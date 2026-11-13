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
    strictSurfaceCovered: 0, strictSurfaceCorrect: 0,
    paradigmGoldAnnotatedOovTargets: 0,
    paradigmSurfaceSeenInTraining: 0,
    paradigmSurfaceUnseenInTraining: 0,
    paradigmLemmaSeenInTraining: 0,
    paradigmLemmaPosSeenInTraining: 0,
    paradigmSignatureSeenInTraining: 0,
    paradigmExactSurfaceSeenInSignature: 0,
    paradigmNovelSurfaceWithSeenSignature: 0,
    paradigmMissingLemmaOrPos: 0,
    strictLemmaCandidateCount: 0,
    strictLemmaCovered: 0,
    strictLemmaCorrect: 0,
    strictLemmaAmbiguous: 0,
    strictLemmaUnmapped: 0,
    inversionLemmaCandidateCount: 0,
    inversionLemmaCovered: 0,
    inversionLemmaCorrect: 0,
    inversionLemmaAmbiguous: 0,
    inversionLemmaUnmapped: 0,
    sampleStrictLemmaCandidateCount: 0,
    sampleStrictLemmaCovered: 0,
    sampleStrictLemmaCorrect: 0,
    sampleStrictLemmaAmbiguous: 0,
    sampleStrictLemmaUnmapped: 0,
    sampleInversionLemmaCandidateCount: 0,
    sampleInversionLemmaCovered: 0,
    sampleInversionLemmaCorrect: 0,
    sampleInversionLemmaAmbiguous: 0,
    sampleInversionLemmaUnmapped: 0,
    inverseFrequencyLemmaCandidateCount: 0,
    inverseFrequencyLemmaCovered: 0,
    inverseFrequencyLemmaCorrect: 0,
    inverseFrequencyLemmaAmbiguous: 0,
    inverseFrequencyLemmaUnmapped: 0,
    inverseFrequencyInversionLemmaCandidateCount: 0,
    inverseFrequencyInversionLemmaCovered: 0,
    inverseFrequencyInversionLemmaCorrect: 0,
    inverseFrequencyInversionLemmaAmbiguous: 0,
    inverseFrequencyInversionLemmaUnmapped: 0,
    lemmaTargets: 0,
    lemmaUnannotated: 0,
    inverseSampleLemmaTargets: 0,
    inverseSampleTargets: 0, sampleStrictCovered: 0, sampleStrictCorrect: 0,
    sampleInversionCovered: 0, sampleInversionCorrect: 0,
    inverseFrequencyCovered: 0, inverseFrequencyCorrect: 0,
    inverseFrequencyInversionCovered: 0, inverseFrequencyInversionCorrect: 0,
    contextBackoffs: 0
  };
  const add = (target, source) => {
    for (const key of Object.keys(target)) target[key] += source[key] || 0;
  };
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  const normalizeLemma = value => Attention.tokenize(value || "").join(" ");
  const annotationTokensFor = record => record.tokens.flatMap(token => {
    const forms = Attention.tokenize(token.form);
    const lemma = normalizeLemma(token.lemma);
    return forms.map(form => ({
      form,lemma:lemma || null,upos:token.upos || null,feats:{...(token.feats || {})}
    }));
  });
  const featureSignature = row => Object.keys(row.feats || {}).sort()
    .map(key => key + "=" + row.feats[key]).join("|") || "_";
  const paradigmKeyFor = row => row?.lemma && row?.upos
    ? JSON.stringify([row.lemma,row.upos,featureSignature(row)]) : null;
  const measureLemmaCandidate = (candidate,goldLemma,metrics,prefix,lemmaBySurface) => {
    if (!candidate || !goldLemma) return;
    metrics[prefix + "CandidateCount"]++;
    const lemmas = lemmaBySurface.get(normalizeLemma(candidate.token));
    if (!lemmas || !lemmas.size) {
      metrics[prefix + "Unmapped"]++;
      return;
    }
    if (lemmas.size !== 1) {
      metrics[prefix + "Ambiguous"]++;
      return;
    }
    metrics[prefix + "Covered"]++;
    if (lemmas.has(goldLemma)) metrics[prefix + "Correct"]++;
  };

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

    // Candidate surface forms are mapped to UD lemmas using only the model's
    // actual training partition, never validation or independent-test annotations.
    const trainingSentenceKeys = new Set(trainingSplit.train.map(row => Attention.tokenize(row).join(" ")));
    const trainingLemmaBySurface = new Map();
    const trainingLemmaSet = new Set();
    const trainingLemmaPosSet = new Set();
    const trainingParadigmForms = new Map();
    let trainingLemmaSentenceCount = 0;
    let trainingLemmaAlignmentSkipped = 0;
    for (const record of prepared.trainingRecords) {
      const sentenceKey = Attention.tokenize(record.text).join(" ");
      if (!trainingSentenceKeys.has(sentenceKey)) continue;
      const annotated = annotationTokensFor(record);
      if (annotated.length !== sentenceKey.split(" ").filter(Boolean).length ||
          annotated.map(row => row.form).join(" ") !== sentenceKey) {
        trainingLemmaAlignmentSkipped++;
        continue;
      }
      trainingLemmaSentenceCount++;
      for (const row of annotated) {
        if (!row.lemma) continue;
        if (!trainingLemmaBySurface.has(row.form)) trainingLemmaBySurface.set(row.form,new Set());
        trainingLemmaBySurface.get(row.form).add(row.lemma);
        trainingLemmaSet.add(row.lemma);
        if (row.upos) trainingLemmaPosSet.add(JSON.stringify([row.lemma,row.upos]));
        const key = paradigmKeyFor(row);
        if (key) {
          if (!trainingParadigmForms.has(key)) trainingParadigmForms.set(key,new Set());
          trainingParadigmForms.get(key).add(row.form);
        }
      }
    }
    assert.ok(trainingLemmaSentenceCount >= Math.floor(trainingSplit.train.length * 0.9),
      "at least 90% of training sentences must align with UD lemma annotations");

    const testLemmaBySentence = new Map();
    let testLemmaAlignmentSkipped = 0;
    for (const record of prepared.testRecords) {
      const sentenceKey = Attention.tokenize(record.text).join(" ");
      const annotated = annotationTokensFor(record);
      if (annotated.length !== sentenceKey.split(" ").filter(Boolean).length ||
          annotated.map(row => row.form).join(" ") !== sentenceKey) {
        testLemmaAlignmentSkipped++;
        continue;
      }
      testLemmaBySentence.set(sentenceKey,annotated);
    }
    assert.ok(testLemmaBySentence.size >= Math.floor(prepared.testTexts.length * 0.95),
      "at least 95% of independent test sentences must align with UD lemma annotations");

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
      strictSurfaceCovered: 0, strictSurfaceCorrect: 0,
      paradigmGoldAnnotatedOovTargets: 0,
      paradigmSurfaceSeenInTraining: 0,
      paradigmSurfaceUnseenInTraining: 0,
      paradigmLemmaSeenInTraining: 0,
      paradigmLemmaPosSeenInTraining: 0,
      paradigmSignatureSeenInTraining: 0,
      paradigmExactSurfaceSeenInSignature: 0,
      paradigmNovelSurfaceWithSeenSignature: 0,
      paradigmMissingLemmaOrPos: 0,
      strictLemmaCandidateCount: 0,
      strictLemmaCovered: 0,
      strictLemmaCorrect: 0,
      strictLemmaAmbiguous: 0,
      strictLemmaUnmapped: 0,
      inversionLemmaCandidateCount: 0,
      inversionLemmaCovered: 0,
      inversionLemmaCorrect: 0,
      inversionLemmaAmbiguous: 0,
      inversionLemmaUnmapped: 0,
      sampleStrictLemmaCandidateCount: 0,
      sampleStrictLemmaCovered: 0,
      sampleStrictLemmaCorrect: 0,
      sampleStrictLemmaAmbiguous: 0,
      sampleStrictLemmaUnmapped: 0,
      sampleInversionLemmaCandidateCount: 0,
      sampleInversionLemmaCovered: 0,
      sampleInversionLemmaCorrect: 0,
      sampleInversionLemmaAmbiguous: 0,
      sampleInversionLemmaUnmapped: 0,
      inverseFrequencyLemmaCandidateCount: 0,
      inverseFrequencyLemmaCovered: 0,
      inverseFrequencyLemmaCorrect: 0,
      inverseFrequencyLemmaAmbiguous: 0,
      inverseFrequencyLemmaUnmapped: 0,
      inverseFrequencyInversionLemmaCandidateCount: 0,
      inverseFrequencyInversionLemmaCovered: 0,
      inverseFrequencyInversionLemmaCorrect: 0,
      inverseFrequencyInversionLemmaAmbiguous: 0,
      inverseFrequencyInversionLemmaUnmapped: 0,
      lemmaTargets: 0,
      lemmaUnannotated: 0,
      inverseSampleLemmaTargets: 0,
      inverseSampleTargets: 0, sampleStrictCovered: 0, sampleStrictCorrect: 0,
      sampleInversionCovered: 0, sampleInversionCorrect: 0,
      inverseFrequencyCovered: 0, inverseFrequencyCorrect: 0,
      inverseFrequencyInversionCovered: 0, inverseFrequencyInversionCorrect: 0,
      contextBackoffs: 0
    };
    for (const sentence of prepared.testTexts) {
      const tokens = Attention.tokenize(sentence);
      const goldLemmaRows = testLemmaBySentence.get(tokens.join(" ")) || null;
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
        const goldAnnotation = goldLemmaRows?.[index] || null;
        const goldLemma = goldAnnotation?.lemma || null;
        if (goldLemma) metrics.lemmaTargets++;
        else metrics.lemmaUnannotated++;
        if (goldLemma && goldAnnotation?.upos) {
          metrics.paradigmGoldAnnotatedOovTargets++;
          if ((trainingTokenFrequency.get(tokens[index]) || 0) > 0) {
            metrics.paradigmSurfaceSeenInTraining++;
          } else {
            metrics.paradigmSurfaceUnseenInTraining++;
          }
          if (trainingLemmaSet.has(goldLemma)) metrics.paradigmLemmaSeenInTraining++;
          if (trainingLemmaPosSet.has(JSON.stringify([goldLemma,goldAnnotation.upos]))) {
            metrics.paradigmLemmaPosSeenInTraining++;
          }
          const goldParadigmKey = paradigmKeyFor(goldAnnotation);
          const availableForms = goldParadigmKey ? trainingParadigmForms.get(goldParadigmKey) : null;
          if (availableForms?.size) {
            metrics.paradigmSignatureSeenInTraining++;
            if (availableForms.has(goldAnnotation.form)) {
              metrics.paradigmExactSurfaceSeenInSignature++;
            } else {
              metrics.paradigmNovelSurfaceWithSeenSignature++;
            }
          } else {
            metrics.paradigmMissingLemmaOrPos++;
          }
        }
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
        // Deterministic 1-in-4 OOV slice: compare inverse-frequency retrieval on the
        // exact same target positions as the existing uniform-scoring baselines.
        const inverseSample = metrics.oov % 4 === 0;
        const inverseFrequencyPrediction = inverseSample
          ? model.predictMasked(sentence, index, {scoring:"inverse_frequency"}) : null;
        const inverseFrequencyInversionPrediction = inverseSample
          ? model.predictMasked(sentence, index, {scoring:"inverse_frequency",allowOrderInversion:true}) : null;
        if (inverseSample) metrics.inverseSampleTargets++;
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
        measureLemmaCandidate(strictCandidate,goldLemma,metrics,"strictLemma",trainingLemmaBySurface);
        measureLemmaCandidate(inversionCandidate,goldLemma,metrics,"inversionLemma",trainingLemmaBySurface);
        if (inversionCandidate) {
          metrics.inversionCovered++;
          if (Attention.russianStem(inversionCandidate.token) === Attention.russianStem(tokens[index])) {
            metrics.inversionCorrect++;
          }
        }
        if (inverseSample) {
          if (goldLemma) metrics.inverseSampleLemmaTargets++;
          measureLemmaCandidate(strictCandidate,goldLemma,metrics,"sampleStrictLemma",trainingLemmaBySurface);
          measureLemmaCandidate(inversionCandidate,goldLemma,metrics,"sampleInversionLemma",trainingLemmaBySurface);
          if (strictCandidate) {
            metrics.sampleStrictCovered++;
            if (Attention.russianStem(strictCandidate.token) === Attention.russianStem(tokens[index])) {
              metrics.sampleStrictCorrect++;
            }
          }
          if (inversionCandidate) {
            metrics.sampleInversionCovered++;
            if (Attention.russianStem(inversionCandidate.token) === Attention.russianStem(tokens[index])) {
              metrics.sampleInversionCorrect++;
            }
          }
          const inverseCandidate = inverseFrequencyPrediction?.retrievalCandidate;
          measureLemmaCandidate(inverseCandidate,goldLemma,metrics,"inverseFrequencyLemma",trainingLemmaBySurface);
          if (inverseCandidate) {
            metrics.inverseFrequencyCovered++;
            if (Attention.russianStem(inverseCandidate.token) === Attention.russianStem(tokens[index])) {
              metrics.inverseFrequencyCorrect++;
            }
          }
          const inverseInversionCandidate = inverseFrequencyInversionPrediction?.retrievalCandidate;
          measureLemmaCandidate(inverseInversionCandidate,goldLemma,metrics,"inverseFrequencyInversionLemma",trainingLemmaBySurface);
          if (inverseInversionCandidate) {
            metrics.inverseFrequencyInversionCovered++;
            if (Attention.russianStem(inverseInversionCandidate.token) === Attention.russianStem(tokens[index])) {
              metrics.inverseFrequencyInversionCorrect++;
            }
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
        morphologyParadigmOracle: {
          goldAnnotatedOovTargets:metrics.paradigmGoldAnnotatedOovTargets,
          surfaceSeenInTraining:metrics.paradigmSurfaceSeenInTraining,
          surfaceUnseenInTraining:metrics.paradigmSurfaceUnseenInTraining,
          lemmaSeenInTraining:metrics.paradigmLemmaSeenInTraining,
          lemmaAndUposSeenInTraining:metrics.paradigmLemmaPosSeenInTraining,
          exactLemmaUpostFeatsSignatureSeen:metrics.paradigmSignatureSeenInTraining,
          exactSurfaceSeenUnderSignature:metrics.paradigmExactSurfaceSeenInSignature,
          unseenSurfaceWithKnownSignature:metrics.paradigmNovelSurfaceWithSeenSignature,
          missingLemmaOrUpostFeatsSignature:metrics.paradigmMissingLemmaOrPos,
          denominatorDescription:"annotated OOV targets; diagnostic uses held-out gold lemma, UPOS and FEATS only to estimate an oracle ceiling, never to produce a prediction"
        },
        lemmaLevelContextRetrieval: {
          goldAnnotatedOovTargets:metrics.lemmaTargets,
          unannotatedOovTargets:metrics.lemmaUnannotated,
          trainingLemmaSurfaces:trainingLemmaBySurface.size,
          alignedTrainingSentences:trainingLemmaSentenceCount,
          skippedTrainingSentenceAlignments:trainingLemmaAlignmentSkipped,
          alignedIndependentTestSentences:testLemmaBySentence.size,
          skippedIndependentTestSentenceAlignments:testLemmaAlignmentSkipped,
          strict: {
            candidateCount:metrics.strictLemmaCandidateCount,
            correct:metrics.strictLemmaCorrect,covered:metrics.strictLemmaCovered,
            ambiguousCandidateForms:metrics.strictLemmaAmbiguous,
            unmappedCandidateForms:metrics.strictLemmaUnmapped,
            precision:ratio(metrics.strictLemmaCorrect,metrics.strictLemmaCovered),
            coverage:ratio(metrics.strictLemmaCovered,metrics.lemmaTargets)
          },
          orderInvariant: {
            candidateCount:metrics.inversionLemmaCandidateCount,
            correct:metrics.inversionLemmaCorrect,covered:metrics.inversionLemmaCovered,
            ambiguousCandidateForms:metrics.inversionLemmaAmbiguous,
            unmappedCandidateForms:metrics.inversionLemmaUnmapped,
            precision:ratio(metrics.inversionLemmaCorrect,metrics.inversionLemmaCovered),
            coverage:ratio(metrics.inversionLemmaCovered,metrics.lemmaTargets)
          }
        },
        inverseFrequencyRetrievalSameSample: {
          sampledOovTargets: metrics.inverseSampleTargets,
          uniformStrict: {
            correct: metrics.sampleStrictCorrect, covered: metrics.sampleStrictCovered,
            precision: ratio(metrics.sampleStrictCorrect, metrics.sampleStrictCovered),
            coverage: ratio(metrics.sampleStrictCovered, metrics.inverseSampleTargets)
          },
          inverseFrequencyStrict: {
            correct: metrics.inverseFrequencyCorrect, covered: metrics.inverseFrequencyCovered,
            precision: ratio(metrics.inverseFrequencyCorrect, metrics.inverseFrequencyCovered),
            coverage: ratio(metrics.inverseFrequencyCovered, metrics.inverseSampleTargets)
          },
          uniformOrderInvariant: {
            correct: metrics.sampleInversionCorrect, covered: metrics.sampleInversionCovered,
            precision: ratio(metrics.sampleInversionCorrect, metrics.sampleInversionCovered),
            coverage: ratio(metrics.sampleInversionCovered, metrics.inverseSampleTargets)
          },
          inverseFrequencyOrderInvariant: {
            correct: metrics.inverseFrequencyInversionCorrect,
            covered: metrics.inverseFrequencyInversionCovered,
            precision: ratio(metrics.inverseFrequencyInversionCorrect, metrics.inverseFrequencyInversionCovered),
            coverage: ratio(metrics.inverseFrequencyInversionCovered, metrics.inverseSampleTargets)
          },
          lemmaGoldAnnotatedSampleTargets:metrics.inverseSampleLemmaTargets,
          lemmaLevelUniformStrict:{
            candidateCount:metrics.sampleStrictLemmaCandidateCount,
            correct:metrics.sampleStrictLemmaCorrect,covered:metrics.sampleStrictLemmaCovered,
            ambiguousCandidateForms:metrics.sampleStrictLemmaAmbiguous,
            unmappedCandidateForms:metrics.sampleStrictLemmaUnmapped,
            precision:ratio(metrics.sampleStrictLemmaCorrect,metrics.sampleStrictLemmaCovered),
            coverage:ratio(metrics.sampleStrictLemmaCovered,metrics.inverseSampleLemmaTargets)
          },
          lemmaLevelInverseStrict:{
            candidateCount:metrics.inverseFrequencyLemmaCandidateCount,
            correct:metrics.inverseFrequencyLemmaCorrect,covered:metrics.inverseFrequencyLemmaCovered,
            ambiguousCandidateForms:metrics.inverseFrequencyLemmaAmbiguous,
            unmappedCandidateForms:metrics.inverseFrequencyLemmaUnmapped,
            precision:ratio(metrics.inverseFrequencyLemmaCorrect,metrics.inverseFrequencyLemmaCovered),
            coverage:ratio(metrics.inverseFrequencyLemmaCovered,metrics.inverseSampleLemmaTargets)
          },
          lemmaLevelUniformOrderInvariant:{
            candidateCount:metrics.sampleInversionLemmaCandidateCount,
            correct:metrics.sampleInversionLemmaCorrect,covered:metrics.sampleInversionLemmaCovered,
            ambiguousCandidateForms:metrics.sampleInversionLemmaAmbiguous,
            unmappedCandidateForms:metrics.sampleInversionLemmaUnmapped,
            precision:ratio(metrics.sampleInversionLemmaCorrect,metrics.sampleInversionLemmaCovered),
            coverage:ratio(metrics.sampleInversionLemmaCovered,metrics.inverseSampleLemmaTargets)
          },
          lemmaLevelInverseOrderInvariant:{
            candidateCount:metrics.inverseFrequencyInversionLemmaCandidateCount,
            correct:metrics.inverseFrequencyInversionLemmaCorrect,
            covered:metrics.inverseFrequencyInversionLemmaCovered,
            ambiguousCandidateForms:metrics.inverseFrequencyInversionLemmaAmbiguous,
            unmappedCandidateForms:metrics.inverseFrequencyInversionLemmaUnmapped,
            precision:ratio(metrics.inverseFrequencyInversionLemmaCorrect,metrics.inverseFrequencyInversionLemmaCovered),
            coverage:ratio(metrics.inverseFrequencyInversionLemmaCovered,metrics.inverseSampleLemmaTargets)
          }
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
        morphologyParadigmOracle: {
          goldAnnotatedOovTargets:aggregate.paradigmGoldAnnotatedOovTargets,
          surfaceSeenInTraining:aggregate.paradigmSurfaceSeenInTraining,
          surfaceUnseenInTraining:aggregate.paradigmSurfaceUnseenInTraining,
          lemmaSeenInTraining:aggregate.paradigmLemmaSeenInTraining,
          lemmaAndUpOsSeenInTraining:aggregate.paradigmLemmaPosSeenInTraining,
          exactLemmaUpostFeatsSignatureSeen:aggregate.paradigmSignatureSeenInTraining,
          exactSurfaceSeenUnderSignature:aggregate.paradigmExactSurfaceSeenInSignature,
          unseenSurfaceWithKnownSignature:aggregate.paradigmNovelSurfaceWithSeenSignature,
          missingLemmaOrUpostFeatsSignature:aggregate.paradigmMissingLemmaOrPos,
          exactSurfaceRate:ratio(aggregate.paradigmExactSurfaceSeenInSignature,aggregate.paradigmGoldAnnotatedOovTargets),
          knownSignatureRate:ratio(aggregate.paradigmSignatureSeenInTraining,aggregate.paradigmGoldAnnotatedOovTargets),
          denominatorDescription:"annotated OOV targets; diagnostic uses held-out gold lemma, UPOS and FEATS only to estimate an oracle ceiling, never to produce a prediction"
        },
        lemmaLevelContextRetrieval: {
          goldAnnotatedOovTargets:aggregate.lemmaTargets,
          unannotatedOovTargets:aggregate.lemmaUnannotated,
          strict: {
            candidateCount:aggregate.strictLemmaCandidateCount,
            correct:aggregate.strictLemmaCorrect,covered:aggregate.strictLemmaCovered,
            ambiguousCandidateForms:aggregate.strictLemmaAmbiguous,
            unmappedCandidateForms:aggregate.strictLemmaUnmapped,
            precision:ratio(aggregate.strictLemmaCorrect,aggregate.strictLemmaCovered),
            coverage:ratio(aggregate.strictLemmaCovered,aggregate.lemmaTargets)
          },
          orderInvariant: {
            candidateCount:aggregate.inversionLemmaCandidateCount,
            correct:aggregate.inversionLemmaCorrect,covered:aggregate.inversionLemmaCovered,
            ambiguousCandidateForms:aggregate.inversionLemmaAmbiguous,
            unmappedCandidateForms:aggregate.inversionLemmaUnmapped,
            precision:ratio(aggregate.inversionLemmaCorrect,aggregate.inversionLemmaCovered),
            coverage:ratio(aggregate.inversionLemmaCovered,aggregate.lemmaTargets)
          }
        },
        inverseFrequencyRetrievalSameSample: {
          sampledOovTargets: aggregate.inverseSampleTargets,
          uniformStrict: {
            correct: aggregate.sampleStrictCorrect, covered: aggregate.sampleStrictCovered,
            precision: ratio(aggregate.sampleStrictCorrect, aggregate.sampleStrictCovered),
            coverage: ratio(aggregate.sampleStrictCovered, aggregate.inverseSampleTargets)
          },
          inverseFrequencyStrict: {
            correct: aggregate.inverseFrequencyCorrect, covered: aggregate.inverseFrequencyCovered,
            precision: ratio(aggregate.inverseFrequencyCorrect, aggregate.inverseFrequencyCovered),
            coverage: ratio(aggregate.inverseFrequencyCovered, aggregate.inverseSampleTargets)
          },
          uniformOrderInvariant: {
            correct: aggregate.sampleInversionCorrect, covered: aggregate.sampleInversionCovered,
            precision: ratio(aggregate.sampleInversionCorrect, aggregate.sampleInversionCovered),
            coverage: ratio(aggregate.sampleInversionCovered, aggregate.inverseSampleTargets)
          },
          inverseFrequencyOrderInvariant: {
            correct: aggregate.inverseFrequencyInversionCorrect,
            covered: aggregate.inverseFrequencyInversionCovered,
            precision: ratio(aggregate.inverseFrequencyInversionCorrect, aggregate.inverseFrequencyInversionCovered),
            coverage: ratio(aggregate.inverseFrequencyInversionCovered, aggregate.inverseSampleTargets)
          },
          lemmaGoldAnnotatedSampleTargets:aggregate.inverseSampleLemmaTargets,
          lemmaLevelUniformStrict:{
            candidateCount:aggregate.sampleStrictLemmaCandidateCount,
            correct:aggregate.sampleStrictLemmaCorrect,covered:aggregate.sampleStrictLemmaCovered,
            ambiguousCandidateForms:aggregate.sampleStrictLemmaAmbiguous,
            unmappedCandidateForms:aggregate.sampleStrictLemmaUnmapped,
            precision:ratio(aggregate.sampleStrictLemmaCorrect,aggregate.sampleStrictLemmaCovered),
            coverage:ratio(aggregate.sampleStrictLemmaCovered,aggregate.inverseSampleLemmaTargets)
          },
          lemmaLevelInverseStrict:{
            candidateCount:aggregate.inverseFrequencyLemmaCandidateCount,
            correct:aggregate.inverseFrequencyLemmaCorrect,covered:aggregate.inverseFrequencyLemmaCovered,
            ambiguousCandidateForms:aggregate.inverseFrequencyLemmaAmbiguous,
            unmappedCandidateForms:aggregate.inverseFrequencyLemmaUnmapped,
            precision:ratio(aggregate.inverseFrequencyLemmaCorrect,aggregate.inverseFrequencyLemmaCovered),
            coverage:ratio(aggregate.inverseFrequencyLemmaCovered,aggregate.inverseSampleLemmaTargets)
          },
          lemmaLevelUniformOrderInvariant:{
            candidateCount:aggregate.sampleInversionLemmaCandidateCount,
            correct:aggregate.sampleInversionLemmaCorrect,covered:aggregate.sampleInversionLemmaCovered,
            ambiguousCandidateForms:aggregate.sampleInversionLemmaAmbiguous,
            unmappedCandidateForms:aggregate.sampleInversionLemmaUnmapped,
            precision:ratio(aggregate.sampleInversionLemmaCorrect,aggregate.sampleInversionLemmaCovered),
            coverage:ratio(aggregate.sampleInversionLemmaCovered,aggregate.inverseSampleLemmaTargets)
          },
          lemmaLevelInverseOrderInvariant:{
            candidateCount:aggregate.inverseFrequencyInversionLemmaCandidateCount,
            correct:aggregate.inverseFrequencyInversionLemmaCorrect,
            covered:aggregate.inverseFrequencyInversionLemmaCovered,
            ambiguousCandidateForms:aggregate.inverseFrequencyInversionLemmaAmbiguous,
            unmappedCandidateForms:aggregate.inverseFrequencyInversionLemmaUnmapped,
            precision:ratio(aggregate.inverseFrequencyInversionLemmaCorrect,aggregate.inverseFrequencyInversionLemmaCovered),
            coverage:ratio(aggregate.inverseFrequencyInversionLemmaCovered,aggregate.inverseSampleLemmaTargets)
          }
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
  summary.trainingContextRetrievalExperiment = {
    onlyChangedVariable: "uniform versus inverse-frequency candidate scoring",
    morphologyParadigmOracle: "upper-bound diagnostic only; training paradigm inventory is built from the model's exact training partition; held-out gold lemma/UPOS/FEATS are used only to score availability and never enter candidate generation",
    evaluation: "same deterministic one-in-four OOV target slice for all four retrieval modes",
    lemmaEvaluation: "candidate surface forms mapped to UD gold lemmas from training split only; held-out gold lemma used only for scoring",
    orderInversionSeparatelyControlled: true
  };
  console.log("NEUROGENESIS 0.58.111 UD_Russian-GSD benchmark: " + JSON.stringify(summary));
  console.log("External corpus benchmark is separate from the frozen 49-sentence language benchmark.");
}
