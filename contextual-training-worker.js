/* NEUROGENESIS contextual training worker.
 * Runs CPU-heavy training away from the visible page so the graph and controls stay responsive.
 */
"use strict";

self.window = self;
importScripts(
  "./knowledge.js?v=0.58.107",
  "./semantic-core.js?v=0.58.107",
  "./contextual-attention.js?v=0.58.107",
  "./phrase-composition.js?v=0.58.107"
);

self.addEventListener("message", event => {
  const payload = event.data || {};
  if (payload.type !== "train") return;
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map(value => String(value || "").trim()).filter(Boolean).slice(0, 160)
    : [];
  if (!rows.length) {
    self.postMessage({ type: "error", message: "Добавь предложения для обучения." });
    return;
  }

  try {
    const model = self.NGContextualModel.create({
      dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: 9173
    });
    const report = model.train(rows, {
      epochs: 45,
      learningRate: 0.035,
      splitSeed: 902,
      patience: 14,
      onProgress: progress => self.postMessage({ type: "progress", ...progress })
    });

    let phraseModel = null;
    let phraseReport = null;
    let phraseError = "";
    self.postMessage({
      type: "progress",
      phase: "phrase-preparing",
      epoch: 0,
      totalEpochs: 1
    });
    if (self.NGPhraseCompositionModel) {
      try {
        phraseModel = self.NGPhraseCompositionModel.create({ dimension: 12, seed: 24081 });
        phraseReport = phraseModel.train(
          rows,
          model,
          self.NGSemanticCore,
          self.NGKnowledge,
          {
            epochs: 24,
            learningRate: 0.045,
            onProgress: progress => self.postMessage({ type: "progress", ...progress })
          }
        );
      } catch (error) {
        phraseError = String(error && error.message || error);
      }
    }

    self.postMessage({
      type: "complete",
      contextualState: model.exportState(),
      phraseState: phraseReport && phraseModel ? phraseModel.exportState() : null,
      report,
      phraseReport,
      phraseError
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error && error.message || error)
    });
  }
});
