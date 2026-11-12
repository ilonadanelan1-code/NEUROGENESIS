# Contextual UPOS auxiliary head · experimental

This module introduces a trainable auxiliary classifier for universal part-of-speech tags (UPOS). It is intentionally separate from masked-token prediction and from the rule-based semantic core. A pinned UD_Russian-GSD pilot now compares it against a majority-class baseline and reports metrics separately for seen and unseen lemmas.

## Input representation

For each visible annotated token, the extractor aligns CoNLL-U FORM rows to the contextual model tokenizer and concatenates:

- the token vector, including character n-gram features for OOV surface forms;
- the contextual vector computed from its surrounding tokens.

Token/annotation alignment must be exact after tokenization. Sentences with mismatched tokenization are skipped and counted rather than silently shifting labels.

## Training isolation

The classifier accepts only examples explicitly supplied to its train call. The intended benchmark protocol is:

1. split the decontaminated UD training sentences into train and validation using the contextual model's deterministic split;
2. build UPOS training examples only from the training records;
3. use validation labels only for early stopping;
4. evaluate once on the independent UD test records;
5. report results separately for known and unseen lemmas.

The module does not update contextual model weights, does not add tokens to its vocabulary and does not change the main masked-token predictor.

## External benchmark

The UPOS pilot uses the same pinned UD_Russian-GSD r2.18 sample and three model seeds. The contextual encoder is trained only on the model's training sentence partition; UPOS labels for that same partition train the auxiliary head. The model's validation partition controls early stopping. The held-out UD test is evaluated only after training. Reports include exact correct/covered/target counts, majority baseline, macro-F1 and seen/unseen-lemma slices.

## Interpretation

A stronger UPOS score indicates improved grammatical-category recognition under this auxiliary task. It is not a masked-word prediction score, a semantic-role score or proof of word meaning understanding. Further work should add supervised FEATS prediction and dependency-role evaluation, then test whether these auxiliary features improve independent lexical prediction and compositional generalization.
