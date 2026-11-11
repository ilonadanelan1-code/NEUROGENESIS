"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
for (const file of ["knowledge.js", "semantic-core.js", "semantic-query.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const engine = window.NGSemanticQuery;
const knowledge = window.NGKnowledge;
assert.ok(engine && engine.version === 3);

const oldTopic = {
  activeThread: { id:"T-old", title:"Изучение устройства нейросетей", contextSummary:"Обсуждение контекста диалога." },
  recentMessages: [
    { threadId:"T-old", role:"user", text:"Я изучаю устройство нейросетей." },
    { threadId:"T-old", role:"assistant", text:"Объяснить, что такое контекст?" }
  ]
};
const explicitQuestion = engine.local("Сколько сердец у осьминога?", oldTopic, knowledge);
const ambiguousHeartCount = engine.local("Сколько сердец?", oldTopic, knowledge);
assert.equal(ambiguousHeartCount.contextRelation, "follow_up",
  "a short question without its own named object should be resolved against the active subject");
assert.equal(explicitQuestion.contextRelation, "new_topic",
  "a fully specified object question must not inherit an unrelated active subject");
assert.match(explicitQuestion.canonicalQuestion, /осьминога/u);
assert.equal(explicitQuestion.evidencePlan.length, 0,
  "a simple single-fact question must not be expanded into a multi-hop plan");
assert.equal(explicitQuestion.semanticFrame.schema, "NG_SEMANTIC_FRAME_V1");
assert.equal(explicitQuestion.semanticFrame.answerType, "quantity");
assert.match(explicitQuestion.semanticFrame.subject.text, /осьминог/u);
assert.match(explicitQuestion.semanticFrame.attribute.text, /сердец/u);
const separateQuantity = engine.local("Сколько часов ты спал?", oldTopic, knowledge);
assert.equal(separateQuantity.contextRelation, "new_topic",
  "a complete question with its own measurable subject must not be treated as a follow-up");

const octopusTopic = {
  activeThread: { id:"T-octopus", title:"Сколько сердец у осьминога?", contextSummary:"Вопрос о количестве сердец осьминога." },
  recentMessages: [
    { threadId:"T-octopus", role:"user", text:"Сколько сердец у осьминога?", relation:"new_topic" },
    { threadId:"T-octopus", role:"assistant", text:"Проверяю локальную запись." }
  ],
  resolution: {
    applied:true,
    context:{ recentExchange:[
      { role:"user", text:"Сколько сердец у осьминога?" },
      { role:"assistant", text:"Проверяю локальную запись." }
    ]}
  }
};
for (const followUp of ["Сколько сердец?", "А у него сколько?", "Так колько в итоге?", "Ну так че там по сердцам?"]) {
  const plan = engine.local(followUp, octopusTopic, knowledge);
  assert.equal(plan.contextRelation, "follow_up", "follow-up must inherit the established subject: " + followUp);
  assert.match(plan.canonicalQuestion, /осьминога/u, "follow-up must resolve to the octopus topic: " + followUp);
  assert.equal(plan.semanticFrame.discourse.relation, "follow_up");
  assert.match(plan.semanticFrame.subject.text, /осьминог/u);
}

const paraphrase = engine.local("Каково число сердечных насосов у головоногого?", {}, knowledge);
assert.ok(paraphrase.searchQueries.some(query => /осьминог|головоног/u.test(query)),
  "offline synonym expansion should connect a cephalopod paraphrase");
assert.ok(paraphrase.searchQueries.some(query => /сердц|сердечн/u.test(query)),
  "offline synonym expansion should connect heart-related wording");

const request = engine.buildRequest("А у него сколько?", octopusTopic, [
  { id:"M1", text:"У осьминога три сердца." },
  { id:"M2", text:"Я изучаю устройство нейросетей." }
]);
assert.equal(request.schema, "NEUROGENESIS_LLM_REQUEST_V2");
assert.equal(request.metadata.semanticSchema, "NG_SEMANTIC_FRAME_V1");
assert.match(request.messages[0].content, /субъект — осьминог, атрибут — сердца/u);
assert.match(request.messages[0].content, /evidencePlan/u);
assert.match(request.messages[0].content, /subjectFrom/u);
assert.equal(request.messages.length, 2);
assert.match(request.messages[0].content, /НЕ отвечай на вопрос/u);
assert.match(request.messages[1].content, /А у него сколько/u);
assert.match(request.messages[1].content, /У осьминога три сердца/u);
assert.match(request.messages[1].content, /activeTopic/u);
assert.equal(request.metadata.operation, "semantic_query_interpretation");

const parsed = engine.parse(JSON.stringify({
  contextRelation:"follow_up",
  canonicalQuestion:"Сколько сердец у осьминога?",
  searchQueries:["сколько сердец у осьминога","число сердечных органов головоногого"],
  expectedAnswerType:"quantity",
  confidence:0.97,
  evidencePlan:[
    {id:"country",question:"В какой стране находится Таллин?",subject:"Таллин",attribute:"страна"},
    {id:"president",question:"Кто президент этой страны?",attribute:"президент",subjectFrom:{stepId:"country",field:"object"},dependsOn:["country"]},
    {id:"invalid",attribute:"город",subjectFrom:{stepId:"future",field:"object"}}
  ]
}));
assert.equal(parsed.source, "model");
assert.equal(parsed.semanticFrame.schema, "NG_SEMANTIC_FRAME_V1");
assert.equal(parsed.semanticFrame.answerType, "quantity");
assert.equal(parsed.contextRelation, "follow_up");
assert.equal(parsed.expectedAnswerType, "quantity");
assert.equal(parsed.version, 3);
assert.equal(parsed.evidencePlan.length, 2);
assert.equal(parsed.evidencePlan[1].subjectFrom.stepId, "country");
assert.equal(parsed.evidencePlan[1].subjectFrom.field, "object",
  "a dependent step must reference only the previous claim's object field");
assert.equal(parsed.evidencePlanInvalid, true,
  "a partially rejected model plan must be marked unsafe for grounded synthesis");
assert.deepEqual(Array.from(parsed.evidencePlan[1].dependsOn), ["country"]);
assert.equal(parsed.searchQueries.length, 3);
assert.equal(parsed.searchQueries[0], parsed.canonicalQuestion,
  "the canonical form must be prepended when the model omitted it from search variants");
assert.equal(engine.parse("Это не JSON"), null);
const malformedDependency = engine.parse(JSON.stringify({
  contextRelation:"new_topic", canonicalQuestion:"Кто президент этой страны?",
  searchQueries:["Кто президент этой страны?"], confidence:0.9,
  evidencePlan:[{id:"child",attribute:"президент",subjectFrom:{stepId:"future",field:"object"},dependsOn:["future"]}]
}));
assert.ok(malformedDependency && malformedDependency.evidencePlanInvalid,
  "an entirely invalid dependency plan must not silently become a single-step query");


const parseQuestionPlan = (canonicalQuestion, evidencePlan, originalQuestion = canonicalQuestion) => engine.parse(JSON.stringify({
  contextRelation: "new_topic", canonicalQuestion, searchQueries: [canonicalQuestion],
  confidence: 0.9, evidencePlan
}), originalQuestion);
const simpleWithoutPlan = parseQuestionPlan("Сколько сердец у осьминога?", []);
assert.equal(simpleWithoutPlan.evidencePlanInvalid, false,
  "a genuinely single-question query may keep the simple empty evidence plan");
const compoundQuestion = "В какой стране находится Таллин и кто президент этой страны?";
const compoundWithoutPlan = parseQuestionPlan(compoundQuestion, []);
assert.ok(compoundWithoutPlan && compoundWithoutPlan.evidencePlanInvalid,
  "a compound question must not silently fall back to one semantic step when the model omits its plan");
const compoundOneStep = parseQuestionPlan(compoundQuestion, [
  { id: "country", subject: "Таллин", attribute: "страна" }
]);
assert.ok(compoundOneStep && compoundOneStep.evidencePlanInvalid,
  "one step cannot silently represent two explicit interrogative clauses");
const compoundComplete = parseQuestionPlan(compoundQuestion, [
  { id: "country", subject: "Таллин", attribute: "страна" },
  { id: "president", attribute: "президент",
    subjectFrom: { stepId: "country", field: "object" }, dependsOn: ["country"] }
]);
assert.equal(compoundComplete.evidencePlanInvalid, false,
  "a valid two-step plan must remain eligible for grounded retrieval");
assert.equal(compoundComplete.evidencePlan.length, 2);

const shortenedCanonical = parseQuestionPlan("В какой стране находится Таллин?", [
  { id: "country", subject: "Таллин", attribute: "страна" }
], compoundQuestion);
assert.ok(shortenedCanonical && shortenedCanonical.evidencePlanInvalid,
  "the model must not hide a second requested fact by shortening canonicalQuestion while the original user query remains compound");

const threePartQuestion = "В каком регионе расположен порт, сколько у него причалов и кто им управляет?";
const twoStepsForThreeParts = parseQuestionPlan(threePartQuestion, [
  { id: "region", subject: "порт", attribute: "регион" },
  { id: "berths", subject: "порт", attribute: "причалы" }
]);
assert.ok(twoStepsForThreeParts && twoStepsForThreeParts.evidencePlanInvalid,
  "a plan with two steps cannot silently cover three explicit question parts");

const alternativeConnectorQuestion = "Сколько этажей у здания, а какова его высота?";
const connectorPlan = parseQuestionPlan(alternativeConnectorQuestion, [
  { id: "floors", subject: "здание", attribute: "этажи" },
  { id: "height", subject: "здание", attribute: "высота" }
]);
assert.equal(connectorPlan.evidencePlanInvalid, false,
  "a second clause introduced by the Russian connector «а» must be counted as a separate requested fact");

const separatedQuestions = "Кто разработал механизм? В каком году это произошло?";
const separatedQuestionPlan = parseQuestionPlan(separatedQuestions, [
  { id: "author", subject: "механизм", attribute: "разработчик" },
  { id: "year", subject: "разработка механизма", attribute: "год" }
]);
assert.equal(separatedQuestionPlan.evidencePlanInvalid, false,
  "two interrogative sentences in one user message must be recognized as a two-step request");

const fivePartQuestion = "Кто создал механизм, в каком году его создали, где его разработали, сколько этапов у разработки и зачем механизм применяют?";
const fourStepsForFiveParts = parseQuestionPlan(fivePartQuestion, [
  { id: "creator", subject: "механизм", attribute: "создатель" },
  { id: "year", subject: "создание механизма", attribute: "год" },
  { id: "place", subject: "механизм", attribute: "место разработки" },
  { id: "stages", subject: "разработка механизма", attribute: "число этапов" }
]);
assert.ok(fourStepsForFiveParts && fourStepsForFiveParts.evidencePlanInvalid,
  "requests with more than four explicit parts must not pass through the four-step plan limit as if complete");

const meaningFrame = window.NGSemanticCore.analyse("Сколько сердечных насосов у головоногого?", {contextRelation:"new_topic"}, knowledge);
assert.equal(meaningFrame.answerType, "quantity");
assert.match(meaningFrame.subject.text, /головоногого/u);
assert.match(meaningFrame.attribute.text, /сердечных насосов/u);
const inheritedFrame = window.NGSemanticCore.analyse("А у него сколько?", {
  contextRelation:"follow_up", contextText:"Сколько сердец у осьминога?"
}, knowledge);
assert.match(inheritedFrame.subject.text, /осьминога/u);
assert.match(inheritedFrame.attribute.text, /сердец/u);
assert.equal(inheritedFrame.entities[0].certainty, "context_candidate");
assert.equal(engine.isStructuredCommand("Покажи последние когнитивные циклы"), true);

console.log("NEUROGENESIS semantic query planner: passed.");
