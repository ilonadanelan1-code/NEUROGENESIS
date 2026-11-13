"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dataDir = process.argv[2];
if (!dataDir || !fs.existsSync(dataDir)) throw new Error("Pass the pinned RNC noun directory from rl_wsd_labeled as argv[2].");
const window = {};
const sandbox = { window, Math, Map, Set, JSON, RegExp, Object, Array, String, Number, Date };
for (const file of ["contextual-attention.js", "lexical-sense.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const Attention = window.NGContextualModel;
const Lexical = window.NGLexicalSenseModel;
const normalise = value => String(value || "").normalize("NFKC").toLowerCase().replace(/ё/gu, "е")
  .replace(/\s+/gu, " ").trim();
function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(rows, seed) {
  const result = rows.slice(), random = randomFor(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
function parseWordFile(file, model) {
  const lemma = path.basename(file, path.extname(file));
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
  const otherSenseIds = new Set(), validSenseIds = new Set(), rows = [];
  for (const line of lines) {
    if (line.startsWith("\t\t")) {
      const parts = line.trim().split("\t").filter(Boolean);
      if (parts.length < 2) continue;
      const senseId = parts[parts.length - 1].trim();
      const description = parts.slice(0, -1).join(" ").trim();
      if (/^другое$/iu.test(description)) otherSenseIds.add(senseId);
      else if (senseId !== "0" && /^\d+$/u.test(senseId)) validSenseIds.add(senseId);
      continue;
    }
    if (!line.trim()) continue;
    const fields = line.replace(/\r$/u, "").split("\t");
    if (fields.length < 4) continue;
    const last = (fields[fields.length - 1] || "").trim();
    const secondLast = (fields[fields.length - 2] || "").trim();
    let label, contentEnd;
    if (/^\d+$/u.test(secondLast) && /^\d+$/u.test(last)) {
      if (secondLast !== last) continue;
      label = secondLast;
      contentEnd = fields.length - 2;
    } else if (/^\d+$/u.test(last)) {
      label = last;
      contentEnd = fields.length - 1;
    } else continue;
    if (label === "0" || otherSenseIds.has(label) || !validSenseIds.has(label)) continue;
    const before = fields[0] || "";
    const word = (fields[1] || "").trim();
    const after = fields.slice(2, contentEnd).join(" ");
    if (!word) continue;
    const text = [before, word, after].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
    const tokens = model.tokenize(text);
    const targetTokens = model.tokenize(word);
    const targetIndex = model.tokenize(before).length;
    if (targetTokens.length !== 1 || tokens[targetIndex] !== targetTokens[0]) continue;
    rows.push({
      lemma, sense: label, text, targetIndex, targetForm: targetTokens[0],
      normalizedSentence: tokens.join(" ")
    });
  }
  const grouped = new Map();
  for (const row of rows) {
    const key = row.normalizedSentence;
    if (!grouped.has(key)) grouped.set(key, new Map());
    const labels = grouped.get(key);
    labels.set(row.sense, (labels.get(row.sense) || 0) + 1);
  }
  const conflicts = new Set([...grouped.entries()].filter(([, labels]) => labels.size > 1).map(([key]) => key));
  const unique = new Map();
  for (const row of rows) if (!conflicts.has(row.normalizedSentence) && !unique.has(row.normalizedSentence))
    unique.set(row.normalizedSentence, row);
  const contexts = [...unique.values()];
  const senses = new Set(contexts.map(row => row.sense));
  return { lemma, contexts, senseCount: senses.size };
}
function stratifiedSplit(rows, seed) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.sense)) groups.set(row.sense, []);
    groups.get(row.sense).push(row);
  }
  const train = [], validation = [], test = [];
  let offset = 0;
  for (const [, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const items = shuffle(group, seed + offset++ * 9973);
    const n = items.length;
    if (n < 3) { train.push(...items); continue; }
    const trainCount = Math.max(1, Math.floor(n * .6));
    const validationCount = Math.max(1, Math.floor(n * .2));
    train.push(...items.slice(0, trainCount));
    validation.push(...items.slice(trainCount, trainCount + validationCount));
    test.push(...items.slice(trainCount + validationCount));
  }
  return { train, validation, test };
}
function samplePairs(rows, maxPerClass, seed) {
  const positives = [], negatives = [];
  for (let left = 0; left < rows.length; left++) {
    for (let right = left + 1; right < rows.length; right++) {
      const pair = {
        left: rows[left], right: rows[right],
        label: rows[left].sense === rows[right].sense ? 1 : 0,
        lemma: rows[left].lemma
      };
      (pair.label ? positives : negatives).push(pair);
    }
  }
  const count = Math.min(maxPerClass, positives.length, negatives.length);
  if (count < 4) return [];
  return shuffle(positives, seed).slice(0, count).concat(shuffle(negatives, seed ^ 0x9e3779b9).slice(0, count));
}
function pairsFor(rowsByLemma, maxPerClass, seed) {
  const result = [];
  let offset = 0;
  for (const [, rows] of rowsByLemma) {
    result.push(...samplePairs(rows, maxPerClass, seed + offset++ * 104729));
  }
  return shuffle(result, seed ^ 0x51ed270b);
}
function selectEncoderTexts(rowsByLemma, maximum = 320) {
  const perLemma = Math.max(1, Math.floor(maximum / Math.max(1, rowsByLemma.length)));
  const selected = [];
  for (let index = 0; index < rowsByLemma.length; index++) {
    selected.push(...shuffle(rowsByLemma[index][1], 20261113 + index * 313).slice(0, perLemma).map(row => row.text));
  }
  if (selected.length < maximum) {
    const used = new Set(selected);
    for (const [, rows] of rowsByLemma) {
      for (const row of shuffle(rows, 9981)) {
        if (selected.length >= maximum) break;
        if (!used.has(row.text)) { selected.push(row.text); used.add(row.text); }
      }
    }
  }
  return selected.slice(0, maximum);
}
function summarize(rows, key, total = rows.length) {
  const covered = rows.filter(row => row[key] != null);
  let correct = 0, tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of covered) {
    const prediction = row[key] >= .5 ? 1 : 0;
    if (row.label === 1 && prediction === 1) { tp++; correct++; }
    else if (row.label === 0 && prediction === 1) fp++;
    else if (row.label === 0 && prediction === 0) { tn++; correct++; }
    else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const negativePrecision = tn + fn ? tn / (tn + fn) : 0;
  const negativeRecall = tn + fp ? tn / (tn + fp) : 0;
  const negativeF1 = negativePrecision + negativeRecall
    ? 2 * negativePrecision * negativeRecall / (negativePrecision + negativeRecall) : 0;
  return {
    count: total, covered: covered.length, correct, tp, fp, tn, fn,
    accuracy: covered.length ? correct / covered.length : null,
    precision, recall, f1, macroF1: (f1 + negativeF1) / 2,
    coverage: total ? covered.length / total : 0
  };
}
function aggregateRuns(runs, key, pairKey) {
  const rows = runs.flatMap(run => run[pairKey].map(row => ({
    label: row.label, probability: row[key], lemma: row.lemma
  })));
  return summarize(rows, "probability", rows.length);
}
function byLemmaBucket(runs, key, pairKey, lemmaSet) {
  const rows = runs.flatMap(run => run[pairKey]
    .filter(row => lemmaSet.has(row.lemma))
    .map(row => ({ label: row.label, probability: row[key], lemma: row.lemma })));
  return summarize(rows, "probability", rows.length);
}
function errorExamples(predictions, pairs, limit = 6) {
  const errors = [];
  for (const row of predictions) {
    if (row.contextualProbability == null) continue;
    const predicted = row.contextualProbability >= .5 ? 1 : 0;
    if (predicted === row.label) continue;
    const pair = pairs[row.index];
    if (!pair) continue;
    errors.push({
      lemma: pair.lemma, goldSameSense: row.label === 1,
      contextualProbability: Number(row.contextualProbability.toFixed(4)),
      baselineProbability: row.baselineProbability == null ? null : Number(row.baselineProbability.toFixed(4)),
      left: pair.left.text.slice(0, 180), right: pair.right.text.slice(0, 180)
    });
    if (errors.length >= limit) break;
  }
  return errors;
}

const files = fs.readdirSync(dataDir).filter(file => file.endsWith(".txt")).sort();
const parsed = files.map(file => parseWordFile(path.join(dataDir, file), Attention));
const eligible = parsed.filter(item => item.contexts.length >= 18 && item.senseCount >= 2);
assert.ok(eligible.length >= 16, "RNC WSD subset must provide at least 16 usable polysemous lemmas; got " + eligible.length);
const ordered = shuffle(eligible, 20261113);
const trainLemmaItems = ordered.slice(0, Math.floor(eligible.length * .6));
const unseenLemmaItems = ordered.slice(trainLemmaItems.length);
assert.ok(trainLemmaItems.length >= 8 && unseenLemmaItems.length >= 4);

const trainRowsByLemma = [], validationRowsByLemma = [], knownTestRowsByLemma = [], unseenTestRowsByLemma = [];
for (const item of trainLemmaItems) {
  const split = stratifiedSplit(item.contexts, 20261113 + trainRowsByLemma.length * 7919);
  trainRowsByLemma.push([item.lemma, split.train]);
  validationRowsByLemma.push([item.lemma, split.validation]);
  knownTestRowsByLemma.push([item.lemma, split.test]);
}
for (const item of unseenLemmaItems) unseenTestRowsByLemma.push([item.lemma, item.contexts]);

const partitionSets = { train: new Set(), validation: new Set(), knownTest: new Set(), unseenTest: new Set() };
const partitionOrder = ["train", "validation", "knownTest", "unseenTest"];
let duplicateSentenceExclusions = 0;
function decontaminate(rowsByLemma, partitionName) {
  const output = [], partitionIndex = partitionOrder.indexOf(partitionName);
  const prior = new Set(partitionOrder.slice(0, partitionIndex).flatMap(name => [...partitionSets[name]]));
  for (const [lemma, rows] of rowsByLemma) {
    const kept = [];
    for (const row of rows) {
      const key = row.normalizedSentence;
      if (prior.has(key) || partitionSets[partitionName].has(key)) { duplicateSentenceExclusions++; continue; }
      partitionSets[partitionName].add(key);
      kept.push(row);
    }
    output.push([lemma, kept]);
  }
  return output;
}
const cleanTrainRows = decontaminate(trainRowsByLemma, "train");
const cleanValidationRows = decontaminate(validationRowsByLemma, "validation");
const cleanKnownTestRows = decontaminate(knownTestRowsByLemma, "knownTest");
const cleanUnseenTestRows = decontaminate(unseenTestRowsByLemma, "unseenTest");
const trainValidationSet = new Set([...partitionSets.train, ...partitionSets.validation]);
const allEarlier = new Set([...trainValidationSet, ...partitionSets.knownTest]);
const crossPartitionOverlap = [...partitionSets.unseenTest].filter(value => allEarlier.has(value)).length;
assert.equal(crossPartitionOverlap, 0, "normalized sentence overlap must be zero across all partitions");

const trainPairs = pairsFor(cleanTrainRows, 70, 101);
const validationPairs = pairsFor(cleanValidationRows, 45, 202);
const knownTestPairs = pairsFor(cleanKnownTestRows, 45, 303);
const unseenTestPairs = pairsFor(cleanUnseenTestRows, 45, 404);
assert.ok(trainPairs.length >= 120 && validationPairs.length >= 40 && knownTestPairs.length >= 40 && unseenTestPairs.length >= 40,
  "all split partitions need enough balanced same/different-sense pairs");
const encoderTexts = selectEncoderTexts(cleanTrainRows, 320);
assert.ok(encoderTexts.length >= 80 && encoderTexts.length <= 320);
const seeds = [
  { model: 9173, split: 902 },
  { model: 31415, split: 2718 },
  { model: 2718, split: 9044 }
];
const allRuns = [];
for (const seed of seeds) {
  const contextual = Attention.create({ dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: seed.model });
  const encoderTraining = contextual.train(encoderTexts, {
    epochs: 14, learningRate: .025, splitSeed: seed.split, patience: 6,
    shuffleExamples: true, shuffleSeed: seed.model ^ seed.split
  });
  assert.equal(encoderTraining.evaluationIsolated, true);
  const lexical = Lexical.create();
  const classifierTraining = lexical.train(trainPairs, validationPairs, contextual, {
    epochs: 220, learningRate: .08, patience: 26, l2: .003
  });
  const known = lexical.evaluate(knownTestPairs, contextual);
  const unseen = lexical.evaluate(unseenTestPairs, contextual);
  allRuns.push({
    seed, encoderTraining, classifierTraining,
    knownPredictions: known.predictions.map(row => ({ ...row, lemma: knownTestPairs[row.index]?.lemma })),
    unseenPredictions: unseen.predictions.map(row => ({ ...row, lemma: unseenTestPairs[row.index]?.lemma }))
  });
}
const knownBaseline = aggregateRuns(allRuns, "baselineProbability", "knownPredictions");
const knownContextual = aggregateRuns(allRuns, "contextualProbability", "knownPredictions");
const unseenBaseline = aggregateRuns(allRuns, "baselineProbability", "unseenPredictions");
const unseenContextual = aggregateRuns(allRuns, "contextualProbability", "unseenPredictions");
const knownBaselinePaired = aggregateRuns(allRuns, "baselineProbability", "knownPredictions");
const unseenBaselinePaired = aggregateRuns(allRuns, "baselineProbability", "unseenPredictions");

const frequencyCounts = [...cleanTrainRows].map(([lemma, rows]) => ({ lemma, count: rows.length }))
  .sort((a, b) => a.count - b.count || a.lemma.localeCompare(b.lemma));
const midpoint = Math.floor(frequencyCounts.length / 2);
const lowerContextCountLemmas = new Set(frequencyCounts.slice(0, midpoint).map(row => row.lemma));
const higherContextCountLemmas = new Set(frequencyCounts.slice(midpoint).map(row => row.lemma));
const majority = (pairs) => {
  const positive = pairs.filter(pair => pair.label === 1).length;
  const negative = pairs.length - positive;
  return { positive, negative, accuracy: pairs.length ? Math.max(positive, negative) / pairs.length : null };
};
const firstRun = allRuns[0];
const report = {
  benchmark: "NEUROGENESIS contextual lexical-sense / WiC pilot",
  schema: "NG_LEXICAL_SENSE_BENCHMARK_V1",
  source: {
    repository: "https://github.com/lopuhin/ruslang-wsd-labeled",
    commit: "67266b5bb21dd92e7def0bdc41adddb2584c1868",
    subset: "nouns/RNC",
    declaredPackageLicense: "MIT",
    provenance: "human-labelled Russian National Corpus contexts; sense definitions from the Active Dictionary",
    redistributionNote: "corpus is fetched in CI and not vendored; package MIT metadata does not override any separate source-corpus terms"
  },
  split: {
    totalUsableLemmas: eligible.length,
    trainLemmas: cleanTrainRows.map(row => row[0]),
    knownValidationLemmas: cleanValidationRows.map(row => row[0]),
    knownTestLemmas: cleanKnownTestRows.map(row => row[0]),
    unseenTestLemmas: cleanUnseenTestRows.map(row => row[0]),
    encoderTrainingSentences: encoderTexts.length,
    trainPairs: trainPairs.length,
    validationPairs: validationPairs.length,
    knownTestPairs: knownTestPairs.length,
    unseenTestPairs: unseenTestPairs.length,
    normalizedSentenceLeakage: crossPartitionOverlap,
    duplicateSentenceExclusions,
    sentenceSplitPolicy: "stratified by sense within training lemmas; unseen lemmas held out completely"
  },
  seeds: allRuns.map(run => ({
    modelSeed: run.seed.model, splitSeed: run.seed.split,
    encoderTraining: {
      trainRows: run.encoderTraining.trainRows,
      validationRows: run.encoderTraining.validationRows,
      testRows: run.encoderTraining.testRows,
      vocabularySize: run.encoderTraining.vocabularySize,
      epochs: run.encoderTraining.epochs
    },
    classifierTraining: {
      trainPairs: run.classifierTraining.trainPairs,
      contextualTrainCovered: run.classifierTraining.contextualTrainCovered,
      validationPairs: run.classifierTraining.validationPairs,
      contextualValidationCovered: run.classifierTraining.contextualValidationCovered,
      baselineBestEpoch: run.classifierTraining.baselineBestEpoch,
      contextualBestEpoch: run.classifierTraining.contextualBestEpoch
    },
    knownLemma: {
      baseline: summarize(run.knownPredictions.map(row => ({ label: row.label, probability: row.baselineProbability })), run.knownPredictions.length),
      contextual: summarize(run.knownPredictions.map(row => ({ label: row.label, probability: row.contextualProbability })), run.knownPredictions.length)
    },
    unseenLemma: {
      baseline: summarize(run.unseenPredictions.map(row => ({ label: row.label, probability: row.baselineProbability })), run.unseenPredictions.length),
      contextual: summarize(run.unseenPredictions.map(row => ({ label: row.label, probability: row.contextualProbability })), run.unseenPredictions.length)
    }
  })),
  aggregateAcrossSeeds: {
    knownLemma: {
      baseline: knownBaseline,
      baselineOnContextualCoverage: knownBaselinePaired,
      contextual: knownContextual,
      pairedDeltaPP: knownContextual.accuracy == null || knownBaselinePaired.accuracy == null
        ? null : (knownContextual.accuracy - knownBaselinePaired.accuracy) * 100
    },
    unseenLemma: {
      baseline: unseenBaseline,
      baselineOnContextualCoverage: unseenBaselinePaired,
      contextual: unseenContextual,
      pairedDeltaPP: unseenContextual.accuracy == null || unseenBaselinePaired.accuracy == null
        ? null : (unseenContextual.accuracy - unseenBaselinePaired.accuracy) * 100
    },
    knownLemmaContextCountBuckets: {
      definition: "lower/higher half by available training-context count; this is a dataset-size proxy, not corpus token frequency",
      lowerContextCount: {
        lemmas: [...lowerContextCountLemmas],
        baseline: byLemmaBucket(allRuns, "baselineProbability", "knownPredictions", lowerContextCountLemmas),
        contextual: byLemmaBucket(allRuns, "contextualProbability", "knownPredictions", lowerContextCountLemmas)
      },
      higherContextCount: {
        lemmas: [...higherContextCountLemmas],
        baseline: byLemmaBucket(allRuns, "baselineProbability", "knownPredictions", higherContextCountLemmas),
        contextual: byLemmaBucket(allRuns, "contextualProbability", "knownPredictions", higherContextCountLemmas)
      }
    },
    majorityBaselines: {
      knownLemma: majority(knownTestPairs),
      unseenLemma: majority(unseenTestPairs)
    }
  },
  errorExamples: {
    knownLemma: errorExamples(firstRun.knownPredictions, knownTestPairs),
    unseenLemma: errorExamples(firstRun.unseenPredictions, unseenTestPairs)
  }
};
console.log("NEUROGENESIS 0.58.121 contextual lexical-sense benchmark: " + JSON.stringify(report));
console.log("NEUROGENESIS lexical-sense error counts: " + JSON.stringify({
  knownFalseMerges: allRuns.reduce((sum, run) => sum + run.knownPredictions.filter(row => row.label === 0 && row.contextualProbability != null && row.contextualProbability >= .5).length, 0),
  knownFalseSplits: allRuns.reduce((sum, run) => sum + run.knownPredictions.filter(row => row.label === 1 && row.contextualProbability != null && row.contextualProbability < .5).length, 0),
  unseenFalseMerges: allRuns.reduce((sum, run) => sum + run.unseenPredictions.filter(row => row.label === 0 && row.contextualProbability != null && row.contextualProbability >= .5).length, 0),
  unseenFalseSplits: allRuns.reduce((sum, run) => sum + run.unseenPredictions.filter(row => row.label === 1 && row.contextualProbability != null && row.contextualProbability < .5).length, 0)
}));
assert.ok(report.split.normalizedSentenceLeakage === 0);
assert.ok(report.aggregateAcrossSeeds.knownLemma.contextual.coverage >= .9);
assert.ok(report.aggregateAcrossSeeds.unseenLemma.contextual.coverage >= .9);
assert.ok(Number.isFinite(report.aggregateAcrossSeeds.knownLemma.contextual.macroF1));
assert.ok(Number.isFinite(report.aggregateAcrossSeeds.unseenLemma.contextual.macroF1));
console.log("NEUROGENESIS contextual lexical-sense benchmark protocol passed; quality gain is reported, not assumed.");