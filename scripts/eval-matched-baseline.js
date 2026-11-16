"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ngram = require("../ngram-predictor.js");

function readRows(file, limit) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).map(s => s.trim()).filter(Boolean).slice(0, limit);
}
function makeAttention(trainRows) {
  const sandbox = { console, globalThis: null };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, "..", "contextual-attention.js"), "utf8");
  vm.runInContext(source, sandbox, { filename: "contextual-attention.js" });
  if (!sandbox.NGContextualModel) throw new Error("NGContextualModel did not load");
  const model = sandbox.NGContextualModel.create();
  model.train(trainRows, { epochs: 8 });
  return model;
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
  const trainRows = readRows(trainPath, 320);
  const validationRows = readRows(validationPath, Number(process.env.VAL_SENTENCES || 300));
  const testRows = readRows(testPath, Number(process.env.TEST_SENTENCES || 5000));
  if (trainRows.length < 20 || !validationRows.length || !testRows.length) {
    throw new Error("Need at least 20 shared training sentences and non-empty validation/test files");
  }

  const ngramModel = ngram.create();
  ngramModel.train(trainRows);
  const tuning = ngramModel.tuneWeights(validationRows, { rounds: 1 });
  const attentionModel = makeAttention(trainRows);
  const ngramMetrics = evaluate((tokens, i) =>
    ngramModel.predictMasked(tokens, i, { limit: 8 }).predictions.map(p => p.token), testRows);
  const attentionMetrics = evaluate((tokens, i) => {
    const result = attentionModel.predictMasked(tokens.join(" "), i);
    return result && Array.isArray(result.predictions) ? result.predictions.map(p => p.token) : [];
  }, testRows);

  const report = {
    protocol: "matched-data-320",
    trainSentencesPerModel: trainRows.length,
    validationSentencesForNgramWeightTuning: validationRows.length,
    testSentences: testRows.length,
    ngram: { metrics: ngramMetrics, tuning },
    contextualAttention: { metrics: attentionMetrics },
    note: "Both models receive exactly the same 320 training sentences. N-gram weights are tuned only on validation; neither model sees test sentences during training or tuning."
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("matched-data Top-1: attention", pct(attentionMetrics.top1), "| N-gram", pct(ngramMetrics.top1));
  console.log("matched-data Top-8: attention", pct(attentionMetrics.top8), "| N-gram", pct(ngramMetrics.top8));
  return report;
}
if (require.main === module) main();
module.exports = { main, evaluate };
