"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class TestURL {
  constructor(value) {
    this.original = String(value);
    const match = this.original.match(/^([a-z][a-z0-9+.-]*:)\\/\\/([^/?#]+)([^?#]*)(?:\\?([^#]*))?(?:#(.*))?$/iu);
    if (!match) throw new Error("Invalid URL");
    this.protocol = match[1].toLowerCase();
    const authority = match[2];
    const at = authority.lastIndexOf("@");
    const host = at >= 0 ? authority.slice(at + 1) : authority;
    const credentials = at >= 0 ? authority.slice(0, at) : "";
    this.username = credentials.split(":")[0] || "";
    this.password = credentials.includes(":") ? credentials.split(":").slice(1).join(":") : "";
    this.hostname = host.replace(/:\\d+$/u, "").toLowerCase();
    this.pathname = match[3] || "/";
    this.search = match[4] ? "?" + match[4] : "";
    this.hash = match[5] ? "#" + match[5] : "";
  }
  toString() { return this.original; }
}
class TestHeaders {
  constructor(values = {}) { this.values = new Map(Object.entries(values).map(([k,v]) => [k.toLowerCase(), String(v)])); }
  get(name) { return this.values.get(String(name).toLowerCase()) || null; }
}
class TestResponse {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new TestHeaders(options.headers || {});
  }
  async json() { return typeof this.body === "string" ? JSON.parse(this.body) : this.body; }
}
class TestRequest {
  constructor(url, options = {}) {
    this.url = String(url);
    this.method = options.method || "GET";
    this.headers = new TestHeaders(options.headers || {});
    this.body = options.body == null ? "" : String(options.body);
  }
  async text() { return this.body; }
}

const source = fs.readFileSync("server/llm-worker.js", "utf8").replace("export default", "globalThis.NGWorker =");
const upstreamCalls = [];
const sandbox = {
  URL: TestURL,
  Response: TestResponse,
  globalThis: {},
  async fetch(url, options) {
    upstreamCalls.push({ url, options });
    return new TestResponse(JSON.stringify({
      choices: [{ message: { content: "Связный тестовый ответ" } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "llm-worker.js" });
const worker = sandbox.NGWorker;
const env = {
  APP_ORIGIN: "https://ilonadanelan1-code.github.io",
  APP_TOKEN: "client-test-token",
  UPSTREAM_API_KEY: "provider-secret",
  UPSTREAM_BASE_URL: "https://api.example.test/v1",
  UPSTREAM_MODEL: "test-model"
};
const request = (path, options = {}) => new TestRequest("https://worker.example" + path, {
  ...options,
  headers: {
    ...(options.headers || {}),
    Origin: "https://ilonadanelan1-code.github.io"
  }
});
(async () => {
  let response = await worker.fetch(request("/api/health"), env);
  assert.equal(response.status, 401, "health endpoint must require the app token");

  response = await worker.fetch(request("/api/health", { headers: { Authorization: "Bearer client-test-token" } }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).configured, true);

  response = await worker.fetch(request("/api/chat", {
    method: "POST", headers: { Authorization: "Bearer wrong" }, body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
  }), env);
  assert.equal(response.status, 401);

  response = await worker.fetch(request("/api/chat", {
    method: "POST", headers: { Authorization: "Bearer client-test-token" }, body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
  }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.reply, "Связный тестовый ответ");
  assert.equal(data.usage.total_tokens, 20);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].options.headers.Authorization, "Bearer provider-secret",
    "the provider key must be added only by the server worker");
  assert.equal(upstreamCalls[0].options.body.includes("provider-secret"), false);

  response = await worker.fetch(request("/api/chat", {
    method: "POST", headers: { Authorization: "Bearer client-test-token" }, body: JSON.stringify({ messages: [{ role: "tool", content: "no" }] })
  }), env);
  assert.equal(response.status, 400, "tool roles must be rejected by the proxy");

  response = await worker.fetch(new TestRequest("https://worker.example/api/health", {
    headers: { Origin: "https://attacker.example", Authorization: "Bearer client-test-token" }
  }), env);
  assert.equal(response.status, 403, "unapproved browser origins must be rejected");
  console.log("NEUROGENESIS server-side LLM proxy: passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
