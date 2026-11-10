# NEUROGENESIS — three-route selective-cleanup stress test

**Protocol:** version 1  
**Candidate under test:** one bounded-asymmetric replay sweep plus at most two selective corrections  
**Stress topology:** three active input routes converge on one unused (false) output  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** never loaded or modified

## 1. Research question

The ten-seed robustness test passed on the original four-feature/five-output task schedule. This test asks a harder and narrower question: can the existing leakage ranking identify a false output receiving contributions from at least three concurrently active input routes, while the correction budget remains fixed at two episodes?

The false output is selected from the one output not assigned to any of the four original features. Three fixed feature inputs (F1, F2, and F3) are then given positive eligibility-based reinforcement toward that same false output. Their correct output routes are held neutral during this seeding operation. The test measures the false-output activation with all three inputs active and measures each route's marginal contribution by repeating the readout with that route omitted.

## 2. Pre-registered conditions

The benchmark uses five deterministic seeds (7, 17, 29, 43, 59), with both forward and reverse task orders. Three cross-route weight profiles are fixed before measurement:

| Profile | Reinforcement episodes per competing route |
|---|---|
| equal-medium | 2 / 2 / 2 |
| ascending | 1 / 2 / 3 |
| descending | 3 / 2 / 1 |

This produces 30 independently created and disposed WASM brains. The seeding positive rate remains 1.0. Replay remains one sweep at positive rate 0.02 and negative rate 1.0. Selective cleanup remains zero-positive / full-negative at a maximum of two correction episodes per brain.

The acceptance limits are unchanged: expected activation at least 0.15, non-target activation at most 0.05, correct weights below 0.95, and all weights finite and within [0, 1]. No rate, threshold, or correction budget is tuned after observing the result.

## 3. Attribution and safeguards

The report stores each route's pre-cleanup weight, weight increment, isolated single-input activation above the no-input baseline, and the combined three-input false-output activation. The isolated probe avoids a false zero-contribution reading when the combined output saturates at 1.0. It also stores post-cleanup route evidence, correction targets, held-out retention, headroom, fresh-feature learning, and old-map retention after fresh learning.

The protocol test requires all 30 scenarios, both task orders for each seed/profile, exactly three distinct seeded routes, positive measured contribution from all three routes, a false output not belonging to the mapping, no more than two cleanup episodes, single-edge-only corrections, consumed eligibility traces, bounded weights, and disposal of every brain.

The protocol pass and scientific candidate pass are intentionally separate. A valid experiment remains a successful CI test even when the fixed two-correction policy fails the harder acceptance criteria. Such a failure is retained as a result; the budget and thresholds are not relaxed to make the benchmark green.

## 4. Verified results — GitHub Actions run #526

**Workflow:** successful validation and GitHub Pages deployment on commit e6d49aa7f8b55b21d7b051f657b5fe1605050637. The 30-scenario report was archived as the neurogenesis-plasticity-three-route-stress-v1 artifact.

| Measure | Result |
|---|---:|
| Seeds × task orders × weight profiles | 5 × 2 × 3 = 30 |
| Scenarios with three positive route contributions | 30/30 |
| False output above the 0.05 limit before cleanup | 30/30 |
| False output above the 0.05 limit after cleanup | 30/30 |
| Combined false-output activation | 1.0 in every scenario |
| Full retention + transfer acceptance | 0/30 |
| Headroom checks | 30/30 |
| Fresh fifth-feature learning | 30/30 |
| Old mappings retained after fresh learning | 0/30 |
| Corrections used | 60 total; exactly 2 per scenario |
| Corrections aimed at one of the three seeded false routes | 60/60 |
| Brains left undisposed | 0 |

In the equal-medium profile, each seeded cross-route weight rose from 0 to 0.674601. The ranking selected two of the three routes; each selected weight fell to 0.380663, while the third remained at 0.674601. The isolated activation contributions of all three remained above the 0.05 acceptance limit. In ascending and descending profiles, the same qualitative failure persisted: the two-correction cap could not clear the false output.

The initial #525 run correctly revealed output saturation but used an invalid leave-one-out attribution metric. Run #526 replaced that metric with isolated one-route probes against a no-input baseline. The corrected protocol passed; the scientific candidate did not. This distinction is preserved in the JSON artifact.

## 5. Interpretation boundary and next step

The failure is not an attribution-ranking miss: all 60 correction episodes targeted one of the three deliberately seeded routes into the false output. The failure is insufficient correction depth. Two total episodes leave one route untouched and also leave corrected links individually strong. The first depth diagnostic (run #527) compared budgets 2, 3, 6, and 9: all 40 scenarios were valid, but no budget eliminated the false response. The next registered comparison extends to 18, 21, and 24 total corrections. These are experiment-only diagnostics; no production correction budget is being adopted or raised.

No production learning rule, application state, or user save data is modified by this research benchmark.

No production learning rule, application state, or user save data is modified by this research benchmark.
