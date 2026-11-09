(() => {
  "use strict";
  const STORAGE_KEY = "neurogenesis.goals.v1";
  const MAX_GOALS = 24;
  const STALE_AFTER = 30 * 24 * 60 * 60 * 1000;
  const STATUSES = ["active","waiting_user","blocked","review","paused","completed","stale"];
  const STORAGE_TRANSACTION_KEY = "neurogenesis.storage-transaction.v1";
  let goals = [];

  function createStorageTransaction() {
    let depth = 0;
    let staged = new Map();
    let ready = true;
    let lastError = "";
    const clearKey = key => {
      if (typeof localStorage.removeItem === "function") localStorage.removeItem(key);
      else localStorage.setItem(key, "");
    };
    const clearJournal = () => clearKey(STORAGE_TRANSACTION_KEY);

    function recover() {
      let raw;
      try { raw = localStorage.getItem(STORAGE_TRANSACTION_KEY); }
      catch (error) {
        ready = false; lastError = String(error && error.message || error);
        console.warn("NEUROGENESIS storage recovery could not read its journal:", error);
        return false;
      }
      if (!raw) { ready = true; lastError = ""; return true; }
      let journal;
      try { journal = JSON.parse(raw); }
      catch (error) {
        ready = false; lastError = "Повреждён журнал транзакции хранилища.";
        console.warn("NEUROGENESIS storage recovery found an invalid journal:", error);
        return false;
      }
      const rows = journal && journal.version === 1 && Array.isArray(journal.before) ? journal.before : null;
      if (!rows || rows.some(row => !row || typeof row.key !== "string" ||
          row.key === STORAGE_TRANSACTION_KEY || !(row.value === null || typeof row.value === "string"))) {
        ready = false; lastError = "Некорректная структура журнала транзакции.";
        console.warn("NEUROGENESIS storage recovery refused an invalid journal.");
        return false;
      }
      try {
        for (const row of rows) clearKey(row.key);
        for (const row of rows) if (row.value !== null) localStorage.setItem(row.key, row.value);
        clearJournal();
        ready = true; lastError = "";
        return true;
      } catch (error) {
        ready = false; lastError = String(error && error.message || error);
        console.warn("NEUROGENESIS storage recovery is incomplete; its journal was retained:", error);
        return false;
      }
    }

    function run(entries) {
      if (!ready && !recover()) return false;
      const targets = new Map();
      const changed = [];
      try {
        for (const row of Array.isArray(entries) ? entries : []) {
          if (!row || typeof row.key !== "string" || !row.key || row.key === STORAGE_TRANSACTION_KEY)
            throw new Error("Некорректный ключ транзакции.");
          targets.set(row.key, row.value === null ? null : String(row.value));
        }
        for (const [key, value] of targets) {
          const previous = localStorage.getItem(key);
          if (previous !== value) changed.push({ key, value: previous });
        }
        if (!changed.length) return true;
        localStorage.setItem(STORAGE_TRANSACTION_KEY, JSON.stringify({ version: 1, before: changed }));
        for (const row of changed) {
          const value = targets.get(row.key);
          if (value === null) clearKey(row.key);
          else localStorage.setItem(row.key, value);
        }
        clearJournal();
        ready = true; lastError = "";
        return true;
      } catch (error) {
        lastError = String(error && error.message || error);
        console.warn("NEUROGENESIS storage transaction failed; restoring its before-image:", error);
        try {
          if (localStorage.getItem(STORAGE_TRANSACTION_KEY)) recover();
          else ready = true;
        } catch (recoveryError) {
          ready = false; lastError += "; rollback: " + String(recoveryError && recoveryError.message || recoveryError);
        }
        return false;
      }
    }

    function begin() {
      if (depth === 0) {
        if (!ready && !recover()) return false;
        staged = new Map();
      }
      depth++;
      return true;
    }
    function stage(key, value) {
      if (typeof key !== "string" || !key || key === STORAGE_TRANSACTION_KEY) return false;
      const normalized = value === null ? null : String(value);
      if (depth > 0) { staged.set(key, normalized); return true; }
      return run([{ key, value: normalized }]);
    }
    function commit() {
      if (depth <= 0) return false;
      depth--;
      if (depth > 0) return true;
      const entries = [...staged].map(([key, value]) => ({ key, value }));
      staged.clear();
      return run(entries);
    }
    function abort() { depth = 0; staged.clear(); }
    function status() { return { ready, active: depth > 0, pendingWrites: staged.size, error: lastError }; }
    const api = Object.freeze({ version: 1, key: STORAGE_TRANSACTION_KEY, begin, stage, commit, abort, run, recover, status });
    window.NGStorageTransaction = api;
    recover();
    return api;
  }
  createStorageTransaction();
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
      kind: ["contrast_observations","clarify_counterexample","missing_observation","duplicate_observation","discriminating_observations"].includes(raw.kind)
        ? raw.kind : "missing_observation",
      title, status, nextAction: cleanText(raw.nextAction, 420),
      blockers: Array.isArray(raw.blockers) ? raw.blockers.filter(x => typeof x === "string").slice(0, 4).map(x => x.slice(0, 220)) : [],
      sourceClaimIds: uniqueStrings(raw.sourceClaimIds),
      evidenceClaimIds: uniqueStrings(raw.evidenceClaimIds),
      evidenceMemoryIds: uniqueStrings(raw.evidenceMemoryIds),
      observationCount: Math.max(0, Math.min(500, Math.floor(Number(raw.observationCount) || 0))),
      observationsAfterAssessment: Math.max(0, Math.min(500, Math.floor(Number(raw.observationsAfterAssessment) || 0))),
      eventCount: Math.max(0, Math.min(500, Math.floor(Number(raw.eventCount) || 0))),
      unknownEventCount: Math.max(0, Math.min(500, Math.floor(Number(raw.unknownEventCount) || 0))),
      completeObservationCount: Math.max(0, Math.min(500, Math.floor(Number(raw.completeObservationCount) || 0))),
      incompleteObservationCount: Math.max(0, Math.min(500, Math.floor(Number(raw.incompleteObservationCount) || 0))),
      metadataCoverage: Math.max(0, Math.min(100, Math.round(Number(raw.metadataCoverage) || 0))),
      numericOutcomeMissingCount: Math.max(0, Math.min(500, Math.floor(Number(raw.numericOutcomeMissingCount) || 0))),
      milestones: Array.isArray(raw.milestones) ? raw.milestones.filter(x => typeof x === "string").slice(0, 5).map(x => x.slice(0, 80)) : [],
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
    const value = JSON.stringify(goals.slice(-MAX_GOALS));
    const transaction = window.NGStorageTransaction;
    if (transaction && typeof transaction.stage === "function") {
      const ok = transaction.stage(STORAGE_KEY, value);
      if (!ok) console.warn("NEUROGENESIS research-goal storage transaction was rejected.");
      return ok;
    }
    try { localStorage.setItem(STORAGE_KEY, value); return true; }
    catch (error) {
      console.warn("NEUROGENESIS research-goal storage failed:", error);
      return false;
    }
  }
  function statusFor(inquiry, now, lastProgressAt, evidence) {
    if (inquiry.status === "skipped") return "paused";
    if (inquiry.status === "answered") {
      if (["duplicate_same_event","duplicate_separate_events","duplicate_partitioned_events"].includes(inquiry.assessment)) return "completed";
      if (["insufficient_context","gap_confirmed"].includes(inquiry.assessment)) {
        return evidence && evidence.observationsAfterAssessment > 0 ? "review" : "blocked";
      }
      return "review";
    }
    if (lastProgressAt > 0 && now - lastProgressAt > STALE_AFTER) return "stale";
    return inquiry.lastAskedAt > 0 ? "waiting_user" : "active";
  }
  function evidenceFor(inquiry, memories) {
    const wanted = new Set([...(inquiry.sourceClaimIds || []),...(inquiry.responseClaimIds || [])]);
    const evidence = new Map();
    const memoryIds = new Set();
    const claimRecordedAt = new Map();
    const memoryRows = Array.isArray(memories) ? memories : [];
    const comparisonEdges = inquiry.kind === "discriminating_observations" &&
      Array.isArray(inquiry.comparisonEdges)
      ? inquiry.comparisonEdges.filter(edge => edge && typeof edge.subject === "string" &&
        typeof edge.object === "string")
      : [];
    const evidenceEdges = comparisonEdges.length ? comparisonEdges : [{
      subject: inquiry.edgeSubject, object: inquiry.edgeObject
    }];
    if (inquiry.responseMemoryId) memoryIds.add(inquiry.responseMemoryId);
    for (const memory of memoryRows) {
      if (!memory || typeof memory.id !== "string") continue;
      for (const claim of Array.isArray(memory.claims) ? memory.claims : []) {
        if (!claim || typeof claim.id !== "string") continue;
        const linkedById = wanted.has(claim.id);
        // Duplicate checks compare only the cards named by the inquiry.
        const matchingObservation = inquiry.kind !== "duplicate_observation" &&
          claim.kind === "observation" && evidenceEdges.some(edge =>
            sameEntity(claim.subject, edge.subject) && sameEntity(claim.object, edge.object));
        if (!linkedById && !matchingObservation) continue;
        evidence.set(claim.id, claim);
        const recordedAt = safeTime(claim.createdAt, safeTime(memory.createdAt, 0));
        claimRecordedAt.set(claim.id, Math.max(claimRecordedAt.get(claim.id) || 0, recordedAt));
        memoryIds.add(memory.id);
      }
    }
    const rows = [...evidence.values()];
    const observations = rows.filter(claim => claim.kind === "observation");
    const assessmentAt = safeTime(inquiry.assessmentAt, safeTime(inquiry.answeredAt, 0));
    const observationsAfterAssessment = assessmentAt
      ? observations.filter(claim => (claimRecordedAt.get(claim.id) || 0) > assessmentAt).length
      : 0;
    const explicitEventRefs = observations.map(claim => {
      const details = claim.observationCase && typeof claim.observationCase === "object"
        ? claim.observationCase : {};
      return typeof claim.eventRef === "string" && claim.eventRef.trim()
        ? claim.eventRef.trim()
        : typeof details.eventRef === "string" ? details.eventRef.trim() : "";
    }).filter(Boolean);
    const events = new Set(explicitEventRefs.map(value=>normalise(value)));
    const numericRequired = field => !!(field&&field.status==="provided"&&
      /шкал|балл|процент|температур|пульс|частот|давлен|уровен|количеств|числов/u.test(normalise(field.value)));
    const numericPresent = field => !!(field&&field.status==="provided"&&/[+-]?\d+(?:[.,]\d+)?/u.test(String(field.value||"")));
    const fieldCount = observations.length*4;
    const knownFields = observations.reduce((sum,claim)=>{
      const details=claim.observationCase&&typeof claim.observationCase==="object"?claim.observationCase:{};
      return sum+["context","timing","criterion","outcome"].filter(key=>
        details[key]&&details[key].status==="provided").length;
    },0);
    const quality = observations.map(claim=>{
      const details=claim.observationCase&&typeof claim.observationCase==="object"?claim.observationCase:{};
      const required=["context","timing","criterion"].filter(key=>!details[key]||details[key].status!=="provided");
      const needsNumber=numericRequired(details.criterion);
      const missingNumber=needsNumber&&!numericPresent(details.outcome);
      return {claimId:claim.id,complete:required.length===0&&!missingNumber,missingFields:required,
        numericOutcomeRequired:needsNumber,numericOutcomeMissing:missingNumber};
    });
    return {
      claimIds: [...evidence.keys()].slice(0, 12),
      memoryIds: [...memoryIds].slice(0, 12),
      observationCount: observations.length,
      observationsAfterAssessment,
      eventCount: events.size,
      unknownEventCount: observations.length - explicitEventRefs.length,
      completeObservationCount: quality.filter(item=>item.complete).length,
      incompleteObservationCount: quality.filter(item=>!item.complete).length,
      metadataCoverage: fieldCount?Math.round(knownFields/fieldCount*100):0,
      numericOutcomeMissingCount: quality.filter(item=>item.numericOutcomeMissing).length
    };
  }
  function buildGoal(inquiry, memories, focus, now, previous) {
    const evidence = evidenceFor(inquiry, memories);
    const sourceClaimIds = uniqueStrings(inquiry.sourceClaimIds);
    const milestones = [];
    if (sourceClaimIds.length) milestones.push("есть исходные утверждения");
    if (inquiry.lastAskedAt > 0) milestones.push("вопрос был задан");
    if (inquiry.status === "answered") milestones.push("получен ответ");
    if (["duplicate_same_event","duplicate_separate_events"].includes(inquiry.assessment))
      milestones.push("идентичность эпизодов уточнена");
    if (inquiry.assessment==="duplicate_partitioned_events")
      milestones.push("карточки распределены по группам эпизодов");
    if (evidence.observationCount > 0) milestones.push("привязаны прямые наблюдения");
    if (evidence.observationsAfterAssessment > 0) milestones.push("после оценки добавлены новые наблюдения");
    const workSteps = [
      sourceClaimIds.length > 0,
      inquiry.lastAskedAt > 0,
      inquiry.status === "answered",
      evidence.observationCount > 0 || ["duplicate_same_event","duplicate_separate_events","duplicate_partitioned_events"].includes(inquiry.assessment)
    ];
    const progress = Math.round(workSteps.filter(Boolean).length / 4 * 100);
    const focusId = focus && focus.item && focus.item.id;
    const selected = focusId === inquiry.id;
    const focusScore = selected ? Math.round(Math.max(0, Math.min(1, Number(focus.score) || 0)) * 100) : 0;
    const blockers = [];
    const needsReassessment = inquiry.status === "answered" &&
      ["insufficient_context","gap_confirmed"].includes(inquiry.assessment) &&
      evidence.observationsAfterAssessment > 0;
    if (inquiry.assessment === "insufficient_context" && !needsReassessment) {
      blockers.push(inquiry.assessmentReason || "Ответ не позволил восстановить контекст сравниваемых случаев.");
    } else if (inquiry.assessment === "gap_confirmed" && !needsReassessment) {
      blockers.push(inquiry.assessmentReason || "В ответе подтверждено отсутствие нужных наблюдений.");
    } else if (evidence.observationCount === 0) {
      blockers.push("В привязанных записях пока нет прямой карточки наблюдения для этого звена.");
    }
    if (inquiry.kind === "duplicate_observation" &&
        !["duplicate_same_event","duplicate_separate_events","duplicate_partitioned_events"].includes(inquiry.assessment) &&
        evidence.unknownEventCount > 0) {
      blockers.push("Для " + evidence.unknownEventCount + " наблюдений не задан eventRef: нельзя определить, один это эпизод или несколько.");
    }
    let nextAction = "Задать исследовательский вопрос " + inquiry.id + " и уточнить недостающие сведения.";
    if (inquiry.status === "open" && inquiry.lastAskedAt > 0) {
      nextAction = "Ожидается содержательный ответ на " + inquiry.id + ".";
    } else if (needsReassessment) {
      nextAction = "После предыдущей оценки появились " + evidence.observationsAfterAssessment +
        " новых прямых наблюдений. Повторно сопоставить их контекст, время и критерий; прежний ответ и его оценка сохраняются как история.";
    } else if (inquiry.status === "answered" && inquiry.assessment === "insufficient_context") {
      nextAction = "Уточнить обстоятельства, время и критерий результата; до этого причинная связь остаётся непроверенной.";
    } else if (inquiry.status === "answered" && inquiry.assessment === "gap_confirmed") {
      nextAction = "Добавить естественное наблюдение, когда оно появится; специально создавать условия ради проверки не нужно.";
    } else if (inquiry.status === "answered") {
      nextAction = "Пересмотреть вопрос с учётом ответа и отдельно проверить, появились ли прямые наблюдения.";
    } else if (inquiry.status === "skipped") {
      nextAction = "Вопрос отложен. К нему можно вернуться позднее.";
    } else if (inquiry.kind === "duplicate_observation") {
      nextAction = "Ответить на " + inquiry.id + ": «один эпизод», «разные эпизоды» или полное разбиение вида «группы: 1+2; 3; 4+5». Каждый номер карточки нужно использовать ровно один раз.";
    } else if (evidence.observationCount > 0) {
      nextAction = "Сопоставить связанные карточки наблюдений, не считая их автоматически доказательством.";
    }
    const previousProgress = previous ? previous.lastProgressAt : safeTime(inquiry.updatedAt, inquiry.createdAt);
    const status = statusFor(inquiry, now, previousProgress, evidence);
    const candidate = {
      id: "G-" + inquiry.id, inquiryId: inquiry.id, kind: inquiry.kind,
      title: "Уточнить связь «" + cleanText(inquiry.edgeSubject, 100) + " → " + cleanText(inquiry.edgeObject, 100) + "»",
      status, nextAction, blockers, sourceClaimIds, evidenceClaimIds: evidence.claimIds,
      evidenceMemoryIds: evidence.memoryIds, observationCount: evidence.observationCount,
      observationsAfterAssessment: evidence.observationsAfterAssessment,
      eventCount: evidence.eventCount, unknownEventCount: evidence.unknownEventCount,
      completeObservationCount:evidence.completeObservationCount,
      incompleteObservationCount:evidence.incompleteObservationCount,
      metadataCoverage:evidence.metadataCoverage,
      numericOutcomeMissingCount:evidence.numericOutcomeMissingCount,
      milestones, progress, focusScore, selected,
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
          " · после последней оценки: " + item.observationsAfterAssessment +
          " · явных eventRef: " + item.eventCount + " · без eventRef: " + item.unknownEventCount + ".");
        lines.push("  Прогресс выполнения работы: " + item.progress + "/100 · " +
          (item.milestones.length ? item.milestones.join("; ") : "этапы пока не начаты") + ".");
        lines.push("  Качество доказательств: полных карточек " + item.completeObservationCount + "/" +
          item.observationCount + " · заполненность полей " + item.metadataCoverage + "% · не хватает числового результата: " +
          item.numericOutcomeMissingCount + ".");
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
    const transaction = window.NGStorageTransaction;
    if (transaction && typeof transaction.stage === "function") transaction.stage(STORAGE_KEY, null);
    else {
      try { localStorage.removeItem(STORAGE_KEY); }
      catch (error) { console.warn("NEUROGENESIS research-goal clearing failed:", error); }
    }
    return snapshot();
  }
  load();
  window.NGGoals = {version:1,load,reconcile,list,snapshot,report,export:() => list(),merge,clear};
})();