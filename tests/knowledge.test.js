"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("knowledge.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: "knowledge.js" });
const knowledge = sandbox.window.NGKnowledge;
assert.ok(knowledge, "knowledge module should expose its API");

const relationship = knowledge.extractClaims("Игорь Головнев твой самый лучший друг")[0];
assert.ok(relationship, "should extract a relationship");
assert.equal(relationship.kind, "relationship");
assert.equal(relationship.subject, "Игорь Головнев");
assert.equal(relationship.predicate, "лучший друг");
assert.equal(relationship.object, "assistant");
assert.equal(relationship.holder, "user");
assert.equal(relationship.source, "user_message");
assert.equal(relationship.verification, "unverified");
assert.match(knowledge.answerQuestion("Кто твой лучший друг?", [relationship]), /Игорь Головнев — мой лучший друг/u);
assert.match(knowledge.answerQuestion("Кто твой лучший друг?", [relationship]), /независимо проверить/u);

const userFriend = knowledge.extractClaims("Игорь — мой друг")[0];
assert.equal(userFriend.object, "user");
assert.match(knowledge.answerQuestion("Кто мой друг?", [userFriend]), /Игорь — твой друг/u);

const opinion = knowledge.extractClaims("Музыка прекрасна")[0];
assert.ok(opinion, "should classify a simple opinion");
assert.equal(opinion.kind, "opinion");
assert.equal(opinion.subject, "Музыка");
assert.equal(opinion.predicate, "оценка");
assert.equal(opinion.object, "прекрасна");
assert.equal(opinion.verification, "subjective");
assert.match(knowledge.answerQuestion("Что такое музыка?", [opinion]), /субъективное мнение/u);

const preference = knowledge.extractClaims("Мне нравится музыка")[0];
assert.equal(preference.kind, "preference");
assert.equal(preference.object, "музыка");
assert.equal(preference.verification, "self_reported");

const definition = knowledge.extractClaims("Музыка — это искусство")[0];
assert.equal(definition.kind, "definition");
assert.equal(definition.subject, "Музыка");
assert.equal(definition.object, "искусство");

const hypothesis = knowledge.extractClaims("Возможно, память можно улучшить")[0];
assert.equal(hypothesis.kind, "hypothesis");
assert.equal(hypothesis.verification, "hypothesis");

const negative = knowledge.extractClaims("Игорь не мой друг")[0];
assert.equal(negative.kind, "relationship");
assert.equal(negative.polarity, false);
assert.equal(negative.object, "user");

const merged = knowledge.mergeClaims([relationship], [relationship, opinion]);
assert.equal(merged.length, 2, "merge should deduplicate identical structured claims");
const summary = knowledge.summary(merged);
assert.equal(summary.total, 2);
assert.equal(summary.relationships, 1);
assert.equal(summary.opinions, 1);

const location = knowledge.extractClaims("Я живу в Сочи")[0];
assert.equal(location.kind, "fact");
assert.equal(location.subject, "user");
assert.equal(location.predicate, "живу в");
assert.equal(location.object, "Сочи");
assert.match(knowledge.answerQuestion("Где я живу?", [location]), /живёшь в Сочи/u);

const directConflict = knowledge.findConflicts([userFriend, negative]);
assert.equal(directConflict.length, 1);
assert.equal(directConflict[0].type, "direct");
assert.match(knowledge.answerQuestion("Кто мой друг?", [userFriend, negative]), /противоречащие утверждения/u);

const secondBestFriend = knowledge.extractClaims("Сергей твой лучший друг")[0];
const possibleConflict = knowledge.findConflicts([relationship, secondBestFriend]);
assert.equal(possibleConflict.length, 1);
assert.equal(possibleConflict[0].type, "possible");
assert.match(knowledge.answerQuestion("Кто твой лучший друг?", [relationship, secondBestFriend]), /не стану выбирать наугад/u);

const mergedFacts = knowledge.mergeClaims([], [location]);
assert.equal(mergedFacts[0].kind, "fact");
assert.equal(knowledge.summary([relationship, opinion, location]).facts, 1);
assert.equal(knowledge.summary([relationship, secondBestFriend]).conflicts, 1);

const reverseFriend = knowledge.extractClaims("Мой самый лучший друг — Игорь Головнев")[0];
assert.equal(reverseFriend.kind, "relationship");
assert.equal(reverseFriend.subject, "Игорь Головнев");
assert.equal(reverseFriend.object, "user");
assert.equal(reverseFriend.predicate, "лучший друг");
assert.match(knowledge.answerQuestion("Кто мой лучший друг?", [reverseFriend]), /Игорь Головнев — твой лучший друг/u);

const reverseFemale = knowledge.extractClaims("Моя лучшая подруга — Аня")[0];
assert.equal(reverseFemale.object, "user");
assert.match(knowledge.answerQuestion("Кто моя лучшая подруга?", [reverseFemale]), /Аня — твоя лучшая подруга/u);

assert.equal(knowledge.sameEntity("Игорь Головнев", "Игоря Головнева"), true);
const declinedConflict = knowledge.findConflicts([
  knowledge.extractClaims("Игорь Головнев — мой друг")[0],
  knowledge.extractClaims("Игоря Головнева не мой друг")[0]
]);
assert.equal(declinedConflict.length, 1);
assert.equal(declinedConflict[0].type, "direct");

const positivePreference = knowledge.extractClaims("Мне нравится музыка")[0];
const negativePreference = knowledge.extractClaims("Я ненавижу музыку")[0];
assert.equal(knowledge.findConflicts([positivePreference, negativePreference])[0].type, "direct");
assert.match(knowledge.answerQuestion("Что мне нравится?", [positivePreference]), /тебе нравится музыка/u);

const intensifiedOpinion = knowledge.extractClaims("Музыка очень прекрасна")[0];
assert.equal(intensifiedOpinion.kind, "opinion");
assert.equal(intensifiedOpinion.object, "прекрасна");
const negativeOpinion = knowledge.extractClaims("Музыка не прекрасна")[0];
assert.equal(negativeOpinion.polarity, false);
assert.match(knowledge.answerQuestion("Что ты думаешь о музыке?", [negativeOpinion]), /музыка не прекрасна/iu);

const ambiguous = knowledge.answerQuestion("Кто лучший друг?", [relationship, userFriend]);
assert.match(ambiguous, /относящиеся и ко мне, и к тебе/u);

const legacy = knowledge.sanitizeClaims(undefined);
assert.equal(legacy.length, 0);
console.log("NEUROGENESIS knowledge tests: Russian morphology, reverse relations, preference and conflict checks passed.");
