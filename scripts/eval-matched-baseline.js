"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ngram = require("../ngram-predictor.js");

const SPLIT_SEED = 902;
const TARGET_TRAIN_SENTENCES = 320;
const DEFAULT_POOL_SENTENCES = 458;

function readRows(file, limit) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).map(s => s.trim()).filter(Boolean).slice(0, limit);
}
function makeAttention(candidatePool) {
  const sandbox = { console, globalThis: null };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, "..", "contextual-attention.js"), "utf8");
  vm.runInContext(source, sandbox, { filename: "contextual-attention.js" });
  if (!sandbox.NGContextualModel) throw new Error("NGContextualModel did not load");
  const model = sandbox.NGContextualModel.create();
  model.train(candidatePool, { epochs: 8, splitSeed: SPLIT_SEED });
  return model;
}
function prepareMatchedData(attentionModel, candidatePool) {
  if (!attentionModel || typeof attentionModel.splitCorpus !== "function") {
    throw new TypeError("Attention model must expose its deterministic corpus split.");
  }
  const split = attentionModel.splitCorpus(candidatePool, SPLIT_SEED);
  if (split.train.length !== TARGET_TRAIN_SENTENCES) {
    throw new Error(
      "Expected exactly " + TARGET_TRAIN_SENTENCES + " actual training sentences; got " +
      split.train.length + ". Adjust BENCHMARK_POOL_SENTENCES (currently " + candidatePool.length + ")."
    );
  }
  if (!split.validation.length || !split.test.length) {
    throw new Error("Matched comparison requires non-empty validation and internal holdout subsets.");
  }
  return split;
}
function evaluate(predict, rows) {
  let positions = 0, top1 = 0, top5 = 0, top8 = 0;
  for (const row of rows) {
    const tokens = ngram.tokenize(row);
    for (let i = 0; i < tokens.length; i++) {
      const predictions = predict(tokens, i);
      positions++;
      if (predictions[0] === tokens[i]) top1++;
      if (predictions.slice(0, 5).includes(tokens[i])) top5++;
      if (predictions.slice(0, 8).includes(tokens[i])) top8++;
    }
  }
  return {
    positions,
    top1: positions ? top1 / positions : 0,
    top5: positions ? top5 / positions : 0,
    top8: positions ? top8 / positions : 0
  };
}
function pct(value) { return (100 * value).toFixed(2) + "%"; }
function main() {
  const [trainPath, validationPath, testPath] = process.argv.slice(2);
  if (!trainPath || !validationPath || !testPath) {
    throw new Error("Usage: node scripts/eval-matched-baseline.js train.txt validation.txt test.txt");
  }
  const candidatePool = readRows(trainPath, Number(process.env.BENCHMARK_POOL_SENTENCES || DEFAULT_POOL_SENTENCES));
  const testRows = readRows(testPath, Number(process.env.TEST_SENTENCES || 5000));
  if (candidatePool.length < DEFAULT_POOL_SENTENCES || !testRows.length) {
    throw new Error("Need at least " + DEFAULT_POOL_SENTENCES + " candidate-pool sentences and a non-empty external test file.");
  }

  // Attention performs its own deterministic 70/15/15 split. Derive that exact
  // partition first, then train N-gram on the same 320 rows and tune it on the
  // same validation rows. The internal 15% holdout is never used by either model.
  const attentionModel = makeAttention(candidatePool);
  const split = prepareMatchedData(attentionModel, candidatePool);
  const attentionTraining = attentionModel.status().lastTraining;
  if (!attentionTraining ||
      attentionTraining.trainRows !== split.train.length ||
      attentionTraining.validationRows !== split.validation.length ||
      attentionTraining.testRows !== split.test.length) {
    throw new Error("Attention training partition does not match the shared deterministic split.");
  }

  const ngramModel = ngram.create();
  const ngramTraining = ngramModel.train(split.train);
  const tuning = ngramModel.tuneWeights(split.validation, { rounds: 1 });

  const ngramMetrics = evaluate((tokens, i) =>
    ngramModel.predictMasked(tokens, i, { limit: 8 }).predictions.map(p => p.token), testRows);
  const attentionMetrics = evaluate((tokens, i) => {
    const result = attentionModel.predictMasked(tokens.join(" "), i);
    return result && Array.isArray(result.predictions) ? result.predictions.map(p => p.token) : [];
  }, testRows);

  const report = {
    protocol: "matched-training-320-shared-validation-v2",
    candidatePoolSentences: candidatePool.length,
    trainSentencesPerModel: split.train.length,
    validationSentencesUsedByBothModels: split.validation.length,
    internalHoldoutSentencesUnusedByBothModels: split.test.length,
    splitSeed: SPLIT_SEED,
    attention: {
      actualTrainRows: attentionTraining.trainRows,
      validationRows: attentionTraining.validationRows,
      internalTestRows: attentionTraining.testRows,
      selectedEpochs: attentionTraining.epochs,
      bestEpoch: attentionTraining.bestEpoch
    },
    ngram: {
      actualTrainSentences: ngramTraining.sentences,
      validationSentences: split.validation.length,
      metrics: ngramMetrics,
      tuning
    },
    contextualAttention: { metrics: attentionMetrics },
    testSentences: testRows.length,
    note: "Both models train on the exact same 320 sentences and use the exact same held-out validation sentences. Attention uses validation for early stopping; N-gram uses it for weight tuning. Neither model sees the external test set during training or tuning. The extra internal holdout subset is unused."
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("matched-data Top-1: attention", pct(attentionMetrics.top1), "| N-gram", pct(ngramMetrics.top1));
  console.log("matched-data Top-8: attention", pct(attentionMetrics.top8), "| N-gram", pct(ngramMetrics.top8));
  return report;
}
if (require.main === module) main();
module.exports = { main, evaluate, prepareMatchedData };
