"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("first-experiment.js", "utf8");
const elements = new Map();
function element(id, textContent = "") {
  const listeners = new Map();
  const value = {
    id, textContent, value: "", hidden: false, disabled: false, dataset: {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    click() {
      if (this.disabled) return;
      const handler = listeners.get("click");
      if (handler) handler({ target: this });
    }
  };
  elements.set(id, value);
  return value;
}

element("first-experiment");
const run = element("first-experiment-run");
const show = element("first-experiment-show");
const status = element("first-experiment-status");
const result = element("first-experiment-result");
const memoryInput = element("memory-input");
const remember = element("remember-button");
const ask = element("ask-button");
const feedback = element("memory-feedback");
const feed = element("memory-feed");
const simulation = element("run-button", "▶ Симуляция");
const memories = [];
let askedQuestion = "";
let assistantReply = "Я понял, что это продолжение прежней темы, но не нашёл нужную запись.";

remember.addEventListener("click", () => {
  if (!memories.includes(memoryInput.value)) memories.push(memoryInput.value);
});
ask.addEventListener("click", () => {
  askedQuestion = memoryInput.value;
  feedback.textContent = "ПОИСК ЗАВЕРШЁН · НАЙДЕНО 1 · 2 СЛЕДОВ АКТИВИРОВАНО";
  feed.lastElementChild = { className: "memory-message from-brain", textContent: assistantReply };
});
simulation.addEventListener("click", () => {
  simulation.textContent = /пауза/iu.test(simulation.textContent) ? "▶ Симуляция" : "Ⅱ Пауза";
});

const document = { getElementById: id => elements.get(id) || null };
const window = {
  NGMemory: {
    count: () => memories.length,
    search: query => memories
      .filter(text => text.includes("осьминога") || query.includes("осьминога"))
      .map(text => ({ text, score: 0.9 }))
      .slice(0, 5)
  }
};
vm.runInNewContext(source, { document, window, console });

run.click();
assert.ok(memories.includes("У осьминога три сердца."),
  "the guided experiment must store its sample fact through the existing memory control");
assert.equal(askedQuestion, "Сколько сердец у осьминога?",
  "the guided experiment must ask the configured recall question");
assert.equal(show.disabled, true,
  "a stale or off-topic assistant reply must not unlock the network success action");
assert.equal(result.hidden, false, "the experiment must expose a visible result even when recall fails");
assert.match(status.textContent, /частично/u);
assert.match(result.textContent, /сам ответ диалога не подтвердил/u,
  "the experiment must report when search candidates exist but the actual response is off-topic");

assistantReply = "В моей памяти есть запись: У осьминога три сердца.";
run.click();
assert.equal(show.disabled, false, "the network view must unlock only after the actual answer confirms the fact");
assert.match(result.textContent, /Ответ системы/u);
assert.match(result.textContent, /Следов памяти активировано по отчёту: 2/u,
  "the result must report activated memory traces");
assert.match(status.textContent, /Опыт завершён/u);

show.click();
assert.match(simulation.textContent, /Пауза/u,
  "the show-network action must start the existing visual simulation");
assert.match(status.textContent, /визуальному ядру/u);

console.log("NEUROGENESIS first experiment: memory write, recall query, activation report and simulation handoff passed.");
