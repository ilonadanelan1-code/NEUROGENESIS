(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;
  const RESPONSE_MARGIN = 0.05;
  const TRAINING_REPETITIONS = 3;
  const INITIAL_TARGET_WEIGHT = 0.2;
  const INITIAL_CROSS_WEIGHT = 0.12;
  const LEARNING_RATE = 0.25;

  function createFixture(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const brain = runtime.createBrain();
    try {
      const ids = {
        a: brain.addNeuron("contrastive-pattern-A", "sensory", 0, 0, 1),
        b: brain.addNeuron("contrastive-pattern-B", "sensory", 0, 1, 1),
        x: brain.addNeuron("contrastive-output-X", "output", 1, 0, 1),
        y: brain.addNeuron("contrastive-output-Y", "output", 1, 1, 1)
      };
      if (Object.values(ids).some(id => !id)) {
        throw new Error("Could not create the contrastive benchmark neurons");
      }

      const edges = [
        { key: "A-X", from: ids.a, to: ids.x, weight: INITIAL_TARGET_WEIGHT },
        { key: "A-Y", from: ids.a, to: ids.y, weight: INITIAL_CROSS_WEIGHT },
        { key: "B-X", from: ids.b, to: ids.x, weight: INITIAL_CROSS_WEIGHT },
        { key: "B-Y", from: ids.b, to: ids.y, weight: INITIAL_TARGET_WEIGHT }
      ];
      for (const edge of edges) {
        if (!brain.addSynapse(edge.from, edge.to, edge.weight)) {
          throw new Error("Could not create contrastive synapse " + edge.key);
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

  function measurePattern(fixture, label) {
    const { brain, ids } = fixture;
    const input = label === "A" ? ids.a : ids.b;
    const target = label === "A" ? ids.x : ids.y;
    const other = label === "A" ? ids.y : ids.x;
    settle(brain);
    if (!brain.stimulate(input, 1)) {
      throw new Error("Could not stimulate contrastive pattern " + label);
    }
    brain.step(0.1, 0);
    const snapshot = brain.snapshot();
    const targetResponse = snapshot.neurons.find(row => row.id === target)?.activation;
    const incorrectResponse = snapshot.neurons.find(row => row.id === other)?.activation;
    if (![targetResponse, incorrectResponse].every(Number.isFinite)) {
      throw new Error("Contrastive pattern " + label + " produced an invalid response");
    }
    settle(brain);
    return {
      pattern: label,
      targetResponse,
      incorrectResponse,
      margin: targetResponse - incorrectResponse
    };
  }

  function trainEpisode(fixture, label, repetition) {
    const { brain, ids } = fixture;
    const input = label === "A" ? ids.a : ids.b;
    const target = label === "A" ? ids.x : ids.y;
    const other = label === "A" ? ids.y : ids.x;

    settle(brain);
    if (!brain.stimulate(input, 1) || !brain.stimulate(target, 1)) {
      throw new Error("Could not prepare contrastive episode " + label);
    }
    brain.step(0.1, 0.9);
    for (let i = 0; i < 20; i++) brain.step(0.25, 0.9);

    const beforeReward = brain.snapshot();
    const targetEdge = findEdge(beforeReward, input, target);
    const crossEdge = findEdge(beforeReward, input, other);
    const activeNeuronsBeforeReward = beforeReward.neurons.filter(
      row => row.activation > EPSILON
    ).length;
    if (!targetEdge || !crossEdge ||
        targetEdge.eligibility <= EPSILON || crossEdge.eligibility <= EPSILON) {
      throw new Error("Contrastive episode " + label + " must retain target and cross-path traces");
    }
    if (activeNeuronsBeforeReward !== 0) {
      throw new Error("Contrastive reward for " + label + " arrived before activity faded");
    }

    const unrelatedEdgesBefore = beforeReward.synapses
      .filter(edge => edge.from !== input)
      .map(edge => ({ from: edge.from, to: edge.to, weight: edge.weight }));
    const changedSynapses = brain.learnContrastiveReward(LEARNING_RATE, target, other);
    const afterReward = brain.snapshot();
    const targetAfter = findEdge(afterReward, input, target);
    const crossAfter = findEdge(afterReward, input, other);
    const unrelatedEdgesUnchanged = unrelatedEdgesBefore.every(previous => {
      const current = findEdge(afterReward, previous.from, previous.to);
      return current && Math.abs(current.weight - previous.weight) <= 1e-7;
    });
    const traceConsumed = afterReward.synapses.every(
      edge => edge.eligibility <= EPSILON
    );

    return {
      pattern: label,
      repetition,
      targetEligibility: targetEdge.eligibility,
      crossEligibility: crossEdge.eligibility,
      activeNeuronsBeforeReward,
      changedSynapses,
      targetWeightBefore: targetEdge.weight,
      targetWeightAfter: targetAfter?.weight ?? null,
      crossWeightBefore: crossEdge.weight,
      crossWeightAfter: crossAfter?.weight ?? null,
      targetStrengthened: targetAfter && targetAfter.weight > targetEdge.weight,
      crossPathWeakened: crossAfter && crossAfter.weight < crossEdge.weight,
      unrelatedEdgesUnchanged,
      traceConsumed
    };
  }

  function runOrder(runtime, sequence) {
    const fixture = createFixture(runtime);
    const { brain, ids } = fixture;
    try {
      const before = {
        A: measurePattern(fixture, "A"),
        B: measurePattern(fixture, "B")
      };
      const episodes = [];
      for (const label of sequence) {
        for (let repetition = 1; repetition <= TRAINING_REPETITIONS; repetition++) {
          episodes.push(trainEpisode(fixture, label, repetition));
        }
      }
      const after = {
        A: measurePattern(fixture, "A"),
        B: measurePattern(fixture, "B")
      };
      const snapshot = brain.snapshot();
      const weights = {
        targetA: findEdge(snapshot, ids.a, ids.x)?.weight,
        crossA: findEdge(snapshot, ids.a, ids.y)?.weight,
        crossB: findEdge(snapshot, ids.b, ids.x)?.weight,
        targetB: findEdge(snapshot, ids.b, ids.y)?.weight
      };
      const checks = {
        patternASelectsOutputX:
          after.A.targetResponse > after.A.incorrectResponse + RESPONSE_MARGIN,
        patternBSelectsOutputY:
          after.B.targetResponse > after.B.incorrectResponse + RESPONSE_MARGIN,
        patternAImprovesItsMargin: after.A.margin > before.A.margin + RESPONSE_MARGIN,
        patternBImprovesItsMargin: after.B.margin > before.B.margin + RESPONSE_MARGIN,
        bothTargetWeightsIncrease:
          weights.targetA > INITIAL_TARGET_WEIGHT &&
          weights.targetB > INITIAL_TARGET_WEIGHT,
        bothCrossWeightsDecrease:
          weights.crossA < INITIAL_CROSS_WEIGHT &&
          weights.crossB < INITIAL_CROSS_WEIGHT,
        bothTargetAndCrossTracesArePresent:
          episodes.every(episode =>
            episode.targetEligibility > EPSILON &&
            episode.crossEligibility > EPSILON
          ),
        allRewardsArriveAfterActivityFades:
          episodes.every(episode => episode.activeNeuronsBeforeReward === 0),
        contrastiveUpdateTouchesOnlySelectedOutputPaths:
          episodes.every(episode =>
            episode.changedSynapses === 2 &&
            episode.unrelatedEdgesUnchanged
          ),
        targetPathsStrengthenAndCrossPathsWeaken:
          episodes.every(episode =>
            episode.targetStrengthened && episode.crossPathWeakened
          ),
        everyEpisodeConsumesAllTraces:
          episodes.every(episode => episode.traceConsumed),
        allWeightsRemainBounded:
          snapshot.synapses.every(edge =>
            Number.isFinite(edge.weight) && edge.weight >= 0 && edge.weight <= 1
          )
      };
      return {
        order: sequence.join("→"),
        before,
        after,
        weights,
        episodes,
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

    const aThenB = runOrder(runtime, ["A", "B"]);
    const bThenA = runOrder(runtime, ["B", "A"]);
    const checks = {
      contrastiveTrainingWorksInBothOrders: aThenB.passed && bThenA.passed,
      orderDoesNotChangeTheLearnedMapping:
        Math.abs(aThenB.weights.targetA - bThenA.weights.targetA) <= 1e-5 &&
        Math.abs(aThenB.weights.crossA - bThenA.weights.crossA) <= 1e-5 &&
        Math.abs(aThenB.weights.crossB - bThenA.weights.crossB) <= 1e-5 &&
        Math.abs(aThenB.weights.targetB - bThenA.weights.targetB) <= 1e-5
    };
    return {
      kind: "contrastive dense two-pattern learning benchmark",
      network: {
        neurons: 4,
        synapses: 4,
        initialTargetWeight: INITIAL_TARGET_WEIGHT,
        initialCrossWeight: INITIAL_CROSS_WEIGHT
      },
      trainingRepetitionsPerPattern: TRAINING_REPETITIONS,
      learningRate: LEARNING_RATE,
      aThenB,
      bThenA,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  root.NGContrastiveBenchmark = Object.freeze({ run });
})();
