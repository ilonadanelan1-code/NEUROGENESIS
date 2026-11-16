"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const messages=[];
const handlers={};
const sandbox={
  postMessage(message){messages.push(message);},
  addEventListener(name,callback){handlers[name]=callback;},
  importScripts(...files){
    for(const file of files){
      vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
    }
  }
};
sandbox.self=sandbox;
sandbox.window=sandbox;
vm.runInNewContext(
  fs.readFileSync("contextual-training-worker.js","utf8"),
  sandbox,
  {filename:"contextual-training-worker.js"}
);

const corpus=[
  "нейрон получает сигнал","нейрон обрабатывает сигнал","сигнал активирует нейрон",
  "сеть получает данные","сеть обрабатывает сигнал","память хранит информацию",
  "модель изучает контекст","контекст меняет значение слова","система получает сигнал",
  "система обрабатывает данные","ключ открывает замок","ключ запускает программу",
  "программа использует ключ","замок защищает помещение",
  "сенсор обнаруживает импульс","алгоритм выбирает маршрут",
  "исследователь проверяет гипотезу","память сохраняет событие",
  "датчик измеряет температуру","система передает сигнал"
];

assert.equal(typeof handlers.message,"function","worker must register its message handler");
handlers.message({data:{type:"train",rows:corpus}});
const progress=messages.filter(message=>message.type==="progress");
const complete=messages.find(message=>message.type==="complete");
assert.ok(progress.length>0,"worker must stream progress while training");
assert.ok(progress.some(message=>message.phase==="contextual"),"contextual training progress must be reported");
assert.ok(progress.some(message=>message.phase==="phrase-preparing"),"phrase preparation must be visible");
assert.ok(complete,"worker must return a completed checkpoint");
assert.equal(complete.report.evaluationIsolated,true,"held-out evaluation must stay isolated");
assert.ok(complete.report.testAccuracy>=0&&complete.report.testAccuracy<=1);
const restored=sandbox.NGContextualModel.create({dimension:12,windowSize:4,heads:3,blocks:2,seed:9173});
assert.equal(restored.loadState(complete.contextualState).trained,true,"worker checkpoint must load into browser architecture");
if(complete.phraseState){
  const phrase=sandbox.NGPhraseCompositionModel.create({dimension:12,seed:24081});
  assert.equal(phrase.loadState(complete.phraseState).trained,true,"phrase checkpoint must also load");
}
console.log("NEUROGENESIS background contextual worker: progress, isolated evaluation and checkpoint loading passed.");
