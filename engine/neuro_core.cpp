#include "neuro_core.hpp"

#include <algorithm>
#include <cmath>
#include <unordered_map>
#include <utility>

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
    synapses_.push_back(Synapse{from, to, std::clamp(weight, 0.0f, 1.0f), 0.0f, 0.0f});
    return true;
}

bool Brain::set_synapse_weight(std::uint32_t from, std::uint32_t to, float weight) {
    if (!std::isfinite(weight)) return false;
    const auto it = std::find_if(synapses_.begin(), synapses_.end(),
        [from, to](const Synapse& edge) { return edge.from == from && edge.to == to; });
    if (it == synapses_.end()) return false;
    it->weight = std::clamp(weight, 0.0f, 1.0f);
    return true;
}

bool Brain::set_synapse_eligibility(std::uint32_t from, std::uint32_t to, float value) {
    if (!std::isfinite(value)) return false;
    const auto it = std::find_if(synapses_.begin(), synapses_.end(),
        [from, to](const Synapse& edge) { return edge.from == from && edge.to == to; });
    if (it == synapses_.end()) return false;
    it->eligibility = std::clamp(value, 0.0f, 1.0f);
    return true;
}

void Brain::reset_eligibility() noexcept {
    for (auto& edge : synapses_) edge.eligibility = 0.0f;
}

bool Brain::stimulate(std::uint32_t neuron_id, float strength) {
    auto it = std::find_if(neurons_.begin(), neurons_.end(),
        [neuron_id](const Neuron& neuron) { return neuron.id == neuron_id; });
    if (it == neurons_.end() || !std::isfinite(strength)) return false;
    it->activation = std::clamp(it->activation + strength, 0.0f, 1.0f);
    return true;
}

std::uint32_t Brain::learn(float learning_rate, float reward, float weight_decay) {
    if (!std::isfinite(learning_rate) || !std::isfinite(reward) ||
        !std::isfinite(weight_decay)) return 0;
    const float rate = std::clamp(learning_rate, 0.0f, 1.0f);
    const float reinforcement = std::clamp(reward, -1.0f, 1.0f);
    const float decay = std::clamp(weight_decay, 0.0f, 1.0f);
    if (rate == 0.0f && decay == 0.0f) return 0;

    std::unordered_map<std::uint32_t, std::size_t> neuron_index;
    neuron_index.reserve(neurons_.size());
    for (std::size_t i = 0; i < neurons_.size(); ++i) {
        neuron_index.emplace(neurons_[i].id, i);
    }

    std::uint32_t changed = 0;
    for (auto& edge : synapses_) {
        const auto source = neuron_index.find(edge.from);
        const auto target = neuron_index.find(edge.to);
        if (source == neuron_index.end() || target == neuron_index.end()) continue;

        const float pre = neurons_[source->second].activation;
        const float post = neurons_[target->second].activation;
        const float potentiation = rate * reinforcement * pre * post;
        const float weakening = decay * edge.weight;
        const float updated = std::clamp(edge.weight + potentiation - weakening, 0.0f, 1.0f);
        if (std::abs(updated - edge.weight) > 1.0e-7f) {
            edge.weight = updated;
            ++changed;
        }
    }
    return changed;
}

std::uint32_t Brain::learn_from_reward(float learning_rate, float reward, float weight_decay) {
    if (!std::isfinite(learning_rate) || !std::isfinite(reward) ||
        !std::isfinite(weight_decay)) return 0;
    const float rate = std::clamp(learning_rate, 0.0f, 1.0f);
    const float reinforcement = std::clamp(reward, -1.0f, 1.0f);
    const float decay = std::clamp(weight_decay, 0.0f, 1.0f);

    std::uint32_t changed = 0;
    for (auto& edge : synapses_) {
        const float potentiation = rate * reinforcement * edge.eligibility;
        const float weakening = decay * edge.weight;
        const float updated = std::clamp(edge.weight + potentiation - weakening, 0.0f, 1.0f);
        if (std::abs(updated - edge.weight) > 1.0e-7f) {
            edge.weight = updated;
            ++changed;
        }
        edge.eligibility = 0.0f;
    }
    return changed;
}

std::uint32_t Brain::learn_from_reward_homeostatic(float learning_rate, float reward,
                                                              float weight_decay) {
    if (!std::isfinite(learning_rate) || !std::isfinite(reward) ||
        !std::isfinite(weight_decay)) return 0;
    const float rate = std::clamp(learning_rate, 0.0f, 1.0f);
    const float reinforcement = std::clamp(reward, -1.0f, 1.0f);
    const float decay = std::clamp(weight_decay, 0.0f, 1.0f);

    std::uint32_t changed = 0;
    for (auto& edge : synapses_) {
        const float scale = reinforcement >= 0.0f ? (1.0f - edge.weight) : edge.weight;
        const float potentiation = rate * reinforcement * edge.eligibility * scale;
        const float weakening = decay * edge.weight;
        const float updated = std::clamp(edge.weight + potentiation - weakening, 0.0f, 1.0f);
        if (std::abs(updated - edge.weight) > 1.0e-7f) {
            edge.weight = updated;
            ++changed;
        }
        edge.eligibility = 0.0f;
    }
    return changed;
}

std::uint32_t Brain::learn_contrastive_reward(float learning_rate,
                                              std::uint32_t input_neuron_id,
                                              std::uint32_t positive_neuron_id,
                                              std::uint32_t negative_neuron_id) {
    if (!std::isfinite(learning_rate) ||
        input_neuron_id == positive_neuron_id ||
        input_neuron_id == negative_neuron_id ||
        positive_neuron_id == negative_neuron_id ||
        !find_neuron(input_neuron_id) ||
        !find_neuron(positive_neuron_id) ||
        !find_neuron(negative_neuron_id)) return 0;

    const float rate = std::clamp(learning_rate, 0.0f, 1.0f);
    std::uint32_t changed = 0;
    for (auto& edge : synapses_) {
        float delta = 0.0f;
        if (edge.from == input_neuron_id && edge.to == positive_neuron_id) {
            delta = rate * edge.eligibility;
        } else if (edge.from == input_neuron_id && edge.to == negative_neuron_id) {
            delta = -rate * edge.eligibility;
        }
        const float updated = std::clamp(edge.weight + delta, 0.0f, 1.0f);
        if (std::abs(updated - edge.weight) > 1.0e-7f) {
            edge.weight = updated;
            ++changed;
        }
        edge.eligibility = 0.0f;
    }
    return changed;
}

std::uint32_t Brain::learn_contrastive_reward_asymmetric(
    float positive_learning_rate, float negative_learning_rate,
    std::uint32_t input_neuron_id, std::uint32_t positive_neuron_id,
    std::uint32_t negative_neuron_id) {
    if (!std::isfinite(positive_learning_rate) ||
        !std::isfinite(negative_learning_rate) ||
        input_neuron_id == positive_neuron_id ||
        input_neuron_id == negative_neuron_id ||
        positive_neuron_id == negative_neuron_id ||
        !find_neuron(input_neuron_id) ||
        !find_neuron(positive_neuron_id) ||
        !find_neuron(negative_neuron_id)) return 0;

    const float positive_rate = std::clamp(positive_learning_rate, 0.0f, 1.0f);
    const float negative_rate = std::clamp(negative_learning_rate, 0.0f, 1.0f);
    std::uint32_t changed = 0;
    for (auto& edge : synapses_) {
        float delta = 0.0f;
        if (edge.from == input_neuron_id && edge.to == positive_neuron_id) {
            delta = positive_rate * edge.eligibility * (1.0f - edge.weight);
        } else if (edge.from == input_neuron_id && edge.to == negative_neuron_id) {
            delta = -negative_rate * edge.eligibility * edge.weight;
        }

        const float updated = std::clamp(edge.weight + delta, 0.0f, 1.0f);
        if (std::abs(updated - edge.weight) > 1.0e-7f) {
            edge.weight = updated;
            ++changed;
        }
        // Every valid reward event consumes all traces, including unassigned paths.
        edge.eligibility = 0.0f;
    }
    return changed;
}

void Brain::step(float delta_seconds, float eligibility_retention) {
    if (!std::isfinite(delta_seconds) || !std::isfinite(eligibility_retention)) return;
    const float dt = std::clamp(delta_seconds, 0.0f, 0.25f);
    const float retention = std::clamp(eligibility_retention, 0.0f, 1.0f);
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

    for (auto& edge : synapses_) {
        const auto source = neuron_index.find(edge.from);
        const auto target = neuron_index.find(edge.to);
        if (source == neuron_index.end() || target == neuron_index.end()) continue;
        const float coactivation =
            neurons_[source->second].activation * neurons_[target->second].activation;
        edge.eligibility = std::clamp(
            edge.eligibility * retention + coactivation, 0.0f, 1.0f);
    }
}

} // namespace neurogenesis