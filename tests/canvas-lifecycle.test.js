"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync("app.js", "utf8");

function section(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  assert.notEqual(start, -1, "missing section: " + startMarker);
  const end = app.indexOf(endMarker, start);
  assert.notEqual(end, -1, "missing section boundary: " + endMarker);
  return app.slice(start, end);
}

const scheduler = section("  function scheduleFrame() {", "  function rebuildIndexes()");
assert.match(scheduler, /pageSuspended\s*\|\|\s*document\.hidden/u,
  "hidden pages must not enqueue canvas frames");
assert.match(scheduler, /frameHandle\s*=\s*requestAnimationFrame\(frame\)/u,
  "the scheduled animation-frame identifier must be retained");
assert.match(scheduler, /function cancelScheduledFrame\(\)[\s\S]*?cancelAnimationFrame\(frameHandle\)/u,
  "the pending animation frame must be cancellable");
assert.match(scheduler, /frameScheduled\s*=\s*false/u,
  "cancellation must reset the scheduler guard");

const lifecycle = section("  const handleCanvasResize =", "  for (const eventName");
assert.match(lifecycle, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/u,
  "the renderer must respond to document visibility changes");
assert.match(lifecycle, /window\.addEventListener\("pagehide", handlePageHide\)/u,
  "the renderer must suspend when the page enters the back-forward cache");
assert.match(lifecycle, /window\.addEventListener\("pageshow", handlePageShow\)/u,
  "the renderer must restore after the page is shown again");
assert.match(lifecycle, /if \(dirty\) saveState\(\)/u,
  "unsaved network changes must be flushed when rendering is suspended");
assert.match(lifecycle, /clearTimeout\(saveTimer\)/u,
  "the pending debounced save must not be left behind during suspension");
assert.match(lifecycle, /observer\.disconnect\(\)/u,
  "the resize observer must be disconnected on pagehide");
assert.match(lifecycle, /observer\.observe\(canvas\)/u,
  "the resize observer must be recreated when the page returns");
assert.match(lifecycle, /window\.addEventListener\("resize", handleCanvasResize\)/u,
  "the legacy window-resize fallback must remain available");

const observerLifecycle = lifecycle.slice(
  lifecycle.indexOf("  function connectCanvasResizeObserver()"),
  lifecycle.indexOf("  function suspendRendering()")
);
assert.match(observerLifecycle, /try\s*\{[\s\S]*?observer\.observe\(canvas\)/u,
  "a browser with a broken ResizeObserver implementation must fall back instead of crashing");
assert.match(observerLifecycle, /catch\s*\(error\)[\s\S]*?canvasResizeObserver\s*=\s*null/u,
  "a failed observer must not leave a stale observer reference");
assert.match(observerLifecycle, /observer\.disconnect\(\)/u,
  "a partially initialized observer must be disconnected after observe() fails");


function createObserverHarness(ResizeObserverImpl) {
  const observerStart = app.indexOf("  const handleCanvasResize =");
  const observerEnd = app.indexOf("  function suspendRendering()", observerStart);
  assert.notEqual(observerStart, -1, "ResizeObserver lifecycle helpers must exist");
  assert.notEqual(observerEnd, -1, "ResizeObserver lifecycle helpers must have a clear boundary");
  const source = app.slice(observerStart, observerEnd) +
    "\nglobalThis.__observerApi = { connect: connectCanvasResizeObserver, disconnect: disconnectCanvasResizeObserver };";
  const warnings = [];
  const sandbox = {
    ResizeObserver: ResizeObserverImpl,
    canvas: {},
    resize() {},
    scheduleFrame() {},
    console: { warn(...args) { warnings.push(args); } }
  };
  vm.runInNewContext(source, sandbox, { filename: "canvas-observer-lifecycle.js" });
  return { api: sandbox.__observerApi, warnings };
}

let observeCalls = 0, disconnectCalls = 0, constructorCalls = 0;
class WorkingResizeObserver {
  constructor(callback) { constructorCalls++; this.callback = callback; }
  observe() { observeCalls++; }
  disconnect() { disconnectCalls++; }
}
let observerHarness = createObserverHarness(WorkingResizeObserver);
assert.doesNotThrow(() => observerHarness.api.connect());
assert.doesNotThrow(() => observerHarness.api.connect(),
  "duplicate resume events must not create multiple observers");
assert.equal(constructorCalls, 1);
assert.equal(observeCalls, 1);
observerHarness.api.disconnect();
observerHarness.api.disconnect();
assert.equal(disconnectCalls, 1,
  "disconnect must release the active observer only once");

observerHarness = createObserverHarness(undefined);
assert.doesNotThrow(() => observerHarness.api.connect(),
  "browsers without ResizeObserver must continue using the window-resize fallback");
assert.doesNotThrow(() => observerHarness.api.disconnect());

let failedObserveDisconnects = 0;
class BrokenObserveResizeObserver {
  observe() { throw new Error("observe failed"); }
  disconnect() { failedObserveDisconnects++; }
}
observerHarness = createObserverHarness(BrokenObserveResizeObserver);
assert.doesNotThrow(() => observerHarness.api.connect(),
  "an exception from observe() must not interrupt app startup");
assert.equal(failedObserveDisconnects, 1,
  "a partially created observer must be cleaned up after observe() fails");
assert.equal(observerHarness.warnings.length, 1);

class BrokenConstructorResizeObserver {
  constructor() { throw new Error("constructor failed"); }
}
observerHarness = createObserverHarness(BrokenConstructorResizeObserver);
assert.doesNotThrow(() => observerHarness.api.connect(),
  "an exception from the ResizeObserver constructor must use the fallback");
assert.equal(observerHarness.warnings.length, 1);

class BrokenDisconnectResizeObserver {
  observe() {}
  disconnect() { throw new Error("disconnect failed"); }
}
observerHarness = createObserverHarness(BrokenDisconnectResizeObserver);
observerHarness.api.connect();
assert.doesNotThrow(() => observerHarness.api.disconnect(),
  "a cleanup exception must not escape during pagehide");
assert.equal(observerHarness.warnings.length, 1);

const frameStart = app.indexOf("  function frame(time) {");
const frameEnd = app.indexOf("\n  canvas.addEventListener", frameStart);
assert.notEqual(frameStart, -1, "the canvas frame loop must exist");
assert.notEqual(frameEnd, -1, "the canvas frame loop must have a clear boundary");
const frameBody = app.slice(frameStart, frameEnd);
assert.match(frameBody, /frameHandle\s*=\s*null[\s\S]*?if \(pageSuspended \|\| document\.hidden\)[\s\S]*?return;/u,
  "a stale frame callback must exit before advancing simulation state");
assert.doesNotMatch(frameBody, /requestAnimationFrame\(frame\)/u,
  "the frame callback must not schedule itself unconditionally while idle");
assert.match(frameBody, /if\(animationActive\)[\s\S]*scheduleFrame\(\)/u,
  "continuous rendering must continue only while simulation activity is running");

console.log("NEUROGENESIS canvas lifecycle contracts: hidden-page suspension, frame cancellation, save flush, observer cleanup and restoration passed.");
