"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { URL } = require("node:url");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, URL, AbortController, setTimeout, clearTimeout };
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
const focusContext={...context,focus:{
 threadId:"T-sleep",referenceType:"ellipsis",anchor:{text:"Я плохо спал и чувствую усталость"},
 candidates:[{text:"Я плохо спал и чувствую усталость"},{text:"Примерно четыре часа"}],
 latestUser:{text:"Примерно четыре часа",relation:"answer_to_question"},
 latestAssistant:{text:"Понял. А почему ты связываешь это с усталостью?"},needsDisambiguation:false
}};
const request = bridge.buildRequest("А почему?", focusContext, [
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
assert.equal(request.metadata.pendingQuestionCount, 0,
  "the request should report no open clarification questions when none are present");
assert.equal(request.messages.some(row => row.content.includes("В музыке важна гармония")), false,
  "messages from another topic must never reach the language model");
assert.equal(request.messages.some(row => row.content.includes("tool output")), false,
  "non-dialogue roles must never enter the language model history");
assert.ok(request.messages.some(row => row.content.includes("Сколько часов ты спал?")),
  "the active thread's previous assistant question must remain in context");
assert.match(request.messages[request.messages.length-1].content,/КАНДИДАТ КОНТЕКСТНОГО ФОКУСА/u);
assert.match(request.messages[request.messages.length-1].content,/Опорная реплика пользователя/u);
assert.equal(request.metadata.focusAnchorCharacters,"Я плохо спал и чувствую усталость".length);
assert.equal(request.metadata.focusCandidateCount,2);

// Open clarification questions must be forwarded as unresolved context, not silently dropped.
const pendingRequest = bridge.buildRequest("Примерно четыре часа", {
  activeThread: {
    id: "T-sleep", title: "Недостаток сна и усталость",
    pendingQuestions: ["Почему ты связываешь короткий сон с усталостью?", "Как часто это повторяется?"]
  },
  recentMessages: [{ threadId: "T-sleep", role: "user", text: "Я плохо спал" }]
}, []);
assert.match(pendingRequest.messages[pendingRequest.messages.length - 1].content,
  /НЕЗАКРЫТЫЕ УТОЧНЯЮЩИЕ ВОПРОСЫ/u);
assert.match(pendingRequest.messages[pendingRequest.messages.length - 1].content,
  /Почему ты связываешь короткий сон с усталостью/u);
assert.match(pendingRequest.messages[pendingRequest.messages.length - 1].content,
  /Как часто это повторяется/u);
assert.equal(pendingRequest.metadata.pendingQuestionCount, 2);
const unscopedPending = bridge.buildRequest("Новый вопрос", {
  activeThread: { title: "Без ID", pendingQuestions: ["Не передавать этот вопрос"] },
  recentMessages: []
}, []);
assert.equal(unscopedPending.metadata.pendingQuestionCount, 0,
  "pending questions must not be forwarded without a confirmed active topic ID");

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
const unscopedFocusRequest=bridge.buildRequest("Продолжим?",{
 activeThread:{title:"Тема без ID"},recentMessages:[],
 focus:{threadId:"T-foreign",anchor:{text:"Сведения из чужой темы"},candidates:[]}
},[]);
assert.doesNotMatch(unscopedFocusRequest.messages.map(row=>row.content).join("\n"),/Сведения из чужой темы/u);
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
assert.ok(extendedRequest.metadata.historyCharacters <= 14000,
  "dialogue history must respect the shared fourteen-thousand-character budget");
assert.match(extendedRequest.messages[1].content,/СООБЩЕНИЕ 4/u,
  "the retained history should keep the correct recent chronological window");
assert.match(extendedRequest.messages[16].content,/СООБЩЕНИЕ 19/u,
  "the newest prior message should remain immediately before the current prompt");
assert.equal(extendedRequest.messages.some(row=>row.content.includes("Чужая тема не должна попасть")),false,
  "extended history must remain isolated to the active topic");

const duplicateHistoryRows = [
  { id:"M-old-user", threadId:"T-duplicates", role:"user", text:"Старая реплика" },
  { id:"M-old-user", threadId:"T-duplicates", role:"user", text:"Старая реплика" },
  { id:"M-old-assistant", threadId:"T-duplicates", role:"assistant", text:"Ответ в теме" },
  { id:"M-current", threadId:"T-duplicates", role:"user", text:"Текущий вопрос" },
  { id:"M-current", threadId:"T-duplicates", role:"user", text:"Текущий вопрос" }
];
const deduplicatedRequest = bridge.buildRequest("Текущий вопрос", {
  activeThread:{ id:"T-duplicates", title:"Проверка повторов" },
  recentMessages:duplicateHistoryRows
}, []);
assert.equal(deduplicatedRequest.metadata.historyMessages,2,
  "duplicate message IDs must be removed before selecting the active-topic history");
assert.equal(deduplicatedRequest.messages.filter(row=>row.content==="Старая реплика").length,1,
  "a repeated stored message must reach the model only once");
assert.equal(deduplicatedRequest.messages.filter(row=>row.role==="user"&&row.content==="Текущий вопрос").length,1,
  "duplicate copies of the current prompt must not be repeated in the model history");

const oversizedRows = Array.from({ length:16 }, (_, index) => ({
  threadId:"T-long", role:"assistant", text:"Длинное сообщение " + index + " " + "я".repeat(1300)
}));
const boundedRequest = bridge.buildRequest("Текущий запрос", {
  activeThread:{ id:"T-long", title:"Длинная беседа" }, recentMessages:oversizedRows
}, []);
assert.ok(boundedRequest.metadata.historyCharacters <= 14000,
  "long transcripts must be trimmed to the fourteen-thousand-character dialogue budget");
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
  const semanticPlanRequest = {
    schema: "NEUROGENESIS_LLM_REQUEST_V2",
    messages: [
      { role: "system", content: "Определи смысл запроса, не отвечай." },
      { role: "user", content: "Сколько сердец у осьминога?" }
    ],
    metadata: { operation: "semantic_query_interpretation" }
  };
  assert.equal(await gateway.generate(semanticPlanRequest), "Связный ответ",
    "the bridge must accept V2 semantic interpretation requests as well as V1 dialogue requests");
  await assert.rejects(() => gateway.generate({
    schema: "NEUROGENESIS_LLM_REQUEST_V3", messages: [{ role: "user", content: "x" }]
  }), /Некорректный запрос/u, "unsupported request versions must still be rejected");
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
  assert.throws(() => bridge.createHttpAdapter({ endpoint: "https://example.com/api", clientToken: "x" }),
    /корневой адрес Worker/u, "gateway configuration must reject an API path that would be duplicated");
  const notFoundAdapter = bridge.createHttpAdapter(
    { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
    async () => ({ ok: false, status: 404, async json() { return { error: "not_found" }; } })
  );
  await assert.rejects(() => notFoundAdapter.health(), /Шлюз вернул 404/u,
    "a missing Worker route should explain that the gateway base URL or path is wrong");

  const notConfiguredAdapter = bridge.createHttpAdapter(
    { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
    async () => ({
      ok: false, status: 503,
      async json() { return { ok: true, configured: false, provider: "openai-compatible", model: "test-model" }; }
    })
  );
  await assert.rejects(
    () => notConfiguredAdapter.health(),
    /UPSTREAM_API_KEY/u,
    "a valid gateway with a missing provider secret must explain which Cloudflare secret is missing"
  );

  const providerErrorCases = [
    {
      code: "invalid_upstream_configuration", status: 500,
      message: /UPSTREAM_BASE_URL/u
    },
    {
      code: "invalid_json", status: 400,
      message: /Шлюз не смог разобрать запрос/u
    },
    {
      code: "invalid_upstream_response", status: 502,
      message: /неподдерживаемом формате/u
    },
    {
      code: "empty_model_response", status: 502,
      message: /не прислал текст сообщения/u
    }
  ];
  for (const failure of providerErrorCases) {
    const failingAdapter = bridge.createHttpAdapter(
      { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
      async () => ({
        ok: false,
        status: failure.status,
        async json() { return { error: failure.code }; }
      })
    );
    await assert.rejects(
      () => failingAdapter.generate(request),
      failure.message,
      "the client must explain the provider error code: " + failure.code
    );
  }

  const workerSource = fs.readFileSync("server/llm-worker.js", "utf8");
  const workerErrorCodes = [...new Set(
    [...workerSource.matchAll(/\berror\s*:\s*"([a-z_]+)"/gu)].map(match => match[1])
  )];
  assert.ok(workerErrorCodes.length > 0, "the Worker must expose identifiable error codes");
  for (const code of workerErrorCodes) {
    const codeAdapter = bridge.createHttpAdapter(
      { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
      async () => ({
        ok: false,
        status: 502,
        async json() { return { error: code }; }
      })
    );
    await assert.rejects(
      () => codeAdapter.generate(request),
      error => Boolean(error && typeof error.message === "string" && !/^Ошибка серверного шлюза/u.test(error.message)),
      "the client must provide a specific explanation for Worker error: " + code
    );
  }

  let neverResolvingSignal = null;
  const hangingAdapter = bridge.createHttpAdapter(
    { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token", requestTimeoutMs: 25 },
    async (_url, options) => {
      neverResolvingSignal = options.signal;
      return new Promise(() => {});
    }
  );
  await assert.rejects(() => hangingAdapter.health(), /Истекло время ожидания проверки шлюза/u,
    "a health request that never resolves must fail within its deadline");
  assert.equal(neverResolvingSignal.aborted, true,
    "the browser should abort the timed-out network request when AbortController is available");

  const hangingBodyAdapter = bridge.createHttpAdapter(
    { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token", requestTimeoutMs: 25 },
    async () => ({ ok: true, status: 200, async json() { return new Promise(() => {}); } })
  );
  await assert.rejects(() => hangingBodyAdapter.generate(request), /Истекло время ожидания ответа модели/u,
    "a response whose body never finishes parsing must also be bounded");
  const longReply = "Д".repeat(10000);
  const capacityGateway = bridge.create();
  capacityGateway.register("capacity-test", { async generate() { return longReply; } });
  assert.equal(await capacityGateway.generate(request), longReply,
    "the chat gateway must preserve a ten-thousand-character answer instead of truncating it at eight thousand");

  // --- Detailed replies: model, requested route, fallback flag and usage must survive the adapter. ---
  const plain = value => JSON.parse(JSON.stringify(value)); // results come from the vm realm
  const chatBodies = [];
  function workerAdapter(chatPayload, healthPayload) {
    return bridge.createHttpAdapter(
      { endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
      async (url, options) => {
        if (url.endsWith("/api/health")) return { ok: true, status: 200, async json() { return healthPayload || { ok: true, configured: true, model: "primary/model", fallbackModels: ["openrouter/free"] }; } };
        chatBodies.push(options.body);
        return { ok: true, status: 200, async json() { return chatPayload; } };
      });
  }
  const primaryAdapter = workerAdapter({ ok: true, reply: " Основной ответ ", model: "primary/model", requestedModel: "primary/model", fallbackUsed: false,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } });
  assert.equal(await primaryAdapter.generate(request), "Основной ответ", "generate() must keep returning a plain string");
  const primaryDetails = await primaryAdapter.generateDetailed(request);
  assert.deepEqual(plain(primaryDetails), { reply: "Основной ответ", model: "primary/model", requestedModel: "primary/model", fallbackUsed: false,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }, "a primary-route answer must not be reported as a fallback");
  const { generate: detachedGenerate } = primaryAdapter;
  assert.equal(await detachedGenerate(request), "Основной ответ", "adapter methods must not depend on `this`");

  const routerAdapter = workerAdapter({ ok: true, reply: "Ответ роутера", model: "vendor/concrete-model:free", requestedModel: "openrouter/free", fallbackUsed: true, usage: null });
  const routerDetails = await routerAdapter.generateDetailed(request);
  assert.equal(routerDetails.fallbackUsed, true, "openrouter/free is a fallback even when the router names a concrete model");
  assert.equal(routerDetails.model, "vendor/concrete-model:free");
  assert.equal(routerDetails.requestedModel, "openrouter/free");
  assert.equal(routerDetails.usage, null);

  const bareAdapter = workerAdapter({ ok: true, reply: "Только текст" });
  assert.deepEqual(plain(await bareAdapter.generateDetailed(request)), { reply: "Только текст", model: null, requestedModel: null, fallbackUsed: null, usage: null },
    "metadata the server did not send must stay null instead of being invented");
  const junkAdapter = workerAdapter({ ok: true, reply: "x", model: "bad model\nid", fallbackUsed: "yes", usage: { prompt_tokens: "abc", total_tokens: -3 } });
  const junkDetails = await junkAdapter.generateDetailed(request);
  assert.equal(junkDetails.model, null);
  assert.equal(junkDetails.fallbackUsed, null);
  assert.equal(junkDetails.usage, null, "unusable usage values must be dropped");

  const healthDetails = await workerAdapter({}, undefined).health();
  assert.deepEqual(plain(healthDetails.fallbackModels), ["openrouter/free"], "health() must pass configured fallback models to the UI");
  assert.equal((await workerAdapter({}, { ok: true, configured: true, model: "m" }).health()).fallbackModels, null,
    "a health payload without fallbackModels must not claim an empty fallback list");

  // Gateway: generate() stays a string, generateDetailed() wraps legacy adapters without inventing metadata.
  const detailGateway = bridge.create();
  detailGateway.register("detail-test", primaryAdapter);
  assert.equal(typeof await detailGateway.generate(request), "string");
  assert.equal((await detailGateway.generateDetailed(request)).model, "primary/model");
  const legacyGateway = bridge.create();
  legacyGateway.register("legacy-test", { async generate() { return "Старый адаптер"; } });
  assert.deepEqual(plain(await legacyGateway.generateDetailed(request)), { reply: "Старый адаптер", model: null, requestedModel: null, fallbackUsed: null, usage: null });
  assert.equal(await legacyGateway.generate(request), "Старый адаптер");
  await assert.rejects(() => legacyGateway.generateDetailed({ schema: "NEUROGENESIS_LLM_REQUEST_V3", messages: [{ role: "user", content: "x" }] }), /Некорректный запрос/u);
  await assert.rejects(() => bridge.create().generateDetailed(request), /не подключена/u);
  const emptyGateway = bridge.create();
  emptyGateway.register("empty-test", { async generate() { return "  "; } });
  await assert.rejects(() => emptyGateway.generateDetailed(request), /пустой/u);

  // Smoke request: fixed, history-free, accepted by the gateway validator.
  const smoke = bridge.buildSmokeRequest();
  assert.equal(smoke.messages.length, 2);
  assert.equal(smoke.messages.some(row => row.content.includes("T-sleep")), false);
  assert.equal((await detailGateway.generateDetailed(smoke)).reply, "Основной ответ");

  // Failures carry stable codes and never echo the access token.
  for (const [status, payload, code] of [[401, { error: "unauthorized" }, "unauthorized"], [503, { error: "provider_not_configured" }, "provider_not_configured"],
    [502, { error: "upstream_error", upstream_status: 429 }, "upstream_error"], [504, { error: "upstream_timeout" }, "upstream_timeout"]]) {
    const failing = bridge.createHttpAdapter({ endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" },
      async () => ({ ok: false, status, async json() { return payload; } }));
    await assert.rejects(() => failing.generateDetailed(request), error => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(String(error.message).includes("private-app-token"), false);
      if (payload.upstream_status) assert.equal(error.upstreamStatus, 429);
      return true;
    });
  }
  const offline = bridge.createHttpAdapter({ endpoint: "https://neurogenesis-test.workers.dev", clientToken: "private-app-token" }, async () => { throw new Error("socket Bearer private-app-token"); });
  await assert.rejects(() => offline.generateDetailed(request), error => error.code === "network" && !String(error.message).includes("private-app-token"));

  console.log("NEUROGENESIS language-model bridge and authenticated HTTP adapter: passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
