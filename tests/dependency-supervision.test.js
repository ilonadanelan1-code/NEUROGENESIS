"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for (const file of ["contextual-attention.js","dependency-supervision.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const Attention = window.NGContextualModel;
const Dependency = window.NGDependencySupervision;
assert.ok(Attention && Dependency);
assert.equal(Dependency.schema,"NG_DEPENDENCY_HEAD_RELATION_V1");

const sentences = [
  ["Система получает сигнал.",[
    ["Система","система",2,"nsubj"],["получает","получать",0,"root"],["сигнал","сигнал",2,"obj"]
  ]],
  ["Датчик измеряет температуру.",[
    ["Датчик","датчик",2,"nsubj"],["измеряет","измерять",0,"root"],["температуру","температура",2,"obj"]
  ]],
  ["Модель анализирует контекст.",[
    ["Модель","модель",2,"nsubj"],["анализирует","анализировать",0,"root"],["контекст","контекст",2,"obj"]
  ]],
  ["Сенсор фиксирует движение.",[
    ["Сенсор","сенсор",2,"nsubj"],["фиксирует","фиксировать",0,"root"],["движение","движение",2,"obj"]
  ]],
  ["Алгоритм выбирает маршрут.",[
    ["Алгоритм","алгоритм",2,"nsubj"],["выбирает","выбирать",0,"root"],["маршрут","маршрут",2,"obj"]
  ]],
  ["Устройство передаёт данные.",[
    ["Устройство","устройство",2,"nsubj"],["передаёт","передавать",0,"root"],["данные","данные",2,"obj"]
  ]],
  ["Исследователь проверяет гипотезу.",[
    ["Исследователь","исследователь",2,"nsubj"],["проверяет","проверять",0,"root"],["гипотезу","гипотеза",2,"obj"]
  ]],
  ["Процессор обрабатывает запрос.",[
    ["Процессор","процессор",2,"nsubj"],["обрабатывает","обрабатывать",0,"root"],["запрос","запрос",2,"obj"]
  ]],
  ["Программа сохраняет результат.",[
    ["Программа","программа",2,"nsubj"],["сохраняет","сохранять",0,"root"],["результат","результат",2,"obj"]
  ]],
  ["Робот быстро обнаруживает препятствие.",[
    ["Робот","робот",3,"nsubj"],["быстро","быстро",3,"advmod"],
    ["обнаруживает","обнаруживать",0,"root"],["препятствие","препятствие",3,"obj"]
  ]],
  ["Датчик точно измеряет давление.",[
    ["Датчик","датчик",3,"nsubj"],["точно","точно",3,"advmod"],
    ["измеряет","измерять",0,"root"],["давление","давление",3,"obj"]
  ]],
  ["Нейрон получает импульс.",[
    ["Нейрон","нейрон",2,"nsubj"],["получает","получать",0,"root"],["импульс","импульс",2,"obj"]
  ]]
];
const records = sentences.map(([text,rows],index)=>({
  sentenceId:"train-"+(index+1),
  text,
  tokens:rows.map(([form,lemma,head,deprel],tokenIndex)=>({
    id:tokenIndex+1,form,lemma,head,deprel,upos:tokenIndex===1?"VERB":"NOUN",feats:{}
  }))
}));
const heldOut = [
  {
    sentenceId:"test-1",
    text:"Лидар диагностирует преграду.",
    tokens:[
      {id:1,form:"Лидар",lemma:"лидар",head:2,deprel:"nsubj"},
      {id:2,form:"диагностирует",lemma:"диагностировать",head:0,deprel:"root"},
      {id:3,form:"преграду",lemma:"преграда",head:2,deprel:"obj"},
      {id:4,form:".",lemma:"_",head:2,deprel:"punct"}
    ]
  },
  {
    sentenceId:"test-2",
    text:"Гравиметр регистрирует колебания.",
    tokens:[
      {id:1,form:"Гравиметр",lemma:"гравиметр",head:2,deprel:"nsubj"},
      {id:2,form:"регистрирует",lemma:"регистрировать",head:0,deprel:"root"},
      {id:3,form:"колебания",lemma:"колебание",head:2,deprel:"obj"}
    ]
  }
];

const corpus = records.map(row=>row.text);
const contextual = Attention.create({dimension:8,windowSize:2,heads:2,blocks:1,seed:9173});
const contextualTraining = contextual.train(corpus,{
  epochs:6,learningRate:.025,patience:4,splitSeed:902
});
const split = contextual.splitCorpus(corpus,902);
assert.equal(split.train.length,contextualTraining.trainRows);
const byText = new Map(records.map(row=>[row.text,row]));
const trainRecords = split.train.map(text=>byText.get(text));
const validationRecords = split.validation.map(text=>byText.get(text));
assert.ok(trainRecords.every(Boolean)&&validationRecords.every(Boolean));

const trainSet = Dependency.extractExamples(trainRecords,contextual);
const validationSet = Dependency.extractExamples(validationRecords,contextual);
const testSet = Dependency.extractExamples(heldOut,contextual);
assert.ok(trainSet.groups.length>0);
assert.ok(validationSet.groups.length>0);
assert.equal(testSet.stats.alignedSentences,2);
assert.equal(testSet.groups.length,6);
assert.ok(testSet.groups.every(row=>row.targetKnown===false),
  "held-out dependency dependents must include unseen lexical targets");
assert.ok(testSet.groups.every(row=>row.candidateHeadIds[0]===0),
  "root must be an explicit head candidate");
assert.ok(testSet.groups.every(row=>row.candidateHeadIds.length===row.sentenceLength),
  "each dependent must be scored against ROOT and all other words");
assert.ok(testSet.groups.filter(row=>row.relation==="root").every(row=>
  row.candidateHeadIds[row.targetCandidateIndex]===0));
assert.ok(testSet.groups.filter(row=>row.relation!=="root").every(row=>
  row.candidateHeadIds[row.targetCandidateIndex]!==0));
assert.equal(testSet.groups.some(row=>row.relation==="punct"),false,
  "standalone punctuation must be excluded as a lexical dependent while the sentence stays aligned");
assert.ok(testSet.stats.skippedReasons.nonlexical_token>=1);
assert.ok(trainSet.groups.some(row=>row.relation==="root"));
assert.ok(trainSet.groups.some(row=>row.relation==="nsubj"));
assert.ok(trainSet.groups.some(row=>row.relation==="obj"));

const head = Dependency.create({seed:812});
const training = head.train(trainSet.groups,validationSet.groups,{
  epochs:12,learningRate:.012,patience:4,seed:812,
  classWeighting:"none",selectionMetric:"las"
});
assert.ok(training.trainingSteps>0);
assert.equal(training.selectionMetric,"validation_las");
assert.ok(Number.isFinite(training.validationLAS));
assert.equal(training.trainExamples,trainSet.groups.length);
assert.equal(training.validationExamples,validationSet.groups.length);
const evaluation = head.evaluate(testSet.groups);
assert.equal(evaluation.targets,6);
assert.ok(Number.isFinite(evaluation.headAccuracy));
assert.ok(Number.isFinite(evaluation.oracleRelationAccuracy));
assert.ok(Number.isFinite(evaluation.relationMacroF1));
assert.ok(Number.isFinite(evaluation.las));
const prediction = head.predict(testSet.groups[0]);
assert.ok(prediction);
assert.ok(testSet.groups[0].candidateHeadIds.includes(prediction.headId));
assert.ok(head.status().labels.includes(prediction.relation));
assert.ok(prediction.headConfidence>=0&&prediction.headConfidence<=1);
assert.ok(prediction.relationConfidence>=0&&prediction.relationConfidence<=1);

const seenLemmas = new Set(trainSet.groups.map(row=>row.lemma));
const unseenRows = testSet.groups.filter(row=>!seenLemmas.has(row.lemma));
assert.equal(unseenRows.length,6);
assert.equal(head.evaluate(unseenRows).targets,unseenRows.length);

const balanced = Dependency.create({seed:812});
const balancedTraining = balanced.train(trainSet.groups,validationSet.groups,{
  epochs:8,learningRate:.012,patience:4,seed:812,
  classWeighting:"sqrt_inverse",selectionMetric:"las"
});
assert.equal(balancedTraining.classWeighting,"sqrt_inverse");
assert.equal(balancedTraining.selectionMetric,"validation_las");
assert.ok(Object.values(balancedTraining.classWeights).every(value=>Number.isFinite(value)&&value>0));

const restored = Dependency.create();
restored.loadState(head.exportState());
assert.deepEqual(restored.predict(testSet.groups[0]),prediction,
  "dependency checkpoint reload must preserve head and relation predictions");
assert.throws(()=>head.train([{candidateFeatures:[[1,2]],candidateHeadIds:[0],
  targetCandidateIndex:0,relation:"nsubj"}],[]),/invalid candidate features/u);

const invalidRecord = {
  sentenceId:"invalid-head",
  text:"Лидар видит сигнал.",
  tokens:[
    {id:1,form:"Лидар",lemma:"лидар",head:1,deprel:"nsubj"},
    {id:2,form:"видит",lemma:"видеть",head:0,deprel:"root"},
    {id:3,form:"сигнал",lemma:"сигнал",head:2,deprel:"obj"}
  ]
};
const invalid = Dependency.extractExamples([invalidRecord],contextual);
assert.equal(invalid.stats.skippedReasons.self_head,1,
  "self-headed annotation must be skipped instead of training a malformed arc");

console.log("NEUROGENESIS dependency head/relation head: token alignment, candidate-head supervision, ROOT handling, OOV holdout, LAS selection, class weighting and checkpoint parity passed.");
