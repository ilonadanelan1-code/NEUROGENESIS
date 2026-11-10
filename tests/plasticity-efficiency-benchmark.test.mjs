import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";
import "../plasticity-efficiency-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityEfficiencyBenchmark?.run, "function",
  "the replay-efficiency benchmark must expose run()");

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

const report = globalThis.NGPlasticityEfficiencyBenchmark.run({ runtime });
const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-efficiency-v1.json");
await mkdir(reportDirectory, { recursive: true });
const reportArtifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityEfficiencyBenchmark.version,
  report
};
await writeFile(reportPath, JSON.stringify(reportArtifact, null, 2) + "\n", "utf8");
const persistedArtifact = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persistedArtifact.report.kind, report.kind);
assert.equal(persistedArtifact.report.passed, report.passed);
console.log("NEUROGENESIS plasticity efficiency report artifact saved: " + reportPath);
console.log("NEUROGENESIS plasticity efficiency summary: " + JSON.stringify({
  passed: report.passed,
  checks: report.checks,
  candidates: report.candidates.map(row => ({
    id: row.id,
    replaySweeps: row.replaySweeps,
    negativeRate: row.negativeRate,
    passedScenarios: row.passedScenarios,
    replayEpisodes: row.replayEpisodes,
    totalEpisodes: row.totalEpisodes,
    replayReductionVsBaseline: row.replayReductionVsBaseline,
    maxCorrectWeight: row.maxCorrectWeight,
    meanUnusedHeadroom: row.meanUnusedHeadroom,
    minExpectedAfterRetention: row.minExpectedAfterRetention,
    maxUnexpectedAfterRetention: row.maxUnexpectedAfterRetention
  })),
  createdBrains, activeBrains
}));

assert.equal(report.kind, "NEUROGENESIS plasticity replay-efficiency benchmark");
assert.equal(report.passed, true, "the fixed baseline must reproduce the established bounded-asymmetric result");
assert.deepEqual(report.protocol.seeds, [101, 211]);
assert.equal(report.protocol.taskOrders.length, 2);
assert.equal(report.candidates.length, 5);
assert.equal(report.checks.allCandidatesCompleted, true);
assert.equal(report.checks.baselinePassesAllAcceptanceChecks, true);
assert.equal(report.checks.allWeightsBounded, true);
assert.equal(report.checks.allCandidateReportsHaveBothOrders, true);
assert.equal(report.checks.replayCostsAreMeasured, true);

const byId = new Map(report.candidates.map(row => [row.id, row]));
assert.equal(byId.get("baseline-2-sweeps").replayEpisodes, 1152);
assert.equal(byId.get("baseline-2-sweeps").totalEpisodes, 1380);
assert.equal(byId.get("one-sweep-070").replayEpisodes, 576);
assert.equal(byId.get("one-sweep-070").totalEpisodes, 804);
assert.equal(byId.get("one-sweep-085").replayEpisodes, 576);
assert.equal(byId.get("one-sweep-100").replayEpisodes, 576);
assert.equal(byId.get("zero-sweeps-070").replayEpisodes, 0);
assert.equal(byId.get("zero-sweeps-070").totalEpisodes, 228);
assert.equal(byId.get("one-sweep-070").replayReductionVsBaseline, 0.5);
assert.equal(byId.get("zero-sweeps-070").replayReductionVsBaseline, 1);

for (const candidate of report.candidates) {
  assert.equal(candidate.scenarioCount, 4);
  assert.ok(candidate.passedScenarios >= 0 && candidate.passedScenarios <= 4);
  assert.ok(candidate.retentionPasses >= 0 && candidate.retentionPasses <= 4);
  assert.ok(candidate.headroomPasses >= 0 && candidate.headroomPasses <= 4);
  assert.ok(candidate.freshAssociationPasses >= 0 && candidate.freshAssociationPasses <= 4);
  assert.ok(candidate.oldAfterFreshPasses >= 0 && candidate.oldAfterFreshPasses <= 4);
  for (const scenario of candidate.scenarios) {
    assert.equal(scenario.weights.allWeightsBounded, true);
    assert.equal(scenario.allWeightsBoundedAfterFresh, true);
    assert.equal(scenario.episodes.initialSingleton, 16);
    assert.equal(scenario.episodes.compositions, 9);
    assert.equal(scenario.episodes.freshAssociation, 32);
  }
}

assert.equal(createdBrains, 20, "five candidates × two seeds × two orders must use independent WASM brains");
assert.equal(activeBrains, 0, "every efficiency-test WASM brain must be disposed");

console.log("NEUROGENESIS plasticity efficiency assertions: passed.");
