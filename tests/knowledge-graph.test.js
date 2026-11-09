"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync("knowledge.js","utf8"),sandbox,{filename:"knowledge.js"});
vm.runInNewContext(fs.readFileSync("knowledge-graph.js","utf8"),sandbox,{filename:"knowledge-graph.js"});
const knowledge=sandbox.window.NGKnowledge;
const graphEngine=sandbox.window.NGKnowledgeGraph.create(knowledge);
assert.ok(graphEngine,"graph engine should expose a builder");
function observation(id,eventRef,polarity,evidence){
  return {id,kind:"observation",subject:"Недостаток сна",predicate:"наблюдение",
    object:polarity?"усталость":"отсутствие усталости",holder:"user",polarity,source:"user_message",
    evidence,verification:"unverified",extractionConfidence:0.86,createdAt:1000,
    observationCase:{schema:2,eventRef,source:"direct_observation"}};
}
const friend=knowledge.extractClaims("Игорь мой друг")[0];
const notFriend=knowledge.extractClaims("Игорь не мой друг")[0];
const memories=[
  {id:"memory-a",text:"Игорь мой друг",createdAt:100,claims:[friend]},
  {id:"memory-b",text:"Игорь не мой друг",createdAt:200,claims:[notFriend]},
  {id:"memory-c",text:"Первое наблюдение",createdAt:300,claims:[observation("observation-c1","episode-7",true,"При недостатке сна наблюдалась усталость")]},
  {id:"memory-d",text:"Дополнение к эпизоду",createdAt:400,claims:[observation("observation-d1","episode-7",true,"В том же эпизоде отмечена усталость")]},
  {id:"memory-e",text:"Похожее описание без ID",createdAt:500,claims:[observation("observation-e1","",true,"При недостатке сна наблюдалась усталость")]}
];
const original=JSON.stringify(memories),graph=graphEngine.build(memories);
assert.equal(JSON.stringify(memories),original,"building the graph must not mutate source memories");
assert.equal(graph.schemaVersion,1);
assert.equal(graph.stats.memories,5);
assert.equal(graph.stats.observations,3);
assert.equal(graph.stats.events,1,"only an explicit eventRef creates an event node");
assert.equal(graph.stats.linkedObservations,2);
assert.equal(graph.stats.unlinkedObservations,1);
assert.ok(graph.stats.concepts>=3);
assert.ok(graph.edges.some(edge=>edge.type==="contains"));
assert.ok(graph.edges.some(edge=>edge.type==="asserts"&&edge.claimKind==="relationship"));
assert.ok(graph.edges.some(edge=>edge.type==="conflicts_with"),
  "conflicting source claims should be represented as a conflict edge");
const event=graph.nodes.find(node=>node.type==="event");
assert.equal(event.eventRef,"episode-7");
assert.equal(event.memberClaimIds.length,2,
  "two source claims may point to one event only through an explicit eventRef");
const igor=graph.nodes.find(node=>node.type==="concept"&&node.aliases.some(alias=>knowledge.sameEntity(alias,"Игоря")));
assert.ok(igor,"normalized mentions of the same concept should share one concept node");
assert.ok(graph.edges.some(edge=>edge.type==="asserts"&&edge.from===igor.id),
  "concept nodes should be connected by provenance-bearing assertion edges");
const reordered=graphEngine.build(memories.slice().reverse());
assert.deepEqual(reordered.nodes.map(node=>node.id),graph.nodes.map(node=>node.id),
  "node IDs should be stable when memory input order changes");
assert.deepEqual(reordered.edges.map(edge=>edge.id),graph.edges.map(edge=>edge.id),
  "edge IDs should be stable when memory input order changes");
const malformedArchiveClaim={id:"archive-malformed",kind:"causal",subject:"что усталость",
  predicate:"приводит к",object:"снижению концентрации",polarity:true,status:"current",
  verification:"unverified",evidence:"что усталость приводит к снижению концентрации"};
const reportingArchiveClaim={...malformedArchiveClaim,id:"archive-report",
  subject:"В отчёте говорится, что усталость"};
const validArchiveClaim=knowledge.extractClaims("Недостаток сна после тренировки приводит к усталости")[0];
const defensiveGraph=graphEngine.build([{id:"archive-boundary",text:"Импортированная архивная запись",
  claims:[malformedArchiveClaim,reportingArchiveClaim,validArchiveClaim]}]);
const defensiveClaims=defensiveGraph.nodes.filter(node=>node.type==="claim");
assert.equal(defensiveClaims.length,1,
  "the graph must sanitize direct inputs instead of trusting archived memory claims");
assert.equal(defensiveClaims[0].subject,"Недостаток сна после тренировки",
  "only the valid causal claim should be projected into the graph");
assert.equal(defensiveGraph.nodes.find(node=>node.type==="memory"&&node.memoryId==="archive-boundary").claimCount,1,
  "memory graph metadata must count only sanitized claims");
const empty=graphEngine.build([]);
assert.equal(empty.stats.nodes,0);
assert.equal(empty.stats.edges,0);
assert.equal(empty.stats.conflicts,0);

function relation(id,subject,predicate,object,polarity=true,modality="asserted") {
  return {id,kind:"relationship",subject,predicate,object,polarity,modality,verification:"unverified",
    source:"user_message",evidence:subject+" "+predicate+" "+object,status:"current"};
}
const connectedGraph=graphEngine.build([
  {id:"bridge",text:"Музыка связана с настроением",claims:[relation("bridge-claim","Музыка","связана с","Настроением")]},
  {id:"indirect",text:"Настроение влияет на энергию",claims:[relation("indirect-claim","Настроение","влияет на","Энергию")]},
  {id:"unrelated",text:"Сон связан с энергией",claims:[relation("unrelated-claim","Сон","связан с","Энергией")]}
]);
const musicRecall=graphEngine.search(connectedGraph,"музыка",10);
assert.ok(musicRecall.anchors.some(item=>item.label==="Музыка"),"query concepts should become graph anchors");
assert.ok(musicRecall.matches.some(item=>item.memoryId==="bridge"&&item.pathType!=="two_hop"),
  "claims directly linked to a matching concept should be retrievable");
const indirect=musicRecall.matches.find(item=>item.memoryId==="indirect");
assert.ok(indirect,"graph traversal should retrieve a claim connected through an intermediate concept");
assert.equal(indirect.pathType,"two_hop");
assert.equal(JSON.stringify(indirect.viaConcepts),JSON.stringify(["Музыка","Настроением"]));
assert.ok(indirect.path.length>=2,"an indirect result must include its traversed graph edges");
assert.ok(!musicRecall.matches.some(item=>item.memoryId==="unrelated"),
  "shared destination concepts alone must not create a path without an explicit bridge");
const noPositiveBridge=graphEngine.build([
  {id:"negative-bridge",text:"Музыка не связана с настроением",claims:[relation("negative","Музыка","связана с","Настроением",false)]},
  {id:"target",text:"Настроение связано с энергией",claims:[relation("target","Настроение","связано с","Энергией")]}
]);
const negativeRecall=graphEngine.search(noPositiveBridge,"музыка",10);
assert.ok(!negativeRecall.matches.some(item=>item.memoryId==="target"&&item.pathType==="two_hop"),
  "negative claims must not act as positive reasoning bridges");
const noHypothesisBridge=graphEngine.build([
  {id:"possible-bridge",text:"Музыка может быть связана с настроением",claims:[relation("possible","Музыка","связана с","Настроением",true,"possible")]},
  {id:"possible-target",text:"Настроение связано с энергией",claims:[relation("possible-target","Настроение","связано с","Энергией")]}
]);
const possibleRecall=graphEngine.search(noHypothesisBridge,"музыка",10);
assert.ok(!possibleRecall.matches.some(item=>item.memoryId==="possible-target"&&item.pathType==="two_hop"),
  "hypothetical claims must not act as established positive bridges");
assert.equal(graphEngine.search(connectedGraph,"неизвестное слово",10).matches.length,0,
  "queries without a graph match should return an empty result");
console.log("NEUROGENESIS knowledge graph tests: stable IDs, provenance, explicit events, conflicts, bounded traversal and guarded reasoning passed.");
