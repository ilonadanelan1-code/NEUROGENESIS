"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const fixtureTrain = [
  "# sent_id = train-1",
  "# text = Нейрон получает сигнал.",
  "1\tНейрон\tнейрон\tNOUN\t_\tCase=Nom|Number=Sing\t2\tnsubj\t_\t_",
  "2\tполучает\tполучать\tVERB\t_\tMood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin\t0\troot\t_\t_",
  "3\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t2\tobj\t_\t_",
  "",
  "# sent_id = train-2",
  "# text = Сеть хранит данные.",
  "1\tСеть\tсеть\tNOUN\t_\tCase=Nom|Number=Sing\t2\tnsubj\t_\t_",
  "2\tхранит\tхранить\tVERB\t_\tMood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin\t0\troot\t_\t_",
  "3\tданные\tданные\tNOUN\t_\tCase=Acc|Number=Plur\t2\tobj\t_\t_",
  ""
].join("\n");
const fixtureTest = [
  "# sent_id = test-1",
  "# text = Нейрон получает сигнал!",
  "1\tНейрон\tнейрон\tNOUN\t_\t_\t2\tnsubj\t_\t_",
  "2\tполучает\tполучать\tVERB\t_\t_\t0\troot\t_\t_",
  "3\tсигнал\tсигнал\tNOUN\t_\t_\t2\tobj\t_\t_",
  "",
  "# sent_id = test-2",
  "# text = Память сохраняет важные события.",
  "1\tПамять\tпамять\tNOUN\t_\t_\t2\tnsubj\t_\t_",
  "2\tсохраняет\tсохранять\tVERB\t_\t_\t0\troot\t_\t_",
  "3\tважные\tважный\tADJ\t_\t_\t4\tamod\t_\t_",
  "4\tсобытия\tсобытие\tNOUN\t_\t_\t2\tobj\t_\t_",
  ""
].join("\n");
assert.equal(importer.decodeEntities("тест &#39;пример&#39; &amp; текст"), "тест 'пример' & текст");
assert.deepEqual(importer.parseFeatures("__proto__=polluted|Case=Nom|Number=Sing"),
 {Case:"Nom",Number:"Sing"},"only valid UD feature keys may enter the annotation map");

const unsafeAnnotationSummary = importer.annotationSummary([{
  tokens: [{upos: "__proto__", deprel: "__proto__", feats: {}}]
}]);
assert.equal(Object.getPrototypeOf(unsafeAnnotationSummary.upos), null);
assert.equal(unsafeAnnotationSummary.upos.__proto__, 1);
assert.equal(unsafeAnnotationSummary.dependencyRelations.__proto__, 1);

const parsedFixture = importer.parseConllu(fixtureTrain);
assert.equal(parsedFixture.length, 2);
assert.equal(parsedFixture[0].tokenCount, 3);
assert.equal(parsedFixture[0].sentenceId, "train-1");
assert.equal(parsedFixture[0].annotationTokenCount, 3);
assert.equal(parsedFixture[0].tokens[0].lemma, "нейрон");
assert.equal(parsedFixture[0].tokens[0].upos, "NOUN");
assert.deepEqual(parsedFixture[0].tokens[0].feats, {Case: "Nom", Number: "Sing"});
assert.equal(parsedFixture[0].tokens[1].feats.VerbForm, "Fin");
assert.equal(parsedFixture[0].tokens[1].head, 0);
assert.equal(parsedFixture[0].tokens[1].deprel, "root");

const fixtureOptions = {trainLimit: 10, testLimit: 10, minimumTokens: 3, maximumTokens: 20, seed: 17};
const preparedFixture = importer.prepareCorpus(fixtureTrain, fixtureTest, fixtureOptions);
assert.equal(preparedFixture.stats.normalizedTrainTestOverlapsExcluded, 1);
assert.equal(preparedFixture.stats.normalizedSampleTrainTestOverlaps, 0);
assert.equal(preparedFixture.trainingTexts.length, 1);
assert.equal(preparedFixture.trainingTexts[0], "Сеть хранит данные.");
assert.equal(preparedFixture.trainingRecords.length, 1);
assert.equal(preparedFixture.trainingRecords[0].sentenceId, "train-2");
assert.equal(preparedFixture.trainingRecords[0].tokens[0].lemma, "сеть");
assert.equal(preparedFixture.trainingRecords[0].tokens[0].upos, "NOUN");
assert.equal(preparedFixture.testRecords.length, 2);
assert.equal(preparedFixture.stats.annotations.training.sentences, 1);
assert.equal(preparedFixture.stats.annotations.training.tokens, 3);
assert.equal(preparedFixture.stats.annotations.training.lemmaAnnotated, 3);
assert.equal(preparedFixture.stats.annotations.training.featureAnnotated, 3);
assert.equal(preparedFixture.stats.annotations.training.upos.NOUN, 2);
assert.equal(preparedFixture.stats.annotations.training.upos.VERB, 1);
assert.equal(preparedFixture.stats.annotations.test.sentences, 2);
assert.equal(preparedFixture.stats.annotations.test.tokens, 7);

assert.deepEqual(
  importer.prepareCorpus(fixtureTrain, fixtureTest, fixtureOptions).trainingTexts,
  preparedFixture.trainingTexts,
  "training sample must be deterministic"
);

const structuralRows = importer.parseConllu([
  "# sent_id = structural-1",
  "# text = Мы видим связь.",
  "1-2\tМы видим\t_\t_\t_\t_\t_\t_\t_\t_",
  "1\tМы\tмы\tPRON\t_\tCase=Nom\t2\tnsubj\t_\t_",
  "1.1\tмы\tмы\tX\t_\t_\t_\t_\t_\t_",
  "2\tвидим\tвидеть\tVERB\t_\tMood=Ind\t0\troot\t_\t_",
  "3\tсвязь\tсвязь\tNOUN\t_\tCase=Acc\t2\tobj\t_\t_",
  ""
].join("\n"));
assert.equal(structuralRows[0].tokens.length, 3,
  "multiword ranges and empty nodes must not become duplicate lexical annotations");
assert.deepEqual(structuralRows[0].tokens.map(row => row.id), [1, 2, 3]);

const trainPath = process.argv[2];
const testPath = process.argv[3];
if (!trainPath && !testPath) {
  console.log("NEUROGENESIS UD Russian-GSD importer fixtures: passed; external corpus files not supplied.");
} else {
  assert.ok(trainPath && testPath, "supply both pinned UD train and test CoNLL-U files");
  const trainContent = fs.readFileSync(trainPath, "utf8");
  const testContent = fs.readFileSync(testPath, "utf8");
  const prepared = importer.prepareCorpus(trainContent, testContent, {
    trainLimit: 320, testLimit: 240, seed: 20261112, minimumTokens: 4, maximumTokens: 40
  });
  assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps, 0);
  assert.equal(prepared.trainingTexts.length, 320);
  assert.equal(prepared.testTexts.length, 240);

  const window = {};
  const sandbox = {window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number};
  vm.runInNewContext(fs.readFileSync("contextual-attention.js", "utf8"), sandbox,
    {filename: "contextual-attention.js"});
  const Attention = window.NGContextualModel;
  assert.ok(Attention && Attention.schema === "NG_CONTEXTUAL_ATTENTION_V5");

  const seeds = [
    {model: 9173, split: 902},
    {model: 31415, split: 2718},
    {model: 2718, split: 9044}
  ];
  const seedReports = [];
  const createFrequencyBuckets = () => ({
    "1": {targets: 0, correct: 0},
    "2-4": {targets: 0, correct: 0},
    "5-9": {targets: 0, correct: 0},
    "10+": {targets: 0, correct: 0}
  });
  const mergeFrequencyBuckets = (target, source) => {
    for (const key of Object.keys(target)) {
      target[key].targets += source[key].targets;
      target[key].correct += source[key].correct;
    }
  };
  const summarizeFrequencyBuckets = buckets => Object.fromEntries(
    Object.entries(buckets).map(([range, counts]) => [range, {
      targets: counts.targets,
      correct: counts.correct,
      accuracy: ratio(counts.correct, counts.targets)
    }])
  );
  const aggregateFrequencyBuckets = createFrequencyBuckets();
  const aggregate = {
    total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
    oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
    oovPluralHintTargets: 0, oovPluralKnownBaseTargets: 0, oovPluralKnownBaseHits: 0,
    oovPluralNoKnownBaseTargets: 0, oovPluralAmbiguousBaseTargets: 0,
    strictCovered: 0, strictCorrect: 0, inversionCovered: 0, inversionCorrect: 0,
    strictSurfaceCovered: 0, strictSurfaceCorrect: 0, contextBackoffs: 0
  };
  const add = (target, source) => {
    for (const key of Object.keys(target)) target[key] += source[key] || 0;
  };
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

  for (const seed of seeds) {
    const model = Attention.create({
      dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: seed.model
    });
    const training = model.train(prepared.trainingTexts, {
      epochs: 20, learningRate: 0.02, patience: 8, splitSeed: seed.split
    });
    assert.ok(training.trainRows > 0 && training.vocabularySize > 1);
    assert.ok(model.status().trainingContextExamples > 0);
    const retrievalIndexStartedAt = Date.now();
    const retrievalIndex = model.retrievalIndexStatus();
    const retrievalIndexBuildMs = Date.now() - retrievalIndexStartedAt;
    assert.equal(retrievalIndex.built, true,
      "the independent benchmark must build the indexed OOV retrieval structure");
    assert.equal(retrievalIndex.exampleCount, model.status().trainingContextExamples);
    assert.ok(retrievalIndex.indexedContextPositions > 0);

    const trainingSplit = model.splitCorpus(prepared.trainingTexts, seed.split);
    assert.equal(trainingSplit.train.length, training.trainRows,
      "frequency diagnostics must use the exact model training partition");
    const trainingTokenFrequency = new Map();
    for (const row of trainingSplit.train) {
      for (const token of Attention.tokenize(row)) {
        trainingTokenFrequency.set(token, (trainingTokenFrequency.get(token) || 0) + 1);
      }
    }

    const pluralCandidateBaseCounts = new Map();
    for (const base of model.exportState().vocabulary) {
      const surface = Attention.russianNounPlural(base);
      if (surface) pluralCandidateBaseCounts.set(surface, (pluralCandidateBaseCounts.get(surface) || 0) + 1);
    }
    const metrics = {
      frequencyBuckets: createFrequencyBuckets(),
      total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
      oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
      oovPluralHintTargets: 0, oovPluralKnownBaseTargets: 0, oovPluralKnownBaseHits: 0,
      oovPluralNoKnownBaseTargets: 0, oovPluralAmbiguousBaseTargets: 0,
      strictCovered: 0, strictCorrect: 0, inversionCovered: 0, inversionCorrect: 0,
      strictSurfaceCovered: 0, strictSurfaceCorrect: 0, contextBackoffs: 0
    };
    for (const sentence of prepared.testTexts) {
      const tokens = Attention.tokenize(sentence);
      for (let index = 0; index < tokens.length; index++) {
        metrics.total++;
        const score = model.score(sentence, index);
        if (!score) continue;
        metrics.contextBackoffs += score.contextMorphologyBackoffs.length;
        if (score.targetKnown) {
          metrics.known++;
          const frequency = trainingTokenFrequency.get(tokens[index]) || 0;
          assert.ok(frequency > 0, "known targets must occur in the training partition");
          const frequencyBand = frequency === 1 ? "1" : frequency <= 4 ? "2-4" :
            frequency <= 9 ? "5-9" : "10+";
          metrics.frequencyBuckets[frequencyBand].targets++;
          if (score.predictions[0]?.token === tokens[index]) {
            metrics.exact++;
            metrics.frequencyBuckets[frequencyBand].correct++;
          }
        }
        if (score.morphologyKnown) {
          metrics.morphologyCovered++;
          if (score.morphologyCorrect) metrics.morphologyCorrect++;
        }
        if (score.targetKnown) continue;
        metrics.oov++;
        const strictPrediction = model.predictMasked(sentence, index);
        if (strictPrediction?.morphologyHint?.number === "plural") {
          metrics.oovPluralHintTargets++;
          const baseCount = pluralCandidateBaseCounts.get(tokens[index]) || 0;
          if (baseCount > 0) {
            metrics.oovPluralKnownBaseTargets++;
            if (baseCount > 1) metrics.oovPluralAmbiguousBaseTargets++;
            if (strictPrediction.generatedCandidates?.some(row => row.surface === tokens[index])) {
              metrics.oovPluralKnownBaseHits++;
            }
          } else {
            metrics.oovPluralNoKnownBaseTargets++;
          }
        }
        const inversionPrediction = model.predictMasked(sentence, index, {allowOrderInversion: true});
        const generated = strictPrediction?.generatedPrediction;
        if (generated) {
          metrics.generatedCovered++;
          if (generated.surface === tokens[index]) metrics.generatedCorrect++;
        }
        if (strictPrediction?.generatedCandidates?.some(row => row.surface === tokens[index])) {
          metrics.generatedCandidateHits++;
        }
        const strictCandidate = strictPrediction?.retrievalCandidate;
        if (strictCandidate) {
          metrics.strictCovered++;
          if (Attention.russianStem(strictCandidate.token) === Attention.russianStem(tokens[index])) {
            metrics.strictCorrect++;
          }
        }
        if (strictPrediction?.retrievalPrediction) {
          metrics.strictSurfaceCovered++;
          if (strictPrediction.retrievalPrediction.surface === tokens[index]) metrics.strictSurfaceCorrect++;
        }
        const inversionCandidate = inversionPrediction?.retrievalCandidate;
        if (inversionCandidate) {
          metrics.inversionCovered++;
          if (Attention.russianStem(inversionCandidate.token) === Attention.russianStem(tokens[index])) {
            metrics.inversionCorrect++;
          }
        }
      }
    }
    assert.equal(metrics.oovPluralHintTargets,
      metrics.oovPluralKnownBaseTargets + metrics.oovPluralNoKnownBaseTargets,
      "every plural-hint OOV target must be classified by current vocabulary support");
    assert.ok(metrics.oovPluralKnownBaseHits <= metrics.oovPluralKnownBaseTargets,
      "top-eight generated hits cannot exceed targets with a known base candidate");
    add(aggregate, metrics);
    mergeFrequencyBuckets(aggregateFrequencyBuckets, metrics.frequencyBuckets);
    seedReports.push({
      modelSeed: seed.model,
      splitSeed: seed.split,
      training: {
        inputRows: prepared.trainingTexts.length,
        trainRows: training.trainRows,
        validationRows: training.validationRows,
        internalTestRows: training.testRows,
        vocabularySize: training.vocabularySize,
        vocabularyCapacity: 1024,
        vocabularySaturated: training.vocabularySize >= 1024,
        trainingContextExamples: model.status().trainingContextExamples,
        contextRetrievalIndex: retrievalIndex,
        contextRetrievalIndexBuildMs: retrievalIndexBuildMs,
        epochs: training.epochs
      },
      metrics: {
        targets: metrics.total,
        knownTargetCoverage: ratio(metrics.known, metrics.total),
        exactKnownTargetAccuracy: ratio(metrics.exact, metrics.known),
        frequencyBuckets: summarizeFrequencyBuckets(metrics.frequencyBuckets),
        allTargetExactAccuracy: ratio(metrics.exact, metrics.total),
        morphology: {
          correct: metrics.morphologyCorrect, covered: metrics.morphologyCovered,
          accuracy: ratio(metrics.morphologyCorrect, metrics.morphologyCovered),
          coverage: ratio(metrics.morphologyCovered, metrics.total)
        },
        oovGeneration: {
          correct: metrics.generatedCorrect, covered: metrics.generatedCovered,
          oovTargets: metrics.oov, accuracy: ratio(metrics.generatedCorrect, metrics.generatedCovered),
          coverage: ratio(metrics.generatedCovered, metrics.oov),
          candidateRecallAt8: ratio(metrics.generatedCandidateHits, metrics.oov)
        },
        contextRetrievalStrict: {
          correct: metrics.strictCorrect, covered: metrics.strictCovered, oovTargets: metrics.oov,
          precision: ratio(metrics.strictCorrect, metrics.strictCovered),
          coverage: ratio(metrics.strictCovered, metrics.oov)
        },
        contextRetrievalOrderInvariant: {
          correct: metrics.inversionCorrect, covered: metrics.inversionCovered, oovTargets: metrics.oov,
          precision: ratio(metrics.inversionCorrect, metrics.inversionCovered),
          coverage: ratio(metrics.inversionCovered, metrics.oov)
        },
        strictRetrievalSurface: {
          correct: metrics.strictSurfaceCorrect, covered: metrics.strictSurfaceCovered,
          accuracy: ratio(metrics.strictSurfaceCorrect, metrics.strictSurfaceCovered)
        },
        contextMorphologyBackoffUses: metrics.contextBackoffs,
        oovMorphologyDiagnostics: {
          pluralHintTargets: metrics.oovPluralHintTargets,
          knownBaseCandidateTargets: metrics.oovPluralKnownBaseTargets,
          knownBaseCandidateTop8Hits: metrics.oovPluralKnownBaseHits,
          noKnownBaseCandidateTargets: metrics.oovPluralNoKnownBaseTargets,
          ambiguousBaseCandidateTargets: metrics.oovPluralAmbiguousBaseTargets,
          knownBaseCandidateCoverage: ratio(metrics.oovPluralKnownBaseTargets, metrics.oovPluralHintTargets),
          top8RecallGivenKnownBase: ratio(metrics.oovPluralKnownBaseHits, metrics.oovPluralKnownBaseTargets)
        }
      }
    });
  }

  const shuffledAggregate = {
    total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
    frequencyBuckets: createFrequencyBuckets()
  };
  const shuffledSeedReports = [];
  for (const seed of seeds) {
    const model = Attention.create({
      dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: seed.model
    });
    const shuffleSeed = (seed.model ^ 0x5f3759df) >>> 0;
    const training = model.train(prepared.trainingTexts, {
      epochs: 20, learningRate: 0.02, patience: 8, splitSeed: seed.split,
      shuffleExamples: true, shuffleSeed
    });
    const trainingSplit = model.splitCorpus(prepared.trainingTexts, seed.split);
    assert.equal(trainingSplit.train.length, training.trainRows,
      "shuffled diagnostics must use the exact model training partition");
    const tokenFrequency = new Map();
    for (const row of trainingSplit.train) {
      for (const token of Attention.tokenize(row)) {
        tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
      }
    }
    const metrics = {
      total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
      frequencyBuckets: createFrequencyBuckets()
    };
    for (const sentence of prepared.testTexts) {
      const tokens = Attention.tokenize(sentence);
      for (let index = 0; index < tokens.length; index++) {
        metrics.total++;
        const score = model.score(sentence, index);
        if (!score) continue;
        if (score.targetKnown) {
          metrics.known++;
          const frequency = tokenFrequency.get(tokens[index]) || 0;
          assert.ok(frequency > 0, "known targets must occur in the shuffled training partition");
          const band = frequency === 1 ? "1" : frequency <= 4 ? "2-4" :
            frequency <= 9 ? "5-9" : "10+";
          metrics.frequencyBuckets[band].targets++;
          if (score.predictions[0]?.token === tokens[index]) {
            metrics.exact++;
            metrics.frequencyBuckets[band].correct++;
          }
        }
        if (score.morphologyKnown) {
          metrics.morphologyCovered++;
          if (score.morphologyCorrect) metrics.morphologyCorrect++;
        }
      }
    }
    for (const key of ["total", "known", "exact", "morphologyCovered", "morphologyCorrect"]) {
      shuffledAggregate[key] += metrics[key];
    }
    mergeFrequencyBuckets(shuffledAggregate.frequencyBuckets, metrics.frequencyBuckets);
    const fixed = seedReports.find(row => row.modelSeed === seed.model);
    shuffledSeedReports.push({
      modelSeed: seed.model,
      splitSeed: seed.split,
      training: {
        trainRows: training.trainRows,
        validationRows: training.validationRows,
        internalTestRows: training.testRows,
        vocabularySize: training.vocabularySize,
        vocabularySaturated: training.vocabularySize >= 1024,
        epochs: training.epochs,
        shuffleExamples: training.shuffleExamples,
        shuffleSeed: training.shuffleSeed
      },
      metrics: {
        targets: metrics.total,
        knownTargetCoverage: ratio(metrics.known, metrics.total),
        exactKnownTargetAccuracy: ratio(metrics.exact, metrics.known),
        allTargetExactAccuracy: ratio(metrics.exact, metrics.total),
        frequencyBuckets: summarizeFrequencyBuckets(metrics.frequencyBuckets),
        morphology: {
          correct: metrics.morphologyCorrect,
          covered: metrics.morphologyCovered,
          accuracy: ratio(metrics.morphologyCorrect, metrics.morphologyCovered),
          coverage: ratio(metrics.morphologyCovered, metrics.total)
        },
        pairedFixedOrder: {
          exactKnownTargetAccuracy: fixed.metrics.exactKnownTargetAccuracy,
          allTargetExactAccuracy: fixed.metrics.allTargetExactAccuracy,
          frequencyBuckets: fixed.metrics.frequencyBuckets
        }
      }
    });
  }

  const frequencyAggregate = {
    frequencyBuckets: createFrequencyBuckets(),
    total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
    oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
    oovPluralHintTargets: 0, oovPluralKnownBaseTargets: 0, oovPluralKnownBaseHits: 0,
    oovPluralNoKnownBaseTargets: 0, oovPluralAmbiguousBaseTargets: 0,
    strictCovered: 0, strictCorrect: 0, inversionCovered: 0, inversionCorrect: 0,
    strictSurfaceCovered: 0, strictSurfaceCorrect: 0, contextBackoffs: 0
  };
  const frequencySeedReports = [];
  for (const seed of seeds) {
    const model = Attention.create({
      dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: seed.model
    });
    const training = model.train(prepared.trainingTexts, {
      epochs: 20, learningRate: 0.02, patience: 8, splitSeed: seed.split,
      vocabularyStrategy: "frequency"
    });
    assert.equal(training.vocabularyStrategy, "frequency");
    const trainingSplit = model.splitCorpus(prepared.trainingTexts, seed.split);
    assert.equal(trainingSplit.train.length, training.trainRows);
    const tokenFrequency = new Map();
    for (const row of trainingSplit.train) {
      for (const token of Attention.tokenize(row)) {
        tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
      }
    }
    assert.equal(training.vocabularySelection.candidateTypes, tokenFrequency.size,
      "frequency selection must count only the exact training partition");
    assert.equal(training.vocabularySelection.selectedTypes, training.vocabularySize);
    const selectedVocabulary = new Set(model.exportState().vocabulary);
    assert.ok(Array.from(selectedVocabulary).every(token => tokenFrequency.has(token)),
      "frequency selection must never include a validation or test-only token");
    const expectedVocabulary = Array.from(tokenFrequency.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 1024).map(row => row[0]);
    assert.deepEqual(Array.from(model.exportState().vocabulary), expectedVocabulary,
      "frequency vocabulary must be ordered by train frequency with deterministic lexical ties");
    const retrievalIndex = model.retrievalIndexStatus();
    assert.equal(retrievalIndex.built, true);
    assert.equal(retrievalIndex.exampleCount, model.status().trainingContextExamples);
    const pluralCandidateBaseCounts = new Map();
    for (const base of model.exportState().vocabulary) {
      const surface = Attention.russianNounPlural(base);
      if (surface) pluralCandidateBaseCounts.set(surface, (pluralCandidateBaseCounts.get(surface) || 0) + 1);
    }
    const metrics = {
      frequencyBuckets: createFrequencyBuckets(),
      total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
      oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
      oovPluralHintTargets: 0, oovPluralKnownBaseTargets: 0, oovPluralKnownBaseHits: 0,
      oovPluralNoKnownBaseTargets: 0, oovPluralAmbiguousBaseTargets: 0,
      strictCovered: 0, strictCorrect: 0, inversionCovered: 0, inversionCorrect: 0,
      strictSurfaceCovered: 0, strictSurfaceCorrect: 0, contextBackoffs: 0
    };
    for (const sentence of prepared.testTexts) {
      const tokens = Attention.tokenize(sentence);
      for (let index = 0; index < tokens.length; index++) {
        metrics.total++;
        const score = model.score(sentence, index);
        if (!score) continue;
        metrics.contextBackoffs += score.contextMorphologyBackoffs.length;
        if (score.targetKnown) {
          metrics.known++;
          const frequency = tokenFrequency.get(tokens[index]) || 0;
          assert.ok(frequency > 0, "known targets must occur in the training partition");
          const band = frequency === 1 ? "1" : frequency <= 4 ? "2-4" :
            frequency <= 9 ? "5-9" : "10+";
          metrics.frequencyBuckets[band].targets++;
          if (score.predictions[0]?.token === tokens[index]) {
            metrics.exact++;
            metrics.frequencyBuckets[band].correct++;
          }
        }
        if (score.morphologyKnown) {
          metrics.morphologyCovered++;
          if (score.morphologyCorrect) metrics.morphologyCorrect++;
        }
        if (score.targetKnown) continue;
        metrics.oov++;
        const strictPrediction = model.predictMasked(sentence, index);
        if (strictPrediction?.morphologyHint?.number === "plural") {
          metrics.oovPluralHintTargets++;
          const baseCount = pluralCandidateBaseCounts.get(tokens[index]) || 0;
          if (baseCount > 0) {
            metrics.oovPluralKnownBaseTargets++;
            if (baseCount > 1) metrics.oovPluralAmbiguousBaseTargets++;
            if (strictPrediction.generatedCandidates?.some(row => row.surface === tokens[index])) {
              metrics.oovPluralKnownBaseHits++;
            }
          } else metrics.oovPluralNoKnownBaseTargets++;
        }
        const inversionPrediction = model.predictMasked(sentence, index, {allowOrderInversion: true});
        const generated = strictPrediction?.generatedPrediction;
        if (generated) {
          metrics.generatedCovered++;
          if (generated.surface === tokens[index]) metrics.generatedCorrect++;
        }
        if (strictPrediction?.generatedCandidates?.some(row => row.surface === tokens[index])) {
          metrics.generatedCandidateHits++;
        }
        const strictCandidate = strictPrediction?.retrievalCandidate;
        if (strictCandidate) {
          metrics.strictCovered++;
          if (Attention.russianStem(strictCandidate.token) === Attention.russianStem(tokens[index])) metrics.strictCorrect++;
        }
        if (strictPrediction?.retrievalPrediction) {
          metrics.strictSurfaceCovered++;
          if (strictPrediction.retrievalPrediction.surface === tokens[index]) metrics.strictSurfaceCorrect++;
        }
        const inversionCandidate = inversionPrediction?.retrievalCandidate;
        if (inversionCandidate) {
          metrics.inversionCovered++;
          if (Attention.russianStem(inversionCandidate.token) === Attention.russianStem(tokens[index])) metrics.inversionCorrect++;
        }
      }
    }
    assert.equal(metrics.oovPluralHintTargets,
      metrics.oovPluralKnownBaseTargets + metrics.oovPluralNoKnownBaseTargets);
    add(frequencyAggregate, metrics);
    mergeFrequencyBuckets(frequencyAggregate.frequencyBuckets, metrics.frequencyBuckets);
    frequencySeedReports.push({
      modelSeed: seed.model, splitSeed: seed.split,
      training: {
        trainRows: training.trainRows, vocabularySize: training.vocabularySize,
        vocabularyCapacity: 1024, vocabularySelection: training.vocabularySelection,
        epochs: training.epochs, trainingContextExamples: model.status().trainingContextExamples
      },
      metrics: {
        targets: metrics.total,
        knownTargetCoverage: ratio(metrics.known, metrics.total),
        exactKnownTargetAccuracy: ratio(metrics.exact, metrics.known),
        allTargetExactAccuracy: ratio(metrics.exact, metrics.total),
        frequencyBuckets: summarizeFrequencyBuckets(metrics.frequencyBuckets),
        morphology: {
          correct: metrics.morphologyCorrect, covered: metrics.morphologyCovered,
          accuracy: ratio(metrics.morphologyCorrect, metrics.morphologyCovered),
          coverage: ratio(metrics.morphologyCovered, metrics.total)
        },
        oovGeneration: {
          correct: metrics.generatedCorrect, covered: metrics.generatedCovered, oovTargets: metrics.oov,
          accuracy: ratio(metrics.generatedCorrect, metrics.generatedCovered),
          coverage: ratio(metrics.generatedCovered, metrics.oov),
          candidateRecallAt8: ratio(metrics.generatedCandidateHits, metrics.oov)
        },
        contextRetrievalStrict: {
          correct: metrics.strictCorrect, covered: metrics.strictCovered, oovTargets: metrics.oov,
          precision: ratio(metrics.strictCorrect, metrics.strictCovered),
          coverage: ratio(metrics.strictCovered, metrics.oov)
        },
        contextRetrievalOrderInvariant: {
          correct: metrics.inversionCorrect, covered: metrics.inversionCovered, oovTargets: metrics.oov,
          precision: ratio(metrics.inversionCorrect, metrics.inversionCovered),
          coverage: ratio(metrics.inversionCovered, metrics.oov)
        }
      }
    });
  }

  const metricSummary = metrics => ({
    targets: metrics.total,
    knownTargetCoverage: ratio(metrics.known, metrics.total),
    exactKnownTargetAccuracy: ratio(metrics.exact, metrics.known),
    allTargetExactAccuracy: ratio(metrics.exact, metrics.total),
    morphology: {
      correct: metrics.morphologyCorrect, covered: metrics.morphologyCovered,
      accuracy: ratio(metrics.morphologyCorrect, metrics.morphologyCovered),
      coverage: ratio(metrics.morphologyCovered, metrics.total)
    },
    oovGeneration: {
      correct: metrics.generatedCorrect, covered: metrics.generatedCovered, oovTargets: metrics.oov,
      accuracy: ratio(metrics.generatedCorrect, metrics.generatedCovered),
      coverage: ratio(metrics.generatedCovered, metrics.oov),
      candidateRecallAt8: ratio(metrics.generatedCandidateHits, metrics.oov)
    },
    contextRetrievalStrict: {
      correct: metrics.strictCorrect, covered: metrics.strictCovered, oovTargets: metrics.oov,
      precision: ratio(metrics.strictCorrect, metrics.strictCovered),
      coverage: ratio(metrics.strictCovered, metrics.oov)
    },
    contextRetrievalOrderInvariant: {
      correct: metrics.inversionCorrect, covered: metrics.inversionCovered, oovTargets: metrics.oov,
      precision: ratio(metrics.inversionCorrect, metrics.inversionCovered),
      coverage: ratio(metrics.inversionCovered, metrics.oov)
    }
  });
  const frequencyMetrics = metricSummary(frequencyAggregate);
  const baselineMetrics = metricSummary(aggregate);
  const percentagePointDelta = (current, previous) =>
    current == null || previous == null ? null : (current - previous) * 100;

  const summary = {
    benchmark: "NEUROGENESIS external Russian language pilot",
    version: "0.58.111",
    source: {
      treebank: "UD_Russian-GSD",
      release: "r2.18",
      commit: "9acc9d677327043bd416fcc89e4b3407c620d885",
      license: "CC BY-SA 4.0"
    },
    preparation: prepared.stats,
    independentTest: {
      seedCount: seeds.length,
      sampledSentences: prepared.testTexts.length,
      normalizedSentenceLeakage: prepared.stats.normalizedSampleTrainTestOverlaps,
      metrics: {
        targets: aggregate.total,
        knownTargetCoverage: ratio(aggregate.known, aggregate.total),
        exactKnownTargetAccuracy: ratio(aggregate.exact, aggregate.known),
        frequencyBuckets: summarizeFrequencyBuckets(aggregateFrequencyBuckets),
        allTargetExactAccuracy: ratio(aggregate.exact, aggregate.total),
        morphology: {
          correct: aggregate.morphologyCorrect, covered: aggregate.morphologyCovered,
          accuracy: ratio(aggregate.morphologyCorrect, aggregate.morphologyCovered),
          coverage: ratio(aggregate.morphologyCovered, aggregate.total)
        },
        oovGeneration: {
          correct: aggregate.generatedCorrect, covered: aggregate.generatedCovered,
          oovTargets: aggregate.oov, accuracy: ratio(aggregate.generatedCorrect, aggregate.generatedCovered),
          coverage: ratio(aggregate.generatedCovered, aggregate.oov),
          candidateRecallAt8: ratio(aggregate.generatedCandidateHits, aggregate.oov)
        },
        contextRetrievalStrict: {
          correct: aggregate.strictCorrect, covered: aggregate.strictCovered, oovTargets: aggregate.oov,
          precision: ratio(aggregate.strictCorrect, aggregate.strictCovered),
          coverage: ratio(aggregate.strictCovered, aggregate.oov)
        },
        contextRetrievalOrderInvariant: {
          correct: aggregate.inversionCorrect, covered: aggregate.inversionCovered, oovTargets: aggregate.oov,
          precision: ratio(aggregate.inversionCorrect, aggregate.inversionCovered),
          coverage: ratio(aggregate.inversionCovered, aggregate.oov)
        },
        strictRetrievalSurface: {
          correct: aggregate.strictSurfaceCorrect, covered: aggregate.strictSurfaceCovered,
          accuracy: ratio(aggregate.strictSurfaceCorrect, aggregate.strictSurfaceCovered)
        },
        contextMorphologyBackoffUses: aggregate.contextBackoffs,
        oovMorphologyDiagnostics: {
          pluralHintTargets: aggregate.oovPluralHintTargets,
          knownBaseCandidateTargets: aggregate.oovPluralKnownBaseTargets,
          knownBaseCandidateTop8Hits: aggregate.oovPluralKnownBaseHits,
          noKnownBaseCandidateTargets: aggregate.oovPluralNoKnownBaseTargets,
          ambiguousBaseCandidateTargets: aggregate.oovPluralAmbiguousBaseTargets,
          knownBaseCandidateCoverage: ratio(aggregate.oovPluralKnownBaseTargets, aggregate.oovPluralHintTargets),
          top8RecallGivenKnownBase: ratio(aggregate.oovPluralKnownBaseHits, aggregate.oovPluralKnownBaseTargets)
        }
      }
    },
    seeds: seedReports,
    vocabularySelectionExperiment: {
      control: {strategy: "first_seen", metrics: baselineMetrics},
      experiment: {strategy: "frequency", metrics: frequencyMetrics},
      deltasPercentagePoints: {
        knownTargetCoverage: percentagePointDelta(frequencyMetrics.knownTargetCoverage, baselineMetrics.knownTargetCoverage),
        exactKnownTargetAccuracy: percentagePointDelta(frequencyMetrics.exactKnownTargetAccuracy, baselineMetrics.exactKnownTargetAccuracy),
        allTargetExactAccuracy: percentagePointDelta(frequencyMetrics.allTargetExactAccuracy, baselineMetrics.allTargetExactAccuracy),
        morphologyAccuracy: percentagePointDelta(frequencyMetrics.morphology.accuracy, baselineMetrics.morphology.accuracy),
        morphologyCoverage: percentagePointDelta(frequencyMetrics.morphology.coverage, baselineMetrics.morphology.coverage),
        oovGenerationAccuracy: percentagePointDelta(frequencyMetrics.oovGeneration.accuracy, baselineMetrics.oovGeneration.accuracy),
        oovGenerationCoverage: percentagePointDelta(frequencyMetrics.oovGeneration.coverage, baselineMetrics.oovGeneration.coverage),
        strictRetrievalPrecision: percentagePointDelta(frequencyMetrics.contextRetrievalStrict.precision, baselineMetrics.contextRetrievalStrict.precision),
        strictRetrievalCoverage: percentagePointDelta(frequencyMetrics.contextRetrievalStrict.coverage, baselineMetrics.contextRetrievalStrict.coverage),
        orderInvariantRetrievalPrecision: percentagePointDelta(frequencyMetrics.contextRetrievalOrderInvariant.precision, baselineMetrics.contextRetrievalOrderInvariant.precision),
        orderInvariantRetrievalCoverage: percentagePointDelta(frequencyMetrics.contextRetrievalOrderInvariant.coverage, baselineMetrics.contextRetrievalOrderInvariant.coverage)
      },
      sameSeedsCorpusSplitAndHyperparameters: true,
      onlyChangedVariable: "vocabulary selection strategy",
      seeds: frequencySeedReports
    },
    trainingOrderExperiment: {
      control: "fixed training-example order each epoch",
      experiment: "seeded Fisher-Yates shuffle before each epoch",
      onlyChangedVariable: "training example order",
      sameCorpusSplitSeedsModelSeedsAndHyperparameters: true,
      shuffledAggregate: {
        targets: shuffledAggregate.total,
        knownTargetCoverage: ratio(shuffledAggregate.known, shuffledAggregate.total),
        exactKnownTargetAccuracy: ratio(shuffledAggregate.exact, shuffledAggregate.known),
        allTargetExactAccuracy: ratio(shuffledAggregate.exact, shuffledAggregate.total),
        frequencyBuckets: summarizeFrequencyBuckets(shuffledAggregate.frequencyBuckets),
        morphology: {
          correct: shuffledAggregate.morphologyCorrect,
          covered: shuffledAggregate.morphologyCovered,
          accuracy: ratio(shuffledAggregate.morphologyCorrect, shuffledAggregate.morphologyCovered),
          coverage: ratio(shuffledAggregate.morphologyCovered, shuffledAggregate.total)
        }
      },
      pairedSeeds: shuffledSeedReports
    },
    leakageChecks: {
      exactNormalizedTrainTestSentences: 0,
      sourceOverlapSentencesExcludedFromTrain: prepared.stats.normalizedTrainTestOverlapsExcluded,
      sampledOverlapSentences: prepared.stats.normalizedSampleTrainTestOverlaps
    }
  };
  console.log("NEUROGENESIS 0.58.111 UD_Russian-GSD benchmark: " + JSON.stringify(summary));
  console.log("External corpus benchmark is separate from the frozen 49-sentence language benchmark.");
}
