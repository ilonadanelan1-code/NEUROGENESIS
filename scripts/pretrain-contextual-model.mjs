import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
globalThis.window = globalThis;

await import("../knowledge.js");
await import("../semantic-core.js");
await import("../contextual-attention.js");
await import("../phrase-composition.js");

const subjects = [
  "исследователь", "студент", "учёный", "инженер", "программист",
  "робот", "алгоритм", "датчик", "компьютер", "эксперт"
];
const patterns = [
  { verb: "изучает", objects: ["язык", "контекст"], adverb: "внимательно" },
  { verb: "проверяет", objects: ["гипотезу", "результат"], adverb: "тщательно" },
  { verb: "обрабатывает", objects: ["данные", "информацию"], adverb: "быстро" },
  { verb: "сохраняет", objects: ["сообщение", "событие"], adverb: "надёжно" },
  { verb: "получает", objects: ["сигнал", "энергию"], adverb: "регулярно" },
  { verb: "передаёт", objects: ["данные", "сообщение"], adverb: "точно" },
  { verb: "измеряет", objects: ["температуру", "давление"], adverb: "аккуратно" },
  { verb: "анализирует", objects: ["структуру", "причину"], adverb: "подробно" }
];
const corpus = [];
for (const subject of subjects) {
  for (const pattern of patterns) {
    for (const object of pattern.objects) {
      corpus.push(subject[0].toLocaleUpperCase("ru-RU") + subject.slice(1) +
        " " + pattern.verb + " " + object + " " + pattern.adverb + ".");
    }
  }
}

const unique = [...new Set(corpus)].slice(0, 160);
if (unique.length < 120 || unique.length > 160) {
  throw new Error(`Expected 120–160 unique sentences, received ${unique.length}.`);
}

const contextual = globalThis.NGContextualModel.create({
  dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: 9173
});
const contextualReport = contextual.train(unique, {
  epochs: 80,
  learningRate: 0.025,
  patience: 20,
  splitSeed: 9173,
  shuffleExamples: true,
  shuffleSeed: 2718
});
if (!contextualReport.evaluationIsolated ||
    !contextualReport.validationExamples ||
    !contextualReport.testExamples ||
    contextualReport.splitFallback) {
  throw new Error("Contextual pretraining did not produce an isolated validation/test split.");
}

const phrase = globalThis.NGPhraseCompositionModel.create({ dimension: 12, seed: 24081 });
let phraseReport = null;
let phraseError = null;
try {
  phraseReport = phrase.train(
    unique,
    contextual,
    globalThis.NGSemanticCore,
    globalThis.NGKnowledge,
    { epochs: 35, learningRate: 0.045 }
  );
} catch (error) {
  phraseError = String(error && error.message || error);
}

const bundle = {
  schema: "NEUROGENESIS_PRETRAINED_CONTEXTUAL_V1",
  bundleVersion: 1,
  modelVersion: "0.58.106",
  corpus: unique,
  provenance: {
    kind: "original_synthetic_russian_training_sentences",
    authoring: "created for NEUROGENESIS pretraining",
    thirdPartyCorpusRedistributed: false,
    note: "This small starter checkpoint is a local experimental model, not a general-purpose Russian language model."
  },
  contextualReport,
  phraseReport,
  phraseError,
  contextualState: contextual.exportState(),
  phraseState: phrase.exportState(),
  status: {
    contextual: contextual.status(),
    phrase: phrase.status()
  }
};
await fs.writeFile(
  path.join(root, "contextual-pretrained.json"),
  JSON.stringify(bundle),
  "utf8"
);
await fs.mkdir(path.join(root, "benchmark-reports"), { recursive: true });
await fs.writeFile(
  path.join(root, "benchmark-reports", "contextual-pretraining-v1.json"),
  JSON.stringify({
    schema: bundle.schema,
    provenance: bundle.provenance,
    corpusRows: unique.length,
    contextualReport,
    phraseReport,
    phraseError,
    status: bundle.status
  }, null, 2),
  "utf8"
);
console.log(JSON.stringify({
  corpusRows: unique.length,
  contextualReport,
  phraseReport,
  phraseError,
  checkpointBytes: (await fs.stat(path.join(root, "contextual-pretrained.json"))).size,
  status: bundle.status
}, null, 2));
