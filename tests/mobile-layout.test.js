"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const viewport = html.match(/<meta name="viewport" content="([^"]+)"/u);

assert.ok(viewport, "the app must declare a mobile viewport");
assert.match(viewport[1], /width=device-width/u);
assert.match(viewport[1], /viewport-fit=cover/u);
assert.doesNotMatch(viewport[1], /user-scalable=no/u,
  "mobile users must retain browser zoom accessibility");

assert.ok(css.includes(".app-shell{height:100dvh;min-height:440px;"),
  "the app must size its main shell to the dynamic viewport");
assert.ok(css.includes("@media(max-width:640px){\n  .topbar{height:57px;"),
  "the portrait layout must have a compact phone breakpoint");
assert.ok(css.includes(".workspace{display:flex;flex-direction:column;overflow:hidden}"),
  "the portrait phone layout must stack the brain and control panel");
assert.ok(css.includes("overflow-y:auto"),
  "mobile panels must keep their contents reachable by scrolling");
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
assert.ok(landscapeCss.includes(".side-panel{display:block;padding:0 13px;overflow-y:auto}"),
  "the landscape control panel must remain vertically scrollable");

const version = html.match(/DIGITAL ORGANISM · ([0-9.]+)/u)?.[1];
assert.ok(version, "the displayed app version must be present");
assert.ok(html.includes("./styles.css?v=" + version),
  "the stylesheet cache key must match the displayed app version");

console.log("NEUROGENESIS mobile layout contracts: viewport, portrait stacking, pointer canvas, short-landscape sizing and scroll access passed.");
