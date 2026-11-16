"use strict";
// node scripts/eval-compact.js <modeldir> <val.txt> <valN> <test1.txt> [test2.txt ...]
const fs = require("node:fs");
const path = require("node:path");
const nc = require("./ngram-compact.js");
const [modelDir, valFile, valN, ...testFiles] = process.argv.slice(2);
function head(file, n) { return fs.readFileSync(file, "utf8").split("\n").slice(0, n).filter(Boolean); }
const model = nc.loadModel(modelDir);
console.log("каналов загружено:", model.channels.length, "словарь:", model.vocab.length);
const wf = path.join(modelDir, "weights.json");
if (Number(valN) > 0) {
  const t = Date.now();
  const items = nc.prepareRows(model, head(valFile, Number(valN)));
  const tuning = nc.tuneWeights(model, items, Number(process.env.ROUNDS || 1));
  fs.writeFileSync(wf, JSON.stringify(model.weights));
  console.log("подбор весов на validation:", (tuning.initial * 100).toFixed(2) + "% ->", (tuning.tuned * 100).toFixed(2) + "%", ((Date.now() - t) / 1000).toFixed(0), "с");
} else if (fs.existsSync(wf)) Object.assign(model.weights, JSON.parse(fs.readFileSync(wf, "utf8")));
for (const f of testFiles) {
  const items = nc.prepareRows(model, head(f, Number(process.env.TEST_N || 1500)));
  const r = nc.evaluateItems(model, items, model.weights);
  console.log(path.basename(f), "top1", (r.top1 * 100).toFixed(2) + "%", "top5", (r.top5 * 100).toFixed(2) + "%", "top8", (r.top8 * 100).toFixed(2) + "%",
    "| слова в словаре", (r.coverage * 100).toFixed(1) + "%", "top1 среди них", (r.top1OnKnown * 100).toFixed(2) + "%", "| позиций", r.positions);
}
