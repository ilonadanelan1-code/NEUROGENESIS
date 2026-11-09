(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;
  const TOLERANCE = 1e-5;
  const TRAINING_REPETITIONS = 3;
  const LEARNING_RATE = 0.25;

  function createFixture(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }

    const brain = runtime.createBrain();
    try {
      const ids = {
        a: brain.addNeuron("shared-pattern-A", "sensory", 0, 0, 1),
        b: brain.addNeuron("shared-pattern-B", "sensory", 0, 1, 1),
        shared: brain.addNeuron("shared-hidden-path", "logic", 1, 0.5, 1),
        x: brain.addNeuron("competing-output-X", "output", 2, 0, 1),
        y: brain.addNeuron("competing-output-Y", "output", 2, 1, 1)
      };
      if (Object.values(ids).some(id => !id)) {
        throw new Error("Could not create all shared-path diagnostic neurons");
      }

      const edges = [
        { key: "A-H", from: ids.a, to: ids.shared, weight: 0.6 },
        { key: "B-H", from: ids.b, to: ids.shared, weight: 0.6 },
        { key: "H-X", from: ids.shared, to: ids.x, weight: 0.4 },
        { key: "H-Y", from: ids.shared, to: ids.y, weight: 0.4 }
      ];
      for (const edge of edges) {
        if (!brain.addSynapse(edge.from, edge.to, edge.weight)) {
          throw new Error("Could not create shared-path synapse " + edge.key);
        }
      }
      return { brain, ids, edges };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function findEdge(snapshot, from, to) {
    return snapshot.synapses.find(edge => edge.from === from && edge.to === to) || null;
  }

  function settle(brain) {
    for (let i = 0; i < 20; i++) brain.step(0.25, 0);
    brain.resetEligibility();
  }

  function measureInput(fixture, label) {
    const { brain, ids } = fixture;
    const input = label === "A" ? ids.a : ids.b;
    settle(brain);
    if (!brain.stimulate(input, 1)) {
      throw new Error("Could not stimulate shared-path input " + label);
    }

    // Two steps are required: input -> shared hidden node -> competing outputs.
    brain.step(0.1, 0);
    brain.step(0.1, 0);
    const snapshot = brain.snapshot();
    const outputX = snapshot.neurons.find(row => row.id === ids.x)?.activation;
    const outputY = snapshot.neurons.find(row => row.id === ids.y)?.activation;
    const shared = snapshot.neurons.find(row => row.id === ids.shared)?.activation;
    if (![outputX, outputY, shared].every(Number.isFinite)) {
      throw new Error("Shared-path input " + label + " produced a non-finite response");
    }

    settle(brain);
    return {
      input: label,
      sharedActivation: shared,
      outputX,
      outputY,
      outputDifference: outputX - outputY,
      bothOutputsActive: outputX > EPSILON && outputY > EPSILON
    };
  }

  function trainEpisode(fixture, label, repetition) {
    const { brain, ids } = fixture;
    const input = label === "A" ? ids.a : ids.b;
    const target = label === "A" ? ids.x : ids.y;
    const other = label === "A" ? ids.y : ids.x;

    settle(brain);
    if (!brain.stimulate(input, 1) || !brain.stimulate(target, 1)) {
      throw new Error("Could not prepare shared-path training episode " + label);
    }
    brain.step(0.1, 0.9);
    for (let i = 0; i < 20; i++) brain.step(0.25, 0.9);

    const beforeReward = brain.snapshot();
    const sharedTargetEdge = findEdge(beforeReward, ids.shared, target);
    const sharedOtherEdge = findEdge(beforeReward, ids.shared, other);
    const targetEligibility = sharedTargetEdge?.eligibility ?? 0;
    const competingEligibility = sharedOtherEdge?.eligibility ?? 0;
    const eligibleSynapses = beforeReward.synapses.filter(
      edge => edge.eligibility > EPSILON
    ).length;
    const activeNeurons = beforeReward.neurons.filter(
      neuron => neuron.activation > EPSILON
    ).length;

    if (targetEligibility <= EPSILON || eligibleSynapses === 0) {
      throw new Error("Shared-path target did not leave an eligibility trace for " + label);
    }
    if (activeNeurons !== 0) {
      throw new Error("Shared-path reward arrived before inactivity for " + label);
    }

    const changedSynapses = brain.learnFromReward(LEARNING_RATE, 1, 0);
    const afterReward = brain.snapshot();
    const traceConsumed = afterReward.synapses.every(
      edge => edge.eligibility <= EPSILON
    );
    return {
      pattern: label,
      repetition,
      targetEligibility,
      competingEligibility,
      eligibleSynapses,
      activeNeuronsBeforeReward: activeNeurons,
      changedSynapses,
      traceConsumed
    };
  }

  function runOrder(runtime, sequence) {
    const fixture = createFixture(runtime);
    const { brain, ids } = fixture;
    try {
      const initial = {
        A: measureInput(fixture, "A"),
        B: measureInput(fixture, "B")
      };
      const episodes = [];
      for (const label of sequence) {
        for (let repetition = 1; repetition <= TRAINING_REPETITIONS; repetition++) {
          episodes.push(trainEpisode(fixture, label, repetition));
        }
      }

      const after = {
        A: measureInput(fixture, "A"),
        B: measureInput(fixture, "B")
      };
      const snapshot = brain.snapshot();
      const inputWeightA = findEdge(snapshot, ids.a, ids.shared)?.weight;
      const inputWeightB = findEdge(snapshot, ids.b, ids.shared)?.weight;
      const outputWeightX = findEdge(snapshot, ids.shared, ids.x)?.weight;
      const outputWeightY = findEdge(snapshot, ids.shared, ids.y)?.weight;

      const checks = {
        sharedInputRoutesRemainSymmetric:
          Math.abs(inputWeightA - inputWeightB) <= TOLERANCE,
        competingOutputWeightsRemainSymmetric:
          Math.abs(outputWeightX - outputWeightY) <= TOLERANCE,
        inputAActivatesBothCompetingOutputs: after.A.bothOutputsActive,
        inputBActivatesBothCompetingOutputs: after.B.bothOutputsActive,
        inputAProducesNoSelectiveOutput:
          Math.abs(after.A.outputDifference) <= TOLERANCE,
        inputBProducesNoSelectiveOutput:
          Math.abs(after.B.outputDifference) <= TOLERANCE,
        bothInputsCollapseToSameOutputResponse:
          Math.abs(after.A.outputX - after.B.outputX) <= TOLERANCE &&
          Math.abs(after.A.outputY - after.B.outputY) <= TOLERANCE,
        rewardsArriveAfterActivityFades:
          episodes.every(episode => episode.activeNeuronsBeforeReward === 0),
        everyEpisodeHasTargetTrace:
          episodes.every(episode => episode.targetEligibility > EPSILON),
        noWrongOutputTraceInEachEpisode:
          episodes.every(episode => episode.competingEligibility <= EPSILON),
        everyEpisodeConsumesTraces:
          episodes.every(episode => episode.traceConsumed),
        allWeightsRemainBounded:
          snapshot.synapses.every(edge =>
            Number.isFinite(edge.weight) && edge.weight >= 0 && edge.weight <= 1
          )
      };

      return {
        order: sequence.join("→"),
        initial,
        after,
        weights: {
          inputAtoShared: inputWeightA,
          inputBtoShared: inputWeightB,
          sharedToX: outputWeightX,
          sharedToY: outputWeightY
        },
        episodes,
        checks,
        diagnosed: Object.values(checks).every(Boolean)
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

    const aThenB = runOrder(runtime, ["A", "B"]);
    const bThenA = runOrder(runtime, ["B", "A"]);
    const checks = {
      bothTrainingOrdersReproduceSharedPathInterference:
        aThenB.diagnosed && bThenA.diagnosed,
      diagnosisIsOrderIndependent:
        Math.abs(aThenB.after.A.outputX - bThenA.after.A.outputX) <= TOLERANCE &&
        Math.abs(aThenB.after.B.outputY - bThenA.after.B.outputY) <= TOLERANCE,
      eachScenarioUsesSixDelayedRewardEpisodes:
        aThenB.episodes.length === 6 && bThenA.episodes.length === 6
    };

    return {
      kind: "shared-path competing-output interference diagnostic",
      network: { neurons: 5, synapses: 4, sharedHiddenNodes: 1, competingOutputs: 2 },
      trainingRepetitionsPerPattern: TRAINING_REPETITIONS,
      learningRate: LEARNING_RATE,
      aThenB,
      bThenA,
      checks,
      diagnosed: Object.values(checks).every(Boolean),
      interpretation: "shared-hidden-path-collapses-input-identity"
    };
  }

  root.NGCompetitionBenchmark = Object.freeze({ run });
})();
