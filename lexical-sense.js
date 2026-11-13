(() => {
"use strict";
const SCHEMA = "NG_LEXICAL_SENSE_V1";
const BASE_FEATURE_NAMES = Object.freeze([
  "context_jaccard", "context_tfidf_cosine", "left_context_jaccard", "right_context_jaccard",
  "same_lemma", "same_surface", "same_stem", "same_number", "number_known",
  "number_conflict", "target_suffix_similarity", "same_left_neighbor",
  "same_right_neighbor", "target_length_similarity"
]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clean = (value, limit = 2400) => String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, limit);
const normalise = value => clean(value, 2400).normalize("NFKC").toLowerCase().replace(/ё/gu, "е");
const sigmoid = value => 1 / (1 + Math.exp(-clamp(value, -30, 30)));
const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const cosine = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  const denominator = Math.sqrt(dot(left, left) * dot(right, right));
  return denominator > 1e-12 ? dot(left, right) / denominator : 0;
};
const jaccard = (left, right) => {
  const a = new Set(left), b = new Set(right);
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / Math.max(1, a.size + b.size - intersection);
};
function commonSuffixSimilarity(left, right) {
  const a = normalise(left), b = normalise(right), limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[a.length - 1 - shared] === b[b.length - 1 - shared]) shared++;
  return shared / Math.max(1, Math.max(a.length, b.length));
}
function numberHint(surface, model) {
  const verb = model && typeof model.russianVerbNumber === "function" ? model.russianVerbNumber(surface) : null;
  if (verb === "singular" || verb === "plural") return verb;
  const stem = model && typeof model.russianStem === "function" ? model.russianStem(surface) : normalise(surface);
  const plural = model && typeof model.russianNounPlural === "function" ? model.russianNounPlural(stem) : null;
  return plural && normalise(plural) === normalise(surface) ? "plural" : null;
}
function tokenStem(token, model) {
  return model && typeof model.russianStem === "function" ? normalise(model.russianStem(token)) : normalise(token);
}
function resolveExample(example, model) {
  if (!example || typeof example !== "object" || !model || typeof model.tokenize !== "function") return null;
  const text = clean(example.text);
  if (!text) return null;
  const tokens = model.tokenize(text);
  if (!Array.isArray(tokens) || !tokens.length) return null;
  let targetIndex = Number.isInteger(example.targetIndex) ? example.targetIndex : -1;
  const targetForm = normalise(example.targetForm || "");
  if (targetIndex < 0 && targetForm) targetIndex = tokens.findIndex(token => normalise(token) === targetForm);
  if (targetIndex < 0 || targetIndex >= tokens.length) return null;
  const surface = normalise(example.targetForm || tokens[targetIndex]);
  if (!surface || normalise(tokens[targetIndex]) !== surface) return null;
  const stem = tokenStem(surface, model);
  const lemma = normalise(example.lemma || stem);
  const left = tokens.slice(0, targetIndex).map(token => tokenStem(token, model)).filter(Boolean);
  const right = tokens.slice(targetIndex + 1).map(token => tokenStem(token, model)).filter(Boolean);
  const context = left.concat(right);
  return {
    text, tokens, targetIndex, surface, stem, lemma, left, right, context,
    leftNeighbor: left.length ? left[left.length - 1] : "",
    rightNeighbor: right.length ? right[0] : "",
    number: numberHint(surface, model)
  };
}
function documentKey(example) {
  return example.text + "\u0000" + example.targetIndex;
}
function buildIdf(pairs, model) {
  const documents = new Map();
  for (const pair of pairs || []) {
    for (const example of [pair && pair.left, pair && pair.right]) {
      const resolved = resolveExample(example, model);
      if (resolved) documents.set(documentKey(resolved), new Set(resolved.context));
    }
  }
  const frequency = new Map();
  for (const terms of documents.values()) for (const term of terms) frequency.set(term, (frequency.get(term) || 0) + 1);
  const values = {};
  for (const [term, count] of frequency) values[term] = Math.log((documents.size + 1) / (count + 1)) + 1;
  return { documentCount: documents.size, values };
}
function tfidfVector(tokens, idf) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const result = new Map();
  for (const [token, count] of counts) result.set(token, (1 + Math.log(count)) * finite(idf.values[token], 1));
  return result;
}
function sparseCosine(left, right) {
  let leftNorm = 0, rightNorm = 0, product = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left) product += value * finite(right.get(key), 0);
  const denominator = Math.sqrt(leftNorm * rightNorm);
  return denominator > 1e-12 ? product / denominator : 0;
}
function vectorFeatures(left, right) {
  const contextLeft = left.score.contextualVector, contextRight = right.score.contextualVector;
  const tokenLeft = left.score.tokenVector, tokenRight = right.score.tokenVector;
  if (!Array.isArray(contextLeft) || !Array.isArray(contextRight) ||
      !Array.isArray(tokenLeft) || !Array.isArray(tokenRight) ||
      contextLeft.length !== contextRight.length || tokenLeft.length !== tokenRight.length ||
      contextLeft.length !== tokenLeft.length || !contextLeft.length ||
      !contextLeft.every(Number.isFinite) || !contextRight.every(Number.isFinite) ||
      !tokenLeft.every(Number.isFinite) || !tokenRight.every(Number.isFinite)) return null;
  const result = [cosine(contextLeft, contextRight), cosine(tokenLeft, tokenRight)];
  for (let index = 0; index < contextLeft.length; index++) {
    result.push(Math.abs(contextLeft[index] - contextRight[index]));
    result.push(contextLeft[index] * contextRight[index]);
    result.push(Math.abs(tokenLeft[index] - tokenRight[index]));
    result.push(tokenLeft[index] * tokenRight[index]);
  }
  return result;
}
function baseFeatures(left, right, idf) {
  const leftTfidf = tfidfVector(left.context, idf), rightTfidf = tfidfVector(right.context, idf);
  const sameNumberKnown = !!left.number && !!right.number;
  const lengthSimilarity = 1 - Math.abs(left.surface.length - right.surface.length) /
    Math.max(1, Math.max(left.surface.length, right.surface.length));
  return [
    jaccard(left.context, right.context),
    sparseCosine(leftTfidf, rightTfidf),
    jaccard(left.left, right.left),
    jaccard(left.right, right.right),
    Number(left.lemma === right.lemma),
    Number(left.surface === right.surface),
    Number(left.stem === right.stem),
    Number(sameNumberKnown && left.number === right.number),
    Number(sameNumberKnown),
    Number(sameNumberKnown && left.number !== right.number),
    commonSuffixSimilarity(left.surface, right.surface),
    Number(!!left.leftNeighbor && left.leftNeighbor === right.leftNeighbor),
    Number(!!left.rightNeighbor && left.rightNeighbor === right.rightNeighbor),
    lengthSimilarity
  ];
}
function makeScorer(model) {
  const cache = new Map();
  return example => {
    const resolved = resolveExample(example, model);
    if (!resolved) return null;
    const key = documentKey(resolved);
    if (!cache.has(key)) {
      const score = typeof model.score === "function" ? model.score(resolved.text, resolved.targetIndex) : null;
      cache.set(key, score && Array.isArray(score.contextualVector) ? score : null);
    }
    resolved.score = cache.get(key);
    return resolved;
  };
}
function buildBatch(pairs, model, idf) {
  const scoreExample = makeScorer(model);
  const baselineRows = [], contextualRows = [], predictions = [];
  for (let index = 0; index < (pairs || []).length; index++) {
    const pair = pairs[index];
    const left = scoreExample(pair && pair.left), right = scoreExample(pair && pair.right);
    if (!left || !right) continue;
    const label = pair.label === true ? 1 : pair.label === false ? 0 : Number(pair.label);
    if (label !== 0 && label !== 1) continue;
    const base = baseFeatures(left, right, idf);
    baselineRows.push({ index, label, features: base });
    const contextual = vectorFeatures(left, right);
    if (contextual) contextualRows.push({ index, label, features: base.concat(contextual) });
    predictions.push({ index, label, lemma: normalise(pair.lemma || left.lemma) });
  }
  return { baselineRows, contextualRows, predictions, total: (pairs || []).length };
}
function standardize(features, means, scales) {
  return [1, ...features.map((value, index) => (finite(value) - means[index]) / scales[index])];
}
function lossForRows(rows, classifier) {
  if (!rows.length) return null;
  let loss = 0;
  for (const row of rows) {
    const probability = sigmoid(dot(classifier.weights, standardize(row.features, classifier.means, classifier.scales)));
    loss -= row.label ? Math.log(Math.max(1e-12, probability)) : Math.log(Math.max(1e-12, 1 - probability));
  }
  return loss / rows.length;
}
function fitClassifier(trainRows, validationRows, options = {}) {
  if (!trainRows.length) throw new TypeError("Lexical sense training needs covered training pairs.");
  const dimension = trainRows[0].features.length;
  if (!trainRows.every(row => row.features.length === dimension) ||
      !validationRows.every(row => row.features.length === dimension)) throw new TypeError("Lexical sense feature dimensions do not match.");
  const positives = trainRows.filter(row => row.label === 1).length;
  const negatives = trainRows.length - positives;
  if (!positives || !negatives) throw new TypeError("Lexical sense training needs both same-sense and different-sense pairs.");
  const means = Array.from({ length: dimension }, (_, index) =>
    trainRows.reduce((sum, row) => sum + row.features[index], 0) / trainRows.length);
  const scales = Array.from({ length: dimension }, (_, index) => {
    const variance = trainRows.reduce((sum, row) => sum + Math.pow(row.features[index] - means[index], 2), 0) / trainRows.length;
    return Math.sqrt(variance) > 1e-8 ? Math.sqrt(variance) : 1;
  });
  const prepared = trainRows.map(row => ({ ...row, x: standardize(row.features, means, scales) }));
  const validation = validationRows.map(row => ({ ...row, x: standardize(row.features, means, scales) }));
  let weights = Array.from({ length: dimension + 1 }, () => 0);
  const maxEpochs = Math.max(10, Math.min(500, Math.floor(finite(options.epochs, 240))));
  const learningRate = clamp(finite(options.learningRate, .08), .001, .5);
  const l2 = clamp(finite(options.l2, .003), 0, .2);
  const patience = Math.max(4, Math.min(100, Math.floor(finite(options.patience, 28))));
  const positiveWeight = trainRows.length / (2 * positives);
  const negativeWeight = trainRows.length / (2 * negatives);
  let bestWeights = weights.slice(), bestLoss = validation.length ? lossForRows(validation, { weights, means, scales }) : Infinity;
  let bestEpoch = 0, stale = 0, epochsRun = 0;
  for (let epoch = 0; epoch < maxEpochs; epoch++) {
    const gradient = Array.from({ length: weights.length }, () => 0);
    for (const row of prepared) {
      const probability = sigmoid(dot(weights, row.x));
      const weight = row.label ? positiveWeight : negativeWeight;
      const error = (probability - row.label) * weight;
      for (let index = 0; index < gradient.length; index++) gradient[index] += error * row.x[index];
    }
    for (let index = 0; index < weights.length; index++) {
      gradient[index] /= prepared.length;
      if (index > 0) gradient[index] += l2 * weights[index];
      weights[index] -= learningRate * gradient[index];
    }
    epochsRun = epoch + 1;
    const candidateLoss = validation.length
      ? lossForRows(validation, { weights, means, scales })
      : lossForRows(prepared, { weights, means, scales });
    if (candidateLoss < bestLoss - 1e-8) {
      bestLoss = candidateLoss;
      bestWeights = weights.slice();
      bestEpoch = epochsRun;
      stale = 0;
    } else {
      stale++;
      if (stale >= patience) break;
    }
  }
  const classifier = { weights: bestWeights, means, scales, bestEpoch, bestLoss, epochsRun, dimension };
  const trainPredictions = prepared.map(row => ({ label: row.label, probability: sigmoid(dot(bestWeights, row.x)) }));
  const validationPredictions = validation.map(row => ({ label: row.label, probability: sigmoid(dot(bestWeights, row.x)) }));
  return {
    classifier,
    training: metricSummary(trainPredictions, trainRows.length),
    validation: metricSummary(validationPredictions, validationRows.length),
    positives, negatives
  };
}
function metricSummary(rows, total) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of rows) {
    const prediction = row.probability >= .5 ? 1 : 0;
    if (row.label === 1 && prediction === 1) tp++;
    else if (row.label === 0 && prediction === 1) fp++;
    else if (row.label === 0 && prediction === 0) tn++;
    else fn++;
  }
  const covered = rows.length, correct = tp + tn;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const positiveF1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const negativePrecision = tn + fn ? tn / (tn + fn) : 0;
  const negativeRecall = tn + fp ? tn / (tn + fp) : 0;
  const negativeF1 = negativePrecision + negativeRecall
    ? 2 * negativePrecision * negativeRecall / (negativePrecision + negativeRecall) : 0;
  return {
    count: total, covered, correct, tp, fp, tn, fn,
    accuracy: covered ? correct / covered : null,
    precision, recall, f1: positiveF1, macroF1: (positiveF1 + negativeF1) / 2,
    coverage: total ? covered / total : 0
  };
}
function applyClassifier(rows, classifier) {
  return rows.map(row => ({
    index: row.index, label: row.label,
    probability: sigmoid(dot(classifier.weights, standardize(row.features, classifier.means, classifier.scales)))
  }));
}
function create() {
  let idf = { documentCount: 0, values: {} };
  let baselineClassifier = null, contextualClassifier = null, lastTraining = null;
  function train(trainPairs, validationPairs, contextualModel, options = {}) {
    if (!contextualModel || typeof contextualModel.score !== "function" || typeof contextualModel.tokenize !== "function")
      throw new TypeError("A trained contextual attention model is required for lexical sense training.");
    if (!contextualModel.status || !contextualModel.status().trained)
      throw new TypeError("Train the contextual attention model before lexical sense comparison.");
    idf = buildIdf(trainPairs, contextualModel);
    const trainBatch = buildBatch(trainPairs, contextualModel, idf);
    const validationBatch = buildBatch(validationPairs, contextualModel, idf);
    const baseline = fitClassifier(trainBatch.baselineRows, validationBatch.baselineRows, options);
    const contextual = fitClassifier(trainBatch.contextualRows, validationBatch.contextualRows, options);
    baselineClassifier = baseline.classifier;
    contextualClassifier = contextual.classifier;
    lastTraining = {
      trainPairs: (trainPairs || []).length,
      baselineTrainCovered: trainBatch.baselineRows.length,
      contextualTrainCovered: trainBatch.contextualRows.length,
      validationPairs: (validationPairs || []).length,
      baselineValidationCovered: validationBatch.baselineRows.length,
      contextualValidationCovered: validationBatch.contextualRows.length,
      idfDocuments: idf.documentCount,
      featureDimension: contextualClassifier.dimension,
      baselineBestEpoch: baselineClassifier.bestEpoch,
      contextualBestEpoch: contextualClassifier.bestEpoch,
      baselineValidation: baseline.validation,
      contextualValidation: contextual.validation,
      selectionMetric: "validation_log_loss",
      objective: "same_vs_different_word_sense"
    };
    return { ...lastTraining };
  }
  function evaluate(pairs, contextualModel) {
    if (!baselineClassifier || !contextualClassifier) throw new TypeError("Train the lexical sense model before evaluation.");
    const batch = buildBatch(pairs, contextualModel, idf);
    const baselinePredictions = applyClassifier(batch.baselineRows, baselineClassifier);
    const contextualPredictions = applyClassifier(batch.contextualRows, contextualClassifier);
    const contextualIndexes = new Set(contextualPredictions.map(row => row.index));
    const baselinePaired = baselinePredictions.filter(row => contextualIndexes.has(row.index));
    const baselineMetrics = metricSummary(baselinePredictions, batch.total);
    const baselinePairedMetrics = metricSummary(baselinePaired, batch.total);
    const contextualMetrics = metricSummary(contextualPredictions, batch.total);
    const byIndex = new Map();
    for (const row of baselinePredictions) byIndex.set(row.index, { index: row.index, label: row.label, baselineProbability: row.probability });
    for (const row of contextualPredictions) {
      const item = byIndex.get(row.index) || { index: row.index, label: row.label };
      item.contextualProbability = row.probability;
      byIndex.set(row.index, item);
    }
    const predictions = [...byIndex.values()].sort((a, b) => a.index - b.index);
    return {
      total: batch.total,
      baseline: baselineMetrics,
      baselineOnContextualCoverage: baselinePairedMetrics,
      contextual: contextualMetrics,
      pairedDeltaPP: baselinePairedMetrics.accuracy == null || contextualMetrics.accuracy == null
        ? null : (contextualMetrics.accuracy - baselinePairedMetrics.accuracy) * 100,
      predictions
    };
  }
  function predictPair(pair, contextualModel) {
    const report = evaluate([pair], contextualModel);
    const row = report.predictions[0];
    return row ? {
      sameSense: row.contextualProbability == null ? null : row.contextualProbability >= .5,
      sameSenseProbability: row.contextualProbability == null ? null : row.contextualProbability,
      baselineSameSenseProbability: row.baselineProbability,
      contextualAvailable: row.contextualProbability != null
    } : null;
  }
  function status() {
    return {
      schema: SCHEMA, version: 1, trained: !!baselineClassifier && !!contextualClassifier,
      baselineFeatureCount: BASE_FEATURE_NAMES.length,
      contextualFeatureCount: contextualClassifier ? contextualClassifier.dimension : 0,
      idfDocuments: idf.documentCount,
      lastTraining: lastTraining ? { ...lastTraining } : null
    };
  }
  function exportState() {
    return {
      schema: SCHEMA, version: 1, idf: { documentCount: idf.documentCount, values: { ...idf.values } },
      baselineClassifier: baselineClassifier ? JSON.parse(JSON.stringify(baselineClassifier)) : null,
      contextualClassifier: contextualClassifier ? JSON.parse(JSON.stringify(contextualClassifier)) : null,
      lastTraining: lastTraining ? JSON.parse(JSON.stringify(lastTraining)) : null
    };
  }
  function loadState(state) {
    if (!state || state.schema !== SCHEMA || state.version !== 1 ||
        !state.idf || !state.idf.values || typeof state.idf.values !== "object")
      throw new TypeError("Unsupported lexical sense model state.");
    const validClassifier = classifier => !classifier ||
      (Array.isArray(classifier.weights) && Array.isArray(classifier.means) && Array.isArray(classifier.scales) &&
       classifier.weights.length === classifier.means.length + 1 &&
       classifier.means.length === classifier.scales.length &&
       classifier.weights.every(Number.isFinite) && classifier.means.every(Number.isFinite) &&
       classifier.scales.every(value => Number.isFinite(value) && value > 0));
    if (!validClassifier(state.baselineClassifier) || !validClassifier(state.contextualClassifier) ||
        !Object.values(state.idf.values).every(value => Number.isFinite(Number(value)) && Number(value) > 0))
      throw new TypeError("Lexical sense model weights or IDF values are malformed.");
    idf = { documentCount: Math.max(0, Math.floor(finite(state.idf.documentCount))), values: { ...state.idf.values } };
    baselineClassifier = state.baselineClassifier ? JSON.parse(JSON.stringify(state.baselineClassifier)) : null;
    contextualClassifier = state.contextualClassifier ? JSON.parse(JSON.stringify(state.contextualClassifier)) : null;
    lastTraining = state.lastTraining ? JSON.parse(JSON.stringify(state.lastTraining)) : null;
    return status();
  }
  return Object.freeze({ train, evaluate, predictPair, status, exportState, loadState });
}
const root = typeof window !== "undefined" ? window : globalThis;
root.NGLexicalSenseModel = Object.freeze({ schema: SCHEMA, version: 1, create, baseFeatureNames: BASE_FEATURE_NAMES });
})();