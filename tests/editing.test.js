"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("applyMatch replaces the phrase with the correct casing", () => {
  const { app, input } = loadApp("In order to fix the issue.");
  app.scheduleFullRescan();
  app.applyMatch(app.scan(input.value, 0)[0], "to");
  assert.equal(input.value, "To fix the issue.");
});

test("applyMatch reports how many characters and words were saved", () => {
  const { app, input, elements } = loadApp("In order to fix the issue.");
  app.scheduleFullRescan();
  app.applyMatch(app.scan(input.value, 0)[0], "to");
  assert.match(elements["toast"].textContent, /saved 9 chars, 2 words/);
});

test("replaceAll applies the shortest option to every match", () => {
  const { app, input, elements } = loadApp(
    "Due to the fact that the server crashed, due to the fact that it failed."
  );
  app.scheduleFullRescan();
  app.replaceAll();
  assert.equal(input.value, "Since the server crashed, since it failed.");
  assert.match(elements["toast"].textContent, /Replaced 2 phrases/);
});

test("clearAll empties the editor and resets the stats", () => {
  const { app, input, elements } = loadApp("Due to the fact that we tried.");
  app.scheduleFullRescan();
  app.clearAll();
  assert.equal(input.value, "");
  assert.equal(elements["stats"].textContent, "No suggestions");
  assert.equal(elements["replaceAll"].disabled, true);
});

test("rescanAroundEdit keeps matches before the edit and re-finds the rest", () => {
  const { app, input, elements } = loadApp();
  const deep = "due to the fact that we tried. " + Array(100).fill("x").join(" ") + " in order to fix it.";
  input.value = deep;
  app.scheduleFullRescan();
  app.rescanAroundEdit(app.scan(deep, 0)[1].startChar);
  app.render();
  assert.equal(elements["stats"].textContent, "2 suggestions");
});

test("dismissing a suggestion removes it until the next re-scan", () => {
  const { app, elements, fire } = loadApp("due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  fire(elements["editor"], "mousemove", { clientX: 50, clientY: 15 });
  const box = elements["boxes"].children[0];
  const dismissButton = box.children[0].children[1];
  fire(elements["boxes"], "click", { target: dismissButton });
  assert.equal(elements["stats"].textContent, "No suggestions");
});