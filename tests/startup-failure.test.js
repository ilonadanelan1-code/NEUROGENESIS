"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");

function runStartup({ mainCanvas = true, mainContext = {}, layerFailure = -1, throwMain = false, throwLayer = false, statusPresent = true } = {}) {
  const status = statusPresent ? { textContent: "" } : null;
  let createdLayers = 0;
  let mainContextCalls = 0;
  const mainElement = mainCanvas ? {
    getContext() {
      mainContextCalls++;
      if (throwMain) throw new Error("main context blocked");
      return mainContext;
    }
  } : null;
  const document = {
    hidden: false,
    getElementById(id) {
      if (id === "brain-canvas") return mainElement;
      if (id === "system-status") return status;
      return null;
    },
    createElement(tag) {
      assert.equal(tag, "canvas");
      const index = createdLayers++;
      return {
        getContext() {
          if (throwLayer && index === layerFailure) throw new Error("layer context blocked");
          return index === layerFailure ? null : {};
        }
      };
    }
  };
  const errors = [];
  const sandbox = {
    document,
    window: { innerWidth: 390 },
    console: { error(...args) { errors.push(args); }, warn() {}, log() {} },
    Math, Map, Set, Date, JSON, Array, Object, Number, String, Boolean, RegExp,
    Promise, Error, TypeError, setTimeout, clearTimeout
  };
  assert.doesNotThrow(() => vm.runInNewContext(source, sandbox, { filename: "app.js" }),
    "canvas startup failures must be handled without an uncaught exception");
  return { status, createdLayers, mainContextCalls, errors };
}

let result = runStartup({ mainCanvas: false });
assert.equal(result.status.textContent, "CANVAS НЕ НАЙДЕН");
assert.equal(result.mainContextCalls, 0);

result = runStartup({ mainCanvas: false, statusPresent: false });
assert.equal(result.errors.length, 0,
  "the fallback must remain safe even when the status element is unavailable");

result = runStartup({ mainContext: null });
assert.equal(result.status.textContent, "CANVAS НЕ ПОДДЕРЖИВАЕТСЯ");
assert.equal(result.createdLayers, 0);

result = runStartup({ throwMain: true });
assert.equal(result.status.textContent, "CANVAS НЕ УДАЛОСЬ ИНИЦИАЛИЗИРОВАТЬ");
assert.equal(result.errors.length, 1);

for (let failedLayer = 0; failedLayer < 3; failedLayer++) {
  result = runStartup({ layerFailure: failedLayer });
  assert.equal(result.status.textContent, "НЕ УДАЛОСЬ СОЗДАТЬ ВСЕ ГРАФИЧЕСКИЕ СЛОИ",
    "each auxiliary canvas layer must fail gracefully: " + failedLayer);
  assert.equal(result.createdLayers, 3, "all offscreen layers are allocated before their contexts are checked");
}

result = runStartup({ layerFailure: 1, throwLayer: true });
assert.equal(result.status.textContent, "ГРАФИЧЕСКИЕ СЛОИ НЕ УДАЛОСЬ СОЗДАТЬ");
assert.equal(result.errors.length, 1);

console.log("NEUROGENESIS startup failure handling: missing canvas, unavailable context and all auxiliary layer failures passed.");
