(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([7, 17, 29, 43, 59]);
  const PROFILES = Object.freeze([
    Object.freeze({ id: "equal-medium", boostEpisodes: Object.freeze([2, 2, 2]) }),
    Object.freeze({ id: "ascending", boostEpisodes: Object.freeze([1, 2, 3]) }),
    Object.freeze({ id: "descending", boostEpisodes: Object.freeze([3, 2, 1]) })
  ]);

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before three-route stress testing");
    }
    const mode = {
      id: "three-route-stress-fixed-cap-2",
      updateRule: "bounded",
      positiveRate: 0.02,
      negativeRate: 1.0,
      replaySweeps: 1,
      selectiveCleanupBudget: 2,
      selectiveCleanupNegativeRate: 1.0
    };
    const profiles = PROFILES.map(profile => {
      const report = benchmark.run({
        runtime,
        modes: [mode],
        seeds: SEEDS.slice(),
        targetModeId: mode.id,
        scenarioOptions: {
          seedCompetingRoutes: {
            featureIndices: [0, 1, 2],
            boostEpisodes: profile.boostEpisodes.slice(),
            positiveRate: 1.0
          }
        }
      });
      return {
        profile: { id: profile.id, boostEpisodes: profile.boostEpisodes.slice() },
        report
      };
    });
    const scenarios = profiles.flatMap(row => row.report.scenarios.map(scenario => ({
      profile: row.profile.id,
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
    const expectedScenarios = PROFILES.length * SEEDS.length * 2;
    const checks = {
      allProfileSeedOrderScenariosCompleted: scenarios.length === expectedScenarios,
      everyProfileHasBothOrdersForEverySeed: PROFILES.every(profile => SEEDS.every(seed =>
        scenarios.some(row => row.profile === profile.id && row.seed === seed && row.trainingOrder === "forward") &&
        scenarios.some(row => row.profile === profile.id && row.seed === seed && row.trainingOrder === "reverse"))),
      everyScenarioSeedsThreeDistinctRoutes: scenarios.every(row =>
        row.stressSeed && row.stressSeed.routes.length === 3 &&
        new Set(row.stressSeed.routes.map(route => route.featureIndex)).size === 3),
      allThreeRoutesHavePositiveMeasuredContribution: scenarios.every(row =>
        row.stressSeed.evidence.routeCount === 3 &&
        row.stressSeed.evidence.routes.every(route =>
          route.contributes && Number.isFinite(route.weight) && route.weight > 0)),
      allFalseOutputsAreNonTargetOutputs: scenarios.every(row =>
        row.stressSeed && !Object.values(row.mapping).includes(row.stressSeed.falseOutput)),
      cleanupNeverExceedsTwoEpisodes: scenarios.every(row => row.cleanup.used <= 2),
      everyCleanupCorrectionChangesOneEdgeAndConsumesTraces: scenarios.every(row =>
        row.cleanup.episodes.every(step => step.changedEdges === 1 &&
          step.tracesConsumed && step.weightDelta < 0)),
      allWeightsRemainFiniteAndBounded: scenarios.every(row =>
        row.weights.allWeightsBounded && row.allWeightsBoundedAfterFresh),
      everyDisposableBrainWasCreated: profiles.every(row =>
        row.report.createdBrains === SEEDS.length * 2)
    };
    const protocolPassed = Object.values(checks).every(Boolean);
    const byProfile = PROFILES.map(profile => {
      const rows = scenarios.filter(row => row.profile === profile.id);
      const mean = values => values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return {
        id: profile.id,
        boostEpisodesPerRoute: profile.boostEpisodes.slice(),
        scenarioCount: rows.length,
        fullAcceptancePasses: rows.filter(row => row.passed).length,
        initialFalseOutputAboveThreshold: rows.filter(row =>
          row.stressSeed.evidence.activation > 0.05).length,
        finalFalseOutputAboveThreshold: rows.filter(row =>
          row.stressAfterCleanup.activation > 0.05).length,
        meanInitialFalseOutputActivation: mean(rows.map(row => row.stressSeed.evidence.activation)),
        maxInitialFalseOutputActivation: Math.max(...rows.map(row => row.stressSeed.evidence.activation)),
        maxFinalFalseOutputActivation: Math.max(...rows.map(row => row.stressAfterCleanup.activation)),
        correctionsTargetingSeededOutput: rows.reduce((sum, row) => sum +
          row.cleanup.episodes.filter(step => step.incorrectOutput === row.stressSeed.falseOutput &&
            row.stressSeed.routes.some(route => route.feature === step.feature)).length, 0),
        totalCleanupEpisodes: rows.reduce((sum, row) => sum + row.cleanup.used, 0),
        scenariosWithThreeRemainingContributors: rows.filter(row =>
          row.stressAfterCleanup.routeCount === 3).length
      };
    });
    return {
      kind: "NEUROGENESIS three-route selective cleanup stress benchmark",
      version: 1,
      passed: protocolPassed,
      protocolPassed,
      candidatePassed: scenarios.length === expectedScenarios && scenarios.every(row => row.passed),
      scientificOutcome: scenarios.every(row => row.passed)
        ? "TWO_EPISODE_CAP_PASSED_ALL_STRESS_SCENARIOS"
        : "TWO_EPISODE_CAP_DID_NOT_PASS_ALL_STRESS_SCENARIOS",
      protocol: {
        seeds: SEEDS.slice(),
        taskOrders: ["forward", "reverse"],
        profiles: PROFILES.map(profile => ({
          id: profile.id,
          boostEpisodesPerRoute: profile.boostEpisodes.slice()
        })),
        scenarioCount: expectedScenarios,
        featureIndices: [0, 1, 2],
        minimumCompetingRoutes: 3,
        stressPositiveRate: 1.0,
        cleanupBudgetPerScenario: 2,
        replaySweeps: 1,
        replayPositiveRate: 0.02,
        replayNegativeRate: 1.0,
        cleanupPositiveRate: 0,
        cleanupNegativeRate: 1.0,
        targetMinActivation: 0.15,
        nonTargetMaxActivation: 0.05,
        maxCorrectWeightForHeadroom: 0.95
      },
      checks,
      summary: {
        scenarioCount: scenarios.length,
        fullAcceptancePasses: scenarios.filter(row => row.passed).length,
        retentionPasses: scenarios.filter(row => row.retentionPassed).length,
        headroomPasses: scenarios.filter(row => row.headroomPassed).length,
        freshAssociationPasses: scenarios.filter(row => row.freshAssociation.passed).length,
        oldAfterFreshPasses: scenarios.filter(row => row.oldAfterFresh.passed).length,
        totalCleanupEpisodes: scenarios.reduce((sum, row) => sum + row.cleanup.used, 0),
        maximumCleanupUsed: Math.max(...scenarios.map(row => row.cleanup.used)),
        allThreeRoutesInitiallyContribute: scenarios.filter(row =>
          row.stressSeed.evidence.routeCount === 3).length,
        falseOutputAboveThresholdBeforeCleanup: scenarios.filter(row =>
          row.stressSeed.evidence.activation > 0.05).length,
        falseOutputAboveThresholdAfterCleanup: scenarios.filter(row =>
          row.stressAfterCleanup.activation > 0.05).length
      },
      byProfile,
      scenarios,
      timingMs: profiles.reduce((sum, row) => sum + row.report.timingMs, 0)
    };
  }

  root.NGPlasticityThreeRouteStress = Object.freeze({
    version: 1,
    run,
    seeds: SEEDS,
    profiles: PROFILES
  });
})();
