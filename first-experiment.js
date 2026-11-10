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
      askButton.click();
      const matches = memory.search(QUESTION).filter(item =>
        item && typeof item.text === "string" && Number(item.score) >= 0.19
      );
      const feedback = $("memory-feedback");
      const feedbackText = feedback ? feedback.textContent : "";
      const activatedMatch = feedbackText.match(/(\d+)\s+СЛЕДОВ АКТИВИРОВАНО/iu);
      const activated = activatedMatch ? Number(activatedMatch[1]) : 0;
      const count = memory.count();

      const savedLabel = countAfter > countBefore
        ? "Добавлена новая запись."
        : "Запись уже существовала и была обработана повторно.";
      const retrievalLabel = matches.length
        ? "Поиск нашёл сохранённое воспоминание:"
        : "Факт сохранён, но формулировка вопроса пока не дала уверенного совпадения.";
      const matchedText = matches.length ? matches[0].text : FACT;

      result.textContent = [
        savedLabel,
        retrievalLabel,
        matches.length ? "«" + matchedText + "»" : "",
        "Записей в памяти: " + count + ".",
        "Следов памяти активировано по отчёту: " + activated + "."
      ].filter(Boolean).join("\n");
      result.hidden = false;
      showButton.disabled = false;
      runButton.disabled = false;
      setStatus(
        matches.length
          ? "Опыт завершён: факт сохранён, вопрос обработан, связанная запись найдена."
          : "Опыт завершён частично: запись сохранена, но поиск не подтвердил совпадение.",
        matches.length ? "success" : "warning"
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