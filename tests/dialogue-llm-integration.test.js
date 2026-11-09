"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, URL, AbortController, setTimeout, clearTimeout };

for (const file of ["knowledge.js", "dialog-context.js", "llm-bridge.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const contextEngine = window.NGDialogContext.create(window.NGKnowledge);
let state = contextEngine.empty();

state = contextEngine.track(state, {
  role: "user",
  text: "Недостаток сна сегодня вызвал у меня усталость",
  time: 1
});
const sleepThreadId = state.activeThreadId;

state = contextEngine.track(state, {
  role: "assistant",
  text: "Сколько часов ты спал? И как часто это повторяется?",
  time: 2
});
assert.equal(contextEngine.report(state).activeThread.pendingQuestions.length, 2,
  "the real dialog report should expose both unanswered questions as strings");

state = contextEngine.track(state, {
  role: "user",
  text: "Примерно четыре часа",
  time: 3
});
assert.equal(state.messages[state.messages.length - 1].relation, "answer_to_question",
  "a concise reply should resolve the matching question");
assert.deepEqual(
  Array.from(contextEngine.report(state).activeThread.pendingQuestions),
  ["И как часто это повторяется?"],
  "the report should keep only the unanswered question"
);

state = contextEngine.track(state, {
  role: "assistant",
  text: "Короткий сон может усиливать усталость. Как часто это повторяется?",
  time: 4
});
state = contextEngine.track(state, {
  role: "user",
  text: "Теперь поговорим о музыке и музыкальных инструментах",
  time: 5
});
const musicThreadId = state.activeThreadId;
assert.notEqual(musicThreadId, sleepThreadId);

state = contextEngine.track(state, {
  role: "user",
  text: "Вернёмся к недостатку сна и усталости",
  time: 6
});
assert.equal(state.activeThreadId, sleepThreadId,
  "an explicit return should reactivate the matching earlier discussion");

state = contextEngine.track(state, {
  role: "user",
  text: "А почему?",
  time: 7
});

const report = contextEngine.report(state);
const history = contextEngine.history(state, report.activeThread.id, 17);
const request = window.NGLLMBridge.buildRequest(
  "А почему?",
  { activeThread: report.activeThread, recentMessages: history },
  []
);
const userPrompt = request.messages[request.messages.length - 1].content;
const pendingBlock = userPrompt.split("НЕЗАКРЫТЫЕ УТОЧНЯЮЩИЕ ВОПРОСЫ В ЭТОЙ ТЕМЕ")[1] || "";

assert.equal(report.activeThread.id, sleepThreadId);
assert.equal(request.metadata.pendingQuestionCount, 1,
  "the LLM request should receive exactly the remaining unanswered clarification");
assert.match(pendingBlock, /И как часто это повторяется\?/u,
  "the real unanswered question must reach the LLM prompt");
assert.doesNotMatch(pendingBlock, /Сколько часов ты спал/u,
  "a question already answered by the user must not be marked as pending");
assert.equal(request.metadata.historyMessages, 5,
  "the current prompt should be excluded while the active thread's recent history is retained");
assert.equal(
  request.messages.some(row => row.content.includes("музыкальных инструментах")),
  false,
  "messages from a paused, unrelated topic must not leak into the LLM request"
);
assert.equal(
  request.messages.filter(row => row.role === "user" && row.content === "А почему?").length,
  1,
  "the current user prompt must occur once, not be duplicated in history"
);

console.log("NEUROGENESIS dialog-context to LLM bridge integration: passed.");
