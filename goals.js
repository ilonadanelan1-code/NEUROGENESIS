(() => {
  "use strict";
  const STORAGE_KEY = "neurogenesis.goals.v1";
  const MAX_GOALS = 24;
  const STALE_AFTER = 30 * 24 * 60 * 60 * 1000;
  const STATUSES = ["active","waiting_user","blocked","review","paused","completed","stale"];
  let goals = [];
  function safeTime(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  function cleanText(value, limit = 240) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }
  function uniqueStrings(value, limit = 12) {
    return Array.isArray(value)
      ? [...new Set(value.filter(item => typeof item === "string" && item.trim()).map(item => item.slice(0, 120)))].slice(0, limit)
      : [];
  }
  function normalise(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/giu, " ").trim().replace(/\s+/g, " ");
  }
  function sameEntity(left, right) {
    const knowledge = window.NGKnowledge;
    if (knowledge && typeof knowledge.sameEntity === "function") {
      try { return knowledge.sameEntity(left, right); } catch (_) {}
    }
    return normalise(left) === normalise(right);
  }
  function cleanGoal(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" ||
        !/^G-Q\d{1,8}$/u.test(raw.id) || typeof raw.inquiryId !== "string" ||
        !/^Q\d{1,8}$/u.test(raw.inquiryId)) return null;
    const status = STATUSES.includes(raw.status) ? raw.status : "active";
    const title = cleanText(raw.title, 280);
    if (!title) return null;
    return {
      id: raw.id, inquiryId: raw.inquiryId,
      kind: ["contrast_observations","clarify_counterexample","missing_observation","duplicate_observation"].includes(raw.kind)
        ? raw.kind : "missing_observation",
      title, status, nextAction: cleanText(raw.nextAction, 420),
      blockers: Array.isArray(raw.blockers) ? raw.blockers.filter(x => typeof x === "string").slice(0, 4).map(x => x.slice(0, 220)) : [],
      sourceClaimIds: uniqueStrings(raw.sourceClaimIds),
      evidenceClaimIds: uniqueStrings(raw.evidenceClaimIds),
      evidenceMemoryIds: uniqueStrings(raw.evidenceMemoryIds),
      observationCount: Math.max(0, Math.min(500, Math.floor(Number(raw.observationCount) || 0))),
      eventCount: Math.max(0, Math.min(500, Math.floor(Number(raw.eventCount) || 0))),
      milestones: Array.isArray(raw.milestones) ? raw.milestones.filter(x => typeof x === "string").slice(0, 4).map(x => x.slice(0, 80)) : [],
      progress: Math.max(0, Math.min(100, Math.round(Number(raw.progress) || 0))),
      focusScore: Math.max(0, Math.min(100, Math.round(Number(raw.focusScore) || 0))),
      selected: raw.selected === true, assessment: cleanText(raw.assessment, 64),
      assessmentReason: cleanText(raw.assessmentReason, 420),
      createdAt: safeTime(raw.createdAt, Date.now()),
      updatedAt: safeTime(raw.updatedAt, Date.now()),
      lastProgressAt: safeTime(raw.lastProgressAt, safeTime(raw.updatedAt, Date.now()))
    };
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      goals = Array.isArray(saved) ? saved.map(cleanGoal).filter(Boolean).slice(-MAX_GOALS) : [];
    } catch (error) {
      goals = [];
      console.warn("Could not load NEUROGENESIS research goals:", error);
    }
    return list();
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(goals.slice(-MAX_GOALS)));
      return true;
    } catch (error) {
      console.warn("NEUROGENESIS research-goal storage failed:", error);
      return false;
    }
  }
  function statusFor(inquiry, now, lastProgressAt) {
    if (inquiry.status === "skipped") return "paused";
    if (inquiry.status === "answered") {
      if (["duplicate_same_event","duplicate_separate_events"].includes(inquiry.assessment)) return "completed";
      if (["insufficient_context","gap_confirmed"].includes(inquiry.assessment)) return "blocked";
      return "review";
    }
    if (lastProgressAt > 0 && now - lastProgressAt > STALE_AFTER) return "stale";
    return inquiry.lastAskedAt > 0 ? "waiting_user" : "active";
  }
  function evidenceFor(inquiry, memories) {
    const wanted = new Set([...(inquiry.sourceClaimIds || []),...(inquiry.responseClaimIds || [])]);
    const evidence = new Map();
    const memoryIds = new Set();
    const memoryRows = Array.isArray(memories) ? memories : [];
    if (inquiry.responseMemoryId) memoryIds.add(inquiry.responseMemoryId);
    for (const memory of memoryRows) {
      if (!memory || typeof memory.id !== "string") continue;
      for (const claim of Array.isArray(memory.claims) ? memory.claims : []) {
        if (!claim || typeof claim.id !== "string") continue;
        const linkedById = wanted.has(claim.id);
        const matchingObservation = claim.kind === "observation" &&
          sameEntity(claim.subject, inquiry.edgeSubject) && sameEntity(claim.object, inquiry.edgeObject);
        if (!linkedById && !matchingObservation) continue;
        evidence.set(claim.id, claim);
        memoryIds.add(memory.id);
      }
    }
    const rows = [...evidence.values()];
    const observations = rows.filter(claim => claim.kind === "observation");
    const events = new Set(observations.map(claim =>
      typeof claim.eventRef === "string" && claim.eventRef ? claim.eventRef : claim.id));
    return {
      claimIds: [...evidence.keys()].slice(0, 12),
      memoryIds: [...memoryIds].slice(0, 12),
      observationCount: observations.length,
      eventCount: events.size
    };
  }
  function buildGoal(inquiry, memories, focus, now, previous) {
    const evidence = evidenceFor(inquiry, memories);
    const sourceClaimIds = uniqueStrings(inquiry.sourceClaimIds);
    const milestones = [];
    if (sourceClaimIds.length) milestones.push("есть исходные утверждения");
    if (inquiry.lastAskedAt > 0) milestones.push("вопрос был задан");
    if (inquiry.status === "answered") milestones.push("получен ответ");
    if (evidence.observationCount > 0) milestones.push("привязаны прямые наблюдения");
    const progress = Math.round(milestones.length / 4 * 100);
    const focusId = focus && focus.item && focus.item.id;
    const selected = focusId === inquiry.id;
    const focusScore = selected ? Math.round(Math.max(0, Math.min(1, Number(focus.score) || 0)) * 100) : 0;
    const blockers = [];
    if (inquiry.assessment === "insufficient_context") {
      blockers.push(inquiry.assessmentReason || "Ответ не позволил восстановить контекст сравниваемых случаев.");
    } else if (inquiry.assessment === "gap_confirmed") {
      blockers.push(inquiry.assessmentReason || "В ответе подтверждено отсутствие нужных наблюдений.");
    } else if (evidence.observationCount === 0) {
      blockers.push("В привязанных записях пока нет прямой карточки наблюдения для этого звена.");
    }
    let nextAction = "Задать исследовательский вопрос " + inquiry.id + " и уточнить недостающие сведения.";
    if (inquiry.status === "open" && inquiry.lastAskedAt > 0) {
      nextAction = "Ожидается содержательный ответ на " + inquiry.id + ".";
    } else if (inquiry.status === "answered" && inquiry.assessment === "insufficient_context") {
      nextAction = "Уточнить обстоятельства, время и критерий результата; до этого причинная связь остаётся непроверенной.";
    } else if (inquiry.status === "answered" && inquiry.assessment === "gap_confirmed") {
      nextAction = "Добавить естественное наблюдение, когда оно появится; специально создавать условия ради проверки не нужно.";
    } else if (inquiry.status === "answered") {
      nextAction = "Пересмотреть вопрос с учётом ответа и отдельно проверить, появились ли прямые наблюдения.";
    } else if (inquiry.status === "skipped") {
      nextAction = "Вопрос отложен. К нему можно вернуться позднее.";
    } else if (evidence.observationCount > 0) {
      nextAction = "Сопоставить связанные карточки наблюдений, не считая их автоматически доказательством.";
    }
    const previousProgress = previous ? previous.lastProgressAt : safeTime(inquiry.updatedAt, inquiry.createdAt);
    const status = statusFor(inquiry, now, previousProgress);
    const candidate = {
      id: "G-" + inquiry.id, inquiryId: inquiry.id, kind: inquiry.kind,
      title: "Уточнить связь «" + cleanText(inquiry.edgeSubject, 100) + " → " + cleanText(inquiry.edgeObject, 100) + "»",
      status, nextAction, blockers, sourceClaimIds, evidenceClaimIds: evidence.claimIds,
      evidenceMemoryIds: evidence.memoryIds, observationCount: evidence.observationCount,
      eventCount: evidence.eventCount, milestones, progress, focusScore, selected,
      assessment: cleanText(inquiry.assessment, 64), assessmentReason: cleanText(inquiry.assessmentReason, 420),
      createdAt: previous ? previous.createdAt : safeTime(inquiry.createdAt, now),
      updatedAt: now, lastProgressAt: now
    };
    if (previous) {
      const comparable = item => {
        const copy = {...item};
        delete copy.updatedAt;
        delete copy.lastProgressAt;
        return JSON.stringify(copy);
      };
      if (comparable(previous) === comparable(candidate)) {
        candidate.updatedAt = previous.updatedAt;
        candidate.lastProgressAt = previous.lastProgressAt;
      } else {
        candidate.lastProgressAt = now;
      }
    } else {
      candidate.lastProgressAt = safeTime(inquiry.updatedAt, safeTime(inquiry.createdAt, now));
    }
    return cleanGoal(candidate);
  }
  function mergeGoals(existing, incoming) {
    const merged = new Map();
    for (const raw of [...(Array.isArray(existing) ? existing : []),...(Array.isArray(incoming) ? incoming : [])]) {
      const item = cleanGoal(raw);
      if (!item) continue;
      const previous = merged.get(item.id);
      if (!previous || item.updatedAt >= previous.updatedAt) merged.set(item.id, item);
    }
    return [...merged.values()].sort((a,b) => a.updatedAt - b.updatedAt).slice(-MAX_GOALS);
  }
  function reconcile(input = {}) {
    const now = safeTime(input.now, Date.now());
    const inquiryRows = Array.isArray(input.inquiries) ? input.inquiries : [];
    const memoryRows = Array.isArray(input.memories) ? input.memories : [];
    const focus = input.focus && typeof input.focus === "object" ? input.focus : null;
    const byId = new Map(goals.map(item => [item.id, item]));
    const next = [];
    for (const inquiry of inquiryRows.slice(-MAX_GOALS)) {
      if (!inquiry || typeof inquiry.id !== "string" || !/^Q\d{1,8}$/u.test(inquiry.id)) continue;
      const id = "G-" + inquiry.id;
      const item = buildGoal(inquiry, memoryRows, focus, now, byId.get(id));
      if (item) next.push(item);
    }
    const seen = new Set(next.map(item => item.id));
    for (const old of goals) if (!seen.has(old.id)) next.push(old);
    goals = next.sort((a,b) => a.updatedAt - b.updatedAt).slice(-MAX_GOALS);
    persist();
    return snapshot();
  }
  function list() {
    return goals.map(item => ({
      ...item, blockers: item.blockers.slice(), sourceClaimIds: item.sourceClaimIds.slice(),
      evidenceClaimIds: item.evidenceClaimIds.slice(), evidenceMemoryIds: item.evidenceMemoryIds.slice(),
      milestones: item.milestones.slice()
    }));
  }
  function snapshot() {
    const count = status => goals.filter(item => item.status === status).length;
    return {
      total: goals.length, active: count("active"), waiting: count("waiting_user"),
      blocked: count("blocked") + count("stale"), review: count("review"),
      paused: count("paused"), completed: count("completed"),
      focusId: (goals.find(item => item.selected) || {}).id || ""
    };
  }
  function report() {
    const state = snapshot();
    const labels = {
      active: "АКТИВНАЯ", waiting_user: "ЖДУ ОТВЕТА", blocked: "ЗАБЛОКИРОВАНА",
      review: "ТРЕБУЕТ ПЕРЕСМОТРА", paused: "ОТЛОЖЕНА", completed: "ЗАВЕРШЕНА", stale: "БЕЗ ДВИЖЕНИЯ"
    };
    const lines = [
      "ЦЕЛИ И САМОКОНТРОЛЬ",
      "Всего: " + state.total + " · активных: " + state.active + " · ждут ответа: " + state.waiting +
        " · заблокировано/без движения: " + state.blocked + " · требуют пересмотра: " + state.review +
        " · отложено: " + state.paused + " · завершено: " + state.completed
    ];
    if (!goals.length) {
      lines.push("", "Пока нет сформированных исследовательских целей. Они появятся из конкретных открытых вопросов и пробелов в сохранённых данных.");
    } else {
      const ordered = goals.slice().sort((a,b) =>
        Number(b.selected) - Number(a.selected) || b.focusScore - a.focusScore || b.updatedAt - a.updatedAt);
      lines.push("", "ТЕКУЩИЕ ЦЕЛИ");
      for (const item of ordered.slice(0, 8)) {
        lines.push("• " + item.id + " · " + (labels[item.status] || item.status) + " · " + item.title);
        lines.push("  Основание: вопрос " + item.inquiryId + "; исходных утверждений: " + item.sourceClaimIds.length +
          "; связанных записей: " + item.evidenceMemoryIds.length + "; прямых наблюдений: " + item.observationCount +
          " (" + item.eventCount + " различимых эпизодов).");
        lines.push("  Этапы обработки: " + (item.milestones.length ? item.milestones.join("; ") : "пока не начаты") +
          " · служебный прогресс " + item.progress + "/100.");
        if (item.blockers.length) lines.push("  Блокеры: " + item.blockers.join("; "));
        lines.push("  Следующий шаг: " + item.nextAction);
        if (item.selected) lines.push("  Приоритет внимания: " + item.focusScore + "/100 (очередность работы, не вероятность истинности).");
      }
    }
    lines.push("", "ПРИНЦИП: цель создаётся из сохранённого исследовательского вопроса, а не из приписанного системе желания. Этапы показывают ход обработки, не истинность причинной гипотезы. Сообщения пользователя не считаются независимо проверенными источниками.");
    return lines.join("\n");
  }
  function merge(incoming) {
    goals = mergeGoals(goals, incoming);
    persist();
    return snapshot();
  }
  function clear() {
    goals = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { persist(); }
    return snapshot();
  }
  load();
  window.NGGoals = {version:1,load,reconcile,list,snapshot,report,export:() => list(),merge,clear};
})();