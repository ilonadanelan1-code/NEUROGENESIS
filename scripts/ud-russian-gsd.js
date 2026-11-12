"use strict";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&(?:amp|quot|apos|lt|gt|#39);/giu, entity => {
      const named = {"&amp;":"&","&quot;":"\"","&apos;":"'","&lt;":"<","&gt;":">","&#39;":"'"}; 
      return named[entity.toLowerCase()] || entity;
    })
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (entity, code) => {
      const number = code[0].toLowerCase() === "x"
        ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isInteger(number) && number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number) : entity;
    })
    .replace(/\x60\x60/gu, "\"")
    .replace(/''/gu, "\"");
}

function normalizeSentence(value) {
  const text = decodeEntities(value).normalize("NFKC").toLowerCase().replace(/ё/gu, "е");
  return text.match(/[\p{L}\p{N}]+/gu)?.join(" ") || "";
}

function tokenizeText(value) {
  return decodeEntities(value).normalize("NFKC").toLowerCase().replace(/ё/gu, "е")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

function parseConllu(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("CoNLL-U content must be a non-empty string.");
  }
  const rows = [];
  let text = null;
  const forms = [];
  const flush = () => {
    const candidate = (text || forms.join(" ")).trim();
    const normalized = normalizeSentence(candidate);
    if (normalized) rows.push({
      text: decodeEntities(candidate).normalize("NFKC").replace(/\s+/gu, " ").trim(),
      normalized,
      tokenCount: tokenizeText(candidate).length
    });
    text = null;
    forms.length = 0;
  };
  for (const line of content.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("# text = ")) {
      text = line.slice("# text = ".length);
      continue;
    }
    if (line.startsWith("#")) continue;
    const columns = line.split("\t");
    if (/^\d+$/u.test(columns[0] || "") && columns[1]) forms.push(columns[1]);
  }
  flush();
  return rows;
}

function uniqueRecords(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!row.normalized || seen.has(row.normalized)) continue;
    seen.add(row.normalized);
    result.push(row);
  }
  return result;
}

function hashForSample(value, seed) {
  let hash = (2166136261 ^ (Number(seed) >>> 0)) >>> 0;
  const input = String(value);
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function deterministicSample(rows, limit, seed) {
  const count = Math.max(0, Math.floor(Number(limit) || 0));
  return rows.slice().sort((left, right) => {
    const a = hashForSample(left.normalized, seed);
    const b = hashForSample(right.normalized, seed);
    return a - b || left.normalized.localeCompare(right.normalized);
  }).slice(0, count);
}

function prepareCorpus(trainContent, testContent, options = {}) {
  const trainLimit = Math.min(320, Math.max(1, Math.floor(Number(options.trainLimit) || 320)));
  const testLimit = Math.min(400, Math.max(1, Math.floor(Number(options.testLimit) || 240)));
  const seed = Math.floor(Number(options.seed) || 20261112);
  const minimumTokens = Math.max(3, Math.floor(Number(options.minimumTokens) || 4));
  const maximumTokens = Math.min(96, Math.max(minimumTokens, Math.floor(Number(options.maximumTokens) || 40)));

  const rawTrain = parseConllu(trainContent);
  const rawTest = parseConllu(testContent);
  const uniqueTrain = uniqueRecords(rawTrain);
  const uniqueTest = uniqueRecords(rawTest);
  const testKeys = new Set(uniqueTest.map(row => row.normalized));
  const overlap = uniqueTrain.filter(row => testKeys.has(row.normalized));
  const disjointTrain = uniqueTrain.filter(row => !testKeys.has(row.normalized));
  const eligibleTrain = disjointTrain.filter(row =>
    row.tokenCount >= minimumTokens && row.tokenCount <= maximumTokens);
  const eligibleTest = uniqueTest.filter(row =>
    row.tokenCount >= minimumTokens && row.tokenCount <= maximumTokens);
  const trainingSample = deterministicSample(eligibleTrain, trainLimit, seed);
  const testSample = deterministicSample(eligibleTest, testLimit, seed ^ 0x5f3759df);
  const sampledKeys = new Set(trainingSample.map(row => row.normalized));
  const sampledOverlap = testSample.filter(row => sampledKeys.has(row.normalized)).length;

  if (!trainingSample.length || !testSample.length) {
    throw new Error("The pinned UD corpus did not yield enough eligible train/test sentences.");
  }
  if (sampledOverlap !== 0) {
    throw new Error("Train/test sentence leakage detected after deterministic sampling.");
  }
  return {
    trainingTexts: trainingSample.map(row => row.text),
    testTexts: testSample.map(row => row.text),
    stats: {
      sourceTrainSentences: rawTrain.length,
      uniqueTrainSentences: uniqueTrain.length,
      sourceTestSentences: rawTest.length,
      uniqueTestSentences: uniqueTest.length,
      duplicateTrainSentences: rawTrain.length - uniqueTrain.length,
      duplicateTestSentences: rawTest.length - uniqueTest.length,
      normalizedTrainTestOverlapsExcluded: overlap.length,
      eligibleTrainSentencesAfterDecontamination: eligibleTrain.length,
      eligibleTestSentences: eligibleTest.length,
      sampledTrainSentences: trainingSample.length,
      sampledTestSentences: testSample.length,
      normalizedSampleTrainTestOverlaps: sampledOverlap,
      seed,
      minimumTokens,
      maximumTokens
    }
  };
}

module.exports = {
  decodeEntities,
  normalizeSentence,
  tokenizeText,
  parseConllu,
  uniqueRecords,
  deterministicSample,
  prepareCorpus
};
