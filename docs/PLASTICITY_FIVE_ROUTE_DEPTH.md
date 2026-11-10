# NEUROGENESIS — five-route selective cleanup-depth stress

**Protocol:** version 1  
**Question:** does selective cleanup remain effective when five input routes reinforce the same unused output?  
**Runtime:** disposable C++/WebAssembly brains only  
**Production network, localStorage and user saves:** unchanged

## 1. Registered topology

The experiment uses five sensory inputs and six output neurons. Five input/output mappings are trained first, leaving one output unused. The stress phase then strengthens five distinct input-to-unused-output edges. The false output must receive a positive, independently measured contribution from every seeded input before cleanup.

After ordinary retention training, all held-out input combinations containing two through five features are evaluated: 26 combinations and 320 stimulation-order permutations. The same expected-output floor (0.15), non-target ceiling (0.05), and correct-weight headroom ceiling (0.95) used by the earlier four-route experiment are retained.

## 2. Fixed profiles and budgets

Three pre-registered route-strength profiles are compared:

| Profile | Positive seeding episodes per route |
|---|---|
| Equal-medium | 2 / 2 / 2 / 2 / 2 |
| Ascending | 1 / 2 / 3 / 4 / 5 |
| Descending | 5 / 4 / 3 / 2 / 1 |

Each profile uses five fixed seeds (7, 17, 29, 43, 59), forward and reverse task orders, and cleanup budgets of 36, 40, and 44 episodes. This creates 90 independent disposable WASM brains.

Replay remains one sweep with positive rate 0.02 and negative rate 1.0. Selective cleanup uses zero positive rate and negative rate 1.0. The five-feature task set consists of AB, CDE, and ABCDE compositions across three cycles.

## 3. Acceptance and protocol validity

Candidate acceptance is reported independently for each route profile and budget. A candidate passes only when it preserves all singleton and held-out mappings, remains within the activation and weight limits, learns a fresh sixth feature using the spare output, and preserves the original mappings after that new learning.

The protocol is technically valid only when all 90 profile/budget/seed/order scenarios complete, all five seeded routes contribute positively, every cleanup update changes exactly one selected edge and consumes eligibility traces, all weights remain finite and bounded, and every disposable brain is released. A scientifically unsuccessful budget is archived as a measured result rather than treated as an invalid protocol.

## 4. Isolation and interpretation boundary

No benchmark result changes the production JavaScript network, the shadow runtime used by the app, localStorage, or user saves. The fixed fixture tests only this five-input/six-output topology and its registered seeds and profiles. Passing it would be evidence for this bounded stress task—not a general learning guarantee, autonomous learning, or evidence of general intelligence.

## 5. Verified results

Pending the first successful GitHub Actions run. The machine-readable artifact is published as `neurogenesis-plasticity-five-route-depth-v1`.

## 6. Relation to the four-route result

The preceding four-route experiment tested 90 independent brains. All 30 scenarios at budget 28 remained slightly above the 0.05 non-target ceiling (maximum 0.05330864). All 30 scenarios at budget 32 passed, and budget 36 produced no additional corrections. The five-route protocol raises the number of simultaneous seeded contributors and increases the registered cleanup budgets; it does not change the acceptance thresholds.
