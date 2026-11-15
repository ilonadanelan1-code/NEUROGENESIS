(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const MAX_WINDOW = 8;
  const normalise = value => String(value == null ? "" : value).normalize("NFKC").toLowerCase().replace(/ё/gu, "е");
  const tokenize = value => normalise(value).match(/[\p{L}\p{N}]+/gu)?.slice(0, 96) || [];

  function create(model) {
    if (!model || typeof model.exportState !== "function") throw new TypeError("A trained contextual model with exportState() is required.");
    const state = model.exportState();
    if (!state || !Array.isArray(state.vocabulary) || !Array.isArray(state.trainingContextExamples)) {
      throw new TypeError("The model checkpoint does not contain training context examples.");
    }
    const vocabulary = new Set(state.vocabulary.map(normalise));
    const examples = state.trainingContextExamples.filter(example =>
      example && typeof example.target === "string" && vocabulary.has(normalise(example.target)) &&
      Array.isArray(example.context) && example.context.length >= 2 && example.context.length <= 16 &&
      example.context.every(row => row && typeof row.token === "string" && Number.isInteger(row.offset) &&
        row.offset !== 0 && Math.abs(row.offset) <= MAX_WINDOW));
    const stemOf = token => typeof model.russianStem === "function" ? normalise(model.russianStem(token)) : normalise(token);
    const documentFrequency = new Map(), exactPostings = new Map(), stemPostings = new Map();
    const appendPosting = (index, key, posting) => {
      if (!key) return;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(posting);
    };
    examples.forEach((example, exampleIndex) => {
      const seen = new Set();
      example.context.forEach((row, contextIndex) => {
        const token = normalise(row.token), stem = stemOf(row.stem || row.token);
        appendPosting(exactPostings, token, { exampleIndex, contextIndex });
        appendPosting(stemPostings, stem, { exampleIndex, contextIndex });
        if (stem) seen.add(stem);
      });
      for (const stem of seen) documentFrequency.set(stem, (documentFrequency.get(stem) || 0) + 1);
    });
    const documentCount = Math.max(1, examples.length);

    function shortlistExamples(query) {
      const byExample = new Map();
      query.forEach((item, queryIndex) => {
        const postings = new Set([
          ...(exactPostings.get(item.token) || []),
          ...(item.stem.length >= 3 ? stemPostings.get(item.stem) || [] : [])
        ].map(row => row.exampleIndex));
        for (const exampleIndex of postings) {
          if (!byExample.has(exampleIndex)) byExample.set(exampleIndex, new Set());
          byExample.get(exampleIndex).add(queryIndex);
        }
      });
      return [...byExample.entries()].filter(([, queryIndexes]) => queryIndexes.size >= 2)
        .map(([exampleIndex]) => exampleIndex).sort((a, b) => a - b);
    }

    function maskedContext(text, targetIndex) {
      const tokens = tokenize(text);
      if (!tokens.length) return { index: -1, context: [] };
      const index = Math.max(0, Math.min(tokens.length - 1, Math.floor(Number(targetIndex) || 0)));
      const context = [];
      for (let offset = -MAX_WINDOW; offset <= MAX_WINDOW; offset++) {
        if (offset === 0) continue;
        const position = index + offset;
        if (position < 0 || position >= tokens.length) continue;
        const token = tokens[position];
        context.push({ token, stem: stemOf(token), offset });
      }
      return { index, context };
    }

    function compareContext(query, example, allowOrderInversion) {
      const used = new Set();
      let matched = 0, exact = 0, stemMatches = 0, aligned = 0, weighted = 0, possible = 0;
      const matchedTokens = [];
      for (const item of query) {
        const stem = item.stem, df = documentFrequency.get(stem) || 0;
        const idf = 1 + Math.log((documentCount + 1) / (df + 1));
        possible += idf;
        let best = null;
        for (let index = 0; index < example.context.length; index++) {
          if (used.has(index)) continue;
          const row = example.context[index], rowToken = normalise(row.token), rowStem = stemOf(row.stem || row.token);
          const isExact = item.token === rowToken, isSameStem = !isExact && stem.length >= 3 && stem === rowStem;
          if (!isExact && !isSameStem) continue;
          const sameOffset = item.offset === row.offset, inverted = item.offset === -row.offset;
          let positionWeight = sameOffset ? 1 : 0;
          if (!sameOffset && allowOrderInversion && inverted) positionWeight = 0.58;
          if (!sameOffset && !inverted && Math.sign(item.offset) === Math.sign(row.offset) &&
              Math.abs(item.offset - row.offset) === 1) positionWeight = 0.68;
          if (positionWeight === 0) continue;
          const quality = (isExact ? 1 : 0.62) * positionWeight * idf;
          if (!best || quality > best.quality) best = { index, quality, isExact, sameOffset, token: row.token, offset: row.offset };
        }
        if (!best) continue;
        used.add(best.index); matched++;
        if (best.isExact) exact++; else stemMatches++;
        if (best.sameOffset) aligned++;
        weighted += best.quality;
        matchedTokens.push({ token: item.token, matched: best.token, offset: item.offset,
          trainingOffset: best.offset, kind: best.isExact ? "exact" : "same_stem" });
      }
      const coverage = query.length ? matched / query.length : 0;
      const lexical = matched ? (exact + stemMatches * 0.62) / matched : 0;
      const alignment = matched ? aligned / matched : 0;
      const weightedCoverage = possible ? weighted / possible : 0;
      return { score: 0.58 * weightedCoverage + 0.22 * coverage + 0.12 * lexical + 0.08 * alignment,
        matched, exact, stemMatches, aligned, coverage, matchedTokens };
    }

    function predictMasked(text, targetIndex, predictOptions = {}) {
      const parsed = maskedContext(text, targetIndex);
      if (parsed.index < 0) return { available: false, reason: "empty_input", candidates: [], context: [] };
      if (parsed.context.length < 2) return { available: false, reason: "insufficient_context", candidates: [], context: parsed.context };
      if (!examples.length) return { available: false, reason: "no_training_contexts", candidates: [], context: parsed.context };

      const byTarget = new Map(), candidateIndexes = shortlistExamples(parsed.context);
      for (const exampleIndex of candidateIndexes) {
        const example = examples[exampleIndex];
        const evidence = compareContext(parsed.context, example, predictOptions.allowOrderInversion === true);
        if (evidence.matched < 2 || evidence.coverage < 0.34) continue;
        const key = normalise(example.target);
        if (!byTarget.has(key)) byTarget.set(key, { baseToken: example.target, evidence: [], contexts: new Set() });
        const record = byTarget.get(key);
        const contextKey = example.context.map(row => String(row.offset) + ":" + normalise(row.token)).sort().join("|");
        if (!record.contexts.has(contextKey)) { record.contexts.add(contextKey); record.evidence.push(evidence); }
      }

      let neural = null;
      if (typeof model.predictMasked === "function") {
        try { neural = model.predictMasked(text, parsed.index); } catch (_) { neural = null; }
      }
      const neuralRows = Array.isArray(neural?.predictions) ? neural.predictions : [];
      const neuralMax = Math.max(1e-12, ...neuralRows.map(row => Number(row.probability) || 0));
      const morphologyHint = neural?.morphologyHint || null;
      const limit = Math.max(1, Math.min(16, Math.floor(Number(predictOptions.limit) || 8)));
      const candidates = [];

      for (const record of byTarget.values()) {
        const rankedEvidence = record.evidence.sort((a, b) => b.score - a.score), best = rankedEvidence[0];
        const supportBonus = Math.min(0.06, Math.max(0, rankedEvidence.length - 1) * 0.015);
        const neuralRow = neuralRows.find(row => normalise(row.token) === normalise(record.baseToken));
        const neuralProbability = neuralRow ? Math.max(0, Number(neuralRow.probability) || 0) : 0;
        const neuralBonus = neuralRow ? 0.08 * Math.min(1, neuralProbability / neuralMax) : 0;
        const contextScore = Math.min(1, best.score + supportBonus), score = Math.min(1, contextScore * 0.92 + neuralBonus);
        let surface = record.baseToken, method = "training_context_ranker";
        const features = {};
        if (morphologyHint?.number === "plural" && typeof model.russianNounPlural === "function") {
          const plural = model.russianNounPlural(record.baseToken);
          if (plural) { surface = plural; method = "training_context_ranker_plus_plural_rule"; features.number = "plural"; }
        }
        candidates.push({ token: surface, surface, baseToken: record.baseToken, score, contextScore, neuralProbability,
          support: rankedEvidence.length, matchedCount: best.matched, queryCoverage: best.coverage,
          exactMatches: best.exact, stemMatches: best.stemMatches, offsetMatches: best.aligned,
          matchedContextTokens: best.matchedTokens, features, method });
      }
      candidates.sort((a, b) => b.score - a.score || b.support - a.support || a.baseToken.localeCompare(b.baseToken));
      const unique = [], seenSurface = new Set();
      for (const candidate of candidates) {
        const key = normalise(candidate.surface);
        if (seenSurface.has(key)) continue;
        seenSurface.add(key); unique.push(candidate);
        if (unique.length >= limit) break;
      }
      return { available: unique.length > 0, reason: unique.length ? null : "no_context_match",
        maskedTokenIndex: parsed.index, morphologyHint, contextTokenCount: parsed.context.length,
        candidateCount: unique.length, candidates: unique, method: "context_only_training_example_ranking", targetSurfaceUsed: false };
    }

    return Object.freeze({ predictMasked, status: () => ({ schema: "NG_CONTEXTUAL_CANDIDATE_RANKER_V1",
      trainingContextExamples: examples.length, indexedStems: documentFrequency.size, exactTerms: exactPostings.size,
      stemTerms: stemPostings.size, maxWindowSize: MAX_WINDOW }) });
  }
  root.NGContextualCandidateRanker = Object.freeze({ schema: "NG_CONTEXTUAL_CANDIDATE_RANKER_V1", create });
})();