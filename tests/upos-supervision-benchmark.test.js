"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const trainPath = process.argv[2];
const testPath = process.argv[3];
if (!trainPath && !testPath) {
  console.log("NEUROGENESIS contextual UPOS benchmark: external corpus files not supplied.");
  process.exit(0);
}
assert.ok(trainPath && testPath, "supply both pinned UD train and test CoNLL-U files");
const prepared = importer.prepareCorpus(
  fs.readFileSync(trainPath, "utf8"),
  fs.readFileSync(testPath, "utf8"),
  {trainLimit:320,testLimit:240,seed:20261112,minimumTokens:4,maximumTokens:40}
);
assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps,0);
assert.equal(prepared.trainingRecords.length,320);
assert.equal(prepared.testRecords.length,240);

const window = {};
const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for (const file of ["contextual-attention.js","upos-supervision.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const Attention = window.NGContextualModel;
const Supervision = window.NGWordSupervision;
assert.ok(Attention&&Supervision);

const seeds = [
  {model:9173,split:902},
  {model:31415,split:2718},
  {model:2718,split:9044}
];
const variants = {
  unweighted: {classWeighting:"none",selectionMetric:"macro_f1"},
  sqrtInverse: {classWeighting:"sqrt_inverse",selectionMetric:"macro_f1"}
};
assert.equal(new Set(Object.values(variants).map(row=>row.selectionMetric)).size,1,
  "UPOS weighting variants must use the same validation checkpoint-selection metric");
const normalizedRecordMap = new Map(prepared.trainingRecords.map(row=>[row.normalized,row]));
const seedsReport = [];
const groupTotals = Object.fromEntries(Object.keys(variants).map(variant=>[variant,
  Object.fromEntries(["all","knownLemma","unseenLemma"].map(key=>[key,{
    targets:0,covered:0,correct:0,majorityBaselineCorrect:0
  }]))
]));
const ratio=(numerator,denominator)=>denominator?numerator/denominator:null;

function summarize(examples,head,majorityLabel) {
  const report=head.evaluate(examples);
  const supported=new Set(head.status().labels);
  const coveredExamples=examples.filter(row=>supported.has(row.label));
  const majorityBaselineCorrect=coveredExamples.filter(row=>row.label===majorityLabel).length;
  return {
    targets:report.targets,
    covered:report.covered,
    correct:report.correct,
    accuracy:ratio(report.correct,report.covered),
    coverage:ratio(report.covered,report.targets),
    majorityBaselineCorrect,
    majorityBaselineAccuracy:ratio(majorityBaselineCorrect,report.covered),
    macroF1:report.macroF1,
    perClass:report.perClass
  };
}
function addGroup(target,source) {
  for(const key of ["targets","covered","correct","majorityBaselineCorrect"])target[key]+=source[key]||0;
}

for (const seed of seeds) {
  const contextual=Attention.create({
    dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model
  });
  const contextualTraining=contextual.train(prepared.trainingTexts,{
    epochs:20,learningRate:.02,patience:8,splitSeed:seed.split
  });
  assert.ok(contextualTraining.evaluationIsolated===true);
  const split=contextual.splitCorpus(prepared.trainingTexts,seed.split);
  assert.equal(split.train.length,contextualTraining.trainRows);
  assert.equal(split.validation.length,contextualTraining.validationRows);
  const recordsFor=rows=>rows.map(text=>{
    const record=normalizedRecordMap.get(importer.normalizeSentence(text));
    assert.ok(record,"each internal sentence split must map to its original annotated training record");
    return record;
  });
  const trainRecords=recordsFor(split.train);
  const validationRecords=recordsFor(split.validation);
  const trainSet=Supervision.extractExamples(trainRecords,contextual);
  const validationSet=Supervision.extractExamples(validationRecords,contextual);
  const testSet=Supervision.extractExamples(prepared.testRecords,contextual);
  assert.ok(trainSet.examples.length>0&&validationSet.examples.length>0&&testSet.examples.length>0);

  const seenLemmas=new Set(trainSet.examples.map(row=>row.lemma).filter(Boolean));
  const groups={
    all:testSet.examples,
    knownLemma:testSet.examples.filter(row=>seenLemmas.has(row.lemma)),
    unseenLemma:testSet.examples.filter(row=>!seenLemmas.has(row.lemma))
  };
  const variantReports={};
  for(const [variant,configuration] of Object.entries(variants)){
    const head=Supervision.create({seed:seed.model});
    const headTraining=head.train(trainSet.examples,validationSet.examples,{
      epochs:80,learningRate:.035,patience:12,seed:seed.model,...configuration
    });
    assert.ok(headTraining.classes.length>=2);
    const metrics=Object.fromEntries(Object.entries(groups).map(([key,examples])=>[
      key,summarize(examples,head,headTraining.majorityLabel)
    ]));
    for(const key of Object.keys(groupTotals[variant]))addGroup(groupTotals[variant][key],metrics[key]);
    variantReports[variant]={training:headTraining,metrics};
  }
  seedsReport.push({
    modelSeed:seed.model,
    splitSeed:seed.split,
    contextualTraining:{
      trainRows:contextualTraining.trainRows,
      validationRows:contextualTraining.validationRows,
      internalTestRows:contextualTraining.testRows,
      vocabularySize:contextualTraining.vocabularySize,
      epochs:contextualTraining.epochs
    },
    extraction:{
      training:trainSet.stats,
      validation:validationSet.stats,
      independentTest:testSet.stats
    },
    variants:variantReports
  });
}

const aggregate=Object.fromEntries(Object.entries(groupTotals).map(([variant,groups])=>[
  variant,Object.fromEntries(Object.entries(groups).map(([key,row])=>[key,{
    ...row,
    accuracy:ratio(row.correct,row.covered),
    coverage:ratio(row.covered,row.targets),
    majorityBaselineAccuracy:ratio(row.majorityBaselineCorrect,row.covered)
  }]))
]));
const summary={
  benchmark:"NEUROGENESIS supervised contextual UPOS class-balance experiment",
  version:"0.58.116",
  source:{
    treebank:"UD_Russian-GSD",release:"r2.18",
    commit:"9acc9d677327043bd416fcc89e4b3407c620d885",
    license:"CC BY-SA 4.0"
  },
  protocol:{
    seeds,
    variants,
    sameEncoderAndSplitsForBothHeads:true,
    classWeightsDerivedOnlyFromSupervisedTrainingRows:true,
    unweightedEarlyStopping:"validation cross-entropy",
    sqrtInverseEarlyStopping:"validation macro-F1",
    sqrtInverseFormula:"sqrt(N / (K * classCount)), normalized to mean sample weight 1"
  },
  isolation:{
    trainSentences:prepared.trainingRecords.length,
    independentTestSentences:prepared.testRecords.length,
    normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps,
    supervisedAnnotationsUsedOnlyFromModelTrainSplit:true,
    validationUsedOnlyForEarlyStopping:true,
    independentTestUsedOnlyForEvaluation:true
  },
  aggregate,
  seeds:seedsReport
};
assert.equal(summary.isolation.normalizedSentenceLeakage,0);
assert.ok(aggregate.unweighted.unseenLemma.targets>0,
  "the independent test must include lemmas not seen in the supervised training partition");
assert.deepEqual(
  Object.values(aggregate.sqrtInverse).map(row=>row.targets),
  Object.values(aggregate.unweighted).map(row=>row.targets),
  "both variants must use the exact same independent test rows"
);
console.log("NEUROGENESIS 0.58.116 supervised contextual UPOS class-balance benchmark: "+JSON.stringify(summary));
