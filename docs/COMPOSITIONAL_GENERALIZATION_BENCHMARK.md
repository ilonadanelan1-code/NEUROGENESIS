# NEUROGENESIS — four-feature zero-shot superposition benchmark

**Stage:** 2 of 3 — compositional generalization baseline  
**Baseline:** main commit f321002eae98c703a35331191418aa86a0fe17b4, version 0.58.37  
**Runtime:** disposable C++/WASM shadow brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** not loaded or modified

## 1. Claim being tested

This experiment tests a narrow capability: after learning four independent
feature-to-output routes from singleton examples, can the network activate
the correct set of outputs when two, three, or four known features are
stimulated together for the first time?

The result is called **zero-shot feature-route superposition**. It is not
conjunction learning, relational composition, role binding, variable binding,
rule induction, or general intelligence. The output set is the union of
independently learned feature routes.

The audit established that the existing core already accepts several
stimulate(neuronId, strength) calls before one synchronous step(). A separate
feature-vector API was therefore unnecessary. The benchmark uses the existing
C++ core through the WASM adapter; it adds no JS lookup layer and no new core
or C ABI behavior.

## 2. Fixed architecture and topology

Each disposable brain contains:

- Four sensory input neurons: A, B, C, D.
- Five output neurons: X, Y, Z, W, V. V is a distractor output.
- A complete 4×5 bipartite graph: 20 directed input-to-output synapses.
- No hidden neurons, composite neurons, pair IDs, triple IDs, or
  combination-specific edges.

All 20 edges start at weight 0.005. With all four features active, the maximum
untrained incoming sum to any output is 4 × 0.005 = 0.02, below the core's
0.05 activation cutoff. This bound prevents the untrained baseline from
passing merely because small cross-path signals accumulate.

The canonical primitive mapping is A→X, B→Y, C→Z, D→W. The decoy V is not a
canonical target.

## 3. Pre-registered train / held-out split

### Training set

Only four singleton input patterns are trained:

- [A] → X
- [B] → Y
- [C] → Z
- [D] → W

For each feature, four contrastive episodes are run: its positive output is
reinforced against each of the other four output neurons in turn. This gives
16 episodes per scenario. Each episode presents exactly one input feature,
one positive output, and one negative output. No pair, triple, or four-feature
input is presented during training.

Two training orders are tested:

1. A→B→C→D, with negative outputs in ascending order.
2. D→C→B→A, with negative outputs in descending order.

### Held-out set

All combinations of size two or greater are held out:

- Pairs: AB, AC, AD, BC, BD, CD.
- Triples: ABC, ABD, ACD, BCD.
- Four-feature set: ABCD.

That is 11 combinations. They are never used for training, reward delivery,
parameter selection, or threshold tuning.

Every permutation of the feature-stimulation order is evaluated. This gives
12 pair permutations, 24 triple permutations, and 24 four-feature
permutations: 60 held-out presentations per training order.

## 4. Learning protocol

For each singleton training episode:

1. Settle the disposable brain and clear old eligibility traces.
2. Stimulate one input feature, its positive output, and one selected negative
   output.
3. Run one 0.1-second step with eligibility retention 0.9.
4. Run 12 fade steps of 0.25 seconds with retention 0.9.
5. Confirm all neuron activations have faded to zero while the selected
   positive and negative edge traces remain non-zero.
6. Apply the existing learnContrastiveReward() update at rate 0.25.
7. Confirm the positive edge increased, the selected negative edge decreased,
   exactly two weights changed, unrelated traces were clear, and all traces
   were consumed.

The four negative outputs are each selected once per feature. The positive
route is reinforced in all four episodes for that feature. This deliberately
uses the existing contrastive learning API; it does not add a new training
rule.

## 5. Inference protocol

For each held-out combination:

1. Settle the network and clear traces.
2. Stimulate only the input feature neurons, one call per feature.
3. Apply one synchronous core step.
4. Read all five output activations.
5. Do not call any learning, reward, weight-setting, or trace-update API.
6. Settle before the next trial.

The benchmark snapshots all weights before and after held-out evaluation and
requires them to remain unchanged. Target outputs are derived from the
singleton mapping; no held-out answer is passed to the network.

## 6. Fixed acceptance criteria

The criteria are constants in compositional-benchmark.js and are not selected
after observing held-out results:

| Metric | Required result |
| --- | ---: |
| Minimum activation of every expected output | ≥ 0.15 |
| Maximum activation of every non-target output | ≤ 0.05 |
| Maximum response spread across stimulation permutations | ≤ 0.000001 |
| Held-out combinations passing | 11 of 11 |
| Held-out permutations passing per training order | 60 of 60 |
| Primitive singleton mappings retained after held-out tests | 4 of 4 |
| Weight changes during held-out inference | 0 |
| Positive/negative contrastive episodes valid | 16 of 16 per scenario |
| Weights | finite and within [0, 1] |

Both forward and reverse training orders must pass every criterion.

## 7. Controls against false positives

### Untrained baseline

A fresh brain with the same topology and initial weights is evaluated on all
held-out combinations and stimulation permutations without training. It must
keep every output at or below 0.05 and must not reach the target threshold.
This confirms the benchmark is not passed by the initial graph alone.

### Permuted-mapping control

A separate fresh brain is trained on a deliberately different singleton map:
A→Y, B→Z, C→W, D→V. It must follow this learned mapping on all held-out
combinations and differ from the canonical output set. This guards against a
hard-coded A→X/B→Y/C→Z/D→W answer path.

### Structural leakage checks

The test asserts exactly nine neurons and 20 synapses, one presented input
feature per training episode, no combination-specific nodes or edges, and no
weight changes during held-out inference. All four brains are independently
created and disposed.

## 8. Determinism

No random number generator is used, so a random seed is not applicable
(seed=null). Feature order, mapping permutations, combination enumeration,
training order, and stimulation permutations are fixed and exhaustive. The
same runtime and constants must produce the same report.

## 9. Measured results

Measured by the required GitHub Actions PR run #42743368055 on commit
a279af1d18c62bcd7920e793767ba80d7b3f4a59. The benchmark's own assertions
passed, not merely the surrounding CI job.

| Metric | Forward order | Reverse order | Required |
| --- | ---: | ---: | ---: |
| Held-out combinations passed | 11/11 | 11/11 | 11/11 |
| Held-out stimulation permutations passed | 60/60 | 60/60 | 60/60 |
| Minimum expected-output activation | 0.4345625638961792 | 0.4345625638961792 | ≥ 0.15 |
| Maximum non-target activation | 0 | 0 | ≤ 0.05 |
| Maximum stimulation-order spread | 0 | 0 | ≤ 0.000001 |
| Primitive singleton mappings retained | 4/4 | 4/4 | 4/4 |
| Weight changes during held-out inference | 0 | 0 | 0 |

Controls also passed:

- Untrained baseline: maximum output activation 0 across all 11 held-out
  combinations and 60 permutations; no expected output reached 0.15.
- Permuted mapping: the independent brain followed A→Y, B→Z, C→W, D→V
  and differed from the canonical mapping on all held-out sets.
- Training: 16 delayed contrastive episodes per scenario; positive and
  negative traces were present after activation faded, exactly two selected
  weights changed per episode, and all traces were consumed.
- Lifecycle: the test created four independent brains (forward, reverse,
  untrained, permuted) and confirmed all four were disposed.

The observed minimum expected activation exceeded the pre-registered 0.15
threshold by about 0.2846. The measured non-target response and stimulation
order spread were both exactly zero in this deterministic WASM run.

This is a successful result for the narrow feature-route superposition task
only. It does not upgrade the claim to conjunction learning, relational
composition, role binding, or general reasoning.

## 10. Interpretation and limitations

A pass demonstrates that the current graph implementation can combine
independently trained direct feature routes when multiple known inputs are
active simultaneously. It demonstrates a small form of zero-shot set-union
transfer beyond the four singleton training examples.

It does not demonstrate learning a new joint relationship. The graph is
fully connected before training, output identities are supervised during
singleton episodes, and each feature has a direct route to its mapped output.
There is no hidden representation, conjunction gate, inhibitory synapse, or
multi-feature credit assignment. The benchmark does not test noisy inputs,
partial observability, long-term consolidation, transfer to new feature
identities, or scaling beyond four features.

A failed threshold is a failed or inconclusive experiment; do not relax the
criteria after inspecting the result. The next stage may test knowledge
retention under additional learning and then scale feature count, but must
not reinterpret this result as broader compositional reasoning.

## 11. Stage 3 handoff

The next run should:

1. Re-check this document and the actual benchmark report/CI result.
2. Test whether singleton mappings remain intact after repeated new training
   tasks, not only after held-out inference.
3. Examine weight drift, trace cleanup, and cross-route interference under
   longer training sequences.
4. Only then increase feature/output count and measure resource/time growth.
5. Keep all runs disposable and preserve the JS production authority.

Do not change the production backend or user save data.
