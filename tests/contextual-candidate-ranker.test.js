"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
const sandbox = { window, Math, Map, Set, Object, Array, String, Number, RegExp };
vm.runInNewContext(fs.readFileSync("contextual-candidate-ranker.js", "utf8"), sandbox, { filename: "contextual-candidate-ranker.js" });
const api = window.NGContextualCandidateRanker;
assert.equal(api.schema, "NG_CONTEXTUAL_CANDIDATE_RANKER_V1");
const state = {
  vocabulary: ["нейрон", "датчик", "получает", "получают", "сигнал", "измеряет", "новые"],
  trainingContextExamples: [
    { target: "нейрон", context: [{ offset: 1, token: "получает", stem: "получа" }, { offset: 2, token: "сигнал", stem: "сигнал" }] },
    { target: "датчик", context: [{ offset: 1, token: "измеряет", stem: "измеря" }, { offset: 2, token: "сигнал", stem: "сигнал" }] },
    { target: "нейрон", context: [{ offset: -1, token: "новые", stem: "нов" }, { offset: 1, token: "получают", stem: "получа" }, { offset: 2, token: "сигнал", stem: "сигнал" }] }
  ]
};
const stem = token => ({ "получает": "получа", "получают": "получа", "нейроны": "нейрон" })[token] || token;
const model = {
  exportState: () => JSON.parse(JSON.stringify(state)),
  russianStem: stem,
  russianNounPlural: token => token === "нейрон" ? "нейроны" : null,
  predictMasked: (text, index) => ({
    morphologyHint: text.split(/\s+/u)[index - 1] === "новые" ? { number: "plural" } : null,
    predictions: [{ token: "нейрон", probability: 0.55 }, { token: "датчик", probability: 0.2 }]
  })
};
const ranker = api.create(model);
assert.equal(ranker.status().trainingContextExamples, 3);
const first = ranker.predictMasked("нейрон получает сигнал", 0);
const masked = ranker.predictMasked("маркер получает сигнал", 0);
assert.deepEqual(JSON.parse(JSON.stringify(first.candidates)), JSON.parse(JSON.stringify(masked.candidates)),
  "changing the hidden surface must not change candidates");
assert.equal(first.targetSurfaceUsed, false);
assert.ok(first.candidates.length > 0);
assert.equal(first.candidates[0].baseToken, "нейрон");
assert.ok(first.candidates[0].matchedContextTokens.every(row => row.token !== "нейрон"),
  "the masked target must not appear in query evidence");
const plural = ranker.predictMasked("новые нейроны получают сигнал", 1);
assert.ok(plural.candidates.some(row => row.baseToken === "нейрон" && row.surface === "нейроны"),
  "a plural agreement hint should inflect a retrieved base token");
assert.equal(plural.morphologyHint.number, "plural");
assert.equal(ranker.predictMasked("нейрон получает", 0).reason, "insufficient_context");
assert.equal(ranker.predictMasked("", 0).reason, "empty_input");
assert.throws(() => api.create({}), /exportState/u);
console.log("contextual-candidate-ranker: all tests passed");