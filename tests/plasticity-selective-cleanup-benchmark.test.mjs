import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-selective-cleanup-benchmark.js";

assert.equal(typeof globalThis.NGPlasticitySelectiveCleanupBenchmark?.run, "function",
  "the selective cleanup benchmark must expose run()");

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

const report = globalThis.NGPlasticitySelectiveCleanupBenchmark.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-selective-cleanup-v1.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticitySelectiveCleanupBenchmark.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.passed, report.passed);
console.log("NEUROGENESIS selective cleanup report artifact saved: " + reportPath);
console.log("NEUROGENESIS selective cleanup summary: " + JSON.stringify({
  passed: report.passed,
  checks: report.checks,
  candidates: report.candidates.map(row => ({
    id: row.id,
    cleanupBudgetPerScenario: row.cleanupBudgetPerScenario,
    passedScenarios: row.passedScenarios,
    retentionPasses: row.retentionPasses,
    headroomPasses: row.headroomPasses,
    freshAssociationPasses: row.freshAssociationPasses,
    oldAfterFreshPasses: row.oldAfterFreshPasses,
    cleanupEpisodes: row.cleanupEpisodes,
    maximumCleanupUsed: row.maximumCleanupUsed,
    totalEpisodes: row.totalEpisodes,
    maxLeakageBeforeCleanup: row.maxLeakageBeforeCleanup,
    maxLeakageAfterCleanup: row.maxLeakageAfterCleanup
  })),
  createdBrains, activeBrains
}));

assert.equal(report.kind, "NEUROGENESIS event-triggered selective plasticity cleanup benchmark");
assert.equal(report.passed, true, "the cleanup experiment must complete its protocol and safety checks");
assert.deepEqual(report.protocol.seeds, [101, 211]);
assert.deepEqual(report.protocol.cleanupBudgetsPerScenario, [0, 1, 2, 4, 8]);
assert.equal(report.protocol.globalCleanupEpisodeCap, 32);
assert.equal(report.candidates.length, 5);
assert.equal(report.checks.allCandidatesCompleted, true);
assert.equal(report.checks.noCleanupReferenceReproducesKnownFailure, true);
assert.equal(report.checks.cleanupNeverExceedsRegisteredBudget, true);
assert.equal(report.checks.allWeightsFiniteAndBounded, true);
assert.equal(report.checks.allScenariosCoverBothTaskOrders, true);
assert.equal(report.checks.everyCleanupStepChangesOnlyOneSelectedEdge, true);
assert.equal(report.checks.costIsRecorded, true);

const byBudget = new Map(report.candidates.map(row => [row.cleanupBudgetPerScenario, row]));
assert.equal(byBudget.get(0).passedScenarios, 2);
assert.equal(byBudget.get(0).retentionPasses, 2);
assert.equal(byBudget.get(0).cleanupEpisodes, 0);

assert.equal(byBudget.get(1).passedScenarios, 2,
  "one targeted correction must not be reported as sufficient for both forward-order cases");
assert.equal(byBudget.get(2).passedScenarios, 4,
  "two targeted corrections must restore all seed/order scenarios");
assert.equal(byBudget.get(2).retentionPasses, 4);
assert.equal(byBudget.get(2).headroomPasses, 4);
assert.equal(byBudget.get(2).freshAssociationPasses, 4);
assert.equal(byBudget.get(2).oldAfterFreshPasses, 4);
assert.equal(byBudget.get(2).cleanupEpisodes, 4,
  "only the two forward-order brains should need two corrections each");
assert.equal(byBudget.get(2).maximumCleanupUsed, 2);
assert.equal(byBudget.get(2).maxLeakageAfterCleanup, 0);
assert.equal(byBudget.get(4).passedScenarios, 4);
assert.equal(byBudget.get(8).passedScenarios, 4);
assert.equal(byBudget.get(4).cleanupEpisodes, 4);
assert.equal(byBudget.get(8).cleanupEpisodes, 4);

for (const candidate of report.candidates) {
  assert.equal(candidate.scenarioCount, 4);
  assert.ok(candidate.maximumCleanupUsed <= candidate.cleanupBudgetPerScenario);
  assert.equal(candidate.freshAssociationPasses, 4,
    "selective cleanup must not prevent fresh feature learning");
  assert.equal(candidate.headroomPasses, 4,
    "all candidates must preserve bounded synaptic weights");
  for (const scenario of candidate.scenarios) {
    assert.equal(scenario.episodes.cleanup, scenario.cleanup.used);
    assert.equal(scenario.episodes.total,
      scenario.episodes.initialSingleton + scenario.episodes.compositions +
      scenario.episodes.replay + scenario.episodes.cleanup + scenario.episodes.freshAssociation);
    assert.equal(scenario.cleanup.final.passed, scenario.retained.passed);
    assert.equal(scenario.cleanup.final.maxUnexpected, scenario.retained.maxUnexpected);
    assert.ok(scenario.cleanup.used <= candidate.cleanupBudgetPerScenario);
    for (const step of scenario.cleanup.episodes) {
      assert.equal(step.changedEdges, 1);
      assert.equal(step.tracesConsumed, true);
      assert.ok(step.weightDelta < 0);
      assert.ok(step.afterWeight >= 0 && step.afterWeight <= 1);
    }
    assert.equal(scenario.allWeightsBoundedAfterFresh, true);
  }
}

assert.equal(createdBrains, 20,
  "five budgets × two seeds × two task orders must use independent WASM brains");
assert.equal(activeBrains, 0, "all selective cleanup WASM brains must be disposed");

console.log("NEUROGENESIS selective cleanup assertions: passed.");
