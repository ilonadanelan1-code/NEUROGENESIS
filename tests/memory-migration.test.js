"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const database = new Map();
const legacyMemories = [
  {
    id: "mmusic",
    text: "Музыка прекрасна",
    tags: ["музык", "прекрасн"],
    traceIds: ["n112", "n113"],
    createdAt: 1794156965429,
    updatedAt: 1794156965430,
    strength: 0.665,
    repetitions: 1,
    recalls: 1
  },
  {
    id: "migor",
    text: "Игорь Головнев твой самый лучший друг",
    tags: ["игорь", "головн", "сам", "лучш"],
    traceIds: ["n114", "n115", "n118", "n116"],
    createdAt: 1794157814555,
    updatedAt: 1794157868253,
    strength: 0.65,
    repetitions: 1,
    recalls: 0
  }
];
database.set("neurogenesis.memories.v1", JSON.stringify(legacyMemories));
database.set("neurogenesis.dialog.v1", "[]");

class ElementStub {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.scrollHeight = 0;
    this.files = [];
  }
  addEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  remove() {}
  focus() {}
  scrollIntoView() {}
}
const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new ElementStub());
    return elements.get(id);
  },
  createElement() { return new ElementStub(); },
  body: new ElementStub()
};
const knownNeurons = new Set(["n112", "n113", "n114", "n115", "n116", "n118"]);
let nextNeuron = 119;
const window = {
  NGBrain: {
    hasNeuron(id) { return knownNeurons.has(id); },
    createMemoryTrace() {
      const id = "n" + nextNeuron++;
      knownNeurons.add(id);
      return id;
    },
    associateMemoryTraces() {},
    activateMemoryTraces() {},
    removeMemoryTraces() {}
  },
  confirm() { return true; }
};
const localStorage = {
  getItem(key) { return database.has(key) ? database.get(key) : null; },
  setItem(key, value) { database.set(key, String(value)); }
};
const sandbox = { window, document, localStorage, console, Date, Math, Set, Map, JSON };
vm.runInNewContext(fs.readFileSync("knowledge.js", "utf8"), sandbox, { filename: "knowledge.js" });
vm.runInNewContext(fs.readFileSync("memory.js", "utf8"), sandbox, { filename: "memory.js" });

assert.equal(window.NGMemory.count(), 2);
const claims = window.NGMemory.claims();
assert.equal(claims.length, 2, "both legacy memories should be upgraded to structured claims");
const relation = claims.find(claim => claim.kind === "relationship");
const opinion = claims.find(claim => claim.kind === "opinion");
assert.ok(relation);
assert.equal(relation.subject, "Игорь Головнев");
assert.equal(relation.predicate, "лучший друг");
assert.equal(relation.object, "assistant");
assert.ok(opinion);
assert.equal(opinion.subject, "Музыка");
assert.equal(opinion.object, "прекрасна");
assert.match(window.NGKnowledge.answerQuestion("Кто твой лучший друг?", claims), /Игорь Головнев — мой лучший друг/u);

const migrated = JSON.parse(database.get("neurogenesis.memories.v1"));
const migratedIgor = migrated.find(item => item.id === "migor");
assert.ok(migratedIgor.claims && migratedIgor.claims.length === 1, "claims should be persisted to upgraded local storage");
assert.ok(migratedIgor.tags.includes("друг"), "legacy tags should be enriched with the missing relationship word");
assert.ok(migratedIgor.traceIds.some(id => id && !["n114", "n115", "n118", "n116"].includes(id)), "new concept should receive a neural trace");
console.log("NEUROGENESIS legacy memory migration: passed.");
