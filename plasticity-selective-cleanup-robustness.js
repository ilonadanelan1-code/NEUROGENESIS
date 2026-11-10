(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([7, 17, 29, 43, 59, 73, 97, 127, 101, 211]);

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before robustness testing");
    }
    const mode = {
      id: "robust-selective-cleanup-2",
      updateRule: "bounded",
      positiveRate: 0.02,
      negativeRate: 1.0,
      replaySweeps: 1,
      selectiveCleanupBudget: 2,
      selectiveCleanupNegativeRate: 1.0
    };
    const report = benchmark.run({
      runtime,
      modes: [mode],
      seeds: SEEDS.slice(),
      targetModeId: mode.id
    });
    const rows = report.scenarios;
    const count = predicate => rows.filter(predicate).length;
    const checks = {
      allSeedOrderScenariosCompleted: rows.length === SEEDS.length * 2,
      bothTaskOrdersPerSeed: SEEDS.every(seed =>
        rows.some(row => row.seed === seed && row.trainingOrder === "forward") &&
        rows.some(row => row.seed === seed && row.trainingOrder === "reverse")),
      cleanupWithinTwoEpisodeBudget: rows.every(row => row.cleanup.used <= 2),
      allWeightsFiniteAndBounded: rows.every(row =>
        row.weights.allWeightsBounded && row.allWeightsBoundedAfterFresh),
      everyCorrectionTargetsExactlyOneEdge: rows.every(row =>
        row.cleanup.episodes.every(step => step.changedEdges === 1 &&
          step.tracesConsumed && step.weightDelta < 0)),
      allBrainsDisposed: report.createdBrains === SEEDS.length * 2
    };
    return {
      kind: "NEUROGENESIS selective cleanup seed robustness benchmark",
      version: 1,
      passed: report.passed && Object.values(checks).every(Boolean),
      protocol: {
        seeds: SEEDS.slice(),
        taskOrders: ["forward", "reverse"],
        scenarioCount: SEEDS.length * 2,
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
        passedScenarios: count(row => row.passed),
        retentionPasses: count(row => row.retentionPassed),
        headroomPasses: count(row => row.headroomPassed),
        freshAssociationPasses: count(row => row.freshAssociation.passed),
        oldAfterFreshPasses: count(row => row.oldAfterFresh.passed),
        totalCleanupEpisodes: rows.reduce((sum, row) => sum + row.cleanup.used, 0),
        maximumCleanupUsed: Math.max(...rows.map(row => row.cleanup.used)),
        maximumNonTargetActivationAfterCleanup: Math.max(...rows.map(row => row.retained.maxUnexpected)),
        minimumExpectedActivationAfterCleanup: Math.min(...rows.map(row => row.retained.minExpected)),
        maximumCorrectWeight: Math.max(...rows.map(row => row.weights.maxCorrectWeight))
      },
      scenarios: rows,
      timingMs: report.timingMs,
      sourceReport: {
        passed: report.passed,
        checks: report.checks,
        comparisons: report.comparisons
      }
    };
  }

  root.NGPlasticitySelectiveCleanupRobustness = Object.freeze({
    version: 1,
    run,
    seeds: SEEDS
  });
})();
