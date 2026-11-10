import assert from "node:assert/strict";
import createModule from "../dist/neurogenesis.mjs";
import "../neuro-wasm-adapter.js";

const runtime = await globalThis.NGWasm.load({ moduleFactory: createModule });
const f32 = Math.fround;
const close = (actual, expected, label, epsilon = 1.0e-5) => {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    label + ": expected " + expected + ", received " + actual
  );
};

function referenceStep(state, deltaSeconds, eligibilityRetention = 0.85) {
  const dt = f32(Math.max(0, Math.min(0.25, deltaSeconds)));
  const index = new Map(state.neurons.map((neuron, position) => [neuron.id, position]));
  const incoming = new Float32Array(state.neurons.length);

  for (const edge of state.synapses) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from == null || to == null) continue;
    const transmitted = f32(state.neurons[from].activation * edge.weight);
    incoming[to] = f32(incoming[to] + transmitted);
    const faded = f32(edge.signal - f32(dt * 2.0));
    edge.signal = Math.max(0, faded);
    edge.signal = Math.max(edge.signal, transmitted);
  }

  for (let i = 0; i < state.neurons.length; i++) {
    const neuron = state.neurons[i];
    const drive = f32(incoming[i] * neuron.excitability);
    const response = drive > 0.05 ? f32(Math.min(1, drive)) : 0;
    const decayed = f32(neuron.activation - f32(dt * 0.65));
    neuron.activation = f32(Math.max(0, Math.min(1, Math.max(decayed, response))));
  }

  const retention = f32(Math.max(0, Math.min(1, eligibilityRetention)));
  const byId = new Map(state.neurons.map(neuron => [neuron.id, neuron]));
  for (const edge of state.synapses) {
    const pre = byId.get(edge.from)?.activation ?? 0;
    const post = byId.get(edge.to)?.activation ?? 0;
    const retained = f32(edge.eligibility * retention);
    const coactivation = f32(pre * post);
    edge.eligibility = f32(Math.max(0, Math.min(1, f32(retained + coactivation))));
  }
}

function referenceLearn(state, learningRate, reward, weightDecay) {
  const rate = f32(Math.max(0, Math.min(1, learningRate)));
  const reinforcement = f32(Math.max(-1, Math.min(1, reward)));
  const decay = f32(Math.max(0, Math.min(1, weightDecay)));
  const byId = new Map(state.neurons.map(neuron => [neuron.id, neuron]));
  let changed = 0;

  for (const edge of state.synapses) {
    const pre = byId.get(edge.from)?.activation ?? 0;
    const post = byId.get(edge.to)?.activation ?? 0;
    let potentiation = f32(rate * reinforcement);
    potentiation = f32(potentiation * pre);
    potentiation = f32(potentiation * post);
    const weakening = f32(decay * edge.weight);
    const sum = f32(edge.weight + potentiation);
    const updated = f32(Math.max(0, Math.min(1, f32(sum - weakening))));
    if (Math.abs(updated - edge.weight) > 1.0e-7) {
      edge.weight = updated;
      changed++;
    }
  }
  return changed;
}

function referenceLearnFromReward(state, learningRate, reward, weightDecay) {
  const rate = f32(Math.max(0, Math.min(1, learningRate)));
  const reinforcement = f32(Math.max(-1, Math.min(1, reward)));
  const decay = f32(Math.max(0, Math.min(1, weightDecay)));
  let changed = 0;
  for (const edge of state.synapses) {
    const potentiation = f32(f32(rate * reinforcement) * edge.eligibility);
    const weakening = f32(decay * edge.weight);
    const updated = f32(Math.max(0, Math.min(1, f32(edge.weight + potentiation - weakening))));
    if (Math.abs(updated - edge.weight) > 1.0e-7) {
      edge.weight = updated;
      changed++;
    }
    edge.eligibility = 0;
  }
  return changed;
}

function referenceLearnContrastiveReward(state, learningRate, inputNeuronId, positiveNeuronId, negativeNeuronId) {
  const rate = f32(Math.max(0, Math.min(1, learningRate)));
  let changed = 0;
  for (const edge of state.synapses) {
    const sign = edge.from === inputNeuronId && edge.to === positiveNeuronId ? 1 :
      edge.from === inputNeuronId && edge.to === negativeNeuronId ? -1 : 0;
    const delta = f32(f32(rate * sign) * edge.eligibility);
    const updated = f32(Math.max(0, Math.min(1, f32(edge.weight + delta))));
    if (Math.abs(updated - edge.weight) > 1.0e-7) {
      edge.weight = updated;
      changed++;
    }
    edge.eligibility = 0;
  }
  return changed;
}

function referenceLearnContrastiveRewardAsymmetric(
  state, positiveLearningRate, negativeLearningRate,
  inputNeuronId, positiveNeuronId, negativeNeuronId
) {
  const positiveRate = f32(Math.max(0, Math.min(1, positiveLearningRate)));
  const negativeRate = f32(Math.max(0, Math.min(1, negativeLearningRate)));
  let changed = 0;
  for (const edge of state.synapses) {
    let delta = 0;
    if (edge.from === inputNeuronId && edge.to === positiveNeuronId) {
      delta = f32(positiveRate * edge.eligibility);
    } else if (edge.from === inputNeuronId && edge.to === negativeNeuronId) {
      delta = f32(-f32(negativeRate * edge.eligibility));
    }
    const updated = f32(Math.max(0, Math.min(1, f32(edge.weight + delta))));
    if (Math.abs(updated - edge.weight) > 1.0e-7) {
      edge.weight = updated;
      changed++;
    }
    edge.eligibility = 0;
  }
  return changed;
}

function assertParity(actual, expected, phase) {
  assert.equal(actual.neurons.length, expected.neurons.length, phase + " neuron count");
  assert.equal(actual.synapses.length, expected.synapses.length, phase + " synapse count");
  for (let i = 0; i < expected.neurons.length; i++) {
    close(actual.neurons[i].activation, expected.neurons[i].activation,
      phase + " neuron " + expected.neurons[i].id + " activation");
    close(actual.neurons[i].excitability, expected.neurons[i].excitability,
      phase + " neuron " + expected.neurons[i].id + " excitability");
  }
  for (let i = 0; i < expected.synapses.length; i++) {
    close(actual.synapses[i].weight, expected.synapses[i].weight,
      phase + " synapse " + i + " weight");
    close(actual.synapses[i].signal, expected.synapses[i].signal,
      phase + " synapse " + i + " signal");
    close(actual.synapses[i].eligibility, expected.synapses[i].eligibility,
      phase + " synapse " + i + " eligibility");
  }
}

const brain = runtime.createBrain();
try {
  const nodes = [
    { id: "input", kind: "sensory", excitability: 0.85, activation: 0.8 },
    { id: "logic-a", kind: "logic", excitability: 0.7, activation: 0.2 },
    { id: "memory", kind: "memory", excitability: 0.9, activation: 0.1 },
    { id: "output", kind: "output", excitability: 0.65, activation: 0.0 }
  ];
  const state = { neurons: [], synapses: [] };
  const ids = new Map();

  for (const node of nodes) {
    const id = brain.addNeuron(node.id, node.kind, 0, 0, node.excitability);
    ids.set(node.id, id);
    brain.stimulate(id, node.activation);
    state.neurons.push({
      id: node.id,
      activation: f32(node.activation),
      excitability: f32(node.excitability)
    });
  }

  const edges = [
    ["input", "logic-a", 0.6],
    ["input", "memory", 0.35],
    ["logic-a", "memory", 0.5],
    ["memory", "output", 0.75],
    ["output", "input", 0.1],
    ["logic-a", "output", 0.2]
  ];
  for (const [from, to, weight] of edges) {
    assert.equal(brain.addSynapse(ids.get(from), ids.get(to), weight), true);
    state.synapses.push({
      from,
      to,
      weight: f32(weight),
      signal: 0,
      eligibility: 0
    });
  }

  assert.equal(brain.setSynapseWeight(ids.get("logic-a"), ids.get("output"), 0.27), true);
  state.synapses[5].weight = f32(0.27);
  assertParity(brain.snapshot(), state, "initial snapshot");

  const timeSteps = [0.05, 0.12, 0.03, 0.2, 0.1, 0.04, 0.16, 0.025, 0.08, 0.11];
  for (let i = 0; i < timeSteps.length; i++) {
    referenceStep(state, timeSteps[i]);
    brain.step(timeSteps[i]);
    assertParity(brain.snapshot(), state, "step " + (i + 1));
  }

  for (const [rate, reward, decay] of [
    [0.25, 0.7, 0.02],
    [0.15, -0.35, 0.01],
    [0.4, 1.0, 0.0],
    [0.0, 0.0, 0.05]
  ]) {
    const expectedChanged = referenceLearn(state, rate, reward, decay);
    const actualChanged = brain.learn(rate, reward, decay);
    assert.equal(actualChanged, expectedChanged,
      "C++ and JavaScript reference must agree on the changed synapse count");
    assertParity(brain.snapshot(), state, "learn " + rate + "/" + reward + "/" + decay);
  }

  const expectedDelayed = referenceLearnFromReward(state, 0.25, -0.4, 0.01);
  assert.equal(brain.learnFromReward(0.25, -0.4, 0.01), expectedDelayed,
    "delayed negative reward must match the JavaScript eligibility reference");
  assertParity(brain.snapshot(), state, "delayed negative reward");

  assert.throws(() => brain.learn(Number.NaN, 1, 0), /finite number/u);
  assert.throws(() => brain.learn(0.1, Number.POSITIVE_INFINITY, 0), /finite number/u);
  assert.throws(() => brain.setSynapseWeight(ids.get("input"), ids.get("memory"), Number.NaN),
    /finite number/u);
} finally {
  brain.dispose();
}


function referenceStimulate(state, neuronId, strength) {
  const neuron = state.neurons.find(row => row.id === neuronId);
  if (!neuron) return false;
  neuron.activation = f32(Math.max(0, Math.min(1, f32(neuron.activation + f32(strength)))));
  return true;
}

const contrastiveBrain = runtime.createBrain();
try {
  const state = { neurons: [], synapses: [] };
  const input = contrastiveBrain.addNeuron("contrastive-input", "sensory", 0, 0, 1);
  const positive = contrastiveBrain.addNeuron("positive-output", "output", 1, 0, 1);
  const negative = contrastiveBrain.addNeuron("negative-output", "output", 1, 1, 1);
  const neutral = contrastiveBrain.addNeuron("neutral-output", "output", 1, 2, 1);
  state.neurons.push(
    { id: input, activation: 0, excitability: 1 },
    { id: positive, activation: 0, excitability: 1 },
    { id: negative, activation: 0, excitability: 1 },
    { id: neutral, activation: 0, excitability: 1 }
  );
  for (const [target, weight, eligibility] of [
    [positive, 0.5, 0.8],
    [negative, 0.4, 0.6],
    [neutral, 0.3, 0.7]
  ]) {
    assert.equal(contrastiveBrain.addSynapse(input, target, weight), true);
    assert.equal(contrastiveBrain.setSynapseEligibility(input, target, eligibility), true);
    state.synapses.push({
      from: input, to: target, weight: f32(weight), signal: 0,
      eligibility: f32(eligibility)
    });
  }

  const expectedChanged = referenceLearnContrastiveReward(state, 0.5, input, positive, negative);
  assert.equal(contrastiveBrain.learnContrastiveReward(0.5, input, positive, negative), expectedChanged,
    "contrastive reward must match the JavaScript float32 reference");
  assertParity(contrastiveBrain.snapshot(), state, "contrastive reward");
  assert.equal(state.synapses[2].weight, f32(0.3),
    "unassigned destinations must retain their weights");
  assert.ok(state.synapses.every(edge => edge.eligibility === 0),
    "all traces must be consumed after a valid contrastive event");

  for (const [index, weight, eligibility] of [
    [0, 0.45, 0.65], [1, 0.35, 0.55], [2, 0.25, 0.7]
  ]) {
    const edge = state.synapses[index];
    assert.equal(contrastiveBrain.setSynapseWeight(input, edge.to, weight), true);
    assert.equal(contrastiveBrain.setSynapseEligibility(input, edge.to, eligibility), true);
    edge.weight = f32(weight);
    edge.eligibility = f32(eligibility);
  }
  const expectedAsymmetricChanged = referenceLearnContrastiveRewardAsymmetric(
    state, 0.2, 0.55, input, positive, negative);
  assert.equal(contrastiveBrain.learnContrastiveRewardAsymmetric(
    0.2, 0.55, input, positive, negative), expectedAsymmetricChanged,
    "asymmetric WASM updates must match independent float32 reference rates");
  assertParity(contrastiveBrain.snapshot(), state, "asymmetric contrastive reward");
  assert.equal(state.synapses[2].weight, f32(0.25),
    "asymmetric updates must not alter unassigned destinations");

  assert.equal(contrastiveBrain.setSynapseEligibility(input, positive, 0.25), true);
  const beforeInvalid = contrastiveBrain.snapshot();
  assert.throws(
    () => contrastiveBrain.learnContrastiveReward(Number.NaN, input, positive, negative),
    /finite number/u,
    "the WASM adapter must reject non-finite learning rates before calling the C ABI"
  );
  const beforeInvalidAsymmetric = contrastiveBrain.snapshot();
  assert.throws(() => contrastiveBrain.learnContrastiveRewardAsymmetric(
    Number.NaN, 0.5, input, positive, negative), /finite number/u);
  assertParity(contrastiveBrain.snapshot(), {
    neurons: beforeInvalidAsymmetric.neurons.map(row => ({ ...row })),
    synapses: beforeInvalidAsymmetric.synapses.map(row => ({ ...row }))
  }, "invalid asymmetric reward");
  assertParity(contrastiveBrain.snapshot(), {
    neurons: beforeInvalid.neurons.map(row => ({ ...row, id: row.id })),
    synapses: beforeInvalid.synapses.map(row => ({ ...row }))
  }, "invalid contrastive reward");
  assert.throws(() => contrastiveBrain.learnContrastiveReward(0.2, input, positive),
    /finite number/u);
} finally {
  contrastiveBrain.dispose();
}

// Deterministic larger graph: exercise index mapping, accumulated input,
// signal decay, repeated reinforcement and bounded weights without flaky RNG.
const stressBrain = runtime.createBrain();
try {
  const stressState = { neurons: [], synapses: [] };
  const stressIds = new Map();
  const kinds = ["sensory", "logic", "memory", "output", "core"];
  for (let i = 0; i < 48; i++) {
    const key = "stress-" + i;
    const excitability = f32(0.25 + ((i * 17) % 70) / 100);
    const activation = f32(((i * 13) % 31) / 100);
    const id = stressBrain.addNeuron(key, kinds[i % kinds.length], i, -i, excitability);
    stressIds.set(key, id);
    if (activation > 0) stressBrain.stimulate(id, activation);
    stressState.neurons.push({ id: key, activation, excitability });
  }

  const offsets = [1, 3, 7, 11, 17];
  for (let i = 0; i < 48; i++) {
    for (const offset of offsets) {
      const target = (i + offset) % 48;
      const weight = f32(0.08 + ((i * 19 + target * 7) % 80) / 100);
      assert.equal(stressBrain.addSynapse(stressIds.get("stress-" + i),
        stressIds.get("stress-" + target), weight), true);
      stressState.synapses.push({
        from: "stress-" + i,
        to: "stress-" + target,
        weight,
        signal: 0,
        eligibility: 0
      });
    }
  }
  assertParity(stressBrain.snapshot(), stressState, "stress initial graph");

  for (let step = 0; step < 80; step++) {
    for (let pulse = 0; pulse < 3; pulse++) {
      const index = (step * 7 + pulse * 13) % 48;
      const strength = f32(0.04 + ((step + pulse * 5) % 9) / 20);
      const key = "stress-" + index;
      assert.equal(stressBrain.stimulate(stressIds.get(key), strength), true);
      assert.equal(referenceStimulate(stressState, key, strength), true);
    }

    const dt = [0.016, 0.033, 0.05, 0.12, 0.2][step % 5];
    const retention = [0.72, 0.81, 0.9, 0.96][step % 4];
    referenceStep(stressState, dt, retention);
    stressBrain.step(dt, retention);
    assertParity(stressBrain.snapshot(), stressState, "stress propagation step " + (step + 1));

    if ((step + 1) % 8 === 0) {
      const rate = [0.05, 0.12, 0.2][Math.floor(step / 8) % 3];
      const reward = step % 16 === 7 ? -0.4 : 0.65;
      const decay = 0.003;
      const expected = referenceLearn(stressState, rate, reward, decay);
      assert.equal(stressBrain.learn(rate, reward, decay), expected,
        "stress learning update count at step " + (step + 1));
      assertParity(stressBrain.snapshot(), stressState, "stress learning step " + (step + 1));
    }

    if ((step + 1) % 16 === 0) {
      const reward = step % 32 === 15 ? -0.55 : 0.7;
      const expected = referenceLearnFromReward(stressState, 0.18, reward, 0.002);
      assert.equal(stressBrain.learnFromReward(0.18, reward, 0.002), expected,
        "stress delayed reward update count at step " + (step + 1));
      assertParity(stressBrain.snapshot(), stressState, "stress delayed reward step " + (step + 1));
    }
  }
} finally {
  stressBrain.dispose();
}

console.log("NEUROGENESIS C++/JavaScript reference parity: activation, signal decay and synaptic learning passed, including delayed reward eligibility and 48-neuron/240-synapse stress parity.");
