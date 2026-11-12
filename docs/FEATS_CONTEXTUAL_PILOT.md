# Contextual UD FEATS attribute-value pilot — 0.58.118

## Purpose

The external UD_Russian-GSD r2.18 pilot shows a low baseline for the existing morphology path (480 / 3,696 covered targets, 12.987%). The annotation importer now preserves gold FEATS values, so this experiment measures whether contextual token and context vectors can predict grammatical feature values on held-out sentences and unseen lemmas.

## Model

- Each UD attribute (for example Case, Number, Gender, Tense, Person, VerbForm, Aspect) gets a separate linear softmax head.
- The input is the concatenation of the contextual model's token and context vectors.
- Comma-separated multi-values are preserved as one canonical label (unique values sorted consistently).
- Class weights use square-root inverse frequency, computed only from the supervised training partition and normalised to mean sample weight 1.
- The checkpoint is selected by validation macro-F1.
- The pilot is conditional: a head predicts a value for an annotated attribute. It does not yet decide whether that attribute applies to a token, and it is not a complete FEATS tagger.

## Data and isolation

- Pinned source: UD_Russian-GSD r2.18, commit 9acc9d677327043bd416fcc89e4b3407c620d885, CC BY-SA 4.0.
- 320 train sentences and 240 independent test sentences, deterministic sampling, zero normalized train/test sentence overlap.
- Within the 320-sentence training sample, the contextual model's train/validation/internal-test split is respected.
- Supervised FEATS targets come only from the model's train split. Validation is used only for checkpoint selection. The independent test is used only for reporting.
- Lemma slices are defined independently per attribute from the supervised training examples.

## Reporting and guardrails

- Attribute shortlist is fixed in advance; the shortlist is capped at nine attributes.
- A value is supported only when it appears at least 12 times in that attribute's supervised training examples. Rare/unseen test values are reported as uncovered, not silently relabelled.
- Report exact numerators/denominators, coverage, accuracy, majority baseline, macro-F1, per-class results, and separate known/unseen-lemma slices across three seeds.
- This is an isolated experiment. No production inference path or existing vocabulary/model weights are changed.
- Do not integrate unless independent unseen-lemma results and macro-F1 provide a reproducible improvement over the relevant majority baselines and all regression tests pass.
