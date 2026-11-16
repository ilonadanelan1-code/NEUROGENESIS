"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nc = require("../scripts/ngram-compact.js");

const rows = [
  "нейрон получает сигнал от соседа",
  "нейрон получает импульс от соседа",
  "сеть хранит данные в памяти",
  "сеть хранит события в памяти",
  "память сохраняет важные события",
  "нейрон передает сигнал дальше",
  "система сохраняет данные в памяти",
  "система передает данные в сеть"
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngram-compact-test-"));
try {
  const corpus = nc.buildCorpus(rows, { minCount: 1 });
  nc.saveCorpus(path.join(dir, "corpus"), corpus);
  for (let i = 0; i < nc.CHANNELS.length; i++) {
    nc.saveChannel(path.join(dir, "channels"), i, nc.buildChannel(corpus, i, { minTotal: 1 }));
  }
  const model = nc.loadModel(dir);
  const items = nc.prepareRows(model, rows);
  const report = nc.evaluateItems(model, items);
  assert.equal(model.channels.length, 20);
  assert.equal(report.positions, items.length);
  assert.ok(report.top1 >= 0 && report.top1 <= 1);
  assert.ok(report.top5 >= report.top1);
  assert.ok(report.top8 >= report.top5);
  assert.ok(report.coverage >= 0 && report.coverage <= 1);
  assert.ok(nc.CHANNELS.every(channel => channel.name));
  console.log("ngram compact tests passed", JSON.stringify(report));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
