(() => {
  "use strict";

  const MEMORY_KEY = "neurogenesis.memories.v1";
  const DIALOG_KEY = "neurogenesis.dialog.v1";
  const MODEL_DECISIONS_KEY = "neurogenesis.model-decisions.v1";
  const MODEL_EVIDENCE_KEY = "neurogenesis.model-evidence.v1";
  const REASONING_ARCHIVE_KEY = "neurogenesis.reasoning-archive.v1";
  const INQUIRIES_KEY = "neurogenesis.inquiries.v1";
  const MAX_MODEL_DECISIONS = 32;
  const MAX_MODEL_EVIDENCE = 64;
  const MAX_REASONING_ARCHIVE = 128;
  const MAX_INQUIRIES = 48;
  const MAX_MEMORIES = 500;
  const MAX_DIALOG = 24;
  const MAX_DIALOG_TEXT = 4200;
  const MAX_TEXT = 1200;
  const KNOWLEDGE = window.NGKnowledge || null;
  let memoryMigrated = false;
  const STOP = new Set(("и в во на я ты мы вы они он она оно мне меня тебя тебе ваш ваши мой моя мое мои свой свои себя это этот эта эти тот та те что как где когда зачем почему кто который а но или да нет не ни же бы ли для по из к со с от до над под при про у об обо есть был была были быть буду будет уже еще очень также тут там туда сюда его ее их").split(/\s+/u));
  const $ = id => document.getElementById(id);
  let memories = [];
  let dialog = [];
  let modelDecisions = [];
  let modelEvidence = [];
  let reasoningArchive = [];
  let inquiries = [];
  let nextInquiryNumber = 1;
  let tagTrace = Object.create(null);
  let libraryOpen = false;
  let libraryLimit = 20;
  let libraryFilter = "";
  let editingMemoryId = null;
  let libraryReturnScrollTop = 0;
  let libraryListScrollTop = 0;
  let allowDiscardOnMemoryBack = false;

  function normalise(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/giu, " ").trim().replace(/\s+/g, " ");
  }
  function stem(word) {
    return word.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|ах|ях|ов|ев|ей|ом|ем|а|я|ы|и|е|у|ю)$/u, "");
  }
  function tokens(value) {
    if (KNOWLEDGE && typeof KNOWLEDGE.tokens === "function") return KNOWLEDGE.tokens(value);
    return normalise(value).split(" ").filter(word => word.length >= 3 && !STOP.has(word))
      .map(stem).filter(word => word.length >= 3);
  }
  function safeTime(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  function cleanModelDecision(raw) {
    if (!raw || typeof raw !== "object" ||
        typeof raw.edgeSubject !== "string" || typeof raw.edgeObject !== "string" ||
        !["conditional","weaken","suspend","restore"].includes(raw.strategy)) return null;
    const edgeSubject=raw.edgeSubject.trim().slice(0,180),edgeObject=raw.edgeObject.trim().slice(0,180);
    if(!edgeSubject||!edgeObject)return null;
    return {
      edgeSubject,edgeObject,strategy:raw.strategy,
      at:safeTime(raw.at,Date.now()),
      claimIds:Array.isArray(raw.claimIds)?raw.claimIds.filter(id=>typeof id==="string").slice(0,8):[]
    };
  }
  function modelDecisionKey(subject,object) {
    return normalise(subject)+"|"+normalise(object);
  }
  function mergeModelDecisionHistory(existing,incoming) {
    const unique=new Map();
    for(const raw of [...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]) {
      const decision=cleanModelDecision(raw);
      if(!decision)continue;
      const key=modelDecisionKey(decision.edgeSubject,decision.edgeObject)+"|"+decision.strategy+"|"+decision.at;
      unique.set(key,decision);
    }
    return [...unique.values()].sort((a,b)=>a.at-b.at).slice(-MAX_MODEL_DECISIONS);
  }
  function currentModelDecisions() {
    const latest=new Map();
    for(const raw of modelDecisions) {
      const decision=cleanModelDecision(raw);
      if(!decision)continue;
      const key=modelDecisionKey(decision.edgeSubject,decision.edgeObject);
      const prior=latest.get(key);
      if(!prior||decision.at>=prior.at)latest.set(key,decision);
    }
    return [...latest.values()].sort((a,b)=>a.at-b.at);
  }
  function modelDecisionForEdge(edge,decisions=currentModelDecisions()) {
    if(!edge)return null;
    return decisions.find(item=>
      KNOWLEDGE && KNOWLEDGE.sameEntity
        ? KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object)
        : modelDecisionKey(item.edgeSubject,item.edgeObject)===modelDecisionKey(edge.subject,edge.object)
    )||null;
  }
  function claimsForWorkingModel(claims) {
    const suspended=currentModelDecisions().filter(item=>item.strategy==="suspend");
    if(!suspended.length)return claims;
    return claims.filter(claim=>!(claim&&claim.kind==="causal"&&suspended.some(item=>
      KNOWLEDGE.sameEntity(item.edgeSubject,claim.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,claim.object))));
  }
  function researchAwareHypothesisNote(result) {
    const hypotheses=Array.isArray(result&&result.hypotheses)?result.hypotheses:[];
    if(!hypotheses.length)return "";
    const decisions=currentModelDecisions();
    const pairKey=(subject,object)=>normalise(subject)+"|"+normalise(object);
    const edges=[...new Map(hypotheses.flatMap(item=>(item.paths||[]).flat())
      .map(edge=>[pairKey(edge.subject,edge.object),edge])).values()];
    const lines=["ПЕРЕОЦЕНКА ГИПОТЕЗ С УЧЁТОМ ОТВЕТОВ"];
    for(const edge of edges) {
      const inquiry=inquiries.find(item=>
        KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object));
      if(inquiry) {
        if(inquiry.status==="answered") {
          lines.push("• "+inquiry.id+" — "+edge.subject+" → "+edge.object+": "+inquiryAssessmentLabel(inquiry)+".");
          if(inquiry.assessment==="insufficient_context")
            lines.push("  Это не подтверждает и не опровергает связь: обстоятельства противоположных наблюдений не установлены.");
          else if(inquiry.assessment==="gap_confirmed")
            lines.push("  Звено остаётся непроверенным: отсутствие наблюдений не является ни подтверждением, ни контрпримером.");
          else
            lines.push("  Ответ содержит пользовательское описание, но его нельзя считать независимо проверенным наблюдением.");
        } else if(inquiry.status==="open") {
          lines.push("• "+inquiry.id+" — "+edge.subject+" → "+edge.object+": вопрос остаётся открытым; данных для оценки пока нет.");
        }
      } else {
        const observations=memories.flatMap(item=>item.claims||[]).filter(claim=>
          claim.kind==="observation"&&KNOWLEDGE.sameEntity(claim.subject,edge.subject)&&KNOWLEDGE.sameEntity(claim.object,edge.object));
        if(!observations.length)lines.push("• "+edge.subject+" → "+edge.object+": прямых наблюдений пока нет; звено остаётся непроверенным.");
      }
    }
    const activePairs=new Set(hypotheses.map(item=>pairKey(item.subject,item.object)));
    const excluded=new Map();
    for(const entry of reasoningArchive) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta||meta.type!=="derived_hypotheses")continue;
      for(const conclusion of meta.conclusions) {
        if(activePairs.has(pairKey(conclusion.subject,conclusion.object))||!conclusion.paths.length)continue;
        const blockedPaths=conclusion.paths.map(path=>path.map(edge=>({
          edge,decision:decisions.find(item=>item.strategy==="suspend"&&
            KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object))
        })).filter(row=>row.decision));
        if(blockedPaths.every(rows=>rows.length>0)) {
          const blocked=[...new Map(blockedPaths.flat().map(row=>[pairKey(row.edge.subject,row.edge.object),row.edge])).values()];
          excluded.set(pairKey(conclusion.subject,conclusion.object),{
            subject:conclusion.subject,object:conclusion.object,blocked
          });
        }
      }
    }
    for(const item of excluded.values()) {
      lines.push("• Прежняя гипотеза "+item.subject+" ⇢ "+item.object+" сейчас не строится: все её сохранённые маршруты проходят через связь, приостановленную в рабочей модели ("+
        item.blocked.map(edge=>edge.subject+" → "+edge.object).join("; ")+").");
      const inquiry=inquiries.find(row=>item.blocked.some(edge=>
        KNOWLEDGE.sameEntity(row.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(row.edgeObject,edge.object)));
      if(inquiry&&inquiry.assessment==="insufficient_context")
        lines.push("  "+inquiry.id+" не установил обстоятельства противоречия. Гипотеза не опровергнута: она просто не используется в новых цепочках до отдельного решения.");
    }
    if(lines.length===1)return "";
    lines.push("Новые гипотезы остаются предположениями по структуре сохранённых связей. Ответы уточняют пробелы и ограничения, но не создают причинные доказательства.");
    return lines.join("\n");
  }
  function formatModelDecisionNote() {
    const decisions=currentModelDecisions();
    if(!decisions.length)return "";
    const description={
      conditional:"сохранена как условная; важные условия пока не установлены",
      weaken:"учитывается только как один из возможных факторов, не как обязательная или достаточная причина",
      suspend:"временно исключена из новых причинных цепочек и прогнозов",
      restore:"возвращена в активную рабочую модель"
    };
    return "\n\nРЕШЕНИЯ РАБОЧЕЙ ПРИЧИННОЙ МОДЕЛИ\n"+
      decisions.slice(-8).map(item=>"• "+item.edgeSubject+" → "+item.edgeObject+" — "+description[item.strategy]).join("\n")+
      "\nИсходные воспоминания и наблюдения не изменены.";
  }
  function cleanMemory(raw) {
    if (!raw || typeof raw.text !== "string") return null;
    const text = raw.text.trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const legacyTags = Array.isArray(raw.tags) ? raw.tags.filter(x => typeof x === "string").map(normalise).filter(Boolean) : [];
    const extractedTags = [...new Set(tokens(text))];
    const tags = [...new Set([...extractedTags, ...legacyTags])].slice(0, 6);
    const traceIds = tags.map(tag => {
      let index = legacyTags.indexOf(tag);
      if (index < 0 && KNOWLEDGE && typeof KNOWLEDGE.sameEntity === "function") {
        index = legacyTags.findIndex(oldTag => KNOWLEDGE.sameEntity(oldTag, tag));
      }
      return index >= 0 && Array.isArray(raw.traceIds) && typeof raw.traceIds[index] === "string" ? raw.traceIds[index] : null;
    });
    const extractedClaims = KNOWLEDGE ? KNOWLEDGE.extractClaims(text) : [];
    const claims = KNOWLEDGE ? (extractedClaims.length ? KNOWLEDGE.mergeClaims(raw.claims, extractedClaims) : KNOWLEDGE.sanitizeClaims(raw.claims, text)) : [];
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 80) : makeId(),
      text, tags: tags.length ? tags : tokens(text).slice(0, 6), traceIds,
      claims,
      createdAt: safeTime(raw.createdAt, Date.now()),
      updatedAt: safeTime(raw.updatedAt, safeTime(raw.createdAt, Date.now())),
      strength: Number.isFinite(Number(raw.strength)) ? Math.max(0, Math.min(1, Number(raw.strength))) : 0.65,
      repetitions: Math.max(1, Math.min(100000, Math.floor(Number(raw.repetitions) || 1))),
      recalls: Math.max(0, Math.min(100000, Math.floor(Number(raw.recalls) || 0)))
    };
  }
  function makeId() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function rebuildTagTraceIndex() {
    tagTrace = Object.create(null);
    for (const item of memories) {
      item.tags.forEach((tag, index) => {
        const id = item.traceIds[index];
        if (id && !tagTrace[tag]) tagTrace[tag] = id;
      });
    }
  }
  function cleanReasoning(raw) {
    if (!raw || typeof raw !== "object" || raw.version !== 1 ||
        !["causal_chain","derived_hypotheses","prioritized_hypotheses"].includes(raw.type) ||
        !Array.isArray(raw.conclusions)) return null;
    const createdAt=safeTime(raw.createdAt,Date.now());
    const conclusions=raw.conclusions.slice(0,8).map(item=>{
      if(!item||typeof item.subject!=="string"||typeof item.object!=="string")return null;
      const paths=Array.isArray(item.paths)?item.paths.slice(0,3).map(path=>
        Array.isArray(path)?path.slice(0,3).map(edge=>{
          if(!edge||typeof edge.subject!=="string"||typeof edge.object!=="string")return null;
          return {id:typeof edge.id==="string"?edge.id.slice(0,100):null,subject:edge.subject.slice(0,180),object:edge.object.slice(0,180)};
        }).filter(Boolean):[]
      ).filter(path=>path.length):[];
      return paths.length?{subject:item.subject.slice(0,180),object:item.object.slice(0,180),paths}:null;
    }).filter(Boolean);
    if(!conclusions.length)return null;
    const reviews=Array.isArray(raw.reviews)?raw.reviews.slice(-48).map(item=>{
      if(!item||typeof item.claimId!=="string")return null;
      const at=safeTime(item.at,Date.now());
      return {
        claimId:item.claimId.slice(0,100),
        kind:["counterexample","opposing_claim","supporting_observation","supporting_claim","source_revised"].includes(item.kind)?item.kind:"counterexample",
        phase:["baseline","subsequent"].includes(item.phase)?item.phase:(at<=createdAt?"baseline":"subsequent"),
        subject:typeof item.subject==="string"?item.subject.slice(0,180):"",
        object:typeof item.object==="string"?item.object.slice(0,180):"",
        evidence:typeof item.evidence==="string"?item.evidence.slice(0,240):"",
        edgeSubject:typeof item.edgeSubject==="string"?item.edgeSubject.slice(0,180):"",
        edgeObject:typeof item.edgeObject==="string"?item.edgeObject.slice(0,180):"",
        at
      };
    }).filter(Boolean):[];
    const status=["current","updated","challenged","revised"].includes(raw.status)?raw.status:"current";
    const modelHistory=Array.isArray(raw.modelHistory)?raw.modelHistory.slice(-8).map(snapshot=>{
      if(!snapshot||typeof snapshot!=="object")return null;
      const edges=Array.isArray(snapshot.edges)?snapshot.edges.slice(0,12).map(edge=>{
        if(!edge||typeof edge.subject!=="string"||typeof edge.object!=="string")return null;
        const options=Array.isArray(edge.revisionOptions)?edge.revisionOptions.slice(0,3).map(option=>{
          if(!option||typeof option.id!=="string"||typeof option.title!=="string")return null;
          return {id:option.id.slice(0,40),title:option.title.slice(0,120),
            proposal:typeof option.proposal==="string"?option.proposal.slice(0,360):"",
            discriminators:Array.isArray(option.discriminators)?option.discriminators.filter(x=>typeof x==="string").slice(0,4).map(x=>x.slice(0,240)):[]};
        }).filter(Boolean):[];
        return {subject:edge.subject.slice(0,180),object:edge.object.slice(0,180),
          status:["challenged","observed","unobserved"].includes(edge.status)?edge.status:"unobserved",
          decision:["conditional","weaken","suspend","restore"].includes(edge.decision)?edge.decision:null,
          claimIds:Array.isArray(edge.claimIds)?edge.claimIds.filter(id=>typeof id==="string").slice(0,8):[],
          revisionOptions:options};
      }).filter(Boolean):[];
      const alternatives=Array.isArray(snapshot.alternatives)?snapshot.alternatives.slice(0,8).map(item=>{
        if(!item||typeof item.subject!=="string"||typeof item.object!=="string")return null;
        const paths=Array.isArray(item.paths)?item.paths.slice(0,3).map(path=>
          Array.isArray(path)?path.slice(0,3).filter(edge=>edge&&typeof edge.subject==="string"&&typeof edge.object==="string")
            .map(edge=>({subject:edge.subject.slice(0,180),object:edge.object.slice(0,180)})):[]
        ).filter(path=>path.length):[];
        return {subject:item.subject.slice(0,180),object:item.object.slice(0,180),paths};
      }).filter(Boolean):[];
      return {at:safeTime(snapshot.at,Date.now()),signature:typeof snapshot.signature==="string"?snapshot.signature.slice(0,600):"",edges,alternatives};
    }).filter(Boolean):[];
    return {version:1,type:raw.type,createdAt,status,conclusions,reviews,modelHistory};
  }
  function reviewKindForClaim(claim) {
    if(!claim||claim.status==="superseded")return null;
    if(claim.kind==="causal"&&claim.polarity===false)return "opposing_claim";
    if(claim.kind==="observation")return claim.polarity===false?"counterexample":"supporting_observation";
    return null;
  }
  function claimSemanticKey(claim) {
    const canonical=value=>KNOWLEDGE&&typeof KNOWLEDGE.canonicalEntity==="function"
      ?KNOWLEDGE.canonicalEntity(value):normalise(value);
    return [claim&&claim.kind||"",canonical(claim&&claim.subject||""),normalise(claim&&claim.predicate||""),
      canonical(claim&&claim.object||""),claim&&claim.polarity===false?"0":"1",claim&&claim.modality||""].join("|");
  }
  function evidenceSimilarity(left,right) {
    const a=normalise(left),b=normalise(right);
    if(!a||!b)return a===b?1:0;
    if(a===b)return 1;
    const aa=new Set(tokens(a)),bb=new Set(tokens(b));
    if(!aa.size||!bb.size)return 0;
    let overlap=0;
    for(const token of aa)if(bb.has(token))overlap++;
    return overlap/(aa.size+bb.size-overlap);
  }
  function isRepeatedEvidenceClaim(claim,previousClaims) {
    const key=claimSemanticKey(claim);
    return (previousClaims||[]).some(old=>old&&claimSemanticKey(old)===key&&
      evidenceSimilarity(claim.evidence||"",old.evidence||"")>=0.8);
  }
  function evidenceClaimSignature(claim) {
    return claimSemanticKey(claim)+"|"+normalise(claim&&claim.evidence||"");
  }
  function cleanModelEvidence(raw) {
    if(!raw||typeof raw!=="object"||typeof raw.edgeSubject!=="string"||typeof raw.edgeObject!=="string"||
       typeof raw.signature!=="string"||typeof raw.claimId!=="string"||
       !["counterexample","opposing_claim","supporting_observation","supporting_claim"].includes(raw.kind))return null;
    const edgeSubject=raw.edgeSubject.trim().slice(0,180),edgeObject=raw.edgeObject.trim().slice(0,180);
    if(!edgeSubject||!edgeObject)return null;
    return {edgeSubject,edgeObject,claimId:raw.claimId.slice(0,100),kind:raw.kind,
      direction:["counterexample","opposing_claim"].includes(raw.kind)?"challenging":"supporting",
      strategy:["conditional","weaken","suspend","restore"].includes(raw.strategy)?raw.strategy:null,
      signature:raw.signature.slice(0,900),at:safeTime(raw.at,Date.now()),
      evidence:typeof raw.evidence==="string"?raw.evidence.slice(0,240):""};
  }
  function modelEvidenceKey(item) {
    return modelDecisionKey(item.edgeSubject,item.edgeObject)+"|"+item.signature;
  }
  function mergeModelEvidenceHistory(existing,incoming) {
    const unique=new Map();
    for(const raw of [...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]) {
      const item=cleanModelEvidence(raw);
      if(item)unique.set(modelEvidenceKey(item),item);
    }
    return [...unique.values()].sort((a,b)=>a.at-b.at).slice(-MAX_MODEL_EVIDENCE);
  }
  function mergeReasoningArchive(existing,incoming) {
    const unique=new Map();
    for(const raw of [...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]) {
      if(!raw||raw.role==="user")continue;
      const reasoning=cleanReasoning(raw.reasoning);
      if(!reasoning)continue;
      const entry={role:"assistant",time:safeTime(raw.time,reasoning.createdAt),
        text:typeof raw.text==="string"?raw.text.slice(0,MAX_DIALOG_TEXT):"",reasoning};
      const conclusionKey=reasoning.conclusions.map(item=>item.subject+"|"+item.object+"|"+
        item.paths.map(path=>path.map(edge=>edge.subject+">"+edge.object).join(">")).join(";")).join("||");
      const key=entry.time+"|"+reasoning.createdAt+"|"+reasoning.type+"|"+conclusionKey;
      unique.set(key,entry);
    }
    return [...unique.values()].sort((a,b)=>a.time-b.time).slice(-MAX_REASONING_ARCHIVE);
  }
  function syncArchivedReasoning(entry) {
    const reasoning=cleanReasoning(entry&&entry.reasoning);
    if(!reasoning)return;
    const archived=mergeReasoningArchive([], [entry])[0];
    if(!archived)return;
    const archivedKey=archived.time+"|"+archived.reasoning.createdAt+"|"+archived.reasoning.type+"|"+
      archived.reasoning.conclusions.map(item=>item.subject+"|"+item.object+"|"+
        item.paths.map(path=>path.map(edge=>edge.subject+">"+edge.object).join(">")).join(";")).join("||");
    for(const item of dialog) {
      const candidate=mergeReasoningArchive([], [item])[0];
      if(!candidate)continue;
      const candidateKey=candidate.time+"|"+candidate.reasoning.createdAt+"|"+candidate.reasoning.type+"|"+
        candidate.reasoning.conclusions.map(row=>row.subject+"|"+row.object+"|"+
          row.paths.map(path=>path.map(edge=>edge.subject+">"+edge.object).join(">")).join(";")).join("||");
      if(candidateKey===archivedKey)item.reasoning=cleanReasoning(reasoning);
    }
  }
  function inquiryAssessmentFor(item) {
    const text=normalise(item&&item.responseText||"");
    if(!text)return {assessment:"unassessed",reason:"Ответ не содержит текста для оценки."};
    if(item.kind==="contrast_observations"||item.kind==="clarify_counterexample") {
      const noContext=/не указа|нет точн|неизвестн|не хватает информац|не могу установ|нет сведени|нет информац|не располага|контекст отсутств|условия не сохран/u.test(text);
      return noContext
        ?{assessment:"insufficient_context",reason:"В ответе прямо указано, что контекст наблюдений неизвестен или не сохранён. Противоположные записи остаются неразрешёнными."}
        :{assessment:"context_reported_unverified",reason:"В ответе приведён контекст, но его сопоставимость и временной порядок не проверены. Наблюдения остаются пользовательскими сведениями."};
    }
    const noObservations=/(?:нет|не было|отсутств|не располага|не найден|не зафиксир|не сохран).*?(?:наблюден|случа|данн|пример)|(?:наблюден|случа|данн|пример).*?(?:нет|отсутств|не было|не зафиксир)/u.test(text);
    return noObservations
      ?{assessment:"gap_confirmed",reason:"Ответ сообщает об отсутствии прямых наблюдений. Звено остаётся непроверенным; отсутствие данных не подтверждает и не опровергает причинную связь."}
      :{assessment:"observations_reported_unverified",reason:"В ответе упомянуты возможные наблюдения, но они не представлены как отдельные сопоставимые записи. Нужна проверка исходных случаев."};
  }
  function applyInquiryAssessment(item) {
    if(!item||item.status!=="answered")return false;
    const result=inquiryAssessmentFor(item);
    const at=safeTime(item.answeredAt,item.updatedAt);
    const changed=item.assessment!==result.assessment||item.assessmentReason!==result.reason||item.assessmentAt!==at;
    item.assessment=result.assessment;item.assessmentReason=result.reason;item.assessmentAt=at;
    return changed;
  }
  function assessAnsweredInquiries() {
    let changed=false;
    for(const item of inquiries)if(applyInquiryAssessment(item))changed=true;
    return changed;
  }
  function inquiryAssessmentLabel(item) {
    return ({insufficient_context:"контекст не установлен",gap_confirmed:"отсутствие наблюдений отмечено",
      context_reported_unverified:"контекст указан, но не проверен",
      observations_reported_unverified:"наблюдения заявлены, но не проверены",unassessed:"ответ ещё не оценён"})[item&&item.assessment]||"ответ ещё не оценён";
  }
  function inquiryAssessmentReport() {
    refreshInquiryQueue();
    const answered=inquiries.filter(item=>item.status==="answered").sort((a,b)=>a.createdAt-b.createdAt);
    const open=openInquiries();
    if(!answered.length&&!open.length)return "Исследовательская очередь пуста. Сначала сформируй вопросы командой «Найди пробелы в знаниях».";
    let answer="ОЦЕНКА ИССЛЕДОВАТЕЛЬСКИХ ОТВЕТОВ\n\n";
    for(const item of answered.slice(-12)) {
      answer+=item.id+" · "+item.edgeSubject+" → "+item.edgeObject+"\n";
      answer+="Статус ответа: "+inquiryAssessmentLabel(item)+"\n";
      answer+=(item.assessmentReason||inquiryAssessmentFor(item).reason)+"\n";
      answer+="Ответ: «"+item.responseText.slice(0,700)+"»\n\n";
    }
    if(open.length)answer+="ОСТАЮТСЯ ОТКРЫТЫМИ\n"+open.map(item=>"• "+item.id+" — "+item.edgeSubject+" → "+item.edgeObject).join("\n")+"\n\n";
    answer+="Эта оценка показывает, что сообщил пользователь и чего всё ещё не хватает. Она не проверяет достоверность сообщений и не меняет решения рабочей модели автоматически.";
    return answer;
  }
  function cleanInquiry(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !/^Q\d{1,8}$/u.test(raw.id) ||
        typeof raw.signature !== "string" || typeof raw.question !== "string") return null;
    return {id:raw.id,signature:raw.signature.slice(0,500),
      kind:["contrast_observations","clarify_counterexample","missing_observation"].includes(raw.kind)?raw.kind:"missing_observation",
      edgeSubject:typeof raw.edgeSubject==="string"?raw.edgeSubject.slice(0,180):"",
      edgeObject:typeof raw.edgeObject==="string"?raw.edgeObject.slice(0,180):"",
      question:raw.question.slice(0,700),reason:typeof raw.reason==="string"?raw.reason.slice(0,700):"",
      priority:Math.max(0,Math.min(9,Number(raw.priority)||0)),
      status:["open","answered","skipped"].includes(raw.status)?raw.status:"open",
      sourceClaimIds:Array.isArray(raw.sourceClaimIds)?raw.sourceClaimIds.filter(x=>typeof x==="string").slice(0,12):[],
      createdAt:safeTime(raw.createdAt,Date.now()),updatedAt:safeTime(raw.updatedAt,safeTime(raw.createdAt,Date.now())),
      lastAskedAt:safeTime(raw.lastAskedAt,0),responseText:typeof raw.responseText==="string"?raw.responseText.slice(0,MAX_TEXT):"",
      responseMemoryId:typeof raw.responseMemoryId==="string"?raw.responseMemoryId.slice(0,100):"",
      responseClaimIds:Array.isArray(raw.responseClaimIds)?raw.responseClaimIds.filter(x=>typeof x==="string").slice(0,12):[],
      answeredAt:safeTime(raw.answeredAt,0),
      assessment:["insufficient_context","gap_confirmed","context_reported_unverified","observations_reported_unverified"].includes(raw.assessment)?raw.assessment:"unassessed",
      assessmentReason:typeof raw.assessmentReason==="string"?raw.assessmentReason.slice(0,700):"",
      assessmentAt:safeTime(raw.assessmentAt,0)};
  }
  function mergeInquiryHistory(existing,incoming) {
    const unique=new Map();
    for(const raw of [...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]) {
      const item=cleanInquiry(raw);if(!item)continue;
      const previous=unique.get(item.signature);
      if(!previous||item.updatedAt>=previous.updatedAt) {
        if(previous&&item.id!==previous.id)item.id=previous.id;
        unique.set(item.signature,item);
      }
    }
    const result=[...unique.values()].sort((a,b)=>a.createdAt-b.createdAt).slice(-MAX_INQUIRIES);
    const nums=result.map(x=>Number(x.id.slice(1))).filter(Number.isFinite);
    nextInquiryNumber=Math.max(nextInquiryNumber,nums.length?Math.max(...nums)+1:1);
    return result;
  }
  function reconcileInquiryResponsesFromEntries(entries) {
    let changed=false;
    const latest=new Map();
    for(const entry of Array.isArray(entries)?entries:[]) {
      if(!entry||entry.role!=="user"||typeof entry.text!=="string")continue;
      const match=entry.text.match(/^ответ на вопрос\s+#?\s*(q\d+)\s*:\s*([\s\S]+)$/iu);
      if(!match||!match[2].trim())continue;
      const id=match[1].toUpperCase();
      const at=safeTime(entry.time,0);
      const previous=latest.get(id);
      if(!previous||at>=previous.at)latest.set(id,{text:match[2].trim().slice(0,MAX_TEXT),at});
    }
    for(const item of inquiries) {
      if(item.status!=="answered")continue;
      const response=latest.get(item.id.toUpperCase());
      if(!response||response.at<item.createdAt)continue;
      if(item.responseText!==response.text) {
        item.responseText=response.text;
        item.updatedAt=Math.max(item.updatedAt,response.at);
        changed=true;
      }
      const linked=memories.find(entry=>entry.id===item.responseMemoryId);
      if(!linked) {
        const prefix=normalise("Ответ на вопрос "+item.id+":");
        const candidate=memories.find(entry=>normalise(entry.text).startsWith(prefix));
        if(candidate) {
          item.responseMemoryId=candidate.id;
          changed=true;
        }
      }
    }
    if(assessAnsweredInquiries())changed=true;
    return changed;
  }
  function inquiryEdgeKey(subject,object) {
    const key=value=>KNOWLEDGE&&KNOWLEDGE.canonicalEntity?KNOWLEDGE.canonicalEntity(value):normalise(value);
    return key(subject)+"|"+key(object);
  }
  function inquiryCandidates() {
    const claims=memories.flatMap(item=>item.claims||[]).filter(claim=>claim&&claim.status!=="superseded");
    const edges=new Map();
    for(const entry of reasoningArchive) {
      const meta=cleanReasoning(entry.reasoning);if(!meta)continue;
      for(const conclusion of meta.conclusions)for(const path of conclusion.paths)for(const edge of path) {
        const key=inquiryEdgeKey(edge.subject,edge.object);
        if(!edges.has(key))edges.set(key,{subject:edge.subject,object:edge.object});
      }
    }
    const candidates=[];
    for(const edge of edges.values()) {
      const obs=claims.filter(c=>c.kind==="observation"&&KNOWLEDGE.sameEntity(c.subject,edge.subject)&&KNOWLEDGE.sameEntity(c.object,edge.object));
      const positive=obs.filter(c=>c.polarity!==false),negative=obs.filter(c=>c.polarity===false);
      const causal=claims.filter(c=>c.kind==="causal"&&KNOWLEDGE.sameEntity(c.subject,edge.subject)&&KNOWLEDGE.sameEntity(c.object,edge.object));
      const sourceClaimIds=[...new Set([...causal,...obs].map(c=>c.id).filter(Boolean))].slice(0,12);
      if(positive.length&&negative.length) {
        candidates.push({signature:"contrast_observations|"+inquiryEdgeKey(edge.subject,edge.object),kind:"contrast_observations",
          edgeSubject:edge.subject,edgeObject:edge.object,priority:0,sourceClaimIds,
          question:"В чём различались обстоятельства двух наблюдений по связи «"+edge.subject+" → "+edge.object+"»? Уточни контекст, время и то, как определялся результат. Не нужно специально создавать какие-либо условия.",
          reason:"В памяти есть наблюдение с результатом и противоположное наблюдение для того же звена. Нужно понять, относятся ли они к разным условиям или действительно противоречат друг другу."});
      } else if(negative.length) {
        candidates.push({signature:"clarify_counterexample|"+inquiryEdgeKey(edge.subject,edge.object),kind:"clarify_counterexample",
          edgeSubject:edge.subject,edgeObject:edge.object,priority:1,sourceClaimIds,
          question:"Можешь уточнить контекст наблюдения, в котором «"+edge.subject+"» присутствовало, а «"+edge.object+"» не наблюдалось? Важно понять время, условия и критерий результата.",
          reason:"Найден потенциальный контрпример к сохранённой причинной связи. Нужно уточнить обстоятельства, не отбрасывая ни исходную запись, ни наблюдение."});
      } else if(!obs.length) {
        candidates.push({signature:"missing_observation|"+inquiryEdgeKey(edge.subject,edge.object),kind:"missing_observation",
          edgeSubject:edge.subject,edgeObject:edge.object,priority:2,sourceClaimIds,
          question:"Есть ли у тебя конкретные естественные наблюдения, которые помогают проверить связь «"+edge.subject+" → "+edge.object+"»? Подойдут случаи с наличием и отсутствием исходного условия, а также с наличием и отсутствием результата.",
          reason:"В архиве есть причинное звено, но в памяти нет отдельных наблюдений, непосредственно проверяющих его. Отсутствие данных не подтверждает и не опровергает связь."});
      }
    }
    return candidates.sort((a,b)=>a.priority-b.priority);
  }
  function refreshInquiryQueue() {
    let added=0,changed=false;
    for(const c of inquiryCandidates()) {
      const old=inquiries.find(x=>x.signature===c.signature);
      if(old) {
        if(old.status==="open"&&(old.question!==c.question||old.reason!==c.reason)) {
          old.question=c.question;old.reason=c.reason;old.sourceClaimIds=c.sourceClaimIds;old.updatedAt=Date.now();changed=true;
        }
        continue;
      }
      if(inquiries.length>=MAX_INQUIRIES)break;
      inquiries.push({id:"Q"+nextInquiryNumber++,signature:c.signature,kind:c.kind,edgeSubject:c.edgeSubject,edgeObject:c.edgeObject,
        question:c.question,reason:c.reason,priority:c.priority,status:"open",sourceClaimIds:c.sourceClaimIds,
        createdAt:Date.now(),updatedAt:Date.now(),lastAskedAt:0,responseText:"",responseMemoryId:"",responseClaimIds:[],answeredAt:0});
      added++;changed=true;
    }
    if(changed)persist();
    return {added,open:openInquiries(),answered:inquiries.filter(x=>x.status==="answered")};
  }
  function openInquiries() {
    return inquiries.filter(x=>x.status==="open").sort((a,b)=>a.lastAskedAt-b.lastAskedAt||a.priority-b.priority||a.createdAt-b.createdAt);
  }
  function presentInquiry(item) {
    if(!item)return "Сейчас у меня нет открытых исследовательских вопросов. Сначала сформируй причинные выводы или запусти «Найди пробелы в знаниях».";
    item.lastAskedAt=Date.now();item.updatedAt=Date.now();persist();
    return "ВОПРОС ДЛЯ УТОЧНЕНИЯ · "+item.id+"\n\n"+item.question+
      "\n\nЗАЧЕМ Я СПРАШИВАЮ\n"+item.reason+
      "\n\nОТВЕТ\nНажми «Запомнить» и начни ответ точно так:\nОтвет на вопрос "+item.id+": [твой ответ]\n\nОтвет будет сохранён как твоё сообщение и привязан к "+item.id+". Он не станет автоматически доказанным фактом.";
  }
  function researchGapsAnswer() {
    const r=refreshInquiryQueue();
    if(!r.open.length)return "ПОИСК ПРОБЕЛОВ ЗАВЕРШЁН\n\nНовых открытых вопросов не получилось сформировать. Возможно, в архиве пока нет подходящих причинных выводов или найденные вопросы уже получили ответы.\n\nОчередь доступна командой «Какие вопросы открыты?».";
    return "ПОИСК ПРОБЕЛОВ ЗАВЕРШЁН\n\nНовых вопросов: "+r.added+". Открыто: "+r.open.length+". Уже получили ответ: "+r.answered.length+".\n\nПриоритет отражает наличие противоречий и пробелов, а не вероятность истинности гипотез.\n\n"+presentInquiry(r.open[0]);
  }
  function inquiryOverviewAnswer() {
    refreshInquiryQueue();
    const open=openInquiries(),answered=inquiries.filter(x=>x.status==="answered"),skipped=inquiries.filter(x=>x.status==="skipped");
    if(!inquiries.length)return "Очередь исследовательских вопросов пока пуста. Сохрани причинные выводы, затем попроси «Найди пробелы в знаниях».";
    let answer="ИССЛЕДОВАТЕЛЬСКАЯ ОЧЕРЕДЬ\n\nОткрыто: "+open.length+" · Получили ответ: "+answered.length+" · Пропущено: "+skipped.length+"\n";
    if(open.length)answer+="\nОТКРЫТЫЕ ВОПРОСЫ\n"+open.map(x=>"• "+x.id+" — "+x.edgeSubject+" → "+x.edgeObject+" · "+x.question).join("\n");
    if(answered.length)answer+="\n\nПОЛУЧЕННЫЕ ОТВЕТЫ\n"+answered.slice(-8).map(x=>"• "+x.id+" — "+inquiryAssessmentLabel(x)).join("\n");
    if(skipped.length)answer+="\n\nПРОПУЩЕНО: "+skipped.map(x=>x.id).join(", ");
    return answer+"\n\nОтветы остаются пользовательскими сведениями. Они не подтверждают причинную связь автоматически.";
  }
  function skipInquiry(id) {
    const item=inquiries.find(x=>x.id.toUpperCase()===String(id||"").toUpperCase()&&x.status==="open");
    if(!item)return "Не нашёл открытый вопрос "+id+". Посмотри очередь командой «Какие вопросы открыты?».";
    item.status="skipped";item.updatedAt=Date.now();persist();
    return "Вопрос "+item.id+" помечен как пропущенный. Его история и источники сохранены.";
  }
  function recordInquiryResponse(id,response,memory,claims) {
    const item=inquiries.find(x=>x.id.toUpperCase()===String(id||"").toUpperCase()&&x.status==="open");
    if(!item)return "";
    item.status="answered";item.responseText=String(response||"").trim().slice(0,MAX_TEXT);
    item.responseMemoryId=memory&&memory.id||"";
    item.responseClaimIds=[...new Set((claims||[]).map(c=>c&&c.id).filter(Boolean))].slice(0,12);
    item.answeredAt=Date.now();item.updatedAt=item.answeredAt;applyInquiryAssessment(item);persist();
    return "ОТВЕТ ПРИВЯЗАН К "+item.id+"\nВ памяти сохранён ответ: «"+item.responseText+"»."+
      (item.responseClaimIds.length?" Выделено структурированных утверждений: "+item.responseClaimIds.length+".":" Структурированное утверждение не выделено, но текст сохранён.")+
      " Рабочая причинная модель не меняется автоматически.";
  }
  function mergeReviewFindings(existing,incoming) {
    const unique=new Map();
    for(const item of [...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]) {
      if(!item||typeof item.claimId!=="string")continue;
      const key=item.claimId+"|"+normalise(item.edgeSubject)+"|"+normalise(item.edgeObject)+"|"+item.kind;
      unique.set(key,item);
    }
    return [...unique.values()];
  }
  function recordNewEvidenceForDecisions(claims,previousClaims) {
    const decisions=currentModelDecisions(),additions=[];
    if(!decisions.length)return additions;
    for(const claim of claims||[]) {
      const kind=claim&&claim.kind==="causal"&&claim.polarity!==false&&claim.status!=="superseded"
        ?"supporting_claim":reviewKindForClaim(claim);
      if(!kind||isRepeatedEvidenceClaim(claim,previousClaims))continue;
      for(const decision of decisions) {
        if(safeTime(claim.createdAt,Date.now())<=decision.at)continue;
        if(!KNOWLEDGE.sameEntity(decision.edgeSubject,claim.subject)||
           !KNOWLEDGE.sameEntity(decision.edgeObject,claim.object))continue;
        const signature=evidenceClaimSignature(claim);
        const event={edgeSubject:decision.edgeSubject,edgeObject:decision.edgeObject,claimId:claim.id,
          kind,strategy:decision.strategy,signature,at:safeTime(claim.createdAt,Date.now()),
          evidence:String(claim.evidence||"").slice(0,240)};
        if(modelEvidence.some(item=>modelEvidenceKey(item)===modelEvidenceKey(event))||
           additions.some(item=>modelEvidenceKey(item)===modelEvidenceKey(event)))continue;
        additions.push(event);
      }
    }
    if(additions.length) {
      modelEvidence=mergeModelEvidenceHistory(modelEvidence,additions);
      persist();
    }
    return additions;
  }
  function formatNewModelEvidenceNote(events) {
    if(!Array.isArray(events)||!events.length)return "";
    const labels={
      counterexample:"новое наблюдение, не согласующееся со звеном",
      opposing_claim:"новое отрицательное причинное утверждение о звене",
      supporting_observation:"новое наблюдение, согласующееся со звеном",
      supporting_claim:"новое причинное утверждение в пользу звена"
    };
    const lines=events.slice(0,4).map(item=>"• "+labels[item.kind]+" «"+item.edgeSubject+" → "+item.edgeObject+"»: «"+item.evidence+"»");
    return "НОВЫЕ СВИДЕТЕЛЬСТВА ДЛЯ ПЕРЕСМОТРА РЕШЕНИЯ\n"+lines.join("\n")+
      "\nРешение рабочей модели не изменено автоматически. Это пользовательские записи, а не независимо подтверждённые доказательства. Для повторной оценки используй команду «Построй обновлённую причинную модель».";
  }
  function collectReasoningFindings(meta,claims) {
    if(!meta||!Array.isArray(claims)||!KNOWLEDGE||typeof KNOWLEDGE.sameEntity!=="function")return [];
    const additions=[];
    for(const claim of claims){
      if(!claim||typeof claim.id!=="string")continue;
      const kind=reviewKindForClaim(claim);
      if(!kind)continue;
      const at=safeTime(claim.createdAt,Date.now());
      const phase=at<=meta.createdAt?"baseline":"subsequent";
      const matchedEdges=new Map();
      for(const conclusion of meta.conclusions){
        for(const path of conclusion.paths){
          for(const edge of path){
            if(!KNOWLEDGE.sameEntity(claim.subject,edge.subject)||!KNOWLEDGE.sameEntity(claim.object,edge.object))continue;
            const key=normalise(edge.subject)+"|"+normalise(edge.object);
            if(!matchedEdges.has(key))matchedEdges.set(key,edge);
          }
        }
      }
      for(const edge of matchedEdges.values()){
        const alreadyRecorded=meta.reviews.some(item=>item.claimId===claim.id&&
          KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object));
        const alreadyAdded=additions.some(item=>item.claimId===claim.id&&
          KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object));
        if(alreadyRecorded||alreadyAdded)continue;
        additions.push({
          claimId:claim.id,kind,phase,subject:String(claim.subject||"").slice(0,180),
          object:String(claim.object||"").slice(0,180),
          evidence:String(claim.evidence||"").slice(0,240),
          edgeSubject:edge.subject,edgeObject:edge.object,at
        });
      }
    }
    return additions;
  }
  function updateReasoningStatus(meta) {
    const challenged=meta.reviews.some(item=>item.kind==="counterexample"||item.kind==="opposing_claim"||item.kind==="source_revised");
    meta.status=challenged?"challenged":meta.reviews.length?"updated":"current";
    return meta;
  }
  function makeReasoningMeta(type,result,claims) {
    if(!result||!["causal_chain","derived_hypotheses","prioritized_hypotheses"].includes(type))return null;
    const source=Array.isArray(result.hypotheses)?result.hypotheses:
      Array.isArray(result.paths)?result.paths.map(path=>({
        subject:path[0]&&path[0].subject,
        object:path[path.length-1]&&path[path.length-1].object,
        paths:[path]
      })):[];
    const conclusions=source.slice(0,8).map(item=>{
      const paths=Array.isArray(item.paths)?item.paths:[];
      const cleanPaths=paths.slice(0,3).map(path=>path.filter(edge=>edge&&typeof edge.subject==="string"&&typeof edge.object==="string")
        .slice(0,3).map(edge=>({id:typeof edge.id==="string"?edge.id:null,subject:edge.subject,object:edge.object})))
        .filter(path=>path.length);
      return item.subject&&item.object&&cleanPaths.length?{subject:item.subject,object:item.object,paths:cleanPaths}:null;
    }).filter(Boolean);
    const createdAt=Date.now();
    const meta=cleanReasoning({version:1,type,createdAt,status:"current",conclusions,reviews:[]});
    if(!meta)return null;
    meta.reviews=collectReasoningFindings(meta,claims||[]);
    return cleanReasoning(updateReasoningStatus(meta));
  }
  function baselineReviewNote(meta) {
    if(!meta)return "";
    const challenged=meta.reviews.filter(item=>item.phase==="baseline"&&
      (item.kind==="counterexample"||item.kind==="opposing_claim"||item.kind==="source_revised"));
    if(!challenged.length)return "";
    const lines=challenged.slice(0,4).map(item=>
      "• «"+item.evidence+"» · затронутое звено "+item.edgeSubject+" → "+item.edgeObject
    );
    return "\n\nПРЕДВАРИТЕЛЬНАЯ САМОПРОВЕРКА\nДо построения этого вывода в памяти уже были сохранены сведения, ставящие под вопрос отдельные звенья:\n"+
      lines.join("\n")+
      "\n\nЭто ранее известные ограничения, а не новые опровержения. Вывод помечен как требующий пересмотра; само наблюдение тоже ещё требует проверки.";
  }
  function reviewPriorConclusions(freshClaims) {
    if(!Array.isArray(freshClaims)||!freshClaims.length||!KNOWLEDGE||typeof KNOWLEDGE.sameEntity!=="function")return "";
    const findings=[];
    for(const entry of reasoningArchive){
      const meta=cleanReasoning(entry.reasoning);
      if(!meta)continue;
      const additions=collectReasoningFindings(meta,freshClaims);
      if(!additions.length)continue;
      meta.reviews.push(...additions);
      meta.reviews=meta.reviews.slice(-48);
      updateReasoningStatus(meta);
      entry.reasoning=cleanReasoning(meta);
      syncArchivedReasoning(entry);
      for(const finding of additions)findings.push({entry,finding});
    }
    if(!findings.length)return "";
    const unique=[...new Map(findings.map(row=>[row.entry.time+"|"+row.finding.claimId+"|"+row.finding.edgeSubject+"|"+row.finding.edgeObject,row])).values()];
    const challenged=unique.filter(row=>row.finding.kind==="counterexample"||row.finding.kind==="opposing_claim"||row.finding.kind==="source_revised");
    const supporting=unique.filter(row=>row.finding.kind==="supporting_observation"||row.finding.kind==="supporting_claim");
    let answer="";
    if(challenged.length){
      answer="ПЕРЕСМОТР ПРЕЖНЕГО ВЫВОДА\n";
      for(const row of challenged.slice(0,4)){
        answer+="Ранее выведенная связь затронута звеном "+row.finding.edgeSubject+" → "+row.finding.edgeObject+"\n";
        answer+=(row.finding.phase==="baseline"?"Ранее сохранённое к моменту вывода свидетельство: ":"Новое потенциальное противоречие: ")+"«"+row.finding.evidence+"»\n";
      }
      answer+="Я пометил прежний вывод как требующий пересмотра. Я не удаляю его и не объявляю опровергнутым: новое сообщение тоже требует проверки, а контекст наблюдения может иметь значение.";
    }
    if(supporting.length){
      if(answer)answer+="\n\n";
      answer+="ДОПОЛНЕНИЕ К ПРЕЖНЕМУ ВЫВОДУ\n";
      for(const row of supporting.slice(0,3)){
        answer+=(row.finding.phase==="baseline"?"Уже сохранённое наблюдение":"Новое наблюдение")+" согласуется со звеном "+row.finding.edgeSubject+" → "+row.finding.edgeObject+": «"+row.finding.evidence+"».\n";
      }
      answer+="Это дополнительные записи, согласующиеся со связью, но не независимое доказательство причинности.";
    }
    return answer;
  }
  function edgeMatchesClaim(edge,claim) {
    return KNOWLEDGE.sameEntity(edge.subject,claim.subject)&&KNOWLEDGE.sameEntity(edge.object,claim.object);
  }
  function findAlternativeCausalPaths(start,target,allClaims,excludedEdges) {
    const isExcluded=edge=>(excludedEdges||[]).some(item=>
      KNOWLEDGE.sameEntity(item.subject,edge.subject)&&KNOWLEDGE.sameEntity(item.object,edge.object));
    const suspended=currentModelDecisions().filter(item=>item.strategy==="suspend");
    const isSuspended=edge=>suspended.some(item=>
      KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object));
    const isBlocked=edge=>allClaims.some(claim=>claim&&
      ((claim.kind==="causal"&&claim.polarity===false)||(claim.kind==="observation"&&claim.polarity===false))&&
      edgeMatchesClaim(edge,claim));
    const edges=allClaims.filter(claim=>claim&&claim.kind==="causal"&&claim.polarity!==false&&claim.status!=="superseded"&&
      !isExcluded(claim)&&!isBlocked(claim)&&!isSuspended(claim));
    const paths=[];
    const startKey=KNOWLEDGE.canonicalEntity(start),targetKey=KNOWLEDGE.canonicalEntity(target);
    if(!startKey||!targetKey)return paths;
    function walk(node,path,visited) {
      if(paths.length>=4||path.length>=3)return;
      for(const edge of edges) {
        if(KNOWLEDGE.canonicalEntity(edge.subject)!==node)continue;
        const next=KNOWLEDGE.canonicalEntity(edge.object);
        if(!next||visited.has(next))continue;
        const nextPath=[...path,edge];
        if(next===targetKey){paths.push(nextPath);continue;}
        walk(next,nextPath,new Set([...visited,next]));
      }
    }
    walk(startKey,[],new Set([startKey]));
    return paths;
  }
  function revisionOptionsForEdge(edge) {
    const subject=edge.subject,object=edge.object;
    return [
      {
        id:"conditional",
        title:"1. Сохранить связь как условную",
        proposal:"Связь «"+subject+" → "+object+"» может проявляться только при некоторых условиях. Какие именно условия важны, память пока не показывает.",
        discriminators:[
          "Сравнить безопасные естественные случаи с одинаково определёнными условием и результатом, записывая контекст каждого случая.",
          "Проверить временной порядок: условие должно предшествовать результату, а не просто встречаться рядом с ним.",
          "Искать повторения как случаев с результатом, так и случаев без него при сопоставимых обстоятельствах."
        ]
      },
      {
        id:"weaken",
        title:"2. Ослабить общее утверждение",
        proposal:"Не считать «"+subject+"» достаточной или обязательной причиной «"+object+"». Оставить её одним из возможных факторов, пока не выяснены другие условия.",
        discriminators:[
          "Собирать случаи, когда результат возникает без исходного фактора и когда фактор присутствует без результата.",
          "Отдельно записывать другие сопутствующие обстоятельства; совпадение факторов не позволяет приписать эффект одному из них."
        ]
      },
      {
        id:"suspend",
        title:"3. Временно не использовать связь в прогнозах",
        proposal:"Пометить звено «"+subject+" → "+object+"» как спорное и не строить на нём уверенные дальнейшие выводы. Исходную запись оставить в памяти и истории.",
        discriminators:[
          "Уточнить исходное наблюдение: измерение, время, источник и условия.",
          "Решать, возвращать ли звено в активную модель, только после повторяемых и независимо проверенных данных."
        ]
      }
    ];
  }
  function challengedModelEdges() {
    const allClaims=memories.flatMap(item=>item.claims||[]);
    const edges=new Map();
    let changed=false;
    for(const entry of reasoningArchive) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta)continue;
      const additions=collectReasoningFindings(meta,allClaims);
      if(additions.length) {
        meta.reviews.push(...additions);
        meta.reviews=meta.reviews.slice(-48);
        changed=true;
      }
      const previousStatus=meta.status;
      updateReasoningStatus(meta);
      if(previousStatus!==meta.status)changed=true;
      entry.reasoning=cleanReasoning(meta);
      syncArchivedReasoning(entry);
      for(const conclusion of meta.conclusions) {
        for(const path of conclusion.paths) {
          for(const edge of path) {
            const findings=meta.reviews.filter(item=>
              KNOWLEDGE.sameEntity(item.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,edge.object)&&
              ["counterexample","opposing_claim","source_revised"].includes(item.kind));
            if(!findings.length)continue;
            const key=modelDecisionKey(edge.subject,edge.object);
            edges.set(key,{subject:edge.subject,object:edge.object,claimIds:[...new Set(findings.map(item=>item.claimId))].slice(0,8)});
          }
        }
      }
    }
    if(changed)persist();
    return [...edges.values()];
  }
  function findReasoningEntryForEdge(edge) {
    const rows=reasoningArchive.slice().reverse();
    for(const entry of rows) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta||meta.type!=="derived_hypotheses")continue;
      const found=meta.conclusions.some(conclusion=>conclusion.paths.some(path=>path.some(item=>
        KNOWLEDGE.sameEntity(item.subject,edge.subject)&&KNOWLEDGE.sameEntity(item.object,edge.object))));
      if(found)return {entry,meta};
    }
    return null;
  }
  function applyRevisionChoice(query) {
    const clean=String(query||"").trim().replace(/[.!?]+$/u,"");
    const match=clean.match(/^(?:выбираю|применяю|применить|прими|зафиксируй|фиксирую)\s+(?:вариант\s*)?([123])(?:\s+для\s+(?:связи|звена)\s+(.+?)\s*(?:→|⇢|->|—|–)\s*(.+))?$/iu);
    if(!match)return null;
    const candidates=challengedModelEdges();
    let selected;
    if(match[2]&&match[3]) {
      selected=candidates.find(edge=>KNOWLEDGE.sameEntity(edge.subject,match[2])&&KNOWLEDGE.sameEntity(edge.object,match[3]));
      if(!selected) {
        return "Я не нашёл среди спорных звеньев связь «"+match[2]+" → "+match[3]+"». Сначала построй обновлённую причинную модель и выбирай вариант только для звена, отмеченного как «ПОД ВОПРОСОМ».";
      }
    } else if(candidates.length===1) {
      selected=candidates[0];
    } else if(candidates.length>1) {
      return "Есть несколько спорных звеньев. Укажи, к какому применить вариант "+match[1]+":\n"+
        candidates.map(edge=>"• "+edge.subject+" → "+edge.object).join("\n")+
        "\n\nФормат: «Выбираю вариант "+match[1]+" для связи X → Y».";
    } else {
      return "Сейчас в отслеживаемой причинной модели нет спорных звеньев с вариантами пересмотра. Сначала выведи гипотезу и проверь её по сохранённым наблюдениям.";
    }
    const context=findReasoningEntryForEdge(selected);
    if(!context)return "Не удалось найти исходный вывод для выбранной связи. Исходные записи не изменены.";
    const optionId=({1:"conditional",2:"weaken",3:"suspend"})[match[1]];
    const option=revisionOptionsForEdge(selected).find(item=>item.id===optionId);
    if(!option)return "Для этого звена не удалось подготовить выбранный вариант. Ничего не изменено.";
    modelDecisions=mergeModelDecisionHistory(modelDecisions,[{
      edgeSubject:selected.subject,edgeObject:selected.object,strategy:optionId,at:Date.now(),claimIds:selected.claimIds
    }]);
    const ok=persist();
    const effect=optionId==="conditional"
      ?"Связь остаётся в выводах, но теперь явно трактуется как условная; необходимые условия ещё неизвестны."
      :optionId==="weaken"
        ?"Связь остаётся доступной как один из возможных факторов, но не считается обязательной или достаточной причиной."
        :"Связь исключена из новых причинных цепочек и прогнозов. Её исходная запись и контрпример остаются в памяти.";
    return "РЕШЕНИЕ ПРИМЕНЕНО К РАБОЧЕЙ ПРИЧИННОЙ МОДЕЛИ\n\n"+
      "Звено: "+selected.subject+" → "+selected.object+"\n"+
      "Выбрано: "+option.title+"\n"+effect+
      "\n\nЭто решение относится только к рабочей модели. Оно не переписывает и не удаляет исходные воспоминания."+
      (ok?"":"\n\nЛокальное сохранение решения не подтвердилось.");
  }
  function restoreModelEdge(query) {
    let clean=String(query||"").trim().replace(/[.!?]+$/u,"");
    clean=clean.replace(/\s+в\s+рабочую\s+модель$/iu,"");
    const match=clean.match(/^(?:верни|восстанови)\s+(?:связь|звено)\s+(.+?)\s*(?:→|⇢|->|—|–)\s*(.+)$/iu);
    if(!match)return null;
    const existing=currentModelDecisions().find(item=>
      KNOWLEDGE.sameEntity(item.edgeSubject,match[1])&&KNOWLEDGE.sameEntity(item.edgeObject,match[2]));
    if(!existing)return "Для связи «"+match[1]+" → "+match[2]+" нет сохранённого решения о пересмотре. Исходная причинная запись не была изменена.";
    if(existing.strategy==="restore")return "Эта связь уже возвращена в активную рабочую модель: "+existing.edgeSubject+" → "+existing.edgeObject+".";
    modelDecisions=mergeModelDecisionHistory(modelDecisions,[{
      edgeSubject:existing.edgeSubject,edgeObject:existing.edgeObject,strategy:"restore",at:Date.now(),claimIds:existing.claimIds
    }]);
    const ok=persist();
    return "Связь "+existing.edgeSubject+" → "+existing.edgeObject+" возвращена в активную рабочую модель. Она снова может участвовать в новых выводах, но прежний контрпример остаётся видимым, а сама связь не становится доказанной."+
      (ok?"":" Локальное сохранение решения не подтвердилось.");
  }
  function buildCausalModelRevision() {
    const tracked=reasoningArchive.slice();
    if(!tracked.length)return "Пока нет причинных выводов с сохранёнными ссылками на исходные записи. Сначала попроси меня вывести причинную цепочку или новые гипотезы.";
    const allClaims=memories.flatMap(item=>item.claims||[]);
    const decisions=currentModelDecisions();
    const reports=[];
    let changed=false;
    for(const entry of tracked) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta)continue;
      const additions=collectReasoningFindings(meta,allClaims);
      if(additions.length){meta.reviews.push(...additions);meta.reviews=meta.reviews.slice(-48);changed=true;}
      updateReasoningStatus(meta);
      const edgeMap=new Map();
      for(const conclusion of meta.conclusions) {
        for(const path of conclusion.paths) for(const edge of path) {
          const key=normalise(edge.subject)+"|"+normalise(edge.object);
          if(!edgeMap.has(key))edgeMap.set(key,edge);
        }
      }
      const edgeStates=[...edgeMap.values()].map(edge=>{
        const matched=meta.reviews.filter(finding=>KNOWLEDGE.sameEntity(finding.edgeSubject,edge.subject)&&KNOWLEDGE.sameEntity(finding.edgeObject,edge.object));
        const challenged=matched.filter(finding=>finding.kind==="counterexample"||finding.kind==="opposing_claim"||finding.kind==="source_revised");
        const supporting=matched.filter(finding=>finding.kind==="supporting_observation"||finding.kind==="supporting_claim");
        const status=challenged.length?"challenged":supporting.length?"observed":"unobserved";
        return {subject:edge.subject,object:edge.object,status,decision:modelDecisionForEdge(edge,decisions),
          claimIds:matched.map(finding=>finding.claimId).slice(0,8),findings:matched,
          revisionOptions:status==="challenged"?revisionOptionsForEdge(edge):[]};
      });
      const challengedEdges=edgeStates.filter(edge=>edge.status==="challenged");
      const alternatives=[];
      for(const conclusion of meta.conclusions) {
        const relevant=challengedEdges.filter(edge=>conclusion.paths.some(path=>path.some(item=>
          KNOWLEDGE.sameEntity(item.subject,edge.subject)&&KNOWLEDGE.sameEntity(item.object,edge.object))));
        if(!relevant.length)continue;
        const paths=findAlternativeCausalPaths(conclusion.subject,conclusion.object,allClaims,relevant);
        if(paths.length)alternatives.push({subject:conclusion.subject,object:conclusion.object,paths});
      }
      const snapshotEdges=edgeStates.map(edge=>({subject:edge.subject,object:edge.object,status:edge.status,
        decision:edge.decision?edge.decision.strategy:null,claimIds:edge.claimIds,revisionOptions:edge.revisionOptions}));
      const snapshotAlternatives=alternatives.map(item=>({subject:item.subject,object:item.object,paths:item.paths.map(path=>path.map(edge=>({subject:edge.subject,object:edge.object})))}));
      const signatureSource=JSON.stringify({edges:snapshotEdges,alternatives:snapshotAlternatives});
      let signatureHash=2166136261;
      for(let i=0;i<signatureSource.length;i++){signatureHash^=signatureSource.charCodeAt(i);signatureHash=Math.imul(signatureHash,16777619);}
      const signature=(signatureHash>>>0).toString(36);
      const last=meta.modelHistory[meta.modelHistory.length-1];
      if(!last||last.signature!==signature) {
        meta.modelHistory.push({at:Date.now(),signature,edges:snapshotEdges,alternatives:snapshotAlternatives});
        meta.modelHistory=meta.modelHistory.slice(-8);
        changed=true;
      }
      entry.reasoning=cleanReasoning(meta);
      syncArchivedReasoning(entry);
      reports.push({entry,meta,edgeStates,challengedEdges,alternatives});
    }
    if(changed)persist();
    const reportCandidates=[...new Map(reports.flatMap(report=>report.meta.conclusions.map(conclusion=>{
      const pathKey=conclusion.subject+"|"+conclusion.object+"|"+conclusion.paths.map(path=>path.map(edge=>edge.subject+"=>"+edge.object).join(">")).join("|");
      return [pathKey,{report,conclusion}];
    }))).values()];
    const isSubpath=(shortPath,longPath)=>{
      if(shortPath.length>=longPath.length)return false;
      for(let start=0;start+shortPath.length<=longPath.length;start++) {
        if(shortPath.every((edge,index)=>KNOWLEDGE.sameEntity(edge.subject,longPath[start+index].subject)&&
          KNOWLEDGE.sameEntity(edge.object,longPath[start+index].object)))return true;
      }
      return false;
    };
    const uniqueReports=reportCandidates.filter(row=>!reportCandidates.some(other=>other!==row&&
      other.conclusion.paths.some(longPath=>row.conclusion.paths.some(shortPath=>isSubpath(shortPath,longPath)))));
    if(!uniqueReports.length)return "В истории есть записи, но в них нет пригодных причинных маршрутов для перестройки модели.";
    let answer="ПЕРЕСМОТРЕННАЯ ПРИЧИННАЯ МОДЕЛЬ\n\n";
    answer+="Я не переписываю исходные воспоминания. Ниже — текущая оценка маршрутов и возможные варианты структуры.\n\n";
    const inquiryAnswers=inquiries.filter(item=>item.status==="answered");
    if(inquiryAnswers.length) {
      answer+="УЧЁТ ИССЛЕДОВАТЕЛЬСКИХ ОТВЕТОВ\n";
      for(const item of inquiryAnswers.slice(-8)) {
        answer+="• "+item.id+" — "+item.edgeSubject+" → "+item.edgeObject+": "+inquiryAssessmentLabel(item)+".\n";
        answer+="  "+(item.assessmentReason||inquiryAssessmentFor(item).reason)+"\n";
      }
      answer+="Ответы уточняют состояние данных, но сами по себе не подтверждают причинность.\n\n";
    }

    for(let index=0;index<uniqueReports.length&&index<8;index++) {
      const {report,conclusion}=uniqueReports[index];
      answer+=(index+1)+". "+conclusion.subject+" ⇢ "+conclusion.object+"\n";
      for(const path of conclusion.paths) {
        answer+="Маршрут: "+[path[0].subject,...path.map(edge=>edge.object)].join(" → ")+"\n";
        for(const edge of path) {
          const state=report.edgeStates.find(item=>KNOWLEDGE.sameEntity(item.subject,edge.subject)&&KNOWLEDGE.sameEntity(item.object,edge.object));
          const label=state&&state.decision&&state.decision.strategy==="suspend"?"ПРИОСТАНОВЛЕНО В РАБОЧЕЙ МОДЕЛИ":
            state&&state.decision&&state.decision.strategy==="conditional"?"УСЛОВНАЯ СВЯЗЬ":
            state&&state.decision&&state.decision.strategy==="weaken"?"ОСЛАБЛЕННАЯ СВЯЗЬ":
            state&&state.decision&&state.decision.strategy==="restore"?"ВОЗВРАЩЕНО В АКТИВНУЮ МОДЕЛЬ":
            !state?"не оценено":state.status==="challenged"?"ПОД ВОПРОСОМ":state.status==="observed"?"ЕСТЬ СОГЛАСУЮЩЕЕСЯ НАБЛЮДЕНИЕ":"НЕТ ОТДЕЛЬНЫХ НАБЛЮДЕНИЙ";
          answer+="  • "+edge.subject+" → "+edge.object+" — "+label+"\n";
          if(state&&state.status==="challenged") {
            for(const finding of state.findings.filter(item=>item.kind!=="supporting_observation").slice(0,2)) {
              answer+="    Основание: «"+finding.evidence+"» ("+(finding.phase==="baseline"?"уже было в памяти":"появилось позже")+")\n";
            }
          }
        }
      }
      const relevant=report.alternatives.filter(item=>KNOWLEDGE.sameEntity(item.subject,conclusion.subject)&&KNOWLEDGE.sameEntity(item.object,conclusion.object));
      if(relevant.length) {
        for(const item of relevant)for(const path of item.paths)answer+="Возможный обход спорного звена: "+[path[0].subject,...path.map(edge=>edge.object)].join(" → ")+"\n";
      } else if(report.challengedEdges.some(edge=>conclusion.paths.some(path=>path.some(item=>
        KNOWLEDGE.sameEntity(item.subject,edge.subject)&&KNOWLEDGE.sameEntity(item.object,edge.object))))) {
        answer+="Альтернативного маршрута от исходного понятия к этому результату в памяти нет. Подменять слабое звено выдуманной связью нельзя.\n";
      }
      answer+="\n";
    }
    const shownRevisionEdges=new Set();
    const revisionRows=uniqueReports.flatMap(row=>row.report.edgeStates
      .filter(edge=>edge.status==="challenged")
      .map(edge=>({edge,conclusion:row.conclusion})));
    if(revisionRows.length) {
      answer+="ВАРИАНТЫ ПЕРЕСМОТРА СПОРНЫХ СВЯЗЕЙ\n";
      for(const row of revisionRows) {
        const key=normalise(row.edge.subject)+"|"+normalise(row.edge.object);
        if(shownRevisionEdges.has(key))continue;
        shownRevisionEdges.add(key);
        answer+="\nЗвено: "+row.edge.subject+" → "+row.edge.object+"\n";
        const currentDecision=modelDecisionForEdge(row.edge,decisions);
        if(currentDecision) {
          const selected=currentDecision.strategy==="restore"?"Связь возвращена в активную модель":
            "Выбранный вариант: "+(revisionOptionsForEdge(row.edge).find(option=>option.id===currentDecision.strategy)?.title||currentDecision.strategy);
          answer+=selected+"\n";
        }
        for(const option of row.edge.revisionOptions) {
          answer+=option.title+(currentDecision&&currentDecision.strategy===option.id?" · ВЫБРАН":"")+"\n";
          answer+="Предлагаемая модель: "+option.proposal+"\n";
          answer+="Что поможет различить варианты:\n";
          for(const discriminator of option.discriminators)answer+="  • "+discriminator+"\n";
        }
      }
      answer+="\nЭто конкурирующие способы обращаться с неопределённостью, а не три новых факта. Система не выбирает один автоматически. Не нужно намеренно создавать вредные условия ради наблюдений.\n\n";
    }
    const unobservedRows=[...new Map(uniqueReports.flatMap(row=>row.report.edgeStates
      .filter(edge=>edge.status==="unobserved")
      .map(edge=>[normalise(edge.subject)+"|"+normalise(edge.object),edge]))).values()];
    if(unobservedRows.length) {
      answer+="НЕПРОВЕРЕННЫЕ ЗВЕНЬЯ\n";
      for(const edge of unobservedRows.slice(0,6)) {
        answer+="• "+edge.subject+" → "+edge.object+": в памяти пока нет отдельных наблюдений. Нужны естественные записи о наличии условия, измеренном результате, времени и сопутствующих обстоятельствах.\n";
      }
      answer+="\n";
    }
    const parallelRows=[];
    const alreadyListedRoots=new Set(uniqueReports.map(row=>KNOWLEDGE.canonicalEntity(row.conclusion.subject)));
    const suspendedDecisions=decisions.filter(item=>item.strategy==="suspend");
    const candidateRoots=[...new Map(allClaims.filter(claim=>claim&&claim.kind==="causal"&&claim.polarity!==false&&claim.status!=="superseded"&&
      !suspendedDecisions.some(item=>KNOWLEDGE.sameEntity(item.edgeSubject,claim.subject)&&KNOWLEDGE.sameEntity(item.edgeObject,claim.object)))
      .map(claim=>[KNOWLEDGE.canonicalEntity(claim.subject),claim.subject])).values()]
      .filter(root=>!alreadyListedRoots.has(KNOWLEDGE.canonicalEntity(root)));
    for(const row of uniqueReports) {
      const affected=row.report.challengedEdges.some(edge=>row.conclusion.paths.some(path=>path.some(item=>
        KNOWLEDGE.sameEntity(item.subject,edge.subject)&&KNOWLEDGE.sameEntity(item.object,edge.object))));
      if(!affected)continue;
      const internalNodes=new Set(row.conclusion.paths.flatMap(path=>
        path.slice(1).map(edge=>KNOWLEDGE.canonicalEntity(edge.subject))
          .concat(path.length?KNOWLEDGE.canonicalEntity(path[path.length-1].object):[])));
      for(const root of candidateRoots) {
        if(KNOWLEDGE.sameEntity(root,row.conclusion.subject)||internalNodes.has(KNOWLEDGE.canonicalEntity(root)))continue;
        const paths=findAlternativeCausalPaths(root,row.conclusion.object,allClaims,[]);
        for(const path of paths) {
          const key=path.map(edge=>normalise(edge.subject)+"|"+normalise(edge.object)).join(">");
          if(!parallelRows.some(item=>item.key===key))parallelRows.push({key,path});
        }
      }
    }
    if(parallelRows.length) {
      answer+="ОТДЕЛЬНЫЕ МАРШРУТЫ К ТОМУ ЖЕ РЕЗУЛЬТАТУ\n";
      for(const item of parallelRows.slice(0,3))answer+="• "+[item.path[0].subject,...item.path.map(edge=>edge.object)].join(" → ")+" — отдельная непроверенная гипотеза, а не замена спорной связи.\n";
      answer+="\n";
    }
    answer+="Предлагаемое изменение модели: спорные рёбра оставить видимыми, но пометить как требующие проверки; непроверенные рёбра не считать подтверждёнными; альтернативные маршруты хранить отдельно. Ни одна исходная запись не удалена и не переписана.\n\n";
    answer+="Выбранные решения рабочей модели хранятся отдельно от исходных воспоминаний и попадут в резервную копию. Их можно изменить или отменить командой «Верни связь X → Y в рабочую модель». Новый вариант схемы — аналитическое предложение, а не установленный факт.";
    return answer;
  }

  function previousConclusionsAnswer() {
    const tracked=reasoningArchive.slice().sort((a,b)=>a.time-b.time);
    const older=dialog.filter(item=>item.role==="assistant"&&!item.reasoning&&/(⇢|причинная цепочка)/u.test(item.text)).slice(-4);
    if(!tracked.length){
      return "В истории пока нет выводов с сохранёнными ссылками на исходные причинные записи. Старые ответы из предыдущих версий я не могу проверить автоматически: у них не было структурированных ссылок на источники, и я не буду угадывать их основание.";
    }
    const allClaims=memories.flatMap(item=>item.claims||[]);
    let changed=false;
    const audited=[];
    for(const entry of tracked){
      const meta=cleanReasoning(entry.reasoning);
      if(!meta)continue;
      const additions=collectReasoningFindings(meta,allClaims);
      if(additions.length){
        meta.reviews=mergeReviewFindings(meta.reviews,additions).slice(-48);
        changed=true;
      }
      const previousStatus=meta.status;
      updateReasoningStatus(meta);
      if(previousStatus!==meta.status)changed=true;
      entry.reasoning=cleanReasoning(meta);
      syncArchivedReasoning(entry);
      audited.push({entry,meta:entry.reasoning});
    }
    if(changed)persist();
    const challenged=audited.filter(item=>item.meta.status==="challenged"||item.meta.status==="revised");
    const updated=audited.filter(item=>item.meta.status==="updated");
    let answer="ПРОВЕРКА ИСТОРИИ ВЫВОДОВ\n\n";
    if(challenged.length){
      answer+="Выводы, требующие пересмотра:\n";
      for(const item of challenged){
        const findings=item.meta.reviews.filter(row=>row.kind!=="supporting_observation"&&row.kind!=="supporting_claim");
        const impacted=item.meta.conclusions.filter(conclusion=>findings.some(finding=>
          conclusion.paths.some(path=>path.some(edge=>
            KNOWLEDGE.sameEntity(edge.subject,finding.edgeSubject)&&KNOWLEDGE.sameEntity(edge.object,finding.edgeObject)))));
        const titles=impacted.map(row=>row.subject+" ⇢ "+row.object).join("; ");
        answer+="• "+(titles||"Связь из сохранённого вывода")+"\n";
        const uniqueFindings=[...new Map(findings.map(row=>[row.claimId+"|"+row.edgeSubject+"|"+row.edgeObject,row])).values()];
        for(const finding of uniqueFindings.slice(-6)){
          const timing=finding.phase==="baseline"?"Уже было в памяти при создании вывода":"Появилось после создания вывода";
          answer+="  "+timing+": «"+finding.evidence+"» · звено "+finding.edgeSubject+" → "+finding.edgeObject+"\n";
        }
      }
    }else{
      answer+="В доступной памяти пока не найдены явные контрпримеры или противоположные причинные утверждения для отслеживаемых выводов. Это не подтверждает их истинность: исходные связи остаются непроверенными.";
    }
    const supporting=audited.flatMap(item=>item.meta.reviews.filter(row=>row.kind==="supporting_observation"||row.kind==="supporting_claim"));
    if(supporting.length){
      answer+="\n\nНаблюдения и утверждения, согласующиеся с отдельными звеньями: "+supporting.length+
        ". Они не отменяют контрпримеры и не доказывают причинность.";
    }
    if(updated.length)answer+="\n\nВыводы, дополненные только согласующимися сведениями: "+updated.length+".";
    answer+="\n\nВсего выводов с отслеживаемыми источниками: "+audited.length+".";
    if(older.length)answer+="\n\nНекоторые старые ответы в видимой ленте не содержат структурированных ссылок на источники. Они остаются историей, но автоматическая проверка для них недоступна.";
    const evidence=modelEvidence.slice(-8);
    if(evidence.length){
      answer+="\n\nНОВЫЕ СВИДЕТЕЛЬСТВА ПО РЕШЕНИЯМ РАБОЧЕЙ МОДЕЛИ:\n";
      answer+=evidence.map(item=>
        "• "+(item.direction==="challenging"?"потенциально противоречит":"потенциально согласуется с")+" звеном "+
        item.edgeSubject+" → "+item.edgeObject+": «"+item.evidence+"»"
      ).join("\n");
      answer+="\nЭти сообщения не отменяют решения автоматически и не считаются независимо подтверждёнными.";
    }
    answer+=formatModelDecisionNote();
    return answer;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
      memoryMigrated = Array.isArray(saved) && saved.some(item => item && (!Array.isArray(item.claims) || item.claims.length === 0) && KNOWLEDGE && KNOWLEDGE.extractClaims(item.text).length > 0);
      memories = Array.isArray(saved) ? saved.map(cleanMemory).filter(Boolean).slice(-MAX_MEMORIES) : [];
    } catch (error) {
      memories = [];
      console.warn("Could not load NEUROGENESIS memories:", error);
    }
    try {
      const savedDialog = JSON.parse(localStorage.getItem(DIALOG_KEY) || "[]");
      dialog = Array.isArray(savedDialog)
        ? savedDialog.filter(x => x && typeof x.text === "string")
          .map(x => ({ role: x.role === "user" ? "user" : "assistant", text: x.text.slice(0, MAX_DIALOG_TEXT), time: safeTime(x.time, Date.now()), reasoning: cleanReasoning(x.reasoning) }))
          .slice(-MAX_DIALOG)
        : [];
    } catch (error) {
      dialog = [];
      console.warn("Could not load NEUROGENESIS dialogue:", error);
    }
    try {
      const savedArchive=JSON.parse(localStorage.getItem(REASONING_ARCHIVE_KEY)||"[]");
      reasoningArchive=mergeReasoningArchive(savedArchive,dialog);
    } catch(error) {
      reasoningArchive=mergeReasoningArchive([],dialog);
      console.warn("Could not load NEUROGENESIS reasoning archive:",error);
    }
    try {
      const savedInquiries=JSON.parse(localStorage.getItem(INQUIRIES_KEY)||"[]");
      inquiries=mergeInquiryHistory([],savedInquiries);
      if(reconcileInquiryResponsesFromEntries(dialog))memoryMigrated=true;
      if(assessAnsweredInquiries())memoryMigrated=true;
    } catch(error) {
      inquiries=[];nextInquiryNumber=1;
      console.warn("Could not load NEUROGENESIS inquiry queue:",error);
    }
    try {
      const savedEvidence=JSON.parse(localStorage.getItem(MODEL_EVIDENCE_KEY)||"[]");
      modelEvidence=mergeModelEvidenceHistory([],savedEvidence);
    } catch(error) {
      modelEvidence=[];
      console.warn("Could not load NEUROGENESIS model evidence:",error);
    }
    try {
      const savedDecisions=JSON.parse(localStorage.getItem(MODEL_DECISIONS_KEY)||"[]");
      modelDecisions=mergeModelDecisionHistory([],savedDecisions);
    } catch(error) {
      modelDecisions=[];
      console.warn("Could not load NEUROGENESIS model decisions:",error);
    }
    rebuildTagTraceIndex();
    const brain = window.NGBrain;
    if (brain && typeof brain.hasNeuron === "function" && typeof brain.createMemoryTrace === "function") {
      let repaired = false;
      for (const item of memories) {
        const oldIds = item.traceIds.slice();
        item.traceIds = item.tags.map((tag, index) => {
          const id = oldIds[index];
          return id && (typeof brain.hasMemoryTrace === "function" ? brain.hasMemoryTrace(id, tag) : brain.hasNeuron(id)) ? id : ensureTrace(tag);
        });
        if (item.traceIds.some((id, index) => id !== oldIds[index])) repaired = true;
        for (const claim of item.claims || []) {
          const oldClaimTrace = claim.traceId || null;
          ensureClaimTrace(claim);
          if (claim.traceId !== oldClaimTrace) repaired = true;
        }
      }
      rebuildTagTraceIndex();
      if (repaired) memoryMigrated = true;
    }
    if (KNOWLEDGE && KNOWLEDGE.reconcileKnowledgeHistory && KNOWLEDGE.reconcileKnowledgeHistory(memories.flatMap(item=>item.claims||[]))) memoryMigrated = true;
    if (memoryMigrated) { memoryMigrated = false; persist(); }
  }
  function persist() {
    updateCount();
    let ok = true;
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories.slice(-MAX_MEMORIES)));
    } catch (error) {
      ok = false;
      console.warn("NEUROGENESIS memory storage failed", error);
    }
    try {
      localStorage.setItem(DIALOG_KEY, JSON.stringify(dialog.slice(-MAX_DIALOG)));
    } catch (error) {
      ok = false;
      console.warn("NEUROGENESIS dialogue storage failed", error);
    }
    try {
      localStorage.setItem(MODEL_DECISIONS_KEY,JSON.stringify(modelDecisions.slice(-MAX_MODEL_DECISIONS)));
    } catch(error) {
      ok=false;
      console.warn("NEUROGENESIS model decision storage failed",error);
    }
    try {
      localStorage.setItem(MODEL_EVIDENCE_KEY,JSON.stringify(modelEvidence.slice(-MAX_MODEL_EVIDENCE)));
    } catch(error) {
      ok=false;
      console.warn("NEUROGENESIS model evidence storage failed",error);
    }
    try {
      localStorage.setItem(REASONING_ARCHIVE_KEY,JSON.stringify(reasoningArchive.slice(-MAX_REASONING_ARCHIVE)));
    } catch(error) {
      ok=false;console.warn("NEUROGENESIS reasoning archive storage failed",error);
    }
    try {
      localStorage.setItem(INQUIRIES_KEY,JSON.stringify(inquiries.slice(-MAX_INQUIRIES)));
    } catch(error) {
      ok=false;console.warn("NEUROGENESIS inquiry queue storage failed",error);
    }
    if (!ok) setFeedback("Не удалось полностью сохранить данные: хранилище браузера заполнено или недоступно. Сделай экспорт резервной копии.");
    return ok;
  }
  function updateCount() {
    const el = $("memory-count");
    if (el) el.textContent = memories.length + " / " + MAX_MEMORIES + " ЗАПИСЕЙ";
    const manage = $("memory-manage");
    if (manage) manage.textContent = libraryOpen ? "Закрыть записи" : "Записи (" + memories.length + ")";
    const knowledgeCount = $("knowledge-count");
    if (knowledgeCount && KNOWLEDGE) {
      const summary = KNOWLEDGE.summary(memories.flatMap(item => item.claims || []));
      knowledgeCount.textContent = summary.total + " СТРУКТУРНЫХ ЗНАНИЙ · " + summary.conflicts + " КОНФЛИКТОВ";
    }
  }
  function setFeedback(message) {
    const el = $("memory-feedback");
    if (el) el.textContent = message;
  }
  function renderDialog() {
    const feed = $("memory-feed");
    if (!feed) return;
    feed.textContent = "";
    const items = dialog.length ? dialog : [{
      role: "assistant",
      text: "Я — NEUROGENESIS, экспериментальный цифровой организм в браузере. У меня есть локальная память и система структурированных знаний. Пока я отвечаю по правилам и сохранённым сведениям, а не как полноценная языковая модель."
    }];
    for (const item of items.slice(-12)) {
      const bubble = document.createElement("div");
      bubble.className = "memory-message " + (item.role === "user" ? "from-user" : "from-brain");
      bubble.textContent = item.text;
      feed.appendChild(bubble);
    }
    feed.scrollTop = feed.scrollHeight;
  }
  function say(role, text, reasoning) {
    const entry={ role, text: String(text).slice(0, MAX_DIALOG_TEXT), time: Date.now() };
    const clean=cleanReasoning(reasoning);
    if(clean)entry.reasoning=clean;
    dialog.push(entry);
    dialog = dialog.slice(-MAX_DIALOG);
    if(clean)reasoningArchive=mergeReasoningArchive(reasoningArchive,[entry]);
    persist();
    renderDialog();
  }
  function ensureTrace(tag) {
    const brain = window.NGBrain;
    if (tagTrace[tag]) {
      const valid = brain && typeof brain.hasMemoryTrace === "function"
        ? brain.hasMemoryTrace(tagTrace[tag], tag)
        : !brain || typeof brain.hasNeuron !== "function" || brain.hasNeuron(tagTrace[tag]);
      if (valid) return tagTrace[tag];
      delete tagTrace[tag];
    }
    if (!brain || typeof brain.createMemoryTrace !== "function") return null;
    const id = brain.createMemoryTrace(tag);
    if (id) tagTrace[tag] = id;
    return id || null;
  }
  function ensureClaimTrace(claim) {
    if (!claim) return null;
    const brain = window.NGBrain;
    const key = "claim:" + (claim.id || normalise(claim.subject + " " + claim.predicate + " " + claim.object));
    if (claim.traceId) {
      const valid = brain && typeof brain.hasMemoryTrace === "function"
        ? brain.hasMemoryTrace(claim.traceId, key)
        : !brain || typeof brain.hasNeuron !== "function" || brain.hasNeuron(claim.traceId);
      if (valid) return claim.traceId;
    }
    if (!brain || typeof brain.createMemoryTrace !== "function") return null;
    const label = (claim.subject + " → " + claim.predicate).slice(0, 42);
    claim.traceId = brain.createMemoryTrace(key, label) || null;
    return claim.traceId;
  }
  function ensureClaimTraces(claims) {
    for (const claim of claims || []) ensureClaimTrace(claim);
  }
  function releaseUnusedTraces(candidateIds) {
    const used = new Set(memories.flatMap(item => [...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)]).filter(Boolean));
    const unused = [...new Set((candidateIds || []).filter(id => id && !used.has(id)))];
    const brain = window.NGBrain;
    if (unused.length && brain && typeof brain.removeMemoryTraces === "function") {
      brain.removeMemoryTraces(unused);
    }
    rebuildTagTraceIndex();
  }
  function linkMemory(item, related) {
    const ids = [...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)];
    for (const old of related || []) ids.push(...(old.traceIds || []), ...(old.claims || []).map(claim => claim.traceId));
    const unique = [...new Set(ids.filter(Boolean))];
    const brain = window.NGBrain;
    if (brain && typeof brain.associateMemoryTraces === "function") brain.associateMemoryTraces(unique);
    if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces([...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)]);
  }
  function rememberText(raw) {
    const previousClaims=memories.flatMap(item=>item.claims||[]);
    const previousClaimIds=new Set(previousClaims.map(claim=>claim.id).filter(Boolean));
    const clean = String(raw || "").trim().slice(0, MAX_TEXT);
    if (!clean) { setFeedback("Сначала напиши, что мне нужно запомнить."); return false; }
    const fullInquiryAnswer=clean.match(/^ответ на вопрос\s+#?\s*(q\d+)\s*:\s*([\s\S]+)$/iu);
    const fragments = fullInquiryAnswer ? [clean] : clean.split(/\n+|(?<=[.!?])\s+/u).map(x => x.trim()).filter(Boolean).slice(0, 8);
    let saved = 0, repeated = 0, skipped = 0;
    const inquiryResponseNotes=[];
    for (const fragment of fragments) {
      const answerMatch=fragment.match(/^ответ на вопрос\s+#?\s*(q\d+)\s*:\s*([\s\S]+)$/iu);
      const knowledgeText=answerMatch?answerMatch[2].trim():fragment;
      const compact = normalise(fragment);
      if (compact.length < 3) continue;
      const tags = [...new Set(tokens(fragment))].slice(0, 6);
      // An inquiry answer is contextual testimony. Do not turn quoted or discussed claims into facts.
      const claims = answerMatch ? [] : (KNOWLEDGE ? KNOWLEDGE.extractClaims(knowledgeText) : []);
      let item = memories.find(x => normalise(x.text) === compact);
      if (item) {
        item.strength = Math.min(1, (item.strength || 0.6) + 0.12);
        item.updatedAt = Date.now();
        item.repetitions = (item.repetitions || 1) + 1;
        for (const tag of tags) {
          if (item.tags.includes(tag) || item.tags.length >= 6) continue;
          item.tags.push(tag);
          item.traceIds.push(ensureTrace(tag));
        }
        if (KNOWLEDGE) item.claims = KNOWLEDGE.mergeClaims(item.claims, claims);
        ensureClaimTraces(item.claims);
        repeated++;
        const related = memories.filter(old => old.id !== item.id && old.tags.some(tag => tags.includes(tag))).slice(-4);
        linkMemory(item, related);
      } else {
        if (memories.length >= MAX_MEMORIES) { skipped++; continue; }
        const traceIds = tags.map(ensureTrace);
        const related = memories.filter(old => old.tags.some(tag => tags.includes(tag))).slice(-4);
        item = {
          id: makeId(), text: fragment.slice(0, MAX_TEXT), tags, traceIds,
          createdAt: Date.now(), updatedAt: Date.now(), strength: 0.65,
          repetitions: 1, recalls: 0,
          claims
        };
        ensureClaimTraces(item.claims);
        memories.push(item);
        saved++;
        linkMemory(item, related);
      }
      if(answerMatch) {
        const note=recordInquiryResponse(answerMatch[1].toUpperCase(),knowledgeText,item,claims);
        if(note)inquiryResponseNotes.push(note);
      }
    }
    rebuildTagTraceIndex();
    if (KNOWLEDGE && KNOWLEDGE.reconcileKnowledgeHistory) KNOWLEDGE.reconcileKnowledgeHistory(memories.flatMap(item=>item.claims||[]));
    const ok = persist();
    if (!saved && !repeated && skipped) {
      const response = "Память заполнена: лимит — " + MAX_MEMORIES + " записей. Я не стал молча удалять старые воспоминания. Открой «Записи», удали ненужное или сделай экспорт.";
      say("assistant", response);
      setFeedback("ЛИМИТ ДОСТИГНУТ · СТАРЫЕ ЗАПИСИ СОХРАНЕНЫ");
      return false;
    }
    if (!saved && !repeated) {
      say("assistant", "Не получилось выделить отдельный фрагмент для памяти. Попробуй сформулировать мысль полным предложением.");
      setFeedback("НЕТ СОХРАНЁННЫХ ФРАГМЕНТОВ");
      return false;
    }
    const freshClaims=memories.flatMap(item=>item.claims||[]).filter(claim=>claim.id&&!previousClaimIds.has(claim.id));
    const independentFreshClaims=freshClaims.filter(claim=>!isRepeatedEvidenceClaim(claim,previousClaims));
    const decisionEvidence=recordNewEvidenceForDecisions(independentFreshClaims,previousClaims);
    const revisionNote=reviewPriorConclusions(independentFreshClaims);
    let response = saved ? "Запомнил " + saved + (saved === 1 ? " новый фрагмент" : " новых фрагмента") : "Эта информация уже была в памяти";
    if (repeated) response += (saved ? "; повторно обработал " : ". Усилил след ") + repeated + (repeated === 1 ? " повтор" : " повтора");
    if (skipped) response += ". " + skipped + " новых фрагментов не поместились: лимит заполнен";
    response += ". Выделил темы и связал их с узлами памяти.";
    if(revisionNote)response+="\n\n"+revisionNote;
    const decisionEvidenceNote=formatNewModelEvidenceNote(decisionEvidence);
    if(decisionEvidenceNote)response+="\n\n"+decisionEvidenceNote;
    if(inquiryResponseNotes.length)response+="\n\n"+inquiryResponseNotes.join("\n\n");
    if (!ok) response += " Но локальное сохранение не подтвердилось.";
    say("assistant", response);
    renderLibrary();
    setFeedback("ПАМЯТЬ ОБНОВЛЕНА · " + memories.length + " / " + MAX_MEMORIES);
    return true;
  }
  function matchMemory(query, item) {
    const q = [...new Set(tokens(query))];
    const structuredText = KNOWLEDGE ? (item.claims || []).map(claim => KNOWLEDGE.claimSearchText(claim)).join(" ") : "";
    const words = [...new Set(tokens(item.text + " " + structuredText))];
    if (!q.length || !words.length) return {score:0,directHits:0,associativeHits:0};
    const similarity = KNOWLEDGE && typeof KNOWLEDGE.semanticMatch === "function"
      ? KNOWLEDGE.semanticMatch(q, words)
      : {weightedHits:q.filter(word=>words.includes(word)).length,directHits:q.filter(word=>words.includes(word)).length,associativeHits:0};
    const hits = similarity.weightedHits;
    const coverage = hits / q.length;
    const density = hits / Math.sqrt(q.length * words.length);
    const qNorm = normalise(query);
    const textNorm = normalise(item.text);
    const phrase = qNorm.length > 5 && textNorm.includes(qNorm) ? 0.34 : 0;
    const tagHits = q.filter(word => (item.tags || []).includes(word)).length;
    const tagBoost = tagHits / q.length * 0.08;
    const score = Math.min(1, coverage * 0.62 + density * 0.30 + phrase + tagBoost) *
      (0.75 + (item.strength || 0.6) * 0.25);
    return {score,directHits:similarity.directHits,associativeHits:similarity.associativeHits};
  }
  function scoreMemory(query, item) {
    return matchMemory(query, item).score;
  }
  function askMemory(raw) {
    const query = String(raw || "").trim();
    if (!query) { setFeedback("Напиши вопрос к моей памяти."); return; }
    const lower = normalise(query);
    const skippedInquiry=lower.match(/^пропусти вопрос (q\d+)$/u);
    if(skippedInquiry) { say("assistant",skipInquiry(skippedInquiry[1].toUpperCase()));setFeedback("ИССЛЕДОВАНИЕ · ВОПРОС ОБНОВЛЁН");return; }
    if(/^(?:найди пробелы в знаниях|исследуй пробелы в памяти|сформируй вопросы для проверки|обнови исследовательские вопросы)$/u.test(lower)) {
      say("assistant",researchGapsAnswer());setFeedback("САМОИССЛЕДОВАНИЕ · ПОИСК ПРОБЕЛОВ");return;
    }
    if(/^(?:задай мне вопрос|задай следующий вопрос|следующий исследовательский вопрос|какой вопрос ты хочешь мне задать|что тебе нужно уточнить)$/u.test(lower)) {
      const r=refreshInquiryQueue();say("assistant",presentInquiry(r.open[0]));setFeedback("ИССЛЕДОВАНИЕ · ВОПРОС ДЛЯ УТОЧНЕНИЯ");return;
    }
    if(/^(?:какие вопросы открыты|покажи исследовательские вопросы|что ты хочешь узнать|покажи очередь вопросов)$/u.test(lower)) {
      say("assistant",inquiryOverviewAnswer());setFeedback("ИССЛЕДОВАНИЕ · ОЧЕРЕДЬ ВОПРОСОВ");return;
    }
    if(/^(?:оцени ответы на вопросы|что изменилось после ответов|покажи оценку исследовательских ответов|проанализируй ответы на вопросы)$/u.test(lower)) {
      say("assistant",inquiryAssessmentReport());setFeedback("ИССЛЕДОВАНИЕ · ОЦЕНКА ОТВЕТОВ");return;
    }
    if (/^(привет|здравствуй|добрый день|доброе утро|добрый вечер)(?:\s|$)/u.test(lower)) {
      say("assistant", "Привет. Я на связи. Можешь рассказать мне факт для памяти или спросить о том, что я уже сохранил.");
      return;
    }
    const choiceAnswer=applyRevisionChoice(query);
    if(choiceAnswer) {
      say("assistant",choiceAnswer);
      setFeedback("РЕШЕНИЕ РАБОЧЕЙ МОДЕЛИ СОХРАНЕНО");
      return;
    }
    const restoreAnswer=restoreModelEdge(query);
    if(restoreAnswer) {
      say("assistant",restoreAnswer);
      setFeedback("СВЯЗЬ ВОЗВРАЩЕНА В РАБОЧУЮ МОДЕЛЬ");
      return;
    }
    if (/^(?:построй обновленную причинную модель|обнови причинную модель|как перестроить причинную модель|предложи пересмотр причинной модели|предложи варианты пересмотра|какие есть варианты пересмотра|что различит варианты модели|что изменить в причинной модели|покажи модель причинных связей)$/u.test(lower)) {
      say("assistant",buildCausalModelRevision());
      setFeedback("ПЕРЕСТРОЙКА ПРИЧИННОЙ МОДЕЛИ · ИСТОРИЯ СОХРАНЕНА");
      return;
    }
    if (/^(?:какие прежние выводы требуют пересмотра|покажи пересмотренные выводы|проверь свои прежние выводы|проверь прежние выводы|что изменилось в прежних выводах)$/u.test(lower)) {
      say("assistant",previousConclusionsAnswer());
      setFeedback("САМОПРОВЕРКА · ИСТОРИЯ ВЫВОДОВ");
      return;
    }
    if (/(сколько|покажи|список).*(помн|воспомин|запис)|^что ты помнишь(?:\s*\??)?$/u.test(lower)) {
      const recent = memories.slice(-5).reverse();
      const text = memories.length
        ? "Сейчас в долговременной памяти " + memories.length + " записей. Последние из них:\n" + recent.map((m, i) => (i + 1) + ". " + m.text).join("\n")
        : "Моя долговременная память пока пуста. Нажми «Запомнить», чтобы передать мне первый факт.";
      say("assistant", text);
      const ids = recent.flatMap(m => [...(m.traceIds || []), ...(m.claims || []).map(claim => claim.traceId)]);
      const brain = window.NGBrain;
      if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces(ids);
      return;
    }
    const sourceClaims = memories.flatMap(item => item.claims || []);
    const allClaims = claimsForWorkingModel(sourceClaims);
    const hypothesisPriority = KNOWLEDGE && typeof KNOWLEDGE.prioritizeHypotheses==="function" ? KNOWLEDGE.prioritizeHypotheses(query,allClaims) : null;
    const priorityClaimIds = new Set(hypothesisPriority && hypothesisPriority.claimIds || []);
    const derivedHypotheses = KNOWLEDGE && typeof KNOWLEDGE.deriveHypotheses==="function" ? KNOWLEDGE.deriveHypotheses(query,allClaims) : null;
    const derivedClaimIds = new Set(derivedHypotheses && derivedHypotheses.claimIds || []);
    const experimentPlan = KNOWLEDGE && typeof KNOWLEDGE.designDiscriminatingTest==="function" ? KNOWLEDGE.designDiscriminatingTest(query,allClaims) : null;
    const experimentClaimIds = new Set(experimentPlan && experimentPlan.claimIds || []);
    const hypothesisRecall = KNOWLEDGE && typeof KNOWLEDGE.evaluateConditionalHypothesis==="function" ? KNOWLEDGE.evaluateConditionalHypothesis(query,allClaims) : null;
    const hypothesisClaimIds = new Set(hypothesisRecall && hypothesisRecall.claimIds || []);
    const causalRecall = KNOWLEDGE && typeof KNOWLEDGE.causalEvidence==="function" ? KNOWLEDGE.causalEvidence(query,allClaims) : null;
    const causalClaimIds = new Set(causalRecall && causalRecall.claimIds || []);
    const structuredAnswer = KNOWLEDGE ? KNOWLEDGE.answerQuestion(query, allClaims) : null;
    if (structuredAnswer) {
      const isEntityProfileQuery = /^(?:что ты знаешь|что ты помнишь|что тебе известно|что известно|расскажи|кто такой|кто такая|кто такое)(?:\s|$)/u.test(lower);
      const isIdentityQuery = /^(?:кто ты|ты кто|кто вы|вы кто|что ты такое|что вы такое)$/u.test(lower);
      const isCausalQuery = !!(causalRecall && causalRecall.answer);
      const isHypothesisCheck = !!(hypothesisRecall && hypothesisRecall.answer);
      const isExperimentPlan = !!(experimentPlan && experimentPlan.answer);
      const isDerivedHypotheses = !!(derivedHypotheses && derivedHypotheses.answer);
      const isHypothesisPriority = !!(hypothesisPriority && hypothesisPriority.answer);
      const isUserProfileQuery = /^(?:что ты знаешь|что ты помнишь|что тебе известно|расскажи)(?:\s|$)/u.test(lower) && /\b(?:обо мне|о мне|про меня)\b/u.test(lower);
      const related = memories.map(item => ({ item, ...matchMemory(query,item) }))
        .filter(hit => hit.score > 0.08 ||
          (isIdentityQuery && (hit.item.claims || []).some(claim => claim.kind === "identity" && claim.subject === "assistant")) ||
          (isUserProfileQuery && (hit.item.claims || []).some(claim =>
            (claim.kind==="fact"&&claim.subject==="user") ||
            (claim.kind==="preference"&&claim.subject==="user") ||
            (claim.kind==="relationship"&&claim.object==="user") ||
            (claim.kind==="hypothesis"&&claim.subject==="user") ||
            claim.kind==="opinion")) ||
          (isCausalQuery && (hit.item.claims || []).some(claim=>causalClaimIds.has(claim.id))) ||
          (isHypothesisCheck && (hit.item.claims || []).some(claim=>hypothesisClaimIds.has(claim.id))) ||
          (isExperimentPlan && (hit.item.claims || []).some(claim=>experimentClaimIds.has(claim.id))) ||
          (isDerivedHypotheses && (hit.item.claims || []).some(claim=>derivedClaimIds.has(claim.id))))
        .sort((a, b) => b.score - a.score).slice(0, isHypothesisPriority ? 8 : isDerivedHypotheses ? 8 : isExperimentPlan ? 8 : isHypothesisCheck ? 8 : isCausalQuery ? 6 : isUserProfileQuery ? 12 : isEntityProfileQuery ? 6 : 3);
      const traceIds = [];
      for (const hit of related) {
        hit.item.recalls = (hit.item.recalls || 0) + 1;
        hit.item.strength = Math.min(1, (hit.item.strength || 0.6) + 0.015);
        traceIds.push(...(hit.item.traceIds || []), ...(hit.item.claims || []).map(claim => claim.traceId));
      }
      persist();
      const conclusionMeta=isHypothesisPriority?makeReasoningMeta("prioritized_hypotheses",hypothesisPriority,sourceClaims):
        isDerivedHypotheses?makeReasoningMeta("derived_hypotheses",derivedHypotheses,sourceClaims):
        isCausalQuery?makeReasoningMeta("causal_chain",causalRecall,sourceClaims):null;
      const modelNote=(isHypothesisPriority||isDerivedHypotheses||isExperimentPlan||isCausalQuery)?formatModelDecisionNote():"";
      const researchNote=(isHypothesisPriority||isDerivedHypotheses)?researchAwareHypothesisNote(isHypothesisPriority?hypothesisPriority:derivedHypotheses):"";
      const conclusionAnswer=researchNote+(researchNote?"\n\n":"")+structuredAnswer+modelNote+baselineReviewNote(conclusionMeta);
      say("assistant", conclusionAnswer, conclusionMeta);
      const brain = window.NGBrain;
      const activeTraceIds = [...new Set(traceIds)];
      if (brain && typeof brain.associateMemoryTraces === "function") brain.associateMemoryTraces(activeTraceIds);
      const activated = brain && typeof brain.activateMemoryTraces === "function"
        ? Number(brain.activateMemoryTraces(activeTraceIds) || 0) : 0;
      const associativeMatches = related.filter(hit=>hit.associativeHits>0).length;
      const causalLabel=isCausalQuery?(causalRecall.alternativeCount>1?"АЛЬТЕРНАТИВНЫЕ ОБЪЯСНЕНИЯ · ":causalRecall.conflicts&&causalRecall.conflicts.length?"ПРОТИВОРЕЧИЕ В ПРИЧИНАХ · ":"ПРИЧИННАЯ ЦЕПОЧКА · "):"";
      const reasoningLabel=isHypothesisCheck?(hypothesisRecall.counterexampleCount>0?"КОНТРПРИМЕР В ПАМЯТИ · ":"ПРОВЕРКА ГИПОТЕЗЫ · "):"";
      const experimentLabel=isExperimentPlan?(experimentPlan.alternativeCount>1?"ПЛАН СРАВНЕНИЯ ГИПОТЕЗ · ":"НЕДОСТАТОЧНО АЛЬТЕРНАТИВ · "):"";
      const derivedLabel=isDerivedHypotheses?"НОВЫЕ ГИПОТЕЗЫ · ":"";
      const priorityLabel=isHypothesisPriority?(hypothesisPriority.counterexampleCount>0?"ПРИОРИТЕТ · ЕСТЬ КОНТРПРИМЕР · ":"ПРИОРИТЕТ ПРОВЕРКИ · "):"";
      setFeedback((isHypothesisPriority ? priorityLabel : isDerivedHypotheses ? derivedLabel : isExperimentPlan ? experimentLabel : isHypothesisCheck ? reasoningLabel : isCausalQuery ? causalLabel : associativeMatches ? "АСОЦИАТИВНЫЙ ПОИСК · " : "") +
        (isEntityProfileQuery ? "ПРОФИЛЬ ПО ПАМЯТИ · " : "СТРУКТУРНЫЙ ПОИСК · ") +
        related.length + " ЗАПИСЕЙ · " + activated + " СЛЕДОВ АКТИВИРОВАНО");
      return;
    }
    const ranked = memories.map(item => ({ item, score: scoreMemory(query, item) }))
      .filter(hit => hit.score >= 0.19).sort((a, b) => b.score - a.score).slice(0, 4);
    if (!ranked.length) {
      say("assistant", "Я пока не нашёл в своей памяти достаточно близкой информации.\n\nЯ не буду выдумывать ответ. Расскажи мне об этом через «Запомнить», и я смогу использовать эти сведения в следующих вопросах.");
      setFeedback("ПОИСК ЗАВЕРШЁН · НАДЁЖНЫХ СОВПАДЕНИЙ НЕТ");
      return;
    }
    const ids = [];
    for (const hit of ranked) {
      hit.item.recalls = (hit.item.recalls || 0) + 1;
      hit.item.strength = Math.min(1, (hit.item.strength || 0.6) + 0.015);
      ids.push(...(hit.item.traceIds || []), ...(hit.item.claims || []).map(claim => claim.traceId));
    }
    persist();
    const answer = "Я нашёл " + ranked.length + (ranked.length === 1 ? " связанное воспоминание:" : " связанных воспоминания:") +
      "\n\n" + ranked.map((hit, i) => (i + 1) + ". " + hit.item.text).join("\n\n") +
      "\n\nЭто найденные записи, а не самостоятельно проверенные факты. Я пока умею извлекать и связывать сохранённые сведения, но ещё не обладаю полноценным языковым мышлением."+
      (currentModelDecisions().length?formatModelDecisionNote():"");
    say("assistant", answer);
    const brain = window.NGBrain;
    const activeTraceIds = [...new Set(ids)];
    if (brain && typeof brain.associateMemoryTraces === "function") brain.associateMemoryTraces(activeTraceIds);
    const activated = brain && typeof brain.activateMemoryTraces === "function"
      ? Number(brain.activateMemoryTraces(activeTraceIds) || 0) : 0;
    setFeedback("ПОИСК ЗАВЕРШЁН · НАЙДЕНО " + ranked.length + " · " + activated + " СЛЕДОВ АКТИВИРОВАНО");
  }

  function removeMemory(id) {
    const item = memories.find(entry => entry.id === id);
    if (!item) return;
    if (!window.confirm("Удалить эту запись из памяти? Её уникальные нейронные следы тоже будут удалены.")) return;
    memories = memories.filter(entry => entry.id !== id);
    if (KNOWLEDGE && KNOWLEDGE.reconcileKnowledgeHistory) KNOWLEDGE.reconcileKnowledgeHistory(memories.flatMap(entry=>entry.claims||[]));
    releaseUnusedTraces([...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)]);
    persist();
    renderLibrary();
    say("assistant", "Запись удалена. Общие нейронные следы сохранены, если на них ссылаются другие воспоминания.");
    setFeedback("ЗАПИСЬ УДАЛЕНА · " + memories.length + " ОСТАЛОСЬ");
  }
  function editMemory(id, text) {
    const item = memories.find(entry => entry.id === id);
    const value = String(text || "").trim().slice(0, MAX_TEXT);
    if (!item || !value) { setFeedback("Текст записи не может быть пустым."); return false; }
    if (memories.some(entry => entry.id !== id && normalise(entry.text) === normalise(value))) {
      setFeedback("Такая запись уже существует. Отредактируй её вместо создания повтора.");
      return false;
    }
    const oldIds = [...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)];
    const tags = [...new Set(tokens(value))].slice(0, 6);
    const claims = KNOWLEDGE ? KNOWLEDGE.extractClaims(value) : [];
    item.text = value;
    item.claims = claims;
    ensureClaimTraces(item.claims);
    item.tags = tags;
    item.traceIds = tags.map(ensureTrace);
    item.updatedAt = Date.now();
    if (KNOWLEDGE && KNOWLEDGE.reconcileKnowledgeHistory) KNOWLEDGE.reconcileKnowledgeHistory(memories.flatMap(entry=>entry.claims||[]));
    const related = memories.filter(entry => entry.id !== id && entry.tags.some(tag => tags.includes(tag))).slice(-4);
    linkMemory(item, related);
    releaseUnusedTraces(oldIds);
    persist();
    renderLibrary();
    say("assistant", "Запись исправлена. Я обновил её темы и связи в нейронной сети.");
    setFeedback("ИЗМЕНЕНИЯ СОХРАНЕНЫ");
    return true;
  }
  function clearMemory() {
    if (!memories.length && !modelDecisions.length) { setFeedback("Память уже пуста."); return; }
    if (!window.confirm("Удалить все " + memories.length + " записей, решения рабочей модели и их уникальные нейронные следы? История диалога останется.")) return;
    const oldIds = memories.flatMap(item => [...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)]);
    memories = [];
    modelDecisions = [];
    modelEvidence = [];
    inquiries = [];
    nextInquiryNumber = 1;
    releaseUnusedTraces(oldIds);
    persist();
    renderLibrary();
    say("assistant", "Долговременная память очищена. История этого диалога сохранена.");
    setFeedback("ПАМЯТЬ ОЧИЩЕНА");
  }
  function formatDate(time) {
    try { return new Date(time).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
    catch (_) { return ""; }
  }
  function button(label, action, className) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.dataset.action = action;
    el.className = className || "secondary-button";
    return el;
  }
  function renderClaimPreview(text) {
    const preview = $("memory-editor-preview");
    if (!preview) return;
    preview.textContent = "";
    const claims = KNOWLEDGE ? KNOWLEDGE.extractClaims(text) : [];
    if (!claims.length) {
      const empty = document.createElement("div");
      empty.className = "memory-preview-empty";
      empty.textContent = "Пока не удалось выделить структурированное утверждение. Сам текст всё равно можно сохранить.";
      preview.appendChild(empty);
      return;
    }
    for (const claim of claims) {
      const row = document.createElement("div");
      row.className = "memory-preview-claim";
      const kind = document.createElement("span");
      kind.className = "memory-claim-kind";
      kind.textContent = ({relationship:"СВЯЗЬ",causal:"ПРИЧИНА",identity:"РОЛЬ",opinion:"МНЕНИЕ",preference:"ПРЕДПОЧТЕНИЕ",fact:"САМООПИСАНИЕ",definition:"ОПРЕДЕЛЕНИЕ",hypothesis:"ГИПОТЕЗА"})[claim.kind] || "ЗАПИСЬ";
      const label = document.createElement("span");
      label.textContent = KNOWLEDGE.claimLabel(claim);
      row.append(kind, label);
      preview.appendChild(row);
    }
  }
  function renderMemoryEditor() {
    const item = memories.find(entry => entry.id === editingMemoryId);
    const view = $("memory-editor-view");
    if (!view || !item) {
      editingMemoryId = null;
      return;
    }
    const input = $("memory-editor-input");
    const meta = $("memory-editor-meta");
    if (input && input.dataset.memoryId !== item.id) {
      input.value = item.text;
      input.dataset.memoryId = item.id;
    }
    if (meta) meta.textContent = formatDate(item.createdAt) + " · повторений: " + item.repetitions + " · извлечений: " + item.recalls;
    renderClaimPreview(input ? input.value : item.text);
    const save = $("memory-editor-save");
    if (save) save.disabled = !(input && input.value.trim());
  }
  function renderLibrary() {
    const panel = $("memory-library");
    const list = $("memory-library-list");
    if (!panel || !list) return;
    const toolbar = $("memory-library-toolbar");
    const editor = $("memory-editor-view");
    const more = $("memory-more");
    panel.hidden = !libraryOpen;
    if (!libraryOpen) {
      if (editor) editor.hidden = true;
      if (toolbar) toolbar.hidden = false;
      list.hidden = false;
      if (more) more.hidden = true;
      updateCount();
      return;
    }
    if (editingMemoryId) {
      if (toolbar) toolbar.hidden = true;
      list.hidden = true;
      if (more) more.hidden = true;
      if (editor) editor.hidden = false;
      renderMemoryEditor();
      updateCount();
      return;
    }
    if (toolbar) toolbar.hidden = false;
    list.hidden = false;
    if (editor) editor.hidden = true;
    const previousScrollTop = list.scrollTop || libraryListScrollTop;
    const query = normalise(libraryFilter);
    const filtered = memories.filter(item => !query || normalise(item.text + " " + item.tags.join(" ") + " " + (item.claims || []).map(claim => KNOWLEDGE ? KNOWLEDGE.claimSearchText(claim) : "").join(" ")).includes(query));
    const visible = filtered.slice().reverse().slice(0, libraryLimit);
    list.textContent = "";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "memory-library-empty";
      empty.textContent = memories.length ? "По этому запросу ничего не найдено." : "Память пока пуста. Сохрани первый факт выше.";
      list.appendChild(empty);
    }
    const conflictIds = KNOWLEDGE
      ? new Set(KNOWLEDGE.findConflicts(memories.flatMap(entry => entry.claims || [])).flatMap(conflict => [conflict.left.id, conflict.right.id]))
      : new Set();
    for (const item of visible) {
      const card = document.createElement("article");
      card.className = "memory-entry";
      card.dataset.memoryId = item.id;
      const meta = document.createElement("div");
      meta.className = "memory-entry-meta";
      meta.textContent = formatDate(item.createdAt) + " · повторений: " + item.repetitions + " · извлечений: " + item.recalls;
      const text = document.createElement("div");
      text.className = "memory-entry-text";
      text.textContent = item.text;
      if (KNOWLEDGE && item.claims && item.claims.length) {
        const structured = document.createElement("div");
        structured.className = "memory-entry-claims";
        for (const claim of item.claims) {
          const line = document.createElement("div");
          line.className = "memory-entry-claim";
          const kind = document.createElement("span");
          kind.className = "memory-claim-kind";
          kind.textContent = ({relationship:"СВЯЗЬ",causal:"ПРИЧИНА",identity:"РОЛЬ",opinion:"МНЕНИЕ",preference:"ПРЕДПОЧТЕНИЕ",fact:"САМООПИСАНИЕ",definition:"ОПРЕДЕЛЕНИЕ",hypothesis:"ГИПОТЕЗА"})[claim.kind] || "ЗАПИСЬ";
          const label = document.createElement("span");
          label.textContent = KNOWLEDGE.claimLabel(claim);
          const source = document.createElement("small");
          source.textContent = claim.verification === "subjective" ? "Субъективная оценка" : claim.verification === "self_reported" ? "Самоописание · источник: сообщение пользователя" : claim.verification === "hypothesis" ? "Предположение" : "Источник: сообщение пользователя · не проверено";
          if (claim.status==="superseded" && claim.kind==="identity") source.textContent = "Прежняя роль · сохранена в истории";
          else if (claim.status==="superseded") source.textContent = "Историческое сведение · позже уточнено";
          else if (claim.revision && claim.kind==="identity") source.textContent = "Текущая роль · установлена последним уточнением";
          else if (claim.revision) source.textContent = "Текущее сведение · установлено последним уточнением";
          if (conflictIds.has(claim.id)) source.textContent += " · возможное противоречие";
          line.append(kind, label, source);
          structured.appendChild(line);
        }
        card.append(meta, text, structured);
      } else {
        card.append(meta, text);
      }
      const tags = document.createElement("div");
      tags.className = "memory-entry-tags";
      for (const tag of item.tags) {
        const chip = document.createElement("span");
        chip.className = "memory-tag";
        chip.textContent = tag;
        tags.appendChild(chip);
      }
      const actions = document.createElement("div");
      actions.className = "memory-entry-actions";
      actions.append(button("Открыть", "edit", "secondary-button memory-mini-button"), button("Забыть", "delete", "secondary-button memory-mini-button memory-delete-button"));
      card.append(tags, actions);
      list.appendChild(card);
    }
    list.scrollTop = previousScrollTop;
    libraryListScrollTop = list.scrollTop;
    if (more) {
      more.hidden = filtered.length <= visible.length;
      more.textContent = "Показать ещё (" + Math.max(0, filtered.length - visible.length) + ")";
    }
    const back = $("memory-library-back");
    if (back) back.textContent = "← Назад к диалогу";
    updateCount();
  }
  function openMemoryEditor(id) {
    const item = memories.find(entry => entry.id === id);
    if (!item) return;
    const list = $("memory-library-list");
    libraryListScrollTop = list ? list.scrollTop : libraryListScrollTop;
    editingMemoryId = id;
    try {
      const state = window.history && window.history.state;
      if (!state || state.__ngMemoryView !== "editor") {
        window.history && window.history.pushState({ __ngMemoryView: "editor", id }, "", "#ng-memory-entry");
      }
    } catch (_) {}
    renderLibrary();
    const input = $("memory-editor-input");
    if (input) input.focus();
  }
  function restoreLibraryOrigin() {
    const side = document.querySelector(".side-panel");
    if (side) side.scrollTop = libraryReturnScrollTop;
    const manage = $("memory-manage");
    if (manage) manage.focus();
  }
  function closeMemoryLibrary() {
    if (editingMemoryId) {
      const item = memories.find(entry => entry.id === editingMemoryId);
      const input = $("memory-editor-input");
      if (item && input && input.value.trim() !== item.text &&
          !window.confirm("Есть несохранённые изменения. Закрыть библиотеку и отказаться от них?")) return;
    }
    try {
      const state = window.history && window.history.state;
      if (state && state.__ngMemoryView === "editor") {
        window.history.go(-2);
        return;
      }
      if (state && state.__ngMemoryView === "library") {
        window.history.back();
        return;
      }
    } catch (_) {}
    libraryOpen = false;
    editingMemoryId = null;
    renderLibrary();
    restoreLibraryOrigin();
  }
  function backToMemoryList(force = false) {
    const input = $("memory-editor-input");
    const item = memories.find(entry => entry.id === editingMemoryId);
    if (!force && item && input && input.value.trim() !== item.text &&
        !window.confirm("Есть несохранённые изменения. Вернуться к списку без сохранения?")) return;
    try {
      const state = window.history && window.history.state;
      if (state && state.__ngMemoryView === "editor") {
        allowDiscardOnMemoryBack = true;
        window.history.back();
        return;
      }
    } catch (_) {}
    editingMemoryId = null;
    renderLibrary();
    const list = $("memory-library-list");
    if (list) list.scrollTop = libraryListScrollTop;
  }
  function saveMemoryEditor() {
    if (!editingMemoryId) return;
    const input = $("memory-editor-input");
    if (!input || !input.value.trim()) {
      const feedback = $("memory-editor-feedback");
      if (feedback) feedback.textContent = "Текст записи не может быть пустым.";
      return;
    }
    if (!editMemory(editingMemoryId, input.value)) {
      const feedback = $("memory-editor-feedback");
      if (feedback) feedback.textContent = $("memory-feedback")?.textContent || "Не удалось сохранить запись.";
      return;
    }
    const feedback = $("memory-editor-feedback");
    if (feedback) feedback.textContent = "Сохранено. Возвращаю к списку записей…";
    backToMemoryList(true);
  }
  function handleLibraryClick(event) {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const card = control.closest(".memory-entry");
    if (!card) return;
    const id = card.dataset.memoryId;
    const action = control.dataset.action;
    if (action === "delete") removeMemory(id);
    if (action === "edit") openMemoryEditor(id);
  }

  function exportBackup() {
    try {
      const backup = {
        format: "NEUROGENESIS_MEMORY_BACKUP",
        version: 2,
        knowledgeModel: KNOWLEDGE ? KNOWLEDGE.version : 0,
        exportedAt: new Date().toISOString(),
        memories,
        dialog,
        modelDecisions,
        modelEvidence,
        reasoningArchive,
        inquiries
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "neurogenesis-memory-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setFeedback("РЕЗЕРВНАЯ КОПИЯ ПОДГОТОВЛЕНА · " + memories.length + " ЗАПИСЕЙ");
    } catch (error) {
      console.error("NEUROGENESIS export failed:", error);
      setFeedback("Экспорт не удался. Браузер не разрешил создать файл.");
    }
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data && data.format && data.format !== "NEUROGENESIS_MEMORY_BACKUP") throw new Error("Это не резервная копия NEUROGENESIS.");
      if (data && Number(data.version) > 2) throw new Error("Версия резервной копии новее поддерживаемой.");
      const incoming = Array.isArray(data) ? data : data && data.memories;
      if (!Array.isArray(incoming)) throw new Error("Файл не содержит список воспоминаний.");
      let imported = 0, duplicates = 0, skipped = 0;
      for (const raw of incoming) {
        const candidate = cleanMemory(raw);
        if (!candidate) { skipped++; continue; }
        const duplicate = memories.find(item => normalise(item.text) === normalise(candidate.text));
        if (duplicate) {
          duplicate.strength = Math.min(1, Math.max(duplicate.strength, candidate.strength));
          duplicate.repetitions += candidate.repetitions;
          duplicate.updatedAt = Date.now();
          if (KNOWLEDGE) duplicate.claims = KNOWLEDGE.mergeClaims(duplicate.claims, candidate.claims);
          ensureClaimTraces(duplicate.claims);
          for (const tag of candidate.tags) {
            if (duplicate.tags.includes(tag) || duplicate.tags.length >= 6) continue;
            duplicate.tags.push(tag);
            duplicate.traceIds.push(ensureTrace(tag));
          }
          const related = memories.filter(old => old.id !== duplicate.id && old.tags.some(tag => candidate.tags.includes(tag))).slice(-4);
          linkMemory(duplicate, related);
          duplicates++;
          continue;
        }
        if (memories.length >= MAX_MEMORIES) { skipped++; continue; }
        candidate.id = makeId();
        candidate.tags = [...new Set(tokens(candidate.text))].slice(0, 6);
        candidate.claims = KNOWLEDGE ? (candidate.claims.length ? candidate.claims : KNOWLEDGE.extractClaims(candidate.text)) : [];
        candidate.traceIds = candidate.tags.map(ensureTrace);
        ensureClaimTraces(candidate.claims);
        candidate.createdAt = safeTime(candidate.createdAt, Date.now());
        candidate.updatedAt = Date.now();
        const related = memories.filter(old => old.tags.some(tag => candidate.tags.includes(tag))).slice(-4);
        memories.push(candidate);
        linkMemory(candidate, related);
        imported++;
      }
      if (Array.isArray(data.dialog)) {
        const restored = data.dialog.filter(item => item && typeof item.text === "string")
          .map(item => ({ role: item.role === "user" ? "user" : "assistant", text: item.text.slice(0, MAX_DIALOG_TEXT), time: safeTime(item.time, Date.now()), reasoning: cleanReasoning(item.reasoning) }));
        dialog = [...dialog, ...restored].sort((a, b) => a.time - b.time).slice(-MAX_DIALOG);
      }
      if(Array.isArray(data.modelDecisions))modelDecisions=mergeModelDecisionHistory(modelDecisions,data.modelDecisions);
      if(Array.isArray(data.modelEvidence))modelEvidence=mergeModelEvidenceHistory(modelEvidence,data.modelEvidence);
      reasoningArchive=mergeReasoningArchive(reasoningArchive,
        [...(Array.isArray(data.reasoningArchive)?data.reasoningArchive:[]),...(Array.isArray(data.dialog)?data.dialog:[])]);
      if(Array.isArray(data.inquiries))inquiries=mergeInquiryHistory(inquiries,data.inquiries);
      reconcileInquiryResponsesFromEntries(data.dialog);
      assessAnsweredInquiries();
      rebuildTagTraceIndex();
      if (KNOWLEDGE && KNOWLEDGE.reconcileKnowledgeHistory) KNOWLEDGE.reconcileKnowledgeHistory(memories.flatMap(entry=>entry.claims||[]));
      const ok = persist();
      renderLibrary();
      renderDialog();
      say("assistant", "Импорт завершён. Добавлено: " + imported + ", уже были: " + duplicates + ", пропущено: " + skipped + (ok ? "." : ". Локальное сохранение не подтвердилось."));
      setFeedback("ИМПОРТ · +" + imported + " · ПОВТОРОВ " + duplicates + " · ПРОПУЩЕНО " + skipped);
    } catch (error) {
      console.warn("NEUROGENESIS import failed:", error);
      setFeedback("Не удалось импортировать файл: " + String(error.message || error).slice(0, 100));
    }
  }

  function submit(action) {
    const input = $("memory-input");
    const value = input ? input.value.trim() : "";
    if (!value) { setFeedback("Сначала введи текст."); return; }
    say("user", value);
    if (action === "remember") rememberText(value);
    else askMemory(value);
    input.value = "";
    input.focus();
  }

  const rememberButton = $("remember-button");
  const askButton = $("ask-button");
  const memoryInput = $("memory-input");
  if (rememberButton) rememberButton.addEventListener("click", () => submit("remember"));
  if (askButton) askButton.addEventListener("click", () => submit("ask"));
  if (memoryInput) memoryInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit("ask");
    }
  });
  function openMemoryLibrary() {
    const side = document.querySelector(".side-panel");
    libraryReturnScrollTop = side ? side.scrollTop : 0;
    libraryOpen = true;
    editingMemoryId = null;
    libraryLimit = 20;
    try {
      const state = window.history && window.history.state;
      if (!state || state.__ngMemoryView !== "library") {
        window.history && window.history.pushState({ __ngMemoryView: "library" }, "", "#ng-memory");
      }
    } catch (_) {}
    renderLibrary();
  }
  const manageButton = $("memory-manage");
  if (manageButton) manageButton.addEventListener("click", () => {
    if (libraryOpen) closeMemoryLibrary();
    else openMemoryLibrary();
  });
  const libraryBackButton = $("memory-library-back");
  if (libraryBackButton) libraryBackButton.addEventListener("click", closeMemoryLibrary);
  const editorBackButton = $("memory-editor-back");
  if (editorBackButton) editorBackButton.addEventListener("click", () => backToMemoryList(false));
  const editorCancelButton = $("memory-editor-cancel");
  if (editorCancelButton) editorCancelButton.addEventListener("click", () => backToMemoryList(false));
  const editorSaveButton = $("memory-editor-save");
  if (editorSaveButton) editorSaveButton.addEventListener("click", saveMemoryEditor);
  const editorInput = $("memory-editor-input");
  if (editorInput) editorInput.addEventListener("input", () => {
    renderClaimPreview(editorInput.value);
    const save = $("memory-editor-save");
    if (save) save.disabled = !editorInput.value.trim();
    const feedback = $("memory-editor-feedback");
    if (feedback) feedback.textContent = "Есть несохранённые изменения";
  });
  if (typeof window.addEventListener === "function") {
    window.addEventListener("popstate", event => {
      const state = event.state;
      if (state && state.__ngMemoryView === "library" && editingMemoryId && !allowDiscardOnMemoryBack) {
        const item = memories.find(entry => entry.id === editingMemoryId);
        const input = $("memory-editor-input");
        if (item && input && input.value.trim() !== item.text &&
            !window.confirm("Есть несохранённые изменения. Вернуться к списку без сохранения?")) {
          window.history && window.history.pushState({ __ngMemoryView: "editor", id: editingMemoryId }, "", "#ng-memory-entry");
          return;
        }
      }
      allowDiscardOnMemoryBack = false;
      if (state && state.__ngMemoryView === "editor") {
        libraryOpen = true;
        editingMemoryId = state.id;
        renderLibrary();
        return;
      }
      if (state && state.__ngMemoryView === "library") {
        libraryOpen = true;
        editingMemoryId = null;
        const input = $("memory-editor-input");
        if (input) input.dataset.memoryId = "";
        renderLibrary();
        const list = $("memory-library-list");
        if (list) list.scrollTop = libraryListScrollTop;
        return;
      }
      const wasOpen = libraryOpen;
      libraryOpen = false;
      editingMemoryId = null;
      const input = $("memory-editor-input");
      if (input) input.dataset.memoryId = "";
      renderLibrary();
      if (wasOpen) restoreLibraryOrigin();
    });
    window.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !libraryOpen) return;
      event.preventDefault();
      if (editingMemoryId) backToMemoryList(false);
      else closeMemoryLibrary();
    });
  }
  const filterInput = $("memory-filter");
  if (filterInput) filterInput.addEventListener("input", event => {
    libraryFilter = event.target.value;
    libraryLimit = 20;
    libraryListScrollTop = 0;
    const list = $("memory-library-list");
    if (list) list.scrollTop = 0;
    renderLibrary();
  });
  const moreButton = $("memory-more");
  if (moreButton) moreButton.addEventListener("click", () => { libraryLimit += 20; renderLibrary(); });
  const libraryList = $("memory-library-list");
  if (libraryList) libraryList.addEventListener("click", handleLibraryClick);
  const exportButton = $("memory-export");
  if (exportButton) exportButton.addEventListener("click", exportBackup);
  const importButton = $("memory-import");
  const importInput = $("memory-import-file");
  if (importButton && importInput) importButton.addEventListener("click", () => importInput.click());
  if (importInput) importInput.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    if (file) await importBackup(file);
    importInput.value = "";
  });
  const clearButton = $("memory-clear");
  if (clearButton) clearButton.addEventListener("click", clearMemory);

  load();
  updateCount();
  renderDialog();
  renderLibrary();
  setFeedback("ЛОКАЛЬНАЯ ПАМЯТЬ · ДАННЫЕ ОСТАЮТСЯ В ЭТОМ БРАУЗЕРЕ");
  window.NGMemory = {
    count: () => memories.length,
    search: query => memories.map(item => ({ text: item.text, claims: item.claims || [], score: scoreMemory(query, item) }))
      .sort((a, b) => b.score - a.score).slice(0, 5),
    ask: query => askMemory(query),
    claims: () => memories.flatMap(item => item.claims || []),
    modelDecisions: () => currentModelDecisions(),
    modelEvidence: () => modelEvidence.slice(),
    reasoningHistory: () => reasoningArchive.map(item=>({time:item.time,type:item.reasoning.type,conclusions:item.reasoning.conclusions,status:item.reasoning.status})),
    inquiries: () => inquiries.map(item=>({...item,sourceClaimIds:item.sourceClaimIds.slice(),responseClaimIds:item.responseClaimIds.slice()})),
    refreshInquiries: () => { const r=refreshInquiryQueue(); return {added:r.added,open:r.open.length,answered:r.answered.length}; },
    summary: () => KNOWLEDGE ? KNOWLEDGE.summary(memories.flatMap(item => item.claims || [])) : {total:0}

  };
})();