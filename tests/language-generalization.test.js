"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const window={},sandbox={window,Math,Map,Set,JSON,RegExp,Object,Array,String,Number,Date};
for(const file of ["knowledge.js","semantic-core.js","contextual-attention.js","phrase-composition.js"])
 vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
const core=window.NGSemanticCore,knowledge=window.NGKnowledge;
const Attention=window.NGContextualModel,Composer=window.NGPhraseCompositionModel;
const trainRows=[
 "нейрон получает сигнал","сеть получает сигнал","система получает данные","память получает данные",
 "нейрон обрабатывает данные","сеть обрабатывает сигнал","система обрабатывает данные","модель обрабатывает сигнал",
 "память хранит данные","система хранит сигнал","ключ открывает замок","программа открывает файл",
 "алгоритм выбирает маршрут","система выбирает режим","сенсор обнаруживает сигнал","датчик обнаруживает импульс",
 "исследователь проверяет гипотезу","модель проверяет гипотезу","память сохраняет событие","система сохраняет данные",
 "датчик измеряет температуру","сенсор измеряет сигнал","модель изучает контекст","контекст меняет значение",
 "замок защищает помещение","сигнал активирует нейрон","ключ запускает программу","программа использует ключ"
];
const heldOut=[
 {text:"нейросеть обрабатывает команду",subject:"нейросеть",predicate:"обрабатывает",object:"команду"},
 {text:"датчик обнаруживает вибрацию",subject:"датчик",predicate:"обнаруживает",object:"вибрацию"},
 {text:"система сохраняет результат",subject:"система",predicate:"сохраняет",object:"результат"},
 {text:"алгоритм выбирает решение",subject:"алгоритм",predicate:"выбирает",object:"решение"},
 {text:"сигнал активирует механизм",subject:"сигнал",predicate:"активирует",object:"механизм"},
 {text:"контекст меняет интерпретацию",subject:"контекст",predicate:"меняет",object:"интерпретацию"}
];
const normalise=value=>String(value||"").normalize("NFKC").toLowerCase().replace(/ё/gu,"е").replace(/\s+/gu," ").trim();
const trainingKeys=new Set(trainRows.map(normalise));
assert.equal(trainingKeys.size,trainRows.length,"training corpus must not contain duplicate sentences");
for(const item of heldOut)assert.equal(trainingKeys.has(normalise(item.text)),false,"held-out sentence leaked into the training corpus");
assert.ok(core&&Composer&&Attention,"semantic and trainable language modules must be loaded");
const contextual=Attention.create({dimension:12,windowSize:4,heads:3,blocks:2,seed:9173});
const contextualReport=contextual.train(trainRows,{epochs:55,learningRate:.035,splitSeed:902,patience:24});
assert.equal(contextualReport.evaluationMode,"held_out_sentences");
assert.equal(contextualReport.evaluationIsolated,true);
assert.ok(contextualReport.validationExamples>0&&contextualReport.testExamples>0);
assert.ok(Number.isFinite(contextualReport.validationAccuracy)&&Number.isFinite(contextualReport.testAccuracy));
const composer=Composer.create({dimension:12,seed:9044});
const composerReport=composer.train(trainRows,contextual,core,knowledge,{epochs:45,learningRate:.045});
assert.equal(composerReport.sentences,trainRows.length);
assert.ok(composerReport.roleExamples>0&&composerReport.relationExamples>0);
assert.equal(composerReport.supervision,"weak_semantic_parser_labels");
assert.equal(composerReport.evaluation,"training_only_not_held_out");
let roleCorrect=0,roleTotal=0,trueEdges=0,falseEdges=0,missedEdges=0,oovTokens=0,parserFrames=0;
const expectedEdges=["0:1:subject_to_predicate","1:2:predicate_to_object","0:2:subject_to_object"];
for(const item of heldOut){
 const frame=core.analyse(item.text,{contextRelation:"new_topic"},knowledge).proposition;
 assert.equal(normalise(frame.subject),item.subject,"held-out parser subject: "+item.text);
 assert.equal(normalise(frame.predicate),item.predicate,"held-out parser predicate: "+item.text);
 assert.equal(normalise(frame.object),item.object,"held-out parser object: "+item.text);
 parserFrames++;
 const result=composer.analyse(item.text,contextual,core,knowledge);
 assert.equal(result.roles.length,3);
 const expectedRoles=["subject","predicate","object"];
 for(let i=0;i<expectedRoles.length;i++){roleTotal++;if(result.roles[i].role===expectedRoles[i])roleCorrect++;}
 const predicted=new Set(result.edges.map(edge=>edge.from+":"+edge.to+":"+edge.relation));
 for(const edge of expectedEdges){if(predicted.has(edge))trueEdges++;else missedEdges++;}
 for(const edge of predicted)if(!expectedEdges.includes(edge))falseEdges++;
 const languageAnalysis=contextual.analyse(item.text);
 oovTokens+=languageAnalysis.oovCount;
}
const roleAccuracy=roleCorrect/roleTotal,edgePrecision=trueEdges/Math.max(1,trueEdges+falseEdges),edgeRecall=trueEdges/Math.max(1,trueEdges+missedEdges);
assert.ok(parserFrames===heldOut.length);
assert.ok(roleAccuracy>=.8,"held-out subject/predicate/object role accuracy must exceed the 0.8 diagnostic floor: "+roleAccuracy);
assert.ok(edgePrecision>=.8&&edgeRecall>=.8,"held-out relation precision/recall must exceed the 0.8 diagnostic floor: "+edgePrecision+"/"+edgeRecall);
assert.ok(oovTokens>=5,"the held-out evaluation must include unknown tokens handled by subword vectors");
const oovScore=contextual.score(heldOut[0].text,0);
assert.equal(oovScore.targetKnown,false);
assert.equal(oovScore.targetProbability,null);
assert.ok(oovScore.tokenVector.length===12&&oovScore.tokenVector.every(Number.isFinite));
const negated=core.analyse("Система не получает сигнал.",{contextRelation:"new_topic"},knowledge).proposition;
assert.equal(negated.polarity,"negative");
assert.equal(negated.polarityScope.effect,"negative");
const causal=core.analyse("Недостаток сна может приводить к усталости.",{contextRelation:"new_topic"},knowledge).proposition;
assert.equal(causal.kind,"hypothesis");
assert.equal(causal.modality,"possible");
assert.equal(causal.relation,"causal");
const conditional=core.analyse("Если система получает сигнал, то система активируется.",{contextRelation:"new_topic"},knowledge).propositionChain;
assert.equal(conditional.items.length,2);
assert.equal(conditional.items[0].proposition.kind,"conditional");
assert.equal(conditional.items[1].relationToPrevious.type,"condition_result");
const coreference=core.analyse("Система получает сигнал. Она активируется.",{contextRelation:"new_topic"},knowledge).propositionChain;
assert.equal(coreference.items[1].proposition.subject,"Система");
assert.equal(coreference.items[1].proposition.references[0].status,"resolved");
assert.equal(coreference.items[1].proposition.references[0].antecedentText,"Система");
const paraphrases=["Сколько сердец у осьминога?","У осьминога сколько сердец?","Сердец у осьминога сколько?"];
const paraphraseFrames=paraphrases.map(question=>core.analyse(question,{contextRelation:"new_topic"},knowledge));
const paraphraseKeys=paraphraseFrames.map(frame=>normalise(frame.subject.text)+":"+normalise(frame.attribute.text));
assert.equal(new Set(paraphraseKeys).size,1,"quantity paraphrases must preserve the same subject and attribute");
const summary={
 trainingSentences:trainRows.length,heldOutSentences:heldOut.length,
 heldOutRoleAccuracy:roleAccuracy,heldOutEdgePrecision:edgePrecision,heldOutEdgeRecall:edgeRecall,
 heldOutUnknownTokens:oovTokens,contextualValidationAccuracy:contextualReport.validationAccuracy,
 contextualValidationCoverage:contextualReport.validationCoverage,contextualTestAccuracy:contextualReport.testAccuracy,
 contextualTestCoverage:contextualReport.testCoverage
};
console.log("NEUROGENESIS held-out language generalization: "+JSON.stringify(summary));
console.log("Negation, causal modality, conditional chains, coreference and quantity paraphrases: passed.");