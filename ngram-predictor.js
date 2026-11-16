"use strict";
/*
 * NGNgramPredictor — двусторонний статистический предсказатель скрытого слова.
 *
 * Идея: слово предсказывается по левому и правому контексту одновременно.
 * Используется несколько «каналов» (соседи ±1, ±2, пары слева/справа, пропуски),
 * каждый в двух вариантах: по точным словам и по основам (первые символы слова),
 * что даёт обобщение на новые словоформы. Вероятности каналов смешиваются с весами,
 * которые подбираются на ОТДЕЛЬНОЙ validation-выборке. Тестовые данные никогда
 * не участвуют ни в счётчиках, ни в подборе весов.
 *
 * Нет ограничений на размер корпуса и словаря (в отличие от attention-модели).
 */
(function (root) {
  const BOS = "<s>", EOS = "</s>";
  const STEM_LEN = 5;

  function tokenize(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/gu, "е")
      .match(/[\p{L}\p{N}]+/gu) || [];
  }
  function stemOf(word) {
    return word.length > STEM_LEN ? word.slice(0, STEM_LEN) : word;
  }

  // Канал = набор смещений относительно маски и режим ключа (surface | stem).
  const OFFSET_SETS = [
    [-1], [1], [-2], [2],
    [-2, -1], [1, 2], [-1, 1],
    [-2, -1, 1], [-1, 1, 2], [-2, -1, 1, 2]
  ];
  const CHANNELS = [];
  for (const offsets of OFFSET_SETS) {
    for (const mode of ["surface", "stem"]) CHANNELS.push({ offsets, mode, name: (mode === "surface" ? "w" : "t") + offsets.join(",") });
  }

  function keyFor(tokens, index, channel) {
    const parts = [];
    for (const offset of channel.offsets) {
      const position = index + offset;
      let word = position < 0 ? BOS : position >= tokens.length ? EOS : tokens[position];
      if (channel.mode === "stem" && word !== BOS && word !== EOS) word = stemOf(word);
      parts.push(word);
    }
    return parts.join("\u0001");
  }

  function defaultWeights() {
    const weights = {};
    for (const channel of CHANNELS) {
      const specificity = channel.offsets.length;
      weights[channel.name] = Math.pow(2, specificity - 1) * (channel.mode === "surface" ? 1 : 0.6);
    }
    weights.unigram = 0.02;
    weights.shrink = 0.5;
    return weights;
  }

  function create() {
    const tables = CHANNELS.map(() => new Map());   // key -> {total, targets: Map}
    const unigram = new Map();
    let unigramTotal = 0;
    let weights = defaultWeights();
    let trainedSentences = 0;

    function addSentence(text) {
      const tokens = tokenize(text);
      if (tokens.length < 2) return;
      trainedSentences++;
      for (let index = 0; index < tokens.length; index++) {
        const target = tokens[index];
        unigram.set(target, (unigram.get(target) || 0) + 1);
        unigramTotal++;
        for (let c = 0; c < CHANNELS.length; c++) {
          const key = keyFor(tokens, index, CHANNELS[c]);
          let entry = tables[c].get(key);
          if (!entry) { entry = { total: 0, targets: new Map() }; tables[c].set(key, entry); }
          entry.total++;
          entry.targets.set(target, (entry.targets.get(target) || 0) + 1);
        }
      }
    }

    function train(texts) {
      for (const text of texts) addSentence(text);
      return { sentences: trainedSentences, vocabulary: unigram.size, tokens: unigramTotal };
    }

    function scoreAll(tokens, index) {
      const scores = new Map();
      const shrink = weights.shrink;
      for (let c = 0; c < CHANNELS.length; c++) {
        const entry = tables[c].get(keyFor(tokens, index, CHANNELS[c]));
        if (!entry) continue;
        const weight = weights[CHANNELS[c].name];
        if (!weight) continue;
        const denominator = entry.total + shrink;
        for (const [target, count] of entry.targets) {
          scores.set(target, (scores.get(target) || 0) + weight * count / denominator);
        }
      }
      if (weights.unigram > 0 && unigramTotal) {
        // Небольшой априор по частоте добавляется только уже найденным кандидатам
        // и (если совпадений нет вовсе) самым частотным словам.
        if (!scores.size) {
          const top = Array.from(unigram.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
          for (const [word, count] of top) scores.set(word, weights.unigram * count / unigramTotal);
        } else {
          for (const word of scores.keys()) scores.set(word, scores.get(word) + weights.unigram * (unigram.get(word) || 0) / unigramTotal);
        }
      }
      return scores;
    }

    function predictMasked(text, targetIndex, options = {}) {
      const tokens = Array.isArray(text) ? text.slice() : tokenize(text);
      if (!tokens.length) return null;
      const index = Math.max(0, Math.min(tokens.length - 1, Math.floor(Number(targetIndex) || 0)));
      const limit = Math.max(1, Math.min(20, options.limit || 8));
      const scores = scoreAll(tokens, index);
      let sum = 0;
      for (const value of scores.values()) sum += value;
      const predictions = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, limit)
        .map(([token, value]) => ({ token, probability: sum > 0 ? value / sum : 0 }));
      return { maskedTokenIndex: index, available: predictions.length > 0, predictions };
    }

    // Подбор весов по validation: покоординатный поиск, критерий — top-1 accuracy.
    function accuracyOn(rows, maxPositions) {
      let correct = 0, total = 0;
      for (const row of rows) {
        const tokens = tokenize(row);
        for (let i = 0; i < tokens.length; i++) {
          if (maxPositions && total >= maxPositions) return correct / Math.max(1, total);
          const prediction = predictMasked(tokens, i, { limit: 1 });
          total++;
          if (prediction && prediction.predictions[0] && prediction.predictions[0].token === tokens[i]) correct++;
        }
      }
      return total ? correct / total : 0;
    }
    function tuneWeights(validationRows, options = {}) {
      const rounds = options.rounds || 2;
      const factors = [0, 0.25, 0.5, 2, 4];
      let best = accuracyOn(validationRows);
      const initial = best;
      const names = CHANNELS.map(channel => channel.name).concat(["unigram", "shrink"]);
      for (let round = 0; round < rounds; round++) {
        for (const name of names) {
          const original = weights[name];
          let bestValue = original;
          for (const factor of factors) {
            if (name === "shrink" && factor === 0) continue;
            weights[name] = original * factor;
            const accuracy = accuracyOn(validationRows);
            if (accuracy > best + 1e-9) { best = accuracy; bestValue = weights[name]; }
          }
          weights[name] = bestValue;
        }
      }
      return { initialValidationAccuracy: initial, tunedValidationAccuracy: best };
    }

    function status() {
      return { sentences: trainedSentences, vocabulary: unigram.size, tokens: unigramTotal, channels: CHANNELS.length };
    }
    function knows(word) { return unigram.has(word); }
    function getWeights() { return Object.assign({}, weights); }
    function setWeights(next) { weights = Object.assign(defaultWeights(), next || {}); }

    return Object.freeze({ train, addSentence, predictMasked, tuneWeights, status, knows, getWeights, setWeights, tokenize });
  }

  const api = Object.freeze({ create, tokenize, stemOf, channels: CHANNELS.map(c => c.name) });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NGNgramPredictor = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
