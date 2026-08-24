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

const RESCAN_CONTEXT_CHARS = 80;
const SCAN_DEBOUNCE_MS = 200;
const HISTORY_DEBOUNCE_MS = 500;
const TOAST_DURATION_MS = 2200;
const BOX_GAP = 8;
const STACK_GAP = 6;
const MAX_STACK_ATTEMPTS = 20;
const MIN_SUGGESTION_WIDTH = 140;
const MAX_SUGGESTION_WIDTH = 280;
const CHAR_WIDTH_PX = 7.6;
const WIDTH_PADDING_PX = 40;

/* ==================== State ==================== */

let nextMatchId = 1;
let matches = [];
let phraseRects = [];
let rescanTimer = null;

let history = [textarea.value];
let historyIndex = 0;
let historyTimer = null;
let toastTimer = null;

/* ==================== Dictionary index ==================== */

const indexByFirstWord = new Map();

function wordCount(text) {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function usableReplacements(phrase, replacements) {
  const phraseWordCount = wordCount(phrase);
  return replacements.filter((replacement) => {
    const replacementWordCount = wordCount(replacement);
    if (replacementWordCount > phraseWordCount) return false;
    if (replacementWordCount === phraseWordCount && replacement.length > phrase.length) return false;
    return true;
  });
}

function rankShortestFirst(replacements) {
  return [...replacements].sort((a, b) => {
    const aWords = wordCount(a);
    const bWords = wordCount(b);
    if (aWords !== bWords) return aWords - bWords;
    return a.length - b.length;
  });
}

function addToIndex(firstWord, entry) {
  const bucket = indexByFirstWord.get(firstWord);
  if (bucket) bucket.push(entry);
  else indexByFirstWord.set(firstWord, [entry]);
}

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

function tokensMatch(tokens, startIndex, words) {
  if (startIndex + words.length > tokens.length) return false;
  for (let i = 1; i < words.length; i++) {
    if (tokens[startIndex + i].lower !== words[i]) return false;
  }
  return true;
}

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

function firstLetterToUpperCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

function render() {
  const text = textarea.value;
  mirror.textContent = "";
  boxesLayer.textContent = "";
  if (text) {
    const orderedMatches = [...matches].sort((a, b) => a.startChar - b.startChar);
    renderMirror(text, orderedMatches);
    layoutSuggestionBoxes(orderedMatches, mirror.querySelectorAll("mark"));
  }
  syncEditorHeights();
  updateStats();
}

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

function syncEditorHeights() {
  const height = Math.max(mirror.offsetHeight, editor.clientHeight);
  textarea.style.height = height + "px";
}

function estimateSuggestionBoxWidth(match) {
  const longestText = match.entry.replacements
    .concat(match.entry.phrase)
    .reduce((longest, text) => (text.length > longest.length ? text : longest), "");
  return Math.max(
    MIN_SUGGESTION_WIDTH,
    Math.min(MAX_SUGGESTION_WIDTH, longestText.length * CHAR_WIDTH_PX + WIDTH_PADDING_PX)
  );
}

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

function layoutSuggestionBoxes(orderedMatches, marks) {
  if (!marks.length) return;
  const editorRect = editor.getBoundingClientRect();
  const scrollLeft = editor.scrollLeft;
  const scrollTop = editor.scrollTop;
  const placedBoxes = [];
  phraseRects = [];

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const match = orderedMatches[i];
    const markRect = mark.getBoundingClientRect();
    phraseRects.push({
      id: match.id,
      left: markRect.left,
      top: markRect.top,
      right: markRect.right,
      bottom: markRect.bottom,
    });

    const box = buildSuggestionBox(match);
    boxesLayer.append(box);
    const width = estimateSuggestionBoxWidth(match);
    box.style.width = width + "px";
    const height = box.offsetHeight;

    const left = markRect.left - editorRect.left + scrollLeft;
    const contentTop = markRect.top - editorRect.top + scrollTop;
    const top = positionBox(box, left, width, height, contentTop, markRect.height, placedBoxes);

    placedBoxes.push({ left, right: left + width, top, bottom: top + height });
  }
}

function positionBox(box, left, width, height, contentTop, phraseHeight, placedBoxes) {
  let top = contentTop - height - BOX_GAP;
  top = shiftUpUntilClear(top, left, width, height, placedBoxes);
  if (top < 0) {
    top = contentTop + phraseHeight + BOX_GAP;
    top = shiftDownUntilClear(top, left, width, height, placedBoxes);
  }
  top = Math.max(0, top);
  box.style.left = left + "px";
  box.style.top = top + "px";
  return top;
}

function shiftUpUntilClear(top, left, width, height, placedBoxes) {
  let attempts = 0;
  while (attempts++ < MAX_STACK_ATTEMPTS) {
    const collision = findCollision(top, left, width, height, placedBoxes);
    if (!collision) break;
    top = collision.top - height - STACK_GAP;
  }
  return top;
}

function shiftDownUntilClear(top, left, width, height, placedBoxes) {
  let attempts = 0;
  while (attempts++ < MAX_STACK_ATTEMPTS) {
    const collision = findCollision(top, left, width, height, placedBoxes);
    if (!collision) break;
    top = collision.bottom + STACK_GAP;
  }
  return top;
}

function findCollision(top, left, width, height, placedBoxes) {
  return placedBoxes.find(
    (placed) =>
      horizontallyOverlaps(left, width, placed) &&
      verticallyOverlaps(top, height, placed)
  );
}

function horizontallyOverlaps(left, width, placed) {
  return left < placed.right && left + width > placed.left;
}

function verticallyOverlaps(top, height, placed) {
  return top < placed.bottom && top + height > placed.top;
}

function showBoxForMatch(id) {
  for (const box of boxesLayer.children) {
    box.classList.toggle("visible", Number(box.dataset.matchId) === id);
  }
}

function hideAllBoxes() {
  for (const box of boxesLayer.children) {
    box.classList.remove("visible");
  }
}

/* ==================== Editing ==================== */

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

function replacementMessage(match, applied, savedChars, savedWords) {
  const phrase = "\u201c" + match.entry.phrase + "\u201d";
  const change = applied === "" ? "Removed " + phrase : phrase + " \u2192 \u201c" + applied + "\u201d";
  return change + " \u00b7 saved " + formatSavings(savedChars, savedWords);
}

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

function clearAll() {
  textarea.value = "";
  pushHistory("");
  matches = [];
  render();
}

/* ==================== Undo / redo ==================== */

function pushHistory(newText) {
  clearTimeout(historyTimer);
  history = history.slice(0, historyIndex + 1);
  history.push(newText);
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function setTextAndRescan(newText) {
  textarea.value = newText;
  matches = scan(newText, 0);
  render();
}

function undo() {
  if (historyIndex <= 0) return;
  clearTimeout(historyTimer);
  historyIndex--;
  setTextAndRescan(history[historyIndex]);
  updateHistoryButtons();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  clearTimeout(historyTimer);
  historyIndex++;
  setTextAndRescan(history[historyIndex]);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

/* ==================== UI state ==================== */

function updateStats() {
  const count = matches.length;
  statsElement.textContent =
    count === 0 ? "No suggestions" : count + " suggestion" + (count === 1 ? "" : "s");
  replaceAllBtn.disabled = count === 0;
  updateHistoryButtons();
}

function formatSavings(savedChars, savedWords) {
  const parts = [savedChars + " char" + (savedChars === 1 ? "" : "s")];
  if (savedWords > 0) parts.push(savedWords + " word" + (savedWords === 1 ? "" : "s"));
  return parts.join(", ");
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), TOAST_DURATION_MS);
}

/* ==================== Events ==================== */

function scheduleFullRescan() {
  matches = scan(textarea.value, 0);
  render();
}

function recordTypingBurst() {
  if (textarea.value !== history[historyIndex]) pushHistory(textarea.value);
}

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

textarea.addEventListener("scroll", () => {
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
});

function findMatchById(id) {
  return matches.find((match) => match.id === id);
}

function applyReplacementFromBox(button) {
  const box = button.closest(".suggest-box");
  const match = findMatchById(Number(box.dataset.matchId));
  if (match) applyMatch(match, button.dataset.replacement);
}

function dismissMatchFromBox(button) {
  const box = button.closest(".suggest-box");
  matches = matches.filter((match) => match.id !== Number(box.dataset.matchId));
  render();
}

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

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

editor.addEventListener("mousemove", (e) => {
  const x = e.clientX;
  const y = e.clientY;
  for (const box of boxesLayer.children) {
    if (pointInRect(x, y, box.getBoundingClientRect())) {
      showBoxForMatch(Number(box.dataset.matchId));
      return;
    }
  }
  const hit = phraseRects.find((rect) => pointInRect(x, y, rect));
  showBoxForMatch(hit ? hit.id : null);
});

editor.addEventListener("mouseleave", hideAllBoxes);

window.addEventListener("resize", () => render());

/* ==================== Init ==================== */

buildIndex();
matches = scan(textarea.value, 0);
render();