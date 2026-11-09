"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const adapter = fs.readFileSync("neuro-wasm-adapter.js", "utf8");
const version = html.match(/DIGITAL ORGANISM · ([0-9.]+)/u)?.[1];

assert.equal(version, "0.58.30", "the shadow runtime release must have a distinct asset version");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gu)].map(match => match[1]);
const normalized = scripts.map(ref => ref.split("?")[0].replace(/^\.\//u, ""));
assert.equal(normalized.filter(path => path === "neuro-wasm-adapter.js").length, 1,
  "the WASM adapter must be loaded exactly once");
assert.ok(normalized.indexOf("activation.js") < normalized.indexOf("neuro-wasm-adapter.js"));
assert.ok(normalized.indexOf("neuro-wasm-adapter.js") < normalized.indexOf("app.js"),
  "the adapter must exist before the app starts");
assert.ok(normalized.indexOf("app.js") < normalized.indexOf("knowledge.js"));
assert.equal(normalized.at(-1), "memory.js");
for (const ref of scripts) {
  assert.ok(ref.includes("?v=" + version), "every script must use the current cache version: " + ref);
}
assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css\?v=0\.58\.30"/u);

assert.match(adapter, /function createBrainFromSnapshot\(snapshot\)/u);
assert.match(adapter, /function createShadowController\(options = \{\}\)/u);
assert.match(adapter, /state = "unavailable"/u);
assert.match(adapter, /const previous = brain;[\s\S]*?brain = candidate;[\s\S]*?if \(previous\) previous\.dispose\(\)/u,
  "snapshot replacement must remain atomic");
assert.match(adapter, /authority: "javascript"/u,
  "the adapter must explicitly retain JavaScript as the authoritative runtime");

assert.match(app, /function wasmShadowSnapshot\(\)/u);
assert.match(app, /function syncWasmShadow\(\)/u);
assert.match(app, /function startWasmShadow\(\)/u);
assert.match(app, /wasmShadow\.stimulate\(id, strength\)/u);
assert.match(app, /stepWasmShadow\(dt\)/u);
assert.match(app, /wasmShadowStepElapsed < 100/u,
  "shadow computation must be throttled to at most 10 steps per second");
assert.match(app, /wasmShadow\.step\(elapsed \/ 1000\)/u);
assert.match(app, /if\(drag&&drag\.kind==="node"\)syncWasmShadow\(\)/u,
  "node movement must be mirrored at gesture completion, not every pointer move");
assert.match(app, /wasmDiagnostics\(\)/u,
  "the browser must expose shadow backend diagnostics");

const frameStart = app.indexOf("  function frame(time) {");
const frameEnd = app.indexOf("\n  canvas.addEventListener", frameStart);
assert.ok(frameStart >= 0 && frameEnd > frameStart);
const frame = app.slice(frameStart, frameEnd);
assert.match(frame, /stepWasmShadow\(dt\)/u);
assert.doesNotMatch(frame, /localStorage\.setItem/u,
  "the shadow compute loop must not persist C++ state over the JS network");

console.log("NEUROGENESIS WASM shadow-mode integration contracts: passed.");
