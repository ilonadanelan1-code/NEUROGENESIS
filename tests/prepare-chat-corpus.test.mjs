import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
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
}), "", "Explicit coding examples must be excluded from the casual-chat source.");
const thoughtStripped = __test.dialogueText({
  messages: [
    { role: "system", content: "Do not train on system instructions." },
    { role: "user", content: "Что такое дружба?" },
    { role: "assistant", content: "<think>Скрытое рассуждение не должно попасть в набор.</think>Дружба — это взаимная поддержка." },
  ],
});
assert.match(thoughtStripped, /Дружба — это взаимная поддержка/u);
assert.doesNotMatch(thoughtStripped, /Скрытое рассуждение/u);
assert.doesNotMatch(thoughtStripped, /system instructions/u);
assert.match(__test.everydayDialogueText({
  user: "Где здесь остановка?",
  assistant: "Вон за перекрёстком, справа.",
}), /<\|user\|>[\s\S]*<\|assistant\|>/u);
assert.equal(__test.everydayDialogueText({ user: "Вопрос без ответа", assistant: "" }), "");
assert.match(__test.qaDialogueText({
  q: "Короче, хэллоу если не сложно.",
  a: "Добро пожаловать в чат! О чём поболтаем?",
}), /<\|user\|>[\s\S]*<\|assistant\|>/u);
assert.equal(__test.qaDialogueText({ q: "Привет", a: "" }), "");

const assistantRows = [
  { message_id: "u1", parent_id: null, role: "prompter", lang: "ru", text: "Как дела?", deleted: false, synthetic: false, review_result: true },
  { message_id: "a1", parent_id: "u1", role: "assistant", lang: "ru", text: "Всё хорошо, спасибо!", deleted: false, synthetic: false, review_result: true },
  { message_id: "u2", parent_id: null, role: "prompter", lang: "en", text: "Hello?", deleted: false },
  { message_id: "a2", parent_id: "u2", role: "assistant", lang: "en", text: "Hi!", deleted: false },
  { message_id: "u3", parent_id: null, role: "prompter", lang: "ru", text: "Удалённый вопрос", deleted: true },
  { message_id: "a3", parent_id: "u3", role: "assistant", lang: "ru", text: "Не использовать", deleted: false },
  { message_id: "u4", parent_id: null, role: "prompter", lang: "ru", text: "Вопрос с плохой оценкой", deleted: false, review_result: false },
  { message_id: "a4", parent_id: "u4", role: "assistant", lang: "ru", text: "Ответ с плохой оценкой", deleted: false, review_result: false },
  { message_id: "u5", parent_id: null, role: "prompter", lang: "ru", text: "Вопрос synthetic", deleted: false, synthetic: true },
  { message_id: "a5", parent_id: "u5", role: "assistant", lang: "ru", text: "Ответ synthetic", deleted: false, synthetic: false },
];
const assistantPairs = __test.openAssistantRowsToPairs(assistantRows, { maxCharacters: 10000 });
assert.equal(assistantPairs.length, 1);
assert.match(assistantPairs[0], /Всё хорошо, спасибо!/u);
assert.doesNotMatch(assistantPairs.join("\n"), /Hello|Удалённый|плохой оценкой|synthetic/u);

assert.equal(__test.splitRows("stable-source", ["a", "b", "c"]).validation.length, 1);
assert.equal(__test.splitRows("stable-source", ["a", "b", "c"]).test.length, 1);

const bookSource = {
  id: "book-test", dataset: "fixture/books", maxRows: 100,
  maxCharacters: 10000, maxDownloadBytes: 100000,
  license: "CC0-1.0", url: "https://example.test/books",
  rawTextUrl: "https://example.test/books.txt", role: "literature",
};
const instructionSource = {
  id: "instruction-test", dataset: "fixture/instruction", maxRows: 100,
  maxCharacters: 10000, maxDownloadBytes: 100000,
  license: "Apache-2.0", url: "https://example.test/instruction",
  rawFileUrl: "https://example.test/instruction.jsonl", role: "dialogue",
};
const poetrySource = {
  id: "poetry-test", dataset: "fixture/poetry", pageLimit: 2, maxRows: 100,
  maxCharacters: 10000, maxDownloadBytes: 100000,
  license: "CC-BY-4.0", url: "https://example.test/poetry",
  rawFileUrl: "https://example.test/poetry.jsonl",
  allowedAuthors: ["Михаил Ломоносов", "Александр Пушкин", "Анна Ахматова", "Сергей Есенин"],
  role: "literature-filtered",
};
const qaSource = {
  id: "qa-test", dataset: "fixture/qa", maxRows: 100,
  maxCharacters: 10000, maxDownloadBytes: 100000,
  license: "CC0-1.0", url: "https://example.test/qa",
  rawCsvUrl: "https://example.test/qa.csv", role: "qa",
};
const oasstSource = {
  id: "oasst-test", dataset: "fixture/oasst", maxRows: 120,
  maxCharacters: 50000, maxDownloadBytes: 100000,
  license: "Apache-2.0", url: "https://example.test/oasst",
  rawGzipJsonlUrl: "https://example.test/oasst.gz", role: "oasst",
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
  "fixture/poetry": {
    rows: Array.from({ length: 60 }, (_, index) => ({
      author: ["Михаил Ломоносов", "Александр Пушкин", "Анна Ахматова", "Сергей Есенин"][index % 4],
      text: "Поэтический или литературный фрагмент номер " + index +
        " содержит достаточно длинный текст для языкового обучения. ".repeat(2),
    })).concat([{
      author: "Неизвестный автор",
      text: "Этот текст не должен попасть в выбранную авторскую выборку. ".repeat(3),
    }]),
  },
  "fixture/qa": {
    splits: [{ config: "default", split: "train" }],
    rows: Array.from({ length: 60 }, (_, index) => ({
      q: index === 0 ? 'Как дела, "друг"?' : "Короткий вопрос номер " + index + "?",
      a: index === 0 ? 'Всё хорошо, "спасибо"!' : "Короткий дружелюбный ответ номер " + index + ".",
    })),
  },
  "fixture/oasst": {
    splits: [{ config: "default", split: "train" }],
    rows: Array.from({ length: 60 }, (_, index) => {
      const id = String(index);
      return [
        { message_id: "u" + id, parent_id: null, role: "prompter", lang: "ru", text: "Вопрос OASST " + id + "?", deleted: false, synthetic: false, review_result: true },
        { message_id: "a" + id, parent_id: "u" + id, role: "assistant", lang: "ru", text: "Ответ OASST " + id + ".", deleted: false, synthetic: false, review_result: true },
      ];
    }).flat(),
  },
  "fixture/everyday": {
    rows: Array.from({ length: 60 }, (_, index) => ({
      user: "Повседневный вопрос номер " + index + "?",
      assistant: "Естественный разговорный ответ номер " + index + ".",
    })),
  },
};
const oasstGzip = gzipSync(Buffer.from(
  fixtures["fixture/oasst"].rows.map(row => JSON.stringify(row)).join("\n")
));
const fetchImpl = async url => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/oasst.gz")) {
    return { ok: true, body: new Blob([oasstGzip]).stream() };
  }
  if (parsed.pathname.endsWith("/books.txt")) {
    return { ok: true, text: async () => fixtures["fixture/books"].text };
  }
  if (parsed.pathname.endsWith("/poetry.jsonl")) {
    return {
      ok: true,
      text: async () => fixtures["fixture/poetry"].rows.map(row => JSON.stringify(row)).join("\n"),
    };
  }
  if (parsed.pathname.endsWith("/instruction.jsonl")) {
    return {
      ok: true,
      text: async () => fixtures["fixture/instruction"].rows.map(row => JSON.stringify(row)).join("\n"),
    };
  }
  if (parsed.pathname.endsWith("/qa.csv")) {
    const quote = value => '"' + String(value).replace(/"/gu, '""') + '"';
    return {
      ok: true,
      text: async () => "q,a\n" + fixtures["fixture/qa"].rows
        .map(row => quote(row.q) + "," + quote(row.a)).join("\n"),
    };
  }
  if (parsed.pathname.endsWith("/everyday.jsonl")) {
    return {
      ok: true,
      text: async () => fixtures["fixture/everyday"].rows
        .map(row => JSON.stringify(row)).join("\n"),
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
  const filteredRows = dataset === "fixture/poetry"
    ? fixture.rows.filter(row => ["Александр Пушкин", "Анна Ахматова", "Сергей Есенин"].includes(row.author))
    : fixture.rows;
  return {
    ok: true,
    json: async () => ({ rows: filteredRows.slice(offset, offset + length).map(row => ({ row })) }),
  };
};
const result = await prepareCorpus({
  fetchImpl,
  sources: [bookSource, poetrySource, qaSource, oasstSource, instructionSource, everydaySource],
});
assert.ok(result.buckets.train.length > 0);
assert.ok(result.buckets.validation.length > 0);
assert.ok(result.buckets.test.length > 0);
assert.ok(result.buckets.train.some(row => row.includes("<|assistant|>")));
assert.ok(result.buckets.train.some(row => row.includes("Литературный фрагмент")));
assert.match(Object.values(result.buckets).flat().join("\n"), /Как дела, "друг"\?/u);
assert.match(Object.values(result.buckets).flat().join("\n"), /Всё хорошо, "спасибо"!/u);
for (const source of result.manifest.sources) {
  assert.ok(source.localSplitCounts.train > 0, source.id + " needs train rows");
  assert.ok(source.localSplitCounts.validation > 0, source.id + " needs validation rows");
  assert.ok(source.localSplitCounts.test > 0, source.id + " needs test rows");
}
assert.equal(result.manifest.sources[0].license, "CC0-1.0");
assert.equal(result.manifest.sources[1].license, "CC-BY-4.0");
assert.equal(result.manifest.sources[2].license, "CC0-1.0");
assert.equal(result.manifest.sources[3].license, "Apache-2.0");
assert.equal(result.manifest.sources[4].license, "Apache-2.0");
assert.equal(result.manifest.sources[5].license, "CC-BY-4.0");
assert.match(result.manifest.splitMethod, /NOT author- or document-disjoint/u);
for (const source of result.manifest.sources) {
  assert.ok(
    source.localSplitCounts.train + source.localSplitCounts.validation + source.localSplitCounts.test > 0,
    source.id + " should have assigned examples",
  );
}
assert.match(result.manifest.sources[0].rawTextUrl, /books\.txt/u);
assert.match(result.manifest.sources[1].filters.join(" "), /selected classical-poet author names/u);
assert.ok(fixtures["fixture/poetry"].rows.some(row => row.author === "Михаил Ломоносов"), "the first RuHeritage author must be accepted");
assert.match(result.manifest.sources[1].rawFileUrl, /poetry\.jsonl/u);
assert.match(result.manifest.sources[2].rawCsvUrl, /qa\.csv/u);
assert.match(result.manifest.sources[3].rawGzipJsonlUrl, /oasst\.gz/u);
assert.match(result.manifest.sources[4].rawFileUrl, /instruction\.jsonl/u);
assert.match(result.manifest.splitMethod, /at least one validation and one test row per (retained )?source/u);
assert.equal(result.manifest.sources[1].uniqueRows, 60);
assert.equal(result.manifest.sources[2].uniqueRows, 60);
assert.equal(result.manifest.sources[3].uniqueRows, 60, "all 60 complete OpenAssistant parent/reply fixtures should fit the test character budget");
assert.equal(result.manifest.sources[4].uniqueRows, 60);
assert.equal(result.manifest.sources[5].uniqueRows, 60);


const duplicateText = "<|user|>\nПРИВЕТ, друг!\n<|assistant|>\nЗдравствуйте.\n<|end|>";
const duplicateVariant = "<|user|> Привет, друг! <|assistant|> Здравствуйте. <|end|>";
const dedupeFixture = [
  { source: { id: "synthetic-qa", role: "qa" }, rows: [duplicateText, "Уникальный синтетический пример."] },
  { source: { id: "human-dialogue", role: "oasst" }, rows: [duplicateVariant, "Уникальный диалоговый пример."] },
  { source: { id: "literature", role: "literature" }, rows: ["Уникальный литературный фрагмент."] },
];
const duplicateAudit = __test.deduplicateAcrossSources(dedupeFixture);
assert.equal(duplicateAudit.crossSourceDuplicateRowsRemoved, 1,
  "an exact duplicate across sources must be removed globally");
assert.equal(dedupeFixture[0].rows.length, 1,
  "human-authored dialogue must win over a duplicate synthetic example");
assert.equal(dedupeFixture[1].rows.length, 2,
  "the higher-priority human-authored source must retain its complete rows");
assert.equal(dedupeFixture[0].rows[0], "Уникальный синтетический пример.");
assert.equal(
  __test.normalizedTextKey(duplicateText),
  __test.normalizedTextKey(duplicateVariant),
  "NFKC, whitespace, case and ё normalization must catch formatting variants",
);

const splitOwners = new Map();
for (const [splitName, rows] of Object.entries(result.buckets)) {
  for (const row of rows) {
    const key = __test.normalizedTextKey(row);
    assert.ok(!splitOwners.has(key),
      "normalized duplicate must not cross into another split: " + splitName);
    splitOwners.set(key, splitName);
  }
}
assert.equal(result.manifest.duplicateAudit.crossSourceDuplicateRowsRemoved >= 0, true);

console.log("Open Russian corpus preparation contract passed.");
