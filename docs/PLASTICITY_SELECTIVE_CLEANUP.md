# NEUROGENESIS — event-triggered selective plasticity cleanup

**Protocol:** version 1  
**Base learning:** one replay sweep, bounded asymmetric rates 0.02 / 1.00  
**Correction:** zero positive update, negative update 1.00, at most 0/1/2/4/8 cleanup episodes per scenario  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** never loaded or modified

## 1. Research question

The previous replay-efficiency experiment found that one full replay sweep with negative rate 1.00 preserved the old mappings in only two of four seed/order scenarios. The two forward-order scenarios narrowly failed because a wrong output still activated above the fixed 0.05 ceiling. A second full replay sweep passed all four scenarios.

This experiment tests whether the missing correction can be applied more selectively: identify the input-to-wrong-output synapse routes that contribute most to measured false activation, then depress only those routes.

## 2. Fixed learning protocol

Every candidate starts from the same initial singleton training, three composition-learning cycles, and one complete replay sweep. The rates are fixed:

- Replay positive rate: 0.02.
- Replay negative rate: 1.00.
- Composition update: homeostatic reward at 0.05.
- Cleanup positive rate: 0.00.
- Cleanup negative rate: 1.00.

The cleanup procedure is invoked after the one-sweep protocol and before the retained-map score. It first measures all 11 held-out feature combinations and all 60 stimulation-order permutations. For each non-target output above 0.05, it attributes the excess response to the active feature-to-output cross routes. Each route receives an accumulated score equal to excess activation multiplied by its current synaptic weight.

The highest-ranked route is selected. Exactly one contrastive episode is then applied to that input, its known correct output (zero positive learning rate), and the selected incorrect output. The test requires exactly one weight to change: the selected incorrect edge must weaken; no other edge may change. The system re-measures all held-out combinations before selecting the next route. It stops early when retention passes or when the registered budget is exhausted.

## 3. Fixed candidate budgets

Each candidate runs with seeds 101 and 211, in both forward and reverse task order: four independent disposable brains per candidate.

| Candidate | Maximum cleanup episodes per brain | Maximum across four scenarios |
|---|---:|---:|
| No cleanup | 0 | 0 |
| Minimal | 1 | 4 |
| Small | 2 | 8 |
| Medium | 4 | 16 |
| Maximum registered | 8 | 32 |

The maximum of eight cleanup episodes per scenario is fixed before measurement. The test does not increase it after observing a failure. This is a strict budget, not a target number: cleanup may stop earlier when all held-out responses pass.

## 4. Acceptance and controls

The no-cleanup candidate must reproduce the known one-sweep failure in two of four scenarios. This is a regression guard against accidentally changing the base protocol.

A candidate passes only when all four scenarios satisfy all of these requirements:

- All four singleton routes and 11 held-out combinations are correct.
- All 60 stimulation permutations remain within the order-invariance limit.
- Expected activation is at least 0.15 and non-target activation is at most 0.05.
- Maximum correct weight stays at or below 0.95; no correct edge reaches 0.98.
- A new fifth feature learns the previously unused output with the same bounded learning rule.
- All 11 original held-out combinations still pass after the new feature is learned.
- All weights remain finite and within [0, 1].

Each cleanup event is checked for consumed eligibility traces and exactly one changed synaptic edge. Every scenario uses a fresh WASM brain and must dispose it.

The experiment is technically valid when all five budgets complete, the no-cleanup control reproduces its known result, all weight and isolation checks pass, and both task orders are included. Smaller budgets are allowed to fail scientifically without failing CI.

## 5. Cost accounting

The original two-sweep protocol uses 288 replay episodes per scenario. The one-sweep base uses 144. Selective cleanup adds no more than the candidate's fixed budget. At the maximum budget, the total replay-plus-cleanup cost is 152 episodes per scenario, still 47.2% below the 288-episode two-sweep reference. Lower budgets reduce it further.

The benchmark archives every candidate's full per-scenario results, selected routes, before/after weights, leak measurements, cleanup count, episode count, and timing in a JSON CI artifact. CI timings are not mobile performance estimates.

## 6. Isolation and interpretation

All learning and correction occur inside disposable WASM brains constructed by the test runtime. No user-created network, localStorage record, saved memory, or production JavaScript synaptic weight is read or changed.

A passing result would support only the tested supervised four-feature route-retention task. It would not establish general continual learning, open-ended autonomy, relational reasoning, or intelligence.

## 7. Verified results — GitHub Actions run #517

**Status:** the complete validation and GitHub Pages deployment passed on commit `9549654e96b718fd128de1593b680bfd90f8d6ea` (2026-11-10). The CI artifact `neurogenesis-plasticity-selective-cleanup-v1` contains all 20 seed/order/budget scenarios and every selected-edge correction.

| Cleanup budget per brain | Scenarios passing | Retention passes | Cleanup episodes across four brains | Worst non-target activation after cleanup |
|---:|---:|---:|---:|---:|
| 0 | 2/4 | 2/4 | 0 | 0.05328359 |
| 1 | 2/4 | 2/4 | 2 | 0.05328359 |
| **2** | **4/4** | **4/4** | **4** | **0** |
| 4 | 4/4 | 4/4 | 4 | 0 |
| 8 | 4/4 | 4/4 | 4 | 0 |

The two-correction budget is the **smallest tested budget that passed all four scenarios**. Both seed/order cases in reverse order needed no correction. Both forward-order cases needed exactly two targeted corrections each. A one-correction budget fixed only one of the two wrong routes and therefore correctly remained a failure.

In each forward-order case, the two selected cross-route weights fell from **0.023264 to 0.013271**. Exactly one edge changed per correction; the correct positive route was not strengthened, and all eligibility traces were consumed. After cleanup:

- All 4 singleton routes and all 11 held-out combinations passed in both task orders.
- All 60 held-out stimulation permutations remained within the fixed limits.
- Maximum non-target activation was **0**.
- Minimum expected activation was approximately **0.63688**, above the 0.15 floor.
- All four scenarios retained weight headroom and learned the fifth feature.
- All original combinations still passed after fifth-feature learning.
- Every one of the 20 disposable brains was disposed; weights remained finite and within [0, 1].

### Measured cost

The accepted two-sweep reference used **1,380 total episodes** across four scenarios, including 1,152 replay episodes. The selective method used **808 total episodes**: 576 replay episodes plus four targeted corrections. That is **41.45% fewer total episodes** and **49.65% fewer replay/cleanup episodes** than the two-sweep reference, under this benchmark's episode-count definition.

The budgets of four and eight did not add further corrections or improve the result. The minimal successful choice is therefore budget two, not the maximum budget eight.

[Successful workflow run #517 and JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42828003033) · [Measured source commit](https://github.com/ilonadanelan1-code/NEUROGENESIS/commit/9549654e96b718fd128de1593b680bfd90f8d6ea)

## 8. Decision and next step

The follow-up robustness run #523 extended the original result to ten deterministic seeds and both forward/reverse task orders. All 20 scenarios passed with the same two-correction maximum: every forward-order scenario used two targeted cross-route corrections, while every reverse-order scenario needed none. All 20 retained the original feature mappings, passed headroom checks, learned the fifth feature, and retained all earlier held-out combinations after fresh learning. Maximum non-target activation after correction remained zero.

This confirms the result across more initial mappings, but only for the existing complete four-feature/five-output fixture. The next task is a new pre-registered stress graph where a false output accumulates at least three competing route contributions, with varied cross-route initial weights and the same fixed correction budget. Determine whether the ranking remains accurate when leakage is distributed over more routes. Keep thresholds unchanged and archive failures as results. Do not transfer the experimental rule to the production JavaScript network or user saves until the broader stress task passes and a separate integration review is completed.

Detailed robustness protocol and measurements: `docs/PLASTICITY_SELECTIVE_CLEANUP_ROBUSTNESS.md`.
