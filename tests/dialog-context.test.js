"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
vm.runInNewContext(fs.readFileSync("knowledge.js", "utf8"), sandbox, { filename: "knowledge.js" });
vm.runInNewContext(fs.readFileSync("dialog-context.js", "utf8"), sandbox, { filename: "dialog-context.js" });
const engine = window.NGDialogContext.create(window.NGKnowledge);
let state = engine.empty();
state = engine.track(state, { role: "user", text: "Недостаток сна сегодня вызвал у меня усталость", time: 1 });
const firstThread = state.activeThreadId;
state = engine.track(state, { role: "assistant", text: "Сколько часов ты спал? И как определяешь усталость?", time: 2 });
assert.match(engine.report(state).activeThread.pendingQuestion, /сколько часов/iu);
state = engine.track(state, { role: "user", text: "Примерно четыре часа", time: 3 });
assert.equal(state.activeThreadId, firstThread, "an answer must remain in the current thread");
assert.equal(state.messages[state.messages.length - 1].relation, "answer_to_question");
const resolved = engine.resolve(state, "А почему?");
assert.equal(resolved.applied, true, "short follow-ups should inherit the active context");
assert.match(resolved.query, /усталость/u);
assert.equal(engine.hasReference("А это почему?"), true,
  "Russian demonstrative references must be detected with Unicode-aware boundaries");
assert.equal(engine.hasReference("Что такое контекст диалога?"), false,
  "the phrase 'что такое' must not by itself force an unrelated concept question into the old topic");

state = engine.track(state, { role: "user", text: "Теперь поговорим о музыке и музыкальных инструментах", time: 4 });
const musicThread = state.activeThreadId;
assert.notEqual(musicThread, firstThread, "clear topic change should create a separate thread");
state = engine.track(state, { role: "user", text: "Вернёмся к недостаток сна", time: 5 });
assert.equal(state.activeThreadId, firstThread, "explicit return should restore the matching prior thread");
assert.equal(state.threads.find(row => row.id === musicThread).status, "paused");
const history = engine.history(state, firstThread);
assert.ok(history.length >= 3, "thread history should remain separate");
assert.equal(engine.history(state, musicThread).some(row => /недостатку сна/u.test(row.text)), false,
  "messages from another topic must not leak into the music thread");
const previousSleepLastUserText = state.threads.find(row => row.id === firstThread).lastUserText;
const unresolved = engine.track(state, { role: "user", text: "Вернёмся к квантовым вычислениям", time: 6 });
assert.notEqual(unresolved.activeThreadId, firstThread,
  "an unresolved topic return must open a separate clarification thread");
assert.equal(unresolved.threads.find(row => row.id === firstThread).lastUserText, previousSleepLastUserText,
  "an unresolved topic return must not overwrite the unrelated active thread's last user message");
assert.equal(unresolved.messages[unresolved.messages.length - 1].relation, "new_topic");
assert.equal(engine.resolve(unresolved, "А почему?").applied, false,
  "an unresolved return must not borrow context from the currently active unrelated topic");
assert.equal(engine.isLikelyAnswer("Примерно четыре часа", "Сколько часов ты спал?"), true,
  "a concise answer sharing the requested quantity must attach to the pending question");
assert.equal(engine.isLikelyAnswer("Музыка прекрасна", "Сколько часов ты спал?"), false,
  "an unrelated short statement must not be accepted as an answer merely because it is short");
assert.equal(engine.isLikelyAnswer("Да", "Ты спал сегодня?"), true,
  "a yes/no response should answer a pending yes/no question");
assert.equal(engine.isLikelyAnswer("Да", "Почему ты устал?"), false,
  "a bare yes/no response must not answer an open-ended causal question");
const pendingBase = engine.track(
  engine.track(engine.empty(), { role: "user", text: "Недостаток сна вызывает усталость", time: 60 }),
  { role: "assistant", text: "Сколько часов ты спал?", time: 61 }
);
const questionAfterQuestion = engine.track(pendingBase, { role: "user", text: "А почему?", time: 62 });
assert.equal(questionAfterQuestion.messages[questionAfterQuestion.messages.length - 1].relation, "continuation",
  "a follow-up question must not be marked as an answer to an earlier open question");
assert.equal(questionAfterQuestion.threads.find(row => row.id === pendingBase.activeThreadId).pendingQuestion.answered, false,
  "a follow-up question must leave the earlier question open");
const unrelatedShortStatement = engine.track(pendingBase, {
  role: "user", text: "Музыка прекрасна", time: 66
});
assert.notEqual(unrelatedShortStatement.activeThreadId, pendingBase.activeThreadId,
  "a meaningful short statement unrelated to the pending question must open a separate topic");
assert.equal(unrelatedShortStatement.messages[unrelatedShortStatement.messages.length - 1].relation, "new_topic");
assert.equal(unrelatedShortStatement.threads.find(row => row.id === pendingBase.activeThreadId).pendingQuestion.answered, false,
  "the unrelated short statement must not close the earlier pending question");
const musicFollowUp = engine.resolve(unrelatedShortStatement, "Почему?");
assert.equal(musicFollowUp.applied, true);
assert.match(musicFollowUp.query, /Музыка прекрасна/u);
assert.doesNotMatch(musicFollowUp.query, /Сколько часов ты спал/u);
const answerAfterQuestion = engine.track(pendingBase, { role: "user", text: "Примерно четыре часа", time: 63 });
assert.equal(answerAfterQuestion.messages[answerAfterQuestion.messages.length - 1].relation, "answer_to_question",
  "a short declarative reply should still answer the pending question");
const unrelatedRequest = engine.track(pendingBase, {
  role: "user",
  text: "Я изучаю устройство нейросетей. Объясни в двух предложениях, что такое контекст диалога, а затем задай мне один уточняющий вопрос.",
  time: 64
});
assert.notEqual(unrelatedRequest.activeThreadId, pendingBase.activeThreadId,
  "a long standalone request must open a new thread instead of answering an unrelated pending question");
assert.equal(unrelatedRequest.messages[unrelatedRequest.messages.length - 1].relation, "new_topic");
assert.equal(unrelatedRequest.threads.find(row => row.id === pendingBase.activeThreadId).pendingQuestion.answered, false,
  "a standalone request must not close the previous thread's pending question");
const commandAfterQuestion = engine.track(pendingBase, {
  role: "user", text: "Объясни, как работает RAG", time: 65
});
assert.notEqual(commandAfterQuestion.messages[commandAfterQuestion.messages.length - 1].relation, "answer_to_question",
  "an imperative request must not be mistaken for an answer");

let backupLike = engine.empty();
backupLike = engine.track(backupLike, {
  role: "user",
  text: "При недостатке сна наблюдалась усталость; контекст: после тренировки; время: 2026-11-09 07:15; критерий: по шкале 1–10",
  time: 100
});
backupLike = engine.track(backupLike, { role: "assistant", text: "Запомнил 1 новый фрагмент.", time: 101 });
backupLike = engine.track(backupLike, { role: "user", text: "Задай мне вопрос о сне", time: 102 });
backupLike = engine.track(backupLike, {
  role: "assistant",
  text: "Как ты оценивал бы свою усталость по шкале 1–10 после тренировки при недосыпе?",
  time: 103
});
const sleepThreadId = backupLike.activeThreadId;
const neuralRequest = engine.track(backupLike, {
  role: "user",
  text: "Я изучаю устройство нейросетей. Объясни в двух предложениях, что такое контекст диалога, а затем задай мне один уточняющий вопрос.",
  time: 104
});
assert.notEqual(neuralRequest.activeThreadId, sleepThreadId,
  "the exact backup sequence must open a separate neural-networks topic");
assert.equal(neuralRequest.messages[neuralRequest.messages.length - 1].relation, "new_topic");
assert.equal(neuralRequest.threads.find(row => row.id === sleepThreadId).pendingQuestion.answered, false,
  "switching to neural networks must not answer or close the pending sleep question");
const sameSubjectOpening = engine.track(backupLike, {
  role: "user", text: "Я изучаю связь недостатка сна и усталости", time: 105
});
assert.equal(sameSubjectOpening.activeThreadId, sleepThreadId,
  "a topic opening that clearly overlaps the active subject must stay in that topic");
// An ambiguous return opens a clarification thread, then the user's choice resumes the selected old thread.
const ambiguousState = engine.sanitize({
  activeThreadId:"T50-current",
  threads:[
    {id:"T50-current",title:"Текущая несвязанная тема",status:"active",updatedAt:200,lastUserText:"Обсуждаем текущую тему"},
    {id:"T51-music-tools",title:"Музыка и музыкальные инструменты",status:"paused",updatedAt:50,
      keywords:["музык","инструмент"],lastUserText:"Музыка и инструменты"},
    {id:"T52-music-memory",title:"Музыка и воспоминания",status:"paused",updatedAt:40,
      keywords:["музык","воспомин"],lastUserText:"Музыка и воспоминания"}
  ],
  messages:[
    {id:"M51",threadId:"T51-music-tools",role:"user",text:"Музыка и музыкальные инструменты",time:50},
    {id:"M52",threadId:"T52-music-memory",role:"user",text:"Музыка и воспоминания",time:40}
  ]
});
const ambiguousRequest = engine.track(ambiguousState, {
  role:"user",text:"Вернёмся к музыке",time:201
});
assert.equal(ambiguousRequest.lastDecision.kind,"ambiguous_return",
  "a return that matches two prior topics must request a choice");
assert.equal(ambiguousRequest.activeThreadId === "T50-current",false,
  "ambiguous return clarification must not remain inside the unrelated active topic");
const clarifiedReturn = engine.track(ambiguousRequest, {
  role:"user",text:"Я имею в виду музыку и музыкальные инструменты",time:202
});
assert.equal(clarifiedReturn.activeThreadId,"T51-music-tools",
  "a clear answer to an ambiguous topic choice must resume the matching prior thread");
assert.equal(clarifiedReturn.lastDecision.kind,"returned");
assert.equal(clarifiedReturn.messages[clarifiedReturn.messages.length-1].relation,"explicit_return");

const resumed = engine.track(unresolved, { role: "user", text: "Музыка и инструменты мне интересны", time: 9 });
assert.equal(resumed.lastDecision, null, "an unresolved-reference flag must not poison later turns");
// The active topic must win by its own update time, not by a newer paused topic.
const mergeLeft = engine.sanitize({
  activeThreadId:"T10-left",
  threads:[
    {id:"T10-left",title:"Текущая тема слева",status:"active",updatedAt:100},
    {id:"T11-left-paused",title:"Старая приостановленная тема",status:"paused",updatedAt:80}
  ],
  messages:[]
});
const mergeRight = engine.sanitize({
  activeThreadId:"T20-right",
  threads:[
    {id:"T20-right",title:"Текущая тема справа",status:"active",updatedAt:90},
    {id:"T21-right-paused",title:"Позже обновлённая старая тема",status:"paused",updatedAt:120}
  ],
  messages:[],
  lastDecision:{kind:"unresolved_return",text:"к чужой теме",candidates:[]}
});
const merged = engine.merge(mergeLeft,mergeRight);
assert.equal(merged.activeThreadId,"T10-left",
  "merge must compare active-thread timestamps, not the most recently updated paused thread");
assert.equal(merged.lastDecision,null,
  "a decision belonging to the non-selected active thread must not leak into the merged context");
assert.equal(merged.threads.filter(row=>row.status==="active").map(row=>row.id).join(","),"T10-left",
  "a merged context must have exactly one active thread");
const normalizedMultipleActive = engine.sanitize({
  activeThreadId:"T30-selected",
  threads:[
    {id:"T30-selected",title:"Выбранная тема",status:"active",updatedAt:1},
    {id:"T31-extra",title:"Лишняя активная тема",status:"active",updatedAt:2}
  ]
});
assert.equal(normalizedMultipleActive.threads.filter(row=>row.status==="active").map(row=>row.id).join(","),"T30-selected",
  "sanitization must normalize malformed multiple-active-thread states");
const inferredActive = engine.sanitize({
  threads:[
    {id:"T40-paused",title:"Приостановленная",status:"paused",updatedAt:3},
    {id:"T41-indicated",title:"Отмеченная активная",status:"active",updatedAt:2}
  ]
});
assert.equal(inferredActive.activeThreadId,"T41-indicated",
  "when the active ID is missing, an explicitly active thread should be preferred over the last list row");

// A topic keeps compact, extractive user-originated notes across turns and serialization.
let summaryState = engine.empty();
summaryState = engine.track(summaryState, {
  role:"user", text:"Я развиваю NEUROGENESIS и хочу, чтобы система сохраняла контекст длительных обсуждений.", time:300
});
const summaryThreadId = summaryState.activeThreadId;
summaryState = engine.track(summaryState, {
  role:"assistant", text:"Я предлагаю полностью заменить историю одной сгенерированной фразой.", time:301
});
summaryState = engine.track(summaryState, {
  role:"user", text:"Важно сохранять исходные реплики, не смешивать темы и переносить заметки через резервную копию.", time:302
});
summaryState = engine.track(summaryState, {
  role:"assistant", text:"Что нужно сохранить?", time:303
});
summaryState = engine.track(summaryState, {
  role:"user", text:"Нужно сохранить исходные реплики.", time:304
});
const summaryReport = engine.report(summaryState);
assert.equal(summaryReport.activeThread.id, summaryThreadId);
assert.match(summaryReport.activeThread.contextSummary,/NEUROGENESIS/u,
  "the topic summary should retain the user's original topic statement");
assert.match(summaryReport.activeThread.contextSummary,/не смешивать темы/u,
  "the topic summary should retain a later user-provided requirement");
assert.match(summaryReport.activeThread.contextSummary,/Сохранить исходные реплики/u,
  "a concise answer should be stored together with the question it answered");
assert.doesNotMatch(summaryReport.activeThread.contextSummary,/полностью заменить историю/u,
  "assistant-authored text must not be promoted into the user-originated topic summary");
assert.ok(summaryReport.activeThread.summaryParts <= 4,
  "topic summaries must remain bounded to four extractive notes");
const summaryFollowUp = engine.resolve(summaryState, "И почему это важно?");
assert.match(summaryFollowUp.query,/РАНЕЕ СОХРАНЁННЫЕ ВЫДЕРЖКИ/u,
  "short follow-ups should carry the extractive topic summary");
const summaryRoundTrip = engine.sanitize(JSON.parse(JSON.stringify(summaryState)));
assert.equal(engine.report(summaryRoundTrip).activeThread.contextSummary,summaryReport.activeThread.contextSummary,
  "topic summaries must survive serialization and sanitization");
const summaryLegacy = engine.sanitize({
  activeThreadId:"T80-legacy",
  threads:[{id:"T80-legacy",title:"Старая тема",status:"active",updatedAt:402,
    lastUserText:"Старый диалог должен сохранить главную мысль"}],
  messages:[
    {id:"M80",threadId:"T80-legacy",role:"user",text:"Старый диалог должен сохранить главную мысль",time:401},
    {id:"M81",threadId:"T80-legacy",role:"assistant",text:"Служебный ответ помощника",time:402}
  ]
});
assert.match(engine.report(summaryLegacy).activeThread.contextSummary,/Старый диалог должен сохранить главную мысль/u,
  "legacy thread data without summary fields should be upgraded from its own user messages");
const leftSummary = engine.sanitize({
  activeThreadId:"T90-merge",
  threads:[{id:"T90-merge",title:"Объединяемая тема",status:"active",updatedAt:500,
    summaryParts:[{text:"Ранее пользователь обсуждал сохранение контекста",at:490}]}],messages:[]
});
const rightSummary = engine.sanitize({
  activeThreadId:"T90-merge",
  threads:[{id:"T90-merge",title:"Объединяемая тема",status:"active",updatedAt:510,
    summaryParts:[{text:"Позже пользователь потребовал изоляцию тем",at:510}]}],messages:[]
});
const mergedSummary = engine.report(engine.merge(leftSummary,rightSummary)).activeThread.contextSummary;
assert.match(mergedSummary,/сохранение контекста/u);
assert.match(mergedSummary,/изоляцию тем/u,
  "merging two copies of the same thread must preserve summary notes from both sides");

const roundTrip = engine.sanitize(JSON.parse(JSON.stringify(state)));
assert.equal(roundTrip.activeThreadId, firstThread);
assert.equal(engine.report(roundTrip).topics.length, 2);
const bad = engine.sanitize({ activeThreadId: "missing", threads: [{ id: "T1-x", title: "A" }], messages: [{ id: "M", threadId: "missing", role: "user", text: "x" }] });
assert.equal(bad.messages.length, 0, "messages without a valid thread must be rejected");
console.log("NEUROGENESIS dialogue context: passed.");
