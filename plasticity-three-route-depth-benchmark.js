(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([7, 17, 29, 43, 59]);
  const BUDGETS = Object.freeze([2, 3, 6, 9]);
  const BOOST_EPISODES = Object.freeze([2, 2, 2]);

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before cleanup-depth testing");
    }
    const budgets = BUDGETS.map(budget => {
      const mode = {
        id: "three-route-depth-budget-" + budget,
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
            featureIndices: [0, 1, 2],
            boostEpisodes: BOOST_EPISODES.slice(),
            positiveRate: 1.0
          }
        }
      });
      return { budget, report };
    });
    const scenarios = budgets.flatMap(row => row.report.scenarios.map(scenario => ({
      budget: row.budget,
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
    const expectedScenarios = BUDGETS.length * SEEDS.length * 2;
    const checks = {
      allBudgetSeedOrderScenariosCompleted: scenarios.length === expectedScenarios,
      allBudgetsRepresented: BUDGETS.every(budget => scenarios.filter(row => row.budget === budget).length === SEEDS.length * 2),
      bothTaskOrdersPerSeedAndBudget: BUDGETS.every(budget => SEEDS.every(seed =>
        scenarios.some(row => row.budget === budget && row.seed === seed && row.trainingOrder === "forward") &&
        scenarios.some(row => row.budget === budget && row.seed === seed && row.trainingOrder === "reverse"))),
      everyScenarioBeginsWithThreeContributors: scenarios.every(row =>
        row.stressSeed && row.stressSeed.evidence.routeCount === 3 &&
        row.stressSeed.evidence.routes.every(route => route.contributes)),
      allFalseOutputsAreNonTargetOutputs: scenarios.every(row =>
        row.stressSeed && !Object.values(row.mapping).includes(row.stressSeed.falseOutput)),
      cleanupRespectsItsDeclaredBudget: scenarios.every(row => row.cleanup.used <= row.budget),
      everyCorrectionTargetsOneEdgeAndConsumesTraces: scenarios.every(row =>
        row.cleanup.episodes.every(step => step.changedEdges === 1 &&
          step.tracesConsumed && step.weightDelta < 0)),
      allWeightsRemainFiniteAndBounded: scenarios.every(row =>
        row.weights.allWeightsBounded && row.allWeightsBoundedAfterFresh),
      everyDisposableBrainWasCreated: budgets.every(row =>
        row.report.createdBrains === SEEDS.length * 2)
    };
    const protocolPassed = Object.values(checks).every(Boolean);
    const byBudget = BUDGETS.map(budget => {
      const rows = scenarios.filter(row => row.budget === budget);
      const mean = values => values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const correctionStats = rows.map(row => {
        const counts = new Map();
        for (const episode of row.cleanup.episodes) {
          const key = episode.feature + "->" + episode.incorrectOutput;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const seededOutputCorrections = row.cleanup.episodes.filter(episode =>
          episode.incorrectOutput === row.stressSeed.falseOutput &&
          row.stressSeed.routes.some(route => route.feature === episode.feature));
        return {
          correctionEpisodes: row.cleanup.used,
          uniqueSeededRoutesCorrected: new Set(seededOutputCorrections.map(item => item.feature)).size,
          repeatedCorrectionEpisodes: seededOutputCorrections.length -
            new Set(seededOutputCorrections.map(item => item.feature)).size,
          maxCorrectionsOnOneSeededRoute: Math.max(0, ...row.stressSeed.routes.map(route =>
            seededOutputCorrections.filter(item => item.feature === route.feature).length))
        };
      });
      const remainingWeights = rows.flatMap(row => row.stressAfterCleanup.routes.map(route => route.weight));
      const remainingIsolatedActivation = rows.flatMap(row =>
        row.stressAfterCleanup.routes.map(route => route.marginalActivation));
      return {
        budget,
        scenarioCount: rows.length,
        fullAcceptancePasses: rows.filter(row => row.passed).length,
        retentionPasses: rows.filter(row => row.retentionPassed).length,
        headroomPasses: rows.filter(row => row.headroomPassed).length,
        freshAssociationPasses: rows.filter(row => row.freshAssociation.passed).length,
        oldAfterFreshPasses: rows.filter(row => row.oldAfterFresh.passed).length,
        scenariosWithFalseOutputAboveThreshold: rows.filter(row =>
          row.stressAfterCleanup.activation > 0.05).length,
        scenariosWithThreeRemainingContributors: rows.filter(row =>
          row.stressAfterCleanup.routeCount === 3).length,
        meanFinalFalseOutputActivation: mean(rows.map(row => row.stressAfterCleanup.activation)),
        maximumFinalFalseOutputActivation: Math.max(...rows.map(row => row.stressAfterCleanup.activation)),
        minimumRemainingRouteWeight: Math.min(...remainingWeights),
        maximumRemainingRouteWeight: Math.max(...remainingWeights),
        minimumRemainingIsolatedActivation: Math.min(...remainingIsolatedActivation),
        maximumRemainingIsolatedActivation: Math.max(...remainingIsolatedActivation),
        totalCleanupEpisodes: correctionStats.reduce((sum, row) => sum + row.correctionEpisodes, 0),
        meanUniqueSeededRoutesCorrected: mean(correctionStats.map(row => row.uniqueSeededRoutesCorrected)),
        meanRepeatedCorrectionEpisodes: mean(correctionStats.map(row => row.repeatedCorrectionEpisodes)),
        maximumCorrectionsOnOneSeededRoute: Math.max(...correctionStats.map(row => row.maxCorrectionsOnOneSeededRoute))
      };
    });
    return {
      kind: "NEUROGENESIS three-route cleanup-depth diagnostic benchmark",
      version: 1,
      passed: protocolPassed,
      protocolPassed,
      candidatePassed: scenarios.length === expectedScenarios && scenarios.every(row => row.passed),
      protocol: {
        seeds: SEEDS.slice(),
        taskOrders: ["forward", "reverse"],
        budgets: BUDGETS.slice(),
        scenarioCount: expectedScenarios,
        featureIndices: [0, 1, 2],
        falseRouteBoostEpisodes: BOOST_EPISODES.slice(),
        stressPositiveRate: 1.0,
        replaySweeps: 1,
        replayPositiveRate: 0.02,
        replayNegativeRate: 1.0,
        cleanupPositiveRate: 0,
        cleanupNegativeRate: 1.0,
        targetMinActivation: 0.15,
        nonTargetMaxActivation: 0.05,
        maxCorrectWeightForHeadroom: 0.95,
        maxDiagnosticCleanupBudget: 12
      },
      checks,
      summary: {
        scenarioCount: scenarios.length,
        fullAcceptancePasses: scenarios.filter(row => row.passed).length,
        maximumCleanupUsed: Math.max(...scenarios.map(row => row.cleanup.used)),
        allThreeRoutesInitiallyContribute: scenarios.filter(row =>
          row.stressSeed.evidence.routeCount === 3).length,
        budgetComparison: byBudget
      },
      byBudget,
      scenarios,
      timingMs: budgets.reduce((sum, row) => sum + row.report.timingMs, 0)
    };
  }

  root.NGPlasticityThreeRouteDepth = Object.freeze({
    version: 1,
    run,
    seeds: SEEDS,
    budgets: BUDGETS
  });
})();
