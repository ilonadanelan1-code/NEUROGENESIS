#include "neuro_wasm.h"

#include "neuro_core.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <string>
#include <utility>

struct ng_brain_handle {
    neurogenesis::Brain brain;
};

namespace {
neurogenesis::NeuronKind safe_kind(int kind) noexcept {
    if (kind < 0 || kind > 4) return neurogenesis::NeuronKind::Logic;
    return static_cast<neurogenesis::NeuronKind>(kind);
}

const neurogenesis::Neuron* neuron_at(const ng_brain_handle* handle,
                                      std::uint32_t index) noexcept {
    if (!handle || index >= handle->brain.neurons().size()) return nullptr;
    return &handle->brain.neurons()[index];
}

const neurogenesis::Synapse* synapse_at(const ng_brain_handle* handle,
                                        std::uint32_t index) noexcept {
    if (!handle || index >= handle->brain.synapses().size()) return nullptr;
    return &handle->brain.synapses()[index];
}

float invalid_float() noexcept {
    return std::numeric_limits<float>::quiet_NaN();
}
} // namespace

extern "C" {

ng_brain_handle* ng_brain_create(void) {
    return new (std::nothrow) ng_brain_handle{};
}

void ng_brain_destroy(ng_brain_handle* handle) {
    delete handle;
}

std::uint32_t ng_brain_add_neuron(ng_brain_handle* handle, const char* name, int kind,
                                  float x, float y, float excitability) {
    if (!handle) return 0;
    try {
        std::string safe_name = name ? name : "";
        if (safe_name.size() > 64) safe_name.resize(64);
        return handle->brain.add_neuron(std::move(safe_name), safe_kind(kind),
                                        x, y, excitability);
    } catch (...) {
        return 0;
    }
}

int ng_brain_add_synapse(ng_brain_handle* handle, std::uint32_t from,
                         std::uint32_t to, float weight) {
    if (!handle) return 0;
    try {
        return handle->brain.add_synapse(from, to, weight) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int ng_brain_set_synapse_weight(ng_brain_handle* handle, std::uint32_t from,
                                  std::uint32_t to, float weight) {
    if (!handle) return 0;
    try {
        return handle->brain.set_synapse_weight(from, to, weight) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int ng_brain_set_synapse_eligibility(ng_brain_handle* handle, std::uint32_t from,
                                      std::uint32_t to, float value) {
    if (!handle) return 0;
    try {
        return handle->brain.set_synapse_eligibility(from, to, value) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

void ng_brain_reset_eligibility(ng_brain_handle* handle) {
    if (handle) handle->brain.reset_eligibility();
}

int ng_brain_stimulate(ng_brain_handle* handle, std::uint32_t neuron_id, float strength) {
    if (!handle) return 0;
    try {
        return handle->brain.stimulate(neuron_id, strength) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

std::uint32_t ng_brain_learn(ng_brain_handle* handle, float learning_rate,
                             float reward, float weight_decay) {
    if (!handle) return 0;
    try {
        return handle->brain.learn(learning_rate, reward, weight_decay);
    } catch (...) {
        return 0;
    }
}

std::uint32_t ng_brain_learn_from_reward(ng_brain_handle* handle, float learning_rate,
                                           float reward, float weight_decay) {
    if (!handle) return 0;
    try {
        return handle->brain.learn_from_reward(learning_rate, reward, weight_decay);
    } catch (...) {
        return 0;
    }
}

std::uint32_t ng_brain_learn_from_reward_homeostatic(ng_brain_handle* handle,
                                                        float learning_rate, float reward,
                                                        float weight_decay) {
    if (!handle) return 0;
    try {
        return handle->brain.learn_from_reward_homeostatic(learning_rate, reward, weight_decay);
    } catch (...) {
        return 0;
    }
}

std::uint32_t ng_brain_learn_contrastive_reward(ng_brain_handle* handle,
                                                 float learning_rate,
                                                 std::uint32_t input_neuron_id,
                                                 std::uint32_t positive_neuron_id,
                                                 std::uint32_t negative_neuron_id) {
    if (!handle) return 0;
    try {
        return handle->brain.learn_contrastive_reward(
            learning_rate, input_neuron_id, positive_neuron_id, negative_neuron_id);
    } catch (...) {
        return 0;
    }
}

std::uint32_t ng_brain_learn_contrastive_reward_asymmetric(
    ng_brain_handle* handle, float positive_learning_rate, float negative_learning_rate,
    std::uint32_t input_neuron_id, std::uint32_t positive_neuron_id,
    std::uint32_t negative_neuron_id) {
    if (!handle) return 0;
    try {
        return handle->brain.learn_contrastive_reward_asymmetric(
            positive_learning_rate, negative_learning_rate, input_neuron_id,
            positive_neuron_id, negative_neuron_id);
    } catch (...) {
        return 0;
    }
}

void ng_brain_step(ng_brain_handle* handle, float delta_seconds, float eligibility_retention) {
    if (!handle || !std::isfinite(delta_seconds) || !std::isfinite(eligibility_retention)) return;
    try {
        handle->brain.step(delta_seconds, eligibility_retention);
    } catch (...) {
        // Keep C callers safe if a temporary simulation buffer cannot be allocated.
    }
}

std::uint32_t ng_brain_neuron_count(const ng_brain_handle* handle) {
    return handle ? static_cast<std::uint32_t>(handle->brain.neurons().size()) : 0;
}

std::uint32_t ng_brain_synapse_count(const ng_brain_handle* handle) {
    return handle ? static_cast<std::uint32_t>(handle->brain.synapses().size()) : 0;
}

std::uint32_t ng_brain_neuron_id_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* neuron = neuron_at(handle, index);
    return neuron ? neuron->id : 0;
}

int ng_brain_neuron_kind_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* neuron = neuron_at(handle, index);
    return neuron ? static_cast<int>(neuron->kind) : -1;
}

float ng_brain_neuron_activation_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* neuron = neuron_at(handle, index);
    return neuron ? neuron->activation : invalid_float();
}

float ng_brain_neuron_excitability_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* neuron = neuron_at(handle, index);
    return neuron ? neuron->excitability : invalid_float();
}

float ng_brain_neuron_x_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* neuron = neuron_at(handle, index);
    return neuron ? neuron->x : invalid_float();
}

float ng_brain_neuron_y_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* neuron = neuron_at(handle, index);
    return neuron ? neuron->y : invalid_float();
}

std::uint32_t ng_brain_synapse_from_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* synapse = synapse_at(handle, index);
    return synapse ? synapse->from : 0;
}

std::uint32_t ng_brain_synapse_to_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* synapse = synapse_at(handle, index);
    return synapse ? synapse->to : 0;
}

float ng_brain_synapse_weight_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* synapse = synapse_at(handle, index);
    return synapse ? synapse->weight : invalid_float();
}

float ng_brain_synapse_signal_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* synapse = synapse_at(handle, index);
    return synapse ? synapse->signal : invalid_float();
}

float ng_brain_synapse_eligibility_at(const ng_brain_handle* handle, std::uint32_t index) {
    const auto* synapse = synapse_at(handle, index);
    return synapse ? synapse->eligibility : invalid_float();
}

} // extern "C"
