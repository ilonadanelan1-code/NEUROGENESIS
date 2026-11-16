#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 7319;
const TRAIN_LIMIT = 320;
const EVAL_TARGETS_PER_ROW = 8;
const SOURCE_QUOTAS = {
  train: {
    "openassistant-ru": 180,
    "tiny-russian-dialogs": 50,
    "imperius-ru-classic": 60,
    "russian-everyday-dialogues": 20,
    "ruheritage-poetry": 10,
  },
  validation: {
    "openassistant-ru": 28,
    "tiny-russian-dialogs": 12,
    "imperius-ru-classic": 14,
    "russian-everyday-dialogues": 1,
    "ruheritage-poetry": 1,
  },
  test: {
    "openassistant-ru": 28,
    "tiny-russian-dialogs": 12,
    "imperius-ru-classic": 14,
    "russian-everyday-dialogues": 1,
    "ruheritage-poetry": 1,
  },
};
const FALLBACK_ORDER = [
  "openassistant-ru",
  "russian-everyday-dialogues",
  "imperius-ru-classic",
  "tiny-russian-dialogs",
  "ruheritage-poetry",
  "ru-dataset-small",
];

function hash(value) {
  let result = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function normalizedKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function readJsonl(text, fileName) {
  const rows = [];
  const lines = String(text ?? "").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(fileName + ":" + (index + 1) + " is not valid JSON: " + error.message);
    }
    if (!row || typeof row.sourceId !== "string" || typeof row.text !== "string" ||
        !row.sourceId.trim() || !row.text.trim()) {
      throw new Error(fileName + ":" + (index + 1) + " lacks sourceId or text.");
    }
    rows.push({ sourceId: row.sourceId, text: row.text });
  }
  return rows;
}

function sourceCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.sourceId] = (counts[row.sourceId] || 0) + 1;
  return counts;
}

function balancedSample(rows, quotas, targetCount, label) {
  const selected = [];
  const used = new Set();
  const pools = new Map();
  for (const row of rows) {
    if (!pools.has(row.sourceId)) pools.set(row.sourceId, []);
    pools.get(row.sourceId).push(row);
  }
  for (const [sourceId, pool] of pools) {
    pool.sort((left, right) =>
      hash(SEED + "\n" + label + "\n" + sourceId + "\n" + left.text) -
        hash(SEED + "\n" + label + "\n" + sourceId + "\n" + right.text) ||
      (left.text < right.text ? -1 : left.text > right.text ? 1 : 0));
  }
  for (const [sourceId, quota] of Object.entries(quotas)) {
    const pool = pools.get(sourceId) || [];
    for (const row of pool.slice(0, quota)) {
      const key = sourceId + "\n" + normalizedKey(row.text);
      if (used.has(key)) continue;
      used.add(key);
      selected.push(row);
    }
  }
  const fallback = [];
  for (const sourceId of FALLBACK_ORDER) {
    for (const row of pools.get(sourceId) || []) {
      const key = sourceId + "\n" + normalizedKey(row.text);
      if (!used.has(key)) fallback.push(row);
    }
  }
  for (const [sourceId, pool] of pools) {
    if (FALLBACK_ORDER.includes(sourceId)) continue;
    for (const row of pool) {
      const key = sourceId + "\n" + normalizedKey(row.text);
      if (!used.has(key)) fallback.push(row);
    }
  }
  fallback.sort((left, right) =>
    hash(SEED + "\n" + label + "\nfill\n" + left.sourceId + "\n" + left.text) -
      hash(SEED + "\n" + label + "\nfill\n" + right.sourceId + "\n" + right.text) ||
    left.sourceId.localeCompare(right.sourceId));
  for (const row of fallback) {
    if (selected.length >= targetCount) break;
    const key = row.sourceId + "\n" + normalizedKey(row.text);
    if (used.has(key)) continue;
    used.add(key);
    selected.push(row);
  }
  if (selected.length < Math.min(targetCount, rows.length)) {
    throw new Error(label + " sample unexpectedly short: " + selected.length + " rows.");
  }
  selected.sort((left, right) =>
    hash(SEED + "\n" + label + "\norder\n" + left.sourceId + "\n" + left.text) -
      hash(SEED + "\n" + label + "\norder\n" + right.sourceId + "\n" + right.text));
  return selected;
}

function modelText(value) {
  return String(value ?? "")
    .replace(/<\|user\|>/gu, " ")
    .replace(/<\|assistant\|>/gu, " ")
    .replace(/<\|end\|>/gu, " ")
    .replace(/<think>[\s\S]*?<\/think>/giu, " ")
    .replace(/<think>[\s\S]*$/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1200);
}

function targetPositions(tokens, row, splitName) {
  if (tokens.length < 4) return [];
  const candidates = [];
  for (let index = 1; index < tokens.length - 1; index += 1) {
    candidates.push(index);
  }
  candidates.sort((left, right) =>
    hash(SEED + "\n" + splitName + "\n" + row.sourceId + "\n" + row.text + "\n" + left) -
      hash(SEED + "\n" + splitName + "\n" + row.sourceId + "\n" + row.text + "\n" + right));
  return candidates.slice(0, EVAL_TARGETS_PER_ROW).sort((left, right) => left - right);
}

function evaluate(model, rows, splitName) {
  const vocabulary = new Set(model.exportState().vocabulary);
  const metrics = {
    split: splitName,
    rows: rows.length,
    targets: 0,
    knownTargets: 0,
    unknownTargets: 0,
    unavailableContexts: 0,
    top1Correct: 0,
    top8Correct: 0,
  };
  for (const row of rows) {
    const text = modelText(row.text);
    const tokens = model.tokenize(text);
    for (const index of targetPositions(tokens, row, splitName)) {
      const target = tokens[index];
      metrics.targets += 1;
      if (!vocabulary.has(target)) {
        metrics.unknownTargets += 1;
        continue;
      }
      metrics.knownTargets += 1;
      const prediction = model.predictMasked(text, index);
      if (!prediction || !prediction.available || !Array.isArray(prediction.predictions)) {
        metrics.unavailableContexts += 1;
        continue;
      }
      const candidates = prediction.predictions;
      if (candidates[0]?.token === target) metrics.top1Correct += 1;
      if (candidates.slice(0, 8).some(candidate => candidate.token === target)) {
        metrics.top8Correct += 1;
      }
    }
  }
  const covered = Math.max(0, metrics.knownTargets - metrics.unavailableContexts);
  metrics.coverage = metrics.targets ? covered / metrics.targets : 0;
  metrics.knownTargetCoverage = metrics.targets ? metrics.knownTargets / metrics.targets : 0;
  metrics.top1AccuracyCovered = covered ? metrics.top1Correct / covered : null;
  metrics.top8AccuracyCovered = covered ? metrics.top8Correct / covered : null;
  metrics.top1AccuracyAllTargets = metrics.targets ? metrics.top1Correct / metrics.targets : 0;
  metrics.top8AccuracyAllTargets = metrics.targets ? metrics.top8Correct / metrics.targets : 0;
  return metrics;
}

async function main() {
  const inputDir = path.resolve(process.argv[2] || path.join(ROOT, "training-data/generated"));
  const baselinePath = path.join(ROOT, "contextual-pretrained.json");
  const baselineBundle = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  if (baselineBundle.schema !== "NEUROGENESIS_PRETRAINED_CONTEXTUAL_V1" ||
      !baselineBundle.contextualState) {
    throw new Error("The original starter checkpoint is missing or has an unsupported schema.");
  }

  await import("../contextual-attention.js");
  const NG = globalThis.NGContextualModel;
  if (!NG || typeof NG.fromState !== "function") {
    throw new Error("NEUROGENESIS contextual model API is unavailable.");
  }

  const [trainRaw, validationRaw, testRaw, manifest] = await Promise.all([
    fs.readFile(path.join(inputDir, "train.jsonl"), "utf8"),
    fs.readFile(path.join(inputDir, "validation.jsonl"), "utf8"),
    fs.readFile(path.join(inputDir, "test.jsonl"), "utf8"),
    fs.readFile(path.join(inputDir, "manifest.json"), "utf8"),
  ]);
  const trainRows = readJsonl(trainRaw, "train.jsonl");
  const validationRows = readJsonl(validationRaw, "validation.jsonl");
  const testRows = readJsonl(testRaw, "test.jsonl");
  const corpusManifest = JSON.parse(manifest);

  const selectedTrain = balancedSample(trainRows, SOURCE_QUOTAS.train, TRAIN_LIMIT, "train");
  const selectedValidation = balancedSample(validationRows, SOURCE_QUOTAS.validation, 56, "validation");
  const selectedTest = balancedSample(testRows, SOURCE_QUOTAS.test, 56, "test");
  const trainTexts = selectedTrain.map(row => modelText(row.text)).filter(text => text.split(/\s+/u).length >= 3);
  if (trainTexts.length !== TRAIN_LIMIT) {
    throw new Error("Expected " + TRAIN_LIMIT + " usable training rows, received " + trainTexts.length + ".");
  }

  const baseline = NG.fromState(baselineBundle.contextualState);
  const baselineEvaluation = {
    validation: evaluate(baseline, selectedValidation, "validation"),
    test: evaluate(baseline, selectedTest, "test"),
  };
  const candidateSeeds = [6021, 9173, 12301];
  const candidateRuns = [];
  for (const seed of candidateSeeds) {
    const candidate = NG.create({
      dimension: baselineBundle.contextualState.dimension,
      windowSize: baselineBundle.contextualState.windowSize,
      heads: baselineBundle.contextualState.heads,
      blocks: baselineBundle.contextualState.transformerBlocks,
      seed,
    });
    const trainingReport = candidate.train(trainTexts, {
      epochs: 12,
      learningRate: 0.02,
      patience: 5,
      // Keep the internal row split fixed; vary initialization and shuffle seed.
      splitSeed: 6021,
      shuffleExamples: true,
      shuffleSeed: seed + 3116,
    });
    if (!Number.isFinite(trainingReport.validationLoss)) {
      throw new Error("Candidate seed " + seed + " did not produce an internal validation loss.");
    }
    candidateRuns.push({
      seed,
      trainingReport,
      validation: evaluate(candidate, selectedValidation, "validation"),
      test: evaluate(candidate, selectedTest, "test"),
      modelState: candidate.exportState(),
    });
  }

  // Choose by the training-run's own internal validation loss only.
  // The external validation and test samples are never used for model selection.
  const selectedRun = candidateRuns.slice().sort((left, right) =>
    left.trainingReport.validationLoss - right.trainingReport.validationLoss ||
    left.seed - right.seed)[0];
  const meanMetric = (split, key) => {
    const values = candidateRuns.map(run => Number(run[split][key])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const evaluation = {
    baseline: baselineEvaluation,
    candidate: {
      selectedSeed: selectedRun.seed,
      selectionMetric: "internal_validation_loss",
      trainingReport: selectedRun.trainingReport,
      validation: selectedRun.validation,
      test: selectedRun.test,
    },
    candidateRuns: candidateRuns.map(run => ({
      seed: run.seed,
      internalValidationLoss: run.trainingReport.validationLoss,
      validation: run.validation,
      test: run.test,
    })),
    candidateMeanAcrossSeeds: {
      validationTop1AccuracyAllTargets: meanMetric("validation", "top1AccuracyAllTargets"),
      validationTop8AccuracyAllTargets: meanMetric("validation", "top8AccuracyAllTargets"),
      testTop1AccuracyAllTargets: meanMetric("test", "top1AccuracyAllTargets"),
      testTop8AccuracyAllTargets: meanMetric("test", "top8AccuracyAllTargets"),
      testCoverage: meanMetric("test", "coverage"),
    },
  };
  const trainingReport = selectedRun.trainingReport;
  const candidate = { exportState: () => selectedRun.modelState };
  const report = {
    schema: "NEUROGENESIS_CONTEXTUAL_CORPUS_PILOT_V1",
    createdAt: new Date().toISOString(),
    seed: SEED,
    candidateSeeds,
    architecture: {
      dimension: baselineBundle.contextualState.dimension,
      windowSize: baselineBundle.contextualState.windowSize,
      heads: baselineBundle.contextualState.heads,
      blocks: baselineBundle.contextualState.transformerBlocks,
      vocabularyLimit: 1024,
      trainingRowLimit: 320,
    },
    corpus: {
      schema: corpusManifest.schema,
      totals: corpusManifest.totals,
      skippedSources: corpusManifest.skippedSources,
      duplicateAudit: corpusManifest.duplicateAudit,
      splitMethod: corpusManifest.splitMethod,
    },
    sample: {
      requestedTrainingRows: TRAIN_LIMIT,
      actualTrainingRows: selectedTrain.length,
      trainBySource: sourceCounts(selectedTrain),
      validationRows: selectedValidation.length,
      validationBySource: sourceCounts(selectedValidation),
      testRows: selectedTest.length,
      testBySource: sourceCounts(selectedTest),
      testWasNeverUsedForTraining: true,
    },
    trainingReport,
    evaluation,
    interpretation: {
      task: "masked-token prediction on source-aware Russian text rows",
      thisIsNotConversationalGeneration: true,
      candidateSeeds,
      candidateSelectionMetric: "internal_validation_loss",
      externalValidationUsedForModelSelection: false,
      testSetUsedForTrainingOrModelSelection: false,
      promotionDecision: "not_promoted_masked_token_results_only",
      limitations: [
        "The local contextual model predicts masked tokens; it does not generate full conversational replies.",
        "The model accepts at most 320 training rows and a vocabulary of 1024 tokens.",
        "The corpus split is row-level, not author- or document-disjoint; paraphrases and same-document excerpts can still overlap.",
        "The validation and test probes cover only a small deterministic source-stratified sample.",
        "Three independent candidate initializations are compared; the selected checkpoint is chosen by the candidate training run internal validation loss, not by the external test set.",
      ],
    },
  };

  const reportPath = path.join(ROOT, "benchmark-reports", "contextual-corpus-pilot-v1.json");
  const checkpointPath = path.join(inputDir, "contextual-corpus-pilot-checkpoint.json");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(checkpointPath, JSON.stringify({
    schema: "NEUROGENESIS_CONTEXTUAL_CORPUS_PILOT_CHECKPOINT_V1",
    seed: selectedRun.seed,
    candidateSeeds,
    selectionMetric: "internal_validation_loss",
    trainingSources: sourceCounts(selectedTrain),
    trainingReport,
    modelState: candidate.exportState(),
    notForProduction: true,
  }), "utf8");

  console.log(JSON.stringify({
    reportPath,
    checkpointPath,
    trainingRows: selectedTrain.length,
    trainBySource: sourceCounts(selectedTrain),
    trainingReport,
    baselineValidation: evaluation.baseline.validation,
    baselineTest: evaluation.baseline.test,
    selectedCandidateSeed: selectedRun.seed,
    candidateMeanAcrossSeeds: evaluation.candidateMeanAcrossSeeds,
    candidateRuns: evaluation.candidateRuns,
    promotionDecision: report.interpretation.promotionDecision,
    promotionDecision: report.interpretation.promotionDecision,
  }, null, 2));
}

main().catch(error => {
  console.error("Contextual corpus pilot failed:", error);
  process.exitCode = 1;
});
