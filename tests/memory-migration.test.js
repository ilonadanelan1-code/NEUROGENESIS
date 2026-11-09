"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const database = new Map();
const legacyMemories = [
  {
    id: "mmusic",
    text: "Музыка прекрасна",
    tags: ["музык", "прекрасн"],
    traceIds: ["n112", "n113"],
    createdAt: 1794156965429,
    updatedAt: 1794156965430,
    strength: 0.665,
    repetitions: 1,
    recalls: 1
  },
  {
    id: "mlike",
    text: "Мне нравится музыка",
    tags: ["нравится", "музык"],
    traceIds: [],
    createdAt: 1794157000000,
    updatedAt: 1794157000000,
    strength: 0.65,
    repetitions: 1,
    recalls: 0
  },
  {
    id: "massistant",
    text: "Ты мой оссистент",
    tags: ["оссистент"],
    traceIds: [],
    createdAt: 1794158000000,
    updatedAt: 1794158000000,
    strength: 0.65,
    repetitions: 1,
    recalls: 0,
    claims: []
  },
  {
    id: "mcreator",
    text: "Твоего создателя зовут Сергей",
    tags: ["создателя", "сергей"],
    traceIds: [],
    createdAt: 1794158100000,
    updatedAt: 1794158100000,
    strength: 0.65,
    repetitions: 1,
    recalls: 0,
    claims: []
  },
  {
    id: "migor",
    text: "Игорь Головнев твой самый лучший друг",
    tags: ["игорь", "головн", "сам", "лучш"],
    traceIds: ["n114", "n115", "n118", "n116"],
    createdAt: 1794157814555,
    updatedAt: 1794157868253,
    strength: 0.65,
    repetitions: 1,
    recalls: 0
  },
  {
    id: "mobservation",
    text: "При недостатке сна наблюдалась усталость",
    tags: ["недостаток", "сна", "усталость"],
    traceIds: [],
    createdAt: 1794158200000,
    updatedAt: 1794158200000,
    strength: 0.65,
    repetitions: 1,
    recalls: 0
  }
];
database.set("neurogenesis.memories.v1", JSON.stringify(legacyMemories));
database.set("neurogenesis.dialog.v1", JSON.stringify([
  {role:"user",text:"Недостаток сна сегодня вызвал у меня усталость",time:1794158201000},
  {role:"assistant",text:"Сколько часов ты спал?",time:1794158202000,
  sourceReasoning:{
    version:1,type:"derived_hypotheses",createdAt:1794158202000,status:"current",
    conclusions:[{subject:"В отчёте говорится, что усталость",object:"снижению концентрации",
      paths:[[{id:"dialog-source-only-edge",subject:"В отчёте говорится, что усталость",object:"снижению концентрации"}]]}],
    reviews:[],modelHistory:[]
  }},
  {role:"user",text:"А почему?",time:1794158203000}
]));
database.set("neurogenesis.cognitive-cycles.v1", JSON.stringify([{
  id:"C700",sequence:700,at:1794158800000,mode:"ask",intent:"general_question",status:"complete",
  phases:[{name:"perception",status:"complete",summary:"Локальный сохранённый цикл"}],
  uncertainty:{level:"low",supportIndex:78,reasons:["локальный источник"],evidenceCount:1,conflictCount:0,independentSources:1},
  metrics:{inputTokens:4,parsedClaims:1,attentionMatches:1,memoryBefore:6,memoryAfter:6},
  memoryIds:[],claimIds:[]
}]));

database.set("neurogenesis.inquiries.v1", JSON.stringify([{
  id:"Q1",signature:"legacy-observation-context-test",kind:"contrast_observations",
  edgeSubject:"Недостаток сна",edgeObject:"усталости",question:"Уточни контекст наблюдений",
  status:"answered",createdAt:1794158300000,updatedAt:1794158300000,answeredAt:1794158300000,
  responseText:"Обстоятельства двух наблюдений не указаны. Даты и время неизвестны. Критерий определения результата не описан."
}]));

database.set("neurogenesis.reasoning-archive.v1", JSON.stringify([
  {role:"assistant",time:1794158400000,text:"Старый вывод",reasoning:{
    version:1,type:"derived_hypotheses",createdAt:1794158400000,status:"current",
    conclusions:[{subject:"что усталость",object:"снижению концентрации",
      paths:[[{id:"legacy-malformed-edge",subject:"что усталость",object:"снижению концентрации"}]]},
    ],
    reviews:[],modelHistory:[]
  }},
  {role:"assistant",time:1794158500000,text:"Исключённый фрагмент",reasoning:{
    version:1,type:"derived_hypotheses",createdAt:1794158500000,status:"current",
    conclusions:[],reviews:[],modelHistory:[],
    excludedPaths:[{origin:"conclusion",subject:"что усталость",object:"снижению концентрации",
      route:[{subject:"что усталость",object:"снижению концентрации"}],reason:"malformed_causal_subject"}]
  }},
  {role:"assistant",time:1794158600000,text:"Только исходный снимок",sourceReasoning:{
    version:1,type:"derived_hypotheses",createdAt:1794158600000,status:"current",
    conclusions:[
      {subject:"что усталость",object:"снижению концентрации",
        paths:[[{id:"archive-source-only-edge",subject:"что усталость",object:"снижению концентрации"}]]},
      {subject:"Усталость",object:"снижению концентрации",
        evidence:"Исследование показало, что усталость приводит к снижению концентрации",
        paths:[[{id:"archive-reported-conclusion",subject:"Усталость",object:"снижению концентрации"}]]}
    ],
    reviews:[],modelHistory:[{at:1794158600000,edges:[],alternatives:[
      {subject:"Перегрузка",object:"усталости",
        evidence:"Исследование показало, что перегрузка приводит к усталости",
        paths:[[{subject:"Перегрузка",object:"усталости"}]]}
    ]}]
  }}
]));

class ElementStub {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.scrollHeight = 0;
    this.files = [];
  }
  addEventListener(type, listener) {
    (this.listeners ||= Object.create(null));
    (this.listeners[type] ||= []).push(listener);
  }
  dispatch(type, event = {}) {
    const pending = [];
    for (const listener of this.listeners && this.listeners[type] || []) {
      pending.push(listener({ target:this, preventDefault() {}, ...event }));
    }
    return Promise.all(pending);
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  remove() {}
  focus() {}
  scrollIntoView() {}
}
const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new ElementStub());
    return elements.get(id);
  },
  createElement() { return new ElementStub(); },
  body: new ElementStub()
};
const knownNeurons = new Set(["n112", "n113", "n114", "n115", "n116", "n118"]);
const createdLabels = [];
const traceKeys = new Map([["n112","музык"],["n113","прекрасн"],["n114","игорь"],["n115","головн"],["n118","сам"],["n116","лучш"]]);
let nextNeuron = 119;
const window = {
  NGBrain: {
    hasNeuron(id) { return knownNeurons.has(id); },
    hasMemoryTrace(id, key) { return traceKeys.get(id) === String(key).slice(0, 34); },
    createMemoryTrace(key, label) {
      const id = "n" + nextNeuron++;
      knownNeurons.add(id);
      traceKeys.set(id, String(key).slice(0, 34));
      if (label) createdLabels.push(label);
      return id;
    },
    associateMemoryTraces() {},
    activateMemoryTraces() {},
    removeMemoryTraces() {}
  },
  confirm() { return true; }
};
const localStorage = {
  getItem(key) { return database.has(key) ? database.get(key) : null; },
  setItem(key, value) { database.set(key, String(value)); }
};
const sandbox = {
  window, document, localStorage, console, Date, Math, Set, Map, JSON, URL, AbortController, setTimeout, clearTimeout,
  async fetch(url, options) {
    if (String(url).endsWith("/api/health")) {
      return { ok:true, status:200, async json() { return { ok:true, configured:true, model:"integration-test-model" }; } };
    }
    if (String(url).endsWith("/api/chat")) {
      return { ok:true, status:200, async json() { return { ok:true, reply:"Интеграционный ответ языковой модели" }; } };
    }
    return { ok:false, status:404, async json() { return { error:"not_found" }; } };
  }
};
window.fetch = sandbox.fetch;
vm.runInNewContext(fs.readFileSync("knowledge.js", "utf8"), sandbox, { filename: "knowledge.js" });
vm.runInNewContext(fs.readFileSync("goals.js", "utf8"), sandbox, { filename: "goals.js" });
vm.runInNewContext(fs.readFileSync("observation-engine.js", "utf8"), sandbox, { filename: "observation-engine.js" });
vm.runInNewContext(fs.readFileSync("knowledge-graph.js", "utf8"), sandbox, { filename: "knowledge-graph.js" });
vm.runInNewContext(fs.readFileSync("reasoning-audit.js", "utf8"), sandbox, { filename: "reasoning-audit.js" });
vm.runInNewContext(fs.readFileSync("hypothesis-lifecycle.js", "utf8"), sandbox, { filename: "hypothesis-lifecycle.js" });
vm.runInNewContext(fs.readFileSync("discriminating-observations.js", "utf8"), sandbox, { filename: "discriminating-observations.js" });
vm.runInNewContext(fs.readFileSync("dialog-context.js", "utf8"), sandbox, { filename: "dialog-context.js" });
vm.runInNewContext(fs.readFileSync("dialog-manager.js", "utf8"), sandbox, { filename: "dialog-manager.js" });
vm.runInNewContext(fs.readFileSync("llm-bridge.js", "utf8"), sandbox, { filename: "llm-bridge.js" });
vm.runInNewContext(fs.readFileSync("memory.js", "utf8"), sandbox, { filename: "memory.js" });

assert.equal(window.NGMemory.count(), 6);
const dialogState = window.NGMemory.dialogContext();
assert.ok(dialogState && dialogState.activeThread, "legacy dialogue should rebuild a working context");
assert.match(dialogState.activeThread.title, /недостаток сна/iu);
assert.equal(window.NGMemory.dialogHistory().length, 3);
const dialogPlan = window.NGMemory.planDialog("А почему?");
assert.equal(dialogPlan.intent, "follow_up", "the manager should classify a short contextual follow-up");
assert.equal(dialogPlan.action, "continue_active_topic", "the manager should route a resolvable follow-up through the active topic");
assert.equal(window.NGMemory.llmStatus().connected, false, "the model bridge must remain offline until a provider is explicitly configured");
const preparedRequest = window.NGMemory.prepareLLMRequest("А почему?");
assert.equal(preparedRequest.schema, "NEUROGENESIS_LLM_REQUEST_V1");
assert.equal(preparedRequest.metadata.historyMessages, 2, "the current user turn should not be duplicated in model history");
assert.equal(window.NGMemory.hypothesisLifecycle().length, 0, "legacy backups without causal archives should load an empty lifecycle safely");
assert.match(window.NGMemory.hypothesisLifecycleReport(), /Пока нет архивных причинных выводов/u);
const loadedReasoningHistory=window.NGMemory.reasoningHistory();
assert.equal(loadedReasoningHistory.length,4,"archive records from saved reasoning and dialogue source snapshots must survive local-storage loading");
const loadedMalformed=loadedReasoningHistory.find(item=>item.time===1794158400000);
assert.ok(loadedMalformed);
assert.equal(loadedMalformed.conclusions.length,0,
  "a malformed archived conclusion must not survive as an active conclusion");
assert.ok(loadedMalformed.excludedPaths.some(item=>item.reason==="malformed_causal_subject"&&item.subject==="что усталость"),
  "the rejected conclusion must remain visible in excludedPaths");
const loadedExcludedOnly=loadedReasoningHistory.find(item=>item.time===1794158500000);
assert.ok(loadedExcludedOnly&&loadedExcludedOnly.conclusions.length===0,
  "an excludedPaths-only archive object must not be promoted to a hypothesis");
assert.ok(loadedExcludedOnly.excludedPaths.some(item=>item.reason==="malformed_causal_subject"));
const loadedArchiveSourceOnly=loadedReasoningHistory.find(item=>item.time===1794158600000);
assert.ok(loadedArchiveSourceOnly&&loadedArchiveSourceOnly.conclusions.length===0,
  "a raw sourceReasoning archive snapshot must pass through the same active-projection guard");
assert.ok(loadedArchiveSourceOnly.excludedPaths.some(item=>item.reason==="malformed_causal_subject"));
assert.ok(loadedArchiveSourceOnly.excludedPaths.some(item=>item.reason==="reported_causal_statement"&&item.subject==="Усталость"),
  "a reported-evidence conclusion must be excluded even when its causal subject is otherwise valid");
assert.ok(loadedArchiveSourceOnly.excludedPaths.some(item=>item.origin==="snapshot_alternative"&&item.reason==="reported_causal_statement"&&item.subject==="Перегрузка"),
  "a report-attributed snapshot alternative must not enter the active archive projection");
const loadedDialogSourceOnly=loadedReasoningHistory.find(item=>item.time===1794158202000);
assert.ok(loadedDialogSourceOnly&&loadedDialogSourceOnly.conclusions.length===0,
  "reasoning restored from a dialogue sourceReasoning snapshot must not reactivate a malformed route");
assert.ok(loadedDialogSourceOnly.excludedPaths.some(item=>item.reason==="malformed_causal_subject"));
const persistedArchiveAfterLoad=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"));
const preservedRawArchive=persistedArchiveAfterLoad.find(item=>item.time===1794158600000);
assert.equal(preservedRawArchive.sourceReasoning.conclusions[0].subject,"что усталость",
  "the immutable source snapshot must remain intact for historical inspection");
assert.equal(preservedRawArchive.reasoning.conclusions.length,0,
  "the active archive projection must keep the malformed source conclusion excluded");
assert.equal(window.NGMemory.refreshInquiries().added,0,
  "excludedPaths-only and malformed source snapshots must not seed active research inquiries");
assert.doesNotMatch(window.NGMemory.modelReviewReadiness(),/что усталость/u,
  "excluded archive paths must not become tracked causal edges for model review readiness");
const migratedGraph = window.NGMemory.knowledgeGraph();
assert.equal(migratedGraph.stats.memories,6,"legacy records should remain individually represented in the graph");
assert.ok(migratedGraph.stats.claims >= 6,"legacy claims should be projected without rewriting the backup format");
const claims = window.NGMemory.claims();
assert.equal(claims.length, 6, "all legacy memories should be upgraded to structured claims");
const relation = claims.find(claim => claim.kind === "relationship");
const opinion = claims.find(claim => claim.kind === "opinion");
assert.ok(relation);
assert.equal(relation.subject, "Игорь Головнев");
assert.equal(relation.predicate, "лучший друг");
assert.equal(relation.object, "assistant");
const identity = claims.find(claim => claim.kind === "identity");
assert.ok(identity, "old assistant-role memory should migrate automatically");
assert.equal(identity.object, "ассистент");
assert.match(window.NGKnowledge.answerQuestion("Кто ты?", claims), /я — ассистент/u);
const creator = claims.find(claim => claim.subject === "assistant" && claim.predicate === "создатель");
assert.ok(creator, "old creator memory should migrate automatically");
assert.equal(creator.object, "Сергей");
assert.match(window.NGKnowledge.answerQuestion("Кто твой создатель?", claims), /моего создателя зовут Сергей/u);
assert.ok(opinion);
assert.equal(opinion.subject, "Музыка");
assert.equal(opinion.object, "прекрасна");
assert.match(window.NGKnowledge.answerQuestion("Кто твой лучший друг?", claims), /Игорь Головнев — мой лучший друг/u);
assert.ok(window.NGMemory.search("Головнева").some(item => item.text.includes("Игорь Головнев")), "memory search should use the same Russian case normalization as knowledge profiles");
const musicProfile = window.NGKnowledge.answerQuestion("Что ты знаешь о музыке?", claims);
assert.match(musicProfile, /Музыка — прекрасна/u);
assert.match(musicProfile, /нравится музыка/u);
assert.match(musicProfile, /субъективное мнение/u);
assert.match(musicProfile, /самоописание/u);

const migratedObservation=claims.find(claim=>claim.kind==="observation");
assert.ok(migratedObservation,"legacy observation text should migrate into a structured case");
assert.equal(migratedObservation.observationCase.schema,2);
assert.equal(migratedObservation.observationCase.context.status,"not_stated");
assert.equal(migratedObservation.sourceMemoryId,"mobservation");
const observationCases=window.NGMemory.observationCases();
assert.equal(observationCases.length,1);
assert.equal(observationCases[0].sourceMemoryId,"mobservation");
assert.match(window.NGMemory.observationJournal(),/ЖУРНАЛ НАБЛЮДЕНИЙ/u);
const migratedInquiry=window.NGMemory.inquiries().find(item=>item.id==="Q1");
assert.equal(migratedInquiry.responseDetails.context.status,"not_recorded");
assert.equal(migratedInquiry.responseDetails.timing.status,"unknown");
assert.equal(migratedInquiry.responseDetails.criterion.status,"not_recorded");
const readiness=window.NGMemory.reviewReadinessForEdge("Недостаток сна","усталости");
assert.equal(readiness.contextStatus,"not_stated","the absence report must not rewrite the direct observation card");
assert.equal(readiness.timingStatus,"not_stated","the inquiry timing is not a timestamp attached to the event card");
assert.equal(readiness.criterionStatus,"not_stated","the inquiry response is not an observation measurement method");
assert.equal(readiness.answerContextStatus,"not_recorded");
assert.equal(readiness.answerTimingStatus,"unknown");
assert.equal(readiness.answerCriterionStatus,"not_recorded");
assert.equal(readiness.context,false,"an absence report must never count as a provided context");

const migrated = JSON.parse(database.get("neurogenesis.memories.v1"));
const migratedIgor = migrated.find(item => item.id === "migor");
assert.ok(migratedIgor.claims && migratedIgor.claims.length === 1, "claims should be persisted to upgraded local storage");
assert.ok(migratedIgor.tags.includes("друг"), "legacy tags should be enriched with the missing relationship word");
assert.ok(migratedIgor.traceIds.some(id => id && !["n114", "n115", "n118", "n116"].includes(id)), "new concept should receive a neural trace");
assert.ok(migratedIgor.claims[0].traceId, "structured relation should receive its own claim engram");
assert.ok(createdLabels.includes("Игорь Головнев → лучший друг"), "the new engram should be labeled as a relationship");
const migratedIdentity = migrated.find(item => item.id === "massistant");
const migratedCreator = migrated.find(item => item.id === "mcreator");
assert.equal(migratedIdentity.claims[0].kind, "identity");
assert.ok(migratedIdentity.claims[0].traceId, "migrated assistant role should receive an engram");
assert.equal(migratedCreator.claims[0].predicate, "создатель");
const persistedObservation = JSON.parse(database.get("neurogenesis.memories.v1")).find(item=>item.id==="mobservation");
assert.equal(persistedObservation.claims[0].sourceMemoryId,"mobservation");
assert.equal(persistedObservation.claims[0].observationCase.schema,2);
assert.ok(migratedCreator.claims[0].traceId, "migrated creator fact should receive an engram");
(async () => {
  // Exercise the actual remember-button -> submit("remember") path.
  const rememberInput = document.getElementById("memory-input");
  const rememberButton = document.getElementById("remember-button");
  const beforeRememberCount = window.NGMemory.count();
  const filler = "Как дела?";
  rememberInput.value = filler;
  await rememberButton.dispatch("click");
  assert.equal(window.NGMemory.count(), beforeRememberCount,
    "small talk submitted through the UI must not create a durable memory");
  const durableAfterFiller = JSON.parse(database.get("neurogenesis.memories.v1"));
  assert.equal(durableAfterFiller.some(item => item.text === filler), false,
    "small talk must be absent from persisted long-term memory");
  const dialogAfterFiller = JSON.parse(database.get("neurogenesis.dialog.v1"));
  assert.ok(dialogAfterFiller.some(item => item.role === "user" && item.text === filler),
    "the small-talk user turn must remain in persisted dialogue history");

  const musicBefore = durableAfterFiller.find(item => item.text === "Музыка прекрасна");
  assert.ok(musicBefore, "the positive-control memory fixture must exist");
  const repetitionsBefore = musicBefore.repetitions;
  rememberInput.value = "Музыка прекрасна";
  rememberButton.dispatch("click");
  const durableAfterMusic = JSON.parse(database.get("neurogenesis.memories.v1"));
  const musicAfter = durableAfterMusic.find(item => item.text === "Музыка прекрасна");
  assert.ok(musicAfter, "meaningful positive-control text must remain in long-term memory");
  assert.ok(musicAfter.repetitions > repetitionsBefore,
    "the real UI remember path must process meaningful text instead of filtering it as small talk");
  assert.ok(JSON.parse(database.get("neurogenesis.dialog.v1"))
    .some(item => item.role === "user" && item.text === "Музыка прекрасна"),
    "the meaningful positive-control turn must remain in dialogue history");

  const importInput=document.getElementById("memory-import-file");
  const importTime=1794159000000;
  const validImportedEdge={id:"valid-import-edge",subject:"Недостаток сна",object:"снижению концентрации"};
  const observationReviewEdge={id:"observation-review-edge",subject:"Недосып",object:"снижению концентрации"};
  const observationAlternativeEdge={id:"observation-alternative-edge",subject:"Стресс",object:"снижению концентрации"};
  const reportedEvidenceEdge={id:"reported-evidence-edge",subject:"Усталость",object:"снижению концентрации",
    evidence:"По данным исследования, усталость приводит к снижению концентрации"};
  const importedReasoning={
    version:1,type:"derived_hypotheses",createdAt:importTime,status:"current",
    conclusions:[
      {subject:"Недостаток сна",object:"снижению концентрации",paths:[[validImportedEdge]]},
      {subject:"Недосып",object:"снижению концентрации",paths:[[observationReviewEdge],[observationAlternativeEdge]]},
      {subject:"В отчёте говорится, что усталость",object:"снижению концентрации",paths:[[validImportedEdge]]},
      {subject:"Усталость",object:"снижению концентрации",paths:[[reportedEvidenceEdge]]}
    ],
    reviews:[
      {claimId:"missing-import-source",kind:"counterexample",phase:"subsequent",
        subject:"Недостаток сна",object:"снижению концентрации",edgeSubject:"Недостаток сна",
        edgeObject:"снижению концентрации",at:importTime+10,evidence:"Архивный контрпример без исходной карточки"},
      {claimId:"valid-import-causal",kind:"supporting_claim",phase:"subsequent",
        subject:"Недостаток сна",object:"снижению концентрации",edgeSubject:"Недостаток сна",
        edgeObject:"снижению концентрации",at:importTime+20,evidence:"Архивный текст, не совпадающий с исходной запись"}
    ],
    modelHistory:[{at:importTime,edges:[
      {subject:"что усталость",object:"снижению концентрации",status:"challenged",decision:"restore",claimIds:["bad-import-claim"]}
    ],alternatives:[
      {subject:"В отчёте говорится, что усталость",object:"снижению концентрации",paths:[[validImportedEdge]]},
      {subject:"Усталость",object:"снижению концентрации",paths:[[reportedEvidenceEdge]]}
    ]}]
  };
  const importedDialogReasoning={
    version:1,type:"derived_hypotheses",createdAt:importTime+1000,status:"current",
    conclusions:[{subject:"что усталость",object:"снижению концентрации",paths:[[
      {id:"dialog-malformed-edge",subject:"что усталость",object:"снижению концентрации"}
    ]]}],
    reviews:[],modelHistory:[]
  };
  const importedBackup={
    format:"NEUROGENESIS_MEMORY_BACKUP",version:2,memories:[{
      id:"bad-import-memory",text:"Архивная запись без причинного разбора",createdAt:importTime,
      claims:[{id:"bad-import-claim",kind:"causal",subject:"что усталость",predicate:"приводит к",
        object:"снижению концентрации",evidence:"что усталость приводит к снижению концентрации"}]
    },{
      id:"valid-import-source",text:"Недостаток сна приводит к снижению концентрации",createdAt:importTime+1,
      claims:[{id:"valid-import-causal",kind:"causal",subject:"Недостаток сна",predicate:"приводит к",
        object:"снижению концентрации",evidence:"Недостаток сна приводит к снижению концентрации"}]
    }],
    reasoningArchive:[
      {role:"assistant",time:importTime,text:"Импортированный архив",reasoning:importedReasoning},
      {role:"assistant",time:importTime+3000,text:"Архив с исходным снимком",sourceReasoning:{
        version:1,type:"derived_hypotheses",createdAt:importTime+3000,status:"current",
        conclusions:[{subject:"что усталость",object:"снижению концентрации",paths:[[
          {id:"import-source-only-edge",subject:"что усталость",object:"снижению концентрации"}
        ]]}],reviews:[],modelHistory:[]
      }}
    ],
    modelDecisions:[{edgeSubject:"что усталость",edgeObject:"снижению концентрации",strategy:"restore",
      at:importTime+30,claimIds:["bad-import-claim"]}],
    modelEvidence:[{edgeSubject:"что усталость",edgeObject:"снижению концентрации",claimId:"bad-import-claim",
      kind:"supporting_claim",signature:"bad",at:importTime+40,evidence:"По данным исследования, усталость приводит к снижению концентрации"}],
    inquiries:[{
      id:"Q810",signature:"import-lifecycle-persistence-test",kind:"missing_observation",
      edgeSubject:"Недосып",edgeObject:"снижению концентрации",
      question:"Есть ли отдельное наблюдение для этой связи?",
      reason:"Проверка синхронизации статуса гипотезы.",priority:1,status:"open",
      sourceClaimIds:["valid-import-causal"],createdAt:importTime+50,updatedAt:importTime+50
    }],
    cognitiveCycles:[{
      id:"C700",sequence:700,at:importTime+5000,mode:"remember",intent:"memory_write",status:"complete",
      phases:[{name:"perception",status:"complete",summary:"Импортированный цикл"}],
      uncertainty:{level:"medium",supportIndex:55,reasons:["данные из резервной копии"],evidenceCount:1,conflictCount:0,independentSources:0},
      metrics:{inputTokens:3,parsedClaims:1,attentionMatches:0,memoryBefore:0,memoryAfter:1,memoryAdded:1},
      memoryIds:["valid-import-source"],claimIds:["valid-import-causal"]
    }],
    dialog:[
      {role:"assistant",time:importTime+1000,text:"Старый ответ",reasoning:importedDialogReasoning},
      {role:"assistant",time:importTime+2000,text:"Диалог с исходным снимком",sourceReasoning:{
        version:1,type:"derived_hypotheses",createdAt:importTime+2000,status:"current",
        conclusions:[{subject:"В отчёте говорится, что усталость",object:"снижению концентрации",paths:[[
          {id:"dialog-import-source-edge",subject:"В отчёте говорится, что усталость",object:"снижению концентрации"}
        ]]}],reviews:[],modelHistory:[]
      }}
    ]
  };
  importInput.files=[{async text(){return JSON.stringify(importedBackup);}}];
  await importInput.dispatch("change");
  const storedLifecycleAfterImport = JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))
    .find(item=>item.time===importTime).reasoning.conclusions
    .find(item=>item.subject==="Недосып").lifecycle;
  assert.ok(storedLifecycleAfterImport,
    "the archive lifecycle must be synchronized during import persistence, without opening its report");
  assert.equal(storedLifecycleAfterImport.state,"under_review",
    "an imported open inquiry must immediately mark its matching hypothesis as under review");
  window.NGMemory.ask("пропусти вопрос Q810");
  const storedInquiryAfterSkip = JSON.parse(database.get("neurogenesis.inquiries.v1"))
    .find(item=>item.id==="Q810");
  const storedLifecycleAfterSkip = JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))
    .find(item=>item.time===importTime).reasoning.conclusions
    .find(item=>item.subject==="Недосып").lifecycle;
  assert.equal(storedInquiryAfterSkip.status,"skipped",
    "the inquiry command must update the persisted inquiry status");
  assert.equal(storedLifecycleAfterSkip.state,"new",
    "the matching hypothesis state must leave under_review immediately after its only inquiry is skipped");
  assert.ok(storedLifecycleAfterSkip.events.some(item=>item.kind==="state_changed"&&
    item.fromState==="under_review"&&item.toState==="new"),
    "the lifecycle event history must persist the inquiry-driven state transition");
  const skippedResearchGoal=window.NGMemory.goals().find(item=>item.inquiryId==="Q810");
  assert.ok(skippedResearchGoal,"the skipped inquiry must retain its linked research goal");
  assert.equal(skippedResearchGoal.status,"paused",
    "skipping a question must pause its goal without deleting its history");
  const negativeObservationText="При недосыпе не наблюдалось снижение концентрации";
  const parsedNegativeObservation=window.NGKnowledge.extractClaims(negativeObservationText)[0];
  assert.ok(parsedNegativeObservation&&parsedNegativeObservation.kind==="observation"&&
    parsedNegativeObservation.polarity===false,
    "the integration input must be parsed as a direct counter-observation");
  assert.equal(window.NGMemory.remember(negativeObservationText),true,
    "the direct counter-observation must pass through the real memory-write pipeline");
  const storedObservationMemory=JSON.parse(database.get("neurogenesis.memories.v1"))
    .flatMap(item=>item.claims||[]).find(item=>item.id===parsedNegativeObservation.id);
  assert.ok(storedObservationMemory,
    "the counter-observation source claim must be saved in durable memory");
  const storedLifecycleAfterObservation=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))
    .find(item=>item.time===importTime).reasoning.conclusions
    .find(item=>item.subject==="Недосып").lifecycle;
  assert.equal(storedLifecycleAfterObservation.state,"partially_challenged",
    "a new counter-observation must challenge only the affected route when an alternative remains");
  assert.ok(storedLifecycleAfterObservation.challengingClaimIds.includes(parsedNegativeObservation.id),
    "the challenged state must point to the exact counter-observation source claim");
  assert.ok(storedLifecycleAfterObservation.events.some(item=>item.kind==="evidence_added"&&
    item.claimId===parsedNegativeObservation.id),
    "the lifecycle event log must record the counter-observation");
  assert.equal(storedLifecycleAfterObservation.routeReviews.length,2);
  assert.equal(storedLifecycleAfterObservation.routeReviews[0].state,"challenged");
  assert.equal(storedLifecycleAfterObservation.routeReviews[1].state,"under_review",
    "an unaffected alternative route must remain under review when the discriminating question targets it");
  assert.equal(storedLifecycleAfterObservation.routeReviews[1].challengingClaimIds.length,0,
    "an open comparison question must not fabricate counter-evidence against the alternative route");
  assert.ok(storedLifecycleAfterObservation.routeReviews[1].pendingInquiryCount>0,
    "the selected discriminating question must be linked to its exact route edge");
  const lifecycleReportAfterObservation=window.NGMemory.hypothesisLifecycleReport();
  assert.match(lifecycleReportAfterObservation,/ЧАСТЬ МАРШРУТОВ ОСПАРИВАЕТСЯ/u);
  assert.match(lifecycleReportAfterObservation,/Маршрут 1 · затронут контрпримером/u);
  assert.match(lifecycleReportAfterObservation,/Маршрут 2 · есть открытый вопрос/u);
  const routeQuestions=window.NGMemory.inquiries();
  assert.ok(routeQuestions.some(item=>item.kind==="discriminating_observations"&&
    item.comparisonEdges.some(edge=>edge.subject==="Недосып")&&
    item.comparisonEdges.some(edge=>edge.subject==="Стресс")),
    "the existing research queue must offer a targeted comparison of the two alternative routes");
  const routeResearchPlan=window.NGMemory.researchStrategy();
  assert.match(routeResearchPlan,/два возможных маршрута/u,
    "the research planner must select a discriminating question for the surviving alternative");
  const discriminatingInquiry=routeQuestions.find(item=>item.kind==="discriminating_observations"&&
    item.comparisonEdges.some(edge=>edge.subject==="Недосып")&&
    item.comparisonEdges.some(edge=>edge.subject==="Стресс"));
  assert.ok(discriminatingInquiry,"the route comparison must have one stable inquiry identity");
  const initialComparisonGoal=window.NGMemory.goals().find(item=>item.inquiryId===discriminatingInquiry.id);
  assert.ok(initialComparisonGoal,"a route comparison inquiry must produce one linked research goal");
  assert.equal(initialComparisonGoal.status,"active",
    "a new comparison inquiry must begin as an active research goal");
  assert.equal(window.NGMemory.goals().filter(item=>item.kind==="discriminating_observations").length,1,
    "alternative routes must share one comparison goal rather than spawning one goal per branch");

  assert.equal(window.NGMemory.remember(
    "Ответ на вопрос "+discriminatingInquiry.id+": Нет прямых наблюдений для сравнения."
  ),true,"the real memory pipeline must accept a discriminating-inquiry answer");
  const answeredComparison=window.NGMemory.inquiries().find(item=>item.id===discriminatingInquiry.id);
  assert.equal(answeredComparison.status,"answered");
  assert.equal(answeredComparison.assessment,"gap_confirmed",
    "an explicit no-observation answer must be recorded as a historical evidence gap");
  const blockedComparisonGoal=window.NGMemory.goals().find(item=>item.inquiryId===discriminatingInquiry.id);
  assert.equal(blockedComparisonGoal.status,"blocked",
    "a confirmed lack of observations must block reassessment until new evidence arrives");

  const alternativeObservationText="При стрессе наблюдалось снижение концентрации";
  const alternativeObservation=window.NGKnowledge.extractClaims(alternativeObservationText)
    .find(item=>item.kind==="observation");
  assert.ok(alternativeObservation&&alternativeObservation.polarity!==false,
    "the alternative-route integration input must parse as a direct positive observation");
  assert.equal(window.NGMemory.remember(alternativeObservationText),true,
    "the alternative-route observation must pass through the durable memory-write pipeline");
  const reviewedComparisonGoal=window.NGMemory.goals().find(item=>item.inquiryId===discriminatingInquiry.id);
  assert.equal(reviewedComparisonGoal.status,"review",
    "new evidence on the second route must unblock the previously blocked comparison goal");
  assert.equal(reviewedComparisonGoal.observationsAfterAssessment,1,
    "the alternative-route observation must be counted after the old assessment");
  assert.ok(reviewedComparisonGoal.evidenceClaimIds.includes(alternativeObservation.id),
    "the reopened goal must retain the exact source claim from the alternative route");
  assert.equal(window.NGMemory.inquiries().find(item=>item.id===discriminatingInquiry.id).assessment,"gap_confirmed",
    "new observations must not overwrite the user's historical answer or its assessment");

  window.NGMemory.refreshInquiries();
  window.NGMemory.refreshInquiries();
  const refreshedQuestions=window.NGMemory.inquiries();
  assert.equal(refreshedQuestions.filter(item=>item.kind==="discriminating_observations"&&
    item.signature===discriminatingInquiry.signature).length,1,
    "repeated queue refreshes must not recreate an answered comparison question");
  assert.equal(window.NGMemory.goals().filter(item=>item.inquiryId===discriminatingInquiry.id).length,1,
    "repeated reconciliation must not create duplicate goals for the same comparison inquiry");
  assert.equal(window.NGMemory.modelDecisions().some(item=>item.edgeSubject==="Недосып"),false,
    "a counter-observation must not silently change the working-model decision");
  const importedCycles=window.NGMemory.cognitiveCycles();
  assert.ok(importedCycles.some(item=>item.at===1794158800000&&item.id==="C700"),
    "backup import must retain the cognitive-cycle history already stored on this device");
  const restoredImportedCycle=importedCycles.find(item=>item.at===importTime+5000);
  assert.ok(restoredImportedCycle,
    "backup import must restore cognitive cycles from the optional v2 field");
  assert.notEqual(restoredImportedCycle.id,"C700",
    "a cycle imported from another local sequence with a colliding ID must receive a unique ID");
  assert.equal(new Set(importedCycles.map(item=>item.id)).size,importedCycles.length,
    "merged cognitive cycles must have unique IDs");
  assert.equal(new Set(importedCycles.map(item=>item.sequence)).size,importedCycles.length,
    "merged cognitive cycles must have unique sequence numbers");
  const storedCycles=JSON.parse(database.get("neurogenesis.cognitive-cycles.v1"));
  assert.ok(storedCycles.some(item=>item.at===importTime+5000),
    "restored cognitive cycles must be persisted in local storage");
  const cycleCountBeforeLegacyImport=window.NGMemory.cognitiveCycles().length;
  importInput.files=[{async text(){return JSON.stringify({
    format:"NEUROGENESIS_MEMORY_BACKUP",version:2,memories:[]
  });}}];
  await importInput.dispatch("change");
  assert.equal(window.NGMemory.cognitiveCycles().length,cycleCountBeforeLegacyImport,
    "a legacy v2 backup without the optional cognitiveCycles field must not erase local cycle history");
  assert.equal(JSON.parse(database.get("neurogenesis.cognitive-cycles.v1")).length,cycleCountBeforeLegacyImport,
    "legacy backup import must leave the persisted cognitive-cycle history intact");
  const importedRows=window.NGMemory.reasoningHistory();
  const importedArchiveRow=importedRows.find(item=>item.time===importTime);
  assert.ok(importedArchiveRow);
  assert.deepEqual(importedArchiveRow.conclusions.map(item=>item.subject),["Недостаток сна","Недосып"],
    "backup import must preserve valid conclusions while excluding malformed conclusion subjects");
  assert.ok(importedArchiveRow.excludedPaths.some(item=>item.origin==="conclusion"&&item.subject==="В отчёте говорится, что усталость"),
    "the malformed conclusion must be retained as an excluded archive path");
  assert.ok(importedArchiveRow.excludedPaths.some(item=>item.origin==="snapshot_edge"&&item.subject==="что усталость"),
    "malformed model-history edges must remain excluded from active snapshots");
  assert.ok(importedArchiveRow.excludedPaths.some(item=>item.origin==="snapshot_alternative"),
    "malformed snapshot alternatives must also remain excluded rather than becoming routes");
  assert.ok(importedArchiveRow.excludedPaths.some(item=>item.reason==="reported_causal_statement"&&item.subject==="Усталость"),
    "report-attributed evidence on an otherwise-valid route must remain excluded in the archive projection");
  const storedImportedArchive=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))
    .find(item=>item.time===importTime);
  assert.ok(storedImportedArchive.reasoning.reviews.some(item=>item.claimId==="missing-import-source"),
    "unverified review metadata must remain in the archive for historical inspection");
  const importedDialogRow=importedRows.find(item=>item.time===importTime+1000);
  assert.ok(importedDialogRow&&importedDialogRow.conclusions.length===0,
    "reasoning embedded in imported dialogue must pass through the same archive guard");
  assert.ok(importedDialogRow.excludedPaths.some(item=>item.reason==="malformed_causal_subject"));
  const importedSourceArchiveRow=importedRows.find(item=>item.time===importTime+3000);
  assert.ok(importedSourceArchiveRow&&importedSourceArchiveRow.conclusions.length===0,
    "backup reasoningArchive sourceReasoning must be sanitized before it can be reused");
  assert.ok(importedSourceArchiveRow.excludedPaths.some(item=>item.reason==="malformed_causal_subject"));
  const importedSourceDialogRow=importedRows.find(item=>item.time===importTime+2000);
  assert.ok(importedSourceDialogRow&&importedSourceDialogRow.conclusions.length===0,
    "backup dialogue sourceReasoning must be sanitized before it can be reused");
  assert.ok(importedSourceDialogRow.excludedPaths.some(item=>item.reason==="malformed_causal_subject"));
  const persistedImportedSource=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))
    .find(item=>item.time===importTime+3000);
  assert.equal(persistedImportedSource.sourceReasoning.conclusions[0].subject,"что усталость",
    "backup import must preserve the original malformed source snapshot without activating it");
  assert.ok(!window.NGMemory.claims().some(claim=>claim.subject==="что усталость"||claim.subject==="В отчёте говорится, что усталость"),
    "malformed claims from imported memories must not enter active knowledge");
  const importedGraph=window.NGMemory.knowledgeGraph();
  assert.ok(!importedGraph.nodes.some(node=>node.type==="claim"&&
    (node.subject==="что усталость"||node.subject==="В отчёте говорится, что усталость")),
    "malformed imported claims must not enter the active knowledge graph");
  const importedLifecycles=window.NGMemory.hypothesisLifecycle();
  assert.ok(importedLifecycles.some(item=>item.subject==="Недостаток сна"&&item.object==="снижению концентрации"),
    "valid archived hypotheses must still receive lifecycle records");
  assert.ok(!importedLifecycles.some(item=>item.subject==="что усталость"||item.subject==="В отчёте говорится, что усталость"),
    "excluded archive subjects must not receive active lifecycle records");
  const validImportedLifecycle=importedLifecycles.find(item=>item.subject==="Недостаток сна"&&item.object==="снижению концентрации");
  assert.ok(validImportedLifecycle);
  assert.notEqual(validImportedLifecycle.state,"challenged",
    "an archived review without a matching imported source claim must not challenge the valid conclusion");
  assert.equal(validImportedLifecycle.challengingClaimIds.length,0);
  assert.equal(validImportedLifecycle.supportingClaimIds.length,0,
    "a review that reuses a real source ID but changes its evidence must not become active support");
  assert.ok(!window.NGMemory.modelDecisions().some(item=>item.edgeSubject==="что усталость"),
    "an imported restore decision with a malformed causal subject must not enter the active decision ledger");
  assert.ok(!window.NGMemory.modelEvidence().some(item=>item.edgeSubject==="что усталость"),
    "report-attributed model evidence with a malformed subject must not be presented as active evidence");
  const importedRevision=window.NGMemory.modelEvolution();
  assert.doesNotMatch(importedRevision,/Недостаток сна → снижению концентрации — ПОД ВОПРОСОМ/u,
    "unverified archived review metadata must not mark a valid route as challenged");
  assert.match(importedRevision,/Недостаток сна → снижению концентрации — НЕТ ОТДЕЛЬНЫХ НАБЛЮДЕНИЙ/u,
    "the route should remain unobserved until a matching source claim is available");

  // The archive guard must remain safe even if NGKnowledge did not load.
  const fallbackDatabase=new Map();
  const fallbackArchiveTime=1794159100000;
  const fallbackRawReasoning={
    version:1,type:"derived_hypotheses",createdAt:fallbackArchiveTime,status:"current",
    conclusions:[
      {subject:"Исследование показало, что усталость",object:"снижению концентрации",
        paths:[[{id:"fallback-reported-subject",subject:"Исследование показало, что усталость",
          object:"снижению концентрации"}]]},
      {subject:"Усталость",object:"снижению концентрации",
        paths:[[{id:"fallback-reported-evidence",subject:"Усталость",object:"снижению концентрации",
          evidence:"Исследование показало, что усталость приводит к снижению концентрации"}]]},
      {subject:"Перегрузка",object:"усталости",
        evidence:"Исследование показало, что перегрузка приводит к усталости",
        paths:[[{id:"fallback-reported-conclusion",subject:"Перегрузка",object:"усталости"}]]}
    ],
    reviews:[],modelHistory:[{at:fallbackArchiveTime,edges:[],alternatives:[
      {subject:"Недосып",object:"усталости",
        evidence:"Исследование показало, что недосып приводит к усталости",
        paths:[[{subject:"Недосып",object:"усталости"}]]}
    ]}]
  };
  fallbackDatabase.set("neurogenesis.reasoning-archive.v1",JSON.stringify([
    {role:"assistant",time:fallbackArchiveTime,text:"Fallback archive",sourceReasoning:fallbackRawReasoning}
  ]));
  fallbackDatabase.set("neurogenesis.model-decisions.v1",JSON.stringify([
    {edgeSubject:"что усталость",edgeObject:"снижению концентрации",strategy:"restore",at:fallbackArchiveTime,
      evidence:"Утверждение, что усталость приводит к снижению концентрации"},
    {edgeSubject:"Усталость",edgeObject:"снижению концентрации",strategy:"restore",at:fallbackArchiveTime+1,
      evidence:"Исследование показало, что усталость приводит к снижению концентрации"},
    {edgeSubject:"Недостаток сна",edgeObject:"усталости",strategy:"restore",at:fallbackArchiveTime+2,
      evidence:"Недостаток сна привёл к усталости"}
  ]));
  fallbackDatabase.set("neurogenesis.model-evidence.v1",JSON.stringify([
    {edgeSubject:"что усталость",edgeObject:"снижению концентрации",kind:"supporting_claim",
      claimId:"fallback-bad-subject",signature:"fallback-bad-subject",
      evidence:"Недостаток сна привёл к усталости"},
    {edgeSubject:"Усталость",edgeObject:"снижению концентрации",kind:"supporting_claim",
      claimId:"fallback-reported-evidence",signature:"fallback-reported-evidence",
      evidence:"Исследование показало, что усталость приводит к снижению концентрации"},
    {edgeSubject:"Недостаток сна",edgeObject:"усталости",kind:"supporting_claim",
      claimId:"fallback-valid-evidence",signature:"fallback-valid-evidence",
      evidence:"Недостаток сна привёл к усталости"}
  ]));
  const fallbackLocalStorage={
    getItem(key){return fallbackDatabase.has(key)?fallbackDatabase.get(key):null;},
    setItem(key,value){fallbackDatabase.set(key,String(value));},
    removeItem(key){fallbackDatabase.delete(key);}
  };
  const fallbackWindow={...window};
  delete fallbackWindow.NGKnowledge;
  const fallbackSandbox={...sandbox,window:fallbackWindow,localStorage:fallbackLocalStorage};
  vm.runInNewContext(fs.readFileSync("memory.js","utf8"),fallbackSandbox,{filename:"memory-fallback.js"});
  const fallbackHistory=fallbackWindow.NGMemory.reasoningHistory();
  assert.equal(fallbackHistory.length,1);
  assert.equal(fallbackHistory[0].conclusions.length,0,
    "reported causal summaries must not become active when the main knowledge validator is unavailable");
  assert.ok(fallbackHistory[0].excludedPaths.some(item=>item.reason==="reported_causal_statement"&&
    item.subject==="Исследование показало, что усталость"),
    "the fallback archive guard must retain the reporting subject as an excluded historical path");
  assert.ok(fallbackHistory[0].excludedPaths.some(item=>item.reason==="reported_causal_statement"&&
    item.subject==="Усталость"),
    "the fallback archive guard must reject a valid-looking path whose evidence is only a research report");
  assert.ok(fallbackHistory[0].excludedPaths.some(item=>item.reason==="reported_causal_statement"&&
    item.subject==="Перегрузка"),
    "the fallback archive guard must reject a valid-looking conclusion with report-only evidence");
  assert.ok(fallbackHistory[0].excludedPaths.some(item=>item.origin==="snapshot_alternative"&&
    item.reason==="reported_causal_statement"&&item.subject==="Недосып"),
    "the fallback archive guard must also reject report-attributed snapshot alternatives");
  const fallbackDecisions=fallbackWindow.NGMemory.modelDecisions();
  assert.equal(fallbackDecisions.length,1,
    "the fallback guard must not reactivate malformed or report-attributed restore decisions");
  assert.equal(fallbackDecisions[0].edgeSubject,"Недостаток сна",
    "a valid restore decision with direct evidence should remain available without NGKnowledge");
  const fallbackEvidence=fallbackWindow.NGMemory.modelEvidence();
  assert.equal(fallbackEvidence.length,1,
    "the fallback guard must reject malformed subjects and report-attributed model evidence");
  assert.equal(fallbackEvidence[0].claimId,"fallback-valid-evidence",
    "a valid direct evidence item should remain available without NGKnowledge");
  const fallbackPersisted=JSON.parse(fallbackDatabase.get("neurogenesis.reasoning-archive.v1"))[0];
  assert.equal(fallbackPersisted.sourceReasoning.conclusions[0].subject,"Исследование показало, что усталость",
    "the raw source snapshot must remain available for historical inspection");
  const beforeCount = window.NGMemory.count();
  const beforeClaims = window.NGMemory.claims().length;
  window.NGMemory.configureLLM({
    endpoint:"https://neurogenesis-test.workers.dev",
    clientToken:"integration-client-token"
  }, async (url, options) => {
    if (String(url).endsWith("/api/health")) {
      return { ok:true, status:200, async json() { return { ok:true, configured:true, model:"integration-test-model" }; } };
    }
    if (String(url).endsWith("/api/chat")) {
      return { ok:true, status:200, async json() { return { ok:true, reply:"Интеграционный ответ языковой модели" }; } };
    }
    return { ok:false, status:404, async json() { return { error:"not_found" }; } };
  });
  const health = await window.NGMemory.testLLMConnection();
  assert.equal(health.model, "integration-test-model");
  assert.equal(window.NGMemory.llmStatus().verified, true);
  const cyclesBeforeLLM = window.NGMemory.cognitiveCycles().length;
  const sent = await window.NGMemory.askLLM("А почему?");
  assert.equal(sent, true, "the integrated LLM request should return a response");
  assert.equal(window.NGMemory.count(), beforeCount, "an LLM answer must not create a durable memory");
  assert.equal(window.NGMemory.claims().length, beforeClaims, "an LLM answer must not alter structured knowledge");
  assert.match(window.NGMemory.dialogHistory().slice(-1)[0].text, /Интеграционный ответ языковой модели/u);
  const successfulLLMCycle = window.NGMemory.cognitiveCycles().slice(-1)[0];
  assert.equal(window.NGMemory.cognitiveCycles().length, cyclesBeforeLLM + 1,
    "a completed external model request must create exactly one cognitive cycle");
  assert.equal(successfulLLMCycle.mode, "llm",
    "the cognitive cycle must distinguish language-model requests from local reasoning");
  assert.equal(successfulLLMCycle.status, "complete");
  assert.match(successfulLLMCycle.phases.find(item => item.name === "reasoning").summary,
    /подключённой языковой модели/u);
  assert.match(successfulLLMCycle.phases.find(item => item.name === "verification").summary,
    /не считается независимой проверкой/u);
  assert.match(successfulLLMCycle.phases.find(item => item.name === "memory").summary,
    /долговременная память и структурированные знания не изменялись/u);

  let releaseChat = null;
  let concurrentChatCalls = 0;
  window.NGMemory.configureLLM({
    endpoint:"https://neurogenesis-test.workers.dev",
    clientToken:"integration-client-token"
  }, async (url) => {
    if (String(url).endsWith("/api/health")) {
      return { ok:true, status:200, async json() { return { ok:true, configured:true, model:"integration-test-model" }; } };
    }
    if (String(url).endsWith("/api/chat")) {
      concurrentChatCalls++;
      return new Promise(resolve => {
        releaseChat = () => resolve({
          ok:true, status:200,
          async json() { return { ok:true, reply:"Ответ после ожидания" }; }
        });
      });
    }
    return { ok:false, status:404, async json() { return { error:"not_found" }; } };
  });
  await window.NGMemory.testLLMConnection();
  const askButton = document.getElementById("llm-ask-button");
  const firstRequest = window.NGMemory.askLLM("Проверка двойного запуска");
  assert.equal(askButton.disabled, true, "the LLM action must be disabled while a request is active");
  assert.equal(typeof releaseChat, "function", "the test must hold the first model response open");
  assert.equal(await window.NGMemory.askLLM("Повторный клик"), false,
    "a second request must be rejected while the first one is pending");
  assert.equal(concurrentChatCalls, 1, "two taps must not create parallel provider requests");
  releaseChat();
  assert.equal(await firstRequest, true, "the original request must complete normally");
  assert.equal(askButton.disabled, false, "the LLM action must be re-enabled after success");
  const cyclesBeforeLLMFailure = window.NGMemory.cognitiveCycles().length;
  window.NGMemory.configureLLM({
    endpoint:"https://neurogenesis-test.workers.dev",
    clientToken:"integration-client-token"
  }, async (url) => {
    if (String(url).endsWith("/api/health")) {
      return { ok:true, status:200, async json() { return { ok:true, configured:true, model:"integration-test-model" }; } };
    }
    if (String(url).endsWith("/api/chat")) {
      return { ok:false, status:503, async json() { return { error:"provider_unavailable" }; } };
    }
    return { ok:false, status:404, async json() { return { error:"not_found" }; } };
  });
  await window.NGMemory.testLLMConnection();
  assert.equal(await window.NGMemory.askLLM("Проверь обработку ошибки провайдера"), false,
    "a failed provider request must not be reported as a successful response");
  const failedLLMCycle = window.NGMemory.cognitiveCycles().slice(-1)[0];
  assert.equal(window.NGMemory.cognitiveCycles().length, cyclesBeforeLLMFailure + 1,
    "a failed external model request must also be recorded for diagnostics");
  assert.equal(failedLLMCycle.mode, "llm");
  assert.equal(failedLLMCycle.status, "error",
    "a provider failure must be recorded as an error cycle, not as completed reasoning");
  assert.equal(failedLLMCycle.phases.find(item => item.name === "reasoning").status, "limited");
  // The existing research planner must prioritize review goals created by new evidence,
  // even when the question that originally produced the goal is already answered.
  const priorGoalsManager = window.NGGoals;
  window.NGGoals = {
    list() {
      return [{
        id:"G-Q77",inquiryId:"Q77",title:"Уточнить связь «Недостаток сна → усталость»",
        status:"review",assessment:"gap_confirmed",
        assessmentReason:"На момент прежнего ответа прямых наблюдений не было.",
        observationsAfterAssessment:2,observationCount:3,completeObservationCount:2,
        metadataCoverage:75,selected:true,focusScore:88,updatedAt:1794159900000,
        blockers:[],
        nextAction:"После предыдущей оценки появились 2 новых прямых наблюдения. Повторно сопоставить их контекст, время и критерий."
      }];
    }
  };
  const reassessmentPlan = window.NGMemory.researchStrategy();
  assert.match(reassessmentPlan,/ПЛАН ИССЛЕДОВАНИЯ · ПОВТОРНАЯ ОЦЕНКА/u,
    "the research planner must route review goals to a reassessment plan");
  assert.match(reassessmentPlan,/G-Q77/u,
    "the plan must identify the exact goal that needs reassessment");
  assert.match(reassessmentPlan,/Наблюдений после прежней оценки: 2/u,
    "the plan must use the existing post-assessment evidence count");
  assert.match(reassessmentPlan,/не переписывают старый ответ/u,
    "the plan must preserve the historical assessment instead of silently rewriting it");
  window.NGGoals = priorGoalsManager;

  console.log("NEUROGENESIS legacy migration, LLM integration and request-lock tests: passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
