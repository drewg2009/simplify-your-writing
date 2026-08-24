"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("wordCount counts whitespace-separated words", () => {
  const { app } = loadApp();
  assert.equal(app.wordCount("a b c"), 3);
  assert.equal(app.wordCount("  spaced   out  "), 2);
  assert.equal(app.wordCount(""), 0);
  assert.equal(app.wordCount("   "), 0);
});

test("rankShortestFirst orders by word count then character count", () => {
  const { app } = loadApp();
  assert.deepEqual([...app.rankShortestFirst(["because", "since", "due to"])], [
    "since", "because", "due to",
  ]);
  assert.deepEqual([...app.rankShortestFirst(["because of", "since", "due to the fact that"])], [
    "since", "because of", "due to the fact that",
  ]);
});

test("every dictionary replacement obeys the never-extend-the-copy rule", () => {
  const { app, internals } = loadApp();
  for (const entry of internals.DICTIONARY) {
    assert.deepEqual(
      app.usableReplacements(entry.phrase, entry.replacements),
      entry.replacements,
      entry.phrase + " should keep all of its replacements"
    );
  }
});

test("every indexed entry's replacements are ranked shortest-first", () => {
  const { app, internals } = loadApp();
  app.buildIndex();
  for (const bucket of internals.indexByFirstWord.values()) {
    for (const entry of bucket) {
      assert.deepEqual(
        app.rankShortestFirst(entry.replacements),
        entry.replacements,
        entry.phrase + " replacements should already be ranked"
      );
    }
  }
});

test("index groups phrases by their first word", () => {
  const { app, internals } = loadApp();
  app.buildIndex();
  const bucket = internals.indexByFirstWord.get("due");
  assert.ok(bucket, "bucket exists for the first word 'due'");
  assert.ok(bucket.some((entry) => entry.phrase === "due to the fact that"));
  for (const [firstWord, entries] of internals.indexByFirstWord) {
    for (const entry of entries) {
      assert.equal(entry.words[0], firstWord, entry.phrase + " indexed under its first word");
    }
  }
});