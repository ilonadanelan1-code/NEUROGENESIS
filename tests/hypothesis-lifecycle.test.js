"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const window={};
vm.runInNewContext(fs.readFileSync("knowledge.js","utf8"),{window},{filename:"knowledge.js"});
vm.runInNewContext(fs.readFileSync("hypothesis-lifecycle.js","utf8"),{window},{filename:"hypothesis-lifecycle.js"});
const knowledge=window.NGKnowledge;
const engine=window.NGHypothesisLifecycle.create(knowledge);
const causal=(id,subject,object)=>({id,kind:"causal",subject,predicate:"приводит к",object,polarity:true,status:"current",
  evidence:subject+" приводит к "+object});
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

const forgedReviewMeta={...first.meta,reviews:[{
  claimId:"missing-source",kind:"counterexample",phase:"subsequent",
  subject:"Недостаток сна",object:"Усталость",edgeSubject:"Недостаток сна",
  edgeObject:"Усталость",at:1500,evidence:"Архивная запись без исходной карточки"
}]};
const forgedReview=engine.reconcile(forgedReviewMeta,[],[],[],1600);
assert.equal(forgedReview.meta.conclusions[0].lifecycle.state,"new",
  "an archived review without a matching source claim must not challenge an active hypothesis");
assert.equal(forgedReview.meta.conclusions[0].lifecycle.challengingClaimIds.length,0);
const forgedPriorMeta={...first.meta,conclusions:[{...first.meta.conclusions[0],lifecycle:{
  ...lifecycle,state:"challenged",challengingClaimIds:["missing-source"]
}}]};
const forgedPrior=engine.reconcile(forgedPriorMeta,[],[],[],1700);
assert.equal(forgedPrior.meta.conclusions[0].lifecycle.state,"new",
  "unresolved archived evidence IDs must remain historical references, not active support");
assert.equal(forgedPrior.meta.conclusions[0].lifecycle.challengingClaimIds.length,0,
  "unresolved archived evidence IDs must not remain in active evidence counters");

const malformedArchivedEdge=causal("bad-report","В отчёте говорится, что усталость","Снижение концентрации");
assert.equal(engine.sanitize({...lifecycle,subject:"что усталость"}),null,
  "a malformed archived conclusion must not produce an active lifecycle record");
assert.equal(engine.sanitize({...lifecycle,routes:[[malformedArchivedEdge]]}),null,
  "a lifecycle without any valid archived route must not remain active");
assert.equal(engine.sanitize({...lifecycle,routes:[[causal("valid","Недостаток сна","Усталость"),malformedArchivedEdge]]}),null,
  "a route containing one malformed edge must be rejected whole, not shortened");
const reportedEvidenceEdge={...causal("bad-evidence","Усталость","Снижение концентрации"),
  evidence:"По данным исследования, усталость приводит к снижению концентрации"};
assert.equal(engine.sanitize({...lifecycle,routes:[[reportedEvidenceEdge]]}),null,
  "a report-attributed route must not survive lifecycle sanitization");
const malformedConclusion=engine.reconcile({...base,conclusions:[{
  subject:"В отчёте говорится, что усталость",object:"Снижение концентрации",
  paths:[[malformedArchivedEdge]]
}]},[],[],[],1500);
assert.equal(malformedConclusion.meta.conclusions.length,0,
  "reconciliation must remove an invalid conclusion from its active projection");
const question=engine.reconcile(first.meta,[],[],[{id:"Q1",status:"open",edgeSubject:"Недостаток сна",edgeObject:"Усталость"}],2000);
assert.equal(question.meta.conclusions[0].lifecycle.state,"under_review");
assert.ok(question.transitions.some(item=>item.from==="new"&&item.to==="under_review"));

const support=engine.reconcile(question.meta,[],[],[],3000);
const withSupport=engine.reconcile(support.meta,[causal("o1","Недостаток сна","Усталость")],[],[],4000);
// Reviews are the only evidence input: a causal claim is not silently upgraded to an observation.
assert.equal(withSupport.meta.conclusions[0].lifecycle.state,"new",
  "a causal claim alone must not count as review evidence or keep an inquiry open");
const supportingObservation={id:"o1",kind:"observation",subject:"Недостаток сна",predicate:"наблюдение",object:"Усталость",
  polarity:true,status:"current",evidence:"Наблюдалась усталость"};
const counterObservation={id:"o2",kind:"observation",subject:"Недостаток сна",predicate:"наблюдение",object:"Усталость",
  polarity:false,status:"current",evidence:"Результат не наблюдался"};
const reviewed={...support.meta,reviews:[{claimId:"o1",kind:"supporting_observation",phase:"subsequent",
  subject:"Недостаток сна",object:"Усталость",edgeSubject:"Недостаток сна",edgeObject:"Усталость",
  at:4500,evidence:"Наблюдалась усталость"}]};
const provisionally=engine.reconcile(reviewed,[supportingObservation],[],[],5000);
assert.equal(provisionally.meta.conclusions[0].lifecycle.state,"provisionally_supported");
assert.ok(provisionally.meta.conclusions[0].lifecycle.events.some(item=>item.kind==="evidence_added"&&item.claimId==="o1"));
const forgedEvidenceReview={...support.meta,reviews:[{claimId:"c-source",kind:"supporting_claim",phase:"subsequent",
  subject:"Недостаток сна",object:"Усталость",edgeSubject:"Недостаток сна",edgeObject:"Усталость",
  at:4700,evidence:"Архивный текст, не совпадающий с исходной запись"}]};
const sourceCausal=causal("c-source","Недостаток сна","Усталость");
const rejectedEvidence=engine.reconcile(forgedEvidenceReview,[sourceCausal],[],[],4800);
assert.equal(rejectedEvidence.meta.conclusions[0].lifecycle.state,"new",
  "a review must match the exact source evidence, not merely reuse a real claim ID and edge");
assert.equal(rejectedEvidence.meta.conclusions[0].lifecycle.supportingClaimIds.length,0);

const challenged={...provisionally.meta,reviews:[...reviewed.reviews,{claimId:"o2",kind:"counterexample",phase:"subsequent",
  subject:"Недостаток сна",object:"Усталость",edgeSubject:"Недостаток сна",edgeObject:"Усталость",
  at:5500,evidence:"Результат не наблюдался"}]};
const disputed=engine.reconcile(challenged,[supportingObservation,counterObservation],[],[],6000);
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
const restoredDecision=[{edgeSubject:"Недостаток сна",edgeObject:"Усталость",strategy:"restore",at:11000}];
const revised=engine.reconcile(changedRoutes,[],restoredDecision,[],13000);
assert.equal(revised.meta.conclusions[0].lifecycle.revision,2);
assert.ok(revised.meta.conclusions[0].lifecycle.events.some(item=>item.kind==="routes_changed"));

// A later, weaker decision on another route must not hide an active suspension.
const multiBase={version:1,type:"derived_hypotheses",createdAt:15000,conclusions:[{
  subject:"Факторы",object:"Результат",paths:[
    [causal("m1","Недосыпание","Результат")],[causal("m2","Стресс","Результат")]
  ]}],reviews:[],modelHistory:[]};
const multiCreated=engine.reconcile(multiBase,[],[],[],15000);
const multiSuspended=engine.reconcile(multiCreated.meta,[],[
  {edgeSubject:"Недосыпание",edgeObject:"Результат",strategy:"suspend",at:16000},
  {edgeSubject:"Стресс",edgeObject:"Результат",strategy:"conditional",at:17000}
],[],18000);
assert.equal(multiSuspended.meta.conclusions[0].lifecycle.state,"suspended",
  "an active suspended edge must not be hidden by a newer conditional decision on another edge");
const oneRestored=engine.reconcile(multiSuspended.meta,[],[
  {edgeSubject:"Недосыпание",edgeObject:"Результат",strategy:"restore",at:19000},
  {edgeSubject:"Стресс",edgeObject:"Результат",strategy:"conditional",at:17000}
],[],20000);
assert.equal(oneRestored.meta.conclusions[0].lifecycle.state,"conditional",
  "restoring the suspended edge should reveal the remaining conditional decision");

const same=engine.reconcile(revised.meta,[],restoredDecision,[],13000);
assert.equal(same.changed,false,"reconciling an unchanged hypothesis must not add duplicate events");
assert.equal(same.meta.conclusions[0].lifecycle.events.length,revised.meta.conclusions[0].lifecycle.events.length);

const forgedDecisionMeta={...first.meta,conclusions:[{...first.meta.conclusions[0],lifecycle:{
  ...lifecycle,state:"restored",decision:{strategy:"restore",edgeSubject:"Недостаток сна",edgeObject:"Усталость",at:1500}
}}]};
const forgedDecision=engine.reconcile(forgedDecisionMeta,[],[],[],1600);
assert.equal(forgedDecision.meta.conclusions[0].lifecycle.state,"new",
  "a serialized archive decision must not restore a route without a current model-decision record");
assert.equal(forgedDecision.meta.conclusions[0].lifecycle.decision,null);
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
