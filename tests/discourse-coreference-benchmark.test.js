"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["discourse-coreference.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const discourse = window.NGDiscourseCoreference;
assert.ok(discourse, "discourse coreference module must load");

const make = (id,text,gender,number,syntacticRole,semanticRole,turnDistance,topicId="T1") => ({
  id,text,gender,number,syntacticRole,semanticRole,turnDistance,sentenceDistance:0,
  topicId,sourceRole:"user",salience:syntacticRole==="subject"?0.9:0.55,mentionCount:1
});
const cases = [
  {id:"single-masculine",query:"Он ушёл.",gold:"ivan",category:"agreement",
    candidates:[make("anna","Анна","feminine","singular","subject","agent",1),make("ivan","Иван","masculine","singular","object","theme",2)]},
  {id:"single-feminine",query:"Она вернулась.",gold:"maria",category:"agreement",
    candidates:[make("petr","Пётр","masculine","singular","subject","agent",1),make("maria","Мария","feminine","singular","object","theme",3)]},
  {id:"plural-agreement",query:"Они активировались.",gold:"neurons",category:"agreement",
    candidates:[make("module","Модуль","masculine","singular","subject","agent",1),make("neurons","Нейроны","plural","plural","object","theme",4)]},
  {id:"neuter-agreement",query:"Оно сломалось.",gold:"device",category:"agreement",
    candidates:[make("system","Система","feminine","singular","subject","agent",1),make("device","Устройство","neuter","singular","object","theme",2)]},
  {id:"object-theme-over-recency",query:"Я увидел его.",gold:"theme",category:"role",
    candidates:[make("agent","Иван","masculine","singular","subject","agent",1),make("theme","Пётр","masculine","singular","object","theme",2)]},
  {id:"dative-recipient",query:"Ему передали ключ.",gold:"recipient",category:"role",
    candidates:[make("agent","Иван","masculine","singular","subject","agent",1),make("recipient","Петру","masculine","singular","object","recipient",3)]},
  {id:"plural-dative-recipient",query:"Им сообщили результат.",gold:"recipients",category:"role",
    candidates:[make("agents","Инженеры","plural","plural","subject","agent",1),make("recipients","Исследователи","plural","plural","object","recipient",2)]},
  {id:"instrumental-role",query:"С ним работали.",gold:"instrument",category:"role",
    candidates:[make("theme","Модуль","masculine","singular","object","theme",1),make("instrument","Инструмент","masculine","singular","object","instrument",3)]},
  {id:"plural-object-theme",query:"Проверили их.",gold:"files",category:"role",
    candidates:[make("people","Инженеры","plural","plural","subject","agent",1),make("files","Файлы","plural","plural","object","theme",2)]},
  {id:"older-subject-over-near-object",query:"Он позвонил.",gold:"older-agent",category:"role",
    candidates:[make("near-object","Пётр","masculine","singular","object","theme",1),make("older-agent","Иван","masculine","singular","subject","agent",2)]},
  {id:"distant-agreement",query:"Она пришла.",gold:"older-maria",category:"long_distance",
    candidates:[make("near-petr","Пётр","masculine","singular","subject","agent",1),make("older-maria","Мария","feminine","singular","subject","agent",6)]},
  {id:"distant-plural",query:"Они вернулись.",gold:"older-team",category:"long_distance",
    candidates:[make("near-person","Иван","masculine","singular","subject","agent",1),make("older-team","Команда","plural","plural","subject","agent",5)]},
  {id:"distant-role-over-near-agent",query:"Ему ответили.",gold:"older-recipient",category:"long_distance",
    candidates:[make("near-agent","Пётр","masculine","singular","subject","agent",1),make("older-recipient","Ивану","masculine","singular","object","recipient",5)]},
  {id:"same-topic-return",query:"Он снова ответил.",gold:"old-topic-person",category:"topic_return",
    candidates:[make("recent-woman","Мария","feminine","singular","subject","agent",1),make("old-topic-person","Пётр","masculine","singular","subject","agent",5)]},
  {id:"case-role-return",query:"Ей передали сообщение.",gold:"recipient",category:"topic_return",
    candidates:[make("recent-agent","Иван","feminine","singular","subject","agent",1),make("recipient","Марии","feminine","singular","object","recipient",4)]},
  {id:"subject-salience",query:"Он продолжил работу.",gold:"focus",category:"role",
    candidates:[make("recent-theme","Модуль","masculine","singular","object","theme",1),make("focus","Пётр","masculine","singular","subject","agent",2)]},
  {id:"accusative-theme",query:"Я нашёл его.",gold:"target",category:"role",
    candidates:[make("recent-agent","Пётр","masculine","singular","subject","agent",1),make("target","Файл","masculine","singular","object","theme",2)]},
  {id:"two-equal-feminine",query:"Она ответила.",gold:null,category:"ambiguous",
    candidates:[make("anna","Анна","feminine","singular","subject","agent",2),make("maria","Мария","feminine","singular","subject","agent",2)]},
  {id:"two-equal-masculine",query:"Он ушёл.",gold:null,category:"ambiguous",
    candidates:[make("ivan","Иван","masculine","singular","subject","agent",1),make("petr","Пётр","masculine","singular","subject","agent",1)]},
  {id:"two-equal-plural",query:"Они пришли.",gold:null,category:"ambiguous",
    candidates:[make("team-a","Команда А","plural","plural","subject","agent",2),make("team-b","Команда Б","plural","plural","subject","agent",2)]},
  {id:"no-compatible-gender",query:"Он ответил.",gold:null,category:"unresolved",
    candidates:[make("anna","Анна","feminine","singular","subject","agent",1),make("model","Модель","feminine","singular","object","theme",2)]},
  {id:"no-candidate",query:"Она ответила.",gold:null,category:"unresolved",candidates:[]},
  {id:"other-topic-only",query:"Он ответил.",gold:null,category:"topic_switch",
    candidates:[make("old-petr","Пётр","masculine","singular","subject","agent",1,"T2")]},
  {id:"same-topic-filter",query:"Он ответил.",gold:"same-thread-petr",category:"topic_switch",
    candidates:[make("other-thread-petr","Пётр","masculine","singular","subject","agent",1,"T2"),
      make("same-thread-petr","Пётр","masculine","singular","object","theme",3,"T1")]},
  {id:"negation-preserves-reference",query:"Он не вернулся.",gold:"petr",category:"negation",
    candidates:[make("near-anna","Анна","feminine","singular","subject","agent",1),
      make("petr","Пётр","masculine","singular","subject","agent",3)]},
  {id:"causal-discourse-subject",query:"Поэтому он вызвал врача.",gold:"older-agent",category:"causal",
    candidates:[make("near-object","Пётр","masculine","singular","object","theme",1),
      make("older-agent","Иван","masculine","singular","subject","agent",2)]}
];

function compatible(mention,candidate){
  const gender=candidate.gender||"unknown",number=candidate.number||"unknown";
  if(gender!=="unknown"&&!mention.genders.includes(gender))return false;
  if(number!=="unknown"&&number!==mention.number)return false;
  return true;
}
function nearestBaseline(query,candidates){
  const mention=discourse.detectMention(query);
  if(!mention)return null;
  const rows=(candidates||[]).filter(c=>!c.topicId||c.topicId==="T1").filter(c=>compatible(mention,c))
    .sort((a,b)=>(a.turnDistance||1)-(b.turnDistance||1)||
      (a.sentenceDistance||0)-(b.sentenceDistance||0));
  if(!rows.length)return null;
  const distance=(rows[0].turnDistance||1)*100+(rows[0].sentenceDistance||0);
  const tied=rows.filter(row=>(row.turnDistance||1)*100+(row.sentenceDistance||0)===distance);
  return tied.length===1?rows[0].id:null;
}
function metrics(predictions,rows){
  let tp=0,fp=0,fn=0,correct=0,links=0,correctAbstain=0,requiredAbstain=0;
  for(let i=0;i<rows.length;i++){
    const gold=rows[i].gold,pred=predictions[i];
    if(pred===gold)correct++;
    if(gold===null){requiredAbstain++;if(pred===null)correctAbstain++;}
    if(pred!==null)links++;
    if(pred!==null&&pred===gold)tp++;
    else if(pred!==null)fp++;
    if(gold!==null&&pred!==gold)fn++;
  }
  const precision=tp+fp?tp/(tp+fp):0,recall=tp+fn?tp/(tp+fn):0;
  return {exactAccuracy:{correct,total:rows.length,value:correct/rows.length},
    linkPrecision:{correct:tp,predicted:tp+fp,value:precision},
    linkRecall:{correct:tp,gold:tp+fn,value:recall},
    linkF1:precision+recall?2*precision*recall/(precision+recall):0,
    coverage:{linked:links,total:rows.length,value:links/rows.length},
    falseLinkRate:{falseLinks:fp,predicted:links,value:links?fp/links:0},
    correctAbstention:{correct:correctAbstain,required:requiredAbstain,
      value:requiredAbstain?correctAbstain/requiredAbstain:0}};
}

const baseline=[],experiment=[];
for(const row of cases){
  baseline.push(nearestBaseline(row.query,row.candidates));
  const result=discourse.resolveMention(row.query,row.candidates,{topicId:"T1"});
  experiment.push(result.status==="resolved"?result.antecedent.id:null);
}
const baselineMetrics=metrics(baseline,cases),experimentMetrics=metrics(experiment,cases);
const byCategory={};
for(const category of [...new Set(cases.map(row=>row.category))]){
  const selected=cases.map((row,index)=>({row,index})).filter(item=>item.row.category===category);
  byCategory[category]={
    cases:selected.length,
    baselineCorrect:selected.filter(item=>baseline[item.index]===item.row.gold).length,
    experimentCorrect:selected.filter(item=>experiment[item.index]===item.row.gold).length,
    experimentLinks:selected.filter(item=>experiment[item.index]!==null).length
  };
}
assert.equal(cases.length,26);
assert.ok(cases.some(row=>row.category==="long_distance"));
assert.ok(cases.some(row=>row.category==="ambiguous"));
assert.ok(cases.some(row=>row.category==="topic_switch"));
assert.ok(experimentMetrics.correctAbstention.required>0);
console.log("NEUROGENESIS discourse coreference diagnostic benchmark: "+JSON.stringify({
  schema:"NG_DISCOURSE_COREFERENCE_DIAGNOSTIC_V1",
  corpus:"hand-authored diagnostic contrast set; not a representative corpus",
  cases:cases.length,
  split:"single fixed diagnostic set; no train/test split and no learning",
  baseline:"nearest compatible mention by recency; tie abstains",
  experiment:"agreement + grammatical-case/semantic-role + salience + recency; threshold and margin abstention",
  baseline:baselineMetrics,experiment:experimentMetrics,byCategory
}));
