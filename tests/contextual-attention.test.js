"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const window={},sandbox={window,Math,Map,Set,JSON,Object,Array,String,Number,RegExp};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,{filename:"contextual-attention.js"});
const api=window.NGContextualModel;
assert.ok(api&&api.schema==="NG_CONTEXTUAL_ATTENTION_V3");
const corpus=["нейрон получает сигнал","нейрон обрабатывает сигнал","сигнал активирует нейрон",
 "сеть получает данные","сеть обрабатывает сигнал","память хранит информацию","модель изучает контекст",
 "контекст меняет значение слова","ключ открывает замок","ключ запускает программу","программа использует ключ","замок защищает помещение"];
const model=api.create({dimension:12,windowSize:2,heads:3,seed:9173});
const splitA=model.splitCorpus(corpus,902),splitB=model.splitCorpus(corpus,902);
assert.deepEqual(splitA,splitB,"corpus partitioning must be deterministic");
assert.equal(splitA.train.length+splitA.validation.length+splitA.test.length,corpus.length);
const identities=rows=>rows.map(row=>api.tokenize(row).join(" "));
const trainIds=new Set(identities(splitA.train));
for(const row of [...splitA.validation,...splitA.test])assert.equal(trainIds.has(api.tokenize(row).join(" ")),false,
 "a held-out sentence must not appear in training");
const duplicateSplit=model.splitCorpus([...corpus,corpus[0],corpus[1]],902);
assert.equal(duplicateSplit.duplicateRows,2,"duplicate sentences must be removed before splitting");
assert.equal(duplicateSplit.uniqueRows,corpus.length);
assert.throws(()=>model.splitCorpus([corpus[0],corpus[0]],902),/three distinct sentences/u);
const initialState=model.exportState(),report=model.train(corpus,{epochs:90,learningRate:.025,splitSeed:902,patience:24});
assert.ok(report.examples>0);
assert.ok(report.validationExamples>0&&report.testExamples>0);
assert.equal(report.trainRows+report.validationRows+report.testRows,report.uniqueRows);
assert.ok(report.bestEpoch>=0&&report.bestEpoch<=report.epochs);
assert.ok(report.validationCoverage>0&&report.validationCoverage<=1);
assert.ok(report.testCoverage>0&&report.testCoverage<=1);
assert.ok(Number.isFinite(report.testLoss));
assert.equal(report.evaluationIsolated,true,"held-out evaluation must use a fresh initialization and disjoint rows");
assert.equal(model.status().trainingSteps,report.trainingSteps,"the step counter must describe the selected checkpoint");
assert.ok(report.attemptedTrainingSteps>=report.trainingSteps);
assert.ok(report.finalLoss<report.initialLoss,"multi-head masked-token loss must decrease after training");
assert.equal(model.status().trained,true);assert.equal(model.status().heads,3);
assert.equal(model.status().headDimension,4);assert.equal(model.status().feedForwardDimension,24);
const attention=model.score("нейрон получает сигнал",1);
assert.ok(attention&&attention.attention.length>=2);
assert.equal(attention.heads.length,3,"three separately parameterized attention heads must be exposed");
for(const head of attention.heads){
 assert.ok(Math.abs(head.attention.reduce((sum,row)=>sum+row.weight,0)-1)<1e-9,
  "each head must produce a normalized attention distribution");
 assert.ok(head.vector.length===4&&head.vector.every(Number.isFinite));
 assert.equal(head.attention.some(row=>row.token==="получает"),false,"masked target must not leak into attention context");
}
assert.ok(attention.contextualVector.length===12&&attention.contextualVector.every(Number.isFinite));
assert.ok(attention.normalization.first.every(Number.isFinite));
assert.ok(attention.normalization.second.every(Number.isFinite));
assert.equal(attention.feedForward.hidden.length,24);
assert.ok(attention.feedForward.hidden.every(value=>Number.isFinite(value)&&value>=0));
const trainedState=model.exportState();
assert.notDeepEqual(trainedState.attentionHeads,initialState.attentionHeads,
 "the attention heads must receive gradient updates");
assert.notDeepEqual(trainedState.feedForward1,initialState.feedForward1,
 "the feed-forward block must receive gradient updates");
assert.notDeepEqual(trainedState.norm1Gamma,initialState.norm1Gamma,
 "layer normalization scale must be trainable");
assert.notDeepEqual(trainedState.relativePositionBias,initialState.relativePositionBias,
 "per-head relative positional biases must receive gradient updates");
for(const head of attention.heads){
 assert.equal(head.relativePositionBias.length,4);
 assert.ok(head.relativePositionBias.every(Number.isFinite));
}
const analysis=model.analyse("нейрон получает сигнал");
assert.equal(analysis.tokens.length,3);assert.ok(analysis.positions.length>0);
const firstRunState=model.exportState();
const repeatReport=model.train(corpus,{epochs:90,learningRate:.025,splitSeed:902,patience:24});
assert.deepEqual(model.exportState(),firstRunState,"an isolated training run must restart from the same initial weights and random token initialization");
assert.equal(repeatReport.validationLoss,report.validationLoss,"repeated deterministic splits must reproduce validation metrics");
assert.equal(repeatReport.testLoss,report.testLoss,"test evaluation must be reproducible");
const secondModel=api.create({dimension:12,windowSize:2,heads:3,seed:9173});
const secondReport=secondModel.train(corpus,{epochs:90,learningRate:.025,splitSeed:902,patience:24});
assert.ok(secondReport.trainingSteps>0&&secondModel.status().trained);
const restored=api.fromState(model.exportState());
assert.equal(restored.status().trainingSteps,model.status().trainingSteps);
assert.deepEqual(restored.status().lastTraining,model.status().lastTraining,"training diagnostics must persist with the selected checkpoint");
assert.deepEqual(restored.analyse("нейрон получает сигнал"),model.analyse("нейрон получает сигнал"),
 "the complete multi-head architecture must persist");
assert.throws(()=>restored.loadState({schema:api.schema,version:3,dimension:999,windowSize:2,heads:3,vocabulary:[]}),/dimensions, heads or vocabulary/u);
assert.throws(()=>restored.loadState({schema:"NG_CONTEXTUAL_ATTENTION_V2",version:2}),/Unsupported contextual model state/u);
const malformedState=restored.exportState();malformedState.relativePositionBias[0].pop();
assert.throws(()=>restored.loadState(malformedState),/weights are malformed/u);
assert.throws(()=>api.create({dimension:10,heads:3}),/divisible/u);
const longModel=api.create({dimension:12,windowSize:4,heads:3,seed:321});
const longText="нейрон получает сигнал через скрытый контекст и затем активирует сеть";
longModel.train(corpus,{epochs:18,learningRate:.02,splitSeed:902});
const longScore=longModel.score(longText,5);
assert.ok(longScore.attention.some(row=>row.token==="получает"&&row.offset===-4),
 "the model must attend to a token four positions to the left");
assert.ok(longScore.attention.some(row=>row.token==="сеть"&&row.offset===4),
 "the model must attend to a token four positions to the right");
assert.equal(longScore.attention.some(row=>row.token==="контекст"),false,"the target token must remain masked in a long context");
assert.ok(longScore.attention.every(row=>row.distance===Math.abs(row.offset)));
assert.ok(longScore.heads.every(head=>head.attention.some(row=>Math.abs(row.offset)===4)));
const longAnalysis=longModel.analyse(longText);
assert.equal(longAnalysis.windowSize,4);assert.equal(longAnalysis.maxWindowSize,8);
assert.equal(longAnalysis.tokens.length,10);
assert.ok(longAnalysis.positions.length>=5);
assert.equal(api.create({windowSize:999}).status().windowSize,8,"window size must be capped at eight positions per side");
assert.throws(()=>api.create().train([],{}),/at least one training sentence/u);
assert.throws(()=>api.create().train(["одно предложение","одно предложение"],{}),/three distinct sentences/u);
console.log("NEUROGENESIS contextual attention v3: deterministic splits, validation-selected checkpoint, held-out test metrics and persistence passed.");