"use strict";
const assert = require("node:assert/strict");
const { statistics, summarize, parseJsonObject } = require("../scripts/eval-matched-multiseed.js");

const stats = statistics([1, 3]);
assert.equal(stats.mean, 2);
assert.equal(stats.runs, 2);
assert.equal(stats.sampleStdDev, Math.SQRT2);

const reports = [
  {
    ngram: { metrics: { top1: 0.10, top5: 0.30, top8: 0.40 } },
    contextualAttention: { metrics: { top1: 0.05, top5: 0.25, top8: 0.45 } }
  },
  {
    ngram: { metrics: { top1: 0.20, top5: 0.40, top8: 0.50 } },
    contextualAttention: { metrics: { top1: 0.15, top5: 0.35, top8: 0.55 } }
  }
];
const summary = summarize(reports);
assert.ok(Math.abs(summary.ngram.top1.mean - 0.15) < 1e-12);
assert.ok(Math.abs(summary.contextualAttention.top1.mean - 0.10) < 1e-12);
assert.ok(Math.abs(summary.pairedDeltaNgramMinusAttention.top1.mean - 0.05) < 1e-12);
assert.ok(Math.abs(summary.pairedDeltaNgramMinusAttention.top8.mean + 0.05) < 1e-12);
assert.ok(Math.abs(summary.pairedDeltaNgramMinusAttention.top1.sampleStdDev) < 1e-12);

const parsed = parseJsonObject('prefix\n{"ok":true,"nested":{"value":2}}\ntrailer');
assert.deepEqual(parsed, { ok: true, nested: { value: 2 } });

console.log("ngram matched multiseed aggregation tests passed");
