import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";
import "../disposable-experiment-session.js";

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const source = {
  neurons: [
    { id: "trial-input", name: "Вход", type: "sensory", x: 0, y: 0, bias: 1, activity: 0.7 },
    { id: "trial-positive", name: "Правильный выход", type: "output", x: 1, y: 0, bias: 1, activity: 0.2 },
    { id: "trial-negative", name: "Конкурирующий выход", type: "output", x: 2, y: 0, bias: 1, activity: 0.1 },
    { id: "trial-other", name: "Побочная ветвь", type: "memory", x: 3, y: 0, bias: 1, activity: 0.3 }
  ],
  synapses: [
    { from: "trial-input", to: "trial-positive", weight: 0.6, eligibility: 0.8 },
    { from: "trial-input", to: "trial-negative", weight: 0.5, eligibility: 0.7 },
    { from: "trial-input", to: "trial-other", weight: 0.4, eligibility: 0.6 }
  ]
};
const sourceBefore = JSON.parse(JSON.stringify(source));
const shadow = globalThis.NGWasm.createShadowController({
  runtime,
  getSnapshot: () => source
});
let createdExperiment = null;
let receivedOptions = null;

try {
  assert.equal(await shadow.start(), true);
  const shadowBefore = shadow.snapshot();
  const result = globalThis.NGDisposableExperimentSession.runContrastiveTrial({
    createExperiment: options => {
      receivedOptions = options;
      createdExperiment = shadow.createExperiment(options);
      return createdExperiment;
    },
    inputId: "trial-input",
    positiveId: "trial-positive",
    negativeId: "trial-negative",
    steps: 6,
    stimulus: 0.8,
    positiveLearningRate: 0.02,
    negativeLearningRate: 1,
    deltaSeconds: 0.1,
    eligibilityRetention: 0.9
  });

  assert.deepEqual(receivedOptions, { resetState: true },
    "a live trial must start from a fresh activation/eligibility state");
  assert.ok(createdExperiment, "the shadow controller must provide a disposable candidate");
  assert.equal(createdExperiment.disposed, true,
    "the session must dispose its candidate after producing the proposal");
  assert.throws(() => createdExperiment.snapshot(), /already been disposed/u);
  assert.equal(result.ok, true, result.message || "the contrastive trial should create a proposal");
  assert.equal(result.code, "proposal-ready");
  assert.equal(result.report.changedSynapses, 2);
  assert.equal(result.report.updates, 2);
  assert.ok(result.report.positive.eligibility > 0);
  assert.ok(result.report.negative.eligibility > 0);
  assert.ok(result.report.positive.activationBeforeLearning > 0);
  assert.ok(result.report.negative.activationBeforeLearning > 0);
  assert.ok(result.report.positive.weightAfter > result.report.positive.weightBefore);
  assert.ok(result.report.negative.weightAfter < result.report.negative.weightBefore);
  assert.equal(result.report.changes.changedWeights.length, 2);
  assert.deepEqual(
    result.report.changes.changedWeights.map(edge => [edge.from, edge.to]).sort(),
    [["trial-input", "trial-negative"], ["trial-input", "trial-positive"]]
  );
  assert.equal(result.report.changes.addedEdges.length, 0);
  assert.equal(result.report.changes.removedEdges.length, 0);
  assert.equal(result.proposal.policy, "manual-review-only");
  assert.equal(Object.hasOwn(result.proposal, "apply"), false);

  assert.deepEqual(source, sourceBefore,
    "the authoritative JavaScript snapshot must not be mutated by the candidate");
  assert.deepEqual(shadow.snapshot(), shadowBefore,
    "candidate correction must not leak into the long-lived WASM shadow");
} finally {
  shadow.dispose();
}

const noDirectRoutes = {
  neurons: [
    { id: "no-input", name: "Вход", type: "sensory", bias: 1 },
    { id: "hidden", name: "Скрытый узел", type: "logic", bias: 1 },
    { id: "no-positive", name: "Выход A", type: "output", bias: 1 },
    { id: "no-negative", name: "Выход B", type: "output", bias: 1 }
  ],
  synapses: [
    { from: "no-input", to: "hidden", weight: 0.8 },
    { from: "hidden", to: "no-positive", weight: 0.8 },
    { from: "hidden", to: "no-negative", weight: 0.8 }
  ]
};
const rejected = globalThis.NGDisposableExperimentSession.runContrastiveTrial({
  createExperiment: options => runtime.createDisposableExperiment({
    neurons: noDirectRoutes.neurons.map(row => ({ ...row, activity: 0 })),
    synapses: noDirectRoutes.synapses.map(row => ({ ...row, eligibility: 0 }))
  }),
  inputId: "no-input",
  positiveId: "no-positive",
  negativeId: "no-negative"
});
assert.equal(rejected.ok, false);
assert.equal(rejected.code, "direct-routes-required",
  "the current contrastive rule must not pretend it can correct indirect paths");

console.log("NEUROGENESIS disposable contrastive trial session: passed.");
