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
assert.ok(core && core.version === 3, "semantic core v3 must be loaded");

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
  ["Сколько нейронов в сети?", "quantity", "factual_question"],
  ["Назови количество сердечных камер у головоногого.", "quantity", "statement"],
  ["Где расположено ядро системы?", "location", "factual_question"]
];
for (const [query, answer, intent] of intentCases) {
  const frame = core.analyse(query, { contextRelation: "new_topic" }, knowledge);
  assert.equal(frame.answerType, answer, "answer type for: " + query);
  assert.equal(frame.intent, intent, "intent for: " + query);
}

const ellipticalPronoun = core.analyse("А у него сколько?", {
  contextRelation: "follow_up",
  contextText: "Сколько сердец у осьминога?"
}, knowledge);
assert.match(ellipticalPronoun.subject.text, /осьминог/iu);
assert.match(ellipticalPronoun.attribute.text, /сердец/iu);
assert.equal(ellipticalPronoun.subject.certainty, "context_candidate");

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
assert.equal(untrusted.entities[0].text, "осьминог",
  "the primary subject must remain in the bounded entity list");


const propositions = [
  {
    text: "Сеть не активируется.",
    kind: "assertion", subject: /сеть/iu, predicate: /активируется/iu,
    object: null, polarity: "negative", modality: "asserted"
  },
  {
    text: "Недостаток сна может приводить к усталости.",
    kind: "hypothesis", subject: /недостаток сна/iu, predicate: /приводить к/iu,
    object: /усталости/iu, polarity: "positive", modality: "possible"
  },
  {
    text: "У осьминога три сердца.",
    kind: "assertion", subject: /осьминога/iu, predicate: /имеет/iu,
    object: /три сердца/iu, relation: "has"
  },
  {
    text: "Вчера сеть работала.",
    kind: "assertion", subject: /сеть/iu, predicate: /работала/iu,
    temporal: "past"
  },
  {
    text: "Возможно, система активируется.",
    kind: "hypothesis", modality: "possible"
  },
  {
    text: "Я думаю, что сеть работает.",
    kind: "opinion", modality: "opinion"
  },
  {
    text: "Почему сеть не активируется?",
    kind: "question", assertionStatus: "question"
  },
  {
    text: "Объясни, почему сеть не активируется.",
    kind: "request", assertionStatus: "request"
  },
  {
    text: "Если система получит данные, она активируется.",
    kind: "conditional", assertionStatus: "conditional"
  },
  {
    text: "Он сказал, что сеть не активируется.",
    kind: "reported", assertionStatus: "reported",
    source: "reported_speech"
  },
  {
    text: "«Сеть не активируется».",
    kind: "reported", source: "quoted_text"
  }
];
for (const item of propositions) {
  const frame = core.analyse(item.text, { contextRelation: "new_topic" }, knowledge);
  const proposition = frame.proposition;
  assert.equal(proposition.schema, "NG_PROPOSITION_FRAME_V1", item.text);
  assert.equal(proposition.kind, item.kind, item.text);
  if (item.subject) assert.match(proposition.subject || "", item.subject, item.text);
  if (item.predicate) assert.match(proposition.predicate || "", item.predicate, item.text);
  if (item.object) assert.match(proposition.object || "", item.object, item.text);
  if (item.object === null) assert.equal(proposition.object, null, item.text);
  if (item.polarity) assert.equal(proposition.polarity, item.polarity, item.text);
  if (item.modality) assert.equal(proposition.modality, item.modality, item.text);
  if (item.relation) assert.equal(proposition.relation, item.relation, item.text);
  if (item.temporal) assert.equal(proposition.temporal.relation, item.temporal, item.text);
  if (item.assertionStatus) assert.equal(proposition.assertionStatus, item.assertionStatus, item.text);
  if (item.source) assert.equal(proposition.attribution.source, item.source, item.text);
}
const noFactFromQuestion = core.analyse("Сколько сердец у осьминога?", {
  contextRelation: "new_topic"
}, knowledge).proposition;
assert.equal(noFactFromQuestion.assertionStatus, "question");
assert.equal(noFactFromQuestion.predicate, null,
  "a question must not be represented as an asserted predicate");
const noFactFromReportedSpeech = core.analyse("В отчёте говорится, что усталость приводит к снижению концентрации.", {
  contextRelation: "new_topic"
}, knowledge).proposition;
assert.equal(noFactFromReportedSpeech.kind, "reported");
assert.equal(noFactFromReportedSpeech.assertionStatus, "reported",
  "a source-attributed statement must not be flattened into a user assertion");

const validatedProposition = core.validateProposition({
  kind: "question", subject: "осьминог", predicate: "создать",
  polarity: "negative", modality: "interrogative", confidence: 3,
  attribution: { speaker: "assistant", source: "assistant_output" }
});
assert.equal(validatedProposition.assertionStatus, "question",
  "validation must derive assertion status from the proposition kind");
assert.equal(validatedProposition.confidence, 1);
assert.equal(validatedProposition.attribution.source, "assistant_output");

const protectedClassificationCases = [
  {
    name: "question",
    base: { kind: "question", confidence: 0.78, polarity: "positive", modality: "interrogative",
      attribution: { speaker: "user", source: "user_utterance" } },
    raw: { kind: "assertion", polarity: "negative", modality: "asserted",
      attribution: { speaker: "assistant", source: "assistant_output" } },
    expectedKind: "question", expectedModality: "interrogative", expectedSource: "user_utterance"
  },
  {
    name: "reported speech",
    base: { kind: "reported", confidence: 0.76, polarity: "positive", modality: "reported",
      attribution: { speaker: "unknown", source: "reported_speech", reportedBy: "Иван" } },
    raw: { kind: "assertion", modality: "asserted",
      attribution: { speaker: "user", source: "user_utterance" } },
    expectedKind: "reported", expectedModality: "reported", expectedSource: "reported_speech"
  },
  {
    name: "hypothesis",
    base: { kind: "hypothesis", confidence: 0.82, polarity: "positive", modality: "possible",
      attribution: { speaker: "user", source: "user_utterance" } },
    raw: { kind: "assertion", modality: "asserted" },
    expectedKind: "hypothesis", expectedModality: "possible", expectedSource: "user_utterance"
  },
  {
    name: "opinion",
    base: { kind: "opinion", confidence: 0.72, polarity: "positive", modality: "opinion",
      attribution: { speaker: "user", source: "user_opinion", reportedBy: "user" } },
    raw: { kind: "assertion", modality: "asserted",
      attribution: { speaker: "assistant", source: "assistant_output" } },
    expectedKind: "opinion", expectedModality: "opinion", expectedSource: "user_opinion"
  },
  {
    name: "conditional",
    base: { kind: "conditional", confidence: 0.82, polarity: "positive", modality: "conditional",
      attribution: { speaker: "user", source: "user_utterance" } },
    raw: { kind: "assertion", modality: "asserted" },
    expectedKind: "conditional", expectedModality: "conditional", expectedSource: "user_utterance"
  },
  {
    name: "request",
    base: { kind: "request", confidence: 0.72, polarity: "positive", modality: "directive",
      attribution: { speaker: "user", source: "user_utterance" } },
    raw: { kind: "assertion", modality: "asserted" },
    expectedKind: "request", expectedModality: "directive", expectedSource: "user_utterance"
  }
];
for (const item of protectedClassificationCases) {
  const result = core.validateProposition(item.raw, item.base);
  assert.equal(result.kind, item.expectedKind, item.name + ": model must not rewrite a protected speech act");
  assert.equal(result.assertionStatus, item.expectedKind === "question" ? "question"
    : item.expectedKind === "reported" ? "reported"
    : item.expectedKind === "hypothesis" ? "hypothetical"
    : item.expectedKind, item.name + ": assertion status must follow the protected kind");
  assert.equal(result.modality, item.expectedModality, item.name + ": modality must remain consistent");
  assert.equal(result.attribution.source, item.expectedSource, item.name + ": attribution must remain grounded");
}
const protectedNegative = core.validateProposition({
  kind: "assertion", polarity: "positive", modality: "asserted"
}, {
  kind: "assertion", polarity: "negative", modality: "asserted", confidence: 0.74
});
assert.equal(protectedNegative.polarity, "negative",
  "a confident local negation must not be flipped to positive by model framing");


console.log("NEUROGENESIS semantic understanding benchmark: " +
  equivalentQuantityQuestions.length + " paraphrases, " +
  intentCases.length + " intent/type cases, context and validation checks passed.");
