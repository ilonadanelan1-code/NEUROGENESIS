import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-five-route-cleanup-budget-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityFiveRouteCleanupBudget?.run, "function",
  "the five-route cleanup-budget benchmark must expose run()");

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

const report = globalThis.NGPlasticityFiveRouteCleanupBudget.run({ runtime });
const directory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(directory, "plasticity-five-route-cleanup-budget-v1.json");
await mkdir(directory, { recursive: true });
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityFiveRouteCleanupBudget.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 180);
assert.equal(persisted.report.byBudgetAndOrder.length, 12);
console.log("NEUROGENESIS five-route cleanup-budget v1 summary: " + JSON.stringify({
  passed: report.passed,
  protocol: report.protocol,
  checks: report.checks,
  summary: report.summary,
  createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allProfileBudgetSeedOrderScenariosCompleted, true);
assert.equal(report.checks.everyBudgetHasBothOrdersForEveryProfileAndSeed, true);
assert.equal(report.checks.allFiveSeededRoutesContribute, true);
assert.equal(report.checks.cleanupNeverExceedsDeclaredBudget, true);
assert.equal(report.checks.everyCleanupEpisodeChangesOneEdgeAndConsumesTrace, true);
assert.equal(report.checks.everyWeightRemainsFiniteAndBounded, true);
assert.equal(report.checks.everyFreshAssociationIsMeasured, true);
assert.equal(report.checks.allDisposableBrainsReleased, true);
assert.equal(createdBrains, 180);
assert.equal(activeBrains, 0);

for (const row of report.scenarios) {
  assert.ok([32, 36, 40, 44, 48, 56].includes(row.budget));
  assert.ok([71, 83, 97, 109, 127].includes(row.seed));
  assert.ok(["equal-medium", "ascending", "descending"].includes(row.profile));
  assert.ok(["safe-ABCDE-CDE-AB", "control-AB-CDE-ABCDE"].includes(row.orderVariant));
  assert.ok(row.cleanup.used <= row.budget);
  assert.ok(row.cleanup.episodes.every(step => step.changedEdges === 1 && step.tracesConsumed));
  assert.equal(row.allWeightsBoundedAfterFresh, true);
}
console.log("NEUROGENESIS five-route cleanup-budget protocol assertions: passed.");
