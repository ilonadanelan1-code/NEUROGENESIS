# UD annotation pipeline · 0.58.112

## What is retained

The pinned UD_Russian-GSD CoNLL-U importer now preserves token-level annotations alongside each sentence:

- surface form and lemma;
- UPOS and XPOS;
- parsed FEATS map plus the original FEATS string;
- HEAD and DEPREL;
- DEPS and MISC;
- sentence ID and separate annotation-token count.

CoNLL-U multiword-token ranges (for example, `1-2`) and empty nodes (for example, `2.1`) are not treated as independent lexical tokens. Only integer token IDs are represented in the lexical token array.

## Split isolation

`prepareCorpus()` still returns the legacy `trainingTexts` and `testTexts` arrays unchanged. It additionally returns `trainingRecords` and `testRecords`, with deep-copied token feature maps. Exact normalized sentence overlap is removed before deterministic sampling, so the annotated training records originate only from the decontaminated training side.

The preparation report counts annotation coverage, UPOS labels and dependency relations separately for train and test. Test annotations are diagnostic only; they must never be passed to training.

## Next model task

This commit is a data-foundation step, not yet a new trained language head. The next stage is to train auxiliary predictions on training-side annotations only:

1. UPOS prediction for masked and OOV lemmas;
2. selected FEATS prediction, such as Case, Number, Gender, Person, Tense and VerbForm;
3. dependency-role prediction conditioned on the contextual representation;
4. held-out evaluation stratified by known versus unseen lemma, with exact numerators, denominators and per-seed results.

The existing word-prediction objective remains separate. Improved POS or morphology scores must not be reported as improved lexical prediction or semantic understanding unless those tasks also improve on independent tests.
