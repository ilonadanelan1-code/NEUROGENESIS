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

## 3. Verified results

Pending first GitHub Actions run. The machine-readable artifact is published as neurogenesis-plasticity-three-route-profile-depth-v1.

## 4. Interpretation boundary

Passing this test would support only the registered three-route profiles and seeds. It would not justify integrating the mechanism into the production JavaScript network or using the tested budget as a general learning policy. Further unseen topologies and mixed-strength cases would remain necessary.
