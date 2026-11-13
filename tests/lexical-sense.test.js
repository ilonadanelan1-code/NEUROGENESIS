"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
const sandbox = { window, Math, Map, Set, JSON, RegExp, Object, Array, String, Number, Date };
for (const file of ["contextual-attention.js", "lexical-sense.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const Attention = window.NGContextualModel;
const Lexical = window.NGLexicalSenseModel;
assert.ok(Attention && Attention.schema === "NG_CONTEXTUAL_ATTENTION_V5");
assert.ok(Lexical && Lexical.schema === "NG_LEXICAL_SENSE_V1");
const texts = [
  "Ключ открыл тяжелую дверь", "Ключ от двери сломался в замке",
  "Поверни ключ и открой замок", "Секретный ключ шифрует сообщение",
  "Программа проверяет ключ шифрования", "Из земли бьет холодный ключ",
  "Родниковый ключ пробился между камнями", "Вода течет из чистого ключа",
  "Горячий ключ забил у подножия горы", "Старый ключ лежал рядом с дверью",
  "Замок открывается длинным ключом", "Новый ключ подходит к входной двери"
];
const contextual = Attention.create({ dimension: 12, windowSize: 3, heads: 3, blocks: 2, seed: 9173 });
const training = contextual.train(texts, {
  epochs: 12, learningRate: .025, splitSeed: 902, patience: 6, shuffleExamples: true, shuffleSeed: 55173
});
assert.ok(training.examples > 0 && contextual.status().trained);
assert.equal(training.evaluationIsolated, true);
const target = (text, lemma = "ключ") => {
  const tokens = contextual.tokenize(text);
  const index = tokens.findIndex(token => token === "ключ" || token.startsWith("ключ"));
  assert.ok(index >= 0, "target word must be present: " + text);
  return { text, targetIndex: index, targetForm: tokens[index], lemma };
};
const trainPairs = [
  { left: target("Ключ открыл тяжелую дверь"), right: target("Старый ключ лежал рядом с дверью"), label: 1, lemma: "ключ" },
  { left: target("Ключ открыл тяжелую дверь"), right: target("Из земли бьет холодный ключ"), label: 0, lemma: "ключ" },
  { left: target("Секретный ключ шифрует сообщение"), right: target("Программа проверяет ключ шифрования"), label: 1, lemma: "ключ" },
  { left: target("Секретный ключ шифрует сообщение"), right: target("Горячий ключ забил у подножия горы"), label: 0, lemma: "ключ" },
  { left: target("Поверни ключ и открой замок"), right: target("Замок открывается длинным ключом"), label: 1, lemma: "ключ" },
  { left: target("Вода течет из чистого ключа"), right: target("Из земли бьет холодный ключ"), label: 1, lemma: "ключ" },
  { left: target("Вода течет из чистого ключа"), right: target("Секретный ключ шифрует сообщение"), label: 0, lemma: "ключ" },
  { left: target("Старый ключ лежал рядом с дверью"), right: target("Программа проверяет ключ шифрования"), label: 0, lemma: "ключ" }
];
const validationPairs = [
  { left: target("Ключ от двери сломался в замке"), right: target("Старый ключ лежал рядом с дверью"), label: 1, lemma: "ключ" },
  { left: target("Ключ от двери сломался в замке"), right: target("Родниковый ключ пробился между камнями"), label: 0, lemma: "ключ" },
  { left: target("Новый ключ подходит к входной двери"), right: target("Поверни ключ и открой замок"), label: 1, lemma: "ключ" },
  { left: target("Новый ключ подходит к входной двери"), right: target("Вода течет из чистого ключа"), label: 0, lemma: "ключ" }
];
const lexical = Lexical.create();
const report = lexical.train(trainPairs, validationPairs, contextual, {
  epochs: 180, learningRate: .08, patience: 24, l2: .003
});
assert.ok(report.baselineTrainCovered >= 6);
assert.ok(report.contextualTrainCovered >= 6);
assert.ok(report.baselineValidationCovered >= 2);
assert.ok(report.contextualValidationCovered >= 2);
assert.equal(report.selectionMetric, "validation_log_loss");
assert.equal(lexical.status().trained, true);
const evaluated = lexical.evaluate(validationPairs, contextual);
assert.equal(evaluated.total, validationPairs.length);
assert.equal(evaluated.baseline.count, validationPairs.length);
assert.equal(evaluated.contextual.count, validationPairs.length);
assert.equal(evaluated.contextual.coverage, 1);
assert.ok(Number.isFinite(evaluated.contextual.accuracy));
assert.ok(Number.isFinite(evaluated.contextual.macroF1));
assert.ok(Number.isFinite(evaluated.pairedDeltaPP));
const prediction = lexical.predictPair(validationPairs[0], contextual);
assert.ok(prediction);
assert.ok(prediction.sameSenseProbability >= 0 && prediction.sameSenseProbability <= 1);
assert.ok(prediction.baselineSameSenseProbability >= 0 && prediction.baselineSameSenseProbability <= 1);
assert.equal(prediction.contextualAvailable, true);
const maskedA = contextual.score("Ключ открыл тяжелую дверь", 0);
const maskedB = contextual.score("Замок открыл тяжелую дверь", 0);
assert.equal(JSON.stringify(maskedA.contextualVector), JSON.stringify(maskedB.contextualVector),
  "the target surface must not leak into the masked contextual vector");
assert.notEqual(JSON.stringify(maskedA.tokenVector), JSON.stringify(maskedB.tokenVector),
  "the target identity is retained separately from its context representation");
const state = lexical.exportState();
const restored = Lexical.create();
assert.equal(restored.loadState(state).trained, true);
assert.equal(JSON.stringify(restored.predictPair(validationPairs[0], contextual)), JSON.stringify(prediction),
  "lexical-sense classifier state must reproduce predictions");
const malformed = lexical.exportState();
malformed.contextualClassifier.weights.pop();
assert.throws(() => Lexical.create().loadState(malformed), /malformed/u);
console.log("NEUROGENESIS lexical sense v1: masked contextual comparison, Russian form hints, paired baseline and checkpoint persistence passed.");