import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-five-route-order-isolation-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityFiveRouteOrderIsolation?.run, "function",
  "the five-route order-isolation benchmark must expose run()");

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

const report = globalThis.NGPlasticityFiveRouteOrderIsolation.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-five-route-order-isolation-v1.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null, workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind, benchmarkVersion: globalThis.NGPlasticityFiveRouteOrderIsolation.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 120);
assert.equal(persisted.report.variantSummary.length, 8);
console.log("NEUROGENESIS five-route order-isolation v1 summary: " + JSON.stringify({
  passed: report.passed, protocol: report.protocol, checks: report.checks,
  summary: report.summary, createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allOrderProfileSeedScenariosCompleted, true);
assert.equal(report.checks.eachProfileHasEveryOrderVariantForEverySeed, true);
assert.equal(report.checks.everyScenarioBeginsWithFiveDistinctRoutes, true);
assert.equal(report.checks.allFiveRoutesHavePositiveMeasuredContribution, true);
assert.equal(report.checks.cleanupRespectsDeclaredBudget, true);
assert.equal(report.checks.everyCorrectionChangesOneEdgeAndConsumesTraces, true);
assert.equal(report.checks.allWeightsRemainFiniteAndBounded, true);
assert.equal(report.checks.everyScenarioHasCompleteStageDiagnostics, true);
assert.equal(createdBrains, 120);
assert.equal(activeBrains, 0);
for (const scenario of report.scenarios) {
  assert.equal(scenario.orderControls.freshReverse, false);
  assert.equal(scenario.learningStages.length, 18);
  for (const stage of scenario.learningStages) {
    assert.equal(stage.patternCount, 5);
    for (const failure of stage.failures) {
      assert.ok(Number.isFinite(failure.activation));
      assert.equal(typeof failure.worstUnexpectedOutput, "string");
    }
  }
}
console.log("NEUROGENESIS five-route order-isolation protocol assertions: passed.");
