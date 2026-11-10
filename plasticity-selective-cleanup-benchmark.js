(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const SEEDS = Object.freeze([101, 211]);
  const CLEANUP_BUDGETS = Object.freeze([0, 1, 2, 4, 8]);

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before selective cleanup research");
    }

    const started = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : Date.now();
    const candidates = CLEANUP_BUDGETS.map(budget => {
      const id = "one-sweep-cleanup-" + budget;
      const mode = {
        id,
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
        targetModeId: id
      });
      if (report.scenarios.length !== SEEDS.length * 2) {
        throw new Error("Selective cleanup candidate did not complete all four seed/order scenarios: " + id);
      }
      const rows = report.scenarios;
      const count = predicate => rows.filter(predicate).length;
      return {
        id,
        replaySweeps: 1,
        replayNegativeRate: 1.0,
        cleanupNegativeRate: 1.0,
        cleanupBudgetPerScenario: budget,
        scenarioCount: rows.length,
        passedScenarios: count(row => row.passed),
        retentionPasses: count(row => row.retentionPassed),
        headroomPasses: count(row => row.headroomPassed),
        freshAssociationPasses: count(row => row.freshAssociation.passed),
        oldAfterFreshPasses: count(row => row.oldAfterFresh.passed),
        cleanupEpisodes: rows.reduce((sum, row) => sum + row.cleanup.used, 0),
        maximumCleanupUsed: Math.max(...rows.map(row => row.cleanup.used)),
        totalEpisodes: rows.reduce((sum, row) => sum + row.episodes.total, 0),
        maxCorrectWeight: Math.max(...rows.map(row => row.weights.maxCorrectWeight)),
        meanUnusedHeadroom: rows.reduce((sum, row) => sum + row.weights.meanUnusedHeadroom, 0) / rows.length,
        maxLeakageBeforeCleanup: Math.max(...rows.map(row => row.cleanup.initial?.maxUnexpected ?? row.retained.maxUnexpected)),
        maxLeakageAfterCleanup: Math.max(...rows.map(row => row.retained.maxUnexpected)),
        minExpectedAfterCleanup: Math.min(...rows.map(row => row.retained.minExpected)),
        scenarios: rows,
        reportPassed: report.passed
      };
    });

    const baseline = candidates.find(row => row.cleanupBudgetPerScenario === 0);
    if (!baseline) throw new Error("The no-cleanup reference candidate is missing");
    const baselineCleanupEpisodes = baseline.cleanupEpisodes;
    const checks = {
      allCandidatesCompleted: candidates.length === CLEANUP_BUDGETS.length &&
        candidates.every(row => row.scenarioCount === SEEDS.length * 2),
      noCleanupReferenceReproducesKnownFailure: baseline.passedScenarios === 2 &&
        baseline.retentionPasses === 2 && baseline.cleanupEpisodes === 0,
      cleanupNeverExceedsRegisteredBudget: candidates.every(row =>
        row.maximumCleanupUsed <= row.cleanupBudgetPerScenario),
      allWeightsFiniteAndBounded: candidates.every(row =>
        row.scenarios.every(scenario => scenario.weights.allWeightsBounded &&
          scenario.allWeightsBoundedAfterFresh)),
      allScenariosCoverBothTaskOrders: candidates.every(row =>
        row.scenarios.some(scenario => scenario.trainingOrder === "forward") &&
        row.scenarios.some(scenario => scenario.trainingOrder === "reverse")),
      everyCleanupStepChangesOnlyOneSelectedEdge: candidates.every(row =>
        row.scenarios.every(scenario => scenario.cleanup.episodes.every(step =>
          step.changedEdges === 1 && step.tracesConsumed && step.weightDelta < 0))),
      costIsRecorded: candidates.every(row =>
        Number.isInteger(row.cleanupEpisodes) && Number.isInteger(row.totalEpisodes))
    };
    return {
      kind: "NEUROGENESIS event-triggered selective plasticity cleanup benchmark",
      version: 1,
      passed: Object.values(checks).every(Boolean),
      protocol: {
        seeds: SEEDS.slice(),
        taskOrders: ["forward", "reverse"],
        featureCount: 4,
        outputCount: 5,
        heldOutCombinationCount: 11,
        heldOutPermutationCount: 60,
        cycles: 3,
        replaySweeps: 1,
        replayPositiveRate: 0.02,
        replayNegativeRate: 1.0,
        cleanupPositiveRate: 0,
        cleanupNegativeRate: 1.0,
        cleanupBudgetsPerScenario: CLEANUP_BUDGETS.slice(),
        globalCleanupEpisodeCap: CLEANUP_BUDGETS[CLEANUP_BUDGETS.length - 1] * SEEDS.length * 2,
        targetMinActivation: 0.15,
        nonTargetMaxActivation: 0.05,
        maxCorrectWeightForHeadroom: 0.95,
        freshAssociationSweeps: 8,
        selection: "Re-measure all held-out feature combinations and stimulation permutations; rank active input-to-non-target-output edges by accumulated excess activation multiplied by edge weight; weaken only the highest-ranked edge per episode; re-measure before the next correction.",
        acceptance: "A candidate passes only if all four seed/order scenarios retain all old mappings, keep headroom, learn the fifth feature, and retain all old held-out combinations after fresh learning."
      },
      checks,
      baselineCleanupEpisodes,
      candidates,
      timingMs: Number(((typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now() : Date.now()) - started).toFixed(3))
    };
  }

  root.NGPlasticitySelectiveCleanupBenchmark = Object.freeze({
    version: 1,
    run,
    cleanupBudgets: CLEANUP_BUDGETS
  });
})();
