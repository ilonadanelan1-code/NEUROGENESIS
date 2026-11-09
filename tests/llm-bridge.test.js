"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
vm.runInNewContext(fs.readFileSync("llm-bridge.js", "utf8"), sandbox, { filename: "llm-bridge.js" });
const bridge = window.NGLLMBridge;
const context = {
  activeThread: { title: "Недостаток сна и усталость" },
  recentMessages: [
    { role: "user", text: "Я плохо спал и чувствую усталость" },
    { role: "assistant", text: "Сколько часов ты спал?" },
    { role: "user", text: "Примерно четыре часа" }
  ]
};
const request = bridge.buildRequest("А почему?", context, [
  { text: "Пользователь наблюдал усталость после короткого сна.", source: "M1", kind: "observation", status: "user_supplied" }
]);
assert.equal(request.schema, "NEUROGENESIS_LLM_REQUEST_V1");
assert.equal(request.messages[0].role, "system");
assert.match(request.messages[0].content, /не изменяешь эти слои/u);
assert.equal(request.messages[request.messages.length - 1].content.startsWith("А почему?"), true);
assert.equal(request.metadata.historyMessages, 2, "the current user message should not be duplicated in history");
assert.match(request.messages[request.messages.length - 1].content, /пользовательским данным/u);
(async () => {
  const gateway = bridge.create();
  assert.equal(gateway.status().connected, false);
  await assert.rejects(() => gateway.generate(request), /пока не подключена/u);
  gateway.register("test-provider", { async generate(payload) { return "Связный ответ"; } });
  assert.equal(gateway.status().connected, true);
  assert.equal(await gateway.generate(request), "Связный ответ");
  gateway.unregister("test-provider");
  assert.equal(gateway.status().connected, false);
  console.log("NEUROGENESIS language-model bridge: passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
