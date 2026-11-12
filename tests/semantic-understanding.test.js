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
  if (item.scope) assert.equal(proposition.polarityScope.scope, item.scope, item.text);
  if (item.quantifier) assert.equal(proposition.polarityScope.quantifier, item.quantifier, item.text);
  if (item.scopeEffect) assert.equal(proposition.polarityScope.effect, item.scopeEffect, item.text);
}

const compositionalRoleCases = [
  ["нейрон получает сигнал", "нейрон", "получает", "сигнал"],
  ["сигнал получает нейрон", "сигнал", "получает", "нейрон"],
  ["ключ открывает замок", "ключ", "открывает", "замок"],
  ["замок открывает ключ", "замок", "открывает", "ключ"],
  ["сеть обрабатывает данные", "сеть", "обрабатывает", "данные"],
  ["сигнал активирует нейрон", "сигнал", "активирует", "нейрон"],
  ["сенсор обнаруживает импульс", "сенсор", "обнаруживает", "импульс"],
  ["память сохраняет событие", "память", "сохраняет", "событие"],
  ["алгоритм выбирает маршрут", "алгоритм", "выбирает", "маршрут"],
  ["исследователь проверяет гипотезу", "исследователь", "проверяет", "гипотезу"],
  ["датчик измеряет температуру", "датчик", "измеряет", "температуру"]
];
for (const [text, subject, predicate, object] of compositionalRoleCases) {
  const proposition = core.analyse(text, { contextRelation: "new_topic" }, knowledge).proposition;
  assert.equal(proposition.subject, subject, "subject role must follow phrase order: " + text);
  assert.equal(proposition.predicate, predicate, "predicate must be preserved: " + text);
  assert.equal(proposition.object, object, "object role must follow phrase order: " + text);
}


const expandedRoleCases = [
  ["Сигнал нейрон получает.", "нейрон", "получает", "Сигнал"],
  ["Данные система сохраняет.", "система", "сохраняет", "Данные"],
  ["Гипотезу исследователь проверяет.", "исследователь", "проверяет", "Гипотезу"]
];
for (const [text, subject, predicate, object] of expandedRoleCases) {
  const proposition = core.analyse(text, { contextRelation: "new_topic" }, knowledge).proposition;
  assert.equal(proposition.subject.toLowerCase(), subject.toLowerCase(), "bounded verb-final SOV subject: " + text);
  assert.equal(proposition.predicate.toLowerCase(), predicate.toLowerCase(), "bounded verb-final predicate: " + text);
  assert.equal(proposition.object.toLowerCase(), object.toLowerCase(), "bounded verb-final object: " + text);
}
const paraphraseCases = [
  ["Сенсор фиксирует колебания.", "сенсор", "фиксирует", "колебания"],
  ["Устройство регистрирует импульс.", "устройство", "регистрирует", "импульс"],
  ["Алгоритм делает выбор маршрута.", "алгоритм", "делает", "выбор маршрута"]
];
for (const [text, subject, predicate, object] of paraphraseCases) {
  const proposition = core.analyse(text, { contextRelation: "new_topic" }, knowledge).proposition;
  assert.equal(proposition.subject.toLowerCase(), subject.toLowerCase(), "paraphrase subject: " + text);
  assert.equal(proposition.predicate.toLowerCase(), predicate.toLowerCase(), "paraphrase predicate: " + text);
  assert.equal(proposition.object.toLowerCase(), object.toLowerCase(), "paraphrase object: " + text);
}
const modalInfinitive = core.analyse("Система может обнаружить помеху.", {
  contextRelation: "new_topic"
}, knowledge).proposition;
assert.equal(modalInfinitive.kind, "hypothesis");
assert.equal(modalInfinitive.modality, "possible");
assert.equal(modalInfinitive.subject, "Система");
assert.equal(modalInfinitive.predicate, "обнаружить");
assert.equal(modalInfinitive.object, "помеху");
const directCausality = core.analyse("Перегрев вызывает сбой.", {
  contextRelation: "new_topic"
}, knowledge).proposition;
assert.equal(directCausality.kind, "assertion");
assert.equal(directCausality.subject, "Перегрев");
assert.equal(directCausality.predicate, "вызывает");
assert.equal(directCausality.object, "сбой");
assert.equal(directCausality.relation, "causal");
const inverseCausality = core.analyse("Сбой происходит из-за перегрева.", {
  contextRelation: "new_topic"
}, knowledge).proposition;
assert.equal(inverseCausality.kind, "assertion");
assert.equal(inverseCausality.subject, "Сбой");
assert.equal(inverseCausality.relation, "causal");
assert.equal(inverseCausality.object, "перегрева");
const pluralCoreference = core.analyse("Модель получает данные. Затем она обрабатывает их.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(pluralCoreference.items[1].proposition.subject, "Модель");
assert.ok(pluralCoreference.items[1].proposition.references.some(row =>
  row.mention === "их" && row.status === "resolved" && row.antecedentText === "данные"),
  "plural pronouns must resolve to explicit plural data entities");

const polarityScopeCases = [
  {
    text: "Не все нейроны активируются.",
    kind: "assertion", subject: /нейрон/iu, predicate: /активируются/iu,
    polarity: "mixed", scope: "quantifier", quantifier: "all", scopeEffect: "not_all"
  },
  {
    text: "Все нейроны не активируются.",
    kind: "assertion", subject: /нейрон/iu, predicate: /активируются/iu,
    polarity: "negative", scope: "quantifier", quantifier: "all", scopeEffect: "all_negative"
  },
  {
    text: "Ни один нейрон не активируется.",
    kind: "assertion", subject: /нейрон/iu, predicate: /активируется/iu,
    polarity: "negative", scope: "quantifier", quantifier: "none", scopeEffect: "none_negative"
  },
  {
    text: "Сеть не всегда активируется.",
    kind: "assertion", subject: /сеть/iu, predicate: /активируется/iu,
    polarity: "mixed", scope: "temporal", quantifier: "always", scopeEffect: "not_always"
  },
  {
    text: "Сеть всегда не активируется.",
    kind: "assertion", subject: /сеть/iu, predicate: /активируется/iu,
    polarity: "negative", scope: "temporal", quantifier: "always", scopeEffect: "always_negative"
  }
];
for (const item of polarityScopeCases) {
  const proposition = core.analyse(item.text, { contextRelation: "new_topic" }, knowledge).proposition;
  assert.equal(proposition.kind, item.kind, item.text);
  assert.match(proposition.subject || "", item.subject, item.text);
  assert.match(proposition.predicate || "", item.predicate, item.text);
  assert.equal(proposition.polarity, item.polarity, item.text);
  assert.equal(proposition.polarityScope.scope, item.scope, item.text);
  assert.equal(proposition.polarityScope.quantifier, item.quantifier, item.text);
  assert.equal(proposition.polarityScope.effect, item.scopeEffect, item.text);
}
const ambiguousScope = core.analyse("Не все нейроны не активируются.", {
  contextRelation: "new_topic"
}, knowledge).proposition;
assert.equal(ambiguousScope.kind, "fragment",
  "double negation with a not-all quantifier must remain an unresolved fragment");
assert.equal(ambiguousScope.polarity, "unknown");
assert.equal(ambiguousScope.polarityScope.scope, "ambiguous");
assert.equal(ambiguousScope.polarityScope.effect, "ambiguous");

const localNotAll = core.extractProposition("Не все нейроны активируются.", "statement", {});
const forgedScope = core.validateProposition({
  kind: "assertion", polarity: "negative", modality: "asserted",
  polarityScope: { scope: "predicate", quantifier: "unspecified", effect: "negative" }
}, localNotAll);
assert.equal(forgedScope.polarity, "mixed",
  "model framing must not collapse not-all into ordinary predicate negation");
assert.equal(forgedScope.polarityScope.effect, "not_all");
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

const sequenceFrame = core.analyse("Система работает. Затем система активируется.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(sequenceFrame.propositionChain.schema, "NG_PROPOSITION_CHAIN_V1");
assert.equal(sequenceFrame.propositionChain.items.length, 2);
assert.equal(sequenceFrame.propositionChain.items[0].relationToPrevious.type, "root");
assert.equal(sequenceFrame.propositionChain.items[0].proposition.predicate, "работает");
assert.equal(sequenceFrame.propositionChain.items[1].relationToPrevious.type, "sequence");
assert.equal(sequenceFrame.propositionChain.items[1].relationToPrevious.referenceId, "p1");
assert.equal(sequenceFrame.propositionChain.items[1].proposition.predicate, "активируется");

const conditionalFrame = core.analyse("Если система получает сигнал, то система активируется.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(conditionalFrame.propositionChain.items.length, 2);
assert.equal(conditionalFrame.propositionChain.items[0].proposition.kind, "conditional");
assert.equal(conditionalFrame.propositionChain.items[0].proposition.subject, "система");
assert.equal(conditionalFrame.propositionChain.items[0].proposition.predicate, "получает");
assert.equal(conditionalFrame.propositionChain.items[0].proposition.object, "сигнал");
assert.equal(conditionalFrame.propositionChain.items[0].proposition.modality, "conditional");
assert.equal(conditionalFrame.propositionChain.items[1].relationToPrevious.type, "condition_result");
assert.equal(conditionalFrame.propositionChain.items[1].relationToPrevious.referenceId, "p1");

const causalFrame = core.analyse("Сеть не активируется, потому что питание не работает.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(causalFrame.propositionChain.items.length, 2);
assert.equal(causalFrame.propositionChain.items[1].relationToPrevious.type, "cause_of_previous");
assert.equal(causalFrame.propositionChain.items[1].proposition.polarity, "negative");

const resultFrame = core.analyse("Питание не работает. Поэтому сеть не активируется.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(resultFrame.propositionChain.items.length, 2);
assert.equal(resultFrame.propositionChain.items[1].relationToPrevious.type, "result_of_previous");
assert.equal(resultFrame.propositionChain.items[1].relationToPrevious.referenceId, "p1");

const contrastFrame = core.analyse("Система работает, однако сеть не активируется.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(contrastFrame.propositionChain.items.length, 2);
assert.equal(contrastFrame.propositionChain.items[1].relationToPrevious.type, "contrast");

const singleFrame = core.analyse("Система активируется.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(singleFrame.propositionChain.items.length, 0,
  "single propositions must not be wrapped in a fake discourse chain");

const unforcedAndFrame = core.analyse("Мне нравится сеть и память.", {
  contextRelation: "new_topic"
}, knowledge);
assert.equal(unforcedAndFrame.propositionChain.items.length, 0,
  "a coordinating 'и' inside one phrase must not trigger clause splitting");


const pronounResolved = core.analyse("Система получает сигнал. Она активируется.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(pronounResolved.items[1].proposition.subject, "Система",
  "a feminine pronoun must resolve to the only compatible prior entity");
assert.equal(pronounResolved.items[1].proposition.references[0].mention, "Она");
assert.equal(pronounResolved.items[1].proposition.references[0].targetType, "entity");
assert.equal(pronounResolved.items[1].proposition.references[0].status, "resolved");
assert.equal(pronounResolved.items[1].proposition.references[0].antecedentId, "p1");

const objectPronounResolved = core.analyse("Система получает сигнал. Он усиливается.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(objectPronounResolved.items[1].proposition.subject, "сигнал",
  "a masculine pronoun must be able to refer to a prior object, not only the subject");

const ambiguousPronoun = core.analyse("Модель использует нейросеть. Она активируется.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(ambiguousPronoun.items[1].proposition.subject, "Она",
  "the original pronoun must remain when two compatible antecedents compete");
assert.equal(ambiguousPronoun.items[1].proposition.references[0].status, "ambiguous");
assert.equal(ambiguousPronoun.items[1].proposition.references[0].candidates.length, 2);

const ungroundedPronoun = core.analyse("Она активируется. Сеть работает.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(ungroundedPronoun.items[0].proposition.references.length, 1);
assert.equal(ungroundedPronoun.items[0].proposition.references[0].status, "unresolved");

const demonstrativeReference = core.analyse("Система активируется. Это запускает процесс.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(demonstrativeReference.items[1].proposition.references[0].targetType, "proposition");
assert.equal(demonstrativeReference.items[1].proposition.references[0].antecedentId, "p1");

const locationReference = core.analyse("Система работает в лаборатории. Там система активируется.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(locationReference.items[1].proposition.references[0].targetType, "location");
assert.equal(locationReference.items[1].proposition.references[0].status, "resolved");
assert.match(locationReference.items[1].proposition.references[0].antecedentText, /лаборатории/iu);

const temporalReference = core.analyse("Вчера система работала. Тогда система активировалась.", {
  contextRelation: "new_topic"
}, knowledge).propositionChain;
assert.equal(temporalReference.items[1].proposition.references[0].targetType, "time");
assert.equal(temporalReference.items[1].proposition.references[0].status, "resolved");
assert.equal(temporalReference.items[1].proposition.references[0].antecedentText, "Вчера");

const referenceValidation = core.validateProposition({
  references: [{ mention: "Она", targetType: "entity", status: "resolved",
    antecedentId: "p9", antecedentText: "Подмена", confidence: 9 }]
});
assert.equal(referenceValidation.references[0].status, "unresolved",
  "references to proposition IDs outside the bounded chain must not be accepted");
assert.equal(referenceValidation.references[0].antecedentId, null);

const forgedChain = core.validateFrame({
  propositionChain: {
    schema: "NG_PROPOSITION_CHAIN_V1", version: 1,
    items: [
      { id: "p1", text: "Подменённое предложение",
        proposition: { kind: "assertion", subject: "подмена", predicate: "существует", confidence: 0.99 },
        relationToPrevious: { type: "root", referenceId: null } },
      { id: "p2", text: "Подменённое продолжение",
        proposition: { kind: "assertion", subject: "подмена", predicate: "работает", confidence: 0.99 },
        relationToPrevious: { type: "contrast", referenceId: "p1" } }
    ]
  }
}, sequenceFrame, knowledge);
assert.equal(forgedChain.propositionChain.items[0].text, "Система работает",
  "a model must not silently replace a locally extracted proposition chain");
assert.equal(forgedChain.propositionChain.items[1].relationToPrevious.type, "sequence");

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
