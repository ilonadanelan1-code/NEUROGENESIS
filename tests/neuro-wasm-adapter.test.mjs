import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";

assert.equal(typeof globalThis.NGWasm?.load, "function",
  "the browser adapter must expose a load() method");

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
assert.equal(runtime.version, 1);
assert.equal(typeof runtime.createBrain, "function");

const brain = runtime.createBrain();
try {
  assert.equal(brain.neuronCount, 0);
  assert.equal(brain.synapseCount, 0);

  const sensory = brain.addNeuron("Восприятие", "sensory", 1, 2, 0.8);
  const output = brain.addNeuron("Реакция", "output", 3, 4, 0.75);

  assert.ok(sensory > 0 && output > sensory);
  assert.equal(brain.addSynapse(sensory, output, 0.5), true);
  assert.equal(brain.addSynapse(sensory, output, 0.5), false);
  assert.equal(brain.addSynapse(sensory, sensory, 0.5), false);

  assert.equal(brain.stimulate(sensory, 0.4), true);
  brain.step(0.1);

  const first = brain.getNeuronAt(0);
  const second = brain.getNeuronAt(1);
  const edge = brain.getSynapseAt(0);

  assert.deepEqual(first, {
    id: sensory,
    name: "Восприятие",
    kind: "sensory",
    activation: Math.fround(0.335),
    excitability: Math.fround(0.8),
    x: Math.fround(1),
    y: Math.fround(2)
  });
  assert.equal(second.id, output);
  assert.equal(second.kind, "output");
  assert.ok(second.activation > 0, "the signal should propagate through the native C++ core");
  assert.deepEqual({
    from: edge.from, to: edge.to, weight: edge.weight, signal: edge.signal
  }, {
    from: sensory,
    to: output,
    weight: Math.fround(0.5),
    signal: Math.fround(0.2)
  });
  assert.ok(edge.eligibility > 0 && edge.eligibility <= 1,
    "the adapter must expose the eligibility trace accumulated during a simulation step");
  assert.equal(brain.getNeuronAt(99), null);
  assert.equal(brain.getSynapseAt(99), null);

  const snapshot = brain.snapshot();
  assert.equal(snapshot.neurons.length, 2);
  assert.equal(snapshot.synapses.length, 1);

  const directWeightBeforeLearning = brain.getSynapseAt(0).weight;
  assert.equal(brain.learn(0.5, 1, 0), 1,
    "the WebAssembly core must expose reward-modulated learning");
  assert.ok(brain.getSynapseAt(0).weight > directWeightBeforeLearning);
  assert.ok(brain.getSynapseAt(0).eligibility > 0,
    "immediate Hebbian learning must leave the sequence trace available");
  assert.equal(brain.learnFromReward(0.5, 1, 0), 1,
    "the adapter must expose delayed reward learning");
  assert.equal(brain.getSynapseAt(0).eligibility, 0,
    "applying delayed reward must consume the eligibility trace");
  assert.equal(brain.setSynapseWeight(sensory, output, 0.5), true,
    "the adapter must expose exact synapse-weight restoration");
  assert.equal(brain.getSynapseAt(0).weight, Math.fround(0.5));
  assert.equal(brain.setSynapseWeight(output, sensory, 0.5), false,
    "weight restoration must not create a new synapse");

  assert.throws(() => brain.addNeuron("bad", "unknown"), /kind must be/u);
  assert.throws(() => brain.step(-0.1), /cannot be negative/u);
  assert.throws(() => brain.step(Number.NaN), /finite number/u);
  assert.throws(() => brain.addNeuron("bad", "logic", Number.NaN, 0), /finite number/u);
} finally {
  brain.dispose();
}

const contrastiveBrain = runtime.createBrain();
try {
  const input = contrastiveBrain.addNeuron("input", "sensory", 0, 0, 1);
  const positive = contrastiveBrain.addNeuron("positive", "output", 1, 0, 1);
  const negative = contrastiveBrain.addNeuron("negative", "output", 1, 1, 1);
  const neutral = contrastiveBrain.addNeuron("neutral", "output", 1, 2, 1);
  assert.equal(contrastiveBrain.addSynapse(input, positive, 0.5), true);
  assert.equal(contrastiveBrain.addSynapse(input, negative, 0.4), true);
  assert.equal(contrastiveBrain.addSynapse(input, neutral, 0.3), true);
  assert.equal(contrastiveBrain.setSynapseEligibility(input, positive, 0.8), true);
  assert.equal(contrastiveBrain.setSynapseEligibility(input, negative, 0.6), true);
  assert.equal(contrastiveBrain.setSynapseEligibility(input, neutral, 0.7), true);
  assert.equal(contrastiveBrain.learnContrastiveReward(0.5, input, positive, negative), 2);
  const rows = contrastiveBrain.snapshot().synapses;
  assert.ok(Math.abs(rows[0].weight - 0.9) < 1e-6);
  assert.ok(Math.abs(rows[1].weight - 0.1) < 1e-6);
  assert.equal(rows[2].weight, Math.fround(0.3));
  assert.ok(rows.every(row => row.eligibility === 0));
} finally {
  contrastiveBrain.dispose();
}

const mappedContrastive = runtime.createBrainFromSnapshot({
  neurons: [
    { id: "mapped-input", name: "input", type: "sensory" },
    { id: "mapped-positive", name: "positive", type: "output" },
    { id: "mapped-negative", name: "negative", type: "output" }
  ],
  synapses: [
    { from: "mapped-input", to: "mapped-positive", weight: 0.5 },
    { from: "mapped-input", to: "mapped-negative", weight: 0.4 }
  ]
});
try {
  assert.equal(mappedContrastive.setSynapseEligibility("mapped-input", "mapped-positive", 0.8), true);
  assert.equal(mappedContrastive.setSynapseEligibility("mapped-input", "mapped-negative", 0.6), true);
  assert.equal(mappedContrastive.learnContrastiveReward(0.5, "mapped-input", "mapped-positive", "mapped-negative"), 2,
    "snapshot mirrors must map source neuron IDs to contrastive core targets");
  const rows = mappedContrastive.snapshot().synapses;
  assert.ok(Math.abs(rows[0].weight - 0.9) < 1e-6);
  assert.ok(Math.abs(rows[1].weight - 0.1) < 1e-6);
} finally {
  mappedContrastive.dispose();
}

const contrastiveSource = {
  neurons: [
    { id: "contrast-input", name: "input", type: "sensory", bias: 1, activity: 0 },
    { id: "contrast-positive", name: "positive", type: "output", bias: 1, activity: 0 },
    { id: "contrast-negative", name: "negative", type: "output", bias: 1, activity: 0 }
  ],
  synapses: [
    { from: "contrast-input", to: "contrast-positive", weight: 0.5 },
    { from: "contrast-input", to: "contrast-negative", weight: 0.4 }
  ]
};
const contrastiveShadow = globalThis.NGWasm.createShadowController({
  runtime,
  getSnapshot: () => contrastiveSource
});
try {
  assert.equal(await contrastiveShadow.start(), true);
  assert.equal(contrastiveShadow.stimulate("contrast-input", 0.8), true);
  assert.equal(contrastiveShadow.stimulate("contrast-positive", 0.6), true);
  assert.equal(contrastiveShadow.stimulate("contrast-negative", 0.5), true);
  assert.equal(contrastiveShadow.step(0.1, 0.9), true);
  assert.ok(contrastiveShadow.snapshot().synapses.every(row => row.eligibility > 0));
  assert.equal(contrastiveShadow.learnContrastiveReward(
    0.5, "contrast-input", "contrast-positive", "contrast-negative"), 2);
  const rows = contrastiveShadow.snapshot().synapses;
  assert.ok(rows[0].weight > 0.5);
  assert.ok(rows[1].weight < 0.4);
  assert.ok(rows.every(row => row.eligibility === 0));
  assert.equal(contrastiveShadow.diagnostics().sequenceRewards, 1);
} finally {
  contrastiveShadow.dispose();
}

assert.throws(() => brain.snapshot(), /already been disposed/u);
assert.doesNotThrow(() => brain.dispose(), "dispose() must be idempotent");

const sourceNetwork = {
  neurons: [
    { id: "n-source", name: "Сенсор", type: "sensory", x: 2, y: 4, bias: 0.8, activity: 0.3 },
    { id: "n-output", name: "Выход", type: "output", x: 6, y: 8, bias: 0.75, activity: 0 }
  ],
  synapses: [
    { from: "n-source", to: "n-output", weight: 0.6 }
  ]
};
const shadow = globalThis.NGWasm.createShadowController({
  runtime,
  getSnapshot: () => sourceNetwork
});
try {
  assert.equal(await shadow.start(), true, "the shadow controller should start with a real WASM runtime");
  assert.deepEqual(shadow.diagnostics(), {
    backend: "wasm-shadow",
    authority: "javascript",
    state: "ready",
    neurons: 2,
    synapses: 1,
    steps: 0,
    stimulations: 0,
    rebuilds: 1,
    learningUpdates: 0,
    sequenceRewards: 0,
    learnedSynapses: 0,
    lastError: null
  });

  assert.equal(shadow.stimulate("n-source", 0.2), true);
  assert.equal(shadow.stimulate("missing-neuron", 0.2), false);
  assert.equal(shadow.step(0.1), true);

  const traceBeforeLearning = shadow.snapshot().synapses[0].eligibility;
  assert.ok(traceBeforeLearning > 0, "shadow steps must accumulate sequence eligibility");
  const sourceWeightBeforeLearning = shadow.snapshot().synapses[0].weight;
  assert.equal(shadow.learn(0.5, 1, 0), 1,
    "the shadow controller must expose controlled Hebbian learning");
  const learnedWeight = shadow.snapshot().synapses[0].weight;
  assert.ok(learnedWeight > sourceWeightBeforeLearning);
  assert.deepEqual(shadow.learnedWeights(), [{
    from: "n-source",
    to: "n-output",
    baseWeight: 0.6,
    weight: learnedWeight
  }]);
  assert.equal(shadow.diagnostics().learningUpdates, 1);
  assert.equal(shadow.diagnostics().learnedSynapses, 1);

  const mirrored = shadow.snapshot();
  assert.deepEqual(mirrored.neurons.map(row => row.id), ["n-source", "n-output"]);
  assert.ok(mirrored.neurons[0].activity > 0.43 && mirrored.neurons[0].activity < 0.44);
  assert.ok(mirrored.neurons[1].activity > 0.22 && mirrored.neurons[1].activity < 0.23,
    "the mirrored signal should propagate inside the C++ core");
  assert.equal(mirrored.synapses[0].from, "n-source");
  assert.equal(mirrored.synapses[0].to, "n-output");

  sourceNetwork.neurons.push({
    id: "n-memory", name: "Память", type: "memory", x: 9, y: 12, bias: 0.55, activity: 0.1
  });
  sourceNetwork.synapses.push({ from: "n-output", to: "n-memory", weight: 0.4 });
  assert.equal(shadow.rebuild(), true, "the shadow network must be rebuildable from the latest JS snapshot");
  assert.equal(shadow.diagnostics().neurons, 3);
  assert.equal(shadow.diagnostics().synapses, 2);
  assert.ok(Math.abs(shadow.snapshot().synapses[0].weight - learnedWeight) < 1.0e-6,
    "learned weights must survive structural snapshot rebuilds");
  assert.ok(Math.abs(shadow.snapshot().synapses[0].eligibility - traceBeforeLearning) < 1.0e-6,
    "eligibility traces must survive rebuilds when the source edge remains unchanged");

  const exportedLearning = shadow.learnedWeights();
  assert.equal(shadow.restoreLearnedWeights(exportedLearning), true,
    "learned weights must support explicit export and restore");

  const beforeFailedRebuild = shadow.snapshot();
  sourceNetwork.neurons.push({
    id: "duplicate", name: "Повтор", type: "logic", x: 0, y: 0, bias: 0.5, activity: 0
  });
  sourceNetwork.neurons.push({
    id: "duplicate", name: "Дубликат", type: "logic", x: 0, y: 0, bias: 0.5, activity: 0
  });
  assert.equal(shadow.rebuild(), false, "an invalid snapshot must not replace a working mirror");
  assert.equal(shadow.diagnostics().state, "ready");
  assert.equal(shadow.diagnostics().neurons, 3);
  assert.equal(shadow.snapshot().neurons.length, beforeFailedRebuild.neurons.length);
  assert.match(shadow.diagnostics().lastError, /unique/u);

  const overlayBeforeFailedRestore = shadow.learnedWeights();
  assert.equal(shadow.restoreLearnedWeights([{
    from: "n-source", to: "n-output", baseWeight: 0.6, weight: 0.9
  }]), false, "a failed snapshot rebuild must reject the imported overlay");
  assert.deepEqual(shadow.learnedWeights(), overlayBeforeFailedRestore,
    "failed learned-weight import must preserve the previous overlay");

  sourceNetwork.neurons = sourceNetwork.neurons.filter(row => row.id !== "duplicate");
  assert.equal(shadow.rebuild(), true, "the mirror must recover after its source snapshot is repaired");
  assert.equal(shadow.diagnostics().lastError, null);
  assert.ok(Math.abs(shadow.snapshot().synapses[0].weight - learnedWeight) < 1.0e-6,
    "a repaired snapshot must not discard a valid learned overlay");
  const beforeSequenceReward = shadow.snapshot().synapses[0].weight;
  assert.equal(shadow.learnFromReward(0.25, 1, 0), 1,
    "the shadow controller must apply delayed reward to the retained sequence trace");
  assert.ok(shadow.snapshot().synapses[0].weight > beforeSequenceReward);
  assert.equal(shadow.snapshot().synapses[0].eligibility, 0);
  assert.equal(shadow.diagnostics().sequenceRewards, 1);
  assert.equal(shadow.resetEligibility(), true);
} finally {
  shadow.dispose();
}
assert.equal(shadow.diagnostics().state, "disposed");
assert.equal(shadow.step(0.1), false);

const unavailable = globalThis.NGWasm.createShadowController({
  getSnapshot: () => ({ neurons: [], synapses: [] }),
  moduleFactory: async () => { throw new Error("synthetic module load failure"); }
});
assert.equal(await unavailable.start(), false);
assert.equal(unavailable.diagnostics().state, "unavailable");
assert.match(unavailable.diagnostics().lastError, /synthetic module load failure/u);
assert.equal(unavailable.step(0.1), false);
assert.equal(unavailable.learnFromReward(0.1, 1, 0), 0);
assert.equal(unavailable.resetEligibility(), false);
unavailable.dispose();

console.log("NEUROGENESIS WebAssembly C++ core and JavaScript adapter: passed.");
