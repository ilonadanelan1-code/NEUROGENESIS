"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class ElementStub {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.listeners = Object.create(null);
    this.children = [];
  }
  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) {
      listener({ target: this, preventDefault() {}, ...event });
    }
  }
  dispatchEvent(event) {
    this.dispatch(event.type, { bubbles: event.bubbles });
    return true;
  }
  replaceChildren(...children) {
    this.children = children;
    this.textContent = children.map(child => child.textContent || "").join("");
  }
}

function boot() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new ElementStub(id));
      return elements.get(id);
    },
    createElement(tag) {
      return new ElementStub(tag);
    }
  };
  const savedCorpus = [
    "Тебя создал Рыжий парень.",
    "Человек изучает нейросеть.",
    "Сеть сохраняет информацию."
  ].join("\n");
  const localStorage = {
    getItem() { return JSON.stringify({ corpus: savedCorpus }); },
    setItem() {},
    removeItem() {}
  };
  const model = {
    schema: "test",
    create() {
      return {
        status() {
          return {
            trained: true, heads: 3, windowSize: 4, vocabularySize: 20,
            transformerBlocks: 2, trainingSteps: 900, subwordBuckets: 16,
            lastLoss: 0.1, lastTraining: null, trainingContextExamples: 10
          };
        },
        exportState() { return {}; },
        loadState() {},
        analyse(text) {
          const tokens = text.toLowerCase().split(/\s+/u).filter(Boolean);
          return {
            tokens,
            knownTokenCount: 0,
            morphologyCoveredTokenCount: 0,
            contextMorphologyBackoffCount: 0,
            morphologyBackoffTokens: [],
            morphologyAmbiguousTokens: [],
            windowSize: 4,
            positions: tokens.map(token => ({
              token, targetKnown: false, attention: [], predictions: [], heads: [],
              morphologyBackoff: false, morphologyAmbiguous: false, morphologyToken: null
            }))
          };
        },
        predictMasked() { return null; }
      };
    }
  };
  const window = { NGContextualModel: model, localStorage };
  class EventStub {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = !!options.bubbles;
    }
  }
  const sandbox = { window, document, localStorage, Event: EventStub, console, Math, JSON, Set, Map, Number, String, Array };
  vm.runInNewContext(fs.readFileSync("contextual-attention-ui.js", "utf8"), sandbox, {
    filename: "contextual-attention-ui.js"
  });
  return { document, el: id => document.getElementById(id) };
}

(async () => {
  const app = boot();
  const corpus = app.el("contextual-training-corpus");
  const count = app.el("contextual-corpus-count");
  const friendly = app.el("contextual-friendly-result");
  assert.match(corpus.value, /Тебя создал Рыжий парень/u, "saved corpus must be restored");
  assert.equal(count.textContent, "Предложений добавлено: 3 · минимум для запуска: 3");

  app.el("contextual-add-examples-button").dispatch("click");
  assert.match(corpus.value, /Тебя создал Рыжий парень/u, "adding starter examples must preserve user text");
  assert.match(corpus.value, /Нейрон получает сигнал/u, "starter examples should be appended");
  assert.equal(count.textContent, "Предложений добавлено: 11 · минимум для запуска: 3");

  app.el("contextual-query").value = "Ключ запускает программу";
  app.el("contextual-analyse-button").dispatch("click");
  assert.equal(friendly.children[0].textContent, "Пока не узнаю слова в этой фразе");
  assert.match(friendly.textContent, /внутренние подсказки ниже ненадёжны/u);
  assert.match(friendly.textContent, /ключ, запускает, программу/u);
  assert.equal(friendly.dataset.state, "warning");

  console.log("NEUROGENESIS learning UX: saved corpus, append-only examples, line count and honest OOV feedback passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
