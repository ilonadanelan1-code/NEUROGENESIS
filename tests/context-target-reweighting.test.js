"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const importer=require("../scripts/ud-russian-gsd.js");

const trainPath=process.argv[2],testPath=process.argv[3];
assert.ok(trainPath&&testPath,"supply pinned UD Russian-GSD train and test CoNLL-U files");
const prepared=importer.prepareCorpus(
 fs.readFileSync(trainPath,"utf8"),fs.readFileSync(testPath,"utf8"),
 {trainLimit:320,testLimit:240,seed:20261112,minimumTokens:4,maximumTokens:40}
);
assert.equal(prepared.trainingTexts.length,320);
assert.equal(prepared.testTexts.length,240);
assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps,0);

const window={};
const sandbox={window,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,
 {filename:"contextual-attention.js"});
const Attention=window.NGContextualModel;
assert.ok(Attention&&Attention.schema==="NG_CONTEXTUAL_ATTENTION_V5");

const seeds=[
 {model:9173,split:902},
 {model:31415,split:2718},
 {model:2718,split:9044}
];
const variants={
 unweighted:{classWeighting:"none"},
 sqrtInverse:{classWeighting:"sqrt_inverse"},
 inverseCapped:{classWeighting:"inverse_capped",minClassWeight:0.75,maxClassWeight:2.5}
};
const bucketNames=["1","2-4","5-9","10+"];
const makeBuckets=()=>Object.fromEntries(bucketNames.map(name=>[name,{
 targets:0,correct:0,tokenCounts:Object.create(null)
}]));
const aggregate=Object.fromEntries(Object.keys(variants).map(name=>[name,{
 targets:0,known:0,exact:0,unknown:0,validationLoss:0,bestEpochTotal:0,
 buckets:makeBuckets(),trainingExamples:0,vocabularySize:0
}]));
const ratio=(n,d)=>d?n/d:null;
const seedReports=[];

for(const seed of seeds){
 const byVariant={};
 let canonicalSplit=null;
 for(const [variant,configuration] of Object.entries(variants)){
  const model=Attention.create({
   dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model
  });
  const training=model.train(prepared.trainingTexts,{
   epochs:20,learningRate:0.02,patience:8,splitSeed:seed.split,...configuration
  });
  assert.equal(training.classWeighting,configuration.classWeighting);
  assert.equal(training.evaluationIsolated,true,
   "all weighting variants must select checkpoints on held-out validation sentences");
  assert.ok(Number.isFinite(training.validationLoss),
   "the checkpoint selector must report an unweighted validation loss");
  assert.equal(training.meanTargetClassWeight,1,
   "weighted training examples must average to one so effective learning rate is comparable");
  const split=model.splitCorpus(prepared.trainingTexts,seed.split);
  assert.equal(split.train.length,training.trainRows);
  if(canonicalSplit)assert.deepEqual(split,canonicalSplit,
   "weighting must not change corpus partitioning");
  else canonicalSplit=split;

  const tokenFrequency=new Map();
  for(const sentence of split.train){
   for(const token of Attention.tokenize(sentence)){
    tokenFrequency.set(token,(tokenFrequency.get(token)||0)+1);
   }
  }
  const metrics={
   targets:0,known:0,exact:0,unknown:0,
   buckets:makeBuckets(),tokenCountsByBucket:Object.create(null)
  };
  for(const sentence of prepared.testTexts){
   const tokens=Attention.tokenize(sentence);
   for(let index=0;index<tokens.length;index++){
    metrics.targets++;
    const score=model.score(sentence,index);
    assert.ok(score,"every independent test token must be scored");
    if(!score.targetKnown){metrics.unknown++;continue;}
    metrics.known++;
    const frequency=tokenFrequency.get(tokens[index])||0;
    assert.ok(frequency>0,"known target must occur in this exact training partition");
    const bucket=frequency===1?"1":frequency<=4?"2-4":frequency<=9?"5-9":"10+";
    const row=metrics.buckets[bucket];
    row.targets++;
    row.tokenCounts[tokens[index]]=(row.tokenCounts[tokens[index]]||0)+1;
    if(score.predictions[0]?.token===tokens[index]){
     metrics.exact++;
     row.correct++;
    }
   }
  }
  const bucketReports=Object.fromEntries(bucketNames.map(name=>{
   const row=metrics.buckets[name];
   const majorityCorrect=Math.max(0,...Object.values(row.tokenCounts));
   return [name,{
    targets:row.targets,correct:row.correct,
    accuracy:ratio(row.correct,row.targets),
    majorityCorrect,majorityAccuracy:ratio(majorityCorrect,row.targets)
   }];
  }));
  const result={
   classWeighting:training.classWeighting,
   training:{
    trainRows:training.trainRows,validationRows:training.validationRows,testRows:training.testRows,
    examples:training.trainExamples,epochs:training.epochs,bestEpoch:training.bestEpoch,
    validationLoss:training.validationLoss,
    vocabularySize:training.vocabularySize,
    classWeightMin:training.minClassWeight,classWeightMax:training.maxClassWeight,
    meanTargetClassWeight:training.meanTargetClassWeight,
    targetWeightByFrequency:training.targetWeightByFrequency
   },
   metrics:{
    targets:metrics.targets,knownTargets:metrics.known,unknownTargets:metrics.unknown,
    knownCoverage:ratio(metrics.known,metrics.targets),
    exactKnownCorrect:metrics.exact,
    exactKnownAccuracy:ratio(metrics.exact,metrics.known),
    allTargetAccuracy:ratio(metrics.exact,metrics.targets),
    frequencyBuckets:bucketReports
   }
  };
  byVariant[variant]=result;
  const total=aggregate[variant];
  total.targets+=metrics.targets;total.known+=metrics.known;total.exact+=metrics.exact;total.unknown+=metrics.unknown;
  total.validationLoss+=training.validationLoss;total.bestEpochTotal+=training.bestEpoch||0;
  total.trainingExamples+=training.trainExamples;total.vocabularySize+=training.vocabularySize;
  for(const bucket of bucketNames){
   const target=total.buckets[bucket],source=metrics.buckets[bucket];
   target.targets+=source.targets;target.correct+=source.correct;
   for(const [token,count] of Object.entries(source.tokenCounts)){
    target.tokenCounts[token]=(target.tokenCounts[token]||0)+count;
   }
  }
 }
 seedReports.push({modelSeed:seed.model,splitSeed:seed.split,variants:byVariant});
}

const aggregateReport=Object.fromEntries(Object.entries(aggregate).map(([variant,row])=>{
 const frequencyBuckets=Object.fromEntries(bucketNames.map(name=>{
  const bucket=row.buckets[name],majorityCorrect=Math.max(0,...Object.values(bucket.tokenCounts));
  return [name,{
   targets:bucket.targets,correct:bucket.correct,
   accuracy:ratio(bucket.correct,bucket.targets),
   majorityCorrect,majorityAccuracy:ratio(majorityCorrect,bucket.targets)
  }];
 }));
 return [variant,{
  targets:row.targets,knownTargets:row.known,unknownTargets:row.unknown,
  knownCoverage:ratio(row.known,row.targets),
  exactKnownCorrect:row.exact,exactKnownAccuracy:ratio(row.exact,row.known),
  allTargetAccuracy:ratio(row.exact,row.targets),
  meanValidationLoss:row.validationLoss/seeds.length,
  meanBestEpoch:row.bestEpochTotal/seeds.length,
  meanTrainingExamples:row.trainingExamples/seeds.length,
  meanVocabularySize:row.vocabularySize/seeds.length,
  frequencyBuckets
 }];
}));
for(const seedRow of seedReports){
 const base=seedRow.variants.unweighted.metrics;
 for(const variant of ["sqrtInverse","inverseCapped"]){
  const candidate=seedRow.variants[variant].metrics;
  assert.equal(candidate.targets,base.targets,
   "all weighting variants must use identical independent test tokens");
  assert.equal(candidate.knownTargets,base.knownTargets,
   "weighting cannot alter the model's known-word coverage");
 }
}
const summary={
 benchmark:"NEUROGENESIS contextual target-frequency reweighting",
 version:"0.58.121",
 source:{
  treebank:"UD_Russian-GSD",release:"r2.18",
  commit:"9acc9d677327043bd416fcc89e4b3407c620d885",
  license:"CC BY-SA 4.0"
 },
 protocol:{
  seeds,variants,
  trainSentences:prepared.trainingTexts.length,
  independentTestSentences:prepared.testTexts.length,
  normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps,
  sameRowsSeedsAndHyperparameters:true,
  onlyChangedVariable:"per-target training-example weight",
  validationSelection:"ordinary unweighted validation loss",
  independentTestUse:"evaluation only"
 },
 aggregate:aggregateReport,
 seeds:seedReports
};
assert.equal(summary.protocol.normalizedSentenceLeakage,0);
console.log("NEUROGENESIS 0.58.121 contextual target-frequency reweighting: "+JSON.stringify(summary));
