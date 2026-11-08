(() => {
  "use strict";

  function spread(seeds, edges, options = {}) {
    const optionNumber = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const maxDepth = Math.max(0, Math.min(4, Math.floor(optionNumber(options.maxDepth, 2))));
    const maxNodes = Math.max(1, Math.min(64, Math.floor(optionNumber(options.maxNodes, 18))));
    const decay = Math.max(0, Math.min(1, optionNumber(options.decay, 0.62)));
    const threshold = Math.max(0, Math.min(1, optionNumber(options.threshold, 0.12)));
    const adjacency = new Map();

    for (const edge of Array.isArray(edges) ? edges : []) {
      if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string" || edge.from === edge.to) continue;
      const weight = Number(edge.weight);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push({ id: edge.to, weight: Math.max(0, Math.min(1, weight)) });
    }

    const best = new Map();
    const queue = [];
    for (const seed of Array.isArray(seeds) ? seeds : []) {
      const id = typeof seed === "string" ? seed : seed && seed.id;
      const strength = typeof seed === "string" || !seed || seed.strength == null ? 0.72 : Number(seed.strength);
      if (typeof id !== "string" || !id || best.has(id)) continue;
      const safeStrength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.72;
      if (safeStrength < threshold) continue;
      best.set(id, { id, strength: safeStrength, depth: 0 });
      queue.push({ id, strength: safeStrength, depth: 0 });
      if (best.size >= maxNodes) break;
    }

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const strongest = best.get(current.id);
      if (!strongest || current.strength < strongest.strength || current.depth >= maxDepth) continue;
      for (const edge of adjacency.get(current.id) || []) {
        const strength = current.strength * edge.weight * decay;
        if (strength < threshold) continue;
        const previous = best.get(edge.id);
        if (previous && previous.strength >= strength) continue;
        if (!previous && best.size >= maxNodes) continue;
        const next = { id: edge.id, strength, depth: current.depth + 1 };
        best.set(edge.id, next);
        queue.push(next);
      }
    }

    return [...best.values()].sort((a, b) => a.depth - b.depth || b.strength - a.strength);
  }

  window.NGActivation = { version: 1, spread };
})();
