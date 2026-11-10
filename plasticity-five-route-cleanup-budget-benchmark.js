(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([71, 83, 97, 109, 127]);
  const BUDGETS = Object.freeze([32, 36, 40, 44, 48, 56]);
  const PROFILES = Object.freeze([
    Object.freeze({ id: "equal-medium", boostEpisodes: Object.freeze([2, 2, 2, 2, 2]) }),
    Object.freeze({ id: "ascending", boostEpisodes: Object.freeze([1, 2, 3, 4, 5]) }),
    Object.freeze({ id: "descending", boostEpisodes: Object.freeze([5, 4, 3, 2, 1]) })
  ]);
  const ORDER_VARIANTS = Object.freeze([
    Object.freeze({
      id: "safe-ABCDE-CDE-AB",
      compositionTaskOrder: Object.freeze(["ABCDE-dense-union", "CDE-union", "AB-union"]),
      initialReverse: false, compositionReverse: false, replayReverse: false, freshReverse: false
    }),
    Object.freeze({
      id: "control-AB-CDE-ABCDE",
      compositionTaskOrder: Object.freeze(["AB-union", "CDE-union", "ABCDE-dense-union"]),
      initialReverse: false, compositionReverse: false, replayReverse: false, freshReverse: false
    })
  ]);

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The plasticity headroom benchmark must load before cleanup-budget testing");
    }

    const batches = [];
    const scenarios = [];
    for (const profile of PROFILES) {
      for (const budget of BUDGETS) {
        const mode = {
          id: "five-route-budget-" + profile.id + "-" + budget,
          updateRule: "bounded",
          positiveRate: 0.02,
          negativeRate: 1.0,
          replaySweeps: 1,
          selectiveCleanupBudget: budget,
          selectiveCleanupNegativeRate: 1.0
        };
        const report = benchmark.run({
          runtime,
          modes: [mode],
          seeds: SEEDS.slice(),
          orderVariants: ORDER_VARIANTS.map(row => ({
            ...row, compositionTaskOrder: row.compositionTaskOrder.slice()
          })),
          targetModeId: mode.id,
          scenarioOptions: {
            dimensions: { featureCount: 5, outputCount: 6, maxCleanupBudget: 60 },
            seedCompetingRoutes: {
              featureIndices: [0, 1, 2, 3, 4],
              boostEpisodes: profile.boostEpisodes.slice(),
              positiveRate: 1.0
            },
            captureLearningStages: false
          }
        });
        if (report.scenarios.length !== SEEDS.length * ORDER_VARIANTS.length ||
            report.createdBrains !== SEEDS.length * ORDER_VARIANTS.length ||
            !report.checks.allScenariosCompleted) {
          throw new Error("A cleanup-budget batch did not complete its expected isolated scenarios");
        }
        batches.push({ profile: profile.id, budget, report });
        for (const scenario of report.scenarios) {
          scenarios.push({
            profile: profile.id,
            boostEpisodesPerRoute: profile.boostEpisodes.slice(),
            budget,
            seed: scenario.seed,
            orderVariant: scenario.trainingOrder,
            compositionTaskOrder: scenario.orderControls.compositionTaskOrder,
            seededRouteCount: scenario.stressSeed.evidence.routeCount,
            allSeededRoutesContribute: scenario.stressSeed.evidence.routeCount === 5 &&
              scenario.stressSeed.evidence.routes.every(route => route.contributes),
            cleanup: {
              budget: scenario.cleanup.budget,
              used: scenario.cleanup.used,
              finalPassed: scenario.cleanup.final.passed,
              finalMaxUnexpected: scenario.cleanup.final.maxUnexpected,
              episodes: scenario.cleanup.episodes
            },
            retained: {
              minExpected: scenario.retained.minExpected,
              maxUnexpected: scenario.retained.maxUnexpected
            },
            retentionPassed: scenario.retentionPassed,
            headroomPassed: scenario.headroomPassed,
            freshAssociation: {
              passed: scenario.freshAssociation.passed,
              targetActivation: scenario.freshAssociation.targetActivation,
              maxUnexpectedActivation: scenario.freshAssociation.maxUnexpectedActivation
            },
            oldAfterFresh: {
              passed: scenario.oldAfterFresh.passed,
              minExpected: scenario.oldAfterFresh.minExpected,
              maxUnexpected: scenario.oldAfterFresh.maxUnexpected
            },
            allWeightsBoundedAfterFresh: scenario.allWeightsBoundedAfterFresh,
            maxCorrectWeight: scenario.weights.maxCorrectWeight,
            passed: scenario.passed
          });
        }
      }
    }

    const expectedCount = PROFILES.length * BUDGETS.length * SEEDS.length * ORDER_VARIANTS.length;
    const checks = {
      allProfileBudgetSeedOrderScenariosCompleted: scenarios.length === expectedCount,
      everyBudgetHasBothOrdersForEveryProfileAndSeed: BUDGETS.every(budget =>
        PROFILES.every(profile => SEEDS.every(seed =>
          ORDER_VARIANTS.every(order => scenarios.some(row =>
            row.budget === budget && row.profile === profile.id &&
            row.seed === seed && row.orderVariant === order.id))))),
      allFiveSeededRoutesContribute: scenarios.every(row =>
        row.seededRouteCount === 5 && row.allSeededRoutesContribute),
      cleanupNeverExceedsDeclaredBudget: scenarios.every(row =>
        row.cleanup.budget === row.budget && row.cleanup.used <= row.budget),
      everyCleanupEpisodeChangesOneEdgeAndConsumesTrace: scenarios.every(row =>
        row.cleanup.episodes.every(step => step.changedEdges === 1 &&
          step.tracesConsumed && step.weightDelta < 0)),
      everyWeightRemainsFiniteAndBounded: scenarios.every(row =>
        row.allWeightsBoundedAfterFresh && Number.isFinite(row.maxCorrectWeight) &&
        row.maxCorrectWeight <= 1),
      everyFreshAssociationIsMeasured: scenarios.every(row =>
        Number.isFinite(row.freshAssociation.targetActivation) &&
        Number.isFinite(row.freshAssociation.maxUnexpectedActivation)),
      allDisposableBrainsReleased: batches.every(batch =>
        batch.report.createdBrains === SEEDS.length * ORDER_VARIANTS.length)
    };

    function summarize(rows) {
      const mean = values => values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return {
        scenarioCount: rows.length,
        fullAcceptancePasses: rows.filter(row => row.passed).length,
        cleanupFinalPasses: rows.filter(row => row.cleanup.finalPassed).length,
        retentionPasses: rows.filter(row => row.retentionPassed).length,
        headroomPasses: rows.filter(row => row.headroomPassed).length,
        freshAssociationPasses: rows.filter(row => row.freshAssociation.passed).length,
        oldAfterFreshPasses: rows.filter(row => row.oldAfterFresh.passed).length,
        meanCleanupEpisodes: mean(rows.map(row => row.cleanup.used)),
        maximumCleanupUsed: Math.max(0, ...rows.map(row => row.cleanup.used)),
        maximumResidualActivation: Math.max(0, ...rows.map(row =>
          Math.max(row.retained.maxUnexpected, row.oldAfterFresh.maxUnexpected)))
      };
    }

    const byBudgetAndOrder = BUDGETS.flatMap(budget =>
      ORDER_VARIANTS.map(order => {
        const rows = scenarios.filter(row => row.budget === budget && row.orderVariant === order.id);
        return {
          budget,
          order: order.id,
          compositionTaskOrder: order.compositionTaskOrder.slice(),
          ...summarize(rows),
          byProfile: PROFILES.map(profile => ({
            profile: profile.id,
            ...summarize(rows.filter(row => row.profile === profile.id))
          }))
        };
      })
    );
    const protocolPassed = Object.values(checks).every(Boolean);
    return {
      kind: "NEUROGENESIS five-route cleanup-budget comparison v1",
      version: 1,
      passed: protocolPassed,
      protocolPassed,
      protocol: {
        seeds: SEEDS.slice(),
        budgets: BUDGETS.slice(),
        profiles: PROFILES.map(profile => ({
          id: profile.id, boostEpisodesPerRoute: profile.boostEpisodes.slice()
        })),
        orderVariantCount: ORDER_VARIANTS.length,
        orderVariants: ORDER_VARIANTS.map(order => ({
          id: order.id, compositionTaskOrder: order.compositionTaskOrder.slice()
        })),
        featureCount: 5,
        outputCount: 6,
        scenarioCount: expectedCount,
        initialMappingOrder: "fixed forward",
        replayTraversalOrder: "fixed forward",
        freshAssociationOrder: "fixed forward",
        cleanupLearningRuleChanged: false,
        productionNetworkModified: false,
        userSavesModified: false
      },
      checks,
      summary: {
        scenarioCount: scenarios.length,
        fullAcceptancePasses: scenarios.filter(row => row.passed).length,
        byBudgetAndOrder
      },
      byBudgetAndOrder,
      scenarios
    };
  }

  root.NGPlasticityFiveRouteCleanupBudget = Object.freeze({
    version: 1, run, seeds: SEEDS, budgets: BUDGETS,
    profiles: PROFILES, orderVariants: ORDER_VARIANTS
  });
})();