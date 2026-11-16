"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workflow = fs.readFileSync(".github/workflows/pages.yml", "utf8");
const jobStart = workflow.indexOf("  prepare-open-chat-corpus:");
const deployStart = workflow.indexOf("\n  deploy:", jobStart);
assert.ok(jobStart >= 0 && deployStart > jobStart,
  "the corpus preparation job must remain present and separate from Pages deploy");

const corpusJob = workflow.slice(jobStart, deployStart);
assert.match(corpusJob,
  /if:\s*github\.event_name\s*!=\s*'pull_request'\s*\|\|\s*contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'run-corpus-pilot'\)/u,
  "the expensive full corpus pilot must run on non-PR events or explicitly opted-in PRs");
assert.match(workflow, /^\s*workflow_dispatch:\s*$/mu,
  "the corpus pilot must remain manually runnable");
assert.match(workflow, /^\s*push:\s*\r?\n\s*branches:\s*\r?\n\s*- main\s*$/mu,
  "the corpus pilot must still run automatically on main pushes");

console.log("CI scope: full corpus training is gated on PRs while main and manual runs remain enabled.");
