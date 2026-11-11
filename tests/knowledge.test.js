"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("knowledge.js", "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: "knowledge.js" });
const knowledge = sandbox.window.NGKnowledge;
assert.ok(knowledge, "knowledge module should expose its API");
assert.equal(knowledge.systemProfile().name,"NEUROGENESIS");
assert.equal(knowledge.systemProfile().languageModelConnected,false);
assert.equal(knowledge.sameEntity("снижение концентрации","снижению концентрации"),true,"Russian case endings should converge to the same concept for causal chaining");
assert.equal(knowledge.sameEntity("здание","здания"),true,
  "Russian neuter nouns ending in -ие/-ия should converge across grammatical cases");
const v18SleepCause=knowledge.extractClaims("Недостаток сна может приводить к усталости")[0];
const fatigueCause=knowledge.extractClaims("Усталость приводит к снижению концентрации")[0];
assert.equal(v18SleepCause.kind,"causal");
assert.equal(v18SleepCause.subject,"Недостаток сна");
assert.equal(v18SleepCause.object,"усталости");
assert.equal(v18SleepCause.modality,"possible");
assert.equal(fatigueCause.kind,"causal");
const quotedCausalSentence="Есть только исходное утверждение о том, что усталость приводит к снижению концентрации.";
assert.equal(knowledge.extractClaims(quotedCausalSentence).length,0,
  "a causal clause introduced as quoted/reporting context must not become a new causal claim");
assert.equal(knowledge.extractClaims("что усталость приводит к снижению концентрации").length,0,
  "a subordinate clause beginning with 'что' must not be treated as an independent causal subject");
assert.equal(knowledge.extractClaims("Ответ на вопрос Q2: В памяти нет наблюдений. "+quotedCausalSentence).length,0,
  "research answers must remain contextual testimony even after memory reloading");
const malformedQuotedClaim={id:"legacy-quoted-cause",kind:"causal",subject:"что усталость",predicate:"приводит к",
  object:"снижению концентрации",evidence:"что усталость приводит к снижению концентрации",
  verification:"unverified",extractionConfidence:0.88,createdAt:1};
assert.equal(knowledge.sanitizeClaims([malformedQuotedClaim]).length,0,
  "legacy causal claims with a subordinate-clause subject must be removed during migration");

for (const subject of [
  "В отчёте говорится, что усталость",
  "Сообщается, что усталость",
  "Формулировка о том, что усталость",
  "По данным исследования, усталость"
]) {
  const raw = {...malformedQuotedClaim, subject};
  assert.equal(knowledge.extractClaims(subject + " приводит к снижению концентрации").length, 0,
    "reporting clauses must not be extracted as causal subjects: " + subject);
  assert.equal(knowledge.sanitizeClaims([raw]).length, 0,
    "reporting clauses must not survive archived-claim sanitization: " + subject);
}
const sourceAttributedCausal="По данным исследования, усталость приводит к снижению концентрации";
assert.equal(knowledge.extractClaims(sourceAttributedCausal).length,0,
  "a comma-separated source preamble must not be dropped before causal extraction");
assert.equal(knowledge.isReportedCausalStatement(sourceAttributedCausal),true,
  "archive validators must be able to distinguish source-attributed evidence from a direct assertion");
assert.equal(knowledge.sanitizeClaims([{...malformedQuotedClaim,subject:"усталость",evidence:sourceAttributedCausal}]).length,0,
  "a legacy claim whose evidence is source-attributed must not re-enter active knowledge");
for (const reportedPrefix of [
  "Исследование показало, что усталость",
  "Исследователи установили, что усталость"
]) {
  const reportedSentence = reportedPrefix + " приводит к снижению концентрации";
  assert.equal(knowledge.extractClaims(reportedSentence).length, 0,
    "research summaries must not become direct causal claims: " + reportedPrefix);
  assert.equal(knowledge.isReportedCausalStatement(reportedSentence), true,
    "archive validation must recognize research-summary phrasing: " + reportedPrefix);
}
const validCausalSubject = "Недостаток сна после тренировки";
assert.equal(knowledge.extractClaims(validCausalSubject + " приводит к усталости").length, 1,
  "a descriptive causal subject must remain valid");
assert.equal(knowledge.sanitizeClaims([{...malformedQuotedClaim, subject:validCausalSubject}]).length, 1,
  "valid archived causal subjects must not be over-filtered");
assert.equal(knowledge.summary([v18SleepCause,fatigueCause]).causal,2);
const causalChain=knowledge.causalEvidence("Как недостаток сна влияет на снижение концентрации?",[v18SleepCause,fatigueCause]);
assert.ok(causalChain,"two causal memories should form a chain");
assert.equal(causalChain.paths[0].length,2,"the inference should be limited to the two stored causal steps");
assert.match(causalChain.answer,/Недостаток сна → усталости → снижению концентрации/u);
assert.match(causalChain.answer,/Недостаток сна может приводить к усталости/u);
assert.match(causalChain.answer,/не проверял причинность независимо/u);
assert.match(knowledge.answerQuestion("Что может вызвать снижение концентрации?",[v18SleepCause,fatigueCause]),/Недостаток сна → усталости → снижению концентрации/u);
assert.match(knowledge.answerQuestion("К чему может привести Недостаток сна?",[v18SleepCause,fatigueCause]),/усталости/u);
assert.equal(knowledge.causalEvidence("Как дождь влияет на концентрацию?",[v18SleepCause,fatigueCause]),null,"unrelated concepts must not be connected by guesswork");
const cycleA=knowledge.extractClaims("Импульс вызывает возбуждение")[0];
const cycleB=knowledge.extractClaims("Возбуждение приводит к импульсу")[0];
assert.ok(knowledge.findCausalPaths("Импульс",[cycleA,cycleB]).length<=2,"causal cycles must not recurse without bound");
const phoneAssociation = knowledge.semanticMatch("телефоне","смартфон");
assert.equal(phoneAssociation.directHits,0,"related words must not be counted as exact matches");
assert.equal(phoneAssociation.associativeHits,1,"the semantic layer should connect phone and smartphone during retrieval");
assert.equal(phoneAssociation.score,0.45,"associative matches must be weaker than exact matches");
assert.equal(knowledge.semanticMatch("телефон","телефон").score,1,"exact matches must retain full weight");
assert.match(knowledge.answerQuestion("Кто ты?", []),/Я — NEUROGENESIS/u,"system identity should not depend on user memories");
assert.match(knowledge.answerQuestion("Что ты умеешь?", []),/до 500 записей/u,"capabilities should describe the implemented memory limit");
assert.match(knowledge.answerQuestion("Что ты умеешь?", []),/не умею свободно рассуждать/u,"the system should state its current reasoning limitations");
assert.match(knowledge.answerQuestion("Что ты умеешь?", []),/хронологию/u,"the system should describe the new event timeline capability and its explicit-date boundary");
assert.match(knowledge.answerQuestion("Что ты знаешь обо мне?", []),/нет конкретных сведений о тебе/u,"an empty user profile should be explained without inventing facts");

const temporalAnchor = new Date(2026,10,11,12,0,0,0).getTime();
const lastYearFact = knowledge.extractClaims("В прошлом году я жил в Сочи", temporalAnchor)[0];
assert.ok(lastYearFact, "a past-tense self-report with a relative year should be extracted");
assert.equal(lastYearFact.predicate,"живу в");
assert.equal(lastYearFact.object,"Сочи");
assert.equal(lastYearFact.validFrom,new Date(2025,0,1).getTime());
assert.equal(lastYearFact.validTo,new Date(2026,0,1).getTime());
assert.equal(lastYearFact.temporalPrecision,"year");
assert.equal(knowledge.answerQuestion("Где я жил в прошлом году?",[lastYearFact]).includes("Сочи"),true,
  "a historical-period question should retrieve a claim that is no longer current");

const lastSummerFact=knowledge.extractClaims("С прошлого лета я живу в Париже",temporalAnchor)[0];
assert.ok(lastSummerFact,"a since-season phrase without an explicit subject pronoun should be extracted");
assert.equal(lastSummerFact.validFrom,new Date(2026,5,1).getTime());
assert.equal(lastSummerFact.temporalPrecision,"season");
assert.equal(lastSummerFact.temporalRelation,"since");

const reconstructed=knowledge.extractClaims(
  "Раньше я жил в Сочи, а с прошлого лета я живу в Париже",temporalAnchor);
assert.equal(reconstructed.length,2,"a compound transition should produce two separate location claims");
const sochiHistory=reconstructed.find(claim=>claim.object==="Сочи");
const parisCurrent=reconstructed.find(claim=>claim.object==="Париже");
assert.ok(sochiHistory&&parisCurrent);
assert.equal(sochiHistory.validTo,parisCurrent.validFrom,
  "the previous location may be bounded by the explicitly dated start of the new location");
assert.equal(sochiHistory.status,"current",
  "a bounded historical interval remains queryable as-of a past date, although not current today");
assert.match(knowledge.answerQuestion("Где я жил в прошлом году?",reconstructed),
  /начало периода не указано/u,
  "the answer should disclose an unknown lower boundary rather than inventing a start date");

const undatedPast=knowledge.extractClaims("Раньше я жил в Сочи",temporalAnchor)[0];
assert.equal(undatedPast.status,"historical");
assert.equal(undatedPast.validFrom,null);
assert.equal(undatedPast.validTo,null);
assert.match(knowledge.answerQuestion("Где я жил в прошлом году?",[undatedPast]),
  /нет даты или периода/u,
  "undated history must not be assigned to an arbitrary calendar year");

const explicitMonth=knowledge.parseTemporalPeriod("июня 2024",temporalAnchor);
assert.equal(explicitMonth.start,new Date(2024,5,1).getTime(),
  "a genitive Russian month form with a year should resolve to the month interval");
assert.equal(explicitMonth.end,new Date(2024,6,1).getTime());
const explicitDay=knowledge.parseTemporalPeriod("20.10.2024",temporalAnchor);
assert.equal(explicitDay.start,new Date(2024,9,20).getTime(),
  "a dotted calendar date must be parsed before punctuation normalization");
assert.equal(explicitDay.end,new Date(2024,9,21).getTime());
const explicitIsoDay=knowledge.parseTemporalPeriod("2024-10-20",temporalAnchor);
assert.equal(explicitIsoDay.start,new Date(2024,9,20).getTime(),
  "an ISO calendar date must preserve its separators during parsing");
const explicitDayFact=knowledge.extractClaims("Я жил в Казани 20.10.2024",temporalAnchor)[0];
assert.ok(explicitDayFact&&explicitDayFact.validFrom===explicitDay.start&&explicitDayFact.validTo===explicitDay.end);
assert.match(knowledge.answerQuestion("Где я жил 20.10.2024?",[explicitDayFact]),/Казани/u,
  "the historical query parser must retain punctuation inside explicit dates");



const relationship = knowledge.extractClaims("Игорь Головнев твой самый лучший друг")[0];
assert.ok(relationship, "should extract a relationship");
assert.equal(relationship.kind, "relationship");
assert.equal(relationship.subject, "Игорь Головнев");
assert.equal(relationship.predicate, "лучший друг");
assert.equal(relationship.object, "assistant");
assert.equal(relationship.holder, "user");
assert.equal(relationship.source, "user_message");
assert.equal(relationship.verification, "unverified");
assert.match(knowledge.answerQuestion("Кто твой лучший друг?", [relationship]), /Игорь Головнев — мой лучший друг/u);
assert.match(knowledge.answerQuestion("Кто твой лучший друг?", [relationship]), /независимо проверить/u);

const userFriend = knowledge.extractClaims("Игорь — мой друг")[0];
assert.equal(userFriend.object, "user");
assert.match(knowledge.answerQuestion("Кто мой друг?", [userFriend]), /Игорь — твой друг/u);

const assistantIdentity = knowledge.extractClaims("Ты мой оссистент")[0];
assert.ok(assistantIdentity, "a user-defined assistant role should become a structured identity claim");
assert.equal(assistantIdentity.kind, "identity");
assert.equal(assistantIdentity.subject, "assistant");
assert.equal(assistantIdentity.predicate, "роль");
assert.equal(assistantIdentity.object, "ассистент");
assert.equal(assistantIdentity.verification, "self_reported");
assert.match(knowledge.answerQuestion("Кто ты?", [assistantIdentity]), /я — ассистент/u);
assert.match(knowledge.answerQuestion("Кто ты?", [assistantIdentity]), /Ты мой оссистент/u);
assert.equal(knowledge.extractClaims("Ты мой ассистент")[0].object, "ассистент");
assert.equal(knowledge.extractClaims("Ты мой помощник")[0].object, "помощник");
const updatedIdentity = knowledge.extractClaims("Теперь ты мой советник")[0];
assert.equal(updatedIdentity.kind, "identity");
assert.equal(updatedIdentity.object, "советник");
assert.equal(updatedIdentity.revision, true, "explicit temporal wording should mark a role update");
assert.equal(knowledge.extractClaims("С этого момента ты мой собеседник")[0].revision, true);
assert.equal(knowledge.extractClaims("Ты мой друг")[0].object, "друг");
const originalIdentityForTimeline = knowledge.sanitizeClaims([assistantIdentity])[0];
const identityTimeline = [originalIdentityForTimeline, updatedIdentity];
assert.equal(knowledge.reconcileIdentityHistory(identityTimeline), true);
assert.equal(originalIdentityForTimeline.status, "superseded");
assert.equal(originalIdentityForTimeline.supersededBy, updatedIdentity.id);
assert.equal(updatedIdentity.status, "current");
assert.equal(knowledge.findConflicts(identityTimeline).length, 0, "a clear role update should not remain a conflict");
assert.match(knowledge.answerQuestion("Кто ты?", identityTimeline), /я — советник/u);
assert.match(knowledge.answerQuestion("Кто ты?", identityTimeline), /Ранее ты называл меня ассистент/u);
assert.match(knowledge.answerQuestion("Кем ты был раньше?", identityTimeline), /роль «ассистент»/u);
assert.equal(knowledge.summary(identityTimeline).activeIdentities, 1);
assert.match(knowledge.answerQuestion("Кто ты?", [knowledge.extractClaims("Музыка прекрасна")[0]]),/NEUROGENESIS/u,"system identity should be available without a user-defined role");

const assistantCreator = knowledge.extractClaims("Твоего создателя зовут Сергей")[0];
assert.ok(assistantCreator, "the creator statement should be extracted");
assert.equal(assistantCreator.kind, "fact");
assert.equal(assistantCreator.subject, "assistant");
assert.equal(assistantCreator.predicate, "создатель");
assert.equal(assistantCreator.object, "Сергей");
assert.equal(assistantCreator.verification, "self_reported");
assert.match(knowledge.answerQuestion("Кто твой создатель?", [assistantCreator]), /моего создателя зовут Сергей/u);
assert.match(knowledge.answerQuestion("Кто создал тебя?", [assistantCreator]), /моего создателя зовут Сергей/u);
assert.match(knowledge.claimLabel(assistantCreator), /Создатель ассистента — Сергей/u);
assert.equal(knowledge.extractClaims("Твой создатель — Сергей")[0].object, "Сергей");

const identityConflict = knowledge.findConflicts([
  assistantIdentity,
  knowledge.extractClaims("Ты мой помощник")[0]
]);
assert.equal(identityConflict.length, 1, "conflicting role descriptions should be flagged instead of silently overwritten");
const unresolvedIdentityTimeline = [assistantIdentity, knowledge.extractClaims("Ты мой помощник")[0]];
knowledge.reconcileIdentityHistory(unresolvedIdentityTimeline);
assert.equal(knowledge.findConflicts(unresolvedIdentityTimeline).length, 1, "a new role without explicit update wording should remain an unresolved conflict");

const opinion = knowledge.extractClaims("Музыка прекрасна")[0];
assert.ok(opinion, "should classify a simple opinion");
assert.equal(opinion.kind, "opinion");
assert.equal(opinion.subject, "Музыка");
assert.equal(opinion.predicate, "оценка");
assert.equal(opinion.object, "прекрасна");
assert.equal(opinion.verification, "subjective");
assert.match(knowledge.answerQuestion("Что такое музыка?", [opinion]), /субъективное мнение/u);

const preference = knowledge.extractClaims("Мне нравится музыка")[0];
assert.equal(preference.kind, "preference");
assert.equal(preference.object, "музыка");
assert.equal(preference.verification, "self_reported");

const definition = knowledge.extractClaims("Музыка — это искусство")[0];
assert.equal(definition.kind, "definition");
assert.equal(definition.subject, "Музыка");
assert.equal(definition.object, "искусство");

const hypothesis = knowledge.extractClaims("Возможно, память можно улучшить")[0];
assert.equal(hypothesis.kind, "hypothesis");
assert.equal(hypothesis.verification, "hypothesis");

const negative = knowledge.extractClaims("Игорь не мой друг")[0];
assert.equal(negative.kind, "relationship");
assert.equal(negative.polarity, false);
assert.equal(negative.object, "user");

const merged = knowledge.mergeClaims([relationship], [relationship, opinion]);
assert.equal(merged.length, 2, "merge should deduplicate identical structured claims");
const summary = knowledge.summary(merged);
assert.equal(summary.total, 2);
assert.equal(summary.relationships, 1);
assert.equal(summary.opinions, 1);

const compound = knowledge.extractClaims("Я живу в Сочи, мне нравится музыка");
assert.equal(compound.length, 2, "simple comma-separated clauses should produce separate claims");
assert.equal(compound[0].kind, "fact");
assert.equal(compound[0].object, "Сочи");
assert.equal(compound[1].kind, "preference");
assert.equal(compound[1].object, "музыка");
const hypothesisAndFact = knowledge.extractClaims("Возможно, память можно улучшить, я живу в Сочи");
assert.equal(hypothesisAndFact.length, 2);
assert.equal(hypothesisAndFact[0].kind, "hypothesis");
assert.equal(hypothesisAndFact[1].kind, "fact");
assert.equal(hypothesisAndFact[1].object, "Сочи");
const smartphone = knowledge.extractClaims("У меня есть смартфон")[0];
assert.equal(smartphone.object,"смартфон");
const phoneProfile = knowledge.answerQuestion("Что ты знаешь о телефоне?",[smartphone]);
assert.match(phoneProfile,/смартфон/u,"entity profiles should retrieve related concepts through a weighted association");

const location = knowledge.extractClaims("Я живу в Сочи")[0];
assert.equal(location.kind, "fact");
assert.equal(location.subject, "user");
assert.equal(location.predicate, "живу в");
assert.equal(location.object, "Сочи");
const updatedLocation = knowledge.extractClaims("Теперь я живу в Париже")[0];
assert.equal(updatedLocation.kind,"fact");
assert.equal(updatedLocation.revision,true,"explicit temporal wording should mark a personal fact update");
const locationHistory = [knowledge.sanitizeClaims([location])[0],updatedLocation];
knowledge.reconcileKnowledgeHistory(locationHistory);
assert.equal(locationHistory[0].status,"superseded");
assert.equal(locationHistory[0].supersededBy,updatedLocation.id);
assert.equal(updatedLocation.status,"current");
assert.equal(knowledge.findConflicts(locationHistory).length,0,"an explicit location correction should resolve the conflict while preserving history");
assert.match(knowledge.answerQuestion("Где я живу?", locationHistory),/живёшь в Париже/u);
const unresolvedLocations = [location,knowledge.extractClaims("Я живу в Париже")[0]];
knowledge.reconcileKnowledgeHistory(unresolvedLocations);
assert.equal(knowledge.findConflicts(unresolvedLocations).length,1,"a location change without explicit correction wording should remain a possible conflict");
assert.match(knowledge.answerQuestion("Что ты знаешь обо мне?",locationHistory),/историческое самоописание · позже уточнено/u);
const positiveMusic = knowledge.extractClaims("Мне нравится музыка")[0];
const updatedMusic = knowledge.extractClaims("Теперь мне не нравится музыка")[0];
assert.equal(updatedMusic.revision,true);
const musicHistory = [knowledge.sanitizeClaims([positiveMusic])[0],updatedMusic];
knowledge.reconcileKnowledgeHistory(musicHistory);
assert.equal(musicHistory[0].status,"superseded");
assert.equal(knowledge.findConflicts(musicHistory).length,0);
assert.match(knowledge.answerQuestion("Что мне нравится?",musicHistory),/тебе не нравится музыка/u);
assert.match(knowledge.answerQuestion("Где я живу?", [location]), /живёшь в Сочи/u);
assert.match(knowledge.answerQuestion("Что ты знаешь о Сочи?", [location]), /Пользователь живёт в Сочи/u);
const userProfileAnswer = knowledge.answerQuestion("Что ты знаешь обо мне?", [location, preference, userFriend, hypothesis]);
assert.match(userProfileAnswer,/Пользователь живёт в Сочи/u);
assert.match(userProfileAnswer,/Пользователю нравится музыка/u);
assert.match(userProfileAnswer,/Игорь — твой друг/u);
assert.match(userProfileAnswer,/Возможно, память можно улучшить/u);
assert.match(userProfileAnswer,/Источник:/u);
assert.match(knowledge.answerQuestion("Расскажи обо мне", [location]),/Пользователь живёт в Сочи/u);

const directConflict = knowledge.findConflicts([userFriend, negative]);
assert.equal(directConflict.length, 1);
assert.equal(directConflict[0].type, "direct");
assert.match(knowledge.answerQuestion("Кто мой друг?", [userFriend, negative]), /противоречащие утверждения/u);

const secondBestFriend = knowledge.extractClaims("Сергей твой лучший друг")[0];
const possibleConflict = knowledge.findConflicts([relationship, secondBestFriend]);
assert.equal(possibleConflict.length, 1);
assert.equal(possibleConflict[0].type, "possible");
assert.match(knowledge.answerQuestion("Кто твой лучший друг?", [relationship, secondBestFriend]), /не стану выбирать наугад/u);

const mergedFacts = knowledge.mergeClaims([], [location]);
assert.equal(mergedFacts[0].kind, "fact");
assert.equal(knowledge.summary([relationship, opinion, location]).facts, 1);
assert.equal(knowledge.summary([relationship, secondBestFriend]).conflicts, 1);

const reverseFriend = knowledge.extractClaims("Мой самый лучший друг — Игорь Головнев")[0];
assert.equal(reverseFriend.kind, "relationship");
assert.equal(reverseFriend.subject, "Игорь Головнев");
assert.equal(reverseFriend.object, "user");
assert.equal(reverseFriend.predicate, "лучший друг");
assert.match(knowledge.answerQuestion("Кто мой лучший друг?", [reverseFriend]), /Игорь Головнев — твой лучший друг/u);

const reverseFemale = knowledge.extractClaims("Моя лучшая подруга — Аня")[0];
assert.equal(reverseFemale.object, "user");
assert.match(knowledge.answerQuestion("Кто моя лучшая подруга?", [reverseFemale]), /Аня — твоя лучшая подруга/u);

assert.equal(knowledge.sameEntity("Игорь Головнев", "Игоря Головнева"), true);
const declinedConflict = knowledge.findConflicts([
  knowledge.extractClaims("Игорь Головнев — мой друг")[0],
  knowledge.extractClaims("Игоря Головнева не мой друг")[0]
]);
assert.equal(declinedConflict.length, 1);
assert.equal(declinedConflict[0].type, "direct");

const positivePreference = knowledge.extractClaims("Мне нравится музыка")[0];
const negativePreference = knowledge.extractClaims("Я ненавижу музыку")[0];
assert.equal(knowledge.findConflicts([positivePreference, negativePreference])[0].type, "direct");
assert.match(knowledge.answerQuestion("Что мне нравится?", [positivePreference]), /тебе нравится музыка/u);
const dislikePreference = knowledge.extractClaims("Мне не нравится музыка")[0];
assert.match(knowledge.answerQuestion("Что мне нравится?", [dislikePreference]), /тебе не нравится музыка/u);
assert.match(knowledge.claimLabel(dislikePreference), /Пользователю не нравится музыка/u);
assert.match(knowledge.answerQuestion("Что я люблю?", [negativePreference]), /ты не любишь музыку/u);
assert.match(knowledge.claimLabel(negativePreference), /Пользователь не любит музыку/u);

const intensifiedOpinion = knowledge.extractClaims("Музыка очень прекрасна")[0];
assert.equal(intensifiedOpinion.kind, "opinion");
assert.equal(intensifiedOpinion.object, "прекрасна");
const negativeOpinion = knowledge.extractClaims("Музыка не прекрасна")[0];
assert.equal(negativeOpinion.polarity, false);
assert.match(knowledge.answerQuestion("Что ты думаешь о музыке?", [negativeOpinion]), /музыка не прекрасна/iu);

const ambiguous = knowledge.answerQuestion("Кто лучший друг?", [relationship, userFriend]);
assert.match(ambiguous, /относящиеся и ко мне, и к тебе/u);

const musicProfile = knowledge.answerQuestion("Что ты знаешь о музыке?", [opinion, preference]);
assert.match(musicProfile, /Вот что я нашёл в сохранённой памяти/u);
assert.match(musicProfile, /Музыка — прекрасна/u);
assert.match(musicProfile, /нравится музыка/u);
assert.match(musicProfile, /субъективное мнение/u);
assert.match(musicProfile, /самоописание/u);
assert.match(musicProfile, /не независимо проверенные факты/u);

const conflictingMusicProfile = knowledge.answerQuestion("Расскажи мне о музыке", [positivePreference, negativePreference]);
assert.match(conflictingMusicProfile, /возможное противоречие/u);
assert.match(conflictingMusicProfile, /Я не буду автоматически выбирать/u);

assert.equal(knowledge.answerQuestion("Что ты знаешь о неизвестном объекте?", [opinion, preference]), null);

const altSleepExplanation = knowledge.extractClaims("Недостаток сна может приводить к усталости")[0];
const altDehydrationExplanation = knowledge.extractClaims("Обезвоживание может приводить к усталости")[0];
const altCausalOptions = [altSleepExplanation, altDehydrationExplanation];
const altCauseAnswer = knowledge.answerQuestion("Почему возникает усталость?", altCausalOptions);
assert.match(altCauseAnswer,/несколько возможных объяснений/u,"multiple distinct causes should be presented as alternatives");
assert.match(altCauseAnswer,/Недостаток сна → усталости/u);
assert.match(altCauseAnswer,/Обезвоживание → усталости/u);
assert.match(altCauseAnswer,/нельзя определить, какая из них основная/u,"the system must not choose a winner without evidence");
const altCauseRecall = knowledge.causalEvidence("Что ещё может вызвать усталость?", altCausalOptions);
assert.equal(altCauseRecall.alternativeCount,2,"the alternative query should count distinct root causes");
assert.equal(altCauseRecall.paths.length,2);
const altDeniedClaim = knowledge.extractClaims("Обезвоживание не приводит к усталости")[0];
assert.equal(altDeniedClaim.kind,"causal");
assert.equal(altDeniedClaim.polarity,false,"causal negation should be represented explicitly");
assert.match(knowledge.claimLabel(altDeniedClaim),/не приводит к усталости/u);
const altUncertainDenial = knowledge.extractClaims("Обезвоживание не может приводить к усталости")[0];
assert.equal(altUncertainDenial.polarity,false);
assert.equal(altUncertainDenial.modality,"possible");
const altCausalConflict = knowledge.findConflicts([altDehydrationExplanation,altDeniedClaim]);
assert.equal(altCausalConflict.length,1,"opposite statements about the same causal link should be a direct conflict");
assert.equal(altCausalConflict[0].type,"direct");
const altDisputedRecall = knowledge.causalEvidence("Почему возникает усталость?",[altDehydrationExplanation,altDeniedClaim]);
assert.equal(altDisputedRecall.paths.length,1,"a denied relationship must not be traversed as a positive causal edge");
assert.equal(altDisputedRecall.conflicts.length,1);
assert.match(altDisputedRecall.answer,/Противоречие в памяти/u,"causal answers should disclose contradictory evidence");

const v12ConditionalRule=knowledge.extractClaims("Если недостаток сна, то усталость")[0];
assert.equal(v12ConditionalRule.kind,"rule","if-then statements should be stored as conditional rules");
assert.equal(v12ConditionalRule.subject,"недостаток сна");
assert.equal(v12ConditionalRule.object,"усталость");
assert.match(knowledge.claimLabel(v12ConditionalRule),/Условное правило/u);
const v12SupportingObservation=knowledge.extractClaims("При недостатке сна наблюдалась усталость")[0];
assert.equal(v12SupportingObservation.kind,"observation","explicit observations should be stored separately from general causal claims");
assert.equal(v12SupportingObservation.polarity,true);
const v12CounterObservation=knowledge.extractClaims("При недостатке сна не наблюдалась усталость")[0];
assert.equal(v12CounterObservation.kind,"observation");
assert.equal(v12CounterObservation.polarity,false,"an observation without the expected result should be marked as a possible counterexample");
const v12CounterCheck=knowledge.evaluateConditionalHypothesis("Проверь гипотезу: если недостаток сна, то усталость",[v12ConditionalRule,v12CounterObservation]);
assert.equal(v12CounterCheck.status,"counterexample");
assert.equal(v12CounterCheck.counterexampleCount,1);
assert.match(v12CounterCheck.answer,/Потенциальные контрпримеры/u);
assert.match(v12CounterCheck.answer,/не наблюдалась усталость/u);
assert.match(v12CounterCheck.answer,/не доказывают её ложность/u);
assert.match(v12CounterCheck.answer,/случай, когда X было, а Y не наблюдалось/u);
const v21StructuredObservation=knowledge.extractClaims("При недостатке сна наблюдалась усталость; контекст: после тяжёлой тренировки; время: вечером; критерий: по шкале 1–10")[0];
assert.equal(v21StructuredObservation.kind,"observation");
assert.equal(v21StructuredObservation.observationCase.schema,2);
assert.equal(v21StructuredObservation.observationCase.context.status,"provided");
assert.equal(v21StructuredObservation.observationCase.context.value,"после тяжёлой тренировки");
assert.equal(v21StructuredObservation.observationCase.timing.value,"вечером");
assert.equal(v21StructuredObservation.observationCase.criterion.value,"по шкале 1–10");
assert.equal(knowledge.extractClaims("При недостатке сна наблюдалась усталость; контекст: после тяжёлой тренировки; время: вечером; критерий: по шкале 1–10").length,1,
  "labelled observation metadata must stay attached to the observation rather than being split into unrelated claims");
const v21MissingObservation=knowledge.extractClaims("При недостатке сна не наблюдалась усталость; контекст: не записан; время: неизвестно; критерий: нет данных")[0];
assert.equal(v21MissingObservation.observationCase.context.status,"not_recorded");
assert.equal(v21MissingObservation.observationCase.timing.status,"unknown");
assert.equal(v21MissingObservation.observationCase.criterion.status,"not_recorded");
const v21InquiryDetails=knowledge.parseObservationDetails("Обстоятельства двух наблюдений не указаны; даты и время неизвестны; критерий определения результата не описан","inquiry_response");
assert.equal(v21InquiryDetails.context.status,"not_recorded");
assert.equal(v21InquiryDetails.timing.status,"unknown");
assert.equal(v21InquiryDetails.criterion.status,"not_recorded");
const v21NoFalseCriterion=knowledge.parseObservationDetails("Нет конкретных зафиксированных естественных наблюдений","inquiry_response");
assert.equal(v21NoFalseCriterion.criterion.status,"not_stated",
  "absence of recorded observations must not be mistaken for a described measurement method");
const v21MeasuredObservation=knowledge.extractClaims("При недостатке сна наблюдалась усталость; контекст: после тренировки; время: 2026-11-09 07:15; критерий: по шкале 1–10; результат: 6/10; событие: сон-эпизод-01")[0];
assert.equal(v21MeasuredObservation.observationCase.criterion.value,"по шкале 1–10");
assert.equal(v21MeasuredObservation.observationCase.outcome.status,"provided");
assert.equal(v21MeasuredObservation.observationCase.outcome.value,"6/10");
assert.equal(v21MeasuredObservation.observationCase.eventRef,"сон-эпизод-01");

const eventObservationOne = knowledge.extractClaims(
  "При недостатке сна наблюдалась усталость; контекст: после тренировки; время: вечером; критерий: по шкале 1–10; событие: sleep-event-A"
)[0];
const eventObservationSame = {
  ...eventObservationOne,
  id: "observation-sleep-event-A-duplicate"
};
const eventObservationSeparate = {
  ...eventObservationOne,
  id: "observation-sleep-event-B",
  observationCase: {
    ...eventObservationOne.observationCase,
    eventRef: "sleep-event-B"
  }
};
const mergedEventObservations = knowledge.mergeClaims(
  [eventObservationOne],
  [eventObservationSame, eventObservationSeparate]
);
assert.equal(mergedEventObservations.length, 2,
  "identical observation cards from different explicit events must remain separate evidence");
assert.equal(
  [...mergedEventObservations.map(claim => claim.observationCase.eventRef)].sort().join("|"),
  "sleep-event-A|sleep-event-B",
  "event identity must participate in structured-observation deduplication"
);
assert.ok(
  mergedEventObservations.some(claim => claim.id === eventObservationOne.id),
  "the original evidence identity must be retained when the same event is merged"
);

const v21Sanitized=knowledge.sanitizeClaims([v21StructuredObservation])[0];
assert.equal(v21Sanitized.observationCase.context.value,"после тяжёлой тренировки");
assert.equal(v21Sanitized.observationCase.schema,2);
assert.equal(v21Sanitized.observationCase.outcome.status,"not_stated",
  "older observation cards must migrate with an explicit empty measured-result field");

const v12SupportCheck=knowledge.evaluateConditionalHypothesis("Проверь правило: если недостаток сна, то усталость",[v12SupportingObservation]);
assert.equal(v12SupportCheck.status,"consistent");
assert.match(v12SupportCheck.answer,/согласуются с правилом/u);
assert.match(v12SupportCheck.answer,/не доказывают, что оно выполняется всегда/u);
const v12MixedCheck=knowledge.evaluateConditionalHypothesis("Найди контрпримеры к правилу: если недостаток сна, то усталость",[v12SupportingObservation,v12CounterObservation]);
assert.equal(v12MixedCheck.status,"mixed");
assert.match(v12MixedCheck.answer,/Картина смешанная/u);
const v12NoDataCheck=knowledge.evaluateConditionalHypothesis("Проверь гипотезу: если недостаток сна, то усталость",[]);
assert.equal(v12NoDataCheck.status,"insufficient");
assert.match(v12NoDataCheck.answer,/Недостаточно данных/u);
assert.equal(knowledge.summary([v12ConditionalRule,v12SupportingObservation]).rules,1);
assert.equal(knowledge.summary([v12ConditionalRule,v12SupportingObservation]).observations,1);

const v13ExperimentPlan=knowledge.designDiscriminatingTest("Как различить причины усталости?",altCausalOptions);
assert.ok(v13ExperimentPlan,"the system should build a comparison plan when multiple explanations exist");
assert.equal(v13ExperimentPlan.alternativeCount,2);
assert.match(v13ExperimentPlan.answer,/План различающей проверки/u);
assert.match(v13ExperimentPlan.answer,/Если два фактора всегда появляются одновременно/u);
assert.match(v13ExperimentPlan.answer,/не доказывает причинность/u);
assert.match(v13ExperimentPlan.answer,/Не нужно специально создавать вредные условия/u);
const v13SinglePlan=knowledge.designDiscriminatingTest("Как различить причины усталости?",[altSleepExplanation]);
assert.equal(v13SinglePlan.alternativeCount,1);
assert.match(v13SinglePlan.answer,/только одно возможное объяснение/u);
const v13NoPlan=knowledge.designDiscriminatingTest("Как различить причины неизвестного явления?",[]);
assert.equal(v13NoPlan,null);

const v14Derived=knowledge.deriveHypotheses("Какие новые гипотезы можно вывести из памяти?",[v18SleepCause,fatigueCause]);
assert.ok(v14Derived,"a multi-step causal path should yield a candidate hypothesis");
assert.ok(v14Derived.hypotheses.some(item=>knowledge.sameEntity(item.subject,"Недостаток сна")&&knowledge.sameEntity(item.object,"снижению концентрации")));
assert.match(v14Derived.answer,/Недостаток сна ⇢ снижению концентрации/u);
assert.match(v14Derived.answer,/Недостаток сна → Усталость → снижению концентрации/u);
assert.match(v14Derived.answer,/НЕ означает, что первая сущность напрямую вызывает последнюю/u);
assert.match(v14Derived.answer,/не добавлены в долговременную память/u);
const v14NoNew=knowledge.deriveHypotheses("Выведи новые гипотезы из памяти",[v18SleepCause,fatigueCause,knowledge.extractClaims("Недостаток сна приводит к снижению концентрации")[0]]);
assert.equal(v14NoNew,null,"an already stored direct relation should not be offered as a new hypothesis");
const v14Blocked=knowledge.deriveHypotheses("Выведи новые гипотезы",[v18SleepCause,fatigueCause,knowledge.extractClaims("Усталость не приводит к снижению концентрации")[0]]);
assert.equal(v14Blocked,null,"a chain with a disputed causal edge should not be used to derive a new hypothesis");
assert.equal(knowledge.deriveHypotheses("Выведи новые гипотезы",[]),null);


const v15DehydrationCause=knowledge.extractClaims("Обезвоживание может приводить к усталости")[0];
const v15CounterObservation=knowledge.extractClaims("При недостатке сна не наблюдалась усталость")[0];
const v15Rule=knowledge.extractClaims("Если недостаток сна, то усталость")[0];
const v15Priority=knowledge.prioritizeHypotheses("Какую гипотезу проверять первой?",[
  v18SleepCause,fatigueCause,v15DehydrationCause,v15Rule,v15CounterObservation
]);
assert.ok(v15Priority,"the system should rank investigative priorities for derived hypotheses");
assert.equal(v15Priority.hypotheses.length,2);
assert.ok(knowledge.sameEntity(v15Priority.hypotheses[0].subject,"Недостаток сна"),"a hypothesis with a stored potential counterexample should be prioritized for clarification");
assert.equal(v15Priority.hypotheses[0].counterexamples.length,1);
assert.ok(knowledge.sameEntity(v15Priority.hypotheses[1].subject,"Обезвоживание"));
assert.equal(v15Priority.hypotheses[1].counterexamples.length,0);
assert.ok(v15Priority.hypotheses[1].unobserved.length>0,"missing observations should be distinguished from supporting evidence");
assert.ok(v15Priority.sharedEdges.some(edge=>knowledge.sameEntity(edge.subject,"Усталость")&&knowledge.sameEntity(edge.object,"снижению концентрации")),"shared chain links must be disclosed, not counted as independent evidence");
assert.match(v15Priority.answer,/порядок работы с пробелами и противоречиями/u);
assert.match(v15Priority.answer,/Потенциальный контрпример/u);
assert.match(v15Priority.answer,/не становится независимым подтверждением/u);
assert.match(v15Priority.answer,/пробел данных, а не подтверждение/u);
assert.match(knowledge.answerQuestion("Какую гипотезу проверять первой?",[
  v18SleepCause,fatigueCause,v15DehydrationCause,v15Rule,v15CounterObservation
]),/ПРИОРИТЕТ 1/u);
assert.equal(knowledge.prioritizeHypotheses("Какую гипотезу проверять первой?",[]).hypotheses.length,0);
assert.equal(knowledge.version,24);

const legacy = knowledge.sanitizeClaims(undefined);
assert.equal(legacy.length, 0);
console.log("NEUROGENESIS knowledge tests: Russian morphology, assistant identity, creator, entity profiles and conflict checks passed.");


// Temporal claim validity is independent from recording time and lifecycle status.
const temporalNow = Date.now();
const timeBoundedClaim = knowledge.sanitizeClaims([{
  ...location, id:"C-TEMPORAL-LOCATION", validFrom:temporalNow-60000, validTo:temporalNow+60000
}])[0];
assert.equal(timeBoundedClaim.validFrom, temporalNow-60000);
assert.equal(timeBoundedClaim.validTo, temporalNow+60000);
assert.equal(knowledge.isCurrentClaim(timeBoundedClaim, temporalNow), true);
assert.equal(knowledge.isCurrentClaim({...timeBoundedClaim, validFrom:temporalNow+10000}, temporalNow), false,
  "future-effective claims must not be treated as current");
assert.equal(knowledge.isCurrentClaim({...timeBoundedClaim, validTo:temporalNow}, temporalNow), false,
  "validTo is an exclusive boundary and an expired claim must not be current");
assert.equal(knowledge.sanitizeClaims([{...location, validFrom:"not-a-date"}]).length, 0,
  "malformed temporal metadata must not silently become an unbounded current fact");
assert.equal(knowledge.sanitizeClaims([{...location, validFrom:temporalNow, validTo:temporalNow}]).length, 0,
  "an empty or reversed validity interval must be rejected");

const archivedLocation = knowledge.sanitizeClaims([{
  ...location, id:"C-ARCHIVED-LOCATION", status:"archived"
}])[0];
assert.equal(knowledge.isCurrentClaim(archivedLocation), false);
assert.equal(knowledge.answerQuestion("Где я живу?", [archivedLocation]), null,
  "an archived location must not leak into a current-location answer");
assert.match(knowledge.answerQuestion("Что ты знаешь обо мне?", [archivedLocation]), /архивная запись/u,
  "profile summaries may preserve inactive history only with an explicit status label");

const archivedCause = knowledge.sanitizeClaims([{
  ...v18SleepCause, id:"C-ARCHIVED-SLEEP-CAUSE", status:"archived"
}])[0];
assert.equal(knowledge.causalEvidence("К чему может привести Недостаток сна?", [archivedCause]), null,
  "archived causal edges must not be used to answer current causal questions");

const orphanedSuperseded = {...location, id:"C-ORPHANED-SUPERSEDED", status:"superseded", supersededBy:"C-MISSING-REPLACEMENT"};
knowledge.reconcileMutableHistory([orphanedSuperseded]);
assert.equal(orphanedSuperseded.status, "superseded",
  "history reconciliation must not reactivate a superseded claim when its replacement is absent");
assert.equal(knowledge.isCurrentClaim(orphanedSuperseded), false);

const nonOverlappingHistory = [
  {...userFriend, id:"C-RELATION-OLD", validFrom:temporalNow-30000, validTo:temporalNow-10000},
  {...negative, id:"C-RELATION-NEW", validFrom:temporalNow-10000, validTo:temporalNow+30000}
];
assert.equal(knowledge.findConflicts(nonOverlappingHistory, temporalNow-20000).length, 0,
  "claims from successive non-overlapping validity periods must not be reported as a simultaneous conflict");
assert.equal(knowledge.findConflicts([
  {...userFriend, validFrom:temporalNow-10000, validTo:temporalNow+10000},
  {...negative, validFrom:temporalNow-10000, validTo:temporalNow+10000}
], temporalNow).length, 1,
  "opposing claims with overlapping validity periods must still be reported as a conflict");

const pastLocationConflicts = [
  {...location, id:"C-PAST-SOCHI", object:"Сочи",
    validFrom:temporalNow-200000, validTo:temporalNow-100000},
  {...location, id:"C-PAST-PARIS", object:"Париж",
    validFrom:temporalNow-200000, validTo:temporalNow-100000}
];
assert.equal(knowledge.findConflicts(pastLocationConflicts, temporalNow-150000).length, 1,
  "as-of conflict checks must honour the requested historical time instead of rechecking against the wall clock");

assert.equal(knowledge.parseClaimTime(1700000000), 1700000000000,
  "Unix seconds must be converted to milliseconds");
assert.equal(knowledge.parseClaimTime(946684800000), 946684800000,
  "millisecond timestamps from before 2001 must not be misread as Unix seconds");

const sameFactDifferentPeriods = knowledge.mergeClaims([], [
  {...location, id:"C-SOCHI-PERIOD-1", validFrom:temporalNow-100000, validTo:temporalNow-50000},
  {...location, id:"C-SOCHI-PERIOD-2", validFrom:temporalNow-40000, validTo:temporalNow}
]);
assert.equal(sameFactDifferentPeriods.length, 2,
  "identical facts with different validity intervals must not be collapsed into one memory claim");
