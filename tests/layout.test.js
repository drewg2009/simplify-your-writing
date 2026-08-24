"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("suggestion box width grows with content but stays within bounds", () => {
  const { app } = loadApp();
  const short = { entry: { phrase: "ok", replacements: ["y"] } };
  const width = app.estimateSuggestionBoxWidth(short);
  assert.ok(width >= 140 && width <= 280);
  const long = { entry: { phrase: "a phrase that goes on and on and on and on", replacements: ["short"] } };
  assert.equal(app.estimateSuggestionBoxWidth(long), 280);
});

test("the box top overlays the phrase, BOX_GAP above it", () => {
  const { app } = loadApp();
  assert.equal(app.topForBoxAbovePhrase(25, 18), 17);
  assert.equal(app.topForBoxAbovePhrase(120, 18), 112);
});

test("the box flips below the phrase when there's no room above", () => {
  const { app } = loadApp();
  assert.equal(app.topForBoxAbovePhrase(3, 18), 29);
  assert.equal(app.topForBoxAbovePhrase(0, 18), 26);
});

test("render marks every match in the mirror", () => {
  const { app, elements } = loadApp("due to the fact that we tried, in order to fix it");
  app.render();
  const marks = elements["mirror"].querySelectorAll("mark");
  assert.equal(marks.length, 2);
  assert.equal(marks[0].textContent, "due to the fact that");
  assert.equal(marks[1].textContent, "in order to");
});

test("render updates the stats and button states", () => {
  const { app, elements } = loadApp("due to the fact that we tried");
  app.render();
  assert.equal(elements["stats"].textContent, "1 suggestion");
  assert.equal(elements["replaceAll"].disabled, false);

  const empty = loadApp("");
  empty.app.render();
  assert.equal(empty.elements["stats"].textContent, "No suggestions");
  assert.equal(empty.elements["replaceAll"].disabled, true);
});