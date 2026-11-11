"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["knowledge.js", "semantic-core.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const core = window.NGSemanticCore;
const knowledge = window.NGKnowledge;
assert.ok(core && core.version === 2, "semantic core v2 must be loaded");

const equivalentQuantityQuestions = [
  { query: "Сколько сердец у осьминога?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Какое количество сердец у осьминога?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Как много сердец у осьминога?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Назови число сердец у осьминога.", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "У осьминога сколько сердец?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Сколько у осьминога сердец?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Сердец у осьминога сколько?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Сколько сердечных камер у головоногого?", subject: /головоног/iu, attribute: /сердечн.*камер|камер/iu },
  { query: "Сколько у головоногого сердечных камер?", subject: /головоног/iu, attribute: /сердечн.*камер|камер/iu },
  { query: "Назови количество сердечных камер у головоногого.", subject: /головоног/iu, attribute: /сердечн.*камер|камер/iu },
  { query: "Каково число сердечных камер головоногого?", subject: /головоног/iu, attribute: /сердечн.*камер|камер/iu },
  { query: "Сколько сердец насчитывается у осьминога?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Сколько сердец имеет осьминог?", subject: /осьминог/iu, attribute: /сердец/iu },
  { query: "Сколько органов, перекачивающих кровь, у осьминога?", subject: /осьминог/iu, attribute: /органов.*кровь/iu },
  { query: "У осьминога сколько органов, перекачивающих кровь?", subject: /осьминог/iu, attribute: /органов.*кровь/iu },
  { query: "Сколько сердечных камер у синего кита?", subject: /синего кита/iu, attribute: /сердечн.*камер|камер/iu }
];

const failures = [];
for (const testCase of equivalentQuantityQuestions) {
  const frame = core.analyse(testCase.query, { contextRelation: "new_topic" }, knowledge);
  if (frame.answerType !== "quantity" ||
      !frame.subject || !testCase.subject.test(frame.subject.text) ||
      !frame.attribute || !testCase.attribute.test(frame.attribute.text)) {
    failures.push({
      query: testCase.query,
      answerType: frame.answerType,
      subject: frame.subject && frame.subject.text,
      attribute: frame.attribute && frame.attribute.text
    });
  }
}
assert.deepEqual(failures, [], "equivalent phrasings must yield the same subject/property slots");

const inherited = core.analyse("Сколько у него сердечных камер?", {
  contextRelation: "follow_up",
  contextText: "Сколько сердечных камер у головоногого?"
}, knowledge);
assert.match(inherited.subject.text, /головоног/iu);
assert.match(inherited.attribute.text, /сердечн.*камер|камер/iu);
assert.equal(inherited.subject.certainty, "context_candidate");
assert.equal(inherited.discourse.relation, "follow_up");

const inheritedEllipsis = core.analyse("А у него сколько?", {
  contextRelation: "follow_up",
  contextText: "Сколько сердец у осьминога?"
}, knowledge);
assert.match(inheritedEllipsis.subject.text, /осьминог/iu);
assert.match(inheritedEllipsis.attribute.text, /сердец/iu);

const intentCases = [
  ["Объясни, что такое трансформер.", "definition", "explanation_request"],
  ["Почему нейроны активируются?", "causal", "causal_question"],
  ["Как настроить приложение?", "procedure", "instruction_request"],
  ["Где находится Таллин?", "location", "factual_question"],
  ["Когда начался эксперимент?", "time", "factual_question"],
  ["Правда ли, что у осьминога три сердца?", "boolean", "factual_question"],
  ["Сравни два способа обучения.", "comparison", "comparison_request"],
  ["Сколько нейронов в сети?", "quantity", "factual_question"]
];
for (const [query, answer, intent] of intentCases) {
  const frame = core.analyse(query, { contextRelation: "new_topic" }, knowledge);
  assert.equal(frame.answerType, answer, "answer type for: " + query);
  assert.equal(frame.intent, intent, "intent for: " + query);
}

const negative = core.analyse("Почему сеть не активируется?", { contextRelation: "new_topic" }, knowledge);
assert.equal(negative.constraints.polarity, "negative");

const untrusted = core.validateFrame({
  intent: "execute_arbitrary_code",
  answerType: "unknown",
  subject: { text: "осьминог" },
  attribute: { text: "сердца" },
  confidence: 2,
  entities: Array.from({ length: 20 }, (_, index) => ({ text: "entity-" + index }))
}, {}, knowledge);
assert.equal(untrusted.intent, "factual_question");
assert.equal(untrusted.answerType, "description");
assert.equal(untrusted.confidence, 1);
assert.equal(untrusted.entities.length, 8);

console.log("NEUROGENESIS semantic understanding benchmark: " +
  equivalentQuantityQuestions.length + " paraphrases, " +
  intentCases.length + " intent/type cases, context and validation checks passed.");
