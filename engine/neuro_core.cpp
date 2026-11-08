#include "neuro_core.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace neurogenesis {

std::uint32_t Brain::add_neuron(std::string name, NeuronKind kind, float x, float y,
                                float excitability) {
    const auto id = next_id_++;
    neurons_.push_back(Neuron{id, std::move(name), kind, 0.0f,
                              std::clamp(excitability, 0.0f, 1.0f), x, y});
    return id;
}

const Neuron* Brain::find_neuron(std::uint32_t id) const noexcept {
    const auto it = std::find_if(neurons_.begin(), neurons_.end(),
        [id](const Neuron& neuron) { return neuron.id == id; });
    return it == neurons_.end() ? nullptr : &*it;
}

bool Brain::add_synapse(std::uint32_t from, std::uint32_t to, float weight) {
    if (from == to || !find_neuron(from) || !find_neuron(to)) return false;
    const auto exists = std::any_of(synapses_.begin(), synapses_.end(),
        [from, to](const Synapse& edge) { return edge.from == from && edge.to == to; });
    if (exists) return false;
    synapses_.push_back(Synapse{from, to, std::clamp(weight, 0.0f, 1.0f), 0.0f});
    return true;
}

bool Brain::stimulate(std::uint32_t neuron_id, float strength) {
    auto it = std::find_if(neurons_.begin(), neurons_.end(),
        [neuron_id](const Neuron& neuron) { return neuron.id == neuron_id; });
    if (it == neurons_.end()) return false;
    it->activation = std::clamp(it->activation + strength, 0.0f, 1.0f);
    return true;
}

void Brain::step(float delta_seconds) {
    const float dt = std::clamp(delta_seconds, 0.0f, 0.25f);
    if (dt <= 0.0f) return;

    std::vector<float> incoming(neurons_.size(), 0.0f);
    for (auto& edge : synapses_) {
        const auto source = std::find_if(neurons_.begin(), neurons_.end(),
            [&edge](const Neuron& neuron) { return neuron.id == edge.from; });
        const auto target = std::find_if(neurons_.begin(), neurons_.end(),
            [&edge](const Neuron& neuron) { return neuron.id == edge.to; });
        if (source == neurons_.end() || target == neurons_.end()) continue;
        const auto index = static_cast<std::size_t>(std::distance(neurons_.begin(), target));
        incoming[index] += source->activation * edge.weight;
        edge.signal = std::max(0.0f, edge.signal - dt * 2.0f);
        edge.signal = std::max(edge.signal, source->activation * edge.weight);
    }

    for (std::size_t i = 0; i < neurons_.size(); ++i) {
        auto& neuron = neurons_[i];
        const float drive = incoming[i] * neuron.excitability;
        const float response = drive > 0.05f ? std::min(1.0f, drive) : 0.0f;
        neuron.activation = std::clamp(
            std::max(neuron.activation - dt * 0.65f, response), 0.0f, 1.0f);
    }
}

} // namespace neurogenesis