# NEUROGENESIS — selective cleanup seed robustness

**Protocol:** version 1  
**Candidate under test:** one replay sweep plus at most two event-triggered cross-route corrections  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** never loaded or modified

## 1. Research question

The first selective-cleanup experiment passed all four original seed/order scenarios with a maximum budget of two corrections per brain. This follow-up asks whether the same fixed strategy generalizes to a wider set of initial feature-to-output mappings.

## 2. Fixed protocol

The benchmark reuses the same network topology, training schedule, homeostatic composition update, one bounded-asymmetric replay sweep, leakage-ranking procedure, and zero-positive / full-negative correction update. It does not tune rates or thresholds.

Ten deterministic seeds are used: 7, 17, 29, 43, 59, 73, 97, 127, 101, and 211. Each seed runs in both existing task orders (forward and reverse), for 20 independent disposable WASM brains.

The cleanup budget remains fixed at two episodes per brain. All 11 held-out combinations and all 60 input-stimulation permutations are measured. The same output activation, headroom, weight-bounds, fresh-feature-transfer, and old-after-fresh criteria remain in force.

## 3. Measurements and safeguards

The machine-readable report records every seed/order scenario, initial and final leakage, expected activation, selected cross-route edges, before/after weights, cleanup count, fresh-feature transfer, and total episode count.

The CI test requires all 20 scenarios to complete; both task orders to be represented for every seed; no brain to exceed the two-episode budget; each correction to change exactly one selected edge; all eligibility traces to be consumed; all weights to remain finite and bounded; and all 20 brains to be disposed.

The report separately records how many scenarios meet the full retention and transfer acceptance criteria. A scientifically unsuccessful candidate is reported as a measured failure rather than hidden by relaxed thresholds.

## 4. Verified results — GitHub Actions run #523

**Status:** all validation, research benchmarks, regression tests, and GitHub Pages deployment passed on commit `1072b7737dbf3ab3324d999945674709e7d29fec` (2026-11-10). The full machine-readable report was uploaded as `neurogenesis-plasticity-selective-cleanup-robustness-v1`.

All **20 of 20** seed/order scenarios passed the complete acceptance criteria:

| Measure | Result |
|---|---:|
| Seeds | 10 |
| Task orders per seed | 2 |
| Total scenarios | 20 |
| Retention passes | 20/20 |
| Headroom passes | 20/20 |
| Fresh fifth-feature learning | 20/20 |
| Old combinations after fresh learning | 20/20 |
| Maximum cleanup used per scenario | 2 |
| Maximum non-target activation after cleanup | 0 |
| Minimum expected activation | 0.63688087 |
| Maximum correct primitive weight | 0.63689101 |
| Disposable brains left alive | 0 |

All ten forward-order scenarios used exactly two targeted corrections; all ten reverse-order scenarios needed none. Every correction changed exactly one selected cross-route weight, consumed eligibility traces, and left every unrelated weight unchanged. The weight bounds and headroom checks passed in all scenarios.

Across the 20 scenarios the benchmark used **4,040 total episodes**. A two-sweep reference at 345 episodes per scenario would use 6,900 episodes. The measured selective method therefore used about **41.45% fewer total episodes** for this fixed task schedule.

[Successful workflow run #523 and JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42828687166) · [Verified source commit](https://github.com/ilonadanelan1-code/NEUROGENESIS/commit/1072b7737dbf3ab3324d999945674709e7d29fec)

## 5. Interpretation and next step

The two-correction policy generalised across the ten tested deterministic seed values and both existing task orders. The exact same measured forward-order leakage pattern recurred for every tested seed, and the correction ranking selected the same number of edges. This makes the result stronger than the original four-scenario result, but still bounded to the current complete four-feature/five-output graph and fixed composition tasks.

The next research step is to create a pre-registered stress fixture where a false output receives contributions from at least three competing input routes, then test whether the same score ranking selects the right subset under the unchanged two-correction cap. Also vary the graph's cross-route initial weights without tuning the acceptance limits. If the cap fails, preserve the failed report and determine whether the cause is attribution ambiguity or an insufficient budget; do not silently raise the cap.

No production learning rule, application state, or user save data was changed by these experiments.
