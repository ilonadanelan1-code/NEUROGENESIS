"use strict";
/*
 * Компактный n-gram предсказатель для больших корпусов (Node.js).
 * Те же идеи, что в ngram-predictor.js (двусторонний контекст, каналы по словам и основам),
 * но вместо Map-ов — хэши ключей и типизированные массивы, поэтому влезает 1M предложений.
 *
 * Строки корпуса: одно предложение на строку, слова через пробел, нижний регистр, «е» вместо «ё».
 */
const fs = require("node:fs");
const path = require("node:path");

const STEM_LEN = 5;
const BOS = 0x1234567 >>> 0, EOS = 0x7654321 >>> 0;
const TID_BITS = 262144;            // 2^18 — максимум слов в словаре
const NONE = 0xFFFFFFFF;
const TOP_PER_KEY = 8;

const OFFSET_SETS = [[-1], [1], [-2], [2], [-2, -1], [1, 2], [-1, 1], [-2, -1, 1], [-1, 1, 2], [-2, -1, 1, 2]];
const CHANNELS = [];
for (const offsets of OFFSET_SETS) for (const mode of ["surface", "stem"]) CHANNELS.push({ offsets, mode, name: (mode === "surface" ? "w" : "t") + offsets.join(",") });

function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function stemOf(word) { return word.length > STEM_LEN ? word.slice(0, STEM_LEN) : word; }
function combine(seed, parts) {
  let k = seed >>> 0;
  for (let i = 0; i < parts.length; i++) { k = Math.imul(k ^ parts[i], 0x9E3779B1) >>> 0; k ^= k >>> 15; }
  return k >>> 0;
}
function channelSeed(index) { return Math.imul(index + 1, 0x85EBCA6B) >>> 0; }

function readU32(file) {
  const buf = fs.readFileSync(file);
  return new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}
function writeTyped(file, arr) { fs.writeFileSync(file, Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)); }

/* ---------- корпус ---------- */
function buildCorpus(lines, options = {}) {
  const maxVocab = Math.min(options.maxVocab || 200000, TID_BITS - 1);
  const counts = new Map();
  let tokenTotal = 0;
  for (const line of lines) {
    const words = line.split(" ");
    for (const w of words) { if (w) { counts.set(w, (counts.get(w) || 0) + 1); tokenTotal++; } }
  }
  const ranked = Array.from(counts.entries()).filter(e => e[1] >= (options.minCount || 2))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxVocab);
  const vocab = ranked.map(e => e[0]);
  const vocabCounts = ranked.map(e => e[1]);
  const ids = new Map(vocab.map((w, i) => [w, i]));
  const wh = new Uint32Array(tokenTotal), sh = new Uint32Array(tokenTotal), tid = new Uint32Array(tokenTotal);
  const starts = new Uint32Array(lines.length + 1);
  let p = 0;
  for (let s = 0; s < lines.length; s++) {
    starts[s] = p;
    for (const w of lines[s].split(" ")) {
      if (!w) continue;
      wh[p] = fnv(w); sh[p] = fnv(stemOf(w));
      const id = ids.get(w);
      tid[p] = id === undefined ? NONE : id;
      p++;
    }
  }
  starts[lines.length] = p;
  return { wh: wh.subarray(0, p), sh: sh.subarray(0, p), tid: tid.subarray(0, p), starts, sentences: lines.length, tokens: p, vocab, vocabCounts };
}
function saveCorpus(dir, c) {
  fs.mkdirSync(dir, { recursive: true });
  writeTyped(path.join(dir, "wh.u32"), c.wh); writeTyped(path.join(dir, "sh.u32"), c.sh);
  writeTyped(path.join(dir, "tid.u32"), c.tid); writeTyped(path.join(dir, "starts.u32"), c.starts);
  fs.writeFileSync(path.join(dir, "vocab.json"), JSON.stringify({ vocab: c.vocab, counts: c.vocabCounts, sentences: c.sentences, tokens: c.tokens }));
}
function loadCorpus(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "vocab.json"), "utf8"));
  return { wh: readU32(path.join(dir, "wh.u32")), sh: readU32(path.join(dir, "sh.u32")), tid: readU32(path.join(dir, "tid.u32")),
    starts: readU32(path.join(dir, "starts.u32")), sentences: meta.sentences, tokens: meta.tokens, vocab: meta.vocab, vocabCounts: meta.counts };
}

/* ---------- построение одного канала ---------- */
function buildChannel(corpus, channelIndex, options = {}) {
  const minTotal = options.minTotal || 2;
  const channel = CHANNELS[channelIndex], seed = channelSeed(channelIndex), offsets = channel.offsets;
  const arr = channel.mode === "stem" ? corpus.sh : corpus.wh, tid = corpus.tid, starts = corpus.starts;
  let valid = 0;
  for (let i = 0; i < tid.length; i++) if (tid[i] !== NONE) valid++;
  const pairs = new Float64Array(valid);
  const parts = new Array(offsets.length);
  let j = 0;
  for (let s = 0; s < corpus.sentences; s++) {
    const a = starts[s], b = starts[s + 1];
    for (let i = a; i < b; i++) {
      const t = tid[i];
      if (t === NONE) continue;
      for (let o = 0; o < offsets.length; o++) {
        const q = i + offsets[o];
        parts[o] = q < a ? BOS : q >= b ? EOS : arr[q];
      }
      pairs[j++] = combine(seed, parts) * TID_BITS + t;
    }
  }
  pairs.sort();
  let cap = 1 << 20;
  let keys = new Uint32Array(cap), startIdx = new Uint32Array(cap + 1), totals = new Uint32Array(cap);
  let tcap = 1 << 21, tgt = new Uint32Array(tcap), cnt = new Uint16Array(tcap);
  let nk = 0, nt = 0;
  const run = [];
  let i = 0;
  while (i < j) {
    const k = Math.floor(pairs[i] / TID_BITS);
    let e = i; run.length = 0;
    let total = 0;
    while (e < j && Math.floor(pairs[e] / TID_BITS) === k) {
      const v = pairs[e];
      let f = e + 1;
      while (f < j && pairs[f] === v) f++;
      run.push([v - k * TID_BITS, f - e]);
      total += f - e; e = f;
    }
    i = e;
    if (total < minTotal) continue;
    run.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    const keep = Math.min(TOP_PER_KEY, run.length);
    if (nk + 1 >= cap) {
      cap *= 2;
      const k2 = new Uint32Array(cap); k2.set(keys); keys = k2;
      const s2 = new Uint32Array(cap + 1); s2.set(startIdx); startIdx = s2;
      const t2 = new Uint32Array(cap); t2.set(totals); totals = t2;
    }
    if (nt + keep >= tcap) {
      tcap *= 2;
      const g2 = new Uint32Array(tcap); g2.set(tgt); tgt = g2;
      const c2 = new Uint16Array(tcap); c2.set(cnt); cnt = c2;
    }
    keys[nk] = k; startIdx[nk] = nt; totals[nk] = total; nk++;
    for (let r = 0; r < keep; r++) { tgt[nt] = run[r][0]; cnt[nt] = Math.min(65535, run[r][1]); nt++; }
  }
  startIdx[nk] = nt;
  return { keys: keys.slice(0, nk), start: startIdx.slice(0, nk + 1), totals: totals.slice(0, nk), tgt: tgt.slice(0, nt), cnt: cnt.slice(0, nt), nk, nt };
}
function saveChannel(dir, index, ch) {
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, "ch" + String(index).padStart(2, "0"));
  const header = new Uint32Array([ch.nk, ch.nt]);
  writeTyped(base + ".hdr", header); writeTyped(base + ".keys", ch.keys); writeTyped(base + ".start", ch.start);
  writeTyped(base + ".tot", ch.totals); writeTyped(base + ".tgt", ch.tgt); writeTyped(base + ".cnt", ch.cnt);
}
function channelExists(dir, index) { return fs.existsSync(path.join(dir, "ch" + String(index).padStart(2, "0") + ".cnt")); }
function loadChannel(dir, index) {
  const base = path.join(dir, "ch" + String(index).padStart(2, "0"));
  const hdr = readU32(base + ".hdr");
  const cntBuf = fs.readFileSync(base + ".cnt");
  return { nk: hdr[0], nt: hdr[1], keys: readU32(base + ".keys"), start: readU32(base + ".start"), totals: readU32(base + ".tot"),
    tgt: readU32(base + ".tgt"), cnt: new Uint16Array(cntBuf.buffer.slice(cntBuf.byteOffset, cntBuf.byteOffset + cntBuf.length)) };
}

/* ---------- модель для предсказания ---------- */
function defaultWeights() {
  const w = {};
  for (const c of CHANNELS) w[c.name] = Math.pow(2, c.offsets.length - 1) * (c.mode === "surface" ? 1 : 0.6);
  w.unigram = 0.02; w.shrink = 0.5;
  return w;
}
function loadModel(dir, channelIndexes) {
  const corpus = JSON.parse(fs.readFileSync(path.join(dir, "corpus", "vocab.json"), "utf8"));
  const indexes = channelIndexes || CHANNELS.map((_, i) => i).filter(i => channelExists(path.join(dir, "channels"), i));
  const channels = indexes.map(i => ({ index: i, data: loadChannel(path.join(dir, "channels"), i) }));
  const ids = new Map(corpus.vocab.map((w, i) => [w, i]));
  let unigramTotal = 0;
  for (const c of corpus.counts) unigramTotal += c;
  return { vocab: corpus.vocab, ids, counts: corpus.counts, unigramTotal, channels, weights: defaultWeights() };
}
function findKey(keys, key) {
  let lo = 0, hi = keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1, v = keys[mid];
    if (v === key) return mid;
    if (v < key) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
// Подготовка позиций: какие записи каждого канала совпали (бинарный поиск делается один раз).
function prepareRows(model, rows) {
  const items = [];
  const C = model.channels.length;
  for (const row of rows) {
    const tokens = row.split(" ").filter(Boolean);
    if (tokens.length < 2) continue;
    const wh = tokens.map(fnv), sh = tokens.map(w => fnv(stemOf(w)));
    for (let i = 0; i < tokens.length; i++) {
      const m = [];
      for (let c = 0; c < C; c++) {
        const idx = model.channels[c].index, ch = CHANNELS[idx], arr = ch.mode === "stem" ? sh : wh;
        const parts = ch.offsets.map(o => { const q = i + o; return q < 0 ? BOS : q >= tokens.length ? EOS : arr[q]; });
        const pos = findKey(model.channels[c].data.keys, combine(channelSeed(idx), parts));
        if (pos >= 0) m.push(c, pos);
      }
      const target = model.ids.get(tokens[i]);
      items.push({ m, target: target === undefined ? -1 : target });
    }
  }
  return items;
}
function scoreItem(model, item, weights, scratch) {
  scratch.clear();
  const shrink = weights.shrink;
  for (let n = 0; n < item.m.length; n += 2) {
    const ch = model.channels[item.m[n]], pos = item.m[n + 1];
    const w = weights[CHANNELS[ch.index].name];
    if (!w) continue;
    const den = ch.data.totals[pos] + shrink;
    for (let t = ch.data.start[pos]; t < ch.data.start[pos + 1]; t++) {
      const id = ch.data.tgt[t];
      scratch.set(id, (scratch.get(id) || 0) + w * ch.data.cnt[t] / den);
    }
  }
  if (weights.unigram > 0) {
    if (!scratch.size) { for (let id = 0; id < 10; id++) scratch.set(id, weights.unigram * model.counts[id] / model.unigramTotal); }
    else for (const id of scratch.keys()) scratch.set(id, scratch.get(id) + weights.unigram * model.counts[id] / model.unigramTotal);
  }
  return scratch;
}
function evaluateItems(model, items, weights) {
  const scratch = new Map();
  let top1 = 0, top5 = 0, top8 = 0, known = 0;
  for (const item of items) {
    if (item.target >= 0) known++;
    const scores = scoreItem(model, item, weights || model.weights, scratch);
    if (item.target < 0) continue;
    // top-5 без полной сортировки
    const best = [];
    for (const [id, v] of scores) {
      if (best.length < 8 || v > best[best.length - 1][1]) {
        best.push([id, v]); best.sort((a, b) => b[1] - a[1] || a[0] - b[0]); if (best.length > 8) best.pop();
      }
    }
    if (best.length && best[0][0] === item.target) top1++;
    if (best.slice(0, 5).some(b => b[0] === item.target)) top5++;
    if (best.some(b => b[0] === item.target)) top8++;
  }
  return { positions: items.length, knownTargets: known, top1: top1 / items.length, top5: top5 / items.length,
    top8: top8 / items.length, top1OnKnown: known ? top1 / known : 0, coverage: known / items.length };
}
function tuneWeights(model, items, rounds = 1) {
  const names = model.channels.map(c => CHANNELS[c.index].name).concat(["unigram", "shrink"]);
  const factors = [0, 0.5, 2];
  let best = evaluateItems(model, items, model.weights).top1;
  const initial = best;
  for (let r = 0; r < rounds; r++) {
    for (const name of names) {
      const original = model.weights[name];
      let bestValue = original;
      for (const f of factors) {
        if (name === "shrink" && f === 0) continue;
        model.weights[name] = original * f;
        const acc = evaluateItems(model, items, model.weights).top1;
        if (acc > best + 1e-9) { best = acc; bestValue = model.weights[name]; }
      }
      model.weights[name] = bestValue;
    }
  }
  return { initial, tuned: best };
}

module.exports = { CHANNELS, buildCorpus, saveCorpus, loadCorpus, buildChannel, saveChannel, channelExists, loadChannel,
  loadModel, prepareRows, scoreItem, evaluateItems, tuneWeights, defaultWeights, fnv, stemOf };
