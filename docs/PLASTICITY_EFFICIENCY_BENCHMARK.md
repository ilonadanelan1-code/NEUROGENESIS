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

## 6. Verified results — GitHub Actions run #511

**Status:** the benchmark infrastructure passed on commit `63566be4fadcefa7bc9c148aa3b43685a4efd9a4` (2026-11-10). The full workflow, regression suite, and GitHub Pages deployment succeeded. The JSON artifact `neurogenesis-plasticity-efficiency-v1` was uploaded with all 20 scenarios.

The fixed two-sweep baseline reproduced the established result in all four seed/order scenarios. All candidates completed, all weights remained finite and bounded, and the new-feature association passed in all 20 cases. The reduced-replay candidates are evaluated against the task's strict acceptance conditions; their failure is reported rather than treated as an infrastructure failure.

| Candidate | Replay reduction | Full passes | Headroom passes | Retention passes | Max non-target response |
|---|---:|---:|---:|---:|---:|
| Baseline: 2 sweeps, negative 0.70 | 0% | 4/4 | 4/4 | 4/4 | 0 |
| 1 sweep, negative 0.70 | 50% | 0/4 | 4/4 | 0/4 | 0.08052414 |
| 1 sweep, negative 0.85 | 50% | 2/4 | 4/4 | 2/4 | 0.06523899 |
| 1 sweep, negative 1.00 | 50% | 2/4 | 4/4 | 2/4 | 0.05328359 |
| 0 sweeps, negative 0.70 | 100% | 0/4 | 4/4 | 0/4 | 0.26564527 |

All candidates preserved weight bounds and passed fresh fifth-feature learning in 4/4 cases. The stronger one-sweep candidates passed only in reverse task order; both forward-order scenarios failed because residual non-target activation remained above the strict 0.05 ceiling. At negative rate 1.00, the worst observed leakage was 0.05328359: close to the limit, but still a failure. It must not be rounded down or counted as a pass.

The weight headroom improved as replay was reduced: the maximum correct weight was 0.73521924 for the baseline, about 0.63689–0.63693 for one sweep, and 0.50397497 for zero sweeps. This does not compensate for interference: lower target-route weights coexisted with larger cross-route responses.

### Interpretation and next experiment

The experiment rejects the current one-sweep and zero-sweep settings under the pre-registered limits. The bottleneck is not learning the fresh association or maintaining bounded weights. It is selective retention under the forward task order: a single full replay sweep leaves enough cross-route weight to activate an incorrect output.

The next experiment should test **event-triggered selective cleanup**: begin with one sweep and negative rate 1.00, measure the non-target outputs for all held-out combinations, then apply a small, bounded number of additional contrastive episodes only to the input→incorrect-output routes responsible for the largest measured leakage. Re-evaluate every held-out combination, both training orders, and the fifth-feature transfer after cleanup. Register a strict maximum cleanup-episode budget before running it; do not increase that budget after seeing a failure.

The original two-sweep strategy remains the only configuration in this comparison that passed all four seed/order scenarios. All candidate experiments remain isolated from the production JavaScript network and user saves.

[Successful workflow run #511 and downloadable JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42825226841) · [Source commit](https://github.com/ilonadanelan1-code/NEUROGENESIS/commit/63566be4fadcefa7bc9c148aa3b43685a4efd9a4)

