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

The report stores each route's pre-cleanup weight, weight increment, full false-output activation, activation with that route omitted, and marginal contribution. It also stores post-cleanup route evidence, correction targets, held-out retention, headroom, fresh-feature learning, and old-map retention after fresh learning.

The protocol test requires all 30 scenarios, both task orders for each seed/profile, exactly three distinct seeded routes, positive measured contribution from all three routes, a false output not belonging to the mapping, no more than two cleanup episodes, single-edge-only corrections, consumed eligibility traces, bounded weights, and disposal of every brain.

The protocol pass and scientific candidate pass are intentionally separate. A valid experiment remains a successful CI test even when the fixed two-correction policy fails the harder acceptance criteria. Such a failure is retained as a result; the budget and thresholds are not relaxed to make the benchmark green.

## 4. Verified results

Pending the first complete GitHub Actions run. The machine-readable artifact is published as neurogenesis-plasticity-three-route-stress-v1.

## 5. Interpretation boundary and next step

A pass would support only this fixed three-route stress fixture and its tested seeds/profiles. A failure would show that the two-correction policy does not cover this specific multi-route condition; it would not justify silently increasing the cap. Any later proposal to integrate selective correction into a disposable shadow network must be based on the archived evidence and a separate review.

No production learning rule, application state, or user save data is modified by this research benchmark.
