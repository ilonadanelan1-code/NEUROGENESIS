"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const fixtureTrain = [
  "# sent_id = train-1",
  "# text = Нейрон получает сигнал.",
  "1\tНейрон\tнейрон\tNOUN\t_\t_\t2\tnsubj\t_\t_",
  "2\tполучает\tполучать\tVERB\t_\t_\t0\troot\t_\t_",
  "3\tсигнал\tсигнал\tNOUN\t_\t_\t2\tobj\t_\t_",
  "",
  "# sent_id = train-2",
  "# text = Сеть хранит данные.",
  "1\tСеть\tсеть\tNOUN\t_\t_\t2\tnsubj\t_\t_",
  "2\tхранит\tхранить\tVERB\t_\t_\t0\troot\t_\t_",
  "3\tданные\tданные\tNOUN\t_\t_\t2\tobj\t_\t_",
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
const parsedFixture = importer.parseConllu(fixtureTrain);
assert.equal(parsedFixture.length, 2);
assert.equal(parsedFixture[0].tokenCount, 3);
const fixtureOptions = {trainLimit: 10, testLimit: 10, minimumTokens: 3, maximumTokens: 20, seed: 17};
const preparedFixture = importer.prepareCorpus(fixtureTrain, fixtureTest, fixtureOptions);
assert.equal(preparedFixture.stats.normalizedTrainTestOverlapsExcluded, 1);
assert.equal(preparedFixture.stats.normalizedSampleTrainTestOverlaps, 0);
assert.equal(preparedFixture.trainingTexts.length, 1);
assert.equal(preparedFixture.trainingTexts[0], "Сеть хранит данные.");
assert.deepEqual(
  importer.prepareCorpus(fixtureTrain, fixtureTest, fixtureOptions).trainingTexts,
  preparedFixture.trainingTexts,
  "training sample must be deterministic"
);

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
        vocabularyCapacity: training.vocabularyCapacity,
        vocabularySaturated: training.vocabularySaturated,
        trainingContextExamples: model.status().trainingContextExamples,
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

  const capacityAggregate = {
    total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
    oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
    pluralHintTargets: 0, knownBaseTargets: 0, knownBaseTop8Hits: 0,
    noKnownBaseTargets: 0, ambiguousBaseTargets: 0
  };
  const capacityFrequencyBuckets = createFrequencyBuckets();
  const capacitySeedReports = [];
  for (const seed of seeds) {
    const model = Attention.create({
      dimension: 12, windowSize: 4, heads: 3, blocks: 2,
      seed: seed.model, maxVocabulary: 2048
    });
    const training = model.train(prepared.trainingTexts, {
      epochs: 20, learningRate: 0.02, patience: 8, splitSeed: seed.split
    });
    assert.equal(training.vocabularyCapacity, 2048,
      "capacity experiment must use the requested 2048-token limit");
    assert.ok(training.vocabularySize > 1024,
      "the larger capacity must retain more than 1024 vocabulary items on this corpus");
    const trainingSplit = model.splitCorpus(prepared.trainingTexts, seed.split);
    assert.equal(trainingSplit.train.length, training.trainRows,
      "capacity diagnostics must use the exact model training partition");
    const tokenFrequency = new Map();
    for (const row of trainingSplit.train) {
      for (const token of Attention.tokenize(row)) {
        tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
      }
    }
    const baseCounts = new Map();
    for (const base of model.exportState().vocabulary) {
      const surface = Attention.russianNounPlural(base);
      if (surface) baseCounts.set(surface, (baseCounts.get(surface) || 0) + 1);
    }
    const metrics = {
      total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
      oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
      pluralHintTargets: 0, knownBaseTargets: 0, knownBaseTop8Hits: 0,
      noKnownBaseTargets: 0, ambiguousBaseTargets: 0,
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
          assert.ok(frequency > 0,
            "capacity-known targets must occur in the actual training partition");
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
        const prediction = model.predictMasked(sentence, index);
        if (prediction?.morphologyHint?.number === "plural") {
          metrics.pluralHintTargets++;
          const baseCount = baseCounts.get(tokens[index]) || 0;
          if (baseCount > 0) {
            metrics.knownBaseTargets++;
            if (baseCount > 1) metrics.ambiguousBaseTargets++;
            if (prediction.generatedCandidates?.some(row => row.surface === tokens[index])) {
              metrics.knownBaseTop8Hits++;
            }
          } else {
            metrics.noKnownBaseTargets++;
          }
        }
        if (prediction?.generatedPrediction) {
          metrics.generatedCovered++;
          if (prediction.generatedPrediction.surface === tokens[index]) metrics.generatedCorrect++;
        }
        if (prediction?.generatedCandidates?.some(row => row.surface === tokens[index])) {
          metrics.generatedCandidateHits++;
        }
      }
    }
    assert.equal(metrics.pluralHintTargets,
      metrics.knownBaseTargets + metrics.noKnownBaseTargets,
      "every expanded-capacity plural-hint OOV target must be classified");
    assert.ok(metrics.knownBaseTop8Hits <= metrics.knownBaseTargets);
    for (const key of ["total", "known", "exact", "morphologyCovered", "morphologyCorrect",
      "oov", "generatedCovered", "generatedCorrect", "generatedCandidateHits",
      "pluralHintTargets", "knownBaseTargets", "knownBaseTop8Hits",
      "noKnownBaseTargets", "ambiguousBaseTargets"]) {
      capacityAggregate[key] += metrics[key];
    }
    mergeFrequencyBuckets(capacityFrequencyBuckets, metrics.frequencyBuckets);
    const control = seedReports.find(row => row.modelSeed === seed.model);
    assert.ok(control, "every 2048-capacity run must have a paired 1024-capacity control");
    capacitySeedReports.push({
      modelSeed: seed.model,
      splitSeed: seed.split,
      training: {
        vocabularySize: training.vocabularySize,
        vocabularyCapacity: training.vocabularyCapacity,
        vocabularySaturated: training.vocabularySaturated,
        trainRows: training.trainRows,
        validationRows: training.validationRows,
        internalTestRows: training.testRows,
        epochs: training.epochs
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
        oovGeneration: {
          correct: metrics.generatedCorrect,
          covered: metrics.generatedCovered,
          oovTargets: metrics.oov,
          accuracy: ratio(metrics.generatedCorrect, metrics.generatedCovered),
          coverage: ratio(metrics.generatedCovered, metrics.oov),
          candidateRecallAt8: ratio(metrics.generatedCandidateHits, metrics.oov)
        },
        oovMorphologyDiagnostics: {
          pluralHintTargets: metrics.pluralHintTargets,
          knownBaseCandidateTargets: metrics.knownBaseTargets,
          knownBaseCandidateTop8Hits: metrics.knownBaseTop8Hits,
          noKnownBaseCandidateTargets: metrics.noKnownBaseTargets,
          ambiguousBaseCandidateTargets: metrics.ambiguousBaseTargets,
          knownBaseCandidateCoverage: ratio(metrics.knownBaseTargets, metrics.pluralHintTargets),
          top8RecallGivenKnownBase: ratio(metrics.knownBaseTop8Hits, metrics.knownBaseTargets)
        }
      },
      pairedControl1024: {
        vocabularySize: control.training.vocabularySize,
        knownTargetCoverage: control.metrics.knownTargetCoverage,
        exactKnownTargetAccuracy: control.metrics.exactKnownTargetAccuracy,
        allTargetExactAccuracy: control.metrics.allTargetExactAccuracy,
        frequencyBuckets: control.metrics.frequencyBuckets,
        morphology: control.metrics.morphology,
        oovMorphologyDiagnostics: control.metrics.oovMorphologyDiagnostics
      },
      deltaPercentagePoints: {
        knownTargetCoverage: (ratio(metrics.known, metrics.total) - control.metrics.knownTargetCoverage) * 100,
        exactKnownTargetAccuracy: (ratio(metrics.exact, metrics.known) - control.metrics.exactKnownTargetAccuracy) * 100,
        allTargetExactAccuracy: (ratio(metrics.exact, metrics.total) - control.metrics.allTargetExactAccuracy) * 100,
        morphologyAccuracy: (ratio(metrics.morphologyCorrect, metrics.morphologyCovered) - control.metrics.morphology.accuracy) * 100
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
        vocabularyCapacity: training.vocabularyCapacity,
        vocabularySaturated: training.vocabularySaturated,
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

  const summary = {
    benchmark: "NEUROGENESIS external Russian language pilot",
    version: "0.58.110",
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
    vocabularyCapacityExperiment: {
      control: "same fixed-order training and evaluation with 1024-token capacity",
      experiment: "same fixed-order training and evaluation with 2048-token capacity",
      onlyChangedVariable: "maximum vocabulary capacity",
      sameCorpusSplitSeedsModelSeedsAndHyperparameters: true,
      control1024: {
        targets: aggregate.total,
        vocabularyCapacity: 1024,
        knownTargetCoverage: ratio(aggregate.known, aggregate.total),
        exactKnownTargetAccuracy: ratio(aggregate.exact, aggregate.known),
        allTargetExactAccuracy: ratio(aggregate.exact, aggregate.total),
        frequencyBuckets: summarizeFrequencyBuckets(aggregateFrequencyBuckets),
        morphology: {
          correct: aggregate.morphologyCorrect,
          covered: aggregate.morphologyCovered,
          accuracy: ratio(aggregate.morphologyCorrect, aggregate.morphologyCovered),
          coverage: ratio(aggregate.morphologyCovered, aggregate.total)
        },
        oovMorphologyDiagnostics: {
          pluralHintTargets: aggregate.oovPluralHintTargets,
          knownBaseCandidateTargets: aggregate.oovPluralKnownBaseTargets,
          knownBaseCandidateTop8Hits: aggregate.oovPluralKnownBaseHits,
          noKnownBaseCandidateTargets: aggregate.oovPluralNoKnownBaseTargets,
          ambiguousBaseCandidateTargets: aggregate.oovPluralAmbiguousBaseTargets,
          knownBaseCandidateCoverage: ratio(aggregate.oovPluralKnownBaseTargets, aggregate.oovPluralHintTargets),
          top8RecallGivenKnownBase: ratio(aggregate.oovPluralKnownBaseHits, aggregate.oovPluralKnownBaseTargets)
        }
      },
      expanded2048: {
        targets: capacityAggregate.total,
        vocabularyCapacity: 2048,
        knownTargetCoverage: ratio(capacityAggregate.known, capacityAggregate.total),
        exactKnownTargetAccuracy: ratio(capacityAggregate.exact, capacityAggregate.known),
        allTargetExactAccuracy: ratio(capacityAggregate.exact, capacityAggregate.total),
        frequencyBuckets: summarizeFrequencyBuckets(capacityFrequencyBuckets),
        morphology: {
          correct: capacityAggregate.morphologyCorrect,
          covered: capacityAggregate.morphologyCovered,
          accuracy: ratio(capacityAggregate.morphologyCorrect, capacityAggregate.morphologyCovered),
          coverage: ratio(capacityAggregate.morphologyCovered, capacityAggregate.total)
        },
        oovGeneration: {
          correct: capacityAggregate.generatedCorrect,
          covered: capacityAggregate.generatedCovered,
          oovTargets: capacityAggregate.oov,
          accuracy: ratio(capacityAggregate.generatedCorrect, capacityAggregate.generatedCovered),
          coverage: ratio(capacityAggregate.generatedCovered, capacityAggregate.oov),
          candidateRecallAt8: ratio(capacityAggregate.generatedCandidateHits, capacityAggregate.oov)
        },
        oovMorphologyDiagnostics: {
          pluralHintTargets: capacityAggregate.pluralHintTargets,
          knownBaseCandidateTargets: capacityAggregate.knownBaseTargets,
          knownBaseCandidateTop8Hits: capacityAggregate.knownBaseTop8Hits,
          noKnownBaseCandidateTargets: capacityAggregate.noKnownBaseTargets,
          ambiguousBaseCandidateTargets: capacityAggregate.ambiguousBaseTargets,
          knownBaseCandidateCoverage: ratio(capacityAggregate.knownBaseTargets, capacityAggregate.pluralHintTargets),
          top8RecallGivenKnownBase: ratio(capacityAggregate.knownBaseTop8Hits, capacityAggregate.knownBaseTargets)
        }
      },
      pairedSeeds: capacitySeedReports
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
  console.log("NEUROGENESIS 0.58.110 UD_Russian-GSD benchmark: " + JSON.stringify(summary));
  console.log("External corpus benchmark is separate from the frozen 49-sentence language benchmark.");
}
