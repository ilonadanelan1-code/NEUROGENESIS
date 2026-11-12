"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const window={},sandbox={window,Math,Map,Set,JSON,Object,Array,String,Number,RegExp};
vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,{filename:"contextual-attention.js"});
const api=window.NGContextualModel;
assert.ok(api&&api.schema==="NG_CONTEXTUAL_ATTENTION_V5");
assert.equal(api.russianStem("нейроны"),api.russianStem("нейрон"));
assert.equal(api.russianStem("сигнала"),api.russianStem("сигнал"));
assert.equal(api.russianStem("систему"),api.russianStem("система"));
assert.equal(api.russianStem("обнаруживают"),api.russianStem("обнаруживает"));
assert.equal(api.russianStem("активируют"),api.russianStem("активирует"));
assert.equal(api.russianNounPlural("нейрон"),"нейроны");
assert.equal(api.russianNounPlural("датчик"),"датчики");
assert.equal(api.russianNounPlural("система"),"системы");
assert.equal(api.russianNounPlural("море"),"моря");
assert.equal(api.russianVerbNumber("получают"),"plural");
assert.equal(api.russianVerbNumber("получает"),"singular");
const adjectiveHint=api.inferMaskedNumber(["новые","нейроны","получают","сигнал"],1);
assert.equal(adjectiveHint.number,"plural");
assert.equal(adjectiveHint.source,"preceding_plural_adjective");
assert.equal(adjectiveHint.confidence,"rule");
const verbHint=api.inferMaskedNumber(["нейроны","получают","сигнал"],0);
assert.equal(verbHint.number,"plural");
assert.equal(verbHint.source,"following_finite_verb");
assert.equal(verbHint.confidence,"rule");
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
assert.equal(model.status().transformerBlocks,2,"the encoder must stack two independent transformer blocks");
assert.equal(initialState.blocks.length,2);assert.equal(model.exportState().blocks.length,2);
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
for(let layer=0;layer<2;layer++){
 assert.notDeepEqual(trainedState.blocks[layer].attentionHeads,initialState.blocks[layer].attentionHeads,"each block attention receives gradients");
 assert.notDeepEqual(trainedState.blocks[layer].feedForward1,initialState.blocks[layer].feedForward1,"each block FFN receives gradients");
 assert.notDeepEqual(trainedState.blocks[layer].norm1Gamma,initialState.blocks[layer].norm1Gamma,"each block LayerNorm is trainable");
 assert.notDeepEqual(trainedState.blocks[layer].relativePositionBias,initialState.blocks[layer].relativePositionBias,"each block position bias is trainable");
 }
assert.notDeepEqual(trainedState.subwordEmbeddings,initialState.subwordEmbeddings,
 "character n-gram embeddings must receive gradient updates");
for(const head of attention.heads){
 assert.equal(head.relativePositionBias.length,5);
 assert.ok(head.relativePositionBias.every(Number.isFinite));
}
const analysis=model.analyse("нейрон получает сигнал");
assert.equal(analysis.tokens.length,3);assert.ok(analysis.positions.length>0);
const oovAnalysis=model.analyse("нейрон поглощает сигнал");
assert.equal(oovAnalysis.unknownTokens.length,1);assert.equal(oovAnalysis.unknownTokens[0],"поглощает");assert.equal(oovAnalysis.oovCount,1);
const oovScore=model.score("нейрон поглощает сигнал",1);
assert.equal(oovScore.targetKnown,false);assert.equal(oovScore.targetProbability,null);
assert.ok(oovScore.subwordFeatures>0&&oovScore.contextualVector.every(Number.isFinite));
assert.ok(oovScore.tokenVector.length===12&&oovScore.tokenVector.every(Number.isFinite)&&oovScore.tokenVector.some(value=>value!==0),
 "an OOV token must expose its own composed character n-gram vector");
assert.ok(oovScore.attention.some(row=>row.token==="нейрон")&&oovScore.attention.some(row=>row.token==="сигнал"),
 "unknown words must receive a subword context representation");
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
assert.throws(()=>restored.loadState({schema:api.schema,version:5,dimension:999,windowSize:2,heads:3,transformerBlocks:2,vocabulary:[],blocks:[{},{}]}),/dimensions, heads, blocks or vocabulary/u);
assert.throws(()=>restored.loadState({schema:"NG_CONTEXTUAL_ATTENTION_V4",version:4}),/Unsupported contextual model state/u);
const malformedState=restored.exportState();malformedState.blocks[0].relativePositionBias[0].pop();
assert.throws(()=>restored.loadState(malformedState),/weights are malformed/u);
const malformedSubwords=restored.exportState();malformedSubwords.subwordEmbeddings.pop();
assert.throws(()=>restored.loadState(malformedSubwords),/weights are malformed/u);
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
const compactModel=api.create({dimension:8,windowSize:2,seed:11});
const compactReport=compactModel.train(["нейрон получает сигнал","сеть получает данные","память хранит информацию"],{epochs:4,learningRate:.02});
assert.equal(compactReport.splitFallback,true,"a three-sentence low-overlap corpus must use an explicit train-only fallback");
assert.equal(compactReport.evaluationMode,"train_only_insufficient_validation");
assert.equal(compactReport.trainRows,3);
assert.equal(compactReport.validationRows,0);assert.equal(compactReport.testRows,0);
assert.equal(compactReport.bestEpoch,null,"no validation-selected best epoch should be claimed in train-only mode");
assert.equal(compactReport.validationLoss,null);assert.equal(compactReport.testLoss,null);
assert.equal(compactModel.status().trained,true,"small corpora must remain trainable without fabricated held-out metrics");
const compactRestored=api.fromState(compactModel.exportState());
assert.equal(compactRestored.status().lastTraining.validationLoss,null,"null validation loss must survive checkpoint reload");
assert.equal(compactRestored.status().lastTraining.testLoss,null,"null test loss must survive checkpoint reload");
assert.equal(compactRestored.status().lastTraining.evaluationAvailable,false);
const morphologyModel=api.create({dimension:12,windowSize:2,heads:3,seed:121});
const morphologyTraining=morphologyModel.train(["нейрон получает сигнал","сеть обрабатывает данные","память хранит информацию"],{epochs:3,learningRate:.02,splitSeed:902});
assert.equal(morphologyTraining.splitFallback,true,"the morphology fixture must train on all three disjoint sentences");
const morphologyScore=morphologyModel.score("нейроны получают сигнал",0);
assert.equal(morphologyScore.targetKnown,false);
assert.equal(morphologyScore.morphologyBackoff,true);
assert.equal(morphologyScore.morphologyToken,"нейрон");
const contextMorphologyScore=morphologyModel.score("нейрон получают сигнал",0);
assert.ok(contextMorphologyScore.contextMorphologyBackoffs.some(row=>
 row.token==="получают"&&row.vocabularyToken==="получает"),
 "an OOV context verb must reuse a unique trained base-form embedding");
const maskedWithMorphContext=morphologyModel.predictMasked("нейрон получают сигнал",2);
assert.ok(maskedWithMorphContext.contextMorphologyBackoffs.some(row=>
 row.token==="получают"&&row.vocabularyToken==="получает"),
 "masked prediction must use morphology-aware context features");
const morphologyAnalysis=morphologyModel.analyse("нейроны получают сигнал");
assert.ok(morphologyAnalysis.morphologyBackoffCount>=1);
assert.ok(morphologyAnalysis.morphologyCoveredTokenCount>=1);
assert.ok(morphologyModel.status().trainingContextExamples>0,
 "training must persist contextual occurrences from training rows only");
const retrievalPrediction=morphologyModel.predictMasked("новые нейроны получают сигнал",1);
assert.ok(retrievalPrediction.retrievalCandidate);
assert.equal(retrievalPrediction.retrievalCandidate.token,"нейрон");
assert.ok(retrievalPrediction.retrievalPrediction);
assert.equal(retrievalPrediction.retrievalPrediction.surface,"нейроны");
const singleAlignedMatch= morphologyModel.predictMasked("сигнал [MASK] получает",1);
assert.equal(singleAlignedMatch.retrievalCandidate,null,
 "a retrieval candidate must be rejected when fewer than two context positions align");
const invertedOrderPrediction=morphologyModel.predictMasked("сигнал [MASK] получает",1,{allowOrderInversion:true});
assert.equal(invertedOrderPrediction.retrievalCandidate?.token,"нейрон",
 "opt-in order-invariant retrieval should recover a training target from two shared context tokens when one offset remains aligned");
assert.equal(invertedOrderPrediction.retrievalCandidate?.method,"unique_training_context_retrieval_order_inversion");
const invertedOrderVisible=morphologyModel.predictMasked("сигнал нейрон получает",1,{allowOrderInversion:true});
assert.deepEqual(invertedOrderVisible.retrievalCandidate,invertedOrderPrediction.retrievalCandidate,
 "order-invariant retrieval must not inspect the hidden target surface");
const hiddenRetrievalPrediction=morphologyModel.predictMasked("новые [MASK] получают сигнал",1);
assert.deepEqual(hiddenRetrievalPrediction.retrievalCandidate,retrievalPrediction.retrievalCandidate,
 "context retrieval must not inspect the hidden target form");
assert.deepEqual(hiddenRetrievalPrediction.retrievalPrediction,retrievalPrediction.retrievalPrediction,
 "retrieval-based inflection must be independent of the hidden target surface");
const restoredRetrievalModel=api.fromState(morphologyModel.exportState());
assert.equal(restoredRetrievalModel.status().trainingContextExamples,morphologyModel.status().trainingContextExamples);
assert.deepEqual(restoredRetrievalModel.predictMasked("новые [MASK] получают сигнал",1).retrievalPrediction,
 retrievalPrediction.retrievalPrediction,"training context index must survive state export/import");
const stemRetrievalModel=api.create({dimension:12,windowSize:2,heads:3,seed:122});
const stemRetrievalTraining=stemRetrievalModel.train([
 "система получает сигнал","систему запускает модуль","нейрон обрабатывает данные"
],{epochs:3,learningRate:.02,splitSeed:902});
assert.equal(stemRetrievalTraining.splitFallback,true,
 "stem retrieval fixture must have no fabricated held-out validation");
const stemContextPrediction=stemRetrievalModel.predictMasked("системы получает сигнал",1);
assert.equal(stemContextPrediction.retrievalCandidate?.token,"получает",
 "ambiguous OOV context forms may match by stem only when two different offsets align");
assert.equal(stemContextPrediction.retrievalCandidate?.stemMatches>=1,true);
const knownContextPrediction=morphologyModel.predictMasked("новые нейроны получают сигнал",1);
const maskedContextPrediction=morphologyModel.predictMasked("новые [MASK] получают сигнал",1);
assert.equal(knownContextPrediction.morphologyHint.number,"plural");
assert.deepEqual(knownContextPrediction.predictions,maskedContextPrediction.predictions,
 "masked prediction must not depend on the hidden target surface form");
assert.deepEqual(knownContextPrediction.generatedCandidates,maskedContextPrediction.generatedCandidates,
 "generated inflections must be produced from context and model vocabulary, not the hidden answer");
console.log("NEUROGENESIS contextual attention v5: stacked transformer blocks, cross-layer gradients, subword OOV handling, conservative Russian morphology fallback and checkpoint persistence passed.");