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

## 7. Measured results

Measured by GitHub Actions PR run **#42762750247**, validation job **129652076562**, on the Stage 3 PR head. The benchmark's own assertions passed; this is not inferred from the job status alone.

### 7.1 Reward valence

All controls used a 0.4 starting weight and the same delayed trace (**0.42956254**) after visible activity had faded.

| Reward | Weight before | Weight after | Delta | Trace consumed |
| ---: | ---: | ---: | ---: | --- |
| +1 | 0.40000001 | 0.50739062 | +0.10739061 | yes |
| −1 | 0.40000001 | 0.29260936 | −0.10739064 | yes |
| 0 | 0.40000001 | 0.40000001 | 0 | yes |

### 7.2 Retention and interference

Before additional composition training, all four scenarios passed the baseline: the four primitive mappings and all 11 multi-feature combinations were correct. Mean/minimum correct route weight was **0.43456256**; maximum cross-route weight was **0**.

The unprotected condition intentionally uses scalar positive reward on co-active composition paths without replay. It detected forgetting in both task orders:

| Condition | Cycle | Minimum expected activation across all 11 combinations | Maximum non-target activation | Maximum cross-route weight | Retention |
| --- | ---: | ---: | ---: | ---: | --- |
| Unprotected, forward | 1 | 0.80407941 | 0.64762843 | 0.32712278 | failed |
| Unprotected, forward | 2 | 1.00000000 | 1.00000000 | 0.67396271 | failed |
| Unprotected, forward | 3 | 1.00000000 | 1.00000000 | 1.00000000 | failed |
| Unprotected, reverse | 1 | 0.80256623 | 0.82842112 | 0.32712278 | failed |
| Unprotected, reverse | 2 | 1.00000000 | 1.00000000 | 0.67396271 | failed |
| Unprotected, reverse | 3 | 1.00000000 | 1.00000000 | 1.00000000 | failed |
| Protected, forward | 1 | 1.00000000 | 0 | 0 | passed |
| Protected, forward | 2 | 1.00000000 | 0 | 0 | passed |
| Protected, forward | 3 | 1.00000000 | 0 | 0 | passed |
| Protected, reverse | 1 | 1.00000000 | 0 | 0 | passed |
| Protected, reverse | 2 | 1.00000000 | 0 | 0 | passed |
| Protected, reverse | 3 | 1.00000000 | 0 | 0 | passed |

Protected runs performed **576 singleton replay episodes each**. After every cycle they passed all four primitive patterns, all three trained union compositions, and all eight still-unseen compositions. They also retained finite bounded weights. Both unprotected runs failed primitive, unseen, and trained-composition response checks; their final maximum cross-route weight reached 1.0.

This supports a narrow conclusion: in this particular graph and task schedule, repeated singleton contrastive rehearsal countered the cross-route interference caused by the scalar reward rule. It is not evidence of a general anti-forgetting algorithm.

### 7.3 Scaling across seeds

All nine independent scenarios passed. Every held-out combination and every stimulation-order permutation was evaluated. The maximum non-target activation and order spread were exactly zero in these deterministic runs.

| Features | Seed | Neurons | Synapses | Training episodes | Held-out combinations | Permutations | Minimum expected activation | Training ms | Held-out inference ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 17 | 9 | 20 | 16 | 11 | 60 | 0.43456256 | 0.304 | 1.099 |
| 4 | 29 | 9 | 20 | 16 | 11 | 60 | 0.43456256 | 0.284 | 1.257 |
| 4 | 43 | 9 | 20 | 16 | 11 | 60 | 0.43456256 | 0.277 | 1.076 |
| 5 | 17 | 11 | 30 | 25 | 26 | 320 | 0.54197299 | 0.540 | 6.315 |
| 5 | 29 | 11 | 30 | 25 | 26 | 320 | 0.54197299 | 0.532 | 6.681 |
| 5 | 43 | 11 | 30 | 25 | 26 | 320 | 0.54197299 | 0.524 | 6.323 |
| 6 | 17 | 13 | 42 | 36 | 57 | 1,950 | 0.64983177 | 0.911 | 51.560 |
| 6 | 29 | 13 | 42 | 36 | 57 | 1,950 | 0.64983177 | 0.922 | 52.301 |
| 6 | 43 | 13 | 42 | 36 | 57 | 0.64983177 | 1.008 | 44.009 |

For every scenario:
- maximum non-target activation: **0** (required ≤ 0.05);
- maximum stimulation-order spread: **0** (required ≤ 0.000001);
- all primitive mappings remained correct;
- all weights remained finite and within [0, 1].

The 6-feature inference pass covers 57 held-out combinations and 1,950 permutations per seed. These timings are specific to the GitHub Actions runner and should not be treated as device/mobile performance estimates.

### 7.4 Resource and lifecycle measurements

- WASM binary artifact: **25,477 bytes**.
- Retention suite: **106.821 ms**.
- Scaling suite: **178.554 ms**.
- Disposable brains created: **16**.
- Disposable brains remaining after the run: **0**.
- Per-brain memory: **not measurable through the current API**; `perBrainMemoryBytes=null`.

The benchmark therefore reports graph cardinality and wall time, but does not fabricate a RAM figure.

### 7.5 CI interpretation

PR run **#42762750247** completed successfully:
- Validate application: **success**.
- C++ core build/tests: **success**.
- Emscripten setup and WASM build/smoke tests: **success**.
- Stage 2 compositional regression and Stage 3 retention/scaling assertions: **success**.
- Existing regression suite: **success**.
- Deploy job: **skipped**, as expected for a pull-request event. A successful Pages deployment must be checked after merge on `main`.


## 8. Interpretation limits and next technical risks

The retention run demonstrates that singleton contrastive rehearsal can counter the interference caused by this specific scalar-reward schedule in this small complete bipartite graph. The no-replay control forgot primitive and combination responses in both task orders; the protected condition retained all measured responses after each of three cycles.

There is a cost: after the first protected cycle, all four correct-route weights reached the upper bound **1.0**. This is successful retention for the tested tasks, but it consumes synaptic headroom and may make later learning less adaptable. The replay strategy also required **576 episodes per protected scenario**. Neither result supports calling replay a general anti-forgetting algorithm.

The scaling run shows that direct-route superposition passed for 4, 5, and 6 features, three deterministic mappings per size, and exhaustive held-out permutations. It does not establish asymptotic scalability, transfer to new feature identities, robustness to noise or partial inputs, or learned conjunctions/relations. The seed-101 retention mapping was F1→O5, F2→O4, F3→O2, F4→O3.

Next technical risks are weight saturation, replay cost, and the absence of per-brain memory attribution in the current C ABI. A sensible next research step is not to enlarge the network immediately: first test whether retention can be achieved without driving all correct weights to 1.0, and whether smaller/adaptive replay preserves plasticity. That would require a separate pre-registered experiment and should remain in the shadow runtime.

No production learning rule, C++ core API, C ABI, user state, or JavaScript source-of-truth behavior was changed by this stage.
