"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

class ElementStub {
  constructor(tagName="div") {
    this.tagName=tagName.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};
    this.className="";this.classList={add(){},remove(){},toggle(){},contains(){return false;}};
    this.hidden=false;this.disabled=false;this.textContent="";this.value="";this.scrollTop=0;
    this.scrollHeight=0;this.files=[];this.listeners=Object.create(null);
  }
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  append(...children){for(const child of children)this.appendChild(child);}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...children);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  focus(){} scrollIntoView(){} click(){this.clicked=true;} closest(){return null;}
}
const elements=new Map();
const document={
  getElementById(id){if(!elements.has(id))elements.set(id,new ElementStub());return elements.get(id);},
  createElement(tag){return new ElementStub(tag);},querySelector(){return null;},body:new ElementStub("body")
};
const database=new Map([
  ["neurogenesis.memories.v1",JSON.stringify([{id:"baseline",text:"Музыка прекрасна",tags:["музык","прекрасн"],traceIds:[],createdAt:1000,updatedAt:1000,strength:.65,repetitions:1,recalls:0}])],
  ["neurogenesis.dialog.v1","[]"]
]);
let failStorageWriteOnceFor="";
const localStorage={
  getItem(key){return database.has(key)?database.get(key):null;},
  setItem(key,value){if(key===failStorageWriteOnceFor){failStorageWriteOnceFor="";throw new Error("Injected storage failure");}database.set(key,String(value));},
  removeItem(key){database.delete(key);}
};
const traces=new Set();let traceNumber=1;const windowListeners=Object.create(null);
const window={
  history:{state:null,pushState(){},back(){}},addEventListener(type,fn){(windowListeners[type]||=[]).push(fn);},
  confirm(){return true;},NGBrain:{
    hasNeuron(id){return traces.has(id);},hasMemoryTrace(id){return traces.has(id);},
    createMemoryTrace(){const id="trace"+traceNumber++;traces.add(id);return id;},
    associateMemoryTraces(){},activateMemoryTraces(){},removeMemoryTraces(ids){for(const id of ids||[])traces.delete(id);}
  }
};
const sandbox={window,document,localStorage,console,Date,Math,Set,Map,JSON,Blob,URL,setTimeout(fn){fn();return 1;}};
for(const path of ["knowledge.js","goals.js","observation-engine.js","knowledge-graph.js","reasoning-audit.js","dialog-context.js","dialog-manager.js","discriminating-observations.js","hypothesis-lifecycle.js","llm-bridge.js","memory.js"])
  vm.runInNewContext(fs.readFileSync(path,"utf8"),sandbox,{filename:path});

const input=document.getElementById("memory-import-file");
const handler=(input.listeners.change||[]).slice(-1)[0];
assert.equal(typeof handler,"function","memory import handler must be registered");
(async()=>{
  const keys=["neurogenesis.memories.v1","neurogenesis.dialog.v1","neurogenesis.dialog-context.v1","neurogenesis.model-decisions.v1","neurogenesis.model-evidence.v1","neurogenesis.reasoning-archive.v1","neurogenesis.inquiries.v1","neurogenesis.cognitive-cycles.v1","neurogenesis.goals.v1"];
  const beforeStorage=new Map(keys.map(key=>[key,database.has(key)?database.get(key):null]));
  const beforeCount=window.NGMemory.count();
  const beforeContext=JSON.stringify(window.NGMemory.dialogContext());
  const beforeGoals=JSON.stringify(window.NGMemory.goals());
  const beforeTraces=traces.size;
  input.files=[{async text(){return JSON.stringify({
    format:"NEUROGENESIS_MEMORY_BACKUP",version:2,
    memories:[{id:"atomic-import-regression",text:"Проверка атомарного восстановления резервной копии",tags:[],traceIds:[],createdAt:Date.now(),updatedAt:Date.now(),strength:.65,repetitions:1,recalls:0}],
    dialog:[],modelDecisions:[],modelEvidence:[],reasoningArchive:[],inquiries:[],cognitiveCycles:[],
    goals:[{id:"G-Q999",inquiryId:"Q999",kind:"missing_observation",title:"Временная цель проверки отката",status:"active",nextAction:"Удалить цель при откате",blockers:[],sourceClaimIds:[],evidenceClaimIds:[],evidenceMemoryIds:[],observationCount:0,eventCount:0,unknownEventCount:0,completeObservationCount:0,incompleteObservationCount:0,metadataCoverage:0,numericOutcomeMissingCount:0,milestones:[],progress:1,focusScore:1,selected:false,assessment:"unassessed",assessmentReason:"",createdAt:Date.now(),updatedAt:Date.now()+1000,lastProgressAt:Date.now()}]
  });}}];
  failStorageWriteOnceFor="neurogenesis.model-evidence.v1";
  await handler({target:input});
  assert.equal(window.NGMemory.count(),beforeCount,"failed import must restore original memories");
  assert.equal(JSON.stringify(window.NGMemory.dialogContext()),beforeContext,"failed import must restore dialogue context");
  assert.equal(JSON.stringify(window.NGMemory.goals()),beforeGoals,"failed import must restore research goals");
  assert.equal(traces.size,beforeTraces,"failed import must remove new neural traces");
  for(const key of keys)assert.equal(database.has(key)?database.get(key):null,beforeStorage.get(key),"failed import must restore "+key);
  assert.equal(window.NGMemory.search("атомарного восстановления").some(row=>row.text.includes("Проверка атомарного восстановления резервной копии")),false,"rejected backup memory must not remain searchable");
  assert.match(document.getElementById("memory-feedback").textContent,/Все изменения отменены/u,"UI must report rollback");
  console.log("NEUROGENESIS atomic backup import rollback: passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
