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

console.log("NEUROGENESIS WebAssembly C++ core and JavaScript adapter: passed.");
