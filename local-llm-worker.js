"use strict";
/*
 * NEUROGENESIS local LLM worker.
 *
 * Real autoregressive generation (Qwen3-0.6B, ONNX, Transformers.js) inside a Web Worker.
 * Classic worker script: new Worker("local-llm-worker.js"). Nothing here touches the page,
 * memory.js or the dialogue engine. The model is downloaded only after an explicit "load" message.
 *
 * Messages from the page -> worker:
 *   {type:"load", id, options?:{device:"auto"|"webgpu"|"wasm", dtype, revision, modelId, runtimeUrl, requireOnline}}
 *   {type:"generate", id, messages:[{role,content}], options?:{max_new_tokens,temperature,top_p,top_k,repetition_penalty}}
 *   {type:"stop"} | {type:"status", id?} | {type:"check-cache", id} | {type:"dispose", id?}
 * Messages from the worker -> page:
 *   status | progress | loaded | token | done | cache-report | disposed | error  (error has {code,message,id?})
 */
(function (G) {
  const CONFIG = {
    modelId: "onnx-community/Qwen3-0.6B-ONNX",
    // Pinned to a verified Hugging Face model revision; never follows mutable "main".
    revision: "a7b503b1c3f7e98e8f80b6d565f47807a5007d9c",
    hubUrl: "https://huggingface.co",
    runtimeUrls: [
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2"
    ],
    metaCacheName: "ng-local-llm-meta-v1",
    metaTimeoutMs: 8000,
    dtypeSuffix: { q4f16: "_q4f16", q4: "_q4", fp16: "_fp16", fp32: "" },
    requiredFiles: ["config.json", "tokenizer.json", "tokenizer_config.json"],
    optionalFiles: ["generation_config.json"],
    maxMessages: 40,
    maxPromptChars: 60000,
    generation: { max_new_tokens: 384, temperature: 0.7, top_p: 0.8, top_k: 20, repetition_penalty: 1.05 }
  };

  const state = {
    phase: "idle",            // idle | loading | ready | generating | error
    modelId: CONFIG.modelId,
    revision: null,           // resolved commit SHA
    device: null,
    dtype: null,
    runtimeUrl: null,
    persisted: null,
    lastError: null,
    fellBack: false
  };
  let runtime = null;          // { mod, url }
  let tokenizer = null;
  let model = null;
  let loadPromise = null;
  let loadWaiters = [];
  let activeStop = null;       // InterruptableStoppingCriteria of the running generation
  let stopRequested = false;
  let activeGenerationId = null;

  function post(message) { G.postMessage(message); }
  function fail(code, message, extra) {
    const error = new Error(message);
    error.code = code;
    if (extra) error.details = extra;
    return error;
  }
  function describe(error) {
    return String(error && error.message ? error.message : error || "Неизвестная ошибка").slice(0, 600);
  }
  function publicStatus() {
    return {
      phase: state.phase, modelId: state.modelId, revision: state.revision, device: state.device,
      dtype: state.dtype, runtimeUrl: state.runtimeUrl, persisted: state.persisted,
      fellBack: state.fellBack, lastError: state.lastError
    };
  }
  function setPhase(phase) { state.phase = phase; post({ type: "status", status: publicStatus() }); }
  function reportError(id, error, code) {
    const resolvedCode = (error && error.code) || code || "error";
    state.lastError = { code: resolvedCode, message: describe(error) };
    post({ type: "error", id: id == null ? null : id, code: resolvedCode, message: describe(error), details: error && error.details || null });
  }

  /* ---------- device and dtype ---------- */
  async function detectDevice(preference) {
    const info = { webgpu: false, shaderF16: false, reason: null };
    try {
      const nav = G.navigator;
      if (!nav || !nav.gpu) info.reason = "navigator.gpu недоступен";
      else {
        const adapter = await nav.gpu.requestAdapter();
        if (!adapter) info.reason = "WebGPU-адаптер не найден";
        else {
          info.webgpu = true;
          info.shaderF16 = !!(adapter.features && typeof adapter.features.has === "function" && adapter.features.has("shader-f16"));
        }
      }
    } catch (error) { info.reason = describe(error); }
    if (preference === "wasm") return { device: "wasm", dtypes: ["q4", "fp16"], info };
    if (preference === "webgpu" && !info.webgpu) throw fail("webgpu_unavailable", "WebGPU недоступен: " + (info.reason || "неизвестная причина"));
    if (info.webgpu) return { device: "webgpu", dtypes: info.shaderF16 ? ["q4f16", "q4", "fp16"] : ["q4", "fp16"], info };
    return { device: "wasm", dtypes: ["q4", "fp16"], info };
  }

  /* ---------- hub metadata (sizes, commit SHA), stored for offline start ---------- */
  const SHA_RE = /^[0-9a-f]{40}$/u;
  function metaKey(modelId, revision) { return "https://ng.local/meta/" + modelId + "/" + revision; }
  async function readStoredMeta(modelId, revision) {
    try {
      if (!G.caches) return null;
      const cache = await G.caches.open(CONFIG.metaCacheName);
      const hit = await cache.match(metaKey(modelId, revision));
      return hit ? await hit.json() : null;
    } catch (_) { return null; }
  }
  async function storeMeta(modelId, revision, meta) {
    try {
      if (!G.caches) return;
      const cache = await G.caches.open(CONFIG.metaCacheName);
      await cache.put(metaKey(modelId, revision), new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
    } catch (_) { /* metadata cache is best-effort */ }
  }
  async function fetchMeta(modelId, revision) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), CONFIG.metaTimeoutMs) : null;
    try {
      const url = CONFIG.hubUrl + "/api/models/" + modelId + "/revision/" + encodeURIComponent(revision) + "?blobs=true";
      const response = await G.fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response.ok) throw fail("hub_http_" + response.status, "Hugging Face вернул HTTP " + response.status + " для метаданных модели.");
      const data = await response.json();
      if (!data || !SHA_RE.test(String(data.sha || "")) || !Array.isArray(data.siblings)) throw fail("hub_bad_metadata", "Метаданные модели имеют неожиданный формат.");
      return {
        sha: data.sha,
        license: data.cardData && data.cardData.license || null,
        siblings: data.siblings.map(item => ({
          rfilename: String(item.rfilename),
          size: Number(item.lfs && item.lfs.size != null ? item.lfs.size : item.size) || 0,
          sha256: item.lfs && item.lfs.sha256 || null
        })),
        savedAt: Date.now()
      };
    } finally { if (timer) clearTimeout(timer); }
  }
  async function resolveMeta(modelId, revision, requireOnline) {
    if (SHA_RE.test(revision) && !requireOnline) {
      const stored = await readStoredMeta(modelId, revision);
      if (stored && stored.sha === revision) return { meta: stored, source: "stored" };
    }
    try {
      const meta = await fetchMeta(modelId, revision);
      await storeMeta(modelId, revision, meta);
      await storeMeta(modelId, meta.sha, meta);
      return { meta, source: "network" };
    } catch (error) {
      const stored = await readStoredMeta(modelId, revision);
      if (stored) return { meta: stored, source: "stored" };
      throw fail("offline_unavailable",
        "Не удалось получить сведения о модели, а сохранённых данных нет. Первая загрузка требует интернета: " + describe(error));
    }
  }

  /* ---------- file list, cache audit ---------- */
  function planFiles(meta, dtype) {
    const names = new Map(meta.siblings.map(item => [item.rfilename, item]));
    const suffix = CONFIG.dtypeSuffix[dtype];
    const modelFile = "onnx/model" + suffix + ".onnx";
    if (suffix === undefined || !names.has(modelFile)) return null;
    const wanted = [...CONFIG.requiredFiles, ...CONFIG.optionalFiles, modelFile];
    for (const name of names.keys()) if (name.startsWith(modelFile + "_data")) wanted.push(name);
    const files = [];
    for (const name of wanted) {
      const item = names.get(name);
      if (!item) {
        if (CONFIG.requiredFiles.includes(name)) return null;
        continue;
      }
      files.push({ file: name, size: item.size, sha256: item.sha256 });
    }
    return files;
  }
  function fileUrl(modelId, sha, file) { return CONFIG.hubUrl + "/" + modelId + "/resolve/" + sha + "/" + file; }
  async function transformersCaches() {
    if (!G.caches) return [];
    const names = (await G.caches.keys()).filter(name => /transformers/iu.test(name));
    if (!names.length) names.push("transformers-cache");
    const opened = [];
    for (const name of names) { try { opened.push(await G.caches.open(name)); } catch (_) { /* skip */ } }
    return opened;
  }
  async function cachedSize(response) {
    const header = Number(response.headers && response.headers.get && response.headers.get("content-length"));
    if (Number.isFinite(header) && header > 0) return header;
    const blob = await response.clone().blob();
    return blob.size;
  }
  // Compares every expected file with what is in the browser cache. Corrupt entries are removed.
  async function auditCache(modelId, sha, files, repair) {
    const caches = await transformersCaches();
    const rows = [];
    for (const item of files) {
      const url = fileUrl(modelId, sha, item.file);
      let status = "missing", cachedBytes = 0;
      for (const cache of caches) {
        const hit = await cache.match(url);
        if (!hit) continue;
        cachedBytes = await cachedSize(hit);
        if (item.size > 0 && cachedBytes !== item.size) {
          status = "corrupt";
          if (repair) await cache.delete(url);
        } else status = "ok";
        break;
      }
      rows.push({ file: item.file, expected: item.size, cached: cachedBytes, status });
    }
    return {
      files: rows,
      missing: rows.filter(row => row.status === "missing").map(row => row.file),
      corrupt: rows.filter(row => row.status === "corrupt").map(row => row.file),
      complete: rows.every(row => row.status === "ok")
    };
  }

  /* ---------- runtime ---------- */
  async function loadRuntime(options) {
    if (typeof G.NGLocalLLMRuntimeLoader === "function") return G.NGLocalLLMRuntimeLoader(options);
    const urls = options.runtimeUrl ? [options.runtimeUrl] : CONFIG.runtimeUrls;
    const errors = [];
    for (const url of urls) {
      try {
        const mod = await import(url);
        if (mod && mod.AutoModelForCausalLM && mod.AutoTokenizer &&
            mod.TextStreamer && mod.InterruptableStoppingCriteria) return { mod, url };
        errors.push(url + ": отсутствует один из экспортов AutoModelForCausalLM, AutoTokenizer, TextStreamer, InterruptableStoppingCriteria");
      } catch (error) { errors.push(url + ": " + describe(error)); }
    }
    throw fail("runtime_load_failed", "Не удалось загрузить Transformers.js (" + errors.join("; ") + "). Для первой загрузки нужен интернет или локальная копия библиотеки.");
  }

  /* ---------- load ---------- */
  function normalizeLoadOptions(raw) {
    const options = raw && typeof raw === "object" ? raw : {};
    const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
    const modelId = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(options.modelId || "") ? options.modelId : CONFIG.modelId;
    return {
      modelId,
      revision: /^[A-Za-z0-9._/-]{1,64}$/u.test(options.revision || "") ? options.revision : CONFIG.revision,
      device: pick(options.device, ["auto", "webgpu", "wasm"], "auto"),
      dtype: pick(options.dtype, ["q4f16", "q4", "fp16", "fp32"], null),
      runtimeUrl: typeof options.runtimeUrl === "string" && /^(https:\/\/|\.{0,2}\/)/u.test(options.runtimeUrl) ? options.runtimeUrl : null,
      requireOnline: options.requireOnline === true
    };
  }
  async function requestPersistence() {
    try {
      const storage = G.navigator && G.navigator.storage;
      if (!storage) return null;
      if (typeof storage.persisted === "function" && await storage.persisted()) return true;
      return typeof storage.persist === "function" ? !!(await storage.persist()) : null;
    } catch (_) { return null; }
  }
  function makeProgress(id, files, auditedOk) {
    const totals = new Map(files.map(item => [item.file, item.size || 0]));
    const loaded = new Map(files.map(item => [item.file, auditedOk.has(item.file) ? item.size || 0 : 0]));
    let lastPercent = -1, lastAt = 0;
    const emit = (file, force) => {
      const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
      const done = [...loaded.values()].reduce((sum, value) => sum + value, 0);
      const percent = total > 0 ? Math.min(100, Math.floor(done * 100 / total)) : 0;
      const now = Date.now();
      if (!force && percent === lastPercent && now - lastAt < 250) return;
      lastPercent = percent; lastAt = now;
      post({ type: "progress", id, phase: "download", file: file || null, loaded: done, total, percent });
    };
    const callback = event => {
      if (!event || !event.file) return;
      const name = String(event.file);
      const key = [...totals.keys()].find(file => name === file || name.endsWith("/" + file));
      if (!key) return;
      if (!totals.get(key) && event.total) totals.set(key, Number(event.total) || 0);
      if (event.status === "progress" && Number.isFinite(event.loaded)) loaded.set(key, Math.max(loaded.get(key) || 0, event.loaded));
      else if (event.status === "done") loaded.set(key, totals.get(key) || loaded.get(key) || 0);
      emit(key, event.status === "done");
    };
    emit(null, true);
    return callback;
  }
  async function createModel(id, options, plan, meta) {
    const mod = runtime.mod;
    const files = plan.files;
    const audit = await auditCache(options.modelId, meta.sha, files, true);
    if (audit.missing.length + audit.corrupt.length > 0 && G.navigator && G.navigator.onLine === false) {
      throw fail("offline_missing_files",
        "Нет интернета, а в кэше не хватает файлов модели: " + [...audit.missing, ...audit.corrupt].join(", ") + ". Подключись к сети и повтори загрузку.", audit);
    }
    const okSet = new Set(audit.files.filter(row => row.status === "ok").map(row => row.file));
    const onProgress = makeProgress(id, files, okSet);
    post({ type: "progress", id, phase: "init", message: audit.complete ? "Файлы модели найдены в кэше." : "Нужно скачать: " + (audit.missing.length + audit.corrupt.length) + " файл(ов).", percent: 0 });
    tokenizer = await mod.AutoTokenizer.from_pretrained(options.modelId, { revision: meta.sha, progress_callback: onProgress });
    model = await mod.AutoModelForCausalLM.from_pretrained(options.modelId, {
      revision: meta.sha, device: plan.device, dtype: plan.dtype, progress_callback: onProgress
    });
    const after = await auditCache(options.modelId, meta.sha, files, false);
    return after;
  }
  async function doLoad(id, rawOptions) {
    const options = normalizeLoadOptions(rawOptions);
    state.modelId = options.modelId;
    state.lastError = null;
    setPhase("loading");
    state.persisted = await requestPersistence();
    post({ type: "progress", id, phase: "init", message: "Определяю WebGPU и формат весов…", percent: 0 });
    const detected = await detectDevice(options.device);
    runtime = runtime || await loadRuntime(options);
    state.runtimeUrl = runtime.url || null;
    const env = runtime.mod.env;
    if (env && typeof env === "object") {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.useWasmCache = true;
    }
    const { meta, source } = await resolveMeta(options.modelId, options.revision, options.requireOnline);
    state.revision = meta.sha;
    // device attempts: preferred first, wasm as safety net when the user asked for "auto"
    const attempts = [];
    const push = (device, dtypes) => {
      for (const dtype of dtypes) {
        const files = planFiles(meta, dtype);
        if (files && !attempts.some(item => item.device === device && item.dtype === dtype)) {
          attempts.push({ device, dtype, files });
        }
      }
    };
    // Try all available WebGPU quantizations before falling back to CPU/WASM.
    push(detected.device, options.dtype ? [options.dtype] : detected.dtypes);
    if (options.device === "auto" && detected.device === "webgpu") {
      push("webgpu", ["q4", "fp16"]);
      push("wasm", ["q4", "fp16"]);
    }
    if (!attempts.length) throw fail("dtype_unavailable", "В репозитории модели нет подходящего формата весов для режимов: " + detected.dtypes.join(", ") + ".");
    let lastError = null, audit = null;
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      try {
        post({ type: "progress", id, phase: "init", message: "Загружаю модель: " + attempt.device + " / " + attempt.dtype + "…", percent: 0 });
        audit = await createModel(id, options, { device: attempt.device, dtype: attempt.dtype, files: attempt.files }, meta);
        state.device = attempt.device; state.dtype = attempt.dtype; state.fellBack = index > 0;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        tokenizer = null; model = null;
        if (error && (error.code === "offline_missing_files" || error.code === "offline_unavailable")) break;
      }
    }
    if (lastError) {
      throw lastError.code ? lastError : fail("model_load_failed", "Не удалось создать модель: " + describe(lastError));
    }
    setPhase("ready");
    return { status: publicStatus(), metaSource: source, cache: audit, webgpu: detected.info, license: meta.license || null };
  }
  function load(id, rawOptions) {
    if (state.phase === "ready" || state.phase === "generating") {
      post({ type: "loaded", id, alreadyLoaded: true, status: publicStatus() });
      return;
    }
    loadWaiters.push(id);
    if (loadPromise) return;  // duplicate request while loading: share the one in flight
    loadPromise = doLoad(id, rawOptions).then(result => {
      const waiters = loadWaiters; loadWaiters = [];
      for (const waiter of waiters) post({ type: "loaded", id: waiter, alreadyLoaded: false, ...result });
    }).catch(error => {
      const waiters = loadWaiters; loadWaiters = [];
      tokenizer = null; model = null;
      state.phase = "error";
      for (const waiter of waiters) reportError(waiter, error, "model_load_failed");
      post({ type: "status", status: publicStatus() });
    }).finally(() => { loadPromise = null; });
  }

  /* ---------- generation ---------- */
  function validMessages(messages) {
    if (!Array.isArray(messages) || !messages.length || messages.length > CONFIG.maxMessages) return false;
    let chars = 0;
    for (const row of messages) {
      if (!row || !["system", "user", "assistant"].includes(row.role) || typeof row.content !== "string" || !row.content.trim()) return false;
      chars += row.content.length;
    }
    return chars <= CONFIG.maxPromptChars;
  }
  function sanitizeGeneration(raw) {
    const options = raw && typeof raw === "object" ? raw : {};
    const number = (value, min, max, fallback) => Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.min(max, Math.max(min, Number(value))) : fallback;
    const defaults = CONFIG.generation;
    const temperature = number(options.temperature, 0, 2, defaults.temperature);
    return {
      max_new_tokens: Math.floor(number(options.max_new_tokens, 1, 1024, defaults.max_new_tokens)),
      temperature,
      do_sample: temperature > 0,
      top_p: number(options.top_p, 0.05, 1, defaults.top_p),
      top_k: Math.floor(number(options.top_k, 1, 200, defaults.top_k)),
      repetition_penalty: number(options.repetition_penalty, 1, 2, defaults.repetition_penalty)
    };
  }
  function cleanReply(text) {
    return String(text || "").replace(/<think>[\s\S]*?<\/think>\s*/gu, "").replace(/^<think>[\s\S]*$/u, "").trim();
  }
  async function generate(id, messages, rawOptions) {
    if (state.phase === "generating") return reportError(id, fail("busy", "Модель уже генерирует ответ. Дождись завершения или остановись."));
    if (state.phase !== "ready" || !model || !tokenizer) return reportError(id, fail("model_not_loaded", "Модель не загружена. Сначала загрузи её."));
    if (!validMessages(messages)) return reportError(id, fail("bad_request", "Некорректный список сообщений для модели."));
    const mod = runtime.mod;
    const params = sanitizeGeneration(rawOptions);
    activeGenerationId = id; stopRequested = false;
    setPhase("generating");
    const startedAt = Date.now();
    let reply = "", completionTokens = 0, promptTokens = 0;
    try {
      const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false });
      const dims = inputs && inputs.input_ids && inputs.input_ids.dims;
      promptTokens = Array.isArray(dims) ? Number(dims[dims.length - 1]) || 0 : 0;
      const stopping = new mod.InterruptableStoppingCriteria();
      activeStop = stopping;
      if (stopRequested) stopping.interrupt();
      const streamer = new mod.TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: text => {
          if (!text) return;
          reply += text;
          post({ type: "token", id, text });
        },
        token_callback_function: () => { completionTokens += 1; }
      });
      await model.generate({
        ...inputs,
        max_new_tokens: params.max_new_tokens,
        do_sample: params.do_sample,
        ...(params.do_sample ? { temperature: params.temperature, top_p: params.top_p, top_k: params.top_k } : {}),
        repetition_penalty: params.repetition_penalty,
        streamer,
        ...(stopping ? { stopping_criteria: stopping } : {})
      });
      const elapsedMs = Date.now() - startedAt;
      post({
        type: "done", id, reply: cleanReply(reply), stopped: stopRequested,
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        elapsedMs, tokensPerSecond: elapsedMs > 0 ? Math.round(completionTokens * 10000 / elapsedMs) / 10 : null,
        device: state.device, dtype: state.dtype
      });
    } catch (error) {
      reportError(id, fail("generation_failed", "Ошибка генерации: " + describe(error)));
    } finally {
      activeStop = null; activeGenerationId = null; stopRequested = false;
      if (state.phase === "generating") setPhase("ready");
    }
  }
  function stop() {
    if (state.phase !== "generating") return false;
    stopRequested = true;
    if (activeStop) {
      try { activeStop.interrupt(); } catch (_) { /* nothing else to do */ }
    }
    return true;
  }

  async function checkCache(id, rawOptions) {
    try {
      const options = normalizeLoadOptions(rawOptions);
      const { meta, source } = await resolveMeta(options.modelId, options.revision, false);
      const detected = await detectDevice("auto").catch(() => ({ dtypes: ["q4", "fp16"], info: null }));
      const dtype = options.dtype || state.dtype || detected.dtypes.find(name => planFiles(meta, name));
      const files = planFiles(meta, dtype);
      if (!files) throw fail("dtype_unavailable", "Нет подходящего формата весов.");
      const audit = await auditCache(options.modelId, meta.sha, files, false);
      post({ type: "cache-report", id, revision: meta.sha, dtype, metaSource: source, ...audit });
    } catch (error) { reportError(id, error, "cache_check_failed"); }
  }
  async function dispose(id) {
    stop();
    try { if (model && typeof model.dispose === "function") await model.dispose(); } catch (_) { /* ignore */ }
    model = null; tokenizer = null;
    state.phase = "idle"; state.device = null; state.dtype = null;
    post({ type: "disposed", id: id == null ? null : id, status: publicStatus() });
  }

  G.addEventListener("message", event => {
    const data = event && event.data || {};
    const id = data.id == null ? null : data.id;
    try {
      switch (data.type) {
        case "load": load(id, data.options); break;
        case "generate": generate(id, data.messages, data.options); break;
        case "stop": stop(); break;
        case "status": post({ type: "status", id, status: publicStatus() }); break;
        case "check-cache": checkCache(id, data.options); break;
        case "dispose": dispose(id); break;
        default: reportError(id, fail("bad_request", "Неизвестный тип сообщения: " + String(data.type).slice(0, 40)));
      }
    } catch (error) { reportError(id, error, "worker_error"); }
  });
  post({ type: "status", status: publicStatus(), ready: true });
})(self);
