(() => {
  "use strict";

  const MEMORY_KEY = "neurogenesis.memories.v1";
  const DIALOG_KEY = "neurogenesis.dialog.v1";
  const MAX_MEMORIES = 500;
  const MAX_DIALOG = 24;
  const MAX_TEXT = 1200;
  const KNOWLEDGE = window.NGKnowledge || null;
  let memoryMigrated = false;
  const STOP = new Set(("и в во на я ты мы вы они он она оно мне меня тебя тебе ваш ваши мой моя мое мои свой свои себя это этот эта эти тот та те что как где когда зачем почему кто который а но или да нет не ни же бы ли для по из к со с от до над под при про у об обо есть был была были быть буду будет уже еще очень также тут там туда сюда его ее их").split(/\s+/u));
  const $ = id => document.getElementById(id);
  let memories = [];
  let dialog = [];
  let tagTrace = Object.create(null);
  let libraryOpen = false;
  let libraryLimit = 20;
  let libraryFilter = "";

  function normalise(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/giu, " ").trim().replace(/\s+/g, " ");
  }
  function stem(word) {
    return word.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|ах|ях|ов|ев|ей|ом|ем|а|я|ы|и|е|у|ю)$/u, "");
  }
  function tokens(value) {
    return normalise(value).split(" ").filter(word => word.length >= 3 && !STOP.has(word))
      .map(stem).filter(word => word.length >= 3);
  }
  function safeTime(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  function cleanMemory(raw) {
    if (!raw || typeof raw.text !== "string") return null;
    const text = raw.text.trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const legacyTags = Array.isArray(raw.tags) ? raw.tags.filter(x => typeof x === "string").map(normalise).filter(Boolean) : [];
    const tags = [...new Set([...legacyTags, ...tokens(text)])].slice(0, 6);
    const traceIds = tags.map(tag => {
      const index = legacyTags.indexOf(tag);
      return index >= 0 && Array.isArray(raw.traceIds) && typeof raw.traceIds[index] === "string" ? raw.traceIds[index] : null;
    });
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 80) : makeId(),
      text, tags: tags.length ? tags : tokens(text).slice(0, 6), traceIds,
      claims: KNOWLEDGE ? (KNOWLEDGE.extractClaims(text).length ? KNOWLEDGE.mergeClaims(raw.claims, KNOWLEDGE.extractClaims(text)) : KNOWLEDGE.sanitizeClaims(raw.claims, text)) : [],
      createdAt: safeTime(raw.createdAt, Date.now()),
      updatedAt: safeTime(raw.updatedAt, safeTime(raw.createdAt, Date.now())),
      strength: Number.isFinite(Number(raw.strength)) ? Math.max(0, Math.min(1, Number(raw.strength))) : 0.65,
      repetitions: Math.max(1, Math.min(100000, Math.floor(Number(raw.repetitions) || 1))),
      recalls: Math.max(0, Math.min(100000, Math.floor(Number(raw.recalls) || 0)))
    };
  }
  function makeId() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function rebuildTagTraceIndex() {
    tagTrace = Object.create(null);
    for (const item of memories) {
      item.tags.forEach((tag, index) => {
        const id = item.traceIds[index];
        if (id && !tagTrace[tag]) tagTrace[tag] = id;
      });
    }
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
      memoryMigrated = Array.isArray(saved) && saved.some(item => item && (!Array.isArray(item.claims) || item.claims.length === 0) && KNOWLEDGE && KNOWLEDGE.extractClaims(item.text).length > 0);
      memories = Array.isArray(saved) ? saved.map(cleanMemory).filter(Boolean).slice(-MAX_MEMORIES) : [];
    } catch (error) {
      memories = [];
      console.warn("Could not load NEUROGENESIS memories:", error);
    }
    try {
      const savedDialog = JSON.parse(localStorage.getItem(DIALOG_KEY) || "[]");
      dialog = Array.isArray(savedDialog)
        ? savedDialog.filter(x => x && typeof x.text === "string")
          .map(x => ({ role: x.role === "user" ? "user" : "assistant", text: x.text.slice(0, 1800), time: safeTime(x.time, Date.now()) }))
          .slice(-MAX_DIALOG)
        : [];
    } catch (error) {
      dialog = [];
      console.warn("Could not load NEUROGENESIS dialogue:", error);
    }
    rebuildTagTraceIndex();
    const brain = window.NGBrain;
    if (brain && typeof brain.hasNeuron === "function" && typeof brain.createMemoryTrace === "function") {
      let repaired = false;
      for (const item of memories) {
        const oldIds = item.traceIds.slice();
        item.traceIds = item.tags.map((tag, index) => {
          const id = oldIds[index];
          return id && brain.hasNeuron(id) ? id : ensureTrace(tag);
        });
        if (item.traceIds.some((id, index) => id !== oldIds[index])) repaired = true;
      }
      rebuildTagTraceIndex();
      if (repaired) memoryMigrated = true;
    }
    if (memoryMigrated) { memoryMigrated = false; persist(); }
  }
  function persist() {
    updateCount();
    let ok = true;
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories.slice(-MAX_MEMORIES)));
    } catch (error) {
      ok = false;
      console.warn("NEUROGENESIS memory storage failed", error);
    }
    try {
      localStorage.setItem(DIALOG_KEY, JSON.stringify(dialog.slice(-MAX_DIALOG)));
    } catch (error) {
      ok = false;
      console.warn("NEUROGENESIS dialogue storage failed", error);
    }
    if (!ok) setFeedback("Не удалось полностью сохранить данные: хранилище браузера заполнено или недоступно. Сделай экспорт резервной копии.");
    return ok;
  }
  function updateCount() {
    const el = $("memory-count");
    if (el) el.textContent = memories.length + " / " + MAX_MEMORIES + " ЗАПИСЕЙ";
    const manage = $("memory-manage");
    if (manage) manage.textContent = "Записи (" + memories.length + ")";
    const knowledgeCount = $("knowledge-count");
    if (knowledgeCount && KNOWLEDGE) {
      const summary = KNOWLEDGE.summary(memories.flatMap(item => item.claims || []));
      knowledgeCount.textContent = summary.total + " СТРУКТУРНЫХ СВЯЗЕЙ";
    }
  }
  function setFeedback(message) {
    const el = $("memory-feedback");
    if (el) el.textContent = message;
  }
  function renderDialog() {
    const feed = $("memory-feed");
    if (!feed) return;
    feed.textContent = "";
    const items = dialog.length ? dialog : [{
      role: "assistant",
      text: "Я — ранний прототип. Могу сохранять факты, искать связи и возвращать то, что действительно записано в моей памяти."
    }];
    for (const item of items.slice(-12)) {
      const bubble = document.createElement("div");
      bubble.className = "memory-message " + (item.role === "user" ? "from-user" : "from-brain");
      bubble.textContent = item.text;
      feed.appendChild(bubble);
    }
    feed.scrollTop = feed.scrollHeight;
  }
  function say(role, text) {
    dialog.push({ role, text: String(text).slice(0, 1800), time: Date.now() });
    dialog = dialog.slice(-MAX_DIALOG);
    persist();
    renderDialog();
  }
  function ensureTrace(tag) {
    const brain = window.NGBrain;
    if (tagTrace[tag]) {
      if (!brain || typeof brain.hasNeuron !== "function" || brain.hasNeuron(tagTrace[tag])) return tagTrace[tag];
      delete tagTrace[tag];
    }
    if (!brain || typeof brain.createMemoryTrace !== "function") return null;
    const id = brain.createMemoryTrace(tag);
    if (id) tagTrace[tag] = id;
    return id || null;
  }
  function releaseUnusedTraces(candidateIds) {
    const used = new Set(memories.flatMap(item => item.traceIds || []).filter(Boolean));
    const unused = [...new Set((candidateIds || []).filter(id => id && !used.has(id)))];
    const brain = window.NGBrain;
    if (unused.length && brain && typeof brain.removeMemoryTraces === "function") {
      brain.removeMemoryTraces(unused);
    }
    rebuildTagTraceIndex();
  }
  function linkMemory(item, related) {
    const ids = [...(item.traceIds || [])];
    for (const old of related || []) ids.push(...(old.traceIds || []));
    const unique = [...new Set(ids.filter(Boolean))];
    const brain = window.NGBrain;
    if (brain && typeof brain.associateMemoryTraces === "function") brain.associateMemoryTraces(unique);
    if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces(item.traceIds || []);
  }
  function rememberText(raw) {
    const clean = String(raw || "").trim().slice(0, MAX_TEXT);
    if (!clean) { setFeedback("Сначала напиши, что мне нужно запомнить."); return false; }
    const fragments = clean.split(/\n+|(?<=[.!?])\s+/u).map(x => x.trim()).filter(Boolean).slice(0, 8);
    let saved = 0, repeated = 0, skipped = 0;
    for (const fragment of fragments) {
      const compact = normalise(fragment);
      if (compact.length < 3) continue;
      const tags = [...new Set(tokens(fragment))].slice(0, 6);
      const claims = KNOWLEDGE ? KNOWLEDGE.extractClaims(fragment) : [];
      let item = memories.find(x => normalise(x.text) === compact);
      if (item) {
        item.strength = Math.min(1, (item.strength || 0.6) + 0.12);
        item.updatedAt = Date.now();
        item.repetitions = (item.repetitions || 1) + 1;
        for (const tag of tags) {
          if (item.tags.includes(tag) || item.tags.length >= 6) continue;
          item.tags.push(tag);
          item.traceIds.push(ensureTrace(tag));
        }
        if (KNOWLEDGE) item.claims = KNOWLEDGE.mergeClaims(item.claims, claims);
        repeated++;
        const related = memories.filter(old => old.id !== item.id && old.tags.some(tag => tags.includes(tag))).slice(-4);
        linkMemory(item, related);
      } else {
        if (memories.length >= MAX_MEMORIES) { skipped++; continue; }
        const traceIds = tags.map(ensureTrace);
        const related = memories.filter(old => old.tags.some(tag => tags.includes(tag))).slice(-4);
        item = {
          id: makeId(), text: fragment.slice(0, MAX_TEXT), tags, traceIds,
          createdAt: Date.now(), updatedAt: Date.now(), strength: 0.65,
          repetitions: 1, recalls: 0,
          claims
        };
        memories.push(item);
        saved++;
        linkMemory(item, related);
      }
    }
    rebuildTagTraceIndex();
    const ok = persist();
    if (!saved && !repeated && skipped) {
      const response = "Память заполнена: лимит — " + MAX_MEMORIES + " записей. Я не стал молча удалять старые воспоминания. Открой «Записи», удали ненужное или сделай экспорт.";
      say("assistant", response);
      setFeedback("ЛИМИТ ДОСТИГНУТ · СТАРЫЕ ЗАПИСИ СОХРАНЕНЫ");
      return false;
    }
    if (!saved && !repeated) {
      say("assistant", "Не получилось выделить отдельный фрагмент для памяти. Попробуй сформулировать мысль полным предложением.");
      setFeedback("НЕТ СОХРАНЁННЫХ ФРАГМЕНТОВ");
      return false;
    }
    let response = saved ? "Запомнил " + saved + (saved === 1 ? " новый фрагмент" : " новых фрагмента") : "Эта информация уже была в памяти";
    if (repeated) response += (saved ? "; повторно обработал " : ". Усилил след ") + repeated + (repeated === 1 ? " повтор" : " повтора");
    if (skipped) response += ". " + skipped + " новых фрагментов не поместились: лимит заполнен";
    response += ". Выделил темы и связал их с узлами памяти.";
    if (!ok) response += " Но локальное сохранение не подтвердилось.";
    say("assistant", response);
    renderLibrary();
    setFeedback("ПАМЯТЬ ОБНОВЛЕНА · " + memories.length + " / " + MAX_MEMORIES);
    return true;
  }
  function scoreMemory(query, item) {
    const q = [...new Set(tokens(query))];
    const structuredText = KNOWLEDGE ? (item.claims || []).map(claim => KNOWLEDGE.claimSearchText(claim)).join(" ") : "";
    const words = [...new Set(tokens(item.text + " " + structuredText))];
    if (!q.length || !words.length) return 0;
    const set = new Set(words);
    const hits = q.filter(word => set.has(word) || (item.tags || []).includes(word)).length;
    const coverage = hits / q.length;
    const density = hits / Math.sqrt(q.length * words.length);
    const qNorm = normalise(query);
    const textNorm = normalise(item.text);
    const phrase = qNorm.length > 5 && textNorm.includes(qNorm) ? 0.34 : 0;
    const tagHits = q.filter(word => (item.tags || []).includes(word)).length;
    const tagBoost = tagHits / q.length * 0.08;
    return Math.min(1, coverage * 0.62 + density * 0.30 + phrase + tagBoost) *
      (0.75 + (item.strength || 0.6) * 0.25);
  }
  function askMemory(raw) {
    const query = String(raw || "").trim();
    if (!query) { setFeedback("Напиши вопрос к моей памяти."); return; }
    const lower = normalise(query);
    if (/^(привет|здравствуй|добрый день|доброе утро|добрый вечер)\b/u.test(lower)) {
      say("assistant", "Привет. Я на связи. Можешь рассказать мне факт для памяти или спросить о том, что я уже сохранил.");
      return;
    }
    if (/(сколько|покажи|список).*(помн|воспомин|запис)|что ты (знаешь|помнишь)/u.test(lower)) {
      const recent = memories.slice(-5).reverse();
      const text = memories.length
        ? "Сейчас в долговременной памяти " + memories.length + " записей. Последние из них:\n" + recent.map((m, i) => (i + 1) + ". " + m.text).join("\n")
        : "Моя долговременная память пока пуста. Нажми «Запомнить», чтобы передать мне первый факт.";
      say("assistant", text);
      const ids = recent.flatMap(m => m.traceIds || []);
      const brain = window.NGBrain;
      if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces(ids);
      return;
    }
    const allClaims = memories.flatMap(item => item.claims || []);
    const structuredAnswer = KNOWLEDGE ? KNOWLEDGE.answerQuestion(query, allClaims) : null;
    if (structuredAnswer) {
      const related = memories.map(item => ({ item, score: scoreMemory(query, item) }))
        .filter(hit => hit.score > 0.08).sort((a, b) => b.score - a.score).slice(0, 3);
      const traceIds = [];
      for (const hit of related) {
        hit.item.recalls = (hit.item.recalls || 0) + 1;
        hit.item.strength = Math.min(1, (hit.item.strength || 0.6) + 0.015);
        traceIds.push(...(hit.item.traceIds || []));
      }
      persist();
      say("assistant", structuredAnswer);
      const brain = window.NGBrain;
      if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces([...new Set(traceIds)]);
      setFeedback("СТРУКТУРНЫЙ ПОИСК · " + related.length + " ЗАПИСЕЙ");
      return;
    }
    const ranked = memories.map(item => ({ item, score: scoreMemory(query, item) }))
      .filter(hit => hit.score >= 0.19).sort((a, b) => b.score - a.score).slice(0, 4);
    if (!ranked.length) {
      say("assistant", "Я пока не нашёл в своей памяти достаточно близкой информации.\n\nЯ не буду выдумывать ответ. Расскажи мне об этом через «Запомнить», и я смогу использовать эти сведения в следующих вопросах.");
      setFeedback("ПОИСК ЗАВЕРШЁН · НАДЁЖНЫХ СОВПАДЕНИЙ НЕТ");
      return;
    }
    const ids = [];
    for (const hit of ranked) {
      hit.item.recalls = (hit.item.recalls || 0) + 1;
      hit.item.strength = Math.min(1, (hit.item.strength || 0.6) + 0.015);
      ids.push(...(hit.item.traceIds || []));
    }
    persist();
    const answer = "Я нашёл " + ranked.length + (ranked.length === 1 ? " связанное воспоминание:" : " связанных воспоминания:") +
      "\n\n" + ranked.map((hit, i) => (i + 1) + ". " + hit.item.text).join("\n\n") +
      "\n\nЭто найденные записи, а не самостоятельно проверенные факты. Я пока умею извлекать и связывать сохранённые сведения, но ещё не обладаю полноценным языковым мышлением.";
    say("assistant", answer);
    const brain = window.NGBrain;
    if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces([...new Set(ids)]);
    setFeedback("ПОИСК ЗАВЕРШЁН · НАЙДЕНО " + ranked.length);
  }

  function removeMemory(id) {
    const item = memories.find(entry => entry.id === id);
    if (!item) return;
    if (!window.confirm("Удалить эту запись из памяти? Её уникальные нейронные следы тоже будут удалены.")) return;
    memories = memories.filter(entry => entry.id !== id);
    releaseUnusedTraces(item.traceIds || []);
    persist();
    renderLibrary();
    say("assistant", "Запись удалена. Общие нейронные следы сохранены, если на них ссылаются другие воспоминания.");
    setFeedback("ЗАПИСЬ УДАЛЕНА · " + memories.length + " ОСТАЛОСЬ");
  }
  function editMemory(id, text) {
    const item = memories.find(entry => entry.id === id);
    const value = String(text || "").trim().slice(0, MAX_TEXT);
    if (!item || !value) { setFeedback("Текст записи не может быть пустым."); return false; }
    if (memories.some(entry => entry.id !== id && normalise(entry.text) === normalise(value))) {
      setFeedback("Такая запись уже существует. Отредактируй её вместо создания повтора.");
      return false;
    }
    const oldIds = [...(item.traceIds || [])];
    const tags = [...new Set(tokens(value))].slice(0, 6);
    const claims = KNOWLEDGE ? KNOWLEDGE.extractClaims(value) : [];
    item.text = value;
    item.claims = claims;
    item.tags = tags;
    item.traceIds = tags.map(ensureTrace);
    item.updatedAt = Date.now();
    const related = memories.filter(entry => entry.id !== id && entry.tags.some(tag => tags.includes(tag))).slice(-4);
    linkMemory(item, related);
    releaseUnusedTraces(oldIds);
    persist();
    renderLibrary();
    say("assistant", "Запись исправлена. Я обновил её темы и связи в нейронной сети.");
    setFeedback("ИЗМЕНЕНИЯ СОХРАНЕНЫ");
    return true;
  }
  function clearMemory() {
    if (!memories.length) { setFeedback("Память уже пуста."); return; }
    if (!window.confirm("Удалить все " + memories.length + " записей и их уникальные нейронные следы? История диалога останется.")) return;
    const oldIds = memories.flatMap(item => item.traceIds || []);
    memories = [];
    releaseUnusedTraces(oldIds);
    persist();
    renderLibrary();
    say("assistant", "Долговременная память очищена. История этого диалога сохранена.");
    setFeedback("ПАМЯТЬ ОЧИЩЕНА");
  }
  function formatDate(time) {
    try { return new Date(time).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
    catch (_) { return ""; }
  }
  function button(label, action, className) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.dataset.action = action;
    el.className = className || "secondary-button";
    return el;
  }
  function renderLibrary() {
    const panel = $("memory-library");
    const list = $("memory-library-list");
    if (!panel || !list) return;
    panel.hidden = !libraryOpen;
    if (!libraryOpen) return;
    const query = normalise(libraryFilter);
    const filtered = memories.filter(item => !query || normalise(item.text + " " + item.tags.join(" ") + " " + (item.claims || []).map(claim => KNOWLEDGE ? KNOWLEDGE.claimSearchText(claim) : "").join(" ")).includes(query));
    const visible = filtered.slice().reverse().slice(0, libraryLimit);
    list.textContent = "";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "memory-library-empty";
      empty.textContent = memories.length ? "По этому запросу ничего не найдено." : "Память пока пуста. Сохрани первый факт выше.";
      list.appendChild(empty);
    }
    for (const item of visible) {
      const card = document.createElement("article");
      card.className = "memory-entry";
      card.dataset.memoryId = item.id;
      const meta = document.createElement("div");
      meta.className = "memory-entry-meta";
      meta.textContent = formatDate(item.createdAt) + " · повторений: " + item.repetitions + " · извлечений: " + item.recalls;
      const text = document.createElement("div");
      text.className = "memory-entry-text";
      text.textContent = item.text;
      if (KNOWLEDGE && item.claims && item.claims.length) {
        const structured = document.createElement("div");
        structured.className = "memory-entry-claims";
        for (const claim of item.claims) {
          const line = document.createElement("div");
          line.className = "memory-entry-claim";
          const kind = document.createElement("span");
          kind.className = "memory-claim-kind";
          kind.textContent = ({relationship:"СВЯЗЬ",opinion:"МНЕНИЕ",preference:"ПРЕДПОЧТЕНИЕ",definition:"ОПРЕДЕЛЕНИЕ",hypothesis:"ГИПОТЕЗА"})[claim.kind] || "ЗАПИСЬ";
          const label = document.createElement("span");
          label.textContent = KNOWLEDGE.claimLabel(claim);
          const source = document.createElement("small");
          source.textContent = claim.verification === "subjective" ? "Субъективная оценка" : claim.verification === "self_reported" ? "Самоописание" : claim.verification === "hypothesis" ? "Предположение" : "Источник: сообщение пользователя · не проверено";
          line.append(kind, label, source);
          structured.appendChild(line);
        }
        card.append(meta, text, structured);
      } else {
        card.append(meta, text);
      }
      const tags = document.createElement("div");
      tags.className = "memory-entry-tags";
      for (const tag of item.tags) {
        const chip = document.createElement("span");
        chip.className = "memory-tag";
        chip.textContent = tag;
        tags.appendChild(chip);
      }
      const actions = document.createElement("div");
      actions.className = "memory-entry-actions";
      actions.append(button("Изменить", "edit", "secondary-button memory-mini-button"), button("Забыть", "delete", "secondary-button memory-mini-button memory-delete-button"));
      const editor = document.createElement("div");
      editor.className = "memory-edit";
      editor.hidden = true;
      const area = document.createElement("textarea");
      area.className = "text-input memory-edit-input";
      area.maxLength = MAX_TEXT;
      area.value = item.text;
      const editorActions = document.createElement("div");
      editorActions.className = "memory-entry-actions";
      editorActions.append(button("Сохранить", "save-edit", "primary-button memory-mini-button"), button("Отмена", "cancel-edit", "secondary-button memory-mini-button"));
      editor.append(area, editorActions);
      card.append(tags, actions, editor);
      list.appendChild(card);
    }
    const more = $("memory-more");
    if (more) {
      more.hidden = filtered.length <= visible.length;
      more.textContent = "Показать ещё (" + Math.max(0, filtered.length - visible.length) + ")";
    }
    updateCount();
  }
  function handleLibraryClick(event) {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const card = control.closest(".memory-entry");
    if (!card) return;
    const id = card.dataset.memoryId;
    const action = control.dataset.action;
    if (action === "delete") removeMemory(id);
    if (action === "edit") {
      const editor = card.querySelector(".memory-edit");
      editor.hidden = !editor.hidden;
      if (!editor.hidden) card.querySelector(".memory-edit-input").focus();
    }
    if (action === "cancel-edit") card.querySelector(".memory-edit").hidden = true;
    if (action === "save-edit") editMemory(id, card.querySelector(".memory-edit-input").value);
  }

  function exportBackup() {
    try {
      const backup = {
        format: "NEUROGENESIS_MEMORY_BACKUP",
        version: 2,
        knowledgeModel: KNOWLEDGE ? KNOWLEDGE.version : 0,
        exportedAt: new Date().toISOString(),
        memories,
        dialog
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "neurogenesis-memory-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setFeedback("РЕЗЕРВНАЯ КОПИЯ ПОДГОТОВЛЕНА · " + memories.length + " ЗАПИСЕЙ");
    } catch (error) {
      console.error("NEUROGENESIS export failed:", error);
      setFeedback("Экспорт не удался. Браузер не разрешил создать файл.");
    }
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data && data.format && data.format !== "NEUROGENESIS_MEMORY_BACKUP") throw new Error("Это не резервная копия NEUROGENESIS.");
      if (data && Number(data.version) > 2) throw new Error("Версия резервной копии новее поддерживаемой.");
      const incoming = Array.isArray(data) ? data : data && data.memories;
      if (!Array.isArray(incoming)) throw new Error("Файл не содержит список воспоминаний.");
      let imported = 0, duplicates = 0, skipped = 0;
      for (const raw of incoming) {
        const candidate = cleanMemory(raw);
        if (!candidate) { skipped++; continue; }
        const duplicate = memories.find(item => normalise(item.text) === normalise(candidate.text));
        if (duplicate) {
          duplicate.strength = Math.min(1, Math.max(duplicate.strength, candidate.strength));
          duplicate.repetitions += candidate.repetitions;
          duplicate.updatedAt = Date.now();
          if (KNOWLEDGE) duplicate.claims = KNOWLEDGE.mergeClaims(duplicate.claims, candidate.claims);
          duplicates++;
          continue;
        }
        if (memories.length >= MAX_MEMORIES) { skipped++; continue; }
        candidate.id = makeId();
        candidate.tags = [...new Set(tokens(candidate.text))].slice(0, 6);
        candidate.claims = KNOWLEDGE ? (candidate.claims.length ? candidate.claims : KNOWLEDGE.extractClaims(candidate.text)) : [];
        candidate.traceIds = candidate.tags.map(ensureTrace);
        candidate.createdAt = safeTime(candidate.createdAt, Date.now());
        candidate.updatedAt = Date.now();
        const related = memories.filter(old => old.tags.some(tag => candidate.tags.includes(tag))).slice(-4);
        memories.push(candidate);
        linkMemory(candidate, related);
        imported++;
      }
      if (Array.isArray(data.dialog)) {
        const restored = data.dialog.filter(item => item && typeof item.text === "string")
          .map(item => ({ role: item.role === "user" ? "user" : "assistant", text: item.text.slice(0, 1800), time: safeTime(item.time, Date.now()) }));
        dialog = [...dialog, ...restored].sort((a, b) => a.time - b.time).slice(-MAX_DIALOG);
      }
      rebuildTagTraceIndex();
      const ok = persist();
      renderLibrary();
      renderDialog();
      say("assistant", "Импорт завершён. Добавлено: " + imported + ", уже были: " + duplicates + ", пропущено: " + skipped + (ok ? "." : ". Локальное сохранение не подтвердилось."));
      setFeedback("ИМПОРТ · +" + imported + " · ПОВТОРОВ " + duplicates + " · ПРОПУЩЕНО " + skipped);
    } catch (error) {
      console.warn("NEUROGENESIS import failed:", error);
      setFeedback("Не удалось импортировать файл: " + String(error.message || error).slice(0, 100));
    }
  }

  function submit(action) {
    const input = $("memory-input");
    const value = input ? input.value.trim() : "";
    if (!value) { setFeedback("Сначала введи текст."); return; }
    say("user", value);
    if (action === "remember") rememberText(value);
    else askMemory(value);
    input.value = "";
    input.focus();
  }

  const rememberButton = $("remember-button");
  const askButton = $("ask-button");
  const memoryInput = $("memory-input");
  if (rememberButton) rememberButton.addEventListener("click", () => submit("remember"));
  if (askButton) askButton.addEventListener("click", () => submit("ask"));
  if (memoryInput) memoryInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit("ask");
    }
  });
  const manageButton = $("memory-manage");
  if (manageButton) manageButton.addEventListener("click", () => {
    libraryOpen = !libraryOpen;
    libraryLimit = 20;
    renderLibrary();
    if (libraryOpen) $("memory-library").scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  const filterInput = $("memory-filter");
  if (filterInput) filterInput.addEventListener("input", event => {
    libraryFilter = event.target.value;
    libraryLimit = 20;
    renderLibrary();
  });
  const moreButton = $("memory-more");
  if (moreButton) moreButton.addEventListener("click", () => { libraryLimit += 20; renderLibrary(); });
  const libraryList = $("memory-library-list");
  if (libraryList) libraryList.addEventListener("click", handleLibraryClick);
  const exportButton = $("memory-export");
  if (exportButton) exportButton.addEventListener("click", exportBackup);
  const importButton = $("memory-import");
  const importInput = $("memory-import-file");
  if (importButton && importInput) importButton.addEventListener("click", () => importInput.click());
  if (importInput) importInput.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    if (file) await importBackup(file);
    importInput.value = "";
  });
  const clearButton = $("memory-clear");
  if (clearButton) clearButton.addEventListener("click", clearMemory);

  load();
  updateCount();
  renderDialog();
  renderLibrary();
  setFeedback("ЛОКАЛЬНАЯ ПАМЯТЬ · ДАННЫЕ ОСТАЮТСЯ В ЭТОМ БРАУЗЕРЕ");
  window.NGMemory = {
    count: () => memories.length,
    search: query => memories.map(item => ({ text: item.text, claims: item.claims || [], score: scoreMemory(query, item) }))
      .sort((a, b) => b.score - a.score).slice(0, 5),
    claims: () => memories.flatMap(item => item.claims || []),
    summary: () => KNOWLEDGE ? KNOWLEDGE.summary(memories.flatMap(item => item.claims || [])) : {total:0}

  };
})();