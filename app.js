"use strict";

/* ==================== Elements ==================== */

const editor = document.getElementById("editor");
const mirror = document.getElementById("mirror");
const boxesLayer = document.getElementById("boxes");
const textarea = document.getElementById("input");
const statsElement = document.getElementById("stats");
const replaceAllBtn = document.getElementById("replaceAll");
const clearBtn = document.getElementById("clear");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const toastEl = document.getElementById("toast");

/* ==================== Constants ==================== */

// How far before an edit we re-match when doing a targeted re-scan. Wide
// enough to catch any phrase that starts just before the edit, small enough
// to keep re-scans cheap.
const RESCAN_CONTEXT_CHARS = 80;
// Debounce between keystrokes and a full re-scan of the editor.
const SCAN_DEBOUNCE_MS = 200;
// Debounce before a typing burst is committed to the undo history as one step.
const HISTORY_DEBOUNCE_MS = 500;
const TOAST_DURATION_MS = 2200;
// Gap between a suggestion box and the phrase it overlays.
const BOX_GAP = 8;
// Suggestion box width is a rough estimate: longest label text × average
// character width, clamped between these bounds.
const MIN_SUGGESTION_WIDTH = 140;
const MAX_SUGGESTION_WIDTH = 280;
const CHAR_WIDTH_PX = 7.6;
const WIDTH_PADDING_PX = 40;

/* ==================== State ==================== */

let nextMatchId = 1;
// All current matches, left to right, rebuilt on every scan.
let matches = [];
// On-screen rectangles of each matched phrase, recorded during layout and
// hit-tested on mousemove so the hovered phrase's box can be shown. Only
// the hovered box's geometry is computed, on demand, when it's built.
let phraseRects = [];
// The single suggestion box currently shown, if any.
let visibleBox = null;
let rescanTimer = null;

// Undo/redo timeline: history is a stack of text snapshots, historyIndex
// points at the currently visible one. Everything after it is the redo stack.
let history = [textarea.value];
let historyIndex = 0;
let historyTimer = null;
let toastTimer = null;

/* ==================== Dictionary index ==================== */

// Dictionary phrases grouped by their first word, so a scan only ever looks
// at phrases that could actually match at the current position.
const indexByFirstWord = new Map();

/**
 * Counts the words in a string (empty and whitespace-only strings count as 0).
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Filters out replacements that would lengthen the copy. The "never extend
 * the copy" rule: a replacement must have fewer words than the phrase, or —
 * if the same number of words — must not be longer in characters.
 * @param {string} phrase The verbose phrase being replaced.
 * @param {string[]} replacements Candidate alternatives.
 * @returns {string[]} Only the replacements that shorten (or at least never lengthen) the copy.
 */
function usableReplacements(phrase, replacements) {
  const phraseWordCount = wordCount(phrase);
  return replacements.filter((replacement) => {
    const replacementWordCount = wordCount(replacement);
    if (replacementWordCount > phraseWordCount) return false;
    if (replacementWordCount === phraseWordCount && replacement.length > phrase.length) return false;
    return true;
  });
}

/**
 * Sorts replacements shortest-first: fewest words, then fewest characters.
 * The first entry is what "Replace All" applies.
 * @param {string[]} replacements
 * @returns {string[]} A new, ranked array (the input is not mutated).
 */
function rankShortestFirst(replacements) {
  return [...replacements].sort((a, b) => {
    const aWords = wordCount(a);
    const bWords = wordCount(b);
    if (aWords !== bWords) return aWords - bWords;
    return a.length - b.length;
  });
}

/**
 * Adds an indexed entry to the first-word bucket, creating it if needed.
 * @param {string} firstWord The phrase's first word, lowercased.
 * @param {object} entry The indexed entry ({ phrase, words, replacements }).
 */
function addToIndex(firstWord, entry) {
  const bucket = indexByFirstWord.get(firstWord);
  if (bucket) bucket.push(entry);
  else indexByFirstWord.set(firstWord, [entry]);
}

/**
 * Builds the first-word index from DICTIONARY at load time. Applies the
 * never-extend rule, ranks each entry's replacements shortest-first, and
 * drops entries left with no usable replacements.
 */
function buildIndex() {
  indexByFirstWord.clear();
  const droppedPhrases = [];
  for (const entry of DICTIONARY) {
    const replacements = usableReplacements(entry.phrase, entry.replacements);
    if (replacements.length === 0) {
      droppedPhrases.push(entry.phrase);
      continue;
    }
    const words = entry.phrase.toLowerCase().split(/\s+/);
    addToIndex(words[0], {
      phrase: entry.phrase,
      words,
      replacements: rankShortestFirst(replacements),
    });
  }
  if (droppedPhrases.length) {
    console.warn("Dropped dictionary entries that would not shorten the copy:", droppedPhrases);
  }
}

/* ==================== Tokenizer ==================== */

/**
 * Splits text into word tokens. A token carries its exact text, a lowercased
 * copy for matching, and its character offsets. Apostrophes stay inside
 * words, so "today's" is one token.
 * @param {string} text
 * @returns {Array<{text: string, lower: string, start: number, end: number}>}
 */
function tokenize(text) {
  const tokens = [];
  const pattern = /[A-Za-z0-9']+/g;
  let tokenMatch;
  while ((tokenMatch = pattern.exec(text)) !== null) {
    tokens.push({
      text: tokenMatch[0],
      lower: tokenMatch[0].toLowerCase(),
      start: tokenMatch.index,
      end: tokenMatch.index + tokenMatch[0].length,
    });
  }
  return tokens;
}

/* ==================== Matching ==================== */

/**
 * Walks the text left to right and returns every non-overlapping match
 * starting at or after fromCharIndex. Greedy: at each position the longest
 * matching phrase wins, and the scan skips past it.
 * @param {string} text
 * @param {number} fromCharIndex Only matches starting at or after this character offset are returned.
 * @returns {Array<{id: number, entry: object, firstWordText: string, startChar: number, endChar: number}>}
 */
function scan(text, fromCharIndex) {
  const tokens = tokenize(text);
  const found = [];
  let tokenIndex = 0;
  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];
    if (token.start < fromCharIndex) {
      tokenIndex++;
      continue;
    }
    const entry = findLongestMatch(tokens, tokenIndex);
    if (entry) {
      found.push(matchFromTokens(entry, tokens, tokenIndex));
      tokenIndex += entry.words.length;
    } else {
      tokenIndex++;
    }
  }
  return found;
}

/**
 * Finds the longest dictionary phrase that matches the tokens starting at
 * startIndex. Only the first-word bucket for the current token is consulted.
 * @param {Array} tokens From tokenize().
 * @param {number} startIndex Index of the token to try matching at.
 * @returns {object|null} The best indexed entry, or null if nothing matches.
 */
function findLongestMatch(tokens, startIndex) {
  const candidates = indexByFirstWord.get(tokens[startIndex].lower);
  if (!candidates) return null;
  let longest = null;
  for (const entry of candidates) {
    if (entry.words.length <= (longest ? longest.words.length : 0)) continue;
    if (tokensMatch(tokens, startIndex, entry.words)) longest = entry;
  }
  return longest;
}

/**
 * Checks whether the tokens at startIndex equal the given phrase words
 * (word 0 is already known to match; only words 1..n are compared).
 * @param {Array} tokens From tokenize().
 * @param {number} startIndex
 * @param {string[]} words Lowercased phrase words from an indexed entry.
 * @returns {boolean}
 */
function tokensMatch(tokens, startIndex, words) {
  if (startIndex + words.length > tokens.length) return false;
  for (let i = 1; i < words.length; i++) {
    if (tokens[startIndex + i].lower !== words[i]) return false;
  }
  return true;
}

/**
 * Builds a match record (with a fresh id) from a matched entry and the
 * tokens it spans.
 * @param {object} entry The indexed dictionary entry.
 * @param {Array} tokens From tokenize().
 * @param {number} startIndex Token index where the match begins.
 * @returns {object} The match record used by rendering and editing.
 */
function matchFromTokens(entry, tokens, startIndex) {
  const endIndex = startIndex + entry.words.length - 1;
  return {
    id: nextMatchId++,
    entry,
    firstWordText: tokens[startIndex].text,
    startChar: tokens[startIndex].start,
    endChar: tokens[endIndex].end,
  };
}

/**
 * Adjusts a replacement's casing to match how the phrase appears in the
 * text: ALL-CAPS phrases get an ALL-CAPS replacement, sentence-initial
 * phrases get a capitalized one, everything else stays lowercase.
 * @param {object} match
 * @param {string} replacement
 * @returns {string}
 */
function applyCasing(match, replacement) {
  const firstWord = match.firstWordText;
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(firstWord)) {
    return firstLetterToUpperCase(replacement);
  }
  return replacement;
}

/**
 * @param {string} text
 * @returns {string} The same text with its first letter capitalized.
 */
function firstLetterToUpperCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Replaces a match's character span in the text. An empty replacement
 * ("delete the phrase") also absorbs the adjacent space so words don't get
 * glued together — "in the month of January" becomes "in January".
 * @param {string} text
 * @param {object} match
 * @param {string} replacement
 * @returns {string}
 */
function spliceReplacement(text, match, replacement) {
  let startIndex = match.startChar;
  let endIndex = match.endChar;
  if (replacement === "") {
    if (startIndex > 0 && /\s/.test(text[startIndex - 1])) startIndex -= 1;
    else if (endIndex < text.length && /\s/.test(text[endIndex])) endIndex += 1;
  }
  return text.slice(0, startIndex) + replacement + text.slice(endIndex);
}

/* ==================== Rendering ==================== */

/**
 * Rebuilds the whole view: the highlight mirror, the suggestion boxes, the
 * editor height, and the stats bar. Called after every scan or edit.
 */
function render() {
  const text = textarea.value;
  mirror.textContent = "";
  boxesLayer.textContent = "";
  hideBox();
  if (text) {
    const orderedMatches = [...matches].sort((a, b) => a.startChar - b.startChar);
    renderMirror(text, orderedMatches);
    recordPhraseRects(mirror.querySelectorAll("mark"));
  }
  syncEditorHeights();
  updateStats();
}

/**
 * Fills the mirror with the same text as the textarea, wrapping each matched
 * phrase in a <mark> so it can be highlighted. The mirror is purely visual:
 * the transparent textarea on top of it keeps native typing and selection.
 * @param {string} text
 * @param {Array} orderedMatches Matches sorted by startChar.
 */
function renderMirror(text, orderedMatches) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of orderedMatches) {
    if (match.startChar < cursor) continue;
    fragment.append(document.createTextNode(text.slice(cursor, match.startChar)));
    const mark = document.createElement("mark");
    mark.dataset.matchId = match.id;
    mark.textContent = text.slice(match.startChar, match.endChar);
    fragment.append(mark);
    cursor = match.endChar;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  mirror.append(fragment);
}

/**
 * Keeps the transparent textarea tall enough to show the mirror's content
 * and scroll with it.
 */
function syncEditorHeights() {
  const height = Math.max(mirror.offsetHeight, editor.clientHeight);
  textarea.style.height = height + "px";
}

/**
 * Estimates a suggestion box width from its longest label (phrase or
 * replacement), clamped between MIN/MAX_SUGGESTION_WIDTH. A heuristic, not
 * measured text — good enough for stacking purposes.
 * @param {object} match
 * @returns {number} Width in pixels.
 */
function estimateSuggestionBoxWidth(match) {
  const longestText = match.entry.replacements
    .concat(match.entry.phrase)
    .reduce((longest, text) => (text.length > longest.length ? text : longest), "");
  return Math.max(
    MIN_SUGGESTION_WIDTH,
    Math.min(MAX_SUGGESTION_WIDTH, longestText.length * CHAR_WIDTH_PX + WIDTH_PADDING_PX)
  );
}

/**
 * Records each phrase's on-screen rectangle for hover hit-testing. This is
 * the only per-match layout data needed: box geometry is computed on demand
 * when a box is actually built, since only one box exists at a time.
 * @param {NodeList} marks The <mark> elements from the mirror.
 */
function recordPhraseRects(marks) {
  if (!marks.length) return;
  phraseRects = [];
  for (const mark of marks) {
    const markRect = mark.getBoundingClientRect();
    phraseRects.push({
      id: Number(mark.dataset.matchId),
      left: markRect.left,
      top: markRect.top,
      right: markRect.right,
      bottom: markRect.bottom,
    });
  }
}

/**
 * Where a box's top edge goes: BOX_GAP above the phrase, so the box overlays
 * it. If that would push the box off the top of the editor, it flips to just
 * below the phrase instead.
 * @param {number} contentTop Content-space top of the phrase.
 * @param {number} phraseHeight On-screen height of the phrase.
 * @returns {number} The box's top offset in content space.
 */
function topForBoxAbovePhrase(contentTop, phraseHeight) {
  let top = contentTop - BOX_GAP;
  if (top < 0) top = contentTop + phraseHeight + BOX_GAP;
  return top;
}

/**
 * Builds the DOM for one suggestion box: a header with the original phrase
 * and a dismiss button, plus one option button per usable replacement.
 * @param {object} match
 * @returns {HTMLElement} The .suggest-box element, not yet positioned.
 */
function buildSuggestionBox(match) {
  const box = document.createElement("div");
  box.className = "suggest-box";
  box.dataset.matchId = match.id;

  const header = document.createElement("div");
  header.className = "suggest-head";

  const phraseLabel = document.createElement("span");
  phraseLabel.className = "suggest-phrase";
  phraseLabel.textContent = match.entry.phrase;

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "suggest-dismiss";
  dismissButton.textContent = "\u00d7";
  dismissButton.title = "Hide this suggestion";

  header.append(phraseLabel, dismissButton);

  const options = document.createElement("div");
  options.className = "suggest-list";
  for (const replacement of match.entry.replacements) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = replacement === "" ? "suggest-opt suggest-opt-remove" : "suggest-opt";
    button.textContent = replacement === "" ? "remove" : applyCasing(match, replacement);
    button.dataset.replacement = replacement;
    options.append(button);
  }

  box.append(header, options);
  return box;
}

/**
 * Builds and shows the suggestion box for the given match on demand. The
 * box overlays its phrase, and its geometry is computed from the phrase's
 * recorded rect (plus the editor's current scroll position) only when it's
 * built. Any previously shown box is removed first, so at most one box
 * exists in the DOM at a time. Pass null to just hide the current box.
 * @param {number|null} id
 */
function showBoxForMatch(id) {
  hideBox();
  if (id == null) return;
  const rect = phraseRects.find((r) => r.id === id);
  const match = matches.find((m) => m.id === id);
  if (!rect || !match) return;
  const editorRect = editor.getBoundingClientRect();
  const left = rect.left - editorRect.left + editor.scrollLeft;
  const contentTop = rect.top - editorRect.top + editor.scrollTop;
  const box = buildSuggestionBox(match);
  box.style.width = estimateSuggestionBoxWidth(match) + "px";
  box.style.left = left + "px";
  box.style.top = topForBoxAbovePhrase(contentTop, rect.bottom - rect.top) + "px";
  boxesLayer.append(box);
  box.classList.add("visible");
  visibleBox = box;
}

/**
 * Removes the currently shown suggestion box, if any.
 */
function hideBox() {
  if (visibleBox) {
    visibleBox.remove();
    visibleBox = null;
  }
}

/* ==================== Editing ==================== */

/**
 * Targeted re-scan after a single-phrase edit: keeps every suggestion that
 * ends before the edit zone, then re-matches from a context window before
 * the edit to the end. Anything matched again keeps a fresh id, so
 * dismissed suggestions inside the edited region come back if they still
 * match.
 * @param {number} editStartChar Character offset where the edit happened.
 */
function rescanAroundEdit(editStartChar) {
  const text = textarea.value;
  const tokens = tokenize(text);
  const firstTokenAfterEdit = tokens.find((token) => token.end > editStartChar);
  const editWordStart = firstTokenAfterEdit ? firstTokenAfterEdit.start : editStartChar;
  const contextStart = Math.max(0, editWordStart - RESCAN_CONTEXT_CHARS);
  const firstTokenInContext = tokens.find((token) => token.start >= contextStart);
  const rescanStart = firstTokenInContext ? firstTokenInContext.start : text.length;
  matches = matches.filter((match) => match.endChar <= rescanStart);
  matches = matches.concat(scan(text, rescanStart));
}

/**
 * Applies one replacement: rewrites the text, records the edit in history,
 * re-scans around the edit, re-renders, and reports the savings in a toast.
 * @param {object} match
 * @param {string} replacement The raw replacement (casing is applied here).
 */
function applyMatch(match, replacement) {
  const text = textarea.value;
  const applied = applyCasing(match, replacement);
  const newText = spliceReplacement(text, match, applied);
  textarea.value = newText;
  const savedChars = Math.max(0, match.endChar - match.startChar - applied.length);
  const savedWords = Math.max(0, match.entry.words.length - wordCount(applied));
  pushHistory(newText);
  rescanAroundEdit(match.startChar);
  render();
  showToast(replacementMessage(match, applied, savedChars, savedWords));
}

/**
 * Builds the toast text for a single replacement, e.g.
 * "“due to the fact that” → “since” · saved 14 chars, 3 words".
 * @param {object} match
 * @param {string} applied The cased replacement that was applied.
 * @param {number} savedChars
 * @param {number} savedWords
 * @returns {string}
 */
function replacementMessage(match, applied, savedChars, savedWords) {
  const phrase = "\u201c" + match.entry.phrase + "\u201d";
  const change = applied === "" ? "Removed " + phrase : phrase + " \u2192 \u201c" + applied + "\u201d";
  return change + " \u00b7 saved " + formatSavings(savedChars, savedWords);
}

/**
 * Applies the shortest option to every match at once. Matches are processed
 * right to left so earlier character offsets stay valid as the text shrinks.
 */
function replaceAll() {
  const ordered = [...matches].sort((a, b) => b.startChar - a.startChar);
  if (ordered.length === 0) return;
  let text = textarea.value;
  let savedChars = 0;
  let savedWords = 0;
  for (const match of ordered) {
    const replacement = applyCasing(match, match.entry.replacements[0]);
    savedChars += Math.max(0, match.endChar - match.startChar - replacement.length);
    savedWords += Math.max(0, match.entry.words.length - wordCount(replacement));
    text = spliceReplacement(text, match, replacement);
  }
  textarea.value = text;
  pushHistory(text);
  matches = scan(text, 0);
  render();
  showToast(
    "Replaced " + ordered.length + " phrase" + (ordered.length === 1 ? "" : "s") +
      " \u00b7 saved " + formatSavings(savedChars, savedWords)
  );
}

/**
 * Empties the editor and records the empty state in history.
 */
function clearAll() {
  textarea.value = "";
  pushHistory("");
  matches = [];
  render();
}

/* ==================== Undo / redo ==================== */

/**
 * Commits a new text snapshot to the timeline. Anything ahead of the current
 * position (the redo stack) is discarded, since the timeline has branched.
 * @param {string} newText
 */
function pushHistory(newText) {
  clearTimeout(historyTimer);
  history = history.slice(0, historyIndex + 1);
  history.push(newText);
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

/**
 * Replaces the editor contents and re-scans from scratch (used by undo/redo,
 * where no edit offset is known).
 * @param {string} newText
 */
function setTextAndRescan(newText) {
  textarea.value = newText;
  matches = scan(newText, 0);
  render();
}

/**
 * Steps back one snapshot in the timeline, if there is one.
 */
function undo() {
  if (historyIndex <= 0) return;
  clearTimeout(historyTimer);
  historyIndex--;
  setTextAndRescan(history[historyIndex]);
  updateHistoryButtons();
}

/**
 * Steps forward one snapshot in the timeline, if there is one.
 */
function redo() {
  if (historyIndex >= history.length - 1) return;
  clearTimeout(historyTimer);
  historyIndex++;
  setTextAndRescan(history[historyIndex]);
  updateHistoryButtons();
}

/**
 * Enables/disables the Undo and Redo buttons to match the timeline position.
 */
function updateHistoryButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

/* ==================== UI state ==================== */

/**
 * Updates the suggestion count and the enabled state of the toolbar buttons.
 */
function updateStats() {
  const count = matches.length;
  statsElement.textContent =
    count === 0 ? "No suggestions" : count + " suggestion" + (count === 1 ? "" : "s");
  replaceAllBtn.disabled = count === 0;
  updateHistoryButtons();
}

/**
 * Formats a savings figure, e.g. "14 chars, 3 words" (pluralizes correctly).
 * @param {number} savedChars
 * @param {number} savedWords
 * @returns {string}
 */
function formatSavings(savedChars, savedWords) {
  const parts = [savedChars + " char" + (savedChars === 1 ? "" : "s")];
  if (savedWords > 0) parts.push(savedWords + " word" + (savedWords === 1 ? "" : "s"));
  return parts.join(", ");
}

/**
 * Shows a transient toast message, replacing any toast currently visible.
 * @param {string} message
 */
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), TOAST_DURATION_MS);
}

/* ==================== Events ==================== */

/**
 * Full re-scan of the whole editor (the debounced handler for typing).
 */
function scheduleFullRescan() {
  matches = scan(textarea.value, 0);
  render();
}

/**
 * Commits the current text to history once the user has paused typing, so a
 * burst of keystrokes is one undo step. No-op if the text didn't change.
 */
function recordTypingBurst() {
  if (textarea.value !== history[historyIndex]) pushHistory(textarea.value);
}

// Two debounce timers on input: a fast one (200 ms) to keep suggestions in
// sync while typing, and a slower one (500 ms) to commit the burst to the
// undo timeline. Clearing the input takes the fast path: cancel pending
// timers, drop all suggestions, and commit immediately.
textarea.addEventListener("input", () => {
  if (textarea.value === "") {
    clearTimeout(rescanTimer);
    clearTimeout(historyTimer);
    matches = [];
    render();
    pushHistory("");
    return;
  }
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(scheduleFullRescan, SCAN_DEBOUNCE_MS);
  clearTimeout(historyTimer);
  historyTimer = setTimeout(recordTypingBurst, HISTORY_DEBOUNCE_MS);
});

// Keep the mirror's scroll position in lockstep with the textarea.
textarea.addEventListener("scroll", () => {
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
});

/**
 * Finds a match by id, or undefined if it's gone (e.g. after a re-scan).
 * @param {number} id
 * @returns {object|undefined}
 */
function findMatchById(id) {
  return matches.find((match) => match.id === id);
}

/**
 * Handles a click on a replacement option: resolves the box's match and
 * applies the chosen replacement.
 * @param {HTMLElement} button The clicked .suggest-opt button.
 */
function applyReplacementFromBox(button) {
  const box = button.closest(".suggest-box");
  const match = findMatchById(Number(box.dataset.matchId));
  if (match) applyMatch(match, button.dataset.replacement);
}

/**
 * Handles a click on a dismiss button: removes the suggestion until the
 * next re-scan.
 * @param {HTMLElement} button The clicked .suggest-dismiss button.
 */
function dismissMatchFromBox(button) {
  const box = button.closest(".suggest-box");
  matches = matches.filter((match) => match.id !== Number(box.dataset.matchId));
  render();
}

// One delegated click handler for the whole boxes layer: option buttons
// apply a replacement, dismiss buttons hide a suggestion.
boxesLayer.addEventListener("click", (e) => {
  const optionButton = e.target.closest(".suggest-opt");
  if (optionButton) {
    applyReplacementFromBox(optionButton);
    return;
  }
  const dismissButton = e.target.closest(".suggest-dismiss");
  if (dismissButton) dismissMatchFromBox(dismissButton);
});

replaceAllBtn.addEventListener("click", replaceAll);
clearBtn.addEventListener("click", clearAll);
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

// Keyboard shortcuts: Cmd/Ctrl+Z to undo, Cmd/Ctrl+Shift+Z and Ctrl+Y to redo.
document.addEventListener("keydown", (e) => {
  const isShortcutModifier = e.metaKey || e.ctrlKey;
  if (!isShortcutModifier) return;
  const key = e.key.toLowerCase();
  if (key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (key === "y") {
    e.preventDefault();
    redo();
  }
});

/**
 * @param {number} x
 * @param {number} y
 * @param {{left: number, top: number, right: number, bottom: number}} rect
 * @returns {boolean} Whether the point lies inside the rect.
 */
function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// Hover tracking: while the pointer is over the visible box, keep it open
// (so it doesn't flicker as the pointer leaves the phrase); otherwise
// hit-test against the recorded phrase rectangles and build the box for the
// hovered phrase on demand.
editor.addEventListener("mousemove", (e) => {
  const x = e.clientX;
  const y = e.clientY;
  if (visibleBox && pointInRect(x, y, visibleBox.getBoundingClientRect())) {
    return;
  }
  const hit = phraseRects.find((rect) => pointInRect(x, y, rect));
  showBoxForMatch(hit ? hit.id : null);
});

editor.addEventListener("mouseleave", hideBox);

window.addEventListener("resize", () => render());

/* ==================== Init ==================== */

buildIndex();
matches = scan(textarea.value, 0);
render();