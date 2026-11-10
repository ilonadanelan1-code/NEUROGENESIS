(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const BASE_SEEDS = Object.freeze([101, 211]);
  const CANDIDATES = Object.freeze([
    Object.freeze({ id: "baseline-2-sweeps", label: "Baseline: 2 replay sweeps, negative rate 0.70", replaySweeps: 2, negativeRate: 0.70 }),
    Object.freeze({ id: "one-sweep-070", label: "1 replay sweep, negative rate 0.70", replaySweeps: 1, negativeRate: 0.70 }),
    Object.freeze({ id: "one-sweep-085", label: "1 replay sweep, negative rate 0.85", replaySweeps: 1, negativeRate: 0.85 }),
    Object.freeze({ id: "one-sweep-100", label: "1 replay sweep, negative rate 1.00", replaySweeps: 1, negativeRate: 1.00 }),
    Object.freeze({ id: "zero-sweeps-070", label: "0 replay sweeps, negative rate 0.70", replaySweeps: 0, negativeRate: 0.70 })
  ]);

  function summarise(candidate, report) {
    const rows = report.scenarios;
    const values = select => rows.map(select);
    const max = select => Math.max(...values(select));
    const min = select => Math.min(...values(select));
    const count = select => rows.filter(select).length;
    return {
      id: candidate.id,
      label: candidate.label,
      positiveRate: 0.02,
      negativeRate: candidate.negativeRate,
      replaySweeps: candidate.replaySweeps,
      scenarioCount: rows.length,
      passedScenarios: count(row => row.passed),
      allScenariosPassed: report.passed,
      retentionPasses: count(row => row.retentionPassed),
      headroomPasses: count(row => row.headroomPassed),
      freshAssociationPasses: count(row => row.freshAssociation.passed),
      oldAfterFreshPasses: count(row => row.oldAfterFresh.passed),
      replayEpisodes: rows.reduce((sum, row) => sum + row.episodes.replay, 0),
      totalEpisodes: rows.reduce((sum, row) => sum + row.episodes.total, 0),
      replayReductionVsBaseline: null,
      maxCorrectWeight: max(row => row.weights.maxCorrectWeight),
      meanUnusedHeadroom: values(row => row.weights.meanUnusedHeadroom)
        .reduce((sum, value) => sum + value, 0) / rows.length,
      minExpectedAfterRetention: min(row => row.retained.minExpected),
      maxUnexpectedAfterRetention: max(row => row.retained.maxUnexpected),
      minFreshTargetActivation: min(row => row.freshAssociation.targetActivation),
      maxFreshNonTargetActivation: max(row => row.freshAssociation.maxUnexpectedActivation),
      scenarios: rows
    };
  }

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before the efficiency experiment");
    }

    const started = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : Date.now();
    const candidates = CANDIDATES.map(candidate => {
      const mode = {
        id: candidate.id,
        updateRule: "bounded",
        positiveRate: 0.02,
        negativeRate: candidate.negativeRate,
        replaySweeps: candidate.replaySweeps
      };
      const report = benchmark.run({
        runtime,
        modes: [mode],
        seeds: BASE_SEEDS.slice(),
        targetModeId: candidate.id
      });
      if (report.scenarios.length !== BASE_SEEDS.length * 2) {
        throw new Error("Efficiency candidate did not complete all seed/order scenarios: " + candidate.id);
      }
      return { candidate, report, summary: summarise(candidate, report) };
    });

    const baseline = candidates.find(item => item.candidate.id === "baseline-2-sweeps");
    if (!baseline) throw new Error("The fixed two-sweep baseline is missing");
    const baselineReplayEpisodes = baseline.summary.replayEpisodes;
    const rows = candidates.map(item => {
      const summary = { ...item.summary };
      summary.replayReductionVsBaseline = baselineReplayEpisodes > 0
        ? Number((1 - summary.replayEpisodes / baselineReplayEpisodes).toFixed(6)) : 0;
      return summary;
    });
    const checks = {
      allCandidatesCompleted: rows.length === CANDIDATES.length && rows.every(row => row.scenarioCount === 4),
      baselinePassesAllAcceptanceChecks: baseline.report.passed && baseline.summary.passedScenarios === 4,
      allWeightsBounded: candidates.every(item => item.report.checks.allWeightsBounded),
      allCandidateReportsHaveBothOrders: candidates.every(item =>
        item.report.scenarios.some(row => row.trainingOrder === "forward") &&
        item.report.scenarios.some(row => row.trainingOrder === "reverse")),
      replayCostsAreMeasured: rows.every(row => Number.isInteger(row.replayEpisodes) && Number.isInteger(row.totalEpisodes))
    };
    return {
      kind: "NEUROGENESIS plasticity replay-efficiency benchmark",
      version: 1,
      passed: Object.values(checks).every(Boolean),
      protocol: {
        seeds: BASE_SEEDS.slice(),
        taskOrders: ["forward", "reverse"],
        featureCount: 4,
        outputCount: 5,
        heldOutCombinationCount: 11,
        heldOutPermutationCount: 60,
        cycles: 3,
        positiveRate: 0.02,
        compositionLearningRate: 0.05,
        compositionUpdateRule: "homeostatic",
        targetMinActivation: 0.15,
        nonTargetMaxActivation: 0.05,
        maxCorrectWeightForHeadroom: 0.95,
        freshAssociationSweeps: 8,
        acceptance: "Each candidate is evaluated independently in both seeds and task orders; a candidate passes only if retention, headroom, fresh learning, and old-after-fresh checks all pass in all four scenarios."
      },
      checks,
      baselineReplayEpisodes,
      candidates: rows,
      timingMs: Number(((typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now() : Date.now()) - started).toFixed(3))
    };
  }

  root.NGPlasticityEfficiencyBenchmark = Object.freeze({
    version: 1,
    run,
    candidates: CANDIDATES
  });
})();
