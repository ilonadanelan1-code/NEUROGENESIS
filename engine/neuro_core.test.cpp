#include "neuro_core.hpp"
#include "neuro_wasm.h"

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>

namespace {
void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(EXIT_FAILURE);
    }
}
} // namespace

int main() {
    using neurogenesis::Brain;
    using neurogenesis::NeuronKind;

    const float nan = std::numeric_limits<float>::quiet_NaN();
    const float infinity = std::numeric_limits<float>::infinity();

    Brain brain;
    const auto input = brain.add_neuron("input", NeuronKind::Sensory, nan, infinity, nan);
    const auto output = brain.add_neuron("output", NeuronKind::Output, 1.0f, 2.0f, 0.75f);

    const auto* normalized = brain.find_neuron(input);
    require(normalized != nullptr, "new neuron must be findable");
    require(normalized->x == 0.0f && normalized->y == 0.0f,
            "non-finite coordinates must fall back to zero");
    require(normalized->excitability == 0.5f,
            "non-finite excitability must fall back to the neutral default");

    require(!brain.add_synapse(input, output, nan),
            "NaN synapse weight must be rejected");
    require(!brain.add_synapse(input, output, infinity),
            "infinite synapse weight must be rejected");
    require(brain.synapses().empty(), "rejected synapses must not be stored");
    require(brain.add_synapse(input, output, 0.5f), "finite synapse must be accepted");

    require(brain.stimulate(input, 0.4f), "finite stimulation must succeed");
    const float activation_before_invalid_input = brain.find_neuron(input)->activation;
    require(!brain.stimulate(input, nan), "NaN stimulation must be rejected");
    require(!brain.stimulate(input, infinity), "infinite stimulation must be rejected");
    require(brain.find_neuron(input)->activation == activation_before_invalid_input,
            "rejected stimulation must leave activation unchanged");

    brain.step(nan);
    brain.step(infinity);
    require(brain.find_neuron(input)->activation == activation_before_invalid_input,
            "non-finite time steps must not corrupt neural activation");

    brain.step(0.1f);
    require(std::isfinite(brain.find_neuron(input)->activation),
            "valid time steps must preserve finite source activation");
    require(std::isfinite(brain.find_neuron(output)->activation),
            "valid time steps must preserve finite target activation");

    Brain learning_brain;
    const auto pre_id = learning_brain.add_neuron("pre", NeuronKind::Sensory, 0.0f, 0.0f, 1.0f);
    const auto post_id = learning_brain.add_neuron("post", NeuronKind::Logic, 0.0f, 0.0f, 1.0f);
    require(learning_brain.add_synapse(pre_id, post_id, 0.5f),
            "learning fixture must create a synapse");
    require(learning_brain.stimulate(pre_id, 0.8f) &&
            learning_brain.stimulate(post_id, 0.7f),
            "learning fixture must activate both connected neurons");
    require(learning_brain.learn(0.5f, 1.0f, 0.0f) == 1,
            "positive reward must strengthen a co-active synapse");
    require(std::abs(learning_brain.synapses()[0].weight - 0.78f) < 1.0e-5f,
            "Hebbian potentiation must follow rate * reward * pre * post");
    require(learning_brain.learn(0.5f, -1.0f, 0.0f) == 1,
            "negative reward must weaken a co-active synapse");
    require(std::abs(learning_brain.synapses()[0].weight - 0.5f) < 1.0e-5f,
            "negative reinforcement must reverse the potentiation");
    require(learning_brain.learn(0.0f, 0.0f, 0.1f) == 1,
            "weight decay must update a synapse even without reinforcement");
    require(std::abs(learning_brain.synapses()[0].weight - 0.45f) < 1.0e-5f,
            "weight decay must be proportional to the current weight");

    const float learning_weight_before_invalid = learning_brain.synapses()[0].weight;
    require(learning_brain.learn(nan, 1.0f, 0.0f) == 0,
            "non-finite learning rate must be rejected");
    require(learning_brain.learn(0.5f, infinity, 0.0f) == 0,
            "non-finite reward must be rejected");
    require(learning_brain.learn(0.5f, 1.0f, nan) == 0,
            "non-finite decay must be rejected");
    require(learning_brain.synapses()[0].weight == learning_weight_before_invalid,
            "invalid learning parameters must not change synaptic weights");

    require(learning_brain.set_synapse_weight(pre_id, post_id, 2.0f),
            "weight restoration must accept a finite value");
    require(learning_brain.synapses()[0].weight == 1.0f,
            "restored weights must be clamped to one");
    require(learning_brain.set_synapse_weight(pre_id, post_id, -1.0f),
            "weight restoration must accept finite lower bounds");
    require(learning_brain.synapses()[0].weight == 0.0f,
            "restored weights must be clamped to zero");
    require(!learning_brain.set_synapse_weight(pre_id, post_id, nan),
            "non-finite restored weights must be rejected");
    require(!learning_brain.set_synapse_weight(post_id, pre_id, 0.5f),
            "unknown synapse pairs must not be created by weight restoration");

    require(learning_brain.set_synapse_weight(pre_id, post_id, 0.98f),
            "learning saturation fixture must set its initial weight");
    require(learning_brain.learn(1.0f, 1.0f, 0.0f) == 1,
            "positive learning must update a near-saturated synapse");
    require(learning_brain.synapses()[0].weight == 1.0f,
            "synaptic learning must never exceed the upper bound");

    Brain sequence_brain;
    const auto sequence_pre = sequence_brain.add_neuron(
        "sequence-pre", NeuronKind::Sensory, 0.0f, 0.0f, 1.0f);
    const auto sequence_post = sequence_brain.add_neuron(
        "sequence-post", NeuronKind::Output, 0.0f, 0.0f, 1.0f);
    require(sequence_brain.add_synapse(sequence_pre, sequence_post, 0.4f),
            "sequence fixture must create a synapse");
    require(sequence_brain.stimulate(sequence_pre, 0.8f) &&
            sequence_brain.stimulate(sequence_post, 0.7f),
            "sequence fixture must activate a connected pair");
    sequence_brain.step(0.1f, 0.9f);
    const float sequence_weight_before_reward = sequence_brain.synapses()[0].weight;
    const float sequence_trace = sequence_brain.synapses()[0].eligibility;
    require(sequence_trace > 0.0f,
            "co-activation must create an eligibility trace without changing the weight");
    for (int i = 0; i < 12; ++i) sequence_brain.step(0.25f, 0.9f);
    require(sequence_brain.find_neuron(sequence_pre)->activation == 0.0f &&
            sequence_brain.find_neuron(sequence_post)->activation == 0.0f,
            "the delayed reward fixture must end after the original activations have faded");
    require(sequence_brain.synapses()[0].eligibility > 0.0f &&
            sequence_brain.synapses()[0].eligibility < sequence_trace,
            "eligibility traces must decay but outlive the original activation");
    require(sequence_brain.learn_from_reward(0.5f, 1.0f, 0.0f) == 1,
            "delayed positive reward must update the earlier co-active synapse");
    require(sequence_brain.synapses()[0].weight > sequence_weight_before_reward,
            "delayed positive reward must strengthen the earlier association");
    require(sequence_brain.synapses()[0].eligibility == 0.0f,
            "a consumed reward must clear its eligibility trace");

    require(sequence_brain.stimulate(sequence_pre, 0.8f) &&
            sequence_brain.stimulate(sequence_post, 0.7f),
            "negative sequence fixture must activate both neurons");
    sequence_brain.step(0.1f, 0.9f);
    const float before_negative_sequence_reward = sequence_brain.synapses()[0].weight;
    require(sequence_brain.learn_from_reward(0.5f, -1.0f, 0.0f) == 1,
            "delayed negative reward must update an eligible synapse");
    require(sequence_brain.synapses()[0].weight < before_negative_sequence_reward,
            "delayed negative reward must weaken the earlier association");
    require(sequence_brain.set_synapse_eligibility(sequence_pre, sequence_post, 2.0f) &&
            sequence_brain.synapses()[0].eligibility == 1.0f,
            "eligibility restoration must clamp to its documented bounds");
    sequence_brain.reset_eligibility();
    require(sequence_brain.synapses()[0].eligibility == 0.0f,
            "eligibility reset must clear all traces");

    ng_brain_handle* api_brain = ng_brain_create();
    require(api_brain != nullptr, "C ABI must allocate an independent brain handle");

    const auto api_input = ng_brain_add_neuron(
        api_brain, "input", static_cast<int>(NeuronKind::Sensory), 1.0f, 2.0f, 0.8f);
    const auto api_output = ng_brain_add_neuron(
        api_brain, "output", static_cast<int>(NeuronKind::Output), 3.0f, 4.0f, 0.75f);
    require(api_input > 0 && api_output > api_input, "C ABI must return stable neuron IDs");
    require(ng_brain_add_synapse(api_brain, api_input, api_output, 0.5f) == 1,
            "C ABI must expose synapse creation");
    require(ng_brain_stimulate(api_brain, api_input, 0.4f) == 1,
            "C ABI must expose neuron stimulation");
    ng_brain_step(api_brain, 0.1f, 0.85f);

    require(ng_brain_neuron_count(api_brain) == 2,
            "C ABI must expose the neuron count");
    require(ng_brain_synapse_count(api_brain) == 1,
            "C ABI must expose the synapse count");
    require(ng_brain_neuron_id_at(api_brain, 0) == api_input,
            "C ABI neuron indices must preserve insertion order");
    require(ng_brain_neuron_kind_at(api_brain, 0) == static_cast<int>(NeuronKind::Sensory),
            "C ABI must preserve the neuron kind");
    require(ng_brain_neuron_activation_at(api_brain, 0) > 0.33f &&
            ng_brain_neuron_activation_at(api_brain, 0) < 0.34f,
            "C ABI must expose the updated source activation");
    require(ng_brain_neuron_activation_at(api_brain, 1) > 0.14f &&
            ng_brain_neuron_activation_at(api_brain, 1) < 0.16f,
            "C ABI must expose propagated target activation");
    require(ng_brain_synapse_signal_at(api_brain, 0) > 0.19f,
            "C ABI must expose propagated synaptic signal");
    require(ng_brain_synapse_eligibility_at(api_brain, 0) > 0.0f,
            "C ABI must expose accumulated eligibility traces");
    require(ng_brain_neuron_id_at(api_brain, 99) == 0,
            "invalid C ABI indices must return a safe sentinel");
    require(std::isnan(ng_brain_neuron_activation_at(api_brain, 99)),
            "invalid C ABI float reads must return NaN");
    const float weight_before_c_api_learning = ng_brain_synapse_weight_at(api_brain, 0);
    require(ng_brain_learn(api_brain, 0.5f, 1.0f, 0.0f) == 1,
            "C ABI must expose reward-modulated learning");
    require(ng_brain_synapse_weight_at(api_brain, 0) > weight_before_c_api_learning,
            "C ABI learning must strengthen co-active synapses");
    require(ng_brain_learn_from_reward(api_brain, 0.25f, 0.5f, 0.0f) == 1,
            "C ABI must expose delayed reward learning");
    require(ng_brain_synapse_eligibility_at(api_brain, 0) == 0.0f,
            "C ABI reward application must consume eligibility traces");
    require(ng_brain_set_synapse_eligibility(api_brain, api_input, api_output, 0.4f) == 1,
            "C ABI must expose eligibility restoration");
    ng_brain_reset_eligibility(api_brain);
    require(ng_brain_synapse_eligibility_at(api_brain, 0) == 0.0f,
            "C ABI must expose trace reset");
    require(ng_brain_learn_from_reward(nullptr, 0.5f, 1.0f, 0.0f) == 0,
            "null C ABI reward learning must be safe");
    require(ng_brain_set_synapse_eligibility(nullptr, api_input, api_output, 0.5f) == 0,
            "null C ABI trace restoration must be safe");
    ng_brain_reset_eligibility(nullptr);
    require(ng_brain_set_synapse_weight(api_brain, api_input, api_output, 0.25f) == 1,
            "C ABI must expose exact weight restoration");
    require(std::abs(ng_brain_synapse_weight_at(api_brain, 0) - 0.25f) < 1.0e-6f,
            "C ABI weight restoration must be reflected by state readers");
    require(ng_brain_set_synapse_weight(api_brain, api_output, api_input, 0.5f) == 0,
            "C ABI must not create missing synapses when restoring weights");
    require(ng_brain_learn(nullptr, 0.5f, 1.0f, 0.0f) == 0,
            "null C ABI learning must be safe");
    require(ng_brain_set_synapse_weight(nullptr, api_input, api_output, 0.5f) == 0,
            "null C ABI weight restoration must be safe");

    require(ng_brain_neuron_count(nullptr) == 0,
            "null C ABI handles must be safe to inspect");
    ng_brain_destroy(api_brain);

    std::cout << "NEUROGENESIS C++ core: finite-input guards passed.\n";
    return EXIT_SUCCESS;
}
