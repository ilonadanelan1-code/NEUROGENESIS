# NEUROGENESIS — five-route selective cleanup-depth stress

## Protocol v1 — measured 2026-11-10

**Topology:** five inputs and six outputs  
**Scenarios:** 90 disposable WASM brains  
**Held-out evaluation:** 26 combinations and 320 stimulation orders  
**Profiles:** equal-medium (2/2/2/2/2), ascending (1/2/3/4/5), descending (5/4/3/2/1)  
**Budgets:** 36, 40 and 44 one-edge cleanup events  
**Production network and user saves:** unchanged

### 1. Measured result

The v1 experiment completed all 90 scenarios and produced a JSON artifact. All 90 scenarios had five seeded routes with five distinct feature indices, all five routes made a positive measured contribution to the same unused output, all weights remained bounded, each correction changed exactly one edge and consumed eligibility traces, and all disposable brains were released.

The first CI assertion incorrectly required the set of five route indices to have size four. The artifact confirms the actual route-index set had size five in every scenario. This was a test-contract typo, not a malformed scenario. The v2 test corrects it. The original v1 artifact remains archived separately.

| Cleanup budget | Full acceptance | Old-map retention | Fresh association | False output above 0.05 |
|---:|---:|---:|---:|---:|
| 36 | 0/30 | 0/30 | 30/30 | 30/30 |
| 40 | 15/30 | 15/30 | 30/30 | 15/30 |
| 44 | 15/30 | 15/30 | 30/30 | 15/30 |

For budget 36, mean final false-output activation was 0.06235 (maximum 0.06355). At budgets 40 and 44, the reverse-order scenarios all passed, while all forward-order scenarios remained above the false-output threshold. The maximum residual activation fell from 0.05684 at budget 40 to 0.05431 at budget 44, but the number of passing scenarios did not improve.

The strongest diagnostic observation is task-order sensitivity: the same profile/seed set passes in reverse order at 40/44 but fails in forward order. This suggests that merely increasing the global cleanup budget is not yet sufficient. The next step must test whether a larger budget resolves the forward-order cases, and then inspect route selection if it does not.

[Archived v1 workflow and measured JSON artifact](https://github.com/ilonadanelan1-code/NEUROGENESIS/actions/runs/42898595074)

## Protocol v2 — extended cleanup budgets

The v2 run preserves the five-input/six-output topology, five route-strength profiles, five deterministic seeds, both task orders, all 26 held-out combinations and all 320 stimulation orders. It uses budgets **44, 48 and 52** with a maximum diagnostic cap of 56. This retains budget 44 as the directly comparable baseline while extending the correction window.

Candidate acceptance is reported per budget and profile. The protocol check and scientific acceptance remain separate: CI should fail for an invalid experiment, not merely because a candidate budget fails to suppress interference. The machine-readable artifact is `neurogenesis-plasticity-five-route-depth-v2`.

## 2. Acceptance criteria

A scenario passes only when:
- Every singleton and held-out combination retains expected activation of at least 0.15 and non-target activation at most 0.05.
- All correct weights remain at or below 0.95, with finite weights in [0, 1].
- A fresh sixth feature learns the unused sixth output.
- All old mappings remain correct after the fresh association is learned.

Protocol integrity separately requires all 90 profile/budget/seed/order scenarios, five distinct seeded routes, positive measured contribution from every route, in-budget one-edge corrections, consumed eligibility traces, and disposal of every WASM brain.

## 3. Interpretation boundary

This is a controlled supervised benchmark over one registered five-input/six-output topology. It does not demonstrate unsupervised or general-purpose learning, autonomous intelligence, or readiness to replace the production JavaScript network. No benchmark result modifies the live app or user saves.
