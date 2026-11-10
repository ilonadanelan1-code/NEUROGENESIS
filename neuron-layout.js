(() => {
  "use strict";
  const DEFAULT_MIN_DISTANCE = 86;
  const DEFAULT_ITERATIONS = 180;
  const EPSILON = 1e-7;

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(name + " must be finite");
    return number;
  }
  function stableAngle(firstId, secondId) {
    const text = String(firstId) + "\u0000" + String(secondId);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) / 4294967296) * Math.PI * 2;
  }
  function buildGrid(xs, ys, cellSize) {
    const grid = new Map();
    for (let i = 0; i < xs.length; i++) {
      const key = Math.floor(xs[i] / cellSize) + ":" + Math.floor(ys[i] / cellSize);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }
    return grid;
  }
  function measure(xs, ys, minDistance) {
    const grid = buildGrid(xs, ys, minDistance);
    let overlaps = 0, minimumDistance = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const cellX = Math.floor(xs[i] / minDistance);
      const cellY = Math.floor(ys[i] / minDistance);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get((cellX + ox) + ":" + (cellY + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const distance = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
          if (distance < minimumDistance) minimumDistance = distance;
          if (distance + EPSILON < minDistance) overlaps++;
        }
      }
    }
    return { overlaps, minimumDistance: Number.isFinite(minimumDistance) ? minimumDistance : null };
  }
  function separate(nodes, options = {}) {
    if (!Array.isArray(nodes)) throw new TypeError("nodes must be an array");
    if (nodes.length > 2500) throw new RangeError("The layout safety limit is 2500 neurons");
    const settings = options && typeof options === "object" ? options : {};
    const minDistance = finite(settings.minDistance ?? DEFAULT_MIN_DISTANCE, "minDistance");
    const iterations = Math.floor(finite(settings.iterations ?? DEFAULT_ITERATIONS, "iterations"));
    const relaxation = finite(settings.relaxation ?? 0.24, "relaxation");
    const maxMove = finite(settings.maxMove ?? 14, "maxMove");
    if (minDistance < 24 || minDistance > 240 || iterations < 1 || iterations > 400 ||
        relaxation <= 0 || relaxation > 0.5 || maxMove <= 0 || maxMove > 48) {
      throw new RangeError("Layout parameters are outside safe bounds");
    }

    const ids = new Set(), xs = new Float64Array(nodes.length), ys = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || node.id == null || String(node.id).trim() === "") {
        throw new TypeError("Every neuron must have a non-empty ID");
      }
      const id = String(node.id);
      if (ids.has(id)) throw new TypeError("Neuron IDs must be unique");
      ids.add(id);
      xs[i] = finite(node.x, "node.x");
      ys[i] = finite(node.y, "node.y");
    }

    const before = measure(xs, ys, minDistance);
    const separationDistance = minDistance;
    let completedIterations = 0;
    for (let iteration = 0; iteration < iterations; iteration++) {
      const grid = buildGrid(xs, ys, separationDistance);
      const forceX = new Float64Array(nodes.length), forceY = new Float64Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const cellX = Math.floor(xs[i] / separationDistance), cellY = Math.floor(ys[i] / separationDistance);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((cellX + ox) + ":" + (cellY + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
            let distance = Math.hypot(dx, dy);
            if (distance >= separationDistance) continue;
            if (distance < EPSILON) {
              const angle = stableAngle(nodes[i].id, nodes[j].id);
              dx = Math.cos(angle); dy = Math.sin(angle); distance = 1;
            }
            const displacement = Math.min(maxMove, (separationDistance - distance) * relaxation);
            const ux = dx / distance, uy = dy / distance;
            forceX[i] += ux * displacement; forceY[i] += uy * displacement;
            forceX[j] -= ux * displacement; forceY[j] -= uy * displacement;
          }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        const magnitude = Math.hypot(forceX[i], forceY[i]);
        if (magnitude <= EPSILON) continue;
        const scale = magnitude > maxMove ? maxMove / magnitude : 1;
        xs[i] += forceX[i] * scale; ys[i] += forceY[i] * scale;
      }
      completedIterations = iteration + 1;
      if (measure(xs, ys, minDistance).overlaps === 0) break;
    }

    const after = measure(xs, ys, minDistance);
    const positions = nodes.map((node, index) => ({ id: String(node.id), x: xs[index], y: ys[index] }));
    const movedCount = positions.reduce((count, position, index) =>
      count + (Math.hypot(position.x - Number(nodes[index].x), position.y - Number(nodes[index].y)) > 0.01 ? 1 : 0), 0);
    return Object.freeze({
      positions, movedCount, minDistance, overlapsBefore: before.overlaps,
      overlapsAfter: after.overlaps, minimumDistanceBefore: before.minimumDistance,
      minimumDistanceAfter: after.minimumDistance, iterations: completedIterations
    });
  }
  globalThis.NGNeuronLayout = Object.freeze({ separate });
})();
