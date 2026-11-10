"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const config = fs.readFileSync("wrangler.toml", "utf8");
const worker = fs.readFileSync("server/llm-worker.js", "utf8");
const deploy = fs.readFileSync(".github/workflows/deploy-worker.yml", "utf8");

assert.match(config, /^main\s*=\s*"server\/llm-worker\.js"\s*$/mu,
  "Wrangler must deploy the Worker entry point tested by CI");
assert.match(config, /^workers_dev\s*=\s*true\s*$/mu,
  "The production Worker must explicitly keep its workers.dev route enabled");
assert.match(config, /^\[vars\]\s*$/mu,
  "Wrangler must declare its non-secret production variables");

const varsSection = config.match(/^\[vars\]\s*\r?\n([\s\S]*)$/mu)?.[1] || "";
const vars = Object.fromEntries(
  [...varsSection.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"\s*$/gmu)]
    .map(match => [match[1], match[2]])
);

for (const name of ["APP_ORIGIN", "UPSTREAM_BASE_URL", "UPSTREAM_MODEL"]) {
  assert.ok(vars[name], "Wrangler must define " + name);
  assert.ok(worker.includes("env." + name),
    "the Worker must consume the Wrangler variable " + name);
}
assert.match(vars.APP_ORIGIN, /^https:\/\//u,
  "the configured application origin must use HTTPS");
assert.match(vars.UPSTREAM_BASE_URL, /^https:\/\//u,
  "the upstream API base URL must use HTTPS");
assert.ok(!vars.UPSTREAM_BASE_URL.endsWith("/chat/completions"),
  "the configured URL must be a base URL because the Worker appends /chat/completions");

for (const name of ["APP_TOKEN", "UPSTREAM_API_KEY"]) {
  assert.match(worker, new RegExp("env\\." + name + "\\b", "u"),
    "the Worker must read the secret " + name);
  assert.doesNotMatch(config, new RegExp("^\\s*" + name + "\\s*=", "mu"),
    "the secret " + name + " must never be committed in wrangler.toml");
}
assert.match(deploy, /workflow_dispatch:/u,
  "production Worker deployment must remain an explicit manual action");
assert.match(deploy, /apiToken:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/u,
  "the Cloudflare deployment token must be supplied through GitHub Secrets");
assert.match(deploy, /accountId:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/u,
  "the Cloudflare account ID must be supplied through GitHub Secrets");
assert.match(deploy, /command:\s*deploy/u,
  "the manual Worker workflow must deploy the exact Wrangler project");

console.log(
  "NEUROGENESIS Worker configuration contracts: entry point, enabled workers.dev route, " +
  "three public variables, two isolated secrets and manual production deployment passed."
);
