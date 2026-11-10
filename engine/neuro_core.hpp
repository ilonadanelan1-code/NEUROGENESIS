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
    float eligibility{0.0f};
};

class Brain {
public:
    std::uint32_t add_neuron(std::string name, NeuronKind kind, float x, float y,
                             float excitability = 0.5f);
    bool add_synapse(std::uint32_t from, std::uint32_t to, float weight = 0.5f);
    bool set_synapse_weight(std::uint32_t from, std::uint32_t to, float weight);
    bool stimulate(std::uint32_t neuron_id, float strength = 1.0f);
    void step(float delta_seconds, float eligibility_retention = 0.85f);
    bool set_synapse_eligibility(std::uint32_t from, std::uint32_t to, float value);
    void reset_eligibility() noexcept;

    // Immediate reward-modulated Hebbian update:
    // delta_weight = rate * reward * pre_activation * post_activation - decay * weight.
    // All inputs are finite-checked and clamped to their documented ranges.
    std::uint32_t learn(float learning_rate, float reward = 1.0f,
                        float weight_decay = 0.0f);

    // Delayed reward update using accumulated eligibility traces.
    // A valid reward consumes and clears all traces, even when reward is neutral.
    std::uint32_t learn_from_reward(float learning_rate, float reward,
                                    float weight_decay = 0.0f);

    // Homeostatic delayed reward: positive updates scale with remaining headroom,
    // negative updates scale with current weight. Valid calls consume all traces.
    std::uint32_t learn_from_reward_homeostatic(float learning_rate, float reward,
                                                float weight_decay = 0.0f);

    // Contrastive delayed reward updates only synapses targeting the selected
    // positive/negative output neurons. All eligibility traces are consumed.
    std::uint32_t learn_contrastive_reward(float learning_rate,
                                           std::uint32_t input_neuron_id,
                                           std::uint32_t positive_neuron_id,
                                           std::uint32_t negative_neuron_id);

    // Experimental asymmetric contrastive update for isolated shadow experiments.
    // Positive and negative paths use independent rates; valid calls consume all traces.
    std::uint32_t learn_contrastive_reward_asymmetric(
        float positive_learning_rate, float negative_learning_rate,
        std::uint32_t input_neuron_id, std::uint32_t positive_neuron_id,
        std::uint32_t negative_neuron_id);

    const std::vector<Neuron>& neurons() const noexcept { return neurons_; }
    const std::vector<Synapse>& synapses() const noexcept { return synapses_; }
    const Neuron* find_neuron(std::uint32_t id) const noexcept;

private:
    std::vector<Neuron> neurons_;
    std::vector<Synapse> synapses_;
    std::uint32_t next_id_{1};
};

} // namespace neurogenesis
