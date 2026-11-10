"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const memory = fs.readFileSync("memory.js", "utf8");
const worker = fs.readFileSync("server/llm-worker.js", "utf8");
const deploy = fs.readFileSync(".github/workflows/deploy-worker.yml", "utf8");

const endpoint = "https://neurogenesis-llm-proxy.ilonadanelan1.workers.dev";
assert.ok(html.includes('id="llm-endpoint"') && html.includes('value="' + endpoint + '"'),
  "the known deployed Worker address must be prefilled for a fresh browser");
assert.match(memory, /const DEFAULT_LLM_ENDPOINT\s*=\s*"https:\/\/neurogenesis-llm-proxy\.ilonadanelan1\.workers\.dev"/u,
  "the endpoint must also be restored when no saved browser configuration exists");
assert.match(memory, /if \(endpoint && !endpoint\.value\.trim\(\)\) endpoint\.value = DEFAULT_LLM_ENDPOINT/u,
  "fresh startup must fill the Worker address without overwriting saved configuration");
assert.match(html, /APP_TOKEN[\s\S]*?не ключ OpenRouter[\s\S]*?UPSTREAM_API_KEY/u,
  "the setup UI must distinguish the application token from the provider API key");
assert.match(memory, /ОШИБКА · " \+ reason/u,
  "the settings panel must show the actual connection error instead of a generic failure label");
assert.ok(memory.includes('replace(/\\s+/gu, " ").trim()'),
  "connection errors must collapse whitespace before presentation");
assert.match(worker, /if \(url\.pathname === "\/" && request\.method === "GET"\)/u,
  "the deployed Worker must expose its unauthenticated, non-secret root diagnostic");
assert.match(deploy, /push:[\s\S]*?server\/llm-worker\.js[\s\S]*?wrangler\.toml/u,
  "server changes and Wrangler config changes must trigger a Worker deployment");
assert.match(deploy, /workflow_dispatch:/u,
  "manual Worker deployments must remain available");

console.log("NEUROGENESIS LLM setup contracts: known Worker endpoint, distinct secrets, specific errors and automatic Worker deployment passed.");
