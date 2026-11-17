"use strict";
// Offline tests for local-llm-worker.js and local-llm-adapter.js. No model weights, no network:
// the Transformers.js runtime, Cache API, fetch and WebGPU are replaced by small fakes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const SHA = "a7b503b1c3f7e98e8f80b6d565f47807a5007d9c";
const SIBLINGS = [
  ["config.json", 100], ["generation_config.json", 50], ["tokenizer.json", 1000], ["tokenizer_config.json", 200],
  ["onnx/model_q4f16.onnx", 5000], ["onnx/model_q4.onnx", 6000]
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(list, predicate, label, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const hit = list.find(predicate);
    if (hit) return hit;
    if (Date.now() - start > timeout) throw new Error("timeout waiting for " + label + "; got " + JSON.stringify(list.map(m => m.type + (m.code ? ":" + m.code : ""))));
    await sleep(2);
  }
}

function makeCaches(store = new Map()) {
  const deleted = [];
  const open = async name => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name);
    return {
      async match(url) {
        const row = entries.get(url);
        if (!row) return undefined;
        const response = {
          headers: { get: key => key.toLowerCase() === "content-length" && row.length != null ? String(row.length) : null },
          async json() { return JSON.parse(row.text); },
          async blob() { return { size: row.length || 0 }; }
        };
        response.clone = () => response;
        return response;
      },
      async put(url, response) {
        if (response && typeof response.text === "function") { const text = await response.text(); entries.set(url, { text, length: null }); }
        else entries.set(url, response);
      },
      async delete(url) { deleted.push(url); return entries.delete(url); }
    };
  };
  return { store, deleted, keys: async () => [...store.keys()], open, putFile(url, length) { if (!store.has("transformers-cache")) store.set("transformers-cache", new Map()); store.get("transformers-cache").set(url, { length, text: "" }); } };
}

function makeRuntime(world, opts = {}) {
  const calls = { tokenizer: [], model: [], generate: 0 };
  class InterruptableStoppingCriteria { constructor() { this.interrupted = false; } interrupt() { this.interrupted = true; } }
  class TextStreamer { constructor(tokenizer, options) { Object.assign(this, options); } }
  const sizeOf = Object.fromEntries(SIBLINGS);
  const cacheFile = file => world.caches.putFile("https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/" + SHA + "/" + file, sizeOf[file]);
  const mod = {
    env: {},
    InterruptableStoppingCriteria, TextStreamer,
    AutoTokenizer: {
      async from_pretrained(id, o) {
        calls.tokenizer.push({ id, ...o });
        for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json", "generation_config.json"]) {
          o.progress_callback({ status: "progress", file, loaded: sizeOf[file] / 2, total: sizeOf[file] });
          cacheFile(file);
          o.progress_callback({ status: "done", file });
        }
        return { apply_chat_template: () => ({ input_ids: { dims: [1, 7] } }) };
      }
    },
    AutoModelForCausalLM: {
      async from_pretrained(id, o) {
        calls.model.push({ id, ...o });
        if (opts.failDevice && opts.failDevice === o.device) throw new Error("device " + o.device + " cannot start");
        const file = "onnx/model_" + o.dtype + ".onnx";
        o.progress_callback({ status: "progress", file, loaded: sizeOf[file] / 2, total: sizeOf[file] });
        cacheFile(file);
        o.progress_callback({ status: "done", file });
        return {
          async generate(args) {
            calls.generate += 1;
            const chunks = opts.chunks || ["Нейрон", " передаёт", " сигнал", "."];
            for (const chunk of chunks) {
              if (args.stopping_criteria && args.stopping_criteria.interrupted) break;
              args.streamer.callback_function(chunk);
              args.streamer.token_callback_function();
              if (opts.delayMs) await sleep(opts.delayMs);
            }
          },
          async dispose() { calls.disposed = true; }
        };
      }
    }
  };
  return { mod, calls };
}

function makeWorld(opts = {}) {
  const messages = [];
  const handlers = {};
  const caches = opts.caches || makeCaches();
  const world = { messages, caches, persistCalls: 0, loaderCalls: 0, online: opts.online !== false };
  const features = { has: name => opts.shaderF16 !== false && name === "shader-f16" };
  const siblings = (opts.siblings || SIBLINGS).map(([rfilename, size]) => ({ rfilename, size, lfs: { size, sha256: "f".repeat(64) } }));
  const deliver = opts.deliver || (message => messages.push(message));
  const sandbox = {
    postMessage: message => deliver(message),
    addEventListener: (name, callback) => { handlers[name] = callback; },
    navigator: {
      onLine: world.online,
      gpu: opts.noGpu ? undefined : { requestAdapter: async () => (opts.noAdapter ? null : { features }) },
      storage: { persisted: async () => false, persist: async () => { world.persistCalls += 1; return true; } }
    },
    caches,
    fetch: async url => {
      if (!world.online) throw new Error("network down");
      assert.match(String(url), /\/api\/models\/onnx-community\/Qwen3-0\.6B-ONNX\/revision\/a7b503b1c3f7e98e8f80b6d565f47807a5007d9c\?blobs=true$/u);
      return { ok: true, status: 200, json: async () => ({ sha: SHA, cardData: { license: "apache-2.0" }, siblings }) };
    },
    Response, AbortController, setTimeout, clearTimeout, Date, Math, JSON, Map, Set, Promise, Error, Number, String, Array, Object, RegExp
  };
  sandbox.self = sandbox;
  world.runtime = makeRuntime(world, opts.runtime);
  world.runtimeFails = opts.runtimeFails || false;
  sandbox.NGLocalLLMRuntimeLoader = async () => {
    world.loaderCalls += 1;
    await sleep(opts.loaderDelayMs || 0);
    if (world.runtimeFails) throw Object.assign(new Error("CDN недоступен"), { code: "runtime_load_failed" });
    return { mod: world.runtime.mod, url: "fake://transformers" };
  };
  vm.runInNewContext(fs.readFileSync("local-llm-worker.js", "utf8"), sandbox, { filename: "local-llm-worker.js" });
  world.send = message => handlers.message({ data: message });
  world.sandbox = sandbox;
  return world;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("worker initializes and reports idle status without loading anything", async () => {
  const world = makeWorld();
  assert.equal(world.messages[0].type, "status");
  assert.equal(world.messages[0].ready, true);
  assert.equal(world.messages[0].status.phase, "idle");
  assert.equal(world.loaderCalls, 0);
});

test("load: WebGPU/q4f16, pinned commit SHA, persistence request, monotonic progress", async () => {
  const world = makeWorld();
  world.send({ type: "load", id: 1, options: {} });
  const loaded = await waitFor(world.messages, m => m.type === "loaded", "loaded");
  assert.equal(loaded.status.device, "webgpu");
  assert.equal(loaded.status.dtype, "q4f16");
  assert.equal(loaded.status.revision, SHA);
  assert.equal(loaded.status.persisted, true);
  assert.equal(world.persistCalls, 1);
  assert.equal(loaded.cache.complete, true);
  assert.equal(loaded.license, "apache-2.0");
  assert.equal(world.runtime.mod.env.useBrowserCache, true);
  assert.equal(world.runtime.mod.env.allowLocalModels, false);
  assert.equal(world.runtime.calls.model[0].revision, SHA, "weights must be requested by commit SHA, not by 'main'");
  assert.equal(world.runtime.calls.tokenizer[0].revision, SHA);
  const percents = world.messages.filter(m => m.type === "progress" && m.phase === "download").map(m => m.percent);
  assert.ok(percents.length >= 3);
  assert.deepEqual(percents, [...percents].sort((a, b) => a - b));
  assert.equal(percents[percents.length - 1], 100);
  assert.equal(world.runtime.calls.model.length, 1);
});

test("generate streams tokens, then done with the full reply and usage", async () => {
  const world = makeWorld();
  world.send({ type: "load", id: 1 });
  await waitFor(world.messages, m => m.type === "loaded", "loaded");
  world.send({ type: "generate", id: 2, messages: [{ role: "system", content: "s" }, { role: "user", content: "Что такое нейрон?" }] });
  const done = await waitFor(world.messages, m => m.type === "done", "done");
  const tokens = world.messages.filter(m => m.type === "token" && m.id === 2).map(m => m.text);
  assert.deepEqual(tokens, ["Нейрон", " передаёт", " сигнал", "."]);
  assert.equal(done.reply, "Нейрон передаёт сигнал.");
  assert.equal(done.stopped, false);
  assert.equal(JSON.stringify(done.usage), JSON.stringify({ prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 }));
  assert.ok(world.messages.indexOf(done) > world.messages.indexOf(world.messages.find(m => m.type === "token")));
  assert.equal(world.runtime.calls.generate, 1);
});

test("stop interrupts generation and returns the partial reply", async () => {
  const world = makeWorld({ runtime: { chunks: Array.from({ length: 60 }, (_, i) => "т" + i + " "), delayMs: 15 } });
  world.send({ type: "load", id: 1 });
  await waitFor(world.messages, m => m.type === "loaded", "loaded");
  world.send({ type: "generate", id: 2, messages: [{ role: "user", content: "длинный ответ" }] });
  await waitFor(world.messages, m => m.type === "token", "first token");
  world.send({ type: "stop" });
  const done = await waitFor(world.messages, m => m.type === "done", "done");
  assert.equal(done.stopped, true);
  assert.ok(done.usage.completion_tokens > 0 && done.usage.completion_tokens < 60);
  world.send({ type: "status", id: 3 });
  const status = (await waitFor(world.messages, m => m.type === "status" && m.id === 3, "status")).status;
  assert.equal(status.phase, "ready");
});

test("runtime init error is reported with a code, the worker stays usable and can retry", async () => {
  const world = makeWorld({ runtimeFails: true });
  world.send({ type: "load", id: 1 });
  const error = await waitFor(world.messages, m => m.type === "error", "error");
  assert.equal(error.id, 1);
  assert.equal(error.code, "runtime_load_failed");
  assert.match(error.message, /CDN/u);
  world.send({ type: "generate", id: 2, messages: [{ role: "user", content: "привет" }] });
  const notLoaded = await waitFor(world.messages, m => m.type === "error" && m.id === 2, "not loaded error");
  assert.equal(notLoaded.code, "model_not_loaded");
  world.runtimeFails = false;
  world.send({ type: "load", id: 3 });
  const loaded = await waitFor(world.messages, m => m.type === "loaded" && m.id === 3, "retry loaded");
  assert.equal(loaded.status.phase, "ready");
});

test("duplicate load shares one initialization; concurrent generate is rejected; repeat request works", async () => {
  const world = makeWorld({ loaderDelayMs: 20, runtime: { delayMs: 20 } });
  world.send({ type: "load", id: 1 });
  world.send({ type: "load", id: 2 });
  await waitFor(world.messages, m => m.type === "loaded" && m.id === 2, "second loaded");
  await waitFor(world.messages, m => m.type === "loaded" && m.id === 1, "first loaded");
  assert.equal(world.loaderCalls, 1);
  assert.equal(world.runtime.calls.model.length, 1);
  world.send({ type: "load", id: 3 });
  assert.equal((await waitFor(world.messages, m => m.type === "loaded" && m.id === 3, "already")).alreadyLoaded, true);
  world.send({ type: "generate", id: 4, messages: [{ role: "user", content: "первый" }] });
  world.send({ type: "generate", id: 5, messages: [{ role: "user", content: "второй" }] });
  assert.equal((await waitFor(world.messages, m => m.type === "error" && m.id === 5, "busy")).code, "busy");
  await waitFor(world.messages, m => m.type === "done" && m.id === 4, "first done");
  world.send({ type: "generate", id: 6, messages: [{ role: "user", content: "третий" }] });
  assert.equal((await waitFor(world.messages, m => m.type === "done" && m.id === 6, "repeat done")).reply, "Нейрон передаёт сигнал.");
  world.send({ type: "generate", id: 7, messages: [{ role: "tool", content: "x" }] });
  assert.equal((await waitFor(world.messages, m => m.type === "error" && m.id === 7, "bad")).code, "bad_request");
});

test("cache: corrupt file is removed and re-downloaded; offline without files fails clearly", async () => {
  const caches = makeCaches();
  const modelUrl = "https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/" + SHA + "/onnx/model_q4f16.onnx";
  caches.putFile(modelUrl, 1234);   // wrong size (expected 5000)
  const world = makeWorld({ caches });
  world.send({ type: "load", id: 1 });
  const loaded = await waitFor(world.messages, m => m.type === "loaded", "loaded");
  assert.ok(caches.deleted.includes(modelUrl), "corrupt entry must be deleted before loading");
  assert.equal(loaded.cache.complete, true);
  // same caches (metadata is now stored), network gone, weights wiped -> explicit offline error
  caches.store.get("transformers-cache").clear();
  const offline = makeWorld({ caches, online: false });
  offline.send({ type: "load", id: 1, options: { revision: SHA } });
  const error = await waitFor(offline.messages, m => m.type === "error", "offline error");
  assert.equal(error.code, "offline_missing_files");
  assert.match(error.message, /onnx\/model_q4f16\.onnx/u);
  // brand-new browser profile, offline: nothing known about the model
  const fresh = makeWorld({ online: false });
  fresh.send({ type: "load", id: 1 });
  assert.equal((await waitFor(fresh.messages, m => m.type === "error", "fresh offline")).code, "offline_unavailable");
});

test("offline start works from stored metadata and a complete cache", async () => {
  const caches = makeCaches();
  const first = makeWorld({ caches });
  first.send({ type: "load", id: 1 });
  await waitFor(first.messages, m => m.type === "loaded", "online loaded");
  const offline = makeWorld({ caches, online: false });
  offline.send({ type: "load", id: 1, options: { revision: SHA } });
  const loaded = await waitFor(offline.messages, m => m.type === "loaded", "offline loaded");
  assert.equal(loaded.metaSource, "stored");
  assert.equal(loaded.cache.complete, true);
});

test("device/dtype selection: no shader-f16 -> q4; missing q4f16 file -> q4; WebGPU failure -> CPU fallback; no GPU -> wasm", async () => {
  let world = makeWorld({ shaderF16: false });
  world.send({ type: "load", id: 1 });
  assert.equal((await waitFor(world.messages, m => m.type === "loaded", "q4")).status.dtype, "q4");

  world = makeWorld({ siblings: SIBLINGS.filter(([name]) => name !== "onnx/model_q4f16.onnx") });
  world.send({ type: "load", id: 1 });
  const noF16File = await waitFor(world.messages, m => m.type === "loaded", "q4 file");
  assert.equal(noF16File.status.dtype, "q4");
  assert.equal(noF16File.status.device, "webgpu");

  world = makeWorld({ runtime: { failDevice: "webgpu" } });
  world.send({ type: "load", id: 1 });
  const fallback = await waitFor(world.messages, m => m.type === "loaded", "fallback");
  assert.equal(fallback.status.device, "wasm");
  assert.equal(fallback.status.dtype, "q4");
  assert.equal(fallback.status.fellBack, true);

  world = makeWorld({ noGpu: true });
  world.send({ type: "load", id: 1 });
  assert.equal((await waitFor(world.messages, m => m.type === "loaded", "wasm")).status.device, "wasm");

  world = makeWorld({ noGpu: true });
  world.send({ type: "load", id: 1, options: { device: "webgpu" } });
  assert.equal((await waitFor(world.messages, m => m.type === "error", "forced webgpu")).code, "webgpu_unavailable");
});

test("missing compatible model weights produce a clear dtype_unavailable error", async () => {
  const siblings = SIBLINGS.filter(([name]) => !name.startsWith("onnx/model_"));
  const world = makeWorld({ siblings });
  world.send({ type: "load", id: 1 });
  const error = await waitFor(world.messages, m => m.type === "error" && m.id === 1, "dtype unavailable");
  assert.equal(error.code, "dtype_unavailable");
  assert.match(error.message, /подходящего формата весов/u);
  assert.doesNotMatch(error.message, /dtypeOrder/u);
});

test("check-cache reports file status without downloading", async () => {
  const world = makeWorld();
  world.send({ type: "check-cache", id: 9 });
  const report = await waitFor(world.messages, m => m.type === "cache-report", "report");
  assert.equal(report.complete, false);
  assert.equal(report.missing.length, 6 - 1);   // 5 files of the q4f16 plan
  assert.equal(world.runtime.calls.model.length, 0);
});

test("adapter + worker end-to-end through the real LLM gateway contract", async () => {
  const window = {};
  const bridgeSandbox = { window, Date, Math, Map, Set, JSON };
  const projectBridge = "llm-bridge.js";
  const bridgeFixture = "tests/fixtures/llm-bridge-contract.js";
  const bridgePath = fs.existsSync(projectBridge) ? projectBridge : bridgeFixture;
  vm.runInNewContext(fs.readFileSync(bridgePath, "utf8"), bridgeSandbox, { filename: bridgePath });
  const gateway = window.NGLLMBridge.create();

  let page = null;
  const world = makeWorld({ deliver: message => setImmediate(() => page && page.onmessage && page.onmessage({ data: message })), runtime: { delayMs: 10 } });
  let terminated = false;
  page = { onmessage: null, onerror: null, postMessage: message => setImmediate(() => world.send(message)), terminate: () => { terminated = true; } };
  const adapter = require("../local-llm-adapter.js").create({ workerFactory: () => page, maxContextChars: 400 });

  // contract checks
  for (const method of ["generate", "generateDetailed", "stop", "load", "status", "dispose", "registerWith"]) assert.equal(typeof adapter[method], "function", method);
  const registered = adapter.registerWith(gateway, "local");
  assert.equal(registered.id, "local");
  assert.equal(registered.active, true);
  const request = window.NGLLMBridge.buildRequest("Привет, кто ты?", { activeThread: null, recentMessages: [] }, []);

  // no implicit download
  await assert.rejects(() => gateway.generate(request), error => error.code === "model_not_loaded");
  assert.equal(world.loaderCalls, 0);

  const progress = [];
  const result = await adapter.load({}, event => progress.push(event));
  assert.equal(result.status.phase, "ready");
  assert.ok(progress.some(event => event.phase === "download"));
  assert.equal((await adapter.load()).alreadyLoaded, true);

  // streaming through the adapter + normalized gateway result
  const streamed = [];
  const detailed = await adapter.generateDetailed(request, { onToken: text => streamed.push(text) });
  assert.equal(streamed.join(""), detailed.reply);
  const viaGateway = await gateway.generateDetailed(request);
  assert.equal(viaGateway.reply, "Нейрон передаёт сигнал.");
  assert.equal(viaGateway.model, "onnx-community/Qwen3-0.6B-ONNX");
  assert.equal(viaGateway.fallbackUsed, null);
  assert.equal(JSON.stringify(viaGateway.usage), JSON.stringify({ prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 }));
  assert.equal(await gateway.generate(request), "Нейрон передаёт сигнал.");

  // conflicting request while one is running
  const first = adapter.generateDetailed(request);
  await assert.rejects(() => adapter.generateDetailed(request), error => error.code === "busy");
  await first;

  // stop through AbortSignal returns the partial text
  const slow = makeWorld({ runtime: { chunks: Array.from({ length: 80 }, (_, i) => "с" + i + " "), delayMs: 10 }, deliver: message => setImmediate(() => slowPage.onmessage({ data: message })) });
  const slowPage = { onmessage: null, postMessage: message => setImmediate(() => slow.send(message)), terminate() {} };
  const slowAdapter = require("../local-llm-adapter.js").create({ workerFactory: () => slowPage });
  await slowAdapter.load();
  const controller = new AbortController();
  const running = slowAdapter.generateDetailed(request, { signal: controller.signal, onToken: () => { if (!controller.signal.aborted) controller.abort(); } });
  const partial = await running;
  assert.equal(partial.stopped, true);
  assert.ok(partial.usage.completion_tokens < 80);

  // history trimming keeps system prompt and the latest question inside the budget
  const long = [{ role: "system", content: "S".repeat(100) }, ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(150) })), { role: "user", content: "Последний вопрос" }];
  const trimmed = require("../local-llm-adapter.js").trimMessages(long, 400);
  assert.equal(trimmed[0].role, "system");
  assert.equal(trimmed[trimmed.length - 1].content, "Последний вопрос");
  assert.ok(trimmed.reduce((sum, row) => sum + row.content.length, 0) <= 400);

  // worker crash settles pending calls with a clear code
  const crashWorld = makeWorld({ deliver: () => {}, loaderDelayMs: 50 });
  const crashPage = { onmessage: null, onerror: null, postMessage: message => setImmediate(() => crashWorld.send(message)), terminate() {} };
  const crashAdapter = require("../local-llm-adapter.js").create({ workerFactory: () => crashPage });
  const pendingLoad = crashAdapter.load();
  await sleep(5);
  crashPage.onerror({ message: "boom" });
  await assert.rejects(() => pendingLoad, error => error.code === "worker_crashed");

  adapter.dispose();
  assert.equal(terminated, true);
  await assert.rejects(() => require("../local-llm-adapter.js").create({ workerFactory: () => { throw new Error("no Worker"); } }).load(), error => error.code === "worker_unavailable");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log("ok - " + name); }
    catch (error) { failed += 1; console.error("not ok - " + name + "\n" + (error && error.stack || error)); }
  }
  if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
  console.log("local-llm: " + tests.length + " tests passed");
})();
