# NEUROGENESIS — retention and scaling benchmark

**Stage:** 3 of 3 — retention, interference, and scale  
**Starting point:** main `bf6f618540e58c03950ed3739c97bdcb7f00b546`, version 0.58.37  
**Runtime:** disposable C++/WASM shadow brains only  
**Production JavaScript network:** unchanged  
**User saves/live state:** never loaded or modified

## 1. What this stage tests

Stage 2 established a narrow baseline: four independently trained feature-to-output routes can be superposed on previously unseen multi-feature inputs. This stage does not repeat that claim as if it were new.

It asks two follow-up questions:

1. Does additional learning on multi-feature compositions damage the already learned primitive routes, and can explicit singleton rehearsal preserve them?
2. Does the same direct-route superposition protocol remain stable when the number of feature neurons grows from four to five and six?

The capability under test remains **feature-route set-union**, not conjunction learning, role binding, relational composition, or general reasoning.

## 2. Architecture and isolation

The benchmark uses the existing C++ core through `neuro-wasm-adapter.js`. It does not add a new learning rule, C ABI call, hidden layer, composite ID, feature lookup table, or production integration.

Each scenario creates its own brain using `runtime.createBrain()`, builds a complete input-to-output graph, and disposes the brain in a `finally` block. The test wraps brain creation to count allocations and verifies that no experimental brain remains alive after the run.

JavaScript remains the production source of truth. No application storage, browser localStorage, user backup, or live application brain is read or changed.

## 3. Retention protocol registered before measurement

### 3.1 Initial model and baseline

The retention experiment uses four input features and five output neurons. The mapping is a deterministic permutation derived from seed **101**; the fifth output is a distractor.

All 20 input-to-output edges start at weight **0.005**. The primitive mapping is trained using the existing delayed contrastive API:

- one input feature per episode;
- one positive output and one negative competitor;
- learning rate **0.25**;
- eligibility retention **0.9**;
- one co-activation step followed by 12 fade steps of 0.25 seconds;
- reward only after visible activation has faded;
- traces must be consumed after every valid update.

Before any additional composition training, the benchmark measures all four singleton mappings, all 11 multi-feature combinations, and the edge-weight baseline. Every baseline must pass the fixed response criteria.

### 3.2 Additional composition tasks

The following tasks are fixed in the source before results are read:

| Task | Inputs | Cued outputs | Purpose |
| --- | --- | --- | --- |
| AB union | A+B | mapping(A)+mapping(B) | Train a previously held-out pair |
| CD union | C+D | mapping(C)+mapping(D) | Train a second pair |
| ABCD dense union | A+B+C+D | all four mapped outputs | Stress dense co-activation |
| AB conflicting label | A+B | mapping(A)+mapping(C) | Deliberately contradict B's primitive mapping |

The conflicting-label task is a stress condition, not a valid target rule and not part of the held-out score.

These four tasks run for **three cycles**. Two task orders are evaluated: forward and reverse. The three valid union tasks are known composition training examples; the remaining eight pair/triple combinations are reserved as Stage 3 unseen compositions and are never trained or used for parameter selection.

Each composition task uses the existing delayed scalar reward API `learnFromReward(0.25, +1, 0)`. Only the input features and the task's cued outputs are stimulated. Eligibility traces are inspected before reward; all valid traces must be consumed afterward. Any unintended active output/trace caused by current cross-weights is recorded rather than silently ignored.

### 3.3 Protection comparison

Two conditions receive the exact same task sequence:

- **Unprotected baseline:** no rehearsal after composition learning.
- **Protected condition:** after every composition task, replay all singleton feature mappings with the existing contrastive positive/negative update. Three complete replay sweeps are fixed per task; the learning rate remains 0.25.

This is a deliberately simple rehearsal baseline, not a new consolidation algorithm. The three sweeps are pre-registered to give the existing 0.25 contrastive update repeated opportunities to counter a single 0.25 scalar-reward increase on a cross-route edge. The number of sweeps is not changed after inspecting held-out results.

Each condition is run in forward and reverse task order using a separate disposable brain.

### 3.4 Measurements after each cycle

After every one of the three cycles, the benchmark actually stimulates and measures:

- all four original singleton mappings;
- all three composition patterns used for valid union training;
- all eight Stage 3 unseen compositions;
- all 11 multi-feature patterns together;
- correct-route and cross-route weight statistics;
- finite/bounded weights and trace cleanup.

A retention pass requires every expected output to reach at least **0.15**, every non-target output to remain at or below **0.05**, and all weights to remain finite in [0, 1]. Merely retaining a weight or reporting that an episode ran is not counted as retaining a response.

### 3.5 Pre-registered acceptance

The retention experiment passes only if:

1. Every scenario passes the pre-composition baseline.
2. The unprotected baseline exhibits measurable forgetting in both task orders.
3. The protected condition retains primitive, trained-union, and unseen compositions after every cycle in both task orders.
4. The protected condition has lower final maximum cross-route weight than the corresponding unprotected condition.
5. All reward traces are consumed and every brain is disposed.

If the unprotected condition does not forget, the stress test is considered insufficient. If protected rehearsal fails any response threshold, the retention claim fails; thresholds are not relaxed.

## 4. Reward-valence controls

Three separate disposable one-edge brains start with weight **0.4**. Each creates a delayed eligibility trace, waits for visible activity to fade, and then calls the existing scalar reward API:

- positive reward **+1** must increase the weight;
- negative reward **−1** must decrease it;
- neutral reward **0** must leave it unchanged.

All three cases must consume the trace. These controls verify the reward semantics used by the experiment; they do not modify the retention model.

## 5. Scaling protocol

Scaling scenarios use **4, 5, and 6** independent input features. Each has one more output neuron than inputs, giving a distractor output. The graph is a complete bipartite feature-to-output graph with all weights initialized to 0.005.

Three deterministic seeds are used: **17, 29, 43**. The seed controls the feature-to-output permutation and training/competitor order using a fixed xorshift32 generator. It does not add stochasticity to the C++ core.

Training contains singleton inputs only. For each feature, the correct output is reinforced against every other output using the same delayed contrastive protocol as Stage 2. Every pair, triple, and larger combination is held out.

| Features | Outputs | Neurons | Synapses | Singleton episodes | Held-out combinations | All held-out input permutations |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 5 | 9 | 20 | 16 | 11 | 60 |
| 5 | 6 | 11 | 30 | 25 | 26 | 320 |
| 6 | 7 | 13 | 42 | 36 | 57 | 1,950 |

All permutations of each held-out combination are evaluated. Every scenario must meet the same fixed 0.15 target, 0.05 non-target, and 1e-6 stimulation-order-spread thresholds. All primitive singleton mappings must also remain correct.

## 6. Resource measurements and limitations

The benchmark records:

- graph size (neurons and synapses);
- training wall time;
- exhaustive held-out inference wall time;
- built WASM artifact byte size from the CI test.

The current C ABI and adapter do not expose per-brain allocator attribution or a reliable per-model WASM heap measurement. Therefore `perBrainMemoryBytes` is explicitly **null**. Graph counts and artifact size are not mislabelled as RAM usage. No memory value is inferred or simulated.

Wall-clock values are diagnostics from the CI runner, not portable performance guarantees. Compare them only within the same runner/toolchain context.

## 7. Results

This section is populated only from the actual GitHub Actions output for the commit that runs this benchmark. A green CI job alone is not evidence of retention or scaling success; the benchmark assertions must also pass.

## 8. Interpretation limits

A successful retention result would show that replaying the existing singleton associations can counteract interference produced by the tested scalar-reward composition tasks. It would not show that the network learned a new relational rule or that replay is a general solution to catastrophic forgetting.

A successful scaling result would show that the same direct-route superposition protocol passes on these small complete bipartite graphs for three deterministic mappings at each of 4, 5, and 6 features. It would not establish asymptotic scalability, broad transfer to new feature identities, noisy-input robustness, or general intelligence.

No production learning rule, C++ core API, C ABI, user state, or JavaScript source-of-truth behavior is changed by this stage.
