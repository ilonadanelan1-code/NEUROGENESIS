# UD Russian-GSD external language pilot

This experiment uses the Russian Universal Dependencies treebank **UD_Russian-GSD**, release **r2.18**, pinned to upstream commit:

- Repository: https://github.com/UniversalDependencies/UD_Russian-GSD
- Pinned commit: https://github.com/UniversalDependencies/UD_Russian-GSD/commit/9acc9d677327043bd416fcc89e4b3407c620d885
- Upstream files: ru_gsd-ud-train.conllu and ru_gsd-ud-test.conllu
- Upstream LICENSE.txt: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
- Treebank contributors listed upstream: Ryan McDonald, Vitaly Nikolaev, Olga Lyashevskaya.
- Upstream README describes the treebank as annotated and converted by Google; its changelog states that Google dropped the NC restriction for UD annotations, while distinguishing the underlying text and saying Google claims no ownership or copyright in that text.

The CI job fetches the pinned files directly from the upstream repository; this project does **not** vendor or redistribute the corpus. The text source and annotation layers should not be assumed to have identical rights. Before redistributing any extracted sentences or derived dataset, re-check the upstream notices and the rights of the underlying source texts. Attribution and ShareAlike requirements apply to adaptations of the licensed treebank layer.

## Preparation and leakage controls

- The importer reads the CoNLL-U text comment, falling back to token forms only when that field is absent.
- HTML entities and the treebank's paired backtick quotation convention are decoded.
- Sentence identity is calculated from normalized Unicode word tokens, with ё normalized to е; punctuation-only differences do not evade duplicate detection.
- Duplicate rows are removed. Any normalized sentence found in both upstream train and test is excluded from the training pool.
- A deterministic hash sampler selects at most 160 training sentences and 240 external test sentences, with seed 20261112.
- The model creates its own train/validation/internal-test split from the 160 training sentences. The official UD test sample remains outside model training and internal validation.
- The model currently has a 160-row corpus input cap and a 512-token vocabulary cap. This pilot respects those limits; it does not silently expand them.
- Results are exploratory and specific to a Wikipedia-style treebank. They are not a general conversational Russian benchmark and are reported separately from the frozen 49-sentence benchmark.

Run locally after obtaining the two upstream files:

    node tests/ud-russian-gsd-benchmark.test.js path/to/ru_gsd-ud-train.conllu path/to/ru_gsd-ud-test.conllu
