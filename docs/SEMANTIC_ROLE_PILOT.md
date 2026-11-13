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

There is no gold-syntax versus predicted-syntax comparison in this run: `main` has no general dependency parser producing sentence trees for this runtime. PR #31 was not used because its CI failed at the benchmark entry point with `Dependency.create is not a function`.

## Russian resources and licensing

Russian FrameBank is highly relevant: it documents predicate–argument constructions, core/non-core roles, passive/imperative/negation alternations, and control/raising. Its README says the example index with sentence/context material is an external ~500 MB file, not included in the offline GitHub release; it also carries a copyright notice for source texts. The public repository is marked GPL-3.0. We did not silently ingest or redistribute the text corpus, and cannot claim a FrameBank held-out evaluation from the accessible annotation tables alone.

UD Russian-GSD 2.18 is an openly downloadable syntactic treebank (CC BY-SA 4.0), but it annotates UPOS, FEATS, and dependency relations—not semantic roles. It is useful for a future syntax-input experiment, not gold SRL by itself.

## Research notes and sources

- Kingsbury & Palmer (2002), *From Treebank to PropBank*, LREC; PropBank adds predicate–argument relations to syntactic trees. Project and frame resources: https://propbank.github.io/
- Palmer, Gildea & Kingsbury (2005), *The Proposition Bank: A Corpus Annotated with Semantic Roles*, Computational Linguistics 31(1). Bibliography: https://propbank.github.io/
- Berkeley ICSI FrameNet: lexical units are organized into semantic frames with frame elements and manually annotated examples. https://icsi.berkeley.edu/projects/framenet-project/
- Universal Dependencies v2: consistent cross-lingual POS, morphology, and typed dependency relations; core arguments and non-core dependents are syntax evidence, not identical to semantic roles. https://universaldependencies.org/ and https://universaldependencies.org/u/dep/all.html
- UD Russian-GSD treebank and license: https://universaldependencies.org/treebanks/ru_gsd/index.html
- Lyashevskaya & Kashkin (2015), *FrameBank: A Database of Russian Lexical Constructions*, AIST 2015, CCIS 542, pp. 350–360; offline resource: https://github.com/olesar/framebank
- Alimova, Tutubalina & Kirillovich (2020), *Cross-lingual Transfer Learning for Semantic Role Labeling in Russian*, CLIB 2020, pp. 72–80. Their reduced English FrameNet pretraining + Russian FrameBank fine-tuning reached 79.8 macro-F1 vs 78.4 baseline: https://aclanthology.org/2020.clib-1.8/
- Shi & Lin (2019), *Simple BERT Models for Relation Extraction and Semantic Role Labeling*, arXiv:1904.05255. Contextual pretrained BERT representations support SRL, but require a substantial pretrained encoder: https://arxiv.org/abs/1904.05255
- Chen et al. (2025), *Semantic Role Labeling: A Systematical Survey*, arXiv:2502.08660: https://arxiv.org/abs/2502.08660
- Zhang et al. (2019), *Semantics-aware BERT for Language Understanding*, arXiv:1909.02209: https://arxiv.org/abs/1909.02209

## Architectural conclusion

The practical path for this JavaScript-first project is a hybrid representation: keep the lightweight contextual model, add explicit predicate–argument and embedded-event structures with confidence/provenance, and later compare an optional pretrained multilingual encoder or external Russian SRL parser against this baseline. Do not train a large Transformer from scratch here. Public Transformer/BERT papers do not reveal the private internal architecture of ChatGPT or Claude; their full model/training details are not public.

## Limitations

- The OVS rule is restricted to an explicitly capitalized proper-name subject after the predicate.
- Control patterns require a finite matrix verb followed by one controller phrase, an infinitive, and its object; intervening adverbs, coordination, omitted controllers, nested control, and long-distance dependencies are not covered.
- Controller-case labels come from the selected construction family; this is not a general morphological analyzer.
- Twelve hand-built cases cannot establish corpus-level generalization or confidence calibration.
- No production dependency tree, gold syntax, or independent FrameBank SRL test split is available in this run.
