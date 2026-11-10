(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const panel = $("first-experiment");
  if (!panel) return;
  const runButton = $("first-experiment-run");
  const showButton = $("first-experiment-show");
  const status = $("first-experiment-status");
  const result = $("first-experiment-result");
  if (!runButton || !showButton || !status || !result) return;

  const FACT = "У осьминога три сердца.";
  const QUESTION = "Сколько сердец у осьминога?";

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || "info";
  }

  function runFirstExperiment() {
    const memory = window.NGMemory;
    const input = $("memory-input");
    const rememberButton = $("remember-button");
    const askButton = $("ask-button");
    if (!memory || typeof memory.count !== "function" || typeof memory.search !== "function" ||
        !input || !rememberButton || !askButton) {
      setStatus("Память пока не готова. Обнови страницу и повтори опыт.", "error");
      return;
    }

    runButton.disabled = true;
    showButton.disabled = true;
    result.hidden = true;
    setStatus("Сохраняю учебный факт в локальную память…", "working");

    try {
      const countBefore = memory.count();
      input.value = FACT;
      rememberButton.click();
      const countAfter = memory.count();
      const savedRecord = memory.search(FACT).find(item => item && item.text === FACT);
      if (!savedRecord) {
        throw new Error("Не удалось подтвердить запись факта в локальной памяти.");
      }

      input.value = QUESTION;
      // Keep this teaching exercise deterministic; ordinary questions use semantic interpretation.
      askButton.dataset.ngForceLocal = "true";
      askButton.click();
      const matches = memory.search(QUESTION).filter(item =>
        item && typeof item.text === "string" && Number(item.score) >= 0.19
      );
      const feedback = $("memory-feedback");
      const feedbackText = feedback ? feedback.textContent : "";
      const activatedMatch = feedbackText.match(/(\d+)\s+СЛЕДОВ АКТИВИРОВАНО/iu);
      const activated = activatedMatch ? Number(activatedMatch[1]) : 0;
      const count = memory.count();
      const savedMatch = matches.find(item => item && item.text === FACT && Number(item.score) >= 0.19);
      const feed = $("memory-feed");
      const lastReply = feed && feed.lastElementChild;
      const replyText = lastReply && /from-brain/u.test(String(lastReply.className || ""))
        ? String(lastReply.textContent || "").slice(0, 700) : "";
      const normalizedReply = replyText.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
      const replyConfirmsFact = replyText.includes(FACT) ||
        (/осьминог/u.test(normalizedReply) && /три/u.test(normalizedReply) && /серд/u.test(normalizedReply));
      const retrievalVerified = !!savedMatch && replyConfirmsFact;

      const savedLabel = countAfter > countBefore
        ? "Добавлена новая запись."
        : "Запись уже существовала и была обработана повторно.";
      const retrievalLabel = retrievalVerified
        ? "Поиск нашёл запись, и ответ диалога подтвердил её извлечение:"
        : savedMatch
          ? "Поиск видит запись, но сам ответ диалога не подтвердил её извлечение."
          : "По заданному вопросу память не нашла достаточно надёжного совпадения.";

      result.textContent = [
        savedLabel,
        retrievalLabel,
        savedMatch ? "Сохранённый факт: «" + savedMatch.text + "»." : "",
        replyText ? "Ответ системы: «" + replyText + "»" : "Ответ ассистента не найден в истории диалога.",
        "Записей в памяти: " + count + ".",
        "Следов памяти активировано по отчёту: " + activated + "."
      ].filter(Boolean).join("\n");
      result.hidden = false;
      showButton.disabled = !retrievalVerified;
      runButton.disabled = false;
      setStatus(
        retrievalVerified
          ? "Опыт завершён: факт сохранён, вопрос обработан и ответ подтверждает извлечение."
          : "Опыт завершён частично: факт сохранён, но ответ не подтвердил его извлечение.",
        retrievalVerified ? "success" : "warning"
      );
    } catch (error) {
      runButton.disabled = false;
      setStatus("Опыт не завершён: " + String(error && error.message || error), "error");
    }
  }

  function showNetworkResponse() {
    const simulationButton = $("run-button");
    if (!simulationButton) {
      setStatus("Поле симуляции недоступно.", "error");
      return;
    }
    if (!/пауза/iu.test(simulationButton.textContent || "")) {
      simulationButton.click();
    }
    showButton.disabled = true;
    showButton.textContent = "Симуляция включена";
    setStatus(
      "Смотри на поле нейросети: поиск памяти передал найденные следы визуальному ядру. Это демонстрация извлечения и активации памяти, а не обучение всей сети с нуля.",
      "success"
    );
  }

  runButton.addEventListener("click", runFirstExperiment);
  showButton.addEventListener("click", showNetworkResponse);
})();