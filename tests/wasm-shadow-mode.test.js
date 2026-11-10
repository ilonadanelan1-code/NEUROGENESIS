"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const adapter = fs.readFileSync("neuro-wasm-adapter.js", "utf8");
const experience = fs.readFileSync("experience-quality.js", "utf8");
const benchmark = fs.readFileSync("experience-benchmark.js", "utf8");
const contrastive = fs.readFileSync("contrastive-benchmark.js", "utf8");
const disposableSession = fs.readFileSync("disposable-experiment-session.js", "utf8");
const disposableUi = fs.readFileSync("disposable-experiment-ui.js", "utf8");
const version = html.match(/DIGITAL ORGANISM · ([0-9.]+)/u)?.[1];

assert.equal(version, "0.58.49", "the isolated contrastive-trial release must have a distinct asset version");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gu)].map(match => match[1]);
const normalized = scripts.map(ref => ref.split("?")[0].replace(/^\.\//u, ""));
assert.equal(normalized.filter(path => path === "neuro-wasm-adapter.js").length, 1,
  "the WASM adapter must be loaded exactly once");
assert.ok(normalized.indexOf("activation.js") < normalized.indexOf("neuro-wasm-adapter.js"));
assert.ok(normalized.indexOf("neuro-wasm-adapter.js") < normalized.indexOf("experience-quality.js"),
  "the experience manager must load after the WASM adapter");
assert.ok(normalized.indexOf("experience-quality.js") < normalized.indexOf("experience-benchmark.js"),
  "the benchmark must load after the episode manager");
assert.ok(normalized.indexOf("experience-benchmark.js") < normalized.indexOf("contrastive-benchmark.js"));
assert.ok(normalized.indexOf("contrastive-benchmark.js") < normalized.indexOf("app.js"),
  "the contrastive benchmark must exist before app startup");
assert.ok(normalized.indexOf("app.js") < normalized.indexOf("disposable-experiment-session.js"));
assert.ok(normalized.indexOf("disposable-experiment-session.js") < normalized.indexOf("disposable-experiment-ui.js"));
assert.ok(normalized.indexOf("disposable-experiment-ui.js") < normalized.indexOf("knowledge.js"));
assert.ok(normalized.indexOf("experience-quality.js") < normalized.indexOf("app.js"),
  "the experience manager must exist before app startup");
assert.ok(normalized.indexOf("neuro-wasm-adapter.js") < normalized.indexOf("app.js"),
  "the adapter must exist before the app starts");
assert.ok(normalized.indexOf("app.js") < normalized.indexOf("knowledge.js"));
assert.equal(normalized.at(-1), "memory.js");
for (const ref of scripts) {
  assert.ok(ref.includes("?v=" + version), "every script must use the current cache version: " + ref);
}
assert.ok(html.includes('<link rel="stylesheet" href="./styles.css?v=' + version + '">'),
  "the stylesheet must use the same cache version as the app scripts");

assert.match(adapter, /function createBrainFromSnapshot\(snapshot\)/u);
assert.match(adapter, /function createDisposableExperiment\(snapshot\)/u);
assert.match(adapter, /function createExperiment\(options = \{\}\)/u);
assert.match(adapter, /settings\.resetState === true/u);
assert.match(disposableSession, /function runContrastiveTrial\(options = \{\}\)/u);
assert.match(disposableSession, /isolation-contract-violation/u);
assert.match(disposableUi, /wasmCreateDisposableExperiment\(options\)/u);
assert.match(disposableUi, /function snapshotSignature\(snapshot\)/u);
assert.match(disposableUi, /proposalBecameStale/u);
assert.match(disposableUi, /function handleSelectionChange\(\)/u);
assert.match(disposableUi, /if \(!refresh\(\) \|\| !latestProposal \|\| !latestReport\) return/u);
assert.match(html, /id="wasm-experiment-run"/u);
assert.match(html, /id="wasm-experiment-export"/u);
assert.match(adapter, /policy: "manual-review-only"/u);
assert.match(app, /wasmCreateDisposableExperiment\(options = \{\}\)/u);
assert.match(app, /wasmSourceSnapshot\(\)[\s\S]*?return wasmShadowSnapshot\(\)/u);
assert.match(disposableUi, /wasmSourceSnapshot\(\)/u);
assert.match(app, /NGDisposableExperimentUI\.refresh\(\)/u);
assert.match(adapter, /function createShadowController\(options = \{\}\)/u);
assert.match(adapter, /state = "unavailable"/u);
assert.match(adapter, /const previous = brain;[\s\S]*?brain = candidate;[\s\S]*?if \(previous\) previous\.dispose\(\)/u,
  "snapshot replacement must remain atomic");
assert.match(adapter, /authority: "javascript"/u,
  "the adapter must explicitly retain JavaScript as the authoritative runtime");
assert.match(adapter, /function learn\(learningRate = 0\.05, reward = 1, weightDecay = 0\)/u);
assert.match(adapter, /function learnedWeights\(\)/u);
assert.match(adapter, /function restoreLearnedWeights\(rows\)/u);
assert.match(experience, /function beginEpisode\(label = ""\)/u);
assert.match(experience, /function observeStep\(\)/u);
assert.match(experience, /function evaluate\(reward, learningRate = 0\.05, weightDecay = 0\)/u);
assert.match(experience, /no-eligible-traces/u);
assert.match(experience, /changedEligibleSynapses/u);
assert.match(experience, /changedNonEligibleSynapses/u);
assert.match(benchmark, /function run\(options = \{\}\)/u);
assert.match(benchmark, /learnFromReward\(0\.25, reward, 0\)/u);
assert.match(benchmark, /positiveRewardIncreasesResponse/u);
assert.match(benchmark, /negativeRewardDecreasesResponse/u);
assert.match(benchmark, /neutralRewardPreservesWeight/u);
assert.match(benchmark, /function runMultiPattern\(runtime\)/u);
assert.match(benchmark, /function runPatternOrder\(runtime, sequence\)/u);
assert.match(benchmark, /firstAssociationSurvivesSecondEpisode/u);
assert.match(benchmark, /crossAssociationsRemainUnchanged/u);
assert.match(benchmark, /function trainDensePattern\(fixture, label\)/u);
assert.match(benchmark, /function runSharedPathInterference\(runtime\)/u);
assert.match(benchmark, /positiveRewardStrengthensOffTargetPaths/u);
assert.match(benchmark, /nonTargetOutputsRemainActive/u);
assert.match(contrastive, /function trainEpisode\(fixture, label, repetition\)/u);
assert.match(contrastive, /learnContrastiveReward\(LEARNING_RATE, input, target, other\)/u);
assert.match(contrastive, /bothCrossWeightsDecrease/u);
assert.match(adapter, /function learnContrastiveReward\(learningRate = 0\.05, inputSourceId, positiveSourceId, negativeSourceId\)/u);
assert.match(app, /wasmLearnContrastiveReward\(learningRate, inputNeuronId, positiveNeuronId, negativeNeuronId\)/u);

assert.match(app, /report\.sharedPathInterference\.orders\.AB/u);
assert.match(html, /Проверить контрастное обучение и конкуренцию/u);
assert.match(app, /report\.multiPattern\.orders\.AB/u);
assert.match(app, /report\.multiPattern\.orders\.BA/u);
assert.match(html, /Проверить контрастное обучение и конкуренцию/u);

assert.match(app, /function wasmShadowSnapshot\(\)/u);
assert.match(app, /function syncWasmShadow\(\)/u);
assert.match(app, /function startWasmShadow\(\)/u);
assert.match(app, /wasmShadow\.stimulate\(id, strength\)/u);
assert.match(app, /stepWasmShadow\(dt\)/u);
assert.match(app, /wasmShadowStepElapsed < 100/u,
  "shadow computation must be throttled to at most 10 steps per second");
assert.match(app, /wasmShadow\.step\(elapsed \/ 1000\)/u);
assert.match(app, /if\(drag&&drag\.kind==="node"\)syncWasmShadow\(\)/u,
  "node movement must be mirrored at gesture completion, not every pointer move");
assert.match(app, /wasmDiagnostics\(\)/u,
  "the browser must expose shadow backend diagnostics");
assert.match(app, /wasmLearn\(learningRate = 0\.05, reward = 1, weightDecay = 0\)/u);
assert.match(app, /wasmLearningExport\(\)/u);
assert.match(app, /wasmLearningImport\(rows\)/u);
assert.match(app, /wasmExperienceBegin\(label = ""\)/u);
assert.match(app, /wasmExperienceEvaluate\(reward, learningRate = 0\.05, weightDecay = 0\)/u);
assert.match(app, /experienceQuality\.observeStep\(\)/u);
assert.match(app, /NGExperienceBenchmark\.run\(\)/u);
assert.match(html, /id="wasm-experience-benchmark-button"/u);
assert.match(html, /id="wasm-experience-benchmark-report"/u);
assert.match(html, /id="wasm-learn-button"/u);
assert.match(html, /id="wasm-experience-report"/u);
assert.match(html, /id="wasm-experience-status"/u);
assert.match(html, /id="wasm-episode-cancel-button"/u);
assert.match(html, /id="wasm-episode-begin-button"/u);
assert.match(html, /id="wasm-learning-export"/u);
assert.match(html, /id="wasm-learning-import"/u);
assert.match(html, /id="wasm-learning-file"/u);
assert.match(app, /wasmShadow\.learn\(/u);
assert.match(app, /NEUROGENESIS_WASM_LEARNED_WEIGHTS/u);
assert.match(app, /wasmShadow\.restoreLearnedWeights\(payload\.weights\)/u);

const frameStart = app.indexOf("  function frame(time) {");
const frameEnd = app.indexOf("\n  canvas.addEventListener", frameStart);
assert.ok(frameStart >= 0 && frameEnd > frameStart);
const frame = app.slice(frameStart, frameEnd);
assert.match(frame, /stepWasmShadow\(dt\)/u);
assert.doesNotMatch(frame, /localStorage\.setItem/u,
  "the shadow compute loop must not persist C++ state over the JS network");

console.log("NEUROGENESIS WASM shadow-mode integration contracts: passed.");
