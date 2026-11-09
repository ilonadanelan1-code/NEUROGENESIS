"use strict";
const assert = require("node:assert/strict");
require("../experience-quality.js");

const factory = globalThis.NGExperienceQuality;
assert.equal(typeof factory?.create, "function");

function fixture(historyLimit = 20) {
  const state = {
    neurons: [
      { id: "n-a", activation: 0.7 },
      { id: "n-b", activation: 0.4 }
    ],
    synapses: [
      { from: "n-a", to: "n-b", weight: 0.5, signal: 0.2, eligibility: 0 },
      { from: "n-b", to: "n-a", weight: 0.8, signal: 0.1, eligibility: 0 }
    ]
  };
  let resetCalls = 0;
  let rewardCalls = 0;
  let tick = 100;
  const manager = factory.create({
    getSnapshot: () => state,
    resetEligibility: () => {
      resetCalls++;
      for (const edge of state.synapses) edge.eligibility = 0;
      return true;
    },
    applyReward: (reward, rate, decay) => {
      rewardCalls++;
      let changed = 0;
      for (const edge of state.synapses) {
        const next = Math.max(0, Math.min(1,
          edge.weight + rate * reward * edge.eligibility - decay * edge.weight));
        if (Math.abs(next - edge.weight) > 1e-6) changed++;
        edge.weight = next;
        edge.eligibility = 0;
      }
      return changed;
    },
    historyLimit,
    now: () => tick++
  });
  return { manager, state, get resetCalls() { return resetCalls; }, get rewardCalls() { return rewardCalls; } };
}

{
  const f = fixture();
  const started = f.manager.beginEpisode("Первый опыт");
  assert.equal(started.ok, true);
  assert.equal(started.episode.id, "episode-0001");
  assert.equal(started.episode.status, "open");
  assert.equal(f.resetCalls, 1);
  assert.equal(f.manager.beginEpisode("не должен заменить открытый").code, "episode-already-open");
  assert.equal(f.resetCalls, 1, "a duplicate begin must not silently discard the open episode");

  f.state.synapses[0].eligibility = 0.8;
  f.state.synapses[1].eligibility = 0.1;
  assert.equal(f.manager.observeStep().ok, true);
  f.state.synapses[0].eligibility = 0.6;
  f.state.synapses[1].eligibility = 0.2;
  assert.equal(f.manager.observeStep().ok, true);
  const evaluated = f.manager.evaluate(1, 0.5, 0);
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.code, "episode-evaluated");
  assert.equal(evaluated.report.steps, 2);
  assert.equal(evaluated.report.eligibleSynapsesBeforeReward, 2);
  assert.ok(Math.abs(evaluated.report.traceMassBeforeReward - 0.8) < 1e-9);
  assert.equal(evaluated.report.changedSynapses, 2);
  assert.equal(evaluated.report.changedEligibleSynapses, 2);
  assert.equal(evaluated.report.changedNonEligibleSynapses, 0);
  assert.equal(evaluated.report.applicationReportedUpdates, 2);
  assert.equal(evaluated.report.traceConsumed, true);
  assert.equal(f.manager.status().state, "evaluated");
  assert.equal(f.rewardCalls, 1);
  assert.equal(f.manager.evaluate(1, 0.5, 0).code, "no-open-episode");
  assert.equal(f.rewardCalls, 1, "a closed episode must never be rewarded twice");
}

{
  const f = fixture();
  f.manager.beginEpisode("Пустой эпизод");
  const empty = f.manager.evaluate(1, 0.5, 0.02);
  assert.equal(empty.code, "empty-episode");
  assert.equal(f.rewardCalls, 0, "an episode without observed steps must not apply reward or decay");
  assert.equal(f.manager.status().state, "empty-episode");
}

{
  const f = fixture();
  f.manager.beginEpisode("Без подходящих следов");
  f.manager.observeStep();
  const result = f.manager.evaluate(-1, 0.5, 0.05);
  assert.equal(result.code, "no-eligible-traces");
  assert.equal(f.rewardCalls, 0, "weight decay must not run when no synapse is eligible");
  assert.equal(f.state.synapses[0].weight, 0.5);
  assert.equal(f.state.synapses[1].weight, 0.8);
}

{
  const f = fixture();
  f.manager.beginEpisode("Отрицательная оценка");
  f.state.synapses[0].eligibility = 0.5;
  f.manager.observeStep();
  const before = f.state.synapses[0].weight;
  const result = f.manager.evaluate(-1, 0.2, 0);
  assert.equal(result.ok, true);
  assert.ok(f.state.synapses[0].weight < before);
  assert.equal(result.report.reward, -1);
}

{
  const f = fixture();
  f.manager.beginEpisode("Нейтральная оценка и регуляризация");
  f.state.synapses[0].eligibility = 0.5;
  f.manager.observeStep();
  const result = f.manager.evaluate(0, 0.2, 0.1);
  assert.equal(result.ok, true);
  assert.equal(result.report.changedEligibleSynapses, 1);
  assert.equal(result.report.changedNonEligibleSynapses, 1,
    "the report must distinguish global weight-decay changes from eligible connections");
  assert.equal(result.report.traceConsumed, true);
}

{
  const f = fixture();
  f.manager.beginEpisode("Отмена");
  f.state.synapses[0].eligibility = 0.7;
  f.manager.observeStep();
  const cancelled = f.manager.cancel("user-reset");
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.report.status, "cancelled");
  assert.equal(f.state.synapses[0].eligibility, 0);
  assert.equal(f.rewardCalls, 0);
  assert.equal(f.manager.cancel().code, "no-open-episode");
}

{
  const f = fixture(2);
  for (let i = 0; i < 3; i++) {
    f.manager.beginEpisode("history-" + i);
    f.manager.observeStep();
    f.manager.cancel("test");
  }
  const history = f.manager.history();
  assert.equal(history.length, 2, "episode history must remain bounded");
  assert.equal(history[0].label, "history-1");
  assert.equal(history[1].label, "history-2");
  history[0].label = "mutated";
  assert.equal(f.manager.history()[0].label, "history-1",
    "history reads must not expose mutable internal reports");
}

{
  const f = fixture();
  f.manager.beginEpisode("Проверка параметров");
  const invalid = f.manager.evaluate(1.5, 0.1, 0);
  assert.equal(invalid.code, "parameters-out-of-range");
  assert.equal(f.manager.status().state, "open",
    "invalid reward parameters must leave the episode open for correction");
  assert.equal(f.rewardCalls, 0);
}

console.log("NEUROGENESIS experience episode quality: lifecycle, reward guards, metrics and bounded history passed.");
