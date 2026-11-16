"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ngram = require("../ngram-predictor.js");

const SPLIT_SEED = Math.floor(Number(process.env.SPLIT_SEED) || 902);
const ATTENTION_SEED = Math.floor(Number(process.env.ATTENTION_SEED) || SPLIT_SEED);
const ATTENTION_EPOCHS = Math.max(1, Math.min(240, Math.floor(Number(process.env.ATTENTION_EPOCHS) || 40)));
const ATTENTION_PATIENCE = Math.max(2, Math.min(60, Math.floor(Number(process.env.ATTENTION_PATIENCE) || 10)));
const CANDIDATE_POOL_SENTENCES = 320;

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
  const model = sandbox.NGContextualModel.create({ seed: ATTENTION_SEED });
  model.train(candidatePool, { epochs: ATTENTION_EPOCHS, patience: ATTENTION_PATIENCE, splitSeed: SPLIT_SEED });
  return model;
}
function prepareMatchedData(attentionModel, candidatePool) {
  if (!attentionModel || typeof attentionModel.splitCorpus !== "function") {
    throw new TypeError("Attention model must expose its deterministic corpus split.");
  }
  const split = attentionModel.splitCorpus(candidatePool, SPLIT_SEED);
  if (split.train.length !== 224 || split.validation.length !== 48 || split.test.length !== 48) {
    throw new Error(
      "Expected attention's deterministic 70/15/15 split to be 224/48/48; got " +
      [split.train.length, split.validation.length, split.test.length].join("/")
    );
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
  const [trainPath, testPath] = process.argv.slice(2);
  if (!trainPath || !testPath) {
    throw new Error("Usage: node scripts/eval-matched-baseline.js train.txt test.txt");
  }
  const candidatePool = readRows(trainPath, CANDIDATE_POOL_SENTENCES);
  const testRows = readRows(testPath, Number(process.env.TEST_SENTENCES || 5000));
  if (candidatePool.length !== CANDIDATE_POOL_SENTENCES || !testRows.length) {
    throw new Error("Need exactly 320 candidate-pool sentences and a non-empty external test file.");
  }

  // The legacy attention model accepts at most 320 input sentences and internally
  // splits them into 224 train / 48 validation / 48 holdout. N-gram receives the
  // exact same 224 train sentences and uses the exact same 48 validation sentences.
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
    protocol: "matched-training-224-shared-validation-v3",
    candidatePoolSentences: candidatePool.length,
    trainSentencesPerModel: split.train.length,
    validationSentencesUsedByBothModels: split.validation.length,
    internalHoldoutSentencesUnusedByBothModels: split.test.length,
    splitSeed: SPLIT_SEED,
    attention: {
      actualTrainRows: attentionTraining.trainRows,
      validationRows: attentionTraining.validationRows,
      internalTestRows: attentionTraining.testRows,
      requestedEpochs: attentionTraining.requestedEpochs,
      selectedEpochs: attentionTraining.epochs,
      bestEpoch: attentionTraining.bestEpoch,
      patience: attentionTraining.patience,
      earlyStopped: attentionTraining.earlyStopped,
      vocabularySize: attentionModel.status().vocabularySize
    },
    ngram: {
      actualTrainSentences: ngramTraining.sentences,
      validationSentences: split.validation.length,
      metrics: ngramMetrics,
      tuning
    },
    contextualAttention: { metrics: attentionMetrics },
    testSentences: testRows.length,
    note: "Both models train on the exact same 224 sentences and use the exact same 48 held-out validation sentences. Attention uses validation for early stopping; N-gram uses it for weight tuning. Neither model sees the external test set during training or tuning. The extra 48-sentence internal holdout subset is unused. Attention trains for up to ATTENTION_EPOCHS (default 40) with patience ATTENTION_PATIENCE (default 10); the selected epoch and early-stop status are included in the report."
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("matched-data Top-1: attention", pct(attentionMetrics.top1), "| N-gram", pct(ngramMetrics.top1));
  console.log("matched-data Top-8: attention", pct(attentionMetrics.top8), "| N-gram", pct(ngramMetrics.top8));
  return report;
}
if (require.main === module) main();
module.exports = { main, evaluate, prepareMatchedData };
