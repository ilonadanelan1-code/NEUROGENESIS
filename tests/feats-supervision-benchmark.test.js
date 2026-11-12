"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const trainPath = process.argv[2];
const testPath = process.argv[3];
if (!trainPath && !testPath) {
  console.log("NEUROGENESIS contextual FEATS benchmark: external corpus files not supplied.");
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
for (const file of ["contextual-attention.js","feats-supervision.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const Attention = window.NGContextualModel;
const Feats = window.NGFeatsSupervision;
assert.ok(Attention && Feats);

const seeds = [
  {model:9173,split:902},
  {model:31415,split:2718},
  {model:2718,split:9044}
];
const variants = {
  unweighted:{classWeighting:"none",selectionMetric:"macro_f1"},
  sqrtInverse:{classWeighting:"sqrt_inverse",selectionMetric:"macro_f1"}
};
assert.equal(new Set(Object.values(variants).map(row=>row.selectionMetric)).size,1,
  "FEATS weighting variants must use the same validation checkpoint-selection metric");
const selectedAttributes = [
  "Case","Number","Gender","Tense","Person","VerbForm","Aspect",
  "Degree","Animacy","Mood","Voice","PronType","NumType"
];
const minimumClassExamples = 12;
const maximumAttributes = 9;
const ratio = (n,d) => d ? n/d : null;

function recordsFor(rows,map) {
  return rows.map(text => {
    const record = map.get(importer.normalizeSentence(text));
    assert.ok(record,"each internal text split must map to its original annotated record");
    return record;
  });
}
function filterLabels(rows,labels) {
  const supported = new Set(labels);
  return rows.filter(row => supported.has(row.label));
}
function summarize(allRows,head,majorityLabel,lemmas=null) {
  const rows = lemmas
    ? allRows.filter(row => lemmas.has(row.lemma))
    : allRows;
  const labels = new Set(head.status().labels);
  const coveredRows = rows.filter(row => labels.has(row.label));
  const report = head.evaluate(coveredRows);
  const counts = Object.create(null);
  for(const row of coveredRows) counts[row.label]=(counts[row.label]||0)+1;
  const majorityCorrect = counts[majorityLabel] || 0;
  const majorityMacroRows = Object.entries(counts).map(([label,targets])=>{
    const truePositive = label===majorityLabel ? targets : 0;
    const predicted = label===majorityLabel ? coveredRows.length : 0;
    const precision = predicted ? truePositive/predicted : 0;
    const recall = targets ? truePositive/targets : 0;
    return precision+recall ? 2*precision*recall/(precision+recall) : 0;
  });
  const majorityBaselineMacroF1 = majorityMacroRows.length
    ? majorityMacroRows.reduce((sum,value)=>sum+value,0)/majorityMacroRows.length : null;
  return {
    targets:rows.length,
    covered:coveredRows.length,
    correct:report.correct,
    unsupported:rows.length-coveredRows.length,
    accuracy:ratio(report.correct,coveredRows.length),
    coverage:ratio(coveredRows.length,rows.length),
    majorityBaselineCorrect:majorityCorrect,
    majorityBaselineAccuracy:ratio(majorityCorrect,coveredRows.length),
    majorityBaselineMacroF1,
    macroF1:report.macroF1,
    perClass:report.perClass
  };
}
function add(target,source) {
  for(const key of ["targets","covered","correct","unsupported","majorityBaselineCorrect"])
    target[key] += source[key] || 0;
}
function difference(left,right) {
  return Number.isFinite(left) && Number.isFinite(right) ? left-right : null;
}
function aggregateVariant(aggregate,variant,attribute,metrics,seed) {
  const row = aggregate[variant][attribute] || (aggregate[variant][attribute]={
    all:{targets:0,covered:0,correct:0,unsupported:0,majorityBaselineCorrect:0},
    knownLemma:{targets:0,covered:0,correct:0,unsupported:0,majorityBaselineCorrect:0},
    unseenLemma:{targets:0,covered:0,correct:0,unsupported:0,majorityBaselineCorrect:0},
    macroF1BySeed:[]
  });
  add(row.all,metrics.all);
  add(row.knownLemma,metrics.knownLemma);
  add(row.unseenLemma,metrics.unseenLemma);
  row.macroF1BySeed.push({
    seed,
    all:metrics.all.macroF1,
    allMajorityBaseline:metrics.all.majorityBaselineMacroF1,
    unseenLemma:metrics.unseenLemma.macroF1,
    unseenLemmaMajorityBaseline:metrics.unseenLemma.majorityBaselineMacroF1
  });
}

const recordMap = new Map(prepared.trainingRecords.map(row=>[row.normalized,row]));
const seedReports = [];
const aggregate = Object.fromEntries(Object.keys(variants).map(variant=>[variant,Object.create(null)]));

for(const seed of seeds) {
  const contextual = Attention.create({
    dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model
  });
  const contextualTraining = contextual.train(prepared.trainingTexts,{
    epochs:20,learningRate:.02,patience:8,splitSeed:seed.split
  });
  assert.ok(contextualTraining.evaluationIsolated===true,
    "contextual encoder must preserve its held-out training partition");
  const split = contextual.splitCorpus(prepared.trainingTexts,seed.split);
  assert.equal(split.train.length,contextualTraining.trainRows);
  assert.equal(split.validation.length,contextualTraining.validationRows);

  const trainSet = Feats.extractExamples(recordsFor(split.train,recordMap),contextual);
  const validationSet = Feats.extractExamples(recordsFor(split.validation,recordMap),contextual);
  const testSet = Feats.extractExamples(prepared.testRecords,contextual);
  assert.ok(trainSet.stats.featureTargets>0);
  assert.ok(validationSet.stats.featureTargets>0);
  assert.ok(testSet.stats.featureTargets>0);

  const candidates = [];
  for(const attribute of selectedAttributes) {
    const rows = trainSet.byAttribute[attribute] || [];
    const counts = Object.create(null);
    for(const row of rows) counts[row.label] = (counts[row.label]||0)+1;
    const supportedLabels = Object.entries(counts)
      .filter(([,count])=>count>=minimumClassExamples)
      .map(([label])=>label).sort();
    if(supportedLabels.length<2) continue;
    candidates.push({
      attribute,trainTargets:rows.length,supportedLabels,
      trainLabelCounts:counts
    });
  }
  candidates.sort((a,b)=>b.trainTargets-a.trainTargets||a.attribute.localeCompare(b.attribute));
  const selected = candidates.slice(0,maximumAttributes);
  assert.ok(selected.length>=4,
    "the fixed FEATS shortlist must provide at least four train-supported attributes");

  const attributeReports = Object.create(null);
  for(const item of selected) {
    const attribute = item.attribute;
    const trainRows = filterLabels(trainSet.byAttribute[attribute]||[],item.supportedLabels);
    const validationRows = filterLabels(validationSet.byAttribute[attribute]||[],item.supportedLabels);
    const testRows = testSet.byAttribute[attribute]||[];
    assert.ok(trainRows.length>0&&validationRows.length>0&&testRows.length>0,
      "each reported attribute must have train, validation and independent test examples");

    const trainLemmas = new Set(trainRows.map(row=>row.lemma).filter(Boolean));
    const variantReports = Object.create(null);
    for(const [variant,configuration] of Object.entries(variants)) {
      const head = Feats.create({seed:seed.model});
      const training = head.train(trainRows,validationRows,{
        epochs:55,learningRate:.03,patience:9,seed:seed.model,...configuration
      });
      assert.ok(training.classes.length>=2);
      assert.ok(training.validationExamples>0);
      assert.equal(training.classWeighting,configuration.classWeighting);
      assert.equal(training.selectionMetric,
        configuration.selectionMetric==="loss"?"validation_loss":"validation_macro_f1");

      const all = summarize(testRows,head,training.majorityLabel);
      const known = summarize(testRows,head,training.majorityLabel,trainLemmas);
      const unseenRows = testRows.filter(row=>!trainLemmas.has(row.lemma));
      const unseen = summarize(unseenRows,head,training.majorityLabel);
      assert.equal(all.targets,testRows.length);
      assert.equal(all.covered+all.unsupported,all.targets);
      assert.equal(known.targets+unseen.targets,all.targets);
      if(all.covered) assert.ok(Number.isFinite(all.accuracy));
      if(unseen.covered) assert.ok(Number.isFinite(unseen.accuracy));

      const metrics={all,knownLemma:known,unseenLemma:unseen};
      aggregateVariant(aggregate,variant,attribute,metrics,seed.model);
      variantReports[variant]={training,metrics};
    }

    const weighted = variantReports.sqrtInverse.metrics;
    const unweighted = variantReports.unweighted.metrics;
    attributeReports[attribute] = {
      trainTargets:item.trainTargets,
      supportedLabels:item.supportedLabels,
      trainLabelCounts:item.trainLabelCounts,
      identicalTrainValidationAndTestRows:true,
      comparison:{
        allAccuracyDelta:difference(weighted.all.accuracy,unweighted.all.accuracy),
        unseenLemmaAccuracyDelta:difference(weighted.unseenLemma.accuracy,unweighted.unseenLemma.accuracy),
        allMacroF1Delta:difference(weighted.all.macroF1,unweighted.all.macroF1),
        unseenLemmaMacroF1Delta:difference(weighted.unseenLemma.macroF1,unweighted.unseenLemma.macroF1)
      },
      variants:variantReports
    };
  }
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
      training:trainSet.stats,
      validation:validationSet.stats,
      independentTest:testSet.stats
    },
    minimumClassExamples,
    attributes:attributeReports
  });
}

const aggregateReport = Object.fromEntries(Object.entries(aggregate).map(([variant,attributes])=>{
  const perAttribute = Object.fromEntries(Object.entries(attributes).map(([attribute,row])=>{
    const metrics = {};
    for(const key of ["all","knownLemma","unseenLemma"]) {
      const value=row[key];
      metrics[key]={
        ...value,
        accuracy:ratio(value.correct,value.covered),
        coverage:ratio(value.covered,value.targets),
        majorityBaselineAccuracy:ratio(value.majorityBaselineCorrect,value.covered)
      };
    }
    const macro=(key)=>{
      const values=row.macroF1BySeed.map(item=>item[key]).filter(Number.isFinite);
      return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
    };
    return [attribute,{
      ...metrics,
      meanMacroF1AcrossSeeds:macro("all"),
      meanMajorityBaselineMacroF1AcrossSeeds:macro("allMajorityBaseline"),
      meanUnseenLemmaMacroF1AcrossSeeds:macro("unseenLemma"),
      meanUnseenLemmaMajorityBaselineMacroF1AcrossSeeds:macro("unseenLemmaMajorityBaseline"),
      macroF1BySeed:row.macroF1BySeed
    }];
  }));
  return [variant,perAttribute];
}));

const summary = {
  benchmark:"NEUROGENESIS paired contextual UD FEATS attribute-value pilot",
  version:"0.58.118",
  source:{
    treebank:"UD_Russian-GSD",release:"r2.18",
    commit:"9acc9d677327043bd416fcc89e4b3407c620d885",
    license:"CC BY-SA 4.0"
  },
  protocol:{
    seeds,
    variants,
    selectedAttributes,
    maximumAttributes,
    minimumClassExamples,
    sameContextualEncoderAndRowsForBothVariants:true,
    checkpointSelectionMetricByVariant:Object.fromEntries(
      Object.entries(variants).map(([name,configuration])=>[name,configuration.selectionMetric])
    ),
    weightsDerivedOnlyFromSupervisedTrainExamples:true,
    independentTestUse:"evaluation only",
    lemmaSlice:"per-attribute train-lemma overlap"
  },
  isolation:{
    trainSentences:prepared.trainingRecords.length,
    independentTestSentences:prepared.testRecords.length,
    normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps,
    annotationsUsedForTrainingOnlyFromTrainSplit:true,
    validationUsedOnlyForCheckpointSelection:true,
    independentTestUsedOnlyForEvaluation:true
  },
  aggregate:aggregateReport,
  seeds:seedReports
};
assert.equal(summary.isolation.normalizedSentenceLeakage,0);
assert.ok(Object.keys(aggregateReport.sqrtInverse).length>=4);
assert.deepEqual(Object.keys(aggregateReport.sqrtInverse).sort(),
  Object.keys(aggregateReport.unweighted).sort(),
  "both FEATS variants must report the same attributes");
console.log("NEUROGENESIS 0.58.118 paired contextual FEATS pilot: "+JSON.stringify(summary));
