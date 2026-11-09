(() => {
  "use strict";
  const STATES=["new","under_review","provisionally_supported","partially_challenged","challenged","conditional","weakened","suspended","revised","restored"];
  const EVENT_KINDS=["created","evidence_added","origin_extended","routes_changed","decision_applied","state_changed"];
  const MAX_EVENTS=120,MAX_IDS=48;
  function hash(value) {
    const input=String(value||"");let result=2166136261;
    for(let i=0;i<input.length;i++){result^=input.charCodeAt(i);result=Math.imul(result,16777619);}
    return (result>>>0).toString(36);
  }
  function uniqueIds(value) {
    return Array.isArray(value)?[...new Set(value.filter(item=>typeof item==="string"&&item.trim()).map(item=>item.trim().slice(0,100)))].slice(0,MAX_IDS):[];
  }
  function safeTime(value,fallback) {
    const number=Number(value);
    return Number.isFinite(number)&&number>0?number:fallback;
  }
  function create(knowledge) {
    if(!knowledge||typeof knowledge.sameEntity!=="function"||typeof knowledge.sanitizeClaims!=="function")
      throw new Error("NGHypothesisLifecycle requires NGKnowledge.sameEntity and sanitizeClaims");
    const entityKey=value=>knowledge.canonicalEntity?knowledge.canonicalEntity(value):
      String(value||"").normalize("NFKC").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/giu," ").trim();
    const edgeKey=edge=>entityKey(edge&&edge.subject)+"|"+entityKey(edge&&edge.object);
    const validCausalEdge=edge=>{
      if(!edge||typeof edge.subject!=="string"||typeof edge.object!=="string"||
         !edge.subject.trim()||!edge.object.trim())return false;
      return knowledge.sanitizeClaims([{
        kind:"causal",subject:edge.subject,predicate:"приводит к",object:edge.object,
        evidence:typeof edge.evidence==="string"?edge.evidence:""
      }]).length===1;
    };
    const cleanRoutes=value=>Array.isArray(value)?value.slice(0,3).map(path=>{
      if(!Array.isArray(path)||!path.length)return [];
      const candidate=path.slice(0,3);
      if(candidate.some(edge=>!validCausalEdge(edge)))return [];
      return candidate.map(edge=>({id:typeof edge.id==="string"?edge.id.slice(0,100):null,
        subject:edge.subject.slice(0,180),object:edge.object.slice(0,180)}));
    }).filter(path=>path.length):[];
    function routeSignature(routes) {
      const rows=cleanRoutes(routes).map(path=>path.map(edgeKey).join(">")).sort();
      return hash(rows.join("||"));
    }
    function cleanEvent(raw) {
      if(!raw||typeof raw!=="object"||typeof raw.id!=="string"||!/^E-[a-z0-9]{1,16}$/u.test(raw.id)||
        !EVENT_KINDS.includes(raw.kind))return null;
      return {id:raw.id,kind:raw.kind,at:safeTime(raw.at,1),
        fromState:STATES.includes(raw.fromState)?raw.fromState:null,
        toState:STATES.includes(raw.toState)?raw.toState:null,
        claimId:typeof raw.claimId==="string"?raw.claimId.slice(0,100):"",
        claimKind:typeof raw.claimKind==="string"?raw.claimKind.slice(0,40):"",
        edgeSubject:typeof raw.edgeSubject==="string"?raw.edgeSubject.slice(0,180):"",
        edgeObject:typeof raw.edgeObject==="string"?raw.edgeObject.slice(0,180):"",
        strategy:["conditional","weaken","suspend","restore"].includes(raw.strategy)?raw.strategy:null,
        decisionKey:typeof raw.decisionKey==="string"?raw.decisionKey.slice(0,400):"",
        routeSignature:typeof raw.routeSignature==="string"?raw.routeSignature.slice(0,32):"",
        previousRouteSignature:typeof raw.previousRouteSignature==="string"?raw.previousRouteSignature.slice(0,32):"",
        originClaimIds:uniqueIds(raw.originClaimIds),
        reason:typeof raw.reason==="string"?raw.reason.slice(0,240):""};
    }
    function cleanRouteReviews(value) {
      if(!Array.isArray(value))return [];
      return value.slice(0,3).map((raw,index)=>{
        if(!raw||typeof raw!=="object")return null;
        const routeIndex=Number.isInteger(raw.routeIndex)?Math.max(0,Math.min(2,raw.routeIndex)):index;
        const state=["new","under_review","provisionally_supported","challenged"].includes(raw.state)?raw.state:"new";
        return {routeIndex,state,signature:typeof raw.signature==="string"?raw.signature.slice(0,32):"",
          edgeCount:Math.max(1,Math.min(3,Math.floor(Number(raw.edgeCount)||1))),
          challengedEdgeCount:Math.max(0,Math.min(3,Math.floor(Number(raw.challengedEdgeCount)||0))),
          pendingInquiryCount:Math.max(0,Math.min(3,Math.floor(Number(raw.pendingInquiryCount)||0))),
          supportingClaimIds:uniqueIds(raw.supportingClaimIds),
          challengingClaimIds:uniqueIds(raw.challengingClaimIds)};
      }).filter(Boolean);
    }
    function sanitize(raw) {
      if(!raw||typeof raw!=="object"||typeof raw.id!=="string"||!/^H-[a-z0-9]{1,16}$/u.test(raw.id)||
        typeof raw.subject!=="string"||typeof raw.object!=="string"||
        !validCausalEdge({subject:raw.subject,object:raw.object}))return null;
      const routes=cleanRoutes(raw.routes);
      if(!routes.length)return null;
      const events=[...new Map((Array.isArray(raw.events)?raw.events:[]).map(cleanEvent).filter(Boolean).map(item=>[item.id,item])).values()]
        .sort((a,b)=>a.at-b.at).slice(-MAX_EVENTS);
      const decision=raw.decision&&typeof raw.decision==="object"&&
        validCausalEdge({subject:raw.decision.edgeSubject,object:raw.decision.edgeObject})?{
        strategy:["conditional","weaken","suspend","restore"].includes(raw.decision.strategy)?raw.decision.strategy:null,
        edgeSubject:typeof raw.decision.edgeSubject==="string"?raw.decision.edgeSubject.slice(0,180):"",
        edgeObject:typeof raw.decision.edgeObject==="string"?raw.decision.edgeObject.slice(0,180):"",
        at:safeTime(raw.decision.at,0)
      }:null;
      return {id:raw.id,subject:raw.subject.slice(0,180),object:raw.object.slice(0,180),
        state:STATES.includes(raw.state)?raw.state:"new",
        revision:Math.max(1,Math.min(1000,Math.floor(Number(raw.revision)||1))),
        routeSignature:typeof raw.routeSignature==="string"?raw.routeSignature.slice(0,32):"",
        routes,
        routeReviews:cleanRouteReviews(raw.routeReviews),
        originClaimIds:uniqueIds(raw.originClaimIds),
        supportingClaimIds:uniqueIds(raw.supportingClaimIds),
        challengingClaimIds:uniqueIds(raw.challengingClaimIds),
        decisionRefs:uniqueIds(raw.decisionRefs),
        decision,
        createdAt:safeTime(raw.createdAt,1),updatedAt:safeTime(raw.updatedAt,safeTime(raw.createdAt,1)),
        events};
    }
    function makeEvent(kind,at,details={}) {
      const event={kind,at:safeTime(at,Date.now()),
        fromState:STATES.includes(details.fromState)?details.fromState:null,
        toState:STATES.includes(details.toState)?details.toState:null,
        claimId:typeof details.claimId==="string"?details.claimId:"",
        claimKind:typeof details.claimKind==="string"?details.claimKind:"",
        edgeSubject:typeof details.edgeSubject==="string"?details.edgeSubject:"",
        edgeObject:typeof details.edgeObject==="string"?details.edgeObject:"",
        strategy:["conditional","weaken","suspend","restore"].includes(details.strategy)?details.strategy:null,
        decisionKey:typeof details.decisionKey==="string"?details.decisionKey:"",
        routeSignature:typeof details.routeSignature==="string"?details.routeSignature:"",
        previousRouteSignature:typeof details.previousRouteSignature==="string"?details.previousRouteSignature:"",
        originClaimIds:uniqueIds(details.originClaimIds),
        reason:typeof details.reason==="string"?details.reason:""};
      event.id="E-"+hash([kind,event.at,event.fromState,event.toState,event.claimId,event.decisionKey,
        event.routeSignature,event.previousRouteSignature,event.originClaimIds.join(",")].join("|"));
      return event;
    }
    function append(record,event) {
      if(record.events.some(item=>item.id===event.id))return false;
      record.events=[...record.events,event].sort((a,b)=>a.at-b.at).slice(-MAX_EVENTS);
      return true;
    }
    function stateFor(record,decisions,pendingInquiry,activeEvidence={}) {
      if(record.decision) {
        return ({conditional:"conditional",weaken:"weakened",suspend:"suspended",restore:"restored"})[record.decision.strategy]||"new";
      }
      const challengedRoutes=Math.max(0,Number(activeEvidence.challengedRoutes)||0);
      const routeCount=Math.max(1,Number(activeEvidence.routeCount)||1);
      if(challengedRoutes>=routeCount)return "challenged";
      if(challengedRoutes>0)return "partially_challenged";
      if(pendingInquiry)return "under_review";
      if(activeEvidence.supporting)return "provisionally_supported";
      if(record.revision>1)return "revised";
      return "new";
    }
    function reviewMatchesClaim(finding,claim,edge) {
      if(!finding||!claim||typeof finding.claimId!=="string"||finding.claimId!==claim.id||!edge)return false;
      const sanitized=knowledge.sanitizeClaims([claim]);
      if(!sanitized.length)return false;
      claim=sanitized[0];
      if(!knowledge.sameEntity(claim.subject,edge.subject)||!knowledge.sameEntity(claim.object,edge.object)||
         !knowledge.sameEntity(finding.edgeSubject,edge.subject)||!knowledge.sameEntity(finding.edgeObject,edge.object)||
         !finding.subject||!finding.object||!knowledge.sameEntity(finding.subject,claim.subject)||
         !knowledge.sameEntity(finding.object,claim.object))return false;
      const sourceEvidence=knowledge.normalise(String(claim.evidence||"").slice(0,240));
      const reviewEvidence=knowledge.normalise(String(finding.evidence||"").slice(0,240));
      if(!sourceEvidence||sourceEvidence!==reviewEvidence)return false;
      if(claim.kind==="observation"&&String(finding.eventRef||"")!==String(claim.observationCase&&claim.observationCase.eventRef||""))return false;
      if(claim.status==="superseded")return finding.kind==="source_revised"&&claim.kind==="causal";
      const expected=claim.kind==="causal"&&claim.polarity===false?"opposing_claim":
        claim.kind==="observation"?(claim.polarity===false?"counterexample":"supporting_observation"):null;
      return finding.kind===expected||
        (finding.kind==="supporting_claim"&&claim.kind==="causal"&&claim.polarity!==false);
    }
    function reconcile(meta,claims=[],decisions=[],inquiries=[],now=Date.now()) {
      if(!meta||!Array.isArray(meta.conclusions))return {meta,changed:false,transitions:[]};
      const allClaims=Array.isArray(claims)?claims.flatMap(claim=>knowledge.sanitizeClaims([claim])):[];
      const allDecisions=Array.isArray(decisions)?decisions:[];
      const allInquiries=Array.isArray(inquiries)?inquiries:[];
      let changed=false;const transitions=[];
      const conclusions=meta.conclusions.map(rawConclusion=>{
        if(!rawConclusion||typeof rawConclusion.subject!=="string"||typeof rawConclusion.object!=="string"||
           !validCausalEdge({subject:rawConclusion.subject,object:rawConclusion.object}))return null;
        const routes=cleanRoutes(rawConclusion.paths);
        if(!routes.length)return null;
        const lifecycleKey=hash([safeTime(meta.createdAt,1),entityKey(rawConclusion.subject),entityKey(rawConclusion.object)].join("|"));
        const prior=sanitize(rawConclusion.lifecycle);
        const at=safeTime(now,Date.now());
        const currentSignature=routeSignature(routes);
        const originIds=uniqueIds(routes.flat().map(edge=>edge.id).filter(Boolean));
        const record=prior||{
          id:"H-"+lifecycleKey,subject:rawConclusion.subject.slice(0,180),object:rawConclusion.object.slice(0,180),
          state:"new",revision:1,routeSignature:"",routes:[],originClaimIds:originIds.slice(),supportingClaimIds:[],
          challengingClaimIds:[],decisionRefs:[],decision:null,createdAt:safeTime(meta.createdAt,now),
          updatedAt:safeTime(meta.createdAt,now),events:[]
        };
        const before=JSON.stringify(record);
        if(!prior)append(record,makeEvent("created",record.createdAt,{
          toState:"new",routeSignature:currentSignature,originClaimIds:originIds,
          reason:"Гипотеза впервые внесена в структурированный архив."
        }));
        if(prior&&record.routeSignature&&record.routeSignature!==currentSignature) {
          record.revision=Math.min(1000,record.revision+1);
          append(record,makeEvent("routes_changed",at,{
            routeSignature:currentSignature,previousRouteSignature:record.routeSignature,
            originClaimIds:originIds,reason:"Структура сохранённых причинных маршрутов изменилась."
          }));
        }
        const newOrigins=prior?originIds.filter(id=>!record.originClaimIds.includes(id)):[];
        if(newOrigins.length) {
          append(record,makeEvent("origin_extended",at,{originClaimIds:newOrigins,
            reason:"В основание гипотезы добавлены новые ссылки на причинные записи."}));
        }
        record.originClaimIds=uniqueIds([...record.originClaimIds,...originIds]);
        const routeEdges=[...new Map(routes.flat().map(edge=>[edgeKey(edge),edge])).values()];
        const claimsById=new Map(allClaims.filter(claim=>claim&&typeof claim.id==="string").map(claim=>[claim.id,claim]));
        const matchedReviews=(Array.isArray(meta.reviews)?meta.reviews:[]).filter(finding=>{
          const edge=routeEdges.find(item=>knowledge.sameEntity(item.subject,finding&&finding.edgeSubject)&&
            knowledge.sameEntity(item.object,finding&&finding.edgeObject));
          const claim=claimsById.get(finding&&finding.claimId);
          return reviewMatchesClaim(finding,claim,edge);
        });
        const findingsByEdge=new Map();
        for(const finding of matchedReviews) {
          const key=edgeKey({subject:finding.edgeSubject,object:finding.edgeObject});
          if(!findingsByEdge.has(key))findingsByEdge.set(key,[]);
          findingsByEdge.get(key).push(finding);
        }
        const pendingInquiryEdges=new Set(allInquiries.filter(item=>item&&item.status==="open"&&
          typeof item.edgeSubject==="string"&&typeof item.edgeObject==="string")
          .map(item=>edgeKey({subject:item.edgeSubject,object:item.edgeObject})));
        const priorEvidenceIds=new Set([...record.supportingClaimIds,...record.challengingClaimIds]);
        const activeSupportingIds=[],activeChallengingIds=[];
        for(const finding of matchedReviews) {
          const challenging=["counterexample","opposing_claim","source_revised"].includes(finding.kind);
          const supporting=["supporting_observation","supporting_claim"].includes(finding.kind);
          if(!challenging&&!supporting)continue;
          if(challenging)activeChallengingIds.push(finding.claimId);
          if(supporting)activeSupportingIds.push(finding.claimId);
          const eventExists=record.events.some(event=>event.kind==="evidence_added"&&event.claimId===finding.claimId&&
            knowledge.sameEntity(event.edgeSubject,finding.edgeSubject)&&knowledge.sameEntity(event.edgeObject,finding.edgeObject));
          if(priorEvidenceIds.has(finding.claimId)||eventExists)continue;
          append(record,makeEvent("evidence_added",safeTime(finding.at,at),{
            claimId:finding.claimId,claimKind:finding.kind,edgeSubject:finding.edgeSubject,edgeObject:finding.edgeObject,
            reason:finding.phase==="baseline"?"Свидетельство уже присутствовало при создании вывода.":"После создания вывода добавлено новое свидетельство."
          }));
        }
        record.supportingClaimIds=uniqueIds(activeSupportingIds);
        record.challengingClaimIds=uniqueIds(activeChallengingIds);
        const routeReviews=routes.map((path,routeIndex)=>{
          const supporting=[],challenging=[],pendingEdges=new Set();
          let challengedEdgeCount=0;
          for(const edge of path) {
            const key=edgeKey(edge);
            const findings=findingsByEdge.get(key)||[];
            const edgeChallenging=findings.filter(item=>["counterexample","opposing_claim","source_revised"].includes(item.kind));
            const edgeSupporting=findings.filter(item=>["supporting_observation","supporting_claim"].includes(item.kind));
            if(edgeChallenging.length)challengedEdgeCount++;
            if(pendingInquiryEdges.has(key))pendingEdges.add(key);
            for(const finding of edgeChallenging)challenging.push(finding.claimId);
            for(const finding of edgeSupporting)supporting.push(finding.claimId);
          }
          const pendingInquiryCount=pendingEdges.size;
          const state=challengedEdgeCount?"challenged":
            pendingInquiryCount?"under_review":
            supporting.length?"provisionally_supported":"new";
          return {routeIndex,state,signature:routeSignature([path]),edgeCount:path.length,
            challengedEdgeCount,pendingInquiryCount,
            supportingClaimIds:uniqueIds(supporting),challengingClaimIds:uniqueIds(challenging)};
        });
        record.routeReviews=cleanRouteReviews(routeReviews);
        const routeDecisions=allDecisions.filter(item=>item&&["conditional","weaken","suspend","restore"].includes(item.strategy)&&
          routeEdges.some(edge=>knowledge.sameEntity(edge.subject,item.edgeSubject)&&knowledge.sameEntity(edge.object,item.edgeObject)))
          .sort((a,b)=>safeTime(a.at,0)-safeTime(b.at,0));
        for(const item of routeDecisions) {
          const decisionKey=[edgeKey({subject:item.edgeSubject,object:item.edgeObject}),item.strategy,safeTime(item.at,0)].join("|");
          const decisionRef="D-"+hash(decisionKey);
          if(record.decisionRefs.includes(decisionRef))continue;
          record.decisionRefs.push(decisionRef);
          append(record,makeEvent("decision_applied",safeTime(item.at,at),{
            edgeSubject:item.edgeSubject,edgeObject:item.edgeObject,strategy:item.strategy,decisionKey,
            reason:"Явное пользовательское решение изменило использование звена в рабочей модели."
          }));
        }
        record.decisionRefs=uniqueIds(record.decisionRefs);
        const latestDecisionByEdge=new Map();
        for(const item of routeDecisions)latestDecisionByEdge.set(edgeKey({subject:item.edgeSubject,object:item.edgeObject}),item);
        const activeDecisions=[...latestDecisionByEdge.values()];
        const restrictionRank={suspend:4,weaken:3,conditional:2,restore:1};
        activeDecisions.sort((a,b)=>(restrictionRank[b.strategy]||0)-(restrictionRank[a.strategy]||0)||
          safeTime(b.at,0)-safeTime(a.at,0));
        // A serialized lifecycle decision is historical metadata, not an independent
        // authorization to reactivate a route. Only the current model-decision ledger may supply it.
        const latestDecision=activeDecisions[0]||null;
        record.decision=latestDecision?{strategy:latestDecision.strategy,edgeSubject:latestDecision.edgeSubject,
          edgeObject:latestDecision.edgeObject,at:safeTime(latestDecision.at,at)}:null;
        const pendingInquiry=routeReviews.some(item=>item.pendingInquiryCount>0);
        const activeEvidence={
          supporting:activeSupportingIds.length>0,
          challenging:activeChallengingIds.length>0,
          challengedRoutes:routeReviews.filter(item=>item.state==="challenged").length,
          routeCount:routeReviews.length
        };
        const nextState=stateFor(record,routeDecisions,pendingInquiry,activeEvidence);
        const oldState=prior?record.state:"new";
        if(prior&&oldState!==nextState) {
          append(record,makeEvent("state_changed",at,{fromState:oldState,toState:nextState,
            reason:"Состояние изменилось после обновления свидетельств, вопросов или решения рабочей модели."}));
          transitions.push({id:record.id,from:oldState,to:nextState});
        }
        record.state=nextState;
        record.routeSignature=currentSignature;
        record.routes=routes;
        record.updatedAt=JSON.stringify(record)!==before?at:record.updatedAt;
        if(JSON.stringify(record)!==JSON.stringify(prior))changed=true;
        return {...rawConclusion,lifecycle:sanitize(record)};
      }).filter(Boolean);
      const updatedMeta={...meta,conclusions};
      return {meta:updatedMeta,changed,transitions};
    }
    function summary(records) {
      const rows=(Array.isArray(records)?records:[]).map(sanitize).filter(Boolean);
      const counts=Object.fromEntries(STATES.map(state=>[state,rows.filter(item=>item.state===state).length]));
      return {total:rows.length,counts,records:rows};
    }
    return Object.freeze({sanitize,reconcile,summary,states:STATES.slice()});
  }
  window.NGHypothesisLifecycle=Object.freeze({version:1,create});
})();