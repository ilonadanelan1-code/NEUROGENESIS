"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const window={},sandbox={window,Math,Map,Set,JSON,RegExp,Object,Array,String,Number,Date};
for(const file of ["knowledge.js","semantic-core.js","contextual-attention.js","phrase-composition.js"])
 vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
const core=window.NGSemanticCore,knowledge=window.NGKnowledge,Attention=window.NGContextualModel,Composer=window.NGPhraseCompositionModel;
assert.ok(Composer&&Composer.schema==="NG_PHRASE_COMPOSITION_V1");
const corpus=[
 "нейрон получает сигнал","сигнал получает нейрон","нейрон обрабатывает сигнал","сеть получает данные",
 "сеть обрабатывает сигнал","память хранит информацию","система получает сигнал","система обрабатывает данные",
 "ключ открывает замок","замок открывает ключ","ключ запускает программу","программа использует ключ"
];
const contextual=Attention.create({dimension:12,windowSize:3,heads:3,blocks:2,seed:9173});
const contextualReport=contextual.train(corpus,{epochs:18,learningRate:.025,splitSeed:902,patience:8});
assert.ok(contextualReport.examples>0&&contextual.status().trained);
const composer=Composer.create({dimension:12,seed:24081});
const report=composer.train(corpus,contextual,core,knowledge,{
 epochs:28,learningRate:.045,augmentWordOrder:true,
 excludeSentences:["сигнал нейрон получает."]
});
assert.ok(report.sentences>=6,"the weak parser should align multiple starter-corpus propositions");
assert.equal(report.sourceSentences,corpus.length);
assert.ok(report.augmentedSentences>0,"verified SOV permutations must be generated");
assert.ok(report.excludedAugmentations>0,"the explicitly held-out SOV sentence must not be generated");
assert.equal(report.augmentation,"verified_sov_permutations_excluding_held_out");
assert.ok(report.roleExamples>0&&report.relationExamples>0&&report.positiveRelations>0);
assert.ok(report.roleTrainingAccuracy>=0&&report.roleTrainingAccuracy<=1);
assert.ok(report.relationTrainingAccuracy>=0&&report.relationTrainingAccuracy<=1);
assert.equal(report.supervision,"weak_semantic_parser_labels");
assert.equal(report.evaluation,"training_only_not_held_out");
const forward=composer.analyse("нейрон получает сигнал",contextual,core,knowledge);
const reverse=composer.analyse("сигнал получает нейрон",contextual,core,knowledge);
assert.equal(forward.weakFrame.subject,"нейрон");
assert.equal(forward.weakFrame.predicate,"получает");
assert.equal(forward.weakFrame.object,"сигнал");
assert.equal(reverse.weakFrame.subject,"сигнал");
assert.equal(reverse.weakFrame.object,"нейрон");
assert.equal(forward.roles.length,3);
for(const row of forward.roles){
 assert.equal(Object.keys(row.probabilities).length,4);
 const sum=Object.values(row.probabilities).reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(sum-1)<1e-8);
 assert.ok(Number.isFinite(row.confidence));
}
assert.equal(forward.phraseVector.length,24);
assert.ok(forward.phraseVector.every(Number.isFinite));
assert.ok(Array.isArray(forward.nodes)&&Array.isArray(forward.edges)&&Array.isArray(forward.relationCandidates));
assert.equal(forward.supervision,"weak_semantic_parser_labels");
const restored=Composer.create({dimension:12,seed:1});
restored.loadState(composer.exportState());
const restoredAnalysis=restored.analyse("нейрон получает сигнал",contextual,core,knowledge);
assert.deepEqual(restoredAnalysis.roles.map(row=>row.role),forward.roles.map(row=>row.role));
assert.deepEqual(restoredAnalysis.edges.map(row=>row.relation),forward.edges.map(row=>row.relation));
const malformed=composer.exportState();malformed.relationWeights[0].pop();
assert.throws(()=>restored.loadState(malformed),/malformed or incompatible/u);
assert.throws(()=>Composer.create().train(corpus,null,core,knowledge),/Train the contextual transformer/u);
console.log("NEUROGENESIS phrase composition: weakly supervised roles, directed dependencies, order-sensitive composition and checkpoint persistence passed.");