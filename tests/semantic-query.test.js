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
assert.ok(engine && engine.version === 2);

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
  confidence:0.97
}));
assert.equal(parsed.source, "model");
assert.equal(parsed.semanticFrame.schema, "NG_SEMANTIC_FRAME_V1");
assert.equal(parsed.semanticFrame.answerType, "quantity");
assert.equal(parsed.contextRelation, "follow_up");
assert.equal(parsed.expectedAnswerType, "quantity");
assert.equal(parsed.searchQueries.length, 3);
assert.equal(parsed.searchQueries[0], parsed.canonicalQuestion,
  "the canonical form must be prepended when the model omitted it from search variants");
assert.equal(engine.parse("Это не JSON"), null);
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
