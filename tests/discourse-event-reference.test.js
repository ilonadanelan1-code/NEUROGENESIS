"use strict";
// Regression guard: Russian Unicode word boundaries must not rely on ASCII \\b.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const window={};
const sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for(const file of ["semantic-core.js","discourse-event-reference.js"])
 vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
const api=window.NGDiscourseEventReference,core=window.NGSemanticCore;
assert.ok(api&&core);
assert.equal(api.detectMention("Из-за этого обработка остановилась").relation,"cause_or_result");
assert.equal(api.detectMention("После этого сервер перезапустился").relation,"sequence");
assert.equal(api.detectMention("Это привело к сбою").relation,"event_subject");
assert.equal(api.detectMention("Он снова заработал"),null,"entity pronouns belong to the entity resolver");
assert.equal(api.detectMention("Это устройство новое"),null,"possessive/demonstrative noun phrase is not an event link");
const messages=[
 {id:"E1",threadId:"T1",role:"user",text:"Сервер потерял соединение."},
 {id:"A1",threadId:"T1",role:"assistant",text:"Это неприятно."},
 {id:"E2",threadId:"T1",role:"user",text:"После этого обработка остановилась."},
 {id:"E3",threadId:"T2",role:"user",text:"База данных перезапустилась."}
];
const candidates=api.extractCandidates(messages,core,{topicId:"T1"});
assert.ok(candidates.length>0,"asserted user propositions in active thread should become event candidates");
assert.equal(candidates.some(x=>x.id==="A1"),false,"assistant text must not become user-grounded event fact");
assert.equal(candidates.some(x=>x.id==="E3"),false,"other thread must be excluded");
const resolved=api.resolveMention("Из-за этого обработка остановилась",candidates,{topicId:"T1"});
assert.equal(resolved.status,"resolved");
assert.equal(resolved.antecedent.id,"E1");
assert.equal(resolved.provenance.memoryEffect,"none");
const competing=api.resolveMention("Из-за этого возник сбой",[
 {id:"E1",text:"Сервер потерял соединение",subject:"сервер",predicate:"потерял",object:"соединение",signature:"сервер потерял соединение",confidence:0.8,turnDistance:1,topicId:"T1"},
 {id:"E2",text:"База данных остановила обработку",subject:"база данных",predicate:"остановила",object:"обработку",signature:"база данных остановила обработку",confidence:0.8,turnDistance:1,topicId:"T1"}
],{topicId:"T1"});
assert.equal(competing.status,"ambiguous","equally plausible events must not be guessed");
assert.equal(competing.antecedent,null);
const otherTopic=api.resolveMention("Из-за этого всё остановилось",candidates,{topicId:"T2"});
assert.equal(otherTopic.status,"unresolved");
console.log("NEUROGENESIS discourse event reference pilot tests passed.");
