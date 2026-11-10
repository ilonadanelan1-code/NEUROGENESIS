import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../plasticity-headroom-benchmark.js";

assert.equal(typeof globalThis.NGPlasticityHeadroomBenchmark?.run, "function",
  "the asymmetric plasticity benchmark must expose run()");

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

const report = globalThis.NGPlasticityHeadroomBenchmark.run({ runtime });

const reportDirectory = process.env.NG_BENCHMARK_REPORT_DIR || "benchmark-reports";
const reportPath = join(reportDirectory, "plasticity-headroom-v4.json");
await mkdir(reportDirectory, { recursive: true });
const reportArtifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  benchmark: report.kind,
  benchmarkVersion: globalThis.NGPlasticityHeadroomBenchmark.version,
  report
};
await writeFile(reportPath, JSON.stringify(reportArtifact, null, 2) + "\n", "utf8");
const persistedArtifact = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(persistedArtifact.report.kind, report.kind);
assert.equal(persistedArtifact.report.passed, report.passed);
console.log("NEUROGENESIS plasticity report artifact saved: " + reportPath);
console.log("NEUROGENESIS asymmetric plasticity headroom benchmark: " + JSON.stringify({
  passed: report.passed,
  protocol: report.protocol,
  checks: report.checks,
  comparisons: report.comparisons,
  scenarios: report.scenarios.map(row => ({
    mode: row.mode, seed: row.seed, order: row.trainingOrder,
    retained: row.retentionPassed, headroom: row.headroomPassed,
    maxCorrectWeight: row.weights.maxCorrectWeight,
    meanUnusedHeadroom: row.weights.meanUnusedHeadroom,
    saturatedCorrectEdges: row.weights.saturatedCorrectEdges,
    crossMax: row.weights.maxCrossWeight,
    baseline: {
      minExpected: row.baseline.minExpected,
      maxUnexpected: row.baseline.maxUnexpected,
      maxOrderSpread: row.baseline.maxOrderSpread,
      passed: row.baseline.passed
    },
    retained: {
      minExpected: row.retained.minExpected,
      maxUnexpected: row.retained.maxUnexpected,
      maxOrderSpread: row.retained.maxOrderSpread,
      passed: row.retained.passed
    },
    freshAssociation: row.freshAssociation,
    oldAfterFresh: {
      minExpected: row.oldAfterFresh.minExpected,
      maxUnexpected: row.oldAfterFresh.maxUnexpected,
      maxOrderSpread: row.oldAfterFresh.maxOrderSpread,
      passed: row.oldAfterFresh.passed
    },
    episodes: row.episodes
  })),
  createdBrains, activeBrains
}));

assert.equal(report.kind, "NEUROGENESIS asymmetric plasticity headroom benchmark");
assert.equal(report.passed, true, "the asymmetric strategy must retain old mappings, headroom and new-learning ability");
assert.deepEqual(report.protocol.seeds, [101, 211]);
assert.equal(report.protocol.featureCount, 4);
assert.equal(report.protocol.outputCount, 5);
assert.equal(report.protocol.heldOutCombinationCount, 11);
assert.equal(report.protocol.heldOutPermutationCount, 60);
assert.equal(report.protocol.cycles, 3);
assert.equal(report.protocol.modes.length, 4);
assert.equal(report.protocol.compositionUpdateRule, "homeostatic");
assert.equal(report.protocol.compositionLearningRate, 0.05);
assert.equal(report.protocol.freshAssociationSweeps, 8);
assert.equal(report.scenarios.length, 16);
assert.equal(report.checks.allScenariosCompleted, true);
assert.equal(report.checks.allAsymmetricScenariosRetainOldMappings, true);
assert.equal(report.checks.allAsymmetricScenariosKeepPlasticityHeadroom, true);
assert.equal(report.checks.allAsymmetricScenariosLearnFreshAssociation, true);
assert.equal(report.checks.allOldMappingsSurviveFreshLearning, true);
assert.equal(report.checks.allWeightsBounded, true);
assert.equal(report.checks.controlsAreReported, true);
assert.equal(report.comparisons.boundedSymmetricHeadroomPasses >= 0, true);

for (const scenario of report.scenarios) {
  assert.equal(scenario.baseline.passed, true, scenario.mode + " baseline map");
  assert.equal(scenario.retained.heldOutPatterns, 11);
  assert.equal(scenario.retained.permutations, 60);
  for (const pattern of scenario.retained.heldOut) {
    assert.equal(typeof pattern.maxUnexpectedOutput, "string");
    assert.ok(Number.isFinite(pattern.maxUnexpectedOutputActivation));
    assert.ok(Array.isArray(pattern.maxUnexpectedOrder));
  }
  assert.equal(scenario.weights.allWeightsBounded, true);
  assert.equal(scenario.allWeightsBoundedAfterFresh, true);
  assert.equal(scenario.episodes.initialSingleton, 16);
  assert.equal(scenario.episodes.compositions, 9);
  assert.equal(scenario.episodes.freshAssociation, 32);
}
for (const scenario of report.scenarios.filter(row => row.mode === "asymmetric")) {
  assert.equal(scenario.retentionPassed, true, "asymmetric replay lost an old feature mapping");
  assert.equal(scenario.headroomPassed, true, "asymmetric replay consumed the reserved plasticity headroom");
  assert.equal(scenario.weights.saturatedCorrectEdges, 0);
  assert.ok(scenario.weights.maxCorrectWeight <= 0.95);
  assert.equal(scenario.freshAssociation.passed, true, "asymmetric replay could not learn a fresh feature");
  assert.ok(scenario.freshAssociation.targetActivation >= 0.15);
  assert.ok(scenario.freshAssociation.maxUnexpectedActivation <= 0.05);
  assert.equal(scenario.oldAfterFresh.passed, true,
    "learning the fresh feature must not erase the previous feature combinations");
}

assert.equal(createdBrains, 16, "every mode/seed/order combination must use an independent WASM brain");
assert.equal(activeBrains, 0, "every benchmark WASM brain must be disposed");
assert.equal(report.createdBrains, createdBrains);
assert.equal(report.protocol.modes.find(mode => mode.id === "asymmetric").positiveRate, 0.02);
assert.equal(report.protocol.modes.find(mode => mode.id === "asymmetric").negativeRate, 0.70);

console.log("NEUROGENESIS asymmetric plasticity headroom assertions: passed.");
