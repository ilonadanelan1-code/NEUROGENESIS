(() => {
  "use strict";

  const clean = (value, limit = 1200) =>
    String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, limit);
  const normalise = value => clean(value, 1200).toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9?]+/giu, " ").trim();

  function returnTarget(text) {
    const match = clean(text).match(/^(?:давай\s+)?(?:вернемся|вернёмся|возвращаемся|вернуться|вернись)\s+к\s+(.+)$/iu);
    return match ? clean(match[1], 160).replace(/[.!?]+$/u, "") : "";
  }
  function isTopicSwitch(text) {
    return /^(?:теперь\s+)?(?:поговорим|перейдем|перейдём|переключимся|сменим тему)\s+(?:о|об|к|на)\b/u.test(normalise(text)) ||
      /^(?:другая тема|смена темы|давай о другом)\b/u.test(normalise(text));
  }
  function isFollowUp(text) {
    const value = normalise(text);
    if (value.length > 100) return false;
    return /^(?:(?:а|и|но)\s+)?(?:почему|зачем|как|что насчет|что насчёт|а если|и если|и что|а что|а это|и это|а дальше|что дальше|потом|тогда|он|она|они|это|эта|этот|тот|та|так|там)\b/u.test(value) ||
      /^(?:почему|зачем|как именно|что именно)\s*[?]$/u.test(value);
  }
  function isQuestion(text) {
    const value = normalise(text);
    return /[?]/u.test(value) ||
      /^(?:кто|что|где|куда|откуда|когда|почему|зачем|как|сколько|какой|какая|какие|можно ли|правда ли|есть ли)\b/u.test(value);
  }
  function classify(input, context = {}) {
    const text = clean(input);
    const value = normalise(text);
    const active = context && context.activeThread || null;
    const decision = context && context.lastDecision || null;
    const recent = Array.isArray(context && context.recentMessages) ? context.recentMessages : [];
    const last = recent.length ? recent[recent.length - 1] : null;
    const pendingQuestion = active && typeof active.pendingQuestion === "string" ? active.pendingQuestion : "";
    const target = returnTarget(text);

    if (!text) return result("empty", "request_input", 1, "empty_input");
    if (target) {
      const returned = decision && decision.kind === "returned";
      const ambiguous = decision && decision.kind === "ambiguous_return";
      const unresolved = decision && decision.kind === "unresolved_return";
      const candidates = decision && Array.isArray(decision.candidates) ? decision.candidates : [];
      return result("topic_return",
        returned ? "resume_topic" : ambiguous ? "choose_topic" : unresolved ? "clarify_topic" : "verify_topic_return",
        returned || ambiguous || unresolved ? 0.98 : 0.78,
        returned ? "explicit_topic_return_resolved" : ambiguous ? "multiple_topic_candidates" :
          unresolved ? "topic_not_found" : "explicit_topic_return", { target, candidates });
    }
    if (isTopicSwitch(text)) {
      return result("topic_change", "open_topic", 0.95, "explicit_or_detected_topic_change");
    }
    if (/^(?:привет|здравствуй|здравствуйте|доброе утро|добрый день|добрый вечер|хай|здарова)(?:\b|$)/u.test(value)) {
      return result("greeting", "greet", 0.99, "greeting_pattern");
    }
    if (/(?:я имел в виду|я имела в виду|поправка|исправление|я ошибся|я ошиблась|не так понял|не так выразился|точнее говоря)/u.test(value) ||
        /^(?:нет|не совсем),?\s/u.test(value)) {
      return result("correction", "recheck_previous_context", 0.94, "correction_marker");
    }
    if (/(?:не согласен|не согласна|это неверно|это неправильно|я не думаю что|не считаю что|с этим не согласен|с этим не согласна)/u.test(value)) {
      return result("objection", "examine_counterargument", 0.92, "objection_marker");
    }
    if ((last && last.role === "user" && last.relation === "answer_to_question") ||
        (pendingQuestion && !isQuestion(text) && text.length <= 220)) {
      return result("answer", "attach_to_open_question", 0.9, "open_question_response");
    }
    if (isFollowUp(text)) {
      const resolution = context && context.resolution || null;
      return result("follow_up",
        resolution && resolution.applied ? "continue_active_topic" : "ask_clarification",
        resolution && resolution.applied ? 0.93 : 0.74,
        resolution && resolution.applied ? "follow_up_context_resolved" : "follow_up_without_safe_reference");
    }
    if (isQuestion(text)) return result("question", "retrieve_and_reason", 0.9, "question_form");
    return result("statement", "consider_new_information", 0.72, "declarative_or_open_message");
  }
  function result(intent, action, confidence, reason, extra = {}) {
    return { intent, action, confidence, reason, ...extra };
  }
  function plan(input, context = {}) {
    const classified = classify(input, context);
    let clarification = "";
    if (classified.action === "choose_topic") {
      const ids = new Set(classified.candidates || []);
      const candidates = (context.topics || []).filter(topic => ids.has(topic.id))
        .map(topic => "«" + clean(topic.title, 90) + "»");
      clarification = candidates.length
        ? "Я нашёл несколько похожих тем: " + candidates.join(", ") + ". Какую именно восстановить?"
        : "Я нашёл несколько похожих тем. Назови точнее, к какому обсуждению вернуться.";
    } else if (classified.action === "clarify_topic" || classified.action === "verify_topic_return") {
      clarification = "Я пока не могу надёжно определить прежнюю тему «" + clean(classified.target, 120) +
        "». Напомни пару характерных слов или уточни, когда мы её обсуждали.";
    } else if (classified.action === "ask_clarification") {
      clarification = "Я вижу, что это продолжение, но не могу надёжно определить, к какой мысли оно относится. Уточни, пожалуйста, какую часть предыдущего обсуждения ты имеешь в виду.";
    }
    return {
      ...classified,
      text: clean(input),
      needsClarification: !!clarification,
      clarification,
      topicId: context.activeThread && context.activeThread.id || ""
    };
  }

  function create() {
    return Object.freeze({ classify, plan, isQuestion, isFollowUp, returnTarget });
  }
  window.NGDialogManager = Object.freeze({ version: 1, create });
})();