(() => {
  "use strict";
  function create(dependencies = {}) {
    const KNOWLEDGE = dependencies.knowledge;
    const normalise = dependencies.normalise;
    const parseObservationMoment = dependencies.parseObservationMoment;
    const enrichedTextLooksLikeSameMention = dependencies.enrichedTextLooksLikeSameMention;
    const observationFieldStatus = dependencies.observationFieldStatus;
    const observationFieldStatusLabel = dependencies.observationFieldStatusLabel;
    if (!KNOWLEDGE || typeof KNOWLEDGE.sameEntity !== 'function' || typeof KNOWLEDGE.sanitizeObservationDetails !== 'function' ||
        typeof normalise !== 'function' || typeof parseObservationMoment !== 'function' || typeof enrichedTextLooksLikeSameMention !== 'function' ||
        typeof observationFieldStatus !== 'function' || typeof observationFieldStatusLabel !== 'function') {
      throw new Error("NEUROGENESIS observation engine dependencies are incomplete.");
    }
  function criterionRequiresNumericOutcome(field) {
    if(!field||field.status!=="provided")return false;
    return /шкал|балл|процент|температур|пульс|частот|давлен|уровен|количеств|числов/u.test(normalise(field.value));
  }
  function numericOutcomePresent(field) {
    return !!(field&&field.status==="provided"&&/[+-]?\d+(?:[.,]\d+)?/u.test(String(field.value||"")));
  }
  function aggregateEventFieldStatus(events,key) {
    const statuses=(events||[]).map(item=>item&&item.details&&item.details[key]&&item.details[key].status||"not_stated");
    if(!statuses.length)return "not_stated";
    if(statuses.every(status=>status==="provided"))return "provided";
    if(statuses.includes("conflict"))return "conflict";
    const rank={not_stated:0,unknown:1,not_recorded:2,none_reported:3,provided:4};
    return statuses.slice().sort((a,b)=>(rank[a]??0)-(rank[b]??0))[0];
  }
  function mergeObservationEventDetails(members) {
    const first=members[0]&&members[0].details||KNOWLEDGE.sanitizeObservationDetails(null,"direct_observation");
    const result={...first};
    const fields=["context","timing","criterion","outcome"];
    for(const key of fields) {
      const rows=members.map(item=>item.details&&item.details[key]).filter(Boolean);
      const provided=rows.filter(field=>field.status==="provided");
      const unique=new Map(provided.map(field=>[normalise(field.value),field]));
      if(unique.size>1) {
        result[key]={status:"conflict",value:"",source:"direct_observation",
          conflictValues:[...unique.values()].map(field=>field.value)};
      } else if(unique.size===1) {
        result[key]={...unique.values().next().value};
      } else {
        const rank={not_stated:0,unknown:1,not_recorded:2,none_reported:3};
        const chosen=rows.slice().sort((a,b)=>(rank[b.status]??0)-(rank[a.status]??0))[0];
        result[key]=chosen?{...chosen}:{status:"not_stated",value:"",source:"direct_observation"};
      }
    }
    return result;
  }
  function observationEventQuality(item) {
    const details=item&&item.details||{};
    const missingFields=[];
    for(const key of ["context","timing","criterion"])
      if(!details[key]||details[key].status!=="provided")missingFields.push(key);
    const numericRequired=criterionRequiresNumericOutcome(details.criterion);
    if(numericRequired&&!numericOutcomePresent(details.outcome))missingFields.push("outcome");
    const metadataConflicts=["context","timing","criterion","outcome"].filter(key=>
      details[key]&&details[key].status==="conflict");
    return {id:item&&item.id||"",memberIds:Array.isArray(item&&item.memberIds)?item.memberIds.slice():[item&&item.id].filter(Boolean),
      numericOutcomeRequired:numericRequired,missingFields,metadataConflicts,
      identityUnresolved:!!(item&&item.identityUnresolved),
      complete:missingFields.length===0&&!metadataConflicts.length&&!(item&&item.identityUnresolved)};
  }
  function reviewReadinessForEdge(sourceCases,inquiryRows,subject,object) {
    const allCases=(sourceCases||[]).filter(item=>
      KNOWLEDGE.sameEntity(item.subject,subject)&&KNOWLEDGE.sameEntity(item.object,object));
    const grouped=uniqueObservationEvents(allCases),distinct=grouped.events;
    const supporting=distinct.filter(item=>item.polarity);
    const challenging=distinct.filter(item=>!item.polarity);
    const relatedAnswers=(inquiryRows||[]).filter(item=>item.status==="answered"&&
      KNOWLEDGE.sameEntity(item.edgeSubject,subject)&&KNOWLEDGE.sameEntity(item.edgeObject,object)&&item.responseText);
    const answerDetails=relatedAnswers.map(item=>item.responseDetails||
      KNOWLEDGE.parseObservationDetails(item.responseText,"inquiry_response"));
    const answerContextStatus=observationFieldStatus(answerDetails,"context");
    const answerTimingStatus=observationFieldStatus(answerDetails,"timing");
    const answerCriterionStatus=observationFieldStatus(answerDetails,"criterion");
    const checks=distinct.map(observationEventQuality);
    const contextStatus=aggregateEventFieldStatus(distinct,"context");
    const timingStatus=aggregateEventFieldStatus(distinct,"timing");
    const criterionStatus=aggregateEventFieldStatus(distinct,"criterion");
    const outcomeStatus=aggregateEventFieldStatus(distinct,"outcome");
    const numericOutcomeRequired=checks.some(item=>item.numericOutcomeRequired);
    const numericOutcomeMissingCount=checks.filter(item=>item.numericOutcomeRequired&&item.missingFields.includes("outcome")).length;
    const metadataConflictCount=checks.reduce((sum,item)=>sum+item.metadataConflicts.length,0);
    const identityUnresolvedCount=checks.filter(item=>item.identityUnresolved).length;
    const missingByField=key=>checks.filter(item=>item.missingFields.includes(key)).length;
    const blockers=[];
    if(!supporting.length)blockers.push("нет отдельного наблюдения, в котором результат присутствовал");
    if(!challenging.length)blockers.push("нет отдельного наблюдения, в котором результат отсутствовал");
    for(const [key,label,wording] of [
      ["context","контекст","не указан"],
      ["timing","время или временной порядок","не указаны"],
      ["criterion","способ оценки","не указан"]
    ]) {
      const count=missingByField(key);
      if(count)blockers.push(label+" "+wording+" в "+count+" из "+distinct.length+" отдельных событий");
    }
    if(numericOutcomeMissingCount)blockers.push("не записано фактическое числовое значение результата (например, 6/10) в "+numericOutcomeMissingCount+" событии(ях), хотя указан числовой способ оценки");
    if(identityUnresolvedCount)blockers.push("идентичность эпизодов не уточнена в "+identityUnresolvedCount+" возможной группе карточек; их нельзя считать установленным числом самостоятельных событий");
    if(metadataConflictCount)blockers.push("есть "+metadataConflictCount+" конфликтующих значений полей внутри карточек одного явно связанного события");
    const completeEventCount=checks.filter(item=>item.complete).length;
    const ready=blockers.length===0&&distinct.length>0;
    const label=ready?"ДОСТАТОЧНО ДАННЫХ ДЛЯ ПРЕДМЕТНОГО ПЕРЕСМОТРА":
      supporting.length&&challenging.length?"ПРОТИВОРЕЧИЕ ЕСТЬ, НО ДАННЫХ ДЛЯ ПЕРЕСМОТРА ПОКА НЕ ХВАТАЕТ":
      distinct.length?"ОДНОСТОРОННИЕ НАБЛЮДЕНИЯ":"НЕТ ПРЯМЫХ НАБЛЮДЕНИЙ";
    return {subject,object,supportingCount:supporting.length,challengingCount:challenging.length,
      totalCount:distinct.length,context:distinct.length>0&&contextStatus==="provided",
      timing:distinct.length>0&&timingStatus==="provided",criterion:distinct.length>0&&criterionStatus==="provided",
      contextStatus,timingStatus,criterionStatus,outcomeStatus,
      answerContextStatus,answerTimingStatus,answerCriterionStatus,
      numericOutcomeRequired,numericOutcomeMissingCount,
      completeEventCount,incompleteEventCount:distinct.length-completeEventCount,metadataConflictCount,identityUnresolvedCount,
      possibleDuplicateCount:grouped.duplicateMentions,possibleDuplicateGroups:grouped.possibleDuplicateGroups,
      ready,label,blockers,eventChecks:checks,answerIds:relatedAnswers.map(item=>item.id)};
  }
  function observationDuplicateRelation(left,right) {
    if(!left||!right||left.polarity!==right.polarity||
       !KNOWLEDGE.sameEntity(left.subject,right.subject)||!KNOWLEDGE.sameEntity(left.object,right.object))return null;
    const a=String(left.details&&left.details.eventRef||"").trim();
    const b=String(right.details&&right.details.eventRef||"").trim();
    if(a||b)return a&&b&&normalise(a)===normalise(b)?"explicit_event_ref":null;
    const leftText=normalise(left.evidence),rightText=normalise(right.evidence);
    if(leftText&&leftText===rightText)return "same_text_possible_repeat";
    if(leftText&&rightText&&enrichedTextLooksLikeSameMention(leftText,rightText))return "possible_enrichment";
    const leftTime=left.details&&left.details.timing,rightTime=right.details&&right.details.timing;
    const leftContext=left.details&&left.details.context,rightContext=right.details&&right.details.context;
    const leftCriterion=left.details&&left.details.criterion,rightCriterion=right.details&&right.details.criterion;
    const leftOutcome=left.details&&left.details.outcome,rightOutcome=right.details&&right.details.outcome;
    const leftMoment=leftTime&&leftTime.status==="provided"?parseObservationMoment(leftTime.value):null;
    const rightMoment=rightTime&&rightTime.status==="provided"?parseObservationMoment(rightTime.value):null;
    if(leftMoment&&rightMoment&&leftMoment.precision!=="date"&&
       normalise(leftTime.value)===normalise(rightTime.value)&&
       leftContext&&rightContext&&leftContext.status==="provided"&&rightContext.status==="provided"&&
       normalise(leftContext.value)===normalise(rightContext.value)&&
       leftCriterion&&rightCriterion&&leftCriterion.status==="provided"&&rightCriterion.status==="provided"&&
       normalise(leftCriterion.value)===normalise(rightCriterion.value)&&
       normalise(leftOutcome&&leftOutcome.value||"")===normalise(rightOutcome&&rightOutcome.value||""))return "matching_event_details";
    return null;
  }
  function uniqueObservationEvents(cases) {
    const groups=[];
    for(const item of Array.isArray(cases)?cases:[]) {
      let target=null,relation=null;
      for(const group of groups) {
        const match=group.members.map(member=>observationDuplicateRelation(member,item)).find(Boolean);
        if(match){target=group;relation=match;break;}
      }
      if(!target)groups.push({members:[item],relations:[]});
      else {target.members.push(item);target.relations.push(relation);}
    }
    const events=groups.map(group=>{
      const quality=item=>{
        const detail=item.details||{};
        return ["context","timing","criterion","outcome"].filter(key=>detail[key]&&detail[key].status==="provided").length+
          (detail.eventRef?1:0);
      };
      const members=group.members.slice().sort((a,b)=>quality(b)-quality(a)||
        String(b.evidence||"").length-String(a.evidence||"").length||a.recordedAt-b.recordedAt);
      const primary=members[0];
      const explicitDuplicate=members.length>1&&group.relations.length===members.length-1&&
        group.relations.every(value=>value==="explicit_event_ref");
      const identityUnresolved=members.length>1&&!explicitDuplicate;
      const details=explicitDuplicate?mergeObservationEventDetails(members):
        (primary.details||KNOWLEDGE.sanitizeObservationDetails(null,"direct_observation"));
      return {...primary,details,memberIds:members.map(item=>item.id).filter(Boolean),
        sourceMemoryIds:[...new Set(members.map(item=>item.sourceMemoryId).filter(Boolean))],
        memberRecordedAt:members.map(item=>item.recordedAt),
        duplicateIds:members.slice(1).map(item=>item.id),duplicateCount:members.length-1,
        duplicateConfidence:explicitDuplicate?"explicit":identityUnresolved?"possible":"none",
        identityUnresolved,eventRef:details.eventRef||""};
    });
    const duplicates=groups.filter(group=>group.members.length>1);
    const possibleGroups=duplicates.filter(group=>!(group.members.length>1&&
      group.relations.length===group.members.length-1&&group.relations.every(value=>value==="explicit_event_ref"))).map(group=>{
      const members=group.members.slice().sort((a,b)=>a.recordedAt-b.recordedAt);
      return {subject:members[0].subject,object:members[0].object,polarity:members[0].polarity,
        claimIds:members.map(item=>item.id).filter(Boolean),
        members:members.map(item=>({id:item.id,sourceMemoryId:item.sourceMemoryId,evidence:item.evidence,
          recordedAt:item.recordedAt,eventRef:item.details&&item.details.eventRef||""})),
        relationTypes:[...new Set(group.relations)]};
    });
    return {events:events.sort((a,b)=>a.recordedAt-b.recordedAt),
      duplicateMentions:duplicates.reduce((sum,group)=>sum+group.members.length-1,0),
      possibleDuplicateGroups:possibleGroups.length,possibleGroups,
      explicitDuplicateGroups:duplicates.filter(group=>group.members.length>1&&
        group.relations.length===group.members.length-1&&group.relations.every(value=>value==="explicit_event_ref")).length};
  }
  function observationValue(item,key) {
    const field=item&&item.details&&item.details[key];
    return field&&field.status==="provided"?normalise(field.value):"";
  }
  function evidenceReconciliationForEdge(sourceCases,subject,object,baselineAt=0) {
    const candidates=(sourceCases||[]).filter(item=>
      KNOWLEDGE.sameEntity(item.subject,subject)&&KNOWLEDGE.sameEntity(item.object,object));
    const grouped=uniqueObservationEvents(candidates),cases=grouped.events;
    const duplicateMentions=grouped.duplicateMentions;
    const supporting=cases.filter(item=>item.polarity),challenging=cases.filter(item=>!item.polarity);
    const oppositePairs=[];
    for(const positive of supporting)for(const negative of challenging) {
      const values={context:[observationValue(positive,"context"),observationValue(negative,"context")],
        timing:[observationValue(positive,"timing"),observationValue(negative,"timing")],
        criterion:[observationValue(positive,"criterion"),observationValue(negative,"criterion")]};
      const comparedDimensions=Object.entries(values).filter(([,pair])=>pair[0]&&pair[1]).map(([key])=>key);
      const changedDimensions=comparedDimensions.filter(key=>values[key][0]!==values[key][1]);
      const sameContext=!!values.context[0]&&values.context[0]===values.context[1];
      const sameCriterion=!!values.criterion[0]&&values.criterion[0]===values.criterion[1];
      const complete=observationEventQuality(positive).complete&&observationEventQuality(negative).complete;
      oppositePairs.push({supportingId:positive.id,challengingId:negative.id,contextMatch:sameContext,
        criterionMatch:sameCriterion,timingKnown:!!values.timing[0]&&!!values.timing[1],
        timingDiff:changedDimensions.includes("timing"),comparedDimensions,changedDimensions,
        status:!complete?"incomplete":!sameContext||!sameCriterion?"different_metadata":"aligned"});
    }
    const aligned=oppositePairs.filter(pair=>pair.status==="aligned");
    const different=oppositePairs.filter(pair=>pair.status==="different_metadata");
    const incomplete=oppositePairs.filter(pair=>pair.status==="incomplete");
    const contextDifferences=different.filter(pair=>pair.changedDimensions.includes("context"));
    const criterionDifferences=different.filter(pair=>pair.changedDimensions.includes("criterion"));
    const timingDifferences=oppositePairs.filter(pair=>pair.timingDiff);
    const timingOnlyPairs=oppositePairs.filter(pair=>pair.status!=="incomplete"&&pair.changedDimensions.length===1&&pair.changedDimensions[0]==="timing");
    const contextOnlyPairs=oppositePairs.filter(pair=>pair.status!=="incomplete"&&pair.changedDimensions.length===1&&pair.changedDimensions[0]==="context");
    const multiDimensionPairs=oppositePairs.filter(pair=>pair.status!=="incomplete"&&pair.changedDimensions.length>1);
    const contextTimingPairs=oppositePairs.filter(pair=>pair.status!=="incomplete"&&pair.changedDimensions.includes("context")&&pair.changedDimensions.includes("timing"));
    const metadataKeys=["context","timing","criterion","outcome"];
    const fields=cases.length*metadataKeys.length;
    const known=cases.reduce((sum,item)=>sum+metadataKeys.filter(key=>
      item.details[key]&&item.details[key].status==="provided").length,0);
    const checks=cases.map(observationEventQuality);
    const completeCases=checks.filter(item=>item.complete).length;
    const numericOutcomeRequired=checks.some(item=>item.numericOutcomeRequired);
    const outcomeMissingCount=checks.filter(item=>item.numericOutcomeRequired&&item.missingFields.includes("outcome")).length;
    const metadataConflictCount=checks.reduce((sum,item)=>sum+item.metadataConflicts.length,0);
    const identityUnresolvedCount=checks.filter(item=>item.identityUnresolved).length;
    const fieldStatuses=["provided","not_stated","not_recorded","unknown","none_reported","conflict"];
    const fieldStatusCounts=Object.fromEntries(metadataKeys.map(key=>[key,Object.fromEntries(fieldStatuses.map(status=>
      [status,cases.filter(item=>(item.details&&item.details[key]&&item.details[key].status||"not_stated")===status).length]))]));
    const provenanceRows=candidates.map(item=>({sourceRef:String(item.sourceRef||item.details&&item.details.sourceRef||"").trim(),
      verification:String(item.verification||"unverified"),source:String(item.source||"unknown")}));
    const sourceReferenceCount=new Set(provenanceRows.map(item=>item.sourceRef).filter(Boolean)).size;
    const independentVerifiedSources=new Set(provenanceRows.filter(item=>
      item.sourceRef&&["independently_verified","verified"].includes(item.verification)).map(item=>item.sourceRef)).size;
    const verifiedWithoutSourceRef=provenanceRows.filter(item=>
      !item.sourceRef&&["independently_verified","verified"].includes(item.verification)).length;
    const userReportedUnverifiedCount=cases.filter(item=>
      item.source==="user_message"&&(!item.verification||item.verification==="unverified")).length;
    const recordIds=[...new Set(candidates.map(item=>item.sourceMemoryId).filter(Boolean))];
    const addedAfter=cases.filter(item=>(item.memberRecordedAt||[item.recordedAt]).some(at=>baselineAt&&at>baselineAt));
    let pattern="нет прямых наблюдений";
    let recommendation="Нужны естественные наблюдения в обе стороны: как случаи с результатом, так и случаи без него. Не создавать условия специально.";
    if(cases.length&&(!supporting.length||!challenging.length)) {
      pattern="односторонний материал";
      recommendation="Не менять общее причинное утверждение по односторонним данным. Нужны естественные случаи противоположного исхода, записанные тем же способом.";
    } else if(supporting.length&&challenging.length&&multiDimensionPairs.length) {
      pattern="противоположные исходы при одновременных различиях нескольких параметров";
      recommendation="Нельзя выделить роль отдельного фактора: в сопоставляемых случаях одновременно меняются несколько параметров. Сохранять связь как спорную и не приписывать расхождение одному из них без случаев, где параметры различаются по отдельности.";
    } else if(supporting.length&&challenging.length&&criterionDifferences.length) {
      pattern="противоположные исходы записаны с разными критериями или методами оценки";
      recommendation="Сначала согласовать критерий результата. При разных способах измерения исходы нельзя напрямую сопоставлять; различие метода само по себе не объясняет причинность.";
    } else if(supporting.length&&challenging.length&&aligned.length&&different.length) {
      pattern="смешанная картина: есть сопоставимые пары и пары с различиями контекста";
      recommendation="Не считать связь универсальной. Сохранить её как спорную; отдельно проверить, меняется ли результат при различиях контекста, не объявляя совпадение причиной.";
    } else if(supporting.length&&challenging.length&&aligned.length&&timingOnlyPairs.length&&!different.length) {
      pattern="контекст и критерий совпадают, но время противоположных исходов различается";
      recommendation="Сопоставляемые события различаются временем. Это может быть значимым условием или обычным ходом времени; без наблюдений, где время меняется отдельно от других параметров, нельзя приписывать ему причинную роль.";
    } else if(supporting.length&&challenging.length&&aligned.length) {
      pattern="есть разнонаправленные наблюдения с совпадающими контекстом и критерием";
      recommendation="Общее правило пока не подтверждается однозначно: при зафиксированных одинаковых контексте и критерии исходы расходятся. Повторять только естественные наблюдения и искать независимое подтверждение.";
    } else if(supporting.length&&challenging.length&&contextDifferences.length) {
      pattern="противоположные исходы записаны при разных контекстах";
      recommendation="Рассматривать условную связь только как рабочую гипотезу. Различие контекста может быть важно, но само по себе не доказывает, что именно оно объясняет расхождение.";
    } else if(supporting.length&&challenging.length&&timingDifferences.length) {
      pattern="противоположные исходы записаны в разное время";
      recommendation="Временное различие может быть важным параметром, но само по себе не показывает причину расхождения. Не смешивать время регистрации с временем самого события и не делать вывод без контекста.";
    } else if(supporting.length&&challenging.length) {
      pattern="противоположные исходы есть, но сопоставимость случаев не установлена";
      recommendation="Пока не выбирать объяснение. Заполнять контекст, время и критерий для каждого естественного случая; не делать вывод по простому количеству записей.";
    }
    if(identityUnresolvedCount)recommendation+=" Возможные повторы пока не подтверждены как одно событие или разные события.";
    if(metadataConflictCount)recommendation+=" Внутри явно связанного эпизода есть несовпадающие значения отдельных полей.";
    return {subject,object,cases,supportingCount:supporting.length,challengingCount:challenging.length,
      duplicateMentions,possibleDuplicateGroups:grouped.possibleDuplicateGroups,
      explicitDuplicateGroups:grouped.explicitDuplicateGroups,outcomeMissingCount,
      numericOutcomeRequired,completeCases,metadataCoverage:fields?Math.round(known/fields*100):0,
      knownFields:known,fieldCount:fields,metadataConflictCount,identityUnresolvedCount,fieldStatusCounts,
      alignedPairCount:aligned.length,differentMetadataPairCount:different.length,
      contextDifferencePairCount:contextDifferences.length,criterionDifferencePairCount:criterionDifferences.length,
      timingDifferencePairCount:timingDifferences.length,timingOnlyPairCount:timingOnlyPairs.length,
      contextOnlyPairCount:contextOnlyPairs.length,multiDimensionDifferencePairCount:multiDimensionPairs.length,
      contextTimingDifferencePairCount:contextTimingPairs.length,incompletePairCount:incomplete.length,
      oppositePairCount:oppositePairs.length,independentVerifiedSources,sourceReferenceCount,
      verifiedWithoutSourceRef,userReportedUnverifiedCount,
      userRecordCount:recordIds.length,addedAfterModelCount:addedAfter.length,addedAfterModelIds:addedAfter.map(item=>item.id),
      eventChecks:checks,pattern,recommendation,oppositePairs:oppositePairs.slice(0,6)};
  }
    return Object.freeze({ uniqueObservationEvents, reviewReadinessForEdge, evidenceReconciliationForEdge, observationEventQuality });
  }
  window.NGObservationEngine = Object.freeze({ version: 1, create });
})();