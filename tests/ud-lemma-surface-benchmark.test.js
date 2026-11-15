"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const importer=require("../scripts/ud-russian-gsd.js");
const window={},sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,{filename:"contextual-attention.js"});
vm.runInNewContext(fs.readFileSync("ud-context-candidate-ranker.js","utf8"),sandbox,{filename:"ud-context-candidate-ranker.js"});
const modelApi=window.NGContextualModel,api=window.NGUDContextCandidateRanker;
assert.ok(modelApi&&api&&typeof api.create==="function");
const [trainPath,devPath]=process.argv.slice(2);
assert.ok(trainPath&&devPath,"provide official UD train and dev CoNLL-U files");
const train=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(trainPath,"utf8")));
const dev=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(devPath,"utf8")));
const devKeys=new Set(dev.map(row=>row.normalized)),overlap=train.filter(row=>devKeys.has(row.normalized)).length;
const cleanTrain=train.filter(row=>!devKeys.has(row.normalized));
assert.equal(cleanTrain.filter(row=>devKeys.has(row.normalized)).length,0);
const sample=importer.deterministicSample(dev,120,20261120);
const ranker=api.create(cleanTrain,{modelApi,windowSize:4});
const normalize=value=>String(value==null?"":value).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
const contentPOS=new Set(["NOUN","PROPN","VERB","AUX","ADJ","ADV","PRON","NUM"]);
const trainForms=new Set(),trainLemmas=new Set();
for(const sentence of cleanTrain)for(const token of sentence.tokens){
 const form=normalize(token.form),lemma=normalize(token.lemma||token.form);
 if(form)trainForms.add(form);if(lemma)trainLemmas.add(lemma);
}
const makeGroup=()=>({total:0,lemmaCovered:0,lemmaTop1:0,lemmaRecall8:0,
 surfaceCovered:0,surfaceTop1:0,surfaceRecall8:0,oracleTotal:0,oracleSurfaceTop1:0,oracleSurfaceRecall8:0,
 generatedTop1:0,generatedRecall8:0,generatedCount:0,observedCount:0});
const groups={all:makeGroup(),oovSurface:makeGroup(),knownLemmaOovSurface:makeGroup(),unseenLemma:makeGroup()};
const perPOS=Object.create(null),errors=[];
function update(group,row){
 group.total++;
 if(row.lemmaCandidates.length)group.lemmaCovered++;
 if(row.lemmaTop1)group.lemmaTop1++;
 if(row.lemmaRecall8)group.lemmaRecall8++;
 if(row.surfaceCandidates.length)group.surfaceCovered++;
 if(row.surfaceTop1)group.surfaceTop1++;
 if(row.surfaceRecall8)group.surfaceRecall8++;
 if(row.oracleEligible){group.oracleTotal++;if(row.oracleTop1)group.oracleSurfaceTop1++;if(row.oracleRecall8)group.oracleSurfaceRecall8++;}
 if(row.generatedTop1)group.generatedTop1++;
 if(row.generatedRecall8)group.generatedRecall8++;
 group.generatedCount+=row.surfaceCandidates.filter(c=>c.generated).length;
 group.observedCount+=row.surfaceCandidates.filter(c=>!c.generated).length;
}
for(const sentence of sample){
 const lexical=sentence.tokens.filter(token=>api.tokenize(token.form).length===1&&token.upos!=="PUNCT"&&token.upos!=="SYM");
 const text=lexical.map(token=>token.form).join(" ");
 for(let index=0;index<lexical.length;index++){
  const target=lexical[index];if(!contentPOS.has(target.upos))continue;
  const result=ranker.predictLemmaMasked(text,index,{limit:8,surfaceLemmaLimit:5,surfaceLimit:4});
  assert.equal(result.targetSurfaceUsed,false);
  const goldForm=normalize(target.form),goldLemma=normalize(target.lemma||target.form);
  const oovSurface=!trainForms.has(goldForm),unseenLemma=!trainLemmas.has(goldLemma);
  const lemmaTop1=result.lemmaCandidates.length>0&&normalize(result.lemmaCandidates[0].lemma)===goldLemma;
  const lemmaRecall8=result.lemmaCandidates.some(candidate=>normalize(candidate.lemma)===goldLemma);
  const surfaceTop1=result.surfaceCandidates.length>0&&normalize(result.surfaceCandidates[0].form)===goldForm;
  const surfaceRecall8=result.surfaceCandidates.some(candidate=>normalize(candidate.form)===goldForm);
  const generatedTop1=result.surfaceCandidates.length>0&&result.surfaceCandidates[0].generated&&normalize(result.surfaceCandidates[0].form)===goldForm;
  const generatedRecall8=result.surfaceCandidates.some(candidate=>candidate.generated&&normalize(candidate.form)===goldForm);
  const oracle=ranker.reconstructSurface({lemma:goldLemma,upos:target.upos},result.tagPrediction,{limit:8});
  const oracleTop1=oracle.candidates.length>0&&normalize(oracle.candidates[0].form)===goldForm;
  const oracleRecall8=oracle.candidates.some(candidate=>normalize(candidate.form)===goldForm);
  const row={lemmaCandidates:result.lemmaCandidates,lemmaTop1,lemmaRecall8,surfaceCandidates:result.surfaceCandidates,
   surfaceTop1,surfaceRecall8,oracleEligible:!unseenLemma,oracleTop1,oracleRecall8,generatedTop1,generatedRecall8};
  update(groups.all,row);
  if(oovSurface)update(groups.oovSurface,row);
  if(oovSurface&&!unseenLemma)update(groups.knownLemmaOovSurface,row);
  if(unseenLemma)update(groups.unseenLemma,row);
  if(!perPOS[target.upos])perPOS[target.upos]=makeGroup();
  update(perPOS[target.upos],row);
  if((!lemmaTop1||!surfaceTop1)&&errors.length<50){
   errors.push({sentence:sentence.text,target:target.form,lemma:goldLemma,upos:target.upos,oovSurface,unseenLemma,
    predictedLemmas:result.lemmaCandidates.slice(0,5).map(c=>({lemma:c.lemma,upos:c.upos,score:Number(c.score.toFixed(3)),support:c.support})),
    reconstructedForms:result.surfaceCandidates.slice(0,8).map(c=>({form:c.form,lemma:c.lemma,upos:c.upos,
     method:c.method,score:Number(c.combinedScore.toFixed(3)),features:c.features})),
    oracleForms:oracle.candidates.slice(0,5).map(c=>({form:c.form,method:c.method,features:c.features}))});
  }
 }
}
const ratio=(a,b)=>b?a/b:0;
const summarize=group=>({
 total:group.total,lemmaCoverage:ratio(group.lemmaCovered,group.total),
 lemmaTop1All:ratio(group.lemmaTop1,group.total),lemmaRecallAt8All:ratio(group.lemmaRecall8,group.total),
 lemmaTop1AmongCovered:ratio(group.lemmaTop1,group.lemmaCovered),
 surfaceCoverage:ratio(group.surfaceCovered,group.total),surfaceTop1All:ratio(group.surfaceTop1,group.total),
 surfaceRecallAt8All:ratio(group.surfaceRecall8,group.total),
 oracleEligible:group.oracleTotal,oracleSurfaceTop1:ratio(group.oracleSurfaceTop1,group.oracleTotal),
 oracleSurfaceRecallAt8:ratio(group.oracleSurfaceRecall8,group.oracleTotal),
 generatedTop1All:ratio(group.generatedTop1,group.total),generatedRecallAt8All:ratio(group.generatedRecall8,group.total),
 generatedCandidates:group.generatedCount,observedCandidates:group.observedCount
});
const report={
 corpus:{trainSentences:train.length,trainSentencesUsed:cleanTrain.length,devSentences:dev.length,
  sampledDevSentences:sample.length,trainDevOverlapExcluded:overlap,remainingTrainDevOverlap:0,
  training:ranker.status()},
 metrics:{all:summarize(groups.all),oovSurface:summarize(groups.oovSurface),
  knownLemmaOovSurface:summarize(groups.knownLemmaOovSurface),unseenLemma:summarize(groups.unseenLemma),
  byUPOS:Object.fromEntries(Object.entries(perPOS).map(([key,value])=>[key,summarize(value)]))},
 errors,
 methodology:{selectionSplit:"exploratory official UD dev sample",sampleSeed:20261120,
  trainPartitionOnly:true,devHoldoutNotUsedForTraining:true,hiddenSurfaceNotReadByPredictor:true,
  oracleSurfaceMetricUsesGoldLemmaOnlyForDiagnostic:true,generatedFormsRequireLearnedSuffixRule:true,
  metricsDoNotRepresentIndependentFinalTest:true}
};
fs.mkdirSync("benchmark-reports",{recursive:true});
fs.writeFileSync("benchmark-reports/ud-lemma-surface-v1.json",JSON.stringify(report,null,2)+"\n");
console.log("UD_LEMMA_SURFACE_BENCHMARK "+JSON.stringify(report));
