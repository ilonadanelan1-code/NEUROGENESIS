import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-three-route-profile-depth-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityThreeRouteProfileDepth?.run, "function",
  "the three-route profile depth benchmark must expose run()");

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

const report = globalThis.NGPlasticityThreeRouteProfileDepth.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-three-route-profile-depth-v1.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityThreeRouteProfileDepth.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 60);

console.log("NEUROGENESIS three-route profile depth summary: " + JSON.stringify({
  passed: report.passed,
  candidate22PassedAllProfiles: report.candidate22PassedAllProfiles,
  candidate24PassedAllProfiles: report.candidate24PassedAllProfiles,
  checks: report.checks,
  byBudget: report.byBudget,
  byProfileAndBudget: report.byProfileAndBudget,
  createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allProfileBudgetSeedOrderScenariosCompleted, true);
assert.equal(report.checks.everyProfileBudgetHasBothOrdersForEverySeed, true);
assert.equal(report.checks.everyScenarioBeginsWithThreeDistinctRoutes, true);
assert.equal(report.checks.allThreeRoutesHavePositiveMeasuredContribution, true);
assert.equal(report.checks.allFalseOutputsAreNonTargetOutputs, true);
assert.equal(report.checks.cleanupRespectsDeclaredBudget, true);
assert.equal(report.checks.everyCorrectionChangesOneEdgeAndConsumesTraces, true);
assert.equal(report.checks.allWeightsRemainFiniteAndBounded, true);
assert.equal(report.checks.everyDisposableBrainWasCreated, true);
assert.deepEqual(report.protocol.budgets, [22, 24]);
assert.equal(createdBrains, 60);
assert.equal(activeBrains, 0);

for (const scenario of report.scenarios) {
  assert.equal(scenario.stressSeed.evidence.routeCount, 3);
  assert.equal(scenario.stressSeed.routes.length, 3);
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

console.log("NEUROGENESIS three-route profile depth protocol assertions: passed.");
