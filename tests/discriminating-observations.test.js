"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync("knowledge.js","utf8"),sandbox,{filename:"knowledge.js"});
vm.runInNewContext(fs.readFileSync("discriminating-observations.js","utf8"),sandbox,{filename:"discriminating-observations.js"});
const knowledge=sandbox.window.NGKnowledge;
const engine=sandbox.window.NGDiscriminatingObservations.create(knowledge);
function causal(id,subject,object){
  return {id,kind:"causal",subject,object,polarity:true,status:"current",evidence:subject+" приводит к "+object};
}
function observation(id,subject,object,polarity=true,complete=false){
  const field=status=>({status,value:status==="provided"?"указано":""});
  return {id,kind:"observation",subject,object,polarity,status:"current",evidence:id,
    observationCase:complete?{context:field("provided"),timing:field("provided"),criterion:field("provided")}:
      {context:field("not_stated"),timing:field("not_stated"),criterion:field("not_stated")}};
}
const sleep=causal("c1","Недостаток сна","Усталость");
const stress=causal("c2","Стресс","Усталость");
const conclusion={subject:"Причины",object:"Усталость",paths:[[sleep],[stress]]};
const before=JSON.stringify({conclusion,claims:[sleep,stress]});
const result=engine.analyze(conclusion,[sleep,stress]);
assert.ok(result,"two distinct causal routes should produce a discriminating inquiry");
assert.equal(result.comparisonEdges.length,2);
assert.ok(result.question.includes("Недостаток сна"));
assert.ok(result.question.includes("Стресс"));
assert.ok(result.question.includes("Усталость"));
assert.ok(result.question.includes("естественные случаи"));
assert.ok(result.question.includes("Не нужно специально создавать условия"));
assert.ok(result.reason.includes("не считаются независимыми подтверждениями"));
assert.equal(JSON.stringify({conclusion,claims:[sleep,stress]}),before,"analysis must not mutate source routes or claims");
assert.ok(result.sourceClaimIds.includes("c1")&&result.sourceClaimIds.includes("c2"));
assert.equal(engine.analyze({subject:"Причины",object:"Усталость",paths:[[sleep],[sleep]]},[sleep]),null,
  "duplicate routes must not create a fake comparison");
assert.equal(engine.analyze({subject:"Причины",object:"Усталость",paths:[[sleep]]},[sleep]),null,
  "one route is not a competition");
assert.equal(engine.analyze({subject:"Причины",object:"Усталость",paths:[]},[]),null);
const shared=causal("c3","Недосып","Концентрация");
const left=causal("c4","Концентрация","Ошибки");
const right=causal("c5","Концентрация","Усталость");
const divergent=engine.analyze({subject:"Недосып",object:"Результат",paths:[[shared,left],[shared,right]]},[shared,left,right]);
assert.equal(divergent.commonPrefix,1,"the selector should focus on the first true route divergence");
assert.ok(divergent.comparisonEdges.some(edge=>edge.object==="Ошибки"));
assert.ok(divergent.comparisonEdges.some(edge=>edge.object==="Усталость"));
const sameStartA=causal("c6","Недосып","Стресс");
const sameStartB=causal("c7","Недосып","Настроение");
const sameStart=engine.analyze({subject:"Недосып",object:"Усталость",paths:[[sameStartA],[sameStartB]]},[sameStartA,sameStartB]);
assert.ok(sameStart,"routes with a common starting condition but different branches should remain comparable");
const repeated=observation("o1","Недостаток сна","Усталость",true,false);
const scoreOnce=engine.analyze(conclusion,[sleep,stress,repeated]).score;
const scoreRepeated=engine.analyze(conclusion,[sleep,stress,repeated,{...repeated,id:"o1-copy"},{...repeated,id:"o1-copy-2"}]).score;
assert.equal(scoreOnce,scoreRepeated,"repeated records must not make one branch look like independent evidence");
const mixed=engine.analyze(conclusion,[sleep,stress,repeated,observation("o2","Недостаток сна","Усталость",false,true)]);
assert.ok(mixed,"conflicting observations must not suppress a useful comparison");
const reordered=engine.analyze({...conclusion,paths:conclusion.paths.slice().reverse()},[stress,sleep]);
assert.equal(reordered.signature,result.signature,"ranking and signatures must be stable under input reordering");
console.log("NEUROGENESIS discriminating-observation tests: competing paths, first divergence, neutral questions, duplicate evidence and non-mutation passed.");