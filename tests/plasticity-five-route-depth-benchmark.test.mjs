import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-five-route-depth-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityFiveRouteDepth?.run, "function",
  "the five-route cleanup-depth benchmark must expose run()");

const baseRuntime = await globalThis.NGWasm.load({ moduleFactory: createModule });
let createdBrains = 0;
let activeBrains = 0;
const runtime = {
  createBrain() {
    const brain = baseRuntime.createBrain();
    createdBrains++;
    activeBrains++;
    let disposed = false;
    return new Proxy({}, {
      get(_target, property) {
        if (property === "dispose") {
          return () => {
            if (disposed) return;
            disposed = true;
            brain.dispose();
            activeBrains--;
          };
        }
        const value = Reflect.get(brain, property, brain);
        return typeof value === "function" ? value.bind(brain) : value;
      }
    });
  }
};

const report = globalThis.NGPlasticityFiveRouteDepth.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-five-route-depth-v3.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityFiveRouteDepth.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 90);

console.log("NEUROGENESIS five-route cleanup-depth v3 summary: " + JSON.stringify({
  passed: report.passed,
  candidate52PassedAllProfiles: report.candidate52PassedAllProfiles,
  candidate54PassedAllProfiles: report.candidate54PassedAllProfiles,
  candidate56PassedAllProfiles: report.candidate56PassedAllProfiles,
  checks: report.checks,
  byBudget: report.byBudget,
  byProfileAndBudget: report.byProfileAndBudget,
  createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allProfileBudgetSeedOrderScenariosCompleted, true);
assert.equal(report.checks.everyProfileBudgetHasBothOrdersForEverySeed, true);
assert.equal(report.checks.everyScenarioBeginsWithFiveDistinctRoutes, true);
assert.equal(report.checks.allFiveRoutesHavePositiveMeasuredContribution, true);
assert.equal(report.checks.allFalseOutputsAreNonTargetOutputs, true);
assert.equal(report.checks.cleanupRespectsDeclaredBudget, true);
assert.equal(report.checks.everyCorrectionChangesOneEdgeAndConsumesTraces, true);
assert.equal(report.checks.allWeightsRemainFiniteAndBounded, true);
assert.equal(report.checks.everyDisposableBrainWasCreated, true);
assert.deepEqual(report.protocol.budgets, [52, 54, 56]);
assert.equal(report.protocol.featureCount, 5);
assert.equal(report.protocol.outputCount, 6);
assert.equal(report.protocol.heldOutCombinationCount, 26);
assert.equal(report.protocol.heldOutPermutationCount, 320);
assert.equal(report.protocol.maxDiagnosticCleanupBudget, 60);
for (const budget of [52, 54, 56]) {
  const allPassed = report.byBudget.find(row => row.budget === budget)?.fullAcceptancePasses === 30;
  assert.equal(report["candidate" + budget + "PassedAllProfiles"], allPassed,
    "candidate summary flag must match the measured full-scenario acceptance for budget " + budget);
}
assert.equal(createdBrains, 90);
assert.equal(activeBrains, 0);

for (const scenario of report.scenarios) {
  assert.equal(scenario.stressSeed.evidence.routeCount, 5);
  assert.equal(scenario.stressSeed.routes.length, 5);
  assert.ok(scenario.cleanup.used <= scenario.budget);
  assert.equal(scenario.cleanup.episodes.length, scenario.cleanup.used);
  assert.equal(scenario.weights.allWeightsBounded, true);
  assert.equal(scenario.allWeightsBoundedAfterFresh, true);
  for (const route of scenario.stressSeed.routes) {
    assert.ok(route.afterWeight > route.beforeWeight);
    assert.ok(route.totalWeightDelta > 0);
  }
  for (const step of scenario.cleanup.episodes) {
    assert.equal(step.changedEdges, 1);
    assert.equal(step.tracesConsumed, true);
    assert.ok(step.weightDelta < 0);
  }
}

console.log("NEUROGENESIS five-route cleanup-depth protocol assertions: passed.");
