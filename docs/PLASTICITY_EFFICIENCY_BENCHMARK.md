# NEUROGENESIS — plasticity replay-efficiency benchmark

**Protocol:** version 1  
**Baseline method:** bounded asymmetric replay, positive rate 0.02, negative rate 0.70, two replay sweeps  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** never loaded or modified

## 1. Research question

The headroom benchmark established that two replay sweeps with a bounded asymmetric update can retain earlier feature routes, preserve weight headroom, and learn one new feature. Each four-scenario candidate costs 1,152 replay episodes in aggregate.

This experiment asks whether fewer replay episodes can achieve the same acceptance criteria by changing only replay count and the negative update rate. It is a parameter-efficiency experiment, not a new learning architecture.

## 2. Fixed protocol

All candidates use the same four input features, five outputs, initial supervised singleton training, three composition-learning cycles, homeostatic composition reward at 0.05, and eight fresh-association sweeps. The positive replay rate remains 0.02.

Every candidate runs with seeds 101 and 211 and both forward and reverse task order: four independent disposable WASM brains per candidate, 20 brains overall.

| Candidate | Replay sweeps per composition | Positive rate | Negative rate |
|---|---:|---:|---:|
| Baseline | 2 | 0.02 | 0.70 |
| One sweep, standard depression | 1 | 0.02 | 0.70 |
| One sweep, stronger depression | 1 | 0.02 | 0.85 |
| One sweep, maximum depression | 1 | 0.02 | 1.00 |
| No replay | 0 | 0.02 | 0.70 |

Only the replay sweep count and negative rate vary. Each candidate is evaluated independently against the same fixed thresholds; no result-dependent threshold tuning is permitted.

## 3. Acceptance criteria

A candidate passes only when **all four** seed/order scenarios meet every condition:

- The four original primitive mappings and all 11 held-out multi-feature combinations remain correct after composition training.
- Expected outputs activate to at least 0.15; non-target outputs stay at or below 0.05.
- Maximum correct primitive weight stays at or below 0.95, with no correct edge reaching 0.98.
- The new fifth feature learns its unused output using the candidate's own replay rule.
- All 11 old held-out combinations still pass after the fifth feature is learned.
- All weights remain finite and within [0, 1].

The experiment itself is considered technically valid when the two-sweep baseline reproduces the established result, all candidates complete, all weights remain bounded, both training orders are represented, and replay episode counts are recorded. Reduced-replay candidates are allowed to fail; their failure is a research result, not a reason to fail the CI job.

## 4. Cost accounting

For the four seed/order scenarios together:

- Two-sweep baseline: 1,152 replay episodes and 1,380 total episodes.
- One-sweep candidates: 576 replay episodes and 804 total episodes (50% fewer replay episodes).
- Zero-sweep candidate: 0 replay episodes and 228 total episodes.

The benchmark saves each scenario's measured weights, activations, pass/fail status, episode counts, and runtime in a machine-readable JSON CI artifact. Timing values are specific to the GitHub Actions runner and are not mobile-device performance estimates.

## 5. Isolation and interpretation

Each candidate constructs and disposes its own WASM brains. The current JavaScript production network, persistent browser storage, and user-created memories are not touched. The parameterized benchmark runner is test infrastructure only; it does not expose the experimental rule to normal application operation.

A result can support only a narrow conclusion about the tested supervised feature-to-output graph and task schedule. It does not demonstrate open-ended lifelong learning, relational reasoning, autonomy, or general intelligence.

## 6. Status

The protocol is registered in source and runs in CI. Numerical outcomes are pending the first successful workflow run with the saved artifact. Do not promote a reduced-replay candidate until all four of its scenarios pass the complete acceptance criteria.
