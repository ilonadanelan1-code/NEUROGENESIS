(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;
  const RESPONSE_MARGIN = 0.02;
  const TRAINING_REPETITIONS = 4;
  const INITIAL_WEIGHT = 0.35;
  const LEARNING_RATE = 0.25;

  function createFixture(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }

    const brain = runtime.createBrain();
    try {
      const ids = {
        a: brain.addNeuron("pattern-A", "sensory", 0, 0, 1),
        b: brain.addNeuron("pattern-B", "sensory", 0, 0, 1),
        x: brain.addNeuron("response-X", "output", 0, 0, 1),
        y: brain.addNeuron("response-Y", "output", 0, 0, 1)
      };
      if (Object.values(ids).some(id => !id)) {
        throw new Error("Could not create all multi-pattern benchmark neurons");
      }

      const edges = [
        ["a", "x"], ["a", "y"], ["b", "x"], ["b", "y"]
      ];
      for (const [from, to] of edges) {
        if (!brain.addSynapse(ids[from], ids[to], INITIAL_WEIGHT)) {
          throw new Error("Could not create the fully connected two-pattern benchmark");
        }
      }

      return { brain, ids, edges };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function settle(brain) {
    for (let i = 0; i < 20; i++) brain.step(0.25, 0);
    brain.resetEligibility();
  }

  function measurePattern(fixture, pattern) {
    const { brain, ids } = fixture;
    const inputId = pattern === "A" ? ids.a : ids.b;
    const expectedId = pattern === "A" ? ids.x : ids.y;
    const otherId = pattern === "A" ? ids.y : ids.x;

    settle(brain);
    if (!brain.stimulate(inputId, 1)) {
      throw new Error("Could not stimulate pattern " + pattern);
    }
    brain.step(0.1, 0);

    const snapshot = brain.snapshot();
    const activationById = new Map(snapshot.neurons.map(row => [row.id, row.activation]));
    const correctResponse = activationById.get(expectedId);
    const otherResponse = activationById.get(otherId);
    if (!Number.isFinite(correctResponse) || !Number.isFinite(otherResponse)) {
      throw new Error("Pattern " + pattern + " produced a non-finite response");
    }

    settle(brain);
    return {
      pattern,
      correctResponse,
      otherResponse,
      margin: correctResponse - otherResponse
    };
  }

  function trainEpisode(fixture, pattern, episodeIndex) {
    const { brain, ids } = fixture;
    const inputId = pattern === "A" ? ids.a : ids.b;
    const targetId = pattern === "A" ? ids.x : ids.y;

    settle(brain);
    if (!brain.stimulate(inputId, 1) || !brain.stimulate(targetId, 1)) {
      throw new Error("Could not prepare pattern " + pattern + " training episode");
    }
    brain.step(0.1, 0.9);
    for (let i = 0; i < 20; i++) brain.step(0.25, 0.9);

    const beforeReward = brain.snapshot();
    const activeNeuronsBeforeReward = beforeReward.neurons.filter(
      row => row.activation > EPSILON
    ).length;
    const eligibleSynapsesBeforeReward = beforeReward.synapses.filter(
      row => row.eligibility > EPSILON
    ).length;
    const eligibilityMassBeforeReward = beforeReward.synapses.reduce(
      (sum, row) => sum + row.eligibility, 0
    );

    if (activeNeuronsBeforeReward !== 0) {
      throw new Error("Pattern " + pattern + " reward arrived before activity faded");
    }
    if (eligibleSynapsesBeforeReward === 0 || eligibilityMassBeforeReward <= EPSILON) {
      throw new Error("Pattern " + pattern + " did not leave an eligibility trace");
    }

    const changedSynapses = brain.learnFromReward(LEARNING_RATE, 1, 0);
    const afterReward = brain.snapshot();
    const traceConsumed = afterReward.synapses.every(
      row => row.eligibility <= EPSILON
    );

    return {
      pattern,
      episode: episodeIndex,
      activeNeuronsBeforeReward,
      eligibleSynapsesBeforeReward,
      eligibilityMassBeforeReward,
      changedSynapses,
      traceConsumed
    };
  }

  function runOrder(runtime, firstPattern, secondPattern) {
    const fixture = createFixture(runtime);
    const { brain } = fixture;
    try {
      const initialWeights = brain.snapshot().synapses.map(row => row.weight);
      const firstEpisodes = [];
      const secondEpisodes = [];

      for (let i = 0; i < TRAINING_REPETITIONS; i++) {
        firstEpisodes.push(trainEpisode(fixture, firstPattern, i + 1));
      }
      const firstAfterFirstTask = measurePattern(fixture, firstPattern);

      for (let i = 0; i < TRAINING_REPETITIONS; i++) {
        secondEpisodes.push(trainEpisode(fixture, secondPattern, i + 1));
      }

      const firstAfterSecondTask = measurePattern(fixture, firstPattern);
      const secondAfterSecondTask = measurePattern(fixture, secondPattern);
      const finalSnapshot = brain.snapshot();
      const finalWeights = finalSnapshot.synapses.map(row => row.weight);
      const allEpisodes = [...firstEpisodes, ...secondEpisodes];
      const diagonalWeightMean = (finalWeights[0] + finalWeights[3]) / 2;
      const crossWeightMean = (finalWeights[1] + finalWeights[2]) / 2;

      const checks = {
        firstPatternLearnedBeforeSecond: firstAfterFirstTask.margin > RESPONSE_MARGIN,
        firstPatternRetainedAfterSecond: firstAfterSecondTask.margin >
          RESPONSE_MARGIN &&
          firstAfterSecondTask.margin >= firstAfterFirstTask.margin - 1e-5,
        secondPatternLearned: secondAfterSecondTask.margin > RESPONSE_MARGIN,
        targetWeightsOutgrowCrossWeights: diagonalWeightMean >
          crossWeightMean + RESPONSE_MARGIN,
        rewardsArriveAfterActivity: allEpisodes.every(
          row => row.activeNeuronsBeforeReward === 0
        ),
        everyRewardHasEligibility: allEpisodes.every(
          row => row.eligibleSynapsesBeforeReward > 0 &&
            row.eligibilityMassBeforeReward > EPSILON
        ),
        everyRewardConsumesTraces: allEpisodes.every(row => row.traceConsumed),
        weightsStayBounded: finalWeights.every(
          weight => Number.isFinite(weight) && weight >= 0 && weight <= 1
        ),
        networkRemainsFourByFour: brain.neuronCount === 4 &&
          brain.synapseCount === 4
      };

      return {
        order: firstPattern + "_then_" + secondPattern,
        initialWeights,
        finalWeights,
        firstPatternAfterFirstTask,
        firstPatternAfterSecondTask,
        secondPatternAfterSecondTask,
        diagonalWeightMean,
        crossWeightMean,
        episodes: allEpisodes,
        checks,
        passed: Object.values(checks).every(Boolean)
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

    const aThenB = runOrder(runtime, "A", "B");
    const bThenA = runOrder(runtime, "B", "A");
    const checks = {
      bothTrainingOrdersLearnDistinctResponses: aThenB.passed && bThenA.passed,
      previouslyLearnedResponseSurvivesLaterTask:
        aThenB.checks.firstPatternRetainedAfterSecond &&
        bThenA.checks.firstPatternRetainedAfterSecond,
      orderSymmetryIsStable:
        Math.abs(aThenB.firstPatternAfterSecondTask.margin -
          bThenA.secondPatternAfterSecondTask.margin) < 1e-4 &&
        Math.abs(aThenB.secondPatternAfterSecondTask.margin -
          bThenA.firstPatternAfterSecondTask.margin) < 1e-4
    };

    return {
      kind: "two-pattern sequential learning benchmark",
      network: { neurons: 4, synapses: 4, initialWeight: INITIAL_WEIGHT },
      trainingRepetitionsPerPattern: TRAINING_REPETITIONS,
      learningRate: LEARNING_RATE,
      responseMarginThreshold: RESPONSE_MARGIN,
      aThenB,
      bThenA,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  root.NGMultiPatternBenchmark = Object.freeze({ run });
})();
