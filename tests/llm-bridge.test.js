"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { URL } = require("node:url");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, URL };
vm.runInNewContext(fs.readFileSync("llm-bridge.js", "utf8"), sandbox, { filename: "llm-bridge.js" });
const bridge = window.NGLLMBridge;
const context = {
  activeThread: {
    id: "T-sleep", title: "Недостаток сна и усталость",
    contextSummary: "1. Пользователь сообщил о коротком сне и усталости.\\n2. Пользователь уточнил, что хочет сохранить контекст темы."
  },
  recentMessages: [
    { threadId: "T-sleep", role: "user", text: "Я плохо спал и чувствую усталость" },
    { threadId: "T-sleep", role: "assistant", text: "Сколько часов ты спал?" },
    { threadId: "T-music", role: "assistant", text: "В музыке важна гармония, не смешивай темы." },
    { threadId: "T-sleep", role: "user", text: "Примерно четыре часа" },
    { threadId: "T-sleep", role: "assistant", text: "Понял. А почему ты связываешь это с усталостью?" },
    { threadId: "T-music", role: "user", text: "Музыка мне нравится." },
    { threadId: "T-sleep", role: "tool", text: "tool output must not enter dialogue history" },
    { threadId: "T-sleep", role: "user", text: "А почему?" }
  ]
};
const request = bridge.buildRequest("А почему?", context, [
  { text: "Пользователь наблюдал усталость после короткого сна.", source: "M1", kind: "observation", status: "user_supplied" }
]);
assert.equal(request.schema, "NEUROGENESIS_LLM_REQUEST_V1");
assert.equal(request.messages[0].role, "system");
assert.match(request.messages[0].content, /не изменяешь эти слои/u);
assert.equal(request.messages[request.messages.length - 1].content.startsWith("А почему?"), true);
assert.match(request.messages[request.messages.length - 1].content,/КРАТКИЕ ВЫДЕРЖКИ ИЗ ПРЕДЫДУЩИХ РЕПЛИК ПОЛЬЗОВАТЕЛЯ/u);
assert.match(request.messages[request.messages.length - 1].content,/хочет сохранить контекст темы/u);
assert.equal(request.metadata.contextSummaryCharacters,context.activeThread.contextSummary.length,
  "the request metadata should describe the attached topic-summary size");
assert.equal(request.metadata.historyMessages, 4, "the current user message should be removed while earlier turns from the active topic remain in history");
assert.equal(request.messages.some(row => row.content.includes("В музыке важна гармония")), false,
  "messages from another topic must never reach the language model");
assert.equal(request.messages.some(row => row.content.includes("tool output")), false,
  "non-dialogue roles must never enter the language model history");
assert.ok(request.messages.some(row => row.content.includes("Сколько часов ты спал?")),
  "the active thread's previous assistant question must remain in context");

// Without an active thread ID, the bridge must not forward an unscoped transcript.
const unscopedRequest = bridge.buildRequest("Продолжим?", {
  activeThread: { title: "Тема без идентификатора", contextSummary: "Сводка без подтверждённого ID темы" },
  recentMessages: [
    { threadId: "T-sleep", role: "user", text: "Сведения из другой темы" },
    { role: "assistant", text: "Реплика без ID темы" }
  ]
}, []);
assert.equal(unscopedRequest.metadata.historyMessages, 0,
  "the LLM bridge must fail closed when the active thread ID is missing");
assert.equal(unscopedRequest.messages.length, 2,
  "an unscoped request should contain only system policy and the current user message");
assert.doesNotMatch(unscopedRequest.messages.map(row => row.content).join("\n"),
  /Сведения из другой темы|Реплика без ID темы|Сводка без подтверждённого ID темы/u,
  "history and summaries without a confirmed active thread must not reach the model");

const extendedRows = Array.from({ length:20 }, (_, index) => ({
  threadId:"T-long", role:index % 2 ? "assistant" : "user",
  text:"СООБЩЕНИЕ " + index + " " + "x".repeat(400)
}));
extendedRows.push({ threadId:"T-foreign", role:"assistant", text:"Чужая тема не должна попасть в историю" });
extendedRows.push({ threadId:"T-long", role:"user", text:"Последний вопрос" });
const extendedRequest = bridge.buildRequest("Последний вопрос", {
  activeThread:{ id:"T-long", title:"Длинная беседа" }, recentMessages:extendedRows
}, []);
assert.equal(extendedRequest.metadata.historyMessages,16,
  "the bridge should retain up to sixteen prior messages, excluding the current user prompt");
assert.equal(extendedRequest.messages.length,18,
  "sixteen history messages plus system policy and current prompt must fit the worker's eighteen-message cap");
assert.ok(extendedRequest.metadata.historyCharacters <= 10000,
  "dialogue history must respect the shared ten-thousand-character budget");
assert.match(extendedRequest.messages[1].content,/СООБЩЕНИЕ 4/u,
  "the retained history should keep the correct recent chronological window");
assert.match(extendedRequest.messages[16].content,/СООБЩЕНИЕ 19/u,
  "the newest prior message should remain immediately before the current prompt");
assert.equal(extendedRequest.messages.some(row=>row.content.includes("Чужая тема не должна попасть")),false,
  "extended history must remain isolated to the active topic");

const oversizedRows = Array.from({ length:16 }, (_, index) => ({
  threadId:"T-long", role:"assistant", text:"Длинное сообщение " + index + " " + "я".repeat(1300)
}));
const boundedRequest = bridge.buildRequest("Текущий запрос", {
  activeThread:{ id:"T-long", title:"Длинная беседа" }, recentMessages:oversizedRows
}, []);
assert.ok(boundedRequest.metadata.historyCharacters <= 10000,
  "long transcripts must be trimmed to the total character budget");
assert.ok(boundedRequest.messages.length <= 18,
  "the request must never exceed the worker's message-count limit");
assert.match(request.messages[0].content, /пользовательскими данными/u);
assert.match(request.messages[request.messages.length - 1].content, /Пользователь наблюдал усталость/u);
(async () => {
  const gateway = bridge.create();
  assert.equal(gateway.status().connected, false);
  await assert.rejects(() => gateway.generate(request), /пока не подключена/u);
  gateway.register("test-provider", { async generate(payload) { return "Связный ответ"; } });
  assert.equal(gateway.status().connected, true);
  assert.equal(await gateway.generate(request), "Связный ответ");
  gateway.unregister("test-provider");
  assert.equal(gateway.status().connected, false);

  const httpCalls = [];
  const adapter = bridge.createHttpAdapter(
    { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
    async (url, options) => {
      httpCalls.push({ url, options });
      if (url.endsWith("/api/health")) {
        return { ok: true, status: 200, async json() { return { ok: true, configured: true, model: "test-model" }; } };
      }
      return { ok: true, status: 200, async json() { return { ok: true, reply: "Ответ через защищённый шлюз" }; } };
    }
  );
  const health = await adapter.health();
  assert.equal(health.ok, true);
  assert.equal(health.model, "test-model");
  assert.equal(await adapter.generate(request), "Ответ через защищённый шлюз");
  assert.equal(httpCalls[0].url, "https://neurogenesis-test.workers.dev/api/health");
  assert.equal(httpCalls[1].url, "https://neurogenesis-test.workers.dev/api/chat");
  assert.equal(httpCalls[1].options.headers.Authorization, "Bearer private-app-token");
  assert.equal(httpCalls[1].options.body.includes("private-app-token"), false,
    "the app access token must be sent only as an authorization header");
  assert.throws(() => bridge.createHttpAdapter({ endpoint: "http://example.com", clientToken: "x" }),
    /HTTPS/u, "public gateways must require HTTPS");
  assert.throws(() => bridge.createHttpAdapter({ endpoint: "https://example.com" }),
    /ключ доступа/u, "the adapter must not connect without an app access token");
  console.log("NEUROGENESIS language-model bridge and authenticated HTTP adapter: passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
