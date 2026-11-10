(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([7, 17, 29, 43, 59]);
  const BUDGET = 56;
  const PROFILES = Object.freeze([
    Object.freeze({ id: "equal-medium", boostEpisodes: Object.freeze([2, 2, 2, 2, 2]) }),
    Object.freeze({ id: "ascending", boostEpisodes: Object.freeze([1, 2, 3, 4, 5]) }),
    Object.freeze({ id: "descending", boostEpisodes: Object.freeze([5, 4, 3, 2, 1]) })
  ]);
  const ORDER_VARIANTS = Object.freeze([
    { id: "AB-CDE-ABCDE", compositionTaskOrder: ["AB-union", "CDE-union", "ABCDE-dense-union"] },
    { id: "AB-ABCDE-CDE", compositionTaskOrder: ["AB-union", "ABCDE-dense-union", "CDE-union"] },
    { id: "CDE-AB-ABCDE", compositionTaskOrder: ["CDE-union", "AB-union", "ABCDE-dense-union"] },
    { id: "CDE-ABCDE-AB", compositionTaskOrder: ["CDE-union", "ABCDE-dense-union", "AB-union"] },
    { id: "ABCDE-AB-CDE", compositionTaskOrder: ["ABCDE-dense-union", "AB-union", "CDE-union"] },
    { id: "ABCDE-CDE-AB", compositionTaskOrder: ["ABCDE-dense-union", "CDE-union", "AB-union"] }
  ].map(row => Object.freeze({
    ...row, initialReverse: false, compositionReverse: false,
    replayReverse: false, freshReverse: false
  })));

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before composition-order testing");
    }
    const batches = [];
    for (const profile of PROFILES) {
      const mode = {
        id: "five-route-composition-order-" + profile.id,
        updateRule: "bounded", positiveRate: 0.02, negativeRate: 1.0,
        replaySweeps: 1, selectiveCleanupBudget: BUDGET,
        selectiveCleanupNegativeRate: 1.0
      };
      const report = benchmark.run({
        runtime, modes: [mode], seeds: SEEDS.slice(),
        orderVariants: ORDER_VARIANTS.map(row => ({
          ...row, compositionTaskOrder: row.compositionTaskOrder.slice()
        })),
        targetModeId: mode.id,
        scenarioOptions: {
          dimensions: { featureCount: 5, outputCount: 6, maxCleanupBudget: 60 },
          seedCompetingRoutes: {
            featureIndices: [0, 1, 2, 3, 4],
            boostEpisodes: profile.boostEpisodes.slice(), positiveRate: 1.0
          },
          captureLearningStages: true
        }
      });
      batches.push({
        profile: profile.id, boostEpisodesPerRoute: profile.boostEpisodes.slice(), report
      });
    }
    const scenarios = batches.flatMap(batch => batch.report.scenarios.map(scenario => ({
      profile: batch.profile, boostEpisodesPerRoute: batch.boostEpisodesPerRoute,
      seed: scenario.seed, orderVariant: scenario.trainingOrder,
      compositionTaskOrder: scenario.orderControls.compositionTaskOrder,
      cleanup: scenario.cleanup, retained: scenario.retained,
      retentionPassed: scenario.retentionPassed, headroomPassed: scenario.headroomPassed,
      freshAssociation: scenario.freshAssociation, oldAfterFresh: scenario.oldAfterFresh,
      learningStages: scenario.learningStages, passed: scenario.passed,
      episodes: scenario.episodes
    }))));
    const expectedCount = PROFILES.length * SEEDS.length * ORDER_VARIANTS.length;
    const checks = {
      allScenariosCompleted: scenarios.length === expectedCount,
      everySequenceCoveredForEveryProfileAndSeed: ORDER_VARIANTS.every(order =>
        PROFILES.every(profile => SEEDS.every(seed =>
          scenarios.some(row => row.orderVariant === order.id &&
            row.profile === profile.id && row.seed === seed)))),
      everySequenceIsExactThreeTaskPermutation: scenarios.every(row =>
        row.compositionTaskOrder.length === 3 &&
        new Set(row.compositionTaskOrder).size === 3 &&
        row.compositionTaskOrder.every(id =>
          ["AB-union", "CDE-union", "ABCDE-dense-union"].includes(id))),
      everyScenarioHasAll18DiagnosticCheckpoints: scenarios.every(row =>
        row.learningStages.length === 18 &&
        row.learningStages.every(stage => stage.patternCount === 5)),
      allDisposableBrainsReleased: batches.every(batch =>
        batch.report.createdBrains === SEEDS.length * ORDER_VARIANTS.length)
    };
    const sequenceSummary = ORDER_VARIANTS.map(order => {
      const rows = scenarios.filter(row => row.orderVariant === order.id);
      const firstFailures = rows.flatMap(row => {
        const first = row.learningStages.find(stage => stage.failures.length);
        return first ? [{
          profile: row.profile, seed: row.seed, cycle: first.cycle,
          taskId: first.taskId, stage: first.stage,
          failingPatterns: first.failures.length,
          maxUnexpectedActivation: Math.max(...first.failures.map(f => f.activation))
        }] : [];
      });
      const byProfile = PROFILES.map(profile => {
        const selected = rows.filter(row => row.profile === profile.id);
        return {
          profile: profile.id, scenarios: selected.length,
          fullAcceptance: selected.filter(row => row.passed).length,
          retention: selected.filter(row => row.retentionPassed).length,
          oldAfterFresh: selected.filter(row => row.oldAfterFresh.passed).length,
          meanCleanupEvents: selected.reduce((sum, row) => sum + row.cleanup.used, 0) /
            Math.max(1, selected.length),
          maximumResidualActivation: Math.max(0, ...selected.map(row => row.retained.maxUnexpected))
        };
      });
      return {
        id: order.id, compositionTaskOrder: order.compositionTaskOrder,
        scenarios: rows.length, fullAcceptance: rows.filter(row => row.passed).length,
        retention: rows.filter(row => row.retentionPassed).length,
        oldAfterFresh: rows.filter(row => row.oldAfterFresh.passed).length,
        meanCleanupEvents: rows.reduce((sum, row) => sum + row.cleanup.used, 0) /
          Math.max(1, rows.length),
        firstFailureCount: firstFailures.length, firstFailures, byProfile
      };
    });
    const passed = Object.values(checks).every(Boolean);
    return {
      kind: "NEUROGENESIS five-route composition-order benchmark v1",
      version: 1, passed, protocolPassed: passed,
      protocol: {
        seeds: SEEDS.slice(),
        profiles: PROFILES.map(row => ({
          id: row.id, boostEpisodesPerRoute: row.boostEpisodes.slice()
        })),
        featureCount: 5, outputCount: 6, cleanupBudget: BUDGET,
        compositionTaskPermutationCount: 6, scenarios: expectedCount,
        initialMappingOrder: "fixed forward", replayTraversalOrder: "fixed forward",
        freshAssociationOrder: "fixed forward", checkpointsPerScenario: 18,
        productionNetworkModified: false, userSavesModified: false
      },
      checks,
      summary: {
        scenarios: scenarios.length,
        fullAcceptance: scenarios.filter(row => row.passed).length,
        sequenceSummary
      },
      sequenceSummary, scenarios
    };
  }
  root.NGPlasticityFiveRouteCompositionOrder = Object.freeze({
    version: 1, run, seeds: SEEDS, budget: BUDGET,
    profiles: PROFILES, orderVariants: ORDER_VARIANTS
  });
})();