"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),importer=require("../scripts/ud-russian-gsd.js");
const window={},sandbox={window,Math,Map,Set,Object,Array,String,Number,RegExp};
vm.runInNewContext(fs.readFileSync("ud-context-candidate-ranker.js","utf8"),sandbox,{filename:"ud-context-candidate-ranker.js"});
const api=window.NGUDContextCandidateRanker;assert.equal(api.schema,"NG_UD_CONTEXT_CANDIDATE_RANKER_V1");
const fixture=[
"# sent_id = a\n# text = Новый нейрон получает сигнал.\n1\tНовый\tновый\tADJ\t_\tCase=Nom|Gender=Masc|Number=Sing\t2\tamod\t_\t_\n2\tнейрон\tнейрон\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Sing\t3\tnsubj\t_\t_\n3\tполучает\tполучать\tVERB\t_\tNumber=Sing|Person=3|Tense=Pres\t0\troot\t_\t_\n4\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t3\tobj\t_\t_\n\n"+
"# sent_id = b\n# text = Новые нейроны получают сигнал.\n1\tНовые\tновый\tADJ\t_\tCase=Nom|Number=Plur\t2\tamod\t_\t_\n2\tнейроны\tнейрон\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Plur\t3\tnsubj\t_\t_\n3\tполучают\tполучать\tVERB\t_\tNumber=Plur|Person=3|Tense=Pres\t0\troot\t_\t_\n4\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t3\tobj\t_\t_\n\n"+
"# sent_id = c\n# text = Новые датчики измеряют сигнал.\n1\tНовые\tновый\tADJ\t_\tCase=Nom|Number=Plur\t2\tamod\t_\t_\n2\tдатчики\tдатчик\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Plur\t3\tnsubj\t_\t_\n3\tизмеряют\tизмерять\tVERB\t_\tNumber=Plur|Person=3|Tense=Pres\t0\troot\t_\t_\n4\tсигнал\tсигнал\tNOUN\t_\tCase=Acc|Number=Sing\t3\tobj\t_\t_\n\n"+
"# sent_id = d\n# text = Система хранит данные.\n1\tСистема\tсистема\tNOUN\t_\tCase=Nom|Gender=Fem|Number=Sing\t2\tnsubj\t_\t_\n2\tхранит\tхранить\tVERB\t_\tNumber=Sing|Person=3|Tense=Pres\t0\troot\t_\t_\n3\tданные\tданные\tNOUN\t_\tCase=Acc|Number=Plur\t2\tobj\t_\t_\n"];

fixture.push(
"# sent_id = e\n# text = Мотор гудит громко.\n"+
"1\tМотор\tмотор\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Sing\t2\tnsubj\t_\t_\n"+
"2\tгудит\tгудеть\tVERB\t_\tNumber=Sing|Person=3|Tense=Pres\t0\troot\t_\t_\n"+
"3\tгромко\tгромко\tADV\t_\t_\t2\tadvmod\t_\t_\n",
"# sent_id = f\n# text = Ремонт прибора завершён.\n"+
"1\tРемонт\tремонт\tNOUN\t_\tCase=Nom|Gender=Masc|Number=Sing\t2\tnsubj\t_\t_\n"+
"2\tприбора\tприбор\tNOUN\t_\tCase=Gen|Gender=Masc|Number=Sing\t3\tnmod\t_\t_\n"+
"3\tзавершён\tзавершить\tVERB\t_\tVerbForm=Part|Tense=Past|Voice=Pass|Gender=Masc|Number=Sing\t0\troot\t_\t_\n"
);
const records=api.parseConllu(fixture.join("\n"));assert.equal(records.length,4);assert.equal(records[1].tokens[1].lemma,"нейрон");assert.equal(records[1].tokens[1].feats.Number,"Plur");
const modelApi={inferMaskedNumber:(t,i)=>{const l=t[i-1]||"",r=t[i+1]||"";if(/(ые|ие)$/u.test(l)||/(ют|ут|ат|ят)$/u.test(r))return{number:"plural"};if(/(ает|яет|ует|ит|ет)$/u.test(r))return{number:"singular"};return null;}};
const ranker=api.create(records,{modelApi});
const lemmaFirst=ranker.predictLemmaMasked("Новые нейроны получают сигнал",1,{limit:8});
assert.equal(lemmaFirst.targetSurfaceUsed,false);
assert.ok(lemmaFirst.lemmaCandidates.some(row=>row.lemma==="нейрон"&&row.upos==="NOUN"),
 "lemma-first predictor should retrieve the noun lemma without reading the hidden form");
const changedHidden=ranker.predictLemmaMasked("Новые устройства получают сигнал",1,{limit:8});
assert.deepEqual(
 JSON.parse(JSON.stringify(lemmaFirst.lemmaCandidates.map(row=>({lemma:row.lemma,upos:row.upos,score:row.score})))),
 JSON.parse(JSON.stringify(changedHidden.lemmaCandidates.map(row=>({lemma:row.lemma,upos:row.upos,score:row.score})))),
 "replacing the hidden surface must not change lemma candidates"
);
assert.ok(lemmaFirst.surfaceCandidates.some(row=>row.lemma==="нейрон"),
 "surface reconstruction must follow candidate lemmas");
const forcedMorphology={upos:[{label:"NOUN",probability:.99}],morphology:{NOUN:{
 Case:[{label:"Gen",probability:.97},{label:"Nom",probability:.03}],
 Number:[{label:"Sing",probability:.98},{label:"Plur",probability:.02}],
 Gender:[{label:"Masc",probability:.99}]
}}};
const generatedMotor=ranker.reconstructSurface({lemma:"мотор",upos:"NOUN"},forcedMorphology,{limit:8});
assert.ok(generatedMotor.candidates.some(row=>row.form==="мотора"&&row.generated===true&&row.method==="learned_suffix_rule"),
 "the learned -ор → -ора genitive rule should generate a form for a different lemma");
assert.equal(generatedMotor.targetSurfaceUsed,false);
assert.equal(ranker.status().sentenceCount,4);assert.ok(ranker.status().contextExamples>0);
const tagProbe=ranker.predictMasked("нейрон система сигнал",1);
assert.ok(tagProbe.tagPrediction&&tagProbe.tagPrediction.upos.length>0,"POS classifier should return a distribution without the hidden target");
assert.equal(tagProbe.tagPrediction.upos[0].label,"VERB","noun subject + noun object context should favour a verb");
const plural=ranker.predictMasked("Новые нейроны получают сигнал",1);assert.equal(plural.targetSurfaceUsed,false);assert.ok(plural.candidates.some(c=>c.lemma==="нейрон"&&c.form==="нейроны"&&c.features.Number==="Plur"));assert.equal(plural.morphologyHint.number,"plural");
const altered=ranker.predictMasked("Новые механизмы получают сигнал",1);assert.deepEqual(JSON.parse(JSON.stringify(plural.candidates)),JSON.parse(JSON.stringify(altered.candidates)),"masked token surface must not influence candidates");
assert.ok(plural.candidates.every(c=>!c.matchedContext.some(x=>x.token==="нейроны")),"hidden surface must not occur in context evidence");
assert.ok(ranker.predictMasked("Новый нейрон получает сигнал",1).candidates.some(c=>c.lemma==="нейрон"&&c.form==="нейрон"));
const rerankProbe=ranker.predictMasked("нейрон получает сигнал",1,{limit:12});
const rerankedDefault=ranker.rerankCandidates(rerankProbe.candidates,rerankProbe.tagPrediction,{tagPosWeight:0,tagFeatureWeight:0});
assert.deepEqual(JSON.parse(JSON.stringify(rerankedDefault.map(c=>c.form))),JSON.parse(JSON.stringify(rerankProbe.candidates.map(c=>c.form))),
 "zero tag weights must preserve the original lexical ranking");
const verbContext=ranker.predictMasked("нейрон получает сигнал",1);
assert.equal(verbContext.candidates[0].upos,"VERB","nominative subject + accusative object should raise a verb candidate");
assert.ok(verbContext.contextHints.pos.VERB>0);
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
 const testKeys=new Set(testUnique.map(row=>row.normalized));
 const overlap=trainUnique.filter(row=>testKeys.has(row.normalized)).length;
 const trainForIndex=trainUnique.filter(row=>!testKeys.has(row.normalized));
 assert.equal(trainForIndex.length+overlap,trainUnique.length,"all overlapping train rows must be excluded");
 const remainingOverlap=trainForIndex.filter(row=>testKeys.has(row.normalized)).length;
 assert.equal(remainingOverlap,0,"no train/test sentence may remain in the context index");
 const modelWindow={};
 const modelSandbox={window:modelWindow,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
 vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),modelSandbox,{filename:"contextual-attention.js"});
 const fullRanker=api.create(trainForIndex,{modelApi:modelWindow.NGContextualModel,windowSize:4});
 const trainingForms=new Set(),trainingLemmas=new Set();
 for(const row of trainForIndex)for(const token of row.tokens){
  trainingForms.add(String(token.form).normalize("NFKC").toLowerCase().replace(/ё/gu,"е"));
  if(token.lemma)trainingLemmas.add(String(token.lemma).toLowerCase().replace(/ё/gu,"е"));
 }
 const sample=importer.deterministicSample(testUnique,100,20261115);
 const groups={all:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0},oovForm:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0},oovLemma:{total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0}};
 const perPos=Object.create(null),errorExamples=[],uposMetrics={total:0,correct:0},morphMetrics=Object.create(null),morphBaselineMetrics=Object.create(null);
 const trainPosCounts=new Map(),trainFeatureCounts=new Map();
 for(const row of trainForIndex)for(const token of row.tokens){
  const upos=token.upos;if(!upos)continue;trainPosCounts.set(upos,(trainPosCounts.get(upos)||0)+1);
  for(const key of ["Case","Number","Gender","Animacy","Tense","Aspect","Person","VerbForm","Mood","Voice","Degree","NumType"]){
   const value=token.feats&&token.feats[key];if(!value)continue;const group=upos+"|"+key;if(!trainFeatureCounts.has(group))trainFeatureCounts.set(group,new Map());const counts=trainFeatureCounts.get(group);counts.set(value,(counts.get(value)||0)+1);
  }
 }
 const majorityPos=[...trainPosCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
 const majorityFeature=new Map([...trainFeatureCounts.entries()].map(([key,counts])=>[key,[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null]));
 let posBaseline={total:0,correct:0};
 for(const sentence of sample){
  const lexical=sentence.tokens.filter(t=>api.tokenize(t.form).length===1&&t.upos!=="PUNCT"&&t.upos!=="SYM");
  const text=lexical.map(t=>t.form).join(" ");
  for(let index=0;index<lexical.length;index++){
   const target=lexical[index];
   if(!["NOUN","PROPN","VERB","AUX","ADJ","ADV","PRON","NUM"].includes(target.upos))continue;
   const result=fullRanker.predictMasked(text,index,{limit:8});
   const predictedUPOS=result.tagPrediction&&result.tagPrediction.upos[0]&&result.tagPrediction.upos[0].label;
   uposMetrics.total++;if(predictedUPOS===target.upos)uposMetrics.correct++;posBaseline.total++;if(majorityPos===target.upos)posBaseline.correct++;
   for(const key of ["Case","Number","Gender","Animacy","Tense","Aspect","Person","VerbForm","Mood","Voice","Degree","NumType"]){
    const expected=target.feats&&target.feats[key];if(!expected)continue;
    const distribution=result.tagPrediction&&result.tagPrediction.morphology[target.upos]&&result.tagPrediction.morphology[target.upos][key];
    if(!distribution||!distribution.length)continue;
    if(!morphMetrics[key])morphMetrics[key]={total:0,correct:0};
    morphMetrics[key].total++;if(distribution[0].label===expected)morphMetrics[key].correct++;
    if(!morphBaselineMetrics[key])morphBaselineMetrics[key]={total:0,correct:0};
    morphBaselineMetrics[key].total++;if(majorityFeature.get(target.upos+"|"+key)===expected)morphBaselineMetrics[key].correct++;
   }
   const form=String(target.form).toLowerCase().replace(/ё/gu,"е");
   const lemma=String(target.lemma||target.form).toLowerCase().replace(/ё/gu,"е");
   const oovForm=!trainingForms.has(form),oovLemma=!trainingLemmas.has(lemma);
   const covered=result.candidates.length>0;
   const top1=covered&&result.candidates[0].form.toLowerCase().replace(/ё/gu,"е")===form;
   const recall8=covered&&result.candidates.some(c=>c.form.toLowerCase().replace(/ё/gu,"е")===form);
   const lemmaTop1=covered&&result.candidates[0].lemma.toLowerCase().replace(/ё/gu,"е")===lemma;
   const lemmaRecall8=covered&&result.candidates.some(c=>c.lemma.toLowerCase().replace(/ё/gu,"е")===lemma);
   const add=g=>{g.total++;if(covered)g.covered++;if(top1)g.top1++;if(recall8)g.recall8++;if(lemmaTop1)g.lemmaTop1++;if(lemmaRecall8)g.lemmaRecall8++;};
   add(groups.all);if(oovForm)add(groups.oovForm);if(oovLemma)add(groups.oovLemma);
   if(!perPos[target.upos])perPos[target.upos]={total:0,covered:0,top1:0,recall8:0,lemmaTop1:0,lemmaRecall8:0};
   add(perPos[target.upos]);
   if(!top1&&errorExamples.length<40)errorExamples.push({text:sentence.text,target:target.form,lemma,upos:target.upos,oovForm,oovLemma,context:lexical.slice(Math.max(0,index-4),index).map(t=>t.form).concat(["[MASK]"],lexical.slice(index+1,index+5).map(t=>t.form)),candidates:result.candidates.slice(0,5).map(c=>({form:c.form,lemma:c.lemma,upos:c.upos,score:Number(c.score.toFixed(3)),features:c.features}))});
   if(result.available)assert.equal(result.targetSurfaceUsed,false);
  }
 }
 const summary=g=>({total:g.total,coverage:g.total?g.covered/g.total:0,
  top1AmongCovered:g.covered?g.top1/g.covered:0,recallAt8AmongCovered:g.covered?g.recall8/g.covered:0,
  lemmaTop1AmongCovered:g.covered?g.lemmaTop1/g.covered:0,lemmaRecallAt8AmongCovered:g.covered?g.lemmaRecall8/g.covered:0,
  top1All:g.total?g.top1/g.total:0,recallAt8All:g.total?g.recall8/g.total:0,
  lemmaTop1All:g.total?g.lemmaTop1/g.total:0,lemmaRecallAt8All:g.total?g.lemmaRecall8/g.total:0});
 const report={
  corpus:{trainSentences:trainUnique.length,trainSentencesUsed:trainForIndex.length,testSentences:testUnique.length,testSampleSentences:sample.length,
   overlapSentencesExcludedFromTrain:overlap,remainingTrainTestSentenceOverlap:remainingOverlap,training:fullRanker.status()},
  metrics:{all:summary(groups.all),oovSurface:summary(groups.oovForm),unseenLemma:summary(groups.oovLemma),
   byUPOS:Object.fromEntries(Object.entries(perPos).map(([k,v])=>[k,summary(v)])),
   contextClassifier:{
    upos:{...uposMetrics,accuracy:uposMetrics.total?uposMetrics.correct/uposMetrics.total:0,
      majorityBaseline:{...posBaseline,accuracy:posBaseline.total?posBaseline.correct/posBaseline.total:0},majorityLabel:majorityPos},
    morphology:Object.fromEntries(Object.entries(morphMetrics).map(([k,v])=>[k,{...v,accuracy:v.total?v.correct/v.total:0,
      majorityBaseline:{...morphBaselineMetrics[k],accuracy:morphBaselineMetrics[k].total?morphBaselineMetrics[k].correct/morphBaselineMetrics[k].total:0}}]))
   }},
  errorExamples,
  methodology:{trainPartitionOnly:true,testSentencesHeldOut:true,maskedTargetSurfaceNotUsedByRanker:true,
   sampleSeed:20261115,scoreIsCalibratedProbability:false}
 };
 fs.mkdirSync("benchmark-reports",{recursive:true});
 fs.writeFileSync("benchmark-reports/ud-context-candidate-ranker-v1.json",JSON.stringify(report,null,2)+"\n");
 console.log("UD_CONTEXT_CANDIDATE_RANKER_BENCHMARK "+JSON.stringify(report));
}
