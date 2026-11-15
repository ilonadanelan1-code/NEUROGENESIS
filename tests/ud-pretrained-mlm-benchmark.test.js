"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const [trainPath, testPath, outputPath] = process.argv.slice(2);
assert.ok(trainPath && testPath && outputPath,
  "usage: node tests/ud-pretrained-mlm-benchmark.test.js TRAIN.conllu TEST.conllu OUTPUT.json");

const window = {};
const sandbox = {window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number};
vm.runInNewContext(fs.readFileSync("contextual-attention.js", "utf8"), sandbox,
  {filename: "contextual-attention.js"});
const api = window.NGContextualModel;
assert.ok(api && typeof api.create === "function", "contextual model API must load");

const prepared = importer.prepareCorpus(
  fs.readFileSync(trainPath, "utf8"),
  fs.readFileSync(testPath, "utf8"),
  {trainLimit: 320, testLimit: 100, seed: 20261125, minimumTokens: 4, maximumTokens: 40}
);
assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps, 0,
  "sampled train/test sentences must be disjoint");

const model = api.create({dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: 9173});
const training = model.train(prepared.trainingTexts,
  {epochs: 40, learningRate: 0.025, patience: 10, splitSeed: 902});
const exported = model.exportState();
const trainingVocabulary = new Set((exported.vocabulary || []).map(normalize));
const contentPOS = new Set(["NOUN", "PROPN", "VERB", "AUX", "ADJ", "ADV", "PRON", "NUM"]);
const cases = [];
let sentenceCount = 0;

for (const sentence of prepared.testRecords) {
  const lexical = sentence.tokens.filter(token =>
    token.form && token.upos !== "PUNCT" && token.upos !== "SYM" &&
    api.tokenize(token.form).length === 1);
  if (lexical.length < 2) continue;
  const forms = lexical.map(token => token.form);
  const normalized = forms.map(normalize);
  const text = forms.join(" ");
  assert.equal(JSON.stringify(api.tokenize(text)), JSON.stringify(normalized),
    "word positions must remain aligned with the model tokenizer");
  const sourceText = sentence.text || text;
  const sourceMatches = [...sourceText.matchAll(/[\p{L}\p{N}]+/gu)];
  const sourceWords = api.tokenize(sourceText);
  const canPreservePunctuation = sourceMatches.length === forms.length &&
    JSON.stringify(sourceWords) === JSON.stringify(normalized);
  sentenceCount++;

  for (let index = 0; index < lexical.length; index++) {
    const target = lexical[index];
    if (!contentPOS.has(target.upos)) continue;
    const maskedForms = forms.slice();
    maskedForms[index] = "NEUROGENESISMASK";
    const result = model.predictMasked(maskedForms.join(" "), index, {limit: 8});
    assert.ok(result && Array.isArray(result.predictions),
      "the existing model must return a prediction list");
    const internalCandidates = result.predictions.map(row => normalize(row.token)).filter(Boolean);
    const gold = normalize(target.form);
    cases.push({
      sentence_id: sentence.sentenceId || null,
      tokens: forms,
      masked_sentence: canPreservePunctuation
        ? sourceText.slice(0, sourceMatches[index].index) + "[MASK]" +
          sourceText.slice(sourceMatches[index].index + sourceMatches[index][0].length)
        : maskedFormsForExternal(forms, index),
      target_index: index,
      gold_form: target.form,
      gold_normalized: gold,
      upos: target.upos,
      in_internal_train_vocabulary: trainingVocabulary.has(gold),
      internal_candidates: internalCandidates.slice(0, 8),
      internal_candidate_count: internalCandidates.length,
      internal_retrieval_candidate: result.retrievalCandidate
        ? normalize(result.retrievalCandidate.token) : null,
      internal_generated_candidates: (result.generatedCandidates || [])
        .map(row => normalize(row.surface)).filter(Boolean).slice(0, 8)
    });
  }
}

assert.ok(cases.length >= 500, "benchmark sample unexpectedly small: " + cases.length);
const payload = {
  schema: "NEUROGENESIS_PRETRAINED_RUSSIAN_MLM_INPUT_V1",
  created_at: new Date().toISOString(),
  corpus: prepared.stats,
  internal_model: {
    schema: api.schema,
    version: api.version,
    config: {dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: 9173},
    training,
    vocabulary_size: trainingVocabulary.size,
    note: "The target position is replaced with a placeholder before calling predictMasked; the predictor excludes that position from context."
  },
  benchmark: {
    task: "single-token masked-word prediction",
    test_sentences_used: sentenceCount,
    masked_targets: cases.length,
    target_POS: [...contentPOS],
    external_model_target_is_masked_by_python_runner: true,
    candidates_are_normalized_lowercase_with_yo_folded: true
  },
  cases
};

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, JSON.stringify(payload));
console.log(JSON.stringify({
  output: outputPath,
  sentences: sentenceCount,
  targets: cases.length,
  train_sentences: prepared.stats.sampledTrainSentences,
  train_test_overlap: prepared.stats.normalizedSampleTrainTestOverlaps,
  model_training: training
}, null, 2));

function maskedFormsForExternal(forms, index) {
  const copy = forms.slice();
  copy[index] = "[MASK]";
  return copy.join(" ");
}

function normalize(value) {
  return String(value == null ? "" : value).normalize("NFKC")
    .toLowerCase().replace(/ё/gu, "е");
}
