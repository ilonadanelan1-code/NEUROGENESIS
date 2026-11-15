"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const window={},sandbox={window,Math,Map,Set,Object,Array,String,Number,RegExp};
vm.runInNewContext(fs.readFileSync("ud-context-candidate-ranker.js","utf8"),sandbox,{filename:"ud-context-candidate-ranker.js"});
const api=window.NGUDContextCandidateRanker;assert.equal(api.schema,"NG_UD_CONTEXT_CANDIDATE_RANKER_V1");
const fixture=[
"# sent_id = a\n# text = Новый нейрон получает сигнал.\n1\tНовый\tновый\tADJ\t_\tCase=Nom|Gender=Masc|Number=Sing\t2\tamod\t_\t_\n2\tнейрон\tнейрон\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Sing\t3\tnsubj\t_\t_\n3\tполучает\tполучать\tVERB\t_\tNumber=Sing|Person=3|Tense=Pres\t0\troot\t_\t_\n4\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t3\tobj\t_\t_\n\n"+
"# sent_id = b\n# text = Новые нейроны получают сигнал.\n1\tНовые\tновый\tADJ\t_\tCase=Nom|Number=Plur\t2\tamod\t_\t_\n2\tнейроны\tнейрон\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Plur\t3\tnsubj\t_\t_\n3\tполучают\tполучать\tVERB\t_\tNumber=Plur|Person=3|Tense=Pres\t0\troot\t_\t_\n4\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t3\tobj\t_\t_\n\n"+
"# sent_id = c\n# text = Новые датчики измеряют сигнал.\n1\tНовые\tновый\tADJ\t_\tCase=Nom|Number=Plur\t2\tamod\t_\t_\n2\tдатчики\tдатчик\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Plur\t3\tnsubj\t_\t_\n3\tизмеряют\tизмерять\tVERB\t_\tNumber=Plur|Person=3|Tense=Pres\t0\troot\t_\t_\n4\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t3\tobj\t_\t_\n\n"+
"# sent_id = d\n# text = Система хранит данные.\n1\tСистема\tсистема\tNOUN\t_\tCase=Nom|Gender=Fem|Number=Sing\t2\tnsubj\t_\t_\n2\tхранит\tхранить\tVERB\t_\tNumber=Sing|Person=3|Tense=Pres\t0\troot\t_\t_\n3\tданные\tданные\tNOUN\t_\tCase=Acc|Number=Plur\t2\tobj\t_\t_\n"];
const records=api.parseConllu(fixture.join("\n"));assert.equal(records.length,4);assert.equal(records[1].tokens[1].lemma,"нейрон");assert.equal(records[1].tokens[1].feats.Number,"Plur");
const modelApi={inferMaskedNumber:(t,i)=>{const l=t[i-1]||"",r=t[i+1]||"";if(/(ые|ие)$/u.test(l)||/(ют|ут|ат|ят)$/u.test(r))return{number:"plural"};if(/(ает|яет|ует|ит|ет)$/u.test(r))return{number:"singular"};return null;}};
const ranker=api.create(records,{modelApi});assert.equal(ranker.status().sentenceCount,4);assert.ok(ranker.status().contextExamples>0);
const plural=ranker.predictMasked("Новые нейроны получают сигнал",1);assert.equal(plural.targetSurfaceUsed,false);assert.ok(plural.candidates.some(c=>c.lemma==="нейрон"&&c.form==="нейроны"&&c.features.Number==="Plur"));assert.equal(plural.morphologyHint.number,"plural");
const altered=ranker.predictMasked("Новые механизмы получают сигнал",1);assert.deepEqual(JSON.parse(JSON.stringify(plural.candidates)),JSON.parse(JSON.stringify(altered.candidates)),"masked token surface must not influence candidates");
assert.ok(plural.candidates.every(c=>!c.matchedContext.some(x=>x.token==="нейроны")),"hidden surface must not occur in context evidence");
assert.ok(ranker.predictMasked("Новый нейрон получает сигнал",1).candidates.some(c=>c.lemma==="нейрон"&&c.form==="нейрон"));
assert.equal(ranker.predictMasked("",0).reason,"empty_input");assert.equal(ranker.predictMasked("нейрон получает",0).reason,"insufficient_context");
assert.throws(()=>api.create([]),/annotated training sentences/u);console.log("ud-context-candidate-ranker: fixture tests passed");

const trainPath=process.argv[2],testPath=process.argv[3];
if(!trainPath&&!testPath){
 console.log("UD context candidate ranker fixture tests passed; external corpus files not supplied.");
}else{
 assert.ok(trainPath&&testPath,"supply both official UD train and test CoNLL-U files");
 const trainRaw=importer.parseConllu(fs.readFileSync(trainPath,"utf8"));
 const testRaw=importer.parseConllu(fs.readFileSync(testPath,"utf8"));
 const trainUnique=importer.uniqueRecords(trainRaw),testUnique=importer.uniqueRecords(testRaw);
 const trainKeys=new Set(trainUnique.map(row=>row.normalized));
 const overlap=testUnique.filter(row=>trainKeys.has(row.normalized)).length;
 assert.equal(overlap,0,"official train and test sentences must not overlap");
 const modelWindow={};
 const modelSandbox={window:modelWindow,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
 vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),modelSandbox,{filename:"contextual-attention.js"});
 const fullRanker=api.create(trainUnique,{modelApi:modelWindow.NGContextualModel,windowSize:4});
 const trainingForms=new Set(),trainingLemmas=new Set();
 for(const row of trainUnique)for(const token of row.tokens){
  trainingForms.add(String(token.form).normalize("NFKC").toLowerCase().replace(/ё/gu,"е"));
  if(token.lemma)trainingLemmas.add(String(token.lemma).toLowerCase().replace(/ё/gu,"е"));
 }
 const sample=importer.deterministicSample(testUnique,100,20261115);
 const groups={all:{total:0,covered:0,top1:0,recall8:0},oovForm:{total:0,covered:0,top1:0,recall8:0},oovLemma:{total:0,covered:0,top1:0,recall8:0}};
 const perPos=Object.create(null);
 for(const sentence of sample){
  const lexical=sentence.tokens.filter(t=>api.tokenize(t.form).length===1&&t.upos!=="PUNCT"&&t.upos!=="SYM");
  const text=lexical.map(t=>t.form).join(" ");
  for(let index=0;index<lexical.length;index++){
   const target=lexical[index];
   if(!["NOUN","PROPN","VERB","AUX","ADJ","ADV","PRON","NUM"].includes(target.upos))continue;
   const result=fullRanker.predictMasked(text,index,{limit:8});
   const form=String(target.form).toLowerCase().replace(/ё/gu,"е");
   const lemma=String(target.lemma||target.form).toLowerCase().replace(/ё/gu,"е");
   const oovForm=!trainingForms.has(form),oovLemma=!trainingLemmas.has(lemma);
   const covered=result.candidates.length>0;
   const top1=covered&&result.candidates[0].form.toLowerCase().replace(/ё/gu,"е")===form;
   const recall8=covered&&result.candidates.some(c=>c.form.toLowerCase().replace(/ё/gu,"е")===form);
   const add=g=>{g.total++;if(covered)g.covered++;if(top1)g.top1++;if(recall8)g.recall8++;};
   add(groups.all);if(oovForm)add(groups.oovForm);if(oovLemma)add(groups.oovLemma);
   if(!perPos[target.upos])perPos[target.upos]={total:0,covered:0,top1:0,recall8:0};
   add(perPos[target.upos]);
   if(result.available)assert.equal(result.targetSurfaceUsed,false);
  }
 }
 const summary=g=>({total:g.total,coverage:g.total?g.covered/g.total:0,
  top1AmongCovered:g.covered?g.top1/g.covered:0,recallAt8AmongCovered:g.covered?g.recall8/g.covered:0,
  top1All:g.total?g.top1/g.total:0,recallAt8All:g.total?g.recall8/g.total:0});
 const report={
  corpus:{trainSentences:trainUnique.length,testSentences:testUnique.length,testSampleSentences:sample.length,
   trainTestSentenceOverlap:overlap,training:fullRanker.status()},
  metrics:{all:summary(groups.all),oovSurface:summary(groups.oovForm),unseenLemma:summary(groups.oovLemma),
   byUPOS:Object.fromEntries(Object.entries(perPos).map(([k,v])=>[k,summary(v)]))},
  methodology:{trainPartitionOnly:true,testSentencesHeldOut:true,maskedTargetSurfaceNotUsedByRanker:true,
   sampleSeed:20261115,scoreIsCalibratedProbability:false}
 };
 fs.mkdirSync("benchmark-reports",{recursive:true});
 fs.writeFileSync("benchmark-reports/ud-context-candidate-ranker-v1.json",JSON.stringify(report,null,2)+"\n");
 console.log("UD_CONTEXT_CANDIDATE_RANKER_BENCHMARK "+JSON.stringify(report));
}
