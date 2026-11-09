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
    resolution:"same_event",createdAt:now-500000,updatedAt:now-100000}
];
const memories = [{
  id:"m1",
  claims:[
    {id:"c1",kind:"causal",subject:"Недостаток сна",object:"усталость"},
    {id:"o1",kind:"observation",subject:"Недостаток сна",object:"усталость",eventRef:"event-a"},
    {id:"o2",kind:"observation",subject:"Недостаток сна",object:"усталость",eventRef:"event-b"}
  ]
}];
const focus = {item:{id:"Q1"},score:.82,reasons:["влияние на другие выводы"]};
const initial = window.NGGoals.reconcile({inquiries,memories,focus,now});
assert.equal(initial.total,5);
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
const q2 = rows.find(item => item.inquiryId === "Q2");
assert.equal(q2.status,"blocked");
assert.match(q2.nextAction,/уточнить обстоятельства/iu);
assert.match(q2.blockers.join(" "),/Контекст/u);
assert.equal(rows.find(item=>item.inquiryId==="Q3").status,"paused");
assert.equal(rows.find(item=>item.inquiryId==="Q4").status,"stale");
assert.equal(rows.find(item=>item.inquiryId==="Q5").status,"completed");
assert.match(window.NGGoals.report(),/не вероятность истинности/u);
assert.equal(database.has("neurogenesis.goals.v1"),true);
const reloadedWindow = {};
const sandbox2 = {window:reloadedWindow,localStorage,console,Date,Math,Set,Map,JSON};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),sandbox2,{filename:"goals.js"});
assert.equal(reloadedWindow.NGGoals.list().length,5,"goals must persist across reloads");
assert.equal(reloadedWindow.NGGoals.list().find(item=>item.inquiryId==="Q1").status,"waiting_user");
reloadedWindow.NGGoals.merge([{id:"G-Q6",inquiryId:"Q6",title:"Новая цель",status:"active",kind:"missing_observation",createdAt:now,updatedAt:now}]);
assert.equal(reloadedWindow.NGGoals.list().some(item=>item.inquiryId==="Q6"),true);
assert.equal(reloadedWindow.NGGoals.merge([{id:"not-a-goal",inquiryId:"Q7",title:"Мусор"}]).total,6,
  "invalid imported goal IDs must be rejected");
reloadedWindow.NGGoals.clear();
assert.equal(reloadedWindow.NGGoals.list().length,0);
assert.equal(database.has("neurogenesis.goals.v1"),false);
console.log("NEUROGENESIS goal tests: persistence, evidence links, status transitions, stale detection, focus ranking, backup merge and clearing passed.");
