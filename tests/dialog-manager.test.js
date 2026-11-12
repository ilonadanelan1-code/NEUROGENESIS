"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
vm.runInNewContext(fs.readFileSync("knowledge.js", "utf8"), sandbox, { filename: "knowledge.js" });
vm.runInNewContext(fs.readFileSync("dialog-context.js", "utf8"), sandbox, { filename: "dialog-context.js" });
const contextEngine = window.NGDialogContext.create(window.NGKnowledge);
vm.runInNewContext(fs.readFileSync("dialog-manager.js", "utf8"), sandbox, { filename: "dialog-manager.js" });
const manager = window.NGDialogManager.create(contextEngine);

const active = {
  activeThread: { id: "T1", title: "Недостаток сна и усталость", pendingQuestion: "" },
  recentMessages: [{ role: "user", text: "Недостаток сна вызвал усталость", relation: "new_topic" }],
  topics: []
};

assert.equal(manager.classify("Почему?", active).intent, "follow_up",
  "a short causal follow-up must not be treated as an isolated query");
assert.equal(manager.plan("Почему?", { ...active, resolution: { applied: true } }).action,
  "continue_active_topic");
const unclear = manager.plan("А почему?", { ...active, resolution: { applied: false } });
assert.equal(unclear.action, "ask_clarification");
assert.equal(unclear.needsClarification, true);
assert.match(unclear.clarification, /к какой мысли/u);

assert.equal(manager.classify("Примерно четыре часа", {
  ...active,
  activeThread: { ...active.activeThread, pendingQuestion: "Сколько часов ты спал?" }
}).intent, "answer", "short reply to an open question should be recognized as an answer");
assert.equal(manager.classify("Музыка прекрасна", {
  ...active,
  activeThread: { ...active.activeThread, pendingQuestion: "Сколько часов ты спал?" }
}).intent, "statement",
  "an unrelated short declarative message must not be misclassified as an answer");
assert.equal(manager.classify("Да", {
  ...active,
  activeThread: { ...active.activeThread, pendingQuestion: "Ты спал сегодня?" }
}).intent, "answer",
  "the shared classifier should still accept a clear yes/no answer");
const pending = {
  ...active,
  activeThread: { ...active.activeThread, pendingQuestion: "Какой аспект контекста тебя интересует?" }
};
assert.notEqual(manager.classify(
  "Я изучаю устройство нейросетей. Объясни в двух предложениях, что такое контекст диалога, а затем задай мне один уточняющий вопрос.",
  pending
).intent, "answer", "a standalone multi-part request must not be attached to an unrelated pending question");
assert.notEqual(manager.classify("Объясни, как работает RAG", pending).intent, "answer",
  "an imperative request must not be treated as an answer");

assert.equal(manager.classify("Примерно четыре часа", {
  ...active,
  recentMessages: [{ role: "user", text: "Примерно четыре часа", relation: "answer_to_question" }]
}).action, "attach_to_open_question");

assert.equal(manager.classify("Нет, я имел в виду другое", active).intent, "correction");
assert.equal(manager.classify("Я не согласен с этим выводом", active).intent, "objection");
assert.equal(manager.classify("Теперь поговорим о музыке", active).action, "open_topic");
assert.equal(manager.classify("Привет!", active).action, "greet");
assert.equal(manager.isConversationalFiller("Как дела?"), true,
  "small-talk greetings must be detected before saving them as long-term memory");
assert.equal(manager.isConversationalFiller("Музыка прекрасна"), false,
  "a meaningful personal opinion must remain eligible for long-term memory");
assert.equal(manager.isConversationalFiller("Задай мне вопрос о сне"), false,
  "a substantive user request must not be filtered as small talk");

assert.equal(manager.classify("Что ты помнишь о музыке?", active).action, "retrieve_and_reason");

const returned = manager.plan("Вернёмся к музыке", {
  ...active,
  lastDecision: { kind: "returned" }
});
assert.equal(returned.action, "resume_topic");
const missing = manager.plan("Вернёмся к квантовым вычислениям", {
  ...active,
  lastDecision: { kind: "unresolved_return", text: "квантовым вычислениям" }
});
assert.equal(missing.action, "clarify_topic");
assert.equal(missing.needsClarification, true);
const localNewTopicGuess = {
  source: "local", contextRelation: "new_topic", confidence: 0.54
};
assert.equal(manager.shouldAskClarification(missing, localNewTopicGuess), true,
  "a low-confidence local new-topic guess must not suppress clarification for an unresolved explicit return");
const ambiguous = manager.plan("Вернёмся к памяти", {
  ...active,
  lastDecision: { kind: "ambiguous_return", candidates: ["T1", "T2"] },
  topics: [{ id: "T1", title: "Память" }, { id: "T2", title: "Рабочая память" }]
});
assert.equal(ambiguous.action, "choose_topic");
assert.match(ambiguous.clarification, /Память/u);
assert.equal(manager.shouldAskClarification(ambiguous, {
  source: "model", contextRelation: "same_topic", confidence: 0.99
}), true, "an LLM guess must not choose between ambiguous saved topics");
assert.equal(manager.shouldAskClarification(returned, localNewTopicGuess), false,
  "a successfully resolved return does not need clarification");
assert.equal(manager.shouldAskClarification(unclear, {
  source: "model", contextRelation: "follow_up", confidence: 0.57
}), true, "a low-confidence model plan must not suppress ordinary clarification");
assert.equal(manager.shouldAskClarification(unclear, {
  source: "model", contextRelation: "follow_up", confidence: 0.9
}), false, "a sufficiently confident model plan may still resolve ordinary follow-ups");
assert.equal(manager.shouldAskClarification(unclear, {
  source: "local", contextRelation: "follow_up", confidence: 0.54
}), true, "an uncalibrated local heuristic must not override an unresolved follow-up");
assert.equal(manager.shouldAskClarification(unclear, {
  source: "local_fallback", contextRelation: "follow_up", confidence: 0.54
}), true, "the local fallback must not override a required clarification either");

const statement = manager.plan("Музыка помогает мне сосредоточиться", active);
assert.equal(statement.action, "consider_new_information");
assert.equal(statement.needsClarification, false);
assert.equal(manager.classify("   ", active).action, "request_input");
console.log("NEUROGENESIS dialogue manager: passed.");
