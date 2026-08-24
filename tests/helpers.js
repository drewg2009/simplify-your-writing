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

/**
 * Creates a minimal fake DOM element for the test stub. Element state
 * (children, classes, dataset, listeners) lives on plain object properties,
 * so tests can inspect it directly. textContent mirrors the browser: setting
 * it to "" clears the children.
 * @param {string} id
 * @param {{initialValue?: string, tagName?: string}} [options]
 * @returns {object} The fake element.
 */
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
    remove() {
      if (el.parentNode) {
        const index = el.parentNode.children.indexOf(el);
        if (index !== -1) el.parentNode.children.splice(index, 1);
        el.parentNode = null;
      }
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

/**
 * Loads dictionary.js and app.js together in a sandboxed vm context with a
 * fake DOM, exactly like the browser loads them. Returns the app's functions
 * (via the context), the stubbed elements, and a fire() helper for
 * dispatching events captured by addEventListener.
 *
 * Note: app.js's timers resolve through getters, so tests can use
 * node:test's mock timers to control them.
 *
 * @param {string} [initialText] Starting value of the editor textarea.
 * @returns {{app: object, internals: object, elements: object, input: object, fire: Function}}
 */
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

  /**
   * Dispatches a captured event listener on a stubbed element.
   * @param {object} element
   * @param {string} type
   * @param {object} [event] The event object passed to the handler.
   */
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