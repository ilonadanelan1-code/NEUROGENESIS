import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
assert.equal(typeof runtime.createDisposableExperiment, "function");

const source = {
  neurons: [
    { id: "source-input", name: "Источник", type: "sensory", x: 1, y: 2, bias: 0.8, activity: 0 },
    { id: "source-output", name: "Выход", type: "output", x: 3, y: 4, bias: 0.7, activity: 0 }
  ],
  synapses: [
    { from: "source-input", to: "source-output", weight: 0.6 }
  ]
};

const experiment = runtime.createDisposableExperiment(source);
try {
  assert.equal(experiment.disposed, false);
  assert.deepEqual(experiment.baselineSnapshot().neurons.map(row => row.id),
    ["source-input", "source-output"]);
  assert.equal(experiment.baselineSnapshot().synapses[0].weight, Math.fround(0.6));
  assert.equal(experiment.snapshot().synapses[0].weight, Math.fround(0.6));

  const exposedBaseline = experiment.baselineSnapshot();
  exposedBaseline.synapses[0].weight = 0.01;
  assert.equal(experiment.baselineSnapshot().synapses[0].weight, Math.fround(0.6),
    "callers must not be able to mutate the captured baseline through returned snapshots");

  source.synapses[0].weight = 0.2;
  source.neurons[0].name = "Изменённый источник";
  assert.equal(experiment.baselineSnapshot().synapses[0].weight, Math.fround(0.6),
    "the experiment must retain the source state captured at creation time");
  assert.equal(experiment.snapshot().neurons[0].name, "Источник");

  assert.equal(experiment.candidate.setSynapseWeight(
    "source-input", "source-output", 0.35), true);
  const changes = experiment.compare();
  assert.equal(changes.baseline.synapses, 1);
  assert.equal(changes.candidate.synapses, 1);
  assert.equal(changes.changedWeights.length, 1);
  assert.equal(changes.addedEdges.length, 0);
  assert.equal(changes.removedEdges.length, 0);
  assert.equal(changes.changedWeights[0].from, "source-input");
  assert.equal(changes.changedWeights[0].to, "source-output");
  assert.ok(Math.abs(changes.changedWeights[0].baselineWeight - 0.6) < 1e-6);
  assert.ok(Math.abs(changes.changedWeights[0].candidateWeight - 0.35) < 1e-6);
  assert.ok(changes.changedWeights[0].delta < 0);

  const proposal = experiment.exportProposal();
  assert.equal(proposal.format, "NEUROGENESIS_WASM_EXPERIMENT_PROPOSAL");
  assert.equal(proposal.version, 1);
  assert.equal(proposal.policy, "manual-review-only");
  assert.equal(proposal.changes.changedWeights.length, 1);
  assert.equal(Object.hasOwn(proposal, "apply"), false,
    "an experiment report must never provide an automatic apply/commit operation");

  assert.equal(source.synapses[0].weight, 0.2,
    "candidate learning must not mutate the caller's source graph");
} finally {
  experiment.dispose();
}
assert.equal(experiment.disposed, true);
assert.doesNotThrow(() => experiment.dispose(), "experiment disposal must be idempotent");
assert.throws(() => experiment.snapshot(), /already been disposed/u);
assert.throws(() => experiment.baselineSnapshot(), /already been disposed/u);
assert.throws(() => experiment.compare(), /already been disposed/u);
assert.throws(() => experiment.exportProposal(), /already been disposed/u);
assert.throws(() => experiment.candidate.snapshot(), /already been disposed/u);

const authoritativeSource = {
  neurons: [
    { id: "live-input", name: "Вход", type: "sensory", bias: 1, activity: 0 },
    { id: "live-output", name: "Целевой выход", type: "output", bias: 1, activity: 0 }
  ],
  synapses: [
    { from: "live-input", to: "live-output", weight: 0.6 }
  ]
};
const shadow = globalThis.NGWasm.createShadowController({
  runtime,
  getSnapshot: () => authoritativeSource
});
let shadowExperiment = null;
try {
  assert.equal(await shadow.start(), true);
  assert.equal(shadow.stimulate("live-input", 0.8), true);
  assert.equal(shadow.step(0.1, 0.9), true);
  assert.equal(shadow.learn(0.5, 1, 0), 1);
  const shadowLearnedWeight = shadow.snapshot().synapses[0].weight;
  assert.ok(shadowLearnedWeight > 0.6,
    "the control shadow must first contain an experimental weight overlay");

  shadowExperiment = shadow.createExperiment();
  assert.ok(shadowExperiment,
    "a ready shadow controller must create a separate experiment from its source snapshot");
  assert.equal(shadowExperiment.snapshot().synapses[0].weight, Math.fround(0.6),
    "a new candidate must start from the authoritative JavaScript snapshot, not the shadow learning overlay");

  assert.equal(shadowExperiment.candidate.setSynapseWeight(
    "live-input", "live-output", 0.25), true);
  assert.ok(Math.abs(shadowExperiment.snapshot().synapses[0].weight - 0.25) < 1e-6);
  assert.ok(Math.abs(shadow.snapshot().synapses[0].weight - shadowLearnedWeight) < 1e-6,
    "candidate weight changes must not leak into the long-lived shadow network");
  assert.equal(authoritativeSource.synapses[0].weight, 0.6,
    "candidate weight changes must not leak into the authoritative JavaScript network");
} finally {
  if (shadowExperiment) shadowExperiment.dispose();
  shadow.dispose();
}
assert.equal(shadow.createExperiment(), null,
  "a disposed shadow controller must not create new experiments");

console.log("NEUROGENESIS disposable WASM experiment isolation: passed.");
