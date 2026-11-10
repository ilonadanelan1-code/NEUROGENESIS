#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ng_brain_handle ng_brain_handle;

ng_brain_handle* ng_brain_create(void);
void ng_brain_destroy(ng_brain_handle* handle);

uint32_t ng_brain_add_neuron(ng_brain_handle* handle, const char* name, int kind,
                             float x, float y, float excitability);
int ng_brain_add_synapse(ng_brain_handle* handle, uint32_t from, uint32_t to, float weight);
int ng_brain_set_synapse_weight(ng_brain_handle* handle, uint32_t from, uint32_t to, float weight);
int ng_brain_set_synapse_eligibility(ng_brain_handle* handle, uint32_t from, uint32_t to, float value);
void ng_brain_reset_eligibility(ng_brain_handle* handle);
int ng_brain_stimulate(ng_brain_handle* handle, uint32_t neuron_id, float strength);
uint32_t ng_brain_learn(ng_brain_handle* handle, float learning_rate, float reward, float weight_decay);
uint32_t ng_brain_learn_from_reward(ng_brain_handle* handle, float learning_rate, float reward, float weight_decay);
uint32_t ng_brain_learn_from_reward_homeostatic(ng_brain_handle* handle, float learning_rate, float reward, float weight_decay);
uint32_t ng_brain_learn_contrastive_reward(ng_brain_handle* handle, float learning_rate,
                                           uint32_t input_neuron_id,
                                           uint32_t positive_neuron_id,
                                           uint32_t negative_neuron_id);
uint32_t ng_brain_learn_contrastive_reward_asymmetric(
    ng_brain_handle* handle, float positive_learning_rate, float negative_learning_rate,
    uint32_t input_neuron_id, uint32_t positive_neuron_id, uint32_t negative_neuron_id);
void ng_brain_step(ng_brain_handle* handle, float delta_seconds, float eligibility_retention);

uint32_t ng_brain_neuron_count(const ng_brain_handle* handle);
uint32_t ng_brain_synapse_count(const ng_brain_handle* handle);

uint32_t ng_brain_neuron_id_at(const ng_brain_handle* handle, uint32_t index);
int ng_brain_neuron_kind_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_neuron_activation_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_neuron_excitability_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_neuron_x_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_neuron_y_at(const ng_brain_handle* handle, uint32_t index);

uint32_t ng_brain_synapse_from_at(const ng_brain_handle* handle, uint32_t index);
uint32_t ng_brain_synapse_to_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_synapse_weight_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_synapse_signal_at(const ng_brain_handle* handle, uint32_t index);
float ng_brain_synapse_eligibility_at(const ng_brain_handle* handle, uint32_t index);

#ifdef __cplusplus
}
#endif
