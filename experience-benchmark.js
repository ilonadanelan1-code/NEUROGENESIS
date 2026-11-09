(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;

  function requireBrain(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const brain = runtime.createBrain();
    try {
      const input = brain.addNeuron("benchmark-input", "sensory", 0, 0, 1);
      const output = brain.addNeuron("benchmark-output", "output", 0, 0, 1);
      if (!input || !output || !brain.addSynapse(input, output, 0.5)) {
        throw new Error("Could not create the deterministic benchmark network");
      }
      return { brain, input, output, initialWeight: brain.getSynapseAt(0).weight };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function settle(brain, steps = 20, retention = 0) {
    for (let i = 0; i < steps; i++) brain.step(0.25, retention);
    brain.resetEligibility();
  }

  function measureResponse(fixture) {
    const { brain, input, output } = fixture;
    settle(brain);
    if (!brain.stimulate(input, 1)) throw new Error("Benchmark input stimulation failed");
    brain.step(0.1, 0);
    const response = brain.snapshot().neurons.find(row => row.id === output)?.activation;
    if (!Number.isFinite(response)) throw new Error("Benchmark output activation is not finite");
    settle(brain);
    return response;
  }

  function runCondition(runtime, reward) {
    const fixture = requireBrain(runtime);
    const { brain, input, output, initialWeight } = fixture;
    try {
      const responseBefore = measureResponse(fixture);
      if (!brain.stimulate(input, 1) || !brain.stimulate(output, 1)) {
        throw new Error("Could not prepare the co-activation training episode");
      }
      brain.step(0.1, 0.9);
      for (let i = 0; i < 20; i++) brain.step(0.25, 0.9);

      const beforeReward = brain.snapshot();
      const edgeBeforeReward = beforeReward.synapses[0];
      const eligibilityBeforeReward = edgeBeforeReward.eligibility;
      const eligibleSynapsesBeforeReward = beforeReward.synapses.filter(
        row => row.eligibility > EPSILON
      ).length;
      const activeNeuronsBeforeReward = beforeReward.neurons.filter(
        row => row.activation > EPSILON
      ).length;
      if (eligibleSynapsesBeforeReward === 0 || eligibilityBeforeReward <= EPSILON) {
        throw new Error("Delayed reward benchmark did not retain an eligibility trace");
      }

      const changedSynapses = brain.learnFromReward(0.25, reward, 0);
      const afterReward = brain.snapshot();
      const weightAfter = afterReward.synapses[0].weight;
      const traceConsumed = afterReward.synapses.every(
        row => row.eligibility <= EPSILON
      );
      const responseAfter = measureResponse(fixture);

      return {
        reward,
        responseBefore,
        responseAfter,
        responseDelta: responseAfter - responseBefore,
        weightBefore: initialWeight,
        weightAfter,
        weightDelta: weightAfter - initialWeight,
        eligibilityBeforeReward,
        eligibleSynapsesBeforeReward,
        activeNeuronsBeforeReward,
        changedSynapses,
        traceConsumed
      };
    } finally {
      brain.dispose();
    }
  }

  async function run(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    const runtime = settings.runtime || (
      root.NGWasm && typeof root.NGWasm.load === "function"
        ? await root.NGWasm.load(settings.runtimeOptions || {})
        : null
    );
    if (!runtime) throw new Error("NEUROGENESIS WASM runtime is unavailable");

    const positive = runCondition(runtime, 1);
    const negative = runCondition(runtime, -1);
    const neutral = runCondition(runtime, 0);
    const tolerance = 1e-5;
    const checks = {
      positiveRewardIncreasesWeight: positive.weightAfter > positive.weightBefore + tolerance,
      positiveRewardIncreasesResponse: positive.responseAfter > positive.responseBefore + tolerance,
      negativeRewardDecreasesWeight: negative.weightAfter < negative.weightBefore - tolerance,
      negativeRewardDecreasesResponse: negative.responseAfter < negative.responseBefore - tolerance,
      neutralRewardPreservesWeight: Math.abs(neutral.weightAfter - neutral.weightBefore) <= tolerance,
      rewardArrivesAfterActivity: positive.activeNeuronsBeforeReward === 0 &&
        negative.activeNeuronsBeforeReward === 0 && neutral.activeNeuronsBeforeReward === 0,
      everyRewardConsumesTrace: positive.traceConsumed && negative.traceConsumed && neutral.traceConsumed
    };
    return {
      kind: "single-edge delayed-reward benchmark",
      network: { neurons: 2, synapses: 1, initialWeight: 0.5 },
      learningRate: 0.25,
      weightDecay: 0,
      positive,
      negative,
      neutral,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  root.NGExperienceBenchmark = Object.freeze({ run });
})();