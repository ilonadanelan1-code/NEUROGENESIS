# Contextual lexical-sense pilot

## Goal and task definition

This experiment tests whether NEUROGENESIS can tell whether two occurrences of the same Russian target lemma express the same sense. It uses a Word-in-Context (WiC) formulation: given two contexts, predict SAME SENSE or DIFFERENT SENSE. It does not yet assign a stable dictionary sense ID to a single occurrence. This is a deliberate first milestone: compare uses reliably before introducing a dictionary inventory and single-occurrence sense assignment.

## Research findings and implications

- Vaswani et al. (2017), *Attention Is All You Need*, NeurIPS. The Transformer replaces recurrence with attention and can combine information from both sides of a target: https://arxiv.org/abs/1706.03762
- Devlin, Chang, Lee & Toutanova (2018/2019), *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding*, NAACL. Masked-language pretraining creates token representations conditioned on left and right context, followed by task-specific fine-tuning: https://arxiv.org/abs/1810.04805
- Pilehvar & Camacho-Collados (2019), *WiC: The Word-in-Context Dataset for Evaluating Context-Sensitive Meaning Representations*, NAACL, pp. 1267–1273, DOI 10.18653/v1/N19-1128: https://aclanthology.org/N19-1128/
- OpenAI, *GPT-4 Technical Report* (2023, revised 2024), arXiv:2303.08774. It publicly states that GPT-4 is Transformer-based, pretrained to predict the next token and then post-trained for alignment. It explicitly does not disclose the complete architecture or model size: https://arxiv.org/abs/2303.08774
- OpenAI Help Center, *How ChatGPT and our foundation models are developed*, updated October/November 2026. The current overview describes data preparation, pretraining, post-training, evaluation and continued improvement. It explains next-token learning and tokenization at a high level; it is not a detailed architecture specification: https://help.openai.com/en/articles/7842364-how-chatgpt-and-our-foundation-models-are-developed
- Anthropic, *Claude’s Constitution*, published 21 January 2026, CC0. Anthropic says the constitution describes intended values and behavior and plays a role in training. It is a behavioral/training-goals document, not a public neural architecture or a word-sense algorithm: https://www.anthropic.com/constitution
- Gusyatskaya & Lukashevich (2026), «Большие языковые модели в задаче разрешения лексической многозначности на материале русского языка», Электронные библиотеки, т. 29, № 4, pp. 1118–1132, DOI 10.26907/1562-5419-2026-29-4-1118-1132. The Russian WSD study compares small/medium decoder-only LMs, finds broad context and dictionary enrichment useful, and reports that direct generative use is not necessarily the most efficient classifier: https://rdl-journal.ru/article/view/1093
- Kokosinskiy (2026), «Большие языковые модели в задаче оценки семантической близости словоупотреблений», Электронные библиотеки, т. 29, № 4, pp. 1133–1154, DOI 10.26907/1562-5419-2026-29-4-1133-1154. It studies WiC with LLMs and correction from labelled examples without fine-tuning the large model, while noting substantial compute costs: https://rdl-journal.ru/article/view/1085
- Aksenova, Gavrishina, Rykov & Kutuzov (2022), *RuDSI: Graph-based Word Sense Induction Dataset for Russian*, TextGraphs-16, pp. 77–88: https://aclanthology.org/2022.textgraphs-1.9/
- Snegirev et al. (2024), *The Russian-focused embedders' exploration: ruMTEB benchmark and Russian embedding model design*, arXiv:2408.12503. This provides Russian embedding evaluation beyond generic English benchmarks: https://arxiv.org/abs/2408.12503

### Design decision

Do not attempt to reproduce a frontier ChatGPT/Claude architecture, train a large decoder-only model on a phone-sized codebase, or treat a next-token score as proof of sense understanding. The feasible path is:

1. Keep the existing small bidirectional masked-context Transformer.
2. Extract a target representation from surrounding context while masking the target surface from the attention input.
3. Train a small supervised comparison head on labelled usage pairs.
4. Compare it against a strong lexical TF-IDF/Jaccard baseline on identical splits.
5. Later, add licensed dictionary glosses and a proper morphological analyzer only if the experiment proves useful.

The current contextual model supports a window of up to eight tokens on either side. This pilot uses the maximum window because the 2026 Russian WSD study found wider context more informative than a narrow window. Dictionary enrichment is postponed until a compatible, licensed sense inventory is selected.

## Dataset and provenance

The CI benchmark reads the RNC noun subset from the public package repository lopuhin/ruslang-wsd-labeled, pinned to commit 67266b5bb21dd92e7def0bdc41adddb2584c1868. Its README describes human-labelled Russian contexts sampled from the Russian National Corpus (RNC) and RuTenTen, with sense definitions from the Active Dictionary. Its PyPI package metadata and setup.py declare MIT. This pilot uses only nouns/RNC/*.txt, fetches the data during CI, does not commit or redistribute the corpus, and records the exact upstream revision.

Important licensing caveat: the package declares MIT, but that declaration must not be assumed to override any separate terms applicable to source-corpus texts. The source corpus terms must be checked before redistribution or production training. The pilot does not vendor the texts.

RuSemCor (Zenodo DOI 10.5281/zenodo.15686750) is a valuable WordNet-annotated Russian corpus and was examined alongside RuDSI. The Zenodo landing page has an empty license field, so RuSemCor is not downloaded into this automated benchmark. RuDSI's provenance and annotation approach are documented, but a clearly confirmed data license was not found in the inspected metadata.

## Current NEUROGENESIS integration point

The main branch already contains contextual-attention.js. Its score(text, targetIndex) method:

- removes the target position from the attention context;
- returns contextualVector, derived from the surrounding tokens;
- returns tokenVector separately, representing target identity and subword composition;
- exposes conservative Russian stemming, verb-number hints and noun plural generation.

The limitation found in the audit is that the existing model is trained to predict a masked token and expose attention, but it has no explicit supervised objective for distinguishing two senses of the same lemma. The existing Russian morphology is heuristic: it does not provide a full lemma, case, gender or POS analysis.

The new lexical-sense.js module adds an isolated WiC comparison head. The baseline uses context TF-IDF/Jaccard overlap and surface/stem/number hints. The contextual variant adds pairwise contextual-vector and token-vector similarities, differences and products. Both logistic heads use the same labelled training pairs and validation log-loss checkpoint selection.

## Leakage controls and evaluation

- The contextual encoder is trained only on sentences from training lemmas and training contexts.
- The lexical comparison head is trained only on labelled training pairs.
- IDF, feature means and scales are computed only from training pairs.
- Validation contexts are separate from training contexts and select the logistic checkpoint.
- Known-lemma test contexts are held out from training and validation.
- Unseen-lemma test words are excluded entirely from encoder and classifier training.
- Exact normalized sentence duplicates are removed across partitions; the benchmark asserts zero remaining train/validation/test overlap.
- The benchmark uses three fixed seeds and reports exact counts, denominators, accuracy, macro-F1, coverage, confusion counts, known/unseen lemmas and false-merge/false-split examples.
- Baseline accuracy is also computed on the exact subset covered by contextual vectors, so coverage differences do not create a misleading comparison.

The lower/higher context-count buckets are only a proxy for the number of labelled examples available for a lemma, not a measure of its true frequency in Russian text.

## Reproduction

Run the unit test:

node tests/lexical-sense.test.js

The CI benchmark pins and checks out the upstream corpus revision, then runs:

git clone https://github.com/lopuhin/ruslang-wsd-labeled.git /tmp/ruslang-wsd-labeled
git -C /tmp/ruslang-wsd-labeled checkout 67266b5bb21dd92e7def0bdc41adddb2584c1868
node tests/lexical-sense-benchmark.test.js /tmp/ruslang-wsd-labeled/rl_wsd_labeled/nouns/RNC

The benchmark report is written to benchmark-reports/lexical-sense-context-v1.json and printed to the CI log.

## Interpretation and limitations

- WiC accuracy evaluates comparison of two occurrences; it does not prove full human-like understanding or a complete single-occurrence WSD solution.
- The corpus is small, old, noun-focused and drawn from one source corpus. It does not establish broad Russian coverage.
- The current model is small and local, not a frontier LLM. Its context vectors may be weak, especially on unseen lemmas.
- The morphological cues are approximate and must not be presented as full grammatical analysis.
- The model remains isolated from production/runtime. Do not merge unless the contextual head beats the paired TF-IDF baseline on unseen lemmas across seeds, has adequate coverage, has no leakage, and the full CI passes.
