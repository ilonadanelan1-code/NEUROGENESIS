"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const database = new Map();
const localStorage = {
  getItem(key) { return database.has(key) ? database.get(key) : null; },
  setItem(key, value) { database.set(key, String(value)); },
  removeItem(key) { database.delete(key); }
};
const window = {};
const sandbox = { window, localStorage, console, Date, Math, Set, Map, JSON };

for (const file of [
  "knowledge.js",
  "knowledge-graph.js",
  "hypothesis-lifecycle.js",
  "goals.js"
]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const knowledge = window.NGKnowledge;
const graphEngine = window.NGKnowledgeGraph.create(knowledge);
const lifecycleEngine = window.NGHypothesisLifecycle.create(knowledge);
const now = 2_000_000_000_000;

const causal = {
  ...knowledge.extractClaims("Недостаток сна приводит к усталости")[0],
  id: "claim-sleep-fatigue",
  createdAt: now - 3000
};
const supporting = {
  ...knowledge.extractClaims(
    "При недостатке сна наблюдалась усталость; контекст: после тяжёлой тренировки; время: вечером; критерий: по шкале 1–10; результат: 6/10; событие: sleep-event-01"
  )[0],
  id: "observation-sleep-fatigue-01",
  createdAt: now - 2000
};
const counter = {
  ...knowledge.extractClaims(
    "При недостатке сна не наблюдалась усталость; контекст: обычный день; время: утром; критерий: по шкале 1–10; результат: 2/10; событие: sleep-event-02"
  )[0],
  id: "observation-sleep-fatigue-02",
  createdAt: now - 1000
};

assert.equal(causal.kind, "causal");
assert.equal(supporting.kind, "observation");
assert.equal(counter.kind, "observation");
assert.equal(counter.polarity, false);
assert.equal(supporting.observationCase.eventRef, "sleep-event-01");
assert.equal(counter.observationCase.eventRef, "sleep-event-02");
assert.equal(knowledge.sanitizeClaims([causal, supporting, counter]).length, 3,
  "all source claims must pass the same knowledge sanitizer used by downstream modules");

const memories = [{
  id: "memory-sleep-study",
  text: "Три записи о сне и усталости",
  createdAt: now - 3000,
  claims: [causal, supporting, counter]
}];
const sourceSnapshot = JSON.stringify(memories);

const graph = graphEngine.build(memories);
assert.equal(graph.stats.memories, 1);
assert.equal(graph.stats.claims, 3);
assert.equal(graph.stats.observations, 2);
assert.equal(graph.stats.events, 2,
  "two explicit event references must become two separate graph events");
assert.equal(graph.stats.linkedObservations, 2);
assert.equal(graph.stats.unlinkedObservations, 0);
assert.equal(JSON.stringify(memories), sourceSnapshot,
  "graph projection must not mutate source memories");

const openInquiry = {
  id: "Q701",
  kind: "contrast_observations",
  edgeSubject: causal.subject,
  edgeObject: causal.object,
  question: "Сопоставить два наблюдения о сне и усталости",
  status: "open",
  sourceClaimIds: [causal.id],
  lastAskedAt: now - 500,
  createdAt: now - 4000,
  updatedAt: now - 500
};
const goalSnapshot = window.NGGoals.reconcile({
  inquiries: [openInquiry],
  memories,
  focus: { item: { id: "Q701" }, score: 0.8 },
  now
});
assert.equal(goalSnapshot.total, 1);
const goal = window.NGGoals.list()[0];
assert.equal(goal.inquiryId, "Q701");
assert.equal(goal.kind, "contrast_observations");
assert.equal(goal.status, "waiting_user");
assert.equal(goal.observationCount, 2);
assert.equal(goal.eventCount, 2);
assert.equal(goal.unknownEventCount, 0);
assert.equal(goal.completeObservationCount, 2);
assert.equal(goal.incompleteObservationCount, 0);
assert.equal(goal.metadataCoverage, 100);
assert.equal(goal.numericOutcomeMissingCount, 0);
assert.deepEqual(
  [...goal.evidenceClaimIds].sort(),
  [causal.id, supporting.id, counter.id].sort(),
  "the goal layer must receive the exact causal source and both observation cards"
);
assert.deepEqual([...goal.evidenceMemoryIds], ["memory-sleep-study"]);
assert.equal(JSON.stringify(memories), sourceSnapshot,
  "goal reconciliation must not edit the evidence cards it summarizes");

const meta = {
  version: 1,
  type: "derived_hypotheses",
  createdAt: now - 3000,
  conclusions: [{
    subject: "Причины",
    object: "Усталость",
    paths: [[{
      id: causal.id,
      subject: causal.subject,
      object: causal.object,
      evidence: causal.evidence
    }]]
  }],
  reviews: [],
  modelHistory: []
};
function review(claim, kind, at) {
  return {
    claimId: claim.id,
    kind,
    phase: "subsequent",
    subject: claim.subject,
    object: claim.object,
    edgeSubject: causal.subject,
    edgeObject: causal.object,
    eventRef: claim.observationCase.eventRef,
    at,
    evidence: claim.evidence
  };
}

const supportMeta = {
  ...meta,
  reviews: [review(supporting, "supporting_observation", now - 100)]
};
const pending = lifecycleEngine.reconcile(
  supportMeta, [causal, supporting], [], [openInquiry], now
);
const pendingLifecycle = pending.meta.conclusions[0].lifecycle;
assert.equal(pendingLifecycle.state, "under_review",
  "a supporting observation must not silently close an unanswered research inquiry");
assert.equal(pendingLifecycle.routeReviews[0].state, "under_review");
assert.deepEqual(Array.from(pendingLifecycle.supportingClaimIds), [supporting.id]);

const answeredInquiry = {
  ...openInquiry,
  status: "answered",
  assessment: "observations_reported_unverified",
  answeredAt: now + 100,
  updatedAt: now + 100
};
const supported = lifecycleEngine.reconcile(
  pending.meta, [causal, supporting], [], [answeredInquiry], now + 200
);
assert.equal(supported.meta.conclusions[0].lifecycle.state, "provisionally_supported",
  "after the inquiry is answered, a matching observation may support the hypothesis provisionally");
assert.ok(supported.meta.conclusions[0].lifecycle.events.some(event =>
  event.kind === "evidence_added" && event.claimId === supporting.id
));

const challengedMeta = {
  ...supported.meta,
  reviews: [
    ...supported.meta.reviews,
    review(counter, "counterexample", now + 300)
  ]
};
const challenged = lifecycleEngine.reconcile(
  challengedMeta, [causal, supporting, counter], [], [answeredInquiry], now + 400
);
const challengedLifecycle = challenged.meta.conclusions[0].lifecycle;
assert.equal(challengedLifecycle.state, "challenged",
  "a matched negative observation must challenge the route rather than be absorbed as support");
assert.deepEqual(Array.from(challengedLifecycle.challengingClaimIds), [counter.id]);
assert.equal(challengedLifecycle.routeReviews[0].state, "challenged");
assert.ok(challengedLifecycle.events.some(event =>
  event.kind === "evidence_added" && event.claimId === counter.id));

const persisted = database.get("neurogenesis.goals.v1");
assert.ok(persisted, "the integrated research goal must be persisted");
const restoredWindow = {};
const restoredSandbox = { window: restoredWindow, localStorage, console, Date, Math, Set, Map, JSON };
vm.runInNewContext(fs.readFileSync("goals.js", "utf8"), restoredSandbox, { filename: "goals.js" });
assert.equal(restoredWindow.NGGoals.list().length, 1,
  "the integrated goal must survive a fresh module initialization");
assert.equal(restoredWindow.NGGoals.list()[0].evidenceClaimIds.length, 3);

console.log(
  "NEUROGENESIS research pipeline integration: shared claims, graph events, " +
  "goal evidence quality, pending inquiry, provisional support, counter-evidence and persistence passed."
);
