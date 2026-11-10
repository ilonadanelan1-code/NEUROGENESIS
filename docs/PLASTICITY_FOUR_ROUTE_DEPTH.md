# NEUROGENESIS — four-route cleanup-depth stress

**Protocol:** version 1  
**Question:** does selective cleanup generalize from three to four simultaneous competing routes?  
**Runtime:** disposable C++/WebAssembly brains only  
**Production network and user saves:** unchanged

## 1. Fixed comparison

Four known feature inputs (F1–F4) are reinforced toward the same unused false output. Their correct mappings remain distinct. Three pre-registered route-strength profiles are used: equal-medium (2/2/2/2), ascending (1/2/3/4), and descending (4/3/2/1) positive seeding episodes per route.

Each profile uses five deterministic seeds (7, 17, 29, 43, 59) and both forward/reverse task orders. Cleanup budgets are 28, 32, and 36 episodes. Replay remains one sweep at positive rate 0.02 and negative rate 1.0; cleanup remains zero-positive/full-negative at rate 1.0. Acceptance limits remain unchanged: expected output at least 0.15, non-target at most 0.05, correct weight at most 0.95.

The protocol uses 90 independent disposable WASM brains. Each case must show four distinct positive isolated route contributions before cleanup. The report records selected edges, their weights, final false-output activation, old-map retention, headroom, fresh-feature learning, and disposal checks.

## 2. Protocol versus candidate

The CI test fails only when the experiment itself is invalid: missing scenarios, absent route contributions, out-of-budget updates, multi-edge correction, unconsumed traces, out-of-range weights, or undisposed brains. Candidate acceptance is reported separately for each route profile and budget. A scientifically unsuccessful candidate remains archived as a valid measured result.

## 3. Verified results

Pending first GitHub Actions run. The machine-readable artifact is published as neurogenesis-plasticity-four-route-depth-v1.

## 4. Interpretation boundary

This experiment is limited to the registered four-input/five-output topology and fixed seed/profile set. No result from it will automatically change the production JavaScript network, user saves, or the selected correction policy.
