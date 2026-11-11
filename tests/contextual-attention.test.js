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
const initialState=model.exportState(),report=model.train(corpus,{epochs:90,learningRate:.025});
assert.ok(report.examples>20);
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
const before=model.status().trainingSteps;
model.train(["нейрон получает сигнал"],{epochs:2,learningRate:.02});
assert.ok(model.status().trainingSteps>before);
const restored=api.fromState(model.exportState());
assert.equal(restored.status().trainingSteps,model.status().trainingSteps);
assert.deepEqual(restored.analyse("нейрон получает сигнал"),model.analyse("нейрон получает сигнал"),
 "the complete multi-head architecture must persist");
assert.throws(()=>restored.loadState({schema:api.schema,version:3,dimension:999,windowSize:2,heads:3,vocabulary:[]}),/dimensions, heads or vocabulary/u);
assert.throws(()=>restored.loadState({schema:"NG_CONTEXTUAL_ATTENTION_V2",version:2}),/Unsupported contextual model state/u);
const malformedState=restored.exportState();malformedState.relativePositionBias[0].pop();
assert.throws(()=>restored.loadState(malformedState),/weights are malformed/u);
assert.throws(()=>api.create({dimension:10,heads:3}),/divisible/u);
const longModel=api.create({dimension:12,windowSize:4,heads:3,seed:321});
const longText="нейрон получает сигнал через скрытый контекст и затем активирует сеть";
longModel.train([longText,"сеть обрабатывает сигнал через контекст нейрон получает данные"],{epochs:18,learningRate:.02});
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
assert.ok(longAnalysis.positions.length>=8);
assert.equal(api.create({windowSize:999}).status().windowSize,8,"window size must be capped at eight positions per side");
assert.throws(()=>api.create().train([],{}),/at least one training sentence/u);
console.log("NEUROGENESIS contextual attention v3: multi-head training, relative positions, extended context and persistence passed.");