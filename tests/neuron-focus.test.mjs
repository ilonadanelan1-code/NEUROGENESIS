import assert from "node:assert/strict";
import "../neuron-focus.js";

const focus = globalThis.NGNeuronFocus;
assert.equal(typeof focus?.build, "function");

const neurons = [
  { id: "a", type: "core" },
  { id: "b", type: "memory" },
  { id: "c", type: "logic" },
  { id: "d", type: "output" },
  { id: "e", type: "sensory" },
  { id: "z", type: "sensory" }
];
const synapses = [
  { from: "a", to: "b" },
  { from: "c", to: "a" },
  { from: "b", to: "d" },
  { from: "e", to: "d" }
];

const selected = focus.build(neurons, synapses, "a");
assert.deepEqual(selected.selectedId, "a");
assert.deepEqual([...selected.nodeIds], ["a", "b", "c"]);
assert.deepEqual([...selected.edgeKeys], ["a\u0000b", "c\u0000a"]);
assert.ok(Object.isFrozen(selected));
assert.ok(Object.isFrozen(selected.nodeIds));
assert.ok(Object.isFrozen(selected.edgeKeys));

const noSelection = focus.build(neurons, synapses, null);
assert.equal(noSelection, null);
const unknownSelection = focus.build(neurons, synapses, "missing");
assert.equal(unknownSelection, null);
assert.equal(focus.build([], synapses, "a"), null);
assert.equal(focus.build(neurons, [], "a").nodeIds.length, 1);

const isolated = focus.build(neurons, synapses, "z");
assert.deepEqual([...isolated.nodeIds], ["z"]);
assert.deepEqual([...isolated.edgeKeys], []);

console.log("NEUROGENESIS neuron focus: incoming/outgoing neighborhood, unrelated-edge exclusion, isolated nodes and invalid selections passed.");
