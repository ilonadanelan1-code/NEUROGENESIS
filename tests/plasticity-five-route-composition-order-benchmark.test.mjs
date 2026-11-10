import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-five-route-composition-order-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityFiveRouteCompositionOrder?.run, "function",
  "the five-route composition-order benchmark must expose run()");

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
const report = globalThis.NGPlasticityFiveRouteCompositionOrder.run({ runtime });
const directory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(directory, "plasticity-five-route-composition-order-v1.json");
await mkdir(directory, { recursive: true });
const artifact = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null, workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind, benchmarkVersion: globalThis.NGPlasticityFiveRouteCompositionOrder.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const stored = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(stored.report.kind, report.kind);
assert.equal(stored.report.scenarios.length, 90);
assert.equal(stored.report.sequenceSummary.length, 6);
console.log("NEUROGENESIS five-route composition-order v1 summary: " + JSON.stringify({
  passed: report.passed, protocol: report.protocol, checks: report.checks,
  summary: report.summary, createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allScenariosCompleted, true);
assert.equal(report.checks.everySequenceCoveredForEveryProfileAndSeed, true);
assert.equal(report.checks.everySequenceIsExactThreeTaskPermutation, true);
assert.equal(report.checks.everyScenarioHasAll18DiagnosticCheckpoints, true);
assert.equal(createdBrains, 90);
assert.equal(activeBrains, 0);
for (const scenario of report.scenarios) {
  assert.equal(scenario.compositionTaskOrder.length, 3);
  assert.equal(scenario.learningStages.length, 18);
  assert.equal(typeof scenario.orderVariant, "string");
}
console.log("NEUROGENESIS five-route composition-order protocol assertions: passed.");