# Contextual Dependency Head and DEPREL Pilot · 0.58.120

## Purpose

This is an isolated supervised experiment for two token-level decisions needed for richer sentence understanding:

1. **Head selection (UAS):** for each dependent token, choose its syntactic head from ROOT and every other word in the sentence.
2. **Dependency relation (DEPREL):** predict the UD relation conditioned on the selected head.

The experiment does not connect these predictions to the production semantic core or rewrite any user memory.

## Inputs and representations

The source is the pinned UD_Russian-GSD r2.18 corpus at commit 9acc9d677327043bd416fcc89e4b3407c620d885.

For each annotated sentence:

- CoNLL-U token forms are aligned exactly to the contextual tokenizer. Sentences with mismatched tokenization are counted and skipped, not silently shifted.
- If a UD word is segmented into multiple model tokens, its representation is the mean of those piece-level token and contextual vectors.
- A candidate arc representation combines the dependent vector, candidate-head vector, their element-wise product, signed and absolute relative position, and an explicit ROOT indicator.
- ROOT (HEAD=0) is a real candidate. A dependent is never allowed to select itself as its head.
- The attachment model scores all candidate heads with a grouped softmax objective. A separate relation classifier predicts DEPREL from the dependent/head pair.

## Split and training protocol

The corpus importer decontaminates train and test sentences and samples 320 training sentences plus 240 independent test sentences. For each of three fixed seeds, the contextual encoder creates its own deterministic train/validation/test partition inside the 320-sentence training sample:

- Contextual train partition: supplies the encoder learning data and the only dependency annotations used to train the two heads.
- Contextual validation partition: selects component checkpoints independently — attachment by UAS and DEPREL by oracle-head relation macro-F1 (the gold head is supplied for this isolated component score). Combined LAS is reported but does not select either component.
- Contextual internal test partition: remains held out from encoder training and is not used to train either dependency head.
- Independent UD test: used only for the final benchmark report.

Two paired relation-head variants are trained with the same encoder, examples, split, initialization seed and component-specific checkpoint protocol:

- Unweighted DEPREL loss.
- Square-root inverse-frequency DEPREL weighting, with weights derived only from supervised training rows and normalized to mean sample weight 1.

The attachment checkpoint is selected only by validation UAS and training stops only from that UAS curve. The relation checkpoint is selected separately by validation oracle-head relation macro-F1. This prevents relation class weighting from changing the number of attachment updates or the selected attachment epoch. The two variants must produce identical per-dependent HEAD predictions on validation and every independent-test lemma slice; CI compares exact predicted HEAD ids, not only aggregate correct counts. The experiment changes only the DEPREL loss weighting. LAS remains an independently reported combined metric.

The attachment objective is unweighted and receives identical examples in both variants. CI asserts that the paired variants return identical attachment counts on the independent test; only relation-loss class weighting may change.

A DEPREL value is fitted only when it has at least 12 examples in the supervised training partition. Rarer labels are explicitly counted as unsupported relation training examples. They remain part of the independent test denominator and therefore cannot disappear from LAS. Relation coverage is reported separately from accuracy.

## Metrics

- **UAS / head accuracy:** predicted head equals the gold HEAD.
- **Oracle-head relation accuracy and macro-F1:** DEPREL quality when the gold head is supplied. The accuracy denominator is the number of test relations covered by the training label set; unsupported labels contribute zero to macro-F1.
- **Predicted-head relation accuracy and macro-F1:** DEPREL quality when the classifier receives the head selected by the attachment model. This exposes relation errors caused by incorrect head selection as a separate effect.
- **Relation coverage:** proportion of annotated test dependencies whose DEPREL class met the training support threshold.
- **LAS:** predicted head and predicted DEPREL must both match the gold annotation. All annotated test dependencies remain in this denominator, including unsupported relation labels.
- **Baselines:** nearest-left head plus majority training DEPREL, reported separately for head accuracy, relation accuracy and LAS.
- All counts are retained with their denominators and reported separately for all, known-dependent-lemma and unseen-dependent-lemma slices.

## Interpretation boundary

This is a **local per-token head scorer**, not a globally decoded dependency tree. It does not yet enforce one root, acyclicity or a connected tree; high UAS/LAS on individual arcs would not by itself establish valid whole-tree parsing. It also does not prove broad language understanding or compositional reasoning.

No production inference path is changed. The result is an auxiliary signal candidate only. Integration would require stable gains on independent unseen lemmas, adequate relation coverage, full CI success, and a separate test that converts local predictions into valid dependency trees without overriding high-confidence semantic-core evidence.
