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
  activeThread: { title: "Недостаток сна и усталость" },
  recentMessages: [
    { role: "user", text: "Я плохо спал и чувствую усталость" },
    { role: "assistant", text: "Сколько часов ты спал?" },
    { role: "user", text: "Примерно четыре часа" },
    { role: "assistant", text: "Понял. А почему ты связываешь это с усталостью?" },
    { role: "user", text: "А почему?" }
  ]
};
const request = bridge.buildRequest("А почему?", context, [
  { text: "Пользователь наблюдал усталость после короткого сна.", source: "M1", kind: "observation", status: "user_supplied" }
]);
assert.equal(request.schema, "NEUROGENESIS_LLM_REQUEST_V1");
assert.equal(request.messages[0].role, "system");
assert.match(request.messages[0].content, /не изменяешь эти слои/u);
assert.equal(request.messages[request.messages.length - 1].content.startsWith("А почему?"), true);
assert.equal(request.metadata.historyMessages, 4, "the current user message should be removed while earlier turns remain in history");
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
