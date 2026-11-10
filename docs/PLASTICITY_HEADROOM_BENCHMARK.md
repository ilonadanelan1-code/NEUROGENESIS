# Plasticity headroom: bounded asymmetric reward benchmark

## Why this second protocol exists

The first CI-run protocol was deliberately not accepted: all four asymmetric scenarios retained the old mappings and learned a new fifth-feature mapping, but every correct primitive weight saturated at 1.0. The logs showed that the positive-only composition update still used the legacy additive rule. Asymmetric depression reduced the maximum competing weight to approximately 0.004–0.009, but it could not restore headroom already consumed by positive reinforcement.

The second protocol tests a different hypothesis. The experimental update must account for the available weight range itself, while the legacy APIs remain unchanged for production compatibility and historical comparisons.

This experiment runs only in disposable WebAssembly brains. It does not read or write saved application networks, browser memory, or production JavaScript weights.

## Update rules

Two new shadow-only rules are added:

- **Homeostatic delayed reward:** for positive reward, the increment is scaled by the remaining headroom; for negative reward, weakening is scaled by the current weight.
- **Bounded asymmetric contrastive reward:** the selected positive route uses its independent positive rate multiplied by (1 - weight); the selected competing route uses its independent negative rate multiplied by the current weight.

For a valid trace e and weight w:

- positive: Δw = η₊ · e · (1 − w)
- negative: Δw = −η₋ · e · w

For the general homeostatic reward update, the signed reward r is included in the same rule and positive/negative scale is selected by its sign. All updates still clamp weights to [0, 1] and consume eligibility traces after valid events.

The old additive methods learn_from_reward and learn_contrastive_reward retain their previous behavior. The new methods have separate C++, C ABI, WebAssembly and JavaScript adapter entry points. Equal positive and negative rates in the new bounded method are **not** expected to reproduce the old additive method; the native tests check backward compatibility separately.

## Version 2 fixed protocol

Each scenario begins with four sensory features, five output neurons and a complete bipartite feature-to-output graph. Initial weights are 0.005. A seeded permutation selects four distinct correct mappings and leaves one output unused.

The initial primitive map is trained identically using the legacy symmetric additive rate 0.25. Each feature receives one positive update against each of the four competing outputs.

After initial training, three cycles run these composition cues:

1. Features A+B jointly cue their two mapped outputs.
2. Features C+D jointly cue their two mapped outputs.
3. All four features jointly cue their four mapped outputs.

Composition events use the new homeostatic delayed reward at rate 0.05 in every mode. This ensures the comparison does not let the shared positive-only composition step silently consume all weight headroom using additive updates.

Four replay modes are compared:

| Mode | Update rule | Positive rate | Negative rate | Replay sweeps per composition |
|---|---|---:|---:|---:|
| Symmetric high | Legacy additive | 0.25 | 0.25 | 3 |
| Symmetric low | Legacy additive | 0.05 | 0.05 | 1 |
| Bounded symmetric | Headroom-scaled | 0.02 | 0.02 | 2 |
| Bounded asymmetric | Headroom-scaled | 0.02 | 0.35 | 2 |

Each replay sweep rehearses each primitive feature against every non-target output. The bounded symmetric control separates the effect of headroom scaling from the effect of asymmetric positive/negative rates.

Each mode runs with seeds 101 and 211 and both forward and reverse task orders: 16 independent scenarios.

## Evaluation thresholds

A response is correct only when every mapped target output activates to at least 0.15 and every non-target output stays at or below 0.05. All 11 non-singleton combinations of the original four features are held out; all 60 stimulation permutations are tested. Maximum response spread across stimulation orders must not exceed 1e-6.

Weight headroom is measured after the three retention cycles but before adding the fifth feature:

- all weights must be finite and within [0, 1];
- the maximum correct primitive weight must be at most 0.95;
- no correct primitive weight may reach 0.98;
- average unused headroom is reported as the mean of (1 - correct weight).

The benchmark then adds a fifth sensory feature, connects it to all five outputs, and assigns the unused output as its target. The strategy's own update rule and rates train this association for eight complete sweeps (32 positive/negative episodes). The new target must activate to at least 0.15; all non-target outputs must remain at or below 0.05; and all 11 old held-out combinations must still pass afterwards.

A bounded-asymmetric scenario passes only if it retains old mappings, meets the headroom threshold, learns the new fifth-feature association, and preserves old mappings after that new learning.

## Controls and interpretation

The benchmark reports the retention, headroom and fresh-learning outcomes for all controls. The strict target applies to all four bounded-asymmetric seed/order scenarios. It does not assume that a method passes before the results exist.

A passing result would support only a narrow statement: in this controlled known-label feature-to-output experiment, a bounded asymmetric supervised update retained the tested route unions, preserved numerical room in correct links, and learned one additional feature mapping. It would not establish relational reasoning, arbitrary compositional generalization, autonomy, language understanding, or general intelligence.

The previous contradictory-label task remains a separate conflict/interference stress test. It is not mixed into ordinary positive retention because it deliberately asks the model to assign incompatible labels to the same combination.

## Isolation and resource guarantees

Every mode/seed/order case creates a fresh WASM brain. The test wrapper counts all 16 creations and requires all 16 to be disposed. No brain attaches to the live application network. The benchmark does not invoke persistence or import/export.

## Status

Protocol version 2 follows the observed version-1 failure rather than hiding it. Results are pending the next GitHub Actions run. Do not claim success until native C++ tests, C ABI tests, real WASM adapter tests, float32 parity tests, all existing regressions and every benchmark assertion pass.
