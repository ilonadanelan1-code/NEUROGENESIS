import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../multi-hop-credit-diagnostic.js";

assert.equal(typeof globalThis.NGMultiHopCreditDiagnostic?.run, "function",
  "the multi-hop credit diagnostic must expose run()");

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const report = await globalThis.NGMultiHopCreditDiagnostic.run({ runtime });

assert.equal(report.kind, "multi-hop hidden-route credit-assignment diagnostic");
assert.equal(report.fixture.neurons, 5);
assert.equal(report.fixture.synapses, 4);
assert.equal(report.fixture.routeDepth, 2);
assert.equal(report.passed, true,
  "the current multi-hop behavior must match the explicitly measured diagnostic");

for (const key of [
  "targetHiddenRouteReceivesEligibility",
  "competingHiddenRouteReceivesEligibility",
  "bothOutputNeuronsActivate",
  "directContrastiveRuleCannotFindMultiHopTargetEdges",
  "directContrastiveRuleStillConsumesTraces",
  "globalRewardStrengthensTargetRoute",
  "globalRewardAlsoStrengthensCompetingRoute",
  "globalRewardConsumesTraces",
  "allWeightsRemainFiniteAndBounded",
  "allTemporaryBrainsDisposed"
]) {
  assert.equal(report.checks[key], true, "multi-hop diagnostic failed: " + key);
}

assert.equal(report.counters.created, 2);
assert.equal(report.counters.disposed, 2);
assert.equal(report.counters.active, 0);

const target = report.routes.find(route => route.label === "target");
const competing = report.routes.find(route => route.label === "competing");
assert.ok(target && competing);
assert.equal(target.edges.length, 2);
assert.equal(competing.edges.length, 2);
assert.ok(target.edges.every(edge => edge.eligibility > 0));
assert.ok(competing.edges.every(edge => edge.eligibility > 0));
assert.equal(report.directContrastive.returnedUpdates, 0);
assert.equal(report.directContrastive.changedEdges.length, 0);
assert.equal(report.directContrastive.tracesConsumed, true);
assert.equal(report.globalReward.targetRouteStrengthened, true);
assert.equal(report.globalReward.competingRouteAlsoStrengthened, true);

await mkdir("benchmark-reports", { recursive: true });
await writeFile(
  "benchmark-reports/multi-hop-credit-diagnostic-v1.json",
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  "NEUROGENESIS multi-hop credit diagnostic: both hidden routes retain traces; " +
  "direct contrastive learning changes 0 edges; global reward strengthens both routes."
);
