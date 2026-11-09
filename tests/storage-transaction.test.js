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
