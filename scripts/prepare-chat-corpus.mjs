#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://datasets-server.huggingface.co";
const SOURCES = [
  {
    id: "imperius-ru-classic",
    dataset: "Imperius/ru-classic",
    maxRows: 2000,
    maxCharacters: 2_000_000,
    maxDownloadBytes: 4 * 1024 * 1024,
    license: "CC0-1.0",
    url: "https://huggingface.co/datasets/Imperius/ru-classic",
    rawTextUrl: "https://huggingface.co/datasets/Imperius/ru-classic/resolve/main/corpus_clean.norm.txt?download=true",
    role: "literature",
  },
  {
    id: "ruheritage-poetry",
    dataset: "maxzt/RuHeritage-Corpus",
    maxRows: 1000,
    maxCharacters: 800_000,
    maxDownloadBytes: 4 * 1024 * 1024,
    license: "CC-BY-4.0",
    url: "https://huggingface.co/datasets/maxzt/RuHeritage-Corpus",
    rawFileUrl: "https://huggingface.co/datasets/maxzt/RuHeritage-Corpus/resolve/main/russian_classics_dataset.jsonl?download=true",
    allowedAuthors: ["Александр Пушкин", "Михаил Лермонтов", "Александр Блок", "Анна Ахматова", "Сергей Есенин", "Марина Цветаева"],
    role: "literature-filtered",
  },
  {
    id: "tiny-russian-dialogs",
    dataset: "Fmluder/Tiny-Russian-Dialogs",
    pageLimit: 40,
    maxRows: 4000,
    maxCharacters: 500_000,
    license: "CC0-1.0",
    url: "https://huggingface.co/datasets/Fmluder/Tiny-Russian-Dialogs",
    role: "qa",
  },
  {
    id: "openassistant-ru",
    dataset: "OpenAssistant/oasst1",
    pageLimit: 100,
    maxRows: 10000,
    maxCharacters: 1_000_000,
    license: "Apache-2.0",
    url: "https://huggingface.co/datasets/OpenAssistant/oasst1",
    where: "\"lang\"='ru' AND \"deleted\"=false",
    role: "oasst",
    optional: true,
  },
  {
    id: "ru-dataset-small",
    dataset: "ru-dataset/ru-dataset-small",
    pageLimit: 30,
    maxRows: 2650,
    maxCharacters: 1_500_000,
    license: "Apache-2.0",
    url: "https://huggingface.co/datasets/ru-dataset/ru-dataset-small",
    role: "dialogue",
  },
  {
    id: "russian-everyday-dialogues",
    dataset: "kukunechka/russian-everyday-dialogues",
    pageLimit: 1,
    maxRows: 100,
    maxCharacters: 250_000,
    license: "CC-BY-4.0",
    url: "https://huggingface.co/datasets/kukunechka/russian-everyday-dialogues",
    rawFileUrl: "https://huggingface.co/datasets/kukunechka/russian-everyday-dialogues/resolve/main/russian_everyday_dialogues.jsonl?download=true",
    maxDownloadBytes: 64 * 1024,
    role: "everyday",
  },
];

const normalize = value => String(value ?? "")
  .normalize("NFKC")
  .replace(/\r\n?/gu, "\n")
  .replace(/[ \t]+\n/gu, "\n")
  .replace(/\n{3,}/gu, "\n\n")
  .trim();

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function responseError(response, url) {
  return new Error("Hugging Face dataset API returned HTTP " +
    response.status + " for " + url);
}

async function fetchJson(fetchImpl, url, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "NEUROGENESIS-open-corpus-preparer/1.0",
        },
      });
      if (response.ok) return await response.json();
      const error = responseError(response, url);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) ||
          attempt === retries) throw error;
      lastError = error;
      const retryAfter = Number(response.headers?.get?.("retry-after") || 0);
      await new Promise(resolve => setTimeout(resolve,
        Math.min(5000, retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt))));
    } catch (error) {
      lastError = error;
      if (attempt === retries || /HTTP \d+/.test(String(error?.message))) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw lastError || new Error("Dataset request failed.");
}

function chooseTrainingSplit(payload) {
  const splits = Array.isArray(payload?.splits) ? payload.splits : [];
  const train = splits.find(item => item.split === "train");
  if (!train?.config) {
    throw new Error("The dataset viewer exposes no train split: " +
      JSON.stringify(splits.map(item => ({ config: item.config, split: item.split }))));
  }
  return { config: train.config, split: train.split };
}

function safeAssistantContent(value) {
  return normalize(value)
    .replace(/<think>[\s\S]*?<\/think>/giu, " ")
    .replace(/<think>[\s\S]*$/giu, " ")
    .replace(/<\/?think>/giu, " ")
    .trim();
}

function dialogueText(row) {
  if (row?.language && String(row.language).toLowerCase() !== "ru") return "";
  if (row?.type && String(row.type).toLowerCase() !== "chat") return "";
  if (!Array.isArray(row?.messages)) return "";
  const messages = row.messages
    .filter(message => message &&
      ["user", "assistant"].includes(String(message.role || "").toLowerCase()))
    .map(message => {
      const role = String(message.role).toLowerCase();
      const content = role === "assistant"
        ? safeAssistantContent(message.content) : normalize(message.content);
      return content ? (role === "user" ? "<|user|>\n" : "<|assistant|>\n") + content : "";
    })
    .filter(Boolean);
  if (messages.length < 2 || !messages[0].startsWith("<|user|>") ||
      !messages.some(message => message.startsWith("<|assistant|>"))) return "";
  return messages.join("\n") + "\n<|end|>";
}

function everydayDialogueText(row) {
  const user = normalize(row?.user);
  const assistant = safeAssistantContent(row?.assistant);
  if (!user || !assistant) return "";
  return "<|user|>\n" + user + "\n<|assistant|>\n" + assistant + "\n<|end|>";
}

function qaDialogueText(row) {
  const user = normalize(row?.q);
  const assistant = safeAssistantContent(row?.a);
  if (!user || !assistant) return "";
  return "<|user|>\n" + user + "\n<|assistant|>\n" + assistant + "\n<|end|>";
}

function openAssistantRowsToPairs(rawRows, source) {
  const rows = rawRows.filter(row =>
    row && row.lang === "ru" && row.deleted !== true && row.synthetic !== true &&
    typeof row.message_id === "string" && typeof row.text === "string");
  const byId = new Map(rows.map(row => [row.message_id, row]));
  const pairs = [];
  const seen = new Set();
  let characters = 0;
  for (const assistant of rows) {
    if (assistant.role !== "assistant" || !assistant.parent_id) continue;
    if (assistant.review_result === false) continue;
    const user = byId.get(assistant.parent_id);
    if (!user || user.role !== "prompter" || user.deleted === true) continue;
    if (user.review_result === false) continue;
    const question = normalize(user.text).slice(0, 1200);
    const answer = safeAssistantContent(assistant.text).slice(0, 1600);
    if (question.length < 3 || answer.length < 3) continue;
    const pair = "<|user|>\n" + question + "\n<|assistant|>\n" + answer + "\n<|end|>";
    if (seen.has(pair)) continue;
    seen.add(pair);
    pairs.push(pair);
    characters += pair.length;
    if (characters >= source.maxCharacters) break;
  }
  return pairs;
}

function extractText(source, row) {
  if (source.role === "qa") return qaDialogueText(row);
  if (source.role === "literature" || source.role === "literature-filtered") {
    if (source.allowedAuthors &&
        !source.allowedAuthors.includes(normalize(row?.author))) return "";
    const candidates = ["text", "content", "document"];
    for (const key of candidates) {
      const value = normalize(row?.[key]);
      if (value.length >= 80) return value;
    }
    return "";
  }
  if (source.role === "everyday") return everydayDialogueText(row);
  return dialogueText(row);
}

async function collectDialogueFile(fetchImpl, source) {
  const response = await fetchImpl(source.rawFileUrl, {
    headers: {
      Accept: "application/jsonl, application/x-ndjson, text/plain",
      Range: "bytes=0-" + (source.maxDownloadBytes - 1),
      "User-Agent": "NEUROGENESIS-open-corpus-preparer/1.0",
    },
  });
  if (!response.ok) throw responseError(response, source.rawFileUrl);

  const rows = [];
  const seen = new Set();
  let rawRows = 0;
  let characters = 0;
  let consumedBytes = 0;
  const maxBytes = source.maxDownloadBytes;
  const acceptLine = line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    rawRows += 1;
    let row;
    try { row = JSON.parse(trimmed); }
    catch { return; }
    const text = extractText(source, row);
    if (!text || seen.has(text)) return;
    seen.add(text);
    const remaining = source.maxCharacters - characters;
    const bounded = text.slice(0, remaining);
    if (bounded.length < 30) return;
    rows.push(bounded);
    characters += bounded.length;
  };

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let pending = "";
    let reachedEnd = false;
    try {
      while (consumedBytes < maxBytes && rawRows < source.maxRows &&
             characters < source.maxCharacters) {
        const next = await reader.read();
        if (next.done) { reachedEnd = true; break; }
        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        const allowed = Math.min(chunk.byteLength, maxBytes - consumedBytes);
        consumedBytes += allowed;
        pending += decoder.decode(chunk.subarray(0, allowed), { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          acceptLine(line);
          if (rawRows >= source.maxRows || characters >= source.maxCharacters) break;
        }
        if (allowed < chunk.byteLength) break;
      }
      pending += decoder.decode();
      if (reachedEnd) acceptLine(pending);
      else if (consumedBytes < maxBytes && rawRows < source.maxRows) acceptLine(pending);
    } finally {
      try { await reader.cancel(); } catch {}
    }
  } else if (typeof response.text === "function") {
    // Text fallback keeps the extractor unit-testable with tiny in-memory fixtures.
    const body = await response.text();
    consumedBytes = new TextEncoder().encode(body).byteLength;
    for (const line of body.split(/\r?\n/u)) {
      acceptLine(line);
      if (rawRows >= source.maxRows || characters >= source.maxCharacters) break;
    }
  } else {
    throw new Error("The dialogue source response has no readable body.");
  }

  if (!rows.length) {
    throw new Error("No Russian general-chat examples were extracted from " + source.rawFileUrl +
      ". Check the public JSONL file path and its schema.");
  }
  return {
    source, config: "raw-jsonl", split: "train",
    rows, rawRows, requests: 1, characters, uniqueRows: rows.length,
    downloadedBytes: consumedBytes,
  };
}

async function collectLiteratureFile(fetchImpl, source) {
  const maxBytes = source.maxDownloadBytes;
  const response = await fetchImpl(source.rawTextUrl, {
    headers: {
      Accept: "text/plain",
      Range: "bytes=0-" + (maxBytes - 1),
      "User-Agent": "NEUROGENESIS-open-corpus-preparer/1.0",
    },
  });
  if (!response.ok) throw responseError(response, source.rawTextUrl);

  const paragraphs = [];
  let pending = "";
  let consumedBytes = 0;
  let rawRows = 0;
  let characters = 0;
  const seen = new Set();
  const acceptParagraph = value => {
    const text = normalize(value);
    if (text.length < 100 || seen.has(text)) return;
    seen.add(text);
    const remaining = source.maxCharacters - characters;
    const bounded = text.slice(0, remaining);
    if (bounded.length < 100) return;
    paragraphs.push(bounded);
    characters += bounded.length;
  };
  const processChunk = value => {
    pending += value;
    const blocks = pending.split(/\n\s*\n/gu);
    pending = blocks.pop() || "";
    for (const block of blocks) {
      rawRows += 1;
      acceptParagraph(block);
      if (paragraphs.length >= source.maxRows || characters >= source.maxCharacters) break;
    }
  };

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let reachedEnd = false;
    try {
      while (consumedBytes < maxBytes && paragraphs.length < source.maxRows &&
             characters < source.maxCharacters) {
        const next = await reader.read();
        if (next.done) { reachedEnd = true; break; }
        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        const allowed = Math.min(chunk.byteLength, maxBytes - consumedBytes);
        consumedBytes += allowed;
        processChunk(decoder.decode(chunk.subarray(0, allowed), { stream: true }));
        if (allowed < chunk.byteLength) break;
      }
      pending += decoder.decode();
      if (reachedEnd || consumedBytes < maxBytes) {
        rawRows += pending.trim() ? 1 : 0;
        acceptParagraph(pending);
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
  } else if (typeof response.text === "function") {
    const body = await response.text();
    consumedBytes = new TextEncoder().encode(body).byteLength;
    processChunk(body);
    rawRows += pending.trim() ? 1 : 0;
    acceptParagraph(pending);
  } else {
    throw new Error("The literature source response has no readable body.");
  }
  if (!paragraphs.length) {
    throw new Error("No long-form Russian paragraphs were extracted from " + source.rawTextUrl);
  }
  return {
    source, config: "raw-text", split: "train",
    rows: paragraphs, rawRows, requests: 1, characters,
    uniqueRows: paragraphs.length, downloadedBytes: consumedBytes,
  };
}

async function collectOpenAssistant(fetchImpl, source) {
  const splitsPayload = await fetchJson(fetchImpl,
    API + "/splits?dataset=" + encodeURIComponent(source.dataset));
  const { config, split } = chooseTrainingSplit(splitsPayload);
  const rawRows = [];
  let requests = 0;
  let offset = 0;
  while (rawRows.length < source.maxRows && requests < source.pageLimit) {
    const requestedLength = Math.min(100, source.maxRows - rawRows.length);
    const query = new URLSearchParams({
      dataset: source.dataset, config, split,
      where: source.where, offset: String(offset),
      length: String(requestedLength),
    });
    const payload = await fetchJson(fetchImpl, API + "/filter?" + query.toString());
    const batch = Array.isArray(payload?.rows) ? payload.rows.map(item => item?.row).filter(Boolean) : [];
    if (!batch.length) break;
    rawRows.push(...batch);
    offset += batch.length;
    requests += 1;
    if (batch.length < requestedLength) break;
  }
  const pairs = openAssistantRowsToPairs(rawRows, source);
  if (pairs.length < 3) {
    throw new Error("Fewer than three Russian parent/assistant pairs were reconstructed from " +
      source.dataset + ". Check the language filter and message-tree fields.");
  }
  const characters = pairs.reduce((sum, row) => sum + row.length, 0);
  return {
    source, config, split, rows: pairs,
    rawRows: rawRows.length, requests, characters, uniqueRows: pairs.length,
  };
}

async function collectSource(fetchImpl, source) {
  if (source.role === "oasst") return collectOpenAssistant(fetchImpl, source);
  if (source.rawTextUrl) return collectLiteratureFile(fetchImpl, source);
  if (source.rawFileUrl) return collectDialogueFile(fetchImpl, source);
  const splitsUrl = API + "/splits?dataset=" + encodeURIComponent(source.dataset);
  const splitsPayload = await fetchJson(fetchImpl, splitsUrl);
  const { config, split } = chooseTrainingSplit(splitsPayload);
  const rows = [];
  const seen = new Set();
  let characters = 0;
  let requests = 0;
  let rawRows = 0;
  let offset = 0;

  while (rawRows < source.maxRows && characters < source.maxCharacters &&
         requests < source.pageLimit) {
    const length = Math.min(100, source.maxRows - rawRows);
    const query = new URLSearchParams({
      dataset: source.dataset, config, split,
      offset: String(offset), length: String(length),
    });
    if (source.where) query.set("where", source.where);
    const endpoint = source.where ? "/filter?" : "/rows?";
    const payload = await fetchJson(fetchImpl, API + endpoint + query.toString());
    const batch = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!batch.length) break;
    requests += 1;
    rawRows += batch.length;
    offset += batch.length;

    for (const wrapped of batch) {
      const text = extractText(source, wrapped?.row);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const remaining = source.maxCharacters - characters;
      const bounded = text.slice(0, remaining);
      if (bounded.length < (source.role === "literature" ? 80 : 30)) continue;
      rows.push(bounded);
      characters += bounded.length;
      if (characters >= source.maxCharacters) break;
    }
    if (batch.length < length) break;
  }

  if (!rows.length) {
    throw new Error("No eligible Russian text was extracted from " + source.dataset +
      ". Check dataset-viewer availability, split schema and filters.");
  }
  return {
    source,
    config,
    split,
    rows,
    rawRows,
    requests,
    characters,
    uniqueRows: rows.length,
  };
}

function splitRows(sourceId, rows) {
  // Stratified, deterministic per-source split guarantees holdout rows even
  // for the 20-example colloquial dialogue source. This is still row-level,
  // not author- or document-disjoint.
  const sorted = rows.slice().sort((left, right) =>
    hash(sourceId + "\n" + left) - hash(sourceId + "\n" + right) ||
    (left < right ? -1 : left > right ? 1 : 0));
  if (sorted.length < 3) {
    throw new Error("Each corpus source needs at least three unique rows for train/validation/test.");
  }
  const validationCount = Math.max(1, Math.floor(sorted.length * 0.05));
  const testCount = Math.max(1, Math.floor(sorted.length * 0.05));
  const trainingEnd = sorted.length - validationCount - testCount;
  return {
    train: sorted.slice(0, trainingEnd),
    validation: sorted.slice(trainingEnd, trainingEnd + validationCount),
    test: sorted.slice(trainingEnd + validationCount),
  };
}

export async function prepareCorpus(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible function is required.");
  const sources = options.sources || SOURCES;
  const results = [];
  const skippedSources = [];
  for (const source of sources) {
    try {
      results.push(await collectSource(fetchImpl, source));
    } catch (error) {
      if (!source.optional) throw error;
      skippedSources.push({
        id: source.id, dataset: source.dataset,
        reason: String(error?.message || error).slice(0, 500),
      });
    }
  }

  const buckets = { train: [], validation: [], test: [] };
  const countsBySource = {};
  for (const result of results) {
    const sourceSplits = splitRows(result.source.id, result.rows);
    countsBySource[result.source.id] = {
      train: sourceSplits.train.length,
      validation: sourceSplits.validation.length,
      test: sourceSplits.test.length,
    };
    for (const split of Object.keys(buckets)) buckets[split].push(...sourceSplits[split]);
  }
  if (!buckets.train.length || !buckets.validation.length || !buckets.test.length) {
    throw new Error("Prepared corpus does not contain non-empty train, validation and test splits.");
  }

  const manifest = {
    schema: "NEUROGENESIS_PREPARED_CHAT_CORPUS_V1",
    createdAt: new Date().toISOString(),
    method: "Hugging Face datasets-server rows/filter API plus bounded streaming of normalized text and JSONL files; deterministic per-source sampling; exact duplicate removal.",
    splitMethod: "Deterministic per-source 90/5/5 split, with at least one validation and one test row per source. It is NOT author- or document-disjoint.",
    sources: results.map(result => ({
      id: result.source.id,
      dataset: result.source.dataset,
      url: result.source.url,
      license: result.source.license,
      role: result.source.role,
      config: result.config,
      upstreamSplit: result.split,
      rawFileUrl: result.source.rawFileUrl || null,
      rawTextUrl: result.source.rawTextUrl || null,
      downloadedBytes: result.downloadedBytes ?? null,
      fetchedRows: result.rawRows,
      uniqueRows: result.uniqueRows,
      requests: result.requests,
      characters: result.characters,
      localSplitCounts: countsBySource[result.source.id],
      filters: result.source.role === "literature"
        ? ["stream first 4 MiB of corpus_clean.norm.txt", "split at blank lines",
          "keep paragraphs of at least 100 characters", "remove exact duplicates"]
        : result.source.role === "literature-filtered"
          ? ["stream the public JSONL backup", "keep selected classical-poet author names",
            "keep text fields of at least 80 characters", "remove exact duplicate text"]
        : result.source.role === "oasst"
          ? ["filter lang == ru and deleted == false", "reconstruct assistant replies from parent prompter messages",
            "exclude deleted, synthetic and review_result == false rows"]
        : result.source.role === "qa"
          ? ["one q/a pair per row", "strip any <think> blocks", "remove exact duplicates"]
        : result.source.role === "everyday"
        ? ["explicit user and assistant fields must both be non-empty"]
        : result.source.role === "dialogue"
          ? ["keep only user/assistant message roles", "discard system messages",
            "strip all <think> blocks; keep only assistant final text when present"]
          : ["non-empty text/content/document field, at least 80 characters"],
      attribution: result.source.id === "imperius-ru-classic"
        ? "Imperius/ru-classic, CC0-1.0; Russian classical texts originally from lib.ru."
        : result.source.id === "ruheritage-poetry"
          ? "maxzt/RuHeritage-Corpus, CC BY 4.0; curated Russian public-domain literary texts from Russian Wikisource, filtered to selected poets."
        : result.source.id === "tiny-russian-dialogs"
          ? "Fmluder, Tiny-Russian-Dialogs, CC0-1.0; adapted as user/assistant turns."
          : result.source.id === "openassistant-ru"
            ? "OpenAssistant, OASST1, Apache-2.0; adapted by filtering Russian messages and reconstructing parent/reply pairs."
        : result.source.id === "russian-everyday-dialogues"
        ? "Ekaterina Myskina, Russian Everyday Dialogues (2025), CC BY 4.0; adapted by adding role markers."
        : result.source.id === "ru-dataset-small"
          ? "ru-dataset, RU Dataset 1 (ru-dataset-small), Apache-2.0; adapted by removing system and <think> content."
          : "Imperius/ru-classic, CC0-1.0.",
    })),
    totals: Object.fromEntries(Object.entries(buckets).map(([key, value]) =>
      [key, { rows: value.length, characters: value.reduce((sum, text) => sum + text.length, 0) }])),
    countsBySource,
    skippedSources,
    limitations: [
      "This is a bounded training sample, not the complete upstream datasets.",
      "Optional source failures are recorded in skippedSources and do not silently appear as training data.",
      "The validation and test splits are row-level, not author- or document-disjoint.",
      "Literary next-token training teaches language patterns, not reliable factual knowledge.",
      "The instruction dataset contains explicit <think> blocks; these are removed before training and only assistant final text is kept.",
      "The everyday dialogue set contains 20 authored examples and is a style supplement, not a large-scale chat corpus.",
      "The literature sample is a 4 MiB prefix of the upstream normalized text, not the entire 866 MB corpus.",
      "The instruction dataset includes coding and reasoning prompts, so it does not represent casual conversation alone.",
      "RuHeritage poetry samples are filtered by selected author names; the upstream dataset mixes verse and prose and does not provide a dedicated genre field.",
      "Tiny-Russian-Dialogs is synthetic and has repeated answer templates; it is supplementary, not a substitute for human dialogue.",
      "OASST1 contains multiple reply branches; only direct Russian prompter-to-assistant pairs are reconstructed, not complete conversation trees.",
    ],
  };
  return { buckets, manifest };
}

async function main() {
  const outputDir = path.resolve(process.argv[2] || path.join(ROOT, "training-data/generated"));
  const { buckets, manifest } = await prepareCorpus();
  await fs.mkdir(outputDir, { recursive: true });
  for (const [name, rows] of Object.entries(buckets)) {
    await fs.writeFile(path.join(outputDir, name + ".txt"), rows.join("\n\n") + "\n", "utf8");
  }
  await fs.writeFile(path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    outputDir,
    totals: manifest.totals,
    sources: manifest.sources.map(source => ({
      dataset: source.dataset, license: source.license,
      uniqueRows: source.uniqueRows, characters: source.characters,
    })),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error("Open-corpus preparation failed:", error);
    process.exitCode = 1;
  });
}

export const __test = { chooseTrainingSplit, dialogueText, everydayDialogueText, qaDialogueText, safeAssistantContent, openAssistantRowsToPairs, extractText, splitRows };
