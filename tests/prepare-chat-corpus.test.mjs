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
}), "", "Examples explicitly tagged as coding must be excluded from the casual-chat path.");
const thoughtStripped = __test.dialogueText({
  messages: [
    { role: "system", content: "Do not train on system instructions." },
    { role: "user", content: "Что такое дружба?" },
    { role: "assistant", content: "<think>Скрытое рассуждение не должно попасть в набор.</think>Дружба — это взаимная поддержка." },
  ],
});
assert.match(thoughtStripped, /Дружба — это взаимная поддержка/u);
assert.doesNotMatch(thoughtStripped, /Скрытое рассуждение/u,
  "Chain-of-thought blocks must be removed before training.");
assert.doesNotMatch(thoughtStripped, /system instructions/u,
  "System messages must not become assistant training targets.");
assert.match(__test.everydayDialogueText({
  user: "Где здесь остановка?",
  assistant: "Вон за перекрёстком, справа.",
}), /<\|user\|>[\s\S]*<\|assistant\|>/u);
assert.equal(__test.everydayDialogueText({ user: "Вопрос без ответа", assistant: "" }), "");
assert.equal(
  __test.splitRows("stable-source", ["a", "b", "c"]).validation.length, 1,
  "small sources should always get at least one validation item",
);
assert.equal(
  __test.splitRows("stable-source", ["a", "b", "c"]).test.length, 1,
  "small sources should always get at least one test item",
);

const bookSource = {
  id: "book-test", dataset: "fixture/books", maxRows: 100,
  maxCharacters: 10000, maxDownloadBytes: 100000,
  license: "CC0-1.0", url: "https://example.test/books",
  rawTextUrl: "https://example.test/books.txt", role: "literature",
};
const instructionSource = {
  id: "instruction-test", dataset: "fixture/instruction", pageLimit: 2, maxRows: 100,
  maxCharacters: 10000, license: "Apache-2.0", url: "https://example.test/instruction",
  role: "dialogue",
};
const everydaySource = {
  id: "everyday-test", dataset: "fixture/everyday", pageLimit: 1, maxRows: 100,
  maxCharacters: 10000, maxDownloadBytes: 100000,
  license: "CC-BY-4.0", url: "https://example.test/everyday",
  rawFileUrl: "https://example.test/everyday.jsonl", role: "everyday",
};
const fixtures = {
  "fixture/books": {
    text: Array.from({ length: 60 }, (_, index) =>
      "Литературный фрагмент номер " + index +
      " содержит достаточно длинное предложение для проверки обучающего корпуса. ".repeat(2)
    ).join("\n\n"),
  },
  "fixture/instruction": {
    splits: [{ config: "default", split: "train" }],
    rows: Array.from({ length: 60 }, (_, index) => ({
      messages: [
        { role: "system", content: "Ignored system row" },
        { role: "user", content: "Вопрос для разговора номер " + index + "?" },
        { role: "assistant", content: "<think>Удалить это.</think>Ответ в тестовом диалоге номер " + index + "." },
      ],
    })),
  },
  "fixture/everyday": {
    rows: Array.from({ length: 60 }, (_, index) => ({
      user: "Повседневный вопрос номер " + index + "?",
      assistant: "Естественный разговорный ответ номер " + index + ".",
    })),
  },
};
const fetchImpl = async url => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/books.txt")) {
    return { ok: true, text: async () => fixtures["fixture/books"].text };
  }
  if (parsed.pathname.endsWith("/everyday.jsonl")) {
    return {
      ok: true,
      text: async () => fixtures["fixture/everyday"].rows.map(row => JSON.stringify(row)).join("\n"),
    };
  }
  const dataset = parsed.searchParams.get("dataset");
  const fixture = fixtures[dataset];
  assert.ok(fixture, "unexpected dataset request: " + url);
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
const result = await prepareCorpus({
  fetchImpl, sources: [bookSource, instructionSource, everydaySource],
});
assert.ok(result.buckets.train.length > 0);
assert.ok(result.buckets.validation.length > 0);
assert.ok(result.buckets.test.length > 0);
assert.ok(result.buckets.train.some(row => row.includes("<|assistant|>")));
assert.ok(result.buckets.train.some(row => row.includes("Литературный фрагмент")));
for (const source of result.manifest.sources) {
  assert.ok(source.localSplitCounts.train > 0, source.id + " needs train rows");
  assert.ok(source.localSplitCounts.validation > 0, source.id + " needs validation rows");
  assert.ok(source.localSplitCounts.test > 0, source.id + " needs test rows");
}
assert.equal(result.manifest.sources[1].license, "Apache-2.0");
assert.equal(result.manifest.sources[2].license, "CC-BY-4.0");
assert.equal(result.manifest.sources[0].license, "CC0-1.0");
assert.match(result.manifest.splitMethod, /NOT author- or document-disjoint/u);
assert.equal(
  result.manifest.sources[1].localSplitCounts.train +
  result.manifest.sources[1].localSplitCounts.validation +
  result.manifest.sources[1].localSplitCounts.test,
  60,
  "all 60 instruction examples should remain after role filtering",
);
assert.equal(
  result.manifest.sources[2].localSplitCounts.train +
  result.manifest.sources[2].localSplitCounts.validation +
  result.manifest.sources[2].localSplitCounts.test,
  60,
  "all 60 well-formed everyday dialogue examples should remain",
);
assert.match(result.manifest.sources[0].rawTextUrl, /corpus_clean\.norm\.txt/u);
assert.match(result.manifest.splitMethod, /at least one validation and one test row per source/u);

console.log("Open Russian corpus preparation contract passed.");
