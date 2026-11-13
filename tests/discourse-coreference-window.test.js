"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const coreSource=fs.readFileSync("semantic-core.js","utf8");
const resolverSource=fs.readFileSync("discourse-coreference.js","utf8");
assert.match(resolverSource,/const MAX_MESSAGES = 24;/,
  "the experiment must use the full 24-message per-thread history exposed by memory.js");
const baselineSource=resolverSource.replace("const MAX_MESSAGES = 24;","const MAX_MESSAGES = 8");
assert.notEqual(baselineSource,resolverSource,"the 8-message baseline must be an actual bounded-window variant");

function loadResolver(source) {
  const window={};
  const sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
  vm.runInNewContext(coreSource,sandbox,{filename:"semantic-core.js"});
  vm.runInNewContext(source,sandbox,{filename:"discourse-coreference.js"});
  return {core:window.NGSemanticCore,discourse:window.NGDiscourseCoreference};
}
const baseline=loadResolver(baselineSource);
const experiment=loadResolver(resolverSource);
assert.equal(baseline.discourse.resolveMention("Он пришёл.",[],{}).provenance.window,8);
assert.equal(experiment.discourse.resolveMention("Он пришёл.",[],{}).provenance.window,24);

function makeScenario(id,first,second,query,filler,kind="linked") {
  const frames=new Map();
  const messages=[];
  const add=(index,threadId,proposition)=>{
    const text=id+":turn:"+index;
    frames.set(text,{...proposition,arguments:[]});
    messages.push({id:id+"-"+index,threadId,role:"user",text});
  };
  add(0,"T1",{subject:first,object:null});
  if (kind==="linked") add(1,"T1",{subject:null,object:second});
  else add(1,"T1",{subject:second,object:null});
  for(let index=2;index<24;index++) add(index,"T1",{subject:filler,object:null});
  const core={
    grammaticalFeatures:experiment.core.grammaticalFeatures,
    analyse(text){const proposition=frames.get(text);return proposition?{proposition}: {proposition:null};}
  };
  return {id,query,messages,core,expected:kind==="linked"?"linked":"abstain",surfaceForms:[first,second]};
}

const cases=[
  makeScenario("far-system","Система","систему","Она снова вернулась.","Сервер","linked"),
  makeScenario("far-server","Сервер","серверу","Он снова ответил.","Система","linked"),
  makeScenario("far-process","Процесс","процессом","Он снова запустился.","Система","linked"),
  makeScenario("far-module","Модуль","модулю","Он снова заработал.","Система","linked"),
  makeScenario("far-network","Сеть","сетью","Она снова появилась.","Сервер","linked"),
  makeScenario("far-signal","Сигнал","сигналом","Он снова появился.","Система","linked"),
  makeScenario("ambiguous-feminine-system-model","Система","Модель","Она вернулась.","Сервер","ambiguous"),
  makeScenario("ambiguous-feminine-network-memory","Сеть","Память","Она вернулась.","Сервер","ambiguous"),
  makeScenario("ambiguous-feminine-names","Анна","Мария","Она вернулась.","Сервер","ambiguous"),
  makeScenario("ambiguous-masculine-server-module","Сервер","Модуль","Он вернулся.","Система","ambiguous"),
  makeScenario("ambiguous-masculine-process-signal","Процесс","Сигнал","Он вернулся.","Система","ambiguous"),
  makeScenario("ambiguous-masculine-names","Илья","Петя","Он вернулся.","Система","ambiguous")
];

function run(resolver,item) {
  return resolver.discourse.resolveFromHistory(item.query,item.messages,item.core,{topicId:"T1"});
}
function isCorrect(result,item) {
  if(item.expected==="linked") {
    return result.status==="resolved" &&
      item.surfaceForms.every(form=>result.antecedent.surfaceForms.includes(form)) &&
      result.antecedent.identityBasis==="morphological_lemma" &&
      result.antecedent.turnDistance>=23;
  }
  return result.status==="ambiguous" || result.status==="unresolved";
}
function evaluate(resolver) {
  let correct=0,links=0,trueLinks=0,falseLinks=0,correctAbstentions=0;
  const rows=[];
  for(const item of cases) {
    const result=run(resolver,item);
    const linked=result.status==="resolved";
    if(isCorrect(result,item)) correct++;
    if(linked) links++;
    if(linked && item.expected==="linked") trueLinks++;
    if(linked && item.expected==="abstain") falseLinks++;
    if(item.expected==="abstain" && !linked) correctAbstentions++;
    rows.push({id:item.id,expected:item.expected,status:result.status,
      antecedent:result.antecedent&&result.antecedent.text,
      window:result.provenance.window});
  }
  return {
    exact:{correct,total:cases.length,accuracy:correct/cases.length},
    links:{trueLinks,falseLinks,predicted:links,precision:links?trueLinks/links:null,recall:trueLinks/6},
    coverage:{linked:links,total:cases.length,value:links/cases.length},
    falseLinkRate:{falseLinks,predicted:links,value:links?falseLinks/links:null},
    correctAbstention:{correct:correctAbstentions,required:6,value:correctAbstentions/6},
    rows
  };
}
const baselineScores=evaluate(baseline);
const experimentScores=evaluate(experiment);
assert.equal(baselineScores.exact.correct,6,
  "the 8-message baseline should preserve all six correct abstentions but miss six distant links");
assert.equal(baselineScores.links.trueLinks,0);
assert.equal(experimentScores.exact.correct,12,
  "the 24-message window should recover six unique distant links and still abstain on six ambiguous pairs");
assert.equal(experimentScores.links.trueLinks,6);
assert.equal(experimentScores.links.falseLinks,0,
  "the extended history must not confidently choose either candidate in ambiguous distant cases");
assert.equal(experimentScores.correctAbstention.correct,6);

function shortHistory(name) {
  const text="name:"+name;
  const core={
    grammaticalFeatures:experiment.core.grammaticalFeatures,
    analyse(value){return value===text?{proposition:{subject:name,object:null,arguments:[]}}:{proposition:null};}
  };
  return {messages:[{id:"N1",threadId:"T1",role:"user",text}],core};
}
for(const name of ["Саша","Женя"]) {
  const history=shortHistory(name);
  assert.equal(experiment.discourse.resolveFromHistory("Он ушёл.",history.messages,history.core,{topicId:"T1"}).status,
    "unresolved",name+" must not be assigned masculine gender from a generic suffix");
  assert.equal(experiment.discourse.resolveFromHistory("Она ушла.",history.messages,history.core,{topicId:"T1"}).status,
    "unresolved",name+" must not be assigned feminine gender from a generic suffix");
}
const petya=shortHistory("Петя");
assert.equal(experiment.discourse.resolveFromHistory("Он ушёл.",petya.messages,petya.core,{topicId:"T1"}).status,"resolved",
  "the discourse name exception must preserve known masculine diminutives");
assert.equal(experiment.discourse.resolveFromHistory("Она ушла.",petya.messages,petya.core,{topicId:"T1"}).status,"unresolved");

console.log("NEUROGENESIS discourse 24-message window diagnostic passed.");
console.log(JSON.stringify({
  scope:"12 hand-authored long-distance pairs; not a representative corpus",
  baseline8:baselineScores,
  experiment24:experimentScores,
  nameAbstentionGuards:{ambiguousNames:["Саша","Женя"],masculineException:"Петя",status:"passed"}
},null,2));
