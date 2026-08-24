"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

const INTERNALS_EXPORT =
  "globalThis.__appInternals = {" +
  "get DICTIONARY() { return DICTIONARY; }," +
  "get indexByFirstWord() { return indexByFirstWord; }," +
  "get matches() { return matches; }," +
  "get history() { return history; }" +
  "};";

function createElement(id, options = {}) {
  const classes = new Set();
  const el = {
    id,
    tagName: options.tagName || "div",
    value: options.initialValue ?? "",
    style: {},
    dataset: {},
    disabled: false,
    children: [],
    parentNode: null,
    offsetHeight: 40,
    clientHeight: 200,
    scrollTop: 0,
    scrollLeft: 0,
    title: "",
    listeners: {},
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      has(c) { return classes.has(c); },
      toggle(c, on) {
        if (on === undefined) classes.has(c) ? classes.delete(c) : classes.add(c);
        else if (on) classes.add(c);
        else classes.delete(c);
      },
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
    },
    append(...children) {
      for (const child of children) {
        child.parentNode = el;
        el.children.push(child);
      }
    },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    closest(selector) {
      const wanted = selector.replace(".", "");
      let node = el;
      while (node) {
        if (node.className && String(node.className).split(/\s+/).includes(wanted)) return node;
        node = node.parentNode;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== "mark") return [];
      const marks = [];
      for (const child of el.children) {
        for (const grandchild of child.children || []) {
          if (grandchild.tagName === "mark") marks.push(grandchild);
        }
      }
      return marks;
    },
    addEventListener(type, handler) {
      el.listeners[type] = handler;
    },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._textContent ?? ""; },
    set(value) {
      el._textContent = value;
      if (value === "") el.children.length = 0;
    },
  });
  return el;
}

function loadApp(initialText = "") {
  const dictSource = fs.readFileSync(path.join(ROOT, "dictionary.js"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

  const elements = {};
  const document = {
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElement(id, { initialValue: id === "input" ? initialText : "" });
      }
      return elements[id];
    },
    createElement(tag) { return createElement(tag, { tagName: tag }); },
    createDocumentFragment() { return createElement("fragment"); },
    createTextNode(text) { return { nodeType: 3, textContent: text }; },
    addEventListener() {},
  };
  const window = { addEventListener() {} };

  const sandbox = { document, window, console, Number, Math, RegExp, String, Array, Map, Object };
  Object.defineProperty(sandbox, "setTimeout", { get: () => setTimeout, configurable: true });
  Object.defineProperty(sandbox, "clearTimeout", { get: () => clearTimeout, configurable: true });

  const context = vm.createContext(sandbox);
  vm.runInContext(dictSource + "\n" + appSource + "\n" + INTERNALS_EXPORT, context);

  function fire(element, type, event = {}) {
    element.listeners[type](event);
  }

  return {
    app: context,
    internals: context.__appInternals,
    elements,
    input: elements["input"],
    fire,
  };
}

module.exports = { loadApp };