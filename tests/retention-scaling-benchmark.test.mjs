import assert from "node:assert/strict";
import { statSync } from "node:fs";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../retention-scaling-benchmark.js";

assert.equal(typeof globalThis.NGRetentionScalingBenchmark?.run, "function",
  "the stage-three retention/scaling benchmark must expose run()");

const baseRuntime = await globalThis.NGWasm.load({ moduleFactory: createModule });
let createdBrains = 0;
let activeBrains = 0;
const runtime = {
  createBrain() {
    const brain = baseRuntime.createBrain();
    createdBrains++;
    activeBrains++;
    let disposed = false;
    return new Proxy({}, {
      get(_target, property) {
        if (property === "dispose") {
          return () => {
            if (disposed) return;
            disposed = true;
            brain.dispose();
            activeBrains--;
          };
        }
        const value = Reflect.get(brain, property, brain);
        return typeof value === "function" ? value.bind(brain) : value;
      }
    });
  }
};

const wasmArtifactBytes = statSync(new URL("../dist/neurogenesis.wasm", import.meta.url)).size;
const report = await globalThis.NGRetentionScalingBenchmark.run({
  runtime,
  wasmArtifactBytes
});

const retentionSummary = Object.fromEntries(
  Object.entries(report.retention.scenarios).map(([name, scenario]) => [name, {
    passed: scenario.passed,
    forgettingDetected: scenario.forgettingDetected,
    baseline: {
      primitive: scenario.baseline.primitives.passed,
      allCombinations: scenario.baseline.allHeldOutCombinations.passed,
      minExpected: scenario.baseline.allHeldOutCombinations.minExpectedActivation,
      maxUnexpected: scenario.baseline.allHeldOutCombinations.maxUnexpectedActivation,
      weights: scenario.baseline.weights
    },
    history: scenario.history.map(row => ({
      cycle: row.cycle,
      retained: row.retained,
      primitives: row.state.primitives.passed,
      unseen: row.state.unseenCompositions.passed,
      trained: row.state.trainedCompositions.passed,
      minExpected: row.state.allCombinations.minExpectedActivation,
      maxUnexpected: row.state.allCombinations.maxUnexpectedActivation,
      weights: row.weights
    })),
    replayEpisodes: scenario.training.replayEpisodes
  }])
);

console.log("NEUROGENESIS stage-three retention/scaling benchmark: " + JSON.stringify({
  passed: report.passed,
  wasmArtifactBytes,
  rewardControls: report.rewardControls,
  retention: {
    protocol: report.retention.protocol,
    checks: report.retention.checks,
    scenarios: retentionSummary
  },
  scaling: {
    protocol: report.scaling.protocol,
    checks: report.scaling.checks,
    scenarios: report.scaling.scenarios
  },
  timingMs: report.timingMs,
  createdBrains,
  activeBrains
}));

assert.equal(report.kind, "NEUROGENESIS stage-three retention and scaling benchmark");
assert.equal(report.protocol.targetMinActivation, 0.15);
assert.equal(report.protocol.nonTargetMaxActivation, 0.05);
assert.equal(report.protocol.wasmArtifactBytes, wasmArtifactBytes);
assert.equal(report.protocol.perBrainMemoryBytes, null,
  "the benchmark must not fabricate per-brain memory measurements");

assert.equal(report.rewardControls.passed, true);
assert.ok(report.rewardControls.positive.weightDelta > 0);
assert.ok(report.rewardControls.negative.weightDelta < 0);
assert.equal(report.rewardControls.neutral.weightDelta, 0);
for (const control of [
  report.rewardControls.positive,
  report.rewardControls.negative,
  report.rewardControls.neutral
]) {
  assert.ok(control.eligibilityBeforeReward > 0);
  assert.equal(control.inactiveBeforeReward, true);
  assert.equal(control.traceConsumed, true);
}

assert.equal(report.retention.protocol.seed, 101);
assert.equal(report.retention.protocol.cycles, 3);
assert.equal(report.retention.protocol.replaySweepsPerTask, 3);
assert.equal(report.retention.protocol.stageThreeUnseenPatterns, 8);
assert.equal(report.retention.passed, true);
assert.equal(report.retention.checks.allBaselinesPassBeforeAdditionalLearning, true);
assert.equal(report.retention.checks.unprotectedBaselineShowsForgettingInBothOrders, true);
assert.equal(report.retention.checks.protectedReplayRetainsOldAndNewCompositionsInBothOrders, true);
assert.equal(report.retention.checks.protectedReplayRunsMultipleCycles, true);
assert.equal(report.retention.checks.noProtectedCycleHasUnmeasuredRetention, true);

for (const [name, scenario] of Object.entries(report.retention.scenarios)) {
  assert.equal(scenario.baseline.primitives.passed, true, name + " baseline primitive mappings");
  assert.equal(scenario.baseline.allHeldOutCombinations.passed, true, name + " baseline combinations");
  assert.equal(scenario.history.length, 3, name + " must measure every training cycle");
  assert.ok(scenario.history.every(row =>
    row.state.primitives.combinationCount === 4 &&
    row.state.unseenCompositions.combinationCount === 8 &&
    row.state.trainedCompositions.combinationCount === 3
  ));
  assert.ok(scenario.history.every(row =>
    Number.isFinite(row.weights.maxCrossWeight) &&
    Number.isFinite(row.weights.meanCorrectWeight)
  ));
}
for (const name of ["protectedForward", "protectedReverse"]) {
  const scenario = report.retention.scenarios[name];
  assert.equal(scenario.passed, true, name + " must retain all measured old/new patterns");
  assert.ok(scenario.training.replayEpisodes > 0);
  assert.ok(scenario.history.every(row => row.retained), name + " failed a retention cycle");
}
for (const name of ["unprotectedForward", "unprotectedReverse"]) {
  const scenario = report.retention.scenarios[name];
  assert.equal(scenario.forgettingDetected, true,
    name + " must demonstrate that the no-protection baseline is a meaningful stress test");
  assert.ok(scenario.history.some(row => !row.retained));
}
assert.ok(
  report.retention.scenarios.protectedForward.final.weights.maxCrossWeight <
  report.retention.scenarios.unprotectedForward.final.weights.maxCrossWeight,
  "rehearsal protection must reduce cross-route drift relative to the unprotected baseline"
);

assert.deepEqual(report.scaling.protocol.featureCounts, [4, 5, 6]);
assert.deepEqual(report.scaling.protocol.seeds, [17, 29, 43]);
assert.equal(report.scaling.passed, true);
assert.equal(report.scaling.checks.allFeatureCountsPass, true);
assert.equal(report.scaling.checks.everySeedWasExecuted, true);
assert.equal(report.scaling.checks.heldOutSetsWereExhaustive, true);
assert.equal(report.scaling.checks.modelSizesMatchCompleteBipartiteTopology, true);
assert.equal(report.scaling.checks.timingMetricsAreFinite, true);
assert.equal(report.scaling.scenarios.length, 9);

const expectedCombinations = { 4: 11, 5: 26, 6: 57 };
const expectedPermutations = { 4: 60, 5: 320, 6: 1950 };
for (const scenario of report.scaling.scenarios) {
  assert.equal(scenario.heldOutCombinationCount, expectedCombinations[scenario.featureCount]);
  assert.equal(scenario.heldOutPermutationCount, expectedPermutations[scenario.featureCount]);
  assert.equal(scenario.trainingEpisodes, scenario.featureCount ** 2);
  assert.ok(scenario.minExpectedActivation >= 0.15);
  assert.ok(scenario.maxUnexpectedActivation <= 0.05);
  assert.ok(scenario.maxStimulationOrderSpread <= 1e-6);
  assert.equal(scenario.primitiveMappingsRetained, true);
  assert.ok(Number.isFinite(scenario.trainingMs) && scenario.trainingMs >= 0);
  assert.ok(Number.isFinite(scenario.heldOutInferenceMs) && scenario.heldOutInferenceMs >= 0);
}

assert.ok(Number.isFinite(report.timingMs.retention) && report.timingMs.retention >= 0);
assert.ok(Number.isFinite(report.timingMs.scaling) && report.timingMs.scaling >= 0);
assert.equal(createdBrains, 16,
  "three reward controls, four retention scenarios and nine scale scenarios must be independent");
assert.equal(activeBrains, 0, "every disposable shadow brain must be destroyed");

console.log("NEUROGENESIS stage-three retention/scaling assertions: passed.");
