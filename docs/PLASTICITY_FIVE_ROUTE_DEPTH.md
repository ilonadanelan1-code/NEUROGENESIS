# NEUROGENESIS — five-route selective cleanup-depth stress

## Protocol v1 — measured 2026-11-10

**Topology:** five inputs and six outputs  
**Scenarios:** 90 disposable WASM brains  
**Held-out evaluation:** 26 combinations and 320 stimulation orders  
**Profiles:** equal-medium (2/2/2/2/2), ascending (1/2/3/4/5), descending (5/4/3/2/1)  
**Budgets:** 36, 40 and 44 one-edge cleanup events  
**Production network and user saves:** unchanged

The v1 run completed all 90 scenarios. All scenarios had five seeded routes with five distinct feature indices and positive measured contribution from every route. The original v1 test had a faulty uniqueness assertion (it expected a set size of four instead of five); v2 corrected the assertion. The original artifact remains archived.

| Cleanup budget | Full acceptance | False output above 0.05 |
|---:|---:|---:|
| 36 | 0/30 | 30/30 |
| 40 | 15/30 | 15/30 |
| 44 | 15/30 | 15/30 |

At budgets 40 and 44, all reverse-order scenarios passed and all forward-order scenarios failed. Maximum residual seeded false-output activation declined from 0.05684 to 0.05431.

[Archived v1 workflow and JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42898595074)

## Protocol v2 — measured 2026-11-10

V2 corrected the five-route uniqueness contract and tested budgets 44, 48 and 52. Protocol integrity passed all checks across 90 scenarios: five distinct seeded routes, positive contribution from all five, bounded weights, one-edge corrections, consumed eligibility traces, and full disposal of the WASM brains.

| Cleanup budget | Full acceptance | Correct-weight headroom | Fresh association | Seeded false output above 0.05 |
|---:|---:|---:|---:|---:|
| 44 | 15/30 | 30/30 | 30/30 | 15/30 |
| 48 | 15/30 | 30/30 | 30/30 | 10/30 |
| 52 | 15/30 | 30/30 | 30/30 | 0/30 |

All 15 reverse-order scenarios passed at each budget; all 15 forward-order scenarios remained outside the strict held-out acceptance criterion. At budget 52 the originally seeded false output was fully suppressed in every scenario, but other non-target outputs remained narrowly over the 0.05 threshold in some four-feature held-out combinations. The worst observed non-target activation was 0.05094386. Minimum expected activation in those forward-order cases remained approximately 0.729, all singleton mappings passed, and fresh sixth-feature learning succeeded in all 30 scenarios. Thus the remaining failure is marginal multi-feature interference, not collapse of the desired singleton associations.

[Archived v2 workflow and JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42899477942)

## Protocol v3 — extended final-budget diagnostic

V3 retains the same five-input/six-output topology, 90 scenarios, three route-strength profiles, five deterministic seeds, both training orders, 26 held-out combinations and 320 stimulation orders. It moves the budget window to **52, 54 and 56** and raises the declared diagnostic cap to 60. Budget 52 remains as a comparative baseline; 54 and 56 test whether the small residual held-out interference can be removed without changing the learning rule.

The next design decision depends on this result:
- If 54/56 pass both orders, record the smallest successful budget for this registered topology and then test additional random seeds/topologies before any integration.
- If forward-order interference persists, stop increasing the global budget and inspect the per-route leakage ranking and the point in the training sequence where held-out leakage first appears.

The v3 artifact is `neurogenesis-plasticity-five-route-depth-v3`.

## Acceptance criteria

A scenario passes only when every singleton and held-out combination retains expected activation of at least 0.15 and non-target activation at most 0.05; correct weights remain at or below 0.95; a fresh sixth feature learns the unused sixth output; and old mappings remain correct after that new association.

Protocol integrity is separate from scientific acceptance. It requires all 90 profile/budget/seed/order scenarios, five distinct seeded routes, positive contribution from every route, one-edge corrections within budget, consumed eligibility traces, finite bounded weights and disposal of every WASM brain.

## Interpretation boundary

This is a controlled supervised benchmark over one registered five-input/six-output topology. It does not demonstrate unsupervised or general-purpose learning, autonomous intelligence, or readiness to replace the production JavaScript network. No benchmark result modifies the live app or user saves.
