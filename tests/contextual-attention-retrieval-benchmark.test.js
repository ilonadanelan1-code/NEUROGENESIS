"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

const window={},sandbox={window,Math,Map,Set,JSON,Object,Array,String,Number,RegExp};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,
 {filename:"contextual-attention.js"});
const api=window.NGContextualModel;
assert.ok(api&&typeof api.create==="function");

const rows=Array.from({length:320},(_,index)=>{
 const group=index%80;
 return `проект${group} сигнал метод${group} исследователь измеряет параметр${index} через прибор система сохраняет результат${index} в архиве`;
});
const model=api.create({dimension:12,windowSize:4,heads:3,seed:731});
const training=model.train(rows,{epochs:1,learningRate:.001,splitSeed:902});
const state=model.exportState();
const examples=state.trainingContextExamples||[];
assert.ok(examples.length>=1000,
 "performance fixture must create a realistic indexed context store");
const vocabulary=new Set(state.vocabulary);
const queries=[];
for(let group=0;group<80;group++){
 const left=`проект${group}`,right=`метод${group}`;
 if(!vocabulary.has(left)||!vocabulary.has(right))continue;
 queries.push([
  {offset:-1,tokenIndex:-1,contextSourceToken:left,contextMorphologyToken:left},
  {offset:1,tokenIndex:-1,contextSourceToken:right,contextMorphologyToken:right}
 ]);
}
assert.ok(queries.length>=12,
 "the deterministic split must retain enough independent group contexts");

const queryCandidateCounts=queries.map(query=>{
 const tokens=query.map(item=>({token:item.contextMorphologyToken,stem:api.russianStem(item.contextSourceToken)}));
 let candidates=0;
 for(const example of examples){
  if(example.context.some(row=>tokens.some(item=>
   row.token===item.token||(item.stem.length>=3&&(row.stem||api.russianStem(row.token))===item.stem))))candidates++;
 }
 return candidates;
});
const selectedIndexes=queryCandidateCounts
 .map((count,index)=>({count,index}))
 .filter(item=>item.count>0&&item.count<examples.length)
 .sort((a,b)=>a.count-b.count||a.index-b.index)
 .slice(0,24)
 .map(item=>item.index);
assert.ok(selectedIndexes.length>=12,
 "indexed query terms must isolate a strict subset of the stored examples");
const selectedQueries=selectedIndexes.map(index=>queries[index]);
const indexedExamplesVisited=queryCandidateCounts[selectedIndexes.reduce((best,index)=>
 queryCandidateCounts[index]<queryCandidateCounts[best]?index:best,selectedIndexes[0])];

const buildStarted=performance.now();
const indexStatus=model.retrievalIndexStatus();
const indexBuildMs=performance.now()-buildStarted;
assert.equal(indexStatus.built,true);
assert.equal(indexStatus.exampleCount,examples.length);
assert.ok(indexStatus.indexedContextPositions>examples.length);

const optionCases=[
 {},
 {allowOrderInversion:true},
 {allowOrderInversion:true,scoring:"inverse_frequency"}
];
let parityCases=0;
for(const query of selectedQueries){
 for(const options of optionCases){
  const indexed=model.retrieveContextCandidate(query,options);
  const legacy=model.retrieveContextCandidate(query,{...options,useLegacyScan:true});
  assert.deepEqual(indexed,legacy,
   "indexed retrieval must preserve every legacy result, including ties and support counts");
  parityCases++;
 }
}

const run=(options,rounds=8)=>{
 for(let round=0;round<rounds;round++)
  for(const query of selectedQueries)model.retrieveContextCandidate(query,options);
};
run({},2);
run({useLegacyScan:true},2);
const indexedSamples=[],legacySamples=[];
for(let sample=0;sample<7;sample++){
 const measure=options=>{
  const started=performance.now();
  run(options,8);
  return performance.now()-started;
 };
 if(sample%2===0){
  legacySamples.push(measure({useLegacyScan:true}));
  indexedSamples.push(measure({}));
 }else{
  indexedSamples.push(measure({}));
  legacySamples.push(measure({useLegacyScan:true}));
 }
}
const median=values=>{
 const sorted=values.slice().sort((a,b)=>a-b);
 return sorted[Math.floor(sorted.length/2)];
};
const indexedMedianMs=median(indexedSamples),legacyMedianMs=median(legacySamples);
const report={
 version:"0.58.114",
 trainingRows:rows.length,
 trainRows:training.trainRows,
 trainingContextExamples:examples.length,
 indexedContextPositions:indexStatus.indexedContextPositions,
 queryCount:selectedQueries.length,
 parityCases,
 queryCandidateExamplesMin:Math.min(...selectedIndexes.map(index=>queryCandidateCounts[index])),
 queryCandidateExamplesMedian:median(selectedIndexes.map(index=>queryCandidateCounts[index])),
 fullScanExamplesPerQuery:examples.length,
 indexBuildMs:Number(indexBuildMs.toFixed(3)),
 indexedMedianMs:Number(indexedMedianMs.toFixed(3)),
 legacyMedianMs:Number(legacyMedianMs.toFixed(3)),
 indexedMicrosecondsPerQuery:Number((indexedMedianMs/(selectedQueries.length*8)*1000).toFixed(3)),
 legacyMicrosecondsPerQuery:Number((legacyMedianMs/(selectedQueries.length*8)*1000).toFixed(3)),
 speedup:Number((legacyMedianMs/Math.max(indexedMedianMs,1e-9)).toFixed(3)),
 measuredSamples:7,
 roundsPerSample:8
};
console.log("NEUROGENESIS contextual retrieval microbenchmark: "+JSON.stringify(report));
console.log("Legacy scan and indexed retrieval returned identical candidates across all parity cases.");
