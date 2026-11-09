#include "neuro_core.hpp"

#include <algorithm>
#include <cmath>
#include <utility>
#include <unordered_map>

namespace neurogenesis {

std::uint32_t Brain::add_neuron(std::string name, NeuronKind kind, float x, float y,
                                float excitability) {
    const auto id = next_id_++;
    const float safe_excitability = std::isfinite(excitability)
        ? std::clamp(excitability, 0.0f, 1.0f) : 0.5f;
    const float safe_x = std::isfinite(x) ? x : 0.0f;
    const float safe_y = std::isfinite(y) ? y : 0.0f;
    neurons_.push_back(Neuron{id, std::move(name), kind, 0.0f,
                              safe_excitability, safe_x, safe_y});
    return id;
}

const Neuron* Brain::find_neuron(std::uint32_t id) const noexcept {
    const auto it = std::find_if(neurons_.begin(), neurons_.end(),
        [id](const Neuron& neuron) { return neuron.id == id; });
    return it == neurons_.end() ? nullptr : &*it;
}

bool Brain::add_synapse(std::uint32_t from, std::uint32_t to, float weight) {
    if (!std::isfinite(weight) || from == to || !find_neuron(from) || !find_neuron(to)) return false;
    const auto exists = std::any_of(synapses_.begin(), synapses_.end(),
        [from, to](const Synapse& edge) { return edge.from == from && edge.to == to; });
    if (exists) return false;
    synapses_.push_back(Synapse{from, to, std::clamp(weight, 0.0f, 1.0f), 0.0f});
    return true;
}

bool Brain::stimulate(std::uint32_t neuron_id, float strength) {
    auto it = std::find_if(neurons_.begin(), neurons_.end(),
        [neuron_id](const Neuron& neuron) { return neuron.id == neuron_id; });
    if (it == neurons_.end() || !std::isfinite(strength)) return false;
    it->activation = std::clamp(it->activation + strength, 0.0f, 1.0f);
    return true;
}

void Brain::step(float delta_seconds) {
    if (!std::isfinite(delta_seconds)) return;
    const float dt = std::clamp(delta_seconds, 0.0f, 0.25f);
    if (dt <= 0.0f) return;

    std::vector<float> incoming(neurons_.size(), 0.0f);
    std::unordered_map<std::uint32_t, std::size_t> neuron_index;
    neuron_index.reserve(neurons_.size());
    for (std::size_t i = 0; i < neurons_.size(); ++i) {
        neuron_index.emplace(neurons_[i].id, i);
    }

    for (auto& edge : synapses_) {
        const auto source = neuron_index.find(edge.from);
        const auto target = neuron_index.find(edge.to);
        if (source == neuron_index.end() || target == neuron_index.end()) continue;
        const float source_activation = neurons_[source->second].activation;
        const float transmitted = source_activation * edge.weight;
        incoming[target->second] += transmitted;
        edge.signal = std::max(0.0f, edge.signal - dt * 2.0f);
        edge.signal = std::max(edge.signal, transmitted);
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