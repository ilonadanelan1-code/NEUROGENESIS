# NEUROGENESIS — disposable WASM experiments

**Status:** isolated candidate copies and the manual contrastive-trial preview are implemented and tested.

## Isolation boundary

The authoritative application graph remains JavaScript. The long-lived WASM shadow is a separate simulation mirror. A disposable experiment creates a third, short-lived C++/WASM brain from a captured graph snapshot.

A ready shadow controller exposes:

```js
const experiment = shadow.createExperiment();
```

The application bridge exposes the same capability through `NGBrain.wasmCreateDisposableExperiment()`.

The experiment owns its candidate brain and exposes:

- `baselineSnapshot()` — a defensive copy of the captured baseline;
- `candidate` — operations on the isolated WASM candidate;
- `snapshot()` and `compare()` — candidate state and weight/edge differences;
- `exportProposal()` — a versioned, manual-review-only proposal;
- `dispose()` — idempotent release of candidate memory.

There is deliberately no apply, merge, save, or automatic-import method.

## Fresh-state option

```js
const experiment = shadow.createExperiment({ resetState: true });
```

When `resetState` is enabled, the copy keeps neuron identities, graph structure, and synapse weights but starts with zero transient neuron activity and zero eligibility/signal traces. The captured JavaScript graph and the long-lived shadow remain untouched.

## Manual contrastive trial

The experimental panel now allows the user to select:

1. one non-output input neuron;
2. one positive output neuron;
3. one competing output neuron.

The input must have direct synapses to both selected outputs. The current C++ contrastive method updates only those two direct input-to-output edges; it does not perform credit assignment through arbitrary hidden paths. The interface filters for valid direct pairs and refuses unsupported selections.

A trial runs on a fresh disposable copy: stimulus `0.8`, six simulation steps at `0.1` seconds, eligibility retention `0.9`, positive rate `0.02`, and negative rate `1.0`. It requires positive eligibility traces on both target edges, checks that no unselected weights or graph edges changed, builds a manual-review-only proposal, and disposes the candidate.

The downloaded JSON contains the proposal and the observed trial report. Downloading it does not change the application network or local storage. The UI reads its neuron list and graph fingerprint from the authoritative JavaScript snapshot, not the long-lived WASM shadow (which may contain its own experimental weight overlay). It invalidates a previous proposal whenever selected neurons change or source topology, neuron types/excitability, or synapse weights change; export rechecks the current JavaScript graph before creating the file.

## Limits

This is an explicit one-event preview on a user-selected direct pair, not a general-purpose correction policy. It does not automatically infer which output is correct, train indirect routes, or apply learned weights to the live graph. Results on the currently selected network must be evaluated before any broader integration is considered.
