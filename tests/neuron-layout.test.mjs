import assert from "node:assert/strict";
import "../neuron-layout.js";
const layout = globalThis.NGNeuronLayout;
assert.equal(typeof layout?.separate, "function");

const simple = [
  { id: "a", name: "A", type: "core", x: 0, y: 0, bias: 0.8 },
  { id: "b", name: "B", type: "memory", x: 0, y: 0, bias: 0.6 },
  { id: "c", name: "C", type: "logic", x: 18, y: 0, bias: 0.4 },
  { id: "far", name: "Far", type: "output", x: 800, y: 600, bias: 0.7 }
];
const original = JSON.stringify(simple);
const separated = layout.separate(simple);
assert.ok(separated.overlapsBefore >= 2);
assert.equal(separated.overlapsAfter, 0);
assert.ok(separated.movedCount >= 2);
assert.equal(JSON.stringify(simple), original, "layout must not mutate the source graph");
assert.deepEqual(separated.positions.find(row => row.id === "far"), { id: "far", x: 800, y: 600 });
assert.deepEqual(separated.positions, layout.separate(simple).positions, "layout must be deterministic");
assert.deepEqual(layout.separate(separated.positions).positions, separated.positions, "layout must be stable");

const crowded = Array.from({ length: 183 }, (_, index) => {
  const angle = index * 2.399963229728653, radius = 12 + (index % 17) * 2.1;
  return {
    id: "n" + (index + 1), name: "Узел " + (index + 1),
    type: ["core", "sensory", "memory", "logic", "output"][index % 5],
    x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, bias: 0.5
  };
});
const crowdedResult = layout.separate(crowded);
assert.ok(crowdedResult.overlapsBefore > 1000);
assert.equal(crowdedResult.overlapsAfter, 0, "dense 183-neuron cluster must be separated");
assert.ok(crowdedResult.movedCount > 150);
assert.ok(crowdedResult.minimumDistanceAfter >= crowdedResult.minDistance - 1e-5);
assert.equal(crowdedResult.positions.length, 183);
assert.throws(() => layout.separate([{ id: "x", x: NaN, y: 0 }]), /finite/u);
assert.throws(() => layout.separate([{ id: "same", x: 0, y: 0 }, { id: "same", x: 10, y: 0 }]), /unique/u);
assert.throws(() => layout.separate([], { minDistance: 2 }), /safe bounds/u);
assert.throws(() => layout.separate(
  Array.from({ length: 2501 }, (_, id) => ({ id: String(id), x: id * 100, y: 0 }))
), /2500/u);
console.log("NEUROGENESIS neuron layout: collision removal, deterministic output, stable repeat and 183-node dense-cluster test passed.");
