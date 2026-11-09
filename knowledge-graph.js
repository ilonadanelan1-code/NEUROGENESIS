(() => {
  "use strict";
  function cleanText(value,limit=1200) {
    return String(value==null?"":value).replace(/\s+/gu," ").trim().slice(0,limit);
  }
  function createStableId(prefix,source) {
    const value=prefix+"|"+String(source||"");
    let first=2166136261,second=0x9e3779b9;
    for(let i=0;i<value.length;i++){
      const code=value.charCodeAt(i);
      first=Math.imul(first^code,16777619);
      second=Math.imul(second^code,2246822519);
    }
    return prefix+"_"+(first>>>0).toString(36)+"_"+(second>>>0).toString(36);
  }
  function create(knowledge) {
    if(!knowledge||typeof knowledge.normalise!=="function"||typeof knowledge.canonicalEntity!=="function")
      throw new Error("NGKnowledgeGraph requires NGKnowledge.normalise and canonicalEntity");
    function build(input) {
      const memories=Array.isArray(input)?input:(input&&Array.isArray(input.memories)?input.memories:[]);
      const nodes=new Map(),edges=new Map(),conceptAliases=new Map(),eventClaims=new Map(),eventMemories=new Map();
      const claimNodeByObject=new WeakMap(),allClaims=[];
      let observationCount=0,linkedObservationCount=0;
      function addNode(node){if(!nodes.has(node.id))nodes.set(node.id,node);return nodes.get(node.id);}
      function addEdge(type,from,to,identity,data={}) {
        if(!from||!to)return null;
        const edgeId=createStableId("edge",[type,from,to,identity||""].join("|"));
        if(!edges.has(edgeId))edges.set(edgeId,{id:edgeId,type,from,to,directed:type!=="conflicts_with",...data});
        return edges.get(edgeId);
      }
      function ensureConcept(label) {
        const value=cleanText(label,180);if(!value)return null;
        const key=knowledge.canonicalEntity(value)||knowledge.normalise(value);if(!key)return null;
        const id=createStableId("concept",key);
        const node=addNode({id,type:"concept",key,label:value,aliases:[]});
        if(!conceptAliases.has(id))conceptAliases.set(id,new Set());
        conceptAliases.get(id).add(value);
        return node;
      }
      function ensureEvent(eventRef) {
        const label=cleanText(eventRef,100),key=knowledge.normalise(label);if(!key)return null;
        const id=createStableId("event",key);
        return addNode({id,type:"event",eventRef:label,label:"Эпизод · "+label,memberClaimIds:[],sourceMemoryIds:[]});
      }
      const orderedMemories=memories.map((memory,index)=>({memory,index}))
        .filter(row=>row.memory&&typeof row.memory==="object")
        .sort((a,b)=>String(a.memory.id||"").localeCompare(String(b.memory.id||""))||a.index-b.index);
      for(const row of orderedMemories){
        const memory=row.memory;
        const memoryId=cleanText(memory.id,100)||("anonymous-"+createStableId("memory-key",cleanText(memory.text,1200)+"|"+row.index));
        const memoryNodeId=createStableId("memory",memoryId);
        const claimList=Array.isArray(memory.claims)?memory.claims.filter(item=>item&&typeof item==="object"&&typeof item.kind==="string"):[];
        addNode({id:memoryNodeId,type:"memory",memoryId,label:cleanText(memory.text,1200)||("Запись "+memoryId),
          createdAt:Number.isFinite(Number(memory.createdAt))?Number(memory.createdAt):null,claimCount:claimList.length});
        claimList.forEach((claim,claimIndex)=>{
          const claimId=cleanText(claim.id,100),subject=cleanText(claim.subject,180);
          const predicate=cleanText(claim.predicate,100),object=cleanText(claim.object,180);
          const semanticKey=[claim.kind,knowledge.canonicalEntity(subject)||knowledge.normalise(subject),
            knowledge.normalise(predicate),knowledge.canonicalEntity(object)||knowledge.normalise(object),
            claim.polarity===false?"negative":"positive"].join("|");
          // Claims stay scoped to their source record. Similar text in another record
          // is not treated as proof that both records describe one event.
          const claimNodeId=createStableId("claim",memoryId+"|"+(claimId||"no-id")+"|"+semanticKey+"|"+claimIndex);
          const label=typeof knowledge.claimLabel==="function"?cleanText(knowledge.claimLabel(claim),240):
            [subject,predicate,object].filter(Boolean).join(" · ");
          const verification=cleanText(claim.verification,40)||"unspecified";
          const node=addNode({id:claimNodeId,type:"claim",claimId:claimId||null,kind:claim.kind,
            label:label||"Структурированное утверждение",subject,predicate,object,
            polarity:claim.polarity!==false,modality:claim.modality==="possible"?"possible":"asserted",
            verification,extractionConfidence:Number.isFinite(Number(claim.extractionConfidence))?
              Math.max(0,Math.min(1,Number(claim.extractionConfidence))):null,
            status:claim.status==="superseded"?"superseded":"current",source:cleanText(claim.source,60),
            createdAt:Number.isFinite(Number(claim.createdAt))?Number(claim.createdAt):null,
            provenance:[{memoryId,claimId:claimId||null,evidence:cleanText(claim.evidence,1200),
              verification,source:cleanText(claim.source,60)}]});
          claimNodeByObject.set(claim,node.id);allClaims.push(claim);
          addEdge("contains",memoryNodeId,node.id,node.id,{memoryId,claimId:claimId||null});
          const subjectNode=ensureConcept(subject),objectNode=ensureConcept(object);
          if(subjectNode)addEdge("claim_subject",node.id,subjectNode.id,node.id,{claimId:claimId||null});
          if(objectNode)addEdge("claim_object",node.id,objectNode.id,node.id,{claimId:claimId||null});
          if(subjectNode&&objectNode)addEdge("asserts",subjectNode.id,objectNode.id,node.id,{
            claimNodeId:node.id,claimId:claimId||null,claimKind:claim.kind,predicate,
            polarity:claim.polarity!==false,modality:node.modality,verification,status:node.status});
          if(claim.kind==="observation"){
            observationCount++;
            const details=claim.observationCase&&typeof claim.observationCase==="object"?claim.observationCase:null;
            const eventRef=details&&typeof details.eventRef==="string"?cleanText(details.eventRef,100):"";
            if(eventRef){
              linkedObservationCount++;
              const eventNode=ensureEvent(eventRef);
              if(eventNode){
                if(!eventClaims.has(eventNode.id))eventClaims.set(eventNode.id,new Set());
                if(!eventMemories.has(eventNode.id))eventMemories.set(eventNode.id,new Set());
                eventClaims.get(eventNode.id).add(node.id);eventMemories.get(eventNode.id).add(memoryId);
                addEdge("observed_in",node.id,eventNode.id,node.id,{claimId:claimId||null,eventRef});
              }
            }
          }
        });
      }
      let conflicts=[];
      if(typeof knowledge.findConflicts==="function"){try{conflicts=knowledge.findConflicts(allClaims)||[];}catch(_){conflicts=[];}}
      for(const conflict of conflicts){
        if(!conflict||!conflict.left||!conflict.right)continue;
        const left=claimNodeByObject.get(conflict.left),right=claimNodeByObject.get(conflict.right);
        if(!left||!right||left===right)continue;
        const ordered=[left,right].sort();
        addEdge("conflicts_with",ordered[0],ordered[1],String(conflict.type||"unresolved"),
          {conflictType:String(conflict.type||"unresolved")});
      }
      for(const [id,aliases] of conceptAliases){const node=nodes.get(id);if(node)node.aliases=[...aliases].sort((a,b)=>a.localeCompare(b));}
      for(const [id,members] of eventClaims){const node=nodes.get(id);if(node)node.memberClaimIds=[...members].sort();}
      for(const [id,sources] of eventMemories){const node=nodes.get(id);if(node)node.sourceMemoryIds=[...sources].sort();}
      const nodeList=[...nodes.values()].sort((a,b)=>a.id.localeCompare(b.id));
      const edgeList=[...edges.values()].sort((a,b)=>a.id.localeCompare(b.id));
      const countType=type=>nodeList.filter(node=>node.type===type).length;
      const stats={nodes:nodeList.length,edges:edgeList.length,memories:countType("memory"),claims:countType("claim"),
        concepts:countType("concept"),events:countType("event"),assertions:edgeList.filter(edge=>edge.type==="asserts").length,
        conflicts:edgeList.filter(edge=>edge.type==="conflicts_with").length,observations:observationCount,
        linkedObservations:linkedObservationCount,unlinkedObservations:observationCount-linkedObservationCount};
      return {schemaVersion:1,nodes:nodeList,edges:edgeList,stats};
    }

    function search(graph,query,limit=8) {
      const empty={queryTokens:[],anchors:[],matches:[]};
      if(!graph||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))return empty;
      const queryTokens=knowledge.tokens(String(query||""));
      if(!queryTokens.length)return empty;
      const nodesById=new Map(graph.nodes.map(node=>[node.id,node]));
      const claims=new Map(graph.nodes.filter(node=>node.type==="claim").map(node=>[node.id,node]));
      const conceptClaims=new Map(),claimConcepts=new Map(),sourceByClaim=new Map();
      function pushLink(map,key,value) {
        if(!map.has(key))map.set(key,[]);
        map.get(key).push(value);
      }
      for(const edge of graph.edges) {
        if((edge.type==="claim_subject"||edge.type==="claim_object")&&
           claims.has(edge.from)&&nodesById.get(edge.to)?.type==="concept") {
          const link={claimId:edge.from,conceptId:edge.to,edgeId:edge.id,role:edge.type};
          pushLink(conceptClaims,edge.to,link);
          pushLink(claimConcepts,edge.from,link);
        } else if(edge.type==="contains"&&nodesById.get(edge.from)?.type==="memory"&&claims.has(edge.to)) {
          sourceByClaim.set(edge.to,edge.memoryId||nodesById.get(edge.from).memoryId||null);
        }
      }
      const anchors=graph.nodes.filter(node=>node.type==="concept").map(node=>{
        const values=[node.label,...(Array.isArray(node.aliases)?node.aliases:[])].filter(Boolean).join(" ");
        const score=knowledge.semanticMatch(queryTokens,knowledge.tokens(values)).score;
        return {id:node.id,label:node.label,score};
      }).filter(item=>item.score>=0.18)
        .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,12);
      const results=new Map();
      function add(claimId,score,pathType,viaConcepts=[],path=[]) {
        const claim=claims.get(claimId);
        if(!claim||!Number.isFinite(score)||score<0.16)return;
        const memoryId=sourceByClaim.get(claimId)||null;
        const current=results.get(claimId);
        const candidate={claimNodeId:claimId,claimId:claim.claimId||null,memoryId,sourceMemoryId:memoryId,
          label:claim.label,kind:claim.kind,subject:claim.subject,predicate:claim.predicate,object:claim.object,
          polarity:claim.polarity!==false,modality:claim.modality||"asserted",verification:claim.verification||"unspecified",
          status:claim.status||"current",score,pathType,viaConcepts,path};
        if(!current||candidate.score>current.score||
           (candidate.score===current.score&&candidate.pathType.localeCompare(current.pathType)<0))results.set(claimId,candidate);
      }
      for(const claim of claims.values()) {
        if(claim.status==="superseded")continue;
        const haystack=[claim.label,claim.subject,claim.predicate,claim.object].filter(Boolean).join(" ");
        const direct=knowledge.semanticMatch(queryTokens,knowledge.tokens(haystack)).score;
        if(direct>=0.16)add(claim.id,direct,"direct",[],[]);
      }
      for(const anchor of anchors) {
        for(const link of conceptClaims.get(anchor.id)||[]) {
          add(link.claimId,anchor.score*0.78,"one_hop",[anchor.label],[link.edgeId]);
        }
      }
      const bridgeKinds=new Set(["relationship","causal","rule","definition"]);
      for(const anchor of anchors) {
        for(const firstLink of conceptClaims.get(anchor.id)||[]) {
          const bridge=claims.get(firstLink.claimId);
          if(!bridge||!bridgeKinds.has(bridge.kind)||bridge.status==="superseded"||
             bridge.polarity===false||bridge.modality==="possible")continue;
          for(const middleLink of claimConcepts.get(bridge.id)||[]) {
            if(middleLink.conceptId===anchor.id)continue;
            const middle=nodesById.get(middleLink.conceptId);
            if(!middle||middle.type!=="concept")continue;
            for(const targetLink of conceptClaims.get(middleLink.conceptId)||[]) {
              if(targetLink.claimId===bridge.id)continue;
              const target=claims.get(targetLink.claimId);
              if(!target||target.status==="superseded")continue;
              add(target.id,anchor.score*0.38,"two_hop",
                [anchor.label,middle.label],[firstLink.edgeId,middleLink.edgeId,targetLink.edgeId]);
            }
          }
        }
      }
      const matches=[...results.values()].sort((a,b)=>b.score-a.score||
        String(a.memoryId||"").localeCompare(String(b.memoryId||""))||a.claimNodeId.localeCompare(b.claimNodeId))
        .slice(0,Math.max(1,Math.min(30,Number(limit)||8)));
      return {queryTokens,anchors,matches};
    }
    return {version:1,build,search};
  }
  window.NGKnowledgeGraph={version:1,create};
})();