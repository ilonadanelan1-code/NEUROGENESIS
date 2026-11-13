"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["semantic-core.js", "discourse-coreference.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const core = window.NGSemanticCore;
const discourse = window.NGDiscourseCoreference;
assert.ok(core && discourse, "semantic core and discourse coreference module must load");

assert.equal(discourse.detectMention("А что он сделал?").token, "он");
assert.equal(discourse.detectMention("Она не открыла дверь.").genders[0], "feminine");
assert.equal(discourse.detectMention("Они вернулись.").number, "plural");
assert.equal(discourse.detectMention("Модуль работает с ним.").grammaticalCase, "instrumental");
assert.equal(discourse.detectMention("Пользователь передал файл ей.").grammaticalCase, "dative_or_prepositional");
assert.equal(discourse.detectMention("Его книга сломалась."), null,
  "a possessive determiner must not be treated as a standalone antecedent reference");
assert.equal(discourse.detectMention("Я видел его вчера.").token, "его",
  "an object pronoun before an adverb must remain detectable");
assert.equal(discourse.detectMention("Его нашли вчера.").token, "его",
  "a common past-tense verb after an object pronoun must not be mistaken for a possessive noun");
assert.equal(discourse.detectMention("Их обнаружили утром.").token, "их",
  "plural object pronouns before finite verbs must remain detectable");
assert.equal(discourse.detectMention("Его новую книгу нашли вчера."), null,
  "a possessive pronoun followed by a noun phrase must remain outside anaphora resolution");
assert.equal(discourse.detectMention("О нём говорили позже.").grammaticalCase, "prepositional",
  "the common prepositional form нём must be recognized");
assert.equal(discourse.detectMention("Это произошло позже."), null,
  "event demonstratives are outside this person/entity pilot and must not be forced into an entity link");
assert.equal(discourse.inferFeatures("Саша").gender, "unknown",
  "gender-ambiguous names must not be hard-coded as masculine");
assert.equal(discourse.inferFeatures("Женя").gender, "unknown",
  "unisex diminutive names must remain gender-ambiguous without contextual evidence");

const candidate = (id,text,gender,number,syntacticRole,semanticRole,turnDistance=1,extra={}) => ({
  id,text,gender,number,syntacticRole,semanticRole,turnDistance,sentenceDistance:0,
  topicId:"T1",salience:syntacticRole==="subject"?0.9:0.55,...extra
});
const uniqueMale = discourse.resolveMention("Он ушёл.",[
  candidate("petr","Пётр","masculine","singular","subject","agent",1),
  candidate("anna","Анна","feminine","singular","subject","agent",1)
],{topicId:"T1"});
assert.equal(uniqueMale.status,"resolved");
assert.equal(uniqueMale.antecedent.text,"Пётр");
assert.equal(uniqueMale.provenance.memoryEffect,"none");

const negated = discourse.resolveMention("Он не вернулся.",[
  candidate("petr","Пётр","masculine","singular","subject","agent",3),
  candidate("anna","Анна","feminine","singular","subject","agent",1)
],{topicId:"T1"});
assert.equal(negated.status,"resolved");
assert.equal(negated.antecedent.id,"petr",
  "negation changes proposition polarity, not the identity constraints of a personal pronoun");

const causal = discourse.resolveMention("Поэтому он вызвал врача.",[
  candidate("near-object","Пётр","masculine","singular","object","theme",1),
  candidate("older-agent","Иван","masculine","singular","subject","agent",2)
],{topicId:"T1"});
assert.equal(causal.status,"resolved");
assert.equal(causal.antecedent.id,"older-agent",
  "causal connective must not make the nearest object an automatic antecedent");

const dativeRecipient = discourse.resolveMention("Ему передали ключ.",[
  candidate("ivan-agent","Иван","masculine","singular","subject","agent",1),
  candidate("petr-recipient","Пётр","masculine","singular","object","recipient",2)
],{topicId:"T1"});
assert.equal(dativeRecipient.status,"resolved");
assert.equal(dativeRecipient.antecedent.id,"petr-recipient",
  "dative morphology and semantic recipient role should outweigh raw recency");

const accusativeTheme = discourse.resolveMention("Я увидел его.",[
  candidate("ivan-agent","Иван","masculine","singular","subject","agent",1),
  candidate("petr-theme","Пётр","masculine","singular","object","theme",2)
],{topicId:"T1"});
assert.equal(accusativeTheme.status,"resolved");
assert.equal(accusativeTheme.antecedent.id,"petr-theme",
  "object-case reference should prefer a compatible theme over an unrelated recent agent");

const plural = discourse.resolveMention("Они активировались.",[
  candidate("single","Модуль","masculine","singular","subject","agent",1),
  candidate("plural","Нейроны","plural","plural","object","theme",3)
],{topicId:"T1"});
assert.equal(plural.status,"resolved");
assert.equal(plural.antecedent.id,"plural");

const distant = discourse.resolveMention("Она вернулась.",[
  candidate("near-male","Пётр","masculine","singular","subject","agent",1),
  candidate("far-female","Мария","feminine","singular","subject","agent",6)
],{topicId:"T1"});
assert.equal(distant.status,"resolved");
assert.equal(distant.antecedent.id,"far-female",
  "agreement must outweigh recency when the nearest candidate is incompatible");

const ambiguous = discourse.resolveMention("Она пришла.",[
  candidate("a","Анна","feminine","singular","subject","agent",2),
  candidate("b","Мария","feminine","singular","subject","agent",2)
],{topicId:"T1"});
assert.equal(ambiguous.status,"ambiguous");
assert.equal(ambiguous.antecedent,null);
assert.equal(ambiguous.reason,"competing_antecedents");

const unresolved = discourse.resolveMention("Он пришёл.",[
  candidate("anna","Анна","feminine","singular","subject","agent",1),
  candidate("network","Нейросеть","feminine","singular","object","theme",1)
],{topicId:"T1"});
assert.equal(unresolved.status,"unresolved");
assert.equal(unresolved.antecedent,null);

const topicGuard = discourse.resolveMention("Он ответил.",[
  candidate("other-topic","Пётр","masculine","singular","subject","agent",1,{topicId:"T2"})
],{topicId:"T1"});
assert.equal(topicGuard.status,"unresolved",
  "an entity from another topic must never be linked by this bounded resolver");

const missingTopicGuard = discourse.resolveMention("Он ответил.",[
  candidate("untagged","Пётр","masculine","singular","subject","agent",1,{topicId:""})
],{topicId:"T1"});
assert.equal(missingTopicGuard.status,"unresolved",
  "when an active topic is specified, candidates without an explicit matching topic ID must be rejected");

const mixedThreadHistory = [
  {id:"T1-old",threadId:"T1",role:"user",text:"Система получает сигнал."},
  ...Array.from({length:9},(_,index)=>({id:"T2-"+index,threadId:"T2",role:"user",text:"Анна обсуждает новую тему "+index+"."}))
];
const scopedHistory = discourse.resolveFromHistory("Он работает.",mixedThreadHistory,core,{topicId:"T1"});
assert.ok(scopedHistory.candidates.some(row=>row.text==="сигнал"),
  "messages from other threads must be filtered before the bounded eight-message window is applied");
assert.ok(scopedHistory.candidates.every(row=>row.id.startsWith("d0-")),
  "candidate extraction must never include a different thread when a topic ID is supplied");

const noTopicGuard = discourse.resolveMention("Он ответил.",[
  candidate("same-topic","Пётр","masculine","singular","subject","agent",4,{topicId:"T1"})
],{topicId:"T1"});
assert.equal(noTopicGuard.status,"resolved");

const messages = [
  {id:"M1",threadId:"T1",role:"user",text:"Система получает сигнал."},
  {id:"M2",threadId:"T1",role:"assistant",text:"Сигнал поступает в модуль."}
];
const extracted = discourse.extractCandidates(messages,core);
assert.ok(extracted.length>0,"candidate extraction should reuse the existing semantic proposition parser");
assert.ok(extracted.every(row=>row.topicId==="T1"));
assert.ok(extracted.some(row=>/система|сигнал|модуль/iu.test(row.text)));
const fromHistory = discourse.resolveFromHistory("А что он делает?",messages,core,{topicId:"T1"});
assert.equal(fromHistory.schema,"NG_DISCOURSE_COREFERENCE_V1");
assert.ok(["resolved","ambiguous","unresolved"].includes(fromHistory.status));
assert.equal(fromHistory.provenance.memoryEffect,"none",
  "derived discourse links must not write or promote long-term knowledge");

const noPronoun = discourse.resolveFromHistory("Сколько стоит модуль?",messages,core,{topicId:"T1"});
assert.equal(noPronoun.status,"not_applicable");

console.log("NEUROGENESIS discourse coreference unit tests passed.");
