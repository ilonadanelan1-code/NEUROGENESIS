import assert from "node:assert/strict";
import "../neuron-layout.js";

const api=globalThis.NGNeuronLayout;
assert.equal(typeof api?.cluster,"function");
const nodes=[],synapses=[],communitySize=8,groupCount=3;
for(let group=0;group<groupCount;group++)for(let local=0;local<communitySize;local++)nodes.push({
  id:"g"+group+"-n"+local,name:"Группа "+group+" / нейрон "+local,
  type:local===0?"core":"logic",x:((group*17+local*3)%9)*7,y:((group*11+local*5)%7)*8
});
for(let group=0;group<groupCount;group++){
  const offset=group*communitySize;
  for(let a=0;a<communitySize;a++)for(let b=a+1;b<communitySize;b++)
    synapses.push({from:nodes[offset+a].id,to:nodes[offset+b].id,weight:.8});
}
synapses.push({from:"g0-n0",to:"g1-n0",weight:.12},{from:"g1-n1",to:"g2-n0",weight:.12});
const originalNodes=JSON.stringify(nodes),originalEdges=JSON.stringify(synapses);
const options={minDistance:54,clusterIterations:180,resolution:1};
const result=api.cluster(nodes,synapses,options);
assert.equal(result.positions.length,nodes.length);
assert.ok(result.communityCount>=3,"dense communities joined by weak bridges must stay separate");
assert.equal(result.overlapsAfter,0,"community packing must not overlap nodes");
assert.ok(result.modularity>.25,"fixture should expose meaningful modularity");
assert.ok(result.interCommunityEdgeCount>=2);
assert.ok(result.averageInternalEdgeLength<result.averageInterCommunityEdgeLength,
  "intra-community edges should be shorter than cross-community edges");
assert.equal(JSON.stringify(nodes),originalNodes,"layout must not mutate source neurons");
assert.equal(JSON.stringify(synapses),originalEdges,"layout must not mutate source synapses");
assert.deepEqual(result.positions,api.cluster(nodes,synapses,options).positions,"layout must be deterministic");
const groupIds=new Map(result.groupById.map(row=>[row.id,row.clusterId]));
for(let group=0;group<groupCount;group++){
  const ids=Array.from({length:communitySize},(_,local)=>"g"+group+"-n"+local);
  assert.equal(new Set(ids.map(id=>groupIds.get(id))).size,1,"each dense fixture group must stay together");
}
const triangle=api.cluster([{id:"l",x:0,y:0},{id:"m",x:10,y:0},{id:"r",x:20,y:0}],[
  {from:"l",to:"m",weight:1},{from:"m",to:"r",weight:1},{from:"r",to:"l",weight:1}
],{minDistance:40,clusterIterations:60});
assert.equal(triangle.communityCount,1,"a strongly connected triangle should remain one group");
const isolated=api.cluster([{id:"one",x:0,y:0},{id:"two",x:0,y:0},{id:"three",x:0,y:0}],[],
  {minDistance:40,clusterIterations:40});
assert.equal(isolated.communityCount,3,"unconnected neurons must remain separate");
assert.equal(isolated.overlapsAfter,0);
assert.throws(()=>api.cluster(nodes,synapses,{communityGap:10}),/safe bounds/u);
assert.throws(()=>api.cluster(nodes,synapses,{resolution:9}),/safe bounds/u);


const manyIsolated = Array.from({ length: 183 }, (_, index) => ({
  id: "isolated-" + index, x: 0, y: 0
}));
const compact = api.cluster(manyIsolated, [], {
  minDistance: 54, clusterIterations: 40, communityGap: 60
});
assert.equal(compact.communityCount, 183);
assert.equal(compact.overlapsAfter, 0);
assert.ok(compact.bounds.width < 3000 && compact.bounds.height < 3000,
  "many independent visual groups must fit a phone-sized world coordinate range");
for (let i = 0; i < compact.clusters.length; i++) {
  for (let j = i + 1; j < compact.clusters.length; j++) {
    const a = compact.clusters[i], b = compact.clusters[j];
    const distance = Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY);
    assert.ok(distance + 1e-5 >= a.radius + b.radius + 60,
      "group halos must not overlap");
  }
}


const largeBounds = { minX: -9000, maxX: 9000, minY: -7200, maxY: 7200 };
for (const [width, height] of [[1440, 760], [980, 610], [1920, 560], [390, 720]]) {
  const fitted = api.fitViewport(largeBounds, width, height, {
    paddingX: 40, paddingY: 50, minZoom: 0.015, maxZoom: 1.8
  });
  assert.equal(fitted.fits, true, "large graph must fit viewport " + width + "x" + height);
  assert.ok(fitted.zoom >= 0.015 && fitted.zoom <= 1.8);
  assert.ok(fitted.projectedBounds.minX >= 39.999);
  assert.ok(fitted.projectedBounds.maxX <= width - 39.999);
  assert.ok(fitted.projectedBounds.minY >= 49.999);
  assert.ok(fitted.projectedBounds.maxY <= height - 49.999);
}
const tooLarge = api.fitViewport(
  { minX: -1e8, maxX: 1e8, minY: -1e8, maxY: 1e8 },
  980, 610, { paddingX: 40, paddingY: 50, minZoom: 0.015, maxZoom: 1.8 }
);
assert.equal(tooLarge.fits, false, "graphs beyond the zoom floor must be reported as not fitted");

console.log("NEUROGENESIS community layout: dense groups, weak bridges, deterministic placement, edge-length separation, connected triangle, isolated neurons and compact 183-group packing passed.");
