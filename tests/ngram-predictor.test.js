"use strict";
const assert = require("node:assert/strict");
const ngram = require("../ngram-predictor.js");

const train = [
  "нейрон получает сигнал от соседа",
  "нейрон получает импульс от соседа",
  "сеть хранит данные в памяти",
  "сеть хранит события в памяти",
  "память сохраняет важные события",
  "нейрон передает сигнал дальше"
];
const model = ngram.create();
const info = model.train(train);
assert.equal(info.sentences, 6);
assert.ok(info.vocabulary > 10);

// Предсказание по двустороннему контексту.
const hit = model.predictMasked("нейрон получает сигнал от соседа", 2, { limit: 3 });
assert.equal(hit.available, true);
assert.ok(hit.predictions.some(p => p.token === "сигнал"), "ожидаем «сигнал» среди кандидатов");

// Вероятности нормированы и отсортированы.
const probs = hit.predictions.map(p => p.probability);
assert.ok(Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-9 || probs.length < 3 || probs.reduce((a, b) => a + b, 0) <= 1 + 1e-9);
for (let i = 1; i < probs.length; i++) assert.ok(probs[i - 1] >= probs[i]);

// Незнакомый контекст: не падаем, отвечаем самыми частотными словами.
const unseen = model.predictMasked("квазар мерцает над горизонтом", 1);
assert.equal(unseen.available, true);

// Границы индекса и пустой ввод.
assert.equal(model.predictMasked("", 0), null);
assert.doesNotThrow(() => model.predictMasked("слово", 99));

// Детерминизм.
const again = model.predictMasked("нейрон получает сигнал от соседа", 2, { limit: 3 });
assert.deepEqual(again, hit);

// Подбор весов использует только переданную validation и не ухудшает её.
const tuned = ngram.create();
tuned.train(train);
const report = tuned.tuneWeights(["нейрон получает сигнал от соседа", "сеть хранит данные в памяти"], { rounds: 1 });
assert.ok(report.tunedValidationAccuracy >= report.initialValidationAccuracy);

// Экспорт/импорт весов.
const copy = ngram.create();
copy.train(train);
copy.setWeights(tuned.getWeights());
assert.deepEqual(copy.getWeights(), tuned.getWeights());

console.log("ngram-predictor tests passed");
