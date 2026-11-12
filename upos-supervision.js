(() => {
  "use strict";

  const SCHEMA = "NG_UPOS_CONTEXT_HEAD_V1";

  function cleanLabel(value) {
    const label = String(value || "").trim();
    return /^[A-Z][A-Z0-9_]*$/u.test(label) ? label : "";
  }
  function normaliseLemma(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/gu, "е")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }
  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function seededRandom(seed) {
    let state = (Math.floor(finite(seed, 9173)) >>> 0) || 9173;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function softmax(logits) {
    if (!logits.length) return [];
    const maximum = Math.max(...logits);
    const exponents = logits.map(value => Math.exp(Math.max(-60, Math.min(60, value - maximum))));
    const total = exponents.reduce((sum, value) => sum + value, 0) || 1;
    return exponents.map(value => value / total);
  }
  function extractExamples(records, contextualModel) {
    if (!Array.isArray(records)) throw new TypeError("Annotated sentence records must be an array.");
    if (!contextualModel || typeof contextualModel.tokenize !== "function" ||
        typeof contextualModel.score !== "function") {
      throw new TypeError("A trained contextual model with tokenize() and score() is required.");
    }
    const examples = [];
    const reasons = {};
    let alignedSentences = 0;
    const skip = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };
    for (const record of records) {
      if (!record || typeof record.text !== "string" || !Array.isArray(record.tokens)) {
        skip("missing_sentence_annotations");
        continue;
      }
      const textTokens = contextualModel.tokenize(record.text);
      const aligned = [];
      let invalidForm = false;
      for (const token of record.tokens) {
        const pieces = contextualModel.tokenize(token && token.form);
        if (!pieces.length) continue;
        if (!token || pieces.length > 4) {
          invalidForm = true;
          break;
        }
        for (const piece of pieces) aligned.push({token, piece});
      }
      if (invalidForm) {
        skip("unsupported_token_form");
        continue;
      }
      if (aligned.length !== textTokens.length ||
          aligned.some((row, index) => row.piece !== textTokens[index])) {
        skip("tokenization_mismatch");
        continue;
      }
      alignedSentences++;
      for (let index = 0; index < aligned.length; index++) {
        const annotation = aligned[index].token;
        const label = cleanLabel(annotation.upos);
        if (!label) {
          skip("missing_upos");
          continue;
        }
        const score = contextualModel.score(record.text, index);
        if (!score || !Array.isArray(score.tokenVector) || !Array.isArray(score.contextualVector) ||
            score.tokenVector.length !== score.contextualVector.length) {
          skip("missing_contextual_features");
          continue;
        }
        const features = score.tokenVector.concat(score.contextualVector).map(Number);
        if (!features.length || !features.every(Number.isFinite)) {
          skip("invalid_contextual_features");
          continue;
        }
        examples.push({
          features,
          label,
          token: aligned[index].piece,
          lemma: normaliseLemma(annotation.lemma || annotation.form),
          sentenceId: record.sentenceId || null,
          targetKnown: score.targetKnown === true
        });
      }
    }
    return {
      examples,
      stats: {
        inputSentences: records.length,
        alignedSentences,
        skippedSentences: records.length - alignedSentences,
        tokenExamples: examples.length,
        skippedReasons: reasons
      }
    };
  }

  function create(options = {}) {
    const seed = Math.floor(finite(options.seed, 9173)) >>> 0;
    let labels = [], weights = [], bias = [], featureDimension = 0;
    let trainingSteps = 0, lastTraining = null, labelCounts = {};
    function copyState() {
      return {
        schema: SCHEMA,
        version: 1,
        labels: labels.slice(),
        featureDimension,
        weights: weights.map(row => row.slice()),
        bias: bias.slice(),
        trainingSteps,
        labelCounts: {...labelCounts},
        lastTraining: lastTraining ? {...lastTraining} : null
      };
    }
    function logitsFor(features) {
      if (!Array.isArray(features) || features.length !== featureDimension ||
          !features.every(value => Number.isFinite(Number(value)))) return null;
      return weights.map((row, index) =>
        row.reduce((sum, value, position) => sum + value * features[position], bias[index]));
    }
    function predict(features) {
      if (!labels.length) return null;
      const logits = logitsFor(features);
      if (!logits) return null;
      const probabilities = softmax(logits);
      let best = 0;
      for (let index = 1; index < probabilities.length; index++) {
        if (probabilities[index] > probabilities[best]) best = index;
      }
      return {
        label: labels[best],
        confidence: probabilities[best],
        probabilities: labels.map((label, index) => ({label, probability: probabilities[index]}))
          .sort((left, right) => right.probability - left.probability)
      };
    }
    function evaluate(examples) {
      const rows = Array.isArray(examples) ? examples : [];
      let total = 0, correct = 0, covered = 0, loss = 0;
      const classes = {};
      for (const example of rows) {
        const prediction = predict(example.features);
        if (!prediction) continue;
        total++;
        const supported = labels.includes(example.label);
        if (supported) {
          covered++;
          loss -= Math.log(Math.max(1e-12,
            prediction.probabilities.find(row => row.label === example.label)?.probability || 0));
        }
        const hit = prediction.label === example.label;
        if (hit) correct++;
        const row = classes[example.label] || (classes[example.label] = {
          targets: 0, supportedTargets: 0, correct: 0, predicted: 0
        });
        row.targets++;
        if (supported) row.supportedTargets++;
        if (hit) row.correct++;
        const predictedRow = classes[prediction.label] || (classes[prediction.label] = {
          targets: 0, supportedTargets: 0, correct: 0, predicted: 0
        });
        predictedRow.predicted++;
      }
      const perClass = Object.fromEntries(Object.entries(classes).map(([label, row]) => {
        const precision = row.predicted ? row.correct / row.predicted : 0;
        const recall = row.supportedTargets ? row.correct / row.supportedTargets : 0;
        return [label, {
          ...row,
          precision,
          recall,
          f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0
        }];
      }));
      const f1Values = Object.values(perClass).filter(row => row.supportedTargets > 0).map(row => row.f1);
      return {
        targets: total,
        covered,
        correct,
        accuracy: covered ? correct / covered : null,
        coverage: total ? covered / total : null,
        loss: covered ? loss / covered : null,
        macroF1: f1Values.length ? f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length : null,
        perClass
      };
    }
    function train(trainExamples, validationExamples = [], trainOptions = {}) {
      const rows = Array.isArray(trainExamples) ? trainExamples.filter(Boolean) : [];
      if (!rows.length) throw new TypeError("UPOS training needs at least one annotated token.");
      const dimension = rows[0].features && rows[0].features.length;
      if (!Number.isInteger(dimension) || dimension < 1 ||
          rows.some(row => !Array.isArray(row.features) || row.features.length !== dimension ||
            !row.features.every(value => Number.isFinite(Number(value))) || !cleanLabel(row.label))) {
        throw new TypeError("UPOS training examples have invalid features or labels.");
      }
      const validation = Array.isArray(validationExamples) ? validationExamples.filter(Boolean) : [];
      if (validation.some(row => !Array.isArray(row.features) || row.features.length !== dimension ||
          !row.features.every(value => Number.isFinite(Number(value))) || !cleanLabel(row.label))) {
        throw new TypeError("UPOS validation examples have invalid features or labels.");
      }
      labels = [...new Set(rows.map(row => cleanLabel(row.label)))].sort();
      if (labels.length < 2) throw new TypeError("UPOS training needs at least two distinct classes.");
      featureDimension = dimension;
      labelCounts = {};
      for (const row of rows) labelCounts[row.label] = (labelCounts[row.label] || 0) + 1;
      const random = seededRandom(trainOptions.seed == null ? seed : trainOptions.seed);
      weights = Array.from({length: labels.length}, () =>
        Array.from({length: featureDimension}, () => (random() * 2 - 1) * 0.015));
      bias = Array.from({length: labels.length}, () => 0);
      const labelIndexes = new Map(labels.map((label, index) => [label, index]));
      const learningRate = Math.max(0.0001, Math.min(0.2, finite(trainOptions.learningRate, 0.035)));
      const epochs = Math.max(1, Math.min(200, Math.floor(finite(trainOptions.epochs, 80))));
      const patience = Math.max(2, Math.min(40, Math.floor(finite(trainOptions.patience, 12))));
      const l2 = Math.max(0, Math.min(0.01, finite(trainOptions.l2, 0.00005)));
      const shuffleRandom = seededRandom(trainOptions.shuffleSeed == null ? seed ^ 0x9e3779b9 : trainOptions.shuffleSeed);
      const initialValidation = validation.length ? evaluate(validation) : null;
      let bestLoss = initialValidation && initialValidation.loss != null ? initialValidation.loss : Infinity;
      let bestWeights = weights.map(row => row.slice()), bestBias = bias.slice();
      let bestEpoch = 0, staleEpochs = 0, epochsRun = 0, earlyStopped = false;
      for (let epoch = 0; epoch < epochs; epoch++) {
        const order = rows.slice();
        for (let index = order.length - 1; index > 0; index--) {
          const swap = Math.floor(shuffleRandom() * (index + 1));
          const item = order[index]; order[index] = order[swap]; order[swap] = item;
        }
        for (const example of order) {
          const classIndex = labelIndexes.get(example.label);
          const probabilities = softmax(logitsFor(example.features));
          for (let category = 0; category < labels.length; category++) {
            const error = probabilities[category] - (category === classIndex ? 1 : 0);
            for (let feature = 0; feature < featureDimension; feature++) {
              weights[category][feature] -= learningRate *
                (error * Number(example.features[feature]) + l2 * weights[category][feature]);
            }
            bias[category] -= learningRate * error;
          }
          trainingSteps++;
        }
        epochsRun = epoch + 1;
        if (validation.length) {
          const report = evaluate(validation);
          if (report.loss < bestLoss - 1e-8) {
            bestLoss = report.loss;
            bestWeights = weights.map(row => row.slice());
            bestBias = bias.slice();
            bestEpoch = epochsRun;
            staleEpochs = 0;
          } else {
            staleEpochs++;
            if (staleEpochs >= patience) {
              earlyStopped = epochsRun < epochs;
              break;
            }
          }
        }
      }
      if (validation.length) {
        weights = bestWeights;
        bias = bestBias;
      } else {
        bestEpoch = epochsRun;
      }
      const trainReport = evaluate(rows);
      const validationReport = validation.length ? evaluate(validation) : null;
      const majorityLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      lastTraining = {
        trainExamples: rows.length,
        validationExamples: validation.length,
        classes: labels.slice(),
        featureDimension,
        epochs: epochsRun,
        requestedEpochs: epochs,
        bestEpoch,
        earlyStopped,
        learningRate,
        l2,
        initialValidationLoss: initialValidation ? initialValidation.loss : null,
        validationLoss: validationReport ? validationReport.loss : null,
        trainingAccuracy: trainReport.accuracy,
        validationAccuracy: validationReport ? validationReport.accuracy : null,
        majorityLabel,
        majorityTrainingCount: labelCounts[majorityLabel],
        trainingSteps
      };
      return {...lastTraining};
    }
    function status() {
      return {
        schema: SCHEMA,
        version: 1,
        trained: labels.length > 0,
        labels: labels.slice(),
        featureDimension,
        trainingSteps,
        labelCounts: {...labelCounts},
        lastTraining: lastTraining ? {...lastTraining} : null
      };
    }
    function exportState() {
      return copyState();
    }
    function loadState(state) {
      if (!state || state.schema !== SCHEMA || state.version !== 1 ||
          !Array.isArray(state.labels) || !state.labels.length ||
          !Number.isInteger(state.featureDimension) || state.featureDimension < 1 ||
          !Array.isArray(state.weights) || state.weights.length !== state.labels.length ||
          state.weights.some(row => !Array.isArray(row) || row.length !== state.featureDimension ||
            !row.every(value => Number.isFinite(Number(value)))) ||
          !Array.isArray(state.bias) || state.bias.length !== state.labels.length ||
          !state.bias.every(value => Number.isFinite(Number(value)))) {
        throw new TypeError("UPOS classifier checkpoint is malformed.");
      }
      labels = state.labels.map(cleanLabel);
      if (labels.some(label => !label) || new Set(labels).size !== labels.length) {
        throw new TypeError("UPOS classifier labels are invalid.");
      }
      featureDimension = state.featureDimension;
      weights = state.weights.map(row => row.map(Number));
      bias = state.bias.map(Number);
      trainingSteps = Math.max(0, Math.floor(finite(state.trainingSteps, 0)));
      labelCounts = state.labelCounts && typeof state.labelCounts === "object" ? {...state.labelCounts} : {};
      lastTraining = state.lastTraining && typeof state.lastTraining === "object" ? {...state.lastTraining} : null;
      return status();
    }
    return Object.freeze({train, predict, evaluate, status, exportState, loadState});
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.NGWordSupervision = Object.freeze({schema: SCHEMA, version: 1, extractExamples, create, normaliseLemma});
})();