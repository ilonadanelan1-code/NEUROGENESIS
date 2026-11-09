(() => {
  "use strict";

  const MEMORY_KEY = "neurogenesis.memories.v1";
  const DIALOG_KEY = "neurogenesis.dialog.v1";
  const MODEL_DECISIONS_KEY = "neurogenesis.model-decisions.v1";
  const MODEL_EVIDENCE_KEY = "neurogenesis.model-evidence.v1";
  const REASONING_ARCHIVE_KEY = "neurogenesis.reasoning-archive.v1";
  const INQUIRIES_KEY = "neurogenesis.inquiries.v1";
  const COGNITIVE_CYCLES_KEY = "neurogenesis.cognitive-cycles.v1";
  const MAX_COGNITIVE_CYCLES = 80;
  const MAX_MODEL_DECISIONS = 32;
  const MAX_MODEL_EVIDENCE = 64;
  const MAX_REASONING_ARCHIVE = 128;
  const MAX_INQUIRIES = 48;
  const MAX_MEMORIES = 500;
  const MAX_DIALOG = 24;
  const MAX_DIALOG_TEXT = 4200;
  const MAX_TEXT = 1200;
  const KNOWLEDGE = window.NGKnowledge || null;
  const KNOWLEDGE_GRAPH = window.NGKnowledgeGraph || null;
  const REASONING_AUDIT = window.NGReasoningAudit || null;
  const DISCRIMINATING_OBSERVATIONS = window.NGDiscriminatingObservations || null;
  const HYPOTHESIS_LIFECYCLE = window.NGHypothesisLifecycle || null;
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
  let cognitiveCycles = [];
  let nextCognitiveCycleNumber = 1;
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
    const id=typeof raw.id==="string"&&raw.id?raw.id.slice(0,80):makeId();
    const linkedClaims=claims.map(claim=>claim.kind==="observation"?{...claim,sourceMemoryId:id}:claim);
    return {
      id,
      text, tags: tags.length ? tags : tokens(text).slice(0, 6), traceIds,
      claims:linkedClaims,
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
  function isValidArchivedCausalEdge(edge) {
    if(!edge||typeof edge.subject!=="string"||typeof edge.object!=="string"||!edge.subject.trim()||!edge.object.trim())return false;
    if(KNOWLEDGE&&typeof KNOWLEDGE.sanitizeClaims==="function") {
      return KNOWLEDGE.sanitizeClaims([{kind:"causal",subject:edge.subject,predicate:"приводит к",
        object:edge.object,evidence:""}]).length===1;
    }
    return !/^(?:что|то\s+что)\s+/iu.test(edge.subject.trim())&&
      !/(?:^|\s)(?:утверждение|сообщение|формулировка|цитата)\s+(?:о\s+том,\s*)?что(?:\s|$)/iu.test(edge.subject.trim());
  }
  function cleanReasoning(raw) {
    if (!raw || typeof raw !== "object" || raw.version !== 1 ||
        !["causal_chain","derived_hypotheses","prioritized_hypotheses"].includes(raw.type) ||
        !Array.isArray(raw.conclusions)) return null;
    const createdAt=safeTime(raw.createdAt,Date.now());
    const excludedPaths=Array.isArray(raw.excludedPaths)?raw.excludedPaths.slice(-24).map(item=>{
      if(!item||typeof item.subject!=="string"||typeof item.object!=="string")return null;
      return {origin:["conclusion","snapshot_edge","snapshot_alternative"].includes(item.origin)?item.origin:"conclusion",
        subject:item.subject.slice(0,180),object:item.object.slice(0,180),
        route:Array.isArray(item.route)?item.route.slice(0,3).map(edge=>({
          subject:typeof edge.subject==="string"?edge.subject.slice(0,180):"",
          object:typeof edge.object==="string"?edge.object.slice(0,180):""
        })).filter(edge=>edge.subject&&edge.object):[],
        reason:"malformed_causal_subject"};
    }).filter(Boolean):[];
    const excludedKeys=new Set(excludedPaths.map(item=>JSON.stringify(item)));
    const recordExcludedPath=(origin,subject,object,path)=>{
      const row={origin,subject:String(subject||"").slice(0,180),object:String(object||"").slice(0,180),
        route:(Array.isArray(path)?path:[]).slice(0,3).map(edge=>({
          subject:String(edge&&edge.subject||"").slice(0,180),object:String(edge&&edge.object||"").slice(0,180)
        })).filter(edge=>edge.subject&&edge.object),reason:"malformed_causal_subject"};
      const key=JSON.stringify(row);
      if(row.subject&&row.object&&!excludedKeys.has(key)){excludedKeys.add(key);excludedPaths.push(row);}
    };
    const conclusions=raw.conclusions.slice(0,8).map(item=>{
      if(!item||typeof item.subject!=="string"||typeof item.object!=="string")return null;
      const paths=Array.isArray(item.paths)?item.paths.slice(0,3).map(path=>{
        if(!Array.isArray(path)||!path.length)return null;
        const candidate=path.slice(0,3);
        if(candidate.some(edge=>!isValidArchivedCausalEdge(edge))) {
          recordExcludedPath("conclusion",item.subject,item.object,candidate);
          return null;
        }
        return candidate.map(edge=>({id:typeof edge.id==="string"?edge.id.slice(0,100):null,
          subject:edge.subject.slice(0,180),object:edge.object.slice(0,180)}));
      }).filter(path=>path&&path.length):[];
      const lifecycle=HYPOTHESIS_LIFECYCLE&&typeof HYPOTHESIS_LIFECYCLE.create==="function"
        ?HYPOTHESIS_LIFECYCLE.create(KNOWLEDGE).sanitize(item.lifecycle):null;
      return paths.length?{subject:item.subject.slice(0,180),object:item.object.slice(0,180),paths,lifecycle}:null;
    }).filter(Boolean);
    if(!conclusions.length&&!excludedPaths.length)return null;
    const reviews=Array.isArray(raw.reviews)?mergeSimilarReasoningReviews(raw.reviews.slice(-48).map(item=>{
      if(!item||typeof item.claimId!=="string")return null;
      const at=safeTime(item.at,Date.now());
      return {
        claimId:item.claimId.slice(0,100),
        relatedClaimIds:Array.isArray(item.relatedClaimIds)?[...new Set(item.relatedClaimIds.filter(id=>typeof id==="string").slice(0,12))]:[],
        kind:["counterexample","opposing_claim","supporting_observation","supporting_claim","source_revised"].includes(item.kind)?item.kind:"counterexample",
        phase:["baseline","subsequent"].includes(item.phase)?item.phase:(at<=createdAt?"baseline":"subsequent"),
        subject:typeof item.subject==="string"?item.subject.slice(0,180):"",
        object:typeof item.object==="string"?item.object.slice(0,180):"",
        evidence:typeof item.evidence==="string"?item.evidence.slice(0,240):"",
        eventRef:typeof item.eventRef==="string"?item.eventRef.slice(0,100):"",
        edgeSubject:typeof item.edgeSubject==="string"?item.edgeSubject.slice(0,180):"",
        edgeObject:typeof item.edgeObject==="string"?item.edgeObject.slice(0,180):"",
        at
      };
    }).filter(Boolean)):[];
    const status=["current","updated","challenged","revised"].includes(raw.status)?raw.status:"current";
    const modelHistory=Array.isArray(raw.modelHistory)?raw.modelHistory.slice(-8).map(snapshot=>{
      if(!snapshot||typeof snapshot!=="object")return null;
      const edges=Array.isArray(snapshot.edges)?snapshot.edges.slice(0,12).map(edge=>{
        if(!edge||typeof edge.subject!=="string"||typeof edge.object!=="string")return null;
        if(!isValidArchivedCausalEdge(edge)) {
          recordExcludedPath("snapshot_edge",edge.subject,edge.object,[edge]);
          return null;
        }
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
        const paths=Array.isArray(item.paths)?item.paths.slice(0,3).map(path=>{
          if(!Array.isArray(path)||!path.length)return null;
          const candidate=path.slice(0,3);
          if(candidate.some(edge=>!isValidArchivedCausalEdge(edge))) {
            recordExcludedPath("snapshot_alternative",item.subject,item.object,candidate);
            return null;
          }
          return candidate.map(edge=>({subject:edge.subject.slice(0,180),object:edge.object.slice(0,180)}));
        }).filter(path=>path&&path.length):[];
        return {subject:item.subject.slice(0,180),object:item.object.slice(0,180),paths};
      }).filter(Boolean):[];
      return {at:safeTime(snapshot.at,Date.now()),signature:typeof snapshot.signature==="string"?snapshot.signature.slice(0,600):"",edges,alternatives};
    }).filter(Boolean):[];
    return {version:1,type:raw.type,createdAt,status,conclusions,reviews,modelHistory,excludedPaths:excludedPaths.slice(-24)};
  }
  function reconcileHypothesisMeta(raw,now=Date.now()) {
    const meta=cleanReasoning(raw);
    if(!meta||!HYPOTHESIS_LIFECYCLE||!KNOWLEDGE||typeof HYPOTHESIS_LIFECYCLE.create!=="function")return meta;
    try {
      const result=HYPOTHESIS_LIFECYCLE.create(KNOWLEDGE).reconcile(meta,
        memories.flatMap(item=>item.claims||[]),modelDecisions,inquiries,now);
      return cleanReasoning(result.meta)||meta;
    } catch(error) {
      console.warn("NEUROGENESIS hypothesis lifecycle reconciliation failed:",error);
      return meta;
    }
  }
  function refreshHypothesisLifecycleArchive(now=Date.now()) {
    if(!HYPOTHESIS_LIFECYCLE)return false;
    let changed=false;
    for(const entry of reasoningArchive) {
      const previous=JSON.stringify(entry.reasoning);
      const updated=reconcileHypothesisMeta(entry.reasoning,now);
      if(updated&&JSON.stringify(updated)!==previous) {
        entry.reasoning=updated;
        syncArchivedReasoning(entry);
        changed=true;
      }
    }
    return changed;
  }
  function hypothesisLifecycleRows() {
    if(refreshHypothesisLifecycleArchive())persist();
    return reasoningArchive.flatMap(entry=>(entry.reasoning&&entry.reasoning.conclusions||[])
      .map(conclusion=>conclusion.lifecycle).filter(Boolean))
      .map(item=>HYPOTHESIS_LIFECYCLE&&HYPOTHESIS_LIFECYCLE.create
        ?HYPOTHESIS_LIFECYCLE.create(KNOWLEDGE).sanitize(item):item)
      .filter(Boolean);
  }
  function hypothesisLifecycleAnswer() {
    const rows=hypothesisLifecycleRows().sort((a,b)=>b.updatedAt-a.updatedAt);
    if(!rows.length)return "ЖИЗНЕННЫЙ ЦИКЛ ГИПОТЕЗ\n\nПока нет архивных причинных выводов, для которых можно вести историю состояний. Сначала попроси вывести причинную цепочку или новые гипотезы.";
    const labels={new:"НОВАЯ",under_review:"ПРОВЕРЯЕТСЯ",provisionally_supported:"ЕСТЬ ПРЕДВАРИТЕЛЬНО СОГЛАСУЮЩИЕСЯ ЗАПИСИ",
      challenged:"ОСПАРИВАЕТСЯ",conditional:"УСЛОВНАЯ",weakened:"ОСЛАБЛЕНА",suspended:"ПРИОСТАНОВЛЕНА",
      revised:"МАРШРУТ ПЕРЕСМОТРЕН",restored:"ВОЗВРАЩЕНА В АКТИВНУЮ МОДЕЛЬ"};
    const counts=HYPOTHESIS_LIFECYCLE.create(KNOWLEDGE).summary(rows).counts;
    let answer="ЖИЗНЕННЫЙ ЦИКЛ ГИПОТЕЗ\n\nВсего отслеживается: "+rows.length+".\n";
    for(const [state,label] of Object.entries(labels))if(counts[state])answer+="• "+label+": "+counts[state]+"\n";
    answer+="\nПОСЛЕДНИЕ ГИПОТЕЗЫ\n";
    for(const item of rows.slice(0,12)) {
      answer+="\n"+item.id+" · "+(labels[item.state]||item.state)+"\n";
      answer+=item.subject+" ⇢ "+item.object+"\n";
      answer+="Версия маршрута: "+item.revision+" · исходных причинных записей: "+item.originClaimIds.length+
        " · согласующихся свидетельств: "+item.supportingClaimIds.length+
        " · оспаривающих свидетельств: "+item.challengingClaimIds.length+"\n";
      if(item.decision)answer+="Активное решение, влияющее на гипотезу: "+({conditional:"условная связь",weaken:"ослабить связь",suspend:"временно приостановить",restore:"вернуть в активную модель"})[item.decision.strategy]+
        " · "+item.decision.edgeSubject+" → "+item.decision.edgeObject+"\n";
      const recent=item.events.slice(-4);
      if(recent.length)answer+="История: "+recent.map(event=>{
        const kind=({created:"создана",evidence_added:"добавлено свидетельство",origin_extended:"добавлены исходные записи",
          routes_changed:"изменён маршрут",decision_applied:"применено решение",state_changed:"изменилось состояние"})[event.kind]||event.kind;
        return kind+(event.toState?" ("+(labels[event.toState]||event.toState)+")":"");
      }).join(" → ")+"\n";
    }
    answer+="\nСтатус «есть предварительно согласующиеся записи» не означает доказанность. Сведения остаются пользовательскими и требуют проверки. Решения рабочей модели фиксируются отдельно от исходных воспоминаний; история переходов сохраняется.";
    return answer;
  }
  function mergeSimilarReasoningReviews(input) {
    const result=[];
    for(const row of Array.isArray(input)?input:[]) {
      if(!row)continue;
      const match=result.find(old=>old.kind===row.kind&&
        modelDecisionKey(old.edgeSubject,old.edgeObject)===modelDecisionKey(row.edgeSubject,row.edgeObject)&&
        observationRefsCompatible({observationCase:{eventRef:old.eventRef}},{observationCase:{eventRef:row.eventRef}})&&
        enrichedTextLooksLikeSameMention(old.evidence,row.evidence));
      if(!match) {
        result.push({...row,relatedClaimIds:[...new Set([...(row.relatedClaimIds||[]),row.claimId].filter(Boolean))].slice(0,12)});
        continue;
      }
      match.relatedClaimIds=[...new Set([...(match.relatedClaimIds||[]),match.claimId,row.claimId,...(row.relatedClaimIds||[])].filter(Boolean))].slice(0,12);
      if(String(row.evidence||"").length>String(match.evidence||"").length) {
        match.claimId=row.claimId;match.evidence=row.evidence;match.eventRef=row.eventRef||match.eventRef;
      }
    }
    return result.slice(-48);
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
  function enrichedTextLooksLikeSameMention(left,right) {
    const a=normalise(left),b=normalise(right);
    if(!a||!b)return false;
    if(a===b)return true;
    const shorter=a.length<=b.length?a:b,longer=a.length<=b.length?b:a;
    return shorter.length>=28&&longer.startsWith(shorter);
  }
  function observationRefsCompatible(left,right) {
    const a=String(left&&left.observationCase&&left.observationCase.eventRef||"").trim();
    const b=String(right&&right.observationCase&&right.observationCase.eventRef||"").trim();
    if(a||b)return !!a&&!!b&&normalise(a)===normalise(b);
    return true;
  }
  function isRepeatedEvidenceClaim(claim,previousClaims) {
    const key=claimSemanticKey(claim);
    return (previousClaims||[]).some(old=>{
      if(!old||claimSemanticKey(old)!==key)return false;
      if(claim.kind==="observation") {
        if(!observationRefsCompatible(claim,old))return false;
        if(enrichedTextLooksLikeSameMention(claim.evidence||"",old.evidence||""))return true;
      }
      return evidenceSimilarity(claim.evidence||"",old.evidence||"")>=0.8;
    });
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
      evidence:typeof raw.evidence==="string"?raw.evidence.slice(0,240):"",
      eventRef:typeof raw.eventRef==="string"?raw.eventRef.slice(0,100):"",
      duplicateClaimIds:Array.isArray(raw.duplicateClaimIds)?[...new Set(raw.duplicateClaimIds.filter(id=>typeof id==="string").slice(0,12))]:[]};
  }
  function modelEvidenceKey(item) {
    return modelDecisionKey(item.edgeSubject,item.edgeObject)+"|"+(item.eventRef?normalise(item.eventRef)+"|":"")+item.signature;
  }
  function mergeModelEvidenceHistory(existing,incoming) {
    const unique=[];
    for(const raw of [...(Array.isArray(existing)?existing:[]),...(Array.isArray(incoming)?incoming:[])]) {
      const item=cleanModelEvidence(raw);
      if(!item)continue;
      const match=unique.find(old=>modelDecisionKey(old.edgeSubject,old.edgeObject)===modelDecisionKey(item.edgeSubject,item.edgeObject)&&
        old.kind===item.kind&&observationRefsCompatible({observationCase:{eventRef:old.eventRef}},{observationCase:{eventRef:item.eventRef}})&&
        enrichedTextLooksLikeSameMention(old.evidence,item.evidence));
      if(!match) {unique.push(item);continue;}
      match.duplicateClaimIds=[...new Set([...(match.duplicateClaimIds||[]),match.claimId,item.claimId,...(item.duplicateClaimIds||[])])].slice(0,12);
      if(item.evidence.length>match.evidence.length) {
        match.claimId=item.claimId;match.evidence=item.evidence;match.signature=item.signature;
        match.eventRef=item.eventRef||match.eventRef;match.at=Math.min(match.at,item.at);
      }
    }
    return unique.sort((a,b)=>a.at-b.at).slice(-MAX_MODEL_EVIDENCE);
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
  function duplicateInquiryGrouping(response, claimIds) {
    const ids=[...new Set((Array.isArray(claimIds)?claimIds:[]).filter(id=>typeof id==="string"&&id))].slice(0,12);
    const raw=String(response||"").trim().toLocaleLowerCase("ru").replace(/ё/gu,"е");
    const grouped=raw.match(/^(?:группы|группировка|разбиение)\s*[:—-]\s*([\s\S]+)$/iu);
    if(grouped&&ids.length>=2) {
      const parts=grouped[1].split(/[;|]/u).map(part=>part.trim()).filter(Boolean);
      const groups=[];
      let valid=parts.length>=1;
      for(const part of parts) {
        const match=part.match(/^(\d+(?:\s*(?:,|\+)\s*\d+)*)$/u);
        if(!match){valid=false;break;}
        const indexes=match[1].split(/[,+]/u).map(value=>Number(value.trim()));
        if(indexes.some(index=>!Number.isInteger(index)||index<1||index>ids.length)){valid=false;break;}
        groups.push(indexes.map(index=>ids[index-1]));
      }
      const flattened=groups.flat();
      if(valid&&flattened.length===ids.length&&new Set(flattened).size===ids.length&&
         ids.every(id=>flattened.includes(id))) {
        const resolution=groups.length===1?"same_event":
          groups.every(group=>group.length===1)?"separate_events":"partitioned_events";
        return {resolution,groups};
      }
    }
    const separate=/(?:разн\p{L}*\s+(?:(?:самостоятельн|отдельн|независим)\p{L}*\s+)?(?:эпизод\p{L}*|случа\p{L}*|событи\p{L}*|наблюден\p{L}*)|два\s+(?:разных|отдельных)\s+(?:эпизод\p{L}*|случа\p{L}*|событи\p{L}*|наблюден\p{L}*)|отдельн\p{L}+\s+(?:эпизод\p{L}*|случа\p{L}*|событи\p{L}*|наблюден\p{L}*)|кажд\p{L}+\s+карточк\p{L}+\s+отдельно|не\s+(?:один\s+и\s+тот\s+же|одно\s+и\s+то\s+же))/u.test(raw);
    if(separate)return {resolution:"separate_events",groups:ids.map(id=>[id])};
    const same=/(?:один\s+(?:и\s+тот\s+же\s+)?(?:эпизод\p{L}*|случа\p{L}*|событи\p{L}*|наблюден\p{L}*)|одно\s+(?:и\s+то\s+же|событи\p{L}*|наблюден\p{L}*)|это\s+один\s+и\s+тот\s+же|тот\s+же\s+эпизод|считай\s+(?:их\s+)?одним)/u.test(raw);
    return same?{resolution:"same_event",groups:[ids]}:null;
  }
  function duplicateInquiryResolution(response, claimIds) {
    const grouping=duplicateInquiryGrouping(response,claimIds);
    return grouping?grouping.resolution:null;
  }
  function applyDuplicateInquiryResolution(item, grouping) {
    if(!item||item.kind!=="duplicate_observation"||!grouping||
       !["same_event","separate_events","partitioned_events"].includes(grouping.resolution))return {updated:0,missing:[]};
    const ids=[...new Set(item.sourceClaimIds||[])];
    const found=[],missing=[];
    for(const id of ids) {
      let match=null;
      for(const memory of memories) {
        match=(memory.claims||[]).find(claim=>claim&&claim.id===id&&claim.kind==="observation"&&
          KNOWLEDGE.sameEntity(claim.subject,item.edgeSubject)&&KNOWLEDGE.sameEntity(claim.object,item.edgeObject));
        if(match)break;
      }
      if(!match){missing.push(id);continue;}
      found.push(match);
    }
    if(found.length<2||missing.length)return {updated:0,missing};
    const groups=Array.isArray(grouping.groups)?grouping.groups:[];
    const flattened=groups.flat();
    if(!groups.length||flattened.length!==ids.length||new Set(flattened).size!==ids.length||
       !ids.every(id=>flattened.includes(id)))return {updated:0,missing:ids};
    const base="ng-"+item.id.toLowerCase()+"-episode";
    const groupById=new Map();
    groups.forEach((group,groupIndex)=>group.forEach(id=>groupById.set(id,groupIndex)));
    found.forEach((claim,index)=>{
      const details=KNOWLEDGE.sanitizeObservationDetails(claim.observationCase,"direct_observation");
      const groupIndex=groupById.get(claim.id);
      const eventRef=grouping.resolution==="same_event"?base:
        grouping.resolution==="separate_events"?base+"-"+(index+1):
        base+"-group-"+(groupIndex+1);
      claim.observationCase={...details,schema:2,eventRef};
    });
    item.resolution=grouping.resolution;
    item.resolvedEventGroups=groups.map(group=>group.slice());
    item.resolvedEventRefs=[...new Set(found.map(claim=>claim.observationCase.eventRef))];
    return {updated:found.length,missing:[]};
  }
  function inquiryAssessmentFor(item) {
    const text=normalise(item&&item.responseText||"");
    if(item&&item.kind==="duplicate_observation") {
      if(item.resolution==="same_event")return {assessment:"duplicate_same_event",reason:"Пользователь уточнил, что карточки относятся к одному эпизоду. Им присвоен общий идентификатор события; число независимых случаев уменьшено. Это уточнение происхождения записей, а не подтверждение причинной связи."};
      if(item.resolution==="separate_events")return {assessment:"duplicate_separate_events",reason:"Пользователь уточнил, что карточки относятся к разным эпизодам. Каждой карточке присвоен отдельный идентификатор события; они учитываются раздельно."};
      if(item.resolution==="partitioned_events")return {assessment:"duplicate_partitioned_events",reason:"Пользователь распределил карточки по нескольким группам эпизодов. Внутри каждой группы закреплён общий идентификатор, между группами — разные. Это уточнение происхождения записей, а не подтверждение причинной связи."};
      return {assessment:"duplicate_unresolved",reason:"Ответ пока не позволяет однозначно определить, описывают ли карточки один эпизод или разные. Их группировка не изменена; требуется уточнение."};
    }
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
      observations_reported_unverified:"наблюдения заявлены, но не проверены",
      duplicate_same_event:"карточки подтверждены как один эпизод",
      duplicate_separate_events:"карточки подтверждены как разные эпизоды",
      duplicate_partitioned_events:"карточки распределены по нескольким группам эпизодов",
      duplicate_unresolved:"идентичность эпизодов пока не уточнена",
      unassessed:"ответ ещё не оценён"})[item&&item.assessment]||"ответ ещё не оценён";
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
    const responseDetails=KNOWLEDGE?KNOWLEDGE.parseObservationDetails(raw.responseText||"","inquiry_response"):null;
    if(responseDetails)responseDetails.sourceRef=raw.id;
    return {id:raw.id,signature:raw.signature.slice(0,500),
      kind:["contrast_observations","clarify_counterexample","missing_observation","duplicate_observation","discriminating_observations"].includes(raw.kind)?raw.kind:"missing_observation",
      edgeSubject:typeof raw.edgeSubject==="string"?raw.edgeSubject.slice(0,180):"",
      edgeObject:typeof raw.edgeObject==="string"?raw.edgeObject.slice(0,180):"",
      comparisonEdges:Array.isArray(raw.comparisonEdges)?raw.comparisonEdges.slice(0,2).map(edge=>({
        subject:typeof edge.subject==="string"?edge.subject.slice(0,180):"",
        object:typeof edge.object==="string"?edge.object.slice(0,180):""
      })).filter(edge=>edge.subject&&edge.object):[],
      question:raw.question.slice(0,700),reason:typeof raw.reason==="string"?raw.reason.slice(0,700):"",
      priority:Math.max(0,Math.min(9,Number(raw.priority)||0)),
      status:["open","answered","skipped"].includes(raw.status)?raw.status:"open",
      sourceClaimIds:Array.isArray(raw.sourceClaimIds)?raw.sourceClaimIds.filter(x=>typeof x==="string").slice(0,12):[],
      createdAt:safeTime(raw.createdAt,Date.now()),updatedAt:safeTime(raw.updatedAt,safeTime(raw.createdAt,Date.now())),
      lastAskedAt:safeTime(raw.lastAskedAt,0),responseText:typeof raw.responseText==="string"?raw.responseText.slice(0,MAX_TEXT):"",
      responseMemoryId:typeof raw.responseMemoryId==="string"?raw.responseMemoryId.slice(0,100):"",responseDetails,
      responseClaimIds:Array.isArray(raw.responseClaimIds)?raw.responseClaimIds.filter(x=>typeof x==="string").slice(0,12):[],
      answeredAt:safeTime(raw.answeredAt,0),
      assessment:["insufficient_context","gap_confirmed","context_reported_unverified","observations_reported_unverified",
        "duplicate_same_event","duplicate_separate_events","duplicate_partitioned_events","duplicate_unresolved"].includes(raw.assessment)?raw.assessment:"unassessed",
      assessmentReason:typeof raw.assessmentReason==="string"?raw.assessmentReason.slice(0,700):"",
      clarificationNote:typeof raw.clarificationNote==="string"?raw.clarificationNote.slice(0,700):"",
      resolution:["same_event","separate_events","partitioned_events"].includes(raw.resolution)?raw.resolution:"",
      resolvedEventRefs:Array.isArray(raw.resolvedEventRefs)?raw.resolvedEventRefs.filter(x=>typeof x==="string").slice(0,12):[],
      resolvedEventGroups:Array.isArray(raw.resolvedEventGroups)?raw.resolvedEventGroups.slice(0,12).map(group=>
        Array.isArray(group)?group.filter(id=>typeof id==="string").slice(0,12):[]).filter(group=>group.length):[],
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
  function clearLegacyInquiryFragmentClaims() {
    const responses=inquiries.filter(item=>item.status==="answered"&&item.responseText&&item.answeredAt>0)
      .map(item=>({
        at:item.answeredAt,
        fragments:item.responseText.split(/\n+|(?<=[.!?])\s+/u).map(value=>value.trim()).filter(Boolean)
      })).filter(item=>item.fragments.length);
    if(!responses.length)return false;
    let changed=false;
    for(const memory of memories) {
      if(!Array.isArray(memory.claims)||!memory.claims.length)continue;
      let comparable=memory.text;
      const prefix=comparable.match(/^ответ на вопрос\s+#?\s*q\d+\s*:\s*/iu);
      if(prefix)comparable=comparable.slice(prefix[0].length);
      const normalized=normalise(comparable);
      if(!normalized)continue;
      const createdAt=Number(memory.createdAt)||0;
      const isAnswerFragment=responses.some(response=>
        Math.abs(createdAt-response.at)<=60000&&
        response.fragments.some(fragment=>normalise(fragment)===normalized));
      if(isAnswerFragment) {
        memory.claims=[];
        changed=true;
      }
    }
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
    if(DISCRIMINATING_OBSERVATIONS&&typeof DISCRIMINATING_OBSERVATIONS.create==="function") {
      try {
        const selector=DISCRIMINATING_OBSERVATIONS.create(KNOWLEDGE),seenComparisons=new Set();
        for(const entry of reasoningArchive) {
          const meta=cleanReasoning(entry.reasoning);if(!meta)continue;
          for(const conclusion of meta.conclusions) {
            const selected=selector.analyze(conclusion,claims);
            if(!selected||seenComparisons.has(selected.signature))continue;
            seenComparisons.add(selected.signature);
            candidates.push({signature:selected.signature,kind:"discriminating_observations",
              edgeSubject:selected.edgeSubject,edgeObject:selected.edgeObject,comparisonEdges:selected.comparisonEdges,
              priority:0,sourceClaimIds:selected.sourceClaimIds,question:selected.question,reason:selected.reason});
          }
        }
      } catch(error) {
        console.warn("Discriminating-observation selection failed:",error);
      }
    }
    const possibleDuplicates=OBSERVATIONS.uniqueObservationEvents(observationCases()).possibleGroups;
    for(const group of possibleDuplicates) {
      const claimIds=[...new Set(group.claimIds||[])].slice(0,12);
      if(claimIds.length<2)continue;
      const signature="duplicate_observation|"+claimIds.slice().sort().join("|");
      const examples=(group.members||[]).slice(0,12).map((item,index)=>
        "• "+(index+1)+". "+item.id+": «"+String(item.evidence||"").slice(0,150)+"»").join("\n");
      candidates.push({signature,kind:"duplicate_observation",edgeSubject:group.subject,edgeObject:group.object,
        priority:-1,sourceClaimIds:claimIds,
        question:"Карточки могут описывать один эпизод или несколько разных. Ответь «один эпизод» или «разные эпизоды», либо задай смешанное разбиение по номерам: «группы: 1+2; 3; 4+5». Внутри каждой группы карточки относятся к одному событию; каждый номер нужно использовать ровно один раз.\n"+examples,
        reason:"Автоматическая проверка нашла повтор или дополнение формулировки для одного и того же причинного звена. Похожий текст, контекст или время не доказывают идентичность события; перед подсчётом независимых случаев нужно уточнить это у тебя."});
    }
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
          old.question=c.question;old.reason=c.reason;old.sourceClaimIds=c.sourceClaimIds;
          old.comparisonEdges=Array.isArray(c.comparisonEdges)?c.comparisonEdges:[];old.updatedAt=Date.now();changed=true;
        }
        continue;
      }
      if(inquiries.length>=MAX_INQUIRIES)break;
      inquiries.push({id:"Q"+nextInquiryNumber++,signature:c.signature,kind:c.kind,edgeSubject:c.edgeSubject,edgeObject:c.edgeObject,
        question:c.question,reason:c.reason,priority:c.priority,status:"open",sourceClaimIds:c.sourceClaimIds,
        comparisonEdges:Array.isArray(c.comparisonEdges)?c.comparisonEdges:[],
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
      "\n\nОТВЕТ\nНажми «Запомнить» и начни ответ точно так:\nОтвет на вопрос "+item.id+": [твой ответ]\n\n"+
      (item.kind==="duplicate_observation"
        ?"Можно ответить «один эпизод» или «разные эпизоды». Для смешанного случая используй «группы: 1+2; 3; 4+5» по номерам карточек из вопроса; каждый номер нужно указать ровно один раз."
        :"Ответ будет сохранён как твоё отдельное сообщение и привязан к "+item.id+". Он не станет автоматически доказанным фактом и не заполнит поля отдельных карточек наблюдений.");
  }
  function researchImpactForInquiry(item) {
    const affected=new Set();
    const watchedEdges=item.kind==="discriminating_observations"&&Array.isArray(item.comparisonEdges)&&item.comparisonEdges.length
      ?item.comparisonEdges:[item];
    for(const entry of reasoningArchive) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta)continue;
      for(const conclusion of meta.conclusions) {
        const usesEdge=conclusion.paths.some(path=>path.some(edge=>watchedEdges.some(watched=>
          KNOWLEDGE.sameEntity(edge.subject,watched.subject)&&KNOWLEDGE.sameEntity(edge.object,watched.object))));
        if(usesEdge)affected.add(inquiryEdgeKey(conclusion.subject,conclusion.object));
      }
    }
    return affected.size;
  }
  function observationFieldStatus(fields,key) {
    const rank={not_stated:0,unknown:1,not_recorded:2,none_reported:3,provided:4};
    return (fields||[]).map(item=>item&&item[key]&&item[key].status||"not_stated")
      .sort((a,b)=>(rank[b]||0)-(rank[a]||0))[0]||"not_stated";
  }
  function observationFieldStatusLabel(status,field="context") {
    const labels={
      provided:{context:"указан",timing:"указано",criterion:"указан",outcome:"указано"},
      not_stated:{context:"не указан",timing:"не указано",criterion:"не указан",outcome:"не указано"},
      not_recorded:{context:"не записан",timing:"не записано",criterion:"не записан",outcome:"не записано"},
      unknown:{context:"неизвестен",timing:"неизвестно",criterion:"неизвестен",outcome:"неизвестно"},
      none_reported:{context:"сообщено об отсутствии",timing:"сообщено об отсутствии",criterion:"сообщено об отсутствии",outcome:"сообщено об отсутствии"},
      conflict:{context:"значения конфликтуют",timing:"время расходится",criterion:"методы расходятся",outcome:"значения расходятся"}
    };
    return labels[status]?.[field]||labels.not_stated[field];
  }
  const OBSERVATIONS = window.NGObservationEngine.create({
    knowledge: KNOWLEDGE,
    normalise,
    parseObservationMoment,
    enrichedTextLooksLikeSameMention,
    observationFieldStatus,
    observationFieldStatusLabel
  });
  function reviewReadinessForEdge(subject,object) {
    return OBSERVATIONS.reviewReadinessForEdge(observationCases(),inquiries,subject,object);
  }
  function observationCases() {
    const seen=new Set(),result=[];
    for(const memory of memories)for(const claim of memory.claims||[]) {
      if(!claim||claim.kind!=="observation"||claim.status==="superseded")continue;
      const key=memory.id+"|"+claimSemanticKey(claim)+"|"+normalise(claim.evidence||"");
      if(seen.has(key))continue;
      seen.add(key);
      const details=KNOWLEDGE.sanitizeObservationDetails(claim.observationCase,"direct_observation");
      result.push({id:claim.id,sourceMemoryId:memory.id,subject:claim.subject,object:claim.object,
        polarity:claim.polarity!==false,evidence:claim.evidence||"",recordedAt:safeTime(claim.createdAt,memory.createdAt),
        details,sourceRef:details.sourceRef||"",verification:claim.verification||"unverified",
        source:claim.source||"user_message"});
    }
    return result.sort((a,b)=>a.recordedAt-b.recordedAt);
  }

  function parseObservationMoment(value) {
    const raw=String(value||"").trim();
    if(!raw)return null;
    let match=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/u);
    let year,month,day,hour=null,minute=null,second=null,hasSeconds=false;
    if(match) {
      year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);
      if(match[4]!=null) { hour=Number(match[4]);minute=Number(match[5]);second=match[6]==null?0:Number(match[6]);hasSeconds=match[6]!=null; }
    } else {
      match=raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(?:в\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/iu);
      if(!match)return null;
      day=Number(match[1]);month=Number(match[2]);year=Number(match[3]);
      if(match[4]!=null) { hour=Number(match[4]);minute=Number(match[5]);second=match[6]==null?0:Number(match[6]);hasSeconds=match[6]!=null; }
    }
    if(!Number.isInteger(year)||year<1||year>9999||month<1||month>12)return null;
    const leap=year%4===0&&(year%100!==0||year%400===0);
    const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(day<1||day>monthDays[month-1])return null;
    if(hour!=null&&(hour<0||hour>23||minute<0||minute>59||second<0||second>59))return null;
    const pad=value=>String(value).padStart(2,"0");
    const dateKey=String(year).padStart(4,"0")+"-"+pad(month)+"-"+pad(day);
    const timeKey=hour==null?null:pad(hour)+":"+pad(minute)+(hasSeconds?":"+pad(second):"");
    return {dateKey,year,month,day,hour,minute,second,precision:hour==null?"date":hasSeconds?"second":"minute",
      dateLabel:pad(day)+"."+pad(month)+"."+String(year),timeLabel:timeKey,
      secondsOfDay:hour==null?null:hour*3600+minute*60+second};
  }
  function eventIsLaterThanRecord(moment,recordedAt) {
    const recorded=new Date(safeTime(recordedAt,Date.now()));
    const pad=value=>String(value).padStart(2,"0");
    const recordedKey=String(recorded.getFullYear()).padStart(4,"0")+"-"+pad(recorded.getMonth()+1)+"-"+pad(recorded.getDate());
    if(moment.dateKey>recordedKey)return true;
    if(moment.dateKey<recordedKey||moment.secondsOfDay==null)return false;
    const recordedSeconds=recorded.getHours()*3600+recorded.getMinutes()*60+recorded.getSeconds();
    return moment.secondsOfDay>recordedSeconds;
  }
  function observationTimelineData() {
    const sourceCases=observationCases(),grouped=OBSERVATIONS.uniqueObservationEvents(sourceCases);
    const cases=grouped.events,events=[],unparsed=[];
    let missingCount=0;
    for(const item of cases) {
      const field=item.details&&item.details.timing;
      if(!field||field.status!=="provided") {missingCount++;continue;}
      const moment=parseObservationMoment(field.value);
      if(!moment) {unparsed.push({id:item.id,subject:item.subject,object:item.object,polarity:item.polarity,value:field.value});continue;}
      events.push({...item,moment,futureRelativeToRecord:eventIsLaterThanRecord(moment,item.recordedAt)});
    }
    events.sort((a,b)=>a.moment.dateKey.localeCompare(b.moment.dateKey)||
      (a.moment.secondsOfDay==null?Number.MAX_SAFE_INTEGER:a.moment.secondsOfDay)-
      (b.moment.secondsOfDay==null?Number.MAX_SAFE_INTEGER:b.moment.secondsOfDay)||
      String(a.id).localeCompare(String(b.id)));
    return {totalCases:cases.length,rawCardCount:sourceCases.length,duplicateMentions:grouped.duplicateMentions,
      possibleDuplicateGroups:grouped.possibleDuplicateGroups,events,unparsed,missingCount,
      futureCount:events.filter(item=>item.futureRelativeToRecord).length,
      recognizedCount:events.length,unparsedCount:unparsed.length};
  }
  function observationTimelineAnswer() {
    const data=observationTimelineData();
    if(!data.totalCases)return "ХРОНОЛОГИЯ НАБЛЮДЕНИЙ\n\nПока нет сохранённых карточек наблюдений.";
    if(!data.events.length) {
      return "ХРОНОЛОГИЯ НАБЛЮДЕНИЙ\n\nПока не найдено ни одной даты, которую можно надёжно упорядочить. Укажи время события в формате «время: 2026-11-09 07:15» или дату в формате «дата: 09.11.2026». Описания вроде «вчера вечером» сохраняются, но не превращаются в точную дату автоматически.";
    }
    const byDay=new Map();
    for(const item of data.events) { if(!byDay.has(item.moment.dateKey))byDay.set(item.moment.dateKey,[]); byDay.get(item.moment.dateKey).push(item); }
    const fieldText=(field)=>field&&field.status==="provided"?field.value:observationFieldStatusLabel(field&&field.status||"not_stated");
    let answer="ХРОНОЛОГИЯ НАБЛЮДЕНИЙ\n\n";
    answer+="Распознано дат/моментов: "+data.recognizedCount+" из "+data.totalCases+" групп событий; не удалось разобрать: "+data.unparsedCount+"; время не указано: "+data.missingCount+".\n";
    answer+="Карточек памяти: "+data.rawCardCount+"; возможных повторов/дополнений сгруппировано: "+data.duplicateMentions+".\n";
    answer+="Показываю только время события, явно записанное в карточке. Дата сохранения воспоминания не используется для восстановления хронологии.\n\n";
    for(const [dateKey,items] of byDay) {
      const first=items[0].moment; answer+=first.dateLabel+"\n";
      const timed=items.filter(item=>item.moment.precision!=="date"),dateOnly=items.filter(item=>item.moment.precision==="date");
      for(const item of timed) {
        answer+="  "+item.moment.timeLabel+" · "+(item.polarity?"наблюдалось":"не наблюдалось")+" · "+item.subject+" → "+item.object+"\n";
        answer+="    Контекст: "+fieldText(item.details.context)+" · Критерий: "+fieldText(item.details.criterion)+" · Значение: "+fieldText(item.details.outcome)+" · Карточка: "+item.id+"\n";
        if(item.futureRelativeToRecord)answer+="    ПРЕДУПРЕЖДЕНИЕ: событие указано позже времени сохранения карточки. Проверь дату, часы и часовой пояс.\n";
      }
      for(const item of dateOnly) {
        answer+="  Время суток не указано · "+(item.polarity?"наблюдалось":"не наблюдалось")+" · "+item.subject+" → "+item.object+"\n";
        answer+="    Контекст: "+fieldText(item.details.context)+" · Критерий: "+fieldText(item.details.criterion)+" · Значение: "+fieldText(item.details.outcome)+" · Карточка: "+item.id+"\n";
        if(item.futureRelativeToRecord)answer+="    ПРЕДУПРЕЖДЕНИЕ: событие указано позже времени сохранения карточки. Проверь дату, часы и часовой пояс.\n";
      }
      answer+="\n";
    }
    if(data.unparsedCount) {
      answer+="ДАТА/ВРЕМЯ УКАЗАНЫ, НО НЕ РАСПОЗНАНЫ\n";
      for(const item of data.unparsed.slice(0,12))answer+="• "+item.value+" — "+item.subject+" → "+item.object+" (карточка "+item.id+")\n";
      answer+="\n";
    }
    if(data.missingCount)answer+="Без явно указанной даты или времени осталось карточек: "+data.missingCount+". Их нельзя достоверно расположить на временной шкале.\n\n";
    if(data.futureCount)answer+="\nВозможное несоответствие времени: "+data.futureCount+" событие(я) датированы позже момента сохранения карточки. Сравнение использует локальные часы текущего устройства; при переносе копии между часовыми поясами нужна ручная проверка. Это предупреждение, а не автоматическое исправление даты.\n";
    answer+="Распознаются строгие форматы YYYY-MM-DD, YYYY-MM-DD HH:mm[:ss], DD.MM.YYYY и DD.MM.YYYY HH:mm[:ss]. Для даты без времени определяется только день, но не порядок событий внутри него. Часовой пояс не угадывается. Отчёт не подтверждает достоверность самих наблюдений.";
    return answer;
  }
  function observationFieldDescription(field) {
    if(!field)return "не указано";
    if(field.status==="provided")return field.value;
    return observationFieldStatusLabel(field.status);
  }
  function observationCasesAnswer() {
    const cases=observationCases();
    if(!cases.length)return "ЖУРНАЛ НАБЛЮДЕНИЙ\n\nПока нет отдельных структурированных наблюдений. Для записи используй форму:\nПри X наблюдалось Y; контекст: ...; время: ...; критерий: ...\n\nДля явно отсутствующей информации можно указать: «не записано», «неизвестно» или «отсутствовало». Неизвестные поля не будут додумываться.";
    let answer="ЖУРНАЛ НАБЛЮДЕНИЙ · "+cases.length+" КАРТОЧЕК\n\n";
    for(const item of cases.slice(-24).reverse()) {
      answer+=(item.polarity?"НАБЛЮДАЛОСЬ: ":"НЕ НАБЛЮДАЛОСЬ: ")+item.subject+" → "+item.object+"\n";
      answer+="Карточка: "+item.id+" · Источник памяти: "+item.sourceMemoryId+"\n";
      answer+="Контекст: "+observationFieldDescription(item.details.context)+" · Время: "+observationFieldDescription(item.details.timing)+" · Критерий: "+observationFieldDescription(item.details.criterion)+" · Значение: "+observationFieldDescription(item.details.outcome)+"\n";
      if(item.details.eventRef)answer+="Идентификатор события: "+item.details.eventRef+"\n";
      answer+="Исходная запись: «"+item.evidence.slice(0,260)+"»\n\n";
    }
    answer+="Метки «событие: ...» или «эпизод: ...» связывают карточки одного эпизода; разные метки не дают системе слить отдельные события. Метод оценки и полученное значение указываются отдельно. Время записи в память не означает время самого события. Поля заполняются только из явно переданных уточнений; сведения из ответов на вопросы остаются отдельным пользовательским источником, а не новым наблюдением.";
    return answer;
  }
  function evidenceReconciliationForEdge(subject,object,baselineAt=0) {
    return OBSERVATIONS.evidenceReconciliationForEdge(observationCases(),subject,object,baselineAt);
  }
  function trackedObservationEdges() {
    const edges=new Map();
    for(const entry of reasoningArchive) {
      const meta=cleanReasoning(entry.reasoning);if(!meta)continue;
      for(const conclusion of meta.conclusions)for(const path of conclusion.paths)for(const edge of path) {
        const key=modelDecisionKey(edge.subject,edge.object),prior=edges.get(key);
        if(!prior||meta.createdAt>prior.baselineAt)
          edges.set(key,{subject:edge.subject,object:edge.object,baselineAt:meta.createdAt});
      }
    }
    for(const decision of currentModelDecisions()) {
      const key=modelDecisionKey(decision.edgeSubject,decision.edgeObject);
      if(!edges.has(key))edges.set(key,{subject:decision.edgeSubject,object:decision.edgeObject,baselineAt:decision.at});
    }
    return [...edges.values()];
  }
  function observationEvidenceDossierText(row,index=0) {
    const d=evidenceReconciliationForEdge(row.subject,row.object,row.baselineAt);
    let answer=(index?index+". ":"")+"Звено: "+row.subject+" → "+row.object+"\n";
    answer+="Наблюдения после группировки возможных повторов/дополнений: согласующиеся — "+d.supportingCount+"; противоположные — "+d.challengingCount+
      "; сгруппировано повторных карточек — "+d.duplicateMentions+" (возможных групп — "+d.possibleDuplicateGroups+").\n";
    answer+="Заполненность полей по отдельным событиям: "+d.metadataCoverage+"% ("+d.completeCases+" полностью описанных из "+d.cases.length+").\n";
    if(d.identityUnresolvedCount)answer+="Идентичность эпизодов не уточнена для "+d.identityUnresolvedCount+" возможной группы(групп) карточек; полнота этих событий не засчитывается.\n";
    if(d.metadataConflictCount)answer+="Конфликтующих значений полей внутри явно связанных событий: "+d.metadataConflictCount+".\n";
    if(d.outcomeMissingCount)answer+="Для числового способа оценки не записано фактическое числовое значение результата в "+d.outcomeMissingCount+" событии(ях).\n";
    answer+="Отдельных записей памяти: "+d.userRecordCount+"; добавлено в память после сохранения вывода: "+d.addedAfterModelCount+".\n";
    answer+="Явных ссылок на источники: "+d.sourceReferenceCount+
      "; уникальных независимо подтверждённых ссылок: "+d.independentVerifiedSources+
      (d.verifiedWithoutSourceRef?"; подтверждённых записей без ссылки, не засчитанных как независимый источник: "+d.verifiedWithoutSourceRef:"")+".\n";
    answer+="Пользовательских непроверенных эпизодов: "+d.userReportedUnverifiedCount+
      ". Записи памяти сами по себе не являются независимыми источниками.\n";
    const fieldNames={context:"контекст",timing:"время",criterion:"критерий",outcome:"результат"};
    const statusNames={not_stated:"не указано",unknown:"неизвестно",not_recorded:"не записано",none_reported:"сообщено об отсутствии",conflict:"конфликт значений"};
    for(const key of Object.keys(fieldNames)) {
      const counts=d.fieldStatusCounts[key]||{};
      const statusText=Object.entries(statusNames).filter(([status])=>counts[status]>0)
        .map(([status,label])=>label+": "+counts[status]).join(", ");
      if(statusText)answer+="Статус поля «"+fieldNames[key]+"»: "+statusText+".\n";
    }
    answer+="Сопоставление: "+d.pattern+".\n";
    if(d.oppositePairCount) {
      answer+="Пар противоположных исходов: "+d.oppositePairCount+"; совпадают контекст и критерий: "+d.alignedPairCount+
        "; различаются контекст/критерий: "+d.differentMetadataPairCount+
        "; отличаются только временем: "+d.timingOnlyPairCount+
        "; одновременно различаются несколько параметров: "+d.multiDimensionDifferencePairCount+
        "; недостаточно полей для сравнения: "+d.incompletePairCount+".\n";
      const dimensionNames={context:"контекст",timing:"время",criterion:"критерий"};
      for(const pair of d.oppositePairs.slice(0,3)) {
        const changed=(pair.changedDimensions||[]).map(key=>dimensionNames[key]||key);
        answer+="  • "+pair.supportingId+" / "+pair.challengingId+": "+
          (pair.status==="aligned"?"контекст и критерий совпадают":pair.status==="different_metadata"?"контекст или критерий различаются":"поля для сопоставления неполны")+
          (changed.length?"; изменились параметры: "+changed.join(", "):"")+".\n";
      }
    }
    if(d.addedAfterModelIds.length)answer+="Новые для архива записи: "+d.addedAfterModelIds.slice(0,8).join(", ")+". (Это время сохранения в память, не доказательство времени события.)\n";
    answer+="Оценка: "+d.recommendation+"\nТекущее решение модели не меняется автоматически.";
    return answer;
  }
  function experienceReconciliationAnswer() {
    const edges=trackedObservationEdges();
    if(!edges.length)return "СОПОСТАВЛЕНИЕ ОПЫТА С ПРИЧИННОЙ МОДЕЛЬЮ\n\nПока нет сохранённых причинных звеньев с историей. Сначала выведи причинную цепочку, чтобы было с чем сопоставить наблюдения.";
    let answer="СОПОСТАВЛЕНИЕ ОПЫТА С ПРИЧИННОЙ МОДЕЛЬЮ\n\n";
    for(let i=0;i<Math.min(edges.length,10);i++)answer+=observationEvidenceDossierText(edges[i],i+1)+"\n\n";
    answer+="КАК ЧИТАТЬ ОТЧЁТ\nСовпадающий или дополненный текст без отдельного идентификатора события группируется как возможное повторное упоминание: исходные карточки сохраняются, но не считаются независимыми случаями. Чтобы явно различить два эпизода, добавляй разные метки «событие: ...»; одинаковая метка связывает карточки одного эпизода. Метод оценки («критерий») и полученное значение («результат») записываются отдельно. Совпадение контекста и критерия позволяет лишь осторожно сопоставить пару, но не доказывает причинность. Разные контексты сами по себе не объясняют разницу исходов. Время здесь означает пользовательское описание; точность дат и реальный временной порядок независимо не проверены.\n\nРешения рабочей модели остаются прежними. Для явного выбора варианта пересмотра используй отдельную команду после изучения отчёта.";
    return answer;
  }
  function newObservationModelNote(claims) {
    const observations=(claims||[]).filter(claim=>claim&&claim.kind==="observation");
    if(!observations.length)return "";
    const edges=trackedObservationEdges().filter(edge=>observations.some(claim=>
      KNOWLEDGE.sameEntity(claim.subject,edge.subject)&&KNOWLEDGE.sameEntity(claim.object,edge.object)));
    if(!edges.length)return "";
    let answer="СОПОСТАВЛЕНИЕ НОВОГО ОПЫТА С ПРЕЖНЕЙ МОДЕЛЬЮ\n";
    for(const edge of edges.slice(0,3)) {
      const d=evidenceReconciliationForEdge(edge.subject,edge.object,edge.baselineAt);
      answer+="• "+edge.subject+" → "+edge.object+": теперь "+d.supportingCount+" согласующихся и "+
        d.challengingCount+" противоположных записей; полей заполнено "+d.metadataCoverage+"%; "+d.pattern+".\n";
    }
    return answer+"Новые записи сопоставлены с прежним выводом, но его решение не изменено. Подробности: «Сопоставь опыт с причинной моделью».";
  }
  function modelReviewReadinessAnswer() {
    const edges=new Map();
    for(const entry of reasoningArchive) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta)continue;
      for(const conclusion of meta.conclusions)for(const path of conclusion.paths)for(const edge of path) {
        const key=inquiryEdgeKey(edge.subject,edge.object);
        if(!edges.has(key))edges.set(key,{subject:edge.subject,object:edge.object});
      }
    }
    if(!edges.size)return "ГОТОВНОСТЬ К ПЕРЕСМОТРУ МОДЕЛИ\n\nПока нет сохранённых причинных маршрутов, для звеньев которых можно оценить достаточность наблюдений.";
    const rows=[...edges.values()].map(edge=>reviewReadinessForEdge(edge.subject,edge.object))
      .sort((a,b)=>Number(b.ready)-Number(a.ready)||b.totalCount-a.totalCount);
    let answer="ГОТОВНОСТЬ К ПЕРЕСМОТРУ МОДЕЛИ\n\n";
    for(const row of rows.slice(0,12)) {
      const decision=modelDecisionForEdge(row);
      answer+="Звено: "+row.subject+" → "+row.object+"\n";
      answer+="Прямые уникальные наблюдения: согласующиеся — "+row.supportingCount+"; противоположные — "+row.challengingCount+".\n";
      answer+="Контекст: "+observationFieldStatusLabel(row.contextStatus,"context")+" · Время: "+observationFieldStatusLabel(row.timingStatus,"timing")+" · Критерий результата: "+observationFieldStatusLabel(row.criterionStatus,"criterion")+".\n";
      answer+="Фактическое значение: "+observationFieldStatusLabel(row.outcomeStatus,"outcome")+(row.numericOutcomeRequired?" · требуется для указанной числовой шкалы":" · отдельно от метода оценки")+".\n";
      answer+="Полностью описанных событий: "+row.completeEventCount+" из "+row.totalCount+"; с неполными данными: "+row.incompleteEventCount+".\n";
      if(row.identityUnresolvedCount)answer+="Не разрешена идентичность эпизодов в "+row.identityUnresolvedCount+" возможной группе(ах).\n";
      if(row.metadataConflictCount)answer+="Обнаружены конфликтующие значения метаданных: "+row.metadataConflictCount+".\n";
      if(row.possibleDuplicateCount)answer+="Возможные повторы/дополнения: "+row.possibleDuplicateCount+" карточка(и) сгруппированы как один предварительный случай до уточнения идентификатора события.\n";
      if(row.answerIds.length)answer+="Уточнения пользователя: "+row.answerIds.join(", ")+" (контекстные сведения, не независимая проверка).\n";
      answer+="Оценка: "+row.label+".\n";
      if(row.blockers.length)answer+="Что ещё необходимо: "+row.blockers.join("; ")+".\n";
      if(decision)answer+="Текущее решение рабочей модели: "+({conditional:"условная связь",weaken:"ослабленная связь",suspend:"временно приостановлена",restore:"возвращена в активную модель"})[decision.strategy]+".\n";
      if(row.ready)answer+="Следующий шаг: можно открыть предметный пересмотр связи и сравнить варианты модели. Автоматического изменения решения не происходит.\n";
      answer+="\n";
    }
    answer+="Порог означает, что есть согласующиеся и противоположные прямые наблюдения, а контекст, время и критерий заполнены для каждого отдельного события. Дополняющие карточки можно объединить только при общем явном eventRef; сведения из ответов на исследовательские вопросы остаются отдельными и не заполняют поля конкретных наблюдений автоматически. Это достаточность для обсуждения пересмотра, а не доказательство причинности: записи остаются пользовательскими и не проверены независимо. Решения меняются только отдельной явной командой.\n";
    return answer;
  }
  function researchStrategyAnswer() {
    const refreshed=refreshInquiryQueue();
    if(!refreshed.open.length) {
      return "ПЛАН ИССЛЕДОВАНИЯ\n\nСейчас нет открытых исследовательских вопросов. Если в памяти появились новые наблюдения, сначала обнови очередь командой «Найди пробелы в знаниях». Полученные ответы можно посмотреть командой «Оцени ответы на вопросы».";
    }
    const baseWeight={contrast_observations:90,clarify_counterexample:72,missing_observation:54};
    const ranked=rankOpenInquiries();
    const candidates=ranked.map(row=>({item:row.item,impact:row.impact,score:Math.round(row.score*100),reasons:row.reasons}));
    const selected=candidates[0],item=selected.item;
    const kindReason={
      discriminating_observations:"В сохранённом выводе есть конкурирующие маршруты к одному результату. Полезнее всего найти естественные случаи, где различаются условия двух ветвей, а не собирать ещё одно общее подтверждение.",
      contrast_observations:"Для одного и того же звена сохранены наблюдения с разными результатами. Сначала нужно проверить, были ли случаи сопоставимы.",
      clarify_counterexample:"Есть потенциальный контрпример. До пересмотра связи важно уточнить, присутствовало ли исходное условие и как именно определялся результат.",
      missing_observation:"Причинное звено есть в выводах, но прямых наблюдений для его проверки пока не найдено."
    }[item.kind]||"Этот вопрос связан с незакрытым пробелом в сохранённых данных.";
    let answer="ПЛАН ИССЛЕДОВАНИЯ\n\n";
    answer+="ЦЕЛЬ\n"+(item.kind==="discriminating_observations"&&item.comparisonEdges.length>=2
      ?"Сопоставить конкурирующие ветви причинного вывода, не выдавая ни одну из них за установленный факт.\n\n"
      :"Уточнить звено «"+item.edgeSubject+" → "+item.edgeObject+"», не выдавая рабочую гипотезу за установленный факт.\n\n");
    answer+="ПОЧЕМУ ВЫБРАН ИМЕННО ЭТОТ ШАГ\n"+kindReason+"\n";
    answer+="Затрагивает разных сохранённых выводов: "+selected.impact+". ";
    answer+="Эвристический приоритет внимания: "+selected.score+"/100. Основания: "+(selected.reasons||[]).join("; ")+". Это рейтинг очередности работы, а не вероятность истинности связи.\n\n";
    answer+="СЛЕДУЮЩИЙ ВОПРОС · "+item.id+"\n"+item.question+"\n\n";
    if(item.kind==="discriminating_observations"&&item.comparisonEdges.length>=2) {
      answer+="ТЕКУЩИЕ ДАННЫЕ ПО РАЗЛИЧАЮЩИМСЯ ЗВЕНЬЯМ\n";
      for(const edge of item.comparisonEdges) {
        const readiness=reviewReadinessForEdge(edge.subject,edge.object);
        answer+=edge.subject+" → "+edge.object+": "+readiness.label+"; прямых наблюдений — "+readiness.totalCount+
          " (согласующихся — "+readiness.supportingCount+", противоположных — "+readiness.challengingCount+").\n";
        if(readiness.blockers.length)answer+="  Не хватает: "+readiness.blockers.join("; ")+".\n";
      }
    } else {
      const readiness=reviewReadinessForEdge(item.edgeSubject,item.edgeObject);
      answer+="ТЕКУЩАЯ ГОТОВНОСТЬ К ПЕРЕСМОТРУ\n"+readiness.label+".\n";
      if(readiness.blockers.length)answer+="Пока не хватает: "+readiness.blockers.join("; ")+".\n";
    }
    answer+="Ответ на выбранный вопрос может уточнить эти пробелы, но сам по себе не считается новым прямым наблюдением.\n\n";
    answer+="КАК Я РАЗБЕРУ ОТВЕТ\n";
    if(item.kind==="discriminating_observations") {
      answer+="• Если найдутся естественные случаи, где условия ветвей различались, сопоставлю исходные условия и общий результат.\n";
      answer+="• Если обе ветви встречались одновременно или условия нельзя разделить, отмечу это ограничение и не стану выбирать маршрут автоматически.\n";
      answer+="• Если таких случаев нет или они не помнятся, зафиксирую отсутствие ответа; специально создавать условия не требуется.\n";
    } else if(item.kind==="contrast_observations") {
      answer+="• Если время, условия или критерий результата различались, зафиксирую это как возможное объяснение расхождения; само звено автоматически не подтверждается.\n";
      answer+="• Если случаи были сопоставимы, противоречие останется видимым: ни одно наблюдение не будет удалено.\n";
      answer+="• Если контекст восстановить нельзя, неопределённость сохранится.\n";
    } else if(item.kind==="clarify_counterexample") {
      answer+="• Если исходное условие действительно присутствовало, а результат не наступил по тому же критерию, наблюдение останется потенциальным контрпримером.\n";
      answer+="• Если условие, время или критерий неясны, контрпример нельзя считать разрешённым.\n";
    } else {
      answer+="• Конкретные естественные наблюдения с контекстом, временем и критерием результата дадут материал для повторной оценки.\n";
      answer+="• Если таких записей нет, я отмечу подтверждённый пробел данных — это не поддержка и не опровержение связи.\n";
    }
    answer+="\nЧТО ИЗМЕНИТСЯ И ЧТО НЕТ\nОтвет уточнит полноту и сопоставимость данных, но не будет автоматически превращён в доказанный факт и сам по себе не сменит решение рабочей модели. Пользовательские сведения останутся непроверенными извне. Не нужно намеренно создавать какие-либо условия ради наблюдений.\n\n";
    answer+="ФОРМАТ ОТВЕТА\nНачни сообщение точно так: «Ответ на вопрос "+item.id+": ...». Тогда ответ будет связан с этим вопросом и сохранит своё происхождение.";
    return answer;
  }
  function researchGapsAnswer() {
    const r=refreshInquiryQueue();
    if(!r.open.length)return "ПОИСК ПРОБЕЛОВ ЗАВЕРШЁН\n\nНовых открытых вопросов не получилось сформировать. Возможно, в архиве пока нет подходящих причинных выводов или найденные вопросы уже получили ответы.\n\nОчередь доступна командой «Какие вопросы открыты?».";
    const focus=nextResearchFocus();
    return "ПОИСК ПРОБЕЛОВ ЗАВЕРШЁН\n\nНовых вопросов: "+r.added+". Открыто: "+r.open.length+". Уже получили ответ: "+r.answered.length+".\n\nВыбранный вопрос ранжирован по типу пробела, влиянию на другие выводы и истории внимания; рейтинг не является вероятностью истинности.\n\n"+presentInquiry(focus?focus.item:r.open[0]);
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
  function researchGoalsAnswer() {
    refreshInquiryQueue();
    syncResearchGoals();
    const manager = window.NGGoals;
    return manager && typeof manager.report === "function"
      ? manager.report()
      : "Слой исследовательских целей недоступен в этой сборке.";
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
    const responseText=String(response||"").trim().slice(0,MAX_TEXT);
    if(item.kind==="duplicate_observation") {
      const grouping=duplicateInquiryGrouping(responseText,item.sourceClaimIds);
      if(!grouping) {
        item.clarificationNote=responseText.slice(0,700);
        item.updatedAt=Date.now();persist();
        return "УТОЧНЕНИЕ ПО "+item.id+" ПОКА НЕОДНОЗНАЧНО\nТекст сохранён, но группировка карточек не изменена. Используй «один эпизод», «разные эпизоды» или полное разбиение вида «группы: 1+2; 3; 4+5». В разбиении каждый номер карточки должен встретиться ровно один раз.";
      }
      const resolution=grouping.resolution;
      const applied=applyDuplicateInquiryResolution(item,grouping);
      if(applied.updated<2) {
        item.clarificationNote="Не удалось найти исходные карточки для применения ответа: "+applied.missing.join(", ");
        item.updatedAt=Date.now();persist();
        return "НЕ УДАЛОСЬ ПРИМЕНИТЬ УТОЧНЕНИЕ "+item.id+"\nЯ не нашёл минимум две исходные карточки в памяти. Никакие идентификаторы событий не изменены; проверь, не были ли записи удалены.";
      }
      item.status="answered";item.responseText=responseText;item.responseMemoryId=memory&&memory.id||"";
      item.responseDetails=KNOWLEDGE?KNOWLEDGE.parseObservationDetails(responseText,"inquiry_response"):null;
      if(item.responseDetails)item.responseDetails.sourceRef=item.id;
      item.responseClaimIds=[];item.answeredAt=Date.now();item.updatedAt=item.answeredAt;
      applyInquiryAssessment(item);persist();
      const same=resolution==="same_event";
      const separate=resolution==="separate_events";
      const description=same?"Карточкам присвоен общий идентификатор одного события.":
        separate?"Каждой карточке присвоен отдельный идентификатор события.":
        "Карточки распределены по нескольким группам: внутри группы общий идентификатор, между группами разные.";
      return "УТОЧНЕНИЕ ПРИМЕНЕНО · "+item.id+"\n"+description+
        " Исходные записи и их тексты сохранены; изменена только привязка к эпизодам. Число отдельных групп: "+item.resolvedEventRefs.length+"."+
        " Причинная связь от этого не считается подтверждённой.";
    }
    item.status="answered";item.responseText=responseText;
    item.responseMemoryId=memory&&memory.id||"";
    item.responseDetails=KNOWLEDGE?KNOWLEDGE.parseObservationDetails(item.responseText,"inquiry_response"):null;
    if(item.responseDetails)item.responseDetails.sourceRef=item.id;
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
          evidence:String(claim.evidence||"").slice(0,240),
          eventRef:claim.kind==="observation"?String(claim.observationCase&&claim.observationCase.eventRef||""):""};
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
          eventRef:claim.kind==="observation"?String(claim.observationCase&&claim.observationCase.eventRef||""):"",
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
    return reconcileHypothesisMeta(updateReasoningStatus(meta));
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
      entry.reasoning=reconcileHypothesisMeta(meta);
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
    refreshHypothesisLifecycleArchive();
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
    refreshHypothesisLifecycleArchive();
    const ok=persist();
    return "Связь "+existing.edgeSubject+" → "+existing.edgeObject+" возвращена в активную рабочую модель. Она снова может участвовать в новых выводах, но прежний контрпример остаётся видимым, а сама связь не становится доказанной."+
      (ok?"":" Локальное сохранение решения не подтвердилось.");
  }
  function buildCausalModelRevision() {
    const tracked=reasoningArchive.slice();
    if(!tracked.length)return "Пока нет причинных выводов с сохранёнными ссылками на исходные записи. Сначала попроси меня вывести причинную цепочку или новые гипотезы.";
    const excludedMap=new Map();
    for(const entry of tracked) {
      const meta=cleanReasoning(entry.reasoning);
      for(const item of meta&&meta.excludedPaths||[]) {
        const key=item.origin+"|"+item.subject+"|"+item.object+"|"+item.route.map(edge=>edge.subject+">"+edge.object).join(">");
        excludedMap.set(key,item);
      }
    }
    const excludedRows=[...excludedMap.values()].slice(0,12);
    const excludedSection=()=>{
      if(!excludedRows.length)return "";
      let section="АРХИВНЫЕ МАРШРУТЫ, ИСКЛЮЧЁННЫЕ ПРИ ПРОВЕРКЕ ФОРМЫ\n";
      for(const item of excludedRows) {
        const route=item.route.length?[item.route[0].subject,...item.route.map(edge=>edge.object)].join(" → "):item.subject+" → "+item.object;
        section+="• "+route+" — исключён из активного анализа: в старом маршруте обнаружена некорректная форма причинного субъекта.\n";
      }
      section+="Старые сообщения диалога и исходные воспоминания не удаляются. Исправлена только структурированная копия архивного маршрута; исключённый путь больше не используется для новых выводов.\n\n";
      return section;
    };
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
      entry.reasoning=reconcileHypothesisMeta(meta);
      syncArchivedReasoning(entry);
      reports.push({entry,meta:entry.reasoning,edgeStates,challengedEdges,alternatives});
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
    if(!uniqueReports.length)return "В истории есть записи, но в них нет пригодных причинных маршрутов для перестройки модели.\n\n"+excludedSection();
    let answer="ПЕРЕСМОТРЕННАЯ ПРИЧИННАЯ МОДЕЛЬ\n\n";
    answer+="Я не переписываю исходные воспоминания. Ниже — текущая оценка маршрутов и возможные варианты структуры.\n\n";
    answer+=excludedSection();
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
      entry.reasoning=reconcileHypothesisMeta(meta);
      syncArchivedReasoning(entry);
      if(JSON.stringify(entry.reasoning)!==JSON.stringify(meta))changed=true;
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

  function modelEvolutionAnswer() {
    const refreshNote=buildCausalModelRevision();
    if(!reasoningArchive.length) return refreshNote;
    const allClaims=memories.flatMap(item=>item.claims||[]);
    const claimsById=new Map(allClaims.filter(claim=>claim&&typeof claim.id==="string").map(claim=>[claim.id,claim]));
    const entityKey=value=>KNOWLEDGE&&typeof KNOWLEDGE.canonicalEntity==="function"
      ?KNOWLEDGE.canonicalEntity(value):normalise(value);
    const edgeKey=edge=>entityKey(edge.subject)+"|"+entityKey(edge.object);
    const statusLabel=status=>({
      challenged:"ПОД ВОПРОСОМ",
      observed:"ЕСТЬ СОГЛАСУЮЩЕЕСЯ НАБЛЮДЕНИЕ",
      unobserved:"НЕТ ОТДЕЛЬНЫХ НАБЛЮДЕНИЙ"
    })[status]||"НЕ ОЦЕНЕНО";
    const decisionLabel=decision=>({
      conditional:"СВЯЗЬ ОСТАВЛЕНА УСЛОВНОЙ",
      weaken:"СВЯЗЬ ОСЛАБЛЕНА",
      suspend:"СВЯЗЬ ВРЕМЕННО ПРИОСТАНОВЛЕНА",
      restore:"СВЯЗЬ ВОЗВРАЩЕНА В АКТИВНУЮ МОДЕЛЬ"
    })[decision]||"НЕТ ВЫБРАННОГО РЕШЕНИЯ";
    const pathRows=snapshot=>(snapshot.alternatives||[]).flatMap(item=>(item.paths||[]).map(path=>{
      const route=path.length?[path[0].subject,...path.map(edge=>edge.object)].join(" → "):"";
      const key=entityKey(item.subject)+"|"+entityKey(item.object)+"|"+path.map(edge=>edgeKey(edge)).join(">");
      return {key,subject:item.subject,object:item.object,route};
    })).filter(item=>item.route);
    const reports=[];
    for(const entry of reasoningArchive.slice().reverse()) {
      const meta=cleanReasoning(entry.reasoning);
      if(!meta||meta.modelHistory.length<2)continue;
      const previous=meta.modelHistory[meta.modelHistory.length-2];
      const current=meta.modelHistory[meta.modelHistory.length-1];
      const beforeEdges=new Map((previous.edges||[]).map(edge=>[edgeKey(edge),edge]));
      const afterEdges=new Map((current.edges||[]).map(edge=>[edgeKey(edge),edge]));
      const changes=[];
      for(const [key,edge] of afterEdges) {
        const old=beforeEdges.get(key);
        if(!old) {
          changes.push("В снимке появилась связь: "+edge.subject+" → "+edge.object+" — "+statusLabel(edge.status)+".");
          continue;
        }
        if(old.status!==edge.status) {
          changes.push("Статус связи "+edge.subject+" → "+edge.object+": "+statusLabel(old.status)+" → "+statusLabel(edge.status)+".");
        }
        if((old.decision||null)!==(edge.decision||null)) {
          changes.push("Решение по связи "+edge.subject+" → "+edge.object+": "+decisionLabel(old.decision)+" → "+decisionLabel(edge.decision)+".");
        }
        const oldIds=new Set(old.claimIds||[]);
        const newIds=(edge.claimIds||[]).filter(id=>!oldIds.has(id));
        if(newIds.length) {
          const descriptions=newIds.slice(0,3).map(id=>{
            const claim=claimsById.get(id);
            return claim&&claim.evidence?"«"+claim.evidence+"»":"запись "+id;
          });
          changes.push("Новые записи, учтённые для "+edge.subject+" → "+edge.object+": "+descriptions.join("; ")+".");
        }
        const currentIds=new Set(edge.claimIds||[]);
        const removedIds=(old.claimIds||[]).filter(id=>!currentIds.has(id));
        if(removedIds.length) {
          changes.push("В новом снимке больше нет ссылок на "+removedIds.length+" прежн"+
            (removedIds.length===1?"ю запись":"ие записи")+" по связи "+edge.subject+" → "+edge.object+
            ". Это не означает, что сами воспоминания удалены.");
        }
      }
      for(const [key,edge] of beforeEdges) {
        if(!afterEdges.has(key))changes.push("Связь отсутствует в новом снимке: "+edge.subject+" → "+edge.object+
          ". Это изменение структуры вывода, а не доказательство ложности исходной записи.");
      }
      const beforePaths=new Map(pathRows(previous).map(item=>[item.key,item]));
      const afterPaths=new Map(pathRows(current).map(item=>[item.key,item]));
      for(const [key,item] of afterPaths) {
        if(!beforePaths.has(key))changes.push("Добавился альтернативный маршрут для "+item.subject+" ⇢ "+item.object+
          ": "+item.route+" (кандидатная цепочка, не подтверждение причинности).");
      }
      for(const [key,item] of beforePaths) {
        if(!afterPaths.has(key))changes.push("Альтернативный маршрут больше не выводится для "+item.subject+" ⇢ "+item.object+
          ": "+item.route+". Его исчезновение из расчёта само по себе ничего не опровергает.");
      }
      if(changes.length)reports.push({entry,previous,current,meta,changes});
      if(reports.length>=6)break;
    }
    if(!reports.length) {
      const hasSnapshots=reasoningArchive.some(entry=>{
        const meta=cleanReasoning(entry.reasoning);
        return meta&&meta.modelHistory.length>0;
      });
      if(!hasSnapshots) return "Не удалось сохранить исходный снимок причинной модели. Сначала выведи новую гипотезу, затем построй обновлённую причинную модель.";
      return "ИСТОРИЯ ИЗМЕНЕНИЙ ПРИЧИННОЙ МОДЕЛИ\n\n"+
        "Пока есть только исходные снимки либо два последних снимка не различаются по статусам связей, решениям, учтённым записям и альтернативным маршрутам.\n"+
        "Чтобы история стала содержательной, системе нужны новые естественные наблюдения, ответы на исследовательские вопросы или явно выбранное решение по рабочей модели.\n\n"+
        "Отсутствие изменений не является подтверждением истинности гипотез.";
    }
    let answer="ДИНАМИКА ПРИЧИННОЙ МОДЕЛИ\n\n";
    answer+="Сравниваются два последних сохранённых снимка каждого вывода. Изменения показывают эволюцию рабочей модели, а не объективное доказательство причинности.\n\n";
    for(const report of reports) {
      const title=report.meta.conclusions.map(item=>item.subject+" ⇢ "+item.object).slice(0,3).join("; ");
      answer+="ВЫВОД: "+(title||"причинная гипотеза")+"\n";
      answer+="Снимки: "+formatDate(report.previous.at)+" → "+formatDate(report.current.at)+"\n";
      for(const change of report.changes.slice(0,12))answer+="• "+change+"\n";
      answer+="\n";
    }
    answer+="Исходные воспоминания, наблюдения и контрпримеры не переписываются. Изменение статуса означает лишь, что рабочая модель теперь учитывает другой набор доступных сведений. Новые маршруты остаются гипотезами, пока не появятся независимые данные.";
    return answer;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
      memoryMigrated = Array.isArray(saved) && saved.some(item => item && (
        ((!Array.isArray(item.claims) || item.claims.length === 0) && KNOWLEDGE && KNOWLEDGE.extractClaims(item.text).length > 0) ||
        (Array.isArray(item.claims) && KNOWLEDGE && (KNOWLEDGE.sanitizeClaims(item.claims,item.text).length !== item.claims.length || item.claims.some(claim=>claim&&claim.kind==="observation"&&(!claim.observationCase||claim.observationCase.schema!==2||claim.sourceMemoryId!==item.id))))
      ));
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
      if(JSON.stringify(savedArchive)!==JSON.stringify(reasoningArchive))memoryMigrated=true;
    } catch(error) {
      reasoningArchive=mergeReasoningArchive([],dialog);
      console.warn("Could not load NEUROGENESIS reasoning archive:",error);
    }
    try {
      const savedInquiries=JSON.parse(localStorage.getItem(INQUIRIES_KEY)||"[]");
      inquiries=mergeInquiryHistory([],savedInquiries);
       if(Array.isArray(savedInquiries)&&savedInquiries.some(item=>item&&item.status==="answered"&&!item.responseDetails))memoryMigrated=true;
      if(reconcileInquiryResponsesFromEntries(dialog))memoryMigrated=true;
      if(assessAnsweredInquiries())memoryMigrated=true;
      if(clearLegacyInquiryFragmentClaims())memoryMigrated=true;
    } catch(error) {
      inquiries=[];nextInquiryNumber=1;
      console.warn("Could not load NEUROGENESIS inquiry queue:",error);
    }
    try {
      const savedCycles=JSON.parse(localStorage.getItem(COGNITIVE_CYCLES_KEY)||"[]");
      cognitiveCycles=Array.isArray(savedCycles)?savedCycles.map(cleanCognitiveCycle).filter(Boolean).slice(-MAX_COGNITIVE_CYCLES):[];
      nextCognitiveCycleNumber=Math.max(1,...cognitiveCycles.map(item=>item.sequence+1));
    } catch(error) {
      cognitiveCycles=[];nextCognitiveCycleNumber=1;
      console.warn("Could not load NEUROGENESIS cognitive cycles:",error);
    }
    try {
      const savedEvidence=JSON.parse(localStorage.getItem(MODEL_EVIDENCE_KEY)||"[]");
      modelEvidence=mergeModelEvidenceHistory([],savedEvidence);
      if(JSON.stringify(savedEvidence)!==JSON.stringify(modelEvidence))memoryMigrated=true;
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
    if(refreshHypothesisLifecycleArchive())memoryMigrated=true;
    if (memoryMigrated) { memoryMigrated = false; persist(); }
  }
  function syncResearchGoals(focus = null) {
    const manager = window.NGGoals;
    if (!manager || typeof manager.reconcile !== "function") return null;
    try { return manager.reconcile({inquiries,memories,focus,now:Date.now()}); }
    catch (error) { console.warn("NEUROGENESIS research-goal update failed:",error); return null; }
  }
  function persist() {
    updateCount();
    syncResearchGoals();
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
      if (KNOWLEDGE_GRAPH) {
        const graph = KNOWLEDGE_GRAPH.create(KNOWLEDGE).build(memories);
        knowledgeCount.textContent = graph.stats.nodes + " УЗЛОВ · " +
          graph.stats.edges + " СВЯЗЕЙ · " + graph.stats.conflicts + " КОНФЛИКТОВ";
      } else {
        const summary = KNOWLEDGE.summary(memories.flatMap(item => item.claims || []));
        knowledgeCount.textContent = summary.total + " СТРУКТУРНЫХ ЗНАНИЙ · " + summary.conflicts + " КОНФЛИКТОВ";
      }
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
    const clean=reasoning?reconcileHypothesisMeta(reasoning):null;
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
  const COGNITIVE_PHASE_NAMES = ["perception","attention","memory","reasoning","verification","learning","model_update"];
  function cleanCognitiveCycle(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.phases)) return null;
    const allowed = new Set(COGNITIVE_PHASE_NAMES);
    const phases = raw.phases.filter(item => item && allowed.has(item.name)).slice(0,7).map(item => ({
      name:item.name,
      status:["complete","limited","skipped","error"].includes(item.status)?item.status:"limited",
      summary:typeof item.summary==="string"?item.summary.slice(0,260):""
    }));
    if (!phases.length) return null;
    const sequence=Math.max(1,Math.floor(Number(raw.sequence)||1));
    return {
      id:typeof raw.id==="string"?raw.id.slice(0,24):"C"+sequence,
      sequence,
      at:safeTime(raw.at,Date.now()),
      mode:raw.mode==="remember"?"remember":"ask",
      intent:typeof raw.intent==="string"?raw.intent.slice(0,48):"general",
      status:["complete","partial","error"].includes(raw.status)?raw.status:"partial",
      phases,
      attentionDetails:Array.isArray(raw.attentionDetails)?raw.attentionDetails.slice(0,8).map(item=>({
        memoryId:typeof item.memoryId==="string"?item.memoryId.slice(0,100):"",
        score:Math.max(0,Math.min(1,Number(item.score)||0)),
        relevance:Math.max(0,Math.min(1,Number(item.relevance)||0)),
        reasons:Array.isArray(item.reasons)?item.reasons.filter(x=>typeof x==="string").slice(0,4).map(x=>x.slice(0,100)):[]
      })):[],
      uncertainty:{
        level:["low","medium","high"].includes(raw.uncertainty&&raw.uncertainty.level)?raw.uncertainty.level:"medium",
        supportIndex:Math.max(0,Math.min(100,Math.round(Number(raw.uncertainty&&raw.uncertainty.supportIndex)||0))),
        reasons:Array.isArray(raw.uncertainty&&raw.uncertainty.reasons)?raw.uncertainty.reasons.filter(x=>typeof x==="string").slice(0,6).map(x=>x.slice(0,160)):["для старого цикла оценка ещё не сохранялась"],
        evidenceCount:Math.max(0,Number(raw.uncertainty&&raw.uncertainty.evidenceCount)||0),
        conflictCount:Math.max(0,Number(raw.uncertainty&&raw.uncertainty.conflictCount)||0),
        independentSources:Math.max(0,Number(raw.uncertainty&&raw.uncertainty.independentSources)||0)
      },
      focus:raw.focus&&typeof raw.focus==="object"?{
        inquiryId:typeof raw.focus.inquiryId==="string"?raw.focus.inquiryId.slice(0,24):"",
        score:Math.max(0,Math.min(100,Math.round(Number(raw.focus.score)||0))),
        reasons:Array.isArray(raw.focus.reasons)?raw.focus.reasons.filter(x=>typeof x==="string").slice(0,4).map(x=>x.slice(0,120)):[]
      }:null,
      goals:raw.goals&&typeof raw.goals==="object"?{
        total:Math.max(0,Math.floor(Number(raw.goals.total)||0)),
        active:Math.max(0,Math.floor(Number(raw.goals.active)||0)),
        waiting:Math.max(0,Math.floor(Number(raw.goals.waiting)||0)),
        blocked:Math.max(0,Math.floor(Number(raw.goals.blocked)||0)),
        review:Math.max(0,Math.floor(Number(raw.goals.review)||0)),
        paused:Math.max(0,Math.floor(Number(raw.goals.paused)||0)),
        completed:Math.max(0,Math.floor(Number(raw.goals.completed)||0)),
        focusId:typeof raw.goals.focusId==="string"?raw.goals.focusId.slice(0,24):""
      }:null,
      metrics:{
        inputTokens:Math.max(0,Number(raw.metrics&&raw.metrics.inputTokens)||0),
        parsedClaims:Math.max(0,Number(raw.metrics&&raw.metrics.parsedClaims)||0),
        attentionMatches:Math.max(0,Number(raw.metrics&&raw.metrics.attentionMatches)||0),
        memoryBefore:Math.max(0,Number(raw.metrics&&raw.metrics.memoryBefore)||0),
        memoryAfter:Math.max(0,Number(raw.metrics&&raw.metrics.memoryAfter)||0),
        memoryAdded:Math.max(0,Number(raw.metrics&&raw.metrics.memoryAdded)||0),
        memoryUpdated:Math.max(0,Number(raw.metrics&&raw.metrics.memoryUpdated)||0),
        claimCount:Math.max(0,Number(raw.metrics&&raw.metrics.claimCount)||0),
        conflictCount:Math.max(0,Number(raw.metrics&&raw.metrics.conflictCount)||0),
        openQuestions:Math.max(0,Number(raw.metrics&&raw.metrics.openQuestions)||0),
        newQuestions:Math.max(0,Number(raw.metrics&&raw.metrics.newQuestions)||0),
        attentionTopScore:Math.max(0,Math.min(100,Math.round(Number(raw.metrics&&raw.metrics.attentionTopScore)||0))),
        supportIndex:Math.max(0,Math.min(100,Math.round(Number(raw.metrics&&raw.metrics.supportIndex)||0))),
        researchFocusScore:Math.max(0,Math.min(100,Math.round(Number(raw.metrics&&raw.metrics.researchFocusScore)||0))),
        goalCount:Math.max(0,Math.floor(Number(raw.metrics&&raw.metrics.goalCount)||0)),
        activeGoals:Math.max(0,Math.floor(Number(raw.metrics&&raw.metrics.activeGoals)||0)),
        blockedGoals:Math.max(0,Math.floor(Number(raw.metrics&&raw.metrics.blockedGoals)||0))
      },
      memoryIds:Array.isArray(raw.memoryIds)?raw.memoryIds.filter(x=>typeof x==="string").slice(0,8):[],
      claimIds:Array.isArray(raw.claimIds)?raw.claimIds.filter(x=>typeof x==="string").slice(0,12):[]
    };
  }
  function cognitiveIntent(mode,input) {
    if(mode==="remember")return "memory_write";
    const q=normalise(input);
    if(/жизненн.*цикл гипотез|состояни.*гипотез/u.test(q))return "hypothesis_lifecycle";
    if(/хронолог|временн.*шкал/u.test(q))return "event_timeline";
    if(/сопостав.*опыт|сравни.*наблюдени/u.test(q))return "experience_review";
    if(/журнал наблюден|карточк.*наблюден/u.test(q))return "observation_review";
    if(/готовност.*пересмотр|достаточност.*наблюден/u.test(q))return "evidence_readiness";
    if(/исследовательск.*шаг|план исследования|стратеги.*исследован/u.test(q))return "research_planning";
    if(/пробел.*знан|вопрос.*провер/u.test(q))return "research_gap_scan";
    if(/текущ.*цел|покажи.*цел|какие у тебя цел|над чем ты работаешь|прогресс цел/u.test(q))return "goal_monitoring";
    if(/задай.*вопрос|следующ.*вопрос|что тебе нужно уточнить/u.test(q))return "research_question";
    if(/причинн.*модел|пересмотр.*модел/u.test(q))return "model_revision";
    if(/гипотез/u.test(q))return "hypothesis_reasoning";
    if(/почему|причин|вызывает|приводит/u.test(q))return "causal_reasoning";
    if(/кто ты|что ты умеешь|создател/u.test(q))return "identity_query";
    if(/что ты знаешь|расскажи/u.test(q))return "knowledge_query";
    return "general_question";
  }
  function attentionSelection(query) {
    const candidates=memories.map(item=>({
      item,match:matchMemory(query,item),strength:Math.max(0,Math.min(1,Number(item.strength)||0.6)),
      repetitions:Math.max(1,Number(item.repetitions)||1),updatedAt:Number(item.updatedAt)||Number(item.createdAt)||0
    })).filter(row=>row.match.score>=0.035).sort((a,b)=>b.match.score-a.match.score).slice(0,24);
    const candidateClaims=candidates.flatMap(row=>row.item.claims||[]).slice(0,180);
    const conflicts=KNOWLEDGE&&KNOWLEDGE.findConflicts?KNOWLEDGE.findConflicts(candidateClaims):[];
    const conflictedIds=new Set(conflicts.flatMap(item=>[item.left&&item.left.id,item.right&&item.right.id]).filter(Boolean));
    const kindValue={observation:0.15,causal:0.11,rule:0.10,hypothesis:0.08,relationship:0.07,
      preference:0.06,fact:0.06,identity:0.05,definition:0.04,opinion:0.03};
    const now=Date.now();
    return candidates.map(row=>{
      const claims=row.item.claims||[];
      const evidenceValue=Math.min(1,Math.max(0,...claims.map(claim=>
        (kindValue[claim.kind]||0.02)+(claim.kind==="observation"&&claim.polarity===false?0.04:0))));
      const conflictCount=claims.filter(claim=>claim.id&&conflictedIds.has(claim.id)).length;
      const recurrence=Math.min(1,Math.log2(1+row.repetitions)/Math.log2(9));
      const ageDays=row.updatedAt?Math.max(0,(now-row.updatedAt)/86400000):365;
      const recency=1/(1+ageDays/30),relevance=Math.max(0,Math.min(1,row.match.score));
      const score=Math.max(0,Math.min(1,relevance*0.56+row.strength*0.10+recurrence*0.06+
        recency*0.04+evidenceValue*0.12+(conflictCount?0.12:0)));
      const reasons=[];
      if(row.match.directHits)reasons.push("прямое совпадение");
      if(row.match.associativeHits)reasons.push("ассоциативное совпадение");
      if(conflictCount)reasons.push("содержит утверждения с возможным конфликтом");
      if(claims.some(claim=>claim.kind==="observation"))reasons.push("содержит карточку наблюдения");
      if(claims.some(claim=>claim.kind==="causal"||claim.kind==="rule"))reasons.push("связано с причинной моделью");
      if(row.repetitions>1)reasons.push("повторно использовалось");
      if(recency>0.75)reasons.push("недавно обновлялось");
      return {item:row.item,score,relevance,directHits:row.match.directHits,
        associativeHits:row.match.associativeHits,conflictCount,reasons:reasons.slice(0,4)};
    }).sort((a,b)=>b.score-a.score||b.relevance-a.relevance).slice(0,8);
  }
  function rankOpenInquiries(query="",focusClaimIds=[]) {
    const open=inquiries.filter(item=>item.status==="open");
    if(!open.length)return [];
    const focusIds=new Set((Array.isArray(focusClaimIds)?focusClaimIds:[]).filter(Boolean));
    const claimsById=new Map(memories.flatMap(item=>item.claims||[]).filter(claim=>claim&&claim.id).map(claim=>[claim.id,claim]));
    const kindValue={duplicate_observation:1,discriminating_observations:0.99,contrast_observations:0.96,clarify_counterexample:0.84,missing_observation:0.66};
    const queryText=String(query||"").trim();
    return open.map(item=>{
      const linked=(item.sourceClaimIds||[]).map(id=>claimsById.get(id)).filter(Boolean);
      const searchText=[item.question,item.reason,item.edgeSubject,item.edgeObject,
        ...(item.comparisonEdges||[]).flatMap(edge=>[edge.subject,edge.object]),...linked.map(claim=>claim.evidence)].join(" ");
      const relevance=queryText&&KNOWLEDGE&&KNOWLEDGE.semanticMatch
        ?KNOWLEDGE.semanticMatch(queryText,searchText).score:0;
      const priority=item.priority<=-1?1:item.priority===0?0.9:item.priority===1?0.78:0.62;
      const impact=typeof researchImpactForInquiry==="function"?researchImpactForInquiry(item):0;
      const impactScore=Math.min(1,Math.max(0,impact-1)/4);
      const overlap=linked.length?linked.filter(claim=>focusIds.has(claim.id)).length/linked.length:0;
      const fairness=item.lastAskedAt?Math.min(1,Math.max(0,(Date.now()-item.lastAskedAt)/3600000)):1;
      const kind=kindValue[item.kind]||0.55;
      const score=Math.max(0,Math.min(1,kind*0.26+priority*0.18+impactScore*0.18+
        relevance*0.22+overlap*0.10+fairness*0.06));
      const reasons=[];
      if(item.kind==="duplicate_observation")reasons.push("нужно установить идентичность событий");
      else if(item.kind==="discriminating_observations")reasons.push("нужно различить конкурирующие причинные маршруты");
      else if(item.kind==="contrast_observations")reasons.push("есть противоположные наблюдения");
      else if(item.kind==="clarify_counterexample")reasons.push("есть потенциальный контрпример");
      else reasons.push("не хватает прямых наблюдений");
      if(impact>1)reasons.push("затрагивает несколько сохранённых выводов");
      if(relevance>0.08)reasons.push("связан с текущей темой");
      if(overlap>0)reasons.push("затрагивает новые сведения");
      if(fairness>0.85)reasons.push("давно не задавался");
      return {item,score,relevance,impact,reasons:reasons.slice(0,4)};
    }).sort((a,b)=>b.score-a.score||a.item.createdAt-b.item.createdAt);
  }
  function nextResearchFocus(query="",focusClaimIds=[]) {
    return rankOpenInquiries(query,focusClaimIds)[0]||null;
  }
  function assessCognitiveUncertainty(answer,intent,claims,conflicts,attentionCount,mode) {
    const text=String(answer||""),relevant=Array.isArray(claims)?claims:[];
    const conflictCount=Array.isArray(conflicts)?conflicts.length:0,reasons=[];
    let supportIndex=88;
    const noMatch=/не наш[её]л|не найдено|нет достаточно близкой информации|память пока пуста/u.test(text);
    const cautious=/возможн|потенциальн|непроверенн|гипотез|предполож/u.test(text);
    const sensitive=["causal_reasoning","hypothesis_reasoning","research_planning","model_revision","research_gap_scan"].includes(intent);
    const observations=relevant.filter(claim=>claim.kind==="observation").length;
    const independentSources=new Set(relevant.map(claim=>claim.independentSourceId||claim.sourceRef).filter(Boolean)).size;
    if(noMatch){supportIndex-=55;reasons.push("подходящие сведения в памяти не найдены");}
    if(!attentionCount&&mode==="ask"&&!noMatch){supportIndex-=12;reasons.push("внимание не нашло связанных воспоминаний");}
    if(conflictCount){supportIndex-=Math.min(36,18+conflictCount*6);reasons.push("в связанных утверждениях обнаружены противоречия");}
    if(cautious){supportIndex-=10;reasons.push("ответ содержит предварительные или гипотетические выводы");}
    if(sensitive&&!observations){supportIndex-=22;reasons.push("нет прямых карточек наблюдений для проверки");}
    if(sensitive&&relevant.length&&independentSources===0){
      supportIndex-=8;reasons.push("используются пользовательские записи без независимых внешних источников");
    }
    if(!reasons.length)reasons.push("прямых препятствий в выбранных данных не обнаружено");
    supportIndex=Math.max(0,Math.min(100,Math.round(supportIndex)));
    return {level:supportIndex>=75?"low":supportIndex>=45?"medium":"high",supportIndex,
      reasons:[...new Set(reasons)].slice(0,6),evidenceCount:relevant.length,conflictCount,independentSources};
  }

  function beginCognitiveCycle(mode,raw) {
    const input=String(raw||"").trim().slice(0,MAX_TEXT);
    const parsed=mode==="remember"&&KNOWLEDGE?KNOWLEDGE.extractClaims(input):[];
    const attention=attentionSelection(input);
    const before=new Map(memories.map(item=>[item.id,{
      strength:Number(item.strength)||0,
      repetitions:Number(item.repetitions)||1,
      recalls:Number(item.recalls)||0,
      updatedAt:Number(item.updatedAt)||0
    }]));
    return {
      sequence:nextCognitiveCycleNumber++,
      mode,
      intent:cognitiveIntent(mode,input),
      inputTokens:[...new Set(tokens(input))].length,
      parsedClaims:parsed,
      attention,
      before,
      beforeMemoryCount:memories.length,
      beforeClaimIds:new Set(memories.flatMap(item=>item.claims||[]).map(claim=>claim.id).filter(Boolean)),
      beforeInquiryIds:new Set(inquiries.map(item=>item.id)),
      beforeDialogCount:dialog.length
    };
  }
  function cognitiveReasoningKind(intent,answer,mode) {
    if(mode==="remember")return "memory_encoding";
    const text=String(answer||"");
    if(/ВОПРОС ДЛЯ УТОЧНЕНИЯ/u.test(text))return "research_question";
    if(/ХРОНОЛОГИЯ НАБЛЮДЕНИЙ/u.test(text))return "event_timeline";
    if(/СОПОСТАВЛЕНИЕ ОПЫТА/u.test(text))return "experience_review";
    if(/ПРОВЕРКА ГИПОТЕЗЫ|КОНТРПРИМЕР/u.test(text))return "hypothesis_check";
    if(/НОВЫЕ ГИПОТЕЗЫ|ПРИОРИТЕТ ПРОВЕРКИ/u.test(text))return "hypothesis_generation";
    if(/ПРИЧИННАЯ ЦЕПОЧКА|АЛЬТЕРНАТИВНЫЕ ОБЪЯСНЕНИЯ/u.test(text))return "causal_inference";
    if(/ИСТОРИЯ ИЗМЕНЕНИЙ ПРИЧИННОЙ МОДЕЛИ|ДИНАМИКА ПРИЧИННОЙ МОДЕЛИ/u.test(text))return "model_revision";
    if(/не нашёл в своей памяти|не нашел в своей памяти|пока нет достаточно близкой информации/u.test(text))return "no_match";
    if(/не буду выбирать|возможное противоречие|противореч/u.test(text))return "conflict_review";
    if(/По твоему сообщению|Ты сообщал мне|В моей памяти записано|В сохранённой записи/u.test(text))return "structured_retrieval";
    return intent==="general_question"?"associative_retrieval":"rule_based_reasoning";
  }
  function finishCognitiveCycle(context,result,error) {
    const successful=!error&&result!==false;
    let inquiryRefresh={added:0,open:openInquiries()};
    if(successful&&context.mode==="remember") {
      try { inquiryRefresh=refreshInquiryQueue(); }
      catch(refreshError) { console.warn("NEUROGENESIS inquiry refresh failed:",refreshError); }
    }
    const allClaims=memories.flatMap(item=>item.claims||[]);
    const newClaims=allClaims.filter(claim=>claim.id&&!context.beforeClaimIds.has(claim.id));
    const selectedMemoryIds=context.attention.map(hit=>hit.item.id);
    const selectedClaims=context.attention.flatMap(hit=>hit.item.claims||[]);
    const claimsToCheck=[...new Map([...selectedClaims,...newClaims].filter(claim=>claim&&claim.id).map(claim=>[claim.id,claim])).values()];
    const conflicts=KNOWLEDGE&&KNOWLEDGE.findConflicts?KNOWLEDGE.findConflicts(claimsToCheck):[];
    const relevantNewIds=new Set(newClaims.map(claim=>claim.id));
    const relevantMemoryIds=new Set(selectedMemoryIds);
    const relevantConflicts=conflicts.filter(item=>
      relevantNewIds.has(item.left&&item.left.id)||relevantNewIds.has(item.right&&item.right.id)||
      relevantMemoryIds.size&&[...relevantMemoryIds].some(id=>context.attention.some(hit=>hit.item.id===id&&
        (hit.item.claims||[]).some(claim=>claim.id===item.left.id||claim.id===item.right.id)))
    );
    const lastAssistant=[...dialog].reverse().find(item=>item.role==="assistant");
    const answer=lastAssistant&&lastAssistant.text||"";
    const newMemoryIds=memories.filter(item=>!context.before.has(item.id)).map(item=>item.id);
    const updatedMemoryIds=memories.filter(item=>{
      const old=context.before.get(item.id);
      return old&&(Number(item.strength||0)>old.strength+0.0001||
        Number(item.repetitions||1)>old.repetitions||Number(item.recalls||0)>old.recalls||
        Number(item.updatedAt||0)>old.updatedAt);
    }).map(item=>item.id);
    const newQuestionIds=inquiries.filter(item=>!context.beforeInquiryIds.has(item.id)).map(item=>item.id);
    const knowledgeSummary=KNOWLEDGE&&KNOWLEDGE.summary?KNOWLEDGE.summary(allClaims):{total:allClaims.length};
    const uncertainty=assessCognitiveUncertainty(answer,context.intent,claimsToCheck,relevantConflicts,context.attention.length,context.mode);
    const focus=nextResearchFocus(context.input,newClaims.map(claim=>claim.id));
    const goalState=syncResearchGoals(focus);
    const reasoningKind=cognitiveReasoningKind(context.intent,answer,context.mode);
    const phase=(name,status,summary)=>({name,status,summary});
    const phases=[
      phase("perception","complete",
        "Вход распознан; токенов: "+context.inputTokens+"; выделено структурных утверждений: "+context.parsedClaims.length+"."),
      phase("attention",context.attention.length?"complete":"limited",
        "Оценены релевантность, сила следа, повторяемость, недавность, тип знания и конфликты; отобрано: "+context.attention.length+" записей."),
      phase("memory",successful?"complete":"limited",
        context.mode==="remember"
          ?"Память: "+context.beforeMemoryCount+" → "+memories.length+"; новых записей: "+newMemoryIds.length+"; обновлено: "+updatedMemoryIds.length+"."
          :"Извлечение завершено; релевантных записей: "+selectedMemoryIds.length+"."),
      phase("reasoning",answer?"complete":"limited",
        "Тип обработки: "+reasoningKind+". Использован встроенный набор правил, а не языковая модель."),
      phase("verification",relevantConflicts.length||uncertainty.level!=="low"?"limited":"complete",
        "Проверено связанных утверждений: "+claimsToCheck.length+"; конфликтов: "+relevantConflicts.length+
          "; индекс опоры на сохранённые данные: "+uncertainty.supportIndex+"/100 (не вероятность); независимых источников: "+uncertainty.independentSources+"."),
      phase("learning",successful?"complete":"limited",
        "Изменены следы памяти: "+updatedMemoryIds.length+"; новых вопросов: "+newQuestionIds.length+
          "; следующий фокус: "+(focus?focus.item.id:"пока не определён")+
          "; исследовательских целей: "+(goalState?goalState.total:0)+
          "; решения причинной модели автоматически не менялись."),
      phase("model_update",successful?"complete":"limited",
        "Состояние: "+memories.length+" записей, "+knowledgeSummary.total+" структурных утверждений, "+
          currentModelDecisions().length+" решений модели, "+openInquiries().length+" открытых вопросов, "+
          (goalState?goalState.active+" активных целей и "+goalState.blocked+" заблокированных":"слой целей недоступен")+".")
    ];
    const cycle={
      id:"C"+context.sequence,sequence:context.sequence,at:Date.now(),mode:context.mode,intent:context.intent,
      status:error?"error":successful?"complete":"partial",
      phases,
      metrics:{
        inputTokens:context.inputTokens,parsedClaims:context.parsedClaims.length,attentionMatches:context.attention.length,
        memoryBefore:context.beforeMemoryCount,memoryAfter:memories.length,memoryAdded:newMemoryIds.length,
        memoryUpdated:updatedMemoryIds.length,claimCount:allClaims.length,conflictCount:relevantConflicts.length,
        openQuestions:openInquiries().length,newQuestions:newQuestionIds.length,
        attentionTopScore:context.attention.length?Math.round(context.attention[0].score*100):0,
        supportIndex:uncertainty.supportIndex,researchFocusScore:focus?Math.round(focus.score*100):0,
        goalCount:goalState?goalState.total:0,activeGoals:goalState?goalState.active:0,blockedGoals:goalState?goalState.blocked:0
      },
      goals:goalState?goalState:null,
      attentionDetails:context.attention.map(hit=>({memoryId:hit.item.id,score:hit.score,relevance:hit.relevance,reasons:hit.reasons})),
      uncertainty,
      focus:focus?{inquiryId:focus.item.id,score:Math.round(focus.score*100),reasons:focus.reasons}:null,
      memoryIds:[...new Set([...selectedMemoryIds,...newMemoryIds,...updatedMemoryIds])].slice(0,8),
      claimIds:[...new Set([...newClaims.map(claim=>claim.id),...selectedClaims.map(claim=>claim.id)].filter(Boolean))].slice(0,12)
    };
    const cleaned=cleanCognitiveCycle(cycle);
    if(cleaned)cognitiveCycles.push(cleaned);
    cognitiveCycles=cognitiveCycles.slice(-MAX_COGNITIVE_CYCLES);
    try { localStorage.setItem(COGNITIVE_CYCLES_KEY,JSON.stringify(cognitiveCycles)); }
    catch(storageError) { console.warn("NEUROGENESIS cognitive cycle storage failed:",storageError); }
    return cleaned;
  }
  function runCognitiveCycle(mode,raw,operation) {
    const context=beginCognitiveCycle(mode,raw);
    let result;
    try {
      result=operation(raw);
      finishCognitiveCycle(context,result,null);
      return result;
    } catch(error) {
      finishCognitiveCycle(context,false,error);
      throw error;
    }
  }
  function cognitiveCycleReport(limit=1) {
    const rows=cognitiveCycles.slice(-Math.max(1,Math.min(5,Number(limit)||1))).reverse();
    if(!rows.length)return "КОГНИТИВНЫЙ ЦИКЛ\n\nПока нет завершённых циклов. Сохрани воспоминание или задай системе вопрос.";
    return rows.map(cycle=>{
      const labels={
        perception:"1. Восприятие",attention:"2. Внимание",memory:"3. Память",
        reasoning:"4. Рассуждение",verification:"5. Проверка",learning:"6. Обучение",
        model_update:"7. Обновление модели"
      };
      const lines=["КОГНИТИВНЫЙ ЦИКЛ · "+cycle.id,
        "Тип: "+(cycle.mode==="remember"?"сохранение информации":"обработка вопроса")+" · намерение: "+cycle.intent,
        "Состояние: "+cycle.status,
        ...cycle.phases.map(item=>(labels[item.name]||item.name)+" ["+item.status+"]: "+item.summary),
        "Метрики: память "+cycle.metrics.memoryAfter+"/"+MAX_MEMORIES+
          " · знаний "+cycle.metrics.claimCount+" · записей внимания "+cycle.metrics.attentionMatches+
          " · новых вопросов "+cycle.metrics.newQuestions,
        "НЕОПРЕДЕЛЁННОСТЬ: "+({low:"низкая",medium:"средняя",high:"высокая"})[cycle.uncertainty.level]+
          " · индекс опоры "+cycle.uncertainty.supportIndex+"/100 (эвристика, не вероятность).",
        ...cycle.uncertainty.reasons.map(reason=>"• "+reason),
        cycle.focus?"СЛЕДУЮЩИЙ ИССЛЕДОВАТЕЛЬСКИЙ ФОКУС: "+cycle.focus.inquiryId+
          " · рейтинг "+cycle.focus.score+"/100 · "+cycle.focus.reasons.join("; "):
          "СЛЕДУЮЩИЙ ИССЛЕДОВАТЕЛЬСКИЙ ФОКУС: пока нет открытого вопроса.",
        ...(cycle.goals?["МОНИТОРИНГ ЦЕЛЕЙ: всего "+cycle.goals.total+" · активных "+cycle.goals.active+
          " · ждут ответа "+cycle.goals.waiting+" · заблокировано "+cycle.goals.blocked+
          " · требуют пересмотра "+cycle.goals.review+" · завершено "+cycle.goals.completed]:[]),
        ...(cycle.attentionDetails.length?["РАСПРЕДЕЛЕНИЕ ВНИМАНИЯ:",
          ...cycle.attentionDetails.slice(0,5).map((item,index)=>(index+1)+". "+item.memoryId+
            " · значимость "+Math.round(item.score*100)+"/100 · "+item.reasons.join("; "))]:[])];
      return lines.join("\n");
    }).join("\n\n──────────\n\n");
  }

  function rememberTextCore(raw) {
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
      if(item)for(const claim of item.claims||[])if(claim.kind==="observation")claim.sourceMemoryId=item.id;
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
    const observationModelNote=newObservationModelNote(independentFreshClaims);
    if(observationModelNote)response+="\n\n"+observationModelNote;
    if(inquiryResponseNotes.length)response+="\n\n"+inquiryResponseNotes.join("\n\n");
    if (!ok) response += " Но локальное сохранение не подтвердилось.";
    say("assistant", response);
    renderLibrary();
    setFeedback("ПАМЯТЬ ОБНОВЛЕНА · " + memories.length + " / " + MAX_MEMORIES);
    return true;
  }
  function rememberText(raw) { return runCognitiveCycle("remember",raw,rememberTextCore); }

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
  function buildGraphRecall(query,limit=12) {
    if(!KNOWLEDGE_GRAPH||!KNOWLEDGE)return {queryTokens:[],anchors:[],matches:[]};
    try {
      const engine=KNOWLEDGE_GRAPH.create(KNOWLEDGE);
      const graph=engine.build(memories);
      return typeof engine.search==="function"?engine.search(graph,query,limit):{queryTokens:[],anchors:[],matches:[]};
    } catch(error) {
      console.warn("Knowledge graph retrieval failed:",error);
      return {queryTokens:[],anchors:[],matches:[]};
    }
  }
  function buildCausalReasoningAudit(paths) {
    if(!REASONING_AUDIT||!KNOWLEDGE||!Array.isArray(paths)||!paths.length)return null;
    const allClaims=memories.flatMap(item=>item.claims||[]);
    const sourceMemoryByClaim=Object.create(null);
    for(const item of memories)for(const claim of item.claims||[])if(claim&&claim.id)sourceMemoryByClaim[claim.id]=item.id;
    try {
      return REASONING_AUDIT.create(KNOWLEDGE).analyze(paths,allClaims,sourceMemoryByClaim);
    } catch(error) {
      console.warn("Causal reasoning audit failed:",error);
      return null;
    }
  }
  function graphEvidenceNote(recall) {
    const matches=Array.isArray(recall&&recall.matches)?recall.matches:[];
    if(!matches.length)return "";
    const lines=["СВЯЗИ, НАЙДЕННЫЕ В ГРАФЕ ЗНАНИЙ"];
    for(const match of matches.slice(0,4)) {
      const source=memories.find(item=>item.id===match.memoryId);
      const route=match.pathType==="two_hop"
        ?"косвенная цепочка через "+(match.viaConcepts||[]).join(" → ")
        :match.pathType==="one_hop"
          ?"связь через понятие «"+((match.viaConcepts||[])[0]||"")+"»"
          :"прямое совпадение с содержанием утверждения";
      const polarity=match.polarity===false?" · отрицательное утверждение":"";
      const verification=match.verification&&match.verification!=="unspecified"
        ?" · статус источника: "+match.verification:"";
      lines.push("• "+(match.label||"Структурированное утверждение")+" — "+route+polarity+verification+
        (source?"\n  Исходная запись: «"+source.text+"»":""));
    }
    lines.push("Переход по графу показывает связь между сохранёнными записями, но сам по себе не доказывает истинность утверждений или причинность.");
    return lines.join("\n");
  }
  function askMemoryCore(raw) {
    const query = String(raw || "").trim();
    if (!query) { setFeedback("Напиши вопрос к моей памяти."); return; }
    const lower = normalise(query);
    if(/^(?:покажи последний когнитивный цикл|покажи последний цикл мышления|что происходило в последнем цикле)$/u.test(lower)) {
      say("assistant",cognitiveCycleReport(1));setFeedback("КОГНИТИВНЫЙ ЦИКЛ · ПОСЛЕДНЯЯ ОБРАБОТКА");return;
    }
    if(/^(?:покажи историю когнитивных циклов|покажи последние когнитивные циклы)$/u.test(lower)) {
      say("assistant",cognitiveCycleReport(5));setFeedback("КОГНИТИВНАЯ ИСТОРИЯ · ПОСЛЕДНИЕ ЦИКЛЫ");return;
    }
    if(/^(?:покажи жизненный цикл гипотез|жизненный цикл гипотез|покажи состояния гипотез|история жизненного цикла гипотез|какие гипотезы проверяются)$/u.test(lower)) {
       say("assistant",hypothesisLifecycleAnswer());setFeedback("САМОИССЛЕДОВАНИЕ · ЖИЗНЕННЫЙ ЦИКЛ ГИПОТЕЗ");return;
     }
     if(/^(?:покажи текущие цели|какие у тебя цели|над чем ты работаешь|над чем ты сейчас работаешь|над чем сейчас работаешь|покажи прогресс целей|что сейчас блокирует цели|каков твой текущий фокус)$/u.test(lower)) {
      say("assistant",researchGoalsAnswer());setFeedback("САМОКОНТРОЛЬ · ИССЛЕДОВАТЕЛЬСКИЕ ЦЕЛИ");return;
    }
    const skippedInquiry=lower.match(/^пропусти вопрос (q\d+)$/u);
    if(skippedInquiry) { say("assistant",skipInquiry(skippedInquiry[1].toUpperCase()));setFeedback("ИССЛЕДОВАНИЕ · ВОПРОС ОБНОВЛЁН");return; }
    if(/^(?:покажи хронологию наблюдений|хронология наблюдений|покажи временную шкалу наблюдений|восстанови последовательность наблюдений)$/u.test(lower)) {
      say("assistant",observationTimelineAnswer());setFeedback("ПАМЯТЬ ОПЫТА · ХРОНОЛОГИЯ");return;
    }
    if(/^(?:сопоставь опыт с причинной моделью|сопоставь наблюдения с моделью|сравни новые наблюдения с моделью|проанализируй сопоставимость наблюдений)$/u.test(lower)) {
       say("assistant",experienceReconciliationAnswer());setFeedback("САМОПРОВЕРКА · СОПОСТАВЛЕНИЕ ОПЫТА");return;
     }
     if(/^(?:покажи журнал наблюдений|покажи карточки наблюдений|список наблюдений|что сохранено как опыт)$/u.test(lower)) {
       say("assistant",observationCasesAnswer());setFeedback("ПАМЯТЬ ОПЫТА · ЖУРНАЛ НАБЛЮДЕНИЙ");return;
     }
     if(/^(?:оцени готовность пересмотра модели|проверь готовность модели к пересмотру|достаточно ли данных для пересмотра|оцени достаточность наблюдений)$/u.test(lower)) {
      say("assistant",modelReviewReadinessAnswer());setFeedback("САМОИССЛЕДОВАНИЕ · ПРОВЕРКА ДОСТАТОЧНОСТИ ДАННЫХ");return;
    }
    if(/^(?:составь план исследования|покажи план исследования|выбери следующий исследовательский шаг|какой следующий шаг исследования|определи стратегию исследования)$/u.test(lower)) {
      say("assistant",researchStrategyAnswer());setFeedback("САМОИССЛЕДОВАНИЕ · ПЛАН ИССЛЕДОВАНИЯ");return;
    }
    if(/^(?:найди пробелы в знаниях|исследуй пробелы в памяти|сформируй вопросы для проверки|обнови исследовательские вопросы)$/u.test(lower)) {
      say("assistant",researchGapsAnswer());setFeedback("САМОИССЛЕДОВАНИЕ · ПОИСК ПРОБЕЛОВ");return;
    }
    if(/^(?:задай мне вопрос|задай следующий вопрос|следующий исследовательский вопрос|какой вопрос ты хочешь мне задать|что тебе нужно уточнить)$/u.test(lower)) {
      const r=refreshInquiryQueue();const focus=nextResearchFocus(query);say("assistant",presentInquiry(focus?focus.item:r.open[0]));setFeedback("ИССЛЕДОВАНИЕ · ВОПРОС ДЛЯ УТОЧНЕНИЯ");return;
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
    if (/^(?:покажи историю изменений модели|покажи изменения рабочей модели|сравни версии причинной модели|что изменилось в причинной модели|что изменилось с прошлого пересмотра)$/u.test(lower)) {
      say("assistant",modelEvolutionAnswer());
      setFeedback("ИСТОРИЯ РАБОЧЕЙ МОДЕЛИ · СРАВНЕНИЕ СНИМКОВ");
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
    const causalAudit=causalRecall&&causalRecall.paths?buildCausalReasoningAudit(causalRecall.paths):null;
    const causalAuditText=causalAudit&&REASONING_AUDIT?REASONING_AUDIT.create(KNOWLEDGE).format(causalAudit):"";
    const causalClaimIds = new Set(causalRecall && causalRecall.claimIds || []);
    const structuredAnswer = KNOWLEDGE ? KNOWLEDGE.answerQuestion(query, allClaims) : null;
    const graphRecall=buildGraphRecall(query,16);
    const graphByMemory=new Map();
    for(const match of graphRecall.matches||[]) {
      if(!match.memoryId)continue;
      const factor=match.pathType==="two_hop"?0.55:match.pathType==="one_hop"?0.78:0.92;
      const score=Number(match.score||0)*factor;
      const previous=graphByMemory.get(match.memoryId);
      if(!previous||score>previous.score)graphByMemory.set(match.memoryId,{score,pathType:match.pathType});
    }
    const graphNote=graphEvidenceNote(graphRecall);
    if (structuredAnswer) {
      const isEntityProfileQuery = /^(?:что ты знаешь|что ты помнишь|что тебе известно|что известно|расскажи|кто такой|кто такая|кто такое)(?:\s|$)/u.test(lower);
      const isIdentityQuery = /^(?:кто ты|ты кто|кто вы|вы кто|что ты такое|что вы такое)$/u.test(lower);
      const isCausalQuery = !!(causalRecall && causalRecall.answer);
      const isHypothesisCheck = !!(hypothesisRecall && hypothesisRecall.answer);
      const isExperimentPlan = !!(experimentPlan && experimentPlan.answer);
      const isDerivedHypotheses = !!(derivedHypotheses && derivedHypotheses.answer);
      const isHypothesisPriority = !!(hypothesisPriority && hypothesisPriority.answer);
      const isUserProfileQuery = /^(?:что ты знаешь|что ты помнишь|что тебе известно|расскажи)(?:\s|$)/u.test(lower) && /\b(?:обо мне|о мне|про меня)\b/u.test(lower);
      const related = memories.map(item => {
        const base=matchMemory(query,item),graphHit=graphByMemory.get(item.id);
        return {item,...base,score:Math.max(base.score,graphHit?graphHit.score:0),
          graphPathType:graphHit?graphHit.pathType:null};
      }).filter(hit => hit.score > 0.08 ||
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
      const conclusionAnswer=researchNote+(researchNote?"\n\n":"")+structuredAnswer+
        (isCausalQuery&&causalAuditText?"\n\n"+causalAuditText:"")+
        (graphNote?"\n\n"+graphNote:"")+modelNote+baselineReviewNote(conclusionMeta);
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
    const ranked = memories.map(item => {
      const base=scoreMemory(query,item),graphHit=graphByMemory.get(item.id);
      return {item,score:Math.max(base,graphHit?graphHit.score:0),graphPathType:graphHit?graphHit.pathType:null};
    }).filter(hit => hit.score >= 0.19).sort((a, b) => b.score - a.score).slice(0, 4);
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
      (graphNote?"\n\n"+graphNote:"")+
      (currentModelDecisions().length?formatModelDecisionNote():"");
    say("assistant", answer);
    const brain = window.NGBrain;
    const activeTraceIds = [...new Set(ids)];
    if (brain && typeof brain.associateMemoryTraces === "function") brain.associateMemoryTraces(activeTraceIds);
    const activated = brain && typeof brain.activateMemoryTraces === "function"
      ? Number(brain.activateMemoryTraces(activeTraceIds) || 0) : 0;
    setFeedback("ПОИСК ЗАВЕРШЁН · НАЙДЕНО " + ranked.length + " · " + activated + " СЛЕДОВ АКТИВИРОВАНО");
  }

  function askMemory(raw) { return runCognitiveCycle("ask",raw,askMemoryCore); }

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
    item.claims = claims.map(claim=>claim.kind==="observation"?{...claim,sourceMemoryId:item.id}:claim);
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
    const hasGoals=window.NGGoals&&typeof window.NGGoals.list==="function"&&window.NGGoals.list().length>0;
    if (!memories.length && !modelDecisions.length && !inquiries.length && !hasGoals) { setFeedback("Память уже пуста."); return; }
    if (!window.confirm("Удалить все " + memories.length + " записей, исследовательские цели, решения рабочей модели и их уникальные нейронные следы? История диалога останется.")) return;
    const oldIds = memories.flatMap(item => [...(item.traceIds || []), ...(item.claims || []).map(claim => claim.traceId)]);
    memories = [];
    modelDecisions = [];
    modelEvidence = [];
    inquiries = [];
    nextInquiryNumber = 1;
    if(window.NGGoals&&typeof window.NGGoals.clear==="function")window.NGGoals.clear();
    cognitiveCycles = [];
    nextCognitiveCycleNumber = 1;
    try { localStorage.setItem(COGNITIVE_CYCLES_KEY,"[]"); } catch(error) { console.warn("Could not clear cognitive cycle history:",error); }
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
        inquiries,
        goals:window.NGGoals&&typeof window.NGGoals.export==="function"?window.NGGoals.export():[]
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
          duplicate.claims=duplicate.claims.map(claim=>claim.kind==="observation"?{...claim,sourceMemoryId:duplicate.id}:claim);
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
        candidate.claims=candidate.claims.map(claim=>claim.kind==="observation"?{...claim,sourceMemoryId:candidate.id}:claim);
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
      if(Array.isArray(data.goals)&&window.NGGoals&&typeof window.NGGoals.merge==="function")window.NGGoals.merge(data.goals);
      reconcileInquiryResponsesFromEntries(data.dialog);
      assessAnsweredInquiries();
      clearLegacyInquiryFragmentClaims();
      rebuildTagTraceIndex();
      if (KNOWLEDGE && KNOWLEDGE.reconcileKnowledgeHistory) KNOWLEDGE.reconcileKnowledgeHistory(memories.flatMap(entry=>entry.claims||[]));
      syncResearchGoals();
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
  syncResearchGoals();
  updateCount();
  renderDialog();
  renderLibrary();
  setFeedback("ЛОКАЛЬНАЯ ПАМЯТЬ · ДАННЫЕ ОСТАЮТСЯ В ЭТОМ БРАУЗЕРЕ");
  window.NGMemory = {
    count: () => memories.length,
    search: query => memories.map(item => ({ text: item.text, claims: item.claims || [], score: scoreMemory(query, item) }))
      .sort((a, b) => b.score - a.score).slice(0, 5),
    ask: query => askMemory(query),
    remember: text => rememberText(text),
    claims: () => memories.flatMap(item => item.claims || []),
    modelDecisions: () => currentModelDecisions(),
    modelEvidence: () => modelEvidence.slice(),
    modelEvolution: () => modelEvolutionAnswer(),
    reasoningHistory: () => reasoningArchive.map(item=>({time:item.time,type:item.reasoning.type,conclusions:item.reasoning.conclusions,status:item.reasoning.status,excludedPaths:item.reasoning.excludedPaths||[]})),
    hypothesisLifecycle: () => hypothesisLifecycleRows(),
    hypothesisLifecycleReport: () => hypothesisLifecycleAnswer(),
    inquiries: () => inquiries.map(item=>({...item,sourceClaimIds:item.sourceClaimIds.slice(),responseClaimIds:item.responseClaimIds.slice()})),
    refreshInquiries: () => { const r=refreshInquiryQueue(); return {added:r.added,open:r.open.length,answered:r.answered.length}; },
    researchStrategy: () => researchStrategyAnswer(),
    modelReviewReadiness: () => modelReviewReadinessAnswer(),
     observationCases: () => observationCases(),
     observationJournal: () => observationCasesAnswer(),
     observationTimeline: () => observationTimelineData(),
     observationTimelineReport: () => observationTimelineAnswer(),
     reviewReadinessForEdge: (subject,object) => reviewReadinessForEdge(subject,object),
     reconcileEdgeEvidence: (subject,object,baselineAt=0) => evidenceReconciliationForEdge(subject,object,baselineAt),
     reconcileExperience: () => experienceReconciliationAnswer(),
    summary: () => KNOWLEDGE ? KNOWLEDGE.summary(memories.flatMap(item => item.claims || [])) : {total:0},
    knowledgeGraph: () => KNOWLEDGE_GRAPH ? KNOWLEDGE_GRAPH.create(KNOWLEDGE).build(memories) : null,
    knowledgeGraphSummary: () => {
      const graph = KNOWLEDGE_GRAPH ? KNOWLEDGE_GRAPH.create(KNOWLEDGE).build(memories) : null;
      return graph ? {...graph.stats} : null;
    },
    knowledgeGraphSearch: query => buildGraphRecall(query,16),
    auditCausalPaths: query => {
      const claims=memories.flatMap(item=>item.claims||[]);
      const result=KNOWLEDGE&&typeof KNOWLEDGE.causalEvidence==="function"
        ?KNOWLEDGE.causalEvidence(query,claimsForWorkingModel(claims)):null;
      return result&&result.paths?buildCausalReasoningAudit(result.paths):null;
    },
    cognitiveCycles: () => cognitiveCycles.map(item=>cleanCognitiveCycle(item)).filter(Boolean),
    cognitiveCycleReport: (limit=1) => cognitiveCycleReport(limit),
    attentionSelection: query => attentionSelection(query).map(hit=>({memoryId:hit.item.id,score:hit.score,relevance:hit.relevance,reasons:hit.reasons})),
    nextResearchFocus: (query="",claimIds=[]) => { const row=nextResearchFocus(query,claimIds);return row?{id:row.item.id,kind:row.item.kind,score:row.score,relevance:row.relevance,impact:row.impact,reasons:row.reasons}:null; },
    goals: () => window.NGGoals&&typeof window.NGGoals.list==="function"?window.NGGoals.list():[],
    goalSummary: () => syncResearchGoals(),
    goalReport: () => researchGoalsAnswer()

  };
})();