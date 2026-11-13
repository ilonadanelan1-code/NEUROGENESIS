# NEUROGENESIS semantic-role pilot

## Scope and starting point

This experiment extends the existing `semantic-core.js`; it does not create a second semantic core. The current pipeline already extracts bounded propositions, builds semantic arguments, handles some passive/oblique complements, validates provenance, and links propositions across sentences. `phrase-composition.js` is a separate weakly supervised token-role/edge learner (subject, predicate, object, other); it learns from semantic-core labels and reports training-only accuracy, not independent SRL quality.

The audit found a concrete gap: common past forms such as `открыла` were absent from the bounded predicate inventory; controlled infinitival complements of `попросить`, `заставить`, `разрешить`, and `приказать` had no nested event representation; and a passive instrumental proper name such as `Анной` could be lost by the fixed instrumental-tail inventory.

## Implemented narrow extension

1. Adds common past-tense active forms for `открыть`.
2. Adds a deliberately bounded object-first rule when the post-verbal subject is an explicit internally capitalized proper-name phrase, e.g. `Дверь открыла Анна`. This is not a general OVS parser.
3. Adds controlled infinitive frames for finite forms of:
   - `попросить` → `request_content`, controller as accusative `addressee`;
   - `заставить` → `causative_content`, controller as accusative `causee`;
   - `разрешить` / `позволить` → `permission_content`, controller as dative `addressee`;
   - `приказать` / `велеть` → `command_content`, controller as dative `addressee`.
4. Represents the infinitive as `embeddedPropositions[]`, with its own predicate, object, argument roles, controller provenance, and `assertionStatus: not_independently_asserted`. A request or command is not silently promoted into a fact that the embedded action happened.
5. Extends passive instrumental-tail recognition to productive endings and recognizes a capitalized inflected proper name as an agent candidate.
6. Keeps fallback behavior for unsupported matrix predicates. `Анна убедила Бориса открыть дверь` remains unresolved rather than receiving guessed roles.

## Evaluation protocol

`node tests/semantic-role-pilot.test.mjs` loads the exact pre-experiment `semantic-core.js` from baseline commit `92eddaab0d914721e7732aae6f8345643216818c` with Node's VM and evaluates the current file on the same 12 manually curated cases: 11 positive structures, one unsupported-predicate abstention control, 36 expected role slots, and two held-out infinitive forms (`объяснить`, `включить`) with new entity names/nouns.

It reports exact full-frame accuracy, role micro precision/recall/F1, frame coverage, the known matrix-verb slice, the held-out infinitive slice, and unsupported-predicate abstention. The expected annotations are hand-authored regression diagnostics, not a statistically representative corpus benchmark.

RuSRL supplies gold `synt_head`, `sem_head`, and `sem_role` arrays. The external benchmark uses the gold semantic heads/roles to evaluate the current sentence-level core on single-predicate frames. `main` still does not emit a predicted dependency tree, so a gold-syntax versus predicted-syntax comparison is not available. PR #31 was not used because its CI failed at the benchmark entry point with `Dependency.create is not a function`.

## External RuSRL evaluation

The CI downloads the pinned `IsaNLP/RuSRL` JSONL revision `56080b4b6f77c39b0a57147b1025feaabd1d843e` and runs `tests/semantic-role-rusrl-benchmark.mjs`. The dataset card reports 1,500 rows in one `train` split, with `tokens`, gold syntactic heads (`synt_head`), gold semantic heads (`sem_head`), and semantic role labels (`sem_role`). Its license is CC BY-NC 4.0. The benchmark uses the rows evaluation-only—no fitting or tuning—and does not copy the dataset into this repository. It includes only sentences with one unique semantic head and at least one mapped role; it reports the skipped multi-predicate and unmapped cases. The mapped role subset is deliberately conservative: subject/agent, object/causate, causer, location, time, and instrument. This is an external diagnostic over the published train split, **not** an official held-out test split; do not treat its score as an unbiased leaderboard result.

Russian FrameBank is highly relevant: it documents predicate–argument constructions, core/non-core roles, passive/imperative/negation alternations, and control/raising. Its README says the example index with sentence/context material is an external ~500 MB file, not included in the offline GitHub release; it also carries a copyright notice for source texts. The public repository is marked GPL-3.0. We did not silently ingest or redistribute the text corpus, and cannot claim a FrameBank held-out evaluation from the accessible annotation tables alone.

UD Russian-GSD 2.18 is an openly downloadable syntactic treebank (CC BY-SA 4.0), but it annotates UPOS, FEATS, and dependency relations—not semantic roles. It is useful for a future syntax-input experiment, not gold SRL by itself. RuSRL provides a small gold semantic-role sample and gold syntax arrays, but has only one published split.

## Research notes and sources

- Kingsbury & Palmer (2002), *From Treebank to PropBank*, LREC; PropBank adds predicate–argument relations to syntactic trees. Project and frame resources: https://propbank.github.io/
- Palmer, Gildea & Kingsbury (2005), *The Proposition Bank: A Corpus Annotated with Semantic Roles*, Computational Linguistics 31(1). Bibliography: https://propbank.github.io/
- Berkeley ICSI FrameNet: lexical units are organized into semantic frames with frame elements and manually annotated examples. https://icsi.berkeley.edu/projects/framenet-project/
- Universal Dependencies v2: consistent cross-lingual POS, morphology, and typed dependency relations; core arguments and non-core dependents are syntax evidence, not identical to semantic roles. https://universaldependencies.org/ and https://universaldependencies.org/u/dep/all.html
- UD Russian-GSD treebank and license: https://universaldependencies.org/treebanks/ru_gsd/index.html
- IsaNLP/RuSRL dataset card and file (1.5k Russian rows, `synt_head` / `sem_head` / `sem_role`, CC BY-NC 4.0): https://huggingface.co/datasets/IsaNLP/RuSRL
- Lyashevskaya & Kashkin (2015), *FrameBank: A Database of Russian Lexical Constructions*, AIST 2015, CCIS 542, pp. 337–348; offline resource: https://github.com/olesar/framebank
- Alimova, Tutubalina & Kirillovich (2020), *Cross-lingual Transfer Learning for Semantic Role Labeling in Russian*, CLIB 2020, pp. 72–80. They compare BERT, XLM-R, MUSE and LASER; reduced English FrameNet pretraining + Russian FrameBank fine-tuning reached 79.8 macro-F1 vs 78.4 baseline: https://aclanthology.org/2020.clib-1.8/
- Larionov, Shelmanov, Chistova & Smirnov (2019), *Semantic Role Labeling with Pretrained Language Models for Known and Unknown Predicates*, RANLP 2019, pp. 620–628. The public IsaNLP FrameBank parser provides a Russian SRL implementation, but its README marks the code alpha and describes a Python 3.6/3.7 stack with Gensim 3.6, TensorFlow 1.x, ELMo embeddings, and separate morphology/syntax/SRL services: https://github.com/IINemo/isanlp_srl_framebank
- Vaswani et al. (2017), *Attention Is All You Need*, arXiv:1706.03762. The Transformer uses self-attention rather than recurrence/convolution, enabling contextual token interactions: https://arxiv.org/abs/1706.03762
- Devlin et al. (2019), *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding*, arXiv:1810.04805. BERT pretrains representations using left and right context and then fine-tunes them for downstream tasks: https://arxiv.org/abs/1810.04805
- OpenAI (2023; revised 2024), *GPT-4 Technical Report*, arXiv:2303.08774. It publicly describes GPT-4 as Transformer-based, pretrained to predict the next token, followed by post-training alignment; it does not disclose the full architecture or training recipe: https://arxiv.org/abs/2303.08774
- Shi & Lin (2019), *Simple BERT Models for Relation Extraction and Semantic Role Labeling*, arXiv:1904.05255. Contextual pretrained BERT representations support SRL, but require a substantial pretrained encoder: https://arxiv.org/abs/1904.05255
- Chen et al. (2025; revised June 2026), *A Systematic Survey of Semantic Role Labeling in the Era of Pretrained Language Models*, arXiv:2502.08660: https://arxiv.org/abs/2502.08660
- Zhang et al. (2019), *Semantics-aware BERT for Language Understanding*, arXiv:1909.02209: https://arxiv.org/abs/1909.02209

## Architectural conclusion

The Transformer/BERT literature supports using contextual representations for token-level ambiguity, while SRL supplies an explicit predicate–argument layer. SemBERT is a useful hybrid example: it injects contextual SRL features into a BERT backbone rather than assuming that plain contextual embeddings already expose named semantic roles. The Russian FrameBank transfer study likewise shows measurable gains from multilingual contextual encoders, but it relies on pretrained models and annotated data; training a comparable encoder from scratch is not a sensible next step for this small JavaScript project. The GPT-4 report gives only the public high-level description noted above; no conclusion about private ChatGPT or Claude internals follows from it. A model constitution or alignment policy is not an architecture specification.

The practical path for this JavaScript-first project is a hybrid representation: keep the lightweight contextual model, add explicit predicate–argument and embedded-event structures with confidence/provenance, and later compare an optional pretrained multilingual encoder or external Russian SRL parser against this baseline. Do not train a large Transformer from scratch here. Public Transformer/BERT papers do not reveal the private internal architecture of ChatGPT or Claude; their full model/training details are not public.

## Limitations

- The OVS rule is restricted to an explicitly capitalized proper-name subject after the predicate.
- Control patterns require a finite matrix verb followed by one controller phrase, an infinitive, and its object; intervening adverbs, coordination, omitted controllers, nested control, and long-distance dependencies are not covered.
- Controller-case labels come from the selected construction family; this is not a general morphological analyzer.
- Twelve hand-built cases cannot establish corpus-level generalization or confidence calibration.
- No production dependency tree is available, so predicted-syntax evaluation remains unavailable. RuSRL has only one published split and the FrameBank offline release lacks its external sentence/context index; neither supplies an official independent test split for this experiment.
