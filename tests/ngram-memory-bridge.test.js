"use strict";
const assert = require("node:assert/strict");
const predictor = require("../ngram-predictor.js");
const bridgeApi = require("../ngram-memory-bridge.js");

const bridge = bridgeApi.create({ predictor, maxTrainingTokens: 1000 });
const initial = bridge.rebuild([
  { text: "нейрон получает сигнал от соседа" },
  { text: "нейрон получает импульс от соседа" },
  { text: "сеть хранит данные в памяти" }
]);
assert.equal(initial.sourceMemories, 3);
assert.equal(initial.indexedMemories, 3);
assert.ok(initial.available);
assert.ok(initial.model.vocabulary > 10);

// The bridge can recover a competing word from the same two-sided context.
const masked = bridge.predictMasked("нейрон получает импульс от соседа", 2, { limit: 8 });
assert.ok(masked.predictions.some(item => item.token === "сигнал"));
const suggestions = bridge.suggest("нейрон получает импульс от соседа");
assert.ok(suggestions.some(item => item.token === "сигнал"));

// New memories update the active predictor immediately.
const beforeTokens = bridge.status().indexedTokens;
const updated = bridge.addMemory("нейрон получает разряд от соседа");
assert.equal(updated.indexedMemories, 4);
assert.ok(updated.indexedTokens > beforeTokens);
assert.ok(updated.generation > initial.generation);

// Rebuilding from the current memory set removes deleted material and cached suggestions.
const rebuilt = bridge.rebuild([{ text: "сеть хранит данные в памяти" }]);
assert.equal(rebuilt.sourceMemories, 1);
assert.equal(rebuilt.indexedMemories, 1);
assert.deepEqual(bridge.suggest("нейрон получает импульс от соседа"), []);

// The index enforces a bounded training budget and reports omitted memories.
const bounded = bridgeApi.create({ predictor, maxTrainingTokens: 1000 });
const budgetStatus = bounded.rebuild([
  { text: "первое предложение содержит несколько важных слов" },
  { text: "второе предложение содержит несколько важных слов" }
]);
assert.ok(budgetStatus.indexedTokens <= 1000);
assert.equal(budgetStatus.droppedMemories, 0);

console.log("ngram-memory-bridge tests passed");
