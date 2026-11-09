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

    std::cout << "NEUROGENESIS C++ core: finite-input guards passed.\n";
    return EXIT_SUCCESS;
}
