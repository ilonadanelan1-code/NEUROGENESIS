(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const inputSelect = $("wasm-experiment-input");
  const positiveSelect = $("wasm-experiment-positive");
  const negativeSelect = $("wasm-experiment-negative");
  const refreshButton = $("wasm-experiment-refresh");
  const runButton = $("wasm-experiment-run");
  const exportButton = $("wasm-experiment-export");
  const statusElement = $("wasm-experiment-report");
  if (!inputSelect || !positiveSelect || !negativeSelect || !refreshButton ||
      !runButton || !exportButton || !statusElement) return;

  let currentSnapshot = null;
  let latestProposal = null;
  let latestReport = null;
  let latestSourceSignature = null;

  function setStatus(message, state = "info") {
    statusElement.textContent = message;
    statusElement.dataset.state = state;
  }

  function snapshotSignature(snapshot) {
    const neurons = (snapshot.neurons || []).filter(Boolean).map(row => [
      String(row.id ?? ""),
      String(row.type ?? row.kind ?? ""),
      Number(row.bias ?? row.excitability ?? 0.5)
    ]).sort((left, right) => left[0].localeCompare(right[0]));
    const synapses = (snapshot.synapses || []).filter(Boolean).map(edge => [
      String(edge.from ?? ""),
      String(edge.to ?? ""),
      Number(edge.weight ?? 0.5)
    ]).sort((left, right) => {
      const a = left[0] + "\\u0000" + left[1];
      const b = right[0] + "\\u0000" + right[1];
      return a.localeCompare(b);
    });
    return JSON.stringify({ neurons, synapses });
  }

  function clearResult() {
    latestProposal = null;
    latestReport = null;
    latestSourceSignature = null;
    exportButton.disabled = true;
  }

  function addOptions(select, rows, selectedId) {
    while (select.firstChild) select.removeChild(select.firstChild);
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = String(row.id);
      option.textContent = String(row.name || row.id) + " · " + String(row.id);
      select.appendChild(option);
    }
    if (rows.some(row => String(row.id) === String(selectedId))) {
      select.value = String(selectedId);
    } else if (rows.length) {
      select.value = String(rows[0].id);
    }
  }

  function outgoingOutputRows(snapshot, inputId) {
    const outputById = new Map((snapshot.neurons || [])
      .filter(row => row && String(row.type || row.kind || "") === "output")
      .map(row => [String(row.id), row]));
    const connected = new Set((snapshot.synapses || [])
      .filter(edge => edge && String(edge.from) === String(inputId))
      .map(edge => String(edge.to)));
    return [...connected].map(id => outputById.get(id)).filter(Boolean);
  }

  function updateTargets() {
    if (!currentSnapshot) return;
    const outputs = outgoingOutputRows(currentSnapshot, inputSelect.value);
    const oldPositive = positiveSelect.value;
    const oldNegative = negativeSelect.value;
    addOptions(positiveSelect, outputs, oldPositive);
    addOptions(negativeSelect, outputs, oldNegative);
    if (outputs.length > 1 && positiveSelect.value === negativeSelect.value) {
      negativeSelect.value = String(outputs[1].id);
    }
    const valid = outputs.length >= 2 && positiveSelect.value !== negativeSelect.value;
    positiveSelect.disabled = outputs.length === 0;
    negativeSelect.disabled = outputs.length < 2;
    runButton.disabled = !valid;
    if (!latestReport && !latestProposal) {
      if (!valid) {
        setStatus(outputs.length < 2
          ? "У выбранного входа нет двух прямых связей к выходным нейронам. Выбери другой вход или измени структуру сети."
          : "Выбери два разных выходных нейрона.", "warning");
      } else {
        setStatus("Готово к одноразовому опыту. Основная сеть останется неизменной.", "ready");
      }
    }
  }

  function refresh() {
    const api = window.NGBrain;
    if (!api || typeof api.wasmDiagnostics !== "function" ||
        typeof api.wasmSnapshot !== "function" ||
        typeof api.wasmCreateDisposableExperiment !== "function") {
      currentSnapshot = null;
      addOptions(inputSelect, [], "");
      addOptions(positiveSelect, [], "");
      addOptions(negativeSelect, [], "");
      runButton.disabled = true;
      setStatus("Интерфейс теневой WASM-сети пока недоступен.", "warning");
      return false;
    }

    const diagnostics = api.wasmDiagnostics();
    if (diagnostics.state !== "ready") {
      currentSnapshot = null;
      addOptions(inputSelect, [], "");
      addOptions(positiveSelect, [], "");
      addOptions(negativeSelect, [], "");
      runButton.disabled = true;
      setStatus("WASM ещё не готов. Нажми «Обновить список узлов» после запуска сети.", "info");
      return false;
    }

    const previousInput = inputSelect.value;
    const snapshot = api.wasmSnapshot();
    const signature = snapshotSignature(snapshot);
    const proposalBecameStale = latestSourceSignature !== null &&
      latestSourceSignature !== signature;
    if (proposalBecameStale) clearResult();
    const outputs = (snapshot.neurons || []).filter(row =>
      row && String(row.type || row.kind || "") === "output");
    const inputs = (snapshot.neurons || []).filter(row => {
      if (!row || String(row.type || row.kind || "") === "output") return false;
      return outgoingOutputRows(snapshot, row.id).length >= 2;
    });
    currentSnapshot = snapshot;
    addOptions(inputSelect, inputs, previousInput);
    inputSelect.disabled = inputs.length === 0;
    updateTargets();
    if (proposalBecameStale) {
      setStatus("Исходная сеть изменилась после опыта. Старое предложение аннулировано; проведи новую проверку.", "warning");
    }
    if (!inputs.length) {
      runButton.disabled = true;
      setStatus(outputs.length < 2
        ? "В сети пока нет двух выходных нейронов."
        : "Нет входа с прямыми связями к двум выходным нейронам. Этот опыт нельзя корректно провести на текущем графе.",
      "warning");
      return false;
    }
    return true;
  }

  function formatWeight(value) {
    return Number(value).toFixed(4);
  }

  function renderResult(result) {
    latestProposal = result && result.proposal ? result.proposal : null;
    latestReport = result && result.report ? result.report : null;
    latestSourceSignature = latestReport && currentSnapshot
      ? snapshotSignature(currentSnapshot) : null;
    exportButton.disabled = !latestProposal;
    if (!result || !result.report) {
      setStatus(result && result.message ? result.message : "Опыт не выполнен.", "warning");
      return;
    }
    const report = result.report;
    const lines = [
      (result.ok ? "ПРЕДЛОЖЕНИЕ ГОТОВО" : "ОПЫТ ЗАВЕРШЁН БЕЗ ИЗМЕНЕНИЯ ВЕСОВ") +
        " · изменено связей: " + report.changedSynapses,
      "Вход: " + report.input.name,
      "Правильный выход: " + report.positive.name +
        " · активность до коррекции " + formatWeight(report.positive.activationBeforeLearning) +
        " · вес " + formatWeight(report.positive.weightBefore) + " → " + formatWeight(report.positive.weightAfter),
      "Конкурирующий выход: " + report.negative.name +
        " · активность до коррекции " + formatWeight(report.negative.activationBeforeLearning) +
        " · вес " + formatWeight(report.negative.weightBefore) + " → " + formatWeight(report.negative.weightAfter),
      "Шагов: " + report.steps + " · следы: " +
        formatWeight(report.positive.eligibility) + " / " + formatWeight(report.negative.eligibility),
      "Профиль: +0.02 / −1.00. Изменены только две выбранные прямые связи.",
      "Предложение не применено. Основная сеть и локальные сохранения не затронуты."
    ];
    setStatus(lines.join("\n"), result.ok ? "ready" : "warning");
  }

  function run() {
    latestProposal = null;
    latestReport = null;
    exportButton.disabled = true;
    if (!refresh()) return;
    if (positiveSelect.value === negativeSelect.value) {
      setStatus("Правильный и конкурирующий выходы должны различаться.", "warning");
      return;
    }
    if (!window.NGDisposableExperimentSession ||
        typeof window.NGDisposableExperimentSession.runContrastiveTrial !== "function") {
      setStatus("Модуль изолированного опыта не загружен.", "warning");
      return;
    }
    runButton.disabled = true;
    runButton.textContent = "Выполняю опыт…";
    try {
      const result = window.NGDisposableExperimentSession.runContrastiveTrial({
        createExperiment: options => window.NGBrain.wasmCreateDisposableExperiment(options),
        inputId: inputSelect.value,
        positiveId: positiveSelect.value,
        negativeId: negativeSelect.value,
        steps: 6,
        stimulus: 0.8,
        positiveLearningRate: 0.02,
        negativeLearningRate: 1.0,
        deltaSeconds: 0.1,
        eligibilityRetention: 0.9
      });
      renderResult(result);
    } catch (error) {
      setStatus("Ошибка изолированного опыта: " + String(error && error.message || error), "warning");
    } finally {
      runButton.textContent = "Запустить опыт на копии";
      runButton.disabled = positiveSelect.value === negativeSelect.value ||
        !positiveSelect.value || !negativeSelect.value;
    }
  }

  function exportProposal() {
    if (!refresh() || !latestProposal || !latestReport) return;
    try {
      const payload = {
        ...latestProposal,
        trial: latestReport,
        note: "Manual-review-only. This proposal has not been applied to the authoritative JavaScript network."
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "neurogenesis-contrastive-proposal-" +
        new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Файл предложения подготовлен. Он не меняет сеть и требует отдельной ручной проверки.", "ready");
    } catch (error) {
      setStatus("Не удалось подготовить файл предложения: " +
        String(error && error.message || error), "warning");
    }
  }

  function handleSelectionChange() {
    const hadResult = !!latestProposal || !!latestReport;
    clearResult();
    updateTargets();
    if (hadResult) {
      setStatus("Выбор нейронов изменён. Предыдущий результат сброшен; запусти новый опыт.", "info");
    }
  }

  refreshButton.addEventListener("click", refresh);
  inputSelect.addEventListener("change", handleSelectionChange);
  positiveSelect.addEventListener("change", handleSelectionChange);
  negativeSelect.addEventListener("change", handleSelectionChange);
  runButton.addEventListener("click", run);
  exportButton.addEventListener("click", exportProposal);

  window.NGDisposableExperimentUI = Object.freeze({ refresh });
  refresh();
})();
