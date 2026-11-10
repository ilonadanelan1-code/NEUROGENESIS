# Neuron focus mode

## Purpose

The focus control makes a dense network easier to inspect on a phone. It
highlights the currently selected neuron and its one-hop incoming/outgoing
neighbors, while dimming unrelated neurons and edges.

## Interaction

- Tap the target/eye control in the canvas toolbar to enable focus.
- Select another neuron to move the focus.
- Tap the control again to restore the full-network overview.
- Existing layout separation and undo controls remain separate.

## Safety

Focus mode is purely presentational. It does not move neurons, modify
synapses, change weights, write memory records, or alter WASM learning state.

## Test

The unit test verifies both incoming and outgoing neighbors, excludes edges
between neighbors from the focused edge set, handles isolated neurons, and
rejects missing selections.
