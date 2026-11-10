(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([7, 17, 29, 43, 59]);
  const BUDGETS = Object.freeze([28, 32, 36]);
  const PROFILES = Object.freeze([
    Object.freeze({ id: "equal-medium", boostEpisodes: Object.freeze([2, 2, 2, 2]) }),
    Object.freeze({ id: "ascending", boostEpisodes: Object.freeze([1, 2, 3, 4]) }),
    Object.freeze({ id: "descending", boostEpisodes: Object.freeze([4, 3, 2, 1]) })
  ]);
  const FEATURE_INDICES = Object.freeze([0, 1, 2, 3]);

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before four-route depth testing");
    }

    const batches = [];
    for (const profile of PROFILES) {
      for (const budget of BUDGETS) {
        const mode = {
          id: "four-route-profile-" + profile.id + "-budget-" + budget,
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
          targetModeId: mode.id,
          scenarioOptions: {
            seedCompetingRoutes: {
              featureIndices: FEATURE_INDICES.slice(),
              boostEpisodes: profile.boostEpisodes.slice(),
              positiveRate: 1.0
            }
          }
        });
        batches.push({
          profile: { id: profile.id, boostEpisodes: profile.boostEpisodes.slice() },
          budget,
          report
        });
      }
    }

    const scenarios = batches.flatMap(batch => batch.report.scenarios.map(scenario => ({
      profile: batch.profile.id,
      boostEpisodesPerRoute: batch.profile.boostEpisodes,
      budget: batch.budget,
      seed: scenario.seed,
      trainingOrder: scenario.trainingOrder,
      mapping: scenario.mapping,
      stressSeed: scenario.stressSeed,
      stressAfterCleanup: scenario.stressAfterCleanup,
      cleanup: scenario.cleanup,
      retained: scenario.retained,
      weights: scenario.weights,
      retentionPassed: scenario.retentionPassed,
      headroomPassed: scenario.headroomPassed,
      freshAssociation: scenario.freshAssociation,
      oldAfterFresh: scenario.oldAfterFresh,
      allWeightsBoundedAfterFresh: scenario.allWeightsBoundedAfterFresh,
      passed: scenario.passed,
      episodes: scenario.episodes,
      timingMs: scenario.timingMs
    })));

    const expectedCount = PROFILES.length * BUDGETS.length * SEEDS.length * 2;
    const checks = {
      allProfileBudgetSeedOrderScenariosCompleted: scenarios.length === expectedCount,
      everyProfileBudgetHasBothOrdersForEverySeed: PROFILES.every(profile =>
        BUDGETS.every(budget => SEEDS.every(seed =>
          scenarios.some(row => row.profile === profile.id && row.budget === budget &&
            row.seed === seed && row.trainingOrder === "forward") &&
          scenarios.some(row => row.profile === profile.id && row.budget === budget &&
            row.seed === seed && row.trainingOrder === "reverse")))),
      everyScenarioBeginsWithFourDistinctRoutes: scenarios.every(row =>
        row.stressSeed && row.stressSeed.routes.length === 4 &&
        new Set(row.stressSeed.routes.map(route => route.featureIndex)).size === 4),
      allFourRoutesHavePositiveMeasuredContribution: scenarios.every(row =>
        row.stressSeed.evidence.routeCount === 4 &&
        row.stressSeed.evidence.routes.every(route =>
          route.contributes && Number.isFinite(route.weight) && route.weight > 0)),
      allFalseOutputsAreNonTargetOutputs: scenarios.every(row =>
        row.stressSeed && !Object.values(row.mapping).includes(row.stressSeed.falseOutput)),
      cleanupRespectsDeclaredBudget: scenarios.every(row => row.cleanup.used <= row.budget),
      everyCorrectionChangesOneEdgeAndConsumesTraces: scenarios.every(row =>
        row.cleanup.episodes.every(step => step.changedEdges === 1 &&
          step.tracesConsumed && step.weightDelta < 0)),
      allWeightsRemainFiniteAndBounded: scenarios.every(row =>
        row.weights.allWeightsBounded && row.allWeightsBoundedAfterFresh),
      everyDisposableBrainWasCreated: batches.every(batch =>
        batch.report.createdBrains === SEEDS.length * 2)
    };

    const protocolPassed = Object.values(checks).every(Boolean);
    function summarize(rows) {
      const mean = values => values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return {
        scenarioCount: rows.length,
        fullAcceptancePasses: rows.filter(row => row.passed).length,
        retentionPasses: rows.filter(row => row.retentionPassed).length,
        headroomPasses: rows.filter(row => row.headroomPassed).length,
        freshAssociationPasses: rows.filter(row => row.freshAssociation.passed).length,
        oldAfterFreshPasses: rows.filter(row => row.oldAfterFresh.passed).length,
        falseOutputAboveThresholdAfterCleanup: rows.filter(row =>
          row.stressAfterCleanup.activation > 0.05).length,
        meanFinalFalseOutputActivation: mean(rows.map(row => row.stressAfterCleanup.activation)),
        maximumFinalFalseOutputActivation: Math.max(...rows.map(row => row.stressAfterCleanup.activation)),
        totalCleanupEpisodes: rows.reduce((sum, row) => sum + row.cleanup.used, 0),
        meanCleanupEpisodes: mean(rows.map(row => row.cleanup.used)),
        maximumCleanupUsed: Math.max(...rows.map(row => row.cleanup.used))
      };
    }

    const byBudget = BUDGETS.map(budget => ({
      budget,
      ...summarize(scenarios.filter(row => row.budget === budget))
    }));
    const byProfileAndBudget = PROFILES.flatMap(profile =>
      BUDGETS.map(budget => ({
        profile: profile.id,
        boostEpisodesPerRoute: profile.boostEpisodes.slice(),
        budget,
        ...summarize(scenarios.filter(row =>
          row.profile === profile.id && row.budget === budget))
      }))
    );

    return {
      kind: "NEUROGENESIS four-route cleanup-depth benchmark",
      version: 1,
      passed: protocolPassed,
      protocolPassed,
      candidate28PassedAllProfiles: PROFILES.every(profile =>
        scenarios.filter(row => row.profile === profile.id && row.budget === 28)
          .every(row => row.passed)),
      candidate32PassedAllProfiles: PROFILES.every(profile =>
        scenarios.filter(row => row.profile === profile.id && row.budget === 32)
          .every(row => row.passed)),
      candidate36PassedAllProfiles: PROFILES.every(profile =>
        scenarios.filter(row => row.profile === profile.id && row.budget === 36)
          .every(row => row.passed)),
      protocol: {
        seeds: SEEDS.slice(),
        taskOrders: ["forward", "reverse"],
        budgets: BUDGETS.slice(),
        profiles: PROFILES.map(profile => ({
          id: profile.id,
          boostEpisodesPerRoute: profile.boostEpisodes.slice()
        })),
        scenarioCount: expectedCount,
        featureIndices: FEATURE_INDICES.slice(),
        minimumCompetingRoutes: 4,
        stressPositiveRate: 1.0,
        replaySweeps: 1,
        replayPositiveRate: 0.02,
        replayNegativeRate: 1.0,
        cleanupPositiveRate: 0,
        cleanupNegativeRate: 1.0,
        targetMinActivation: 0.15,
        nonTargetMaxActivation: 0.05,
        maxCorrectWeightForHeadroom: 0.95,
        maxDiagnosticCleanupBudget: 36
      },
      checks,
      summary: {
        scenarioCount: scenarios.length,
        fullAcceptancePasses: scenarios.filter(row => row.passed).length,
        totalCleanupEpisodes: scenarios.reduce((sum, row) => sum + row.cleanup.used, 0),
        byBudget,
        byProfileAndBudget
      },
      byBudget,
      byProfileAndBudget,
      scenarios,
      timingMs: batches.reduce((sum, row) => sum + row.report.timingMs, 0)
    };
  }

  root.NGPlasticityFourRouteDepth = Object.freeze({
    version: 1,
    run,
    seeds: SEEDS,
    budgets: BUDGETS,
    profiles: PROFILES
  });
})();
