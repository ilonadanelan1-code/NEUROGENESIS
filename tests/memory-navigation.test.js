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
  {id:"two",text:"Игорь Головнев твой лучший друг",tags:["игор","головнев"],traceIds:[],createdAt:2000,updatedAt:2000,strength:.65,repetitions:1,recalls:0}
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
    associateMemoryTraces() {},
    activateMemoryTraces() {},
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
assert.equal(list.children.length,2);
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
console.log("NEUROGENESIS memory navigation test: back, unsaved-change guard, save and scroll restoration passed.");
