"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const importer=require("../scripts/ud-russian-gsd.js");
const window={},sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,{filename:"contextual-attention.js"});
vm.runInNewContext(fs.readFileSync("ud-context-candidate-ranker.js","utf8"),sandbox,{filename:"ud-context-candidate-ranker.js"});
const modelApi=window.NGContextualModel,api=window.NGUDContextCandidateRanker;
assert.ok(modelApi&&api);
const [trainPath,devPath]=process.argv.slice(2);
assert.ok(trainPath&&devPath,"provide train and dev CoNLL-U files");
const train=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(trainPath,"utf8")));
const dev=importer.uniqueRecords(importer.parseConllu(fs.readFileSync(devPath,"utf8")));
const devKeys=new Set(dev.map(row=>row.normalized));
const overlap=train.filter(row=>devKeys.has(row.normalized)).length;
const cleanTrain=train.filter(row=>!devKeys.has(row.normalized));
assert.equal(cleanTrain.filter(row=>devKeys.has(row.normalized)).length,0);
const sample=importer.deterministicSample(dev,120,20261117);
const ranker=api.create(cleanTrain,{modelApi,windowSize:4});
const variants=[
 {name:"baseline",options:{}},
 {name:"more_context_features_7",options:{maxContextFeatures:7}},
 {name:"fewer_context_features_3",options:{maxContextFeatures:3}},
 {name:"require_three_candidate_matches",options:{minCandidateMatches:3}},
 {name:"strict_three_context_matches",options:{minContextMatches:3}},
 {name:"strict_coverage_0_4",options:{minContextCoverage:.4}},
 {name:"broad_single_match_shortlist",options:{minCandidateMatches:1,maxContextFeatures:7}},
];
const normalise=v=>String(v==null?"":v).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
const trainForms=new Set(),trainLemmas=new Set();
for(const row of cleanTrain)for(const token of row.tokens){trainForms.add(normalise(token.form));trainLemmas.add(normalise(token.lemma||token.form));}
const contentPOS=new Set(["NOUN","PROPN","VERB","AUX","ADJ","ADV","PRON","NUM"]);
function evaluate(options){
 const groups={all:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0},
  oovSurface:{total:0,covered:0,top1:0,recall8:0,lemmaRecall8:0},
  unseenLemma:{total:0,covered:0,top1:0,recall8:0,lemmaRecall8:0}};
 const pos={total:0,correct:0};
 for(const sentence of sample){
  const lexical=sentence.tokens.filter(t=>api.tokenize(t.form).length===1&&t.upos!=="PUNCT"&&t.upos!=="SYM");
  const text=lexical.map(t=>t.form).join(" ");
  for(let index=0;index<lexical.length;index++){
   const target=lexical[index];if(!contentPOS.has(target.upos))continue;
   const result=ranker.predictMasked(text,index,{limit:8,...options}),form=normalise(target.form),lemma=normalise(target.lemma||target.form);
   const oovSurface=!trainForms.has(form),unseenLemma=!trainLemmas.has(lemma),covered=result.candidates.length>0;
   const top1=covered&&normalise(result.candidates[0].form)===form;
   const recall8=covered&&result.candidates.some(c=>normalise(c.form)===form);
   const lemmaTop1=covered&&normalise(result.candidates[0].lemma)===lemma;
   const lemmaRecall8=covered&&result.candidates.some(c=>normalise(c.lemma)===lemma);
   const add=(g,extended)=>{g.total++;if(covered)g.covered++;if(top1)g.top1++;if(recall8)g.recall8++;if(extended&&lemmaTop1)g.lemmaTop1++;if(lemmaRecall8)g.lemmaRecall8++;};
   add(groups.all,true);if(oovSurface)add(groups.oovSurface,false);if(unseenLemma)add(groups.unseenLemma,false);
   const prediction=result.tagPrediction&&result.tagPrediction.upos[0]?.label;pos.total++;if(prediction===target.upos)pos.correct++;
  }
 }
 const ratio=(a,b)=>b?a/b:0;
 const summary=g=>({total:g.total,coverage:ratio(g.covered,g.total),top1AmongCovered:ratio(g.top1,g.covered),
  recallAt8AmongCovered:ratio(g.recall8,g.covered),lemmaRecallAt8AmongCovered:ratio(g.lemmaRecall8,g.covered),
  top1All:ratio(g.top1,g.total),recallAt8All:ratio(g.recall8,g.total),
  lemmaTop1All:ratio(g.lemmaTop1,g.total),lemmaRecallAt8All:ratio(g.lemmaRecall8,g.total)});
 const metrics={all:summary(groups.all),oovSurface:summary(groups.oovSurface),unseenLemma:summary(groups.unseenLemma),
  posClassifier:{...pos,accuracy:ratio(pos.correct,pos.total)}};
 return{metrics,objective:metrics.all.top1All+.2*metrics.all.recallAt8All};
}
const rows=variants.map(variant=>({variant,result:evaluate(variant.options)}));
rows.sort((a,b)=>b.result.objective-a.result.objective||b.result.metrics.all.recallAt8All-a.result.metrics.all.recallAt8All);
const report={corpus:{trainSentences:train.length,trainSentencesUsed:cleanTrain.length,devSentences:dev.length,
 devSampleSentences:sample.length,trainDevOverlapExcluded:overlap,remainingTrainDevOverlap:0,training:ranker.status()},
 method:{selectionSplit:"official UD dev only",sampleSeed:20261117,objective:"top1All + 0.2 * recallAt8All",
  variants:rows.map(row=>({name:row.variant.name,options:row.variant.options,objective:row.result.objective,metrics:row.result.metrics})),
  selected:rows[0].variant},
 warning:"Development-only tuning result. Do not deploy a non-baseline setting without a separate untouched external test."};
fs.mkdirSync("benchmark-reports",{recursive:true});
fs.writeFileSync("benchmark-reports/ud-context-ranker-retrieval-tuning-v1.json",JSON.stringify(report,null,2)+"\n");
console.log("UD_CONTEXT_RANKER_RETRIEVAL_TUNING "+JSON.stringify(report));
