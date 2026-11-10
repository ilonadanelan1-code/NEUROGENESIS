(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const INITIAL_WEIGHT = 0.005;
  const BASE_LEARNING_RATE = 0.25;
  const COMPOSITION_LEARNING_RATE = 0.05;
  const POSITIVE_RATE = 0.02;
  const NEGATIVE_RATE = 0.70;
  const LOW_SYMMETRIC_RATE = 0.05;
  const HIGH_SYMMETRIC_RATE = 0.25;
  const FRESH_ASSOCIATION_SWEEPS = 8;
  const TARGET_MIN_ACTIVATION = 0.15;
  const NON_TARGET_MAX_ACTIVATION = 0.05;
  const MAX_CORRECT_WEIGHT_FOR_HEADROOM = 0.95;
  const EPSILON = 1e-6;
  const FEATURE_COUNT = 4;
  const OUTPUT_COUNT = 5;
  const CYCLES = 3;
  const SEEDS = Object.freeze([101, 211]);
  const MODES = Object.freeze([
    Object.freeze({ id: "symmetric-high", updateRule: "legacy", positiveRate: HIGH_SYMMETRIC_RATE, negativeRate: HIGH_SYMMETRIC_RATE, replaySweeps: 3 }),
    Object.freeze({ id: "symmetric-low", updateRule: "legacy", positiveRate: LOW_SYMMETRIC_RATE, negativeRate: LOW_SYMMETRIC_RATE, replaySweeps: 1 }),
    Object.freeze({ id: "bounded-symmetric", updateRule: "bounded", positiveRate: POSITIVE_RATE, negativeRate: POSITIVE_RATE, replaySweeps: 2 }),
    Object.freeze({ id: "asymmetric", updateRule: "bounded", positiveRate: POSITIVE_RATE, negativeRate: NEGATIVE_RATE, replaySweeps: 2 })
  ]);

  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : Date.now();
  }
  function createRng(seed) {
    let state = (seed >>> 0) || 0x6d2b79f5;
    return () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
  }
  function shuffle(values, rng) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function combinations(values, size, start = 0, prefix = [], result = []) {
    if (prefix.length === size) { result.push(prefix.slice()); return result; }
    for (let i = start; i <= values.length - (size - prefix.length); i++) {
      prefix.push(values[i]); combinations(values, size, i + 1, prefix, result); prefix.pop();
    }
    return result;
  }
  function permutations(values) {
    if (values.length <= 1) return [values.slice()];
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const rest = values.slice(0, i).concat(values.slice(i + 1));
      for (const tail of permutations(rest)) result.push([values[i], ...tail]);
    }
    return result;
  }
  const HELD_OUT = Array.from({ length: FEATURE_COUNT - 1 }, (_v, i) => i + 2)
    .flatMap(size => combinations(Array.from({ length: FEATURE_COUNT }, (_v, i) => i), size));
  const TASKS = Object.freeze([
    Object.freeze({ id: "AB-union", features: Object.freeze([0, 1]) }),
    Object.freeze({ id: "CD-union", features: Object.freeze([2, 3]) }),
    Object.freeze({ id: "ABCD-dense-union", features: Object.freeze([0, 1, 2, 3]) })
  ]);

  function settle(brain) {
    for (let i = 0; i < 12; i++) brain.step(0.25, 0);
    brain.resetEligibility();
  }
  function createFixture(runtime, seed) {
    const brain = runtime.createBrain();
    try {
      const rng = createRng(seed);
      const outputs = shuffle(Array.from({ length: OUTPUT_COUNT }, (_v, i) => i), rng);
      const mapping = outputs.slice(0, FEATURE_COUNT);
      const featureNames = Array.from({ length: FEATURE_COUNT }, (_v, i) => "F" + (i + 1));
      const outputNames = Array.from({ length: OUTPUT_COUNT }, (_v, i) => "O" + (i + 1));
      const inputIds = featureNames.map((name, i) =>
        brain.addNeuron("headroom-feature-" + name, "sensory", 0, i, 1));
      const outputIds = outputNames.map((name, i) =>
        brain.addNeuron("headroom-output-" + name, "output", 1, i, 1));
      for (const input of inputIds) for (const output of outputIds) {
        if (!brain.addSynapse(input, output, INITIAL_WEIGHT)) throw new Error("Could not build complete headroom graph");
      }
      return { brain, inputIds, outputIds, mapping, featureNames, outputNames, seed };
    } catch (error) { brain.dispose(); throw error; }
  }

  function contrastiveEpisode(brain, inputId, positiveId, negativeId, positiveRate, negativeRate, updateRule = "bounded") {
    settle(brain);
    if (!brain.stimulate(inputId, 1) || !brain.stimulate(positiveId, 1) ||
        !brain.stimulate(negativeId, 1)) throw new Error("Could not prepare contrastive episode");
    brain.step(0.1, 0.9);
    for (let i = 0; i < 12; i++) brain.step(0.25, 0.9);
    const before = brain.snapshot();
    const positive = before.synapses.find(e => e.from === inputId && e.to === positiveId);
    const negative = before.synapses.find(e => e.from === inputId && e.to === negativeId);
    const inactive = before.neurons.every(n => n.activation <= EPSILON);
    if (!positive || !negative || positive.eligibility <= EPSILON ||
        negative.eligibility <= EPSILON || !inactive ||
        before.neurons.some(neuron => neuron.activation > EPSILON)) {
      throw new Error("Contrastive episode did not leave traces after activity faded");
    }
    const changed = updateRule === "legacy"
      ? brain.learnContrastiveReward(positiveRate, inputId, positiveId, negativeId)
      : brain.learnContrastiveRewardAsymmetric(
        positiveRate, negativeRate, inputId, positiveId, negativeId);
    const after = brain.snapshot();
    return {
      changed,
      positiveTrace: positive.eligibility,
      negativeTrace: negative.eligibility,
      traceConsumed: after.synapses.every(e => e.eligibility <= EPSILON),
      positiveWeightDelta: after.synapses.find(e => e.from === inputId && e.to === positiveId).weight - positive.weight,
      negativeWeightDelta: after.synapses.find(e => e.from === inputId && e.to === negativeId).weight - negative.weight
    };
  }

  function trainInitialMappings(fixture, seed, reverseOrder) {
    const rng = createRng((seed ^ 0x31415926) >>> 0);
    let features = shuffle(Array.from({ length: FEATURE_COUNT }, (_v, i) => i), rng);
    if (reverseOrder) features.reverse();
    let episodes = 0;
    for (const feature of features) {
      const target = fixture.mapping[feature];
      let negatives = fixture.outputIds.map((_v, i) => i).filter(i => i !== target);
      negatives = shuffle(negatives, rng);
      if (reverseOrder) negatives.reverse();
      for (const negative of negatives) {
        contrastiveEpisode(fixture.brain, fixture.inputIds[feature],
          fixture.outputIds[target], fixture.outputIds[negative],
          BASE_LEARNING_RATE, BASE_LEARNING_RATE, "legacy");
        episodes++;
      }
    }
    return episodes;
  }

  function trainComposition(fixture, featureIndices) {
    const { brain, inputIds, outputIds, mapping } = fixture;
    settle(brain);
    for (const feature of featureIndices) brain.stimulate(inputIds[feature], 1);
    for (const feature of featureIndices) brain.stimulate(outputIds[mapping[feature]], 1);
    brain.step(0.1, 0.9);
    for (let i = 0; i < 12; i++) brain.step(0.25, 0.9);
    const before = brain.snapshot();
    const selected = featureIndices.length * featureIndices.length;
    const traces = before.synapses.filter(edge =>
      featureIndices.some(index => edge.from === inputIds[index]) &&
      featureIndices.some(index => edge.to === outputIds[mapping[index]]) &&
      edge.eligibility > EPSILON
    ).length;
    if (traces < selected) throw new Error("Composition episode produced fewer eligible routes than expected");
    const changed = brain.learnFromRewardHomeostatic(COMPOSITION_LEARNING_RATE, 1, 0);
    const after = brain.snapshot();
    return { changed, traceConsumed: after.synapses.every(edge => edge.eligibility <= EPSILON), selectedRoutes: selected, traces };
  }

  function replaySweep(fixture, seed, reverseOrder, mode) {
    const rng = createRng(seed >>> 0);
    let features = shuffle(Array.from({ length: FEATURE_COUNT }, (_v, i) => i), rng);
    if (reverseOrder) features.reverse();
    let episodes = 0;
    for (const feature of features) {
      const target = fixture.mapping[feature];
      let negatives = fixture.outputIds.map((_v, i) => i).filter(i => i !== target);
      negatives = shuffle(negatives, rng);
      if (reverseOrder) negatives.reverse();
      for (const negative of negatives) {
        const row = contrastiveEpisode(fixture.brain, fixture.inputIds[feature],
          fixture.outputIds[target], fixture.outputIds[negative],
          mode.positiveRate, mode.negativeRate, mode.updateRule);
        if (!row.traceConsumed || row.positiveWeightDelta < -EPSILON ||
            row.negativeWeightDelta > EPSILON) throw new Error("Replay violated its signed update contract");
        episodes++;
      }
    }
    return episodes;
  }

  function evaluateOne(brain, fixture, features, order) {
    settle(brain);
    for (const index of order) brain.stimulate(fixture.inputIds[index], 1);
    brain.step(0.1, 0);
    const snapshot = brain.snapshot();
    const responses = fixture.outputIds.map(id => snapshot.neurons.find(n => n.id === id)?.activation ?? NaN);
    const expected = features.map(index => fixture.mapping[index]);
    const unexpected = fixture.outputIds.map((_v, index) => index).filter(index => !expected.includes(index));
    const expectedValues = expected.map(index => responses[index]);
    const unexpectedValues = unexpected.map(index => responses[index]);
    const minimum = Math.min(...expectedValues);
    const maximumUnexpected = unexpectedValues.length ? Math.max(...unexpectedValues) : 0;
    settle(brain);
    return {
      responses: Object.fromEntries(fixture.outputNames.map((name, i) => [name, responses[i]])),
      minExpected: minimum,
      maxUnexpected: maximumUnexpected,
      passed: expectedValues.every(v => Number.isFinite(v) && v >= TARGET_MIN_ACTIVATION) &&
        unexpectedValues.every(v => Number.isFinite(v) && v <= NON_TARGET_MAX_ACTIVATION)
    };
  }
  function evaluatePattern(brain, fixture, features) {
    const orders = permutations(features);
    const rows = orders.map(order => evaluateOne(brain, fixture, features, order));
    const expected = features.map(index => fixture.outputNames[fixture.mapping[index]]);
    const spreads = expected.map(name => {
      const values = rows.map(row => row.responses[name]);
      return Math.max(...values) - Math.min(...values);
    });
    return {
      features: features.map(index => fixture.featureNames[index]),
      permutationCount: rows.length,
      minExpected: Math.min(...rows.map(row => row.minExpected)),
      maxUnexpected: Math.max(...rows.map(row => row.maxUnexpected)),
      maxOrderSpread: Math.max(...spreads),
      passed: rows.every(row => row.passed) &&
        Math.max(...spreads) <= 1e-6
    };
  }
  function evaluateAll(brain, fixture) {
    const singleton = Array.from({ length: FEATURE_COUNT }, (_v, i) => [i])
      .map(pattern => evaluatePattern(brain, fixture, pattern));
    const heldOut = HELD_OUT.map(pattern => evaluatePattern(brain, fixture, pattern));
    return {
      singletonPatterns: singleton.length,
      heldOutPatterns: heldOut.length,
      permutations: heldOut.reduce((sum, row) => sum + row.permutationCount, 0),
      minExpected: Math.min(...singleton.concat(heldOut).map(row => row.minExpected)),
      maxUnexpected: Math.max(...singleton.concat(heldOut).map(row => row.maxUnexpected)),
      maxOrderSpread: Math.max(...singleton.concat(heldOut).map(row => row.maxOrderSpread)),
      passed: singleton.concat(heldOut).every(row => row.passed),
      singleton, heldOut
    };
  }

  function weightMetrics(fixture) {
    const snapshot = fixture.brain.snapshot();
    const correct = [];
    const cross = [];
    for (let feature = 0; feature < FEATURE_COUNT; feature++) {
      for (let output = 0; output < OUTPUT_COUNT; output++) {
        const edge = snapshot.synapses.find(row =>
          row.from === fixture.inputIds[feature] && row.to === fixture.outputIds[output]);
        if (!edge) continue;
        (output === fixture.mapping[feature] ? correct : cross).push(edge.weight);
      }
    }
    const mean = rows => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
    const saturated = correct.filter(value => value >= 0.98).length;
    return {
      correctEdges: correct.length,
      minCorrectWeight: Math.min(...correct),
      maxCorrectWeight: Math.max(...correct),
      meanCorrectWeight: mean(correct),
      meanUnusedHeadroom: mean(correct.map(value => 1 - value)),
      saturatedCorrectEdges: saturated,
      correctEdgesBelow95Percent: correct.filter(value => value < MAX_CORRECT_WEIGHT_FOR_HEADROOM).length,
      maxCrossWeight: Math.max(...cross),
      meanCrossWeight: mean(cross),
      allWeightsBounded: snapshot.synapses.every(edge =>
        Number.isFinite(edge.weight) && edge.weight >= 0 && edge.weight <= 1)
    };
  }

  function trainFreshAssociation(fixture, mode, reverseOrder) {
    const { brain, outputIds, outputNames } = fixture;
    const input = brain.addNeuron("headroom-fresh-feature", "sensory", 0, FEATURE_COUNT, 1);
    for (const output of outputIds) {
      if (!brain.addSynapse(input, output, INITIAL_WEIGHT)) throw new Error("Could not add fresh feature routes");
    }
    const target = fixture.mapping.length < outputIds.length
      ? outputIds.findIndex((_v, i) => !fixture.mapping.includes(i)) : -1;
    if (target < 0) throw new Error("No unused output remained for the fresh association");
    const negativeOrder = outputIds.map((_v, i) => i).filter(i => i !== target);
    if (reverseOrder) negativeOrder.reverse();
    let episodes = 0;
    for (let sweep = 0; sweep < FRESH_ASSOCIATION_SWEEPS; sweep++) {
      for (const negative of negativeOrder) {
        const row = contrastiveEpisode(brain, input, outputIds[target], outputIds[negative],
          mode.positiveRate, mode.negativeRate, mode.updateRule);
        if (!row.traceConsumed) throw new Error("Fresh association reward did not consume eligibility");
        episodes++;
      }
    }
    settle(brain);
    brain.stimulate(input, 1);
    brain.step(0.1, 0);
    const snapshot = brain.snapshot();
    const values = outputIds.map(id => snapshot.neurons.find(n => n.id === id)?.activation ?? NaN);
    const unexpected = values.filter((_v, i) => i !== target);
    return {
      inputName: "headroom-fresh-feature",
      expectedOutput: outputNames[target],
      episodes,
      targetActivation: values[target],
      maxUnexpectedActivation: Math.max(...unexpected),
      passed: Number.isFinite(values[target]) && values[target] >= TARGET_MIN_ACTIVATION &&
        unexpected.every(value => Number.isFinite(value) && value <= NON_TARGET_MAX_ACTIVATION)
    };
  }

  function runScenario(runtime, mode, seed, reverseOrder) {
    const fixture = createFixture(runtime, seed);
    const started = now();
    const { brain, mapping, featureNames, outputNames } = fixture;
    try {
      const initialEpisodes = trainInitialMappings(fixture, seed, reverseOrder);
      const baseline = evaluateAll(brain, fixture);
      if (!baseline.passed) throw new Error("Initial single-feature map failed before retention stress");
      const tasks = reverseOrder ? TASKS.slice().reverse() : TASKS.slice();
      const history = [];
      let compositionEpisodes = 0;
      let replayEpisodes = 0;
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
          const task = tasks[taskIndex];
          const composition = trainComposition(fixture, task.features);
          if (!composition.traceConsumed) throw new Error("Composition reward did not consume eligibility");
          compositionEpisodes++;
          for (let sweep = 0; sweep < mode.replaySweeps; sweep++) {
            replayEpisodes += replaySweep(fixture,
              (seed + cycle * 1009 + taskIndex * 131 + sweep * 17) >>> 0,
              reverseOrder, mode);
          }
        }
        const evaluation = evaluateAll(brain, fixture);
        history.push({ cycle, evaluation, weights: weightMetrics(fixture) });
      }
      const retained = evaluateAll(brain, fixture);
      const weights = weightMetrics(fixture);
      const retentionPassed = retained.passed && weights.allWeightsBounded;
      const headroomPassed = weights.maxCorrectWeight <= MAX_CORRECT_WEIGHT_FOR_HEADROOM &&
        weights.saturatedCorrectEdges === 0 &&
        weights.correctEdgesBelow95Percent === weights.correctEdges;
      const freshAssociation = trainFreshAssociation(fixture, mode, reverseOrder);
      const oldAfterFresh = evaluateAll(brain, fixture);
      const allWeightsBoundedAfterFresh = brain.snapshot().synapses.every(edge =>
        Number.isFinite(edge.weight) && edge.weight >= 0 && edge.weight <= 1);
      const passed = retentionPassed && headroomPassed && allWeightsBoundedAfterFresh &&
        freshAssociation.passed && oldAfterFresh.passed;
      return {
        mode: mode.id,
        seed,
        trainingOrder: reverseOrder ? "reverse" : "forward",
        mapping: Object.fromEntries(featureNames.map((name, i) => [name, outputNames[mapping[i]]])),
        protocol: {
          cycles: CYCLES,
          tasksPerCycle: TASKS.map(task => task.id),
          positiveLearningRate: mode.positiveRate,
          negativeLearningRate: mode.negativeRate,
          replaySweepsPerTask: mode.replaySweeps,
          initialTrainingRate: BASE_LEARNING_RATE,
          compositionLearningRate: COMPOSITION_LEARNING_RATE,
          compositionUpdateRule: "homeostatic",
          replayUpdateRule: mode.updateRule,
          targetMinActivation: TARGET_MIN_ACTIVATION,
          nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
          maxCorrectWeightForHeadroom: MAX_CORRECT_WEIGHT_FOR_HEADROOM
        },
        episodes: {
          initialSingleton: initialEpisodes,
          compositions: compositionEpisodes,
          replay: replayEpisodes,
          freshAssociation: freshAssociation.episodes,
          total: initialEpisodes + compositionEpisodes + replayEpisodes + freshAssociation.episodes
        },
        baseline,
        history,
        retained,
        weights,
        retentionPassed,
        headroomPassed,
        freshAssociation,
        oldAfterFresh,
        allWeightsBoundedAfterFresh,
        timingMs: Number((now() - started).toFixed(3)),
        passed
      };
    } finally {
      brain.dispose();
    }
  }

  function run(options = {}) {
    const runtime = options.runtime;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const modes = Array.isArray(options.modes) ? options.modes : MODES;
    const seeds = Array.isArray(options.seeds) ? options.seeds : SEEDS;
    const targetModeId = typeof options.targetModeId === "string" && options.targetModeId
      ? options.targetModeId : "asymmetric";
    if (!modes.length || modes.some(mode => !mode || typeof mode.id !== "string" || !mode.id ||
        !["legacy", "bounded"].includes(mode.updateRule) ||
        !Number.isFinite(mode.positiveRate) || mode.positiveRate < 0 || mode.positiveRate > 1 ||
        !Number.isFinite(mode.negativeRate) || mode.negativeRate < 0 || mode.negativeRate > 1 ||
        !Number.isInteger(mode.replaySweeps) || mode.replaySweeps < 0 || mode.replaySweeps > 6)) {
      throw new TypeError("Benchmark modes must have valid IDs, update rules, bounded rates, and 0–6 integer replay sweeps");
    }
    if (!seeds.length || seeds.some(seed => !Number.isInteger(seed) || seed < 0)) {
      throw new TypeError("Benchmark seeds must be non-negative integers");
    }
    if (new Set(modes.map(mode => mode.id)).size !== modes.length) {
      throw new TypeError("Benchmark mode IDs must be unique");
    }
    const started = now();
    const scenarios = [];
    let createdBrains = 0;
    for (const mode of modes) {
      for (const seed of seeds) {
        for (const reverseOrder of [false, true]) {
          scenarios.push(runScenario(runtime, mode, seed, reverseOrder));
          createdBrains++;
        }
      }
    }
    const target = scenarios.filter(row => row.mode === targetModeId);
    const controls = scenarios.filter(row => row.mode !== targetModeId);
    const expectedCount = modes.length * seeds.length * 2;
    const checks = {
      allScenariosCompleted: scenarios.length === expectedCount,
      allAsymmetricScenariosRetainOldMappings: target.length === seeds.length * 2 &&
        target.every(row => row.retentionPassed),
      allAsymmetricScenariosKeepPlasticityHeadroom: target.length === seeds.length * 2 &&
        target.every(row => row.headroomPassed),
      allAsymmetricScenariosLearnFreshAssociation: target.length === seeds.length * 2 &&
        target.every(row => row.freshAssociation.passed),
      allOldMappingsSurviveFreshLearning: target.length === seeds.length * 2 &&
        target.every(row => row.oldAfterFresh.passed),
      allWeightsBounded: scenarios.every(row => row.weights.allWeightsBounded && row.allWeightsBoundedAfterFresh),
      controlsAreReported: controls.length === expectedCount - target.length,
      noProtectedConditionWasSilentlyOmitted: scenarios.every(row =>
        row.episodes.initialSingleton > 0 && row.episodes.compositions === CYCLES * TASKS.length)
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      kind: "NEUROGENESIS asymmetric plasticity headroom benchmark",
      passed,
      targetModeId,
      protocol: {
        featureCount: FEATURE_COUNT,
        outputCount: OUTPUT_COUNT,
        heldOutCombinationCount: HELD_OUT.length,
        heldOutPermutationCount: HELD_OUT.reduce((sum, pattern) => sum + permutations(pattern).length, 0),
        cycles: CYCLES,
        seeds: seeds.slice(),
        modes: modes.map(mode => ({ ...mode })),
        targetMinActivation: TARGET_MIN_ACTIVATION,
        nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
        maxCorrectWeightForHeadroom: MAX_CORRECT_WEIGHT_FOR_HEADROOM,
        compositionLearningRate: COMPOSITION_LEARNING_RATE,
        compositionUpdateRule: "homeostatic",
        freshAssociationSweeps: FRESH_ASSOCIATION_SWEEPS
      },
      checks,
      scenarios,
      comparisons: {
        asymmetricRetentionPasses: target.filter(row => row.retentionPassed).length,
        asymmetricHeadroomPasses: target.filter(row => row.headroomPassed).length,
        asymmetricFreshLearningPasses: target.filter(row => row.freshAssociation.passed).length,
        controlRetentionPasses: controls.filter(row => row.retentionPassed).length,
        controlHeadroomPasses: controls.filter(row => row.headroomPassed).length,
        controlFreshLearningPasses: controls.filter(row => row.freshAssociation.passed).length,
        boundedSymmetricHeadroomPasses: scenarios.filter(row => row.mode === "bounded-symmetric" && row.headroomPassed).length,
        boundedSymmetricRetentionPasses: scenarios.filter(row => row.mode === "bounded-symmetric" && row.retentionPassed).length
      },
      createdBrains,
      timingMs: Number((now() - started).toFixed(3))
    };
  }

  root.NGPlasticityHeadroomBenchmark = Object.freeze({
    version: 4,
    run,
    protocol: Object.freeze({
      modes: MODES,
      seeds: SEEDS,
      targetMinActivation: TARGET_MIN_ACTIVATION,
      nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
      maxCorrectWeightForHeadroom: MAX_CORRECT_WEIGHT_FOR_HEADROOM
    })
  });
})();
