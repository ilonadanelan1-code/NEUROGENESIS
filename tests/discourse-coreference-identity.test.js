"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for (const file of ["semantic-core.js","discourse-coreference.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const core = window.NGSemanticCore;
const discourse = window.NGDiscourseCoreference;
assert.ok(core && typeof core.grammaticalFeatures === "function",
  "the existing semantic morphology API must be available to the discourse resolver");
assert.ok(discourse,"the discourse resolver must load");

const systemOblique = core.grammaticalFeatures("систему","object",null);
const serverOblique = core.grammaticalFeatures("серверу","object",null);
const ambiguousSystem = core.grammaticalFeatures("системы","subject",null);
assert.equal(systemOblique.canonicalText,"система");
assert.equal(serverOblique.canonicalText,"сервер");
assert.equal(ambiguousSystem.gender,"unknown",
  "системы can represent singular genitive or plural nominative; the core must not force a gender");
assert.equal(ambiguousSystem.number,"unknown",
  "ambiguous singular/plural morphology must not produce a canonical identity key");

const parser = new Map();
const testCore = {
  grammaticalFeatures: core.grammaticalFeatures,
  analyse(text) {
    const proposition = parser.get(text);
    return proposition ? {proposition:{...proposition,arguments:proposition.arguments||[]}} : {proposition:null};
  }
};
function message(id,threadId,text,proposition) {
  parser.set(text,proposition);
  return {id,threadId,role:"user",text};
}
function result(messages) {
  return discourse.extractCandidates(messages,testCore);
}
const cases = [
  {id:"system-case",same:true,messages:[
    message("s1","T1","m1",{subject:"Система",object:null}),
    message("s2","T1","m2",{subject:null,object:"систему"})
  ]},
  {id:"server-case",same:true,messages:[
    message("v1","T1","m3",{subject:"Сервер",object:null}),
    message("v2","T1","m4",{subject:null,object:"серверу"})
  ]},
  {id:"process-case",same:true,messages:[
    message("p1","T1","m5",{subject:"Процесс",object:null}),
    message("p2","T1","m6",{subject:null,object:"процессом"})
  ]},
  {id:"module-case",same:true,messages:[
    message("m1","T1","m7",{subject:"Модуль",object:null}),
    message("m2","T1","m8",{subject:null,object:"модулю"})
  ]},
  {id:"network-case",same:true,messages:[
    message("n1","T1","m9",{subject:"Сеть",object:null}),
    message("n2","T1","m10",{subject:null,object:"сетью"})
  ]},
  {id:"signal-case",same:true,messages:[
    message("g1","T1","m11",{subject:"Сигнал",object:null}),
    message("g2","T1","m12",{subject:null,object:"сигналом"})
  ]},
  {id:"cooccurring-distinct-forms",same:false,messages:[
    message("c1","T1","m13",{subject:"Система",object:"систему"})
  ]},
  {id:"ambiguous-singular-plural",same:false,messages:[
    message("a1","T1","m14",{subject:"Система",object:null}),
    message("a2","T1","m15",{subject:"системы",object:null})
  ]},
  {id:"unsupported-lemma",same:false,messages:[
    message("u1","T1","m16",{subject:"Карта",object:null}),
    message("u2","T1","m17",{subject:null,object:"карту"})
  ]},
  {id:"different-masculine-lemmas",same:false,messages:[
    message("d1","T1","m18",{subject:"Сервер",object:null}),
    message("d2","T1","m19",{subject:"Модуль",object:null})
  ]},
  {id:"singular-plural",same:false,messages:[
    message("q1","T1","m20",{subject:"Сервер",object:null}),
    message("q2","T1","m21",{subject:"серверы",object:null})
  ]},
  {id:"topic-boundary",same:false,messages:[
    message("t1","T1","m22",{subject:"Система",object:null}),
    message("t2","T2","m23",{subject:null,object:"систему"})
  ]}
];

function baselineSame(messages) {
  const surfaces = new Set();
  for (const row of messages) {
    const proposition = parser.get(row.text);
    for (const value of [proposition && proposition.subject,proposition && proposition.object]) {
      if (value) surfaces.add(core.normalise(value));
    }
  }
  return surfaces.size === 1;
}
let baselineCorrect = 0, experimentCorrect = 0;
let trueMorphMerges = 0, falseMorphMerges = 0, guardedDistinct = 0;
for (const item of cases) {
  const expectedSame = item.same;
  const baseline = baselineSame(item.messages);
  const candidates = result(item.messages);
  const predictedSame = candidates.length === 1;
  if (baseline === expectedSame) baselineCorrect++;
  if (predictedSame === expectedSame) experimentCorrect++;
  const morphological = candidates.filter(row => row.identityBasis === "morphological_lemma");
  if (expectedSame && predictedSame && morphological.length === 1) trueMorphMerges++;
  if (!expectedSame && predictedSame) falseMorphMerges++;
  if (!expectedSame && candidates.length > 1) guardedDistinct++;
  assert.equal(predictedSame,expectedSame,
    "identity diagnostic mismatch in case " + item.id + "; candidates=" + JSON.stringify(candidates));
}
assert.equal(trueMorphMerges,6,"all six supported inflection pairs should cluster through the existing parser morphology");
assert.equal(falseMorphMerges,0,"ambiguous, unsupported, co-occurring, plural-mismatched and cross-topic entities must not merge");
assert.equal(guardedDistinct,6,"all six negative/collision cases must preserve distinct candidates");

console.log("NEUROGENESIS discourse identity diagnostic passed.");
console.log(JSON.stringify({
  scope:"12 hand-authored diagnostic pairs; not a representative corpus",
  baseline:{correct:baselineCorrect,total:cases.length,exactAccuracy:baselineCorrect/cases.length},
  experiment:{correct:experimentCorrect,total:cases.length,exactAccuracy:experimentCorrect/cases.length},
  trueMorphMerges:{correct:trueMorphMerges,total:6},
  falseMorphMerges:{count:falseMorphMerges,totalNegativeCases:6},
  distinctGuards:{correct:guardedDistinct,total:6}
},null,2));
