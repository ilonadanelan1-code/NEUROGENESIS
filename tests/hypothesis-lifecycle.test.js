"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const window={};
vm.runInNewContext(fs.readFileSync("knowledge.js","utf8"),{window},{filename:"knowledge.js"});
vm.runInNewContext(fs.readFileSync("hypothesis-lifecycle.js","utf8"),{window},{filename:"hypothesis-lifecycle.js"});
const knowledge=window.NGKnowledge;
const engine=window.NGHypothesisLifecycle.create(knowledge);
const causal=(id,subject,object)=>({id,kind:"causal",subject,object,polarity:true,status:"current"});
const conclusion={subject:"Причины",object:"Усталость",paths:[[causal("c1","Недостаток сна","Усталость")]]};
const base={version:1,type:"derived_hypotheses",createdAt:1000,conclusions:[conclusion],reviews:[],modelHistory:[]};
const original=JSON.stringify(base);
const first=engine.reconcile(base,[],[],[],1000);
assert.equal(first.changed,true);
assert.equal(first.meta.conclusions[0].lifecycle.state,"new");
assert.match(first.meta.conclusions[0].lifecycle.id,/^H-/u);
assert.equal(first.meta.conclusions[0].lifecycle.events[0].kind,"created");
assert.equal(JSON.stringify(base),original,"reconciliation must not mutate the original reasoning record");

const lifecycle=first.meta.conclusions[0].lifecycle;
const question=engine.reconcile(first.meta,[],[],[{id:"Q1",status:"open",edgeSubject:"Недостаток сна",edgeObject:"Усталость"}],2000);
assert.equal(question.meta.conclusions[0].lifecycle.state,"under_review");
assert.ok(question.transitions.some(item=>item.from==="new"&&item.to==="under_review"));

const support=engine.reconcile(question.meta,[],[],[],3000);
const withSupport=engine.reconcile(support.meta,[causal("o1","Недостаток сна","Усталость")],[],[],4000);
// Reviews are the only evidence input: a causal claim is not silently upgraded to an observation.
assert.equal(withSupport.meta.conclusions[0].lifecycle.state,"under_review");
const reviewed={...support.meta,reviews:[{claimId:"o1",kind:"supporting_observation",phase:"subsequent",
  edgeSubject:"Недостаток сна",edgeObject:"Усталость",at:4500,evidence:"Наблюдалась усталость"}]};
const provisionally=engine.reconcile(reviewed,[],[],[],5000);
assert.equal(provisionally.meta.conclusions[0].lifecycle.state,"provisionally_supported");
assert.ok(provisionally.meta.conclusions[0].lifecycle.events.some(item=>item.kind==="evidence_added"&&item.claimId==="o1"));

const challenged={...provisionally.meta,reviews:[...reviewed.reviews,{claimId:"o2",kind:"counterexample",phase:"subsequent",
  edgeSubject:"Недостаток сна",edgeObject:"Усталость",at:5500,evidence:"Результат не наблюдался"}]};
const disputed=engine.reconcile(challenged,[],[],[],6000);
assert.equal(disputed.meta.conclusions[0].lifecycle.state,"challenged");
assert.ok(disputed.meta.conclusions[0].lifecycle.challengingClaimIds.includes("o2"));

const conditional=engine.reconcile(disputed.meta,[],[
 {edgeSubject:"Недостаток сна",edgeObject:"Усталость",strategy:"conditional",at:7000,claimIds:["c1"]}
],[],8000);
assert.equal(conditional.meta.conclusions[0].lifecycle.state,"conditional");
assert.ok(conditional.meta.conclusions[0].lifecycle.events.some(item=>item.kind==="decision_applied"&&item.strategy==="conditional"));
const suspended=engine.reconcile(conditional.meta,[],[
 {edgeSubject:"Недостаток сна",edgeObject:"Усталость",strategy:"suspend",at:9000,claimIds:["c1"]}
],[],10000);
assert.equal(suspended.meta.conclusions[0].lifecycle.state,"suspended");
const restored=engine.reconcile(suspended.meta,[],[
 {edgeSubject:"Недостаток сна",edgeObject:"Усталость",strategy:"restore",at:11000,claimIds:["c1"]}
],[],12000);
assert.equal(restored.meta.conclusions[0].lifecycle.state,"restored");
assert.ok(restored.meta.conclusions[0].lifecycle.events.filter(item=>item.kind==="decision_applied").length===3,
  "decision history must keep conditional, suspend and restore actions");

const changedRoutes={...restored.meta,conclusions:[{...restored.meta.conclusions[0],
 paths:[[causal("c1","Недостаток сна","Усталость"),causal("c2","Стресс","Усталость")]]}]};
const revised=engine.reconcile(changedRoutes,[],[],[],13000);
assert.equal(revised.meta.conclusions[0].lifecycle.revision,2);
assert.ok(revised.meta.conclusions[0].lifecycle.events.some(item=>item.kind==="routes_changed"));

const same=engine.reconcile(revised.meta,[],[],[],13000);
assert.equal(same.changed,false,"reconciling an unchanged hypothesis must not add duplicate events");
assert.equal(same.meta.conclusions[0].lifecycle.events.length,revised.meta.conclusions[0].lifecycle.events.length);

const legacy=engine.reconcile({version:1,type:"causal_chain",createdAt:3000,
 conclusions:[{subject:"A",object:"B",paths:[[causal("x","A","B")]]}]},[],[],[],3000);
assert.equal(legacy.meta.conclusions[0].lifecycle.state,"new",
 "legacy reasoning entries without lifecycle history should be upgraded safely");
const reloaded=engine.sanitize(JSON.parse(JSON.stringify(revised.meta.conclusions[0].lifecycle)));
assert.equal(reloaded.id,revised.meta.conclusions[0].lifecycle.id);
assert.equal(reloaded.events.length,revised.meta.conclusions[0].lifecycle.events.length);
assert.equal(engine.summary([revised.meta.conclusions[0].lifecycle]).counts.restored,1);
const invalid=engine.sanitize({...lifecycle,state:"certain"});
assert.equal(invalid.state,"new","unsupported state labels must never become certainty");
assert.equal(engine.sanitize({...lifecycle,id:"broken"}),null);
console.log("NEUROGENESIS hypothesis lifecycle tests: stable IDs, append-only events, evidence states, review queues, explicit decisions, route revisions and legacy migration passed.");
