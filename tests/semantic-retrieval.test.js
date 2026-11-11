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