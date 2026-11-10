"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const viewport = html.match(/<meta name="viewport" content="([^"]+)"/u);

assert.ok(viewport, "the app must declare a mobile viewport");
assert.match(viewport[1], /width=device-width/u);
assert.match(viewport[1], /viewport-fit=cover/u);
assert.doesNotMatch(viewport[1], /user-scalable=no/u,
  "mobile users must retain browser zoom accessibility");

assert.ok(css.includes(".app-shell{height:100vh;height:100dvh;min-height:440px;"),
  "the app must use classic and dynamic viewport heights in supporting browsers");
assert.ok(css.includes("@media(max-width:640px){\n  .topbar{height:57px;"),
  "the portrait layout must have a compact phone breakpoint");
assert.ok(css.includes(".workspace{display:flex;flex-direction:column;overflow:hidden}"),
  "the portrait phone layout must stack the brain and control panel");
assert.ok(css.includes("overflow-y:auto"),
  "mobile panels must keep their contents reachable by scrolling");
assert.match(css, /@media\s*\(pointer:coarse\)\s*\{[\s\S]*?button\s*\{\s*min-height:44px\s*\}/u,
  "coarse-pointer devices must have at least 44px button targets");
assert.match(css, /\.icon-button,\.tool-button\{width:44px;height:44px;min-width:44px/u,
  "canvas and top-bar icon controls must remain comfortably tappable on phones");
assert.ok(css.includes("#brain-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;"),
  "the interactive brain canvas must keep pointer gestures available");

const landscapeRule = "@media(max-height:560px) and (orientation:landscape){";
const landscapeStart = css.indexOf(landscapeRule);
assert.notEqual(landscapeStart, -1, "a short-landscape layout must be defined");
const nextSection = css.indexOf("/* NEUROGENESIS", landscapeStart);
assert.notEqual(nextSection, -1, "the short-landscape layout section must close");
const landscapeCss = css.slice(landscapeStart, nextSection);
assert.ok(landscapeCss.includes(".app-shell{min-height:0}"),
  "short landscape screens must override the shell's 440px minimum height");
assert.ok(landscapeCss.includes(".workspace{display:grid;flex-direction:initial;grid-template-columns:minmax(0,1fr) 270px}"),
  "narrow landscape phones must override the portrait flex layout with a two-column grid");
assert.ok(landscapeCss.includes(".side-panel{display:block;height:auto;flex:initial;padding:0 13px;overflow-y:auto}"),
  "the landscape control panel must remain vertically scrollable without portrait sizing constraints");
assert.ok(landscapeCss.includes(".brain-panel{height:auto;min-height:0;flex:initial}"),
  "the brain panel must not retain portrait flex sizing in landscape mode");

const version = html.match(/DIGITAL ORGANISM · ([0-9.]+)/u)?.[1];
assert.ok(version, "the displayed app version must be present");
assert.ok(html.includes("./styles.css?v=" + version),
  "the stylesheet cache key must match the displayed app version");

assert.ok(html.includes("id=\"layout-button\"") && html.includes("id=\"undo-layout-button\""),
  "the canvas toolbar must expose node separation and undo controls");
assert.ok(app.includes("function separateNeuronLayout()") && app.includes("function undoNeuronLayout()"),
  "the app must provide reversible collision-aware neuron layout");
assert.ok(app.includes("api.cluster(neurons, synapses"),
  "the layout action must use synapse-aware community clustering");
assert.ok(app.includes("const MIN_VIEW_ZOOM = 0.015"),
  "large desktop graphs must be allowed below the old 12% zoom floor");
assert.ok(app.includes("window.NGNeuronLayout.fitViewport"),
  "the app must use viewport-aware fitting");
assert.ok(app.includes("if (layoutGroups.length) fitNetwork()"),
  "grouped layouts must refit after canvas resizing");
assert.ok(app.includes("safeWorldSpan"),
  "the app must reject layouts outside the visible canvas range");
assert.ok(app.includes("restoreUnsafeCommunityLayout"),
  "the app must restore a previous layout when unsafe coordinates are detected");
assert.ok(app.includes("layoutGroups.length>1"),
  "multiple communities must receive distinct visual halos");
assert.ok(app.includes("const compactView=view.zoom<.42"),
  "dense graphs must use reduced-halo overview rendering");
assert.ok(app.includes("const hitRadius = 19"),
  "neuron selection must use screen-space hit targets at small zoom levels");
assert.ok(app.includes("const overview = denseGraph && view.zoom < .62"),
  "dense connections must use a thinner low-zoom rendering mode");
assert.ok(app.includes("function scheduleFrame()"),
  "the canvas must have a single guarded frame scheduler");
assert.ok(app.includes('if (typeof ResizeObserver === "function") {'),
  "the canvas must detect ResizeObserver before using it");
assert.ok(app.includes("window.addEventListener(\"resize\", handleCanvasResize);"),
  "older browsers must retain a window-resize fallback when ResizeObserver is unavailable");
assert.ok(app.includes('document.addEventListener(eventName, scheduleFrame, {capture:true,passive:true});'),
  "user input must wake the renderer from its idle state");
const frameStart = app.indexOf("  function frame(time) {");
const frameEnd = app.indexOf("\n  canvas.addEventListener", frameStart);
assert.notEqual(frameStart, -1, "the canvas frame loop must exist");
assert.notEqual(frameEnd, -1, "the canvas frame loop must have a clear boundary");
const frameBody = app.slice(frameStart, frameEnd);
assert.doesNotMatch(frameBody, /requestAnimationFrame\(frame\)/u,
  "the frame callback must not schedule itself unconditionally while idle");
assert.match(frameBody, /if\(animationActive\)[\s\S]*scheduleFrame\(\)/u,
  "continuous rendering must continue only while the simulation or activity is running");


assert.ok(html.includes("./canvas-quality.js?v=" + version),
  "the bounded canvas allocator must be loaded by the active app version");
assert.ok(html.indexOf("canvas-quality.js") < html.indexOf("app.js"),
  "canvas quality guards must load before the main app");
assert.ok(app.includes("window.NGCanvasQuality") && app.includes("maxPixels: 2800000"),
  "the renderer must use a bounded backing-store pixel budget");
assert.ok(app.includes("if (canvas.width !== resolution.backingWidth)"),
  "duplicate resize events must not clear unchanged canvas buffers");
assert.match(css, /\.app-shell\{min-height:0;padding-block:env\(safe-area-inset-top/u,
  "short viewports and device safe areas must not be clipped by the shell");
assert.match(css, /@media\(orientation:landscape\) and \(max-height:680px\)/u,
  "short landscape layouts must have a viewport-independent two-column rule");
assert.match(css, /prefers-reduced-motion:reduce/u,
  "the visual system must respect reduced-motion accessibility settings");
assert.match(css, /:focus-visible/u,
  "keyboard users must retain a visible focus indicator");

console.log("NEUROGENESIS mobile and visual guardrails: viewport sizing, safe areas, landscape layout, touch targets, focus, reduced motion and bounded canvas renderer passed.");
