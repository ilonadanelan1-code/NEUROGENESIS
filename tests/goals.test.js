"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const database = new Map();
const localStorage = {
  getItem(key) { return database.has(key) ? database.get(key) : null; },
  setItem(key, value) { database.set(key, String(value)); },
  removeItem(key) { database.delete(key); }
};
const window = {
  NGKnowledge: {
    sameEntity(left, right) {
      const norm = value => String(value || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();
      return norm(left) === norm(right);
    }
  }
};
const sandbox = {window,localStorage,console,Date,Math,Set,Map,JSON};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),sandbox,{filename:"goals.js"});
const now = 2_000_000_000_000;
const inquiries = [
  {id:"Q1",kind:"contrast_observations",edgeSubject:"Недостаток сна",edgeObject:"усталость",
    question:"Сопоставь два случая",status:"open",priority:9,sourceClaimIds:["c1"],
    createdAt:now-3600000,updatedAt:now-3600000,lastAskedAt:now-1800000,assessment:"unassessed"},
  {id:"Q2",kind:"missing_observation",edgeSubject:"стресс",edgeObject:"бессонница",
    question:"Есть ли наблюдения?",status:"answered",assessment:"insufficient_context",
    assessmentReason:"Контекст и время не указаны.",sourceClaimIds:["c2"],
    createdAt:now-3000000,updatedAt:now-1000000,answeredAt:now-1000000},
  {id:"Q3",kind:"missing_observation",edgeSubject:"кофеин",edgeObject:"бодрость",
    question:"Уточни связь",status:"skipped",sourceClaimIds:[],createdAt:now-2000000,updatedAt:now-1000000},
  {id:"Q4",kind:"missing_observation",edgeSubject:"погода",edgeObject:"настроение",
    question:"Нужны наблюдения",status:"open",sourceClaimIds:[],
    createdAt:now-40*86400000,updatedAt:now-40*86400000,lastAskedAt:0},
  {id:"Q5",kind:"duplicate_observation",edgeSubject:"эпизод А",edgeObject:"эпизод Б",
    question:"Один ли это эпизод?",status:"answered",assessment:"duplicate_same_event",
    resolution:"same_event",createdAt:now-500000,updatedAt:now-100000},
  {id:"Q6",kind:"duplicate_observation",edgeSubject:"сон",edgeObject:"усталость",
    question:"Это один эпизод или разные?",status:"open",assessment:"unassessed",
    sourceClaimIds:["o3","o4"],createdAt:now-400000,updatedAt:now-400000,lastAskedAt:0}
];
const memories = [{
  id:"m1",
  claims:[
    {id:"c1",kind:"causal",subject:"Недостаток сна",object:"усталость"},
    {id:"o1",kind:"observation",subject:"Недостаток сна",object:"усталость",eventRef:"event-a"},
    {id:"o2",kind:"observation",subject:"Недостаток сна",object:"усталость",eventRef:"event-b"},
    {id:"o3",kind:"observation",subject:"сон",object:"усталость"},
    {id:"o4",kind:"observation",subject:"сон",object:"усталость",observationCase:{eventRef:""}}
  ]
}];
const focus = {item:{id:"Q1"},score:.82,reasons:["влияние на другие выводы"]};
const initial = window.NGGoals.reconcile({inquiries,memories,focus,now});
assert.equal(initial.total,6);
const rows = window.NGGoals.list();
const q1 = rows.find(item => item.inquiryId === "Q1");
assert.equal(q1.status,"waiting_user");
assert.equal(q1.selected,true);
assert.equal(q1.focusScore,82);
assert.equal(q1.observationCount,2);
assert.equal(q1.eventCount,2);
assert.ok(q1.evidenceClaimIds.includes("c1"));
assert.ok(q1.evidenceMemoryIds.includes("m1"));
assert.ok(q1.milestones.includes("вопрос был задан"));
assert.equal(q1.completeObservationCount,0,"observations without structured metadata are incomplete");
assert.equal(q1.incompleteObservationCount,2,"quality must be calculated for each observation card");
assert.equal(q1.metadataCoverage,0,"metadata cannot be filled from another source by coincidence");
const q2 = rows.find(item => item.inquiryId === "Q2");
assert.equal(q2.status,"blocked");
assert.match(q2.nextAction,/уточнить обстоятельства/iu);
assert.match(q2.blockers.join(" "),/Контекст/u);
assert.equal(rows.find(item=>item.inquiryId==="Q3").status,"paused");
assert.equal(rows.find(item=>item.inquiryId==="Q4").status,"stale");
assert.equal(rows.find(item=>item.inquiryId==="Q5").status,"completed");
const q6 = rows.find(item => item.inquiryId === "Q6");
assert.equal(q6.status,"active");
assert.equal(q6.eventCount,0,"missing eventRef must not be counted as a distinct event");
assert.equal(q6.unknownEventCount,2);
assert.match(q6.nextAction,/один эпизод.*разные эпизоды/u);
assert.match(q6.blockers.join(" "),/нельзя определить/u);
assert.match(window.NGGoals.report(),/явных eventRef/u);
assert.match(window.NGGoals.report(),/Прогресс выполнения работы/u);
assert.match(window.NGGoals.report(),/Качество доказательств/u);
assert.match(window.NGGoals.report(),/не вероятность истинности/u);
assert.equal(database.has("neurogenesis.goals.v1"),true);
const reloadedWindow = {};
const sandbox2 = {window:reloadedWindow,localStorage,console,Date,Math,Set,Map,JSON};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),sandbox2,{filename:"goals.js"});
assert.equal(reloadedWindow.NGGoals.list().length,6,"goals must persist across reloads");
assert.equal(reloadedWindow.NGGoals.list().find(item=>item.inquiryId==="Q1").status,"waiting_user");
reloadedWindow.NGGoals.merge([{id:"G-Q6",inquiryId:"Q6",title:"Новая цель",status:"active",kind:"missing_observation",createdAt:now,updatedAt:now}]);
assert.equal(reloadedWindow.NGGoals.list().some(item=>item.inquiryId==="Q6"),true);
assert.equal(reloadedWindow.NGGoals.merge([{id:"not-a-goal",inquiryId:"Q7",title:"Мусор"}]).total,6,
  "invalid imported goal IDs must be rejected");
reloadedWindow.NGGoals.clear();
assert.equal(reloadedWindow.NGGoals.list().length,0);
assert.equal(database.has("neurogenesis.goals.v1"),false);

// Work progress and evidence quality are independent dimensions.
const qualityWindow={};
const qualitySandbox={window:qualityWindow,localStorage,console,Date,Math,Set,Map,JSON};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),qualitySandbox,{filename:"goals.js"});
const qualityNow=now+100000;
qualityWindow.NGGoals.reconcile({
  inquiries:[{id:"Q7",kind:"duplicate_observation",edgeSubject:"X",edgeObject:"Y",
    question:"Разбей эпизоды",status:"answered",assessment:"duplicate_partitioned_events",
    sourceClaimIds:["q7-a","q7-b"],lastAskedAt:qualityNow-100,createdAt:qualityNow-1000,
    updatedAt:qualityNow,answeredAt:qualityNow,resolution:"partitioned_events"}],
  memories:[{id:"quality-memory",claims:[
    {id:"q7-a",kind:"observation",subject:"X",object:"Y",observationCase:{eventRef:"evt-1",
      context:{status:"provided",value:"после тренировки"},timing:{status:"provided",value:"утром"},
      criterion:{status:"provided",value:"по шкале 1–10"},outcome:{status:"not_stated",value:""}}},
    {id:"q7-b",kind:"observation",subject:"X",object:"Y",observationCase:{eventRef:"evt-2",
      context:{status:"provided",value:"обычный день"},timing:{status:"provided",value:"вечером"},
      criterion:{status:"provided",value:"по шкале 1–10"},outcome:{status:"provided",value:"6/10"}}}
  ]}],
  now:qualityNow
});
const q7=qualityWindow.NGGoals.list().find(item=>item.inquiryId==="Q7");
assert.equal(q7.status,"completed","a resolved mixed event grouping should complete the grouping task");
assert.equal(q7.progress,100,"all completed workflow stages should reach 100 percent");
assert.equal(q7.completeObservationCount,1,"only the card with a numeric outcome is complete");
assert.equal(q7.incompleteObservationCount,1);
assert.equal(q7.numericOutcomeMissingCount,1);
assert.equal(q7.metadataCoverage,88,"field coverage should be independent from workflow completion");
assert.match(qualityWindow.NGGoals.report(),/Прогресс выполнения работы: 100\/100/u);
assert.match(qualityWindow.NGGoals.report(),/Качество доказательств: полных карточек 1\/2/u);

console.log("NEUROGENESIS goal tests: persistence, evidence links, status transitions, stale detection, focus ranking, backup merge and clearing passed.");
