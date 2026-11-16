"use strict";
(function (root) {
  function create(options = {}) {
    const predictor = options.predictor || root.NGNgramPredictor;
    if (!predictor || typeof predictor.create !== "function" || typeof predictor.tokenize !== "function") {
      throw new Error("NGNgramPredictor is not available.");
    }
    const maxTrainingTokens = Math.max(1000, Math.min(100000, Math.floor(Number(options.maxTrainingTokens) || 24000)));
    let sourceRows = [];
    let model = predictor.create();
    let indexedMemories = 0;
    let droppedMemories = 0;
    let indexedTokens = 0;
    let generation = 0;
    const cache = new Map();

    function cleanRow(value) {
      const text = String(value && typeof value === "object" ? value.text || "" : value || "").trim().slice(0, 1200);
      return text && predictor.tokenize(text).length >= 2 ? text : "";
    }
    function selectRows(rows) {
      const selected = [];
      let tokens = 0;
      let dropped = 0;
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        const count = predictor.tokenize(row).length;
        if (count < 2) continue;
        if (tokens + count > maxTrainingTokens) {
          dropped++;
          continue;
        }
        selected.push(row);
        tokens += count;
      }
      selected.reverse();
      return { rows: selected, tokens, dropped };
    }
    function status() {
      const modelStatus = model && typeof model.status === "function" ? model.status() : {};
      return {
        available: !!(modelStatus && modelStatus.tokens > 0),
        sourceMemories: sourceRows.length,
        indexedMemories,
        droppedMemories,
        indexedTokens,
        maxTrainingTokens,
        generation,
        model: modelStatus
      };
    }
    function rebuild(entries = []) {
      sourceRows = (Array.isArray(entries) ? entries : [entries]).map(cleanRow).filter(Boolean);
      const selected = selectRows(sourceRows);
      const nextModel = predictor.create();
      nextModel.train(selected.rows);
      model = nextModel;
      indexedMemories = selected.rows.length;
      droppedMemories = selected.dropped;
      indexedTokens = selected.tokens;
      generation++;
      cache.clear();
      return status();
    }
    function addMemory(value) {
      const row = cleanRow(value);
      if (!row) return status();
      sourceRows.push(row);
      const count = predictor.tokenize(row).length;
      if (droppedMemories === 0 && indexedTokens + count <= maxTrainingTokens) {
        model.addSentence(row);
        indexedMemories++;
        indexedTokens += count;
        generation++;
        cache.clear();
        return status();
      }
      return rebuild(sourceRows);
    }
    function predictMasked(text, targetIndex, predictionOptions = {}) {
      if (!model || typeof model.predictMasked !== "function") return null;
      return model.predictMasked(text, targetIndex, predictionOptions);
    }
    function suggest(query, suggestionOptions = {}) {
      const tokens = predictor.tokenize(query);
      if (tokens.length < 3 || !status().available) return [];
      const maxSuggestions = Math.max(1, Math.min(8, Math.floor(Number(suggestionOptions.limit) || 3)));
      const minProbability = Math.max(0, Math.min(1, Number.isFinite(Number(suggestionOptions.minProbability))
        ? Number(suggestionOptions.minProbability) : 0.08));
      const key = tokens.join(" ") + "|" + maxSuggestions + "|" + minProbability;
      if (cache.has(key)) return cache.get(key).map(item => ({ ...item }));
      const found = new Map();
      const querySet = new Set(tokens);
      const maxPositions = Math.min(tokens.length, 32);
      for (let index = 0; index < maxPositions; index++) {
        const result = model.predictMasked(tokens, index, { limit: 6 });
        for (const prediction of result && result.predictions || []) {
          const token = String(prediction.token || "");
          const probability = Number(prediction.probability);
          if (!token || token.length < 3 || querySet.has(token) || !Number.isFinite(probability) ||
              probability < minProbability) continue;
          const previous = found.get(token);
          if (!previous || probability > previous.probability) {
            found.set(token, { token, probability, position: index });
          }
        }
      }
      const result = [...found.values()].sort((a, b) =>
        b.probability - a.probability || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0)
      ).slice(0, maxSuggestions);
      cache.set(key, result);
      if (cache.size > 96) cache.delete(cache.keys().next().value);
      return result.map(item => ({ ...item }));
    }
    return Object.freeze({ rebuild, addMemory, predictMasked, suggest, status });
  }
  const api = Object.freeze({ create });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NGNgramMemoryBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
