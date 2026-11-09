(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const KIND_CODES = Object.freeze({
    core: 0,
    sensory: 1,
    memory: 2,
    logic: 3,
    output: 4
  });
  const KIND_NAMES = Object.freeze(["core", "sensory", "memory", "logic", "output"]);

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(name + " must be a finite number");
    return number;
  }

  function createRuntime(module) {
    if (!module || typeof module.cwrap !== "function") {
      throw new TypeError("The WebAssembly module must expose Emscripten cwrap()");
    }

    const wrap = (name, result, args) => module.cwrap(name, result, args);
    const api = {
      create: wrap("ng_brain_create", "number", []),
      destroy: wrap("ng_brain_destroy", null, ["number"]),
      addNeuron: wrap("ng_brain_add_neuron", "number", [
        "number", "string", "number", "number", "number", "number"
      ]),
      addSynapse: wrap("ng_brain_add_synapse", "number", ["number", "number", "number", "number"]),
      stimulate: wrap("ng_brain_stimulate", "number", ["number", "number", "number"]),
      step: wrap("ng_brain_step", null, ["number", "number"]),
      neuronCount: wrap("ng_brain_neuron_count", "number", ["number"]),
      synapseCount: wrap("ng_brain_synapse_count", "number", ["number"]),
      neuronId: wrap("ng_brain_neuron_id_at", "number", ["number", "number"]),
      neuronKind: wrap("ng_brain_neuron_kind_at", "number", ["number", "number"]),
      neuronActivation: wrap("ng_brain_neuron_activation_at", "number", ["number", "number"]),
      neuronExcitability: wrap("ng_brain_neuron_excitability_at", "number", ["number", "number"]),
      neuronX: wrap("ng_brain_neuron_x_at", "number", ["number", "number"]),
      neuronY: wrap("ng_brain_neuron_y_at", "number", ["number", "number"]),
      synapseFrom: wrap("ng_brain_synapse_from_at", "number", ["number", "number"]),
      synapseTo: wrap("ng_brain_synapse_to_at", "number", ["number", "number"]),
      synapseWeight: wrap("ng_brain_synapse_weight_at", "number", ["number", "number"]),
      synapseSignal: wrap("ng_brain_synapse_signal_at", "number", ["number", "number"])
    };

    function createBrain() {
      const handle = api.create();
      if (!handle) throw new Error("Could not allocate the NEUROGENESIS WebAssembly brain");
      let disposed = false;
      const names = new Map();

      function live() {
        if (disposed) throw new Error("This NEUROGENESIS brain has already been disposed");
      }

      function getNeuronAt(index) {
        live();
        const count = api.neuronCount(handle);
        const position = Math.floor(finite(index, "index"));
        if (position < 0 || position >= count) return null;
        const id = api.neuronId(handle, position);
        const kind = api.neuronKind(handle, position);
        return {
          id,
          name: names.get(id) || "",
          kind: KIND_NAMES[kind] || "logic",
          activation: api.neuronActivation(handle, position),
          excitability: api.neuronExcitability(handle, position),
          x: api.neuronX(handle, position),
          y: api.neuronY(handle, position)
        };
      }

      function getSynapseAt(index) {
        live();
        const count = api.synapseCount(handle);
        const position = Math.floor(finite(index, "index"));
        if (position < 0 || position >= count) return null;
        return {
          from: api.synapseFrom(handle, position),
          to: api.synapseTo(handle, position),
          weight: api.synapseWeight(handle, position),
          signal: api.synapseSignal(handle, position)
        };
      }

      const brain = {
        addNeuron(name, kind, x = 0, y = 0, excitability = 0.5) {
          live();
          const kindCode = typeof kind === "number" ? kind : KIND_CODES[String(kind || "").toLowerCase()];
          if (!Number.isInteger(kindCode) || kindCode < 0 || kindCode >= KIND_NAMES.length) {
            throw new TypeError("kind must be core, sensory, memory, logic, output or a valid numeric code");
          }
          const safeName = String(name || "").slice(0, 64);
          const id = api.addNeuron(
            handle,
            safeName,
            kindCode,
            finite(x, "x"),
            finite(y, "y"),
            finite(excitability, "excitability")
          );
          if (!id) throw new Error("The WebAssembly core could not add this neuron");
          names.set(id, safeName);
          return id;
        },

        addSynapse(from, to, weight = 0.5) {
          live();
          return api.addSynapse(
            handle,
            Math.floor(finite(from, "from")),
            Math.floor(finite(to, "to")),
            finite(weight, "weight")
          ) === 1;
        },

        stimulate(neuronId, strength = 1) {
          live();
          return api.stimulate(
            handle,
            Math.floor(finite(neuronId, "neuronId")),
            finite(strength, "strength")
          ) === 1;
        },

        step(deltaSeconds) {
          live();
          const delta = finite(deltaSeconds, "deltaSeconds");
          if (delta < 0) throw new RangeError("deltaSeconds cannot be negative");
          api.step(handle, delta);
        },

        get neuronCount() {
          live();
          return api.neuronCount(handle);
        },

        get synapseCount() {
          live();
          return api.synapseCount(handle);
        },

        getNeuronAt,
        getSynapseAt,

        snapshot() {
          live();
          const neurons = Array.from({ length: api.neuronCount(handle) }, (_, i) => getNeuronAt(i));
          const synapses = Array.from({ length: api.synapseCount(handle) }, (_, i) => getSynapseAt(i));
          return { neurons, synapses };
        },

        dispose() {
          if (disposed) return;
          disposed = true;
          names.clear();
          api.destroy(handle);
        }
      };

      return Object.freeze(brain);
    }

    return Object.freeze({
      version: 1,
      module,
      createBrain
    });
  }

  async function load(options = {}) {
    let factory = options.moduleFactory;
    if (!factory) {
      const moduleUrl = options.moduleUrl || "./dist/neurogenesis.mjs";
      const imported = await import(moduleUrl);
      factory = imported.default || imported.NeurogenesisModule;
    }
    if (typeof factory !== "function") {
      throw new TypeError("Could not find the NEUROGENESIS WebAssembly module factory");
    }
    const module = await factory(options.moduleOptions || {});
    return createRuntime(module);
  }

  root.NGWasm = Object.freeze({ version: 1, load });
})();
