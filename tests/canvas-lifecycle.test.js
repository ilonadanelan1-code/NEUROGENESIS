"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

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
assert.match(lifecycle, /canvasResizeObserver\.disconnect\(\)/u,
  "the resize observer must be disconnected on pagehide");
assert.match(lifecycle, /canvasResizeObserver\.observe\(canvas\)/u,
  "the resize observer must be recreated when the page returns");
assert.match(lifecycle, /window\.addEventListener\("resize", handleCanvasResize\)/u,
  "the legacy window-resize fallback must remain available");

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
