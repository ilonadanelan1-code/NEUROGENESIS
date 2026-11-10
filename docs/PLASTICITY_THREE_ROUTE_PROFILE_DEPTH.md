# NEUROGENESIS — three-route profile depth generalization

**Protocol:** version 1  
**Question:** does a 22-episode cleanup cap generalize to mixed-strength competing routes?  
**Runtime:** disposable C++/WebAssembly brains only  
**Production network and user saves:** unchanged

## 1. Fixed comparison

Three pre-registered route-strength profiles are used: equal-medium (2/2/2 positive seeding episodes), ascending (1/2/3), and descending (3/2/1). Each has five seeds (7, 17, 29, 43, 59) and both forward and reverse task orders.

The only variables are the two fixed total cleanup budgets, 22 and 24. The replay remains one sweep at positive rate 0.02 and negative rate 1.0. Cleanup remains zero-positive / full-negative at rate 1.0. Activation limits remain 0.15 expected and 0.05 non-target; the correct-weight ceiling remains 0.95.

This creates 60 independent WASM brains. Every scenario must begin with three independently measured positive input-route contributions to one unused false output. All corrections are checked for exactly one changed edge and consumed eligibility traces.

## 2. Outcome reporting

Protocol validity and scientific acceptance are separate. The test requires all 60 cases, all profiles/budgets/seeds/orders, bounded weights, single-edge updates, and disposal of all brains. It records acceptance separately for each profile and budget. A valid negative result is archived rather than converted into a CI failure.

## 3. Verified results — GitHub Actions run #529

The protocol completed successfully across 60 independent WASM brains. Both registered budgets passed every scenario:

| Route profile | Budget 22 | Budget 24 | Mean corrections used | Maximum used |
|---|---:|---:|---:|---:|
| Equal-medium (2/2/2) | 10/10 | 10/10 | 21 | 22 |
| Ascending (1/2/3) | 10/10 | 10/10 | 21 | 22 |
| Descending (3/2/1) | 10/10 | 10/10 | 21 | 22 |

All 30 scenarios at each budget passed retention, headroom, fresh fifth-feature learning, and old-map retention after fresh learning. No false output remained above 0.05; the maximum measured false-output activation was 0. Every correction changed exactly one edge, consumed eligibility traces, and every brain was disposed.

The combined workload used 630 cleanup episodes per budget across 30 scenarios (mean 21; maximum 22 per brain). Budget 24 did not cause extra updates because cleanup stopped automatically as soon as the acceptance criteria passed. The full machine-readable report is archived as neurogenesis-plasticity-three-route-profile-depth-v1.

## 4. Interpretation and next step

A maximum budget of 22 passed the registered three-route equal, ascending, and descending strength profiles. This is evidence for this fixed four-feature/five-output task, not a general learning guarantee. The next stress test increases the number of competing inputs to four routes converging on the same unused output, with fixed budgets 28, 32, and 36. No production learning rule is being changed.

## 5. Interpretation boundary

Passing this test supports only the registered three-route profiles and seeds. It does not justify integrating the mechanism into the production JavaScript network or using the tested budget as a general learning policy. Additional topologies remain necessary.
