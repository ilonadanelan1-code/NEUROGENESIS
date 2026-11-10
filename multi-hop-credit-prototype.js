(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const EPSILON = 1e-6;

  const keyOf = (from, to) => JSON.stringify([String(from), String(to)]);
  const nodeOf = (snapshot, id) =>
    snapshot.neurons.find(row => String(row.id) === String(id)) || null;
  const copy = snapshot => ({
    neurons: (snapshot.neurons || []).map(row => ({ ...row })),
    synapses: (snapshot.synapses || []).map(row => ({ ...row }))
  });

  function enumerateSimplePaths(snapshot, inputId, maxDepth = 6, maxPaths = 64) {
    const nodes = new Map(snapshot.neurons.map(row => [String(row.id), row]));
    const outgoing = new Map();
    for (const edge of snapshot.synapses) {
      const from = String(edge.from);
      if (!outgoing.has(from)) outgoing.set(from, []);
      outgoing.get(from).push(edge);
    }
    const paths = [];
    let truncated = false;

    function visit(current, visited, edges) {
      if (truncated || edges.length >= maxDepth) return;
      for (const edge of outgoing.get(current) || []) {
        if (truncated) return;
        const next = String(edge.to);
        if (visited.has(next) || !(Number(edge.eligibility) > EPSILON)) continue;
        const node = nodes.get(next);
        if (!node) continue;
        const routeEdges = [...edges, edge];
        if (String(node.type || node.kind || "") === "output") {
          if (paths.length >= maxPaths) {
            truncated = true;
            return;
          }
          paths.push({ outputId: next, nodes: [...visited, next], edges: routeEdges });
        } else {
          const nextVisited = new Set(visited);
          nextVisited.add(next);
          visit(next, nextVisited, routeEdges);
        }
      }
    }

    if (!nodes.has(String(inputId))) return { paths, truncated: false, error: "input-not-found" };
    visit(String(inputId), new Set([String(inputId)]), []);
    return { paths, truncated };
  }

  function scorePath(path, snapshot) {
    const output = nodeOf(snapshot, path.outputId);
    const activation = Number(output && (output.activity ?? output.activation ?? 0));
    if (!(activation > EPSILON) || !path.edges.length) return 0;
    const meanLog = path.edges.reduce((sum, edge) =>
      sum + Math.log(Math.max(EPSILON, Number(edge.eligibility))), 0) / path.edges.length;
    return Math.exp(meanLog) * activation;
  }

  function normalizedCredits(paths, snapshot) {
    const scored = paths.map(path => ({ path, score: scorePath(path, snapshot) }));
    const total = scored.reduce((sum, item) => sum + item.score, 0);
    return total > EPSILON
      ? scored.map(item => ({ ...item, credit: item.score / total }))
      : [];
  }

  function accumulate(map, path, credit) {
    for (const edge of path.edges) {
      const key = keyOf(edge.from, edge.to);
      map.set(key, (map.get(key) || 0) + credit);
    }
  }

  function createProposal(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    const runtime = settings.runtime;
    if (!runtime || typeof runtime.createBrainFromSnapshot !== "function") {
      return { ok: false, code: "runtime-unavailable", message: "WASM-кандидат недоступен.", proposal: null };
    }

    const snapshot = copy(settings.snapshot || {});
    const inputId = String(settings.inputId ?? "");
    const targetId = String(settings.targetOutputId ?? "");
    const positiveRate = Number(settings.positiveLearningRate ?? 0.08);
    const negativeRate = Number(settings.negativeLearningRate ?? 0.4);
    const maxDepth = Number(settings.maxDepth ?? 6);
    const maxPaths = Number(settings.maxPaths ?? 64);
    const input = nodeOf(snapshot, inputId);
    const target = nodeOf(snapshot, targetId);
    if (!inputId || !targetId || inputId === targetId ||
        !input || !target || String(target.type || target.kind || "") !== "output" ||
        String(input.type || input.kind || "") === "output" ||
        !Number.isFinite(positiveRate) || positiveRate < 0 || positiveRate > 1 ||
        !Number.isFinite(negativeRate) || negativeRate < 0 || negativeRate > 1 ||
        !Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 8 ||
        !Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 128) {
      return { ok: false, code: "invalid-parameters", message: "Неверные нейроны или параметры опыта.", proposal: null };
    }

    const enumeration = enumerateSimplePaths(snapshot, inputId, maxDepth, maxPaths);
    if (enumeration.error) {
      return { ok: false, code: enumeration.error, message: "Входной нейрон не найден.", proposal: null };
    }
    if (enumeration.truncated) {
      return { ok: false, code: "path-limit-exceeded", message: "Лимит маршрутов превышен; опыт остановлен без предложения.", proposal: null };
    }

    const eligible = enumeration.paths.filter(path =>
      path.edges.every(edge => Number(edge.eligibility) > EPSILON)
    );
    const positives = normalizedCredits(eligible.filter(path => path.outputId === targetId), snapshot);
    const negatives = normalizedCredits(eligible.filter(path => path.outputId !== targetId), snapshot);
    if (!positives.length || !negatives.length) {
      return { ok: false, code: "target-or-competitor-path-missing", message: "Не найдены оба класса активных маршрутов.", proposal: null };
    }

    const positiveCredit = new Map();
    const negativeCredit = new Map();
    for (const item of positives) accumulate(positiveCredit, item.path, item.credit);
    for (const item of negatives) accumulate(negativeCredit, item.path, item.credit);

    const candidate = runtime.createBrainFromSnapshot(snapshot);
    try {
      const before = candidate.snapshot();
      const changes = [];
      for (const edge of snapshot.synapses) {
        const key = keyOf(edge.from, edge.to);
        const pos = positiveCredit.get(key) || 0;
        const neg = negativeCredit.get(key) || 0;
        const net = pos - neg;
        if (Math.abs(net) <= EPSILON) continue;
        const weight = Number(edge.weight);
        const trace = Number(edge.eligibility);
        if (!Number.isFinite(weight) || !Number.isFinite(trace) ||
            weight < 0 || weight > 1 || trace < 0 || trace > 1) {
          throw new Error("Non-finite or out-of-range edge state");
        }
        const delta = net > 0
          ? positiveRate * trace * (1 - weight) * net
          : -negativeRate * trace * weight * Math.abs(net);
        const after = Math.max(0, Math.min(1, weight + delta));
        if (Math.abs(after - weight) <= EPSILON) continue;
        if (!candidate.setSynapseWeight(edge.from, edge.to, after)) {
          throw new Error("Could not update candidate edge");
        }
        changes.push({
          from: String(edge.from), to: String(edge.to),
          before: weight, after, delta: after - weight,
          positiveCredit: pos, competingCredit: neg
        });
      }

      const after = candidate.snapshot();
      const changedKeys = new Set(changes.map(row => keyOf(row.from, row.to)));
      const sharedKeys = snapshot.synapses.filter(edge =>
        Math.abs((positiveCredit.get(keyOf(edge.from, edge.to)) || 0) -
          (negativeCredit.get(keyOf(edge.from, edge.to)) || 0)) <= EPSILON
      ).map(edge => keyOf(edge.from, edge.to));
      const sharedEdgesPreserved = sharedKeys.every(key => {
        const edge = snapshot.synapses.find(row => keyOf(row.from, row.to) === key);
        const oldRow = before.synapses.find(row => keyOf(row.from, row.to) === key);
        const newRow = after.synapses.find(row => keyOf(row.from, row.to) === key);
        return edge && oldRow && newRow && Math.abs(oldRow.weight - newRow.weight) <= EPSILON;
      });
      const candidateChangesVerified = changes.every(change => {
        const actual = after.synapses.find(row => keyOf(row.from, row.to) === keyOf(change.from, change.to));
        return actual && Math.abs(Number(actual.weight) - change.after) <= EPSILON;
      });
      const unchangedEdgesPreserved = snapshot.synapses
        .filter(edge => !changedKeys.has(keyOf(edge.from, edge.to)))
        .every(edge => {
          const prior = before.synapses.find(row => keyOf(row.from, row.to) === keyOf(edge.from, edge.to));
          const current = after.synapses.find(row => keyOf(row.from, row.to) === keyOf(edge.from, edge.to));
          return prior && current && Math.abs(Number(prior.weight) - Number(current.weight)) <= EPSILON;
        });
      const bounded = after.synapses.every(edge =>
        Number.isFinite(Number(edge.weight)) && Number(edge.weight) >= 0 && Number(edge.weight) <= 1
      );
      const routeData = rows => rows.map(item => ({
        nodes: item.path.nodes,
        outputId: item.path.outputId,
        score: item.score,
        credit: item.credit
      }));
      const proposal = {
        format: "NEUROGENESIS_PATH_AWARE_PROPOSAL",
        version: 1,
        policy: "manual-review-only",
        inputId, targetOutputId: targetId, maxDepth,
        targetPaths: routeData(positives),
        competingPaths: routeData(negatives),
        changes
      };
      const ok = changes.length > 0 && sharedEdgesPreserved && unchangedEdgesPreserved &&
        candidateChangesVerified && bounded && changedKeys.size === changes.length;
      return {
        ok,
        code: ok ? "path-aware-proposal-ready" : "candidate-validation-failed",
        message: ok ? "Создано предложение на отдельной WASM-копии; основная сеть не менялась." :
          "Кандидат не прошёл проверку; предложение отклонено.",
        proposal: ok ? proposal : null,
        report: {
          changedEdges: changes.length,
          positiveRouteCount: positives.length,
          competingRouteCount: negatives.length,
          sharedEdgesPreserved,
          unchangedEdgesPreserved,
          candidateChangesVerified,
          weightsBounded: bounded,
          baselineEdgeCount: before.synapses.length,
          candidateEdgeCount: after.synapses.length
        }
      };
    } finally {
      candidate.dispose();
    }
  }

  root.NGPathAwareCreditPrototype = Object.freeze({ createProposal, enumerateSimplePaths });
})();
