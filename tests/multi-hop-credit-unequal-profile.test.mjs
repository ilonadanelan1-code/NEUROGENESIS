import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../multi-hop-credit-prototype.js";

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const snapshot = {
  neurons: [
    { id: "profile-input", name: "Вход", type: "sensory", x: 0, y: 0, bias: 1, activity: 1 },
    { id: "profile-trunk", name: "Общий участок", type: "memory", x: 1, y: 0, bias: 1, activity: 0.7 },
    { id: "target-a", name: "Цель A", type: "logic", x: 2, y: -2, bias: 1, activity: 0.6 },
    { id: "target-b", name: "Цель B", type: "logic", x: 2, y: -1, bias: 1, activity: 0.5 },
    { id: "target-c", name: "Цель C", type: "logic", x: 2, y: 0, bias: 1, activity: 0.45 },
    { id: "competitor-a", name: "Конкурент A", type: "logic", x: 2, y: 1, bias: 1, activity: 0.4 },
    { id: "competitor-b", name: "Конкурент B", type: "logic", x: 2, y: 2, bias: 1, activity: 0.35 },
    { id: "target-output", name: "Целевой выход", type: "output", x: 3, y: 0, bias: 1, activity: 0.72 },
    { id: "competitor-output-a", name: "Конкурирующий выход A", type: "output", x: 3, y: 1, bias: 1, activity: 0.51 },
    { id: "competitor-output-b", name: "Конкурирующий выход B", type: "output", x: 3, y: 2, bias: 1, activity: 0.43 },
    { id: "isolated-input", name: "Изолированный вход", type: "sensory", x: 5, y: 0, bias: 1, activity: 0.2 },
    { id: "isolated-output", name: "Изолированный выход", type: "output", x: 6, y: 0, bias: 1, activity: 0.2 }
  ],
  synapses: [
    { from: "profile-input", to: "profile-trunk", weight: 0.71, eligibility: 0.8 },
    { from: "profile-trunk", to: "target-a", weight: 0.65, eligibility: 0.9 },
    { from: "target-a", to: "target-output", weight: 0.6, eligibility: 0.85 },
    { from: "profile-trunk", to: "target-b", weight: 0.55, eligibility: 0.5 },
    { from: "target-b", to: "target-output", weight: 0.7, eligibility: 0.45 },
    { from: "profile-trunk", to: "target-c", weight: 0.8, eligibility: 0.7 },
    { from: "target-c", to: "target-output", weight: 0.65, eligibility: 0.6 },
    { from: "profile-trunk", to: "competitor-a", weight: 0.62, eligibility: 0.55 },
    { from: "competitor-a", to: "competitor-output-a", weight: 0.7, eligibility: 0.5 },
    { from: "profile-trunk", to: "competitor-b", weight: 0.4, eligibility: 0.95 },
    { from: "competitor-b", to: "competitor-output-b", weight: 0.55, eligibility: 0.9 },
    { from: "isolated-input", to: "isolated-output", weight: 0.4, eligibility: 0.45 }
  ]
};
const original = JSON.stringify(snapshot);
const api = globalThis.NGPathAwareCreditPrototype;
const result = api.createProposal({
  runtime, snapshot, inputId: "profile-input", targetOutputId: "target-output"
});

assert.equal(result.ok, true, result.message);
assert.equal(result.report.positiveRouteCount, 3);
assert.equal(result.report.competingRouteCount, 2);
assert.equal(result.report.changedEdges, 10);
assert.equal(result.report.sharedEdgesPreserved, true);
assert.equal(result.report.unchangedEdgesPreserved, true);
assert.equal(result.report.candidateChangesVerified, true);
assert.equal(result.report.weightsBounded, true);
assert.equal(result.report.baselineEdgeCount, snapshot.synapses.length);
assert.equal(result.report.candidateEdgeCount, snapshot.synapses.length);

function delta(from, to) {
  const row = result.proposal.changes.find(edge => edge.from === from && edge.to === to);
  assert.ok(row, "expected a proposal for " + from + " -> " + to);
  return row.delta;
}

for (const [from, to] of [
  ["profile-trunk", "target-a"], ["target-a", "target-output"],
  ["profile-trunk", "target-b"], ["target-b", "target-output"],
  ["profile-trunk", "target-c"], ["target-c", "target-output"]
]) {
  assert.ok(delta(from, to) > 0, "target path edge must strengthen: " + from + " -> " + to);
}
for (const [from, to] of [
  ["profile-trunk", "competitor-a"], ["competitor-a", "competitor-output-a"],
  ["profile-trunk", "competitor-b"], ["competitor-b", "competitor-output-b"]
]) {
  assert.ok(delta(from, to) < 0, "competing path edge must weaken: " + from + " -> " + to);
}
assert.equal(result.proposal.changes.some(edge =>
  edge.from === "profile-input" && edge.to === "profile-trunk"
), false, "all target and competing paths share this edge; its net credit must cancel");
assert.equal(result.proposal.changes.some(edge => edge.from === "isolated-input"), false);
assert.equal(JSON.stringify(snapshot), original, "the source profile must remain unchanged");

const reversed = api.createProposal({
  runtime,
  snapshot: { neurons: snapshot.neurons.map(row => ({...row})),
    synapses: [...snapshot.synapses].reverse().map(row => ({...row})) },
  inputId: "profile-input",
  targetOutputId: "target-output"
});
assert.equal(reversed.ok, true, reversed.message);
const toMap = proposal => new Map(proposal.changes.map(edge =>
  [JSON.stringify([edge.from, edge.to]), edge.delta]
));
const first = toMap(result.proposal);
const second = toMap(reversed.proposal);
assert.deepEqual([...first.keys()].sort(), [...second.keys()].sort());
for (const [key, value] of first) {
  assert.ok(Math.abs(value - second.get(key)) < 1e-6,
    "unequal route profiles must be independent of edge insertion order: " + key);
}

const pathLimited = api.createProposal({
  runtime, snapshot, inputId: "profile-input", targetOutputId: "target-output", maxPaths: 4
});
assert.equal(pathLimited.ok, false);
assert.equal(pathLimited.code, "path-limit-exceeded");
assert.equal(pathLimited.proposal, null);

console.log(
  "NEUROGENESIS path-aware unequal-profile stress: 3 target routes and 2 competing routes passed; shared trunk cancelled; disconnected edge and input snapshot unchanged; insertion order invariant."
);
