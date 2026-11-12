"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for(const file of ["contextual-attention.js","feats-supervision.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const Attention = window.NGContextualModel;
const Feats = window.NGFeatsSupervision;
assert.ok(Attention&&Feats);
assert.equal(Feats.schema,"NG_FEATS_CONTEXT_HEAD_V1");

const sentences = [
  ["Система получает сигнал.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem",PronType:"Int,Rel"}],
    ["получает","получать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["сигнал","сигнал",{Case:"Acc",Number:"Sing",Gender:"Masc"}]
  ]],
  ["Система хранит данные.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem",PronType:"Int,Rel"}],
    ["хранит","хранить",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["данные","данные",{Case:"Acc",Number:"Plur",PronType:"Rel,Int"}]
  ]],
  ["Система анализирует контекст.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["анализирует","анализировать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["контекст","контекст",{Case:"Acc",Number:"Sing",Gender:"Masc"}]
  ]],
  ["Система измеряет температуру.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["измеряет","измерять",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["температуру","температура",{Case:"Acc",Number:"Sing",Gender:"Fem"}]
  ]],
  ["Система выбирает маршрут.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["выбирает","выбирать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["маршрут","маршрут",{Case:"Acc",Number:"Sing",Gender:"Masc"}]
  ]],
  ["Система обрабатывает сообщение.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["обрабатывает","обрабатывать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["сообщение","сообщение",{Case:"Acc",Number:"Sing",Gender:"Neut"}]
  ]],
  ["Система отправляет пакеты.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["отправляет","отправлять",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["пакеты","пакет",{Case:"Acc",Number:"Plur",Gender:"Masc"}]
  ]],
  ["Система обнаруживает вибрацию.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["обнаруживает","обнаруживать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["вибрацию","вибрация",{Case:"Acc",Number:"Sing",Gender:"Fem"}]
  ]],
  ["Система сохраняет события.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["сохраняет","сохранять",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["события","событие",{Case:"Acc",Number:"Plur",Gender:"Neut"}]
  ]],
  ["Система открывает модуль.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["открывает","открывать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["модуль","модуль",{Case:"Acc",Number:"Sing",Gender:"Masc"}]
  ]],
  ["Система проверяет гипотезу.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["проверяет","проверять",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["гипотезу","гипотеза",{Case:"Acc",Number:"Sing",Gender:"Fem"}]
  ]],
  ["Система изучает маршрут.", [
    ["Система","система",{Case:"Nom",Number:"Sing",Gender:"Fem"}],
    ["изучает","изучать",{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}],
    ["маршрут","маршрут",{Case:"Acc",Number:"Sing",Gender:"Masc"}]
  ]]
];
const records = sentences.map(([text,rows],index)=>({
  sentenceId:"train-"+(index+1),
  text,
  tokens:rows.map(([form,lemma,feats])=>({form,lemma,feats}))
}));
const heldOut = [
  {
    sentenceId:"test-1",
    text:"Лидар диагностирует препятствие.",
    tokens:[
      {form:"Лидар",lemma:"лидар",feats:{Case:"Nom",Number:"Sing",Gender:"Masc"}},
      {form:"диагностирует",lemma:"диагностировать",feats:{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}},
      {form:"препятствие",lemma:"препятствие",feats:{Case:"Acc",Number:"Sing",Gender:"Neut"}}
    ]
  },
  {
    sentenceId:"test-2",
    text:"Гравиметр регистрирует колебания.",
    tokens:[
      {form:"Гравиметр",lemma:"гравиметр",feats:{Case:"Nom",Number:"Sing",Gender:"Masc"}},
      {form:"регистрирует",lemma:"регистрировать",feats:{Number:"Sing",Person:"3",Tense:"Pres",Aspect:"Imp",VerbForm:"Fin"}},
      {form:"колебания",lemma:"колебание",feats:{Case:"Acc",Number:"Plur",Gender:"Neut"}}
    ]
  }
];

const corpus = records.map(row=>row.text);
const contextual = Attention.create({dimension:8,windowSize:2,heads:2,blocks:1,seed:9173});
const contextualTraining = contextual.train(corpus,{
  epochs:8,learningRate:.025,patience:5,splitSeed:902
});
const split = contextual.splitCorpus(corpus,902);
assert.equal(split.train.length,contextualTraining.trainRows);
const recordMap = new Map(records.map(row=>[row.text,row]));
const trainRecords = split.train.map(text=>recordMap.get(text));
const validationRecords = split.validation.map(text=>recordMap.get(text));
assert.ok(trainRecords.every(Boolean)&&validationRecords.every(Boolean));

const training = Feats.extractExamples(trainRecords,contextual);
const validation = Feats.extractExamples(validationRecords,contextual);
const testing = Feats.extractExamples(heldOut,contextual);
const allAnnotatedTraining = Feats.extractExamples(records,contextual);
assert.ok(training.stats.featureTargets>0);
assert.ok(validation.stats.featureTargets>0);
assert.equal(testing.stats.alignedSentences,2);
assert.ok(testing.byAttribute.Case.length>0);
assert.ok(testing.byAttribute.Number.length>0);
assert.ok(testing.byAttribute.Tense.length>0);
assert.ok(allAnnotatedTraining.byAttribute.PronType.length>=2);
assert.deepEqual(
  [...new Set(allAnnotatedTraining.byAttribute.PronType.map(row=>row.label))],
  ["Int,Rel"],
  "comma-separated UD values with different source ordering must canonicalize to one label"
);
assert.ok(testing.byAttribute.Case.every(row=>row.lemma));
assert.ok(testing.byAttribute.Case.every(row=>row.targetKnown===false),
  "test examples must use subword representations for unseen lexical targets");

const trainCase = training.byAttribute.Case;
const validationCase = validation.byAttribute.Case;
const labels = [...new Set(trainCase.map(row=>row.label))];
assert.ok(labels.includes("Nom")&&labels.includes("Acc"));
assert.ok(validationCase.length>0);
const head = Feats.create({seed:812});
const result = head.train(trainCase,validationCase,{
  epochs:40,learningRate:.035,patience:8,seed:812,
  classWeighting:"sqrt_inverse",selectionMetric:"macro_f1"
});
assert.ok(result.trainingSteps>0);
assert.equal(result.selectionMetric,"validation_macro_f1");
assert.equal(result.classWeighting,"sqrt_inverse");
assert.ok(Number.isFinite(result.validationMacroF1));

const unweightedHead = Feats.create({seed:812});
const unweightedResult = unweightedHead.train(trainCase,validationCase,{
  epochs:40,learningRate:.035,patience:8,seed:812,
  classWeighting:"none",selectionMetric:"loss"
});
assert.equal(unweightedResult.classWeighting,"none");
assert.equal(unweightedResult.selectionMetric,"validation_loss");
assert.ok(Object.values(unweightedResult.classWeights).every(value=>value===1));
assert.ok(Number.isFinite(unweightedResult.validationLoss));
assert.deepEqual(Array.from(unweightedHead.status().labels),Array.from(head.status().labels));

const testCase = testing.byAttribute.Case;
const report = head.evaluate(testCase.filter(row=>head.status().labels.includes(row.label)));
assert.ok(report.targets>0);
assert.ok(Number.isFinite(report.accuracy));
assert.ok(Number.isFinite(report.macroF1));
const prediction = head.predict(testCase[0].features);
assert.ok(prediction&&labels.includes(prediction.label));
assert.ok(prediction.confidence>=0&&prediction.confidence<=1);

const unsafeFeatures = Object.create(null);
unsafeFeatures.Case = "Nom";
unsafeFeatures["__proto__"] = "polluted";
const malicious = Feats.extractExamples([{
  sentenceId:"unsafe",
  text:"Система видит мир.",
  tokens:[
    {form:"Система",lemma:"система",feats:unsafeFeatures},
    {form:"видит",lemma:"видеть",feats:{Number:"Sing"}},
    {form:"мир",lemma:"мир",feats:{Case:"Acc"}}
  ]
}],contextual);
assert.ok(malicious.byAttribute.Case);
assert.equal(Object.prototype.polluted,undefined);
assert.equal(malicious.byAttribute.__proto__,undefined);

console.log("NEUROGENESIS contextual FEATS head: annotation alignment, per-attribute targets, unseen-lemma holdout, validation checkpoint selection, class weighting and safe feature names passed.");
