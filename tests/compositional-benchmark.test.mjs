import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../compositional-benchmark.js";

assert.equal(typeof globalThis.NGCompositionalBenchmark?.run, "function",
  "the compositional benchmark must expose run()");

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

const report = await globalThis.NGCompositionalBenchmark.run({ runtime });

assert.equal(report.kind, "four-feature zero-shot feature-route superposition benchmark");
assert.deepEqual(report.network, {
  inputFeatures: 4,
  outputNeurons: 5,
  neurons: 9,
  synapses: 20,
  initialWeight: 0.005,
  learningRate: 0.25,
  fadeStepsAfterCoactivation: 12,
  eligibilityRetention: 0.9
});
assert.deepEqual(report.protocol.trainingPatterns, [["A"], ["B"], ["C"], ["D"]]);
assert.deepEqual(report.protocol.heldOutPatterns, [
  ["A", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"], ["C", "D"],
  ["A", "B", "C"], ["A", "B", "D"], ["A", "C", "D"], ["B", "C", "D"],
  ["A", "B", "C", "D"]
]);
assert.equal(report.protocol.trainingEpisodesPerScenario, 16);
assert.equal(report.protocol.heldOutCombinationCount, 11);
assert.equal(report.protocol.heldOutPermutationCountPerScenario, 60);
assert.equal(report.protocol.seed, null,
  "the benchmark is deterministic and deliberately uses no random generator");
assert.deepEqual(report.protocol.criteria, {
  targetMinActivation: 0.15,
  nonTargetMaxActivation: 0.05,
  maximumStimulationOrderSpread: 1e-6
});

assert.equal(report.passed, true,
  "the four independent routes must recombine on every held-out pair, triple and quadruple");
assert.equal(createdBrains, 4,
  "forward, reverse, untrained and permuted scenarios must use separate disposable brains");
assert.equal(activeBrains, 0, "every experimental brain must be disposed");

for (const key of [
  "forwardTrainingOrderPasses",
  "reverseTrainingOrderPasses",
  "untrainedControlDoesNotPass",
  "permutationControlFollowsItsLearnedMapping",
  "allHeldOutPatternsWereExcludedFromTraining"
]) {
  assert.equal(report.checks[key], true, "compositional benchmark check failed: " + key);
}

for (const scenario of [report.forward, report.reverse]) {
  assert.equal(scenario.passed, true, "training order must pass: " + scenario.order);
  assert.deepEqual(scenario.network, {
    inputFeatures: 4, outputNeurons: 5, neurons: 9, synapses: 20
  });
  assert.equal(scenario.training.episodes, 16);
  assert.equal(scenario.training.uniqueInputPatterns, 4);
  assert.equal(scenario.training.onlySingletonInputs, true);
  assert.equal(scenario.training.allEpisodesValid, true);
  assert.equal(scenario.heldOut.combinationCount, 11);
  assert.equal(scenario.heldOut.permutationCount, 60);
  assert.ok(scenario.heldOut.minExpectedActivation >= 0.15);
  assert.ok(scenario.heldOut.maxUnexpectedActivation <= 0.05);
  assert.ok(scenario.heldOut.maxOrderSpread <= 1e-6);
  assert.equal(scenario.heldOut.passed, true);
  assert.equal(scenario.primitiveRetention.combinationCount, 4);
  assert.equal(scenario.primitiveRetention.passed, true);
  assert.equal(scenario.weightsUnchangedDuringInference, true);
  assert.equal(scenario.stimulationOrderInvariant, true);

  for (const pattern of scenario.heldOut.patterns) {
    assert.equal(pattern.passed, true, "held-out pattern must pass: " + pattern.features.join("+"));
    assert.equal(pattern.permutationCount, pattern.features.length === 2 ? 2 :
      pattern.features.length === 3 ? 6 : 24);
    assert.ok(pattern.minExpectedActivation >= 0.15);
    assert.ok(pattern.maxUnexpectedActivation <= 0.05);
  }

  for (const episode of scenario.training.episodesDetail) {
    assert.equal(episode.presentedInputFeatures.length, 1,
      "training must never contain a pair or composite feature input");
    assert.ok(episode.positiveEligibility > 0);
    assert.ok(episode.negativeEligibility > 0);
    assert.equal(episode.activeNeuronsBeforeReward, 0,
      "contrastive reward must be delayed until activity fades");
    assert.equal(episode.unrelatedTracesClear, true);
    assert.equal(episode.changedSynapses, 2);
    assert.equal(episode.positiveStrengthened, true);
    assert.equal(episode.negativeWeakened, true);
    assert.equal(episode.traceConsumed, true);
  }
}

assert.equal(report.controls.untrainedBaseline.passedAsExpected, true,
  "an untrained graph must not pass the held-out output threshold");
assert.equal(report.controls.untrainedBaseline.evaluatedCombinations, 11);
assert.equal(report.controls.untrainedBaseline.evaluatedPermutations, 60);
assert.ok(report.controls.untrainedBaseline.maxOutputActivation <= 0.05);
assert.equal(report.controls.permutedMapping.passed, true,
  "the network must follow a separately trained non-canonical feature mapping");
assert.equal(report.controls.permutedMapping.followsPermutedMapping, true);
assert.equal(report.controls.permutedMapping.differsFromCanonicalMapping, true);
assert.equal(report.controls.permutedMapping.trainingEpisodes, 16);

console.log("NEUROGENESIS compositional benchmark: " + JSON.stringify({
  passed: report.passed,
  train: report.protocol.trainingPatterns,
  heldOutCombinations: report.protocol.heldOutCombinationCount,
  heldOutPermutationsPerOrder: report.protocol.heldOutPermutationCountPerScenario,
  forward: {
    minExpectedActivation: report.forward.heldOut.minExpectedActivation,
    maxUnexpectedActivation: report.forward.heldOut.maxUnexpectedActivation,
    maxOrderSpread: report.forward.heldOut.maxOrderSpread
  },
  reverse: {
    minExpectedActivation: report.reverse.heldOut.minExpectedActivation,
    maxUnexpectedActivation: report.reverse.heldOut.maxUnexpectedActivation,
    maxOrderSpread: report.reverse.heldOut.maxOrderSpread
  },
  untrainedBaseline: report.controls.untrainedBaseline,
  permutedControl: {
    followsPermutedMapping: report.controls.permutedMapping.followsPermutedMapping,
    differsFromCanonicalMapping: report.controls.permutedMapping.differsFromCanonicalMapping
  }
}));
