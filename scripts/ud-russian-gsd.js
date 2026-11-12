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

function parseFeatures(value) {
  const result = {};
  const raw = String(value || "_");
  if (!raw || raw === "_") return result;
  for (const part of raw.split("|")) {
    const separator = part.indexOf("=");
    if (separator <= 0 || separator === part.length - 1) continue;
    const key = part.slice(0, separator);
    const featureValue = part.slice(separator + 1);
    if (key && featureValue) result[key] = featureValue;
  }
  return result;
}

function parseConllu(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("CoNLL-U content must be a non-empty string.");
  }
  const rows = [];
  let text = null;
  let sentenceId = null;
  const forms = [];
  const tokens = [];
  const flush = () => {
    const candidate = (text || forms.join(" ")).trim();
    const normalized = normalizeSentence(candidate);
    if (normalized) rows.push({
      sentenceId,
      text: decodeEntities(candidate).normalize("NFKC").replace(/\s+/gu, " ").trim(),
      normalized,
      tokenCount: tokenizeText(candidate).length,
      annotationTokenCount: tokens.length,
      tokens: tokens.map(row => ({...row}))
    });
    text = null;
    sentenceId = null;
    forms.length = 0;
    tokens.length = 0;
  };
  for (const line of content.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("# sent_id = ")) {
      sentenceId = line.slice("# sent_id = ".length).trim() || null;
      continue;
    }
    if (line.startsWith("# text = ")) {
      text = line.slice("# text = ".length);
      continue;
    }
    if (line.startsWith("#")) continue;
    const columns = line.split("\t");
    const rawId = columns[0] || "";
    // CoNLL-U multiword-token ranges (1-2) and empty nodes (2.1) are
    // structural rows, not independent lexical tokens for this pilot.
    if (!/^\d+$/u.test(rawId) || !columns[1]) continue;
    const form = decodeEntities(columns[1]).normalize("NFKC");
    forms.push(form);
    const lemma = columns[2] && columns[2] !== "_" ? decodeEntities(columns[2]).normalize("NFKC").toLowerCase() : null;
    const upos = columns[3] && columns[3] !== "_" ? columns[3] : null;
    const xpos = columns[4] && columns[4] !== "_" ? columns[4] : null;
    const featsRaw = columns[5] || "_";
    const headRaw = columns[6] || "_";
    const head = /^\d+$/u.test(headRaw) ? Number(headRaw) : null;
    const deprel = columns[7] && columns[7] !== "_" ? columns[7] : null;
    tokens.push({
      id: Number(rawId),
      form,
      lemma,
      upos,
      xpos,
      feats: parseFeatures(featsRaw),
      featsRaw,
      head,
      deprel,
      deps: columns[8] && columns[8] !== "_" ? columns[8] : null,
      misc: columns[9] && columns[9] !== "_" ? columns[9] : null
    });
  }
  flush();
  return rows;
}

function annotationSummary(rows) {
  const sentences = Array.isArray(rows) ? rows : [];
  const upos = {};
  const dependencyRelations = {};
  let tokens = 0, lemmaAnnotated = 0, featureAnnotated = 0, dependencyAnnotated = 0;
  for (const sentence of sentences) {
    for (const token of Array.isArray(sentence.tokens) ? sentence.tokens : []) {
      tokens++;
      if (token.lemma) lemmaAnnotated++;
      if (Object.keys(token.feats || {}).length) featureAnnotated++;
      if (token.upos) upos[token.upos] = (upos[token.upos] || 0) + 1;
      if (token.deprel) {
        dependencyAnnotated++;
        dependencyRelations[token.deprel] = (dependencyRelations[token.deprel] || 0) + 1;
      }
    }
  }
  return {
    sentences: sentences.length,
    tokens,
    lemmaAnnotated,
    featureAnnotated,
    dependencyAnnotated,
    upos,
    dependencyRelations
  };
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
    trainingRecords: trainingSample.map(row => ({...row,tokens:row.tokens.map(token=>({...token,feats:{...token.feats}}))})),
    testRecords: testSample.map(row => ({...row,tokens:row.tokens.map(token=>({...token,feats:{...token.feats}}))})),
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
      annotations: {training:annotationSummary(trainingSample),test:annotationSummary(testSample)},
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
  parseFeatures,
  annotationSummary,
  uniqueRecords,
  deterministicSample,
  prepareCorpus
};
