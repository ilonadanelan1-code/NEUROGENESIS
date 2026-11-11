"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["knowledge.js", "semantic-core.js", "semantic-retrieval.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const knowledge = window.NGKnowledge, core = window.NGSemanticCore, retrieval = window.NGSemanticRetrieval;
assert.ok(retrieval && retrieval.version === 2);
assert.deepEqual(Array.from(knowledge.tokens("сердец")), ["сердц"],
  "irregular Russian genitive plural should normalize to the same stem as «сердца»");
assert.deepEqual(Array.from(knowledge.tokens("сердца")), ["сердц"],
  "the direct plural form should preserve the same semantic stem");
const memory = {
  id: "M-OCTOPUS", text: "У осьминога три сердца.",
  claims: [{ id: "C-OCTOPUS", kind: "fact", subject: "осьминог", predicate: "имеет",
    object: "три сердца", evidence: "У осьминога три сердца.", polarity: true, verification: "user_supplied" }]
};
const unrelated = {
  id: "M-WHALE", text: "У синего кита четыре камеры сердца.",
  claims: [{ id: "C-WHALE", kind: "fact", subject: "синий кит", predicate: "имеет",
    object: "четыре камеры сердца", evidence: "У синего кита четыре камеры сердца." }]
};
const sameMeaning = [
  "Сколько сердец у осьминога?",
  "У осьминога сколько сердец?",
  "Назови число сердец у осьминога."
];
const scores = sameMeaning.map(question => {
  const frame = core.analyse(question, { contextRelation: "new_topic" }, knowledge);
  return { frame, target: retrieval.scoreRecord(frame, memory, knowledge).score,
    unrelated: retrieval.scoreRecord(frame, unrelated, knowledge).score };
});
for (const row of scores) {
  assert.ok(row.target > 0.65, "the relevant source must match both subject and requested property");
  assert.ok(row.target > row.unrelated + 0.25,
    "a memory sharing only the word 'heart' must not outrank the correct entity-property pair");
}
assert.ok(Math.max(...scores.map(row => row.target)) - Math.min(...scores.map(row => row.target)) < 0.001,
  "different surface word orders with the same meaning should retrieve the same evidence");
const heldOutCases = [
  {
    name: "book chapters",
    queries: ["Сколько глав у романа?", "У романа сколько глав?", "Назови число глав у романа."],
    record: { id: "M-NOVEL", text: "В романе 24 главы.", claims: [{
      id: "C-NOVEL", kind: "fact", subject: "роман", predicate: "содержит",
      object: "24 главы", evidence: "В романе 24 главы."
    }] },
    distractor: { id: "M-COLLECTION", text: "В сборнике 10 глав.", claims: [{
      id: "C-COLLECTION", kind: "fact", subject: "сборник", predicate: "содержит",
      object: "10 глав", evidence: "В сборнике 10 глав."
    }] }
  },
  {
    name: "building floors",
    queries: ["Сколько этажей у здания?", "У здания сколько этажей?", "Назови количество этажей у здания."],
    record: { id: "M-BUILDING", text: "В здании 12 этажей.", claims: [{
      id: "C-BUILDING", kind: "fact", subject: "здание", predicate: "имеет",
      object: "12 этажей", evidence: "В здании 12 этажей."
    }] },
    distractor: { id: "M-HOUSE", text: "В частном доме 2 этажа.", claims: [{
      id: "C-HOUSE", kind: "fact", subject: "частный дом", predicate: "имеет",
      object: "2 этажа", evidence: "В частном доме 2 этажа."
    }] }
  },
  {
    name: "city population",
    queries: ["Население Таллина?", "Каково население Таллина?"],
    record: { id: "M-TALLINN", text: "Население Таллина составляет 450 тысяч человек.", claims: [{
      id: "C-TALLINN", kind: "fact", subject: "Таллин", predicate: "имеет население",
      object: "450 тысяч человек", evidence: "Население Таллина составляет 450 тысяч человек."
    }] },
    distractor: { id: "M-TARTU", text: "Население Тарту составляет 95 тысяч человек.", claims: [{
      id: "C-TARTU", kind: "fact", subject: "Тарту", predicate: "имеет население",
      object: "95 тысяч человек", evidence: "Население Тарту составляет 95 тысяч человек."
    }] }
  },
  {
    name: "tower height",
    queries: ["Какова высота Эйфелевой башни?", "Высота Эйфелевой башни?"],
    record: { id: "M-TOWER", text: "Высота Эйфелевой башни — 330 метров.", claims: [{
      id: "C-TOWER", kind: "fact", subject: "Эйфелева башня", predicate: "имеет высоту",
      object: "330 метров", evidence: "Высота Эйфелевой башни — 330 метров."
    }] },
    distractor: { id: "M-BRIDGE", text: "Высота моста — 80 метров.", claims: [{
      id: "C-BRIDGE", kind: "fact", subject: "мост", predicate: "имеет высоту",
      object: "80 метров", evidence: "Высота моста — 80 метров."
    }] }
  }
];
for (const item of heldOutCases) {
  const values = item.queries.map(question => {
    const frame = core.analyse(question, { contextRelation: "new_topic" }, knowledge);
    const target = retrieval.scoreRecord(frame, item.record, knowledge).score;
    const distractorScore = retrieval.scoreRecord(frame, item.distractor, knowledge).score;
    return { question, frame, target, distractorScore };
  });
  for (const row of values) {
    assert.ok(row.target > 0.65,
      item.name + " must be retrievable from a meaning frame: " + row.question);
    assert.ok(row.target > row.distractorScore + 0.25,
      item.name + " must distinguish the requested subject from a distractor sharing the property");
  }
  assert.ok(Math.max(...values.map(row => row.target)) - Math.min(...values.map(row => row.target)) < 0.001,
    item.name + " paraphrases must converge on the same subject/property evidence");
}


const chainMemories = [
  { id: "M-TALLINN-COUNTRY", text: "Таллин находится в Эстонии.", claims: [{
    id: "C-TALLINN-COUNTRY", kind: "fact", subject: "Таллин",
    predicate: "находится в стране", object: "Эстония",
    evidence: "Таллин находится в Эстонии.", verification: "user_supplied"
  }] },
  { id: "M-ESTONIA-PRESIDENT", text: "Президент Эстонии — Алар Карис.", claims: [{
    id: "C-ESTONIA-PRESIDENT", kind: "fact", subject: "Эстония",
    predicate: "президент", object: "Алар Карис",
    evidence: "Президент Эстонии — Алар Карис.", verification: "user_supplied"
  }] },
  { id: "M-LATVIA-PRESIDENT", text: "Президент Латвии — Эдгарс Ринкевичс.", claims: [{
    id: "C-LATVIA-PRESIDENT", kind: "fact", subject: "Латвия",
    predicate: "президент", object: "Эдгарс Ринкевичс",
    evidence: "Президент Латвии — Эдгарс Ринкевичс.", verification: "user_supplied"
  }] },
  { id: "M-REFERENCE-ONLY", text: "Президент Латвии — Эдгарс Ринкевичс; в справке также упоминается Эстония.", claims: [{
    id: "C-REFERENCE-ONLY", kind: "fact", subject: "Латвия",
    predicate: "президент", object: "Эдгарс Ринкевичс",
    evidence: "Президент Латвии — Эдгарс Ринкевичс; справка также упоминает Эстонию.",
    verification: "user_supplied"
  }] },
  { id: "M-ATTRIBUTE-ONLY", text: "Эстония граничит с Латвией; в заметке упоминается президент.", claims: [{
    id: "C-ATTRIBUTE-ONLY", kind: "fact", subject: "Эстония",
    predicate: "граничит с", object: "Латвией",
    evidence: "Эстония граничит с Латвией; в заметке также упоминается президент Эстонии.",
    verification: "user_supplied"
  }] }
];
const evidencePlan = [
  { id: "country", question: "В какой стране находится Таллин?", subject: "Таллин", attribute: "страна" },
  { id: "president", question: "Кто руководит этой страной?", attribute: "президент",
    subjectFrom: { stepId: "country", field: "object" }, dependsOn: ["country"] }
];
const chainFrame = core.analyse("В какой стране находится Таллин и кто президент этой страны?",
  { contextRelation: "new_topic" }, knowledge);
const chainRecall = retrieval.rankClaims(chainFrame, chainMemories, knowledge, evidencePlan);
assert.equal(chainRecall.requirements.length, 2);
assert.equal(chainRecall.requirements[0].matched, true,
  "the first independent requirement must retrieve the city-country relation");
assert.equal(chainRecall.requirements[1].matched, true,
  "the dependent requirement must resolve its subject from the previous claim's object");
assert.equal(chainRecall.complete, true);
assert.ok(chainRecall.paths.some(path => path.claimIds.length === 2),
  "a two-step answer must retain the complete claim path");
assert.ok(chainRecall.evidence.some(item => item.id === "M-TALLINN-COUNTRY"));
assert.ok(chainRecall.evidence.some(item => item.id === "M-ESTONIA-PRESIDENT"));
assert.ok(!chainRecall.evidence.some(item => item.id === "M-LATVIA-PRESIDENT"),
  "a matching property on another country must not be joined into the chain");
assert.ok(!chainRecall.evidence.some(item => item.id === "M-REFERENCE-ONLY"),
  "an entity mentioned only in evidence text must not override the claim's explicit subject");
assert.ok(!chainRecall.evidence.some(item => item.id === "M-ATTRIBUTE-ONLY"),
  "an attribute mentioned only in evidence text must not override the claim's explicit predicate");
const chainRequest = retrieval.buildRequest("В какой стране находится Таллин и кто президент этой страны?",
  "В какой стране находится Таллин и кто президент этой страны?", chainFrame, chainRecall.evidence, chainRecall);
assert.equal(chainRequest.metadata.requiredSteps, 2);
assert.equal(chainRequest.metadata.coveredSteps, 2);
assert.match(chainRequest.messages[0].content, /связывай соседние шаги только через явно совпадающие сущности/u);
const incomplete = retrieval.rankClaims(chainFrame, [chainMemories[0]], knowledge, evidencePlan);
assert.equal(incomplete.complete, false,
  "a dependent step without its source fact must remain unresolved");
assert.equal(incomplete.requirements[1].matched, false);
const conflictMemories = [...chainMemories, {
  id: "M-TALLINN-CONFLICT", text: "Таллин находится в Латвии.", claims: [{
    id: "C-TALLINN-CONFLICT", kind: "fact", subject: "Таллин",
    predicate: "находится в стране", object: "Латвия",
    evidence: "Таллин находится в Латвии.", verification: "user_supplied"
  }]
}];
const conflictRecall = retrieval.rankClaims(chainFrame, conflictMemories, knowledge, evidencePlan);
assert.ok(conflictRecall.conflicts.length > 0,
  "retrieved contradictory claims must be carried into the synthesis evidence package");
assert.equal(retrieval.normaliseEvidencePlan([
  { id: "first", subject: "Таллин", attribute: "страна" },
  { id: "bad", attribute: "президент", subjectFrom: { stepId: "future", field: "object" } }
], chainFrame).length, 1,
"a step may not depend on an unknown or future step");
const staleRecord = { id: "M-OCTOPUS-OLD", text: memory.text,
  claims: memory.claims.map(claim => ({ ...claim, status: "superseded" })) };
const staleRecall = retrieval.rankClaims(scores[0].frame, [staleRecord], knowledge, []);
assert.equal(staleRecall.requirements[0].matched, false,
  "superseded claims must not be used as current evidence, even for a simple question");

const evidence = retrieval.buildEvidence([{ item: memory, score: scores[0].target }, { item: unrelated, score: scores[0].unrelated }]);
assert.equal(evidence.length, 2);
assert.equal(evidence[0].id, "M-OCTOPUS");
const request = retrieval.buildRequest("У осьминога сколько сердец?", "Сколько сердец у осьминога?", scores[0].frame, evidence);
assert.equal(request.schema, "NEUROGENESIS_LLM_REQUEST_V1");
assert.equal(request.metadata.operation, "grounded_memory_answer");
assert.match(request.messages[0].content, /используя только переданные локальные записи/u);
assert.match(request.messages[0].content, /Не отвечай по общим знаниям/u);
assert.match(request.messages[1].content, /M-OCTOPUS/u);
const parsed = retrieval.parseAnswer(JSON.stringify({
  answer: "В сохранённой записи указано, что у осьминога три сердца.",
  usedSources: ["M-OCTOPUS", "NOT-A-SOURCE"], usedClaims: ["C-OCTOPUS", "NOT-A-CLAIM"],
  confidence: 0.94, insufficientEvidence: false
}), evidence);
assert.ok(parsed);
assert.deepEqual(Array.from(parsed.usedSources), ["M-OCTOPUS"]);
assert.deepEqual(Array.from(parsed.usedClaims), ["C-OCTOPUS"],
  "claim citations must be restricted to IDs present in retrieved evidence");
assert.equal(parsed.confidence, 0.94);
const legacyParsed = retrieval.parseAnswer(JSON.stringify({
  answer: "В старой версии ответа перечислен источник без списка claim IDs.",
  usedSources: ["M-OCTOPUS"], confidence: 0.9, insufficientEvidence: false
}), evidence);
assert.ok(legacyParsed && legacyParsed.usedSources.length === 1,
  "the legacy grounded answer format without usedClaims must remain accepted");
assert.equal(legacyParsed.usedClaims.length, 0);
assert.equal(retrieval.parseAnswer(JSON.stringify({
  answer: "У осьминога три сердца.", usedSources: ["INVENTED"], confidence: 0.99, insufficientEvidence: false
}), evidence), null, "answers without a valid local source must be rejected");
assert.equal(retrieval.parseAnswer("not json", evidence), null);
const insufficient = retrieval.parseAnswer(JSON.stringify({
  answer: "В памяти недостаточно сведений, чтобы ответить.", usedSources: [],
  confidence: 0.1, insufficientEvidence: true
}), evidence);
assert.ok(insufficient && insufficient.insufficientEvidence);
const partial = retrieval.parseAnswer(JSON.stringify({
  answer: "Я могу подтвердить только страну; второго факта в памяти нет.",
  usedSources: ["M-OCTOPUS"], usedClaims: ["C-OCTOPUS"],
  confidence: 0.58, insufficientEvidence: true
}), evidence);
assert.ok(partial && partial.usedSources.length === 1,
  "a grounded partial answer must retain its valid source IDs instead of being discarded");
console.log("NEUROGENESIS semantic retrieval: entity/property matching, paraphrase invariance, evidence provenance and grounded answer validation passed.");