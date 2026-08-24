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

test("no suggestion boxes exist until a phrase is hovered", () => {
  const { app, elements } = loadApp("due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  assert.equal(elements["boxes"].children.length, 0);
});

test("hovering a phrase builds and shows its box", () => {
  const { app, elements, fire } = loadApp("due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  fire(elements["editor"], "mousemove", { clientX: 50, clientY: 15 });
  assert.equal(elements["boxes"].children.length, 1);
  assert.equal(elements["boxes"].children[0].classList.has("visible"), true);
});

test("moving the pointer off the phrase hides the box", () => {
  const { app, elements, fire } = loadApp("due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  fire(elements["editor"], "mousemove", { clientX: 50, clientY: 15 });
  fire(elements["editor"], "mousemove", { clientX: 500, clientY: 500 });
  assert.equal(elements["boxes"].children.length, 0);
});

test("clicking a suggestion option applies the replacement", () => {
  const { app, input, elements, fire } = loadApp("Due to the fact that we tried");
  app.scheduleFullRescan();
  app.render();
  fire(elements["editor"], "mousemove", { clientX: 50, clientY: 15 });
  const box = elements["boxes"].children[0];
  const firstOption = box.children[1].children[0];
  fire(elements["boxes"], "click", { target: firstOption });
  assert.equal(input.value, "Since we tried");
});