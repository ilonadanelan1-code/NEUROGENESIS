import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../experience-benchmark.js";

assert.equal(typeof globalThis.NGExperienceBenchmark?.run, "function",
  "the benchmark module must expose run()");

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const report = await globalThis.NGExperienceBenchmark.run({ runtime });

assert.equal(report.kind, "delayed-reward and two-pattern association benchmark");
assert.equal(report.network.neurons, 2);
assert.equal(report.network.synapses, 1);
assert.equal(report.multiPattern.kind, "two-pattern paired-association benchmark");
assert.deepEqual(report.multiPattern.network, {
  neurons: 4,
  synapses: 4,
  patterns: 2,
  targetWeight: 0.2,
  crossWeight: 0.04
});
assert.equal(report.passed, true,
  "single-edge reward outcomes and two-pattern association preservation must pass");

for (const key of [
  "positiveRewardIncreasesWeight",
  "positiveRewardIncreasesResponse",
  "negativeRewardDecreasesWeight",
  "negativeRewardDecreasesResponse",
  "neutralRewardPreservesWeight",
  "rewardArrivesAfterActivity",
  "everyRewardConsumesTrace",
  "twoPatternAThenBPasses",
  "twoPatternBThenAPasses",
  "twoPatternsImproveBothResponses",
  "twoPatternsRemainDistinct",
  "earlierAssociationIsPreserved",
  "crossAssociationsAreNotUpdated",
  "bothPatternRewardsAreDelayedAndConsumed"
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

for (const [orderKey, order] of Object.entries(report.multiPattern.orders)) {
  assert.equal(order.passed, true, "two-pattern order must pass: " + orderKey);
  assert.equal(order.network.neurons, 4);
  assert.equal(order.network.synapses, 4);
  assert.equal(order.network.patterns, 2);
  assert.ok(order.patterns.A.responseAfter > order.patterns.A.responseBefore);
  assert.ok(order.patterns.B.responseAfter > order.patterns.B.responseBefore);
  assert.ok(order.patterns.A.responseAfter > order.patterns.A.incorrectResponseAfter);
  assert.ok(order.patterns.B.responseAfter > order.patterns.B.incorrectResponseAfter);
  assert.ok(Math.abs(order.firstAssociationRetention.weightDelta) < 1e-5);
  assert.equal(order.episodes.length, 2);
  for (const episode of order.episodes) {
    assert.ok(episode.eligibilityBeforeReward > 0);
    assert.equal(episode.crossEligibilityBeforeReward, 0);
    assert.equal(episode.activeNeuronsBeforeReward, 0);
    assert.equal(episode.traceConsumed, true);
  }
}

console.log("NEUROGENESIS benchmarks: delayed reward and two-pattern association orders passed.");
