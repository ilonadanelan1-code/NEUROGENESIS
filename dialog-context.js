(() => {
  "use strict";

  const MAX_THREADS = 16;
  const MAX_MESSAGES = 64;
  const MAX_TEXT = 1600;
  const MAX_TITLE = 72;
  const MAX_PENDING_QUESTIONS = 6;
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
    const hasReference = text => {
      const value = clean(text, 500).replace(/что(?:\s+же)?\s+такое/giu, "что");
      return /(?<![\p{L}\p{N}_])(?:это|этот|эта|эти|тот|та|те|такой|такая|такие|он|она|они|его|ее|их|там|тогда|этого|этой|этому|нему|ней|них|предыдущ|выше|сказан|упомянут)(?![\p{L}\p{N}_])/iu.test(value);
    };
    const isStandaloneQuestion = text => {
      const value = clean(text, 500);
      // "What/how about ..." explicitly points back to the topic already in progress.
      if (/^(?:(?:а|и|но)\s+)?(?:что|как)\s+(?:насч[её]т|по\s+поводу)(?=\s|$)/iu.test(value)) return false;
      // Speech input may drop the initial "с" in "сколько"; "так колько..." is
      // still a discourse follow-up, not a new self-contained question.
      if (/^(?:так|ну)\s+(?:сколько|кольк[\p{L}]*)(?=\s|$)/iu.test(value)) return false;
      const interrogativeLead = /^(?:(?:а|и|но|так|ну)\s+)?(?:кто|что|где|куда|откуда|когда|сколько|почему|зачем|как|какой|какая|какие|какое|чей|чья|чье|чьё|есть\s+ли|можно\s+ли|правда\s+ли)(?=\s|$)/iu;
      if (!value || hasReference(value) ||
          (!/[?？]\s*$/u.test(value) && !interrogativeLead.test(value))) return false;
      const body = value.replace(interrogativeLead, "").trim();
      const establishedShortQuestion = /^(?:что\s+такое|кто\s+такой|кто\s+такая|кто\s+такие|что\s+значит|что\s+означает|как\s+работает|как\s+работают|как\s+устроен|как\s+устроена|как\s+устроены|как\s+называется|где\s+находится|сколько\s+стоит)(?=\s|$)/iu.test(value);
      // A concise question with its own subject/object is a new request, not a
      // follow-up merely because it contains four or fewer content words.
      return tokens(body).length >= 2 || establishedShortQuestion;
    };
    const isShortFollowUp = text => !isStandaloneQuestion(text) &&
      (tokens(text).length <= 4 || hasReference(text));
    const isStandaloneRequest = text =>
      /(?:^|[^\p{L}])(?:объясни|объяснить|расскажи|рассказать|покажи|показать|задай|задать|составь|составить|напиши|написать|помоги|помочь|сделай|сделать|создай|создать|найди|найти|проверь|проверить|оцени|оценить|сравни|сравнить|рассчитай|рассчитать|перечисли|перечислить|подскажи|подсказать|научи|научить|разбери|разобрать|проанализируй|проанализировать)(?=$|[^\p{L}])/iu.test(text) ||
      /^(?:я изучаю|я интересуюсь|меня интересует|мне интересно|хочу узнать|хочу разобраться|я хочу понять)(?=$|\s)/iu.test(text);
    const isLikelyAnswer = (text, pendingQuestion) => {
      const value = clean(text, 500);
      const wordCount = value ? value.split(/\s+/u).filter(Boolean).length : 0;
      if (!pendingQuestion || wordCount < 1 || wordCount > 14 ||
          /[?？]/u.test(value) || /[.!?]\s+\S/u.test(value) ||
          isStandaloneQuestion(value) || isStandaloneRequest(value)) return false;
      const answer = normalise(value);
      const question = normalise(pendingQuestion);
      const directUncertainty = /^(?:не знаю|не помню|не могу сказать|затрудняюсь(?: ответить)?|без понятия)$/u.test(answer);
      const sharedTopic = overlap(value, pendingQuestion) >= 0.2;
      const yesNoQuestion = /^(?:ты|вы|он|она|они|это|есть ли|можно ли|правда ли|нужно ли|будет ли|сможешь ли|хочешь ли)(?=\s|$)/u.test(question);
      const yesNoAnswer = /^(?:да|нет|скорее да|скорее нет|не совсем|возможно)$/u.test(answer);
      const numericQuestion = /(?:сколько|какое количество|как часто|по какой шкале|на сколько)/u.test(question);
      const numericAnswer = /(?:\d|ноль|один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|двадцать|тридцать|сорок|пятьдесят|сто)/u.test(answer);
      const timeQuestion = /(?:когда|во сколько|какого числа|в какой день)/u.test(question);
      const timeAnswer = /(?:\d{1,2}[:.]\d{2}|\d{1,2}[./-]\d{1,2}|вчера|сегодня|позавчера|завтра|утром|днем|днём|вечером|ночью)/u.test(answer);
      const locationQuestion = /(?:где|куда|откуда|в каком городе|в какой стране)/u.test(question);
      const locationAnswer = /^(?:в|на|из|около)\s+\S+/u.test(answer);
      const causalQuestion = /(?:почему|зачем)/u.test(question);
      const causalAnswer = /^(?:потому что|так как|из[- ]за|благодаря|вследствие)\b/u.test(answer);
      return directUncertainty || sharedTopic || (yesNoQuestion && yesNoAnswer) ||
        (numericQuestion && numericAnswer) || (timeQuestion && timeAnswer) ||
        (locationQuestion && locationAnswer) || (causalQuestion && causalAnswer);
    };
    const topicOpening = text => {
      const match = clean(text, 500).match(/^(?:я изучаю|я интересуюсь|меня интересует|мне интересно|хочу разобраться|хочу узнать)(?:\s*[,—:]\s*|\s+)([^.!?]{3,120})/iu);
      return match ? clean(match[1], 120) : "";
    };
    const isExplicitSwitch = text => /^(?:другая тема|сменим тему|перейдем к|перейдём к|теперь поговорим о|кстати,?\s|отдельный вопрос|новая тема)(?=$|\s|[?.,!:—–])/iu.test(clean(text, 500));
    const returnTarget = text => {
      const match = clean(text, 500).match(/^(?:вернемся|вернёмся|возвращаемся|вернись|назад)\s+(?:к|ко)\s+(.+?)[.!?]?$/iu);
      return match ? clean(match[1], 120) : "";
    };
    const sentenceEndQuestion = text => {
      const lines = clean(text, MAX_TEXT).split(/(?<=[.!?])\s+|\n+/u).filter(Boolean);
      const candidates = lines.filter(line => /\?\s*$/u.test(line) || /ВОПРОС ДЛЯ УТОЧНЕНИЯ/iu.test(line));
      return candidates.length ? clean(candidates[0], 260) : "";
    };
    const extractQuestions = text => clean(text, MAX_TEXT)
      .split(/(?<=[.!?？])\s+/u)
      .map(row => clean(row, 260))
      .filter(row => /[?？]\s*$/u.test(row))
      .slice(0, MAX_PENDING_QUESTIONS);
    const MAX_SUMMARY_PARTS = 4;
    const MAX_SUMMARY_PART_CHARS = 180;
    function mergeSummaryParts(existing, incoming = []) {
      const rows = [];
      for (const raw of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
        if (!raw || typeof raw.text !== "string") continue;
        const text = clean(raw.text, MAX_SUMMARY_PART_CHARS);
        if (!text) continue;
        const at = Math.max(0, Number(raw.at) || 0);
        const duplicate = rows.findIndex(row =>
          normalise(row.text) === normalise(text) || overlap(row.text, text) >= 0.84);
        if (duplicate < 0) rows.push({ text, at });
        else if (text.length > rows[duplicate].text.length) {
          rows[duplicate] = { text, at: Math.max(at, rows[duplicate].at) };
        }
      }
      rows.sort((a, b) => a.at - b.at);
      return rows.length > MAX_SUMMARY_PARTS
        ? [rows[0], ...rows.slice(-(MAX_SUMMARY_PARTS - 1))]
        : rows;
    }
    function summaryCandidate(message, threadMessages) {
      if (!message || message.role !== "user" || typeof message.text !== "string") return "";
      if (message.relation === "answer_to_question") {
        const prior = (Array.isArray(threadMessages) ? threadMessages : [])
          .filter(row => row.role === "assistant" && row.time <= message.time).slice().reverse();
        const question = clean(message.questionText, 260) ||
          prior.map(row => sentenceEndQuestion(row.text)).find(Boolean);
        if (question) return clean("Ответ на вопрос «" + clean(question, 72) + "»: " + message.text, MAX_SUMMARY_PART_CHARS);
      }
      return clean(message.text, MAX_SUMMARY_PART_CHARS);
    }
    function summaryText(parts) {
      return (Array.isArray(parts) ? parts : []).map((row, index) =>
        (index + 1) + ". " + clean(row && row.text, MAX_SUMMARY_PART_CHARS)).filter(Boolean).join("\n");
    }
    function sanitizePendingQuestions(thread) {
      const source = Array.isArray(thread && thread.pendingQuestions)
        ? thread.pendingQuestions
        : thread && thread.pendingQuestion ? [thread.pendingQuestion] : [];
      return source.filter(row => row && typeof row.text === "string")
        .map(row => ({
          text: clean(row.text, 260),
          askedAt: Math.max(0, Number(row.askedAt) || 0),
          answered: !!row.answered
        }))
        .filter(row => row.text)
        .slice(-MAX_PENDING_QUESTIONS);
    }
    function latestPendingQuestion(rows) {
      const list = Array.isArray(rows) ? rows : [];
      return list.find(row => !row.answered) || list[list.length - 1] || null;
    }
    function syncPendingQuestion(thread) {
      thread.pendingQuestions = sanitizePendingQuestions(thread);
      thread.pendingQuestion = latestPendingQuestion(thread.pendingQuestions);
    }
    function matchPendingQuestion(text, pendingQuestions) {
      const matches = (Array.isArray(pendingQuestions) ? pendingQuestions : [])
        .filter(row => row && !row.answered && isLikelyAnswer(text, row.text));
      if (!matches.length) return null;
      if (matches.length === 1) return matches[0];
      const answer = normalise(text);
      if (/^(?:не знаю|не помню|не могу сказать|затрудняюсь(?: ответить)?|без понятия)$/u.test(answer)) {
        return matches.slice().sort((a, b) => b.askedAt - a.askedAt)[0];
      }
      const answerText = normalise(text);
      const wholeWord = pattern =>
        new RegExp("(?<![\\p{L}\\p{N}_])(?:" + pattern + ")(?![\\p{L}\\p{N}_])", "u");
      const affinities = [
        { answer: wholeWord("час(?:а|ов)?"), question: wholeWord("час(?:а|ов)?") },
        { answer: wholeWord("минут(?:а|ы)?"), question: wholeWord("минут(?:а|ы)?") },
        { answer: wholeWord("секунд(?:а|ы)?"), question: wholeWord("секунд(?:а|ы)?") },
        { answer: wholeWord("шкал[\\p{L}]*|балл[\\p{L}]*|оцен[\\p{L}]*"), question: wholeWord("шкал[\\p{L}]*|балл[\\p{L}]*|оцен[\\p{L}]*") },
        { answer: wholeWord("килограмм[\\p{L}]*|кг|вес[\\p{L}]*"), question: wholeWord("килограмм[\\p{L}]*|кг|вес[\\p{L}]*") },
        { answer: wholeWord("сантиметр[\\p{L}]*|см|рост[\\p{L}]*"), question: wholeWord("сантиметр[\\p{L}]*|см|рост[\\p{L}]*") },
        { answer: wholeWord("процент[\\p{L}]*|%"), question: wholeWord("процент[\\p{L}]*|%") }
      ];
      const ranked = matches.map(question => {
        const questionText = normalise(question.text);
        const affinity = affinities.reduce((score, pair) =>
          score + (pair.answer.test(answerText) && pair.question.test(questionText) ? 0.42 : 0), 0);
        return { question, score: overlap(text, question.text) + affinity };
      }).sort((a, b) => b.score - a.score || a.question.askedAt - b.question.askedAt);
      if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.08) return null;
      return ranked[0].question;
    }
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
          summaryParts: Array.isArray(row.summaryParts) ? row.summaryParts : [],
          pendingQuestions: sanitizePendingQuestions(row),
          pendingQuestion: latestPendingQuestion(sanitizePendingQuestions(row))
        }));
      const ids = new Set(result.threads.map(row => row.id));
      result.messages = (Array.isArray(source.messages) ? source.messages : []).filter(row =>
        row && typeof row.id === "string" && ids.has(row.threadId) &&
        (row.role === "user" || row.role === "assistant") && typeof row.text === "string")
        .slice(-MAX_MESSAGES).map(row => ({
          id: row.id.slice(0, 64), threadId: row.threadId,
          role: row.role, text: clean(row.text), time: Math.max(0, Number(row.time) || 0),
          relation: ["new_topic","continuation","answer_to_question","explicit_return","assistant_reply"].includes(row.relation)
            ? row.relation : "continuation",
          questionText: clean(row.questionText, 260)
        }));
      result.activeThreadId = ids.has(source.activeThreadId) ? source.activeThreadId : "";
      if (!result.activeThreadId && result.threads.length) {
        const indicated = result.threads.slice().reverse().find(row => row.status === "active");
        result.activeThreadId = (indicated || result.threads[result.threads.length - 1]).id;
      }
      result.threads = result.threads.map(row => {
        const threadMessages = result.messages.filter(message => message.threadId === row.id);
        const candidates = threadMessages.filter(message => message.role === "user").map(message => ({
          text: summaryCandidate(message, threadMessages), at: message.time
        })).filter(item => item.text);
        if (row.lastUserText && !threadMessages.some(message =>
          message.role === "user" && message.text === row.lastUserText)) {
          candidates.push({ text: row.lastUserText, at: row.updatedAt });
        }
        return {
          ...row,
          status: row.id === result.activeThreadId ? "active" : "paused",
          summaryParts: mergeSummaryParts(row.summaryParts, candidates)
        };
      });
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
        keywords: tokens(message).slice(0, 16), lastUserText: "", lastAssistantText: "",
        summaryParts: [], pendingQuestions: [], pendingQuestion: null
      };
      for (const old of state.threads) if (old.status === "active") old.status = "paused";
      state.threads.push(row);
      state.threads = state.threads.slice(-MAX_THREADS);
      state.activeThreadId = id;
      return row;
    }
    function resolveReturn(state, target, candidateIds = null) {
      const allowed = Array.isArray(candidateIds) ? new Set(candidateIds) : null;
      const ranked = state.threads.filter(thread => !allowed || allowed.has(thread.id)).map(thread => {
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
          state.lastDecision.kind === "unresolved_return") state.lastDecision = null;
      let thread = activeThread(state);
      let relation = role === "assistant" ? "assistant_reply" : "continuation";
      let summaryCandidateText = text;
      let answerQuestionText = "";
      let resolvedAmbiguousReturn = false;
      if (role === "user" && !returnTarget(text) &&
          state.lastDecision && state.lastDecision.kind === "ambiguous_return") {
        const match = resolveReturn(state, text, state.lastDecision.candidates);
        if (match.thread) {
          thread = match.thread;
          for (const row of state.threads) row.status = row.id === thread.id ? "active" : "paused";
          state.activeThreadId = thread.id;
          relation = "explicit_return";
          state.lastDecision = { kind: "returned", text, candidates: [thread.id] };
          resolvedAmbiguousReturn = true;
        } else if (!match.ambiguous) {
          state.lastDecision = null;
        }
      }
      if (role === "user") {
        const target = returnTarget(text);
        if (resolvedAmbiguousReturn) {
          // The user's clarification selected one of the previously ambiguous topics.
        } else if (target) {
          const match = resolveReturn(state, target);
          if (match.ambiguous) {
            state.lastDecision = { kind: "ambiguous_return", text: target, candidates: match.candidates };
            thread = createThread(state, text, time);
            relation = "new_topic";
          } else if (match.thread) {
            thread = match.thread;
            for (const row of state.threads) row.status = row.id === thread.id ? "active" : "paused";
            state.activeThreadId = thread.id;
            relation = "explicit_return";
            state.lastDecision = { kind: "returned", text: target, candidates: [thread.id] };
          } else {
            state.lastDecision = { kind: "unresolved_return", text: target, candidates: [] };
            thread = createThread(state, text, time);
            relation = "new_topic";
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
          const matchedQuestion = matchPendingQuestion(text, thread.pendingQuestions);
          const likelyAnswer = !!matchedQuestion;
          const hasOpenQuestion = thread.pendingQuestions.some(row => !row.answered);
          const independentStatement = !!(hasOpenQuestion && !likelyAnswer && words >= 2 &&
            similarity < 0.12 && knowledge && typeof knowledge.extractClaims === "function" &&
            knowledge.extractClaims(text).length > 0);
          const opening = topicOpening(text);
          const openingSimilarity = opening
            ? overlap(opening, thread.title + " " + thread.keywords.join(" ") + " " + thread.lastUserText)
            : 1;
          const independentTopic = !!(opening && tokens(opening).length >= 2 && openingSimilarity < 0.12);
          const independentQuestion = isStandaloneQuestion(text);
          if (likelyAnswer) {
            relation = "answer_to_question";
            answerQuestionText = matchedQuestion.text;
            summaryCandidateText = "Ответ на вопрос «" + clean(matchedQuestion.text, 72) + "»: " + text;
            matchedQuestion.answered = true;
            syncPendingQuestion(thread);
          } else if (independentTopic || independentStatement || independentQuestion) {
            thread = createThread(state, text, time);
            relation = "new_topic";
            state.lastDecision = { kind: "topic_switch", text: thread.title, candidates: [thread.id] };
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
        const questions = extractQuestions(text);
        const questionKey = value => normalise(clean(value, 260)
          .replace(/^(?:(?:и|а|но|тогда|также|ещё|еще)\s+)+/iu, ""));
        for (const question of questions) {
          const key = questionKey(question);
          const duplicate = thread.pendingQuestions.some(row =>
            !row.answered && questionKey(row.text) === key);
          if (!duplicate) thread.pendingQuestions.push({ text: question, askedAt: time, answered: false });
        }
        thread.pendingQuestions = thread.pendingQuestions.slice(-MAX_PENDING_QUESTIONS);
        syncPendingQuestion(thread);
      }
      state.messages.push({
        id: "M" + time.toString(36) + "-" + state.messages.length.toString(36),
        threadId: thread.id, role, text, time, relation, questionText: answerQuestionText
      });
      if (role === "user") {
        thread.summaryParts = mergeSummaryParts(thread.summaryParts, [{ text: summaryCandidateText, at: time }]);
      }
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
        if (!prior) threads.set(row.id, row);
        else {
          const preferred = row.updatedAt >= prior.updatedAt ? row : prior;
          threads.set(row.id, {
            ...preferred,
            summaryParts: mergeSummaryParts(prior.summaryParts, row.summaryParts)
          });
        }
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
      const activeA = activeThread(a), activeB = activeThread(b);
      const preferRight = !!activeB && (!activeA || activeB.updatedAt >= activeA.updatedAt);
      const selected = preferRight ? b : a;
      const state = sanitize({
        version: 1, activeThreadId: selected.activeThreadId,
        nextSequence: Math.max(a.nextSequence, b.nextSequence), threads: mergedThreads, messages: mergedMessages,
        lastDecision: selected.lastDecision
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
      const pendingQuestions = thread.pendingQuestions.filter(row => !row.answered).map(row => row.text);
      const recentExchange = previous.slice(-4).map(row => ({
        role: row.role,
        text: clean(row.text, 220),
        time: row.time,
        relation: row.relation
      }));
      const context = {
        title: thread.title,
        contextSummary: summaryText(thread.summaryParts),
        lastUserText: priorUser ? priorUser.text : thread.lastUserText,
        lastAssistantText: priorAssistant ? priorAssistant.text : thread.lastAssistantText,
        recentExchange,
        pendingQuestion: pendingQuestions[0] || "",
        pendingQuestions
      };
      const pieces = [raw, "ТЕМА: " + context.title];
      if (context.contextSummary) pieces.push("РАНЕЕ СОХРАНЁННЫЕ ВЫДЕРЖКИ ИЗ РЕПЛИК ПОЛЬЗОВАТЕЛЯ: " + context.contextSummary);
      if (context.recentExchange.length) pieces.push("ПОСЛЕДНИЕ РЕПЛИКИ В ЭТОЙ ТЕМЕ: " +
        context.recentExchange.map(row => (row.role === "user" ? "Пользователь" : "Ассистент") +
          ": " + row.text).join(" | "));
      if (context.lastUserText) pieces.push("ПРЕДЫДУЩЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: " + clean(context.lastUserText, 260));
      if (context.lastAssistantText) pieces.push("ПРЕДЫДУЩИЙ ОТВЕТ АССИСТЕНТА: " + clean(context.lastAssistantText, 260));
      if (context.pendingQuestions.length === 1) {
        pieces.push("ОТКРЫТЫЙ ВОПРОС: " + clean(context.pendingQuestions[0], 220));
      } else if (context.pendingQuestions.length > 1) {
        pieces.push("НЕЗАКРЫТЫЕ ВОПРОСЫ: " + context.pendingQuestions
          .map((question, index) => (index + 1) + ". " + clean(question, 220)).join("; "));
      }
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
          contextSummary: summaryText(active.summaryParts), summaryParts: active.summaryParts.length,
          pendingQuestion: active.pendingQuestion && !active.pendingQuestion.answered ? active.pendingQuestion.text : "",
          pendingQuestions: active.pendingQuestions.filter(row => !row.answered).map(row => row.text)
        } : null,
        topics: state.threads.slice().reverse().map(row => ({
          id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt, turnCount: row.turnCount,
          contextSummary: summaryText(row.summaryParts)
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
    return { version: 1, empty, sanitize, track, rebuild, merge, resolve, report, history, overlap, hasReference, isLikelyAnswer };
  }

  window.NGDialogContext = Object.freeze({ version: 1, create });
})();