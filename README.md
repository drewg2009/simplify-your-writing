# Simplify Your Writing

<img width="1488" height="399" alt="image" src="https://github.com/user-attachments/assets/e4a6962f-2254-4887-9fbd-d3df6a9f72f2" />


A tiny, fully client-side tool that finds wordy phrases in your text and suggests shorter ways to say the same thing. No AI, no network calls, no randomness — just deterministic dictionary lookups in your browser.

Paste text into the editor, and every phrase that can be tightened gets highlighted. **Hover a highlighted phrase** to reveal its suggestion box (it stays open while your pointer is on the box), pick an option to replace that one phrase, hit **Replace All** to apply the top option everywhere, or dismiss a suggestion you don't agree with.

## Why no AI?

The whole point is predictability. Given the same text, this tool always produces the same suggestions in the same order. Every rule is a plain phrase → replacement mapping you can read and edit by hand, so nothing surprising ever comes out of it.

## How it works

### 1. The dictionary (`dictionary.js`)

A single in-memory array of entries:

```js
{ phrase: "due to the fact that", replacements: ["since", "because"] }
```

- Matching is **case-insensitive**; punctuation around the phrase is untouched.
- If the matched phrase starts a sentence, the replacement is capitalized automatically.
- An entry with an empty-string replacement (`""`) means "delete the phrase" — the tool absorbs the adjacent space so text like `in the month of January` becomes `January`.

### 2. The "never extend the copy" rule

Every replacement is checked at load time against two hard rules:

1. It must have **fewer words** than the phrase it replaces.
2. If it has the **same number of words**, it must not be **longer in characters**.

Anything that would make the text longer is discarded at startup (and logged to the console), and any entry left with no valid replacements is dropped entirely. Valid options are then **ranked shortest-first** (fewest words, then fewest characters), so the first option in every box — and the one **Replace All** applies — is always the shortest way to say it.

### 3. Matching (`app.js`)

- **Tokenizer** — scans the text into word tokens (`[A-Za-z0-9']+`) with character offsets, so apostrophes like `today's` stay intact.
- **Hash index** — at startup every dictionary phrase is indexed by its **first word** (`Map<firstWord, entries[]>`), so the scanner only ever looks at candidates that can actually match at the current position.
- **Greedy longest-match scan** — the text is walked left to right. At each word only the first-word bucket is consulted, and the longest matching phrase wins (so `because of the fact that` beats `because of`, and they never overlap).
- **Overlaps** — matches never overlap in the text, but their suggestion boxes can collide horizontally, so boxes are **staggered** into stacked rows above the phrase (flipping below the text when there's no room above).
- **Hover tracking** — during layout every phrase's on-screen rectangle is recorded (`matchRects`), and a `mousemove` handler hit-tests the pointer against those rects (plus the visible box rects) so only the hovered phrase's box is ever shown. The phrase's character span is what gets tracked; the rects are derived from it each render.

### 4. Editing

- **Per-phrase replace** — clicking an option rewrites the textarea and re-scans only the affected region: it keeps every suggestion that ends before the edit, drops everything inside the edited zone, and re-matches from a ~80-character context window before the edit to the end. Nothing else is touched. The toast reports the phrase swap plus exactly how many characters (and words) it saved.
- **Replace All** — applies the first (shortest) option to every suggestion at once, then re-scans. The toast reports how many phrases were replaced and the total characters and words saved.
- **Undo / redo** — a timeline of text snapshots: every change (replace, replace all, clear, and typing bursts) pushes a new snapshot and discards anything ahead of it in the redo stack; undo pops backwards and re-pushes onto the redo stack. Typing is coalesced (a 500 ms idle debounce), so a burst of keystrokes is one undo step. Buttons in the toolbar, plus `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, and `Ctrl+Y`.
- **Dismiss (×)** — hides that suggestion until the next re-scan.
- **Typing/pasting** — a 200 ms debounce triggers a full re-scan so suggestions stay in sync as you edit manually.

### 5. Rendering

The editor is a classic mirror technique: a transparent-text `<textarea>` sits on top of a `pre-wrap` mirror `<div>` that renders the same text with `<mark>` highlights. Suggestion boxes are absolutely positioned over each highlighted phrase, so native typing, caret, selection, and undo all keep working normally.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell: header, toolbar, editor, sample text |
| `style.css` | All styling, including the staggered suggestion boxes |
| `dictionary.js` | The phrase dictionary (the only file you need to edit to add rules) |
| `app.js` | Engine: index, tokenizer, matcher, rendering, re-scan logic |

## Run it

Just open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

No build step, no dependencies.

## Adding your own rules

Append to `DICTIONARY` in `dictionary.js`:

```js
{ phrase: "in close proximity to", replacements: ["near"] },
```

Rules:

- The phrase should be written the way it appears in normal text (case doesn't matter).
- Put the **shortest option first** — or don't bother, the engine re-ranks shortest-first at load anyway.
- Options that would lengthen the text are dropped automatically; check the browser console to see which entries got filtered.
- Use `""` as a replacement to delete a filler phrase entirely.

## Where this could go next

- **Database-backed dictionary** — swap the `DICTIONARY` constant for a fetch of the same-shaped data from a server or SQLite-backed API; the engine only depends on the shape, not the source.
- **Pattern rules** — e.g., `in a {adj} manner` → `{adv}`, handled by the same matcher.
- **Stats** — words saved per edit, most-recurring phrases, per-document reports.

## Sources

The dictionary is curated from public plain-English references: the Plain English Campaign's *A to Z of alternative words*, the UW–Madison Writing Center, englishgrammar.org, Daily Writing Tips, grammarist.com, LanguageTool, and common redundancy lists.
