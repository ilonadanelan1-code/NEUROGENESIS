"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const METRICS = ["top1", "top5", "top8"];

function statistics(values) {
  if (!values.length) throw new TypeError("At least one value is required.");
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    : 0;
  return { mean, sampleStdDev: Math.sqrt(variance), runs: values.length };
}

function summarize(reports) {
  if (!Array.isArray(reports) || !reports.length) {
    throw new TypeError("At least one matched-seed report is required.");
  }
  const summary = { ngram: {}, contextualAttention: {}, pairedDeltaNgramMinusAttention: {} };
  for (const metric of METRICS) {
    summary.ngram[metric] = statistics(reports.map(row => row.ngram.metrics[metric]));
    summary.contextualAttention[metric] = statistics(reports.map(row => row.contextualAttention.metrics[metric]));
    summary.pairedDeltaNgramMinusAttention[metric] = statistics(
      reports.map(row => row.ngram.metrics[metric] - row.contextualAttention.metrics[metric])
    );
  }
  return summary;
}

function parseJsonObject(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("Matched benchmark did not emit a JSON report.");
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < output.length; index++) {
    const char = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return JSON.parse(output.slice(start, index + 1));
    }
  }
  throw new Error("Matched benchmark emitted incomplete JSON.");
}

function runOne(trainPath, testPath, seed, testSentences) {
  const script = path.join(__dirname, "eval-matched-baseline.js");
  const child = spawnSync(process.execPath, [script, trainPath, testPath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      SPLIT_SEED: String(seed),
      ATTENTION_SEED: String(seed),
      TEST_SENTENCES: String(testSentences)
    }
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error("Matched benchmark failed for seed " + seed + ":\n" + (child.stderr || child.stdout));
  }
  const report = parseJsonObject(child.stdout || "");
  if (report.splitSeed !== seed || report.protocol !== "matched-training-224-shared-validation-v3") {
    throw new Error("Unexpected split seed or protocol for seed " + seed + ".");
  }
  return report;
}

function main() {
  const [trainPath, testPath] = process.argv.slice(2);
  if (!trainPath || !testPath) {
    throw new Error("Usage: node scripts/eval-matched-multiseed.js train.txt test.txt");
  }
  const seeds = Array.from(new Set(
    String(process.env.MATCHED_SEEDS || "902,903,904,905,906")
      .split(",").map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value >= 0)
  ));
  if (seeds.length < 2) throw new Error("At least two distinct MATCHED_SEEDS are required.");
  const testSentences = Math.max(1, Math.floor(Number(process.env.TEST_SENTENCES) || 8000));
  const reports = seeds.map(seed => runOne(trainPath, testPath, seed, testSentences));
  const summary = summarize(reports);
  const perSeed = reports.map(report => ({
    seed: report.splitSeed,
    trainSentences: report.trainSentencesPerModel,
    validationSentences: report.validationSentencesUsedByBothModels,
    testSentences: report.testSentences,
    attention: {
      ...report.contextualAttention.metrics,
      requestedEpochs: report.attention.requestedEpochs,
      selectedEpochs: report.attention.selectedEpochs,
      bestEpoch: report.attention.bestEpoch,
      patience: report.attention.patience,
      earlyStopped: report.attention.earlyStopped,
      vocabularySize: report.attention.vocabularySize
    },
    ngram: report.ngram.metrics,
    pairedDeltaNgramMinusAttention: Object.fromEntries(
      METRICS.map(metric => [metric, report.ngram.metrics[metric] - report.contextualAttention.metrics[metric]])
    )
  }));
  console.log(JSON.stringify({
    protocol: "matched-training-224-shared-validation-multiseed-v2",
    baseProtocol: "matched-training-224-shared-validation-v3",
    seeds,
    testSentencesPerSeed: testSentences,
    perSeed,
    summary,
    note: "Each seed changes the deterministic 224/48/48 corpus partition and the attention model initialization. N-gram remains deterministic for a given training/validation split. Values are descriptive means and sample standard deviations, not a formal significance test or confidence interval."
  }, null, 2));
}

if (require.main === module) main();
module.exports = { statistics, summarize, parseJsonObject };
