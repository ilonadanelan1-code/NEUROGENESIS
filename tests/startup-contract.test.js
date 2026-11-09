"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const version = html.match(/DIGITAL ORGANISM · ([0-9.]+)/u)?.[1];
assert.ok(version, "the app version must be readable before validating startup assets");

const idList = [...html.matchAll(/\bid=["']([^"']+)["']/gu)].map(match => match[1]);
const idCounts = new Map();
for (const id of idList) idCounts.set(id, (idCounts.get(id) || 0) + 1);
const duplicateIds = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id);
assert.deepEqual(duplicateIds, [],
  "each DOM id must be unique; duplicate IDs make module lookups ambiguous");

const scriptRefs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gu)]
  .map(match => match[1]);
const stylesheetRefs = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gu)]
  .map(match => match[1]);
assert.ok(scriptRefs.length > 0, "the page must declare its JavaScript entry points");
assert.ok(stylesheetRefs.length > 0, "the page must declare its stylesheet");

const allAssets = [...scriptRefs, ...stylesheetRefs];
for (const ref of allAssets) {
  const [relativePath] = ref.split("?");
  assert.ok(relativePath.startsWith("./"), "startup assets must use repository-local paths: " + ref);
  assert.ok(fs.existsSync(relativePath.slice(2)), "startup asset is missing: " + relativePath);
  assert.ok(ref.includes("?v=" + version), "startup asset cache key is stale: " + ref);
}

const htmlIds = new Set(idList);
const missingReferences = [];
for (const ref of scriptRefs) {
  const [relativePath] = ref.split("?");
  const source = fs.readFileSync(relativePath.slice(2), "utf8");
  const referencedIds = new Set();
  const patterns = [
    /\$\(\s*["']([^"']+)["']\s*\)/gu,
    /getElementById\(\s*["']([^"']+)["']\s*\)/gu,
    /querySelector\(\s*["']#([^"']+)["']\s*\)/gu
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) referencedIds.add(match[1]);
  }
  for (const id of referencedIds) {
    if (!htmlIds.has(id)) missingReferences.push(relativePath + " -> #" + id);
  }
}
assert.deepEqual(missingReferences, [],
  "every statically referenced DOM element must exist in index.html");

console.log(
  "NEUROGENESIS startup contracts: " + scriptRefs.length +
  " JavaScript assets, " + stylesheetRefs.length +
  " stylesheet(s), " + idList.length +
  " unique DOM IDs and all static script-to-DOM references passed."
);
