"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
for (const file of ["knowledge.js", "semantic-core.js", "contextual-attention.js", "semantic-query.js"]) {
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

// A short «yes» reply must not replace the topic anchor or the current question type.
const answerOnlyRecent = {
 activeThread:{id:"T-octopus-answer",title:"Сердца осьминога",contextSummary:"Вопрос о количестве сердец осьминога."},
 recentMessages:[
  {threadId:"T-octopus-answer",role:"user",text:"Сколько сердец у осьминога?",relation:"new_topic"},
  {threadId:"T-octopus-answer",role:"assistant",text:"У осьминога три сердца. Хочешь узнать, почему?",relation:"assistant_reply"},
  {threadId:"T-octopus-answer",role:"user",text:"Да",relation:"answer_to_question",questionText:"Хочешь узнать, почему?"}
 ],
 focus:{threadId:"T-octopus-answer",anchor:{role:"user",text:"Сколько сердец у осьминога?",relation:"new_topic"},
  candidates:[{text:"Сколько сердец у осьминога?"}],
  latestUser:{text:"Да",relation:"answer_to_question",questionText:"Хочешь узнать, почему?"},
  latestAssistant:{text:"У осьминога три сердца. Хочешь узнать, почему?"},referenceType:"ellipsis"},
 resolution:{applied:true,context:{recentExchange:[
  {role:"user",text:"Сколько сердец у осьминога?"},
  {role:"assistant",text:"У осьминога три сердца. Хочешь узнать, почему?"},
  {role:"user",text:"Да",relation:"answer_to_question"}
 ]}}
};
const whyFollowUp=engine.local("А почему?",answerOnlyRecent,knowledge);
assert.equal(whyFollowUp.expectedAnswerType,"causal");
assert.equal(whyFollowUp.semanticFrame.answerType,"causal");
assert.match(whyFollowUp.semanticFrame.subject.text,/осьминог/iu);
assert.match(whyFollowUp.canonicalQuestion,/А почему\\?/u);
assert.match(whyFollowUp.canonicalQuestion,/осьминога/u);

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
assert.match(request.messages[0].content, /NG_PROPOSITION_FRAME_V1/u);
assert.match(request.messages[0].content, /Не превращай вопрос, команду, цитату или пересказ источника в утверждение пользователя/u);
assert.match(request.messages[0].content, /subjectFrom/u);
assert.equal(request.messages.length, 2);
assert.match(request.messages[0].content, /НЕ отвечай на вопрос/u);
assert.match(request.messages[1].content, /А у него сколько/u);
assert.match(request.messages[1].content, /У осьминога три сердца/u);
assert.match(request.messages[1].content, /activeTopic/u);
assert.equal(request.metadata.operation, "semantic_query_interpretation");

const focusRequest = engine.buildRequest("А у него сколько?",{
 ...octopusTopic,
 focus:{threadId:"T-octopus",referenceType:"pronoun",anchor:{text:"Сколько сердец у осьминога?"},
  candidates:[{text:"Сколько сердец у осьминога?"}],
  latestUser:{text:"Сколько сердец у осьминога?"},
  latestAssistant:{text:"У осьминога три сердца."},anchorRecency:"nearby",needsDisambiguation:false}
},[{id:"M1",text:"У осьминога три сердца."}]);
assert.match(focusRequest.messages[1].content,/contextFocus/u);
assert.match(focusRequest.messages[0].content,/последнюю реплику пользователя автоматически/u);
assert.match(focusRequest.messages[1].content,/Сколько сердец у осьминога/u);

const parsed = engine.parse(JSON.stringify({
  contextRelation:"follow_up",
  canonicalQuestion:"Сколько сердец у осьминога?",
  searchQueries:["сколько сердец у осьминога","число сердечных органов головоногого"],
  expectedAnswerType:"quantity",
  semanticFrame:{
    intent:"factual_question",answerType:"quantity",subject:"осьминог",attribute:"сердец",
    proposition:{
      kind:"question",subject:"осьминог",predicate:null,object:"сердец",relation:"has",
      polarity:"unknown",modality:"interrogative",
      temporal:{expression:null,relation:"unspecified"},
      attribution:{speaker:"user",source:"user_utterance"},confidence:0.91
    }
  },
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
assert.equal(parsed.semanticFrame.proposition.schema, "NG_PROPOSITION_FRAME_V1");
assert.equal(parsed.semanticFrame.proposition.kind, "question");
assert.equal(parsed.semanticFrame.proposition.assertionStatus, "question",
  "model-provided proposition framing must preserve question-vs-assertion status");
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

function parseWithForgedProposition(canonicalQuestion, originalQuestion, proposition) {
  return engine.parse(JSON.stringify({
    contextRelation: "new_topic",
    canonicalQuestion,
    searchQueries: [canonicalQuestion],
    expectedAnswerType: "description",
    semanticFrame: {
      intent: "factual_question",
      answerType: "description",
      proposition,
      confidence: 0.99
    },
    confidence: 0.99,
    evidencePlan: []
  }), originalQuestion);
}
const forgedQuestion = parseWithForgedProposition(
  "Сеть не активируется.",
  "Почему сеть не активируется?",
  {
    kind: "assertion", subject: "сеть", predicate: "активируется",
    polarity: "negative", modality: "asserted", confidence: 0.99,
    attribution: { speaker: "user", source: "user_utterance" }
  }
);
assert.equal(forgedQuestion.semanticFrame.proposition.kind, "question",
  "a rewritten canonical statement must not turn the user's original question into an assertion");
assert.equal(forgedQuestion.semanticFrame.proposition.assertionStatus, "question");
assert.equal(forgedQuestion.semanticFrame.proposition.modality, "interrogative");

const forgedReport = parseWithForgedProposition(
  "Усталость приводит к снижению концентрации.",
  "В отчёте говорится, что усталость приводит к снижению концентрации.",
  {
    kind: "assertion", subject: "усталость", predicate: "приводит к",
    object: "снижению концентрации", polarity: "positive", modality: "asserted",
    confidence: 0.99, attribution: { speaker: "user", source: "user_utterance" }
  }
);
assert.equal(forgedReport.semanticFrame.proposition.kind, "reported",
  "a source-attributed report must not become a direct user assertion");
assert.equal(forgedReport.semanticFrame.proposition.assertionStatus, "reported");
assert.equal(forgedReport.semanticFrame.proposition.attribution.source, "source_attributed");

const forgedHypothesis = parseWithForgedProposition(
  "Недостаток сна может приводить к усталости.",
  "Недостаток сна может приводить к усталости.",
  {
    kind: "assertion", subject: "недостаток сна", predicate: "приводить к",
    object: "усталости", polarity: "positive", modality: "asserted",
    confidence: 0.99, attribution: { speaker: "user", source: "user_utterance" }
  }
);
assert.equal(forgedHypothesis.semanticFrame.proposition.kind, "hypothesis");
assert.equal(forgedHypothesis.semanticFrame.proposition.modality, "possible");

const forgedNegation = parseWithForgedProposition(
  "Сеть не активируется.",
  "Сеть не активируется.",
  {
    kind: "assertion", subject: "сеть", predicate: "активируется",
    polarity: "positive", modality: "asserted", confidence: 0.99,
    attribution: { speaker: "user", source: "user_utterance" }
  }
);
assert.equal(forgedNegation.semanticFrame.proposition.kind, "assertion");
assert.equal(forgedNegation.semanticFrame.proposition.polarity, "negative",
  "model framing must not silently erase a confidently detected negation");

const forgedScope = parseWithForgedProposition(
  "Не все нейроны активируются.",
  "Не все нейроны активируются.",
  {
    kind: "assertion", subject: "нейроны", predicate: "активируются",
    polarity: "negative", modality: "asserted", confidence: 0.99,
    polarityScope: { scope: "predicate", quantifier: "unspecified", effect: "negative" },
    attribution: { speaker: "user", source: "user_utterance" }
  }
);
assert.equal(forgedScope.semanticFrame.proposition.polarity, "mixed");
assert.equal(forgedScope.semanticFrame.proposition.polarityScope.effect, "not_all",
  "the model must not collapse not-all quantifier scope into a simple negative predicate");

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

const contextualModel = window.NGContextualModel.create({ dimension: 8, windowSize: 2, seed: 11 });
contextualModel.train(["нейрон получает сигнал", "сеть получает данные", "память хранит информацию"],
  { epochs: 4, learningRate: 0.02 });
window.NGContextualAttention = contextualModel;
const phraseModel = window.NGPhraseCompositionModel.create({dimension:8,seed:17});
phraseModel.train(["нейрон получает сигнал","сеть получает данные","ключ открывает замок","программа использует ключ"],
  contextualModel,window.NGSemanticCore,knowledge,{epochs:12,learningRate:0.04});
window.NGPhraseComposition = phraseModel;
const contextualPlan = engine.local("Нейрон получает сигнал", {}, knowledge);
assert.equal(contextualPlan.version, 4);
assert.ok(contextualPlan.contextualAnalysis && contextualPlan.contextualAnalysis.trained,
  "a trained contextual representation must flow into the semantic query result");
assert.ok(contextualPlan.contextualAnalysis.positions.length > 0);
assert.ok(Array.isArray(contextualPlan.contextualHints));
assert.ok(contextualPlan.phraseComposition&&contextualPlan.phraseComposition.trained,
  "trained phrase composition must flow into the local semantic query plan");
assert.equal(contextualPlan.phraseComposition.weakFrame.subject,"нейрон");
console.log("NEUROGENESIS semantic query planner: passed, including contextual attention integration.");
