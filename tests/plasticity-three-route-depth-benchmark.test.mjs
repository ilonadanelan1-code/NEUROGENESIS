import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-three-route-depth-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityThreeRouteDepth?.run, "function",
  "the three-route cleanup-depth benchmark must expose run()");

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

const report = globalThis.NGPlasticityThreeRouteDepth.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-three-route-depth-v1.json");
await mkdir(reportDirectory, { recursive: true });
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityThreeRouteDepth.version,
  report
};
await writeFile(reportPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
const persisted = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persisted.report.kind, report.kind);
assert.equal(persisted.report.scenarios.length, 40);

console.log("NEUROGENESIS three-route cleanup-depth summary: " + JSON.stringify({
  passed: report.passed,
  candidatePassed: report.candidatePassed,
  checks: report.checks,
  byBudget: report.byBudget,
  createdBrains, activeBrains
}));

assert.equal(report.protocolPassed, true);
assert.equal(report.checks.allBudgetSeedOrderScenariosCompleted, true);
assert.equal(report.checks.allBudgetsRepresented, true);
assert.equal(report.checks.bothTaskOrdersPerSeedAndBudget, true);
assert.equal(report.checks.everyScenarioBeginsWithThreeContributors, true);
assert.equal(report.checks.allFalseOutputsAreNonTargetOutputs, true);
assert.equal(report.checks.cleanupRespectsItsDeclaredBudget, true);
assert.equal(report.checks.everyCorrectionTargetsOneEdgeAndConsumesTraces, true);
assert.equal(report.checks.allWeightsRemainFiniteAndBounded, true);
assert.equal(report.checks.everyDisposableBrainWasCreated, true);
assert.equal(createdBrains, 40);
assert.equal(activeBrains, 0);

for (const scenario of report.scenarios) {
  assert.equal(scenario.stressSeed.evidence.routeCount, 3);
  assert.ok(scenario.cleanup.used <= scenario.budget);
  assert.equal(scenario.cleanup.episodes.length, scenario.cleanup.used);
  assert.equal(scenario.weights.allWeightsBounded, true);
  assert.equal(scenario.allWeightsBoundedAfterFresh, true);
  for (const episode of scenario.cleanup.episodes) {
    assert.equal(episode.changedEdges, 1);
    assert.equal(episode.tracesConsumed, true);
    assert.ok(episode.weightDelta < 0);
  }
}

console.log("NEUROGENESIS three-route cleanup-depth protocol assertions: passed.");
