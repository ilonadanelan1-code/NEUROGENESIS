"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync("knowledge.js","utf8"),sandbox,{filename:"knowledge.js"});
vm.runInNewContext(fs.readFileSync("reasoning-audit.js","utf8"),sandbox,{filename:"reasoning-audit.js"});
const knowledge=sandbox.window.NGKnowledge;
const audit=sandbox.window.NGReasoningAudit.create(knowledge);
function causal(id,subject,object,polarity=true,evidence=id){
  return {id,kind:"causal",subject,object,predicate:"приводит к",polarity,status:"current",
    verification:"unverified",source:"user_message",evidence};
}
function observation(id,subject,object,polarity,evidence){
  return {id,kind:"observation",subject,object,polarity,status:"current",verification:"unverified",evidence};
}
const shared=causal("c1","Музыка","Настроение",true,"Одно и то же общее утверждение");
const c2=causal("c2","Настроение","Энергия",true,"Настроение связано с энергией");
const c3=causal("c3","Музыка","Сон",true,"Одно и то же общее утверждение");
const c4=causal("c4","Сон","Энергия",true,"Сон связан с энергией");
const claims=[shared,c2,c3,c4,
  causal("c1-negative","Музыка","Настроение",false,"Музыка не влияет на настроение"),
  observation("o1","Настроение","Энергия",true,"После изменения настроения отмечалась энергия"),
  observation("o2","Настроение","Энергия",false,"В другом случае энергия не изменилась"),
  observation("o3","Музыка","Сон",true,"При музыке наблюдалось изменение сна")];
const sourceByClaim={c1:"memory-shared",c2:"memory-one",c3:"memory-two",c4:"memory-two",
  "c1-negative":"memory-conflict",o1:"memory-observation-1",o2:"memory-observation-2",o3:"memory-observation-3"};
const paths=[[shared,c2],[c3,c4]];
const before=JSON.stringify({claims,sourceByClaim,paths});
const result=audit.analyze(paths,claims,sourceByClaim);
assert.equal(result.routeCount,2);
assert.equal(result.sharedEdges.length,0,"different complete explanations do not share an edge merely because they share a destination");
assert.equal(result.conflicts.length,1,"a direct opposing causal statement should be detected for a used edge");
assert.equal(result.counterObservationCount,1);
assert.equal(result.supportingObservationCount,2);
assert.ok(result.unobservedStepCount>=1);
assert.equal(result.sourceRecordCount,3,"distinct memory records are provenance, not independent sources");
assert.ok(result.changeConditions.some(item=>/контрнаблюдений/u.test(item)));
assert.ok(result.changeConditions.some(item=>/альтернатив/u.test(item)));
assert.ok(result.changeConditions.some(item=>/не гарантируют независимость/u.test(item)));
const formatted=audit.format(result);
assert.ok(formatted.includes("СРАВНЕНИЕ ПРИЧИННЫХ МАРШРУТОВ"));
assert.ok(formatted.includes("ПРОТИВОРЕЧИЯ"));
assert.ok(formatted.includes("ЧТО МОЖЕТ ИЗМЕНИТЬ ВЫВОД"));
assert.ok(formatted.includes("не являются автоматически независимыми"));
assert.equal(JSON.stringify({claims,sourceByClaim,paths}),before,"analysis must not mutate source claims or paths");
const sharedRoute=audit.analyze([[shared,c2],[shared,c3,c4]],claims,sourceByClaim);
assert.ok(sharedRoute.sharedEdges.some(edge=>edge.subject==="Музыка"&&edge.object==="Настроение"&&edge.routeCount===2),
  "a common edge must be identified as a shared dependency");
assert.ok(sharedRoute.sharedClaims.some(item=>item.claimId==="c1"&&item.routeCount===2),
  "the same source claim must not be counted twice as separate support");
const repeatedClaim={...c4,evidence:"Одно и то же общее утверждение"};
const duplicateEvidence=audit.analyze([[c3],[repeatedClaim]],[c3,repeatedClaim],sourceByClaim);
assert.ok(duplicateEvidence.repeatedEvidence.some(item=>item.claimCount===2),
  "repeated evidence text must be marked as dependent rather than independent confirmation");
const empty=audit.analyze([],claims,sourceByClaim);
assert.equal(empty.routeCount,0);
assert.equal(audit.format(empty),"");
console.log("NEUROGENESIS reasoning audit tests: route comparison, shared dependencies, repeated evidence, observations, conflicts, provenance and non-mutation passed.");