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
    ng_brain_step(api_brain, 0.1f);

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
    require(ng_brain_neuron_id_at(api_brain, 99) == 0,
            "invalid C ABI indices must return a safe sentinel");
    require(std::isnan(ng_brain_neuron_activation_at(api_brain, 99)),
            "invalid C ABI float reads must return NaN");
    require(ng_brain_neuron_count(nullptr) == 0,
            "null C ABI handles must be safe to inspect");
    ng_brain_destroy(api_brain);

    std::cout << "NEUROGENESIS C++ core: finite-input guards passed.\n";
    return EXIT_SUCCESS;
}
