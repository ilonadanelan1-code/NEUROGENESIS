#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace neurogenesis {

enum class NeuronKind : std::uint8_t { Core, Sensory, Memory, Logic, Output };

struct Neuron {
    std::uint32_t id{};
    std::string name;
    NeuronKind kind{NeuronKind::Logic};
    float activation{0.0f};
    float excitability{0.5f};
    float x{0.0f};
    float y{0.0f};
};

struct Synapse {
    std::uint32_t from{};
    std::uint32_t to{};
    float weight{0.5f};
    float signal{0.0f};
};

class Brain {
public:
    std::uint32_t add_neuron(std::string name, NeuronKind kind, float x, float y,
                             float excitability = 0.5f);
    bool add_synapse(std::uint32_t from, std::uint32_t to, float weight = 0.5f);
    bool stimulate(std::uint32_t neuron_id, float strength = 1.0f);
    void step(float delta_seconds);

    const std::vector<Neuron>& neurons() const noexcept { return neurons_; }
    const std::vector<Synapse>& synapses() const noexcept { return synapses_; }
    const Neuron* find_neuron(std::uint32_t id) const noexcept;

private:
    std::vector<Neuron> neurons_;
    std::vector<Synapse> synapses_;
    std::uint32_t next_id_{1};
};

} // namespace neurogenesis