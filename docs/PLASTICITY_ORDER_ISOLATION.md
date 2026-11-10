# NEUROGENESIS — five-route order-isolation benchmark

## Purpose

Separate three order variables that were previously coupled under a single forward/reverse switch:

1. Initial single-feature learning traversal (feature and negative-output order).
2. The sequence of composition-learning tasks.
3. Replay traversal order (feature and negative-output order).

Fresh-association learning is held in the forward direction in every condition. This prevents its order from becoming a fourth confound while comparing retention.

## Protocol v1

- Five inputs, six outputs, five deterministic seeds.
- Three stress profiles: equal-medium (2/2/2/2/2), ascending (1/2/3/4/5), descending (5/4/3/2/1).
- Cleanup budget fixed at 56 one-edge corrections.
- Full 2×2×2 factorial across the three order variables: eight conditions per profile and seed, 120 disposable WASM brains total.
- Every scenario records 18 intermediate checkpoints: after composition training and after replay for each of three tasks in each of three cycles.
- Each checkpoint evaluates all five held-out four-of-five feature combinations across all 24 permutations.
- Each cleanup correction must weaken exactly one selected edge and consume eligibility traces.
- Every network is disposed after its scenario.

## Interpretation

The purpose is to identify which order variable first introduces held-out interference and whether order variables interact. It is not an attempt to increase the cleanup budget or change the live learning rule.

A protocol pass confirms completion and integrity, not scientific acceptance. Retention, plasticity headroom, fresh association learning and old-map retention after fresh learning remain separate measured outcomes.

The benchmark is disposable and does not modify the production network or user saves.

## Results — protocol v1 measured 2026-11-10

All 120 profile/seed/order scenarios completed, every integrity check passed, and all disposable WASM brains were released.

| Composition-task sequence | Retention + old-map-after-fresh | Full acceptance |
|---|---:|---:|
| Forward (AB, CD, ABCDE) | 20/60 | 20/60 |
| Reverse (ABCDE, CD, AB) | 60/60 | 60/60 |

Initial mapping traversal and replay traversal produced no marginal change: each direction yielded 40/60 overall when averaged across the composition-order conditions. Composition-task sequence determined the result.

| Profile | Forward composition | Reverse composition |
|---|---:|---:|
| Equal-medium | 20/20 | 20/20 |
| Ascending | 0/20 | 20/20 |
| Descending | 0/20 | 20/20 |

In every tested order variant, the first held-out failure appeared in cycle 1 immediately after the ABCDE dense-union task. When this task followed the two pair tasks, its maximum unexpected activation at the first failing checkpoint was about 0.11062; when it was presented first, it was about 0.08629. This points to interference accumulated before dense composition training, rather than a simple replay-traversal issue.

The forward sequence used the complete cleanup budget of 56 in every scenario. The reverse sequence averaged 38.67 cleanup events and brought the measured residual maximum to zero across held-out checks. In the forward ascending/descending profiles, residual activation remained about 0.05050, just above the 0.05 acceptance threshold.

## Protocol v2 — all composition-task permutations

The next experiment enumerates all six permutations of the three composition tasks, while fixing initial mapping traversal, replay traversal and fresh-association traversal forward. It retains the same three stress profiles, five seeds and cleanup budget of 56 (90 disposable networks total), with 18 intermediate checkpoints per scenario. Its purpose is to determine whether the dense task must be first, or whether another specific pair/dense ordering is responsible.

## Results — protocol v2, all six task permutations

All 90 profile/seed/permutation scenarios completed. All protocol-integrity checks passed, all 90 disposable WASM brains were released, and the complete GitHub Actions validation and Pages deployment succeeded.

| Composition task order | Full acceptance | Mean cleanup events | Maximum residual activation |
|---|---:|---:|---:|
| AB → CDE → ABCDE | 5/15 | 56.00 | 0.050502 |
| AB → ABCDE → CDE | 15/15 | 44.67 | 0 |
| CDE → AB → ABCDE | 15/15 | 53.67 | 0 |
| CDE → ABCDE → AB | 15/15 | 38.67 | 0 |
| ABCDE → AB → CDE | 15/15 | 38.67 | 0 |
| ABCDE → CDE → AB | 15/15 | 38.67 | 0 |

The single failing sequence is not explained by "dense union last" alone: CDE → AB → ABCDE also places the dense task last, yet passes 15/15. The failure is specific to presenting AB before CDE and then presenting the dense union. In that sequence, equal-medium passes 5/5, but ascending and descending profiles each pass 0/5. Headroom and fresh-association learning pass 15/15 even in this failing sequence; the failures are old-map retention and old-map retention after fresh learning.

Every sequence shows an intermediate held-out failure after the dense-union task during cycle 1. Cleanup subsequently corrects those transient failures in five of the six task orders. Only AB → CDE → ABCDE retains a residual just above the 0.05 threshold in the two unequal profiles after exhausting all 56 cleanup events.

The 24 permutations measured at each checkpoint are permutations of the stimulated input calls before a single network step. They are useful as a deterministic coverage check, but they do not represent time-separated sequential input processing. The causal factor tested here is the order in which the composition-learning tasks are presented.

## Next validation — cycle-to-cycle schedules

Before considering any production change, the next experiment should compare the problematic fixed sequence, the successful CDE → AB → ABCDE sequence, and schedules that alternate the order of the two pair tasks between learning cycles. This checks whether the safe result is robust to schedule variation rather than relying on one fixed permutation.

No benchmark result in this document changes the live learning rule or user saves.


## Protocol v3 — cleanup budget comparison with new seeds

This experiment tests whether a budget of 40 one-edge corrections is sufficient when using the successful ABCDE → CDE → AB task sequence, and contrasts it with the previously failing AB → CDE → ABCDE sequence.

- New deterministic seeds: 71, 83, 97, 109, 127 (no overlap with prior five-route seeds).
- Budgets: 32, 36, 40, 44, 48 and 56.
- Profiles: equal-medium, ascending and descending.
- Two composition orders, with initial mapping, replay and fresh-association traversal held forward.
- 180 disposable WASM brains total; no per-task diagnostic checkpoints, to keep this budget sweep isolated from the v5/v6 checkpoint cost.
- Each scenario still verifies five positively contributing seeded routes, bounded weights, single-edge trace-consuming cleanup events, fresh association learning and old-map retention after fresh learning.

The acceptance decision is based on the full scenario criteria, not only whether the cleanup stage itself falls below the activation threshold. A low budget that clears cross-talk but damages an expected association or prevents fresh learning is not accepted. The experiment does not alter production learning or user data.
