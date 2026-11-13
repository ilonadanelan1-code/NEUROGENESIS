# NEUROGENESIS — bounded discourse coreference pilot

## Scope and diagnosed gap

The current semantic core resolves entity references inside a single proposition chain. Its local resolver searches up to six preceding propositions. The dialogue context manager, in contrast, stores thread messages, short extractive summaries, anchors and pending questions. It does not retain a typed, thread-local inventory of discourse entities.

The semantic query planner previously analysed the current query and used one prior user utterance as contextText. That can provide a broad subject hint, but it does not identify which entity inside that utterance a pronoun denotes. In particular, the parser's within-message antecedent resolver cannot link a pronoun in a later user turn to an entity mentioned in a prior turn.

This pilot tests one narrow fix: build a bounded candidate set from the existing semantic parser's subject/object/argument frames for the active thread, then rank candidate antecedents using agreement, semantic role, syntactic role, salience and recency. It does not create a second semantic parser.

## Research and method selection

1. **Lee, He, Lewis & Zettlemoyer (2017), “End-to-end Neural Coreference Resolution.”** The model learns contextual span representations and scores antecedents for each mention, with marginal likelihood over gold antecedents. This is a strong conceptual reference for candidate ranking, but its end-to-end span enumeration and neural encoder are too expensive to reproduce in this small browser project without a suitable pretrained encoder and labeled training data.  
   https://arxiv.org/abs/1707.07045

2. **Barzilay & Lapata (2008), “Modeling Local Coherence: An Entity-Based Approach.”** The entity grid records each entity's syntactic role across adjacent sentences. This supports a lightweight feature-based approach: retain whether an entity is a subject, object or semantic argument, rather than using recency alone.  
   https://aclanthology.org/J08-1001/  
   DOI: https://doi.org/10.1162/coli.2008.34.1.1

3. **Dobrovolskii, Michurina & Ivoylova (2022), “RuCoCo: a new Russian corpus with coreference annotation.”** The paper reports about one million words and roughly 150,000 mentions, with Russian news texts and public availability.  
   https://arxiv.org/abs/2206.04925

4. **RuCoCo-2023 shared task.** The organizer repository documents a JSON format with character-offset mention spans grouped into entity chains, separate includes for split antecedents, and LEA scoring. Its README reports about one million train/dev words. The GitHub repository exposes train.zip, test_public.zip and test_private.zip, but neither the repository metadata nor README identifies a dataset license. The older annotation-materials repository also has no GitHub license metadata. Public download is not the same as a verified reuse/redistribution license; this pilot therefore does not download, copy, train on, or redistribute RuCoCo data.  
   https://github.com/dialogue-evaluation/RuCoCo-2023  
   https://github.com/vdobrovolskii/rucoco  
   Competition page: https://dialogue-conf.org/evaluation/rucoco-2023/

5. **Russian lightweight baseline.** Chistova & Smirnov (2023), “Light Coreference Resolution for Russian with Hierarchical Discourse Features,” is relevant because it adds discourse structure to Russian coreference. Its reported RuCoCo shared-task setting is more appropriate than simply importing an English-only resolver, but the published model is still a learned system and cannot be assumed to transfer to this project's parser without its data and dependencies.  
   https://arxiv.org/abs/2306.01465

6. **Public LLM training information.** OpenAI's GPT-4 Technical Report describes GPT-4 as Transformer-based and pretrained to predict the next token, followed by post-training alignment. OpenAI's current foundation-model overview describes data preparation, pretraining, post-training and ongoing evaluation. These sources support the general lesson that contextual language competence is learned through large-scale training and later refinement; they do not disclose the full architecture of current ChatGPT models. Anthropic's January 2026 Claude Constitution is a public behavior/values document, not a technical description of Claude's coreference architecture.  
   https://arxiv.org/abs/2303.08774  
   https://help.openai.com/en/articles/7842364-how-chatgpt-and-our-foundation-models-are-developed  
   https://github.com/anthropics/claude-constitution

7. **Russian syntactic annotations.** UD Russian GSD is available under CC BY-SA 4.0 and can supply morphology/dependency features, but it is not a gold coreference corpus.  
   https://universaldependencies.org/treebanks/ru_gsd/index.html

## Engineering decision

discourse-coreference.js is a bounded, rule-scored antecedent ranker. It reuses NGSemanticCore.analyse() to obtain existing subject/object and semantic argument candidates from the last eight messages in the active thread. It scores:

- gender and number agreement (hard incompatibilities are excluded);
- pronoun case and semantic argument compatibility (e.g. dative → recipient/beneficiary; instrumental → instrument/agent);
- syntactic prominence (subject/object);
- entity salience and mention recurrence inside the bounded thread window;
- turn/sentence recency.

The resolver returns resolved, ambiguous, unresolved or not_applicable, along with candidate scores, reason codes, confidence and provenance. It refuses to choose when the score or top-candidate margin is insufficient. A topic ID filter prevents linking to an entity from another thread.

The semantic-query integration is **opt-in only** via window.NG_DISCOURSE_COREFERENCE_EXPERIMENT === true; default runtime behavior remains unchanged. Resolutions are labeled context_candidate, not verified facts. The module explicitly reports memoryEffect: "none" and never writes to long-term memory. Repeated identical surface forms are grouped only within the bounded active-thread window; this is not persistent real-world identity resolution and can conflate homonyms.

## Data and evaluation

RuCoCo is not used because its dataset reuse license could not be verified from the official repository metadata/readme. The added 24-case contrast set is hand-authored and explicitly diagnostic, not a representative corpus. It covers agreement, semantic-role/case conflicts, long-distance candidates, topic boundaries, ambiguity and missing antecedents. It is not used for training and has no train/test split.

The benchmark compares:
- a nearest-compatible-mention baseline (recency, with ties abstaining);
- the experimental agreement + case/role + salience + recency ranker with score/margin abstention.

Metrics are exact accuracy, link precision/recall/F1, coverage, false-link rate and correct-abstention rate, with slices by diagnostic category. These figures measure only this curated diagnostic set; they must not be presented as corpus-level Russian coreference performance.

## Runtime boundary and limitations

- Candidate extraction inherits the existing rule parser's errors and cannot discover mentions the parser misses.
- The pilot supports personal pronouns and a small set of Russian inflectional forms; event demonstratives such as “это” are intentionally out of scope.
- Surface-form grouping can conflate same-name entities. No persistent entity IDs are created.
- There is no learned encoder, no RuCoCo supervision and no calibrated probability model.
- Full-document coreference metrics such as LEA, MUC, B³ or CEAF cannot be claimed from this diagnostic set.
- The feature is off by default until an appropriately licensed corpus and independent evaluation justify enabling it.
