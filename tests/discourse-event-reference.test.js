"use strict";
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
assert.equal(api.detectMention("Это устройство новое"),null,"a demonstrative noun phrase is not an event link");

// Integration guard: use verb patterns supported by the real semantic analyser.
const parsed=core.analyse("Система получает сигнал.",{contextRelation:"new_topic"});
assert.equal(parsed.proposition.kind,"assertion");
assert.equal(parsed.proposition.subject,"Система");
assert.equal(parsed.proposition.predicate,"получает");
assert.equal(parsed.proposition.object,"сигнал");
assert.equal(parsed.proposition.attribution.source,"user_utterance");
assert.ok(parsed.proposition.confidence>=0.5);

const messages=[
 {id:"E1",threadId:"T1",role:"user",text:"Система получает сигнал."},
 {id:"A1",threadId:"T1",role:"assistant",text:"Модуль активирует процесс."},
 {id:"E3",threadId:"T2",role:"user",text:"Модуль активирует процесс."},
 {id:"R1",threadId:"T1",role:"user",text:"В отчёте говорится, что система получает сигнал."},
 {id:"H1",threadId:"T1",role:"user",text:"Возможно, система получает сигнал."},
 {id:"O1",threadId:"T1",role:"user",text:"Я думаю, система получает сигнал."}
];
const candidates=api.extractCandidates(messages,core,{topicId:"T1"});
assert.equal(candidates.length,1,"only the asserted user proposition should become a candidate");
assert.equal(candidates[0].id,"E1");
assert.equal(candidates.some(x=>x.id==="A1"),false,"assistant text must not become a user-grounded event");
assert.equal(candidates.some(x=>x.id==="E3"),false,"another topic must be excluded");
assert.equal(candidates.some(x=>x.id==="R1"),false,"reported content must not become an asserted event");
assert.equal(candidates.some(x=>x.id==="H1"),false,"hypotheses must not become asserted events");
assert.equal(candidates.some(x=>x.id==="O1"),false,"user opinions must not become asserted events");

const resolved=api.resolveFromHistory("Из-за этого обработка остановилась",messages,core,{topicId:"T1"});
assert.equal(resolved.status,"resolved");
assert.equal(resolved.antecedent.id,"E1");
assert.equal(resolved.antecedent.subject,"Система");
assert.equal(resolved.provenance.memoryEffect,"none");
assert.equal(resolved.provenance.usage,"advisory_only");

const competingMessages=[
 {id:"E1",threadId:"T1",role:"user",text:"Система получает сигнал."},
 {id:"E2",threadId:"T1",role:"user",text:"Модуль активирует процесс."}
];
const actualCompetingCandidates=api.extractCandidates(competingMessages,core,{topicId:"T1"});
assert.equal(actualCompetingCandidates.length,2,"both statements should be parsed by the real semantic core");
const competing=api.resolveMention("Из-за этого возник сбой",actualCompetingCandidates,{topicId:"T1"});
assert.equal(competing.status,"ambiguous","equally plausible real parser events must not be guessed");
assert.equal(competing.antecedent,null);

const otherTopic=api.resolveMention("Из-за этого всё остановилось",candidates,{topicId:"T2"});
assert.equal(otherTopic.status,"unresolved");
console.log("NEUROGENESIS discourse event reference real semantic-core integration tests passed.");
