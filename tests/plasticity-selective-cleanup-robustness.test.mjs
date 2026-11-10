import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-selective-cleanup-robustness.js";

assert.equal(typeof globalThis.NGPlasticitySelectiveCleanupRobustness?.run, "function",
  "the selective cleanup robustness benchmark must expose run()");

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

const report = globalThis.NGPlasticitySelectiveCleanupRobustness.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-selective-cleanup-robustness-v1.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticitySelectiveCleanupRobustness.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 20);
console.log("NEUROGENESIS selective cleanup robustness summary: " + JSON.stringify({
  passed: report.passed,
  checks: report.checks,
  summary: report.summary,
  createdBrains, activeBrains
}));

assert.equal(report.kind, "NEUROGENESIS selective cleanup seed robustness benchmark");
assert.deepEqual(report.protocol.seeds, [7, 17, 29, 43, 59, 73, 97, 127, 101, 211]);
assert.equal(report.protocol.scenarioCount, 20);
assert.equal(report.protocol.cleanupBudgetPerScenario, 2);
assert.equal(report.scenarios.length, 20);
assert.equal(report.checks.allSeedOrderScenariosCompleted, true);
assert.equal(report.checks.bothTaskOrdersPerSeed, true);
assert.equal(report.checks.cleanupWithinTwoEpisodeBudget, true);
assert.equal(report.checks.allWeightsFiniteAndBounded, true);
assert.equal(report.checks.everyCorrectionTargetsExactlyOneEdge, true);
assert.equal(report.checks.allBrainsDisposed, true);
assert.equal(createdBrains, 20);
assert.equal(activeBrains, 0);

for (const seed of report.protocol.seeds) {
  const forward = report.scenarios.find(row => row.seed === seed && row.trainingOrder === "forward");
  const reverse = report.scenarios.find(row => row.seed === seed && row.trainingOrder === "reverse");
  assert.ok(forward, "missing forward-order scenario for seed " + seed);
  assert.ok(reverse, "missing reverse-order scenario for seed " + seed);
}
for (const scenario of report.scenarios) {
  assert.ok(scenario.cleanup.used <= 2);
  assert.equal(scenario.weights.allWeightsBounded, true);
  assert.equal(scenario.allWeightsBoundedAfterFresh, true);
  assert.equal(scenario.cleanup.episodes.length, scenario.cleanup.used);
  for (const step of scenario.cleanup.episodes) {
    assert.equal(step.changedEdges, 1);
    assert.equal(step.tracesConsumed, true);
    assert.ok(step.weightDelta < 0);
  }
}

console.log("NEUROGENESIS selective cleanup robustness assertions: passed.");
