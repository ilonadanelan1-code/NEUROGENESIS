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
const records=api.parseConllu(fixture);assert.equal(records.length,4);assert.equal(records[1].tokens[1].lemma,"нейрон");assert.equal(records[1].tokens[1].feats.Number,"Plur");
const modelApi={inferMaskedNumber:(t,i)=>{const l=t[i-1]||"",r=t[i+1]||"";if(/(ые|ие)$/u.test(l)||/(ют|ут|ат|ят)$/u.test(r))return{number:"plural"};if(/(ает|яет|ует|ит|ет)$/u.test(r))return{number:"singular"};return null;}};
const ranker=api.create(records,{modelApi});assert.equal(ranker.status().sentenceCount,4);assert.ok(ranker.status().contextExamples>0);
const plural=ranker.predictMasked("Новые нейроны получают сигнал",1);assert.equal(plural.targetSurfaceUsed,false);assert.ok(plural.candidates.some(c=>c.lemma==="нейрон"&&c.form==="нейроны"&&c.features.Number==="Plur"));assert.equal(plural.morphologyHint.number,"plural");
const altered=ranker.predictMasked("Новые механизмы получают сигнал",1);assert.deepEqual(JSON.parse(JSON.stringify(plural.candidates)),JSON.parse(JSON.stringify(altered.candidates)),"masked token surface must not influence candidates");
assert.ok(plural.candidates.every(c=>!c.matchedContext.some(x=>x.token==="нейроны")),"hidden surface must not occur in context evidence");
assert.ok(ranker.predictMasked("Новый нейрон получает сигнал",1).candidates.some(c=>c.lemma==="нейрон"&&c.form==="нейрон"));
assert.equal(ranker.predictMasked("",0).reason,"empty_input");assert.equal(ranker.predictMasked("нейрон получает",0).reason,"insufficient_context");
assert.throws(()=>api.create([]),/annotated training sentences/u);console.log("ud-context-candidate-ranker: fixture tests passed");