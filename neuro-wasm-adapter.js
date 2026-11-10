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
      setSynapseWeight: wrap("ng_brain_set_synapse_weight", "number", ["number", "number", "number", "number"]),
      setSynapseEligibility: wrap("ng_brain_set_synapse_eligibility", "number", ["number", "number", "number", "number"]),
      resetEligibility: wrap("ng_brain_reset_eligibility", null, ["number"]),
      stimulate: wrap("ng_brain_stimulate", "number", ["number", "number", "number"]),
      learn: wrap("ng_brain_learn", "number", ["number", "number", "number", "number"]),
      learnFromReward: wrap("ng_brain_learn_from_reward", "number", ["number", "number", "number", "number"]),
      learnContrastiveReward: wrap("ng_brain_learn_contrastive_reward", "number", ["number", "number", "number", "number", "number"]),
      learnContrastiveRewardAsymmetric: wrap("ng_brain_learn_contrastive_reward_asymmetric", "number", [
        "number", "number", "number", "number", "number", "number"
      ]),
      step: wrap("ng_brain_step", null, ["number", "number", "number"]),
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
      synapseSignal: wrap("ng_brain_synapse_signal_at", "number", ["number", "number"]),
      synapseEligibility: wrap("ng_brain_synapse_eligibility_at", "number", ["number", "number"])
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
          signal: api.synapseSignal(handle, position),
          eligibility: api.synapseEligibility(handle, position)
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

        setSynapseWeight(from, to, weight) {
          live();
          return api.setSynapseWeight(
            handle,
            Math.floor(finite(from, "from")),
            Math.floor(finite(to, "to")),
            finite(weight, "weight")
          ) === 1;
        },

        setSynapseEligibility(from, to, value) {
          live();
          return api.setSynapseEligibility(
            handle,
            Math.floor(finite(from, "from")),
            Math.floor(finite(to, "to")),
            finite(value, "eligibility")
          ) === 1;
        },

        resetEligibility() {
          live();
          api.resetEligibility(handle);
        },

        learn(learningRate = 0.05, reward = 1, weightDecay = 0) {
          live();
          return api.learn(
            handle,
            finite(learningRate, "learningRate"),
            finite(reward, "reward"),
            finite(weightDecay, "weightDecay")
          );
        },

        learnFromReward(learningRate = 0.05, reward = 1, weightDecay = 0) {
          live();
          return api.learnFromReward(
            handle,
            finite(learningRate, "learningRate"),
            finite(reward, "reward"),
            finite(weightDecay, "weightDecay")
          );
        },

        learnContrastiveReward(learningRate = 0.05, inputNeuronId, positiveNeuronId, negativeNeuronId) {
          live();
          return api.learnContrastiveReward(
            handle,
            finite(learningRate, "learningRate"),
            Math.floor(finite(inputNeuronId, "inputNeuronId")),
            Math.floor(finite(positiveNeuronId, "positiveNeuronId")),
            Math.floor(finite(negativeNeuronId, "negativeNeuronId"))
          );
        },

        learnContrastiveRewardAsymmetric(
          positiveLearningRate = 0.05, negativeLearningRate = 0.05,
          inputNeuronId, positiveNeuronId, negativeNeuronId
        ) {
          live();
          return api.learnContrastiveRewardAsymmetric(
            handle,
            finite(positiveLearningRate, "positiveLearningRate"),
            finite(negativeLearningRate, "negativeLearningRate"),
            Math.floor(finite(inputNeuronId, "inputNeuronId")),
            Math.floor(finite(positiveNeuronId, "positiveNeuronId")),
            Math.floor(finite(negativeNeuronId, "negativeNeuronId"))
          );
        },

        stimulate(neuronId, strength = 1) {
          live();
          return api.stimulate(
            handle,
            Math.floor(finite(neuronId, "neuronId")),
            finite(strength, "strength")
          ) === 1;
        },

        step(deltaSeconds, eligibilityRetention = 0.85) {
          live();
          const delta = finite(deltaSeconds, "deltaSeconds");
          const retention = finite(eligibilityRetention, "eligibilityRetention");
          if (delta < 0) throw new RangeError("deltaSeconds cannot be negative");
          if (retention < 0 || retention > 1) throw new RangeError("eligibilityRetention must be between 0 and 1");
          api.step(handle, delta, retention);
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

    function createBrainFromSnapshot(snapshot) {
      const source = snapshot && typeof snapshot === "object" ? snapshot : {};
      const sourceNeurons = Array.isArray(source.neurons) ? source.neurons : [];
      const sourceSynapses = Array.isArray(source.synapses) ? source.synapses : [];
      if (sourceNeurons.length > 2000 || sourceSynapses.length > 20000) {
        throw new RangeError("The WebAssembly shadow snapshot exceeds its safety limits");
      }

      const coreBrain = createBrain();
      const sourceToCore = new Map();
      const coreToSource = new Map();
      try {
        for (const row of sourceNeurons) {
          if (!row || row.id == null) throw new TypeError("Every shadow neuron must have a stable source ID");
          const sourceId = String(row.id);
          if (!sourceId || sourceToCore.has(sourceId)) {
            throw new TypeError("Shadow neuron IDs must be non-empty and unique");
          }
          const kind = row.kind ?? row.type ?? "logic";
          const x = finite(row.x ?? 0, "neuron.x");
          const y = finite(row.y ?? 0, "neuron.y");
          const excitability = finite(row.excitability ?? row.bias ?? 0.5, "neuron.excitability");
          const id = coreBrain.addNeuron(row.name || sourceId, kind, x, y, excitability);
          sourceToCore.set(sourceId, id);
          coreToSource.set(id, sourceId);

          const activation = finite(row.activation ?? row.activity ?? 0, "neuron.activation");
          if (activation > 0) coreBrain.stimulate(id, activation);
        }

        let acceptedSynapses = 0;
        for (const row of sourceSynapses) {
          if (!row) continue;
          const from = sourceToCore.get(String(row.from));
          const to = sourceToCore.get(String(row.to));
          if (!from || !to) continue;
          const weight = finite(row.weight ?? 0.5, "synapse.weight");
          if (coreBrain.addSynapse(from, to, weight)) {
            acceptedSynapses++;
            if (row.eligibility != null) {
              coreBrain.setSynapseEligibility(from, to, finite(row.eligibility, "synapse.eligibility"));
            }
          }
        }

        const mirror = {
          get neuronCount() { return coreBrain.neuronCount; },
          get synapseCount() { return coreBrain.synapseCount; },
          sourceNeuronId(sourceId) {
            return sourceToCore.get(String(sourceId)) ?? null;
          },
          stimulate(sourceId, strength = 1) {
            const id = sourceToCore.get(String(sourceId));
            return id == null ? false : coreBrain.stimulate(id, strength);
          },
          step(deltaSeconds, eligibilityRetention = 0.85) {
            coreBrain.step(deltaSeconds, eligibilityRetention);
          },
          setSynapseWeight(sourceFrom, sourceTo, weight) {
            const from = sourceToCore.get(String(sourceFrom));
            const to = sourceToCore.get(String(sourceTo));
            return from != null && to != null && coreBrain.setSynapseWeight(from, to, weight);
          },
          setSynapseEligibility(sourceFrom, sourceTo, value) {
            const from = sourceToCore.get(String(sourceFrom));
            const to = sourceToCore.get(String(sourceTo));
            return from != null && to != null && coreBrain.setSynapseEligibility(from, to, value);
          },
          resetEligibility() {
            coreBrain.resetEligibility();
          },
          learn(learningRate = 0.05, reward = 1, weightDecay = 0) {
            return coreBrain.learn(learningRate, reward, weightDecay);
          },
          learnFromReward(learningRate = 0.05, reward = 1, weightDecay = 0) {
            return coreBrain.learnFromReward(learningRate, reward, weightDecay);
          },
          learnContrastiveReward(learningRate = 0.05, inputSourceId, positiveSourceId, negativeSourceId) {
            const input = sourceToCore.get(String(inputSourceId));
            const positive = sourceToCore.get(String(positiveSourceId));
            const negative = sourceToCore.get(String(negativeSourceId));
            if (input == null || positive == null || negative == null) return 0;
            return coreBrain.learnContrastiveReward(learningRate, input, positive, negative);
          },
          learnContrastiveRewardAsymmetric(
            positiveLearningRate = 0.05, negativeLearningRate = 0.05,
            inputSourceId, positiveSourceId, negativeSourceId
          ) {
            const input = sourceToCore.get(String(inputSourceId));
            const positive = sourceToCore.get(String(positiveSourceId));
            const negative = sourceToCore.get(String(negativeSourceId));
            if (input == null || positive == null || negative == null) return 0;
            return coreBrain.learnContrastiveRewardAsymmetric(
              finite(positiveLearningRate, "positiveLearningRate"),
              finite(negativeLearningRate, "negativeLearningRate"),
              input, positive, negative);
          },
          snapshot() {
            const state = coreBrain.snapshot();
            return {
              neurons: state.neurons.map(row => ({
                ...row,
                id: coreToSource.get(row.id) || null,
                type: row.kind,
                bias: row.excitability,
                activity: row.activation
              })),
              synapses: state.synapses.map(row => ({
                ...row,
                from: coreToSource.get(row.from) || null,
                to: coreToSource.get(row.to) || null
              }))
            };
          },
          dispose() {
            sourceToCore.clear();
            coreToSource.clear();
            coreBrain.dispose();
          }
        };
        return Object.freeze(mirror);
      } catch (error) {
        coreBrain.dispose();
        throw error;
      }
    }

    return Object.freeze({
      version: 1,
      module,
      createBrain,
      createBrainFromSnapshot
    });
  }

  function createShadowController(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    const getSnapshot = typeof settings.getSnapshot === "function"
      ? settings.getSnapshot : () => ({ neurons: [], synapses: [] });
    let runtime = settings.runtime || null;
    let brain = null;
    let state = "idle";
    let lastError = "";
    let startPromise = null;
    let steps = 0;
    let stimulations = 0;
    let rebuilds = 0;
    let learningUpdates = 0;
    let sequenceRewards = 0;
    const learningOverlay = new Map();
    let disposed = false;

    const edgeKey = (from, to) => String(from) + "\u0000" + String(to);

    function fail(error, fallback) {
      lastError = error && error.message ? String(error.message).slice(0, 240) : fallback;
    }

    function diagnostics() {
      return {
        backend: "wasm-shadow",
        authority: "javascript",
        state,
        neurons: brain ? brain.neuronCount : 0,
        synapses: brain ? brain.synapseCount : 0,
        steps,
        stimulations,
        rebuilds,
        learningUpdates,
        sequenceRewards,
        learnedSynapses: learningOverlay.size,
        lastError: lastError || null
      };
    }

    function rebuild() {
      if (disposed || !runtime) return false;
      let candidate = null;
      try {
        const previousSnapshot = brain ? brain.snapshot() : null;
        const previousEdges = previousSnapshot ? previousSnapshot.synapses : [];
        const source = getSnapshot();
        const sourceEdges = Array.isArray(source && source.synapses) ? source.synapses : [];
        const sourceWeights = new Map();
        for (const edge of sourceEdges) {
          if (!edge || edge.from == null || edge.to == null) continue;
          const weight = finite(edge.weight ?? 0.5, "synapse.weight");
          sourceWeights.set(edgeKey(edge.from, edge.to), weight);
        }
        candidate = runtime.createBrainFromSnapshot(source);

        for (const [key, learned] of learningOverlay) {
          const baseWeight = sourceWeights.get(key);
          if (baseWeight == null || Math.abs(baseWeight - learned.baseWeight) > 1.0e-6) {
            learningOverlay.delete(key);
            continue;
          }
          const separator = key.indexOf("\u0000");
          const from = key.slice(0, separator);
          const to = key.slice(separator + 1);
          if (!candidate.setSynapseWeight(from, to, learned.weight)) learningOverlay.delete(key);
        }

        const candidateWeights = new Map(candidate.snapshot().synapses.map(edge => [
          edgeKey(edge.from, edge.to), edge.weight
        ]));
        for (const edge of previousEdges) {
          const key = edgeKey(edge.from, edge.to);
          const nextWeight = candidateWeights.get(key);
          if (nextWeight != null && Math.abs(nextWeight - edge.weight) <= 1.0e-6 &&
              Number.isFinite(edge.eligibility) && edge.eligibility > 0) {
            candidate.setSynapseEligibility(edge.from, edge.to, edge.eligibility);
          }
        }

        const previous = brain;
        brain = candidate;
        candidate = null;
        if (previous) previous.dispose();
        rebuilds++;
        lastError = "";
        state = "ready";
        return true;
      } catch (error) {
        if (candidate) candidate.dispose();
        fail(error, "Unable to rebuild the WebAssembly shadow network");
        return false;
      }
    }

    async function start() {
      if (disposed) return false;
      if (state === "ready" && brain) return true;
      if (startPromise) return startPromise;
      state = "loading";
      startPromise = (async () => {
        try {
          if (!runtime) runtime = await load({
            moduleUrl: settings.moduleUrl,
            moduleFactory: settings.moduleFactory,
            moduleOptions: settings.moduleOptions
          });
          if (disposed) return false;
          const ok = rebuild();
          if (!ok) state = "error";
          return ok;
        } catch (error) {
          if (!disposed) {
            fail(error, "WebAssembly shadow runtime could not be loaded");
            state = "unavailable";
          }
          return false;
        } finally {
          startPromise = null;
        }
      })();
      return startPromise;
    }

    function stimulate(sourceId, strength = 1) {
      if (disposed || state !== "ready" || !brain) return false;
      try {
        const ok = brain.stimulate(sourceId, finite(strength, "strength"));
        if (ok) stimulations++;
        return ok;
      } catch (error) {
        fail(error, "WebAssembly shadow stimulation failed");
        return false;
      }
    }

    function step(deltaSeconds, eligibilityRetention = 0.85) {
      if (disposed || state !== "ready" || !brain) return false;
      try {
        brain.step(deltaSeconds, eligibilityRetention);
        steps++;
        return true;
      } catch (error) {
        fail(error, "WebAssembly shadow step failed");
        return false;
      }
    }

    function recordLearningOverlay(changed) {
      const source = getSnapshot();
      const sourceEdges = Array.isArray(source && source.synapses) ? source.synapses : [];
      const baseWeights = new Map();
      for (const edge of sourceEdges) {
        if (!edge || edge.from == null || edge.to == null) continue;
        baseWeights.set(edgeKey(edge.from, edge.to), finite(edge.weight ?? 0.5, "synapse.weight"));
      }
      const stateSnapshot = brain.snapshot();
      for (const edge of stateSnapshot.synapses) {
        const key = edgeKey(edge.from, edge.to);
        const baseWeight = baseWeights.get(key);
        if (baseWeight == null || Math.abs(edge.weight - baseWeight) <= 1.0e-6) {
          learningOverlay.delete(key);
        } else {
          learningOverlay.set(key, { baseWeight, weight: edge.weight });
        }
      }
      learningUpdates += changed;
      lastError = "";
      return changed;
    }

    function learn(learningRate = 0.05, reward = 1, weightDecay = 0) {
      if (disposed || state !== "ready" || !brain) return 0;
      try {
        const changed = brain.learn(
          finite(learningRate, "learningRate"),
          finite(reward, "reward"),
          finite(weightDecay, "weightDecay")
        );
        return recordLearningOverlay(changed);
      } catch (error) {
        fail(error, "WebAssembly shadow learning failed");
        return 0;
      }
    }

    function learnFromReward(learningRate = 0.05, reward = 1, weightDecay = 0) {
      if (disposed || state !== "ready" || !brain) return 0;
      try {
        const changed = brain.learnFromReward(
          finite(learningRate, "learningRate"),
          finite(reward, "reward"),
          finite(weightDecay, "weightDecay")
        );
        sequenceRewards++;
        return recordLearningOverlay(changed);
      } catch (error) {
        fail(error, "WebAssembly sequence reward failed");
        return 0;
      }
    }

    function learnContrastiveReward(learningRate = 0.05, inputSourceId, positiveSourceId, negativeSourceId) {
      if (disposed || state !== "ready" || !brain) return 0;
      try {
        const changed = brain.learnContrastiveReward(
          finite(learningRate, "learningRate"), inputSourceId, positiveSourceId, negativeSourceId
        );
        sequenceRewards++;
        return recordLearningOverlay(changed);
      } catch (error) {
        fail(error, "WebAssembly contrastive reward failed");
        return 0;
      }
    }

    function learnContrastiveRewardAsymmetric(
      positiveLearningRate = 0.05, negativeLearningRate = 0.05,
      inputSourceId, positiveSourceId, negativeSourceId
    ) {
      if (disposed || state !== "ready" || !brain) return 0;
      try {
        const changed = brain.learnContrastiveRewardAsymmetric(
          finite(positiveLearningRate, "positiveLearningRate"),
          finite(negativeLearningRate, "negativeLearningRate"),
          inputSourceId, positiveSourceId, negativeSourceId
        );
        sequenceRewards++;
        return recordLearningOverlay(changed);
      } catch (error) {
        fail(error, "WebAssembly asymmetric contrastive reward failed");
        return 0;
      }
    }

    function resetEligibility() {
      if (disposed || state !== "ready" || !brain) return false;
      try {
        brain.resetEligibility();
        lastError = "";
        return true;
      } catch (error) {
        fail(error, "WebAssembly eligibility reset failed");
        return false;
      }
    }

    function learnedWeights() {
      return [...learningOverlay.entries()].map(([key, value]) => {
        const separator = key.indexOf("\u0000");
        return {
          from: key.slice(0, separator),
          to: key.slice(separator + 1),
          baseWeight: value.baseWeight,
          weight: value.weight
        };
      });
    }

    function restoreLearnedWeights(rows) {
      if (disposed || !Array.isArray(rows) || rows.length > 20000) return false;
      const restored = new Map();
      try {
        for (const row of rows) {
          if (!row || row.from == null || row.to == null) return false;
          const baseWeight = finite(row.baseWeight, "baseWeight");
          const weight = finite(row.weight, "weight");
          restored.set(edgeKey(row.from, row.to), {
            baseWeight: Math.max(0, Math.min(1, baseWeight)),
            weight: Math.max(0, Math.min(1, weight))
          });
        }
        const previous = new Map(learningOverlay);
        learningOverlay.clear();
        for (const entry of restored) learningOverlay.set(...entry);
        if (state === "ready" && brain) {
          const ok = rebuild();
          if (!ok) {
            learningOverlay.clear();
            for (const entry of previous) learningOverlay.set(...entry);
          }
          return ok;
        }
        return true;
      } catch (error) {
        fail(error, "Could not restore learned synapse weights");
        return false;
      }
    }

    function snapshot() {
      return brain ? brain.snapshot() : { neurons: [], synapses: [] };
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (brain) brain.dispose();
      brain = null;
      learningOverlay.clear();
      state = "disposed";
    }

    return Object.freeze({
      start, rebuild, stimulate, step, learn, learnFromReward, learnContrastiveReward,
      learnContrastiveRewardAsymmetric, resetEligibility,
      snapshot, learnedWeights, restoreLearnedWeights, diagnostics, dispose
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

  root.NGWasm = Object.freeze({ version: 1, load, createShadowController });
})();
