# Contextual candidate ranker v1

This branch adds a context-only candidate retrieval layer for the local Russian masked-token model.

## Why

The existing neural softmax can only return forms already in its vocabulary. Its built-in OOV path generates a narrow set of plural noun forms from the neural top predictions and exposes at most one unique context-retrieval result. The new ranker returns a ranked list of lexical candidates backed by stored training-context examples.

## Data flow

1. create(model) snapshots the model checkpoint and reads only vocabulary plus trainingContextExamples.
2. For a masked position, it tokenizes the input and builds a context from offsets other than zero. The token at the masked position is never added to the query.
3. It compares the remaining context to training examples with one-to-one token alignment. Exact matches score higher than same-stem matches; matching offsets score higher than inverted or near offsets. Rare context stems receive an IDF weight.
4. Candidate evidence is grouped by the stored training target and sorted. Neural probabilities are a small tie-breaking contribution, not the sole ranking signal.
5. When the existing model reports a plural agreement hint, the ranker may apply the existing russianNounPlural rule to the retrieved base form.

## Safety and evaluation constraints

- The hidden input surface is not used for retrieval or ranking. The same context at the same mask index must produce the same candidate list even when the hidden surface is replaced.
- Training examples are the source of candidate words. This module does not add the hidden test target to the vocabulary.
- targetSurfaceUsed=false is a diagnostic contract, not a benchmark result.
- The score is a ranking score, not a calibrated probability.
- This version cannot generate an entirely unseen lemma. It can retrieve a known training lemma and apply the narrow existing plural rule where supported.
- It does not replace the neural model and does not claim an accuracy improvement until evaluated on a frozen, untouched test set.

## Use

Load contextual-candidate-ranker.js after contextual-attention.js and before contextual-attention-ui.js. Create one ranker per analysis operation:

    const ranker = window.NGContextualCandidateRanker.create(model);
    const result = ranker.predictMasked(text, maskIndex, { limit: 8 });

Run the focused test from the repository root:

    node tests/contextual-candidate-ranker.test.js
