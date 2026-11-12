"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const trainPath = process.argv[2];
const testPath = process.argv[3];
if (!trainPath && !testPath) {
  console.log("NEUROGENESIS contextual dependency benchmark: external corpus files not supplied.");
  process.exit(0);
}
assert.ok(trainPath && testPath,"supply both pinned UD train and test CoNLL-U files");

const prepared = importer.prepareCorpus(
  fs.readFileSync(trainPath,"utf8"),
  fs.readFileSync(testPath,"utf8"),
  {trainLimit:320,testLimit:240,seed:20261112,minimumTokens:4,maximumTokens:40}
);
assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps,0);
assert.equal(prepared.trainingRecords.length,320);
assert.equal(prepared.testRecords.length,240);

const window = {};
const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for (const file of ["contextual-attention.js","dependency-supervision.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const Attention = window.NGContextualModel;
const Dependency = window.NGDependencySupervision;
assert.ok(Attention && Dependency);
assert.equal(Dependency.schema,"NG_DEPENDENCY_HEAD_RELATION_V1");

const seeds = [
  {model:9173,split:902},
  {model:31415,split:2718},
  {model:2718,split:9044}
];
const variants = {
  unweighted:{classWeighting:"none",selectionMetric:"component_specific"},
  sqrtInverse:{classWeighting:"sqrt_inverse",selectionMetric:"component_specific"}
};
assert.equal(new Set(Object.values(variants).map(row=>row.selectionMetric)).size,1,
  "dependency weighting variants must use the same component-specific validation checkpoint protocol");

function recordsFor(rows,map) {
  return rows.map(text => {
    const record=map.get(importer.normalizeSentence(text));
    assert.ok(record,"each contextual split sentence must map to its annotated UD record");
    return record;
  });
}
function baseline(rows,majorityRelation) {
  let headCorrect=0,relationCorrect=0,lasCorrect=0;
  for(const row of rows) {
    const nearestLeftHead=row.dependentIndex===0?0:row.tokenIds[row.dependentIndex-1];
    const correctHead=nearestLeftHead===row.candidateHeadIds[row.targetCandidateIndex];
    const correctRelation=majorityRelation===row.relation;
    if(correctHead)headCorrect++;
    if(correctRelation)relationCorrect++;
    if(correctHead&&correctRelation)lasCorrect++;
  }
  return {
    targets:rows.length,
    headCorrect,
    headAccuracy:rows.length?headCorrect/rows.length:null,
    majorityRelationCorrect:relationCorrect,
    majorityRelationAccuracy:rows.length?relationCorrect/rows.length:null,
    lasCorrect,
    las:rows.length?lasCorrect/rows.length:null
  };
}
function ratio(numerator,denominator) {
  return denominator?numerator/denominator:null;
}
function summarize(rows,head,majorityRelation) {
  const metrics=head.evaluate(rows);
  return {
    ...metrics,
    coverage:ratio(metrics.targets,rows.length),
    baseline:baseline(rows,majorityRelation)
  };
}
function addTotals(target,source) {
  for(const key of ["targets","headCorrect","oracleRelationCorrect","predictedHeadRelationCorrect","relationCovered","lasCorrect"]) {
    target[key]+=source[key]||0;
  }
  target.baselineHeadCorrect+=source.baseline.headCorrect||0;
  target.baselineRelationCorrect+=source.baseline.majorityRelationCorrect||0;
  target.baselineLASCorrect+=source.baseline.lasCorrect||0;
}
function emptyTotals() {
  return {
    targets:0,headCorrect:0,oracleRelationCorrect:0,predictedHeadRelationCorrect:0,
    relationCovered:0,lasCorrect:0,
    baselineHeadCorrect:0,baselineRelationCorrect:0,baselineLASCorrect:0,
    oracleHeadRelationMacroF1BySeed:[],
    predictedHeadRelationMacroF1BySeed:[]
  };
}
const aggregate = Object.fromEntries(Object.keys(variants).map(variant=>[
  variant,Object.fromEntries(["all","knownLemma","unseenLemma"].map(slice=>[slice,emptyTotals()]))
]));
const seedReports=[];

for(const seed of seeds) {
  const contextual=Attention.create({
    dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model
  });
  const contextualTraining=contextual.train(prepared.trainingTexts,{
    epochs:20,learningRate:.02,patience:8,splitSeed:seed.split
  });
  assert.equal(contextualTraining.evaluationIsolated,true,
    "dependency supervision requires a contextual encoder with a held-out evaluation partition");
  const split=contextual.splitCorpus(prepared.trainingTexts,seed.split);
  assert.equal(split.train.length,contextualTraining.trainRows);
  assert.equal(split.validation.length,contextualTraining.validationRows);

  const recordMap=new Map(prepared.trainingRecords.map(row=>[row.normalized,row]));
  const training=Dependency.extractExamples(recordsFor(split.train,recordMap),contextual);
  const validation=Dependency.extractExamples(recordsFor(split.validation,recordMap),contextual);
  const testing=Dependency.extractExamples(prepared.testRecords,contextual);
  assert.ok(training.groups.length>0&&validation.groups.length>0&&testing.groups.length>0);
  assert.ok(training.groups.some(row=>row.relation==="root"));
  assert.ok(validation.groups.some(row=>row.relation==="root"));
  assert.ok(testing.groups.some(row=>row.relation==="root"));
  const seenLemmas=new Set(training.groups.map(row=>row.lemma).filter(Boolean));
  const slices={
    all:testing.groups,
    knownLemma:testing.groups.filter(row=>seenLemmas.has(row.lemma)),
    unseenLemma:testing.groups.filter(row=>!seenLemmas.has(row.lemma))
  };
  assert.ok(slices.unseenLemma.length>0,
    "independent test must include dependent lemmas not seen in the supervised training split");

  const variantReports={};
  for(const [variant,configuration] of Object.entries(variants)) {
    const head=Dependency.create({seed:seed.model});
    const trainingReport=head.train(training.groups,validation.groups,{
      epochs:12,learningRate:.012,patience:4,seed:seed.model,minimumClassExamples:12,...configuration
    });
    assert.ok(trainingReport.classes.length>=2);
    assert.ok(trainingReport.validationExamples>0);
    assert.ok(Number.isFinite(trainingReport.validationHeadAccuracy));
    assert.ok(Number.isFinite(trainingReport.validationOracleHeadRelationMacroF1),
      "validation must contain at least one DEPREL class supported by supervised training");
    assert.equal(trainingReport.classWeighting,configuration.classWeighting);
    assert.equal(trainingReport.selectionMetric,"validation_uas_and_relation_macro_f1");
    assert.equal(trainingReport.trainExamples,training.groups.length);
    assert.equal(trainingReport.validationExamples,validation.groups.length);

    const metrics=Object.fromEntries(Object.entries(slices).map(([key,rows])=>[
      key,summarize(rows,head,trainingReport.majorityLabel)
    ]));
    for(const key of Object.keys(slices)) {
      assert.equal(metrics[key].targets,slices[key].length);
      assert.equal(metrics[key].headCorrect<=metrics[key].targets,true);
      assert.equal(metrics[key].lasCorrect<=metrics[key].headCorrect,true);
      addTotals(aggregate[variant][key],metrics[key]);
      aggregate[variant][key].oracleHeadRelationMacroF1BySeed.push(metrics[key].oracleHeadRelationMacroF1);
      aggregate[variant][key].predictedHeadRelationMacroF1BySeed.push(metrics[key].predictedHeadRelationMacroF1);
    }
    variantReports[variant]={training:trainingReport,metrics};
  }
  for (const slice of Object.keys(slices)) {
    assert.equal(variantReports.unweighted.metrics[slice].headCorrect,
      variantReports.sqrtInverse.metrics[slice].headCorrect,
      "only relation-class weighting may change; paired attachment predictions must remain identical for "+slice);
  }
  assert.equal(variantReports.unweighted.training.bestArcEpoch,
    variantReports.sqrtInverse.training.bestArcEpoch,
    "relation weighting must not change the attachment checkpoint epoch");
  assert.equal(variantReports.unweighted.training.trainingSteps,
    variantReports.sqrtInverse.training.trainingSteps,
    "relation weighting must not change the number of paired attachment training updates");
  assert.deepEqual(
    Object.keys(variantReports.unweighted.metrics),
    Object.keys(variantReports.sqrtInverse.metrics),
    "both weighting variants must evaluate the exact same lemma slices"
  );
  seedReports.push({
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
      training:training.stats,
      validation:validation.stats,
      independentTest:testing.stats
    },
    seenLemmas:seenLemmas.size,
    slices:Object.fromEntries(Object.entries(slices).map(([key,rows])=>[key,rows.length])),
    variants:variantReports
  });
}

const aggregateReport=Object.fromEntries(Object.entries(aggregate).map(([variant,slices])=>[
  variant,Object.fromEntries(Object.entries(slices).map(([slice,row])=>[
    slice,{
      targets:row.targets,
      correctHeads:row.headCorrect,
      headAccuracy:ratio(row.headCorrect,row.targets),
      oracleRelationCorrect:row.oracleRelationCorrect,
      oracleRelationAccuracy:ratio(row.oracleRelationCorrect,row.relationCovered),
      predictedHeadRelationCorrect:row.predictedHeadRelationCorrect,
      predictedHeadRelationAccuracy:ratio(row.predictedHeadRelationCorrect,row.targets),
      relationCovered:row.relationCovered,
      relationCoverage:ratio(row.relationCovered,row.targets),
      correctLAS:row.lasCorrect,
      LAS:ratio(row.lasCorrect,row.targets),
      nearestLeftBaselineHeadAccuracy:ratio(row.baselineHeadCorrect,row.targets),
      majorityRelationBaselineAccuracy:ratio(row.baselineRelationCorrect,row.targets),
      baselineLAS:ratio(row.baselineLASCorrect,row.targets),
      meanOracleHeadRelationMacroF1AcrossSeeds:row.oracleHeadRelationMacroF1BySeed.filter(Number.isFinite).length
        ?row.oracleHeadRelationMacroF1BySeed.filter(Number.isFinite).reduce((sum,value)=>sum+value,0)/
          row.oracleHeadRelationMacroF1BySeed.filter(Number.isFinite).length:null,
      oracleHeadRelationMacroF1BySeed:row.oracleHeadRelationMacroF1BySeed,
      meanPredictedHeadRelationMacroF1AcrossSeeds:row.predictedHeadRelationMacroF1BySeed.filter(Number.isFinite).length
        ?row.predictedHeadRelationMacroF1BySeed.filter(Number.isFinite).reduce((sum,value)=>sum+value,0)/
          row.predictedHeadRelationMacroF1BySeed.filter(Number.isFinite).length:null,
      predictedHeadRelationMacroF1BySeed:row.predictedHeadRelationMacroF1BySeed
    }
  ]))
]));

const summary={
  benchmark:"NEUROGENESIS contextual dependency-head and DEPREL supervision pilot",
  version:"0.58.120",
  source:{
    treebank:"UD_Russian-GSD",release:"r2.18",
    commit:"9acc9d677327043bd416fcc89e4b3407c620d885",
    license:"CC BY-SA 4.0"
  },
  protocol:{
    seeds,
    variants,
    sameContextualEncoderAndSentenceSplits:true,
    headSelection:"softmax over ROOT and every other token in the sentence",
    relationPrediction:"DEPREL classifier trained on gold dependent-head pairs; oracle-head and predicted-head relation metrics are reported separately",
    componentSpecificCheckpointSelection:{
      attachment:"validation UAS",
      dependencyRelation:"validation oracle-head relation macro-F1",
      combinedLAS:"reported independently; not used to select either component"
    },
    classWeightsDerivedOnlyFromSupervisedTrainRows:true,
    minimumClassExamples:12,
    rareRelationsBelowThreshold:"not fitted by the relation head; explicitly counted in relation coverage and remain errors for LAS",
    independentTestUse:"evaluation only",
    lemmaSlice:"dependent-word lemma overlap with the supervised training split",
    treeConstraint:"none; attachment scores are local per-token head predictions, not globally decoded dependency trees"
  },
  isolation:{
    trainSentences:prepared.trainingRecords.length,
    independentTestSentences:prepared.testRecords.length,
    normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps,
    supervisedAnnotationsUsedOnlyFromContextualTrainSplit:true,
    validationUsedOnlyForComponentSpecificCheckpointSelection:true,
    independentTestUsedOnlyForEvaluation:true
  },
  aggregate:aggregateReport,
  seeds:seedReports
};
assert.equal(summary.isolation.normalizedSentenceLeakage,0);
assert.ok(aggregateReport.unweighted.all.targets>0);
assert.ok(aggregateReport.unweighted.unseenLemma.targets>0);
assert.equal(
  aggregateReport.unweighted.all.targets,
  aggregateReport.sqrtInverse.all.targets
);
console.log("NEUROGENESIS 0.58.120 contextual dependency-head/DEPREL benchmark: "+JSON.stringify(summary));
