"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sandbox = { window: {}, Number, Math, Map, Set, Array };
vm.runInNewContext(fs.readFileSync("activation.js", "utf8"), sandbox, { filename: "activation.js" });
const activation = sandbox.window.NGActivation;
assert.ok(activation);
assert.equal(activation.version, 1);
const pairs = activation.bidirectionalPairs(["A", "B", "A", "C"]);
assert.equal(JSON.stringify(pairs), JSON.stringify([
  ["A","B"],["B","A"],["A","C"],["C","A"],["B","C"],["C","B"]
]), "each co-active memory pair should receive links in both directions");
assert.equal(activation.bidirectionalPairs(["A","B","C"], 2).length, 2);
assert.equal(activation.bidirectionalPairs(["A","",null,"A"]).length, 0);

const chain = activation.spread(
  [{id:"A",strength:0.8}],
  [
    {from:"A",to:"B",weight:0.8},
    {from:"B",to:"C",weight:0.7},
    {from:"C",to:"D",weight:0.9}
  ],
  {maxDepth:2,maxNodes:8,decay:0.5,threshold:0.1}
);
assert.deepEqual(Array.from(chain, item => item.id), ["A","B","C"]);
assert.ok(chain[0].strength > chain[1].strength);
assert.ok(chain[1].strength > chain[2].strength);
assert.equal(chain[2].depth, 2);

const directed = activation.spread(
  ["X"],
  [{from:"Y",to:"X",weight:1}],
  {maxDepth:3}
);
assert.deepEqual(Array.from(directed, item => item.id), ["X"], "activation must follow directed associations only");

const cycle = activation.spread(
  ["A"],
  [{from:"A",to:"B",weight:0.9},{from:"B",to:"A",weight:0.9}],
  {maxDepth:4,maxNodes:8,decay:0.8,threshold:0.01}
);
assert.equal(cycle.length, 2, "cycles must not cause unbounded traversal");

const strongest = activation.spread(
  ["A"],
  [
    {from:"A",to:"C",weight:0.2},
    {from:"A",to:"B",weight:0.9},
    {from:"B",to:"C",weight:0.9}
  ],
  {maxDepth:3,maxNodes:8,decay:0.9,threshold:0.01}
);
assert.ok(strongest.find(item => item.id === "C").strength > 0.4,
  "the strongest path should determine a node's activation");

const limited = activation.spread(
  ["A","B","C"],
  [{from:"A",to:"D",weight:1},{from:"B",to:"E",weight:1},{from:"C",to:"F",weight:1}],
  {maxDepth:2,maxNodes:4,decay:1,threshold:0.01}
);
assert.equal(limited.length, 4, "the activation node budget must be enforced");

const invalid = activation.spread(
  [{id:"",strength:1},{id:"Z",strength:NaN}],
  [{from:"Z",to:"Q",weight:NaN},{from:"Z",to:"Z",weight:1}],
  {}
);
assert.deepEqual(Array.from(invalid, item => item.id), ["Z"]);

const invalidOptions = activation.spread(
  ["A"],
  [{from:"A",to:"B",weight:0.8},{from:"B",to:"C",weight:0.8},{from:"C",to:"D",weight:0.8}],
  {maxDepth:NaN,maxNodes:NaN,decay:NaN,threshold:NaN}
);
assert.ok(invalidOptions.length >= 2 && invalidOptions.length <= 18,
  "invalid options should fall back to safe bounded defaults");
console.log("NEUROGENESIS spreading activation tests: depth, decay, direction, cycles and node budget passed.");
