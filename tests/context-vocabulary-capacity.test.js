"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const trainPath = process.argv[2];
const testPath = process.argv[3];
assert.ok(trainPath && testPath, "supply pinned UD Russian-GSD train and test CoNLL-U files");
const prepared = importer.prepareCorpus(
  fs.readFileSync(trainPath, "utf8"),
  fs.readFileSync(testPath, "utf8"),
  {trainLimit:320,testLimit:240,seed:20261112,minimumTokens:4,maximumTokens:40}
);
assert.equal(prepared.trainingTexts.length,320);
assert.equal(prepared.testTexts.length,240);
assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps,0,
  "the vocabulary-capacity experiment must use the same decontaminated independent split");

const window = {};
const sandbox = {window,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,
  {filename:"contextual-attention.js"});
const Attention = window.NGContextualModel;
assert.ok(Attention && Attention.schema === "NG_CONTEXTUAL_ATTENTION_V5");

const seeds = [
  {model:9173,split:902},
  {model:31415,split:2718},
  {model:2718,split:9044}
];
const capacities = [1024,2048];
const aggregate = Object.fromEntries(capacities.map(capacity=>[capacity,{
  targets:0,evaluated:0,known:0,exact:0,morphologyCovered:0,morphologyCorrect:0,
  oov:0,vocabularySize:0,saturatedSeeds:0
}]));
const seedReports = [];
const ratio = (n,d) => d ? n/d : null;

for (const seed of seeds) {
  const reports = {};
  let referenceSplit = null;
  for (const capacity of capacities) {
    const model = Attention.create({
      dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model,
      vocabularyCapacity:capacity
    });
    assert.equal(model.status().vocabularyCapacity,capacity);
    const training = model.train(prepared.trainingTexts,{
      epochs:20,learningRate:0.02,patience:8,splitSeed:seed.split
    });
    const split = model.splitCorpus(prepared.trainingTexts,seed.split);
    assert.equal(split.train.length,training.trainRows);
    assert.equal(split.validation.length,training.validationRows);
    assert.equal(split.test.length,training.testRows);
    if (referenceSplit) {
      assert.deepEqual(split,referenceSplit,
        "vocabulary capacity must not alter train/validation/test sentence partitions");
    } else {
      referenceSplit = split;
    }
    assert.equal(training.vocabularySize,model.status().vocabularySize);
    assert.ok(training.vocabularySize<=capacity);
    const metrics = {
      targets:0,evaluated:0,known:0,exact:0,morphologyCovered:0,morphologyCorrect:0
    };
    for (const sentence of prepared.testTexts) {
      const tokens = Attention.tokenize(sentence);
      for (let index=0;index<tokens.length;index++) {
        metrics.targets++;
        const score = model.score(sentence,index);
        if (!score) continue;
        metrics.evaluated++;
        if (score.targetKnown) {
          metrics.known++;
          if (score.predictions[0]?.token===tokens[index]) metrics.exact++;
        }
        if (score.morphologyKnown) {
          metrics.morphologyCovered++;
          if (score.morphologyCorrect) metrics.morphologyCorrect++;
        }
      }
    }
    assert.equal(metrics.targets,metrics.evaluated,
      "all independent test tokens must be scored in both capacity variants");
    const saturated = model.status().vocabularySaturated;
    const row = {
      capacity,
      vocabularySize:training.vocabularySize,
      vocabularySaturated:saturated,
      trainRows:training.trainRows,
      validationRows:training.validationRows,
      internalTestRows:training.testRows,
      targets:metrics.targets,
      knownTargets:metrics.known,
      oovTargets:metrics.targets-metrics.known,
      knownCoverage:ratio(metrics.known,metrics.targets),
      exactKnownCorrect:metrics.exact,
      exactKnownAccuracy:ratio(metrics.exact,metrics.known),
      allTargetAccuracy:ratio(metrics.exact,metrics.targets),
      morphologyCovered:metrics.morphologyCovered,
      morphologyCoverage:ratio(metrics.morphologyCovered,metrics.targets),
      morphologyCorrect:metrics.morphologyCorrect,
      morphologyAccuracy:ratio(metrics.morphologyCorrect,metrics.morphologyCovered)
    };
    reports[capacity] = row;
    const total = aggregate[capacity];
    for (const key of ["targets","evaluated","known","exact","morphologyCovered","morphologyCorrect"]) {
      total[key]+=metrics[key];
    }
    total.vocabularySize+=training.vocabularySize;
    if(saturated)total.saturatedSeeds++;
  }
  reports.delta = {
    vocabularySize:reports[2048].vocabularySize-reports[1024].vocabularySize,
    knownCoveragePercentagePoints:(reports[2048].knownCoverage-reports[1024].knownCoverage)*100,
    exactKnownAccuracyPercentagePoints:(reports[2048].exactKnownAccuracy-reports[1024].exactKnownAccuracy)*100,
    allTargetAccuracyPercentagePoints:(reports[2048].allTargetAccuracy-reports[1024].allTargetAccuracy)*100,
    morphologyCoveragePercentagePoints:(reports[2048].morphologyCoverage-reports[1024].morphologyCoverage)*100,
    morphologyAccuracyPercentagePoints:(reports[2048].morphologyAccuracy-reports[1024].morphologyAccuracy)*100
  };
  seedReports.push({modelSeed:seed.model,splitSeed:seed.split,variants:reports});
}

const summary = {
  benchmark:"NEUROGENESIS contextual vocabulary-capacity experiment",
  version:"0.58.120",
  source:{
    treebank:"UD_Russian-GSD",release:"r2.18",
    commit:"9acc9d677327043bd416fcc89e4b3407c620d885",
    license:"CC BY-SA 4.0"
  },
  protocol:{
    seeds,
    capacities,
    trainSentences:prepared.trainingTexts.length,
    independentTestSentences:prepared.testTexts.length,
    sameTrainValidationTestSplits:true,
    sameModelSeedsAndTrainingHyperparameters:true,
    onlyChangedVariable:"configured output-vocabulary capacity",
    normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps,
    independentTestUse:"evaluation only"
  },
  aggregate:Object.fromEntries(capacities.map(capacity=>{
    const row=aggregate[capacity];
    return [capacity,{
      ...row,
      meanVocabularySize:row.vocabularySize/seeds.length,
      knownCoverage:ratio(row.known,row.targets),
      exactKnownAccuracy:ratio(row.exact,row.known),
      allTargetAccuracy:ratio(row.exact,row.targets),
      morphologyCoverage:ratio(row.morphologyCovered,row.targets),
      morphologyAccuracy:ratio(row.morphologyCorrect,row.morphologyCovered)
    }];
  })),
  seeds:seedReports
};
assert.equal(summary.protocol.normalizedSentenceLeakage,0);
assert.ok(summary.aggregate[2048].known>=summary.aggregate[1024].known,
  "the larger output vocabulary must not reduce the number of covered test targets");
console.log("NEUROGENESIS 0.58.120 contextual vocabulary-capacity experiment: "+JSON.stringify(summary));
