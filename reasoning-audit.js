(() => {
  "use strict";
  const clean=(value,limit=240)=>String(value==null?"":value).replace(/\s+/gu," ").trim().slice(0,limit);
  function create(knowledge) {
    if(!knowledge||typeof knowledge.sameEntity!=="function"||typeof knowledge.findConflicts!=="function"||
       typeof knowledge.normalise!=="function")throw new Error("NGReasoningAudit requires NGKnowledge comparison methods");
    const entityKey=value=>knowledge.canonicalEntity?knowledge.canonicalEntity(value):knowledge.normalise(value);
    const edgeKey=edge=>entityKey(edge&&edge.subject)+"=>"+entityKey(edge&&edge.object);
    function analyze(paths,inputClaims,sourceMemoryByClaim={}) {
      const claims=Array.isArray(inputClaims)?inputClaims:[];
      const pathsInput=Array.isArray(paths)?paths.slice(0,8):[];
      const byId=new Map(claims.filter(c=>c&&typeof c.id==="string").map(c=>[c.id,c]));
      const sourceFor=claim=>{
        if(!claim)return null;
        const mapped=claim.id&&sourceMemoryByClaim&&typeof sourceMemoryByClaim==="object"?sourceMemoryByClaim[claim.id]:null;
        const value=mapped||claim.sourceMemoryId||null;
        return typeof value==="string"&&value.trim()?value.trim():null;
      };
      const normalizedPaths=pathsInput.map(path=>(Array.isArray(path)?path:[])
        .filter(edge=>edge&&typeof edge.subject==="string"&&typeof edge.object==="string").slice(0,3))
        .filter(path=>path.length);
      const usedEdgeKeys=new Set(normalizedPaths.flat().map(edgeKey));
      const relevantCausal=claims.filter(c=>c&&c.kind==="causal"&&c.status!=="superseded"&&usedEdgeKeys.has(edgeKey(c)));
      const conflictRows=(()=>{try{return knowledge.findConflicts(relevantCausal)||[];}catch(_){return [];}})();
      const conflictIds=new Set(conflictRows.flatMap(row=>[row&&row.left&&row.left.id,row&&row.right&&row.right.id]).filter(Boolean));
      const observationsFor=edge=>claims.filter(c=>c&&c.kind==="observation"&&c.status!=="superseded"&&
        knowledge.sameEntity(c.subject,edge.subject)&&knowledge.sameEntity(c.object,edge.object));
      const routes=normalizedPaths.map((path,index)=>{
        const steps=path.map(edge=>{
          const claim=edge.id&&byId.get(edge.id)||claims.find(c=>c&&c.kind==="causal"&&
            knowledge.sameEntity(c.subject,edge.subject)&&knowledge.sameEntity(c.object,edge.object)&&
            (edge.predicate==null||knowledge.normalise(c.predicate)===knowledge.normalise(edge.predicate)));
          const observations=observationsFor(edge);
          return {
            id:claim&&claim.id||edge.id||null,subject:edge.subject,object:edge.object,
            evidence:clean(claim&&claim.evidence||edge.evidence,220),
            verification:claim&&claim.verification||"unspecified",status:claim&&claim.status||"current",
            sourceMemoryId:sourceFor(claim||edge),conflict:!!(claim&&claim.id&&conflictIds.has(claim.id)),
            supportingObservations:observations.filter(c=>c.polarity!==false).length,
            counterObservations:observations.filter(c=>c.polarity===false).length,
            supportingObservationIds:observations.filter(c=>c.polarity!==false).map(c=>c.id||knowledge.normalise(c.evidence)).filter(Boolean),
            counterObservationIds:observations.filter(c=>c.polarity===false).map(c=>c.id||knowledge.normalise(c.evidence)).filter(Boolean),
            observationIds:observations.map(c=>c.id).filter(Boolean)
          };
        });
        const sourceMemoryIds=[...new Set(steps.map(s=>s.sourceMemoryId).filter(Boolean))].sort();
        const claimIds=[...new Set(steps.map(s=>s.id).filter(Boolean))].sort();
        return {
          id:"route-"+(index+1),steps,
          label:[path[0].subject,...path.map(edge=>edge.object)].join(" → "),
          sourceMemoryIds,sourceRecordCount:sourceMemoryIds.length,
          unknownSourceCount:steps.filter(s=>!s.sourceMemoryId).length,
          supportingObservations:steps.reduce((sum,s)=>sum+s.supportingObservations,0),
          counterObservations:steps.reduce((sum,s)=>sum+s.counterObservations,0),
          unobservedSteps:steps.filter(s=>s.supportingObservations===0&&s.counterObservations===0).length,
          claimIds
        };
      });
      const claimUse=new Map(),edgeUse=new Map(),evidenceUse=new Map();
      for(const route of routes)for(const step of route.steps) {
        const key=edgeKey(step);
        if(!edgeUse.has(key))edgeUse.set(key,{subject:step.subject,object:step.object,routes:new Set(),claimIds:new Set()});
        edgeUse.get(key).routes.add(route.id);
        if(step.id)edgeUse.get(key).claimIds.add(step.id);
        if(step.id) {
          if(!claimUse.has(step.id))claimUse.set(step.id,new Set());
          claimUse.get(step.id).add(route.id);
        }
        const evidenceKey=knowledge.normalise(step.evidence);
        if(evidenceKey&&step.id) {
          if(!evidenceUse.has(evidenceKey))evidenceUse.set(evidenceKey,{text:step.evidence,claimIds:new Set(),sourceIds:new Set()});
          const entry=evidenceUse.get(evidenceKey);
          entry.claimIds.add(step.id);
          if(step.sourceMemoryId)entry.sourceIds.add(step.sourceMemoryId);
        }
      }
      const sharedEdges=[...edgeUse.values()].filter(row=>row.routes.size>1)
        .map(row=>({subject:row.subject,object:row.object,routeCount:row.routes.size,claimIds:[...row.claimIds].sort()}));
      const sharedClaims=[...claimUse.entries()].filter(([,used])=>used.size>1)
        .map(([claimId,used])=>({claimId,routeCount:used.size}));
      const repeatedEvidence=[...evidenceUse.values()].filter(row=>row.claimIds.size>1)
        .map(row=>({text:row.text,claimCount:row.claimIds.size,sourceRecordCount:row.sourceIds.size}));
      const sourceRecords=[...new Set(routes.flatMap(route=>route.sourceMemoryIds))].sort();
      const allSteps=routes.flatMap(route=>route.steps);
      const uniqueClaimIds=[...new Set(allSteps.map(s=>s.id).filter(Boolean))];
      const supportingObservationCount=new Set(allSteps.flatMap(s=>s.supportingObservationIds)).size;
      const counterObservationCount=new Set(allSteps.flatMap(s=>s.counterObservationIds)).size;
      const uniqueSteps=new Map();
      for(const step of allSteps)if(!uniqueSteps.has(edgeKey(step)))uniqueSteps.set(edgeKey(step),step);
      const unobservedStepCount=[...uniqueSteps.values()].filter(s=>
        s.supportingObservations===0&&s.counterObservations===0).length;
      const conflicts=conflictRows.map(row=>({
        type:row.type||"possible",reason:clean(row.reason,220),
        left:{id:row.left&&row.left.id||null,evidence:clean(row.left&&row.left.evidence,200),sourceMemoryId:sourceFor(row.left)},
        right:{id:row.right&&row.right.id||null,evidence:clean(row.right&&row.right.evidence,200),sourceMemoryId:sourceFor(row.right)}
      }));
      const changeConditions=[];
      if(conflicts.length)changeConditions.push("Разобрать прямые противоречия по одним и тем же причинным звеньям: в памяти есть несовместимые утверждения.");
      if(counterObservationCount)changeConditions.push("Уточнить контекст и критерий потенциальных контрнаблюдений: "+counterObservationCount+" записей расходятся с ожидаемым результатом.");
      if(sharedEdges.length)changeConditions.push("Перепроверить общие звенья "+sharedEdges.map(e=>e.subject+" → "+e.object).join("; ")+": несколько маршрутов зависят от одних и тех же переходов.");
      if(unobservedStepCount)changeConditions.push("Получить безопасные естественные наблюдения по "+unobservedStepCount+" звеньям, для которых нет прямых карточек наблюдений.");
      if(repeatedEvidence.length)changeConditions.push("Проверить повторяющиеся формулировки: одинаковый текст в нескольких утверждениях не превращается в несколько независимых подтверждений.");
      if(routes.length>1)changeConditions.push("Сравнить альтернативы для одного результата: нужны наблюдения, при которых предсказания маршрутов различаются.");
      else if(routes.length===1)changeConditions.push("Найти и проверить альтернативные механизмы: сейчас в памяти прослеживается только один маршрут.");
      if(sourceRecords.length<=1&&routes.length)changeConditions.push("Маршруты опираются не более чем на одну исходную запись памяти; происхождение оснований нуждается в отдельной проверке.");
      else if(sourceRecords.length>1)changeConditions.push("Разные записи памяти не гарантируют независимость сведений: происхождение каждого сообщения нужно проверять отдельно.");
      if(!changeConditions.length)changeConditions.push("Добавить проверяемые наблюдения и возможные контрпримеры с явно указанными условиями и происхождением.");
      return {version:1,routeCount:routes.length,uniqueClaimCount:uniqueClaimIds.length,sourceRecordCount:sourceRecords.length,
        sharedEdges,sharedClaims,repeatedEvidence,conflicts,supportingObservationCount,counterObservationCount,
        unobservedStepCount,routes,changeConditions};
    }
    function format(report) {
      if(!report||!report.routes||!report.routes.length)return "";
      const lines=[
        "СРАВНЕНИЕ ПРИЧИННЫХ МАРШРУТОВ",
        "Маршрутов: "+report.routeCount+" · уникальных утверждений в путях: "+report.uniqueClaimCount+
          " · исходных записей памяти: "+report.sourceRecordCount+".",
        "Записи памяти показывают происхождение фрагментов, но не являются автоматически независимыми источниками доказательств."
      ];
      for(const route of report.routes) {
        lines.push(route.id.toUpperCase()+": "+route.label);
        lines.push("  Прямые наблюдения: "+route.supportingObservations+
          " · потенциальные контрнаблюдения: "+route.counterObservations+
          " · звенья без прямых наблюдений: "+route.unobservedSteps+
          " · исходных записей: "+route.sourceRecordCount+
          (route.unknownSourceCount?" · происхождение не установлено для "+route.unknownSourceCount+" звеньев":""));
      }
      if(report.sharedEdges.length)lines.push("ОБЩИЕ ЗВЕНЬЯ: "+
        report.sharedEdges.map(item=>item.subject+" → "+item.object+" (в "+item.routeCount+" маршрутах)").join("; ")+
        ". Повторение общего звена не является новым подтверждением.");
      else if(report.routeCount>1)lines.push("Общих причинных звеньев между маршрутами не найдено; это разные структуры, но ещё не доказанные независимые объяснения.");
      if(report.repeatedEvidence.length)lines.push("ПОВТОРЯЮЩИЕСЯ ФОРМУЛИРОВКИ: "+
        report.repeatedEvidence.map(item=>"«"+item.text+"» ("+item.claimCount+" утверждения)").join("; ")+".");
      if(report.conflicts.length) {
        lines.push("ПРОТИВОРЕЧИЯ:");
        for(const conflict of report.conflicts.slice(0,4))lines.push("• "+
          (conflict.type==="direct"?"Прямое":"Возможное")+": «"+conflict.left.evidence+
          "» против «"+conflict.right.evidence+"»"+(conflict.reason?" — "+conflict.reason:""));
      }
      lines.push("ЧТО МОЖЕТ ИЗМЕНИТЬ ВЫВОД:");
      report.changeConditions.slice(0,7).forEach((item,index)=>lines.push((index+1)+". "+item));
      lines.push("Это сравнение структуры сохранённых сведений, а не оценка вероятности истинности. Система не выбирает наиболее правдоподобную причину без достаточных оснований.");
      return lines.join("\n");
    }
    return {version:1,analyze,format};
  }
  window.NGReasoningAudit={version:1,create};
})();