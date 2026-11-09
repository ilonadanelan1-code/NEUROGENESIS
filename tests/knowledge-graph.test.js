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
const empty=graphEngine.build([]);
assert.equal(empty.stats.nodes,0);
assert.equal(empty.stats.edges,0);
assert.equal(empty.stats.conflicts,0);
console.log("NEUROGENESIS knowledge graph tests: stable IDs, provenance, concepts, explicit events, conflicts and non-mutation passed.");
