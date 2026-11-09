"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON };
vm.runInNewContext(fs.readFileSync("dialog-context.js", "utf8"), sandbox, { filename: "dialog-context.js" });
const engine = window.NGDialogContext.create({
  normalise: value => String(value || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim(),
  tokens: value => String(value || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/giu).filter(x => x.length > 2)
});
let state = engine.empty();
state = engine.track(state, { role: "user", text: "Недостаток сна сегодня вызвал у меня усталость", time: 1 });
const firstThread = state.activeThreadId;
state = engine.track(state, { role: "assistant", text: "Сколько часов ты спал? И как определяешь усталость?", time: 2 });
assert.match(engine.report(state).activeThread.pendingQuestion, /сколько часов/u);
state = engine.track(state, { role: "user", text: "Примерно четыре часа", time: 3 });
assert.equal(state.activeThreadId, firstThread, "an answer must remain in the current thread");
assert.equal(state.messages[state.messages.length - 1].relation, "answer_to_question");
const resolved = engine.resolve(state, "А почему?");
assert.equal(resolved.applied, true, "short follow-ups should inherit the active context");
assert.match(resolved.query, /усталость/u);
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
const unresolved = engine.track(state, { role: "user", text: "Вернёмся к квантовым вычислениям", time: 6 });
assert.equal(engine.resolve(unresolved, "А почему?").applied, false,
  "an unresolved return must not borrow context from the currently active unrelated topic");
const resumed = engine.track(unresolved, { role: "user", text: "Музыка и инструменты мне интересны", time: 7 });
assert.equal(resumed.lastDecision, null, "an unresolved-reference flag must not poison later turns");
const roundTrip = engine.sanitize(JSON.parse(JSON.stringify(state)));
assert.equal(roundTrip.activeThreadId, firstThread);
assert.equal(engine.report(roundTrip).topics.length, 2);
const bad = engine.sanitize({ activeThreadId: "missing", threads: [{ id: "T1-x", title: "A" }], messages: [{ id: "M", threadId: "missing", role: "user", text: "x" }] });
assert.equal(bad.messages.length, 0, "messages without a valid thread must be rejected");
console.log("NEUROGENESIS dialogue context: passed.");
