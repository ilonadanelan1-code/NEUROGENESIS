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
  const ORDER_VARIANTS = Object.freeze(Array.from({ length: 8 }, (_value, mask) => {
    const initialReverse = Boolean(mask & 1);
    const compositionReverse = Boolean(mask & 2);
    const replayReverse = Boolean(mask & 4);
    return Object.freeze({
      id: [initialReverse ? "R" : "F", compositionReverse ? "R" : "F",
        replayReverse ? "R" : "F"].join("/"),
      initialReverse, compositionReverse, replayReverse, freshReverse: false
    });
  }));

  function run(options = {}) {
    const runtime = options.runtime;
    const benchmark = root.NGPlasticityHeadroomBenchmark;
    if (!runtime || typeof runtime.createBrain !== "function") {
      throw new TypeError("A ready NEUROGENESIS WASM runtime is required");
    }
    if (!benchmark || typeof benchmark.run !== "function") {
      throw new Error("The bounded plasticity benchmark must load before order isolation testing");
    }
    const batches = [];
    for (const profile of PROFILES) {
      const mode = {
        id: "five-route-order-" + profile.id, updateRule: "bounded",
        positiveRate: 0.02, negativeRate: 1.0, replaySweeps: 1,
        selectiveCleanupBudget: BUDGET, selectiveCleanupNegativeRate: 1.0
      };
      const report = benchmark.run({
        runtime, modes: [mode], seeds: SEEDS.slice(),
        orderVariants: ORDER_VARIANTS.map(row => ({ ...row })),
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
      batches.push({ profile: profile.id, boostEpisodesPerRoute: profile.boostEpisodes.slice(), report });
    }

    const scenarios = batches.flatMap(batch => batch.report.scenarios.map(scenario => ({
      profile: batch.profile, boostEpisodesPerRoute: batch.boostEpisodesPerRoute,
      budget: BUDGET, seed: scenario.seed, orderVariant: scenario.trainingOrder,
      orderControls: scenario.orderControls, mapping: scenario.mapping,
      stressSeed: scenario.stressSeed, cleanup: scenario.cleanup,
      retained: scenario.retained, weights: scenario.weights,
      retentionPassed: scenario.retentionPassed, headroomPassed: scenario.headroomPassed,
      freshAssociation: scenario.freshAssociation, oldAfterFresh: scenario.oldAfterFresh,
      allWeightsBoundedAfterFresh: scenario.allWeightsBoundedAfterFresh,
      learningStages: scenario.learningStages, passed: scenario.passed,
      episodes: scenario.episodes, timingMs: scenario.timingMs
    })));

    const expectedCount = PROFILES.length * SEEDS.length * ORDER_VARIANTS.length;
    const checks = {
      allOrderProfileSeedScenariosCompleted: scenarios.length === expectedCount,
      eachProfileHasEveryOrderVariantForEverySeed: PROFILES.every(profile =>
        ORDER_VARIANTS.every(order => SEEDS.every(seed =>
          scenarios.some(row => row.profile === profile.id && row.orderVariant === order.id && row.seed === seed)))),
      everyScenarioBeginsWithFiveDistinctRoutes: scenarios.every(row =>
        row.stressSeed && row.stressSeed.routes.length === 5 &&
        new Set(row.stressSeed.routes.map(route => route.featureIndex)).size === 5),
      allFiveRoutesHavePositiveMeasuredContribution: scenarios.every(row =>
        row.stressSeed.evidence.routeCount === 5 &&
        row.stressSeed.evidence.routes.every(route =>
          route.contributes && Number.isFinite(route.weight) && route.weight > 0)),
      cleanupRespectsDeclaredBudget: scenarios.every(row => row.cleanup.used <= BUDGET),
      everyCorrectionChangesOneEdgeAndConsumesTraces: scenarios.every(row =>
        row.cleanup.episodes.every(step => step.changedEdges === 1 &&
          step.tracesConsumed && step.weightDelta < 0)),
      allWeightsRemainFiniteAndBounded: scenarios.every(row =>
        row.weights.allWeightsBounded && row.allWeightsBoundedAfterFresh),
      everyScenarioHasCompleteStageDiagnostics: scenarios.every(row =>
        row.learningStages.length === 18 &&
        row.learningStages.every(stage => stage.patternCount === 5 &&
          stage.failures.every(failure => typeof failure.worstUnexpectedOutput === "string" &&
            Number.isFinite(failure.activation))))
    };
    const variantSummary = ORDER_VARIANTS.map(order => {
      const rows = scenarios.filter(row => row.orderVariant === order.id);
      const stages = rows.flatMap(row => row.learningStages.map(stage => ({ ...stage, profile: row.profile, seed: row.seed })));
      const earliestFailures = [];
      for (const row of rows) {
        const first = row.learningStages.find(stage => stage.failures.length > 0);
        if (first) earliestFailures.push({
          profile: row.profile, seed: row.seed, cycle: first.cycle,
          taskId: first.taskId, stage: first.stage, failingPatterns: first.failures.length,
          maxUnexpectedActivation: Math.max(...first.failures.map(failure => failure.activation))
        });
      }
      return {
        id: order.id,
        controls: { initialReverse: order.initialReverse,
          compositionReverse: order.compositionReverse, replayReverse: order.replayReverse,
          freshReverse: order.freshReverse },
        scenarioCount: rows.length,
        retainedPasses: rows.filter(row => row.retentionPassed).length,
        headroomPasses: rows.filter(row => row.headroomPassed).length,
        freshAssociationPasses: rows.filter(row => row.freshAssociation.passed).length,
        oldAfterFreshPasses: rows.filter(row => row.oldAfterFresh.passed).length,
        fullAcceptancePasses: rows.filter(row => row.passed).length,
        firstFailureCount: earliestFailures.length,
        firstFailures: earliestFailures,
        maximumCheckpointLeakage: Math.max(0, ...stages.flatMap(stage =>
          stage.failures.map(failure => failure.activation)))
      };
    });
    const protocolChecksPassed = Object.values(checks).every(Boolean);
    return {
      kind: "NEUROGENESIS five-route order-isolation benchmark v1",
      version: 1, protocolPassed: protocolChecksPassed, passed: protocolChecksPassed,
      protocol: {
        seeds: SEEDS.slice(),
        profiles: PROFILES.map(profile => ({ id: profile.id, boostEpisodesPerRoute: profile.boostEpisodes.slice() })),
        budget: BUDGET, orderVariantCount: ORDER_VARIANTS.length,
        orderControls: ["initial feature/negative traversal", "composition task sequence",
          "replay feature/negative traversal"],
        freshAssociationOrder: "fixed forward", featureCount: 5, outputCount: 6,
        checkpointFeatureSets: "all held-out four-of-five feature combinations",
        checkpointsPerScenario: 18, cleanupEventsAreSingleEdgeAndTraceConsuming: true,
        productionNetworkModified: false, userSavesModified: false
      },
      checks,
      summary: {
        scenarioCount: scenarios.length,
        fullAcceptancePasses: scenarios.filter(row => row.passed).length,
        retainedPasses: scenarios.filter(row => row.retentionPassed).length,
        variantSummary
      },
      variantSummary, scenarios
    };
  }
  root.NGPlasticityFiveRouteOrderIsolation = Object.freeze({
    version: 1, run, seeds: SEEDS, budget: BUDGET, profiles: PROFILES,
    orderVariants: ORDER_VARIANTS
  });
})();
