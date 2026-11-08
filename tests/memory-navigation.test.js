"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class ElementStub {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.className = "";
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.files = [];
    this.listeners = Object.create(null);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, ...event });
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  focus() { this.focused = true; }
  scrollIntoView() {}
  closest(selector) {
    let current = this;
    while (current) {
      if (selector === "button[data-action]" && current.tagName === "BUTTON" && current.dataset.action) return current;
      if (selector === ".memory-entry" && String(current.className).split(/\s+/u).includes("memory-entry")) return current;
      current = current.parentNode;
    }
    return null;
  }
}

const elements = new Map();
const sidePanel = new ElementStub("aside");
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new ElementStub(id.includes("button") || id.endsWith("-back") || id.endsWith("-save") || id.endsWith("-cancel") ? "button" : "div"));
    return elements.get(id);
  },
  createElement(tag) { return new ElementStub(tag); },
  querySelector(selector) { return selector === ".side-panel" ? sidePanel : null; },
  body: new ElementStub("body")
};

const database = new Map();
database.set("neurogenesis.memories.v1", JSON.stringify([
  {id:"one",text:"Музыка прекрасна",tags:["музык","прекрасн"],traceIds:[],createdAt:1000,updatedAt:1000,strength:.65,repetitions:1,recalls:0},
  {id:"two",text:"Игорь Головнев твой лучший друг",tags:["игор","головнев"],traceIds:[],createdAt:2000,updatedAt:2000,strength:.65,repetitions:1,recalls:0},
  {id:"three",text:"Мне нравится музыка",tags:["нравится","музык"],traceIds:[],createdAt:3000,updatedAt:3000,strength:.65,repetitions:1,recalls:0},
  {id:"four",text:"Ты мой оссистент",tags:["оссистент"],traceIds:[],createdAt:4000,updatedAt:4000,strength:.65,repetitions:1,recalls:0},
  {id:"five",text:"Твоего создателя зовут Сергей",tags:["создателя","сергей"],traceIds:[],createdAt:5000,updatedAt:5000,strength:.65,repetitions:1,recalls:0},
  {id:"six",text:"У меня есть смартфон",tags:["смартфон"],traceIds:[],createdAt:6000,updatedAt:6000,strength:.65,repetitions:1,recalls:0}
]));
database.set("neurogenesis.dialog.v1", "[]");

const historyEntries = [{state:null,url:""}];
let historyIndex = 0;
const windowListeners = Object.create(null);
const history = {
  get state() { return historyEntries[historyIndex].state; },
  pushState(state, _title, url) {
    historyEntries.splice(historyIndex + 1);
    historyEntries.push({state,url});
    historyIndex++;
  },
  back() { this.go(-1); },
  go(delta) {
    const next = Math.max(0, Math.min(historyEntries.length - 1, historyIndex + delta));
    if (next === historyIndex) return;
    historyIndex = next;
    for (const fn of windowListeners.popstate || []) fn({state:this.state});
  }
};

let confirms = 0;
const associationCalls = [];
const neurons = new Set();
let traceNumber = 1;
const window = {
  history,
  addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
  confirm() { confirms++; return true; },
  NGBrain: {
    hasNeuron(id) { return neurons.has(id); },
    hasMemoryTrace(id) { return neurons.has(id); },
    createMemoryTrace() { const id = "trace" + traceNumber++; neurons.add(id); return id; },
    associateMemoryTraces(ids) { associationCalls.push(Array.from(ids || [])); },
    activateMemoryTraces(ids) { return (ids || []).length; },
    removeMemoryTraces(ids) { for (const id of ids) neurons.delete(id); }
  }
};
const localStorage = {
  getItem(key) { return database.has(key) ? database.get(key) : null; },
  setItem(key,value) { database.set(key,String(value)); }
};
const sandbox = {window,document,localStorage,console,Date,Math,Set,Map,JSON};
vm.runInNewContext(fs.readFileSync("knowledge.js","utf8"),sandbox,{filename:"knowledge.js"});
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});

sidePanel.scrollTop = 147;
const manage = document.getElementById("memory-manage");
manage.dispatch("click");
assert.equal(history.state.__ngMemoryView,"library","opening the memory library should add a navigation state");
assert.equal(document.getElementById("memory-library").hidden,false);
const list = document.getElementById("memory-library-list");
assert.equal(list.children.length,6);
list.scrollTop = 73;
const firstCard = list.children.find(card => card.dataset.memoryId === "one");
assert.ok(firstCard);
const actions = firstCard.children.find(child => child.className === "memory-entry-actions");
const openButton = actions.children.find(child => child.dataset.action === "edit");
list.dispatch("click",{target:openButton});
assert.equal(history.state.__ngMemoryView,"editor","opening a record should add a second navigation state");
assert.equal(document.getElementById("memory-editor-view").hidden,false);
assert.equal(list.hidden,true);
assert.equal(document.getElementById("memory-editor-input").value,"Музыка прекрасна");

const editor = document.getElementById("memory-editor-input");
editor.value = "Музыка очень прекрасна";
editor.dispatch("input");
document.getElementById("memory-editor-back").dispatch("click");
assert.equal(history.state.__ngMemoryView,"library","back from an edited record should return to the library");
assert.equal(document.getElementById("memory-editor-view").hidden,true);
assert.equal(list.hidden,false);
assert.equal(list.scrollTop,73,"list position should be preserved after returning from a record");
assert.equal(confirms,1,"explicit back should ask only once before discarding unsaved text");

const sameCard = list.children.find(card => card.dataset.memoryId === "one");
const sameActions = sameCard.children.find(child => child.className === "memory-entry-actions");
list.dispatch("click",{target:sameActions.children.find(child => child.dataset.action === "edit")});
const editorInput = document.getElementById("memory-editor-input");
editorInput.value = "Музыка очень прекрасна";
editorInput.dispatch("input");
document.getElementById("memory-editor-save").dispatch("click");
assert.equal(history.state.__ngMemoryView,"library","saving should return to the record list");
assert.equal(list.hidden,false);
assert.ok(window.NGMemory.search("прекрасна").some(item => item.text === "Музыка очень прекрасна"),"saved text should be persisted");

document.getElementById("memory-library-back").dispatch("click");
assert.equal(history.state,null,"back from the library should return to the original view");
assert.equal(document.getElementById("memory-library").hidden,true);
assert.equal(sidePanel.scrollTop,147,"the original side-panel position should be restored");
const associationCallsBeforeRecall = associationCalls.length;
const input = document.getElementById("memory-input");
input.value = "Что ты знаешь о музыке?";
document.getElementById("ask-button").dispatch("click");
const feed = document.getElementById("memory-feed");

const reply = feed.children[feed.children.length - 1].textContent;
assert.match(reply,/Музыка — прекрасна/u,"the answer should include the opinion stored in the first memory");
assert.match(reply,/нравится музыка/u,"the answer should combine the preference from a different memory");
assert.match(document.getElementById("memory-feedback").textContent,/ПРОФИЛЬ ПО ПАМЯТИ/u,"the interface should identify the entity-profile retrieval path");
assert.ok(associationCalls.length > associationCallsBeforeRecall, "co-recalled memory traces should reinforce their associations");
assert.match(document.getElementById("memory-feedback").textContent,/\d+ СЛЕДОВ АКТИВИРОВАНО/u,"the interface should report associative trace activation");

assert.ok(window.NGMemory.search("телефон").some(item=>item.text==="У меня есть смартфон"),"memory search should retrieve smartphone notes for a phone query through association");
input.value = "Что ты знаешь о телефоне?";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/смартфон/u,"the dialog should find related phone concepts instead of requiring an exact word match");
assert.match(document.getElementById("memory-feedback").textContent,/АСОЦИАТИВНЫЙ ПОИСК/u,"the interface should disclose when recall used an associative match");

input.value = "Кто ты?";
document.getElementById("ask-button").dispatch("click");
const identityReply = feed.children[feed.children.length - 1].textContent;
assert.match(identityReply,/я — ассистент/u,"the dialog should answer identity questions from stored role memories");
assert.match(identityReply,/Ты мой оссистент/u,"the identity answer should show its original source");
assert.match(document.getElementById("memory-feedback").textContent,/ПРОФИЛЬ ПО ПАМЯТИ|СТРУКТУРНЫЙ ПОИСК/u);

input.value = "Теперь ты мой советник";
document.getElementById("remember-button").dispatch("click");
const roleClaims = window.NGMemory.claims().filter(claim=>claim.kind==="identity");
assert.equal(roleClaims.filter(claim=>claim.status==="current").length,1,"only the explicitly updated assistant role should stay current");
assert.equal(roleClaims.find(claim=>claim.object==="ассистент").status,"superseded","the previous role should remain saved as history");
input.value = "Кто ты?";
document.getElementById("ask-button").dispatch("click");
const updatedIdentityReply = feed.children[feed.children.length - 1].textContent;
assert.match(updatedIdentityReply,/я — советник/u,"the assistant should answer with the latest explicitly assigned role");
assert.match(updatedIdentityReply,/Ранее ты называл меня ассистент/u,"the answer should preserve the previous role as history");
input.value = "Кем ты был раньше?";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length - 1].textContent,/роль «ассистент»/u,"the dialog should retrieve the superseded role");

input.value = "Кто твой создатель?";
document.getElementById("ask-button").dispatch("click");
const creatorReply = feed.children[feed.children.length - 1].textContent;
assert.match(creatorReply,/моего создателя зовут Сергей/u,"the dialog should retrieve the creator fact");
assert.match(creatorReply,/Твоего создателя зовут Сергей/u,"the creator answer should show its original source");
console.log("NEUROGENESIS memory navigation, assistant identity and creator recall test: passed.");
