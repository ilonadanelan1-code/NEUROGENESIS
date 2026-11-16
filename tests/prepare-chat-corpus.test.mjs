import assert from "node:assert/strict";
import { prepareCorpus, __test } from "../scripts/prepare-chat-corpus.mjs";

assert.deepEqual(__test.chooseTrainingSplit({
  splits: [
    { config: "default", split: "test" },
    { config: "default", split: "train" },
  ],
}), { config: "default", split: "train" });

assert.equal(__test.dialogueText({
  language: "en", type: "chat",
  messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }],
}), "", "English examples must not enter the Russian chat corpus.");
assert.equal(__test.dialogueText({
  language: "ru", type: "coding",
  messages: [{ role: "user", content: "Покажи код" }, { role: "assistant", content: "Вот код" }],
}), "", "The initial corpus must keep coding examples out of general chat.");
assert.match(__test.dialogueText({
  language: "ru", type: "chat",
  messages: [{ role: "user", content: "Привет!" }, { role: "assistant", content: "Здравствуйте." }],
}), /<\|user\|>[\s\S]*<\|assistant\|>/u);
assert.equal(__test.assignSplit("stable row"), __test.assignSplit("stable row"));

const bookSource = {
  id: "book-test", dataset: "fixture/books", pageLimit: 2, maxRows: 100,
  maxCharacters: 10000, license: "CC0-1.0", url: "https://example.test/books",
  role: "literature",
};
const chatSource = {
  id: "chat-test", dataset: "fixture/chat", pageLimit: 2, maxRows: 100,
  maxCharacters: 10000, license: "CC-BY-4.0", url: "https://example.test/chat",
  role: "dialogue",
};
const fixtures = {
  "fixture/books": {
    splits: [{ config: "default", split: "train" }],
    rows: [
      { text: "Это достаточно длинный фрагмент художественного текста. ".repeat(3) },
      { text: "Это достаточно длинный фрагмент художественного текста. ".repeat(3) },
      { text: "Второй уникальный литературный фрагмент. ".repeat(4) },
    ],
  },
  "fixture/chat": {
    splits: [{ config: "default", split: "train" }],
    rows: [
      { language: "ru", type: "chat", messages: [
        { role: "user", content: "Как дела?" },
        { role: "assistant", content: "Неплохо, спасибо." },
      ] },
      { language: "en", type: "chat", messages: [
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "Fine." },
      ] },
      { language: "ru", type: "coding", messages: [
        { role: "user", content: "Напиши код." },
        { role: "assistant", content: "Вот пример." },
      ] },
      { language: "ru", type: "chat", messages: [
        { role: "user", content: "Что читаешь?" },
        { role: "assistant", content: "Сейчас — Чехова." },
      ] },
    ],
  },
};
const fetchImpl = async url => {
  const parsed = new URL(url);
  const dataset = parsed.searchParams.get("dataset");
  const fixture = fixtures[dataset];
  assert.ok(fixture, "unexpected dataset request: " + dataset);
  if (parsed.pathname.endsWith("/splits")) {
    return { ok: true, json: async () => ({ splits: fixture.splits }) };
  }
  const offset = Number(parsed.searchParams.get("offset") || 0);
  const length = Number(parsed.searchParams.get("length") || 100);
  return {
    ok: true,
    json: async () => ({ rows: fixture.rows.slice(offset, offset + length).map(row => ({ row })) }),
  };
};
const result = await prepareCorpus({ fetchImpl, sources: [bookSource, chatSource] });
assert.ok(result.buckets.train.length > 0);
assert.ok(result.buckets.validation.length > 0);
assert.ok(result.buckets.test.length > 0);
assert.ok(result.buckets.train.some(row => row.includes("<|assistant|>")));
assert.equal(result.manifest.sources[1].license, "CC-BY-4.0");
assert.equal(result.manifest.sources[0].license, "CC0-1.0");
assert.match(result.manifest.splitMethod, /NOT author- or document-disjoint/u);
assert.equal(result.manifest.sources[1].localSplitCounts.train +
  result.manifest.sources[1].localSplitCounts.validation +
  result.manifest.sources[1].localSplitCounts.test, 2,
  "only two Russian general-chat rows should remain after filtering");

console.log("Open Russian corpus preparation contract passed.");
