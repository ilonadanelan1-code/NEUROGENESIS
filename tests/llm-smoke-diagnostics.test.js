"use strict";
// Contract tests for the settings-panel "Проверить реальный ответ" probe.
// All network traffic is mocked: no real provider, no real secrets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { Blob } = require("node:buffer");

const SCRIPTS = ["knowledge.js", "goals.js", "observation-engine.js", "knowledge-graph.js", "reasoning-audit.js",
  "hypothesis-lifecycle.js", "discriminating-observations.js", "dialog-context.js", "dialog-manager.js", "llm-bridge.js", "memory.js"];
const ENDPOINT = "https://neurogenesis-test.workers.dev";
const APP_TOKEN = "TEST-APP-TOKEN-0123456789";
const UPSTREAM_KEY = "sk-test-upstream-0123456789abcdef";
const LLM_KEY = "neurogenesis.llm-config.v1";

class ElementStub {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.hidden = false; this.textContent = ""; this.value = ""; this.scrollHeight = 0; this.files = []; this.disabled = false;
  }
  addEventListener(type, listener) { ((this.listeners ||= Object.create(null))[type] ||= []).push(listener); }
  dispatch(type, event = {}) {
    return Promise.all((this.listeners && this.listeners[type] || []).map(listener => listener({ target: this, preventDefault() {}, ...event })));
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  remove() {} focus() {} scrollIntoView() {} click() {}
}

function boot({ saved = null, fetchImpl, preload = {} } = {}) {
  const database = new Map(Object.entries(preload));
  if (saved) database.set(LLM_KEY, JSON.stringify(saved));
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new ElementStub()); return elements.get(id); },
    createElement() { return new ElementStub(); }, querySelector() { return null; }, body: new ElementStub()
  };
  const calls = { health: 0, chat: [] };
  const defaultFetch = async (url, options) => {
    if (String(url).endsWith("/api/health")) { calls.health++; return { ok: true, status: 200, async json() { return { ok: true, configured: true, model: "primary/model", fallbackModels: ["openrouter/free"] }; } }; }
    calls.chat.push(String(options && options.body || ""));
    return { ok: true, status: 200, async json() { return { ok: true, reply: "Связь работает.", model: "primary/model", requestedModel: "primary/model", fallbackUsed: false, usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }; } };
  };
  const fetchFn = async (url, options) => {
    if (fetchImpl) { const handled = await fetchImpl(url, options, calls); if (handled) return handled; }
    return defaultFetch(url, options);
  };
  const window = { confirm() { return true; }, fetch: fetchFn };
  const localStorage = {
    getItem(key) { return database.has(key) ? database.get(key) : null; },
    setItem(key, value) { database.set(key, String(value)); },
    removeItem(key) { database.delete(key); }
  };
  const sandbox = { window, document, localStorage, console: { ...console, warn() {} }, Date, Math, Set, Map, JSON, URL, Blob, AbortController, setTimeout, clearTimeout, fetch: fetchFn };
  for (const file of SCRIPTS) vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return { window, document, database, calls, el: id => document.getElementById(id) };
}

function snapshot(app) {
  const stored = {};
  for (const [key, value] of app.database) if (key !== LLM_KEY) stored[key] = value;
  return JSON.stringify({
    stored, count: app.window.NGMemory.count(), claims: app.window.NGMemory.claims().length,
    dialog: app.window.NGMemory.dialogHistory().length, cycles: app.window.NGMemory.cognitiveCycles().length
  });
}
const reply = (status, body) => ({ ok: status < 400, status, async json() { return body; } });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function typeCredentials(app) {
  app.el("llm-endpoint").value = ENDPOINT;
  app.el("llm-client-token").value = APP_TOKEN;
  return Promise.all([app.el("llm-endpoint").dispatch("input"), app.el("llm-client-token").dispatch("input")]);
}

(async () => {
  // 1. Button gating and no automatic request on load.
  {
    const app = boot();
    assert.equal(app.el("llm-smoke-test").disabled, true, "the probe must be disabled until gateway address and APP_TOKEN are entered");
    await app.el("llm-endpoint").dispatch("input");
    assert.equal(app.el("llm-smoke-test").disabled, true, "an address alone is not enough");
    await typeCredentials(app);
    assert.equal(app.el("llm-smoke-test").disabled, false, "address + token enable the probe");
    assert.equal(app.calls.chat.length + app.calls.health, 0, "typing must never trigger network traffic");

    const preloaded = boot({ saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN } });
    await flush();
    assert.equal(preloaded.calls.chat.length + preloaded.calls.health, 0, "a saved configuration must not auto-send a test on page load");
    assert.equal(preloaded.el("llm-smoke-test").disabled, false, "a registered adapter enables the probe");
    assert.match(preloaded.el("llm-smoke-result").textContent, /ещё не проверялся/u);
  }

  // 2. Health alone never reads as "the model answered".
  {
    const app = boot({ saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN } });
    await app.window.NGMemory.testLLMConnection();
    const result = app.el("llm-smoke-result").textContent, badge = app.el("llm-connection-status").textContent;
    assert.match(result, /ШЛЮЗ ОТВЕЧАЕТ/u);
    assert.match(result, /ГЕНЕРАЦИЯ МОДЕЛИ: не проверена/u);
    assert.match(result, /Резерв настроен \(не значит «использован»\): openrouter\/free/u, "configured fallbacks are shown as configured, not as used");
    assert.doesNotMatch(result + badge, /МОДЕЛЬ ОТВЕТИЛА|СГЕНЕРИРОВАЛА|УСПЕХ/u);
    assert.match(badge, /ГЕНЕРАЦИЯ НЕ ПРОВЕРЕНА/u);
    assert.equal(app.calls.chat.length, 0, "health must not call /api/chat");
  }

  // 3. Primary route + isolation from dialogue, memory, knowledge, cycles and storage.
  {
    const app = boot({ saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN } });
    const before = snapshot(app);
    await app.el("llm-smoke-test").dispatch("click");
    await app.window.NGMemory.testLLMGeneration(); // shared in-flight/finished probe
    const text = app.el("llm-smoke-result").textContent;
    assert.match(text, /УСПЕХ/u);
    assert.match(text, /Ответила: primary\/model/u);
    assert.match(text, /Маршрут: ОСНОВНОЙ/u);
    assert.doesNotMatch(text, /РЕЗЕРВНЫЙ/u, "a primary answer must not look like a fallback");
    assert.match(text, /Токены: запрос 20 · ответ 4 · всего 24/u);
    assert.match(text, /Фрагмент: «Связь работает\.»/u);
    assert.equal(app.el("llm-connection-status").textContent, "МОДЕЛЬ ОТВЕТИЛА · primary/model");
    assert.equal(snapshot(app), before, "the probe must not touch dialogue, memory, knowledge, cognitive cycles or any stored data");
    assert.equal([...app.database.values()].some(value => value.includes("связь работает")), false, "probe text must not be persisted anywhere");
    assert.equal(app.calls.chat.length >= 1, true);
    const body = JSON.parse(app.calls.chat[0]);
    assert.equal(body.messages.length, 2, "the probe carries no history, evidence or topic context");
    assert.equal(body.metadata.purpose, "gateway_smoke_test");
    assert.equal(app.el("llm-smoke-test").disabled, false);
    assert.equal(app.el("llm-smoke-test").dataset.state, "idle");
  }

  // 4. Fallback route (router returns a concrete model id), and answers without metadata.
  {
    const app = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async url => String(url).endsWith("/api/chat")
        ? reply(200, { ok: true, reply: "Резервный ответ", model: "vendor/concrete:free", requestedModel: "openrouter/free", fallbackUsed: true, usage: null }) : null
    });
    await app.window.NGMemory.testLLMGeneration();
    const text = app.el("llm-smoke-result").textContent;
    assert.match(text, /Ответила: vendor\/concrete:free/u);
    assert.match(text, /Маршрут: РЕЗЕРВНЫЙ/u);
    assert.match(text, /Запрошенный маршрут: openrouter\/free/u);
    assert.doesNotMatch(text, /Токены/u, "usage is shown only when the provider sent it");

    const bare = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async url => String(url).endsWith("/api/chat") ? reply(200, { ok: true, reply: "Просто текст" }) : null
    });
    await bare.window.NGMemory.testLLMGeneration();
    assert.match(bare.el("llm-smoke-result").textContent, /Ответила: ID модели сервер не сообщил/u);
    assert.match(bare.el("llm-smoke-result").textContent, /Маршрут: сервер не сообщил/u);
  }

  // 5. Legacy adapter with generate() only still works end to end.
  {
    const app = boot();
    app.window.NGLLM.register("legacy-test", { async generate() { return "Ответ старого адаптера"; } });
    await flush();
    app.window.NGMemory.clearLLMConfig(); // updates button state; the legacy provider stays registered
    await app.window.NGMemory.testLLMGeneration();
    const text = app.el("llm-smoke-result").textContent;
    assert.match(text, /УСПЕХ/u);
    assert.match(text, /Ответила: ID модели сервер не сообщил/u, "a legacy adapter must not get an invented model name");
    assert.equal(await app.window.NGLLM.generate(app.window.NGLLMBridge.buildSmokeRequest()), "Ответ старого адаптера");
  }

  // 6. Double tap: one request, loading state, clean recovery.
  {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const app = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async (url, options, calls) => {
        if (!String(url).endsWith("/api/chat")) return null;
        calls.chat.push(String(options.body));
        await gate;
        return reply(200, { ok: true, reply: "Готово", model: "primary/model", requestedModel: "primary/model", fallbackUsed: false, usage: null });
      }
    });
    const button = app.el("llm-smoke-test");
    await button.dispatch("click");
    await button.dispatch("click");
    const third = app.window.NGMemory.testLLMGeneration();
    await flush();
    assert.equal(app.calls.chat.length, 1, "repeated taps must not create parallel duplicate probes");
    assert.equal(button.disabled, true, "the button is disabled while loading");
    assert.equal(button.textContent, "ПРОВЕРЯЮ…");
    assert.equal(button.attributes["aria-busy"], "true");
    assert.match(app.el("llm-smoke-result").textContent, /ПРОВЕРЯЮ/u);
    release();
    await third;
    assert.equal(app.calls.chat.length, 1);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Проверить реальный ответ");
    assert.equal(button.attributes["aria-busy"], "false");
    assert.match(app.el("llm-smoke-result").textContent, /УСПЕХ/u);
  }

  // 7. Failure matrix: clear messages, no secrets, button restored, no stored data touched.
  const failures = [
    ["401", async () => reply(401, { error: "unauthorized" }), /401.*APP_TOKEN/u],
    ["503", async () => reply(503, { error: "provider_not_configured" }), /не настроены провайдер.*503/u],
    ["429", async () => reply(502, { error: "upstream_error", upstream_status: 429 }), /429.*Резервные маршруты \(openrouter\/free\) тоже не дали ответа/u],
    ["provider 401", async () => reply(502, { error: "upstream_error", upstream_status: 401 }), /UPSTREAM_API_KEY/u],
    ["worker timeout", async () => reply(504, { error: "upstream_timeout" }), /не ответил за отведённое время/u],
    ["network", async () => { throw new Error("socket closed; Authorization: Bearer " + APP_TOKEN + " key " + UPSTREAM_KEY); }, /Не удалось связаться со шлюзом/u]
  ];
  for (const [name, handler, expected] of failures) {
    const app = boot({ saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN }, fetchImpl: async url => String(url).endsWith("/api/chat") ? handler() : null });
    await app.window.NGMemory.testLLMConnection(); // learns configured fallback routes from /api/health
    const before = snapshot(app);
    const state = await app.window.NGMemory.testLLMGeneration();
    const text = app.el("llm-smoke-result").textContent;
    assert.equal(state.status, "error", name);
    assert.match(text, /ОШИБКА · МОДЕЛЬ НЕ ОТВЕТИЛА/u, name);
    assert.match(text, expected, name + ": " + text);
    for (const secret of [APP_TOKEN, UPSTREAM_KEY, "Bearer", "Authorization"]) {
      assert.equal(text.includes(secret) || app.el("llm-connection-status").textContent.includes(secret), false, name + " must not reveal " + secret);
    }
    assert.equal(app.el("llm-smoke-test").disabled, false, name + ": the button must leave the loading state");
    assert.equal(app.el("llm-smoke-test").dataset.state, "idle", name);
    assert.equal(snapshot(app), before, name + ": failures must not write user data");
    assert.doesNotMatch(app.el("llm-connection-status").textContent, /МОДЕЛЬ ОТВЕТИЛА/u, name + ": a failed probe must not look like success");
  }
  {
    // Fallback list known to be empty vs unknown.
    const app = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async url => String(url).endsWith("/api/health")
        ? reply(200, { ok: true, configured: true, model: "primary/model", fallbackModels: [] })
        : String(url).endsWith("/api/chat") ? reply(502, { error: "upstream_error", upstream_status: 503 }) : null
    });
    await app.window.NGMemory.testLLMConnection();
    await app.window.NGMemory.testLLMGeneration();
    assert.match(app.el("llm-smoke-result").textContent, /Резервные модели на сервере не настроены/u);
    const unknown = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async url => String(url).endsWith("/api/chat") ? reply(502, { error: "upstream_unreachable" }) : null
    });
    await unknown.window.NGMemory.testLLMGeneration();
    assert.match(unknown.el("llm-smoke-result").textContent, /мог быть недоступен или не настроен/u);

    // A non-retryable provider error never reaches a fallback, so the UI must not claim one failed.
    const nonRetryable = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async url => String(url).endsWith("/api/chat") ? reply(502, { error: "upstream_error", upstream_status: 400 }) : null
    });
    await nonRetryable.window.NGMemory.testLLMGeneration();
    assert.doesNotMatch(nonRetryable.el("llm-smoke-result").textContent, /Резерв/u);

    // Third-party adapter errors are redacted even without a known code.
    const custom = boot();
    custom.window.NGLLM.register("leaky-test", { async generate() { throw new Error("failed with Authorization: Bearer " + APP_TOKEN + " and " + UPSTREAM_KEY); } });
    custom.window.NGMemory.clearLLMConfig();
    await custom.window.NGMemory.testLLMGeneration();
    const leaked = custom.el("llm-smoke-result").textContent;
    assert.match(leaked, /ОШИБКА/u);
    assert.equal(leaked.includes(APP_TOKEN) || leaked.includes(UPSTREAM_KEY) || /Bearer\s+\S*[A-Z0-9]{8}/u.test(leaked), false, "unknown errors must be redacted");

    // Typed-but-unsaved credentials are used and never persisted by the probe.
    const typed = boot({ fetchImpl: async (url, options, calls) => {
      if (String(url).endsWith("/api/chat")) { calls.auth = options.headers.Authorization; calls.chat.push(String(options.body)); return reply(200, { ok: true, reply: "ok", model: "m" }); }
      return null;
    } });
    await typeCredentials(typed);
    const typedResult = await typed.window.NGMemory.testLLMGeneration();
    assert.equal(typedResult.status, "ok", "an unsaved-but-typed token must complete the probe");
    assert.match(typed.el("llm-smoke-result").textContent, /УСПЕХ/u, "the result must leave the loading state and render success");
    assert.doesNotMatch(typed.el("llm-smoke-result").textContent, /ПРОВЕРЯЮ/u, "the loading state must not remain stuck");
    assert.equal(typed.calls.auth, "Bearer " + APP_TOKEN);
    assert.equal(typed.database.has(LLM_KEY), false, "the probe must not save credentials the user did not choose to save");
  }

  // 8. Ordinary chat keeps working and now surfaces which route answered.
  {
    const app = boot({ saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN } });
    const sent = await app.window.NGMemory.askLLM("Расскажи про нейроны");
    assert.equal(sent, true);
    const feedback = app.el("memory-feedback").textContent;
    assert.match(feedback, /ОТВЕТ ПОЛУЧЕН · ПАМЯТЬ НЕ ИЗМЕНЕНА · МОДЕЛЬ: primary\/model · ОСНОВНОЙ МАРШРУТ/u);
    assert.equal(app.window.NGMemory.dialogHistory().slice(-1)[0].text, "Связь работает.");

    const plain = boot({
      saved: { endpoint: ENDPOINT, clientToken: APP_TOKEN },
      fetchImpl: async url => String(url).endsWith("/api/chat") ? reply(200, { ok: true, reply: "Без метаданных" }) : null
    });
    assert.equal(await plain.window.NGMemory.askLLM("Расскажи про нейроны"), true);
    assert.equal(plain.el("memory-feedback").textContent, "ЯЗЫКОВАЯ МОДЕЛЬ · ОТВЕТ ПОЛУЧЕН · ПАМЯТЬ НЕ ИЗМЕНЕНА",
      "answers without metadata keep the exact previous feedback text");
  }

  // 9. Markup contract for the settings block.
  {
    const html = fs.readFileSync("index.html", "utf8");
    assert.match(html, /<button[^>]*id="llm-smoke-test"[^>]*\bdisabled\b[^>]*>Проверить реальный ответ<\/button>/u);
    assert.match(html, /id="llm-smoke-result"[^>]*role="status"[^>]*aria-live="polite"/u);
    const css = fs.readFileSync("styles.css", "utf8");
    assert.match(css, /\.llm-config-smoke\{grid-column:1\/-1\}/u, "the probe button spans the full row on narrow screens");
    assert.match(css, /\.llm-smoke-result\{[^}]*overflow-wrap:anywhere/u, "long model ids must wrap instead of overflowing a phone screen");
  }

  console.log("NEUROGENESIS LLM real-response probe: gating, health/chat separation, route reporting, isolation, double-tap and safe errors passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });

