(() => {
  "use strict";

  function edgeKey(from, to) {
    return String(from) + "\u0000" + String(to);
  }

  function build(neurons, synapses, selectedId) {
    if (!Array.isArray(neurons) || !Array.isArray(synapses) ||
        selectedId == null || String(selectedId) === "") return null;
    const selected = String(selectedId);
    if (!neurons.some(neuron => neuron && String(neuron.id) === selected)) return null;

    const nodeIds = new Set([selected]);
    const edgeKeys = new Set();
    for (const edge of synapses) {
      if (!edge || edge.from == null || edge.to == null) continue;
      const from = String(edge.from), to = String(edge.to);
      if (from !== selected && to !== selected) continue;
      nodeIds.add(from);
      nodeIds.add(to);
      edgeKeys.add(edgeKey(from, to));
    }

    return Object.freeze({
      selectedId: selected,
      nodeIds: Object.freeze([...nodeIds]),
      edgeKeys: Object.freeze([...edgeKeys])
    });
  }

  globalThis.NGNeuronFocus = Object.freeze({ build, edgeKey });
})();
