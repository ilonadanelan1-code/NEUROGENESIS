"use strict";
/*
 * NEUROGENESIS local LLM adapter.
 *
 * Page-side wrapper around local-llm-worker.js that satisfies the LLM_GATEWAY provider contract
 * (generate(request) -> string, generateDetailed(request) -> {reply, model, requestedModel, fallbackUsed, usage}).
 * It does NOT register itself and does not change routing: call adapter.registerWith(NGLLM) when ready.
 * The model is never downloaded implicitly: generate() before load() fails with code "model_not_loaded".
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root && typeof root === "object") root.NGLocalLLM = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const SCRIPT_BASE = (function () {
    try { return root.document && root.document.currentScript && root.document.currentScript.src || ""; }
    catch (_) { return ""; }
  })();
  const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";

  function tagged(code, message) { const error = new Error(message); error.code = code; return error; }

  function trimMessages(messages, maxChars) {
    const rows = messages.map(row => ({ role: row.role, content: String(row.content) }));
    const size = list => list.reduce((sum, row) => sum + row.content.length, 0);
    while (size(rows) > maxChars && rows.length > 2) {
      const index = rows.findIndex(row => row.role !== "system");
      if (index < 0 || index === rows.length - 1) break;
      rows.splice(index, 1);               // drop the oldest non-system turn first
    }
    if (size(rows) > maxChars) {
      const last = rows[rows.length - 1];
      const others = size(rows) - last.content.length;
      last.content = last.content.slice(0, Math.max(200, maxChars - others));
    }
    if (size(rows) > maxChars) {
      const first = rows[0];
      if (first.role === "system" && rows.length > 1) first.content = first.content.slice(0, Math.max(200, maxChars - (size(rows) - first.content.length)));
    }
    return rows;
  }

  function create(config = {}) {
    const options = {
      workerUrl: config.workerUrl || (SCRIPT_BASE ? SCRIPT_BASE.replace(/[^/]*(?:\?.*)?$/u, "") + "local-llm-worker.js" : "./local-llm-worker.js"),
      workerFactory: typeof config.workerFactory === "function" ? config.workerFactory : url => new root.Worker(url),
      maxContextChars: Number.isFinite(config.maxContextChars) ? Math.max(1000, config.maxContextChars) : 9000,
      loadOptions: config.loadOptions || {},
      generation: config.generation || {},
      onToken: typeof config.onToken === "function" ? config.onToken : null,
      onStatus: typeof config.onStatus === "function" ? config.onStatus : null,
      onProgress: typeof config.onProgress === "function" ? config.onProgress : null,
      onDiagnostics: typeof config.onDiagnostics === "function" ? config.onDiagnostics : null,
      onProfile: typeof config.onProfile === "function" ? config.onProfile : null
    };
    let worker = null;
    let nextId = 1;
    let lastStatus = { phase: "idle", modelId: MODEL_ID };
    let loadPromise = null;
    let activeGeneration = null;
    const pending = new Map();   // id -> { resolve, reject, kind, onToken, onProgress }

    function settleAll(error) {
      for (const [, entry] of pending) entry.reject(error);
      pending.clear();
      loadPromise = null; activeGeneration = null;
    }
    function handle(message) {
      if (!message || typeof message !== "object") return;
      if (message.status) {
        lastStatus = message.status;
        if (options.onStatus) { try { options.onStatus(lastStatus); } catch (_) { /* listener errors must not break the adapter */ } }
      }
      const entry = message.id != null ? pending.get(message.id) : null;
      switch (message.type) {
        case "progress":
          if (entry && entry.onProgress) entry.onProgress(message);
          if (options.onProgress) options.onProgress(message);
          break;
        case "token":
          if (entry) {
            if (entry.onToken) entry.onToken(message.text, message);
            if (options.onToken) options.onToken(message.text, message);
          }
          break;
        case "diagnostics":
          if (options.onDiagnostics) options.onDiagnostics(message.diagnostics || null, message);
          break;
        case "profile":
          if (options.onProfile) options.onProfile(message.profile || null, message);
          break;
        case "loaded": case "done": case "cache-report": case "disposed":
          if (entry) { pending.delete(message.id); entry.resolve(message); }
          break;
        case "error":
          if (entry) { pending.delete(message.id); const error = tagged(message.code || "error", message.message || "Ошибка локальной модели."); error.details = message.details || null; entry.reject(error); }
          break;
        default: break;
      }
    }
    function ensureWorker() {
      if (worker) return worker;
      let created;
      try { created = options.workerFactory(options.workerUrl); }
      catch (error) { throw tagged("worker_unavailable", "Не удалось создать Web Worker: " + (error && error.message || error)); }
      if (!created || typeof created.postMessage !== "function") throw tagged("worker_unavailable", "Web Worker недоступен в этом окружении.");
      created.onmessage = event => handle(event && event.data);
      created.onerror = event => {
        const text = event && event.message || "Worker аварийно завершился.";
        worker = null; lastStatus = { ...lastStatus, phase: "error" };
        settleAll(tagged("worker_crashed", text));
      };
      worker = created;
      return worker;
    }
    function request(kind, payload, hooks = {}) {
      let target;
      try { target = ensureWorker(); } catch (error) { return Promise.reject(error); }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, kind, onToken: hooks.onToken || null, onProgress: hooks.onProgress || null });
        try { target.postMessage({ type: kind, id, ...payload }); }
        catch (error) { pending.delete(id); reject(tagged("worker_unavailable", "Не удалось отправить сообщение Worker: " + (error && error.message || error))); }
      });
    }

    function isReady() { return lastStatus.phase === "ready" || lastStatus.phase === "generating"; }

    function load(loadOptions, onProgress) {
      if (isReady()) return Promise.resolve({ alreadyLoaded: true, status: lastStatus });
      if (loadPromise) return loadPromise;
      loadPromise = request("load", { options: { ...options.loadOptions, ...(loadOptions || {}) } }, { onProgress })
        .finally(() => { loadPromise = null; });
      return loadPromise;
    }

    async function generateDetailed(gatewayRequest, callOptions = {}) {
      const messages = gatewayRequest && gatewayRequest.messages;
      if (!Array.isArray(messages) || !messages.length ||
          messages.some(row => !row || !["system", "user", "assistant"].includes(row.role) || typeof row.content !== "string" || !row.content.trim())) {
        throw tagged("bad_request", "Некорректный запрос к локальной модели.");
      }
      if (activeGeneration) throw tagged("busy", "Локальная модель уже формирует ответ.");
      if (!isReady()) {
        if (callOptions.autoLoad === true) await load(callOptions.loadOptions, callOptions.onProgress);
        else throw tagged("model_not_loaded", "Локальная модель не загружена. Загрузи её явно, прежде чем задавать вопрос.");
      }
      const trimmed = trimMessages(messages, options.maxContextChars);
      let streamed = "";
      const onToken = (text, raw) => { streamed += text; if (callOptions.onToken) callOptions.onToken(text, raw); };
      let abortHandler = null;
      const run = request("generate", {
        messages: trimmed,
        options: {
          ...options.generation,
          ...(callOptions.generation || {}),
          promptDiagnostics: callOptions.promptDiagnostics === true
        }
      }, { onToken });
      activeGeneration = run;
      if (callOptions.signal) {
        if (callOptions.signal.aborted) stop();
        else {
          abortHandler = () => stop();
          callOptions.signal.addEventListener("abort", abortHandler, { once: true });
        }
      }
      try {
        const done = await run;
        const reply = String(done.reply || streamed || "").trim();
        if (!reply) throw tagged(done.stopped ? "aborted" : "empty_reply", done.stopped ? "Генерация остановлена до первого символа." : "Модель вернула пустой ответ.");
        return {
          reply, model: done.modelId || lastStatus.modelId || MODEL_ID,
          requestedModel: done.modelId || lastStatus.modelId || MODEL_ID, fallbackUsed: null,
          usage: done.usage || null,
          stopped: !!done.stopped, device: done.device || null, dtype: done.dtype || null,
          elapsedMs: done.elapsedMs || null, tokensPerSecond: done.tokensPerSecond || null,
          metrics: done.metrics || null,
          gpuProfile: done.gpuProfile || null,
          promptDiagnostics: done.promptDiagnostics || null
        };
      } finally {
        activeGeneration = null;
        if (abortHandler) callOptions.signal.removeEventListener("abort", abortHandler);
      }
    }
    async function generate(gatewayRequest, callOptions) {
      return (await generateDetailed(gatewayRequest, callOptions)).reply;
    }
    function stop() {
      if (!worker || !activeGeneration) return false;
      worker.postMessage({ type: "stop" });
      return true;
    }
    function checkCache(loadOptions) { return request("check-cache", { options: { ...options.loadOptions, ...(loadOptions || {}) } }); }
    function status() { return { ...lastStatus, ready: isReady(), busy: !!activeGeneration, loading: !!loadPromise }; }
    async function unload() {
      if (!worker) return;
      stop();
      await request("dispose", {});
    }
    function dispose() {
      if (worker && typeof worker.terminate === "function") { try { worker.terminate(); } catch (_) { /* ignore */ } }
      worker = null; lastStatus = { phase: "idle", modelId: MODEL_ID };
      settleAll(tagged("disposed", "Адаптер локальной модели закрыт."));
    }
    // Registration does not explicitly select the provider. Note: NGLLMBridge.create()
    // automatically activates the first registered provider if the gateway has none active.
    // When another provider is already active, call gateway.select(name) explicitly.
    function registerWith(gateway, name = "local") {
      if (!gateway || typeof gateway.register !== "function") throw tagged("bad_gateway", "Шлюз не поддерживает register().");
      return gateway.register(name, api);
    }

    const api = { id: "local", modelId: MODEL_ID, load, generate, generateDetailed, stop, checkCache, status, unload, dispose, registerWith };
    return Object.freeze(api);
  }

  return Object.freeze({ version: 1, modelId: MODEL_ID, create, trimMessages });
});
