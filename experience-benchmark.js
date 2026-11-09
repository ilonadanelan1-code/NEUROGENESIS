(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;
  const TOLERANCE = 1e-5;

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

  function createPatternFixture(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const brain = runtime.createBrain();
    try {
      const inputA = brain.addNeuron("pattern-A", "sensory", 0, 0, 1);
      const inputB = brain.addNeuron("pattern-B", "sensory", 0, 1, 1);
      const outputX = brain.addNeuron("response-X", "output", 1, 0, 1);
      const outputY = brain.addNeuron("response-Y", "output", 1, 1, 1);
      if (![inputA, inputB, outputX, outputY].every(Boolean)) {
        throw new Error("Could not create the two-pattern benchmark neurons");
      }

      // The 0.04 cross-links remain below the core's 0.05 activation threshold.
      // This isolates two paired routes; it is deliberately not a dense-classifier test.
      const edges = [
        { key: "A-X", from: inputA, to: outputX, weight: 0.2 },
        { key: "A-Y", from: inputA, to: outputY, weight: 0.04 },
        { key: "B-X", from: inputB, to: outputX, weight: 0.04 },
        { key: "B-Y", from: inputB, to: outputY, weight: 0.2 }
      ];
      for (const edge of edges) {
        if (!brain.addSynapse(edge.from, edge.to, edge.weight)) {
          throw new Error("Could not create benchmark synapse " + edge.key);
        }
      }
      return {
        brain,
        patterns: {
          A: { input: inputA, target: outputX, other: outputY, edge: "A-X", cross: "A-Y" },
          B: { input: inputB, target: outputY, other: outputX, edge: "B-Y", cross: "B-X" }
        },
        edges
      };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function findEdge(snapshot, from, to) {
    return snapshot.synapses.find(edge => edge.from === from && edge.to === to) || null;
  }

  function measurePattern(fixture, label) {
    const { brain, patterns } = fixture;
    const pattern = patterns[label];
    settle(brain);
    if (!brain.stimulate(pattern.input, 1)) {
      throw new Error("Could not stimulate pattern " + label);
    }
    brain.step(0.1, 0);
    const snapshot = brain.snapshot();
    const target = snapshot.neurons.find(row => row.id === pattern.target);
    const other = snapshot.neurons.find(row => row.id === pattern.other);
    if (!target || !other || !Number.isFinite(target.activation) ||
        !Number.isFinite(other.activation)) {
      throw new Error("Pattern " + label + " produced an invalid response");
    }
    settle(brain);
    return { correct: target.activation, incorrect: other.activation };
  }

  function trainPattern(fixture, label) {
    const { brain, patterns } = fixture;
    const pattern = patterns[label];
    settle(brain);
    if (!brain.stimulate(pattern.input, 1) || !brain.stimulate(pattern.target, 1)) {
      throw new Error("Could not prepare pattern " + label + " training");
    }
    brain.step(0.1, 0.9);
    for (let i = 0; i < 20; i++) brain.step(0.25, 0.9);

    const beforeReward = brain.snapshot();
    const targetEdge = findEdge(beforeReward, pattern.input, pattern.target);
    const crossEdge = findEdge(beforeReward, pattern.input, pattern.other);
    const eligibilityBeforeReward = targetEdge?.eligibility ?? 0;
    const crossEligibilityBeforeReward = crossEdge?.eligibility ?? 0;
    const activeNeuronsBeforeReward = beforeReward.neurons.filter(
      row => row.activation > EPSILON
    ).length;
    if (eligibilityBeforeReward <= EPSILON) {
      throw new Error("Pattern " + label + " did not retain its target eligibility trace");
    }
    if (crossEligibilityBeforeReward > EPSILON) {
      throw new Error("Pattern " + label + " unexpectedly activated its cross-association");
    }
    if (activeNeuronsBeforeReward !== 0) {
      throw new Error("Pattern " + label + " reward was not delayed until inactivity");
    }

    const changedSynapses = brain.learnFromReward(0.25, 1, 0);
    const afterReward = brain.snapshot();
    const targetWeightAfter = findEdge(afterReward, pattern.input, pattern.target)?.weight;
    const crossWeightAfter = findEdge(afterReward, pattern.input, pattern.other)?.weight;
    const traceConsumed = afterReward.synapses.every(
      edge => edge.eligibility <= EPSILON
    );
    if (!Number.isFinite(targetWeightAfter) || !Number.isFinite(crossWeightAfter)) {
      throw new Error("Pattern " + label + " reward produced an invalid weight");
    }
    return {
      label,
      eligibilityBeforeReward,
      crossEligibilityBeforeReward,
      activeNeuronsBeforeReward,
      changedSynapses,
      targetWeightBefore: targetEdge.weight,
      targetWeightAfter,
      crossWeightBefore: crossEdge.weight,
      crossWeightAfter,
      traceConsumed
    };
  }

  function runPatternOrder(runtime, sequence) {
    const fixture = createPatternFixture(runtime);
    const { brain, patterns, edges } = fixture;
    try {
      const before = {
        A: measurePattern(fixture, "A"),
        B: measurePattern(fixture, "B")
      };
      const firstEpisode = trainPattern(fixture, sequence[0]);
      const secondEpisode = trainPattern(fixture, sequence[1]);
      const afterSecondEpisode = brain.snapshot();
      const firstPattern = patterns[sequence[0]];
      const firstWeightAfterOtherEpisode =
        findEdge(afterSecondEpisode, firstPattern.input, firstPattern.target)?.weight;
      const firstAssociationRetention = {
        pattern: sequence[0],
        weightAfterOwnEpisode: firstEpisode.targetWeightAfter,
        weightAfterOtherEpisode: firstWeightAfterOtherEpisode,
        weightDelta: firstWeightAfterOtherEpisode - firstEpisode.targetWeightAfter
      };

      const after = {
        A: measurePattern(fixture, "A"),
        B: measurePattern(fixture, "B")
      };
      const finalSnapshot = brain.snapshot();
      const patternResults = {};
      for (const label of ["A", "B"]) {
        const pattern = patterns[label];
        const targetEdge = findEdge(finalSnapshot, pattern.input, pattern.target);
        const crossEdge = findEdge(finalSnapshot, pattern.input, pattern.other);
        patternResults[label] = {
          responseBefore: before[label].correct,
          responseAfter: after[label].correct,
          incorrectResponseAfter: after[label].incorrect,
          targetWeightBefore: edges.find(edge => edge.key === pattern.edge).weight,
          targetWeightAfter: targetEdge?.weight,
          crossWeightBefore: edges.find(edge => edge.key === pattern.cross).weight,
          crossWeightAfter: crossEdge?.weight
        };
      }

      const crossWeightsUnchanged = edges.filter(edge => edge.key === "A-Y" || edge.key === "B-X")
        .every(edge => {
          const current = findEdge(finalSnapshot, edge.from, edge.to);
          return current && Math.abs(current.weight - edge.weight) <= TOLERANCE;
        });
      const checks = {
        bothPatternsImproveTheirTargetResponse:
          patternResults.A.responseAfter > patternResults.A.responseBefore + TOLERANCE &&
          patternResults.B.responseAfter > patternResults.B.responseBefore + TOLERANCE,
        bothPatternsRemainDistinct:
          patternResults.A.responseAfter > patternResults.A.incorrectResponseAfter + TOLERANCE &&
          patternResults.B.responseAfter > patternResults.B.incorrectResponseAfter + TOLERANCE,
        firstAssociationSurvivesSecondEpisode:
          Math.abs(firstAssociationRetention.weightDelta) <= TOLERANCE,
        crossAssociationsRemainUnchanged: crossWeightsUnchanged,
        rewardsArriveAfterInactivity:
          firstEpisode.activeNeuronsBeforeReward === 0 &&
          secondEpisode.activeNeuronsBeforeReward === 0,
        eachPatternConsumesItsTrace:
          firstEpisode.traceConsumed && secondEpisode.traceConsumed &&
          firstEpisode.eligibilityBeforeReward > EPSILON &&
          secondEpisode.eligibilityBeforeReward > EPSILON
      };
      return {
        order: sequence.join("→"),
        network: { neurons: 4, synapses: 4, patterns: 2 },
        patterns: patternResults,
        episodes: [firstEpisode, secondEpisode],
        firstAssociationRetention,
        checks,
        passed: Object.values(checks).every(Boolean)
      };
    } finally {
      brain.dispose();
    }
  }

  function runMultiPattern(runtime) {
    const orders = {
      AB: runPatternOrder(runtime, ["A", "B"]),
      BA: runPatternOrder(runtime, ["B", "A"])
    };
    const checks = {
      AThenBOrderPasses: orders.AB.passed,
      BThenAOrderPasses: orders.BA.passed,
      bothOrdersLearnBothPatterns:
        orders.AB.checks.bothPatternsImproveTheirTargetResponse &&
        orders.BA.checks.bothPatternsImproveTheirTargetResponse,
      bothOrdersKeepOutputsDistinct:
        orders.AB.checks.bothPatternsRemainDistinct &&
        orders.BA.checks.bothPatternsRemainDistinct,
      bothOrdersPreserveEarlierAssociation:
        orders.AB.checks.firstAssociationSurvivesSecondEpisode &&
        orders.BA.checks.firstAssociationSurvivesSecondEpisode,
      bothOrdersAvoidCrossAssociationUpdates:
        orders.AB.checks.crossAssociationsRemainUnchanged &&
        orders.BA.checks.crossAssociationsRemainUnchanged,
      delayedRewardsAndTraceConsumption:
        orders.AB.checks.rewardsArriveAfterInactivity &&
        orders.BA.checks.rewardsArriveAfterInactivity &&
        orders.AB.checks.eachPatternConsumesItsTrace &&
        orders.BA.checks.eachPatternConsumesItsTrace
    };
    return {
      kind: "two-pattern paired-association benchmark",
      network: { neurons: 4, synapses: 4, patterns: 2, targetWeight: 0.2, crossWeight: 0.04 },
      orders,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  function createDenseFixture(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const brain = runtime.createBrain();
    try {
      const inputA = brain.addNeuron("dense-pattern-A", "sensory", 0, 0, 1);
      const inputB = brain.addNeuron("dense-pattern-B", "sensory", 0, 1, 1);
      const outputX = brain.addNeuron("dense-response-X", "output", 1, 0, 1);
      const outputY = brain.addNeuron("dense-response-Y", "output", 1, 1, 1);
      if (![inputA, inputB, outputX, outputY].every(Boolean)) {
        throw new Error("Could not create the dense-interference benchmark neurons");
      }

      const edges = [
        { key: "A-X", from: inputA, to: outputX, weight: 0.2 },
        { key: "A-Y", from: inputA, to: outputY, weight: 0.12 },
        { key: "B-X", from: inputB, to: outputX, weight: 0.12 },
        { key: "B-Y", from: inputB, to: outputY, weight: 0.2 }
      ];
      for (const edge of edges) {
        if (!brain.addSynapse(edge.from, edge.to, edge.weight)) {
          throw new Error("Could not create dense benchmark synapse " + edge.key);
        }
      }
      return {
        brain,
        patterns: {
          A: { input: inputA, target: outputX, other: outputY, edge: "A-X", cross: "A-Y" },
          B: { input: inputB, target: outputY, other: outputX, edge: "B-Y", cross: "B-X" }
        },
        edges
      };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function trainDensePattern(fixture, label) {
    const { brain, patterns } = fixture;
    const pattern = patterns[label];
    settle(brain);
    if (!brain.stimulate(pattern.input, 1) || !brain.stimulate(pattern.target, 1)) {
      throw new Error("Could not prepare dense pattern " + label + " training");
    }
    brain.step(0.1, 0.9);
    const duringCoactivation = brain.snapshot();
    const crossActivationDuringCoactivation =
      duringCoactivation.neurons.find(row => row.id === pattern.other)?.activation ?? 0;
    for (let i = 0; i < 20; i++) brain.step(0.25, 0.9);

    const beforeReward = brain.snapshot();
    const targetEdge = findEdge(beforeReward, pattern.input, pattern.target);
    const crossEdge = findEdge(beforeReward, pattern.input, pattern.other);
    const eligibilityBeforeReward = targetEdge?.eligibility ?? 0;
    const crossEligibilityBeforeReward = crossEdge?.eligibility ?? 0;
    const activeNeuronsBeforeReward = beforeReward.neurons.filter(
      row => row.activation > EPSILON
    ).length;
    if (eligibilityBeforeReward <= EPSILON || crossEligibilityBeforeReward <= EPSILON) {
      throw new Error("Dense pattern " + label + " did not accumulate both target and cross-path traces");
    }
    if (crossActivationDuringCoactivation <= 0.05) {
      throw new Error("Dense pattern " + label + " did not activate its competing output");
    }
    if (activeNeuronsBeforeReward !== 0) {
      throw new Error("Dense pattern " + label + " reward was not delayed until inactivity");
    }

    const changedSynapses = brain.learnFromReward(0.25, 1, 0);
    const afterReward = brain.snapshot();
    const targetWeightAfter = findEdge(afterReward, pattern.input, pattern.target)?.weight;
    const crossWeightAfter = findEdge(afterReward, pattern.input, pattern.other)?.weight;
    const traceConsumed = afterReward.synapses.every(
      edge => edge.eligibility <= EPSILON
    );
    if (!Number.isFinite(targetWeightAfter) || !Number.isFinite(crossWeightAfter)) {
      throw new Error("Dense pattern " + label + " reward produced an invalid weight");
    }
    return {
      label,
      eligibilityBeforeReward,
      crossEligibilityBeforeReward,
      crossActivationDuringCoactivation,
      activeNeuronsBeforeReward,
      changedSynapses,
      targetWeightBefore: targetEdge.weight,
      targetWeightAfter,
      crossWeightBefore: crossEdge.weight,
      crossWeightAfter,
      crossWeightDelta: crossWeightAfter - crossEdge.weight,
      traceConsumed
    };
  }

  function runDenseOrder(runtime, sequence) {
    const fixture = createDenseFixture(runtime);
    const { brain, patterns } = fixture;
    try {
      const before = {
        A: measurePattern(fixture, "A"),
        B: measurePattern(fixture, "B")
      };
      const firstEpisode = trainDensePattern(fixture, sequence[0]);
      const secondEpisode = trainDensePattern(fixture, sequence[1]);
      const after = {
        A: measurePattern(fixture, "A"),
        B: measurePattern(fixture, "B")
      };
      const finalSnapshot = brain.snapshot();
      const patternResults = {};
      for (const label of ["A", "B"]) {
        const pattern = patterns[label];
        const targetEdge = findEdge(finalSnapshot, pattern.input, pattern.target);
        const crossEdge = findEdge(finalSnapshot, pattern.input, pattern.other);
        patternResults[label] = {
          responseBefore: before[label].correct,
          responseAfter: after[label].correct,
          incorrectResponseBefore: before[label].incorrect,
          incorrectResponseAfter: after[label].incorrect,
          crossWeightBefore: 0.12,
          crossWeightAfter: crossEdge?.weight,
          crossWeightDelta: (crossEdge?.weight ?? 0) - 0.12,
          targetWeightAfter: targetEdge?.weight
        };
      }

      const episodes = [firstEpisode, secondEpisode];
      const checks = {
        bothEpisodesPotentiateOffTargetPaths:
          episodes.every(episode => episode.crossWeightDelta > TOLERANCE),
        bothCompetingOutputsActivateDuringTraining:
          episodes.every(episode => episode.crossActivationDuringCoactivation > 0.05),
        bothCompetingOutputsRemainActiveOnReplay:
          patternResults.A.incorrectResponseAfter > 0.05 &&
          patternResults.B.incorrectResponseAfter > 0.05,
        targetResponsesRemainStronger:
          patternResults.A.responseAfter > patternResults.A.incorrectResponseAfter &&
          patternResults.B.responseAfter > patternResults.B.incorrectResponseAfter,
        rewardsArriveAfterInactivity:
          episodes.every(episode => episode.activeNeuronsBeforeReward === 0),
        everyDenseEpisodeConsumesItsTraces:
          episodes.every(episode => episode.traceConsumed)
      };
      return {
        order: sequence.join("→"),
        network: { neurons: 4, synapses: 4, patterns: 2, targetWeight: 0.2, crossWeight: 0.12 },
        patterns: patternResults,
        episodes,
        checks,
        passed: Object.values(checks).every(Boolean)
      };
    } finally {
      brain.dispose();
    }
  }

  function runSharedPathInterference(runtime) {
    const orders = {
      AB: runDenseOrder(runtime, ["A", "B"]),
      BA: runDenseOrder(runtime, ["B", "A"])
    };
    const checks = {
      AThenBReproducesInterference: orders.AB.passed,
      BThenAReproducesInterference: orders.BA.passed,
      positiveRewardStrengthensOffTargetPaths:
        orders.AB.checks.bothEpisodesPotentiateOffTargetPaths &&
        orders.BA.checks.bothEpisodesPotentiateOffTargetPaths,
      nonTargetOutputsRemainActive:
        orders.AB.checks.bothCompetingOutputsRemainActiveOnReplay &&
        orders.BA.checks.bothCompetingOutputsRemainActiveOnReplay,
      targetResponsesStillLead:
        orders.AB.checks.targetResponsesRemainStronger &&
        orders.BA.checks.targetResponsesRemainStronger,
      delayedRewardsAndTraceConsumption:
        orders.AB.checks.rewardsArriveAfterInactivity &&
        orders.BA.checks.rewardsArriveAfterInactivity &&
        orders.AB.checks.everyDenseEpisodeConsumesItsTraces &&
        orders.BA.checks.everyDenseEpisodeConsumesItsTraces
    };
    return {
      kind: "dense shared-output interference diagnostic",
      network: { neurons: 4, synapses: 4, patterns: 2, targetWeight: 0.2, crossWeight: 0.12 },
      orders,
      limitationDetected: Object.values(checks).every(Boolean),
      checks,
      passed: Object.values(checks).every(Boolean)
    };
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
    const multiPattern = runMultiPattern(runtime);
    const sharedPathInterference = runSharedPathInterference(runtime);
    const checks = {
      positiveRewardIncreasesWeight: positive.weightAfter > positive.weightBefore + TOLERANCE,
      positiveRewardIncreasesResponse: positive.responseAfter > positive.responseBefore + TOLERANCE,
      negativeRewardDecreasesWeight: negative.weightAfter < negative.weightBefore - TOLERANCE,
      negativeRewardDecreasesResponse: negative.responseAfter < negative.responseBefore - TOLERANCE,
      neutralRewardPreservesWeight: Math.abs(neutral.weightAfter - neutral.weightBefore) <= TOLERANCE,
      rewardArrivesAfterActivity: positive.activeNeuronsBeforeReward === 0 &&
        negative.activeNeuronsBeforeReward === 0 && neutral.activeNeuronsBeforeReward === 0,
      everyRewardConsumesTrace: positive.traceConsumed && negative.traceConsumed && neutral.traceConsumed,
      twoPatternAThenBPasses: multiPattern.checks.AThenBOrderPasses,
      twoPatternBThenAPasses: multiPattern.checks.BThenAOrderPasses,
      twoPatternsImproveBothResponses: multiPattern.checks.bothOrdersLearnBothPatterns,
      twoPatternsRemainDistinct: multiPattern.checks.bothOrdersKeepOutputsDistinct,
      earlierAssociationIsPreserved: multiPattern.checks.bothOrdersPreserveEarlierAssociation,
      crossAssociationsAreNotUpdated: multiPattern.checks.bothOrdersAvoidCrossAssociationUpdates,
      bothPatternRewardsAreDelayedAndConsumed: multiPattern.checks.delayedRewardsAndTraceConsumption,
      denseInterferenceDiagnosticReproducesCrossLearning: sharedPathInterference.limitationDetected
    };
    return {
      kind: "delayed-reward and two-pattern association benchmark",
      network: { neurons: 2, synapses: 1, initialWeight: 0.5 },
      learningRate: 0.25,
      weightDecay: 0,
      positive,
      negative,
      neutral,
      multiPattern,
      sharedPathInterference,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  root.NGExperienceBenchmark = Object.freeze({ run });
})();
