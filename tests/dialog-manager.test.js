"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
vm.runInNewContext(fs.readFileSync("dialog-manager.js", "utf8"), sandbox, { filename: "dialog-manager.js" });
const manager = window.NGDialogManager.create();

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
const ambiguous = manager.plan("Вернёмся к памяти", {
  ...active,
  lastDecision: { kind: "ambiguous_return", candidates: ["T1", "T2"] },
  topics: [{ id: "T1", title: "Память" }, { id: "T2", title: "Рабочая память" }]
});
assert.equal(ambiguous.action, "choose_topic");
assert.match(ambiguous.clarification, /Память/u);

const statement = manager.plan("Музыка помогает мне сосредоточиться", active);
assert.equal(statement.action, "consider_new_information");
assert.equal(statement.needsClarification, false);
assert.equal(manager.classify("   ", active).action, "request_input");
console.log("NEUROGENESIS dialogue manager: passed.");
