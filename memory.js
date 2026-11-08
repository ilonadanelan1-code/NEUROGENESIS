(() => {
  "use strict";
  const MEMORY_KEY = "neurogenesis.memories.v1";
  const DIALOG_KEY = "neurogenesis.dialog.v1";
  const MAX_MEMORIES = 500;
  const MAX_DIALOG = 24;
  const STOP = new Set(("и в во на я ты мы вы они он она оно мне меня мне тебя тебе ваш вашa мой моя мое мои свой свои себя это этот эта эти тот та те что как где когда зачем почему кто который а но или да нет не ни же бы ли для по из к со с от до над под при про у об обо есть был была были быть буду будет уже еще очень также тут там где-то туда сюда мой твой его ее их мне тебе").toLowerCase().split(/\s+/));
  const $ = id => document.getElementById(id);
  let memories = [];
  let dialog = [];
  let tagTrace = Object.create(null);

  function normalise(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/giu, " ").trim().replace(/\s+/g, " ");
  }
  function stem(word) {
    return word.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|ах|ях|ов|ев|ей|ом|ем|а|я|ы|и|е|у|ю)$/u, "");
  }
  function tokens(value) {
    return normalise(value).split(" ").filter(w => w.length >= 3 && !STOP.has(w)).map(stem).filter(w => w.length >= 3);
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
      memories = Array.isArray(saved) ? saved.filter(x => x && typeof x.text === "string").slice(-MAX_MEMORIES) : [];
    } catch (_) { memories = []; }
    try {
      const savedDialog = JSON.parse(localStorage.getItem(DIALOG_KEY) || "[]");
      dialog = Array.isArray(savedDialog) ? savedDialog.filter(x => x && typeof x.text === "string").slice(-MAX_DIALOG) : [];
    } catch (_) { dialog = []; }
    for (const item of memories) {
      if (!Array.isArray(item.tags)) item.tags = tokens(item.text).slice(0, 4);
      if (!Array.isArray(item.traceIds)) item.traceIds = [];
      item.tags.forEach((tag, index) => { if (item.traceIds[index] && !tagTrace[tag]) tagTrace[tag] = item.traceIds[index]; });
    }
  }
  function persist() {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories.slice(-MAX_MEMORIES)));
      localStorage.setItem(DIALOG_KEY, JSON.stringify(dialog.slice(-MAX_DIALOG)));
      updateCount();
      return true;
    } catch (error) {
      console.warn("NEUROGENESIS memory storage failed", error);
      setFeedback("Не удалось сохранить: хранилище браузера заполнено или недоступно.");
      return false;
    }
  }
  function updateCount() {
    const el = $("memory-count");
    if (el) el.textContent = memories.length + " / " + MAX_MEMORIES + " ЗАПИСЕЙ";
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
    if (tagTrace[tag]) return tagTrace[tag];
    const brain = window.NGBrain;
    if (!brain || typeof brain.createMemoryTrace !== "function") return null;
    const id = brain.createMemoryTrace(tag);
    if (id) tagTrace[tag] = id;
    return id || null;
  }
  function rememberText(raw) {
    const clean = String(raw || "").trim();
    if (!clean) { setFeedback("Сначала напиши, что мне нужно запомнить."); return; }
    const fragments = clean.split(/\n+|(?<=[.!?])\s+/u).map(x => x.trim()).filter(Boolean).slice(0, 8);
    let saved = 0;
    let linked = [];
    for (const fragment of fragments) {
      const compact = normalise(fragment);
      if (compact.length < 3) continue;
      let item = memories.find(x => normalise(x.text) === compact);
      const tags = [...new Set(tokens(fragment))].slice(0, 4);
      if (item) {
        item.strength = Math.min(1, (item.strength || 0.6) + 0.12);
        item.updatedAt = Date.now();
        item.repetitions = (item.repetitions || 1) + 1;
      } else {
        const traceIds = tags.map(ensureTrace).filter(Boolean);
        const related = memories.filter(old => old.tags.some(t => tags.includes(t))).slice(-4);
        const relatedIds = related.flatMap(old => old.traceIds || []);
        linked = linked.concat(traceIds, relatedIds);
        item = {
          id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          text: fragment.slice(0, 1200),
          tags,
          traceIds,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          strength: 0.65,
          repetitions: 1,
          recalls: 0
        };
        memories.push(item);
        saved++;
      }
      linked = linked.concat(item.traceIds || []);
    }
    memories = memories.slice(-MAX_MEMORIES);
    const brain = window.NGBrain;
    if (brain && typeof brain.associateMemoryTraces === "function") brain.associateMemoryTraces([...new Set(linked)]);
    if (brain && typeof brain.activateMemoryTraces === "function") brain.activateMemoryTraces([...new Set(linked)]);
    const ok = persist();
    const response = saved
      ? "Запомнил " + saved + (saved === 1 ? " фрагмент." : " фрагмента.") + " Выделил ключевые темы и связал их с узлами памяти."
      : "Эта информация уже была в памяти. Я усилил её след повторным предъявлением.";
    say("assistant", response + (ok ? "" : " Но локальное сохранение не подтвердилось."));
    setFeedback("ПАМЯТЬ ОБНОВЛЕНА · " + memories.length + " ЗАПИСЕЙ");
  }
  function scoreMemory(query, item) {
    const q = [...new Set(tokens(query))];
    const words = [...new Set(tokens(item.text))];
    if (!q.length || !words.length) return 0;
    const set = new Set(words);
    let common = 0;
    for (const word of q) if (set.has(word) || (item.tags || []).includes(word)) common++;
    const overlap = common / Math.sqrt(q.length * words.length);
    const qNorm = normalise(query);
    const textNorm = normalise(item.text);
    const phrase = qNorm.length > 5 && textNorm.includes(qNorm) ? 0.65 : 0;
    const tagBoost = q.filter(w => (item.tags || []).includes(w)).length * 0.07;
    return Math.min(1, overlap + phrase + tagBoost) * (0.75 + (item.strength || 0.6) * 0.25);
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
      if (brain && brain.activateMemoryTraces) brain.activateMemoryTraces(ids);
      return;
    }
    const ranked = memories.map(item => ({ item, score: scoreMemory(query, item) }))
      .filter(x => x.score >= 0.105).sort((a, b) => b.score - a.score).slice(0, 4);
    if (!ranked.length) {
      say("assistant", "Я пока не нашёл в своей памяти достаточно близкой информации.\n\nЯ не буду выдумывать ответ. Расскажи мне об этом через «Запомнить», и я смогу использовать эту информацию в следующих вопросах.");
      setFeedback("ПОИСК ЗАВЕРШЁН · СОВПАДЕНИЙ НЕТ");
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
      "\n\nЭто сведения из моей памяти, а не догадка. Пока я умею извлекать и связывать сохранённые факты, но ещё не обладаю полноценным языковым мышлением.";
    say("assistant", answer);
    const brain = window.NGBrain;
    if (brain && brain.activateMemoryTraces) brain.activateMemoryTraces([...new Set(ids)]);
    setFeedback("ПОИСК ЗАВЕРШЁН · НАЙДЕНО " + ranked.length);
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

  $("remember-button").addEventListener("click", () => submit("remember"));
  $("ask-button").addEventListener("click", () => submit("ask"));
  $("memory-input").addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit("ask");
    }
  });
  load();
  updateCount();
  renderDialog();
  setFeedback("ЛОКАЛЬНАЯ ПАМЯТЬ · ДАННЫЕ ОСТАЮТСЯ В ЭТОМ БРАУЗЕРЕ");
  window.NGMemory = {
    count: () => memories.length,
    search: query => memories.map(item => ({ text: item.text, score: scoreMemory(query, item) })).sort((a, b) => b.score - a.score).slice(0, 5)
  };
})();