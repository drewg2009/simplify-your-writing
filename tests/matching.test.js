"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("tokenize keeps apostrophes inside words intact", () => {
  const { app } = loadApp();
  const tokens = app.tokenize("today's plan isn't late");
  assert.equal(tokens.length, 4);
  assert.equal(tokens[0].text, "today's");
  assert.equal(tokens[2].text, "isn't");
});

test("scan finds every match with correct character spans", () => {
  const { app } = loadApp();
  const matches = app.scan("due to the fact that we tried, due to the fact that we failed.", 0);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].entry.phrase, "due to the fact that");
  assert.equal(matches[0].startChar, 0);
  assert.equal(matches[0].endChar, 20);
  assert.equal(matches[1].startChar, 31);
  assert.equal(matches[1].endChar, 51);
});

test("the longest matching phrase wins over shorter overlapping entries", () => {
  const { app } = loadApp();
  const matches = app.scan("because of the fact that", 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entry.phrase, "because of the fact that");
});

test("matching is case-insensitive", () => {
  const { app } = loadApp();
  const matches = app.scan("DUE TO THE FACT THAT we tried", 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entry.phrase, "due to the fact that");
});

test("matches never overlap in the text", () => {
  const { app } = loadApp();
  const matches = app.scan("because of the fact that we tried due to the fact that it failed", 0);
  assert.ok(matches.length >= 2);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i].startChar >= matches[i - 1].endChar);
  }
});

test("scan skips everything before fromCharIndex", () => {
  const { app } = loadApp();
  const matches = app.scan("due to the fact that we tried, due to the fact that we failed.", 22);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].startChar, 31);
});

test("applyCasing capitalizes the replacement after a sentence-initial match", () => {
  const { app } = loadApp();
  const match = app.scan("Due to the fact that we tried.", 0)[0];
  assert.equal(app.applyCasing(match, "since"), "Since");
});

test("applyCasing uppercases the replacement after an ALL-CAPS match", () => {
  const { app } = loadApp();
  const match = app.scan("DUE TO THE FACT THAT we tried", 0)[0];
  assert.equal(app.applyCasing(match, "since"), "SINCE");
});

test("applyCasing leaves mid-sentence matches lowercase", () => {
  const { app } = loadApp();
  const match = app.scan("we tried, due to the fact that we failed", 0)[0];
  assert.equal(app.applyCasing(match, "since"), "since");
});

test("an empty replacement absorbs the adjacent space", () => {
  const { app } = loadApp();
  const match = app.scan("in the month of January", 0)[0];
  assert.equal(match.entry.phrase, "the month of");
  assert.equal(app.spliceReplacement("in the month of January", match, ""), "in January");
});

test("a normal replacement keeps surrounding punctuation intact", () => {
  const { app } = loadApp();
  const match = app.scan("We tried, due to the fact that it failed.", 0)[0];
  assert.equal(
    app.spliceReplacement("We tried, due to the fact that it failed.", match, "since"),
    "We tried, since it failed."
  );
});