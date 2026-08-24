"use strict";

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("undo and redo step through committed edits", () => {
  const { app, input } = loadApp("In order to fix the issue.");
  app.scheduleFullRescan();
  app.applyMatch(app.scan(input.value, 0)[0], "to");
  assert.equal(input.value, "To fix the issue.");
  app.undo();
  assert.equal(input.value, "In order to fix the issue.");
  app.redo();
  assert.equal(input.value, "To fix the issue.");
});

test("a new edit after undo discards the redo stack", () => {
  const { app, input } = loadApp("In order to fix the issue.");
  app.scheduleFullRescan();
  app.applyMatch(app.scan(input.value, 0)[0], "to");
  app.undo();
  input.value = "Brand new text.";
  app.scheduleFullRescan();
  app.pushHistory(input.value);
  app.redo();
  assert.equal(input.value, "Brand new text.");
});

test("undo is a no-op at the start of history", () => {
  const { app, input } = loadApp("Due to the fact that we tried.");
  app.undo();
  assert.equal(input.value, "Due to the fact that we tried.");
});

test("a typing burst is committed as a single undo step", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { app, input, fire } = loadApp();
    input.value = "due";
    fire(input, "input");
    mock.timers.tick(100);
    input.value = "due to the fact that";
    fire(input, "input");
    mock.timers.tick(500);
    app.undo();
    assert.equal(input.value, "");
  } finally {
    mock.timers.reset();
  }
});