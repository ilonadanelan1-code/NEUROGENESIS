# Plasticity headroom: asymmetric replay benchmark

## Purpose

The stage-three retention benchmark showed a trade-off: rehearsal protected previously learned feature routes, but repeated symmetric positive/negative updates pushed correct weights to the upper bound. This benchmark tests whether independent potentiation and depression rates can preserve old mappings while leaving enough numerical room for further learning.

The experiment runs only in disposable WebAssembly brains. It does not read or write the user's saved network, browser memory, or production JavaScript weights.

## Hypothesis

When the replay task is already known, a smaller positive learning rate and a larger negative learning rate may reduce cross-route interference without forcing correct weights to 1.0.

The tested asymmetric rates are fixed in advance:

- positive route: 0.05
- competing route: 0.25

The benchmark compares these with two symmetric controls:

| Mode | Positive rate | Negative rate | Replay sweeps after each composition |
|---|---:|---:|---:|
| Symmetric high | 0.25 | 0.25 | 3 |
| Symmetric low | 0.05 | 0.05 | 1 |
| Asymmetric | 0.05 | 0.25 | 1 |

The positive/negative rates are applied to selected eligibility traces for one specified input, one correct output, and one competing output. This is an address-specific supervised update, not unsupervised learning and not a general inhibitory neuron mechanism.

## Fixed protocol

Each scenario begins with four sensory features, five output neurons, and a complete bipartite feature-to-output graph. Initial weights are 0.005. A seeded permutation chooses four distinct correct output mappings and leaves one output unused.

The initial primitive map is trained identically for all modes using the legacy symmetric rate 0.25. Each feature receives one positive update against each of the four competing outputs. The initial state must pass the established response criteria before any retention stress is applied.

After initial training, the benchmark performs three cycles. Every cycle contains these three consistent composition tasks:

1. Features A+B jointly cue their two mapped outputs.
2. Features C+D jointly cue their two mapped outputs.
3. All four features jointly cue all four mapped outputs.

Composition episodes use the existing delayed positive reward at rate 0.25. After each composition task, the selected mode performs its declared number of singleton-replay sweeps. One replay sweep rehearses all four primitive features against all four non-target outputs, one pair at a time.

Each mode is evaluated with two seeds (101 and 211) and both forward and reverse task orders: 12 independent scenarios in total.

## Evaluation and thresholds

A response is correct only when all mapped target outputs activate to at least 0.15 and every non-target output remains at or below 0.05. All 11 non-singleton combinations of the four original features are held out, and all 60 stimulation permutations are tested. The maximum response spread across stimulation orders must not exceed 1e-6.

Weight headroom is measured immediately after retention training and before adding the new feature:

- all weights must remain finite and within [0, 1];
- the maximum correct primitive weight must be at most 0.95;
- no correct primitive weight may reach 0.98;
- the mean unused headroom is reported as the mean of (1 - correct weight).

The benchmark then adds a fifth sensory feature and connects it to all five outputs. The previously unused output is assigned as its new target. The same strategy's rates train this association for three complete sweeps against the other four outputs (12 episodes). The new route must activate to at least 0.15, its non-target outputs must remain at or below 0.05, and all 11 old held-out combinations must still pass afterwards.

A scenario passes the asymmetric target only when old mappings survive, the pre-fresh weight headroom criterion is met, the fresh fifth association is learned, and old mappings still pass after that new association.

## Controls and interpretation

The two symmetric strategies are comparison controls. Their outcomes are reported; the benchmark does not assume in advance which exact threshold each one will fail. The target criterion applies to all four asymmetric seed/order scenarios.

A passing result would support a narrow statement: in this controlled, known-label feature-to-output task, asymmetric replay retained measured route unions and left bounded weight headroom while learning one additional feature mapping. It would not establish relational reasoning, arbitrary compositional generalization, autonomy, language understanding, or general intelligence.

The experiment deliberately does not include the previous contradictory-label task. A task that assigns an already-used feature combination to an incompatible output is a conflict/interference stress test, not a valid composition target; it must be reported separately from ordinary retention.

## Resource and isolation guarantees

Every mode/seed/order combination creates a new WASM brain. The test wrapper counts creation and disposal and requires all 12 brains to be destroyed. No brain is attached to the live application network. The benchmark does not call persistence or import/export functions.

## Status

This document defines the preregistered protocol and pass criteria. Measured outcomes are pending the GitHub Actions run for the experimental branch. No efficacy claim should be made until the native C++ tests, C ABI checks, real WASM adapter tests, parity tests, and this benchmark all pass.
