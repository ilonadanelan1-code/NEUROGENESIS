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
    trainLimit: 160, testLimit: 240, seed: 20261112, minimumTokens: 4, maximumTokens: 40
  });
  assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps, 0);
  assert.equal(prepared.trainingTexts.length, 160);
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
  const aggregate = {
    total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
    oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
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

    const metrics = {
      total: 0, known: 0, exact: 0, morphologyCovered: 0, morphologyCorrect: 0,
      oov: 0, generatedCovered: 0, generatedCorrect: 0, generatedCandidateHits: 0,
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
          if (score.predictions[0]?.token === tokens[index]) metrics.exact++;
        }
        if (score.morphologyKnown) {
          metrics.morphologyCovered++;
          if (score.morphologyCorrect) metrics.morphologyCorrect++;
        }
        if (score.targetKnown) continue;
        metrics.oov++;
        const strictPrediction = model.predictMasked(sentence, index);
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
    add(aggregate, metrics);
    seedReports.push({
      modelSeed: seed.model,
      splitSeed: seed.split,
      training: {
        inputRows: prepared.trainingTexts.length,
        trainRows: training.trainRows,
        validationRows: training.validationRows,
        internalTestRows: training.testRows,
        vocabularySize: training.vocabularySize,
        trainingContextExamples: model.status().trainingContextExamples,
        epochs: training.epochs
      },
      metrics: {
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
        contextMorphologyBackoffUses: metrics.contextBackoffs
      }
    });
  }

  const summary = {
    benchmark: "NEUROGENESIS external Russian language pilot",
    version: "0.58.104",
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
        contextMorphologyBackoffUses: aggregate.contextBackoffs
      }
    },
    seeds: seedReports,
    leakageChecks: {
      exactNormalizedTrainTestSentences: 0,
      sourceOverlapSentencesExcludedFromTrain: prepared.stats.normalizedTrainTestOverlapsExcluded,
      sampledOverlapSentences: prepared.stats.normalizedSampleTrainTestOverlaps
    }
  };
  console.log("NEUROGENESIS 0.58.104 UD_Russian-GSD benchmark: " + JSON.stringify(summary));
  console.log("External corpus benchmark is separate from the frozen 49-sentence language benchmark.");
}
