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

test("shiftUpUntilClear stacks a box above its collision", () => {
  const { app } = loadApp();
  const placed = [{ left: 10, right: 60, top: 0, bottom: 30 }];
  assert.equal(app.shiftUpUntilClear(5, 20, 30, 20, placed), -26);
  assert.equal(app.shiftUpUntilClear(40, 20, 30, 20, placed), 40);
});

test("shiftDownUntilClear stacks a box below its collision", () => {
  const { app } = loadApp();
  const placed = [{ left: 10, right: 60, top: 0, bottom: 30 }];
  assert.equal(app.shiftDownUntilClear(20, 20, 30, 20, placed), 36);
});

test("overlap helpers detect collisions on each axis", () => {
  const { app } = loadApp();
  assert.equal(app.horizontallyOverlaps(20, 30, { left: 10, right: 60 }), true);
  assert.equal(app.horizontallyOverlaps(70, 20, { left: 10, right: 60 }), false);
  assert.equal(app.verticallyOverlaps(5, 20, { top: 0, bottom: 30 }), true);
  assert.equal(app.verticallyOverlaps(40, 20, { top: 0, bottom: 30 }), false);
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