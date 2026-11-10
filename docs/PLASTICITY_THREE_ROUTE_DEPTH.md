# NEUROGENESIS — three-route cleanup-depth diagnostic

**Protocol:** version 2  
**Question:** how much bounded-negative cleanup is needed for three strong competing routes?  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged

## 1. Fixed conditions

This diagnostic reuses the three-route equal-medium stress fixture: three feature inputs (F1, F2, F3) are strengthened toward the same unused false output, with two positive seeding episodes per route at rate 1.0. Five deterministic seeds (7, 17, 29, 43, 59) are tested in forward and reverse task orders.

The first comparison (protocol v1, run #527) tested total selective-cleanup budgets 2, 3, 6, and 9. All 40 scenarios were technically valid, but none met full retention criteria. The current v2 comparison extends the diagnostic to budgets 18, 21, and 24 to test whether deeper repeated reductions can remove the false response. The replay remains one sweep at positive rate 0.02 and negative rate 1.0. Each cleanup episode remains zero-positive / full-negative at rate 1.0. Target, non-target, and headroom limits remain 0.15, 0.05, and 0.95 respectively.

The benchmark-only cleanup helper's safe diagnostic ceiling is 24 so the largest registered v2 comparison can be measured. This does not change the application or production learning rule.

## 2. Measurements

The report records each selected feature-to-false-output edge, repeated corrections per route, route weights and isolated activation contributions after cleanup, held-out retention, headroom, fresh association, and old-map survival. Protocol correctness is separate from scientific success, so the experiment remains archived even if none of the tested budgets satisfies full acceptance.

## 3. Verified results — protocol v1, GitHub Actions run #527

The 40-scenario first comparison completed successfully on commit d49638acc00ee5dde518672c52fd452cbce10947. The full report was archived as neurogenesis-plasticity-three-route-depth-v1.

| Total correction budget | Full acceptance | Scenarios with false output still above 0.05 | Mean final false-output activation | Final route weights |
|---:|---:|---:|---:|---:|
| 2 | 0/10 | 10/10 | 1.0000 | 0.380663–0.674601 |
| 3 | 0/10 | 10/10 | 1.0000 | 0.380663 |
| 6 | 0/10 | 10/10 | 0.6514 | 0.217144 |
| 9 | 0/10 | 10/10 | 0.3716 | 0.123867 |

Across every budget, headroom and fresh fifth-feature learning passed 10/10, but old-map retention after fresh learning passed 0/10. At budget 2, the cleanup algorithm selected two unique seeded routes. At budget 3, it selected all three once. At budgets 6 and 9 it revisited all three routes uniformly, with 2 and 3 corrections per route respectively. All 40 brains were disposed; all weights remained finite and bounded. The diagnostic protocol passed in full; the candidate policy did not.

The corrected response is linear over the three strong routes in this fixture: at nine total corrections the three remaining route weights were each 0.123867, producing a combined false response of 0.371602. This is why the original two-episode policy cannot solve this particular high-strength conflict.

## 4. Verified results — protocol v2, GitHub Actions run #528

The 30-scenario v2 protocol completed successfully with all C++/WASM, previous benchmark, and regression checks passing. Its report was uploaded as neurogenesis-plasticity-three-route-depth-v2.

| Total correction budget | Full acceptance | Scenarios above 0.05 | Mean corrections used | Final false-output activation |
|---:|---:|---:|---:|---:|
| 18 | 0/10 | 10/10 | 18 | 0.06897666 |
| 21 | 5/10 | 0/10 | 20.5 | 0 |
| 24 | 10/10 | 0/10 | 21 | 0 |

At budget 21, all five reverse-order cases passed using 20 corrections; all five forward-order cases stopped at 21 and failed the final old-map-retention check. At budget 24, each forward-order case required 22 updates and each reverse-order case stopped at 20, so all ten passed. In all passing cases the three false-route weights were below the fixed 0.05 limit and the original mappings remained intact after fresh-feature learning. Every scenario retained headroom, passed fifth-feature learning, bounded all weights, and disposed its WASM brain.

The protocol itself passed all 30 scenarios. The combined report's candidate flag remains false because the deliberately insufficient 18- and 21-budget controls are included; the 24-budget candidate passed 10/10.

## 5. Verified results — profile generalization pending

The next comparison tests budgets 22 and 24 on all three pre-registered weight profiles (equal, ascending, descending), with the same five seeds and both task orders: 60 fresh disposable WASM brains. Its purpose is to see whether the observed 22-correction forward / 20-correction reverse requirement generalizes beyond equal-strength routes. No production budget is changed.

## 6. Interpretation boundary

A higher budget is not being adopted merely because it may pass this fixture. The comparison is diagnostic evidence to identify the repeated-update depth required for this deliberately strong conflict. Any future policy change must also pass mixed-strength and unseen multi-route conditions before any disposable shadow-network proposal.
