"use strict";

const editor = document.getElementById("editor");
const mirror = document.getElementById("mirror");
const boxesLayer = document.getElementById("boxes");
const textarea = document.getElementById("input");
const statsEl = document.getElementById("stats");
const replaceAllBtn = document.getElementById("replaceAll");
const clearBtn = document.getElementById("clear");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");

const RESCAN_CONTEXT = 80;
let nextId = 1;
let matches = [];
let matchRects = [];
let rescanTimer = null;

let history = [textarea.value];
let historyIndex = 0;
let commitTimer = null;

/* ==================== Dictionary index ==================== */

const indexByFirstWord = new Map();

function wordCount(s) {
  return s.trim() === "" ? 0 : s.split(/\s+/).length;
}

function buildIndex() {
  indexByFirstWord.clear();
  const dropped = [];
  for (const entry of DICTIONARY) {
    const words = entry.phrase.toLowerCase().split(/\s+/);
    const phraseWords = words.length;
    const phraseChars = entry.phrase.length;
    const usable = entry.replacements.filter((rep) => {
      const rw = wordCount(rep);
      if (rw > phraseWords) return false;
      if (rw === phraseWords && rep.length > phraseChars) return false;
      return true;
    });
    if (!usable.length) {
      dropped.push(entry.phrase);
      continue;
    }
    usable.sort((a, b) => {
      const aw = wordCount(a);
      const bw = wordCount(b);
      if (aw !== bw) return aw - bw;
      return a.length - b.length;
    });
    const key = words[0];
    let arr = indexByFirstWord.get(key);
    if (!arr) {
      arr = [];
      indexByFirstWord.set(key, arr);
    }
    arr.push({ phrase: entry.phrase, replacements: usable, words });
  }
  if (dropped.length) {
    console.warn("Dropped dictionary entries that would not shorten the copy:", dropped);
  }
}

/* ==================== Tokenizer ==================== */

function tokenize(text) {
  const tokens = [];
  const re = /[A-Za-z0-9']+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({
      norm: m[0].toLowerCase(),
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tokens;
}

/* ==================== Matching ==================== */

function scan(text, fromIndex) {
  const tokens = tokenize(text);
  const result = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.start < fromIndex) {
      i++;
      continue;
    }
    const candidates = indexByFirstWord.get(t.norm);
    let best = null;
    if (candidates) {
      for (const entry of candidates) {
        const n = entry.words.length;
        if (i + n > tokens.length) continue;
        let ok = true;
        for (let j = 1; j < n; j++) {
          if (tokens[i + j].norm !== entry.words[j]) {
            ok = false;
            break;
          }
        }
        if (ok && (!best || n > best.entry.words.length)) {
          best = { entry, len: n };
        }
      }
    }
    if (best) {
      const startTok = tokens[i];
      const endTok = tokens[i + best.len - 1];
      result.push({
        id: nextId++,
        entry: best.entry,
        firstWordRaw: startTok.raw,
        startChar: startTok.start,
        endChar: endTok.end,
      });
      i += best.len;
    } else {
      i++;
    }
  }
  return result;
}

function applyCasing(m, replacement) {
  const raw = m.firstWordRaw;
  if (raw.length > 1 && raw === raw.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(raw)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function spliceReplacement(text, m, replacement) {
  let start = m.startChar;
  let end = m.endChar;
  if (replacement === "") {
    if (start > 0 && /\s/.test(text[start - 1])) start -= 1;
    else if (end < text.length && /\s/.test(text[end])) end += 1;
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

/* ==================== Rendering ==================== */

function render() {
  const text = textarea.value;
  mirror.textContent = "";
  boxesLayer.textContent = "";

  if (text) {
    const sorted = [...matches].sort((a, b) => a.startChar - b.startChar);
    const fragment = document.createDocumentFragment();
    let pos = 0;
    for (const m of sorted) {
      if (m.startChar < pos) continue;
      fragment.append(document.createTextNode(text.slice(pos, m.startChar)));
      const mark = document.createElement("mark");
      mark.dataset.matchId = m.id;
      mark.textContent = text.slice(m.startChar, m.endChar);
      fragment.append(mark);
      pos = m.endChar;
    }
    fragment.append(document.createTextNode(text.slice(pos)));
    mirror.append(fragment);
    layoutBoxes(sorted, mirror.querySelectorAll("mark"));
  }

  syncHeights();
  updateStats();
}

function syncHeights() {
  const h = Math.max(mirror.offsetHeight, editor.clientHeight);
  textarea.style.height = h + "px";
}

function estimateBoxWidth(m) {
  const texts = m.entry.replacements.concat(m.entry.phrase);
  const longest = texts.reduce((a, b) => (b.length > a.length ? b : a), "");
  return Math.max(140, Math.min(280, longest.length * 7.6 + 40));
}

function layoutBoxes(matchesList, marks) {
  if (!marks.length) return;
  const editorRect = editor.getBoundingClientRect();
  const scrollLeft = editor.scrollLeft;
  const scrollTop = editor.scrollTop;
  const placed = [];
  matchRects = [];

  for (let k = 0; k < marks.length; k++) {
    const mark = marks[k];
    const m = matchesList[k];
    const rect = mark.getBoundingClientRect();
    matchRects.push({ id: m.id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    const contentLeft = rect.left - editorRect.left + scrollLeft;
    const contentTop = rect.top - editorRect.top + scrollTop;
    const phraseHeight = rect.height;

    const box = document.createElement("div");
    box.className = "suggest-box";
    box.dataset.matchId = m.id;

    const head = document.createElement("div");
    head.className = "suggest-head";
    const label = document.createElement("span");
    label.className = "suggest-phrase";
    label.textContent = m.entry.phrase;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "suggest-dismiss";
    dismiss.textContent = "\u00d7";
    dismiss.title = "Hide this suggestion";
    head.append(label, dismiss);

    const list = document.createElement("div");
    list.className = "suggest-list";
    for (const rep of m.entry.replacements) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = rep === "" ? "suggest-opt suggest-opt-remove" : "suggest-opt";
      btn.textContent = rep === "" ? "remove" : applyCasing(m, rep);
      btn.dataset.replacement = rep;
      list.append(btn);
    }

    box.append(head, list);
    boxesLayer.append(box);

    const width = estimateBoxWidth(m);
    box.style.width = width + "px";
    const height = box.offsetHeight;
    const left = contentLeft;

    let top = contentTop - height - 8;
    top = resolveVertical(top, left, width, height, placed);
    if (top < 0) {
      top = contentTop + phraseHeight + 8;
      top = resolveVerticalDown(top, left, width, height, placed);
    }
    box.style.left = left + "px";
    box.style.top = Math.max(0, top) + "px";
    placed.push({ left, right: left + width, top: Math.max(0, top), bottom: Math.max(0, top) + height });
  }
}

function overlapsH(left, width, p) {
  return left < p.right && left + width > p.left;
}

function showMatchBox(id) {
  for (const box of boxesLayer.children) {
    box.classList.toggle("visible", Number(box.dataset.matchId) === id);
  }
}

function hideAllBoxes() {
  for (const box of boxesLayer.children) {
    box.classList.remove("visible");
  }
}

function resolveVertical(startTop, left, width, height, placed) {
  let top = startTop;
  let guard = 0;
  while (guard++ < 20) {
    const hit = placed.find((p) => overlapsH(left, width, p) && top < p.bottom && top + height > p.top);
    if (!hit) break;
    top = hit.top - height - 6;
  }
  return top;
}

function resolveVerticalDown(startTop, left, width, height, placed) {
  let top = startTop;
  let guard = 0;
  while (guard++ < 20) {
    const hit = placed.find((p) => overlapsH(left, width, p) && top < p.bottom && top + height > p.top);
    if (!hit) break;
    top = hit.bottom + 6;
  }
  return top;
}

/* ==================== Editing ==================== */

function rescanAround(editStart) {
  const text = textarea.value;
  const tokens = tokenize(text);
  let idx = 0;
  while (idx < tokens.length && tokens[idx].end <= editStart) idx++;
  const anchor = tokens[idx] || null;
  const editWordStart = anchor ? anchor.start : editStart;
  const contextPos = Math.max(0, editWordStart - RESCAN_CONTEXT);
  let s = 0;
  while (s < tokens.length && tokens[s].start < contextPos) s++;
  const rescanStart = s < tokens.length ? tokens[s].start : text.length;
  matches = matches.filter((m) => m.endChar <= rescanStart);
  matches = matches.concat(scan(text, rescanStart));
}

function applyMatch(m, replacement) {
  const text = textarea.value;
  const rep = applyCasing(m, replacement);
  const newText = spliceReplacement(text, m, rep);
  textarea.value = newText;
  const savedChars = Math.max(0, m.endChar - m.startChar - rep.length);
  const savedWords = Math.max(0, m.entry.words.length - wordCount(rep));
  commitTimeline(newText);
  rescanAround(m.startChar);
  render();
  showToast(
    (rep === "" ? "Removed \u201c" + m.entry.phrase + "\u201d" : "\u201c" + m.entry.phrase + "\u201d \u2192 \u201c" + rep + "\u201d") +
      " \u00b7 saved " + savingsLabel(savedChars, savedWords)
  );
}

function replaceAll() {
  const ordered = [...matches].sort((a, b) => b.startChar - a.startChar);
  if (!ordered.length) return;
  let text = textarea.value;
  let savedChars = 0;
  let savedWords = 0;
  for (const m of ordered) {
    const rep = applyCasing(m, m.entry.replacements[0]);
    savedChars += Math.max(0, m.endChar - m.startChar - rep.length);
    savedWords += Math.max(0, m.entry.words.length - wordCount(rep));
    text = spliceReplacement(text, m, rep);
  }
  textarea.value = text;
  commitTimeline(text);
  matches = scan(text, 0);
  render();
  showToast(
    "Replaced " + ordered.length + " phrase" + (ordered.length === 1 ? "" : "s") +
      " \u00b7 saved " + savingsLabel(savedChars, savedWords)
  );
}

function clearAll() {
  textarea.value = "";
  commitTimeline("");
  matches = [];
  render();
}

/* ==================== Undo / redo ==================== */

function commitTimeline(newText) {
  clearTimeout(commitTimer);
  history = history.slice(0, historyIndex + 1);
  history.push(newText);
  historyIndex = history.length - 1;
  updateHistoryUI();
}

function setTextAndRescan(newText) {
  textarea.value = newText;
  matches = scan(newText, 0);
  render();
}

function undo() {
  if (historyIndex <= 0) return;
  clearTimeout(commitTimer);
  historyIndex--;
  setTextAndRescan(history[historyIndex]);
  updateHistoryUI();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  clearTimeout(commitTimer);
  historyIndex++;
  setTextAndRescan(history[historyIndex]);
  updateHistoryUI();
}

function updateHistoryUI() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

/* ==================== UI state ==================== */

function updateStats() {
  const n = matches.length;
  statsEl.textContent = n === 0 ? "No suggestions" : n + " suggestion" + (n === 1 ? "" : "s");
  replaceAllBtn.disabled = n === 0;
  updateHistoryUI();
}

function savingsLabel(savedChars, savedWords) {
  const parts = [savedChars + " char" + (savedChars === 1 ? "" : "s")];
  if (savedWords > 0) parts.push(savedWords + " word" + (savedWords === 1 ? "" : "s"));
  return parts.join(", ");
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ==================== Events ==================== */

textarea.addEventListener("input", () => {
  if (textarea.value === "") {
    clearTimeout(rescanTimer);
    clearTimeout(commitTimer);
    matches = [];
    render();
    commitTimeline("");
    return;
  }
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    matches = scan(textarea.value, 0);
    render();
  }, 200);
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    if (textarea.value !== history[historyIndex]) {
      commitTimeline(textarea.value);
    }
  }, 500);
});

textarea.addEventListener("scroll", () => {
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
});

boxesLayer.addEventListener("click", (e) => {
  const opt = e.target.closest(".suggest-opt");
  if (opt) {
    const box = opt.closest(".suggest-box");
    const m = matches.find((x) => x.id === Number(box.dataset.matchId));
    if (m) applyMatch(m, opt.dataset.replacement);
    return;
  }
  const dismiss = e.target.closest(".suggest-dismiss");
  if (dismiss) {
    const box = dismiss.closest(".suggest-box");
    matches = matches.filter((x) => x.id !== Number(box.dataset.matchId));
    render();
  }
});

replaceAllBtn.addEventListener("click", replaceAll);
clearBtn.addEventListener("click", clearAll);
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
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

editor.addEventListener("mousemove", (e) => {
  const x = e.clientX;
  const y = e.clientY;
  for (const box of boxesLayer.children) {
    const r = box.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      showMatchBox(Number(box.dataset.matchId));
      return;
    }
  }
  const hit = matchRects.find((mr) => x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom);
  showMatchBox(hit ? hit.id : null);
});

editor.addEventListener("mouseleave", hideAllBoxes);

window.addEventListener("resize", () => render());

/* ==================== Init ==================== */

buildIndex();
matches = scan(textarea.value, 0);
render();