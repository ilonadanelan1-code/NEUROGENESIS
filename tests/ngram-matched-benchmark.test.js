"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ngram = require("../ngram-predictor.js");
const { prepareMatchedData } = require("../scripts/eval-matched-baseline.js");

const sandbox = { console, globalThis: null };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "contextual-attention.js"), "utf8"),
  sandbox,
  { filename: "contextual-attention.js" }
);

const pool = Array.from({ length: 320 }, (_, index) =>
  "исследователь анализирует экспериментальные данные в открытой системе номер " + index + " сегодня"
);
const attention = sandbox.NGContextualModel.create();
const split = prepareMatchedData(attention, pool);

assert.equal(split.train.length, 224);
assert.equal(split.validation.length, 48);
assert.equal(split.test.length, 48);
assert.equal(new Set(split.train).size, 224);
assert.equal(new Set(split.validation).size, 48);
assert.equal(new Set(split.test).size, 48);
assert.equal(new Set([...split.train, ...split.validation, ...split.test]).size, 320);

const ngramModel = ngram.create();
const trained = ngramModel.train(split.train);
assert.equal(trained.sentences, 224);
assert.ok(ngramModel.tuneWeights(split.validation, { rounds: 1 }).tunedValidationAccuracy >= 0);

console.log("ngram matched benchmark split tests passed");
