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
const legacyEndpoint = "https://neurogenesis-llm-proxy.ilonadanel1.workers.dev";
assert.match(memory, /const LEGACY_LLM_ENDPOINT\s*=\s*"https:\/\/neurogenesis-llm-proxy\.ilonadanel1\.workers\.dev"/u,
  "the migration must recognise only the hostname typo previously shown to the user");
assert.match(memory, /endpointWithoutTrailingSlash === LEGACY_LLM_ENDPOINT[\s\S]*?DEFAULT_LLM_ENDPOINT/u,
  "a saved copy of the known typo must migrate to the real Worker hostname");
assert.match(memory, /clientToken:value\.clientToken\.trim\(\)/u,
  "hostname migration must preserve the existing APP_TOKEN");
assert.match(memory, /localStorage\.setItem\(LLM_CONFIG_KEY, JSON\.stringify\(config\)\)/u,
  "the corrected endpoint must persist for the next launch");
assert.ok(!html.includes(legacyEndpoint), "the published app must not contain the old incorrect hostname");
assert.match(html, /DIGITAL ORGANISM · 0\.58\.49/u,
  "the app release version must advance so mobile browsers fetch the migration");

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

const diagnostic = fs.readFileSync("llm-diagnostic.html", "utf8");
assert.match(diagnostic, /const WORKER="https:\/\/neurogenesis-llm-proxy\.ilonadanelan1\.workers\.dev"/u,
  "the diagnostic page must target the canonical deployed Worker");
assert.match(diagnostic, /localStorage\.getItem\(CONFIG_KEY\)/u,
  "the diagnostic page must read the saved gateway config locally");
assert.match(diagnostic, /"Authorization":"Bearer "\+token/u,
  "the diagnostic page must exercise the same authenticated health request as the app");
assert.match(diagnostic, /значение скрыто/u,
  "the diagnostic page must never display the saved application token");
assert.match(diagnostic, /options&&options\.mode==="no-cors"\?"no-cors":"cors"/u,
  "the diagnostic page must exercise browser CORS enforcement from GitHub Pages");
assert.match(diagnostic, /const mode=options&&options\.mode==="no-cors"\?"no-cors":"cors"/u,
  "the diagnostic request helper must support an opaque transport-only probe");
assert.match(diagnostic, /mode:"no-cors"/u,
  "the diagnostic page must distinguish browser network reachability from CORS response access");
assert.match(diagnostic, /проверка Authorization может зависать на CORS preflight/u,
  "the diagnostic page must report authenticated preflight failures precisely");
assert.match(diagnostic, /GitHub Pages · same-origin fetch/u,
  "the diagnostic page must include a same-origin fetch control to separate site networking from cross-origin Worker access");
assert.match(diagnostic, /function imageProbe\(url,timeoutMs\)/u,
  "the diagnostic page must include a browser image-load probe independent of fetch and CORS");
assert.match(diagnostic, /api\/pixel\.gif/u,
  "the diagnostic page must exercise the Worker image transport endpoint");
assert.match(diagnostic, /Worker \/ · изображение/u,
  "the diagnostic page must report the result of the independent image probe");

console.log("NEUROGENESIS LLM setup contracts: known Worker endpoint, distinct secrets, specific errors and automatic Worker deployment passed.");
