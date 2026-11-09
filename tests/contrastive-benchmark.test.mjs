import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../contrastive-benchmark.js";

assert.equal(typeof globalThis.NGContrastiveBenchmark?.run, "function",
  "the contrastive benchmark must expose run()");

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

const report = await globalThis.NGContrastiveBenchmark.run({ runtime });
assert.equal(report.kind, "contrastive dense two-pattern learning benchmark");
assert.deepEqual(report.network, {
  neurons: 4,
  synapses: 4,
  initialTargetWeight: 0.2,
  initialCrossWeight: 0.12
});
assert.equal(report.trainingRepetitionsPerPattern, 3);
assert.equal(report.passed, true,
  "contrastive reward must separate both patterns in both training orders");
assert.equal(createdBrains, 2, "each training order must use an independent WASM brain");
assert.equal(activeBrains, 0, "all contrastive benchmark brains must be disposed");

for (const key of [
  "contrastiveTrainingWorksInBothOrders",
  "orderDoesNotChangeTheLearnedMapping"
]) {
  assert.equal(report.checks[key], true, "contrastive benchmark failed: " + key);
}

for (const scenario of [report.aThenB, report.bThenA]) {
  assert.equal(scenario.passed, true, "contrastive scenario failed: " + scenario.order);
  assert.equal(scenario.episodes.length, 6);
  assert.ok(scenario.weights.targetA > report.network.initialTargetWeight);
  assert.ok(scenario.weights.targetB > report.network.initialTargetWeight);
  assert.ok(scenario.weights.crossA < report.network.initialCrossWeight);
  assert.ok(scenario.weights.crossB < report.network.initialCrossWeight);
  assert.ok(scenario.after.A.margin > scenario.before.A.margin);
  assert.ok(scenario.after.B.margin > scenario.before.B.margin);
  assert.ok(scenario.after.A.targetResponse > scenario.after.A.incorrectResponse);
  assert.ok(scenario.after.B.targetResponse > scenario.after.B.incorrectResponse);

  for (const key of [
    "patternASelectsOutputX",
    "patternBSelectsOutputY",
    "patternAImprovesItsMargin",
    "patternBImprovesItsMargin",
    "bothTargetWeightsIncrease",
    "bothCrossWeightsDecrease",
    "bothTargetAndCrossTracesArePresent",
    "allRewardsArriveAfterActivityFades",
    "contrastiveUpdateTouchesOnlySelectedOutputPaths",
    "targetPathsStrengthenAndCrossPathsWeaken",
    "everyEpisodeConsumesAllTraces",
    "allWeightsRemainBounded"
  ]) {
    assert.equal(scenario.checks[key], true,
      "contrastive scenario " + scenario.order + " failed: " + key);
  }

  for (const episode of scenario.episodes) {
    assert.ok(episode.targetEligibility > 0);
    assert.ok(episode.crossEligibility > 0);
    assert.equal(episode.activeNeuronsBeforeReward, 0);
    assert.equal(episode.changedSynapses, 2);
    assert.equal(episode.unrelatedEdgesUnchanged, true);
    assert.equal(episode.targetStrengthened, true);
    assert.equal(episode.crossPathWeakened, true);
    assert.equal(episode.traceConsumed, true);
  }
}

console.log("NEUROGENESIS contrastive benchmark: target paths strengthened and competing paths weakened in both training orders.");
