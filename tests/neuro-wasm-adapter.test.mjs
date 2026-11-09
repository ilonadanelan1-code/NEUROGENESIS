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
  assert.deepEqual(edge, {
    from: sensory,
    to: output,
    weight: Math.fround(0.5),
    signal: Math.fround(0.2)
  });
  assert.equal(brain.getNeuronAt(99), null);
  assert.equal(brain.getSynapseAt(99), null);

  const snapshot = brain.snapshot();
  assert.equal(snapshot.neurons.length, 2);
  assert.equal(snapshot.synapses.length, 1);

  assert.throws(() => brain.addNeuron("bad", "unknown"), /kind must be/u);
  assert.throws(() => brain.step(-0.1), /cannot be negative/u);
  assert.throws(() => brain.step(Number.NaN), /finite number/u);
  assert.throws(() => brain.addNeuron("bad", "logic", Number.NaN, 0), /finite number/u);
} finally {
  brain.dispose();
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
    lastError: null
  });

  assert.equal(shadow.stimulate("n-source", 0.2), true);
  assert.equal(shadow.stimulate("missing-neuron", 0.2), false);
  assert.equal(shadow.step(0.1), true);

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

  sourceNetwork.neurons = sourceNetwork.neurons.filter(row => row.id !== "duplicate");
  assert.equal(shadow.rebuild(), true, "the mirror must recover after its source snapshot is repaired");
  assert.equal(shadow.diagnostics().lastError, null);
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
unavailable.dispose();

console.log("NEUROGENESIS WebAssembly C++ core and JavaScript adapter: passed.");
