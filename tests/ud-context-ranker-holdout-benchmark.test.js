"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const importer=require("../scripts/ud-russian-gsd.js");

const window={},sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
vmLoad();
function vmLoad(){
 const vm=require("node:vm");
 vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,{filename:"contextual-attention.js"});
 vm.runInNewContext(fs.readFileSync("ud-context-candidate-ranker.js","utf8"),sandbox,{filename:"ud-context-candidate-ranker.js"});
}
const modelApi=window.NGContextualModel,api=window.NGUDContextCandidateRanker;
assert.ok(modelApi&&api,"contextual model and UD ranker must load");
const [trainPath,devPath,testPath]=process.argv.slice(2);
assert.ok(trainPath&&devPath&&testPath,"provide official train, dev and test CoNLL-U files");
const trainUnique=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(trainPath,"utf8")));
const devUnique=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(devPath,"utf8")));
const testUnique=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(testPath,"utf8")));
const devKeys=new Set(devUnique.map(row=>row.normalized)),testKeys=new Set(testUnique.map(row=>row.normalized));
const devTestOverlap=devUnique.filter(row=>testKeys.has(row.normalized)).length;
assert.equal(devTestOverlap,0,"official dev and test sentences must not overlap");
const allHoldoutKeys=new Set([...devKeys,...testKeys]);
const overlapTrain=trainUnique.filter(row=>allHoldoutKeys.has(row.normalized)).length;
const trainForRanker=trainUnique.filter(row=>!allHoldoutKeys.has(row.normalized));
const remainingTrainOverlap=trainForRanker.filter(row=>allHoldoutKeys.has(row.normalized)).length;
assert.equal(remainingTrainOverlap,0,"the candidate index must exclude every dev/test sentence");
const priorTestSample=importer.deterministicSample(testUnique,100,20261115);
const priorTestKeys=new Set(priorTestSample.map(row=>row.normalized));
const untouchedTest=testUnique.filter(row=>!priorTestKeys.has(row.normalized));
assert.equal(untouchedTest.length,testUnique.length-priorTestSample.length,
 "final test set must exclude exactly the 100 previously explored sentences");
const devSample=importer.deterministicSample(devUnique.filter(row=>!trainForRanker.some(t=>t.normalized===row.normalized)),120,20261116);
assert.equal(devSample.length,Math.min(120,devUnique.length));
const ranker=api.create(trainForRanker,{modelApi,windowSize:4});

const variants=[
 {name:"baseline",tagPosWeight:0,tagFeatureWeight:0},
 {name:"pos_0015",tagPosWeight:.0015,tagFeatureWeight:0},
 {name:"pos_0030",tagPosWeight:.003,tagFeatureWeight:0},
 {name:"pos_0060",tagPosWeight:.006,tagFeatureWeight:0},
 {name:"pos_0030_feature_0002",tagPosWeight:.003,tagFeatureWeight:.0002},
 {name:"pos_0030_feature_0005",tagPosWeight:.003,tagFeatureWeight:.0005}
];
const contentPOS=new Set(["NOUN","PROPN","VERB","AUX","ADJ","ADV","PRON","NUM"]);
const keys=["Case","Number","Gender","Animacy","Tense","Aspect","Person","VerbForm","Mood","Voice","Degree","NumType"];
const clean=v=>String(v==null?"":v).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
function evaluate(records,options){
 const groups={all:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0},
  oovSurface:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0},
  unseenLemma:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0}};
 const pos={total:0,correct:0},morph=Object.create(null),perPos=Object.create(null),errors=[];
 for(const sentence of records){
  const lexical=sentence.tokens.filter(t=>api.tokenize(t.form).length===1&&t.upos!=="PUNCT"&&t.upos!=="SYM");
  const text=lexical.map(t=>t.form).join(" ");
  for(let index=0;index<lexical.length;index++){
   const target=lexical[index];if(!contentPOS.has(target.upos))continue;
   const result=ranker.predictMasked(text,index,{limit:8,...options});
   const form=clean(target.form),lemma=clean(target.lemma||target.form);
   const oovForm=!trainingForms.has(form),oovLemma=!trainingLemmas.has(lemma);
   const covered=result.candidates.length>0;
   const top1=covered&&clean(result.candidates[0].form)===form;
   const recall8=covered&&result.candidates.some(c=>clean(c.form)===form);
   const lemmaTop1=covered&&clean(result.candidates[0].lemma)===lemma;
   const lemmaRecall8=covered&&result.candidates.some(c=>clean(c.lemma)===lemma);
   const update=g=>{g.total++;if(covered)g.covered++;if(top1)g.top1++;if(recall8)g.recall8++;if(lemmaTop1)g.lemmaTop1++;if(lemmaRecall8)g.lemmaRecall8++;};
   update(groups.all);if(oovForm)update(groups.oovSurface);if(oovLemma)update(groups.unseenLemma);
   if(!perPos[target.upos])perPos[target.upos]={total:0,covered:0,top1:0,recall8:0};
   update(perPos[target.upos]);
   const predictedPos=result.tagPrediction&&result.tagPrediction.upos[0]?.label;
   pos.total++;if(predictedPos===target.upos)pos.correct++;
   for(const key of keys){
    const expected=target.feats&&target.feats[key];if(!expected)continue;
    const distribution=result.tagPrediction&&result.tagPrediction.morphology[target.upos]&&result.tagPrediction.morphology[target.upos][key];
    if(!distribution||!distribution.length)continue;
    if(!morph[key])morph[key]={total:0,correct:0};
    morph[key].total++;if(distribution[0].label===expected)morph[key].correct++;
   }
   if(!top1&&errors.length<20)errors.push({sentence:sentence.text,target:target.form,lemma,upos:target.upos,
    oovSurface:oovForm,unseenLemma:oovLemma,candidates:result.candidates.slice(0,4).map(c=>({form:c.form,lemma:c.lemma,upos:c.upos,score:Number(c.score.toFixed(3))}))});
  }
 }
 const ratio=(a,b)=>b?a/b:0;
 const sum=g=>({total:g.total,coverage:ratio(g.covered,g.total),top1AmongCovered:ratio(g.top1,g.covered),
  recallAt8AmongCovered:ratio(g.recall8,g.covered),lemmaRecallAt8AmongCovered:ratio(g.lemmaRecall8,g.covered),
  top1All:ratio(g.top1,g.total),recallAt8All:ratio(g.recall8,g.total),
  lemmaTop1All:ratio(g.lemmaTop1,g.total),lemmaRecallAt8All:ratio(g.lemmaRecall8,g.total)});
 const summarized=Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,sum(v)]));
 const objective=summarized.all.top1All+.2*summarized.all.recallAt8All;
 return{metrics:{...summarized,byUPOS:Object.fromEntries(Object.entries(perPos).map(([k,v])=>[k,sum(v)])),
  tagger:{upos:{...pos,accuracy:ratio(pos.correct,pos.total)},
   morphology:Object.fromEntries(Object.entries(morph).map(([k,v])=>[k,{...v,accuracy:ratio(v.correct,v.total)}]))}},
  objective,errorExamples:errors};
}
const trainingForms=new Set(),trainingLemmas=new Set();
for(const row of trainForRanker)for(const token of row.tokens){
 const form=clean(token.form),lemma=clean(token.lemma||token.form);
 if(form)trainingForms.add(form);if(lemma)trainingLemmas.add(lemma);
}
const tuning=variants.map(variant=>({variant,result:evaluate(devSample,{tagPosWeight:variant.tagPosWeight,tagFeatureWeight:variant.tagFeatureWeight})}));
tuning.sort((a,b)=>b.result.objective-a.result.objective||
 b.result.metrics.all.recallAt8All-a.result.metrics.all.recallAt8All);
const selected=tuning[0].variant;
const finalBaseline=evaluate(untouchedTest,{tagPosWeight:0,tagFeatureWeight:0});
const finalSelected=selected.name==="baseline"?finalBaseline:evaluate(untouchedTest,{
 tagPosWeight:selected.tagPosWeight,tagFeatureWeight:selected.tagFeatureWeight
});
const report={
 corpus:{trainSentences:trainUnique.length,trainSentencesUsed:trainForRanker.length,devSentences:devUnique.length,
  devSampleSentences:devSample.length,testSentences:testUnique.length,previouslyExploredTestSentencesExcluded:priorTestSample.length,
  finalUntouchedTestSentences:untouchedTest.length,trainDevTestOverlapExcluded:overlapTrain,
  remainingTrainDevTestOverlap:remainingTrainOverlap,devTestOverlap,training:ranker.status()},
 tuning:{selectionSplit:"official UD dev only",sampleSeed:20261116,objective:"top1All + 0.2 * recallAt8All",
  variants:tuning.map(row=>({variant:row.variant,objective:row.result.objective,metrics:row.result.metrics.all,
    POSAccuracy:row.result.metrics.tagger.upos.accuracy})),selected},
 finalTest:{usedForSelection:false,baseline:finalBaseline.metrics,selected:finalSelected.metrics,
  selectedVariant:selected,taggerNotUsedAsLexicalCandidateSource:true},
 methodology:{trainOnlyIndex:true,devOnlyForCoefficientSelection:true,
  previouslyExploredTestSampleRemoved:true,remainingTestSentencesUsedOnce:true,
  hiddenTargetSurfaceNotUsedByPredictor:true,rankingScoreIsNotProbability:true}
};
fs.mkdirSync("benchmark-reports",{recursive:true});
fs.writeFileSync(path.join("benchmark-reports","ud-context-ranker-holdout-v1.json"),JSON.stringify(report,null,2)+"\n");
console.log("UD_CONTEXT_RANKER_HOLDOUT "+JSON.stringify(report));
