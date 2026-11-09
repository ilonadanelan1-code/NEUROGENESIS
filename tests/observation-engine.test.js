"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const normalise = value => String(value || "").toLowerCase().replace(/ё/g,"е")
  .replace(/[^a-zа-я0-9]+/giu," ").trim();
const knowledge = {
  sameEntity(left,right) { return normalise(left)===normalise(right); },
  sanitizeObservationDetails(raw) {
    return raw || {
      eventRef:"",
      context:{status:"not_stated",value:""},
      timing:{status:"not_stated",value:""},
      criterion:{status:"not_stated",value:""},
      outcome:{status:"not_stated",value:""}
    };
  },
  parseObservationDetails(text) {
    const context=String(text||"").match(/контекст:\s*([^.;]+)/iu);
    return {
      context:context?{status:"provided",value:context[1].trim()}:{status:"not_stated",value:""},
      timing:{status:"not_stated",value:""},
      criterion:{status:"not_stated",value:""},
      outcome:{status:"not_stated",value:""}
    };
  }
};
const observationFieldStatus = (fields,key) => {
  const rank={not_stated:0,unknown:1,not_recorded:2,none_reported:3,provided:4};
  return (fields||[]).map(item=>item&&item[key]&&item[key].status||"not_stated")
    .sort((a,b)=>(rank[b]||0)-(rank[a]||0))[0]||"not_stated";
};
const labels = {
  provided:{context:"указан",timing:"указано",criterion:"указан",outcome:"указано"},
  not_stated:{context:"не указан",timing:"не указано",criterion:"не указан",outcome:"не указано"},
  not_recorded:{context:"не записан",timing:"не записано",criterion:"не записан",outcome:"не записано"},
  unknown:{context:"неизвестен",timing:"неизвестно",criterion:"неизвестен",outcome:"неизвестно"},
  none_reported:{context:"сообщено об отсутствии",timing:"сообщено об отсутствии",criterion:"сообщено об отсутствии",outcome:"сообщено об отсутствии"},
  conflict:{context:"значения конфликтуют",timing:"время расходится",criterion:"методы расходятся",outcome:"значения расходятся"}
};
const observationFieldStatusLabel = (status,field="context") => labels[status]?.[field]||labels.not_stated[field];
const parseObservationMoment = value => {
  const match=String(value||"").match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/u);
  return match?{precision:"minute"}:null;
};
const enrichedTextLooksLikeSameMention = () => false;
const sandbox={window,console,Map,Set,Math,Array,String,Number,Object};
vm.runInNewContext(fs.readFileSync("observation-engine.js","utf8"),sandbox,{filename:"observation-engine.js"});
const engine=window.NGObservationEngine.create({
  knowledge,normalise,parseObservationMoment,enrichedTextLooksLikeSameMention,
  observationFieldStatus,observationFieldStatusLabel
});
const field=(value,status="provided")=>({status,value,source:"direct_observation"});
const card=(id,polarity,eventRef,details={},evidence=id)=>({
  id,subject:"Фактор А",object:"Результат Б",polarity,evidence,recordedAt:1000,
  source:"user_message",verification:"unverified",
  details:{eventRef,context:field("обычный день"),timing:field("2026-11-09 08:00"),
    criterion:field("фиксировался результат"),outcome:field("есть"),...details}
});

// Explicitly linked cards may enrich one event without being counted as independent cases.
const enriched=engine.uniqueObservationEvents([
  card("a1",true,"event-a",{outcome:field("","not_stated")}),
  card("a2",true,"event-a",{context:field("","not_stated"),outcome:field("6/10")}),
  card("b1",false,"event-b",{context:field("выходной")})
]);
assert.equal(enriched.events.length,2);
assert.equal(enriched.explicitDuplicateGroups,1);
assert.equal(enriched.events[0].details.outcome.value,"6/10");
assert.equal(enriched.events[0].details.context.status,"provided");

// Conflicting values inside an explicitly linked event block readiness.
const conflicting=engine.uniqueObservationEvents([
  card("c1",true,"event-c",{context:field("после тренировки")}),
  card("c2",true,"event-c",{context:field("в отпуске")})
]);
assert.equal(conflicting.events[0].details.context.status,"conflict");
assert.equal(engine.observationEventQuality(conflicting.events[0]).complete,false);

// Same-text cards without event IDs remain a possible duplicate, not confirmed identity.
const possible=engine.uniqueObservationEvents([
  card("p1",true,"",{context:field("обычный день")},"одно и то же описание"),
  card("p2",true,"",{context:field("обычный день")},"одно и то же описание")
]);
assert.equal(possible.events.length,1);
assert.equal(possible.events[0].identityUnresolved,true);
assert.equal(possible.possibleDuplicateGroups,1);

// Inquiry metadata is visible but never pooled into the underlying observation cards.
const incompleteCards=[
  card("pos",true,"pos-event",{context:field("","not_stated"),timing:field("","not_stated"),criterion:field("","not_stated")}),
  card("neg",false,"neg-event",{context:field("","not_stated"),timing:field("","not_stated"),criterion:field("","not_stated")})
];
const readiness=engine.reviewReadinessForEdge(incompleteCards,[{
  id:"Q1",status:"answered",edgeSubject:"Фактор А",edgeObject:"Результат Б",
  responseText:"контекст: после тренировки"
}],"Фактор А","Результат Б");
assert.equal(readiness.answerContextStatus,"provided");
assert.equal(readiness.contextStatus,"not_stated");
assert.equal(readiness.ready,false);

// Fully described, separately identified outcomes may open a review candidate.
const completeCards=[
  card("positive",true,"pos",{context:field("после тренировки"),timing:field("2026-11-09 08:00"),criterion:field("по шкале 1–10"),outcome:field("6/10")}),
  card("negative",false,"neg",{context:field("без тренировки"),timing:field("2026-11-09 09:00"),criterion:field("по шкале 1–10"),outcome:field("2/10")})
];
const ready=engine.reviewReadinessForEdge(completeCards,[],"Фактор А","Результат Б");
assert.equal(ready.ready,true);
assert.equal(ready.completeEventCount,2);

// A possible duplicate cannot create a confirmed comparable pair.
const dossier=engine.evidenceReconciliationForEdge([
  card("same-a",true,"",{context:field("обычный день")},"повторяемый текст"),
  card("same-b",true,"",{context:field("обычный день")},"повторяемый текст"),
  card("opposite",false,"negative",{context:field("обычный день")})
],"Фактор А","Результат Б");
assert.equal(dossier.identityUnresolvedCount,1);
assert.equal(dossier.alignedPairCount,0);
assert.equal(dossier.incompletePairCount,1);

// Different explicit event references must never be merged, even when the text is identical.
const separateIds=engine.uniqueObservationEvents([
  card("ref-a",true,"episode-a",{},"identical text"),
  card("ref-b",true,"episode-b",{},"identical text")
]);
assert.equal(separateIds.events.length,2);
assert.equal(separateIds.possibleDuplicateGroups,0);

// Timing-only differences are surfaced separately from context/method mismatches.
const timingOnly=engine.evidenceReconciliationForEdge([
  card("time-positive",true,"time-a",{context:field("обычный день"),timing:field("2026-11-09 08:00")}),
  card("time-negative",false,"time-b",{context:field("обычный день"),timing:field("2026-11-09 20:00")})
],"Фактор А","Результат Б");
assert.equal(timingOnly.timingOnlyPairCount,1);
assert.equal(timingOnly.timingDifferencePairCount,1);
assert.equal(timingOnly.alignedPairCount,1,
  "context and criterion alignment should remain visible while time is separately flagged");
assert.equal(JSON.stringify(timingOnly.oppositePairs[0].changedDimensions),JSON.stringify(["timing"]));

// Multiple dimensions changing together must not be attributed to one factor.
const mixedParameters=engine.evidenceReconciliationForEdge([
  card("mixed-positive",true,"mixed-a",{context:field("после тренировки"),timing:field("2026-11-09 08:00"),criterion:field("по описанию")}),
  card("mixed-negative",false,"mixed-b",{context:field("день отдыха"),timing:field("2026-11-09 20:00"),criterion:field("по записи")})
],"Фактор А","Результат Б");
assert.equal(mixedParameters.multiDimensionDifferencePairCount,1);
assert.equal(mixedParameters.contextTimingDifferencePairCount,1);
assert.match(mixedParameters.pattern,/нескольких параметров/u);
assert.match(mixedParameters.recommendation,/Нельзя выделить роль отдельного фактора/u);

// Missing, unknown, unrecorded and explicitly absent values remain distinct.
const fieldStatuses=engine.evidenceReconciliationForEdge([
  card("field-status",true,"field-status",{context:field("","not_recorded"),timing:field("","unknown"),
    criterion:field("","none_reported"),outcome:field("","not_stated")})
],"Фактор А","Результат Б");
assert.equal(fieldStatuses.fieldStatusCounts.context.not_recorded,1);
assert.equal(fieldStatuses.fieldStatusCounts.timing.unknown,1);
assert.equal(fieldStatuses.fieldStatusCounts.criterion.none_reported,1);
assert.equal(fieldStatuses.fieldStatusCounts.outcome.not_stated,1);

// Memory rows are not independent sources: only distinct, explicit, verified source references count.
const provenance=engine.evidenceReconciliationForEdge([
  {...card("source-a",true,"source-event-a",{sourceRef:"paper-1"}),verification:"verified"},
  {...card("source-b",false,"source-event-b",{sourceRef:"paper-1"}),verification:"verified"},
  {...card("source-c",true,"source-event-c",{sourceRef:"paper-2"}),verification:"verified"},
  {...card("source-d",false,"source-event-d",{}),verification:"verified"}
],"Фактор А","Результат Б");
assert.equal(provenance.sourceReferenceCount,2);
assert.equal(provenance.independentVerifiedSources,2,
  "the same verified source reference must count once even when it appears in multiple memory records");
assert.equal(provenance.verifiedWithoutSourceRef,1,
  "a verified flag without a traceable source reference must not count as an independent source");

// The default user-message source remains visibly unverified.
const userProvenance=engine.evidenceReconciliationForEdge([
  card("user-a",true,"user-event-a"),card("user-b",false,"user-event-b")
],"Фактор А","Результат Б");
assert.equal(userProvenance.userReportedUnverifiedCount,2);

console.log("NEUROGENESIS observation engine tests: grouping, explicit enrichment, conflicts, inquiry isolation, evidence provenance, status breakdown and mixed-parameter analysis passed.");
