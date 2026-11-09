# Compositional Generalization: Architecture Audit

**Audit baseline:** main, version 0.58.37, commit 337d21d66962676a0e0630f4e5b32bb528f8099e  
**Scope:** read-only architecture and test audit. No runtime behavior or user save data changed.

## Executive finding

The C++/WASM core is a generic weighted directed graph of stateful neurons. It can stimulate several independent neuron IDs before one simulation step, sum their incoming signals, and propagate signals over multiple time steps. This is enough to test a narrow form of zero-shot recombination: independently learned feature-to-output routes can be activated together for a combination never presented during training.

It is **not yet evidence of general compositional reasoning**. The current core has no feature-vector input API, no type-specific neuron behavior, no explicit layer or binding mechanism, no signed/inhibitory weights, and no path-aware credit assignment for a multi-feature input. Existing multi-pattern and contrastive benchmarks use two already identified input neurons and two already identified output neurons; they test retention, interference, and input-specific route selection, not unseen combinations.

**Recommendation:** first add a deterministic, isolated benchmark for multi-hot superposition of at least three independently trained primitive associations. Do not redesign the core until this baseline has been measured. If the intended claim is stronger than feature-set union—such as binding features into novel roles or learning conjunctions—design a separate benchmark and architecture proposal.

## 1. Architecture map

### 1.1 Data model and input encoding

- A neuron stores a sequential numeric ID, name, one enum kind, activation, excitability, and visual coordinates. See **engine/neuro_core.hpp:9-19**.
- A synapse stores source ID, target ID, a non-negative weight, current signal, and eligibility trace. See **engine/neuro_core.hpp:21-27**.
- The graph is created explicitly through add_neuron() and add_synapse(); self-edges and duplicate directed edges are rejected. Weights are clamped to [0, 1]. See **engine/neuro_core.cpp:11-29**.
- There is no vector, tensor, token-set, or feature-bundle input parameter. The primitive input operation is stimulate(neuron_id, strength), which adds activation to one named node and clamps it to [0, 1]. See **engine/neuro_core.hpp:31-38** and **engine/neuro_core.cpp:59-65**.
- A multi-feature input can therefore be represented only by calling stimulate() on several feature neurons before the next step(). That is a possible multi-hot stimulus, not a dedicated compositional input abstraction.

The five NeuronKind values—Core, Sensory, Memory, Logic, Output—are stored and exposed as metadata. The core's step() and learning functions do not branch on kind. A node labelled Logic or Memory is not given a special computation merely by its label. See **engine/neuro_core.hpp:9-19** and the complete update path in **engine/neuro_core.cpp:153-194**.

### 1.2 Activation and propagation

For each step, the core:

1. Builds an incoming-signal buffer.
2. For every edge, reads the source's current activation and adds activation × weight to the target's incoming sum; edge signal decays and is raised to the transmitted value.
3. Updates all neuron activations from the incoming buffer using excitability, a fixed 0.05 drive cutoff, saturation at 1, and linear activity decay.
4. Updates each edge's eligibility from the new pre/post activations and the retention factor.

Implementation: **engine/neuro_core.cpp:153-194**.

Consequences:

- The update is synchronous with respect to propagation: the incoming buffer is built before any neuron activation is replaced. A newly activated intermediate node does not forward its new signal again in the same step. Multi-hop propagation needs successive step() calls.
- Arbitrary intermediate nodes and cycles can be constructed, but there is no explicit layer scheduler, recurrent-state policy, or special hidden-node algorithm.
- The only activation nonlinearity is the fixed drive cutoff and [0, 1] clamp. There is no per-neuron threshold or explicit AND/XOR/binding operation.
- Weights cannot be negative, so the core has no inhibitory synapse representation. Competing outputs can both activate.

### 1.3 Learning rules

All weight values remain in [0, 1]. Learning rate and reward inputs are finite-checked and clamped where applicable.

| Rule | Actual update | Scope and limitation |
| --- | --- | --- |
| Immediate Hebbian reward | weight += rate × reward × pre_activation × post_activation − decay × weight | Iterates all synapses; negative reward weakens co-active edges. **neuro_core.cpp:67-98** |
| Delayed scalar reward | weight += rate × reward × eligibility − decay × weight | Iterates all synapses and consumes every eligibility trace after a valid call, including traces that produce no change. **neuro_core.cpp:100-119** |
| Contrastive delayed reward | selected input→positive edge gets +rate × eligibility; selected input→negative edge gets −rate × eligibility | Exact input ID and exact two target IDs are passed by caller. Other edges are not updated, but all traces are consumed. No separate reward or decay argument. **neuro_core.cpp:121-151** |

Eligibility is accumulated as retained previous eligibility plus pre/post co-activation, clamped to [0, 1]. It can outlive visible activation and decay after co-activation stops. See **neuro_core.cpp:185-193** and the delayed-reward native test **engine/neuro_core.test.cpp:113-159**.

A crucial distinction: learn_contrastive_reward() is not a general multi-input credit-assignment rule. Its positive and negative route selection requires one exact input neuron ID. Calling it repeatedly for several input IDs is not equivalent to one atomic multi-feature update because each valid call consumes all traces.

## 2. C++, C ABI, WebAssembly, and JavaScript boundary

### 2.1 Native and C ABI surface

The C++ Brain API is declared in **engine/neuro_core.hpp:29-60**. The opaque C handle and exported operations are declared in **engine/neuro_wasm.h:9-43** and implemented as guarded wrappers in **engine/neuro_wasm.cpp:12-146**. The API exposes creation/destruction, neuron and synapse creation, stimulation, stepping, three learning operations, eligibility/weight setters, and indexed state inspection.

**engine/wasm_entry.cpp:1-5** only supplies a module anchor; the actual callable surface is the C ABI.

### 2.2 WASM build and JS adapter

**engine/CMakeLists.txt:1-53** builds the C++17 core, native test executable, and (under Emscripten) the modularized ES-module WASM artifact. Its exported function list includes the C ABI operations.

**neuro-wasm-adapter.js:234-346** maps arbitrary source IDs to core numeric IDs, imports neuron/synapse snapshots, and maps snapshots back to source IDs. Snapshot import has explicit limits of 2,000 neurons and 20,000 synapses (**lines 234-240**).

**neuro-wasm-adapter.js:396-449** rebuilds a candidate shadow brain from the current source snapshot and swaps it in only after successful construction. It carries forward a learned overlay only while the corresponding source edge and its baseline weight still match. **Lines 504-625** record, export, and restore the separate learned-weight overlay.

### 2.3 Production authority and isolation

The browser app serializes the JavaScript graph into a snapshot and mirrors it to the WASM controller: **app.js:117-135**. The shadow controller is started separately and receives that snapshot: **app.js:208-225**. The integration contract explicitly asserts JavaScript authority and atomic shadow replacement: **tests/wasm-shadow-mode.test.js:37-49**.

The WASM runtime is therefore an experimental mirror, not the production source of truth. Its learned weights are a separate overlay with explicit export/import paths; the normal shadow frame loop is not allowed to write C++ state over the JavaScript network (**tests/wasm-shadow-mode.test.js:78-117**). This audit did not load, modify, export, or overwrite any user save.

## 3. What current tests actually establish

| Test / benchmark | What it establishes | What it does not establish |
| --- | --- | --- |
| **engine/neuro_core.test.cpp:113-159** | Co-activation creates traces; traces survive fading, decay, and are consumed by delayed reward. | Transfer to a new input combination. |
| **engine/neuro_core.test.cpp:161-218** | Contrastive update strengthens one selected direct route, weakens another, preserves unrelated weights, validates arguments, and respects bounds. | Multi-feature input learning or recombination. |
| **tests/neuro-wasm-adapter.test.mjs:1-160** | WASM adapter propagation, snapshots, direct/delayed/contrastive calls, and source-ID mapping work. | Unseen-combination behavior. |
| **tests/neuro-core-parity.test.mjs:14-99, 172-205, 213-337** | C++/WASM behavior matches a JavaScript reference for propagation and learning, including delayed and contrastive updates; a larger deterministic graph checks implementation parity. | Generalization. Matching an implementation reference is not a learning-capability benchmark. |
| **experience-benchmark.js:100-320; tests/experience-benchmark.test.mjs:12-61, 83-100** | Two predeclared input→output pairs learn in either order; the first association is retained; low cross-links stay inactive. | Novel combinations: each inference presents the same trained input ID used in its training episode. |
| **experience-benchmark.js:323-512; tests/experience-benchmark.test.mjs:64-81** | Dense shared-output interference is reproduced: scalar positive reward also strengthens active off-target paths and competing outputs remain active. | A solution to interference or compositional transfer. This is a diagnostic of a limitation. |
| **contrastive-benchmark.js:1-252; tests/contrastive-benchmark.test.mjs:1-100** | Two direct input/output routes are trained in both orders; selected target paths strengthen, selected cross paths weaken, and order does not change the mapping. | Held-out feature combinations. The benchmark supplies the exact input ID and target IDs to each contrastive update. |

The two-pattern benchmark is deliberately an association-retention experiment. Its fixture creates four neurons and four direct edges; each episode stimulates one input and its target, then evaluates that same input again. See **experience-benchmark.js:100-128, 157-207, 209-320**.

The contrastive benchmark uses the same basic four-neuron/four-edge shape, with cross-links strong enough to activate the wrong output. It then calls the update with the current input ID, target ID, and competing output ID. Both training orders are checked. See **contrastive-benchmark.js:16-42, 77-190, 192-252**.

The parity stress graph (48 neurons and 240 synapses) is valuable for scale and numerical consistency, but its inputs, updates, and expected states are generated by a reference implementation. It is not a held-out task split. See **tests/neuro-core-parity.test.mjs:250-337**.

**Audit conclusion on existing evidence:** the repository has useful tests for local association learning, delayed credit traces, order sensitivity, interference, contrastive route selection, API parity, and moderate graph size. No inspected test trains on primitive features and then tests a previously unseen multi-feature combination.

## 4. Capability boundary: what can be tested now

### 4.1 Narrow compositional baseline available without core changes

The current graph can test **zero-shot superposition of independently learned feature routes**:

- Create at least three independent sensory input neurons A/B/C and corresponding output neurons X/Y/Z.
- Connect each input to its own target output. Include low-weight cross paths as a negative-control surface, but choose their weights so the sum of all possible cross-path contributions stays below the core's 0.05 activation cutoff.
- Train only the three singleton associations A→X, B→Y, and C→Z in isolated episodes. Do not ever stimulate or reward a pair/triple during training.
- At inference, stimulate A+B, A+C, B+C, and A+B+C before one step. Do not stimulate outputs and do not create combination-specific neurons or edges.
- Require the expected output set to activate for every held-out combination, non-target outputs to stay below a predeclared threshold, and all three singleton mappings to remain intact.
- Repeat after changing the order of primitive training and the order of input stimulation.

This is a legitimate but deliberately narrow test of recombining independent learned routes. It demonstrates feature-set union / additive superposition only. It does **not** demonstrate role binding, conjunction learning, variable binding, rule induction, or broad reasoning.

### 4.2 Stronger composition requires a separate design

If the target capability is a novel output that depends on a relationship between features—not merely the union of their separately learned outputs—the current primitives are insufficient as a demonstrated solution. A stronger design may need:

- a documented multi-feature stimulus representation and deterministic reset/settling protocol;
- explicit intermediate/binding semantics rather than relying on neuron labels;
- an activation/gating rule that can represent conjunctions and distinguish competing combinations;
- a multi-input credit-assignment rule that can strengthen or weaken the responsible paths atomically without consuming unrelated traces prematurely;
- a clear policy for inhibition/competition if negative evidence is required.

Do not add all of these pre-emptively. First run the narrow baseline. Use its measured failure mode to decide whether a core change is justified.

## 5. Stage 2 benchmark protocol and acceptance criteria

The next implementation stage should add an isolated benchmark and tests, preferably without changing production behavior.

**Training split**
- Three primitive features and three distinct target outputs.
- Training examples: only A→X, B→Y, C→Z.
- Held-out examples: A+B, A+C, B+C, A+B+C. None may be presented during training or used to tune thresholds.
- Use a fresh disposable WASM brain per training order. Never use the live app brain or localStorage state.

**Controls**
- Untrained baseline must not already pass.
- A shuffled primitive mapping must fail the expected output assertions.
- Inference must stimulate input features only; target outputs must not be pre-activated.
- No pair/triple ID, pair/triple node, or pair/triple edge may exist in the training fixture.
- Reset/settle between trials so residual activation cannot masquerade as transfer.
- Run at least two primitive training orders and all permutations of feature stimulation for each held-out set.

**Acceptance**
- Every expected output exceeds the core's 0.05 activation cutoff by a declared margin.
- Every non-target output stays below a declared leakage bound.
- Every held-out pair and triple passes without any training update on that combination.
- Primitive single-feature responses remain correct after combination tests.
- Results are deterministic, finite, bounded, and reported per combination and per order.
- The benchmark labels its result precisely as zero-shot feature-route superposition. A stronger claim requires a stronger task.

If the narrow baseline fails, report the failing feature set and observed activations. Do not immediately add hidden neurons or alter the production JS network. Diagnose the actual failure first.

## 6. False-positive risks to guard against

1. **Direct-pair memorization:** any pair or triple presented during training invalidates that combination as held out.
2. **Target leakage:** stimulating the target output during inference makes the test circular.
3. **Identity leakage:** a composite ID, dedicated composite neuron, or pre-wired composite edge is a lookup table, not recombination.
4. **Residual activation:** failing to settle/reset between trials can make a previous output look like a response to the current combination.
5. **Threshold artefacts:** cross-path contributions can add across multiple active inputs and cross the 0.05 cutoff even when each cross edge is individually subthreshold. Bound the total worst-case leakage, not just each edge.
6. **Training-order artefacts:** one convenient order is insufficient; test reversed and permuted orders.
7. **Reference parity confusion:** matching a reference implementation verifies code equivalence, not the presence of a capability.
8. **Overclaiming:** feature-set union is not conjunction, role binding, systematic rule generalization, or general intelligence.

## 7. Source map for the next run

- Core data model and public API: **engine/neuro_core.hpp:9-60**
- Graph construction, input stimulation, learning, propagation: **engine/neuro_core.cpp:11-194**
- C ABI: **engine/neuro_wasm.h:9-43**, **engine/neuro_wasm.cpp:12-211**
- WASM entry and build/export configuration: **engine/wasm_entry.cpp:1-5**, **engine/CMakeLists.txt:1-53**
- Snapshot mapping and shadow isolation: **neuro-wasm-adapter.js:234-346, 356-449, 504-625**
- Production JS snapshot and shadow startup: **app.js:117-135, 208-225**
- Existing paired-association and interference experiments: **experience-benchmark.js:100-320, 323-512**
- Existing contrastive experiment: **contrastive-benchmark.js:1-252**
- Native and WASM test entry points: **engine/neuro_core.test.cpp**, **tests/neuro-core-parity.test.mjs**, **tests/neuro-wasm-adapter.test.mjs**, **tests/experience-benchmark.test.mjs**, **tests/contrastive-benchmark.test.mjs**, **tests/wasm-shadow-mode.test.js**

## 8. Audit baseline and counting method

The following counts describe the complete 64-blob text tree at baseline commit 337d21d66962676a0e0630f4e5b32bb528f8099e, **before this audit document is added**.

| Category | Files | Physical lines |
| --- | ---: | ---: |
| Application/source (JS, HTML, CSS, C++) | 25 | 12,285 |
| Tests (including engine/neuro_core.test.cpp) | 30 | 7,874 |
| Build/configuration | 8 | 382 |
| Documentation (README.md) | 1 | 555 |
| **All text files** | **64** | **21,096** |

Counting rule: fetch every blob from the non-truncated recursive Git tree at the audited commit; decode UTF-8; count physical lines as newline-separated lines, excluding only the final empty split element when the file ends in a newline. No binary blobs were present in the tree. Categories are mutually exclusive: tests include the native C++ test; configuration includes the five workflow YAML files, .gitignore, engine/CMakeLists.txt, and wrangler.toml; README is documentation; remaining text files are application/source.

The audit document itself is intentionally excluded from the baseline above. Its own physical line count and the post-commit documentation/all-text totals must be reported after it is committed, so the self-added report is not silently omitted from the final project count.

## 9. Audit decision

No production code or user state was changed during this audit. The next safe step is the isolated three-feature zero-shot superposition benchmark described above. Preserve JavaScript as the production authority and keep all experiments in disposable WASM shadow brains until evidence justifies a separately reviewed architecture change.
