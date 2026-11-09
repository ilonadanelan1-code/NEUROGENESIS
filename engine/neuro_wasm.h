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
int ng_brain_stimulate(ng_brain_handle* handle, uint32_t neuron_id, float strength);
void ng_brain_step(ng_brain_handle* handle, float delta_seconds);

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

#ifdef __cplusplus
}
#endif
