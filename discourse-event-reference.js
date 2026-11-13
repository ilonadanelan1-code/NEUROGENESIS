(() => {
  "use strict";
  const SCHEMA = "NG_DISCOURSE_EVENT_REFERENCE_V1";
  const MAX_MESSAGES = 24;
  const clean = (value, limit=300) => String(value == null ? "" : value)
    .replace(/\s+/gu," ").trim().slice(0,limit);
  const normalise = value => clean(value,300).normalize("NFKC").toLowerCase()
    .replace(/ё/gu,"е").replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const EVENT_CUES = Object.freeze([
    {pattern:/^(?:из-за этого|вследствие этого|поэтому|в результате этого)(?![\p{L}\p{N}])/iu, relation:"cause_or_result"},
    {pattern:/^(?:после этого|затем|вслед за этим|тогда)(?![\p{L}\p{N}])/iu, relation:"sequence"},
    {pattern:/^это\s+(?:привело|вызвало|спровоцировало|остановило|запустило|изменило|повредило|нарушило|позволило|помешало)(?![\p{L}\p{N}])/iu, relation:"event_subject"}
  ]);
  function detectMention(value) {
    const text=clean(value,500);
    for(const cue of EVENT_CUES) if(cue.pattern.test(text)) {
      const match=text.match(cue.pattern);
      return {text:match?match[0].trim():"это",relation:cue.relation,kind:"event"};
    }
    return null;
  }
  function extractCandidates(messagesInput,core,options={}) {
    const topicId=clean(options.topicId,80);
    const messages=(Array.isArray(messagesInput)?messagesInput:[]).slice(-MAX_MESSAGES);
    const rows=[];
    messages.forEach((message,index)=>{
      if(!message||typeof message.text!=="string"||!message.text.trim())return;
      if(topicId&&clean(message.threadId,80)!==topicId)return;
      // Do not use assistant assertions as user-grounded event facts in this pilot.
      if(message.role!=="user")return;
      let frame;
      try{frame=core&&typeof core.analyse==="function"
        ?core.analyse(message.text,{contextRelation:"new_topic"}):null;}catch(_){return;}
      const chain=frame&&frame.propositionChain&&Array.isArray(frame.propositionChain.items)
        ?frame.propositionChain.items:[];
      const propositions=chain.length?chain.map(item=>({proposition:item.proposition||{},text:item.text||message.text,id:item.id||""})):
        frame&&frame.proposition?[{proposition:frame.proposition,text:message.text,id:""}]:[];
      for(let propositionIndex=0;propositionIndex<propositions.length;propositionIndex++){
        const row=propositions[propositionIndex];
        const p=row.proposition||{};
        if(!["assertion"].includes(p.kind)||p.modality==="conditional"||p.modality==="reported"||
           p.attribution&&p.attribution.source&&p.attribution.source!=="user_utterance")continue;
        const predicate=clean(p.predicate,100),subject=clean(p.subject,180),object=clean(p.object,180);
        if(!predicate||(!subject&&!object)||Number(p.confidence)<0.5)continue;
        const signature=normalise([subject,predicate,object].filter(Boolean).join(" "));
        if(!signature)continue;
        const messageId=clean(message.id,56);
        const propositionId=clean(row.id,12).replace(/^p/u,"")||String(propositionIndex+1);
        rows.push({
          id:messageId?clean(messageId+"-p"+propositionId,80):"event-"+index+"-p"+(propositionIndex+1),
          text:clean(row.text,260),subject,predicate,object,kind:p.kind,
          polarity:p.polarity==="negative"?"negative":"positive",
          modality:clean(p.modality,24)||"asserted",
          turnDistance:messages.length-index,
          sentenceIndex:row.id||null,
          topicId:clean(message.threadId,80),
          signature,
          confidence:Math.max(0,Math.min(1,Number(p.confidence)||0.5)),
          sourceRole:"user"
        });
      }
    });
    return rows.slice(-MAX_MESSAGES*6);
  }
  function resolveMention(query,candidatesInput,options={}) {
    const mention=typeof query==="object"&&query?query:detectMention(query);
    if(!mention)return {schema:SCHEMA,status:"not_applicable",mention:null,antecedent:null,candidates:[],confidence:0,
      provenance:{source:"event_reference",memoryEffect:"none"}};
    const topicId=clean(options.topicId,80);
    const candidates=(Array.isArray(candidatesInput)?candidatesInput:[])
      .filter(row=>row&&typeof row.signature==="string"&&(!topicId||row.topicId===topicId))
      .map(row=>{
        const recency=Math.max(0,1-(Math.max(1,Number(row.turnDistance)||1)-1)/MAX_MESSAGES);
        const cue=mention.relation==="sequence"?0.12:mention.relation==="cause_or_result"?0.1:0.08;
        const score=Number((Math.min(1,Number(row.confidence)||0.5)*0.45+recency*0.35+cue).toFixed(4));
        return {...row,score};
      }).sort((a,b)=>b.score-a.score);
    const best=candidates[0]||null,second=candidates[1]||null;
    const margin=best?Number((best.score-(second?second.score:0)).toFixed(4)):0;
    let status="unresolved",reason="no_event_candidate",confidence=0;
    if(best){
      if(best.confidence<0.58){reason="weak_event_confidence";}
      else if(second&&margin<0.12){status="ambiguous";reason="competing_event_candidates";}
      else{status="resolved";reason="bounded_event_recency_and_proposition_evidence";
        confidence=Math.max(0.5,Math.min(0.9,0.5+best.score*0.35+margin*0.1));}
    }
    return {
      schema:SCHEMA,status,mention,
      antecedent:status==="resolved"?{
        id:best.id,text:best.text,subject:best.subject,predicate:best.predicate,object:best.object,
        polarity:best.polarity,turnDistance:best.turnDistance,signature:best.signature
      }:null,
      candidates:candidates.slice(0,5).map(row=>({id:row.id,text:row.text,score:row.score,
        subject:row.subject,predicate:row.predicate,object:row.object})),
      confidence,margin,reason,
      provenance:{source:"discourse_event_reference",rule:"asserted_user_proposition_recency",
        window:MAX_MESSAGES,candidateSource:"active_thread_user_messages",
        memoryEffect:"none",uncalibrated:true,usage:"advisory_only"}
    };
  }
  function resolveFromHistory(query,messages,core,options={}) {
    const mention=detectMention(query);
    if(!mention)return resolveMention(null,[],options);
    return resolveMention(mention,extractCandidates(messages,core,options),options);
  }
  window.NGDiscourseEventReference=Object.freeze({
    version:1,schema:SCHEMA,detectMention,extractCandidates,resolveMention,resolveFromHistory
  });
})();
