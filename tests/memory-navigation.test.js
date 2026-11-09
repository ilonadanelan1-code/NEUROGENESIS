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
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),sandbox,{filename:"goals.js"});
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

// A research strategy selects a useful open question, explains its evidence value and keeps decisions unchanged.
const strategyMemoryCountBefore=window.NGMemory.count();
const strategyDecisionsBefore=JSON.stringify(window.NGMemory.modelDecisions());
input.value="Составь план исследования";
document.getElementById("ask-button").dispatch("click");
const strategyReply=feed.children[feed.children.length-1].textContent;
assert.match(strategyReply,/ПЛАН ИССЛЕДОВАНИЯ/u,"the system should provide a distinct research strategy report");
assert.match(strategyReply,/Эвристический приоритет/u,"the plan should disclose that ranking is heuristic, not a truth probability");
assert.match(strategyReply,/КАК Я РАЗБЕРУ ОТВЕТ/u,"the plan should explain how different answers will be interpreted");
assert.match(strategyReply,/не будет автоматически превращён в доказанный факт/u,"a plan must not promote an attributed answer into verified evidence");
assert.match(strategyReply,/Не нужно намеренно создавать какие-либо условия/u,"the plan should rely on natural observations, not induced tests");
const plannedQuestion=strategyReply.match(/СЛЕДУЮЩИЙ ВОПРОС · (Q\d+)/u);
assert.ok(plannedQuestion,"the selected next step should retain its inquiry ID");
const plannedInquiry=window.NGMemory.inquiries().find(item=>item.id===plannedQuestion[1]);
assert.ok(plannedInquiry&&plannedInquiry.status==="open","planning should not answer or close the selected inquiry");
assert.ok(strategyReply.includes(plannedInquiry.question),"the plan should show the exact stored question");
assert.equal(window.NGMemory.count(),strategyMemoryCountBefore,"planning should not create memories");
assert.equal(JSON.stringify(window.NGMemory.modelDecisions()),strategyDecisionsBefore,"planning should not change working-model decisions");

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

// Older builds split long research answers into separate memory fragments.
// Claims extracted from those fragments must be cleared when provenance matches.
const q1Answer="В сохранённых записях обстоятельства двух наблюдений не указаны. Нет точных дат и времени. Поэтому пока нельзя установить, были ли это разные обстоятельства или действительно противоречащие друг другу наблюдения. Эти записи показывают два противоположных результата.";
const q1FalseFragment="Поэтому пока нельзя установить, были ли это разные обстоятельства или действительно противоречащие друг другу наблюдения.";
const falseDefinition={id:"legacy-q1-definition",kind:"definition",subject:"были ли",predicate:"определяется как",
  object:"разные обстоятельства или действительно противоречащие друг другу наблюдения",holder:"user",
  polarity:true,source:"user_message",evidence:"были ли это разные обстоятельства или действительно противоречащие друг другу наблюдения",
  verification:"unverified",extractionConfidence:0.87,traceId:null,createdAt:1000,revision:false,status:"current",modality:"asserted"};
database.set("neurogenesis.memories.v1",JSON.stringify([
  {id:"legacy-q1-prefix",text:"Ответ на вопрос Q1: В сохранённых записях обстоятельства двух наблюдений не указаны.",
   tags:["ответ"],traceIds:[],claims:[],createdAt:1000,updatedAt:1000,strength:.65,repetitions:1,recalls:0},
  {id:"legacy-q1-fragment",text:q1FalseFragment,tags:["обстоятельств"],traceIds:[],claims:[falseDefinition],
   createdAt:1001,updatedAt:1001,strength:.65,repetitions:1,recalls:0}
]));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.inquiries.v1",JSON.stringify([
  {id:"Q1",signature:"legacy-q1",kind:"contrast_observations",edgeSubject:"Недостаток сна",edgeObject:"усталости",
   question:"Уточни обстоятельства.",reason:"Есть противоречие.",priority:0,status:"answered",
   sourceClaimIds:[],createdAt:900,updatedAt:1000,lastAskedAt:950,responseText:q1Answer,
   responseMemoryId:"legacy-q1-prefix",responseClaimIds:[],answeredAt:1000,
   assessment:"insufficient_context",assessmentReason:"Контекст неизвестен.",assessmentAt:1000}
]));
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
assert.equal(window.NGMemory.claims().some(claim=>claim.id==="legacy-q1-definition"),false,
  "a structured claim parsed from a legacy inquiry-answer fragment must be removed");
const cleanedInquiryFragment=JSON.parse(database.get("neurogenesis.memories.v1")).find(item=>item.id==="legacy-q1-fragment");
assert.ok(cleanedInquiryFragment,"the original memory fragment itself must be preserved");
assert.equal(cleanedInquiryFragment.text,q1FalseFragment,"migration must preserve the user's original text");
assert.equal(cleanedInquiryFragment.claims.length,0,"the structured layer should be cleaned and persisted");

// An unrelated memory with the same sentence but far from the inquiry date must be preserved.
database.set("neurogenesis.memories.v1",JSON.stringify([
  {id:"unrelated-definition",text:q1FalseFragment,tags:["обстоятельств"],traceIds:[],claims:[falseDefinition],
   createdAt:900000,updatedAt:900000,strength:.65,repetitions:1,recalls:0}
]));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.inquiries.v1",JSON.stringify([
  {id:"Q1",signature:"legacy-q1",kind:"contrast_observations",edgeSubject:"Недостаток сна",edgeObject:"усталости",
   question:"Уточни обстоятельства.",reason:"Есть противоречие.",priority:0,status:"answered",
   sourceClaimIds:[],createdAt:900,updatedAt:1000,lastAskedAt:950,responseText:q1Answer,
   responseMemoryId:"",responseClaimIds:[],answeredAt:1000,
   assessment:"insufficient_context",assessmentReason:"Контекст неизвестен.",assessmentAt:1000}
]));
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
assert.equal(window.NGMemory.claims().some(claim=>claim.id==="legacy-q1-definition"),true,
  "cleanup must not remove a matching claim from an unrelated memory created outside the inquiry time window");


// Model evolution must compare successive snapshots without changing memories or decisions.
const evolutionMemories=[
  {id:"evolution-counterexample",text:"При факторе Альфа не наблюдался результат Бета",createdAt:100},
  {id:"evolution-route-one",text:"Фактор Альфа приводит к фактору Гамма",createdAt:101},
  {id:"evolution-route-two",text:"Фактор Гамма приводит к результату Бета",createdAt:102}
];
const evolutionConclusion={
  version:1,type:"derived_hypotheses",createdAt:90,status:"current",
  conclusions:[{subject:"Фактор Альфа",object:"Результат Бета",paths:[[{id:"direct-edge",subject:"Фактор Альфа",object:"Результат Бета"}]]}],
  reviews:[],
  modelHistory:[{
    at:95,signature:"baseline",
    edges:[{subject:"Фактор Альфа",object:"Результат Бета",status:"unobserved",decision:null,claimIds:[],revisionOptions:[]}],
    alternatives:[]
  }]
};
database.set("neurogenesis.memories.v1",JSON.stringify(evolutionMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1",JSON.stringify([
  {role:"assistant",time:90,text:"Фактор Альфа ⇢ Результат Бета",reasoning:evolutionConclusion}
]));
database.set("neurogenesis.model-decisions.v1",JSON.stringify([
  {edgeSubject:"Фактор Альфа",edgeObject:"Результат Бета",strategy:"suspend",at:110,claimIds:[]}
]));
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
window.NGMemory.ask("Покажи историю изменений модели");
const evolutionReply=feed.children[feed.children.length-1].textContent;
assert.match(evolutionReply,/ДИНАМИКА ПРИЧИННОЙ МОДЕЛИ/u,
  "the user should receive a dedicated working-model evolution report");
assert.match(evolutionReply,/НЕТ ОТДЕЛЬНЫХ НАБЛЮДЕНИЙ → ПОД ВОПРОСОМ/u,
  "the report should show the edge status transition between snapshots");
assert.match(evolutionReply,/НЕТ ВЫБРАННОГО РЕШЕНИЯ → СВЯЗЬ ВРЕМЕННО ПРИОСТАНОВЛЕНА/u,
  "the report should show when a model decision changes");
assert.match(evolutionReply,/Новые записи, учтённые для Фактор Альфа → Результат Бета: «При факторе Альфа не наблюдался результат Бета»/u,
  "the report should identify newly considered evidence");
assert.match(evolutionReply,/Добавился альтернативный маршрут для Фактор Альфа ⇢ Результат Бета: Фактор Альфа → фактору Гамма → результату Бета/u,
  "the report should identify a newly available alternative route");
assert.equal(window.NGMemory.modelDecisions().find(item=>item.edgeSubject==="Фактор Альфа"&&item.edgeObject==="Результат Бета").strategy,"suspend",
  "reporting evolution must not modify the user's selected model decision");
const evolutionHistory=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))[0].reasoning.modelHistory;
assert.equal(evolutionHistory.length,2,"the report should persist exactly one new snapshot after the baseline");
window.NGMemory.ask("Покажи историю изменений модели");
const repeatedEvolutionHistory=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"))[0].reasoning.modelHistory;
assert.equal(repeatedEvolutionHistory.length,2,"repeating the report without new evidence must not create duplicate snapshots");


// Review readiness requires both directions of direct observation plus context, timing and an outcome criterion.
const readinessMemories=[
  {id:"readiness-positive",text:"При факторе Альфа наблюдался результат Бета",tags:["альфа"],traceIds:[],
   claims:[{id:"obs-positive",kind:"observation",subject:"Фактор Альфа",predicate:"наблюдение",object:"Результат Бета",
    holder:"user",polarity:true,source:"user_message",evidence:"При факторе Альфа наблюдался результат Бета",
    verification:"unverified",extractionConfidence:.86,traceId:null,createdAt:101,status:"current"}],
   createdAt:101,updatedAt:101,strength:.65,repetitions:1,recalls:0},
  {id:"readiness-negative",text:"При факторе Альфа не наблюдался результат Бета",tags:["альфа"],traceIds:[],
   claims:[{id:"obs-negative",kind:"observation",subject:"Фактор Альфа",predicate:"наблюдение",object:"Результат Бета",
    holder:"user",polarity:false,source:"user_message",evidence:"При факторе Альфа не наблюдался результат Бета",
    verification:"unverified",extractionConfidence:.86,traceId:null,createdAt:102,status:"current"}],
   createdAt:102,updatedAt:102,strength:.65,repetitions:1,recalls:0}
];
const readinessConclusion={version:1,type:"derived_hypotheses",createdAt:90,status:"challenged",
 conclusions:[{subject:"Фактор Альфа",object:"Результат Бета",paths:[[
  {id:"alpha-beta",subject:"Фактор Альфа",object:"Результат Бета"}
 ]]}],reviews:[]};
database.set("neurogenesis.memories.v1",JSON.stringify(readinessMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1",JSON.stringify([
 {role:"assistant",time:90,text:"Фактор Альфа ⇢ Результат Бета",reasoning:readinessConclusion}
]));
database.set("neurogenesis.model-decisions.v1",JSON.stringify([
 {edgeSubject:"Фактор Альфа",edgeObject:"Результат Бета",strategy:"suspend",at:110,claimIds:["obs-negative"]}
]));
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1",JSON.stringify([
 {id:"Q1",signature:"readiness-q1",kind:"contrast_observations",edgeSubject:"Фактор Альфа",edgeObject:"Результат Бета",
  question:"Уточни условия наблюдений.",reason:"Наблюдения расходятся.",priority:0,status:"answered",
  sourceClaimIds:["obs-positive","obs-negative"],createdAt:105,updatedAt:120,lastAskedAt:110,
  responseText:"Обстоятельства двух наблюдений неизвестны. Нет точных дат и времени, информации о продолжительности, сопутствующих условиях и способе определения результата. Нет конкретных зафиксированных естественных наблюдений.",responseMemoryId:"",responseClaimIds:[],answeredAt:120}
]));
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
const decisionsBeforeReadiness=JSON.stringify(window.NGMemory.modelDecisions());
window.NGMemory.ask("Оцени готовность пересмотра модели");
const incompleteReadiness=feed.children[feed.children.length-1].textContent;
assert.match(incompleteReadiness,/ПРОТИВОРЕЧИЕ ЕСТЬ, НО ДАННЫХ ДЛЯ ПЕРЕСМОТРА ПОКА НЕ ХВАТАЕТ/u,
  "balanced observations without context, time and criterion details must not pass the review gate");
assert.match(incompleteReadiness,/время или временной порядок/u,
  "the report should name missing temporal information");
assert.match(incompleteReadiness,/способ оценки не указан/u,
  "the report should name the missing outcome criterion");
assert.match(incompleteReadiness,/Контекст: не указан/u,
  "an inquiry response must not rewrite individual event cards");
assert.match(incompleteReadiness,/Критерий результата: не указан/u,
  "a missing method and a statement about no recorded observations must not count as a measurement criterion");
const savedReadinessInquiries=JSON.parse(database.get("neurogenesis.inquiries.v1"));
savedReadinessInquiries[0].responseText="Одно наблюдение было утром, другое вечером; условия различались, результат оценивался по самочувствию.";
database.set("neurogenesis.inquiries.v1",JSON.stringify(savedReadinessInquiries));
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
window.NGMemory.ask("Оцени готовность пересмотра модели");
const completeReadiness=feed.children[feed.children.length-1].textContent;
assert.match(completeReadiness,/Контекст: не указан · Время: не указано · Критерий результата: не указан/u,
  "an inquiry answer must not fill the metadata fields of individual observation cards");
assert.match(completeReadiness,/ПРОТИВОРЕЧИЕ ЕСТЬ, НО ДАННЫХ ДЛЯ ПЕРЕСМОТРА ПОКА НЕ ХВАТАЕТ/u,
  "group-level testimony without per-observation attribution must not open the review gate");
assert.match(completeReadiness,/Уточнения пользователя: Q1 \(контекстные сведения, не независимая проверка\)/u,
  "the inquiry response should remain visible as separate contextual testimony");
assert.match(completeReadiness,/контекст не указан в 2 из 2 отдельных событий/u,
  "the blocker should identify the individual observations that still lack context");
assert.equal(JSON.stringify(window.NGMemory.modelDecisions()),decisionsBeforeReadiness,
  "evaluating readiness must not silently change the selected model decision");

// Evidence reconciliation compares cases without counting repeated wording as a new event
// or multiple user memories as independent external verification.
const reconciliationMemoryCase=(id,claimId,text,polarity,context,timing,criterion,createdAt)=>({
  id,text,tags:["сон","усталость"],traceIds:[],createdAt,updatedAt:createdAt,strength:.65,repetitions:1,recalls:0,
  claims:[{id:claimId,kind:"observation",subject:"Недостаток сна",predicate:"наблюдение",object:"Усталости",
    holder:"user",polarity,source:"user_message",evidence:text,verification:"unverified",
    extractionConfidence:.86,traceId:null,createdAt,status:"current",sourceMemoryId:id,
    observationCase:{schema:2,source:"direct_observation",sourceRef:"",
      context:{status:"provided",value:context,source:"direct_observation"},
      timing:{status:"provided",value:timing,source:"direct_observation"},
      criterion:{status:"provided",value:criterion,source:"direct_observation"},
      outcome:{status:"provided",value:"6/10",source:"direct_observation"}}}]
});
const reconciliationMemories=[
  reconciliationMemoryCase("case-positive-1","case-pos-1","При недостатке сна наблюдалась усталость; после тренировки; вечером; шкала 1–10",true,"после тренировки","вечером","шкала 1–10",300),
  reconciliationMemoryCase("case-negative","case-neg","При недостатке сна не наблюдалась усталость; после тренировки; утром; шкала 1–10",false,"после тренировки","утром","шкала 1–10",310),
  reconciliationMemoryCase("case-positive-2","case-pos-2","При недостатке сна наблюдалась усталость; обычный день; днём; шкала 1–10",true,"обычный день","днём","шкала 1–10",320),
  reconciliationMemoryCase("case-positive-repeat","case-pos-repeat","При недостатке сна наблюдалась усталость; после тренировки; вечером; шкала 1–10",true,"после тренировки","вечером","шкала 1–10",330)
];
database.set("neurogenesis.memories.v1",JSON.stringify(reconciliationMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1",JSON.stringify([{
  role:"assistant",time:200,text:"Недостаток сна → усталость",
  reasoning:{version:1,type:"derived_hypotheses",createdAt:200,status:"current",
    conclusions:[{subject:"Недостаток сна",object:"Усталости",paths:[[
      {id:"tracked-sleep-fatigue",subject:"Недостаток сна",object:"Усталости"}
    ]]}],reviews:[],modelHistory:[]}
}]));
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
assert.equal(window.NGMemory.observationCases().length,4,"the source journal should retain each distinct memory record while merging parser variants inside each record");
const reconciliation=window.NGMemory.reconcileEdgeEvidence("Недостаток сна","Усталости",200);
assert.equal(reconciliation.supportingCount,2,"the dossier should count distinct supporting observations");
assert.equal(reconciliation.challengingCount,1,"the dossier should count the separate counter-observation");
assert.equal(reconciliation.duplicateMentions,1,"identical evidence text should be flagged instead of counted as an extra case");
assert.equal(reconciliation.completeCases,2,"a possible duplicate group must not be counted as a confirmed complete event");
assert.equal(reconciliation.identityUnresolvedCount,1,"the unresolved event identity should be reported separately");
assert.equal(reconciliation.metadataCoverage,100,"metadata coverage should count context, timing, method and measured value fields");
assert.equal(reconciliation.alignedPairCount,0,"a possible duplicate event must not be used as a confirmed comparable pair");
assert.equal(reconciliation.incompletePairCount,1,"the unresolved repeat should remain incomplete for pairwise comparison");
assert.equal(reconciliation.contextDifferencePairCount,1,"different contexts should be reported as a possible source of heterogeneity");
assert.equal(reconciliation.independentVerifiedSources,0,"multiple user memories must not be misrepresented as independent verification");
assert.equal(reconciliation.addedAfterModelCount,3,"the dossier should identify unique records saved after the archived conclusion");
assert.match(window.NGMemory.reconcileExperience(),/СОПОСТАВЛЕНИЕ ОПЫТА С ПРИЧИННОЙ МОДЕЛЬЮ/u);
assert.match(window.NGMemory.reconcileExperience(),/Независимо подтверждённых источников: 0/u);
assert.equal(window.NGMemory.modelDecisions().length,0,"evidence reconciliation must not change model decisions");


// Regressions from the supplied backup: enrichments must not inflate independent event counts.
const backupTime=Date.parse("2026-11-08T23:16:38.585Z");
const eventMemory=(id,claimId,text,createdAt,polarity,details)=>({
  id,text,tags:["недостаток сна","усталость"],traceIds:[],createdAt,updatedAt:createdAt,
  strength:.65,repetitions:1,recalls:0,
  claims:[{id:claimId,kind:"observation",subject:details&&details.subject||"Недостатке сна",predicate:"наблюдение",
    object:details&&details.object||"усталости",holder:"user",polarity,source:"user_message",evidence:text,
    verification:"unverified",extractionConfidence:.86,traceId:null,createdAt,status:"current",sourceMemoryId:id,
    ...(details?{observationCase:{schema:2,source:"direct_observation",sourceRef:"",
      context:{status:details.context?"provided":"not_stated",value:details.context||"",source:"direct_observation"},
      timing:{status:details.timing?"provided":"not_stated",value:details.timing||"",source:"direct_observation"},
      criterion:{status:details.criterion?"provided":"not_stated",value:details.criterion||"",source:"direct_observation"},
      outcome:{status:details.outcome?"provided":"not_stated",value:details.outcome||"",source:"direct_observation"},
      eventRef:details.eventRef||""}}:{})}]
});
const backupDefectMemories=[
  eventMemory("old-short","old-positive","При недостатке сна наблюдалась усталость",backupTime,true,null),
  eventMemory("new-enriched","new-positive","При недостатке сна наблюдалась усталость; контекст: после тренировки; время: 2026-11-09 07:15; критерий: по шкале 1–10",backupTime+1000,true,
    {context:"после тренировки",timing:"2026-11-09 07:15",criterion:"по шкале 1–10"}),
  eventMemory("counter-case","counter-negative","При недостатке сна не наблюдалась усталость",backupTime+2000,false,null)
];
database.set("neurogenesis.memories.v1",JSON.stringify(backupDefectMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
assert.equal(window.NGMemory.observationCases().length,3,"all original user cards must remain in the raw observation journal");
const backupReadiness=window.NGMemory.reviewReadinessForEdge("Недостатке сна","усталости");
assert.equal(backupReadiness.supportingCount,1,"an enriched copy must not become a second supporting event");
assert.equal(backupReadiness.challengingCount,1,"the separate negative observation must remain distinct");
assert.equal(backupReadiness.possibleDuplicateCount,1,"the suspected duplicate must be disclosed");
assert.equal(backupReadiness.numericOutcomeRequired,true,"the scale method requires a measured value");
assert.equal(backupReadiness.ready,false,"a scale without a recorded score must not pass review readiness");
assert.ok(backupReadiness.blockers.some(item=>/фактическое числовое значение/u.test(item)));
const backupDossier=window.NGMemory.reconcileEdgeEvidence("Недостатке сна","усталости",0);
assert.equal(backupDossier.supportingCount,1);
assert.equal(backupDossier.possibleDuplicateGroups,1);
const backupTimeline=window.NGMemory.observationTimeline();
assert.equal(backupTimeline.rawCardCount,3);
assert.equal(backupTimeline.totalCases,2,"the timeline must group cards that could describe a single episode");
assert.equal(backupTimeline.futureCount,1,"an event later than its saved card timestamp should be flagged");
assert.equal(backupTimeline.events[0].futureRelativeToRecord,true);
const backupTimelineReport=window.NGMemory.observationTimelineReport();
assert.match(backupTimelineReport,/позже времени сохранения карточки/u);
assert.match(backupTimelineReport,/часовой пояс/u);

// A targeted inquiry resolves possible duplicate mentions only after an explicit user answer.
const duplicateQueue=window.NGMemory.refreshInquiries();
const duplicateInquiry=window.NGMemory.inquiries().find(item=>item.kind==="duplicate_observation");
assert.ok(duplicateInquiry,"a possible duplicate group should create its own research question even without a causal archive");
assert.equal(duplicateInquiry.status,"open");
assert.match(duplicateInquiry.question,/группы: 1\+2; 3; 4\+5/u,"the inquiry should offer a mixed grouping format");
const duplicateInquiryCount=window.NGMemory.inquiries().length;
window.NGMemory.remember("Ответ на вопрос "+duplicateInquiry.id+": Не уверен, возможно, это похожие записи.");
const pendingDuplicate=window.NGMemory.inquiries().find(item=>item.id===duplicateInquiry.id);
assert.equal(pendingDuplicate.status,"open","an ambiguous answer must not close the duplicate question");
assert.match(pendingDuplicate.clarificationNote,/Не уверен/u);
assert.equal(window.NGMemory.reconcileEdgeEvidence("Недостатке сна","усталости").possibleDuplicateGroups,1,
  "an ambiguous answer must leave the event grouping untouched");
window.NGMemory.remember("Ответ на вопрос "+duplicateInquiry.id+": Это один и тот же эпизод.");
const sameEventInquiry=window.NGMemory.inquiries().find(item=>item.id===duplicateInquiry.id);
assert.equal(sameEventInquiry.status,"answered");
assert.equal(sameEventInquiry.resolution,"same_event");
assert.equal(sameEventInquiry.assessment,"duplicate_same_event");
const sameEventCases=window.NGMemory.observationCases().filter(item=>item.polarity&&
  item.subject==="Недостатке сна"&&item.object==="усталости");
assert.equal(sameEventCases.length,2);
assert.equal(sameEventCases[0].details.eventRef,sameEventCases[1].details.eventRef,
  "a same-event answer must write one shared eventRef to both source observation claims");
const sameEventDossier=window.NGMemory.reconcileEdgeEvidence("Недостатке сна","усталости");
assert.equal(sameEventDossier.supportingCount,1);
assert.equal(sameEventDossier.possibleDuplicateGroups,0);
assert.equal(sameEventDossier.explicitDuplicateGroups,1);
assert.equal(window.NGMemory.refreshInquiries().added,0,
  "a resolved same-event group must not generate the same clarification question again");
assert.equal(window.NGMemory.inquiries().length,duplicateInquiryCount);

// The alternative answer assigns different event IDs and keeps both observations independent.
const separateEpisodeMemories=[
  eventMemory("separate-a","separate-a-claim","Фактор Гамма сопровождался результатом Дельта",backupTime,true,
    {subject:"Фактор Гамма",object:"результатом Дельта"}),
  eventMemory("separate-b","separate-b-claim","Фактор Гамма сопровождался результатом Дельта; контекст: рабочий день; время: 2026-11-08 10:30",backupTime+1000,true,
    {subject:"Фактор Гамма",object:"результатом Дельта",context:"рабочий день",timing:"2026-11-08 10:30",criterion:"обычное наблюдение"})
];
database.set("neurogenesis.memories.v1",JSON.stringify(separateEpisodeMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
window.NGMemory.refreshInquiries();
const separateInquiry=window.NGMemory.inquiries().find(item=>item.kind==="duplicate_observation");
assert.ok(separateInquiry,"a second possible duplicate group should generate a new question");
window.NGMemory.remember("Ответ на вопрос "+separateInquiry.id+": Это разные самостоятельные эпизоды.");
const separateAnswered=window.NGMemory.inquiries().find(item=>item.id===separateInquiry.id);
assert.equal(separateAnswered.resolution,"separate_events");
const separateCases=window.NGMemory.observationCases();
assert.notEqual(separateCases[0].details.eventRef,separateCases[1].details.eventRef,
  "a different-episode answer must assign distinct event IDs");
assert.equal(window.NGMemory.reconcileEdgeEvidence("Фактор Гамма","результатом Дельта").supportingCount,2,
  "separate episodes must be counted independently after clarification");

// A single event can be enriched across cards only when the same explicit eventRef links them.
const linkedEventMemories=[
  eventMemory("linked-a","linked-a-claim","При факторе Тета наблюдался результат Каппа; контекст: после тренировки; время: 2026-11-09 08:00; критерий: по шкале 1–10",700,true,
    {subject:"Фактор Тета",object:"результата Каппа",context:"после тренировки",timing:"2026-11-09 08:00",criterion:"по шкале 1–10",eventRef:"theta-episode-1"}),
  eventMemory("linked-b","linked-b-claim","Дополнение к наблюдению Тета; результат: 6/10",710,true,
    {subject:"Фактор Тета",object:"результата Каппа",outcome:"6/10",eventRef:"theta-episode-1"}),
  eventMemory("linked-negative","linked-negative-claim","При факторе Тета результат Каппа не наблюдался; контекст: без тренировки; время: 2026-11-09 09:00; критерий: по шкале 1–10; результат: 2/10",720,false,
    {subject:"Фактор Тета",object:"результата Каппа",context:"без тренировки",timing:"2026-11-09 09:00",criterion:"по шкале 1–10",outcome:"2/10",eventRef:"theta-episode-2"})
];
database.set("neurogenesis.memories.v1",JSON.stringify(linkedEventMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1",JSON.stringify([]));
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
const linkedReady=window.NGMemory.reviewReadinessForEdge("Фактор Тета","результата Каппа");
assert.equal(linkedReady.supportingCount,1,"two explicitly linked cards should describe one supporting event");
assert.equal(linkedReady.challengingCount,1,"a different eventRef should remain a separate challenging event");
assert.equal(linkedReady.completeEventCount,2,"metadata may be combined within an explicit eventRef group");
assert.equal(linkedReady.ready,true,"both individually identified events should satisfy their required fields");
assert.equal(linkedReady.numericOutcomeMissingCount,0,"a numeric scale requires an actual numeric outcome value");

// Contradictory metadata inside one explicitly linked event must block readiness.
const conflictEventMemories=[
  ...linkedEventMemories.slice(0,2),
  eventMemory("linked-a-conflict","linked-a-conflict-claim","Дополнение: другой контекст",715,true,
    {subject:"Фактор Тета",object:"результата Каппа",context:"в отпуске",eventRef:"theta-episode-1"}),
  linkedEventMemories[2]
];
database.set("neurogenesis.memories.v1",JSON.stringify(conflictEventMemories));
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
const conflictReady=window.NGMemory.reviewReadinessForEdge("Фактор Тета","результата Каппа");
assert.equal(conflictReady.ready,false,"conflicting values inside an explicitly linked event must block readiness");
assert.ok(conflictReady.metadataConflictCount>0,"metadata conflicts should be surfaced explicitly");

// A valid mixed partition can group only some cards while keeping the others independent.
const mixedPartitionMemories=[
  eventMemory("mixed-a","mixed-a-claim","При факторе Лямбда наблюдался результат Мю",backupTime,true,{subject:"Фактор Лямбда",object:"результата Мю"}),
  eventMemory("mixed-b","mixed-b-claim","При факторе Лямбда наблюдался результат Мю",backupTime+1000,true,{subject:"Фактор Лямбда",object:"результата Мю"}),
  eventMemory("mixed-c","mixed-c-claim","При факторе Лямбда наблюдался результат Мю",backupTime+2000,true,{subject:"Фактор Лямбда",object:"результата Мю"}),
  eventMemory("mixed-d","mixed-d-claim","При факторе Лямбда наблюдался результат Мю",backupTime+3000,true,{subject:"Фактор Лямбда",object:"результата Мю"})
];
database.set("neurogenesis.memories.v1",JSON.stringify(mixedPartitionMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
window.NGMemory.refreshInquiries();
const mixedInquiry=window.NGMemory.inquiries().find(item=>item.kind==="duplicate_observation");
assert.ok(mixedInquiry,"four repeated cards should trigger an event-identity question");
assert.match(mixedInquiry.question,/группы: 1\+2; 3; 4/u,"the question should explain the indexed mixed-partition syntax");
window.NGMemory.remember("Ответ на вопрос "+mixedInquiry.id+": группы: 1+2; 3; 4");
const mixedAnswered=window.NGMemory.inquiries().find(item=>item.id===mixedInquiry.id);
assert.equal(mixedAnswered.status,"answered","a complete mixed partition should resolve the inquiry");
assert.equal(mixedAnswered.resolution,"partitioned_events");
assert.equal(mixedAnswered.assessment,"duplicate_partitioned_events");
assert.equal(mixedAnswered.resolvedEventGroups.length,3);
const mixedRefs=window.NGMemory.observationCases().map(item=>item.details.eventRef);
assert.equal(mixedRefs[0],mixedRefs[1],"the first two cards should share one event identity");
assert.notEqual(mixedRefs[1],mixedRefs[2],"the third card should have a separate event identity");
assert.notEqual(mixedRefs[2],mixedRefs[3],"the fourth card should have a separate event identity");
const mixedGroupingReload=JSON.parse(database.get("neurogenesis.inquiries.v1")).find(item=>item.id===mixedInquiry.id);
assert.equal(mixedGroupingReload.resolution,"partitioned_events","the grouping decision should survive local persistence");
assert.equal(mixedGroupingReload.resolvedEventGroups.length,3,"the exact grouping should be preserved");

// Invalid mixed grouping must not partially assign event IDs.
database.set("neurogenesis.memories.v1",JSON.stringify(mixedPartitionMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
window.NGMemory.refreshInquiries();
const invalidGroupingInquiry=window.NGMemory.inquiries().find(item=>item.kind==="duplicate_observation");
window.NGMemory.remember("Ответ на вопрос "+invalidGroupingInquiry.id+": группы: 1+2; 3");
const invalidGrouping=window.NGMemory.inquiries().find(item=>item.id===invalidGroupingInquiry.id);
assert.equal(invalidGrouping.status,"open","a partition omitting a card must not resolve the inquiry");
assert.ok(!window.NGMemory.observationCases().some(item=>item.details.eventRef),
  "an invalid partition must not partially mutate any event identifier");

// Different explicit IDs protect two truly separate episodes from automatic merging.
const explicitEventMemories=[
  eventMemory("event-a","event-a-claim","При факторе Альфа наблюдался результат Бета",500,true,
    {subject:"Фактор Альфа",object:"Результат Бета",context:"обычный день",timing:"2026-11-09 08:00",criterion:"фиксировался результат",eventRef:"alpha-episode-1"}),
  eventMemory("event-b","event-b-claim","При факторе Альфа наблюдался результат Бета",600,true,
    {subject:"Фактор Альфа",object:"Результат Бета",context:"обычный день",timing:"2026-11-09 08:00",criterion:"фиксировался результат",eventRef:"alpha-episode-2"})
];
database.set("neurogenesis.memories.v1",JSON.stringify(explicitEventMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
assert.equal(window.NGMemory.reconcileEdgeEvidence("Фактор Альфа","Результат Бета").supportingCount,2,
  "different explicit event IDs must preserve separate observations");

// Chronology must use explicit event dates rather than memory save timestamps.
const timelineCase=(id,claimId,text,polarity,timing,createdAt,timingStatus="provided")=>({
  id,text:"Запись события "+id,tags:["хронология"],traceIds:[],createdAt,updatedAt:createdAt,strength:.65,repetitions:1,recalls:0,
  claims:[{id:claimId,kind:"observation",subject:"Фактор Время",predicate:"наблюдение",object:"Результат",
    holder:"user",polarity,source:"user_message",evidence:text,verification:"unverified",
    extractionConfidence:.9,traceId:null,createdAt,status:"current",sourceMemoryId:id,
    observationCase:{schema:1,source:"direct_observation",sourceRef:"",
      context:{status:"provided",value:"обычный день",source:"direct_observation"},
      timing:{status:timingStatus,value:timingStatus==="provided"?timing:"",source:"direct_observation"},
      criterion:{status:"provided",value:"одинаковая шкала",source:"direct_observation"}}}]
});
const timelineMemories=[
  timelineCase("saved-first","event-late","При факторе времени наблюдался результат; время: 2026-11-09 21:45",true,"2026-11-09 21:45",100),
  timelineCase("saved-last","event-early","При факторе времени результат не наблюдался; время: 09.11.2026 07:15",false,"09.11.2026 07:15",900),
  timelineCase("saved-middle","event-date","При факторе времени наблюдался результат; дата: 2026-11-08",true,"2026-11-08",500),
  timelineCase("saved-relative","event-relative","При факторе времени наблюдался результат; время: вчера вечером",true,"вчера вечером",300),
  timelineCase("saved-unknown","event-unknown","В отдельном случае фактор времени не сопровождался результатом",false,"",400,"not_recorded")
];
database.set("neurogenesis.memories.v1",JSON.stringify(timelineMemories));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1","[]");
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
const timeline=window.NGMemory.observationTimeline();
assert.equal(timeline.totalCases,5);
assert.equal(timeline.recognizedCount,3,"only explicit supported calendar dates should enter the chronology");
assert.equal(timeline.unparsedCount,1,"relative language should remain unparsed rather than being guessed");
assert.equal(timeline.missingCount,1,"missing event timing must remain separate");
assert.deepEqual(Array.from(timeline.events, item=>item.id),["event-date","event-early","event-late"],
  "chronology should sort by event date and clock time, not by memory save timestamp");
assert.equal(timeline.events[0].moment.precision,"date","date-only observations must not gain an invented time");
assert.equal(timeline.events[1].moment.timeLabel,"07:15");
assert.equal(timeline.events[2].moment.timeLabel,"21:45");
const timelineReport=window.NGMemory.observationTimelineReport();
assert.match(timelineReport,/ХРОНОЛОГИЯ НАБЛЮДЕНИЙ/u);
assert.match(timelineReport,/08\.11\.2026/u);
assert.match(timelineReport,/09\.11\.2026/u);
assert.match(timelineReport,/вчера вечером/u);
assert.match(timelineReport,/Дата сохранения воспоминания не используется/u);
window.NGMemory.ask("Покажи хронологию наблюдений");
assert.match(feed.children[feed.children.length-1].textContent,/ХРОНОЛОГИЯ НАБЛЮДЕНИЙ/u,
  "the natural-language command should open the timeline report");


// Legacy reasoning archives must quarantine malformed causal edges, not reuse them.
const archiveSanitationFixture={
  version:1,type:"derived_hypotheses",createdAt:1000,status:"challenged",
  conclusions:[{subject:"Обезвоживание",object:"снижению концентрации",paths:[
    [{id:"hydration-fatigue",subject:"Обезвоживание",object:"усталости"},
     {id:"fatigue-focus",subject:"Усталость",object:"снижению концентрации"}],
    [{id:"hydration-fatigue",subject:"Обезвоживание",object:"усталости"},
     {id:"quoted-fatigue-focus",subject:"что усталость",object:"снижению концентрации"}]
  ]}],
  reviews:[],
  modelHistory:[{at:1100,signature:"legacy-snapshot",edges:[
    {subject:"Обезвоживание",object:"усталости",status:"unobserved",claimIds:[],revisionOptions:[]},
    {subject:"что усталость",object:"снижению концентрации",status:"unobserved",claimIds:[],revisionOptions:[]}
  ],alternatives:[{subject:"Обезвоживание",object:"снижению концентрации",paths:[
    [{subject:"Обезвоживание",object:"усталости"},{subject:"что усталость",object:"снижению концентрации"}]
  ]}]}
  ]
};
database.set("neurogenesis.memories.v1",JSON.stringify([
  {id:"hydration",text:"Обезвоживание может приводить к усталости",createdAt:900},
  {id:"fatigue",text:"Усталость приводит к снижению концентрации",createdAt:901}
]));
database.set("neurogenesis.dialog.v1","[]");
database.set("neurogenesis.reasoning-archive.v1",JSON.stringify([
  {role:"assistant",time:1000,text:"Старая гипотеза с ошибочным маршрутом",reasoning:archiveSanitationFixture}
]));
database.set("neurogenesis.model-decisions.v1","[]");
database.set("neurogenesis.model-evidence.v1","[]");
database.set("neurogenesis.inquiries.v1","[]");
vm.runInNewContext(fs.readFileSync("memory.js","utf8"),sandbox,{filename:"memory.js"});
const cleanedArchive=window.NGMemory.reasoningHistory()[0];
assert.equal(cleanedArchive.conclusions.length,1,"a conclusion with at least one valid route should be preserved");
assert.equal(cleanedArchive.conclusions[0].paths.length,1,"the valid route should remain");
assert.equal(cleanedArchive.conclusions[0].paths[0][1].subject,"Усталость",
  "the valid causal intermediate should survive unchanged");
assert.ok(cleanedArchive.excludedPaths.length>=2,
  "the malformed conclusion path and snapshot routes should be recorded as excluded");
const storedArchive=JSON.parse(database.get("neurogenesis.reasoning-archive.v1"));
assert.ok(storedArchive[0].reasoning.excludedPaths.length>=2,
  "archive sanitization should be persisted during backup load");
window.NGMemory.ask("Построй обновлённую причинную модель");
const sanitizedModelReply=feed.children[feed.children.length-1].textContent;
assert.match(sanitizedModelReply,/АРХИВНЫЕ МАРШРУТЫ, ИСКЛЮЧЁННЫЕ ПРИ ПРОВЕРКЕ ФОРМЫ/u);
assert.match(sanitizedModelReply,/исключён из активного анализа/u);
assert.match(sanitizedModelReply,/исходные воспоминания не удаляются/u);
assert.equal(window.NGMemory.modelDecisions().length,0,
  "sanitizing historical route syntax must not silently alter model decisions");


// Every save and every question now passes through the same observable cognitive cycle.
window.NGMemory.remember("Я живу в Казани");
const savedCycle=window.NGMemory.cognitiveCycles().slice(-1)[0];
assert.ok(savedCycle,"a successful memory write should create a cognitive cycle");
assert.equal(savedCycle.mode,"remember");
assert.deepEqual(Array.from(savedCycle.phases,item=>item.name),
  ["perception","attention","memory","reasoning","verification","learning","model_update"],
  "every write cycle should traverse the seven ordered cognitive phases");
assert.equal(savedCycle.phases[0].status,"complete");
assert.equal(savedCycle.metrics.memoryAdded,1);
assert.ok(savedCycle.claimIds.length>0,"the cycle should retain IDs of claims it processed");
assert.ok(!("input" in savedCycle)&&!("output" in savedCycle),
  "cycle history should keep process metadata, not duplicate raw user text");

window.NGMemory.ask("Где я живу?");
const answerCycle=window.NGMemory.cognitiveCycles().slice(-1)[0];
assert.equal(answerCycle.mode,"ask");
assert.equal(answerCycle.intent,"general_question");
assert.equal(answerCycle.phases.length,7);
assert.ok(answerCycle.metrics.attentionMatches>0,
  "question processing should record relevant memories selected for attention");
assert.ok(answerCycle.phases.find(item=>item.name==="reasoning").summary.includes("structured_retrieval"),
  "the reasoning stage should identify the structured retrieval path");
assert.ok(answerCycle.metrics.memoryUpdated>0,
  "retrieved memories should register their recall-strength update");

const storedCycles=JSON.parse(database.get("neurogenesis.cognitive-cycles.v1"));
assert.ok(storedCycles.length>=2,"cognitive cycles should persist in local storage");
const cycleReport=window.NGMemory.cognitiveCycleReport(2);
assert.match(cycleReport,/КОГНИТИВНЫЙ ЦИКЛ · C/u);
assert.ok(cycleReport.includes("7. Обновление модели"));
assert.ok(cycleReport.includes("\n"),"cycle reports should use real line breaks for mobile readability");
window.NGMemory.ask("Покажи последний когнитивный цикл");
assert.match(feed.children[feed.children.length-1].textContent,/КОГНИТИВНЫЙ ЦИКЛ/u,
  "the user should be able to inspect the latest completed cycle from the chat");



// Attention is distributed by relevance plus memory salience, and uncertainty is explicit.
window.NGMemory.ask("Почему обезвоживание может приводить к усталости?");
const causalCycle=window.NGMemory.cognitiveCycles().slice(-1)[0];
const attentionRows=window.NGMemory.attentionSelection("усталость");
assert.ok(attentionRows.length>0,"attention should retrieve memories relevant to a topic");
assert.ok(attentionRows[0].score>=attentionRows[0].relevance*0.45,
  "attention should combine semantic relevance with salience rather than rely on raw text match alone");
assert.ok(attentionRows[0].reasons.length>0,
  "attention should explain why a memory was selected");
assert.ok(causalCycle.attentionDetails.length>0,
  "a completed cycle should persist the selected attention targets");
assert.ok(["low","medium","high"].includes(causalCycle.uncertainty.level),
  "a completed cycle should classify uncertainty");
assert.ok(causalCycle.uncertainty.supportIndex>=0&&causalCycle.uncertainty.supportIndex<=100,
  "the support index must remain within its stated heuristic range");
assert.ok(causalCycle.uncertainty.reasons.some(reason=>/наблюден|независим/u.test(reason)),
  "causal reasoning should disclose the absence of observations or independent evidence");
assert.ok(causalCycle.focus===null||causalCycle.focus.score>=0,
  "the cognitive cycle should expose the selected next research focus when one exists");
const expandedReport=window.NGMemory.cognitiveCycleReport(1);
assert.match(expandedReport,/НЕОПРЕДЕЛЁННОСТЬ/u);
assert.match(expandedReport,/РАСПРЕДЕЛЕНИЕ ВНИМАНИЯ/u);
const researchFocus=window.NGMemory.nextResearchFocus("обезвоживание усталость");
assert.ok(researchFocus,"the queue should rank an open research question");
assert.ok(researchFocus.score>=0&&researchFocus.score<=1,
  "research focus ranking should be a normalized score, not a probability");
assert.ok(researchFocus.reasons.length>0,
  "the selected research question should explain its priority");


window.NGMemory.ask("Над чем сейчас работаешь?");
assert.match(feed.children[feed.children.length-1].textContent,/ЦЕЛИ И САМОКОНТРОЛЬ/u,
  "the natural phrasing without ты should open the research-goal report");
const goalReport = window.NGMemory.goalReport();
assert.match(goalReport,/ЦЕЛИ И САМОКОНТРОЛЬ/u);
assert.ok(Array.isArray(window.NGMemory.goals()),"goal records should be exposed through the memory API");
const latestGoalCycle=window.NGMemory.cognitiveCycles().slice(-1)[0];
assert.ok(latestGoalCycle.goals&&latestGoalCycle.goals.total>=0,
  "the cognitive cycle should store a compact research-goal snapshot");

console.log("NEUROGENESIS attention-ranking, uncertainty-assessment, research-focus, cognitive-cycle and reasoning regression tests: passed.");
