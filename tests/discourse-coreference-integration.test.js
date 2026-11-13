"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const memorySource=fs.readFileSync("memory.js","utf8");
const window={};
const sandbox={window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for(const file of ["semantic-core.js","discourse-coreference.js","semantic-query.js"]){
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
const advisory=planner.local("А что он сделал?",context,null);
assert.equal(advisory.discourseResolution,null,
 "the cross-turn resolver must not run or add context when its experiment flag is disabled");
assert.equal(advisory.semanticFrame.discourseEntityResolution,undefined);
assert.equal(advisory.searchQueries.some(x=>/сигнал\s+А что он сделал/iu.test(x)),false,
 "the experimental resolver must not alter retrieval while its feature flag is disabled");

window.NG_DISCOURSE_COREFERENCE_EXPERIMENT=true;
const enabled=planner.local("А что он сделал?",context,null);
assert.ok(enabled.discourseResolution,"the opt-in local semantic planner should expose the bounded cross-turn resolution");
assert.equal(enabled.discourseResolution.schema,"NG_DISCOURSE_COREFERENCE_V1");
assert.equal(enabled.discourseResolution.antecedent.text,"сигнал");
assert.ok(enabled.semanticFrame.discourseEntityResolution,
 "the resolution and its provenance should remain attached to the local semantic frame");
assert.equal(enabled.semanticFrame.discourseEntityResolution.provenance.memoryEffect,"none");
assert.equal(enabled.discourseResolution.status,"resolved");

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
