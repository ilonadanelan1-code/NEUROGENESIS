# NEUROGENESIS — five-route selective cleanup-depth stress

## Protocol v1 — measured 2026-11-10

**Topology:** five inputs and six outputs  
**Scenarios:** 90 disposable WASM brains  
**Held-out evaluation:** 26 combinations and 320 stimulation orders  
**Profiles:** equal-medium (2/2/2/2/2), ascending (1/2/3/4/5), descending (5/4/3/2/1)  
**Budgets:** 36, 40 and 44 one-edge cleanup events  
**Production network and user saves:** unchanged

The v1 run completed all 90 scenarios. The initial test had an incorrect uniqueness assertion (four instead of five distinct route indices); v2 corrected it. The original artifact remains archived.

| Budget | Full acceptance | Seeded false output above 0.05 |
|---:|---:|---:|
| 36 | 0/30 | 30/30 |
| 40 | 15/30 | 15/30 |
| 44 | 15/30 | 15/30 |

At budgets 40 and 44, reverse-order scenarios passed while forward-order scenarios failed. Maximum residual seeded false-output activation declined from 0.05684 to 0.05431.

## Protocol v2 — measured 2026-11-10

V2 corrected the five-route uniqueness contract and tested budgets 44, 48 and 52. Protocol integrity passed all 90 scenarios.

| Budget | Full acceptance | Seeded false output above 0.05 |
|---:|---:|---:|
| 44 | 15/30 | 15/30 |
| 48 | 15/30 | 10/30 |
| 52 | 15/30 | 0/30 |

At 52, the initially seeded false output was suppressed in every scenario, but another non-target output remained narrowly above 0.05 in some held-out combinations of the forward-order non-uniform profiles. Correct single-feature mappings and fresh association learning remained intact.

## Protocol v3 — measured 2026-11-10

V3 tested budgets 52, 54 and 56 across 90 scenarios.

| Budget | Full acceptance | All seeded false outputs suppressed |
|---:|---:|---:|
| 52 | 15/30 | 30/30 |
| 54 | 15/30 | 30/30 |
| 56 | 20/30 | 30/30 |

At budget 56, the equal-medium profile passed 10/10 scenarios, while ascending and descending profiles each passed 5/10. This indicates that the strength distribution among competing routes still affects held-out generalization even after the deliberately seeded false output is removed.

[Archived v3 workflow and JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42900381549)

## Protocol v4 — residual-output attribution

V4 repeats the v3 budgets and topology, and extends each held-out pattern report with:
- The name of the strongest non-target output.
- Its measured activation.
- The exact input presentation order that produced that activation.
- Its order spread across permutations.

The top-level report also lists each failed held-out pattern with profile, budget, seed and training order. No learning rule, learning rate, cleanup ranking, topology or production code path changes in this diagnostic pass. The purpose is to identify the precise residual competitor before designing a new correction strategy.

The machine-readable artifact is `neurogenesis-plasticity-five-route-depth-v4`.

## Protocol v5 — independent order isolation

V5 independently varied initial mapping traversal, composition-task sequence and replay traversal in a full 2×2×2 design. The result isolated composition-task order as the decisive factor: all 60 reverse-composition scenarios passed full acceptance, while only 20 of 60 forward-composition scenarios passed. See [the order-isolation protocol](PLASTICITY_ORDER_ISOLATION.md) for the profile breakdown and measured checkpoints.

## Protocol v6 — all composition permutations

V6 tests all six permutations of the three composition tasks to identify the specific ordering constraint, while holding the other learning and replay traversals fixed.

## Acceptance and integrity boundaries

A scenario passes only when expected activation is at least 0.15, non-target activation is at most 0.05, correct weights remain at or below 0.95, a fresh sixth feature learns the spare output, and old mappings remain correct after that new association.

Protocol integrity is checked separately: all 90 scenarios complete, five distinct routes contribute positively, each cleanup event changes exactly one edge and consumes its eligibility traces, weights remain finite and bounded, and every disposable WASM brain is released.

This is a controlled supervised benchmark over one registered five-input/six-output topology. It does not demonstrate general-purpose learning, autonomous intelligence or readiness to replace the production JavaScript network. User saves and the live network are not modified.
