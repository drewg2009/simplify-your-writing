"use strict";

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./helpers");

test("typing rescans after the debounce delay", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { app, input, elements, fire } = loadApp();
    input.value = "due to the fact that we tried";
    fire(input, "input");
    assert.equal(elements["stats"].textContent, "No suggestions");
    mock.timers.tick(200);
    assert.equal(elements["stats"].textContent, "1 suggestion");
  } finally {
    mock.timers.reset();
  }
});

test("deleting text rescans immediately without the debounce delay", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { app, input, elements, fire } = loadApp("due to the fact that we tried");
    app.scheduleFullRescan();
    app.render();
    input.value = "due to";
    fire(input, "input");
    assert.equal(elements["stats"].textContent, "No suggestions");
    mock.timers.tick(500);
    assert.equal(elements["stats"].textContent, "No suggestions");
  } finally {
    mock.timers.reset();
  }
});

test("clearing the input cancels pending work and commits immediately", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { app, input, fire } = loadApp("due to the fact that we tried");
    app.scheduleFullRescan();
    input.value = "";
    fire(input, "input");
    assert.equal(input.value, "");
    app.undo();
    assert.equal(input.value, "due to the fact that we tried");
  } finally {
    mock.timers.reset();
  }
});

test("hovering a suggestion box keeps it visible", () => {
  const { app, elements, fire } = loadApp("due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  fire(elements["editor"], "mousemove", { clientX: 50, clientY: 15 });
  assert.equal(elements["boxes"].children[0].classList.has("visible"), true);
});

test("clicking a suggestion option applies the replacement", () => {
  const { app, input, elements, fire } = loadApp("Due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  const box = elements["boxes"].children[0];
  const firstOption = box.children[1].children[0];
  fire(elements["boxes"], "click", { target: firstOption });
  assert.equal(input.value, "Since we tried");
});