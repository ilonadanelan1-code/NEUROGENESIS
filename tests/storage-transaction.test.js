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
