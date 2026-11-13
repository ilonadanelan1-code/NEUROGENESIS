import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const BASELINE_SHA = "92eddaab0d914721e7732aae6f8345643216818c";
const baselineSource = execFileSync("git", ["show", BASELINE_SHA + ":semantic-core.js"], {
  encoding: "utf8", maxBuffer: 8 * 1024 * 1024
});
const currentSource = readFileSync(new URL("../semantic-core.js", import.meta.url), "utf8");
function loadCore(source) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 5000 });
  assert.equal(typeof sandbox.window.NGSemanticCore?.analyse, "function");
  return sandbox.window.NGSemanticCore;
}
const baseline = loadCore(baselineSource), current = loadCore(currentSource);
const normalize = value => String(value ?? "").normalize("NFKC").toLowerCase()
  .replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();

const cases = [
  {id:"active_canonical",text:"Анна открыла дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"открыла",object:"дверь",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["patient","дверь","accusative"]],embedded:[]}},
  {id:"active_object_first",text:"Дверь открыла Анна.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"открыла",object:"Дверь",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["patient","Дверь","accusative"]],embedded:[]}},
  {id:"active_negated",text:"Анна не открыла дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"открыла",object:"дверь",polarity:"negative",
    arguments:[["agent","Анна","nominative"],["patient","дверь","accusative"]],embedded:[]}},
  {id:"passive_agent",text:"Дверь была открыта Анной.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Дверь",predicate:"открыта",object:"Анной",polarity:"positive",
    arguments:[["patient","Дверь","nominative"],["agent","Анной","instrumental"]],embedded:[]}},
  {id:"request_control",text:"Анна попросила Бориса открыть дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"попросила",object:"Бориса",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["addressee","Бориса","accusative"]],
    embedded:[{relation:"request_content",subject:"Бориса",predicate:"открыть",object:"дверь",
     arguments:[["agent","Бориса","accusative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"causative_control",text:"Анна заставила Бориса открыть дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"заставила",object:"Бориса",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["causee","Бориса","accusative"]],
    embedded:[{relation:"causative_content",subject:"Бориса",predicate:"открыть",object:"дверь",
     arguments:[["agent","Бориса","accusative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"permission_control",text:"Анна разрешила Борису открыть дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"разрешила",object:"Борису",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["addressee","Борису","dative"]],
    embedded:[{relation:"permission_content",subject:"Борису",predicate:"открыть",object:"дверь",
     arguments:[["agent","Борису","dative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"command_control",text:"Анна приказала Борису открыть дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"приказала",object:"Борису",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["addressee","Борису","dative"]],
    embedded:[{relation:"command_content",subject:"Борису",predicate:"открыть",object:"дверь",
     arguments:[["agent","Борису","dative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"request_negated",text:"Анна не попросила Бориса открыть дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"попросила",object:"Бориса",polarity:"negative",
    arguments:[["agent","Анна","nominative"],["addressee","Бориса","accusative"]],
    embedded:[{relation:"request_content",subject:"Бориса",predicate:"открыть",object:"дверь",
     arguments:[["agent","Бориса","accusative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"request_embedded_negated",text:"Анна попросила Бориса не открывать дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"попросила",object:"Бориса",polarity:"positive",
    arguments:[["agent","Анна","nominative"],["addressee","Бориса","accusative"]],
    embedded:[{relation:"request_content",subject:"Бориса",predicate:"открывать",object:"дверь",
     polarity:"negative",
     arguments:[["agent","Бориса","accusative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"request_both_scopes_negated",text:"Анна не попросила Бориса не открывать дверь.",group:"known_matrix",
   expected:{kind:"assertion",subject:"Анна",predicate:"попросила",object:"Бориса",polarity:"negative",
    arguments:[["agent","Анна","nominative"],["addressee","Бориса","accusative"]],
    embedded:[{relation:"request_content",subject:"Бориса",predicate:"открывать",object:"дверь",
     polarity:"negative",
     arguments:[["agent","Бориса","accusative"],["patient","дверь","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"held_out_explain",text:"Ольга попросила Игоря объяснить задачу.",group:"held_out_infinitive",
   expected:{kind:"assertion",subject:"Ольга",predicate:"попросила",object:"Игоря",polarity:"positive",
    arguments:[["agent","Ольга","nominative"],["addressee","Игоря","accusative"]],
    embedded:[{relation:"request_content",subject:"Игоря",predicate:"объяснить",object:"задачу",
     arguments:[["agent","Игоря","accusative"],["patient","задачу","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"held_out_enable",text:"Робот приказал оператору включить систему.",group:"held_out_infinitive",
   expected:{kind:"assertion",subject:"Робот",predicate:"приказал",object:"оператору",polarity:"positive",
    arguments:[["agent","Робот","nominative"],["addressee","оператору","dative"]],
    embedded:[{relation:"command_content",subject:"оператору",predicate:"включить",object:"систему",
     arguments:[["agent","оператору","dative"],["patient","систему","accusative"]],
     assertionStatus:"not_independently_asserted"}]}},
  {id:"unsupported_matrix_abstention",text:"Анна убедила Бориса открыть дверь.",group:"abstention",
   expected:{kind:"fragment",subject:null,predicate:null,object:null,polarity:"positive",arguments:[],embedded:[]}},
  {id:"unsupported_coordinated_controller",text:"Анна попросила Бориса и Ольгу открыть дверь.",group:"abstention",
   expected:{kind:"fragment",subject:null,predicate:null,object:null,polarity:"positive",arguments:[],embedded:[]}},
  {id:"unsupported_intervening_adverb",text:"Анна попросила Бориса быстро открыть дверь.",group:"abstention",
   expected:{kind:"fragment",subject:null,predicate:null,object:null,polarity:"positive",arguments:[],embedded:[]}}
];

function canonical(p) {
  const value=p&&typeof p==="object"?p:{};
  const args=Array.isArray(value.arguments)?Array.from(value.arguments,r=>[r.role,normalize(r.text),r.grammaticalCase]):[];
  const embedded=Array.isArray(value.embeddedPropositions)?Array.from(value.embeddedPropositions,r=>({
    relation:r.relation,subject:normalize(r.subject),predicate:normalize(r.predicate),object:normalize(r.object),
    polarity:r.polarity||"positive",
    arguments:Array.isArray(r.arguments)?Array.from(r.arguments,a=>[a.role,normalize(a.text),a.grammaticalCase]):[],
    assertionStatus:r.assertionStatus
  })):[];
  return {kind:value.kind||"fragment",subject:value.subject==null?null:normalize(value.subject),
    predicate:value.predicate==null?null:normalize(value.predicate),object:value.object==null?null:normalize(value.object),
    polarity:value.polarity||"unknown",arguments:args,embedded};
}
function expectedCanonical(e) {
  return {kind:e.kind,subject:e.subject==null?null:normalize(e.subject),
    predicate:e.predicate==null?null:normalize(e.predicate),object:e.object==null?null:normalize(e.object),
    polarity:e.polarity,arguments:e.arguments.map(r=>[r[0],normalize(r[1]),r[2]]),
    embedded:e.embedded.map(r=>({relation:r.relation,subject:normalize(r.subject),predicate:normalize(r.predicate),
      object:normalize(r.object),polarity:r.polarity||"positive",
      arguments:r.arguments.map(a=>[a[0],normalize(a[1]),a[2]]),
      assertionStatus:r.assertionStatus}))};
}
function evaluate(core, selected) {
  let exact=0,covered=0,tp=0,fp=0,fn=0,goldCount=0;
  for(const item of selected) {
    const predicted=canonical(core.analyse(item.text,{contextRelation:"new_topic"},null).proposition);
    const expected=expectedCanonical(item.expected);
    if(JSON.stringify(predicted)===JSON.stringify(expected))exact++;
    if(item.group!=="abstention"&&predicted.arguments.length)covered++;
    const flatten=s=>{
      const rows=s.arguments.map(r=>["main",r[0],r[1]]);
      for(const e of s.embedded)for(const r of e.arguments)rows.push([e.relation,r[0],r[1]]);
      return new Set(rows.map(r=>r.join("|")));
    };
    const gold=flatten(expected),guessed=flatten(predicted);
    goldCount+=gold.size;
    for(const role of guessed){if(gold.has(role))tp++;else fp++;}
    for(const role of gold)if(!guessed.has(role))fn++;
  }
  const precision=tp+fp?tp/(tp+fp):0,recall=goldCount?tp/goldCount:0;
  const f1=precision+recall?2*precision*recall/(precision+recall):0;
  const total=selected.filter(x=>x.group!=="abstention").length;
  return {cases:selected.length,exactStructure:{correct:exact,total:selected.length,accuracy:exact/selected.length},
    frameCoverage:{covered,total,coverage:total?covered/total:null},
    roles:{truePositive:tp,falsePositive:fp,falseNegative:fn,gold:goldCount,precision,recall,microF1:f1}};
}
const baselineMetrics=evaluate(baseline,cases),experimentMetrics=evaluate(current,cases);
const ordinaryFrame=current.analyse("Анна открыла дверь.",{contextRelation:"new_topic"},null).proposition;
assert.equal(Object.hasOwn(ordinaryFrame,"embeddedPropositions"),false,
  "ordinary propositions must preserve their pre-pilot output shape");
const knownMatrix=evaluate(current,cases.filter(x=>x.group==="known_matrix"));
const heldOut=evaluate(current,cases.filter(x=>x.group==="held_out_infinitive"));
const abstention=cases.find(x=>x.group==="abstention");
const abstentionPrediction=canonical(current.analyse(abstention.text,{contextRelation:"new_topic"},null).proposition);

assert.equal(experimentMetrics.exactStructure.correct,cases.length,"all diagnostic frames must match exactly");
assert.equal(experimentMetrics.roles.truePositive,experimentMetrics.roles.gold);
assert.equal(experimentMetrics.roles.falsePositive,0);
assert.equal(experimentMetrics.roles.falseNegative,0);
assert.equal(experimentMetrics.frameCoverage.covered,experimentMetrics.frameCoverage.total);
assert.equal(heldOut.exactStructure.correct,2,"held-out infinitive forms must compose with the controller pattern");
assert.deepEqual(abstentionPrediction.arguments,[],"unsupported matrix predicates must not receive invented roles");
assert.deepEqual(abstentionPrediction.embedded,[],"unsupported matrix predicates must not receive an invented embedded event");
for(const item of cases.filter(x=>x.group==="abstention")) {
  const prediction=canonical(current.analyse(item.text,{contextRelation:"new_topic"},null).proposition);
  assert.equal(prediction.kind,"fragment","unsupported constructions must remain unresolved");
  assert.deepEqual(prediction.arguments,[],"unsupported constructions must not receive invented roles");
  assert.deepEqual(prediction.embedded,[],"unsupported constructions must not receive invented events");
}
const embeddedNegated=current.analyse("Анна попросила Бориса не открывать дверь.",{contextRelation:"new_topic"},null).proposition;
assert.equal(embeddedNegated.polarity,"positive","embedded negation must not negate the matrix request");
assert.equal(embeddedNegated.embeddedPropositions[0].polarity,"negative","embedded action negation must be preserved");
const bothNegated=current.analyse("Анна не попросила Бориса не открывать дверь.",{contextRelation:"new_topic"},null).proposition;
assert.equal(bothNegated.polarity,"negative");
assert.equal(bothNegated.embeddedPropositions[0].polarity,"negative");

const forged=current.validateProposition({
  subject:"Анна",predicate:"попросила",object:"Бориса",
  embeddedPropositions:[{schema:"NG_EMBEDDED_PROPOSITION_V1",relation:"request_content",
    subject:"Подмена",predicate:"уничтожить",object:"данные",controllerRole:"addressee",
    controllerCase:"accusative",confidence:1}]
},{kind:"assertion",subject:"Анна",predicate:"попросила",object:"Бориса"});
assert.equal(forged.embeddedPropositions.length,0,"model-supplied nested events must not bypass local extraction");
const forgedFallback=current.validateProposition({},{
  kind:"assertion",subject:"Анна",predicate:"попросила",object:"Бориса",
  embeddedPropositions:[{schema:"NG_EMBEDDED_PROPOSITION_V1",relation:"request_content",
    subject:"Подмена",predicate:"уничтожить",object:"данные",controllerRole:"addressee",
    controllerCase:"accusative",confidence:1}]
});
assert.equal(forgedFallback.embeddedPropositions.length,0,
  "a fallback frame cannot attach an embedded event to a different controller");

console.log("NEUROGENESIS semantic-role pilot: "+JSON.stringify({
  protocol:{baselineCommit:BASELINE_SHA,cases:cases.length,
    positiveCases:cases.filter(x=>x.group!=="abstention").length,
    heldOutInfinitiveCases:cases.filter(x=>x.group==="held_out_infinitive").length,
    expectedRoleSlots:experimentMetrics.roles.gold,
    dataType:"manually curated diagnostic set; not a corpus benchmark",goldSyntaxAvailable:false},
  baseline:baselineMetrics,experiment:experimentMetrics,knownMatrix,heldOutInfinitive:heldOut,
  unsupportedPredicateAbstention:{sentence:abstention.text,remainsFragment:abstentionPrediction.kind==="fragment",
    noRolesInvented:abstentionPrediction.arguments.length===0,
    noEmbeddedEventInvented:abstentionPrediction.embedded.length===0},
  unsupportedStructureAbstentions:cases.filter(x=>x.group==="abstention").map(item=>item.text),
  embeddedNegation:{matrixPolarity:embeddedNegated.polarity,embeddedPolarity:embeddedNegated.embeddedPropositions[0].polarity,
    bothScopes:{matrix:bothNegated.polarity,embedded:bothNegated.embeddedPropositions[0].polarity}}
}));
