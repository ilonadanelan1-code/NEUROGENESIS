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

3. **Grosz, Joshi & Weinstein (1995), “Centering: A Framework for Modeling the Local Coherence of Discourse.”** Centering theory models which discourse entity is most central from one utterance to the next. It motivates salience and continuity features, but also warns against reducing reference to nearest-mention distance alone.  
   https://aclanthology.org/J95-2003/

4. **Dobrovolskii, Michurina & Ivoylova (2022), “RuCoCo: a new Russian corpus with coreference annotation.”** The paper reports about one million words and roughly 150,000 mentions, with Russian news texts and public availability.  
   https://arxiv.org/abs/2206.04925

5. **RuCoCo-2023 shared task.** The organizer repository documents a JSON format with character-offset mention spans grouped into entity chains, separate includes for split antecedents, and LEA scoring. Its README reports about one million train/dev words. The GitHub repository exposes train.zip, test_public.zip and test_private.zip, but neither the repository metadata nor README identifies a dataset license. The older annotation-materials repository also has no GitHub license metadata. Public download is not the same as a verified reuse/redistribution license; this pilot therefore does not download, copy, train on, or redistribute RuCoCo data.  
   https://github.com/dialogue-evaluation/RuCoCo-2023  
   https://github.com/vdobrovolskii/rucoco  
   Competition page: https://dialogue-conf.org/evaluation/rucoco-2023/

6. **Russian lightweight baseline.** Chistova & Smirnov (2023), “Light Coreference Resolution for Russian with Hierarchical Discourse Features,” is relevant because it adds discourse structure to Russian coreference. Its reported RuCoCo shared-task setting is more appropriate than simply importing an English-only resolver, but the published model is still a learned system and cannot be assumed to transfer to this project's parser without its data and dependencies.  
   https://arxiv.org/abs/2306.01465

**Transformer and contextual language representations.** Vaswani et al. (2017) introduced the Transformer as an attention-only encoder/decoder architecture. Devlin et al. (2018) showed that bidirectional contextual pretraining (BERT) can support downstream tasks with a task-specific output layer. These works explain why contextual representations are preferable to isolated word-form lookup, but reproducing a large pretrained encoder is outside this pilot's resource budget.  
   https://arxiv.org/abs/1706.03762  
   https://arxiv.org/abs/1810.04805

**Retrieval and memory separation.** Lewis et al. (2020) distinguish parametric model knowledge from explicit non-parametric retrieval memory. For NEUROGENESIS, the analogous engineering boundary is: active-thread discourse candidates are ephemeral context; long-term user knowledge is a separate evidence-backed store. A pronoun resolution hypothesis must not silently become a persistent fact.  
   https://arxiv.org/abs/2005.11401

**LEA evaluation.** Moosavi & Strube (2016) proposed the link-based entity-aware metric used by the RuCoCo-2023 organizers. A real corpus evaluation should report LEA and preferably standard coreference metrics (MUC, B³ and CEAF), not only local pronoun accuracy.  
   https://aclanthology.org/P16-1060/

7. **Public LLM training information.** OpenAI's GPT-4 Technical Report describes GPT-4 as Transformer-based and pretrained to predict the next token, followed by post-training alignment. OpenAI's current foundation-model overview describes data preparation, pretraining, post-training and ongoing evaluation. These sources support the general lesson that contextual language competence is learned through large-scale training and later refinement; they do not disclose the full architecture of current ChatGPT models. Anthropic's January 2026 Claude Constitution is a public behavior/values document, not a technical description of Claude's coreference architecture.  
   https://arxiv.org/abs/2303.08774  
   https://help.openai.com/en/articles/7842364-how-chatgpt-and-our-foundation-models-are-developed  
   https://github.com/anthropics/claude-constitution

8. **Russian syntactic annotations.** UD Russian GSD is available under CC BY-SA 4.0 and can supply morphology/dependency features, but it is not a gold coreference corpus.  
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
- a nearest-compatible-mention baseline (recency, with ties abstaining); this is a simple comparator, not a claim that the existing application already performs cross-turn entity linking;
- the experimental agreement + case/role + salience + recency ranker with score/margin abstention.

The 24 benchmark cases provide explicit candidate records, so these metrics evaluate ranking and abstention given candidate mentions. Candidate extraction from real active-thread messages is covered separately by unit/integration tests; parser candidate recall is not measured by the 24-case score. Coverage is the fraction of diagnostic queries linked by the ranker, not end-to-end mention-detection coverage. Metrics are exact accuracy, link precision/recall/F1, coverage, false-link rate and correct-abstention rate, with slices by diagnostic category. These figures measure only this curated diagnostic set; they must not be presented as corpus-level Russian coreference performance.

## Diagnostic results (24 hand-authored cases)

The first complete benchmark run on this branch produced the following paired counts. The benchmark is deterministic and contains no training; later commits changed only query-hint ordering and possessive-pronoun detection, not the scoring or benchmark cases.

| Metric | Nearest-compatible baseline | Experimental ranker | Change |
|---|---:|---:|---:|
| Exact decision accuracy | 14/24 = 58.33% | 20/24 = 83.33% | +25.00 pp |
| Link precision | 8/18 = 44.44% | 14/14 = 100.00% | +55.56 pp |
| Link recall | 8/18 = 44.44% | 14/18 = 77.78% | +33.33 pp |
| Link F1 | 44.44% | 87.50% | +43.06 pp |
| Coverage | 18/24 = 75.00% | 14/24 = 58.33% | −16.67 pp |
| False-link rate | 10/18 = 55.56% | 0/14 = 0.00% | −55.56 pp |
| Correct abstention | 6/6 = 100% | 6/6 = 100% | 0 pp |

The ranker deliberately makes fewer links. It removes all false links in this diagnostic set at the cost of lower coverage. Category results: agreement 4/4 for both; semantic-role cases 0/8 baseline vs 6/8 experiment; long-distance 2/3 for both; explicit topic return 1/2 for both; ambiguous 3/3 correct abstentions for both; unresolved 2/2 for both; topic-switch boundary 2/2 exact decisions for both. The small long-distance and topic-return slices show no measured improvement and are too small for generalization claims.

There is no unseen-lemma score: the set is hand-authored, has no corpus split and is not a generalization benchmark. No corpus-level or statistical claim follows from these numbers.

## Runtime boundary and limitations

- Candidate extraction inherits the existing rule parser's errors and cannot discover mentions the parser misses.
- The pilot resolves only the first supported personal-pronoun mention in a query and supports a limited set of Russian inflectional forms; event demonstratives such as “это” are intentionally out of scope.
- Candidate gender/number inference is a conservative suffix heuristic when the parser does not provide a feature; homonyms, rare inflections and ambiguous soft-sign nouns can remain unresolved or be misclassified.
- Surface-form grouping can conflate same-name entities. No persistent entity IDs are created.
- There is no learned encoder, no RuCoCo supervision and no calibrated probability model.
- Full-document coreference metrics such as LEA, MUC, B³ or CEAF cannot be claimed from this diagnostic set.
- The feature is off by default until an appropriately licensed corpus and independent evaluation justify enabling it.
