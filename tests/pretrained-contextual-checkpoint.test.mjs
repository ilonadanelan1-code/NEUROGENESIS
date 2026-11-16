import assert from "node:assert/strict";
import fs from "node:fs/promises";

globalThis.window = globalThis;
await import("../contextual-attention.js");
await import("../phrase-composition.js");

const bundle = JSON.parse(await fs.readFile("contextual-pretrained.json", "utf8"));
assert.equal(bundle.schema, "NEUROGENESIS_PRETRAINED_CONTEXTUAL_V1");
assert.equal(bundle.corpus.length, 160, "The starter corpus must respect the mobile UI limit.");
assert.equal(new Set(bundle.corpus).size, bundle.corpus.length, "Training sentences must be unique.");
assert.equal(bundle.provenance.thirdPartyCorpusRedistributed, false);

const report = bundle.contextualReport;
assert.ok(report && report.evaluationIsolated, "Validation and test must remain sentence-disjoint.");
assert.ok(report.validationExamples > 0, "A held-out validation set is required.");
assert.ok(report.testExamples > 0, "A held-out test set is required.");
assert.ok(Number.isFinite(report.finalLoss), "Final training loss must be reported.");
assert.ok(Number.isFinite(report.validationLoss), "Validation loss must be reported.");
assert.ok(Number.isFinite(report.testLoss), "Test loss must be reported.");
assert.ok(Number.isFinite(report.testAccuracy), "Test accuracy must be reported.");
assert.ok(report.trainingSteps > 0, "The model must have performed optimizer steps.");

const model = globalThis.NGContextualModel.create({
  dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: 9173
});
const status = model.loadState(bundle.contextualState);
assert.equal(status.trained, true);
assert.equal(status.trainingSteps, report.trainingSteps);
assert.ok(status.vocabularySize >= 30, "The pre-trained vocabulary should cover the structured starter corpus.");
assert.ok(status.trainingContextExamples > 0, "The checkpoint should retain its bounded retrieval context index.");

if (bundle.phraseReport) {
  const phrase = globalThis.NGPhraseCompositionModel.create({ dimension: 12, seed: 24081 });
  const phraseStatus = phrase.loadState(bundle.phraseState);
  assert.equal(phraseStatus.trained, true);
}

console.log("Pre-trained contextual checkpoint contract passed.");
console.log(JSON.stringify({
  corpusRows: bundle.corpus.length,
  vocabularySize: status.vocabularySize,
  trainingSteps: status.trainingSteps,
  trainLoss: report.finalLoss,
  validationLoss: report.validationLoss,
  validationAccuracy: report.validationAccuracy,
  validationCoverage: report.validationCoverage,
  testLoss: report.testLoss,
  testAccuracy: report.testAccuracy,
  testCoverage: report.testCoverage,
  phraseModelTrained: Boolean(bundle.phraseReport)
}, null, 2));
