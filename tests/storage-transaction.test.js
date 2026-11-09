"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const database=new Map([["atomic.test.first","old-first"],["atomic.test.second","old-second"],["neurogenesis.goals.v1","[]"]]);
let shouldFail=null;
const localStorage={
 getItem(key){return database.has(key)?database.get(key):null;},
 setItem(key,value){const text=String(value);if(shouldFail&&shouldFail(key,text)){shouldFail=null;throw new Error("Injected localStorage quota failure");}database.set(key,text);},
 removeItem(key){database.delete(key);}
};
function createGoalsSandbox(){const window={};const sandbox={window,localStorage,console,Date,Math,Set,Map,JSON};vm.runInNewContext(fs.readFileSync("goals.js","utf8"),sandbox,{filename:"goals.js"});return window;}
let window=createGoalsSandbox(),transaction=window.NGStorageTransaction;
assert.ok(transaction&&transaction.status().ready);
shouldFail=(key,value)=>key==="atomic.test.second"&&value==="new-second";
assert.equal(transaction.run([{key:"atomic.test.first",value:"new-first"},{key:"atomic.test.second",value:"new-second"}]),false);
assert.equal(database.get("atomic.test.first"),"old-first");
assert.equal(database.get("atomic.test.second"),"old-second");
assert.equal(database.has(transaction.key),false);
assert.equal(transaction.status().ready,true);
shouldFail=key=>key===transaction.key;
assert.equal(transaction.run([{key:"atomic.test.first",value:"must-not-appear"}]),false);
assert.equal(database.get("atomic.test.first"),"old-first");
assert.equal(database.has(transaction.key),false);
assert.equal(transaction.begin(),true);
assert.equal(transaction.stage("atomic.test.first","nested-first"),true);
assert.equal(transaction.begin(),true);
assert.equal(transaction.stage("atomic.test.second","nested-second"),true);
assert.equal(transaction.commit(),true);
assert.equal(database.get("atomic.test.first"),"old-first");
assert.equal(transaction.commit(),true);
assert.equal(database.get("atomic.test.first"),"nested-first");
assert.equal(database.get("atomic.test.second"),"nested-second");
assert.equal(database.has(transaction.key),false);
assert.equal(transaction.run([{key:"atomic.test.first",value:null}]),true);
assert.equal(database.has("atomic.test.first"),false);
database.set(transaction.key,JSON.stringify({version:1,before:[{key:"atomic.test.second",value:"nested-second"},{key:"atomic.test.third",value:null}]}));
database.set("atomic.test.second","partially-written-second");
database.set("atomic.test.third","partially-created-third");
window=createGoalsSandbox();transaction=window.NGStorageTransaction;
assert.equal(database.get("atomic.test.second"),"nested-second");
assert.equal(database.has("atomic.test.third"),false);
assert.equal(database.has(transaction.key),false);
assert.equal(transaction.status().ready,true);
console.log("NEUROGENESIS atomic localStorage transactions: passed.");

const blockedWindow={};
const blockedWarnings=[];
const blockedStorage={
 getItem(){throw new Error("SecurityError: localStorage is blocked");},
 setItem(){throw new Error("SecurityError: localStorage is blocked");},
 removeItem(){throw new Error("SecurityError: localStorage is blocked");}
};
const blockedSandbox={
 window:blockedWindow,localStorage:blockedStorage,Date,Math,Set,Map,JSON,
 console:{warn(...args){blockedWarnings.push(args.map(String).join(" "));},error(){}}
};
assert.doesNotThrow(()=>vm.runInNewContext(fs.readFileSync("goals.js","utf8"),blockedSandbox,{filename:"goals.js"}));
assert.ok(blockedWindow.NGGoals,"research goal APIs must still initialize when browser storage is denied");
const blockedTransaction=blockedWindow.NGStorageTransaction;
assert.equal(blockedTransaction.status().ready,false,
 "the storage transaction must report an unavailable journal instead of claiming persistence is ready");
const volatileGoal=blockedWindow.NGGoals.reconcile({
 inquiries:[{id:"Q990",kind:"missing_observation",edgeSubject:"A",edgeObject:"B",
  question:"Нужно наблюдение",status:"open",createdAt:1000,updatedAt:1000}],
 memories:[],now:2000
});
assert.equal(volatileGoal.total,1,
 "the in-memory research workflow should remain usable even when durable storage is denied");
assert.equal(blockedWindow.NGGoals.list()[0].inquiryId,"Q990");
assert.equal(blockedTransaction.status().ready,false,
 "a failed write must not silently restore the storage-ready state");
assert.ok(blockedWarnings.some(message=>message.includes("storage transaction")),
 "the unavailable persistence path must be visible in diagnostics");
console.log("NEUROGENESIS denied-storage startup: in-memory goals remain available and persistence stays explicitly unavailable.");

const interruptedDatabase=new Map([
 ["atomic.recovery.first","before-first"],
 ["atomic.recovery.second","before-second"]
]);
let failForwardWrite=true;
let failRollbackWrite=true;
const interruptedStorage={
 getItem(key){return interruptedDatabase.has(key)?interruptedDatabase.get(key):null;},
 setItem(key,value){
  const text=String(value);
  if(key==="atomic.recovery.second"&&text==="after-second"&&failForwardWrite){
   failForwardWrite=false;
   throw new Error("Injected failure during forward commit");
  }
  if(key==="atomic.recovery.first"&&text==="before-first"&&failRollbackWrite){
   failRollbackWrite=false;
   throw new Error("Injected failure during rollback");
  }
  interruptedDatabase.set(key,text);
 },
 removeItem(key){interruptedDatabase.delete(key);}
};
const interruptedWindow={};
const interruptedWarnings=[];
const interruptedSandbox={
 window:interruptedWindow,localStorage:interruptedStorage,Date,Math,Set,Map,JSON,
 console:{warn(...args){interruptedWarnings.push(args.map(String).join(" "));},error(){}}
};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),interruptedSandbox,{filename:"goals-interrupted-recovery.js"});
const interruptedTransaction=interruptedWindow.NGStorageTransaction;
assert.equal(interruptedTransaction.run([
 {key:"atomic.recovery.first",value:"after-first"},
 {key:"atomic.recovery.second",value:"after-second"}
]),false,"a failed forward write must not be reported as committed");
assert.equal(interruptedTransaction.status().ready,false,
 "an interrupted rollback must leave storage unavailable instead of claiming consistency");
assert.ok(interruptedDatabase.has(interruptedTransaction.key),
 "the before-image journal must be retained when rollback cannot finish");
assert.ok(interruptedWarnings.some(message=>message.includes("journal was retained")),
 "the incomplete recovery must explicitly report that its before-image journal was retained");
const recoveryWindow={};
const recoverySandbox={
 window:recoveryWindow,localStorage:interruptedStorage,Date,Math,Set,Map,JSON,console
};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),recoverySandbox,{filename:"goals-recovery-after-restart.js"});
const recoveredTransaction=recoveryWindow.NGStorageTransaction;
assert.equal(recoveredTransaction.status().ready,true,
 "a fresh module initialization must retry and complete the retained recovery journal");
assert.equal(interruptedDatabase.get("atomic.recovery.first"),"before-first");
assert.equal(interruptedDatabase.get("atomic.recovery.second"),"before-second");
assert.equal(interruptedDatabase.has(recoveredTransaction.key),false,
 "the journal must be removed only after the before-image has been restored");

const corruptDatabase=new Map([["neurogenesis.storage-transaction.v1","{not-json"]]);
const corruptStorage={
 getItem(key){return corruptDatabase.has(key)?corruptDatabase.get(key):null;},
 setItem(key,value){corruptDatabase.set(key,String(value));},
 removeItem(key){corruptDatabase.delete(key);}
};
const corruptWindow={};
const corruptSandbox={window:corruptWindow,localStorage:corruptStorage,Date,Math,Set,Map,JSON,console};
vm.runInNewContext(fs.readFileSync("goals.js","utf8"),corruptSandbox,{filename:"goals-corrupt-journal.js"});
assert.equal(corruptWindow.NGStorageTransaction.status().ready,false,
 "an unreadable journal must block writes instead of silently discarding recovery information");
assert.equal(corruptDatabase.get("neurogenesis.storage-transaction.v1"),"{not-json",
 "an invalid journal must be retained for diagnosis rather than silently removed");
console.log("NEUROGENESIS interrupted rollback recovery: retained journal, restart recovery and corrupt-journal guard passed.");
