"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const window={};
const sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for(const file of ["semantic-core.js","discourse-coreference.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const core=window.NGSemanticCore;
const discourse=window.NGDiscourseCoreference;
assert.ok(core&&discourse,"semantic and discourse cores must load");

const group=core.grammaticalFeatures("Иван и Пётр","subject");
assert.equal(group.gender,"plural","explicitly conjoined entities must form a plural group");
assert.equal(group.number,"plural");
const mixed=core.grammaticalFeatures("Система и сервер","subject");
assert.equal(mixed.gender,"plural","coordination must not inherit the gender of the first member");
assert.equal(mixed.number,"plural");
assert.equal(mixed.canonicalText,"система и сервер",
  "known coordinated members must expose a stable canonical group identity");
const oblique=core.grammaticalFeatures("систему и серверу","object");
assert.equal(oblique.gender,"plural");
assert.equal(oblique.number,"plural");
assert.equal(oblique.canonicalText,"система и сервер",
  "each inflected member must canonicalize before the group identity is built");
assert.notEqual(core.grammaticalFeatures("Иван или Пётр","subject").number,"plural",
  "disjunction is not a plural co-reference group");
assert.notEqual(core.grammaticalFeatures("вчера и сегодня","subject").number,"plural",
  "two arbitrary words must not be promoted to an entity group");

const parsed=new Map();
const testCore={
  grammaticalFeatures:core.grammaticalFeatures,
  analyse(text) {
    const proposition=parsed.get(text);
    return proposition?{proposition:{...proposition,arguments:proposition.arguments||[]}}:{proposition:null};
  }
};
function message(id,text,proposition) {
  parsed.set(text,proposition);
  return {id,threadId:"T1",role:"user",text};
}
const history=[
  message("G1","GROUP_SUBJECT",{subject:"Система и сервер",object:null}),
  message("G2","GROUP_OBJECT",{subject:null,object:"систему и серверу"})
];
const candidates=discourse.extractCandidates(history,testCore);
assert.equal(candidates.length,1,"matching inflected members should create one guarded group candidate");
assert.equal(candidates[0].gender,"plural");
assert.equal(candidates[0].number,"plural");
assert.equal(candidates[0].identityBasis,"morphological_lemma");
assert.equal([...candidates[0].surfaceForms].sort().join("|"),
  ["Система и сервер","систему и серверу"].sort().join("|"));
const resolved=discourse.resolveMention("Они снова заработали.",candidates,{topicId:"T1"});
assert.equal(resolved.status,"resolved","они should link to the explicit coordinated group");
assert.equal(resolved.antecedent.number,"plural");
assert.equal(resolved.antecedent.text,"система и сервер");

const nameGroupRows=discourse.extractCandidates([
  message("G6","AMBIGUOUS_NAME_GROUP",{subject:"Саша и Женя",object:null})
],testCore);
assert.equal(nameGroupRows.length,1);
assert.equal(nameGroupRows[0].gender,"plural",
  "single-name gender ambiguity must not erase a verified plural group feature");
assert.equal(nameGroupRows[0].number,"plural");
assert.equal(discourse.resolveMention("Они ушли.",nameGroupRows,{topicId:"T1"}).status,"resolved",
  "a group containing gender-ambiguous names can still be plural without guessing either person's gender");

const ambiguous=discourse.resolveMention("Они вернулись.",[
  {id:"group-a",text:"Система и сервер",gender:"plural",number:"plural",featureSource:"semantic_core",
    syntacticRole:"subject",semanticRole:"agent",turnDistance:1,topicId:"T1"},
  {id:"group-b",text:"Система и модуль",gender:"plural",number:"plural",featureSource:"semantic_core",
    syntacticRole:"subject",semanticRole:"agent",turnDistance:1,topicId:"T1"}
],{topicId:"T1"});
assert.equal(ambiguous.status,"ambiguous",
  "two equally plausible plural groups must remain unresolved instead of selecting one");
assert.equal(ambiguous.antecedent,null);

const collision=discourse.extractCandidates([
  message("G3","GROUP_COLLISION",{subject:"Система и сервер",object:"систему и серверу"})
],testCore);
assert.equal(collision.length,2,
  "two inflected group forms in the same proposition must not be merged automatically");

const differentGroups=discourse.extractCandidates([
  message("G4","GROUP_A",{subject:"Система и сервер",object:null}),
  message("G5","GROUP_B",{subject:"Система и модуль",object:null})
],testCore);
assert.equal(differentGroups.length,2,
  "groups with different member sets must remain separate");

console.log("NEUROGENESIS coordinated entity-group tests passed.");
