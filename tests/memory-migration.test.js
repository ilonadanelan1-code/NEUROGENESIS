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
database.set("neurogenesis.dialog.v1", "[]");
database.set("neurogenesis.inquiries.v1", JSON.stringify([{
  id:"Q1",signature:"legacy-observation-context-test",kind:"contrast_observations",
  edgeSubject:"Недостаток сна",edgeObject:"усталости",question:"Уточни контекст наблюдений",
  status:"answered",createdAt:1794158300000,updatedAt:1794158300000,answeredAt:1794158300000,
  responseText:"Обстоятельства двух наблюдений не указаны. Даты и время неизвестны. Критерий определения результата не описан."
}]));

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
  addEventListener() {}
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
const sandbox = { window, document, localStorage, console, Date, Math, Set, Map, JSON };
vm.runInNewContext(fs.readFileSync("knowledge.js", "utf8"), sandbox, { filename: "knowledge.js" });
vm.runInNewContext(fs.readFileSync("observation-engine.js", "utf8"), sandbox, { filename: "observation-engine.js" });
vm.runInNewContext(fs.readFileSync("knowledge-graph.js", "utf8"), sandbox, { filename: "knowledge-graph.js" });
vm.runInNewContext(fs.readFileSync("reasoning-audit.js", "utf8"), sandbox, { filename: "reasoning-audit.js" });
vm.runInNewContext(fs.readFileSync("hypothesis-lifecycle.js", "utf8"), sandbox, { filename: "hypothesis-lifecycle.js" });
vm.runInNewContext(fs.readFileSync("memory.js", "utf8"), sandbox, { filename: "memory.js" });

assert.equal(window.NGMemory.count(), 6);
assert.deepEqual(window.NGMemory.hypothesisLifecycle(), [], "legacy backups without causal archives should load an empty lifecycle safely");
assert.match(window.NGMemory.hypothesisLifecycleReport(), /Пока нет архивных причинных выводов/u);
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
console.log("NEUROGENESIS legacy memory migration, assistant identity, creator and cross-record profile: passed.");
