"use strict";
// node scripts/train-compact.js <train.txt> <N> <outdir>   (повторный запуск продолжает с того места, где остановился)
const fs = require("node:fs");
const path = require("node:path");
const nc = require("./ngram-compact.js");
const [trainFile, trainN, outDir] = process.argv.slice(2);
const budgetMs = Number(process.env.BUDGET_SEC || 200) * 1000;
const minTotal = Number(process.env.MIN_TOTAL || 2);
const t0 = Date.now();
const corpusDir = path.join(outDir, "corpus"), chDir = path.join(outDir, "channels");
let corpus;
if (fs.existsSync(path.join(corpusDir, "vocab.json"))) {
  corpus = nc.loadCorpus(corpusDir);
  console.log("корпус загружен:", corpus.sentences, "предложений,", corpus.tokens, "токенов,", corpus.vocab.length, "слов в словаре");
} else {
  const lines = [];
  const text = fs.readFileSync(trainFile, "utf8");
  let start = 0;
  while (lines.length < Number(trainN)) {
    const end = text.indexOf("\n", start);
    if (end < 0) { if (start < text.length) lines.push(text.slice(start)); break; }
    lines.push(text.slice(start, end)); start = end + 1;
  }
  corpus = nc.buildCorpus(lines);
  nc.saveCorpus(corpusDir, corpus);
  console.log("корпус собран:", corpus.sentences, "предложений,", corpus.tokens, "токенов,", corpus.vocab.length, "слов;", ((Date.now() - t0) / 1000).toFixed(0), "с");
}
const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
let done = 0, total = only ? only.length : nc.CHANNELS.length;
for (let c = 0; c < nc.CHANNELS.length; c++) {
  if (only && !only.includes(c)) continue;
  if (nc.channelExists(chDir, c)) { done++; continue; }
  if (Date.now() - t0 > budgetMs) break;
  const t1 = Date.now();
  const ch = nc.buildChannel(corpus, c, { minTotal });
  nc.saveChannel(chDir, c, ch);
  done++;
  console.log("канал", c, nc.CHANNELS[c].name, "ключей", ch.nk, "записей", ch.nt, (Date.now() - t1) / 1000 + " с", "heapMB", Math.round(process.memoryUsage().heapUsed / 1048576));
}
console.log(done === total ? "ВСЕ КАНАЛЫ ГОТОВЫ" : "готово каналов " + done + "/" + total + " — запусти ещё раз", ((Date.now() - t0) / 1000).toFixed(0), "с");
