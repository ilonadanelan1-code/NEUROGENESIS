(() => {
  "use strict";

  const MAX_THREADS = 16;
  const MAX_MESSAGES = 64;
  const MAX_TEXT = 1600;
  const MAX_TITLE = 72;
  const clean = (value, limit = MAX_TEXT) => String(value == null ? "" : value)
    .replace(/\s+/gu, " ").trim().slice(0, limit);

  function create(knowledge) {
    const normalise = value => knowledge && typeof knowledge.normalise === "function"
      ? knowledge.normalise(value)
      : clean(value, 2000).toLowerCase().replace(/ё/g, "ё").replace(/[^a-zа-я0-9]+/giu, " ").trim();
    const tokens = value => {
      const result = knowledge && typeof knowledge.tokens === "function"
        ? knowledge.tokens(value) : normalise(value).split(/\s+/u).filter(word => word.length > 2);
      return [...new Set((Array.isArray(result) ? result : []).filter(x => typeof x === "string" && x.length > 1))].slice(0, 32);
    };
    const overlap = (left, right) => {
      const a = new Set(tokens(left)), b = new Set(tokens(right));
      if (!a.size || !b.size) return 0;
      let shared = 0;
      for (const token of a) if (b.has(token)) shared++;
      return shared / Math.min(a.size, b.size);
    };
    const hasReference = text => /\b(это|этот|эта|эти|тот|та|те|такой|такая|такое|такие|он|она|они|его|ее|их|там|тогда|этого|этой|этому|нему|ней|них|предыдущ|выше|сказан|упомянут)\b|^(?:а\s+)?(?:почему|зачем|как|и\s+что|а\s+если|а\s+что)\b/iu.test(clean(text, 500));
    const isShortFollowUp = text => tokens(text).length <= 4 || hasReference(text);
    const isExplicitSwitch = text => /^(?:другая тема|сменим тему|перейдем к|перейдём к|теперь поговорим о|кстати,?\s|отдельный вопрос|новая тема)\b/iu.test(clean(text, 500));
    const returnTarget = text => {
      const match = clean(text, 500).match(/^(?:вернемся|вернёмся|возвращаемся|вернись|назад)\s+(?:к|ко)\s+(.+?)[.!?]?$/iu);
      return match ? clean(match[1], 120) : "";
    };
    const sentenceEndQuestion = text => {
      const lines = clean(text, MAX_TEXT).split(/(?<=[.!?])\s+|\n+/u).filter(Boolean);
      const candidates = lines.filter(line => /\?\s*$/u.test(line) || /ВОПРОС ДЛЯ УТОЧНЕНИЯ/iu.test(line));
      return candidates.length ? clean(candidates[candidates.length - 1], 260) : "";
    };
    function empty() {
      return { version: 1, activeThreadId: "", nextSequence: 1, threads: [], messages: [], lastDecision: null };
    }
    function sanitize(raw) {
      const source = raw && typeof raw === "object" ? raw : {};
      const result = empty();
      result.nextSequence = Math.max(1, Math.floor(Number(source.nextSequence) || 1));
      result.threads = (Array.isArray(source.threads) ? source.threads : []).filter(row =>
        row && typeof row.id === "string" && row.id.length <= 48 && typeof row.title === "string")
        .slice(-MAX_THREADS).map(row => ({
          id: row.id,
          title: clean(row.title, MAX_TITLE) || "Без названия",
          status: row.status === "paused" ? "paused" : "active",
          createdAt: Math.max(0, Number(row.createdAt) || 0),
          updatedAt: Math.max(0, Number(row.updatedAt) || 0),
          turnCount: Math.max(0, Math.floor(Number(row.turnCount) || 0)),
          keywords: Array.isArray(row.keywords) ? [...new Set(row.keywords.filter(x => typeof x === "string").map(x => clean(x, 40)))].slice(0, 16) : [],
          lastUserText: clean(row.lastUserText),
          lastAssistantText: clean(row.lastAssistantText),
          pendingQuestion: row.pendingQuestion && typeof row.pendingQuestion.text === "string" ? {
            text: clean(row.pendingQuestion.text, 260),
            askedAt: Math.max(0, Number(row.pendingQuestion.askedAt) || 0),
            answered: !!row.pendingQuestion.answered
          } : null
        }));
      const ids = new Set(result.threads.map(row => row.id));
      result.messages = (Array.isArray(source.messages) ? source.messages : []).filter(row =>
        row && typeof row.id === "string" && ids.has(row.threadId) &&
        (row.role === "user" || row.role === "assistant") && typeof row.text === "string")
        .slice(-MAX_MESSAGES).map(row => ({
          id: row.id.slice(0, 64), threadId: row.threadId,
          role: row.role, text: clean(row.text), time: Math.max(0, Number(row.time) || 0),
          relation: ["new_topic","continuation","answer_to_question","explicit_return","assistant_reply"].includes(row.relation)
            ? row.relation : "continuation"
        }));
      result.activeThreadId = ids.has(source.activeThreadId) ? source.activeThreadId : "";
      if (!result.activeThreadId && result.threads.length) result.activeThreadId = result.threads[result.threads.length - 1].id;
      const seq = result.threads.map(row => Number((row.id.match(/^T(\d+)/u) || [])[1]) || 0);
      result.nextSequence = Math.max(result.nextSequence, 1, ...seq.map(n => n + 1));
      if (source.lastDecision && typeof source.lastDecision.kind === "string") {
        result.lastDecision = {
          kind: clean(source.lastDecision.kind, 32),
          text: clean(source.lastDecision.text, 160),
          candidates: Array.isArray(source.lastDecision.candidates)
            ? source.lastDecision.candidates.filter(x => typeof x === "string").slice(0, 4) : []
        };
      }
      return result;
    }
    function activeThread(state) {
      return state.threads.find(row => row.id === state.activeThreadId) || null;
    }
    function createThread(state, message, now) {
      const sequence = state.nextSequence++;
      const id = "T" + sequence + "-" + Math.max(0, now).toString(36);
      const title = clean(message, MAX_TITLE).replace(/[.!?]+$/u, "") || "Новая тема";
      const row = {
        id, title, status: "active", createdAt: now, updatedAt: now, turnCount: 0,
        keywords: tokens(message).slice(0, 16), lastUserText: "", lastAssistantText: "", pendingQuestion: null
      };
      for (const old of state.threads) if (old.status === "active") old.status = "paused";
      state.threads.push(row);
      state.threads = state.threads.slice(-MAX_THREADS);
      state.activeThreadId = id;
      return row;
    }
    function resolveReturn(state, target) {
      const ranked = state.threads.map(thread => {
        const transcript = state.messages.filter(message => message.threadId === thread.id).map(message => message.text).join(" ");
        return {
          thread,
          score: Math.max(overlap(target, thread.title), overlap(target, thread.keywords.join(" ")),
            overlap(target, transcript))
        };
      }).filter(row => row.score >= 0.28).sort((a, b) => b.score - a.score);
      if (!ranked.length) return { thread: null, ambiguous: false, candidates: [] };
      const tied = ranked.length > 1 && ranked[0].score - ranked[1].score < 0.12;
      return {
        thread: tied ? null : ranked[0].thread,
        ambiguous: tied,
        candidates: ranked.slice(0, 4).map(row => row.thread.id)
      };
    }
    function track(rawState, rawMessage) {
      const state = sanitize(rawState);
      const message = rawMessage && typeof rawMessage === "object" ? rawMessage : {};
      const role = message.role === "user" ? "user" : "assistant";
      const text = clean(message.text);
      if (!text) return state;
      const time = Math.max(0, Number(message.time) || Date.now());
      if (role === "user" && !returnTarget(text) && state.lastDecision &&
          ["unresolved_return","ambiguous_return"].includes(state.lastDecision.kind)) state.lastDecision = null;
      let thread = activeThread(state);
      let relation = role === "assistant" ? "assistant_reply" : "continuation";
      if (role === "user") {
        const target = returnTarget(text);
        if (target) {
          const match = resolveReturn(state, target);
          if (match.ambiguous) {
            state.lastDecision = { kind: "ambiguous_return", text: target, candidates: match.candidates };
          } else if (match.thread) {
            thread = match.thread;
            for (const row of state.threads) row.status = row.id === thread.id ? "active" : "paused";
            state.activeThreadId = thread.id;
            relation = "explicit_return";
            state.lastDecision = { kind: "returned", text: target, candidates: [thread.id] };
          } else {
            state.lastDecision = { kind: "unresolved_return", text: target, candidates: [] };
            if (!thread) thread = createThread(state, text, time);
          }
        } else if (isExplicitSwitch(text)) {
          thread = createThread(state, text, time);
          relation = "new_topic";
          state.lastDecision = { kind: "topic_switch", text: thread.title, candidates: [thread.id] };
        } else if (!thread) {
          thread = createThread(state, text, time);
          relation = "new_topic";
        } else {
          const similarity = overlap(text, thread.title + " " + thread.keywords.join(" ") + " " + thread.lastUserText);
          const words = tokens(text).length;
          const likelyAnswer = !!(thread.pendingQuestion && !thread.pendingQuestion.answered && words <= 28);
          if (likelyAnswer) {
            relation = "answer_to_question";
            thread.pendingQuestion.answered = true;
          } else if (hasReference(text) || isShortFollowUp(text) || similarity >= 0.24) {
            relation = "continuation";
          } else if (words >= 4 && similarity < 0.12) {
            thread = createThread(state, text, time);
            relation = "new_topic";
            state.lastDecision = { kind: "topic_switch", text: thread.title, candidates: [thread.id] };
          } else {
            relation = "continuation";
          }
        }
        thread.lastUserText = text;
        thread.updatedAt = time;
        thread.turnCount++;
      } else if (!thread) {
        thread = createThread(state, text, time);
      }
      if (role === "assistant") {
        thread.lastAssistantText = text;
        thread.updatedAt = time;
        const question = sentenceEndQuestion(text);
        if (question) thread.pendingQuestion = { text: question, askedAt: time, answered: false };
      }
      state.messages.push({
        id: "M" + time.toString(36) + "-" + state.messages.length.toString(36),
        threadId: thread.id, role, text, time, relation
      });
      state.messages = state.messages.slice(-MAX_MESSAGES);
      state.threads.sort((a, b) => a.updatedAt - b.updatedAt);
      state.threads = state.threads.slice(-MAX_THREADS);
      if (!state.threads.some(row => row.id === state.activeThreadId)) state.activeThreadId = thread.id;
      return sanitize(state);
    }
    function rebuild(history) {
      let state = empty();
      for (const row of Array.isArray(history) ? history : []) state = track(state, row);
      return state;
    }
    function merge(left, right) {
      const a = sanitize(left), b = sanitize(right);
      const threads = new Map();
      for (const row of [...a.threads, ...b.threads]) {
        const prior = threads.get(row.id);
        if (!prior || row.updatedAt >= prior.updatedAt) threads.set(row.id, row);
      }
      const messages = new Map();
      for (const row of [...a.messages, ...b.messages]) {
        const prior = messages.get(row.id);
        if (!prior || row.time >= prior.time) messages.set(row.id, row);
      }
      const mergedThreads = [...threads.values()].sort((x, y) => x.updatedAt - y.updatedAt).slice(-MAX_THREADS);
      const valid = new Set(mergedThreads.map(row => row.id));
      const mergedMessages = [...messages.values()].filter(row => valid.has(row.threadId))
        .sort((x, y) => x.time - y.time).slice(-MAX_MESSAGES);
      const recent = b.threads.reduce((best, row) => !best || row.updatedAt > best.updatedAt ? row : best, null);
      const state = sanitize({
        version: 1, activeThreadId: recent && recent.updatedAt >= (activeThread( a )?.updatedAt || 0) ? b.activeThreadId : a.activeThreadId,
        nextSequence: Math.max(a.nextSequence, b.nextSequence), threads: mergedThreads, messages: mergedMessages,
        lastDecision: b.lastDecision || a.lastDecision
      });
      return state;
    }
    function resolve(rawState, input) {
      const state = sanitize(rawState);
      const thread = activeThread(state);
      const raw = clean(input);
      if (!thread || !raw || !isShortFollowUp(raw) ||
          (state.lastDecision && ["unresolved_return","ambiguous_return"].includes(state.lastDecision.kind))) return {
        query: raw, applied: false,
        reason: state.lastDecision && ["unresolved_return","ambiguous_return"].includes(state.lastDecision.kind)
          ? "unresolved_topic_reference" : "no_confident_reference",
        threadId: thread && thread.id || "", title: thread && thread.title || "", context: null
      };
      const previous = state.messages.filter(row => row.threadId === thread.id &&
        !(row.role === "user" && row.text === raw)).slice(-6);
      const priorUser = [...previous].reverse().find(row => row.role === "user");
      const priorAssistant = [...previous].reverse().find(row => row.role === "assistant");
      const context = {
        title: thread.title,
        lastUserText: priorUser ? priorUser.text : thread.lastUserText,
        lastAssistantText: priorAssistant ? priorAssistant.text : thread.lastAssistantText,
        pendingQuestion: thread.pendingQuestion && !thread.pendingQuestion.answered ? thread.pendingQuestion.text : ""
      };
      const pieces = [raw, "ТЕМА: " + context.title];
      if (context.lastUserText) pieces.push("ПРЕДЫДУЩЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: " + clean(context.lastUserText, 260));
      if (context.lastAssistantText) pieces.push("ПРЕДЫДУЩИЙ ОТВЕТ АССИСТЕНТА: " + clean(context.lastAssistantText, 260));
      if (context.pendingQuestion) pieces.push("ОТКРЫТЫЙ ВОПРОС: " + clean(context.pendingQuestion, 220));
      return {
        query: pieces.join(" · "), applied: true, reason: "short_or_referential_follow_up",
        threadId: thread.id, title: thread.title, context
      };
    }
    function report(rawState) {
      const state = sanitize(rawState);
      const active = activeThread(state);
      return {
        version: 1,
        activeThread: active ? {
          id: active.id, title: active.title, status: active.status, turnCount: active.turnCount,
          pendingQuestion: active.pendingQuestion && !active.pendingQuestion.answered ? active.pendingQuestion.text : ""
        } : null,
        topics: state.threads.slice().reverse().map(row => ({
          id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt, turnCount: row.turnCount
        })),
        recentMessages: state.messages.slice(-8).map(row => ({
          threadId: row.threadId, role: row.role, text: row.text, time: row.time, relation: row.relation
        })),
        lastDecision: state.lastDecision
      };
    }
    function history(rawState, threadId, limit = 12) {
      const state = sanitize(rawState);
      const id = threadId || state.activeThreadId;
      return state.messages.filter(row => row.threadId === id).slice(-Math.max(1, Math.min(24, Number(limit) || 12)));
    }
    return { version: 1, empty, sanitize, track, rebuild, merge, resolve, report, history, overlap, hasReference };
  }

  window.NGDialogContext = Object.freeze({ version: 1, create });
})();