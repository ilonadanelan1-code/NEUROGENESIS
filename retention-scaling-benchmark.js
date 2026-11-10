(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const INITIAL_WEIGHT = 0.005;
  const LEARNING_RATE = 0.25;
  const TRAINING_DELTA_SECONDS = 0.1;
  const FADE_DELTA_SECONDS = 0.25;
  const FADE_STEPS = 12;
  const ELIGIBILITY_RETENTION = 0.9;
  const TARGET_MIN_ACTIVATION = 0.15;
  const NON_TARGET_MAX_ACTIVATION = 0.05;
  const EPSILON = 1e-6;

  const RETENTION_FEATURES = 4;
  const RETENTION_SEED = 101;
  const RETENTION_CYCLES = 3;
  const REPLAY_SWEEPS_PER_TASK = 3;
  const SCALE_FEATURE_COUNTS = Object.freeze([4, 5, 6]);
  const SCALE_SEEDS = Object.freeze([17, 29, 43]);

  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : Date.now();
  }

  function createRng(seed) {
    let state = (seed >>> 0) || 0x6d2b79f5;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
  }

  function shuffle(values, rng) {
    const result = values.slice();
    for (let index = result.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(rng() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function combinations(values, size, start = 0, prefix = [], result = []) {
    if (prefix.length === size) {
      result.push(prefix.slice());
      return result;
    }
    for (let index = start; index <= values.length - (size - prefix.length); index++) {
      prefix.push(values[index]);
      combinations(values, size, index + 1, prefix, result);
      prefix.pop();
    }
    return result;
  }

  function permutations(values) {
    if (values.length <= 1) return [values.slice()];
    const result = [];
    for (let index = 0; index < values.length; index++) {
      const head = values[index];
      const rest = values.slice(0, index).concat(values.slice(index + 1));
      for (const tail of permutations(rest)) result.push([head, ...tail]);
    }
    return result;
  }

  function heldOutPatterns(featureCount) {
    const indices = Array.from({ length: featureCount }, (_value, index) => index);
    return Array.from({ length: featureCount - 1 }, (_value, index) => index + 2)
      .flatMap(size => combinations(indices, size));
  }

  function patternKey(pattern) {
    return pattern.slice().sort((a, b) => a - b).join(",");
  }

  function edgeFor(snapshot, from, to) {
    return snapshot.synapses.find(edge => edge.from === from && edge.to === to) || null;
  }

  function createFixture(runtime, featureCount, seed) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const brain = runtime.createBrain();
    try {
      const featureNames = Array.from({ length: featureCount }, (_value, index) =>
        "F" + String(index + 1));
      const outputNames = Array.from({ length: featureCount + 1 }, (_value, index) =>
        "O" + String(index + 1));
      const rng = createRng(seed);
      const mapping = shuffle(outputNames.map((_name, index) => index), rng)
        .slice(0, featureCount);
      const inputIds = featureNames.map((name, index) =>
        brain.addNeuron("retention-feature-" + name, "sensory", 0, index, 1));
      const outputIds = outputNames.map((name, index) =>
        brain.addNeuron("retention-output-" + name, "output", 1, index, 1));

      if (inputIds.some(id => !id) || outputIds.some(id => !id)) {
        throw new Error("Could not create retention/scaling benchmark neurons");
      }
      for (const inputId of inputIds) {
        for (const outputId of outputIds) {
          if (!brain.addSynapse(inputId, outputId, INITIAL_WEIGHT)) {
            throw new Error("Could not create complete feature-to-output graph");
          }
        }
      }
      return { brain, featureNames, outputNames, inputIds, outputIds, mapping, featureCount };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function settle(brain) {
    for (let step = 0; step < FADE_STEPS; step++) {
      brain.step(FADE_DELTA_SECONDS, 0);
    }
    brain.resetEligibility();
  }

  function snapshotWeights(brain) {
    return brain.snapshot().synapses.map(edge => ({
      from: edge.from, to: edge.to, weight: edge.weight
    }));
  }

  function weightsEqual(left, right) {
    return left.length === right.length && left.every((edge, index) =>
      edge.from === right[index].from &&
      edge.to === right[index].to &&
      Math.abs(edge.weight - right[index].weight) <= EPSILON
    );
  }

  function trainSingletonEpisode(fixture, featureIndex, positiveOutputIndex, negativeOutputIndex) {
    const { brain, inputIds, outputIds } = fixture;
    const inputId = inputIds[featureIndex];
    const positiveId = outputIds[positiveOutputIndex];
    const negativeId = outputIds[negativeOutputIndex];

    settle(brain);
    if (!brain.stimulate(inputId, 1) ||
        !brain.stimulate(positiveId, 1) ||
        !brain.stimulate(negativeId, 1)) {
      throw new Error("Could not prepare singleton rehearsal episode");
    }

    brain.step(TRAINING_DELTA_SECONDS, ELIGIBILITY_RETENTION);
    for (let step = 0; step < FADE_STEPS; step++) {
      brain.step(FADE_DELTA_SECONDS, ELIGIBILITY_RETENTION);
    }

    const before = brain.snapshot();
    const positiveBefore = edgeFor(before, inputId, positiveId);
    const negativeBefore = edgeFor(before, inputId, negativeId);
    const activeNeuronsBeforeReward = before.neurons.filter(
      neuron => neuron.activation > EPSILON
    ).length;
    const unassignedTraceCount = before.synapses.filter(edge =>
      edge.eligibility > EPSILON &&
      !(edge.from === inputId &&
        (edge.to === positiveId || edge.to === negativeId))
    ).length;

    if (!positiveBefore || !negativeBefore ||
        positiveBefore.eligibility <= EPSILON ||
        negativeBefore.eligibility <= EPSILON ||
        activeNeuronsBeforeReward !== 0) {
      throw new Error("Singleton episode did not preserve selected traces until inactivity");
    }

    const changedSynapses = brain.learnContrastiveReward(
      LEARNING_RATE, inputId, positiveId, negativeId
    );
    const after = brain.snapshot();
    const positiveAfter = edgeFor(after, inputId, positiveId);
    const negativeAfter = edgeFor(after, inputId, negativeId);
    const traceConsumed = after.synapses.every(edge => edge.eligibility <= EPSILON);

    return {
      feature: fixture.featureNames[featureIndex],
      positiveOutput: fixture.outputNames[positiveOutputIndex],
      negativeOutput: fixture.outputNames[negativeOutputIndex],
      positiveEligibility: positiveBefore.eligibility,
      negativeEligibility: negativeBefore.eligibility,
      activeNeuronsBeforeReward,
      unassignedTraceCount,
      changedSynapses,
      positiveWeightBefore: positiveBefore.weight,
      positiveWeightAfter: positiveAfter?.weight ?? null,
      negativeWeightBefore: negativeBefore.weight,
      negativeWeightAfter: negativeAfter?.weight ?? null,
      positiveDidNotWeaken: Boolean(positiveAfter &&
        positiveAfter.weight + EPSILON >= positiveBefore.weight),
      negativeDidNotStrengthen: Boolean(negativeAfter &&
        negativeAfter.weight <= negativeBefore.weight + EPSILON),
      traceConsumed
    };
  }

  function trainSingletonMap(fixture, seed, reverseOrder = false) {
    const rng = createRng((seed ^ 0xa5a5a5a5) >>> 0);
    let featureOrder = shuffle(
      Array.from({ length: fixture.featureCount }, (_value, index) => index), rng);
    if (reverseOrder) featureOrder.reverse();
    const episodes = [];

    for (const featureIndex of featureOrder) {
      const positiveOutputIndex = fixture.mapping[featureIndex];
      let competitors = fixture.outputIds.map((_id, index) => index)
        .filter(index => index !== positiveOutputIndex);
      competitors = shuffle(competitors, rng);
      if (reverseOrder) competitors.reverse();
      for (const negativeOutputIndex of competitors) {
        episodes.push(trainSingletonEpisode(
          fixture, featureIndex, positiveOutputIndex, negativeOutputIndex));
      }
    }
    return episodes;
  }

  function trainCompositionEpisode(fixture, task) {
    const { brain, inputIds, outputIds } = fixture;
    settle(brain);
    for (const featureIndex of task.features) {
      if (!brain.stimulate(inputIds[featureIndex], 1)) {
        throw new Error("Could not stimulate composition feature in " + task.name);
      }
    }
    for (const outputIndex of task.outputs) {
      if (!brain.stimulate(outputIds[outputIndex], 1)) {
        throw new Error("Could not cue target output in " + task.name);
      }
    }

    brain.step(TRAINING_DELTA_SECONDS, ELIGIBILITY_RETENTION);
    for (let step = 0; step < FADE_STEPS; step++) {
      brain.step(FADE_DELTA_SECONDS, ELIGIBILITY_RETENTION);
    }

    const before = brain.snapshot();
    const activeNeuronsBeforeReward = before.neurons.filter(
      neuron => neuron.activation > EPSILON
    ).length;
    const selected = new Set();
    for (const featureIndex of task.features) {
      for (const outputIndex of task.outputs) {
        selected.add(inputIds[featureIndex] + ":" + outputIds[outputIndex]);
      }
    }
    const selectedTraceCount = before.synapses.filter(edge =>
      selected.has(edge.from + ":" + edge.to) && edge.eligibility > EPSILON
    ).length;
    const unintendedTraceCount = before.synapses.filter(edge =>
      !selected.has(edge.from + ":" + edge.to) && edge.eligibility > EPSILON
    ).length;
    const expectedTraceCount = task.features.length * task.outputs.length;

    if (activeNeuronsBeforeReward !== 0 || selectedTraceCount !== expectedTraceCount) {
      throw new Error("Composition episode did not produce the expected delayed traces: " + task.name);
    }

    const changedSynapses = brain.learnFromReward(LEARNING_RATE, 1, 0);
    const after = brain.snapshot();
    const traceConsumed = after.synapses.every(edge => edge.eligibility <= EPSILON);
    const changedEdges = [];
    for (const edge of before.synapses) {
      const updated = edgeFor(after, edge.from, edge.to);
      if (updated && Math.abs(updated.weight - edge.weight) > EPSILON) {
        changedEdges.push({
          from: edge.from, to: edge.to,
          before: edge.weight, after: updated.weight
        });
      }
    }

    return {
      name: task.name,
      kind: task.kind,
      presentedFeatures: task.features.map(index => fixture.featureNames[index]),
      cuedOutputs: task.outputs.map(index => fixture.outputNames[index]),
      activeNeuronsBeforeReward,
      selectedTraceCount,
      expectedTraceCount,
      unintendedTraceCount,
      changedSynapses,
      changedEdges,
      traceConsumed
    };
  }

  function replaySingletons(fixture, seed, reverseOrder = false) {
    const rng = createRng(seed >>> 0);
    let featureOrder = shuffle(
      Array.from({ length: fixture.featureCount }, (_value, index) => index), rng);
    if (reverseOrder) featureOrder.reverse();
    const episodes = [];
    for (const featureIndex of featureOrder) {
      const positiveOutputIndex = fixture.mapping[featureIndex];
      let competitors = fixture.outputIds.map((_id, index) => index)
        .filter(index => index !== positiveOutputIndex);
      competitors = shuffle(competitors, rng);
      if (reverseOrder) competitors.reverse();
      for (const negativeOutputIndex of competitors) {
        episodes.push(trainSingletonEpisode(
          fixture, featureIndex, positiveOutputIndex, negativeOutputIndex));
      }
    }
    return episodes;
  }

  function evaluateOne(brain, fixture, featureIndices, stimulationOrder) {
    settle(brain);
    for (const featureIndex of stimulationOrder) {
      if (!brain.stimulate(fixture.inputIds[featureIndex], 1)) {
        throw new Error("Could not stimulate held-out feature " + fixture.featureNames[featureIndex]);
      }
    }
    brain.step(TRAINING_DELTA_SECONDS, 0);
    const snapshot = brain.snapshot();
    const responses = fixture.outputIds.map(outputId =>
      snapshot.neurons.find(neuron => neuron.id === outputId)?.activation ?? NaN);
    const expectedOutputIndices = featureIndices.map(index => fixture.mapping[index]);
    const unexpectedOutputIndices = fixture.outputIds.map((_id, index) => index)
      .filter(index => !expectedOutputIndices.includes(index));
    const expectedValues = expectedOutputIndices.map(index => responses[index]);
    const unexpectedValues = unexpectedOutputIndices.map(index => responses[index]);
    const minExpectedActivation = Math.min(...expectedValues);
    const maxUnexpectedActivation = unexpectedValues.length
      ? Math.max(...unexpectedValues) : 0;
    const passed = expectedValues.every(value =>
      Number.isFinite(value) && value >= TARGET_MIN_ACTIVATION
    ) && unexpectedValues.every(value =>
      Number.isFinite(value) && value <= NON_TARGET_MAX_ACTIVATION
    );
    settle(brain);
    return {
      stimulationOrder: stimulationOrder.map(index => fixture.featureNames[index]),
      expectedOutputs: expectedOutputIndices.map(index => fixture.outputNames[index]),
      responses: Object.fromEntries(fixture.outputNames.map((name, index) => [name, responses[index]])),
      minExpectedActivation,
      maxUnexpectedActivation,
      passed
    };
  }

  function evaluatePattern(brain, fixture, featureIndices, exhaustiveOrder = true) {
    const orders = exhaustiveOrder
      ? permutations(featureIndices) : [featureIndices.slice()];
    const rows = orders.map(order => evaluateOne(brain, fixture, featureIndices, order));
    const expectedOutputIndices = featureIndices.map(index => fixture.mapping[index]);
    const spreads = expectedOutputIndices.map(outputIndex => {
      const name = fixture.outputNames[outputIndex];
      const values = rows.map(row => row.responses[name]);
      return Math.max(...values) - Math.min(...values);
    });
    return {
      features: featureIndices.map(index => fixture.featureNames[index]),
      expectedOutputs: expectedOutputIndices.map(index => fixture.outputNames[index]),
      permutationCount: rows.length,
      minExpectedActivation: Math.min(...rows.map(row => row.minExpectedActivation)),
      maxUnexpectedActivation: Math.max(...rows.map(row => row.maxUnexpectedActivation)),
      maxOrderSpread: Math.max(...spreads),
      passed: rows.every(row => row.passed)
    };
  }

  function evaluatePatterns(brain, fixture, patterns, exhaustiveOrder = true) {
    const rows = patterns.map(pattern =>
      evaluatePattern(brain, fixture, pattern, exhaustiveOrder));
    return {
      combinationCount: rows.length,
      permutationCount: rows.reduce((sum, row) => sum + row.permutationCount, 0),
      minExpectedActivation: rows.length
        ? Math.min(...rows.map(row => row.minExpectedActivation)) : 0,
      maxUnexpectedActivation: rows.length
        ? Math.max(...rows.map(row => row.maxUnexpectedActivation)) : 0,
      maxOrderSpread: rows.length
        ? Math.max(...rows.map(row => row.maxOrderSpread)) : 0,
      patterns: rows,
      passed: rows.every(row => row.passed)
    };
  }

  function evaluateRetentionState(fixture, allCombinations, unseenCombinations, trainedCombinations) {
    const singletonPatterns = Array.from(
      { length: fixture.featureCount }, (_value, index) => [index]);
    const primitives = evaluatePatterns(fixture.brain, fixture, singletonPatterns, false);
    const all = evaluatePatterns(fixture.brain, fixture, allCombinations, true);
    const unseen = evaluatePatterns(fixture.brain, fixture, unseenCombinations, true);
    const trained = evaluatePatterns(fixture.brain, fixture, trainedCombinations, true);
    return {
      primitives,
      allCombinations: all,
      unseenCompositions: unseen,
      trainedCompositions: trained,
      allWeightsFiniteAndBounded: fixture.brain.snapshot().synapses.every(edge =>
        Number.isFinite(edge.weight) && edge.weight >= 0 && edge.weight <= 1)
    };
  }

  function weightMetrics(fixture) {
    const snapshot = fixture.brain.snapshot();
    const correct = [];
    const cross = [];
    for (let featureIndex = 0; featureIndex < fixture.featureCount; featureIndex++) {
      const inputId = fixture.inputIds[featureIndex];
      for (let outputIndex = 0; outputIndex < fixture.outputIds.length; outputIndex++) {
        const edge = edgeFor(snapshot, inputId, fixture.outputIds[outputIndex]);
        if (!edge) continue;
        if (outputIndex === fixture.mapping[featureIndex]) correct.push(edge.weight);
        else cross.push(edge.weight);
      }
    }
    const mean = values => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      minCorrectWeight: correct.length ? Math.min(...correct) : 0,
      meanCorrectWeight: mean(correct),
      maxCrossWeight: cross.length ? Math.max(...cross) : 0,
      meanCrossWeight: mean(cross)
    };
  }

  function makeRetentionTasks(mapping) {
    return [
      { name: "pair-AB-union", kind: "union", features: [0, 1], outputs: [mapping[0], mapping[1]] },
      { name: "pair-CD-union", kind: "union", features: [2, 3], outputs: [mapping[2], mapping[3]] },
      { name: "dense-ABCD-union", kind: "dense-union", features: [0, 1, 2, 3], outputs: mapping.slice() },
      { name: "pair-AB-conflicting-label", kind: "conflict", features: [0, 1], outputs: [mapping[0], mapping[2]] }
    ];
  }

  function runRetentionScenario(runtime, protectedReplay, reverseOrder) {
    const fixture = createFixture(runtime, RETENTION_FEATURES, RETENTION_SEED);
    const { brain, mapping } = fixture;
    try {
      const trainingEpisodes = trainSingletonMap(
        fixture, RETENTION_SEED ^ 0x31415926, reverseOrder);
      const allCombinations = heldOutPatterns(RETENTION_FEATURES);
      const trainedKeys = new Set(["0,1", "2,3", "0,1,2,3"]);
      const trainedCombinations = allCombinations.filter(pattern =>
        trainedKeys.has(patternKey(pattern)));
      const unseenCombinations = allCombinations.filter(pattern =>
        !trainedKeys.has(patternKey(pattern)));

      const baselineState = evaluateRetentionState(
        fixture, allCombinations, unseenCombinations, trainedCombinations);
      const baselineWeights = weightMetrics(fixture);
      if (!baselineState.primitives.passed ||
          !baselineState.allCombinations.passed ||
          !baselineState.allWeightsFiniteAndBounded) {
        throw new Error("Pre-composition baseline did not preserve stage-two behaviour");
      }

      let tasks = makeRetentionTasks(mapping);
      if (reverseOrder) tasks = tasks.slice().reverse();
      const history = [];
      const compositionEpisodes = [];
      let replayEpisodeCount = 0;

      for (let cycle = 1; cycle <= RETENTION_CYCLES; cycle++) {
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
          const task = tasks[taskIndex];
          compositionEpisodes.push(trainCompositionEpisode(fixture, task));
          if (protectedReplay) {
            for (let sweep = 0; sweep < REPLAY_SWEEPS_PER_TASK; sweep++) {
              const replay = replaySingletons(
                fixture,
                (RETENTION_SEED + cycle * 1009 + taskIndex * 131 + sweep * 17) >>> 0,
                reverseOrder
              );
              replayEpisodeCount += replay.length;
              if (!replay.every(episode =>
                episode.positiveEligibility > EPSILON &&
                episode.negativeEligibility > EPSILON &&
                episode.activeNeuronsBeforeReward === 0 &&
                episode.positiveDidNotWeaken &&
                episode.negativeDidNotStrengthen &&
                episode.traceConsumed)) {
                throw new Error("Singleton rehearsal failed to preserve or consume traces");
              }
            }
          }
        }

        const state = evaluateRetentionState(
          fixture, allCombinations, unseenCombinations, trainedCombinations);
        const weights = weightMetrics(fixture);
        history.push({
          cycle,
          state,
          weights,
          retained: state.primitives.passed &&
            state.unseenCompositions.passed &&
            state.trainedCompositions.passed &&
            state.allWeightsFiniteAndBounded
        });
      }

      const final = history[history.length - 1];
      const forgettingDetected = !final.state.primitives.passed ||
        !final.state.unseenCompositions.passed ||
        !final.state.trainedCompositions.passed;
      const passed = protectedReplay
        ? history.every(row => row.retained)
        : forgettingDetected;

      return {
        protection: protectedReplay ? "singleton-contrastive-replay" : "none",
        trainingOrder: reverseOrder ? "reverse" : "forward",
        seed: RETENTION_SEED,
        mapping: Object.fromEntries(fixture.featureNames.map((name, index) =>
          [name, fixture.outputNames[mapping[index]]])),
        training: {
          primitiveEpisodes: trainingEpisodes.length,
          compositionCycles: RETENTION_CYCLES,
          compositionTasksPerCycle: tasks.map(task => ({
            name: task.name, kind: task.kind,
            features: task.features.map(index => fixture.featureNames[index]),
            cuedOutputs: task.outputs.map(index => fixture.outputNames[index])
          })),
          compositionEpisodes: compositionEpisodes.length,
          replaySweepsPerTask: protectedReplay ? REPLAY_SWEEPS_PER_TASK : 0,
          replayEpisodes: replayEpisodeCount
        },
        baseline: {
          primitives: baselineState.primitives,
          allHeldOutCombinations: baselineState.allCombinations,
          weights: baselineWeights
        },
        history,
        final,
        forgettingDetected,
        passed
      };
    } finally {
      brain.dispose();
    }
  }

  function runRetentionSuite(runtime) {
    const scenarios = {
      unprotectedForward: runRetentionScenario(runtime, false, false),
      unprotectedReverse: runRetentionScenario(runtime, false, true),
      protectedForward: runRetentionScenario(runtime, true, false),
      protectedReverse: runRetentionScenario(runtime, true, true)
    };
    const checks = {
      allBaselinesPassBeforeAdditionalLearning: Object.values(scenarios).every(
        scenario => scenario.baseline.primitives.passed &&
          scenario.baseline.allHeldOutCombinations.passed),
      unprotectedBaselineShowsForgettingInBothOrders:
        scenarios.unprotectedForward.forgettingDetected &&
        scenarios.unprotectedReverse.forgettingDetected,
      protectedReplayRetainsOldAndNewCompositionsInBothOrders:
        scenarios.protectedForward.passed && scenarios.protectedReverse.passed,
      protectedReplayRunsMultipleCycles:
        scenarios.protectedForward.history.length === RETENTION_CYCLES &&
        scenarios.protectedReverse.history.length === RETENTION_CYCLES,
      noProtectedCycleHasUnmeasuredRetention:
        scenarios.protectedForward.history.every(row =>
          row.state.primitives.combinationCount === RETENTION_FEATURES &&
          row.state.unseenCompositions.combinationCount === 8 &&
          row.state.trainedCompositions.combinationCount === 3) &&
        scenarios.protectedReverse.history.every(row =>
          row.state.primitives.combinationCount === RETENTION_FEATURES &&
          row.state.unseenCompositions.combinationCount === 8 &&
          row.state.trainedCompositions.combinationCount === 3)
    };
    return {
      protocol: {
        seed: RETENTION_SEED,
        featureCount: RETENTION_FEATURES,
        outputCount: RETENTION_FEATURES + 1,
        cycles: RETENTION_CYCLES,
        replaySweepsPerTask: REPLAY_SWEEPS_PER_TASK,
        tasks: ["AB union", "CD union", "ABCD dense union", "AB conflicting label"],
        stageThreeUnseenPatterns: 8,
        criteria: {
          targetMinActivation: TARGET_MIN_ACTIVATION,
          nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
          protectedEveryCycleMustPass: true,
          unprotectedBaselineMustShowForgetting: true
        }
      },
      scenarios,
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  function runRewardValenceControl(runtime, reward) {
    const brain = runtime.createBrain();
    try {
      const input = brain.addNeuron("reward-control-input", "sensory", 0, 0, 1);
      const output = brain.addNeuron("reward-control-output", "output", 1, 0, 1);
      if (!input || !output || !brain.addSynapse(input, output, 0.4)) {
        throw new Error("Could not create reward-valence control brain");
      }
      settle(brain);
      brain.stimulate(input, 1);
      brain.stimulate(output, 1);
      brain.step(TRAINING_DELTA_SECONDS, ELIGIBILITY_RETENTION);
      for (let step = 0; step < FADE_STEPS; step++) {
        brain.step(FADE_DELTA_SECONDS, ELIGIBILITY_RETENTION);
      }
      const before = brain.snapshot();
      const edgeBefore = edgeFor(before, input, output);
      const inactiveBeforeReward = before.neurons.every(neuron =>
        neuron.activation <= EPSILON);
      if (!edgeBefore || edgeBefore.eligibility <= EPSILON || !inactiveBeforeReward) {
        throw new Error("Reward-valence control did not create a delayed trace");
      }
      const changedSynapses = brain.learnFromReward(LEARNING_RATE, reward, 0);
      const after = brain.snapshot();
      const edgeAfter = edgeFor(after, input, output);
      const traceConsumed = after.synapses.every(edge => edge.eligibility <= EPSILON);
      const delta = (edgeAfter?.weight ?? NaN) - edgeBefore.weight;
      const passed = Number.isFinite(delta) && traceConsumed && (
        reward > 0 ? delta > EPSILON :
        reward < 0 ? delta < -EPSILON :
        Math.abs(delta) <= EPSILON
      );
      return {
        reward,
        weightBefore: edgeBefore.weight,
        weightAfter: edgeAfter?.weight ?? null,
        weightDelta: delta,
        eligibilityBeforeReward: edgeBefore.eligibility,
        inactiveBeforeReward,
        changedSynapses,
        traceConsumed,
        passed
      };
    } finally {
      brain.dispose();
    }
  }

  function runRewardValenceControls(runtime) {
    const positive = runRewardValenceControl(runtime, 1);
    const negative = runRewardValenceControl(runtime, -1);
    const neutral = runRewardValenceControl(runtime, 0);
    return {
      positive, negative, neutral,
      passed: positive.passed && negative.passed && neutral.passed
    };
  }

  function runScaleScenario(runtime, featureCount, seed) {
    const fixture = createFixture(runtime, featureCount, seed);
    const { brain } = fixture;
    try {
      const trainingStart = now();
      const episodes = trainSingletonMap(fixture, seed ^ 0x7f4a7c15, false);
      const trainingMs = now() - trainingStart;
      const patterns = heldOutPatterns(featureCount);
      const inferenceStart = now();
      const heldOut = evaluatePatterns(brain, fixture, patterns, true);
      const inferenceMs = now() - inferenceStart;
      const primitive = evaluatePatterns(
        brain, fixture,
        Array.from({ length: featureCount }, (_value, index) => [index]),
        false
      );
      const weights = brain.snapshot().synapses;
      const passed = heldOut.passed && primitive.passed &&
        weights.every(edge => Number.isFinite(edge.weight) &&
          edge.weight >= 0 && edge.weight <= 1);
      return {
        featureCount,
        outputCount: featureCount + 1,
        neurons: brain.neuronCount,
        synapses: brain.synapseCount,
        seed,
        mapping: Object.fromEntries(fixture.featureNames.map((name, index) =>
          [name, fixture.outputNames[fixture.mapping[index]]])),
        trainingEpisodes: episodes.length,
        heldOutCombinationCount: heldOut.combinationCount,
        heldOutPermutationCount: heldOut.permutationCount,
        minExpectedActivation: heldOut.minExpectedActivation,
        maxUnexpectedActivation: heldOut.maxUnexpectedActivation,
        maxStimulationOrderSpread: heldOut.maxOrderSpread,
        primitiveMappingsRetained: primitive.passed,
        trainingMs: Number(trainingMs.toFixed(3)),
        heldOutInferenceMs: Number(inferenceMs.toFixed(3)),
        passed
      };
    } finally {
      brain.dispose();
    }
  }

  function runScalingSuite(runtime) {
    const scenarios = [];
    for (const featureCount of SCALE_FEATURE_COUNTS) {
      for (const seed of SCALE_SEEDS) {
        scenarios.push(runScaleScenario(runtime, featureCount, seed));
      }
    }
    const expectedCombinations = { 4: 11, 5: 26, 6: 57 };
    const expectedPermutations = { 4: 60, 5: 320, 6: 1950 };
    const checks = {
      allFeatureCountsPass: scenarios.every(scenario => scenario.passed),
      everySeedWasExecuted: SCALE_FEATURE_COUNTS.every(featureCount =>
        SCALE_SEEDS.every(seed => scenarios.some(scenario =>
          scenario.featureCount === featureCount && scenario.seed === seed))),
      heldOutSetsWereExhaustive: scenarios.every(scenario =>
        scenario.heldOutCombinationCount === expectedCombinations[scenario.featureCount] &&
        scenario.heldOutPermutationCount === expectedPermutations[scenario.featureCount]),
      modelSizesMatchCompleteBipartiteTopology: scenarios.every(scenario =>
        scenario.neurons === scenario.featureCount * 2 + 1 &&
        scenario.synapses === scenario.featureCount * (scenario.featureCount + 1)),
      timingMetricsAreFinite: scenarios.every(scenario =>
        Number.isFinite(scenario.trainingMs) && scenario.trainingMs >= 0 &&
        Number.isFinite(scenario.heldOutInferenceMs) && scenario.heldOutInferenceMs >= 0)
    };
    return {
      protocol: {
        featureCounts: SCALE_FEATURE_COUNTS.slice(),
        seeds: SCALE_SEEDS.slice(),
        trainingPatterns: "single-feature routes only",
        heldOutPatterns: "all combinations of size 2 through N",
        permutationCoverage: "every permutation of every held-out combination",
        criteria: {
          targetMinActivation: TARGET_MIN_ACTIVATION,
          nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
          maximumStimulationOrderSpread: EPSILON
        },
        expectedCombinations: expectedCombinations,
        expectedPermutations: expectedPermutations
      },
      scenarios,
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

    const rewardControls = runRewardValenceControls(runtime);
    const retentionStart = now();
    const retention = runRetentionSuite(runtime);
    const retentionMs = now() - retentionStart;
    const scalingStart = now();
    const scaling = runScalingSuite(runtime);
    const scalingMs = now() - scalingStart;
    const checks = {
      positiveNegativeAndNeutralRewardsPass: rewardControls.passed,
      retentionAndInterferencePass: retention.passed,
      scalingAcrossFourFiveAndSixFeaturesPasses: scaling.passed
    };
    return {
      kind: "NEUROGENESIS stage-three retention and scaling benchmark",
      protocol: {
        initialWeight: INITIAL_WEIGHT,
        learningRate: LEARNING_RATE,
        eligibilityRetention: ELIGIBILITY_RETENTION,
        fadeSteps: FADE_STEPS,
        targetMinActivation: TARGET_MIN_ACTIVATION,
        nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
        epsilon: EPSILON,
        wasmArtifactBytes: Number.isFinite(settings.wasmArtifactBytes)
          ? settings.wasmArtifactBytes : null,
        perBrainMemoryBytes: null,
        memoryLimitation: "The current C ABI/adapter exposes graph counts and weights, but not per-brain allocator or WASM heap attribution."
      },
      rewardControls,
      retention,
      scaling,
      timingMs: {
        retention: Number(retentionMs.toFixed(3)),
        scaling: Number(scalingMs.toFixed(3))
      },
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  root.NGRetentionScalingBenchmark = Object.freeze({ run });
})();
