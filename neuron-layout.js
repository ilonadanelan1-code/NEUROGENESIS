(() => {
  "use strict";
  const DEFAULT_MIN_DISTANCE = 86;
  const DEFAULT_ITERATIONS = 400;
  const EPSILON = 1e-7;

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(name + " must be finite");
    return number;
  }
  function stableAngle(firstId, secondId) {
    const text = String(firstId) + "\u0000" + String(secondId);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) / 4294967296) * Math.PI * 2;
  }
  function buildGrid(xs, ys, cellSize) {
    const grid = new Map();
    for (let i = 0; i < xs.length; i++) {
      const key = Math.floor(xs[i] / cellSize) + ":" + Math.floor(ys[i] / cellSize);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }
    return grid;
  }
  function measure(xs, ys, minDistance) {
    const grid = buildGrid(xs, ys, minDistance);
    let overlaps = 0, minimumDistance = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const cellX = Math.floor(xs[i] / minDistance);
      const cellY = Math.floor(ys[i] / minDistance);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get((cellX + ox) + ":" + (cellY + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const distance = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
          if (distance < minimumDistance) minimumDistance = distance;
          if (distance + EPSILON < minDistance) overlaps++;
        }
      }
    }
    return { overlaps, minimumDistance: Number.isFinite(minimumDistance) ? minimumDistance : null };
  }
  function separate(nodes, options = {}) {
    if (!Array.isArray(nodes)) throw new TypeError("nodes must be an array");
    if (nodes.length > 2500) throw new RangeError("The layout safety limit is 2500 neurons");
    const settings = options && typeof options === "object" ? options : {};
    const minDistance = finite(settings.minDistance ?? DEFAULT_MIN_DISTANCE, "minDistance");
    const iterations = Math.floor(finite(settings.iterations ?? DEFAULT_ITERATIONS, "iterations"));
    const relaxation = finite(settings.relaxation ?? 0.38, "relaxation");
    const maxMove = finite(settings.maxMove ?? 24, "maxMove");
    if (minDistance < 24 || minDistance > 240 || iterations < 1 || iterations > 400 ||
        relaxation <= 0 || relaxation > 0.5 || maxMove <= 0 || maxMove > 48) {
      throw new RangeError("Layout parameters are outside safe bounds");
    }

    const ids = new Set(), xs = new Float64Array(nodes.length), ys = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || node.id == null || String(node.id).trim() === "") {
        throw new TypeError("Every neuron must have a non-empty ID");
      }
      const id = String(node.id);
      if (ids.has(id)) throw new TypeError("Neuron IDs must be unique");
      ids.add(id);
      xs[i] = finite(node.x, "node.x");
      ys[i] = finite(node.y, "node.y");
    }

    const before = measure(xs, ys, minDistance);
    const separationDistance = minDistance + 2;
    let completedIterations = 0;
    for (let iteration = 0; iteration < iterations; iteration++) {
      const grid = buildGrid(xs, ys, separationDistance);
      const forceX = new Float64Array(nodes.length), forceY = new Float64Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const cellX = Math.floor(xs[i] / separationDistance), cellY = Math.floor(ys[i] / separationDistance);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((cellX + ox) + ":" + (cellY + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
            let distance = Math.hypot(dx, dy);
            if (distance >= minDistance) continue;
            if (distance < EPSILON) {
              const angle = stableAngle(nodes[i].id, nodes[j].id);
              dx = Math.cos(angle); dy = Math.sin(angle); distance = 1;
            }
            const displacement = Math.min(maxMove, (separationDistance - distance) * relaxation);
            const ux = dx / distance, uy = dy / distance;
            forceX[i] += ux * displacement; forceY[i] += uy * displacement;
            forceX[j] -= ux * displacement; forceY[j] -= uy * displacement;
          }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        const magnitude = Math.hypot(forceX[i], forceY[i]);
        if (magnitude <= EPSILON) continue;
        const scale = magnitude > maxMove ? maxMove / magnitude : 1;
        xs[i] += forceX[i] * scale; ys[i] += forceY[i] * scale;
      }
      completedIterations = iteration + 1;
      if (measure(xs, ys, minDistance).overlaps === 0) break;
    }

    const after = measure(xs, ys, minDistance);
    const positions = nodes.map((node, index) => ({ id: String(node.id), x: xs[index], y: ys[index] }));
    const movedCount = positions.reduce((count, position, index) =>
      count + (Math.hypot(position.x - Number(nodes[index].x), position.y - Number(nodes[index].y)) > 0.01 ? 1 : 0), 0);
    return Object.freeze({
      positions, movedCount, minDistance, overlapsBefore: before.overlaps,
      overlapsAfter: after.overlaps, minimumDistanceBefore: before.minimumDistance,
      minimumDistanceAfter: after.minimumDistance, iterations: completedIterations
    });
  }

  const DEFAULT_CLUSTER_DISTANCE = 86;
  const DEFAULT_CLUSTER_ITERATIONS = 150;

  function buildWeightedGraph(nodes, synapses) {
    const indexById = new Map(nodes.map((node, index) => [String(node.id), index]));
    const edgeMap = new Map();
    for (const edge of synapses) {
      if (!edge || edge.from == null || edge.to == null) continue;
      const a = indexById.get(String(edge.from)), b = indexById.get(String(edge.to));
      if (a === undefined || b === undefined || a === b) continue;
      const low = Math.min(a, b), high = Math.max(a, b), key = low + ":" + high;
      const raw = Number(edge.weight);
      const weight = Number.isFinite(raw) ? Math.max(.12, Math.min(1.5, Math.abs(raw))) : 1;
      const existing = edgeMap.get(key);
      if (existing) existing.weight += weight;
      else edgeMap.set(key, { a: low, b: high, weight });
    }
    const edges = [...edgeMap.values()];
    const adjacency = Array.from({ length: nodes.length }, () => new Map());
    const degree = new Float64Array(nodes.length);
    for (const edge of edges) {
      adjacency[edge.a].set(edge.b, (adjacency[edge.a].get(edge.b) || 0) + edge.weight);
      adjacency[edge.b].set(edge.a, (adjacency[edge.b].get(edge.a) || 0) + edge.weight);
      degree[edge.a] += edge.weight; degree[edge.b] += edge.weight;
    }
    return { edges, adjacency, degree, totalDegree: degree.reduce((a, b) => a + b, 0) };
  }

  function detectCommunities(nodes, graph, options = {}) {
    const resolution = finite(options.resolution ?? 1, "resolution");
    const maxPasses = Math.floor(finite(options.communityPasses ?? 28, "communityPasses"));
    if (resolution < .5 || resolution > 2 || maxPasses < 1 || maxPasses > 60) {
      throw new RangeError("Community detection parameters are outside safe bounds");
    }
    const count = nodes.length;
    const labels = Int32Array.from({ length: count }, (_, i) => i);
    const totals = Float64Array.from(graph.degree);
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) =>
      graph.degree[b] - graph.degree[a] || String(nodes[a].id).localeCompare(String(nodes[b].id)));
    let passes = 0;
    if (graph.totalDegree > EPSILON) {
      for (let pass = 0; pass < maxPasses; pass++) {
        let moved = false;
        for (const i of order) {
          const degree = graph.degree[i];
          if (degree <= EPSILON) continue;
          const old = labels[i];
          totals[old] -= degree;
          const byCommunity = new Map();
          for (const [neighbor, weight] of graph.adjacency[i]) {
            const community = labels[neighbor];
            byCommunity.set(community, (byCommunity.get(community) || 0) + weight);
          }
          let best = old, bestGain = 0;
          for (const community of [...byCommunity.keys()].sort((a,b)=>a-b)) {
            const gain = byCommunity.get(community) -
              resolution * degree * totals[community] / graph.totalDegree;
            if (gain > bestGain + 1e-10 ||
                (gain > 1e-10 && Math.abs(gain - bestGain) <= 1e-10 && community < best)) {
              best = community; bestGain = gain;
            }
          }
          labels[i] = best;
          totals[best] += degree;
          if (best !== old) moved = true;
        }
        passes = pass + 1;
        if (!moved) break;
      }
    }
    const buckets = new Map();
    for (let i=0;i<count;i++) {
      if(!buckets.has(labels[i])) buckets.set(labels[i],[]);
      buckets.get(labels[i]).push(i);
    }
    const communities=[...buckets.values()].map(group=>group.sort((a,b)=>
      String(nodes[a].id).localeCompare(String(nodes[b].id))))
      .sort((a,b)=>String(nodes[a[0]].id).localeCompare(String(nodes[b[0]].id)));
    const assignment=new Int32Array(count);
    communities.forEach((group,c)=>group.forEach(i=>assignment[i]=c));
    let modularity=0;
    if(graph.totalDegree>EPSILON){
      const inside=new Float64Array(communities.length), degreeTotals=new Float64Array(communities.length);
      for(let i=0;i<count;i++)degreeTotals[assignment[i]]+=graph.degree[i];
      for(const edge of graph.edges)if(assignment[edge.a]===assignment[edge.b])inside[assignment[edge.a]]+=edge.weight;
      for(let c=0;c<communities.length;c++)
        modularity+=inside[c]/(graph.totalDegree/2)-Math.pow(degreeTotals[c]/graph.totalDegree,2);
    }
    return {communities,assignment,modularity,passes};
  }

  function layoutCommunity(nodes, members, graph, options) {
    const distance=options.minDistance, iterations=options.clusterIterations, separation=distance+2;
    const memberSet=new Set(members);
    const localIndex=new Map(members.map((index,local)=>[index,local]));
    const localNodes=members.map(index=>nodes[index]);
    const order=[...members].sort((a,b)=>graph.degree[b]-graph.degree[a]||
      String(nodes[a].id).localeCompare(String(nodes[b].id)));
    const rank=new Map(order.map((index,i)=>[index,i]));
    const xs=new Float64Array(members.length),ys=new Float64Array(members.length);
    for(let i=0;i<members.length;i++){
      const original=members[i],place=rank.get(original);
      const angle=stableAngle(nodes[original].id,"community:"+String(nodes[members[0]].id));
      const radius=place===0?0:distance*.57*Math.sqrt(place);
      xs[i]=Math.cos(angle)*radius;ys[i]=Math.sin(angle)*radius;
    }
    const edges=graph.edges.filter(e=>memberSet.has(e.a)&&memberSet.has(e.b)).map(e=>({
      a:localIndex.get(e.a),b:localIndex.get(e.b),weight:e.weight
    }));
    for(let step=0;step<iterations;step++){
      const grid=buildGrid(xs,ys,separation);
      const fx=new Float64Array(members.length),fy=new Float64Array(members.length);
      for(let i=0;i<members.length;i++){
        const cx=Math.floor(xs[i]/separation),cy=Math.floor(ys[i]/separation);
        for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
          const bucket=grid.get((cx+ox)+":"+(cy+oy));if(!bucket)continue;
          for(const j of bucket){
            if(j<=i)continue;
            let dx=xs[i]-xs[j],dy=ys[i]-ys[j],d=Math.hypot(dx,dy);
            if(d>=distance)continue;
            if(d<EPSILON){const angle=stableAngle(localNodes[i].id,localNodes[j].id);dx=Math.cos(angle);dy=Math.sin(angle);d=1;}
            const push=Math.min(15,(separation-d)*.38),ux=dx/d,uy=dy/d;
            fx[i]+=ux*push;fy[i]+=uy*push;fx[j]-=ux*push;fy[j]-=uy*push;
          }
        }
      }
      for(const edge of edges){
        let dx=xs[edge.b]-xs[edge.a],dy=ys[edge.b]-ys[edge.a],d=Math.hypot(dx,dy);
        if(d<EPSILON){const angle=stableAngle(localNodes[edge.a].id,localNodes[edge.b].id);dx=Math.cos(angle);dy=Math.sin(angle);d=1;}
        const rest=distance*1.48,strength=.013*Math.min(1.7,Math.sqrt(edge.weight));
        const force=Math.max(-10,Math.min(10,(d-rest)*strength)),x=dx/d*force,y=dy/d*force;
        fx[edge.a]+=x;fy[edge.a]+=y;fx[edge.b]-=x;fy[edge.b]-=y;
      }
      for(let i=0;i<members.length;i++){
        fx[i]-=xs[i]*.0011;fy[i]-=ys[i]*.0011;
        const magnitude=Math.hypot(fx[i],fy[i]);
        if(magnitude>EPSILON){const scale=magnitude>18?18/magnitude:1;xs[i]+=fx[i]*scale;ys[i]+=fy[i]*scale;}
      }
    }
    const separated=separate(localNodes.map((node,i)=>({id:String(node.id),x:xs[i],y:ys[i]})),
      {minDistance:distance,iterations:260,relaxation:.38,maxMove:24});
    const points=separated.positions;
    const cx=points.reduce((sum,p)=>sum+p.x,0)/points.length;
    const cy=points.reduce((sum,p)=>sum+p.y,0)/points.length;
    let radius=distance/2;
    for(const p of points)radius=Math.max(radius,Math.hypot(p.x-cx,p.y-cy)+distance/2);
    return {points:points.map(p=>({id:p.id,x:p.x-cx,y:p.y-cy})),radius,edges};
  }

  function clusterOrder(communities, graph, assignment, nodes) {
    if(communities.length<2)return communities.map((_,i)=>i);
    const cross=new Map();
    for(const edge of graph.edges){
      const a=assignment[edge.a],b=assignment[edge.b];if(a===b)continue;
      const key=Math.min(a,b)+":"+Math.max(a,b);cross.set(key,(cross.get(key)||0)+edge.weight);
    }
    const sizes=communities.map(g=>g.length),remaining=new Set(communities.map((_,i)=>i));
    const first=[...remaining].sort((a,b)=>sizes[b]-sizes[a]||
      String(nodes[communities[a][0]].id).localeCompare(String(nodes[communities[b][0]].id)))[0];
    const order=[first];remaining.delete(first);
    while(remaining.size){
      const next=[...remaining].map(candidate=>{
        let weight=0;for(const placed of order)weight+=cross.get(Math.min(candidate,placed)+":"+Math.max(candidate,placed))||0;
        return {candidate,weight};
      }).sort((a,b)=>b.weight-a.weight||sizes[b.candidate]-sizes[a.candidate]||a.candidate-b.candidate)[0].candidate;
      order.push(next);remaining.delete(next);
    }
    return order;
  }

  function packCommunityCenters(layouts,order,gap){
    if(order.length===1)return[{x:0,y:0}];
    const radii=order.map(index=>layouts[index].radius);
    const sorted=[...radii].sort((a,b)=>a-b);
    const median=sorted[Math.floor(sorted.length/2)]||0;
    const spiralStep=Math.max(28,(median*2+gap)*.62);
    const goldenAngle=2.399963229728653;
    const centers=[{x:0,y:0,radius:radii[0]}];
    let candidateIndex=1;
    const maxCandidates=Math.min(20000,Math.max(3000,order.length*80));
    for(let groupIndex=1;groupIndex<order.length;groupIndex++){
      const radius=radii[groupIndex];
      let placed=null;
      while(candidateIndex<=maxCandidates){
        const angle=candidateIndex*goldenAngle;
        const distance=spiralStep*Math.sqrt(candidateIndex);
        const candidate={x:Math.cos(angle)*distance,y:Math.sin(angle)*distance};
        const clear=centers.every(center=>
          Math.hypot(candidate.x-center.x,candidate.y-center.y)+EPSILON>=
          radius+center.radius+gap
        );
        candidateIndex++;
        if(clear){placed={...candidate,radius};break;}
      }
      if(!placed)throw new RangeError("Could not safely pack all neuron communities into the visible layout area");
      centers.push(placed);
    }
    return centers.map(({x,y})=>({x,y}));
  }

  function cluster(nodes,synapses,options={}){
    if(!Array.isArray(nodes)||!Array.isArray(synapses))throw new TypeError("nodes and synapses must be arrays");
    if(nodes.length>2500||synapses.length>30000)throw new RangeError("The graph layout safety limit was exceeded");
    const settings=options&&typeof options==="object"?options:{};
    const minDistance=finite(settings.minDistance??DEFAULT_CLUSTER_DISTANCE,"minDistance");
    const clusterIterations=Math.floor(finite(settings.clusterIterations??DEFAULT_CLUSTER_ITERATIONS,"clusterIterations"));
    const communityGap=finite(settings.communityGap??60,"communityGap");
    if(minDistance<24||minDistance>240||clusterIterations<20||clusterIterations>260||
      communityGap<60||communityGap>600)throw new RangeError("Cluster layout parameters are outside safe bounds");
    const ids=new Set();
    for(const node of nodes){
      if(!node||node.id==null||String(node.id).trim()==="")throw new TypeError("Every neuron must have a non-empty ID");
      if(ids.has(String(node.id)))throw new TypeError("Neuron IDs must be unique");
      ids.add(String(node.id));finite(node.x,"node.x");finite(node.y,"node.y");
    }
    if(!nodes.length)return{positions:[],clusters:[],groupById:[],movedCount:0,communityCount:0,modularity:0,overlapsBefore:0,overlapsAfter:0,averageInternalEdgeLength:0,averageInterCommunityEdgeLength:0,bounds:{minX:0,maxX:0,minY:0,maxY:0,width:0,height:0}};
    const graph=buildWeightedGraph(nodes,synapses);
    const beforeX=Float64Array.from(nodes,n=>n.x),beforeY=Float64Array.from(nodes,n=>n.y);
    const before=measure(beforeX,beforeY,minDistance);
    const detected=detectCommunities(nodes,graph,settings);
    const local=detected.communities.map(group=>layoutCommunity(nodes,group,graph,{minDistance,clusterIterations}));
    const order=clusterOrder(detected.communities,graph,detected.assignment,nodes);
    const centers=packCommunityCenters(local,order,communityGap);
    const positionById=new Map(),clusters=[];
    for(let o=0;o<order.length;o++){
      const community=order[o],layout=local[community],center=centers[o],nodeIds=[];
      for(const point of layout.points){positionById.set(point.id,{id:point.id,x:point.x+center.x,y:point.y+center.y});nodeIds.push(point.id);}
      const internalWeight=layout.edges.reduce((sum,e)=>sum+e.weight,0);
      let externalWeight=0;
      for(const edge of graph.edges){
        const a=detected.assignment[edge.a],b=detected.assignment[edge.b];
        if((a===community||b===community)&&a!==b)externalWeight+=edge.weight;
      }
      clusters.push({id:"cluster:"+nodeIds[0],nodeIds,size:nodeIds.length,centerX:center.x,centerY:center.y,
        radius:layout.radius,internalEdges:layout.edges.length,internalWeight,externalWeight});
    }
    const positions=nodes.map(node=>positionById.get(String(node.id)));
    const afterX=Float64Array.from(positions,p=>p.x),afterY=Float64Array.from(positions,p=>p.y);
    const after=measure(afterX,afterY,minDistance);
    const minX=Math.min(...afterX),maxX=Math.max(...afterX),minY=Math.min(...afterY),maxY=Math.max(...afterY);
    const bounds={minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY};
    const groupById=nodes.map((node,index)=>({id:String(node.id),
      clusterId:"cluster:"+String(nodes[detected.communities[detected.assignment[index]][0]].id)}));
    let insideLength=0,insideCount=0,crossLength=0,crossCount=0;
    for(const edge of graph.edges){
      const d=Math.hypot(positions[edge.a].x-positions[edge.b].x,positions[edge.a].y-positions[edge.b].y);
      if(detected.assignment[edge.a]===detected.assignment[edge.b]){insideLength+=d;insideCount++;}
      else{crossLength+=d;crossCount++;}
    }
    const movedCount=positions.reduce((sum,p,i)=>sum+(Math.hypot(p.x-beforeX[i],p.y-beforeY[i])>.01?1:0),0);
    return{positions,clusters,groupById,movedCount,communityCount:clusters.length,modularity:detected.modularity,
      communityPasses:detected.passes,overlapsBefore:before.overlaps,overlapsAfter:after.overlaps,
      minimumDistanceAfter:after.minimumDistance,averageInternalEdgeLength:insideCount?insideLength/insideCount:0,
      averageInterCommunityEdgeLength:crossCount?crossLength/crossCount:0,internalEdgeCount:insideCount,interCommunityEdgeCount:crossCount,bounds};
  }

  globalThis.NGNeuronLayout = Object.freeze({ separate, cluster, detectCommunities });
})();
