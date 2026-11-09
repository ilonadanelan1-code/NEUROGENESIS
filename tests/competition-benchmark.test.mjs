import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../competition-benchmark.js";

assert.equal(typeof globalThis.NGCompetitionBenchmark?.run, "function",
  "the shared-path diagnostic must expose run()");

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

const report = await globalThis.NGCompetitionBenchmark.run({ runtime });
assert.equal(report.kind, "shared-path competing-output interference diagnostic");
assert.deepEqual(report.network, {
  neurons: 5,
  synapses: 4,
  sharedHiddenNodes: 1,
  competingOutputs: 2
});
assert.equal(report.diagnosed, true,
  "the current shared-path architecture must reproducibly expose its identity-collapse limitation");
assert.equal(createdBrains, 2, "both training orders must use separate test brains");
assert.equal(activeBrains, 0, "both isolated test brains must be disposed");
assert.equal(report.interpretation, "shared-hidden-path-collapses-input-identity");

for (const scenario of [report.aThenB, report.bThenA]) {
  assert.equal(scenario.diagnosed, true, "the limitation must reproduce in order " + scenario.order);
  assert.equal(scenario.episodes.length, 6);
  assert.ok(Math.abs(scenario.weights.inputAtoShared -
    scenario.weights.inputBtoShared) < 1e-5);
  assert.ok(Math.abs(scenario.weights.sharedToX -
    scenario.weights.sharedToY) < 1e-5);

  for (const label of ["A", "B"]) {
    const result = scenario.after[label];
    assert.equal(result.bothOutputsActive, true,
      "both competing outputs must activate for input " + label);
    assert.ok(Math.abs(result.outputDifference) < 1e-5,
      "a shared bottleneck must not invent a selective response for " + label);
  }

  for (const key of [
    "sharedInputRoutesRemainSymmetric",
    "competingOutputWeightsRemainSymmetric",
    "inputAActivatesBothCompetingOutputs",
    "inputBActivatesBothCompetingOutputs",
    "inputAProducesNoSelectiveOutput",
    "inputBProducesNoSelectiveOutput",
    "bothInputsCollapseToSameOutputResponse",
    "rewardsArriveAfterActivityFades",
    "everyEpisodeHasTargetTrace",
    "noWrongOutputTraceInEachEpisode",
    "everyEpisodeConsumesTraces",
    "allWeightsRemainBounded"
  ]) {
    assert.equal(scenario.checks[key], true,
      "interference diagnostic check failed for " + scenario.order + ": " + key);
  }

  for (const episode of scenario.episodes) {
    assert.equal(episode.activeNeuronsBeforeReward, 0);
    assert.ok(episode.targetEligibility > 0);
    assert.ok(episode.eligibleSynapses > 0);
    assert.equal(episode.competingEligibility, 0);
    assert.equal(episode.traceConsumed, true);
  }
}

console.log("NEUROGENESIS shared-path diagnostic: both inputs collapse to the same two competing outputs in both training orders.");
