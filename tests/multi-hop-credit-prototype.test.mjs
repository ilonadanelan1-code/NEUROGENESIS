import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../multi-hop-credit-prototype.js";

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const fixture = {
  neurons: [
    { id: "input", name: "Вход", type: "sensory", x: 0, y: 0, bias: 1, activity: 0 },
    { id: "trunk", name: "Общий участок", type: "memory", x: 1, y: 0, bias: 1, activity: 0 },
    { id: "good-hidden", name: "Целевая ветвь", type: "logic", x: 2, y: -1, bias: 1, activity: 0 },
    { id: "bad-hidden", name: "Конкурирующая ветвь", type: "logic", x: 2, y: 1, bias: 1, activity: 0 },
    { id: "good-output", name: "Целевой выход", type: "output", x: 3, y: -1, bias: 1, activity: 0 },
    { id: "bad-output", name: "Ложный выход", type: "output", x: 3, y: 1, bias: 1, activity: 0 },
    { id: "isolated-input", name: "Несвязанный вход", type: "sensory", x: 5, y: 0, bias: 1, activity: 0 },
    { id: "isolated-output", name: "Несвязанный выход", type: "output", x: 6, y: 0, bias: 1, activity: 0 }
  ],
  synapses: [
    { from: "input", to: "trunk", weight: 0.7, eligibility: 0 },
    { from: "trunk", to: "good-hidden", weight: 0.7, eligibility: 0 },
    { from: "good-hidden", to: "good-output", weight: 0.7, eligibility: 0 },
    { from: "trunk", to: "bad-hidden", weight: 0.7, eligibility: 0 },
    { from: "bad-hidden", to: "bad-output", weight: 0.7, eligibility: 0 },
    { from: "isolated-input", to: "isolated-output", weight: 0.4, eligibility: 0.3 }
  ]
};

const sourceBrain = runtime.createBrainFromSnapshot(fixture);
let snapshot;
try {
  assert.equal(sourceBrain.stimulate("input", 1), true);
  for (let i = 0; i < 10; i++) sourceBrain.step(0.1, 0.9);
  snapshot = sourceBrain.snapshot();
} finally {
  sourceBrain.dispose();
}
const original = JSON.stringify(snapshot);
const api = globalThis.NGPathAwareCreditPrototype;

function changed(result, from, to) {
  return result.proposal.changes.find(row => row.from === from && row.to === to);
}

const good = api.createProposal({
  runtime, snapshot, inputId: "input", targetOutputId: "good-output"
});
assert.equal(good.ok, true, good.message);
assert.equal(good.proposal.policy, "manual-review-only");
assert.equal(Object.hasOwn(good.proposal, "apply"), false);
assert.equal(good.proposal.changes.some(row => row.from === "isolated-input"), false);
assert.equal(good.report.positiveRouteCount, 1);
assert.equal(good.report.competingRouteCount, 1);
assert.equal(good.report.changedEdges, 4);
assert.equal(good.report.sharedEdgesPreserved, true);
assert.equal(good.report.unchangedEdgesPreserved, true);
assert.equal(good.report.candidateChangesVerified, true);
assert.equal(good.report.weightsBounded, true);
assert.ok(changed(good, "trunk", "good-hidden").delta > 0);
assert.ok(changed(good, "good-hidden", "good-output").delta > 0);
assert.ok(changed(good, "trunk", "bad-hidden").delta < 0);
assert.ok(changed(good, "bad-hidden", "bad-output").delta < 0);
assert.equal(good.proposal.changes.some(row => row.from === "input" && row.to === "trunk"), false,
  "the shared prefix must remain unchanged");

const bad = api.createProposal({
  runtime, snapshot, inputId: "input", targetOutputId: "bad-output"
});
assert.equal(bad.ok, true, bad.message);
assert.ok(changed(bad, "trunk", "bad-hidden").delta > 0);
assert.ok(changed(bad, "bad-hidden", "bad-output").delta > 0);
assert.ok(changed(bad, "trunk", "good-hidden").delta < 0);
assert.ok(changed(bad, "good-hidden", "good-output").delta < 0);
assert.equal(bad.report.sharedEdgesPreserved, true);
assert.equal(bad.report.unchangedEdgesPreserved, true);
assert.equal(bad.report.candidateChangesVerified, true);
assert.equal(JSON.stringify(snapshot), original, "the source snapshot must stay immutable");

const capped = api.createProposal({
  runtime, snapshot, inputId: "input", targetOutputId: "good-output", maxPaths: 1
});
assert.equal(capped.ok, false);
assert.equal(capped.code, "path-limit-exceeded");
assert.equal(capped.proposal, null, "incomplete path enumeration must never yield a proposal");

const tooShallow = api.createProposal({
  runtime, snapshot, inputId: "input", targetOutputId: "good-output", maxDepth: 2
});
assert.equal(tooShallow.ok, false);
assert.equal(tooShallow.code, "target-or-competitor-path-missing");
assert.equal(tooShallow.proposal, null);

const cycleGraph = {
  neurons: [{ id: "i", type: "sensory" }, { id: "h", type: "logic" }, { id: "o", type: "output" }],
  synapses: [
    { from: "i", to: "h", eligibility: 0.5 },
    { from: "h", to: "i", eligibility: 0.5 },
    { from: "h", to: "o", eligibility: 0.5 }
  ]
};
const cyclePaths = api.enumerateSimplePaths(cycleGraph, "i", 6, 8);
assert.equal(cyclePaths.truncated, false);
assert.equal(cyclePaths.paths.length, 1);
assert.deepEqual(cyclePaths.paths[0].nodes, ["i", "h", "o"]);

console.log(
  "NEUROGENESIS path-aware credit prototype: selected route strengthened, competing route weakened, shared trunk preserved; reverse target, cycle guard and path-cap guard passed."
);
