import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../experience-benchmark.js";

assert.equal(typeof globalThis.NGExperienceBenchmark?.run, "function",
  "the benchmark module must expose run()");

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const report = await globalThis.NGExperienceBenchmark.run({ runtime });

assert.equal(report.kind, "single-edge delayed-reward benchmark");
assert.equal(report.network.neurons, 2);
assert.equal(report.network.synapses, 1);
assert.equal(report.passed, true,
  "positive reward must improve the defined response, negative reward must reduce it, and neutral reward must preserve the baseline");

for (const key of [
  "positiveRewardIncreasesWeight",
  "positiveRewardIncreasesResponse",
  "negativeRewardDecreasesWeight",
  "negativeRewardDecreasesResponse",
  "neutralRewardPreservesWeight",
  "rewardArrivesAfterActivity",
  "everyRewardConsumesTrace"
]) {
  assert.equal(report.checks[key], true, "benchmark check failed: " + key);
}

for (const condition of [report.positive, report.negative, report.neutral]) {
  assert.ok(condition.eligibilityBeforeReward > 0);
  assert.equal(condition.eligibleSynapsesBeforeReward, 1);
  assert.equal(condition.activeNeuronsBeforeReward, 0,
    "reward must be delivered after the co-activated neurons have become inactive");
  assert.equal(condition.traceConsumed, true,
    "the benchmark must verify one-time eligibility consumption");
}

assert.ok(report.positive.responseAfter > report.positive.responseBefore);
assert.ok(report.negative.responseAfter < report.negative.responseBefore);
assert.ok(Math.abs(report.neutral.responseAfter - report.neutral.responseBefore) < 1e-5);

console.log("NEUROGENESIS delayed-reward benchmark: positive, negative and neutral outcomes passed.");
