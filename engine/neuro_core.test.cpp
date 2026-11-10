#include "neuro_core.hpp"
#include "neuro_wasm.h"

#include <algorithm>
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
    const float trace_after_fading = sequence_brain.synapses()[0].eligibility;
    require(trace_after_fading > 0.0f,
            "eligibility traces must outlive the original activation");
    for (int i = 0; i < 5; ++i) sequence_brain.step(0.25f, 0.9f);
    require(sequence_brain.synapses()[0].eligibility < trace_after_fading,
            "eligibility traces must decay when co-activation has ended");
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

    Brain homeostatic_brain;
    const auto homeostatic_input = homeostatic_brain.add_neuron(
        "homeostatic-input", NeuronKind::Sensory, 0, 0, 1);
    const auto homeostatic_positive = homeostatic_brain.add_neuron(
        "homeostatic-positive", NeuronKind::Output, 1, 0, 1);
    const auto homeostatic_negative = homeostatic_brain.add_neuron(
        "homeostatic-negative", NeuronKind::Output, 1, 1, 1);
    require(homeostatic_brain.add_synapse(homeostatic_input, homeostatic_positive, 0.5f) &&
            homeostatic_brain.add_synapse(homeostatic_input, homeostatic_negative, 0.4f),
            "homeostatic fixture must create two independent routes");
    require(homeostatic_brain.set_synapse_eligibility(homeostatic_input, homeostatic_positive, 0.8f),
            "homeostatic positive fixture must set an eligibility trace");
    require(homeostatic_brain.learn_from_reward_homeostatic(0.25f, 1.0f) == 1 &&
            std::abs(homeostatic_brain.synapses()[0].weight - 0.6f) < 1.0e-5f &&
            homeostatic_brain.synapses()[0].eligibility == 0.0f,
            "homeostatic positive reward must scale by remaining headroom and consume traces");
    require(homeostatic_brain.set_synapse_eligibility(homeostatic_input, homeostatic_negative, 0.6f),
            "homeostatic negative fixture must set an eligibility trace");
    require(homeostatic_brain.learn_from_reward_homeostatic(0.5f, -1.0f) == 1 &&
            std::abs(homeostatic_brain.synapses()[1].weight - 0.28f) < 1.0e-5f &&
            homeostatic_brain.synapses()[1].eligibility == 0.0f,
            "homeostatic negative reward must scale by current weight and consume traces");
    require(homeostatic_brain.set_synapse_eligibility(homeostatic_input, homeostatic_positive, 0.4f),
            "homeostatic invalid fixture must restore one trace");
    const float homeostatic_before_invalid = homeostatic_brain.synapses()[0].weight;
    require(homeostatic_brain.learn_from_reward_homeostatic(nan, 1.0f) == 0 &&
            homeostatic_brain.synapses()[0].eligibility == 0.4f &&
            homeostatic_brain.synapses()[0].weight == homeostatic_before_invalid,
            "homeostatic invalid rates must reject without mutating weights or traces");

    Brain contrastive_brain;
    const auto contrastive_input = contrastive_brain.add_neuron(
        "contrastive-input", NeuronKind::Sensory, 0.0f, 0.0f, 1.0f);
    const auto positive_output = contrastive_brain.add_neuron(
        "positive-output", NeuronKind::Output, 1.0f, 0.0f, 1.0f);
    const auto negative_output = contrastive_brain.add_neuron(
        "negative-output", NeuronKind::Output, 1.0f, 1.0f, 1.0f);
    const auto neutral_output = contrastive_brain.add_neuron(
        "neutral-output", NeuronKind::Output, 1.0f, 2.0f, 1.0f);
    require(contrastive_brain.add_synapse(contrastive_input, positive_output, 0.5f) &&
            contrastive_brain.add_synapse(contrastive_input, negative_output, 0.4f) &&
            contrastive_brain.add_synapse(contrastive_input, neutral_output, 0.3f),
            "contrastive fixture must create target, competing and unassigned paths");
    require(contrastive_brain.set_synapse_eligibility(contrastive_input, positive_output, 0.8f) &&
            contrastive_brain.set_synapse_eligibility(contrastive_input, negative_output, 0.6f) &&
            contrastive_brain.set_synapse_eligibility(contrastive_input, neutral_output, 0.7f),
            "contrastive fixture must assign independent eligibility traces");
    require(contrastive_brain.learn_contrastive_reward(0.5f, contrastive_input, positive_output, negative_output) == 2,
            "contrastive reward must update only selected positive and negative destinations");
    require(std::abs(contrastive_brain.synapses()[0].weight - 0.9f) < 1.0e-5f,
            "positive destination must be strengthened by its eligibility trace");
    require(std::abs(contrastive_brain.synapses()[1].weight - 0.1f) < 1.0e-5f,
            "negative destination must be weakened by its eligibility trace");
    require(std::abs(contrastive_brain.synapses()[2].weight - 0.3f) < 1.0e-5f,
            "unassigned destinations must not change during contrastive reward");
    require(std::all_of(contrastive_brain.synapses().begin(), contrastive_brain.synapses().end(),
                        [](const auto& edge) { return edge.eligibility == 0.0f; }),
            "contrastive reward must consume assigned and unassigned traces");

    require(contrastive_brain.set_synapse_eligibility(contrastive_input, positive_output, 0.4f),
            "invalid-argument fixture must restore one trace");
    const float invalid_trace = contrastive_brain.synapses()[0].eligibility;
    require(contrastive_brain.learn_contrastive_reward(nan, contrastive_input, positive_output, negative_output) == 0 &&
            contrastive_brain.synapses()[0].eligibility == invalid_trace,
            "non-finite contrastive rate must reject the event without consuming traces");
    require(contrastive_brain.learn_contrastive_reward(0.5f, contrastive_input, positive_output, positive_output) == 0 &&
            contrastive_brain.synapses()[0].eligibility == invalid_trace,
            "identical positive and negative targets must be rejected atomically");
    require(contrastive_brain.learn_contrastive_reward(0.5f, contrastive_input, positive_output, 999999) == 0 &&
            contrastive_brain.synapses()[0].eligibility == invalid_trace,
            "unknown contrastive target IDs must be rejected without mutation");

    require(contrastive_brain.set_synapse_weight(contrastive_input, positive_output, 0.98f) &&
            contrastive_brain.set_synapse_weight(contrastive_input, negative_output, 0.02f),
            "contrastive saturation fixture must restore boundary-adjacent weights");
    require(contrastive_brain.set_synapse_eligibility(contrastive_input, positive_output, 1.0f) &&
            contrastive_brain.set_synapse_eligibility(contrastive_input, negative_output, 1.0f),
            "contrastive saturation fixture must restore full traces");
    require(contrastive_brain.learn_contrastive_reward(1.0f, contrastive_input, positive_output, negative_output) == 2 &&
            contrastive_brain.synapses()[0].weight == 1.0f &&
            contrastive_brain.synapses()[1].weight == 0.0f,
            "contrastive updates must clamp both potentiation and weakening to the valid range");

    Brain asymmetric_brain;
    const auto asymmetric_input = asymmetric_brain.add_neuron(
        "asymmetric-input", NeuronKind::Sensory, 0, 0, 1);
    const auto asymmetric_positive = asymmetric_brain.add_neuron(
        "asymmetric-positive", NeuronKind::Output, 1, 0, 1);
    const auto asymmetric_negative = asymmetric_brain.add_neuron(
        "asymmetric-negative", NeuronKind::Output, 1, 1, 1);
    const auto asymmetric_unassigned = asymmetric_brain.add_neuron(
        "asymmetric-unassigned", NeuronKind::Output, 1, 2, 1);
    require(asymmetric_brain.add_synapse(asymmetric_input, asymmetric_positive, 0.5f) &&
            asymmetric_brain.add_synapse(asymmetric_input, asymmetric_negative, 0.4f) &&
            asymmetric_brain.add_synapse(asymmetric_input, asymmetric_unassigned, 0.3f),
            "asymmetric fixture must create selected and unassigned routes");
    require(asymmetric_brain.set_synapse_eligibility(asymmetric_input, asymmetric_positive, 0.8f) &&
            asymmetric_brain.set_synapse_eligibility(asymmetric_input, asymmetric_negative, 0.6f) &&
            asymmetric_brain.set_synapse_eligibility(asymmetric_input, asymmetric_unassigned, 0.7f),
            "asymmetric fixture must assign independent eligibility traces");
    require(asymmetric_brain.learn_contrastive_reward_asymmetric(
                0.25f, 0.5f, asymmetric_input, asymmetric_positive, asymmetric_negative) == 2,
            "asymmetric update must independently apply positive and negative rates");
    require(std::abs(asymmetric_brain.synapses()[0].weight - 0.6f) < 1.0e-5f &&
            std::abs(asymmetric_brain.synapses()[1].weight - 0.28f) < 1.0e-5f &&
            std::abs(asymmetric_brain.synapses()[2].weight - 0.3f) < 1.0e-5f,
            "asymmetric rates must affect only their selected routes with the correct magnitude");
    require(std::all_of(asymmetric_brain.synapses().begin(), asymmetric_brain.synapses().end(),
                        [](const auto& edge) { return edge.eligibility == 0.0f; }),
            "valid asymmetric reward must consume selected and unrelated traces");

    require(asymmetric_brain.set_synapse_eligibility(asymmetric_input, asymmetric_positive, 0.4f),
            "asymmetric invalid-argument fixture must restore a trace");
    const float asymmetric_invalid_trace = asymmetric_brain.synapses()[0].eligibility;
    const float asymmetric_invalid_weight = asymmetric_brain.synapses()[0].weight;
    require(asymmetric_brain.learn_contrastive_reward_asymmetric(
                nan, 0.5f, asymmetric_input, asymmetric_positive, asymmetric_negative) == 0 &&
            asymmetric_brain.synapses()[0].eligibility == asymmetric_invalid_trace &&
            asymmetric_brain.synapses()[0].weight == asymmetric_invalid_weight,
            "non-finite positive rate must reject atomically without consuming traces");
    require(asymmetric_brain.learn_contrastive_reward_asymmetric(
                0.25f, infinity, asymmetric_input, asymmetric_positive, asymmetric_negative) == 0 &&
            asymmetric_brain.synapses()[0].eligibility == asymmetric_invalid_trace,
            "non-finite negative rate must reject atomically without consuming traces");
    require(asymmetric_brain.learn_contrastive_reward_asymmetric(
                0.25f, 0.5f, asymmetric_input, asymmetric_positive, 999999) == 0 &&
            asymmetric_brain.synapses()[0].eligibility == asymmetric_invalid_trace,
            "unknown asymmetric target IDs must be rejected without mutation");
    require(asymmetric_brain.learn_contrastive_reward_asymmetric(
                0.25f, 0.5f, asymmetric_input, asymmetric_positive, asymmetric_positive) == 0 &&
            asymmetric_brain.synapses()[0].eligibility == asymmetric_invalid_trace,
            "identical asymmetric target IDs must be rejected without mutation");

    Brain legacy_symmetric_brain;
    Brain equal_rate_brain;
    const auto legacy_input = legacy_symmetric_brain.add_neuron("input", NeuronKind::Sensory, 0, 0, 1);
    const auto legacy_positive = legacy_symmetric_brain.add_neuron("positive", NeuronKind::Output, 0, 0, 1);
    const auto legacy_negative = legacy_symmetric_brain.add_neuron("negative", NeuronKind::Output, 0, 0, 1);
    const auto equal_input = equal_rate_brain.add_neuron("input", NeuronKind::Sensory, 0, 0, 1);
    const auto equal_positive = equal_rate_brain.add_neuron("positive", NeuronKind::Output, 0, 0, 1);
    const auto equal_negative = equal_rate_brain.add_neuron("negative", NeuronKind::Output, 0, 0, 1);
    require(legacy_symmetric_brain.add_synapse(legacy_input, legacy_positive, 0.45f) &&
            legacy_symmetric_brain.add_synapse(legacy_input, legacy_negative, 0.35f) &&
            equal_rate_brain.add_synapse(equal_input, equal_positive, 0.45f) &&
            equal_rate_brain.add_synapse(equal_input, equal_negative, 0.35f),
            "symmetric compatibility fixtures must create matching routes");
    require(legacy_symmetric_brain.set_synapse_eligibility(legacy_input, legacy_positive, 0.65f) &&
            legacy_symmetric_brain.set_synapse_eligibility(legacy_input, legacy_negative, 0.55f) &&
            equal_rate_brain.set_synapse_eligibility(equal_input, equal_positive, 0.65f) &&
            equal_rate_brain.set_synapse_eligibility(equal_input, equal_negative, 0.55f),
            "symmetric compatibility fixtures must have identical traces");
    const auto legacy_changed = legacy_symmetric_brain.learn_contrastive_reward(
        0.3f, legacy_input, legacy_positive, legacy_negative);
    const auto bounded_changed = equal_rate_brain.learn_contrastive_reward_asymmetric(
        0.3f, 0.3f, equal_input, equal_positive, equal_negative);
    require(legacy_changed == 2 && bounded_changed == 2 &&
            std::abs(legacy_symmetric_brain.synapses()[0].weight - 0.645f) < 1.0e-5f &&
            std::abs(legacy_symmetric_brain.synapses()[1].weight - 0.185f) < 1.0e-5f,
            "legacy symmetric contrastive learning must retain its additive behavior");
    require(std::abs(equal_rate_brain.synapses()[0].weight - 0.55725f) < 1.0e-5f &&
            std::abs(equal_rate_brain.synapses()[1].weight - 0.29225f) < 1.0e-5f,
            "bounded asymmetric learning must scale potentiation by headroom and depression by current weight");

    require(asymmetric_brain.set_synapse_weight(asymmetric_input, asymmetric_positive, 0.98f) &&
            asymmetric_brain.set_synapse_weight(asymmetric_input, asymmetric_negative, 0.02f) &&
            asymmetric_brain.set_synapse_eligibility(asymmetric_input, asymmetric_positive, 1.0f) &&
            asymmetric_brain.set_synapse_eligibility(asymmetric_input, asymmetric_negative, 1.0f),
            "asymmetric boundary fixture must restore near-limit weights and full traces");
    require(asymmetric_brain.learn_contrastive_reward_asymmetric(
                5.0f, 5.0f, asymmetric_input, asymmetric_positive, asymmetric_negative) == 2 &&
            asymmetric_brain.synapses()[0].weight == 1.0f &&
            asymmetric_brain.synapses()[1].weight == 0.0f,
            "asymmetric rates must clamp to [0,1] and weights must stay within [0,1]");

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
            "C ABI must restore a trace for homeostatic delayed reward");
    const float before_homeostatic_c_api = ng_brain_synapse_weight_at(api_brain, 0);
    require(ng_brain_learn_from_reward_homeostatic(api_brain, 0.25f, 1.0f, 0.0f) == 1 &&
            ng_brain_synapse_weight_at(api_brain, 0) > before_homeostatic_c_api &&
            ng_brain_synapse_weight_at(api_brain, 0) < 1.0f &&
            ng_brain_synapse_eligibility_at(api_brain, 0) == 0.0f,
            "C ABI homeostatic reward must preserve headroom and consume traces");
    require(ng_brain_learn_from_reward_homeostatic(nullptr, 0.25f, 1.0f, 0.0f) == 0,
            "null C ABI homeostatic reward must be safe");
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
    ng_brain_handle* contrastive_api = ng_brain_create();
    require(contrastive_api != nullptr, "contrastive C ABI must allocate an independent brain");
    const auto contrastive_api_input = ng_brain_add_neuron(
        contrastive_api, "input", static_cast<int>(NeuronKind::Sensory), 0, 0, 1);
    const auto contrastive_api_positive = ng_brain_add_neuron(
        contrastive_api, "positive", static_cast<int>(NeuronKind::Output), 1, 0, 1);
    const auto contrastive_api_negative = ng_brain_add_neuron(
        contrastive_api, "negative", static_cast<int>(NeuronKind::Output), 1, 1, 1);
    require(ng_brain_add_synapse(contrastive_api, contrastive_api_input,
                                  contrastive_api_positive, 0.5f) == 1 &&
            ng_brain_add_synapse(contrastive_api, contrastive_api_input,
                                  contrastive_api_negative, 0.4f) == 1,
            "contrastive C ABI must expose target and competitor paths");
    require(ng_brain_set_synapse_eligibility(contrastive_api, contrastive_api_input,
                                             contrastive_api_positive, 0.8f) == 1 &&
            ng_brain_set_synapse_eligibility(contrastive_api, contrastive_api_input,
                                             contrastive_api_negative, 0.6f) == 1,
            "contrastive C ABI must expose eligibility assignment");
    require(ng_brain_learn_contrastive_reward(
                contrastive_api, 0.5f, contrastive_api_input, contrastive_api_positive, contrastive_api_negative) == 2,
            "contrastive C ABI must update the selected positive and negative destinations");
    require(std::abs(ng_brain_synapse_weight_at(contrastive_api, 0) - 0.9f) < 1.0e-5f &&
            std::abs(ng_brain_synapse_weight_at(contrastive_api, 1) - 0.1f) < 1.0e-5f,
            "contrastive C ABI must expose signed target/competitor updates");
    require(ng_brain_synapse_eligibility_at(contrastive_api, 0) == 0.0f &&
            ng_brain_synapse_eligibility_at(contrastive_api, 1) == 0.0f,
            "contrastive C ABI must consume selected traces");
    require(ng_brain_learn_contrastive_reward(
                nullptr, 0.5f, contrastive_api_input, contrastive_api_positive, contrastive_api_negative) == 0,
            "null contrastive C ABI handles must be safe");
    ng_brain_handle* asymmetric_api = ng_brain_create();
    require(asymmetric_api != nullptr, "asymmetric C ABI must allocate an independent brain");
    const auto asymmetric_api_input = ng_brain_add_neuron(
        asymmetric_api, "input", static_cast<int>(NeuronKind::Sensory), 0, 0, 1);
    const auto asymmetric_api_positive = ng_brain_add_neuron(
        asymmetric_api, "positive", static_cast<int>(NeuronKind::Output), 1, 0, 1);
    const auto asymmetric_api_negative = ng_brain_add_neuron(
        asymmetric_api, "negative", static_cast<int>(NeuronKind::Output), 1, 1, 1);
    const auto asymmetric_api_unassigned = ng_brain_add_neuron(
        asymmetric_api, "unassigned", static_cast<int>(NeuronKind::Output), 1, 2, 1);
    require(ng_brain_add_synapse(asymmetric_api, asymmetric_api_input, asymmetric_api_positive, 0.5f) == 1 &&
            ng_brain_add_synapse(asymmetric_api, asymmetric_api_input, asymmetric_api_negative, 0.4f) == 1 &&
            ng_brain_add_synapse(asymmetric_api, asymmetric_api_input, asymmetric_api_unassigned, 0.3f) == 1,
            "asymmetric C ABI must expose selected and unassigned paths");
    require(ng_brain_set_synapse_eligibility(asymmetric_api, asymmetric_api_input, asymmetric_api_positive, 0.8f) == 1 &&
            ng_brain_set_synapse_eligibility(asymmetric_api, asymmetric_api_input, asymmetric_api_negative, 0.6f) == 1 &&
            ng_brain_set_synapse_eligibility(asymmetric_api, asymmetric_api_input, asymmetric_api_unassigned, 0.7f) == 1,
            "asymmetric C ABI must expose per-edge eligibility assignment");
    require(ng_brain_learn_contrastive_reward_asymmetric(
                asymmetric_api, 0.25f, 0.5f, asymmetric_api_input,
                asymmetric_api_positive, asymmetric_api_negative) == 2,
            "asymmetric C ABI must pass independent learning rates to the core");
    require(std::abs(ng_brain_synapse_weight_at(asymmetric_api, 0) - 0.6f) < 1.0e-5f &&
            std::abs(ng_brain_synapse_weight_at(asymmetric_api, 1) - 0.28f) < 1.0e-5f &&
            std::abs(ng_brain_synapse_weight_at(asymmetric_api, 2) - 0.3f) < 1.0e-5f,
            "asymmetric C ABI must expose the expected independent weight updates");
    require(ng_brain_synapse_eligibility_at(asymmetric_api, 0) == 0.0f &&
            ng_brain_synapse_eligibility_at(asymmetric_api, 1) == 0.0f &&
            ng_brain_synapse_eligibility_at(asymmetric_api, 2) == 0.0f,
            "asymmetric C ABI must consume all traces after a valid event");
    require(ng_brain_learn_contrastive_reward_asymmetric(
                nullptr, 0.25f, 0.5f, asymmetric_api_input,
                asymmetric_api_positive, asymmetric_api_negative) == 0,
            "null asymmetric C ABI handles must be safe");
    ng_brain_destroy(asymmetric_api);
    ng_brain_destroy(contrastive_api);

    ng_brain_destroy(api_brain);

    std::cout << "NEUROGENESIS C++ core: finite-input guards passed.\n";
    return EXIT_SUCCESS;
}
