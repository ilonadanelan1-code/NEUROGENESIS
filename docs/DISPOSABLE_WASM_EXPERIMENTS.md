# NEUROGENESIS — disposable WASM experiment boundary

**Status:** implemented and covered by the WebAssembly integration test  
**Purpose:** provide an isolated candidate copy of the authoritative JavaScript graph for future controlled learning trials.

## What the API does

A ready WASM runtime can create a disposable experiment from a captured graph snapshot:

```js
const experiment = runtime.createDisposableExperiment(snapshot);
```

The experiment owns a separate C++/WASM brain. Its baseline is captured at creation time. The caller can run candidate operations through `experiment.candidate`, then inspect:

- `experiment.baselineSnapshot()` — a defensive copy of the captured baseline;
- `experiment.snapshot()` — a defensive copy of the candidate state;
- `experiment.compare()` — changed weights and added/removed edges;
- `experiment.exportProposal()` — a versioned, manual-review-only change proposal;
- `experiment.dispose()` — idempotent release of the candidate brain.

Snapshots returned by the API are copies; editing them cannot rewrite the private baseline or the WASM candidate. Calls that inspect the experiment after disposal fail explicitly.

## Connection to the application shadow controller

A ready shadow controller exposes `createExperiment()`. It captures the controller's `getSnapshot()` result, which in the application is `wasmShadowSnapshot()`: the authoritative JavaScript graph.

This is deliberate. Experimental weights stored in the long-lived WASM shadow overlay are not silently inherited by a new candidate. A new trial starts from the current application graph, while the long-lived shadow remains unchanged.

The application surface also exposes `NGBrain.wasmCreateDisposableExperiment()` for future explicit experiment UI. It returns `null` until the shadow runtime is ready or after it has been disposed.

## Safety boundary

There is intentionally **no apply, merge, save, or automatic-import method** on an experiment. Export creates a proposal for inspection only. The application JavaScript graph, local storage, memory records, and long-lived shadow controller are not changed by candidate operations.

This is infrastructure for controlled trials, not yet a correction policy for arbitrary user networks. The next stage must define explicit task labels and a suitable evaluation protocol before running corrective learning against a real graph snapshot.
