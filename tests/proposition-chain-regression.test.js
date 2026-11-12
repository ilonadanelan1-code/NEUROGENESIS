"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["knowledge.js", "semantic-core.js", "semantic-query.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}
const knowledge = window.NGKnowledge;
const core = window.NGSemanticCore;
const query = window.NGSemanticQuery;
assert.ok(core && query, "semantic core and query must be available");

const parseChain = text => core.analyse(text, { contextRelation: "new_topic" }, knowledge).propositionChain;
const reference = (item, role) => item.proposition.references.find(row => row.mentionRole === role);
const source = "Система получает сигнал. Она активируется.";
const baseline = parseChain(source);
assert.equal(baseline.schema, "NG_PROPOSITION_CHAIN_V1");
assert.equal(baseline.sourceText, source, "the exact original multi-sentence text must remain available");
assert.equal(baseline.items[0].sourceText, "Система получает сигнал.");
assert.equal(baseline.items[1].sourceText, "Она активируется.");
assert.equal(baseline.items[1].proposition.subject, "Система");
assert.equal(reference(baseline.items[1], "subject").status, "resolved");

const competing = parseChain("Модель использует нейросеть. Она активируется.");
assert.equal(competing.items[1].proposition.subject, "Она",
  "the pronoun must remain unchanged when two feminine antecedents compete");
assert.equal(reference(competing.items[1], "subject").status, "ambiguous");
assert.equal(reference(competing.items[1], "subject").candidates.length, 2);

const subjectVersusObject = parseChain("Система получает сигнал. Он усиливается.");
assert.equal(subjectVersusObject.items[1].proposition.subject, "сигнал",
  "a masculine subject pronoun must resolve to the only compatible prior object");
assert.equal(reference(subjectVersusObject.items[1], "subject").candidates[0].role, "object");

const objectReference = parseChain("Система получает сигнал. Модель обрабатывает его.");
assert.equal(objectReference.items[1].proposition.object, "сигнал",
  "an object pronoun must be resolved from the prior proposition object");
assert.equal(reference(objectReference.items[1], "object").status, "resolved");
assert.equal(reference(objectReference.items[1], "object").antecedentText, "сигнал");

const pluralReference = parseChain("Система получает нейроны. Они активируются.");
assert.equal(pluralReference.items[1].proposition.subject, "нейроны",
  "plural agreement must permit a plural antecedent");
assert.equal(reference(pluralReference.items[1], "subject").status, "resolved");

const missingAntecedent = parseChain("Сеть активируется. Он усиливается.");
assert.equal(reference(missingAntecedent.items[1], "subject").status, "unresolved");
assert.equal(missingAntecedent.items[1].proposition.subject, "Он");

const firstMentionMissing = parseChain("Она активируется. Модуль работает.");
assert.equal(reference(firstMentionMissing.items[0], "subject").status, "unresolved");

const longChain = parseChain("Система активирует модуль. Он работает. Он работает.");
assert.equal(longChain.items.length, 3);
assert.equal(longChain.items[1].proposition.subject, "модуль");
assert.equal(longChain.items[2].proposition.subject, "модуль",
  "a resolved antecedent must remain available through a longer bounded chain");
assert.equal(reference(longChain.items[2], "subject").status, "resolved");

const prepositionalHead = parseChain("Модуль находится в большой комнате. Она работает.");
assert.equal(prepositionalHead.items[1].proposition.subject, "в большой комнате",
  "a preposition and adjective must not be mistaken for the grammatical head");
assert.equal(reference(prepositionalHead.items[1], "subject").status, "resolved");
assert.equal(reference(prepositionalHead.items[1], "subject").antecedentText, "в большой комнате");

const feminineSoftSign = parseChain("Модуль открывает дверь. Она работает.");
assert.equal(feminineSoftSign.items[1].proposition.subject, "дверь",
  "known feminine soft-sign nouns must support gender agreement");
assert.equal(reference(feminineSoftSign.items[1], "subject").status, "resolved");

const masculineSoftSign = parseChain("Система использует словарь. Он работает.");
assert.equal(masculineSoftSign.items[1].proposition.subject, "словарь",
  "known masculine soft-sign nouns must remain masculine");
assert.equal(reference(masculineSoftSign.items[1], "subject").status, "resolved");

const genitiveMasculine = parseChain("Система находится около модуля. Он активируется.");
assert.equal(genitiveMasculine.items[1].proposition.subject, "около модуля",
  "a masculine genitive form after a genitive preposition must remain masculine");
assert.equal(reference(genitiveMasculine.items[1], "subject").status, "resolved");
assert.equal(reference(genitiveMasculine.items[1], "subject").antecedentText, "около модуля");

const locativeFeminine = parseChain("Модуль находится в сети. Она активируется.");
assert.equal(locativeFeminine.items[1].proposition.subject, "в сети",
  "a locative singular form must use its preposition as case evidence");
assert.equal(reference(locativeFeminine.items[1], "subject").status, "resolved");
assert.equal(reference(locativeFeminine.items[1], "subject").antecedentText, "в сети");

const ambiguousCaseNumber = parseChain("Модуль использует сети. Она активируется.");
assert.equal(ambiguousCaseNumber.items[1].proposition.subject, "Она",
  "a bare form shared by singular genitive and plural nominative must not be guessed");
assert.equal(reference(ambiguousCaseNumber.items[1], "subject").status, "unresolved");

const obliqueSingular = parseChain("Система получает сигнал. Модуль работает с ним.");
assert.equal(obliqueSingular.items[1].proposition.object, "с ним",
  "a prepositional pronoun phrase must preserve its original case");
assert.equal(reference(obliqueSingular.items[1], "object").status, "resolved");
assert.equal(reference(obliqueSingular.items[1], "object").mention, "ним");
assert.equal(reference(obliqueSingular.items[1], "object").mentionContext, "с");
assert.equal(reference(obliqueSingular.items[1], "object").antecedentText, "сигнал");

const obliquePlural = parseChain("Система получает нейроны. Модуль работает с ними.");
assert.equal(obliquePlural.items[1].proposition.object, "с ними",
  "a plural oblique phrase must be preserved instead of replaced with nominative");
assert.equal(reference(obliquePlural.items[1], "object").status, "resolved");
assert.equal(reference(obliquePlural.items[1], "object").mention, "ними");
assert.equal(reference(obliquePlural.items[1], "object").mentionContext, "с");
assert.equal(reference(obliquePlural.items[1], "object").antecedentText, "нейроны");

const causal = parseChain("Сеть не активируется, потому что питание не работает.");
assert.equal(causal.items.length, 2);
assert.equal(causal.items[1].relationToPrevious.type, "cause_of_previous");
assert.equal(causal.items[0].proposition.polarity, "negative");
assert.equal(causal.items[1].proposition.polarity, "negative",
  "negation must remain local to both propositions in a causal construction");
assert.equal(causal.items[1].relationToPrevious.provenance.source, "semantic_core_rule");
assert.ok(causal.items[1].relationToPrevious.confidence >= 0.8);
assert.equal(causal.items[1].relationToPrevious.provenance.direction, "current_to_previous");

const frontedCause = parseChain("Потому что питание не работает, сеть не активируется.");
assert.equal(frontedCause.items[1].relationToPrevious.type, "result_of_previous");
assert.equal(frontedCause.items[0].proposition.polarity, "negative");
assert.equal(frontedCause.items[1].proposition.polarity, "negative");

const conditional = parseChain("Если система не получает сигнал, то модуль не активируется.");
assert.equal(conditional.items.length, 2);
assert.equal(conditional.items[0].proposition.kind, "conditional");
assert.equal(conditional.items[0].proposition.polarity, "negative");
assert.equal(conditional.items[1].proposition.polarity, "negative");
assert.equal(conditional.items[1].relationToPrevious.type, "condition_result");

const postposedCondition = parseChain("Модуль активируется, если система получает сигнал.");
assert.equal(postposedCondition.items[1].relationToPrevious.type, "condition_of_previous");
assert.equal(postposedCondition.items[1].proposition.kind, "conditional");
assert.equal(postposedCondition.items[1].relationToPrevious.provenance.direction, "current_to_previous");

const contrastForward = parseChain("Система работает, однако сеть не активируется.");
const contrastReverse = parseChain("Сеть не активируется, но система работает.");
assert.equal(contrastForward.items[1].relationToPrevious.type, "contrast");
assert.equal(contrastReverse.items[1].relationToPrevious.type, "contrast");

const temporal = parseChain("Модель запускает процесс. Затем он сохраняет результат.");
assert.equal(temporal.items[1].relationToPrevious.type, "sequence");
assert.equal(temporal.items[1].proposition.subject, "процесс");
assert.equal(temporal.items[1].relationToPrevious.provenance.direction, "previous_to_current");
const temporalBackward = parseChain("Система активируется. До этого питание не работало.");
assert.equal(temporalBackward.items[1].relationToPrevious.type, "sequence");
assert.equal(temporalBackward.items[1].relationToPrevious.provenance.direction, "current_before_previous");

const demonstrativeWithoutAntecedent = parseChain("Это запускает процесс. Система работает.");
assert.equal(demonstrativeWithoutAntecedent.items[0].proposition.references[0].status, "unresolved",
  "a first-position demonstrative must not invent a previous proposition");

const noFalseChain = core.analyse("Мне нравится сеть и память.", { contextRelation: "new_topic" }, knowledge);
assert.equal(noFalseChain.propositionChain.items.length, 0,
  "ordinary coordination inside one phrase must not be split into invented propositions");


const locationReference = parseChain("Система работает в лаборатории. Там система активируется.");
assert.equal(locationReference.items[1].proposition.references[0].targetType, "location");
assert.equal(locationReference.items[1].proposition.references[0].status, "resolved");
assert.match(locationReference.items[1].proposition.references[0].antecedentText, /лаборатории/iu);

const temporalReference = parseChain("Вчера система работала. Тогда система активировалась.");
assert.equal(temporalReference.items[1].relationToPrevious.type, "sequence");
assert.equal(temporalReference.items[1].proposition.references[0].targetType, "time");
assert.equal(temporalReference.items[1].proposition.references[0].status, "resolved");
assert.equal(temporalReference.items[1].proposition.references[0].antecedentText, "Вчера");

const contextualTokens = ["система", "получает", "сигнал", "она", "активируется"];
window.NGContextualAttention = {
  status: () => ({ trained: true, trainingSteps: 5 }),
  analyse: () => ({
    schema: "NG_CONTEXTUAL_ATTENTION_V1",
    positions: contextualTokens.map(token => ({ token, predictions: [{ token: "система", probability: 0.7 }] }))
  })
};
window.NGPhraseComposition = {
  status: () => ({ trained: true }),
  analyse: () => ({
    schema: "NG_PHRASE_COMPOSITION_V1", trained: true, supervision: "weak_semantic_parser_labels",
    tokens: contextualTokens,
    nodes: [
      { role: "subject", start: 0, end: 1, text: "Система", confidence: 0.9 },
      { role: "predicate", start: 1, end: 2, text: "получает", confidence: 0.9 },
      { role: "object", start: 2, end: 3, text: "сигнал", confidence: 0.9 }
    ],
    edges: [{ from: 0, to: 1, fromToken: "система", toToken: "получает",
      relation: "subject_to_predicate", confidence: 0.9 }]
  })
};
const withAdvisoryModels = query.local(source, {}, knowledge);
const advisoryChain = withAdvisoryModels.semanticFrame.propositionChain;
assert.equal(advisoryChain.sourceText, source);
assert.equal(advisoryChain.items[1].proposition.subject, "Система",
  "contextual and composition signals must not override the deterministic coreference result");
assert.equal(advisoryChain.items[1].relationToPrevious.type, "next_sentence");
assert.deepEqual(Array.from(advisoryChain.advisorySignals.map(row => row.source)),
  ["contextual_attention", "phrase_composition"]);
assert.ok(advisoryChain.advisorySignals.every(row => row.confidence > 0 && row.confidence <= 1));
assert.ok(advisoryChain.advisorySignals.every(row => row.provenance && row.usage === "advisory_only_no_semantic_override"));

console.log("Proposition-chain regression tests passed.");
