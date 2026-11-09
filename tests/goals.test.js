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
    sourceClaimIds:["o3","o4"],createdAt:now-400000,updatedAt:now-400000,lastAskedAt:0},
  {id:"Q7",kind:"discriminating_observations",edgeSubject:"Недостаток сна",edgeObject:"усталость",
    question:"Сопоставить два маршрута",status:"open",priority:0,sourceClaimIds:["c1","c2"],
    createdAt:now-300000,updatedAt:now-300000,lastAskedAt:0}
];
const memories = [{
  id:"m1",
  claims:[
    {id:"c1",kind:"causal",subject:"Недостаток сна",object:"усталость"},
    {id:"o1",kind:"observation",subject:"Недостаток сна",object:"усталость",eventRef:"event-a"},
    {id:"o2",kind:"observation",subject:"Недостаток сна",object:"усталость",eventRef:"event-b"},
    {id:"o3",kind:"observation",subject:"сон",object:"усталость"},
    {id:"o4",kind:"observation",subject:"сон",object:"усталость",observationCase:{eventRef:""}},
    {id:"o5",kind:"observation",subject:"сон",object:"усталость",polarity:false}
  ]
}];
const focus = {item:{id:"Q1"},score:.82,reasons:["влияние на другие выводы"]};
const initial = window.NGGoals.reconcile({inquiries,memories,focus,now});
assert.equal(initial.total,7);
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
const qDiscriminating = rows.find(item => item.inquiryId === "Q7");
assert.equal(qDiscriminating.kind,"discriminating_observations","the goal manager must preserve the new inquiry category");
assert.equal(qDiscriminating.status,"active");
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
assert.equal(q6.observationCount,2,"duplicate goals must count only the explicitly compared cards");
assert.equal(q6.evidenceClaimIds.includes("o5"),false,
  "an unrelated opposite observation for the same edge must not leak into a duplicate-card task");
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
assert.equal(reloadedWindow.NGGoals.list().length,7,"goals must persist across reloads");
assert.equal(reloadedWindow.NGGoals.list().find(item=>item.inquiryId==="Q1").status,"waiting_user");
reloadedWindow.NGGoals.merge([{id:"G-Q6",inquiryId:"Q6",title:"Новая цель",status:"active",kind:"missing_observation",createdAt:now,updatedAt:now}]);
assert.equal(reloadedWindow.NGGoals.list().some(item=>item.inquiryId==="Q6"),true);
assert.equal(reloadedWindow.NGGoals.merge([{id:"not-a-goal",inquiryId:"Q7",title:"Мусор"}]).total,7,
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

// Keep the contrast investigation's full positive/negative evidence separate
// from a duplicate-card inquiry that cites only two of those same cards.
const separationWindow={};
const separationSandbox={window:separationWindow,localStorage,console,Date,Math,Set,Map,JSON};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),separationSandbox,{filename:"goals.js"});
const separationMemories=[{id:"shared-observation-memory",claims:[
  {id:"q1-causal",kind:"causal",subject:"Недостаток сна",object:"усталость",polarity:true},
  {id:"q1-positive-a",kind:"observation",subject:"Недостаток сна",object:"усталость",polarity:true},
  {id:"q1-negative",kind:"observation",subject:"Недостаток сна",object:"усталость",polarity:false},
  {id:"q1-positive-b",kind:"observation",subject:"Недостаток сна",object:"усталость",polarity:true}
]}];
const separationSnapshot=JSON.stringify(separationMemories);
separationWindow.NGGoals.reconcile({
  inquiries:[
    {id:"Q1",kind:"contrast_observations",edgeSubject:"Недостаток сна",edgeObject:"усталость",
      question:"Сопоставить три разнонаправленных наблюдения",status:"open",sourceClaimIds:["q1-causal"],
      lastAskedAt:now,createdAt:now-1000,updatedAt:now},
    {id:"Q4",kind:"duplicate_observation",edgeSubject:"Недостаток сна",edgeObject:"усталость",
      question:"Эти две карточки описывают один эпизод?",status:"open",
      sourceClaimIds:["q1-positive-a","q1-negative"],lastAskedAt:now,
      createdAt:now-900,updatedAt:now}
  ],
  memories:separationMemories,
  now
});
const separatedGoals=separationWindow.NGGoals.list();
const q1Contrast=separatedGoals.find(item=>item.inquiryId==="Q1");
const q4Duplicate=separatedGoals.find(item=>item.inquiryId==="Q4");
assert.ok(q1Contrast&&q4Duplicate,"the two inquiry goals must remain separately represented");
assert.equal(q1Contrast.kind,"contrast_observations");
assert.equal(q1Contrast.observationCount,3,
  "Q1 must retain all three positive/negative observations for the contrast investigation");
assert.equal([...q1Contrast.evidenceClaimIds].filter(id=>id.startsWith("q1-")).sort().join("|"),
  "q1-causal|q1-negative|q1-positive-a|q1-positive-b",
  "Q1 must retain its source causal claim and all three positive/negative observations");
assert.equal(q1Contrast.observationCount,3,
  "Q1 observation count must remain independent from its linked causal claim");
assert.equal(q4Duplicate.kind,"duplicate_observation");
assert.equal(q4Duplicate.observationCount,2,
  "Q4 must compare only the two observation cards explicitly cited by that inquiry");
assert.equal([...q4Duplicate.evidenceClaimIds].sort().join("|"),
  "q1-negative|q1-positive-a",
  "the duplicate-card task must not absorb the third same-edge observation");
assert.equal(q4Duplicate.unknownEventCount,2,
  "Q4 must continue to report both cited cards as lacking explicit event identity");
assert.equal(q4Duplicate.eventCount,0,
  "Q4 must not infer an event identity from matching subject/object or polarity");
assert.equal(JSON.stringify(separationMemories),separationSnapshot,
  "goal reconciliation must not mutate source observations or their polarity");

// Q1 must retain all three contrast observations, while Q4 compares only its two
// explicitly cited cards. Missing event IDs and numeric outcomes stay unknown.
const independentQ1Q4 = window.NGGoals.reconcile({
  inquiries:[
    {id:"Q1",kind:"contrast_observations",edgeSubject:"Недостаток сна",edgeObject:"усталость",
      question:"Сопоставить три наблюдения",status:"open",sourceClaimIds:["q1-cause"],
      createdAt:now-300000,updatedAt:now-300000,lastAskedAt:now-200000},
    {id:"Q4",kind:"duplicate_observation",edgeSubject:"Недостаток сна",edgeObject:"усталость",
      question:"Один ли это эпизод?",status:"open",sourceClaimIds:["q4-card-1","q4-card-2"],
      createdAt:now-250000,updatedAt:now-250000,lastAskedAt:now-150000}
  ],
  memories:[{id:"q1-q4-independent-memory",claims:[
    {id:"q1-cause",kind:"causal",subject:"Недостаток сна",object:"усталость"},
    {id:"q4-card-1",kind:"observation",subject:"Недостаток сна",object:"усталость",
      observationCase:{criterion:{status:"provided",value:"по шкале 1–10"},outcome:{status:"not_stated",value:""},eventRef:""}},
    {id:"q4-card-2",kind:"observation",subject:"Недостаток сна",object:"усталость",
      observationCase:{criterion:{status:"provided",value:"по шкале 1–10"},outcome:{status:"not_stated",value:""},eventRef:""}},
    {id:"q1-card-3",kind:"observation",subject:"Недостаток сна",object:"усталость",
      observationCase:{criterion:{status:"provided",value:"по шкале 1–10"},outcome:{status:"not_stated",value:""},eventRef:"event-q1-third"}}
  ]}],
  focus:{item:{id:"Q1"},score:0.7,reasons:["проверка независимости"]},
  now:now+200000
});
const independentRows = window.NGGoals.list();
const independentQ1 = independentRows.find(item=>item.inquiryId==="Q1");
const independentQ4 = independentRows.find(item=>item.inquiryId==="Q4");
assert.equal(independentQ1.observationCount,3,
  "Q1 contrast evidence must retain all three positive/negative observations");
assert.ok(independentQ1.evidenceClaimIds.includes("q1-card-3"),
  "the third Q1 observation must not be removed by Q4's narrower sourceClaimIds");
assert.equal(independentQ4.observationCount,2,
  "Q4 duplicate-card evidence must remain limited to its two cited observations");
assert.equal(independentQ4.evidenceClaimIds.includes("q1-card-3"),false,
  "Q4 must not absorb the unrelated third observation even though it shares the same edge");
assert.equal(independentQ4.eventCount,0,
  "Q4 must not infer event identity when both cited cards have no explicit eventRef");
assert.equal(independentQ4.unknownEventCount,2);
assert.equal(independentQ4.numericOutcomeMissingCount,2,
  "missing numeric outcomes must remain missing rather than being invented");

// A blocked research goal must become reviewable when new direct observations arrive
// after the original answer. The historical user assessment itself must remain unchanged.
const reevaluationDatabase = new Map();
const reevaluationStorage = {
  getItem(key) { return reevaluationDatabase.has(key) ? reevaluationDatabase.get(key) : null; },
  setItem(key, value) { reevaluationDatabase.set(key, String(value)); },
  removeItem(key) { reevaluationDatabase.delete(key); }
};
const reevaluationWindow = { NGKnowledge: window.NGKnowledge };
const reevaluationSandbox = {
  window: reevaluationWindow, localStorage: reevaluationStorage,
  console, Date, Math, Set, Map, JSON
};
vm.runInNewContext(fs.readFileSync("goals.js", "utf8"), reevaluationSandbox, {
  filename: "goals-reevaluation.test.js"
});
const assessmentTime = now + 500000;
const reevaluationInquiries = [
  {
    id:"Q8",kind:"missing_observation",edgeSubject:"Недостаток сна",edgeObject:"усталость",
    question:"Есть ли наблюдения?",status:"answered",assessment:"gap_confirmed",
    assessmentReason:"На момент ответа подходящих наблюдений не было.",
    sourceClaimIds:["q8-cause"],createdAt:assessmentTime-2000,updatedAt:assessmentTime,
    lastAskedAt:assessmentTime-1000,answeredAt:assessmentTime,assessmentAt:assessmentTime
  },
  {
    id:"Q9",kind:"clarify_counterexample",edgeSubject:"стресс",edgeObject:"бессонница",
    question:"Уточни обстоятельства",status:"answered",assessment:"insufficient_context",
    assessmentReason:"На момент ответа обстоятельства сравнения были неизвестны.",
    sourceClaimIds:["q9-cause"],createdAt:assessmentTime-2000,updatedAt:assessmentTime,
    lastAskedAt:assessmentTime-1000,answeredAt:assessmentTime,assessmentAt:assessmentTime
  }
];
const reevaluationMemories = [{
  id:"reevaluation-causes",createdAt:assessmentTime-2000,claims:[
    {id:"q8-cause",kind:"causal",subject:"Недостаток сна",object:"усталость",createdAt:assessmentTime-2000},
    {id:"q9-cause",kind:"causal",subject:"стресс",object:"бессонница",createdAt:assessmentTime-2000}
  ]
}];
reevaluationWindow.NGGoals.reconcile({
  inquiries:reevaluationInquiries,memories:reevaluationMemories,now:assessmentTime+100
});
let reevaluationRows = reevaluationWindow.NGGoals.list();
assert.equal(reevaluationRows.find(row=>row.inquiryId==="Q8").status,"blocked",
  "a confirmed evidence gap should remain blocked while no newer observation exists");
assert.equal(reevaluationRows.find(row=>row.inquiryId==="Q9").status,"blocked",
  "an insufficient-context assessment should remain blocked while no newer observation exists");

reevaluationMemories.push({
  id:"reevaluation-new-observations",createdAt:assessmentTime+500,claims:[
    {id:"q8-observation",kind:"observation",subject:"Недостаток сна",object:"усталость",
      polarity:true,createdAt:assessmentTime+500,observationCase:{
        context:{status:"provided",value:"после рабочего дня"},
        timing:{status:"provided",value:"вечером"},
        criterion:{status:"provided",value:"по шкале 1–10"},
        outcome:{status:"provided",value:"7/10"}
      }},
    {id:"q9-observation",kind:"observation",subject:"стресс",object:"бессонница",
      polarity:true,createdAt:assessmentTime+600,observationCase:{
        context:{status:"provided",value:"во время экзаменов"},
        timing:{status:"provided",value:"в течение недели"},
        criterion:{status:"provided",value:"по факту нарушения сна"},
        outcome:{status:"provided",value:"три ночи"}
      }}
  ]
});
reevaluationWindow.NGGoals.reconcile({
  inquiries:reevaluationInquiries,memories:reevaluationMemories,now:assessmentTime+1000
});
reevaluationRows = reevaluationWindow.NGGoals.list();
const refreshedGap = reevaluationRows.find(row=>row.inquiryId==="Q8");
const refreshedContext = reevaluationRows.find(row=>row.inquiryId==="Q9");
for (const [row,id] of [[refreshedGap,"Q8"],[refreshedContext,"Q9"]]) {
  assert.equal(row.status,"review",
    id+" must move from blocked to review when direct evidence arrives after its assessment");
  assert.equal(row.observationsAfterAssessment,1,
    id+" must count the new direct observation against the historical assessment time");
  assert.match(row.nextAction,/новых прямых наблюдений/u,
    id+" must explain why the goal requires reassessment");
  assert.ok(row.milestones.includes("после оценки добавлены новые наблюдения"),
    id+" must expose the new-evidence milestone");
  assert.equal(row.blockers.length,0,
    id+" must not retain the obsolete no-evidence/context blocker after new evidence arrives");
}
assert.equal(refreshedGap.assessment,"gap_confirmed",
  "new evidence must not rewrite the historical gap assessment");
assert.equal(refreshedGap.assessmentReason,"На момент ответа подходящих наблюдений не было.",
  "the original reason must remain available for audit");
assert.match(reevaluationWindow.NGGoals.report(),/после последней оценки: 1/u,
  "the goals report must expose the number of observations added after assessment");
assert.equal(reevaluationInquiries[0].assessment,"gap_confirmed",
  "goal reconciliation must not mutate the source inquiry");

// A discriminating inquiry must watch observations on both alternative routes.
// New evidence on the second route must reopen the blocked goal for reassessment.
const comparisonGoalWindow = { NGKnowledge: window.NGKnowledge };
const comparisonGoalSandbox = {
  window: comparisonGoalWindow, localStorage: reevaluationStorage,
  console, Date, Math, Set, Map, JSON
};
vm.runInNewContext(fs.readFileSync("goals.js", "utf8"), comparisonGoalSandbox, {
  filename: "goals-discriminating-routes.test.js"
});
const comparisonAssessmentAt = now + 900000;
comparisonGoalWindow.NGGoals.reconcile({
  inquiries:[{
    id:"Q10",kind:"discriminating_observations",edgeSubject:"Недосып",
    edgeObject:"снижению концентрации",
    comparisonEdges:[
      {subject:"Недосып",object:"снижению концентрации"},
      {subject:"Стресс",object:"снижению концентрации"}
    ],
    question:"Сопоставить два альтернативных маршрута",status:"answered",
    assessment:"gap_confirmed",assessmentReason:"На момент ответа прямых наблюдений для сравнения не было.",
    sourceClaimIds:["route-sleep-cause","route-stress-cause"],
    createdAt:comparisonAssessmentAt-2000,updatedAt:comparisonAssessmentAt,
    lastAskedAt:comparisonAssessmentAt-1000,answeredAt:comparisonAssessmentAt,
    assessmentAt:comparisonAssessmentAt
  }],
  memories:[{id:"comparison-route-memory",createdAt:comparisonAssessmentAt-1000,claims:[
    {id:"route-sleep-cause",kind:"causal",subject:"Недосып",object:"снижению концентрации",
      createdAt:comparisonAssessmentAt-1000},
    {id:"route-stress-cause",kind:"causal",subject:"Стресс",object:"снижению концентрации",
      createdAt:comparisonAssessmentAt-1000},
    {id:"route-sleep-before",kind:"observation",subject:"Недосып",object:"снижению концентрации",
      createdAt:comparisonAssessmentAt-100},
    {id:"route-stress-after",kind:"observation",subject:"Стресс",object:"снижению концентрации",
      createdAt:comparisonAssessmentAt+100}
  ]}],
  now:comparisonAssessmentAt+1000
});
const comparisonGoal = comparisonGoalWindow.NGGoals.list().find(row=>row.inquiryId==="Q10");
assert.ok(comparisonGoal);
assert.equal(comparisonGoal.status,"review",
  "fresh evidence on either comparison route must move a blocked discriminating goal to review");
assert.equal(comparisonGoal.observationCount,2,
  "a discriminating goal must include observations from both compared route edges");
assert.equal(comparisonGoal.observationsAfterAssessment,1,
  "an observation on the alternative route must count against the original assessment time");
assert.ok(comparisonGoal.evidenceClaimIds.includes("route-stress-after"),
  "the alternative route's new observation must retain its exact source claim link");
assert.equal(comparisonGoal.assessment,"gap_confirmed",
  "fresh route evidence must not silently rewrite the historical answer assessment");

// A manually resumed question is active until it is actually presented again.
// Its previous ask timestamp remains intact for historical inspection.
const resumedGoalWindow = { NGKnowledge: window.NGKnowledge };
const resumedGoalSandbox = {
  window: resumedGoalWindow, localStorage: reevaluationStorage,
  console, Date, Math, Set, Map, JSON
};
vm.runInNewContext(fs.readFileSync("goals.js", "utf8"), resumedGoalSandbox, {
  filename: "goals-resume.test.js"
});
const resumedAt = now + 1100000;
const resumedInquiry = {
  id:"Q11",kind:"missing_observation",edgeSubject:"сон",edgeObject:"восстановлению",
  question:"Есть ли наблюдение?",status:"open",sourceClaimIds:[],
  createdAt:resumedAt-5000,updatedAt:resumedAt,
  lastAskedAt:resumedAt-3000,lastResumedAt:resumedAt-1000,resumeCount:1
};
resumedGoalWindow.NGGoals.reconcile({inquiries:[resumedInquiry],memories:[],now:resumedAt+100});
let resumedGoal = resumedGoalWindow.NGGoals.list().find(row=>row.inquiryId==="Q11");
assert.equal(resumedGoal.status,"active",
  "a resumed inquiry must be active again until it is asked for a new response");
assert.match(resumedGoal.nextAction,/Повторно задать Q11/u,
  "a resumed goal must tell the system to present the question again");
resumedInquiry.lastAskedAt = resumedAt+200;
resumedInquiry.updatedAt = resumedAt+200;
resumedGoalWindow.NGGoals.reconcile({inquiries:[resumedInquiry],memories:[],now:resumedAt+300});
resumedGoal = resumedGoalWindow.NGGoals.list().find(row=>row.inquiryId==="Q11");
assert.equal(resumedGoal.status,"waiting_user",
  "after it is presented again, the resumed inquiry must wait for the user");

console.log("NEUROGENESIS goal tests: persistence, evidence links, status transitions, stale detection, focus ranking, backup merge and clearing passed.");
