"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const memorySource=fs.readFileSync("memory.js","utf8");
const window={};
const sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for(const file of ["semantic-core.js","discourse-coreference.js","discourse-event-reference.js","semantic-query.js"]){
 vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const planner=window.NGSemanticQuery;
assert.ok(planner,"semantic query planner must load");
const context={
 activeThread:{id:"T1",title:"Система и сигнал",contextSummary:"Система получает сигнал"},
 recentMessages:[
  {id:"M1",threadId:"T1",role:"user",text:"Система получает сигнал.",relation:"new_topic"},
  {id:"M2",threadId:"T1",role:"assistant",text:"Сигнал поступает в модуль.",relation:"assistant_reply"}
 ],
 focus:{threadId:"T1",referenceType:"pronoun",
  anchor:{text:"Система получает сигнал.",relation:"new_topic"},candidates:[],needsDisambiguation:false},
 resolution:{applied:true,context:{recentExchange:[
  {role:"user",text:"Система получает сигнал.",time:1,relation:"new_topic"}
 ]}}
};
window.NG_DISCOURSE_COREFERENCE_EXPERIMENT=false;
window.NG_DISCOURSE_EVENT_REFERENCE_EXPERIMENT=false;
const advisory=planner.local("А что он сделал?",context,null);
assert.equal(advisory.discourseResolution,null,
 "the cross-turn resolver must not run or add context when its experiment flag is disabled");
assert.equal(advisory.semanticFrame.discourseEntityResolution,undefined);
assert.equal(advisory.searchQueries.some(x=>/сигнал\s+А что он сделал/iu.test(x)),false,
 "the experimental resolver must not alter retrieval while its feature flag is disabled");
const disabledEventPlan=planner.local("Из-за этого обработка остановилась.",context,null);
assert.equal(disabledEventPlan.contextRelation,"new_topic",
 "event-reference language must not change topic classification while its opt-in flag is disabled");
assert.equal(disabledEventPlan.discourseEventResolution,null);

window.NG_DISCOURSE_COREFERENCE_EXPERIMENT=true;
window.NG_DISCOURSE_EVENT_REFERENCE_EXPERIMENT=true;
const enabled=planner.local("А что он сделал?",context,null);
assert.ok(enabled.discourseResolution,"the opt-in local semantic planner should expose the bounded cross-turn resolution");
assert.equal(enabled.discourseResolution.schema,"NG_DISCOURSE_COREFERENCE_V1");
assert.equal(enabled.discourseResolution.antecedent.text,"сигнал");
assert.ok(enabled.semanticFrame.discourseEntityResolution,
 "the resolution and its provenance should remain attached to the local semantic frame");
assert.equal(enabled.semanticFrame.discourseEntityResolution.provenance.memoryEffect,"none");
assert.equal(enabled.discourseResolution.status,"resolved");

const eventEnabled=planner.local("Из-за этого обработка остановилась.",context,null);
assert.equal(eventEnabled.contextRelation,"follow_up",
 "event-reference cues must be treated as a continuation of the active topic");
assert.equal(eventEnabled.discourseEventResolution.status,"resolved");
assert.equal(eventEnabled.discourseEventResolution.antecedent.id,"M1");
assert.equal(eventEnabled.discourseEventResolution.provenance.memoryEffect,"none");
assert.equal(eventEnabled.discourseEventResolution.provenance.usage,"advisory_only");
assert.ok(eventEnabled.semanticFrame.discourseEventResolution,
 "event candidate and provenance should be attached to the local semantic frame");
assert.notEqual(eventEnabled.semanticFrame.proposition.subject,"Система",
 "an event candidate must not rewrite the current proposition subject");

const eventAmbiguousHistory=[
 {id:"E1",threadId:"T1",role:"user",text:"Система получает сигнал."},
 {id:"E2",threadId:"T1",role:"user",text:"Модуль активирует процесс."}
];
const eventAmbiguous=planner.local("Из-за этого возник сбой.",{
 ...context,recentMessages:eventAmbiguousHistory,threadHistory:eventAmbiguousHistory
},null);
assert.equal(eventAmbiguous.discourseEventResolution.status,"ambiguous");
assert.equal(eventAmbiguous.discourseEventResolution.antecedent,null,
 "two plausible event antecedents must not be silently selected");

const distantEventHistory=[{id:"OLD",threadId:"T1",role:"user",text:"Система получает сигнал."},
 ...Array.from({length:23},(_,index)=>({id:"A"+index,threadId:"T1",role:"assistant",text:"Ответ без нового пользовательского события."}))];
const distantEvent=planner.local("Из-за этого всё остановилось.",{
 ...context,recentMessages:distantEventHistory,threadHistory:distantEventHistory
},null);
assert.equal(distantEvent.discourseEventResolution.status,"resolved",
 "the resolver should see the bounded 24-message active-thread history");
assert.equal(distantEvent.discourseEventResolution.antecedent.id,"OLD");
assert.equal(distantEvent.discourseEventResolution.antecedent.turnDistance,24);

const expiredEventHistory=[{id:"TOO_OLD",threadId:"T1",role:"user",text:"Система получает сигнал."},
 ...Array.from({length:24},(_,index)=>({id:"B"+index,threadId:"T1",role:"assistant",text:"Ответ без нового пользовательского события."}))];
const expiredEvent=planner.local("Из-за этого всё остановилось.",{
 ...context,recentMessages:expiredEventHistory,threadHistory:expiredEventHistory
},null);
assert.equal(expiredEvent.discourseEventResolution.status,"unresolved",
 "events outside the 24-message active-thread window must not leak into resolution");

const resumedThreadContext={
 ...context,
 recentMessages:[{threadId:"T2",role:"user",text:"Новая тема не должна перехватить старую."}],
 threadHistory:context.recentMessages
};
const resumedThreadPlan=planner.local("Он снова ответил.",resumedThreadContext,null);
assert.equal(resumedThreadPlan.contextRelation,"follow_up");
assert.equal(resumedThreadPlan.discourseResolution.status,"resolved");
assert.equal(resumedThreadPlan.discourseResolution.antecedent.text,"сигнал",
 "the resolver must use active-thread history even when globally recent messages belong to another topic");
const resumedRequest=planner.buildRequest("Он снова ответил.",resumedThreadContext,[]);
const requestPayload=JSON.parse(resumedRequest.messages[1].content.slice(resumedRequest.messages[1].content.indexOf("\n")+1));
assert.ok(requestPayload.recentTurns.some(row=>row.text==="Система получает сигнал."),
 "the LLM request must include the active thread history, not lose it behind globally recent messages");
assert.ok(requestPayload.recentTurns.every(row=>row.text.includes("Система")||row.text.includes("Сигнал")),
 "the request must not mix turns from a different topic into the active thread history");

assert.match(memorySource,/DIALOG_CONTEXT\.history\(dialogContext,\s*report\.activeThread\.id,\s*24\)/,
 "the production context builder must provide bounded per-thread history, not only the globally recent eight messages");
assert.equal(enabled.searchQueries.some(x=>/сигнал\s+А что он сделал/iu.test(x)),false,
 "a local antecedent hypothesis must not change fallback retrieval before the model plan confirms follow-up");
assert.notEqual(enabled.semanticFrame.subject&&enabled.semanticFrame.subject.text,"сигнал",
 "the local plan must expose the candidate without rewriting its own semantic frame");
assert.notEqual(enabled.semanticFrame.proposition.subject,"сигнал",
 "the local plan must not turn a candidate into a proposition fact");
assert.equal(enabled.semanticFrame.proposition.crossTurnReference,undefined,
 "the applied cross-turn reference belongs only on a confirmed merged plan");

const instrumentalFollowUp=planner.local("С ним опять проблема.",context,null);
assert.equal(instrumentalFollowUp.contextRelation,"follow_up",
 "instrumental pronouns detected by the discourse resolver must keep the active topic instead of being classified as a new explicit topic");
assert.ok(instrumentalFollowUp.discourseResolution,
 "prepositional personal pronouns must reach the opt-in cross-turn resolver");
assert.equal(instrumentalFollowUp.discourseResolution.mention.token,"ним");
assert.equal(instrumentalFollowUp.discourseResolution.mention.grammaticalCase,"instrumental");

const prepositionalFollowUp=planner.local("О нём говорили вчера.",context,null);
assert.equal(prepositionalFollowUp.contextRelation,"follow_up");
assert.ok(prepositionalFollowUp.discourseResolution);
assert.equal(prepositionalFollowUp.discourseResolution.mention.token,"нём");
assert.equal(prepositionalFollowUp.discourseResolution.mention.grammaticalCase,"prepositional");

const dativeFollowUp=planner.local("Ему снова передали файл.",context,null);
assert.equal(dativeFollowUp.contextRelation,"follow_up",
 "dative personal pronouns must be recognized as references even without a question mark");
assert.ok(dativeFollowUp.discourseResolution);
assert.equal(dativeFollowUp.discourseResolution.mention.token,"ему");

const modelPlan={
 source:"model",contextRelation:"follow_up",canonicalQuestion:"А что он сделал?",
 searchQueries:["А что он сделал?"],
 semanticFrame:{
  schema:"NG_SEMANTIC_FRAME_V1",
  subject:{text:"он",certainty:"model_candidate"},
  proposition:{subject:"он",predicate:"сделал",object:null},
  entities:[{text:"он",role:"subject"}],
  discourse:{relation:"follow_up"}
 }
};
const eventModelPlan={
 source:"model",contextRelation:"follow_up",canonicalQuestion:eventEnabled.canonicalQuestion,
 searchQueries:["Из-за этого обработка остановилась."],
 semanticFrame:{schema:"NG_SEMANTIC_FRAME_V1",
  subject:{text:"обработка",certainty:"model_candidate"},
  proposition:{subject:"обработка",predicate:"остановилась",object:null}}
};
const mergedEventModelPlan=planner.mergeLocalDiscourseResolution(eventModelPlan,eventEnabled);
assert.equal(mergedEventModelPlan.semanticFrame.subject.text,"обработка",
 "event-reference advisory must not overwrite the model-backed subject");
assert.equal(mergedEventModelPlan.semanticFrame.proposition.subject,"обработка");
assert.equal(mergedEventModelPlan.discourseEventResolution.status,"resolved");
assert.deepEqual(Array.from(mergedEventModelPlan.searchQueries),eventModelPlan.searchQueries,
 "event-reference provenance must not inject retrieval hints before independent model confirmation");
const unchangedModelPlan=planner.mergeLocalDiscourseResolution(modelPlan,advisory);
assert.equal(unchangedModelPlan.semanticFrame.subject.text,"он",
 "when the experiment flag is disabled, the model-backed semantic plan must remain unchanged");
assert.equal(unchangedModelPlan.discourseResolution,undefined);
const mergedModelPlan=planner.mergeLocalDiscourseResolution(modelPlan,enabled);
assert.equal(mergedModelPlan.semanticFrame.subject.text,"сигнал",
 "a resolved local cross-turn candidate must be merged into the model-backed plan when both planners agree it is a follow-up");
assert.equal(mergedModelPlan.semanticFrame.proposition.subject,"сигнал");
assert.equal(mergedModelPlan.semanticFrame.proposition.crossTurnReference.status,"resolved");
assert.ok(mergedModelPlan.searchQueries.some(x=>/сигнал\s+А что он сделал/iu.test(x)),
 "the model-backed retrieval plan must retain the local antecedent hint");
const conflictingModelPlan=planner.mergeLocalDiscourseResolution(
 {...modelPlan,contextRelation:"new_topic"},enabled);
assert.equal(conflictingModelPlan.semanticFrame.subject.text,"он",
 "the local resolver must not override a model plan that classifies the message as a new topic");
assert.equal(conflictingModelPlan.discourseResolution.status,"resolved",
 "the local candidate may remain visible as provenance without being applied");

assert.match(memorySource,/mergeLocalDiscourseResolution\(interpreted,\s*localPlan\)/,
 "the production LLM interpretation path must explicitly merge opt-in local discourse provenance");

console.log("NEUROGENESIS discourse coreference semantic-query integration tests passed.");
