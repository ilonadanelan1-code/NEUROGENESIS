# UD annotated context candidate ranker

The module imports CoNLL-U annotations and builds a lexical/morphological retrieval index from training records.

- Retains surface form, lemma, UPOS and FEATS.
- Builds masked training examples from surrounding words only; the target position is omitted.
- Retrieves examples using visible surface forms, annotated lemmas and a stem fallback.
- Ranks candidate target forms using lexical match, positional alignment, context coverage and a small grammatical-number compatibility adjustment.
- The score is a ranking score, not a calibrated probability.

## Limits

Candidate forms must occur in the imported corpus. This is not yet a productive Russian inflector and does not replace the Transformer. The hidden token surface is never used. The corpus index is held in memory for the current page session, so re-import after reload.

## Browser use

Load after contextual-attention.js and before contextual-attention-ui.js. Parse the official UD Russian-GSD training file and create the ranker:

    const records = window.NGUDContextCandidateRanker.parseConllu(fileText);
    const ranker = window.NGUDContextCandidateRanker.create(records, {
      modelApi: window.NGContextualModel
    });
    const result = ranker.predictMasked(sentence, maskedTokenIndex, { limit: 8 });

Use the train partition only; never add dev or test records to the candidate index.

Pinned upstream training corpus:
https://raw.githubusercontent.com/UniversalDependencies/UD_Russian-GSD/9acc9d677327043bd416fcc89e4b3407c620d885/ru_gsd-ud-train.conllu

## Independent tag prediction

The ranker also trains a sparse multinomial Naive Bayes tagger from the same train-only context examples. It predicts UPOS independently and maintains per-UPOS classifiers for selected UD FEATS such as Case, Number, Gender, Tense, Aspect and VerbForm. These tag distributions are exposed as tagPrediction. Optional reranking weights are disabled by default and may be enabled only after selection on the official dev split. The benchmark reports POS and morphology accuracy separately from lexical candidate recall. Tag confidence is an internal ranking distribution, not a calibrated probability.
