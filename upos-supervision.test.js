"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = {window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number};
vm.runInNewContext(fs.readFileSync("contextual-attention.js", "utf8"), sandbox,
  {filename: "contextual-attention.js"});
vm.runInNewContext(fs.readFileSync("upos-supervision.js", "utf8"), sandbox,
  {filename: "upos-supervision.js"});

const Attention = window.NGContextualModel;
const Supervision = window.NGWordSupervision;
assert.ok(Attention && Supervision);
assert.equal(Supervision.schema, "NG_UPOS_CONTEXT_HEAD_V1");

const records = [
  ["Нейрон получает сигнал.", [["Нейрон","нейрон","NOUN"],["получает","получать","VERB"],["сигнал","сигнал","NOUN"]]],
  ["Сеть хранит данные.", [["Сеть","сеть","NOUN"],["хранит","хранить","VERB"],["данные","данные","NOUN"]]],
  ["Модель анализирует контекст.", [["Модель","модель","NOUN"],["анализирует","анализировать","VERB"],["контекст","контекст","NOUN"]]],
  ["Датчик измеряет температуру.", [["Датчик","датчик","NOUN"],["измеряет","измерять","VERB"],["температуру","температура","NOUN"]]],
  ["Алгоритм выбирает маршрут.", [["Алгоритм","алгоритм","NOUN"],["выбирает","выбирать","VERB"],["маршрут","маршрут","NOUN"]]],
  ["Программа обрабатывает сообщение.", [["Программа","программа","NOUN"],["обрабатывает","обрабатывать","VERB"],["сообщение","сообщение","NOUN"]]],
  ["Сервер отправляет пакет.", [["Сервер","сервер","NOUN"],["отправляет","отправлять","VERB"],["пакет","пакет","NOUN"]]],
  ["Сенсор обнаруживает вибрацию.", [["Сенсор","сенсор","NOUN"],["обнаруживает","обнаруживать","VERB"],["вибрацию","вибрация","NOUN"]]],
  ["Память сохраняет событие.", [["Память","память","NOUN"],["сохраняет","сохранять","VERB"],["событие","событие","NOUN"]]],
  ["Ключ открывает замок.", [["Ключ","ключ","NOUN"],["открывает","открывать","VERB"],["замок","замок","NOUN"]]],
  ["Контроллер проверяет модуль.", [["Контроллер","контроллер","NOUN"],["проверяет","проверять","VERB"],["модуль","модуль","NOUN"]]],
  ["Исследователь изучает гипотезу.", [["Исследователь","исследователь","NOUN"],["изучает","изучать","VERB"],["гипотезу","гипотеза","NOUN"]]]
].map(([text, rows], index) => ({
  sentenceId: "train-" + (index + 1),
  text,
  tokens: rows.map(([form, lemma, upos]) => ({form, lemma, upos, feats:{}, head:null, deprel:null}))
}));

const heldOut = [
  {
    sentenceId:"test-1",
    text:"Лидар диагностирует препятствие.",
    tokens:[
      {form:"Лидар",lemma:"лидар",upos:"NOUN"},
      {form:"диагностирует",lemma:"диагностировать",upos:"VERB"},
      {form:"препятствие",lemma:"препятствие",upos:"NOUN"}
    ]
  },
  {
    sentenceId:"test-2",
    text:"Гравиметр регистрирует колебание.",
    tokens:[
      {form:"Гравиметр",lemma:"гравиметр",upos:"NOUN"},
      {form:"регистрирует",lemma:"регистрировать",upos:"VERB"},
      {form:"колебание",lemma:"колебание",upos:"NOUN"}
    ]
  }
];

const corpus = records.map(row => row.text);
const contextual = Attention.create({dimension:8,windowSize:2,heads:2,blocks:1,seed:9173});
const training = contextual.train(corpus,{epochs:5,learningRate:.025,patience:4,splitSeed:902});
const split = contextual.splitCorpus(corpus,902);
assert.equal(split.train.length,training.trainRows);
const recordByText = new Map(records.map(row=>[row.text,row]));
const trainRecords = split.train.map(text=>recordByText.get(text));
const validationRecords = split.validation.map(text=>recordByText.get(text));
assert.ok(trainRecords.every(Boolean)&&validationRecords.every(Boolean));

const trainSet = Supervision.extractExamples(trainRecords,contextual);
const validationSet = Supervision.extractExamples(validationRecords,contextual);
const testSet = Supervision.extractExamples(heldOut,contextual);
assert.ok(trainSet.examples.length>0);
assert.ok(validationSet.examples.length>0);
assert.equal(testSet.examples.length,6);
assert.equal(testSet.stats.alignedSentences,2);
assert.ok(testSet.examples.every(row=>row.targetKnown===false),
  "the held-out lexical targets should exercise subword representations");
assert.ok(testSet.examples.every(row=>row.lemma));

const head = Supervision.create({seed:812});
const headTraining = head.train(trainSet.examples,validationSet.examples,
  {epochs:60,learningRate:.04,patience:10,seed:812});
assert.ok(headTraining.trainingSteps>0);
assert.deepEqual(Array.from(head.status().labels).sort(),["NOUN","VERB"]);
assert.equal(headTraining.trainExamples,trainSet.examples.length);
assert.equal(headTraining.validationExamples,validationSet.examples.length);

const evaluation = head.evaluate(testSet.examples);
assert.equal(evaluation.targets,6);
assert.equal(evaluation.covered,6);
assert.ok(evaluation.correct>=0&&evaluation.correct<=evaluation.covered);
assert.ok(Number.isFinite(evaluation.accuracy));
assert.ok(Number.isFinite(evaluation.macroF1));
const seenLemmas = new Set(trainSet.examples.map(row=>row.lemma));
const unseenLemmaExamples = testSet.examples.filter(row=>!seenLemmas.has(row.lemma));
const unseenLemmaEvaluation = head.evaluate(unseenLemmaExamples);
assert.ok(unseenLemmaExamples.length>0);
assert.equal(unseenLemmaEvaluation.targets,unseenLemmaExamples.length);

const prediction = head.predict(testSet.examples[0].features);
assert.ok(prediction&&["NOUN","VERB"].includes(prediction.label));
assert.ok(prediction.confidence>=0&&prediction.confidence<=1);
const restored = Supervision.create();
restored.loadState(head.exportState());
assert.deepEqual(restored.predict(testSet.examples[0].features),prediction,
  "UPOS checkpoint reload must preserve class probabilities");
assert.throws(()=>head.train([{features:[1,2],label:"NOUN"}],[]),
  /at least two distinct classes/u);
assert.ok(trainSet.stats.alignedSentences>0);
assert.equal(trainSet.stats.tokenExamples,trainSet.examples.length);

console.log("NEUROGENESIS contextual UPOS auxiliary head: deterministic train/validation split, OOV subword feature extraction, held-out unseen-lemma evaluation and checkpoint parity passed.");
