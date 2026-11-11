"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["knowledge.js", "semantic-core.js", "semantic-retrieval.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const knowledge = window.NGKnowledge, core = window.NGSemanticCore, retrieval = window.NGSemanticRetrieval;
assert.ok(retrieval && retrieval.version === 4);
assert.deepEqual(Array.from(knowledge.tokens("сердец")), ["сердц"],
  "irregular Russian genitive plural should normalize to the same stem as «сердца»");
assert.deepEqual(Array.from(knowledge.tokens("сердца")), ["сердц"],
  "the direct plural form should preserve the same semantic stem");
const memory = {
  id: "M-OCTOPUS", text: "У осьминога три сердца.",
  claims: [{ id: "C-OCTOPUS", kind: "fact", subject: "осьминог", predicate: "имеет",
    object: "три сердца", evidence: "У осьминога три сердца.", polarity: true, verification: "user_supplied" }]
};
const unrelated = {
  id: "M-WHALE", text: "У синего кита четыре камеры сердца.",
  claims: [{ id: "C-WHALE", kind: "fact", subject: "синий кит", predicate: "имеет",
    object: "четыре камеры сердца", evidence: "У синего кита четыре камеры сердца." }]
};
const sameMeaning = [
  "Сколько сердец у осьминога?",
  "У осьминога сколько сердец?",
  "Назови число сердец у осьминога."
];
const scores = sameMeaning.map(question => {
  const frame = core.analyse(question, { contextRelation: "new_topic" }, knowledge);
  return { frame, target: retrieval.scoreRecord(frame, memory, knowledge).score,
    unrelated: retrieval.scoreRecord(frame, unrelated, knowledge).score };
});
for (const row of scores) {
  assert.ok(row.target > 0.65, "the relevant source must match both subject and requested property");
  assert.ok(row.target > row.unrelated + 0.25,
    "a memory sharing only the word 'heart' must not outrank the correct entity-property pair");
}
assert.ok(Math.max(...scores.map(row => row.target)) - Math.min(...scores.map(row => row.target)) < 0.001,
  "different surface word orders with the same meaning should retrieve the same evidence");
const heldOutCases = [
  {
    name: "book chapters",
    queries: ["Сколько глав у романа?", "У романа сколько глав?", "Назови число глав у романа."],
    record: { id: "M-NOVEL", text: "В романе 24 главы.", claims: [{
      id: "C-NOVEL", kind: "fact", subject: "роман", predicate: "содержит",
      object: "24 главы", evidence: "В романе 24 главы."
    }] },
    distractor: { id: "M-COLLECTION", text: "В сборнике 10 глав.", claims: [{
      id: "C-COLLECTION", kind: "fact", subject: "сборник", predicate: "содержит",
      object: "10 глав", evidence: "В сборнике 10 глав."
    }] }
  },
  {
    name: "building floors",
    queries: ["Сколько этажей у здания?", "У здания сколько этажей?", "Назови количество этажей у здания."],
    record: { id: "M-BUILDING", text: "В здании 12 этажей.", claims: [{
      id: "C-BUILDING", kind: "fact", subject: "здание", predicate: "имеет",
      object: "12 этажей", evidence: "В здании 12 этажей."
    }] },
    distractor: { id: "M-HOUSE", text: "В частном доме 2 этажа.", claims: [{
      id: "C-HOUSE", kind: "fact", subject: "частный дом", predicate: "имеет",
      object: "2 этажа", evidence: "В частном доме 2 этажа."
    }] }
  },
  {
    name: "city population",
    queries: ["Население Таллина?", "Каково население Таллина?"],
    record: { id: "M-TALLINN", text: "Население Таллина составляет 450 тысяч человек.", claims: [{
      id: "C-TALLINN", kind: "fact", subject: "Таллин", predicate: "имеет население",
      object: "450 тысяч человек", evidence: "Население Таллина составляет 450 тысяч человек."
    }] },
    distractor: { id: "M-TARTU", text: "Население Тарту составляет 95 тысяч человек.", claims: [{
      id: "C-TARTU", kind: "fact", subject: "Тарту", predicate: "имеет население",
      object: "95 тысяч человек", evidence: "Население Тарту составляет 95 тысяч человек."
    }] }
  },
  {
    name: "tower height",
    queries: ["Какова высота Эйфелевой башни?", "Высота Эйфелевой башни?"],
    record: { id: "M-TOWER", text: "Высота Эйфелевой башни — 330 метров.", claims: [{
      id: "C-TOWER", kind: "fact", subject: "Эйфелева башня", predicate: "имеет высоту",
      object: "330 метров", evidence: "Высота Эйфелевой башни — 330 метров."
    }] },
    distractor: { id: "M-BRIDGE", text: "Высота моста — 80 метров.", claims: [{
      id: "C-BRIDGE", kind: "fact", subject: "мост", predicate: "имеет высоту",
      object: "80 метров", evidence: "Высота моста — 80 метров."
    }] }
  }
];
for (const item of heldOutCases) {
  const values = item.queries.map(question => {
    const frame = core.analyse(question, { contextRelation: "new_topic" }, knowledge);
    const target = retrieval.scoreRecord(frame, item.record, knowledge).score;
    const distractorScore = retrieval.scoreRecord(frame, item.distractor, knowledge).score;
    return { question, frame, target, distractorScore };
  });
  for (const row of values) {
    assert.ok(row.target > 0.65,
      item.name + " must be retrievable from a meaning frame: " + row.question);
    assert.ok(row.target > row.distractorScore + 0.25,
      item.name + " must distinguish the requested subject from a distractor sharing the property");
  }
  assert.ok(Math.max(...values.map(row => row.target)) - Math.min(...values.map(row => row.target)) < 0.001,
    item.name + " paraphrases must converge on the same subject/property evidence");
  const heldOutFrame = values[0].frame;
  const heldOutClaim = item.record.claims[0];
  const heldOutRecall = retrieval.rankClaims(heldOutFrame, [item.record], knowledge, [{
    id: "heldout", subject: heldOutFrame.subject.text, attribute: heldOutFrame.attribute.text
  }]);
  assert.equal(heldOutRecall.complete, true,
    item.name + " must also close a structured claim-level requirement");
  const groundedHeldOut = retrieval.parseAnswer(JSON.stringify({
    answer: heldOutClaim.evidence,
    conclusions: [{ stepId: "heldout", text: heldOutClaim.evidence,
      polarity: "positive", modality: "asserted", claimIds: [heldOutClaim.id] }],
    usedSources: [item.record.id], usedClaims: [heldOutClaim.id],
    confidence: 0.91, insufficientEvidence: false
  }), heldOutRecall.evidence, heldOutRecall);
  assert.ok(groundedHeldOut,
    item.name + " source wording must pass the independent claim-level verifier");
  const wrongHeldOutText = heldOutClaim.evidence.replace(heldOutClaim.object, item.distractor.claims[0].object);
  const wrongHeldOut = retrieval.parseAnswer(JSON.stringify({
    answer: wrongHeldOutText,
    conclusions: [{ stepId: "heldout", text: wrongHeldOutText,
      polarity: "positive", modality: "asserted", claimIds: [heldOutClaim.id] }],
    usedSources: [item.record.id], usedClaims: [heldOutClaim.id],
    confidence: 0.99, insufficientEvidence: false
  }), heldOutRecall.evidence, heldOutRecall);
  assert.equal(wrongHeldOut, null,
    item.name + " must reject a distractor value even when the subject and source ID are valid");
}


const oneDigitMemory = {
  id: "M-BUILDING-COUNT", text: "Здание имеет 2 этажа.", claims: [{
    id: "C-BUILDING-COUNT", kind: "fact", subject: "здание", predicate: "имеет",
    object: "2 этажа", evidence: "Здание имеет 2 этажа.", verification: "user_supplied"
  }]
};
const oneDigitFrame = core.analyse("Сколько этажей у здания?", { contextRelation: "new_topic" }, knowledge);
const oneDigitRecall = retrieval.rankClaims(oneDigitFrame, [oneDigitMemory], knowledge, [{
  id: "floors", subject: oneDigitFrame.subject.text, attribute: oneDigitFrame.attribute.text
}]);
assert.equal(oneDigitRecall.complete, true,
  "the one-digit source claim must close its quantity requirement");
const spelledDigitAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Здание имеет два этажа.",
  conclusions: [{ stepId: "floors", text: "Здание имеет два этажа.",
    polarity: "positive", modality: "asserted", claimIds: ["C-BUILDING-COUNT"] }],
  usedSources: ["M-BUILDING-COUNT"], usedClaims: ["C-BUILDING-COUNT"],
  confidence: 0.91, insufficientEvidence: false
}), oneDigitRecall.evidence, oneDigitRecall);
assert.ok(spelledDigitAnswer,
  "a one-digit numeral and its equivalent Russian number word must be treated as the same value");
const swappedDigitAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Здание имеет три этажа.",
  conclusions: [{ stepId: "floors", text: "Здание имеет три этажа.",
    polarity: "positive", modality: "asserted", claimIds: ["C-BUILDING-COUNT"] }],
  usedSources: ["M-BUILDING-COUNT"], usedClaims: ["C-BUILDING-COUNT"],
  confidence: 0.99, insufficientEvidence: false
}), oneDigitRecall.evidence, oneDigitRecall);
assert.equal(swappedDigitAnswer, null,
  "a one-digit value mismatch must be rejected even when subject and relation match");

const chainMemories = [
  { id: "M-TALLINN-COUNTRY", text: "Таллин находится в Эстонии.", claims: [{
    id: "C-TALLINN-COUNTRY", kind: "fact", subject: "Таллин",
    predicate: "находится в стране", object: "Эстония",
    evidence: "Таллин находится в Эстонии.", verification: "user_supplied"
  }] },
  { id: "M-ESTONIA-PRESIDENT", text: "Президент Эстонии — Алар Карис.", claims: [{
    id: "C-ESTONIA-PRESIDENT", kind: "fact", subject: "Эстония",
    predicate: "президент", object: "Алар Карис",
    evidence: "Президент Эстонии — Алар Карис.", verification: "user_supplied"
  }] },
  { id: "M-LATVIA-PRESIDENT", text: "Президент Латвии — Эдгарс Ринкевичс.", claims: [{
    id: "C-LATVIA-PRESIDENT", kind: "fact", subject: "Латвия",
    predicate: "президент", object: "Эдгарс Ринкевичс",
    evidence: "Президент Латвии — Эдгарс Ринкевичс.", verification: "user_supplied"
  }] },
  { id: "M-REFERENCE-ONLY", text: "Президент Латвии — Эдгарс Ринкевичс; в справке также упоминается Эстония.", claims: [{
    id: "C-REFERENCE-ONLY", kind: "fact", subject: "Латвия",
    predicate: "президент", object: "Эдгарс Ринкевичс",
    evidence: "Президент Латвии — Эдгарс Ринкевичс; справка также упоминает Эстонию.",
    verification: "user_supplied"
  }] },
  { id: "M-ATTRIBUTE-ONLY", text: "Эстония граничит с Латвией; в заметке упоминается президент.", claims: [{
    id: "C-ATTRIBUTE-ONLY", kind: "fact", subject: "Эстония",
    predicate: "граничит с", object: "Латвией",
    evidence: "Эстония граничит с Латвией; в заметке также упоминается президент Эстонии.",
    verification: "user_supplied"
  }] }
];
const evidencePlan = [
  { id: "country", question: "В какой стране находится Таллин?", subject: "Таллин", attribute: "страна" },
  { id: "president", question: "Кто руководит этой страной?", attribute: "президент",
    subjectFrom: { stepId: "country", field: "object" }, dependsOn: ["country"] }
];
const chainFrame = core.analyse("В какой стране находится Таллин и кто президент этой страны?",
  { contextRelation: "new_topic" }, knowledge);
const chainRecall = retrieval.rankClaims(chainFrame, chainMemories, knowledge, evidencePlan);
assert.equal(chainRecall.requirements.length, 2);
assert.equal(chainRecall.requirements[0].matched, true,
  "the first independent requirement must retrieve the city-country relation");
assert.equal(chainRecall.requirements[1].matched, true,
  "the dependent requirement must resolve its subject from the previous claim's object");
assert.equal(chainRecall.complete, true);
assert.ok(chainRecall.paths.some(path => path.claimIds.length === 2),
  "a two-step answer must retain the complete claim path");
assert.ok(chainRecall.evidence.some(item => item.id === "M-TALLINN-COUNTRY"));
assert.ok(chainRecall.evidence.some(item => item.id === "M-ESTONIA-PRESIDENT"));
assert.ok(!chainRecall.evidence.some(item => item.id === "M-LATVIA-PRESIDENT"),
  "a matching property on another country must not be joined into the chain");
assert.ok(!chainRecall.evidence.some(item => item.id === "M-REFERENCE-ONLY"),
  "an entity mentioned only in evidence text must not override the claim's explicit subject");
assert.ok(!chainRecall.evidence.some(item => item.id === "M-ATTRIBUTE-ONLY"),
  "an attribute mentioned only in evidence text must not override the claim's explicit predicate");
const chainRequest = retrieval.buildRequest("В какой стране находится Таллин и кто президент этой страны?",
  "В какой стране находится Таллин и кто президент этой страны?", chainFrame, chainRecall.evidence, chainRecall);
assert.equal(chainRequest.metadata.requiredSteps, 2);
assert.equal(chainRequest.metadata.coveredSteps, 2);
assert.match(chainRequest.messages[0].content, /связывай соседние шаги только через явно совпадающие сущности/u);

const validChainAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Таллин находится в Эстонии. Президент Эстонии — Алар Карис.",
  conclusions: [
    { stepId: "country", text: "Таллин находится в Эстонии.", polarity: "positive",
      modality: "asserted", claimIds: ["C-TALLINN-COUNTRY"] },
    { stepId: "president", text: "Президент Эстонии — Алар Карис.", polarity: "positive",
      modality: "asserted", claimIds: ["C-ESTONIA-PRESIDENT"] }
  ],
  usedSources: ["M-TALLINN-COUNTRY", "M-ESTONIA-PRESIDENT"],
  usedClaims: ["C-TALLINN-COUNTRY", "C-ESTONIA-PRESIDENT"],
  confidence: 0.93, insufficientEvidence: false
}), chainRecall.evidence, chainRecall);
assert.ok(validChainAnswer, "a complete multi-hop answer must cite one claim per step and preserve the parent path");
assert.deepEqual(Array.from(validChainAnswer.usedClaims), ["C-TALLINN-COUNTRY", "C-ESTONIA-PRESIDENT"]);
assert.equal(retrieval.parseAnswer(JSON.stringify({
  answer: "Президент Эстонии — Алар Карис.", usedSources: ["M-ESTONIA-PRESIDENT"],
  usedClaims: ["C-ESTONIA-PRESIDENT"], confidence: 0.93, insufficientEvidence: false
}), chainRecall.evidence, chainRecall), null,
"a multi-hop response without step-level conclusions must not bypass the claim verifier");

for (const question of [
  "В какой стране находится Таллин и кто президент этого государства?",
  "Назови государство, где расположен Таллин, и президента этого государства."
]) {
  const variantFrame = core.analyse(question, { contextRelation: "new_topic" }, knowledge);
  const variantRecall = retrieval.rankClaims(variantFrame, chainMemories, knowledge, evidencePlan);
  assert.equal(variantRecall.complete, true, "held-out chain paraphrases must preserve both relations");
  assert.ok(variantRecall.evidence.some(item => item.id === "M-ESTONIA-PRESIDENT"));
  assert.ok(!variantRecall.evidence.some(item => item.id === "M-LATVIA-PRESIDENT"));
}

const planetaryMemories = [
  { id: "M-MARS-MOONS", text: "У Марса два спутника.", claims: [{
    id: "C-MARS-MOONS", kind: "fact", subject: "Марс", predicate: "имеет спутники",
    object: "Фобос и Деймос", evidence: "У Марса два спутника.", verification: "user_supplied"
  }] },
  { id: "M-EARTH-MOONS", text: "У Земли один спутник.", claims: [{
    id: "C-EARTH-MOONS", kind: "fact", subject: "Земля", predicate: "имеет спутник",
    object: "Луна", evidence: "У Земли один спутник.", verification: "user_supplied"
  }] }
];
const marsFrame = core.analyse("Сколько спутников у Марса?", { contextRelation: "new_topic" }, knowledge);
const marsRecall = retrieval.rankClaims(marsFrame, planetaryMemories, knowledge, [
  { id: "moons", subject: "Марс", attribute: "спутники" }
]);
assert.equal(marsRecall.complete, true);
assert.deepEqual(Array.from(marsRecall.evidence.map(item => item.id)), ["M-MARS-MOONS"],
  "the same property on a different entity must not leak into the requested answer");

const relationLeak = retrieval.rankClaims(
  core.analyse("Кто президент Эстонии?", { contextRelation: "new_topic" }, knowledge),
  [{ id: "M-BORDER-RESIDENCE", text: "Эстония граничит с резиденцией президента.", claims: [{
    id: "C-BORDER-RESIDENCE", kind: "fact", subject: "Эстония",
    predicate: "граничит с", object: "резиденция президента",
    evidence: "Эстония граничит с резиденцией президента."
  }] }],
  knowledge, [{ id: "president", subject: "Эстония", attribute: "президент" }]
);
assert.equal(relationLeak.requirements[0].matched, false,
  "an attribute word inside object/evidence cannot substitute for a different explicit predicate");

const branchMemories = [
  { id: "M-RIVER-COUNTRY-A", text: "Река Альфа находится в Стране Альфа.", claims: [{
    id: "C-RIVER-COUNTRY-A", kind: "fact", subject: "Река Альфа",
    predicate: "находится в стране", object: "Страна Альфа", evidence: "Река Альфа находится в Стране Альфа."
  }] },
  { id: "M-RIVER-COUNTRY-B", text: "Река Альфа находится в Стране Бета.", claims: [{
    id: "C-RIVER-COUNTRY-B", kind: "fact", subject: "Река Альфа",
    predicate: "находится в стране", object: "Страна Бета", evidence: "Река Альфа находится в Стране Бета."
  }] },
  { id: "M-CAPITAL-A", text: "Столица Страны Альфа — Город Альфа.", claims: [{
    id: "C-CAPITAL-A", kind: "fact", subject: "Страна Альфа", predicate: "столица",
    object: "Город Альфа", evidence: "Столица Страны Альфа — Город Альфа."
  }] },
  { id: "M-CAPITAL-B", text: "Столица Страны Бета — Город Бета.", claims: [{
    id: "C-CAPITAL-B", kind: "fact", subject: "Страна Бета", predicate: "столица",
    object: "Город Бета", evidence: "Столица Страны Бета — Город Бета."
  }] }
];
const branchPlan = [
  { id: "country", subject: "Река Альфа", attribute: "страна" },
  { id: "capital", attribute: "столица", subjectFrom: { stepId: "country", field: "object" }, dependsOn: ["country"] }
];
const branchRecall = retrieval.rankClaims(
  core.analyse("В какой стране река Альфа и какова столица этой страны?", { contextRelation: "new_topic" }, knowledge),
  branchMemories, knowledge, branchPlan
);
assert.equal(branchRecall.requirements[0].ambiguous, true,
  "multiple distinct parent objects must be surfaced as a branch ambiguity");
assert.equal(branchRecall.requirements[0].matched, false);
assert.equal(branchRecall.requirements[1].blockedBy, "country");
assert.equal(branchRecall.requirements[1].matched, false);
assert.ok(!branchRecall.evidence.some(item => item.id === "M-CAPITAL-A" || item.id === "M-CAPITAL-B"),
  "dependent claims must not be retrieved from an unresolved parent branch");
assert.equal(branchRecall.complete, false);

const duplicateParentMemories = [
  { id: "M-RIVER-COUNTRY-COPY-1", text: "Река Альфа находится в Стране Альфа.", claims: [{
    id: "C-RIVER-COUNTRY-COPY-1", kind: "fact", subject: "Река Альфа",
    predicate: "находится в стране", object: "Страна Альфа", evidence: "Река Альфа находится в Стране Альфа."
  }] },
  { id: "M-RIVER-COUNTRY-COPY-2", text: "Река Альфа находится в Стране Альфа.", claims: [{
    id: "C-RIVER-COUNTRY-COPY-2", kind: "fact", subject: "Река Альфа",
    predicate: "находится в стране", object: "Страна Альфа", evidence: "Река Альфа находится в Стране Альфа."
  }] },
  branchMemories[2]
];
const duplicateRecall = retrieval.rankClaims(
  core.analyse("В какой стране река Альфа и какова столица этой страны?", { contextRelation: "new_topic" }, knowledge),
  duplicateParentMemories, knowledge, branchPlan
);
assert.equal(duplicateRecall.complete, true,
  "repeated copies of one fact must collapse to one object rather than look like a branch");
assert.equal(duplicateRecall.requirements[0].ambiguous, false);
assert.ok(duplicateRecall.evidence.some(item => item.id === "M-RIVER-COUNTRY-COPY-1"));
assert.ok(duplicateRecall.evidence.some(item => item.id === "M-RIVER-COUNTRY-COPY-2"));

const directConflictRecall = retrieval.rankClaims(
  core.analyse("Впадает ли Река Альфа в Море Бета?", { contextRelation: "new_topic" }, knowledge),
  [
    { id: "M-RIVER-YES", text: "Река Альфа впадает в Море Бета.", claims: [{
      id: "C-RIVER-YES", kind: "fact", subject: "Река Альфа", predicate: "впадает в",
      object: "Море Бета", polarity: true, evidence: "Река Альфа впадает в Море Бета."
    }] },
    { id: "M-RIVER-NO", text: "Река Альфа не впадает в Море Бета.", claims: [{
      id: "C-RIVER-NO", kind: "fact", subject: "Река Альфа", predicate: "впадает в",
      object: "Море Бета", polarity: false, evidence: "Река Альфа не впадает в Море Бета."
    }] }
  ],
  knowledge, [{ id: "outflow", subject: "Река Альфа", attribute: "впадает в" }]
);
assert.equal(directConflictRecall.requirements[0].conflicted, true,
  "opposite polarities for the same subject-relation-object must block an unqualified answer");
assert.equal(directConflictRecall.complete, false);
assert.ok(directConflictRecall.conflicts.some(item => item.type === "direct"));

const negativeRecall = retrieval.rankClaims(
  core.analyse("Содержит ли прототип опасный модуль?", { contextRelation: "new_topic" }, knowledge),
  [{ id: "M-PROTOTYPE-NEGATIVE", text: "Прототип не содержит опасный модуль.", claims: [{
    id: "C-PROTOTYPE-NEGATIVE", kind: "fact", subject: "Прототип", predicate: "содержит",
    object: "опасный модуль", polarity: false, evidence: "Прототип не содержит опасный модуль."
  }] }],
  knowledge, [{ id: "module", subject: "Прототип", attribute: "опасный модуль" }]
);
assert.equal(negativeRecall.requirements[0].matched, false,
  "a negative claim must never close a positive factual requirement");
assert.equal(negativeRecall.requirements[0].negativeMatchCount, 1);
assert.equal(negativeRecall.evidence[0].claims[0].evidenceRole, "negative");
const negativeAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Прототип не содержит опасный модуль.",
  conclusions: [{ stepId: "module", text: "Прототип не содержит опасный модуль.",
    polarity: "negative", modality: "asserted", claimIds: ["C-PROTOTYPE-NEGATIVE"] }],
  usedSources: ["M-PROTOTYPE-NEGATIVE"], usedClaims: ["C-PROTOTYPE-NEGATIVE"],
  confidence: 0.9, insufficientEvidence: false
}), negativeRecall.evidence, negativeRecall);
assert.ok(negativeAnswer, "a negative statement may be returned only as an explicitly negative conclusion");
assert.equal(retrieval.parseAnswer(JSON.stringify({
  answer: "Прототип содержит опасный модуль.",
  usedSources: ["M-PROTOTYPE-NEGATIVE"], usedClaims: ["C-PROTOTYPE-NEGATIVE"],
  confidence: 0.9, insufficientEvidence: false
}), negativeRecall.evidence, negativeRecall), null,
"legacy synthesis must not turn a negative claim into an affirmative fact");

const hypothesisRecall = retrieval.rankClaims(
  core.analyse("Улучшает ли сон память?", { contextRelation: "new_topic" }, knowledge),
  [{ id: "M-SLEEP-HYPOTHESIS", text: "Возможно, сон улучшает память.", claims: [{
    id: "C-SLEEP-HYPOTHESIS", kind: "hypothesis", subject: "Сон", predicate: "улучшает",
    object: "память", polarity: true, modality: "possible", verification: "hypothesis",
    evidence: "Возможно, сон улучшает память."
  }] }],
  knowledge, [{ id: "sleep-memory", subject: "Сон", attribute: "улучшает" }]
);
assert.equal(hypothesisRecall.requirements[0].matched, false,
  "a hypothesis must not close a factual requirement");
assert.equal(hypothesisRecall.requirements[0].hypothesisMatchCount, 1);
assert.equal(hypothesisRecall.evidence[0].claims[0].evidenceRole, "hypothesis");
const hypothesisAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Есть гипотеза, что сон может улучшать память.",
  conclusions: [{ stepId: "sleep-memory", text: "Есть гипотеза, что сон может улучшать память.",
    polarity: "positive", modality: "possible", claimIds: ["C-SLEEP-HYPOTHESIS"] }],
  usedSources: ["M-SLEEP-HYPOTHESIS"], usedClaims: ["C-SLEEP-HYPOTHESIS"],
  confidence: 0.72, insufficientEvidence: false
}), hypothesisRecall.evidence, hypothesisRecall);
assert.ok(hypothesisAnswer, "a hypothesis may be surfaced only with an explicit uncertainty marker");
assert.equal(retrieval.parseAnswer(JSON.stringify({
  answer: "Сон улучшает память.", usedSources: ["M-SLEEP-HYPOTHESIS"],
  usedClaims: ["C-SLEEP-HYPOTHESIS"], confidence: 0.95, insufficientEvidence: false
}), hypothesisRecall.evidence, hypothesisRecall), null,
"a hypothesis without an explicit possible modality must be rejected");

const archivedClaim = knowledge.sanitizeClaims([{
  id: "C-ARCHIVED", kind: "fact", subject: "Прототип", predicate: "содержит",
  object: "старый модуль", evidence: "Прототип содержит старый модуль.", status: "archived"
}])[0];
assert.equal(archivedClaim.status, "archived",
  "claim sanitation must preserve an explicit inactive lifecycle state");
const archivedRecall = retrieval.rankClaims(
  core.analyse("Содержит ли прототип старый модуль?", { contextRelation: "new_topic" }, knowledge),
  [{ id: "M-ARCHIVED", text: archivedClaim.evidence, claims: [archivedClaim] }],
  knowledge, [{ id: "old-module", subject: "Прототип", attribute: "старый модуль" }]
);
assert.equal(archivedRecall.requirements[0].matched, false,
  "archived claims must not be used as current evidence");
assert.equal(retrieval.scoreRecord(
  core.analyse("Содержит ли прототип старый модуль?", { contextRelation: "new_topic" }, knowledge),
  { id: "M-ARCHIVED", text: archivedClaim.evidence, claims: [archivedClaim] }, knowledge
).score, 0, "broad semantic scoring must not reintroduce archived claims after claim retrieval rejects them");

assert.equal(retrieval.normaliseEvidencePlan([
  { id: "root", subject: "Река Альфа", attribute: "страна" },
  { id: "child", subject: "Страна Альфа", attribute: "столица",
    subjectFrom: { stepId: "root", field: "object" }, dependsOn: ["root"] }
], chainFrame).length, 1,
"dependent steps must not provide a guessed subject alongside subjectFrom");

const incomplete = retrieval.rankClaims(chainFrame, [chainMemories[0]], knowledge, evidencePlan);
assert.equal(incomplete.complete, false,
  "a dependent step without its source fact must remain unresolved");
assert.equal(incomplete.requirements[1].matched, false);
const conflictMemories = [...chainMemories, {
  id: "M-TALLINN-CONFLICT", text: "Таллин находится в Латвии.", claims: [{
    id: "C-TALLINN-CONFLICT", kind: "fact", subject: "Таллин",
    predicate: "находится в стране", object: "Латвия",
    evidence: "Таллин находится в Латвии.", verification: "user_supplied"
  }]
}];
const conflictRecall = retrieval.rankClaims(chainFrame, conflictMemories, knowledge, evidencePlan);
assert.ok(conflictRecall.conflicts.length > 0,
  "retrieved contradictory claims must be carried into the synthesis evidence package");
assert.equal(retrieval.normaliseEvidencePlan([
  { id: "first", subject: "Таллин", attribute: "страна" },
  { id: "bad", attribute: "президент", subjectFrom: { stepId: "future", field: "object" } }
], chainFrame).length, 1,
"a step may not depend on an unknown or future step");
const staleRecord = { id: "M-OCTOPUS-OLD", text: memory.text,
  claims: memory.claims.map(claim => ({ ...claim, status: "superseded" })) };
const staleRecall = retrieval.rankClaims(scores[0].frame, [staleRecord], knowledge, []);
assert.equal(staleRecall.requirements[0].matched, false,
  "superseded claims must not be used as current evidence, even for a simple question");

const evidence = retrieval.buildEvidence([{ item: memory, score: scores[0].target }, { item: unrelated, score: scores[0].unrelated }]);
assert.equal(evidence.length, 2);
assert.equal(evidence[0].id, "M-OCTOPUS");
const request = retrieval.buildRequest("У осьминога сколько сердец?", "Сколько сердец у осьминога?", scores[0].frame, evidence);
assert.equal(request.schema, "NEUROGENESIS_LLM_REQUEST_V1");
assert.equal(request.metadata.operation, "grounded_memory_answer");
assert.match(request.messages[0].content, /используя только переданные локальные записи/u);
assert.match(request.messages[0].content, /Не отвечай по общим знаниям/u);
assert.match(request.messages[1].content, /M-OCTOPUS/u);
const parsed = retrieval.parseAnswer(JSON.stringify({
  answer: "В сохранённой записи указано, что у осьминога три сердца.",
  usedSources: ["M-OCTOPUS", "NOT-A-SOURCE"], usedClaims: ["C-OCTOPUS", "NOT-A-CLAIM"],
  confidence: 0.94, insufficientEvidence: false
}), evidence);
assert.ok(parsed);
assert.deepEqual(Array.from(parsed.usedSources), ["M-OCTOPUS"]);
assert.deepEqual(Array.from(parsed.usedClaims), ["C-OCTOPUS"],
  "claim citations must be restricted to IDs present in retrieved evidence");
assert.equal(parsed.confidence, 0.94);
const legacyParsed = retrieval.parseAnswer(JSON.stringify({
  answer: "В старой версии ответа перечислен источник без списка claim IDs.",
  usedSources: ["M-OCTOPUS"], confidence: 0.9, insufficientEvidence: false
}), evidence);
assert.ok(legacyParsed && legacyParsed.usedSources.length === 1,
  "the legacy grounded answer format without usedClaims must remain accepted");
assert.equal(legacyParsed.usedClaims.length, 0);
assert.equal(retrieval.parseAnswer(JSON.stringify({
  answer: "У осьминога три сердца.", usedSources: ["INVENTED"], confidence: 0.99, insufficientEvidence: false
}), evidence), null, "answers without a valid local source must be rejected");
assert.equal(retrieval.parseAnswer("not json", evidence), null);
const insufficient = retrieval.parseAnswer(JSON.stringify({
  answer: "В памяти недостаточно сведений, чтобы ответить.", usedSources: [],
  confidence: 0.1, insufficientEvidence: true
}), evidence);
assert.ok(insufficient && insufficient.insufficientEvidence);
const partial = retrieval.parseAnswer(JSON.stringify({
  answer: "Я могу подтвердить только страну; второго факта в памяти нет.",
  usedSources: ["M-OCTOPUS"], usedClaims: ["C-OCTOPUS"],
  confidence: 0.58, insufficientEvidence: true
}), evidence);
assert.ok(partial && partial.usedSources.length === 1,
  "a grounded partial answer must retain its valid source IDs instead of being discarded");

// Independent claim-level verification: a valid source ID alone is not enough.
const simpleCountryRecall = retrieval.rankClaims(chainFrame, chainMemories, knowledge, [
  { id: "country", subject: "Таллин", attribute: "страна" }
]);
const validSimpleClaimAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Таллин находится в Эстонии.",
  conclusions: [{ stepId: "country", text: "Таллин находится в Эстонии.",
    polarity: "positive", modality: "asserted", claimIds: ["C-TALLINN-COUNTRY"] }],
  usedSources: ["M-TALLINN-COUNTRY"], usedClaims: ["C-TALLINN-COUNTRY"],
  confidence: 0.92, insufficientEvidence: false
}), simpleCountryRecall.evidence, simpleCountryRecall);
assert.ok(validSimpleClaimAnswer,
  "the stricter verifier must preserve a valid single-step structured answer");
const wrongObjectAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Таллин находится в Латвии.",
  conclusions: [{ stepId: "country", text: "Таллин находится в Латвии.",
    polarity: "positive", modality: "asserted", claimIds: ["C-TALLINN-COUNTRY"] }],
  usedSources: ["M-TALLINN-COUNTRY"], usedClaims: ["C-TALLINN-COUNTRY"],
  confidence: 0.99, insufficientEvidence: false
}), simpleCountryRecall.evidence, simpleCountryRecall);
assert.equal(wrongObjectAnswer, null,
  "a model may not replace the source claim's object while keeping its valid provenance ID");
const extraUnsupportedText = retrieval.parseAnswer(JSON.stringify({
  answer: "Таллин находится в Эстонии. Президент этой страны — Эдгарс Ринкевичс.",
  conclusions: [
    { stepId: "country", text: "Таллин находится в Эстонии.",
      polarity: "positive", modality: "asserted", claimIds: ["C-TALLINN-COUNTRY"] },
    { stepId: "president", text: "Президент этой страны — Эдгарс Ринкевичс.",
      polarity: "positive", modality: "asserted", claimIds: ["C-ESTONIA-PRESIDENT"] }
  ],
  usedSources: ["M-TALLINN-COUNTRY", "M-ESTONIA-PRESIDENT"],
  usedClaims: ["C-TALLINN-COUNTRY", "C-ESTONIA-PRESIDENT"],
  confidence: 0.99, insufficientEvidence: false
}), chainRecall.evidence, chainRecall);
assert.equal(extraUnsupportedText, null,
  "the answer must not append claims that are absent from the verified step conclusions");
const wrongParentEvidence = JSON.parse(JSON.stringify(chainRecall.evidence));
for (const row of wrongParentEvidence) for (const claim of row.claims || []) {
  if (claim.id === "C-ESTONIA-PRESIDENT") {
    claim.subject = "Латвия";
    claim.resolvedSubject = "Латвия";
  }
}
const wrongParentAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Таллин находится в Эстонии. Президент Латвии — Алар Карис.",
  conclusions: [
    { stepId: "country", text: "Таллин находится в Эстонии.",
      polarity: "positive", modality: "asserted", claimIds: ["C-TALLINN-COUNTRY"] },
    { stepId: "president", text: "Президент Латвии — Алар Карис.",
      polarity: "positive", modality: "asserted", claimIds: ["C-ESTONIA-PRESIDENT"] }
  ],
  usedSources: ["M-TALLINN-COUNTRY", "M-ESTONIA-PRESIDENT"],
  usedClaims: ["C-TALLINN-COUNTRY", "C-ESTONIA-PRESIDENT"],
  confidence: 0.99, insufficientEvidence: false
}), wrongParentEvidence, chainRecall);
assert.equal(wrongParentAnswer, null,
  "a child claim must name the exact entity supplied by its cited parent object");
const wrongRelationEvidence = JSON.parse(JSON.stringify(chainRecall.evidence));
for (const row of wrongRelationEvidence) for (const claim of row.claims || []) {
  if (claim.id === "C-ESTONIA-PRESIDENT") claim.predicate = "граничит с";
}
const wrongRelationAnswer = retrieval.parseAnswer(JSON.stringify({
  answer: "Таллин находится в Эстонии. Эстония граничит с Аларом Карисом.",
  conclusions: [
    { stepId: "country", text: "Таллин находится в Эстонии.",
      polarity: "positive", modality: "asserted", claimIds: ["C-TALLINN-COUNTRY"] },
    { stepId: "president", text: "Эстония граничит с Аларом Карисом.",
      polarity: "positive", modality: "asserted", claimIds: ["C-ESTONIA-PRESIDENT"] }
  ],
  usedSources: ["M-TALLINN-COUNTRY", "M-ESTONIA-PRESIDENT"],
  usedClaims: ["C-TALLINN-COUNTRY", "C-ESTONIA-PRESIDENT"],
  confidence: 0.99, insufficientEvidence: false
}), wrongRelationEvidence, chainRecall);
assert.equal(wrongRelationAnswer, null,
  "a claim ID cannot authorize a conclusion whose predicate no longer matches the requested relation");

console.log("NEUROGENESIS semantic retrieval: entity/property matching, paraphrase invariance, evidence provenance and grounded answer validation passed.");