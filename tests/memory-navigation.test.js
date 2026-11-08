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

input.value = "Я живу в Сочи";
document.getElementById("remember-button").dispatch("click");
input.value = "Теперь я живу в Париже";
document.getElementById("remember-button").dispatch("click");
const locationClaims = window.NGMemory.claims().filter(claim=>claim.kind==="fact"&&claim.subject==="user"&&/живу в|нахожусь в/u.test(claim.predicate));
assert.equal(locationClaims.find(claim=>claim.object==="Сочи").status,"superseded","a previously saved location should become historical after an explicit update");
assert.equal(locationClaims.find(claim=>claim.object==="Париже").status,"current","the corrected location should become current");
input.value = "Где я живу?";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/живёшь в Париже/u,"the dialog should answer with the current location");
input.value = "Что ты знаешь обо мне?";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/Сочи/u,"the user profile should preserve the historical location");
assert.match(feed.children[feed.children.length-1].textContent,/историческое самоописание/u,"the user profile should label the old location as historical");

input.value = "Кто твой создатель?";
document.getElementById("ask-button").dispatch("click");
const creatorReply = feed.children[feed.children.length - 1].textContent;
assert.match(creatorReply,/моего создателя зовут Сергей/u,"the dialog should retrieve the creator fact");
assert.match(creatorReply,/Твоего создателя зовут Сергей/u,"the creator answer should show its original source");

input.value = "Недостаток сна может приводить к усталости";
document.getElementById("remember-button").dispatch("click");
input.value = "Усталость приводит к снижению концентрации";
document.getElementById("remember-button").dispatch("click");
input.value = "Как недостаток сна влияет на снижение концентрации?";
document.getElementById("ask-button").dispatch("click");
const causalReply=feed.children[feed.children.length-1].textContent;
assert.match(causalReply,/Недостаток сна → усталости → снижению концентрации/u,"the dialog should derive a two-step causal chain from separate memories");
assert.match(causalReply,/Исходные записи:/u,"the inference should expose its exact source memories");
assert.match(causalReply,/не проверял причинность независимо/u,"the inference must not be presented as a proven fact");
assert.match(document.getElementById("memory-feedback").textContent,/ПРИЧИННАЯ ЦЕПОЧКА/u,"the interface should disclose when a causal inference was used");
input.value = "Обезвоживание может приводить к усталости";
document.getElementById("remember-button").dispatch("click");
input.value = "Почему возникает усталость?";
document.getElementById("ask-button").dispatch("click");
const alternativesReply=feed.children[feed.children.length-1].textContent;
assert.match(alternativesReply,/несколько возможных объяснений/u,"the dialog should disclose competing causal explanations");
assert.match(alternativesReply,/Обезвоживание → усталости/u,"the alternative explanation should cite its causal route");
assert.match(document.getElementById("memory-feedback").textContent,/АЛЬТЕРНАТИВНЫЕ ОБЪЯСНЕНИЯ/u,"the interface should label multi-cause answers");
input.value = "Если недостаток сна, то усталость";
document.getElementById("remember-button").dispatch("click");
input.value = "При недостатке сна не наблюдалась усталость";
document.getElementById("remember-button").dispatch("click");

const storedDialogAfterFirstReview=JSON.parse(database.get("neurogenesis.dialog.v1"));
assert.ok(storedDialogAfterFirstReview.some(item=>item.reasoning&&item.reasoning.type==="causal_chain"),"causal conclusions should persist their structured source links");
assert.match(feed.children[feed.children.length-1].textContent,/ПЕРЕСМОТР ПРЕЖНЕГО ВЫВОДА/u,"a newly stored counterexample should automatically trigger review of an earlier causal conclusion");
assert.match(feed.children[feed.children.length-1].textContent,/При недостатке сна не наблюдалась усталость/u,"the review should cite the exact new observation");

input.value = "Проверь гипотезу: если недостаток сна, то усталость";
document.getElementById("ask-button").dispatch("click");
const hypothesisCheckReply=feed.children[feed.children.length-1].textContent;
assert.match(hypothesisCheckReply,/Потенциальные контрпримеры/u,"the dialog should identify a stored observation that challenges the rule");
assert.match(hypothesisCheckReply,/При недостатке сна не наблюдалась усталость/u,"the check should cite the exact observation");
assert.match(hypothesisCheckReply,/Что ещё нужно для проверки/u,"the answer should identify missing evidence");
assert.match(document.getElementById("memory-feedback").textContent,/КОНТРПРИМЕР В ПАМЯТИ/u,"the interface should identify a counterexample-based hypothesis check");
input.value = "Как различить причины усталости?";
document.getElementById("ask-button").dispatch("click");
const experimentPlanReply=feed.children[feed.children.length-1].textContent;
assert.match(experimentPlanReply,/План различающей проверки/u,"the dialog should build a plan for comparing alternative causes");
assert.match(experimentPlanReply,/Недостаток сна/u);
assert.match(experimentPlanReply,/Обезвоживание/u);
assert.match(experimentPlanReply,/Не нужно специально создавать вредные условия/u,"the plan should recommend only safe observations");
assert.match(document.getElementById("memory-feedback").textContent,/ПЛАН СРАВНЕНИЯ ГИПОТЕЗ/u);
input.value = "Выведи новые гипотезы из памяти";
document.getElementById("ask-button").dispatch("click");
const derivedReply=feed.children[feed.children.length-1].textContent;
assert.match(derivedReply,/Недостаток сна ⇢ снижению концентрации/u,"the dialog should derive a candidate connection from two causal memories");
assert.match(derivedReply,/Обезвоживание ⇢ снижению концентрации/u,"the dialog should derive other mediated candidate connections");
assert.match(derivedReply,/не добавлены в долговременную память/u,"derived candidates must remain proposals, not silently become memories");
assert.match(derivedReply,/ПРЕДВАРИТЕЛЬНАЯ САМОПРОВЕРКА/u,"a new conclusion must audit counterexamples that were already stored");
assert.match(derivedReply,/При недостатке сна не наблюдалась усталость/u,"the initial review should cite the pre-existing counterexample");
const dialogAfterDerived=JSON.parse(database.get("neurogenesis.dialog.v1"));
const derivedEntry=dialogAfterDerived.filter(item=>item.role==="assistant"&&item.reasoning&&item.reasoning.type==="derived_hypotheses").slice(-1)[0];
assert.equal(derivedEntry.reasoning.status,"challenged","a conclusion with a pre-existing counterexample should start in challenged status");
assert.ok(derivedEntry.reasoning.reviews.some(item=>item.kind==="counterexample"&&item.phase==="baseline"&&/При недостатке сна не наблюдалась усталость/u.test(item.evidence)),"pre-existing evidence should be recorded as baseline evidence");
assert.match(document.getElementById("memory-feedback").textContent,/НОВЫЕ ГИПОТЕЗЫ/u);

input.value = "Какую гипотезу проверять первой?";
document.getElementById("ask-button").dispatch("click");
const priorityReply=feed.children[feed.children.length-1].textContent;
assert.match(priorityReply,/ПРИОРИТЕТ 1/u,"the dialog should prioritize a candidate with a potential counterexample for clarification");
assert.match(priorityReply,/При недостатке сна не наблюдалась усталость/u,"the priority should cite the user's exact counterexample");
assert.match(priorityReply,/Обезвоживание ⇢ снижению концентрации/u,"the other derived hypothesis should remain visible for comparison");
assert.match(priorityReply,/Общее звено между несколькими гипотезами/u,"the dialog should disclose shared evidence instead of counting it twice");
assert.match(document.getElementById("memory-feedback").textContent,/ПРИОРИТЕТ · ЕСТЬ КОНТРПРИМЕР/u,"the interface should label a hypothesis-prioritization answer");


input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
const modelReply=feed.children[feed.children.length-1].textContent;
assert.match(modelReply,/ПЕРЕСМОТРЕННАЯ ПРИЧИННАЯ МОДЕЛЬ/u,"the app should build a revised causal model from tracked conclusions");
assert.match(modelReply,/Недостаток сна → усталости — ПОД ВОПРОСОМ/u,"the model should mark the specific contradicted edge");
assert.match(modelReply,/Усталость → снижению концентрации — НЕТ ОТДЕЛЬНЫХ НАБЛЮДЕНИЙ/u,"the model should preserve uncertainty for unobserved edges");
assert.match(modelReply,/Альтернативного маршрута от исходного понятия/u,"the model must not invent a substitute route when no route exists");
assert.match(modelReply,/Обезвоживание ⇢ снижению концентрации/u,"the second candidate remains visible as a competing hypothesis");
assert.doesNotMatch(modelReply,/ОТДЕЛЬНЫЕ МАРШРУТЫ К ТОМУ ЖЕ РЕЗУЛЬТАТУ/u,"already listed hypotheses must not be repeated as new parallel routes");
assert.doesNotMatch(modelReply,/2\. Недостаток сна ⇢ усталости/u,"a direct edge already contained in a longer derived path should not be duplicated as a separate conclusion");
assert.doesNotMatch(modelReply,/Обезвоживание ⇢ усталости/u,"a shorter edge already contained in a longer derived path should not be duplicated as a separate conclusion");
assert.match(modelReply,/ВАРИАНТЫ ПЕРЕСМОТРА СПОРНЫХ СВЯЗЕЙ/u,"the model should propose multiple revision strategies");
assert.match(modelReply,/Сохранить связь как условную/u,"one strategy should retain the edge as conditional");
assert.match(modelReply,/Ослабить общее утверждение/u,"one strategy should weaken an overgeneralized claim");
assert.match(modelReply,/Временно не использовать связь в прогнозах/u,"one strategy should suspend a disputed edge without deleting it");
assert.ok(modelReply.length>1800,"the model revision report should preserve all revision alternatives instead of truncating them");
assert.match(modelReply,/Предлагаемая модель: Не считать/u,"the second alternative should be fully present in the response");
assert.match(modelReply,/Решать, возвращать ли звено в активную модель/u,"the third alternative should include its distinguishing criterion");
assert.match(modelReply,/Что поможет различить варианты/u,"each strategy should identify discriminating information");
assert.match(modelReply,/НЕПРОВЕРЕННЫЕ ЗВЕНЬЯ/u,"unobserved edges should be shown separately");
assert.match(modelReply,/Не нужно намеренно создавать вредные условия/u,"the strategy should not encourage harmful experiments");
assert.match(document.getElementById("memory-feedback").textContent,/ПЕРЕСТРОЙКА ПРИЧИННОЙ МОДЕЛИ/u);
const modelDialog=JSON.parse(database.get("neurogenesis.dialog.v1"));
const modelEntry=modelDialog.filter(item=>item.role==="assistant"&&item.text.includes("ПЕРЕСМОТРЕННАЯ ПРИЧИННАЯ МОДЕЛЬ")).slice(-1)[0];
const tracked=modelDialog.filter(item=>item.role==="assistant"&&item.reasoning&&item.reasoning.type==="derived_hypotheses").slice(-1)[0];
assert.ok(tracked.reasoning.modelHistory.length>0,"model revision snapshots should be stored in the reasoning history");
assert.ok(tracked.reasoning.modelHistory[0].edges.some(edge=>edge.status==="challenged"),"model history should preserve the challenged edge state");
assert.equal(tracked.reasoning.modelHistory[0].edges.find(edge=>edge.status==="challenged").revisionOptions.length,3,"three bounded revision options should be stored with the challenged edge");
assert.ok(modelEntry,"the model revision answer should be part of the exported dialogue");
const memoriesBeforeModel=JSON.stringify(window.NGMemory.claims());
input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
assert.equal(JSON.stringify(window.NGMemory.claims()),memoriesBeforeModel,"building a revised causal model must not rewrite the original memories");
const snapshotCount=tracked.reasoning.modelHistory.length;
assert.equal(snapshotCount,1,"the first identical model snapshot should be stored once");
input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
const repeatedTracked=JSON.parse(database.get("neurogenesis.dialog.v1")).filter(item=>item.role==="assistant"&&item.reasoning&&item.reasoning.type==="derived_hypotheses").slice(-1)[0];
assert.equal(repeatedTracked.reasoning.modelHistory.length,snapshotCount,"repeating an unchanged review must not create duplicate snapshots");

// Choosing a revision strategy changes only the working model, not source memories.
const originalClaimsBeforeChoice=JSON.stringify(window.NGMemory.claims());
input.value = "Выбираю вариант 3";
document.getElementById("ask-button").dispatch("click");
const choiceReply=feed.children[feed.children.length-1].textContent;
assert.match(choiceReply,/РЕШЕНИЕ ПРИМЕНЕНО К РАБОЧЕЙ ПРИЧИННОЙ МОДЕЛИ/u,"the app should accept a revision choice when exactly one challenged edge exists");
assert.match(choiceReply,/Недостаток сна → усталости/u);
assert.equal(JSON.stringify(window.NGMemory.claims()),originalClaimsBeforeChoice,"a model revision decision must never rewrite source memories");
const storedDecisions=JSON.parse(database.get("neurogenesis.model-decisions.v1"));
assert.equal(storedDecisions.at(-1).strategy,"suspend","the selected third option should be persisted separately from memories");
input.value = "Выведи новые гипотезы из памяти";
document.getElementById("ask-button").dispatch("click");
const suspendedHypotheses=feed.children[feed.children.length-1].textContent;
assert.match(suspendedHypotheses,/Прежняя гипотеза Недостаток сна ⇢ снижению концентрации сейчас не строится/u,
  "a suspended historical hypothesis should be explicitly identified as excluded from the active model");
assert.doesNotMatch(suspendedHypotheses,/Возможный путь: Недостаток сна → Усталость → снижению концентрации/u,
  "a suspended causal edge must not be used as an active route in new derived hypotheses");
assert.match(suspendedHypotheses,/Обезвоживание ⇢ снижению концентрации/u,"other available paths should remain usable");
assert.match(suspendedHypotheses,/РЕШЕНИЯ РАБОЧЕЙ ПРИЧИННОЙ МОДЕЛИ/u,"derived answers should disclose the active model decision");
input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/ПРИОСТАНОВЛЕНО В РАБОЧЕЙ МОДЕЛИ/u,"the model report should show a suspended edge explicitly");
input.value = "Верни связь Недостаток сна → усталости в рабочую модель";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/возвращена в активную рабочую модель/u,"the user should be able to restore a previously suspended edge");
assert.equal(window.NGMemory.modelDecisions().at(-1).strategy,"restore","restoration should be stored as a separate model decision");
input.value = "Выведи новые гипотезы из памяти";
document.getElementById("ask-button").dispatch("click");
const restoredHypotheses=feed.children[feed.children.length-1].textContent;
assert.match(restoredHypotheses,/Недостаток сна ⇢ снижению концентрации/u,"a restored edge should participate in future candidate generation again");
assert.match(restoredHypotheses,/Обезвоживание ⇢ снижению концентрации/u,"restoring one edge should not disturb the other candidate path");


input.value = "Перегрузка приводит к снижению концентрации";
document.getElementById("remember-button").dispatch("click");
input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
const modelWithThirdCause=feed.children[feed.children.length-1].textContent;
const thirdRouteSection=modelWithThirdCause.split("ОТДЕЛЬНЫЕ МАРШРУТЫ К ТОМУ ЖЕ РЕЗУЛЬТАТУ")[1]||"";
assert.match(thirdRouteSection,/Перегрузка → снижению концентрации/u,"a genuinely new source should still be reported as a separate parallel route");
assert.doesNotMatch(thirdRouteSection,/Обезвоживание → усталости → снижению концентрации/u,"an existing tracked hypothesis must not be echoed as a new route");

input.value = "Усталость не приводит к снижению концентрации";
document.getElementById("remember-button").dispatch("click");
const lateRevisionReply=feed.children[feed.children.length-1].textContent;
assert.match(lateRevisionReply,/ПЕРЕСМОТР ПРЕЖНЕГО ВЫВОДА/u,"a new explicit negative causal claim should mark a previous derived hypothesis as challenged");
assert.match(lateRevisionReply,/Усталость не приводит к снижению концентрации/u,"the revision notice should quote the new opposing claim");
input.value = "Какие прежние выводы требуют пересмотра?";
document.getElementById("ask-button").dispatch("click");
const auditReply=feed.children[feed.children.length-1].textContent;
assert.match(auditReply,/ПРОВЕРКА ИСТОРИИ ВЫВОДОВ/u);
assert.match(auditReply,/Выводы, требующие пересмотра/u);
assert.match(auditReply,/Недостаток сна ⇢ снижению концентрации/u);
assert.match(auditReply,/Обезвоживание ⇢ снижению концентрации/u,"a contradiction in a shared causal link should mark every dependent hypothesis for review");
assert.match(auditReply,/Уже было в памяти при создании вывода/u,"the audit should distinguish evidence that predates the conclusion");
assert.match(auditReply,/Появилось после создания вывода/u,"the audit should distinguish evidence added after the conclusion");
const legacyDialog=JSON.parse(database.get("neurogenesis.dialog.v1"));
const legacyDerived=legacyDialog.filter(item=>item.role==="assistant"&&item.reasoning&&item.reasoning.type==="derived_hypotheses").slice(-1)[0];
legacyDerived.reasoning.reviews=[];
legacyDerived.reasoning.status="current";
database.set("neurogenesis.dialog.v1",JSON.stringify(legacyDialog));
input.value = "Какие прежние выводы требуют пересмотра?";
document.getElementById("ask-button").dispatch("click");
const backfilledAudit=feed.children[feed.children.length-1].textContent;
assert.match(backfilledAudit,/Уже было в памяти при создании вывода/u,"legacy 0.23 reasoning metadata should be backfilled from stored memory");
assert.match(backfilledAudit,/Появилось после создания вывода/u,"legacy audit should reconstruct post-conclusion evidence too");
assert.match(document.getElementById("memory-feedback").textContent,/САМОПРОВЕРКА/u);
input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
const postConflictModel=feed.children[feed.children.length-1].textContent;
const alternateSection=postConflictModel.split("ОТДЕЛЬНЫЕ МАРШРУТЫ К ТОМУ ЖЕ РЕЗУЛЬТАТУ")[1]||"";
assert.doesNotMatch(alternateSection,/Обезвоживание → усталости → снижению концентрации/u,"an alternate route must not reuse a shared edge that has since been opposed");
const latestTracked=JSON.parse(database.get("neurogenesis.dialog.v1")).filter(item=>item.role==="assistant"&&item.reasoning&&item.reasoning.type==="derived_hypotheses").slice(-1)[0];
assert.ok(latestTracked.reasoning.modelHistory.length>=2,"a materially changed model state should append a new historical snapshot");
assert.ok(latestTracked.reasoning.modelHistory.at(-1).edges.some(edge=>window.NGKnowledge.sameEntity(edge.subject,"Усталость")&&window.NGKnowledge.sameEntity(edge.object,"снижению концентрации")&&edge.status==="challenged"),"the new opposing claim should appear as a changed edge state in model history");





// Durable reasoning history survives visible-dialog truncation, and unchanged audits are deterministic.
for(let i=0;i<7;i++) {
  input.value = "Привет";
  document.getElementById("ask-button").dispatch("click");
}
assert.ok(window.NGMemory.reasoningHistory().length>=2,"structured conclusions should remain in the durable archive after the dialogue rolls over");
assert.ok(JSON.parse(database.get("neurogenesis.reasoning-archive.v1")).length>=2,"the durable reasoning archive should be persisted independently");
input.value = "Какие прежние выводы требуют пересмотра?";
document.getElementById("ask-button").dispatch("click");
const stableAuditA=feed.children[feed.children.length-1].textContent;
input.value = "Какие прежние выводы требуют пересмотра?";
document.getElementById("ask-button").dispatch("click");
const stableAuditB=feed.children[feed.children.length-1].textContent;
assert.equal(stableAuditA,stableAuditB,"repeating an audit against unchanged memory should produce the same report");
assert.match(stableAuditA,/Недостаток сна ⇢ снижению концентрации/u,"the audit should include older conclusions retained outside the short dialogue");

input.value = "При недостатке сна наблюдалась усталость";
document.getElementById("remember-button").dispatch("click");
const positiveObservation=window.NGMemory.claims().find(claim=>claim.kind==="observation"&&claim.polarity!==false&&
  window.NGKnowledge.sameEntity(claim.subject,"недостатке сна")&&window.NGKnowledge.sameEntity(claim.object,"усталости"));
assert.ok(positiveObservation,"the new observation should be structurally extracted");
const evidenceEvents=window.NGMemory.modelEvidence();
assert.ok(evidenceEvents.some(item=>item.direction==="supporting"&&
  window.NGKnowledge.sameEntity(item.edgeSubject,"Недостаток сна")&&window.NGKnowledge.sameEntity(item.edgeObject,"усталости")),
  "new supporting evidence should be matched to the previously revised edge");
assert.match(feed.children[feed.children.length-1].textContent,/НОВЫЕ СВИДЕТЕЛЬСТВА ДЛЯ ПЕРЕСМОТРА РЕШЕНИЯ/u,
  "the app should explain that new evidence may justify reviewing an old decision");
assert.equal(window.NGMemory.modelDecisions().find(item=>window.NGKnowledge.sameEntity(item.edgeSubject,"Недостаток сна")&&
  window.NGKnowledge.sameEntity(item.edgeObject,"усталости")).strategy,"restore",
  "new evidence must not silently rewrite the user's selected model decision");
const evidenceCountBeforeRepeat=window.NGMemory.modelEvidence().length;
input.value = "При недостатке сна наблюдалась усталость";
document.getElementById("remember-button").dispatch("click");
assert.equal(window.NGMemory.modelEvidence().length,evidenceCountBeforeRepeat,
  "repeating the same observation should not be counted as independent new evidence");
assert.doesNotMatch(feed.children[feed.children.length-1].textContent,/НОВЫЕ СВИДЕТЕЛЬСТВА ДЛЯ ПЕРЕСМОТРА РЕШЕНИЯ/u,
  "a repeated observation should not trigger another new-evidence notice");
assert.ok(JSON.parse(database.get("neurogenesis.model-evidence.v1")).length>=1,
  "new model-evidence events should persist separately from memories and decisions");


// Goal-directed inquiry creates source-linked questions, avoids duplicates and stores attributed answers.
input.value = "Найди пробелы в знаниях";
document.getElementById("ask-button").dispatch("click");
const inquiryReport=feed.children[feed.children.length-1].textContent;
assert.match(inquiryReport,/ПОИСК ПРОБЕЛОВ ЗАВЕРШЁН/u);
const openInquiry=window.NGMemory.inquiries().find(item=>item.status==="open");
assert.ok(openInquiry,"causal archive should produce a targeted open question");
assert.ok(openInquiry.sourceClaimIds.length>0,"questions should retain source-claim links");
assert.match(openInquiry.question,/наблюден|услови/u,"question should identify a knowledge gap");
const inquiryCountBefore=window.NGMemory.inquiries().length;
input.value = "Найди пробелы в знаниях";
document.getElementById("ask-button").dispatch("click");
assert.equal(window.NGMemory.inquiries().length,inquiryCountBefore,"repeated discovery must not duplicate questions");
input.value = "Ответ на вопрос "+openInquiry.id+": Наблюдение было сделано вечером, результат оценивался по самочувствию.";
document.getElementById("remember-button").dispatch("click");
const answeredInquiry=window.NGMemory.inquiries().find(item=>item.id===openInquiry.id);
assert.equal(answeredInquiry.status,"answered","explicitly prefixed answer should attach to the inquiry");
assert.equal(answeredInquiry.responseText,"Наблюдение было сделано вечером, результат оценивался по самочувствию.");
assert.ok(["context_reported_unverified","observations_reported_unverified"].includes(answeredInquiry.assessment),
  "a response with descriptive details should be classified conservatively");
assert.ok(answeredInquiry.assessmentReason,"an answer assessment should explain its classification");
assert.ok(answeredInquiry.responseMemoryId,"answer should link to its saved memory");
assert.ok(JSON.parse(database.get("neurogenesis.inquiries.v1")).some(item=>item.id===openInquiry.id&&item.status==="answered"),
  "inquiry answer provenance should persist");
input.value = "Какие вопросы открыты?";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/ПОЛУЧЕННЫЕ ОТВЕТЫ/u);
assert.match(feed.children[feed.children.length-1].textContent,new RegExp(openInquiry.id));

// Long inquiry answers must remain intact and must not turn quoted prior claims into new causal facts.
const secondOpenInquiry=window.NGMemory.inquiries().find(item=>item.status==="open");
assert.ok(secondOpenInquiry,"the queue should retain additional unresolved research questions");
const fullInquiryAnswer="Ответ на вопрос "+secondOpenInquiry.id+": В моей памяти нет конкретных естественных наблюдений, которые непосредственно проверяли бы эту связь. Есть только исходное причинное утверждение.";
input.value=fullInquiryAnswer;
document.getElementById("remember-button").dispatch("click");
const secondAnswered=window.NGMemory.inquiries().find(item=>item.id===secondOpenInquiry.id);
const answerBody=fullInquiryAnswer.replace(/^Ответ на вопрос Q\d+:\s*/u,"");
assert.equal(secondAnswered.status,"answered");
assert.equal(secondAnswered.responseText,answerBody,"the inquiry record should retain every sentence of the user's answer");
assert.equal(secondAnswered.assessment,"gap_confirmed","a direct answer saying no observations exist should confirm only the data gap");
assert.match(secondAnswered.assessmentReason,/отсутствии прямых наблюдений/u);
const savedAnswerMemory=JSON.parse(database.get("neurogenesis.memories.v1")).find(item=>item.id===secondAnswered.responseMemoryId);
assert.ok(savedAnswerMemory,"the full answer should retain a memory reference");
assert.equal(savedAnswerMemory.text,fullInquiryAnswer,"a multi-sentence inquiry answer should be stored as one complete memory");
assert.equal(savedAnswerMemory.claims.length,0,"quoted or discussed claims inside an inquiry answer must not become asserted facts");
input.value = "Построй обновлённую причинную модель";
document.getElementById("ask-button").dispatch("click");
assert.match(feed.children[feed.children.length-1].textContent,/УЧЁТ ИССЛЕДОВАТЕЛЬСКИХ ОТВЕТОВ/u,
  "the revised causal model should explicitly account for inquiry assessments");

// Legacy 0.29 backups can recover the full answer from their user transcript.
const savedInquiries=JSON.parse(database.get("neurogenesis.inquiries.v1"));
const legacyInquiry=savedInquiries.find(item=>item.id===secondOpenInquiry.id);
legacyInquiry.responseText=answerBody.split(".")[0]+".";
database.set("neurogenesis.inquiries.v1",JSON.stringify(savedInquiries));
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
const repairedInquiry=window.NGMemory.inquiries().find(item=>item.id===secondOpenInquiry.id);
assert.equal(repairedInquiry.responseText,answerBody,"legacy partial inquiry answers should be repaired from the retained dialogue transcript");
assert.equal(repairedInquiry.assessment,"gap_confirmed","legacy assessments should be reconstructed from restored full responses");
input.value = "Оцени ответы на вопросы";
document.getElementById("ask-button").dispatch("click");
const inquiryAssessment=feed.children[feed.children.length-1].textContent;
assert.match(inquiryAssessment,/ОЦЕНКА ИССЛЕДОВАТЕЛЬСКИХ ОТВЕТОВ/u);
assert.match(inquiryAssessment,/отсутствие наблюдений отмечено/u);
// Research-aware hypothesis generation uses inquiry answers and current model decisions,
// while preserving archived hypotheses instead of calling them disproven.
const researchFixtureMemories=[
  {id:"sleep",text:"Недостаток сна может приводить к усталости",createdAt:1},
  {id:"fatigue",text:"Усталость приводит к снижению концентрации",createdAt:2},
  {id:"hydration",text:"Обезвоживание может приводить к усталости",createdAt:3},
  {id:"counter",text:"При недостатке сна не наблюдалась усталость",createdAt:4},
  {id:"support",text:"При недостатке сна наблюдалась усталость",createdAt:5}
];
const archivedResearchConclusion={
  version:1,type:"derived_hypotheses",createdAt:10,status:"challenged",
  conclusions:[
    {subject:"Недостаток сна",object:"снижению концентрации",paths:[[
      {id:"sleep-edge",subject:"Недостаток сна",object:"усталости"},
      {id:"fatigue-edge",subject:"Усталость",object:"снижению концентрации"}
    ]]},
    {subject:"Обезвоживание",object:"снижению концентрации",paths:[[
      {id:"hydration-edge",subject:"Обезвоживание",object:"усталости"},
      {id:"fatigue-edge",subject:"Усталость",object:"снижению концентрации"}
    ]]}
  ],reviews:[]
};
database.set("neurogenesis.memories.v1",JSON.stringify(researchFixtureMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.model-decisions.v1",JSON.stringify([
  {edgeSubject:"Недостаток сна",edgeObject:"усталости",strategy:"suspend",at:20,claimIds:["counter"]}
]));
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.reasoning-archive.v1",JSON.stringify([
  {role:"assistant",time:10,text:"Архивная гипотеза",reasoning:archivedResearchConclusion}
]));
database.set("neurogenesis.inquiries.v1",JSON.stringify([
  {id:"Q1",signature:"q1",kind:"contrast_observations",edgeSubject:"Недостаток сна",edgeObject:"усталости",
    question:"Уточни обстоятельства двух наблюдений.",reason:"Есть противоположные наблюдения.",priority:0,status:"answered",
    sourceClaimIds:["counter","support"],createdAt:15,updatedAt:21,lastAskedAt:16,
    responseText:"Обстоятельства двух наблюдений неизвестны; контекст не указан.",
    responseMemoryId:"",responseClaimIds:[],answeredAt:21,assessment:"insufficient_context",
    assessmentReason:"Контекст наблюдений неизвестен.",assessmentAt:21},
  {id:"Q2",signature:"q2",kind:"missing_observation",edgeSubject:"Усталость",edgeObject:"снижению концентрации",
    question:"Есть ли наблюдения?",reason:"Нет наблюдений.",priority:2,status:"answered",
    sourceClaimIds:["fatigue-edge"],createdAt:15,updatedAt:22,lastAskedAt:17,
    responseText:"В памяти нет конкретных естественных наблюдений, проверяющих связь.",responseMemoryId:"",
    responseClaimIds:[],answeredAt:22,assessment:"gap_confirmed",
    assessmentReason:"Прямых наблюдений нет.",assessmentAt:22},
  {id:"Q3",signature:"q3",kind:"missing_observation",edgeSubject:"Обезвоживание",edgeObject:"усталости",
    question:"Есть ли наблюдения?",reason:"Нет наблюдений.",priority:2,status:"open",
    sourceClaimIds:["hydration-edge"],createdAt:15,updatedAt:15,lastAskedAt:0,
    responseText:"",responseMemoryId:"",responseClaimIds:[],answeredAt:0}
]));
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
window.NGMemory.ask("Выведи новые гипотезы из памяти");
const researchAwareReply=feed.children[feed.children.length-1].textContent;
assert.match(researchAwareReply,/Обезвоживание ⇢ снижению концентрации/u,
  "a candidate whose causal route remains active should still be generated");
assert.match(researchAwareReply,/Q2 — Усталость → снижению концентрации: отсутствие наблюдений отмечено/u,
  "the active candidate should disclose the confirmed observation gap on a route edge");
assert.match(researchAwareReply,/Q3 — Обезвоживание → усталости: вопрос остаётся открытым/u,
  "the active candidate should disclose its still-open inquiry");
assert.match(researchAwareReply,/Прежняя гипотеза Недостаток сна ⇢ снижению концентрации сейчас не строится/u,
  "a historical hypothesis excluded by a suspended edge should be explained");
assert.match(researchAwareReply,/Q1 не установил обстоятельства противоречия/u,
  "an unanswered context gap must not be treated as falsification");
assert.equal(window.NGMemory.modelDecisions().find(item=>item.edgeSubject==="Недостаток сна").strategy,"suspend",
  "research-aware explanation must not change the selected model decision");

// Legacy backups can contain a false causal claim created from the "что ..." half
// of a comma-separated explanatory sentence. It must be removed and persisted on load.
const legacyQuotedClaim={id:"legacy-quoted-cause",kind:"causal",subject:"что усталость",predicate:"приводит к",
  object:"снижению концентрации",holder:"user",polarity:true,source:"user_message",
  evidence:"что усталость приводит к снижению концентрации",verification:"unverified",
  extractionConfidence:0.88,traceId:null,createdAt:500,revision:false,status:"current",modality:"asserted"};
database.set("neurogenesis.memories.v1",JSON.stringify([
  {id:"legacy-quote",text:"Есть только исходное утверждение о том, что усталость приводит к снижению концентрации.",
   tags:["усталост"],traceIds:[],claims:[legacyQuotedClaim],createdAt:500,updatedAt:500,strength:.65,repetitions:1,recalls:0}
]));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
assert.equal(window.NGMemory.claims().some(claim=>claim.subject==="что усталость"),false,
  "loading a legacy backup must discard the malformed quoted causal claim");
const migratedLegacyMemories=JSON.parse(database.get("neurogenesis.memories.v1"));
assert.equal(migratedLegacyMemories[0].claims.length,0,
  "the repaired memory data should be persisted rather than reintroducing the malformed claim on next load");

console.log("NEUROGENESIS answer-aware hypothesis generation, archived-path exclusion, inquiry provenance and quoted-claim migration: passed.");

