"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
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
assert.ok(advisory.discourseResolution,"local semantic planning should expose the bounded cross-turn resolution");
assert.equal(advisory.discourseResolution.schema,"NG_DISCOURSE_COREFERENCE_V1");
assert.equal(advisory.discourseResolution.antecedent.text,"сигнал");
assert.ok(advisory.semanticFrame.discourseEntityResolution,
 "the resolution and its provenance should remain attached to the local semantic frame");
assert.equal(advisory.semanticFrame.discourseEntityResolution.provenance.memoryEffect,"none");
assert.equal(advisory.searchQueries.some(x=>/сигнал\s+А что он сделал/iu.test(x)),false,
 "the experimental resolver must not alter retrieval while its feature flag is disabled");

window.NG_DISCOURSE_COREFERENCE_EXPERIMENT=true;
const enabled=planner.local("А что он сделал?",context,null);
assert.equal(enabled.discourseResolution.status,"resolved");
assert.ok(enabled.searchQueries.some(x=>/сигнал\s+А что он сделал/iu.test(x)),
 "an explicitly enabled high-confidence link may add a retrieval hint");
assert.equal(enabled.semanticFrame.subject.text,"сигнал",
 "the opt-in path may use the resolved antecedent as a context candidate");
assert.equal(enabled.semanticFrame.subject.certainty,"context_candidate");

console.log("NEUROGENESIS discourse coreference semantic-query integration tests passed.");
