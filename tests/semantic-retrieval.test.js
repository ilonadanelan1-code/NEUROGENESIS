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
assert.ok(retrieval && retrieval.version === 1);
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
  usedSources: ["M-OCTOPUS", "NOT-A-SOURCE"], confidence: 0.94, insufficientEvidence: false
}), evidence);
assert.ok(parsed);
assert.deepEqual(Array.from(parsed.usedSources), ["M-OCTOPUS"]);
assert.equal(parsed.confidence, 0.94);
assert.equal(retrieval.parseAnswer(JSON.stringify({
  answer: "У осьминога три сердца.", usedSources: ["INVENTED"], confidence: 0.99, insufficientEvidence: false
}), evidence), null, "answers without a valid local source must be rejected");
assert.equal(retrieval.parseAnswer("not json", evidence), null);
const insufficient = retrieval.parseAnswer(JSON.stringify({
  answer: "В памяти недостаточно сведений, чтобы ответить.", usedSources: [],
  confidence: 0.1, insufficientEvidence: true
}), evidence);
assert.ok(insufficient && insufficient.insufficientEvidence);
console.log("NEUROGENESIS semantic retrieval: entity/property matching, paraphrase invariance, evidence provenance and grounded answer validation passed.");