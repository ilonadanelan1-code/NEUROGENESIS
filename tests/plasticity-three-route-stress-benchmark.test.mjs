import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-three-route-stress-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityThreeRouteStress?.run, "function",
  "the three-route stress benchmark must expose run()");

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

const report = globalThis.NGPlasticityThreeRouteStress.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-three-route-stress-v1.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityThreeRouteStress.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 30);

console.log("NEUROGENESIS three-route stress summary: " + JSON.stringify({
  passed: report.passed,
  candidatePassed: report.candidatePassed,
  scientificOutcome: report.scientificOutcome,
  checks: report.checks,
  summary: report.summary,
  byProfile: report.byProfile,
  createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allProfileSeedOrderScenariosCompleted, true);
assert.equal(report.checks.everyProfileHasBothOrdersForEverySeed, true);
assert.equal(report.checks.everyScenarioSeedsThreeDistinctRoutes, true);
assert.equal(report.checks.allThreeRoutesHavePositiveMeasuredContribution, true);
assert.equal(report.checks.allFalseOutputsAreNonTargetOutputs, true);
assert.equal(report.checks.cleanupNeverExceedsTwoEpisodes, true);
assert.equal(report.checks.everyCleanupCorrectionChangesOneEdgeAndConsumesTraces, true);
assert.equal(report.checks.allWeightsRemainFiniteAndBounded, true);
assert.equal(report.checks.everyDisposableBrainWasCreated, true);
assert.equal(createdBrains, 30);
assert.equal(activeBrains, 0);

for (const scenario of report.scenarios) {
  assert.equal(scenario.stressSeed.evidence.routeCount, 3);
  assert.equal(scenario.stressSeed.routes.length, 3);
  assert.ok(scenario.cleanup.used <= 2);
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

console.log("NEUROGENESIS three-route stress protocol assertions: passed.");
