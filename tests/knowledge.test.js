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
const sleepCause=knowledge.extractClaims("Недостаток сна может приводить к усталости")[0];
const fatigueCause=knowledge.extractClaims("Усталость приводит к снижению концентрации")[0];
assert.equal(sleepCause.kind,"causal");
assert.equal(sleepCause.subject,"Недостаток сна");
assert.equal(sleepCause.object,"усталости");
assert.equal(sleepCause.modality,"possible");
assert.equal(fatigueCause.kind,"causal");
assert.equal(knowledge.summary([sleepCause,fatigueCause]).causal,2);
const causalChain=knowledge.causalEvidence("Как недостаток сна влияет на снижение концентрации?",[sleepCause,fatigueCause]);
assert.ok(causalChain,"two causal memories should form a chain");
assert.equal(causalChain.paths[0].length,2,"the inference should be limited to the two stored causal steps");
assert.match(causalChain.answer,/Недостаток сна → усталости → снижению концентрации/u);
assert.match(causalChain.answer,/Недостаток сна может приводить к усталости/u);
assert.match(causalChain.answer,/не проверял причинность независимо/u);
assert.match(knowledge.answerQuestion("Что может вызвать снижение концентрации?",[sleepCause,fatigueCause]),/Недостаток сна → усталости → снижению концентрации/u);
assert.match(knowledge.answerQuestion("К чему может привести Недостаток сна?",[sleepCause,fatigueCause]),/усталости/u);
assert.equal(knowledge.causalEvidence("Как дождь влияет на концентрацию?",[sleepCause,fatigueCause]),null,"unrelated concepts must not be connected by guesswork");
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
assert.match(knowledge.answerQuestion("Что ты знаешь обо мне?", []),/нет конкретных сведений о тебе/u,"an empty user profile should be explained without inventing facts");

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
const legacy = knowledge.sanitizeClaims(undefined);
assert.equal(legacy.length, 0);
console.log("NEUROGENESIS knowledge tests: Russian morphology, assistant identity, creator, entity profiles and conflict checks passed.");
