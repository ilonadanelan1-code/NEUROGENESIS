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

const legacy = knowledge.sanitizeClaims(undefined);
assert.equal(legacy.length, 0);
console.log("NEUROGENESIS knowledge tests: 16 assertions passed.");
