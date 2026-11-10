(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;
  const INPUT_ID = "credit-input";
  const GOOD_HIDDEN_ID = "credit-good-hidden";
  const BAD_HIDDEN_ID = "credit-bad-hidden";
  const GOOD_OUTPUT_ID = "credit-good-output";
  const BAD_OUTPUT_ID = "credit-bad-output";
  const INITIAL_WEIGHT = 0.65;
  const STIMULUS = 1;
  const STEP_COUNT = 8;
  const DELTA_SECONDS = 0.1;
  const RETENTION = 0.9;

  function makeFixture() {
    return {
      neurons: [
        { id: INPUT_ID, name: "Вход", type: "sensory", x: 0, y: 0, bias: 1, activity: 0 },
        { id: GOOD_HIDDEN_ID, name: "Скрытый узел A", type: "logic", x: 1, y: -1, bias: 1, activity: 0 },
        { id: BAD_HIDDEN_ID, name: "Скрытый узел B", type: "memory", x: 1, y: 1, bias: 1, activity: 0 },
        { id: GOOD_OUTPUT_ID, name: "Целевой выход", type: "output", x: 2, y: -1, bias: 1, activity: 0 },
        { id: BAD_OUTPUT_ID, name: "Конкурирующий выход", type: "output", x: 2, y: 1, bias: 1, activity: 0 }
      ],
      synapses: [
        { from: INPUT_ID, to: GOOD_HIDDEN_ID, weight: INITIAL_WEIGHT, eligibility: 0 },
        { from: GOOD_HIDDEN_ID, to: GOOD_OUTPUT_ID, weight: INITIAL_WEIGHT, eligibility: 0 },
        { from: INPUT_ID, to: BAD_HIDDEN_ID, weight: INITIAL_WEIGHT, eligibility: 0 },
        { from: BAD_HIDDEN_ID, to: BAD_OUTPUT_ID, weight: INITIAL_WEIGHT, eligibility: 0 }
      ]
    };
  }

  function findEdge(snapshot, from, to) {
    return (snapshot.synapses || []).find(edge =>
      edge && String(edge.from) === String(from) && String(edge.to) === String(to)
    ) || null;
  }

  function findNeuron(snapshot, id) {
    return (snapshot.neurons || []).find(neuron =>
      neuron && String(neuron.id) === String(id)
    ) || null;
  }

  function trackedRuntime(runtime, counters) {
    if (!runtime || typeof runtime.createBrainFromSnapshot !== "function") {
      throw new TypeError("A NEUROGENESIS WASM runtime with createBrainFromSnapshot() is required");
    }
    return {
      createBrainFromSnapshot(snapshot) {
        const brain = runtime.createBrainFromSnapshot(snapshot);
        counters.created++;
        counters.active++;
        let disposed = false;
        return new Proxy({}, {
          get(_target, property) {
            if (property === "dispose") {
              return () => {
                if (disposed) return;
                disposed = true;
                counters.disposed++;
                counters.active--;
                brain.dispose();
              };
            }
            const value = Reflect.get(brain, property, brain);
            return typeof value === "function" ? value.bind(brain) : value;
          }
        });
      }
    };
  }

  function prepareCandidate(runtime) {
    const brain = runtime.createBrainFromSnapshot(makeFixture());
    try {
      if (!brain.stimulate(INPUT_ID, STIMULUS)) {
        throw new Error("Could not stimulate the shared input neuron");
      }
      for (let step = 0; step < STEP_COUNT; step++) {
        brain.step(DELTA_SECONDS, RETENTION);
      }

      const snapshot = brain.snapshot();
      const goodHidden = findNeuron(snapshot, GOOD_HIDDEN_ID);
      const badHidden = findNeuron(snapshot, BAD_HIDDEN_ID);
      const goodOutput = findNeuron(snapshot, GOOD_OUTPUT_ID);
      const badOutput = findNeuron(snapshot, BAD_OUTPUT_ID);
      const routes = [
        {
          label: "target",
          nodes: [INPUT_ID, GOOD_HIDDEN_ID, GOOD_OUTPUT_ID],
          edges: [
            findEdge(snapshot, INPUT_ID, GOOD_HIDDEN_ID),
            findEdge(snapshot, GOOD_HIDDEN_ID, GOOD_OUTPUT_ID)
          ],
          outputActivation: Number(goodOutput && (goodOutput.activation ?? goodOutput.activity))
        },
        {
          label: "competing",
          nodes: [INPUT_ID, BAD_HIDDEN_ID, BAD_OUTPUT_ID],
          edges: [
            findEdge(snapshot, INPUT_ID, BAD_HIDDEN_ID),
            findEdge(snapshot, BAD_HIDDEN_ID, BAD_OUTPUT_ID)
          ],
          outputActivation: Number(badOutput && (badOutput.activation ?? badOutput.activity))
        }
      ];

      const valid = !!goodHidden && !!badHidden && !!goodOutput && !!badOutput &&
        routes.every(route => route.edges.every(edge =>
          edge && Number.isFinite(Number(edge.eligibility)) &&
          Number(edge.eligibility) > EPSILON
        )) &&
        routes.every(route => Number.isFinite(route.outputActivation) &&
          route.outputActivation > 0.05);

      if (!valid) {
        throw new Error("The fixture did not activate both hidden routes and accumulate all four eligibility traces");
      }

      return {
        brain,
        routes: routes.map(route => ({
          label: route.label,
          nodes: route.nodes.slice(),
          outputActivation: route.outputActivation,
          edges: route.edges.map(edge => ({
            from: String(edge.from),
            to: String(edge.to),
            weight: Number(edge.weight),
            eligibility: Number(edge.eligibility)
          }))
        }))
      };
    } catch (error) {
      brain.dispose();
      throw error;
    }
  }

  function summarizeWeights(before, after) {
    return before.synapses.map(edge => {
      const current = findEdge(after, edge.from, edge.to);
      return {
        from: String(edge.from),
        to: String(edge.to),
        before: Number(edge.weight),
        after: current ? Number(current.weight) : null,
        delta: current ? Number(current.weight) - Number(edge.weight) : null
      };
    });
  }

  function runDirectContrastive(runtime) {
    const prepared = prepareCandidate(runtime);
    const brain = prepared.brain;
    try {
      const before = brain.snapshot();
      const updates = brain.learnContrastiveRewardAsymmetric(
        0.02, 1.0, INPUT_ID, GOOD_OUTPUT_ID, BAD_OUTPUT_ID
      );
      const after = brain.snapshot();
      const weights = summarizeWeights(before, after);
      return {
        returnedUpdates: updates,
        changedEdges: weights.filter(row => Math.abs(row.delta || 0) > EPSILON),
        weights,
        tracesConsumed: after.synapses.every(edge =>
          Number(edge.eligibility) <= EPSILON
        ),
        targetRoute: prepared.routes[0],
        competingRoute: prepared.routes[1]
      };
    } finally {
      brain.dispose();
    }
  }

  function runGlobalReward(runtime) {
    const prepared = prepareCandidate(runtime);
    const brain = prepared.brain;
    try {
      const before = brain.snapshot();
      const updates = brain.learnFromReward(0.08, 1.0, 0);
      const after = brain.snapshot();
      const weights = summarizeWeights(before, after);
      const targetKeys = new Set([
        JSON.stringify([INPUT_ID, GOOD_HIDDEN_ID]),
        JSON.stringify([GOOD_HIDDEN_ID, GOOD_OUTPUT_ID])
      ]);
      const competingKeys = new Set([
        JSON.stringify([INPUT_ID, BAD_HIDDEN_ID]),
        JSON.stringify([BAD_HIDDEN_ID, BAD_OUTPUT_ID])
      ]);
      const target = weights.filter(row =>
        targetKeys.has(JSON.stringify([row.from, row.to]))
      );
      const competing = weights.filter(row =>
        competingKeys.has(JSON.stringify([row.from, row.to]))
      );
      return {
        returnedUpdates: updates,
        weights,
        targetRoute: target,
        competingRoute: competing,
        targetRouteStrengthened: target.length === 2 &&
          target.every(row => Number(row.delta) > EPSILON),
        competingRouteAlsoStrengthened: competing.length === 2 &&
          competing.every(row => Number(row.delta) > EPSILON),
        tracesConsumed: after.synapses.every(edge =>
          Number(edge.eligibility) <= EPSILON
        )
      };
    } finally {
      brain.dispose();
    }
  }

  async function run(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    const counters = { created: 0, disposed: 0, active: 0 };
    const runtime = trackedRuntime(settings.runtime, counters);
    const direct = runDirectContrastive(runtime);
    const global = runGlobalReward(runtime);
    const traceRoutes = [direct.targetRoute, direct.competingRoute];
    const checks = {
      targetHiddenRouteReceivesEligibility:
        traceRoutes[0]?.edges?.length === 2 &&
        traceRoutes[0].edges.every(edge => edge.eligibility > EPSILON),
      competingHiddenRouteReceivesEligibility:
        traceRoutes[1]?.edges?.length === 2 &&
        traceRoutes[1].edges.every(edge => edge.eligibility > EPSILON),
      bothOutputNeuronsActivate:
        traceRoutes.every(route => route.outputActivation > 0.05),
      directContrastiveRuleCannotFindMultiHopTargetEdges:
        direct.returnedUpdates === 0 && direct.changedEdges.length === 0,
      directContrastiveRuleStillConsumesTraces:
        direct.tracesConsumed === true,
      globalRewardStrengthensTargetRoute:
        global.targetRouteStrengthened === true,
      globalRewardAlsoStrengthensCompetingRoute:
        global.competingRouteAlsoStrengthened === true,
      globalRewardConsumesTraces:
        global.tracesConsumed === true,
      allWeightsRemainFiniteAndBounded:
        [...direct.weights, ...global.weights].every(row =>
          Number.isFinite(row.before) &&
          Number.isFinite(row.after) &&
          row.before >= 0 && row.before <= 1 &&
          row.after >= 0 && row.after <= 1
        ),
      allTemporaryBrainsDisposed:
        counters.created === 2 && counters.disposed === 2 && counters.active === 0
    };

    return {
      kind: "multi-hop hidden-route credit-assignment diagnostic",
      version: 1,
      fixture: {
        neurons: 5,
        synapses: 4,
        routeDepth: 2,
        initialWeight: INITIAL_WEIGHT,
        steps: STEP_COUNT,
        stimulus: STIMULUS,
        eligibilityRetention: RETENTION
      },
      routes: traceRoutes,
      directContrastive: direct,
      globalReward: global,
      counters: { ...counters },
      checks,
      passed: Object.values(checks).every(Boolean),
      interpretation: [
        "Pairwise eligibility traces accumulate on both links of both active hidden routes.",
        "The current asymmetric contrastive rule selects only direct input-to-output edges; this two-hop fixture has none.",
        "The generic reward rule updates every eligible edge, so it strengthens the target and competing routes together.",
        "This is a diagnostic of current WASM behavior, not a new learning rule and not a production-network change."
      ]
    };
  }

  root.NGMultiHopCreditDiagnostic = Object.freeze({ run });
})();
