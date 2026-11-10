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

## 7. Status

Protocol version 1 is registered in source and CI. Measurements are pending the first successful workflow run. The one-sweep replay baseline remains the reference; no cleanup budget is promoted until it passes every acceptance condition in all four seed/order scenarios.
