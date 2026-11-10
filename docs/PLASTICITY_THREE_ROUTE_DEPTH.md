# NEUROGENESIS — three-route cleanup-depth diagnostic

**Protocol:** version 1  
**Question:** how much bounded-negative cleanup is needed for three strong competing routes?  
**Runtime:** disposable C++/WebAssembly brains only  
**Production JavaScript network:** unchanged

## 1. Fixed conditions

This diagnostic reuses the three-route equal-medium stress fixture: three feature inputs (F1, F2, F3) are strengthened toward the same unused false output, with two positive seeding episodes per route at rate 1.0. Five deterministic seeds (7, 17, 29, 43, 59) are tested in forward and reverse task orders.

The only variable is the total selective-cleanup episode budget: 2, 3, 6, or 9. The replay remains one sweep at positive rate 0.02 and negative rate 1.0. Each cleanup episode remains zero-positive / full-negative at rate 1.0. Target, non-target, and headroom limits remain 0.15, 0.05, and 0.95 respectively.

The benchmark-only cleanup helper's safe diagnostic ceiling is extended to 12 so the fixed nine-episode comparison can be measured. This does not change the application or production learning rule.

## 2. Measurements

The report records each selected feature-to-false-output edge, repeated corrections per route, route weights and isolated activation contributions after cleanup, held-out retention, headroom, fresh association, and old-map survival. Protocol correctness is separate from scientific success, so the experiment remains archived even if none of the tested budgets satisfies full acceptance.

## 3. Verified results

Pending first GitHub Actions run. The machine-readable artifact is published as neurogenesis-plasticity-three-route-depth-v1.

## 4. Interpretation boundary

A larger episode budget is not being adopted. The comparison is diagnostic evidence to identify how many updates the deliberately strong three-route conflict requires. Any future policy change must be assessed separately on mixed-strength and unseen multi-route conditions before any disposable shadow-network proposal.
