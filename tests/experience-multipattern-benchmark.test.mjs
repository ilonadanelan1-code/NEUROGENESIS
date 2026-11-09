import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../experience-multipattern-benchmark.js";

assert.equal(typeof globalThis.NGMultiPatternBenchmark?.run, "function",
  "the multi-pattern benchmark module must expose run()");

const baseRuntime = await globalThis.NGWasm.load({ moduleFactory: createModule });
let createdBrains = 0;
let activeBrains = 0;
const runtime = {
  createBrain() {
    const brain = baseRuntime.createBrain();
    createdBrains++;
    activeBrains++;
    let disposed = false;
    return new Proxy(brain, {
      get(target, property) {
        if (property === "dispose") {
          return () => {
            if (disposed) return;
            disposed = true;
            target.dispose();
            activeBrains--;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }
};
const report = await globalThis.NGMultiPatternBenchmark.run({ runtime });
assert.equal(createdBrains, 2, "each training order must use its own isolated brain");
assert.equal(activeBrains, 0, "both isolated training brains must be disposed");

assert.equal(report.kind, "two-pattern sequential learning benchmark");
assert.equal(report.network.neurons, 4);
assert.equal(report.network.synapses, 4);
assert.equal(report.trainingRepetitionsPerPattern, 4);
assert.equal(report.passed, true,
  "both training orders must learn distinct responses and preserve the first learned response");

for (const key of [
  "bothTrainingOrdersLearnDistinctResponses",
  "previouslyLearnedResponseSurvivesLaterTask",
  "orderSymmetryIsStable"
]) {
  assert.equal(report.checks[key], true, "benchmark check failed: " + key);
}

for (const scenario of [report.aThenB, report.bThenA]) {
  assert.equal(scenario.passed, true, "training order failed: " + scenario.order);
  assert.equal(scenario.episodes.length, 8);
  assert.ok(scenario.firstPatternAfterFirstTask.margin >
    report.responseMarginThreshold);
  assert.ok(scenario.firstPatternAfterSecondTask.margin >
    report.responseMarginThreshold);
  assert.ok(scenario.secondPatternAfterSecondTask.margin >
    report.responseMarginThreshold);
  assert.ok(scenario.diagonalWeightMean >
    scenario.crossWeightMean + report.responseMarginThreshold);

  for (const key of [
    "firstPatternLearnedBeforeSecond",
    "firstPatternRetainedAfterSecond",
    "secondPatternLearned",
    "targetWeightsOutgrowCrossWeights",
    "rewardsArriveAfterActivity",
    "everyRewardHasEligibility",
    "everyRewardConsumesTraces",
    "weightsStayBounded",
    "networkRemainsFourByFour"
  ]) {
    assert.equal(scenario.checks[key], true,
      "scenario " + scenario.order + " failed: " + key);
  }

  for (const episode of scenario.episodes) {
    assert.equal(episode.activeNeuronsBeforeReward, 0);
    assert.ok(episode.eligibleSynapsesBeforeReward > 0);
    assert.ok(episode.eligibilityMassBeforeReward > 0);
    assert.equal(episode.traceConsumed, true);
  }
}

console.log("NEUROGENESIS multi-pattern benchmark: two response mappings learned in both orders; earlier response retained.");
