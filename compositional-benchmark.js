(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const FEATURES = Object.freeze(["A", "B", "C", "D"]);
  const OUTPUTS = Object.freeze(["X", "Y", "Z", "W", "V"]);
  const CANONICAL_MAPPING = Object.freeze([0, 1, 2, 3]);
  const PERMUTED_MAPPING = Object.freeze([1, 2, 3, 4]);

  // Pre-registered constants: no threshold or parameter search uses held-out cases.
  const INITIAL_WEIGHT = 0.005;
  const LEARNING_RATE = 0.25;
  const TRAINING_DELTA_SECONDS = 0.1;
  const FADE_DELTA_SECONDS = 0.25;
  const FADE_STEPS = 12;
  const ELIGIBILITY_RETENTION = 0.9;
  const TARGET_MIN_ACTIVATION = 0.15;
  const NON_TARGET_MAX_ACTIVATION = 0.05;
  const EPSILON = 1e-6;

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

  function heldOutPatterns() {
    const indices = FEATURES.map((_feature, index) => index);
    return [2, 3, 4].flatMap(size => combinations(indices, size));
  }

  function edgeFor(snapshot, from, to) {
    return snapshot.synapses.find(edge => edge.from === from && edge.to === to) || null;
  }

  function createFixture(runtime) {
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    const brain = runtime.createBrain();
    try {
      const inputIds = FEATURES.map((feature, index) =>
        brain.addNeuron("composition-feature-" + feature, "sensory", 0, index, 1));
      const outputIds = OUTPUTS.map((output, index) =>
        brain.addNeuron("composition-output-" + output, "output", 1, index, 1));

      if (inputIds.some(id => !id) || outputIds.some(id => !id)) {
        throw new Error("Could not create the compositional benchmark neurons");
      }

      for (const inputId of inputIds) {
        for (const outputId of outputIds) {
          if (!brain.addSynapse(inputId, outputId, INITIAL_WEIGHT)) {
            throw new Error("Could not create the complete feature-to-output route graph");
          }
        }
      }
      return { brain, inputIds, outputIds };
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

  function trainEpisode(fixture, featureIndex, positiveOutputIndex, negativeOutputIndex) {
    const { brain, inputIds, outputIds } = fixture;
    const inputId = inputIds[featureIndex];
    const positiveId = outputIds[positiveOutputIndex];
    const negativeId = outputIds[negativeOutputIndex];

    settle(brain);
    if (!brain.stimulate(inputId, 1) ||
        !brain.stimulate(positiveId, 1) ||
        !brain.stimulate(negativeId, 1)) {
      throw new Error("Could not prepare a singleton contrastive training episode");
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
    const unrelatedTracesClear = before.synapses
      .filter(edge => edge.from !== inputId ||
        (edge.to !== positiveId && edge.to !== negativeId))
      .every(edge => edge.eligibility <= EPSILON);

    if (!positiveBefore || !negativeBefore ||
        positiveBefore.eligibility <= EPSILON ||
        negativeBefore.eligibility <= EPSILON ||
        activeNeuronsBeforeReward !== 0 ||
        !unrelatedTracesClear) {
      throw new Error("Training episode did not produce isolated delayed traces after activity faded");
    }

    const changedSynapses = brain.learnContrastiveReward(
      LEARNING_RATE, inputId, positiveId, negativeId
    );
    const after = brain.snapshot();
    const positiveAfter = edgeFor(after, inputId, positiveId);
    const negativeAfter = edgeFor(after, inputId, negativeId);
    const traceConsumed = after.synapses.every(edge => edge.eligibility <= EPSILON);

    return {
      inputFeature: FEATURES[featureIndex],
      presentedInputFeatures: [FEATURES[featureIndex]],
      positiveOutput: OUTPUTS[positiveOutputIndex],
      negativeOutput: OUTPUTS[negativeOutputIndex],
      positiveEligibility: positiveBefore.eligibility,
      negativeEligibility: negativeBefore.eligibility,
      activeNeuronsBeforeReward,
      unrelatedTracesClear,
      changedSynapses,
      positiveWeightBefore: positiveBefore.weight,
      positiveWeightAfter: positiveAfter ? positiveAfter.weight : null,
      negativeWeightBefore: negativeBefore.weight,
      negativeWeightAfter: negativeAfter ? negativeAfter.weight : null,
      positiveStrengthened: Boolean(positiveAfter && positiveAfter.weight > positiveBefore.weight),
      negativeWeakened: Boolean(negativeAfter && negativeAfter.weight < negativeBefore.weight),
      traceConsumed
    };
  }

  function trainMapping(fixture, mapping, reverseOrder = false) {
    const featureOrder = FEATURES.map((_feature, index) => index);
    if (reverseOrder) featureOrder.reverse();
    const episodes = [];

    for (const featureIndex of featureOrder) {
      const positiveOutputIndex = mapping[featureIndex];
      const competitors = OUTPUTS.map((_output, index) => index)
        .filter(index => index !== positiveOutputIndex);
      if (reverseOrder) competitors.reverse();

      for (const negativeOutputIndex of competitors) {
        episodes.push(trainEpisode(
          fixture, featureIndex, positiveOutputIndex, negativeOutputIndex
        ));
      }
    }
    return episodes;
  }

  function snapshotWeights(brain) {
    return brain.snapshot().synapses.map(edge => ({
      from: edge.from,
      to: edge.to,
      weight: edge.weight
    }));
  }

  function weightsEqual(left, right) {
    return left.length === right.length && left.every((edge, index) =>
      edge.from === right[index].from &&
      edge.to === right[index].to &&
      Math.abs(edge.weight - right[index].weight) <= EPSILON
    );
  }

  function evaluateOne(brain, fixture, featureIndices, mapping, stimulationOrder) {
    settle(brain);
    for (const featureIndex of stimulationOrder) {
      if (!brain.stimulate(fixture.inputIds[featureIndex], 1)) {
        throw new Error("Could not stimulate held-out feature " + FEATURES[featureIndex]);
      }
    }
    // All feature IDs are stimulated before one synchronous core step.
    brain.step(TRAINING_DELTA_SECONDS, 0);
    const snapshot = brain.snapshot();
    const responses = fixture.outputIds.map(outputId =>
      snapshot.neurons.find(neuron => neuron.id === outputId)?.activation ?? NaN);
    const expectedOutputIndices = featureIndices.map(index => mapping[index]);
    const unexpectedOutputIndices = OUTPUTS.map((_output, index) => index)
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
      stimulationOrder: stimulationOrder.map(index => FEATURES[index]),
      expectedOutputs: expectedOutputIndices.map(index => OUTPUTS[index]),
      responses: Object.fromEntries(OUTPUTS.map((output, index) => [output, responses[index]])),
      minExpectedActivation,
      maxUnexpectedActivation,
      passed
    };
  }

  function evaluatePattern(brain, fixture, featureIndices, mapping, exhaustiveOrder) {
    const orders = exhaustiveOrder ? permutations(featureIndices) : [featureIndices.slice()];
    const rows = orders.map(order =>
      evaluateOne(brain, fixture, featureIndices, mapping, order));
    const expectedOutputIndices = featureIndices.map(index => mapping[index]);
    const orderSpread = expectedOutputIndices.map(outputIndex => {
      const values = rows.map(row => row.responses[OUTPUTS[outputIndex]]);
      return Math.max(...values) - Math.min(...values);
    });
    return {
      features: featureIndices.map(index => FEATURES[index]),
      expectedOutputs: expectedOutputIndices.map(index => OUTPUTS[index]),
      permutationCount: rows.length,
      minExpectedActivation: Math.min(...rows.map(row => row.minExpectedActivation)),
      maxUnexpectedActivation: Math.max(...rows.map(row => row.maxUnexpectedActivation)),
      maxOrderSpread: Math.max(...orderSpread),
      passed: rows.every(row => row.passed)
    };
  }

  function evaluatePatterns(brain, fixture, patterns, mapping, exhaustiveOrder) {
    const rows = patterns.map(pattern =>
      evaluatePattern(brain, fixture, pattern, mapping, exhaustiveOrder));
    return {
      combinationCount: rows.length,
      permutationCount: rows.reduce((sum, row) => sum + row.permutationCount, 0),
      minExpectedActivation: Math.min(...rows.map(row => row.minExpectedActivation)),
      maxUnexpectedActivation: Math.max(...rows.map(row => row.maxUnexpectedActivation)),
      maxOrderSpread: Math.max(...rows.map(row => row.maxOrderSpread)),
      patterns: rows,
      passed: rows.every(row => row.passed)
    };
  }

  function allWeightsBounded(brain) {
    return brain.snapshot().synapses.every(edge =>
      Number.isFinite(edge.weight) && edge.weight >= 0 && edge.weight <= 1);
  }

  function runTrainedScenario(runtime, reverseOrder, heldOut) {
    const fixture = createFixture(runtime);
    const { brain } = fixture;
    try {
      const episodes = trainMapping(fixture, CANONICAL_MAPPING, reverseOrder);
      const weightsBeforeInference = snapshotWeights(brain);
      const heldOutResults = evaluatePatterns(
        brain, fixture, heldOut, CANONICAL_MAPPING, true
      );
      const primitiveResults = evaluatePatterns(
        brain, fixture, FEATURES.map((_feature, index) => [index]),
        CANONICAL_MAPPING, false
      );
      const weightsAfterInference = snapshotWeights(brain);
      const trainingOnlySingletons = episodes.length === FEATURES.length * (OUTPUTS.length - 1) &&
        episodes.every(episode => episode.presentedInputFeatures.length === 1);
      const allTrainingEpisodesValid = episodes.every(episode =>
        episode.positiveEligibility > EPSILON &&
        episode.negativeEligibility > EPSILON &&
        episode.activeNeuronsBeforeReward === 0 &&
        episode.unrelatedTracesClear &&
        episode.changedSynapses === 2 &&
        episode.positiveStrengthened &&
        episode.negativeWeakened &&
        episode.traceConsumed
      );
      const weightsUnchangedDuringInference = weightsEqual(
        weightsBeforeInference, weightsAfterInference
      );
      const stimulationOrderInvariant = heldOutResults.maxOrderSpread <= EPSILON;
      const checks = {
        trainingUsesOnlySingletonFeatures: trainingOnlySingletons,
        delayedPositiveAndNegativeUpdatesPass: allTrainingEpisodesValid,
        everyHeldOutCombinationPasses: heldOutResults.passed,
        everyPrimitiveAssociationIsRetained: primitiveResults.passed,
        inferenceDoesNotChangeWeights: weightsUnchangedDuringInference,
        stimulationOrderDoesNotChangeResponses: stimulationOrderInvariant,
        allWeightsRemainFiniteAndBounded: allWeightsBounded(brain)
      };

      return {
        order: reverseOrder ? "D→C→B→A" : "A→B→C→D",
        network: {
          inputFeatures: FEATURES.length,
          outputNeurons: OUTPUTS.length,
          neurons: brain.neuronCount,
          synapses: brain.synapseCount
        },
        training: {
          uniqueInputPatterns: FEATURES.length,
          episodes: episodes.length,
          onlySingletonInputs: trainingOnlySingletons,
          allEpisodesValid: allTrainingEpisodesValid,
          episodesDetail: episodes
        },
        heldOut: heldOutResults,
        primitiveRetention: primitiveResults,
        weightsUnchangedDuringInference,
        stimulationOrderInvariant,
        checks,
        passed: Object.values(checks).every(Boolean)
      };
    } finally {
      brain.dispose();
    }
  }

  function runUntrainedControl(runtime, heldOut) {
    const fixture = createFixture(runtime);
    const { brain } = fixture;
    try {
      const results = evaluatePatterns(
        brain, fixture, heldOut, CANONICAL_MAPPING, true
      );
      const maxOutputActivation = Math.max(...results.patterns.map(pattern =>
        Math.max(pattern.minExpectedActivation, pattern.maxUnexpectedActivation)));
      const allOutputsBelowCutoff = maxOutputActivation <= NON_TARGET_MAX_ACTIVATION;
      const noExpectedOutputReachesTarget = results.patterns.every(pattern =>
        pattern.minExpectedActivation < TARGET_MIN_ACTIVATION);
      return {
        network: { neurons: brain.neuronCount, synapses: brain.synapseCount },
        evaluatedCombinations: results.combinationCount,
        evaluatedPermutations: results.permutationCount,
        maxOutputActivation,
        allOutputsBelowCutoff,
        noExpectedOutputReachesTarget,
        passedAsExpected: allOutputsBelowCutoff && noExpectedOutputReachesTarget
      };
    } finally {
      brain.dispose();
    }
  }

  function runPermutedControl(runtime, heldOut) {
    const fixture = createFixture(runtime);
    const { brain } = fixture;
    try {
      const episodes = trainMapping(fixture, PERMUTED_MAPPING, false);
      const results = evaluatePatterns(
        brain, fixture, heldOut, PERMUTED_MAPPING, false
      );
      const differsFromCanonicalMapping = results.patterns.every(pattern => {
        const canonical = pattern.features.map(feature => FEATURES.indexOf(feature)).sort();
        const permuted = pattern.expectedOutputs.map(output => OUTPUTS.indexOf(output)).sort();
        return canonical.length !== permuted.length ||
          canonical.some((value, index) => value !== permuted[index]);
      });
      const followsPermutedMapping = results.passed;
      return {
        mapping: Object.fromEntries(FEATURES.map((feature, index) => [
          feature, OUTPUTS[PERMUTED_MAPPING[index]]
        ])),
        trainingEpisodes: episodes.length,
        heldOut: results,
        followsPermutedMapping,
        differsFromCanonicalMapping,
        passed: followsPermutedMapping && differsFromCanonicalMapping
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

    const heldOut = heldOutPatterns();
    const forward = runTrainedScenario(runtime, false, heldOut);
    const reverse = runTrainedScenario(runtime, true, heldOut);
    const untrained = runUntrainedControl(runtime, heldOut);
    const permuted = runPermutedControl(runtime, heldOut);
    const checks = {
      forwardTrainingOrderPasses: forward.passed,
      reverseTrainingOrderPasses: reverse.passed,
      untrainedControlDoesNotPass: untrained.passedAsExpected,
      permutationControlFollowsItsLearnedMapping: permuted.passed,
      allHeldOutPatternsWereExcludedFromTraining:
        heldOut.length === 11 &&
        forward.training.episodesDetail.every(episode => episode.presentedInputFeatures.length === 1) &&
        reverse.training.episodesDetail.every(episode => episode.presentedInputFeatures.length === 1)
    };

    return {
      kind: "four-feature zero-shot feature-route superposition benchmark",
      protocol: {
        determinism: "No RNG; fixed mappings, fixed forward/reverse training orders, lexicographic combinations and exhaustive stimulation permutations",
        seed: null,
        trainingPatterns: FEATURES.map(feature => [feature]),
        heldOutPatterns: heldOut.map(pattern => pattern.map(index => FEATURES[index])),
        trainingEpisodesPerScenario: FEATURES.length * (OUTPUTS.length - 1),
        heldOutCombinationCount: heldOut.length,
        heldOutPermutationCountPerScenario:
          heldOut.reduce((sum, pattern) => sum + permutations(pattern).length, 0),
        criteria: {
          targetMinActivation: TARGET_MIN_ACTIVATION,
          nonTargetMaxActivation: NON_TARGET_MAX_ACTIVATION,
          maximumStimulationOrderSpread: EPSILON
        }
      },
      network: {
        inputFeatures: FEATURES.length,
        outputNeurons: OUTPUTS.length,
        neurons: FEATURES.length + OUTPUTS.length,
        synapses: FEATURES.length * OUTPUTS.length,
        initialWeight: INITIAL_WEIGHT,
        learningRate: LEARNING_RATE,
        fadeStepsAfterCoactivation: FADE_STEPS,
        eligibilityRetention: ELIGIBILITY_RETENTION
      },
      forward,
      reverse,
      controls: {
        untrainedBaseline: untrained,
        permutedMapping: permuted
      },
      checks,
      passed: Object.values(checks).every(Boolean)
    };
  }

  root.NGCompositionalBenchmark = Object.freeze({ run });
})();
