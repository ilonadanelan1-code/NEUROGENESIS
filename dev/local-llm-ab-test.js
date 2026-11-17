"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const MODELS = {
    base: {
      id: "onnx-community/Qwen3-0.6B-ONNX",
      revision: "a7b503b1c3f7e98e8f80b6d565f47807a5007d9c",
      note: "Base: используемая сейчас модель. Ожидается существующий кэш 5/5."
    },
    instruct: {
      id: "onnx-community/Qwen3-0.6B-Instruct-ONNX",
      revision: "54250909aca286a05b9d013c8af7a21859ee6ead",
      note: "Instruct: отдельный checkpoint minpeter/Qwen3-0.6B-Instruct. Отдельные файлы, первая загрузка потребует интернет."
    }
  };
  const SYSTEM = "Ты NEUROGENESIS, русскоязычный помощник. Отвечай естественным, грамматически правильным русским языком. Сначала дай прямой ответ. На простой вопрос достаточно 1–3 коротких предложений. Не выдумывай детали. Если не знаешь, так и скажи. Не повторяй вопрос.";
  const adapter = NGLocalLLM.create({
    workerUrl: "../local-llm-worker.js",
    maxContextChars: 9000,
    generation: { max_new_tokens: 112, temperature: 0, repetition_penalty: 1.05 },
    onStatus: status => {
      $("status").textContent = JSON.stringify(status, null, 2);
      $("load").disabled = status.phase === "loading" || status.phase === "generating";
      $("send").disabled = status.phase !== "ready" || busy;
    }
  });
  let busy = false;
  let loadedModelId = null;
  let history = [{ role: "system", content: SYSTEM }];
  const selected = () => MODELS[$("model").value];
  const formatMs = value => Number.isFinite(value) ? (value < 1000 ? Math.round(value) + " мс" : (value / 1000).toFixed(1) + " с") : "—";
  function setError(error) {
    $("error").textContent = error ? "Ошибка [" + (error.code || "error") + "]: " + (error.message || error) : "";
  }
  function updateModelNote() {
    $("modelNote").textContent = selected().note;
  }
  function renderDiagnostics(prompt, gpu) {
    const lines = [];
    if (prompt) {
      lines.push("Шаблон промпта: " + (prompt.renderSucceeded ? "отрисован" : "ошибка"));
      lines.push("Роли: " + (prompt.roles || []).join(" → "));
      lines.push("Шаблон найден: " + (prompt.templateAvailable ? "да" : "нет/неизвестно") +
        " · длина: " + (prompt.templateChars == null ? "—" : prompt.templateChars));
      lines.push("Символов в промпте: " + (prompt.renderedChars == null ? "—" : prompt.renderedChars));
      lines.push("Начинается с system: " + !!prompt.beginsWithSystem +
        " · вопрос не потерян: " + !!prompt.includesLatestUser +
        " · суффикс assistant: " + !!prompt.endsWithAssistantPrefix);
      if (prompt.error) lines.push("Проблема шаблона: " + prompt.error);
    }
    if (gpu) {
      lines.push("GPU callback-вызовов: " + (gpu.callbackCount == null ? "—" : gpu.callbackCount));
      lines.push("Корректных GPU-записей: " + gpu.eventCount +
        " · записей без валидных времён: " + (gpu.rejectedRecords == null ? "—" : gpu.rejectedRecords));
      lines.push("Поля последней записи: " + ((gpu.lastDataKeys || []).join(", ") || "нет"));
      lines.push("Сумма GPU-ядер: " + Number(gpu.totalGpuMs || 0).toFixed(2) + " мс");
      if (gpu.kernels && gpu.kernels.length) {
        lines.push("Тяжёлые ядра:");
        gpu.kernels.forEach(kernel => lines.push("  " + kernel.name + " · " + kernel.count + " · " + kernel.gpuMs + " мс"));
      }
    }
    $("diagnostics").textContent = lines.length ? lines.join("\n") : "Нет диагностических данных.";
  }
  $("model").addEventListener("change", updateModelNote);
  $("sky").onclick = () => { $("question").value = "Почему небо голубое? Объясни по-русски в двух коротких предложениях. Не выдумывай."; };
  $("fact").onclick = () => { $("question").value = "Что делает митохондрия в клетке? Ответь по-русски в двух коротких предложениях."; };
  $("reset").onclick = () => {
    history = [{ role: "system", content: SYSTEM }];
    $("answer").textContent = "";
    $("metrics").textContent = "Появятся после генерации.";
    $("diagnostics").textContent = "Появится после генерации.";
    setError(null);
  };
  $("cache").onclick = async () => {
    setError(null);
    $("cache").disabled = true;
    try {
      const model = selected();
      const report = await adapter.checkCache({
        device: $("device").value, modelId: model.id, revision: model.revision
      });
      $("progress").textContent = "Кэш " + (report.complete ? "полный" : "неполный") +
        " · файлы " + report.files.filter(file => file.status === "ok").length + "/" + report.files.length +
        " · отсутствует " + report.missing.length;
      $("status").textContent = JSON.stringify(report, null, 2);
    } catch (error) { setError(error); }
    $("cache").disabled = false;
  };
  $("load").onclick = async () => {
    if (busy) return;
    setError(null);
    $("load").disabled = true;
    $("bar").value = 0;
    try {
      const model = selected();
      if (loadedModelId && loadedModelId !== model.id) {
        $("progress").textContent = "Выгружаю предыдущую модель из оперативной памяти…";
        await adapter.unload();
        loadedModelId = null;
      }
      const result = await adapter.load({
        device: $("device").value, modelId: model.id, revision: model.revision
      }, event => {
        if (event.phase === "download") {
          $("bar").value = event.percent;
          $("progress").textContent = "Загрузка " + event.percent + "% · " + (event.file || "");
        } else if (event.message) $("progress").textContent = event.message;
      });
      loadedModelId = model.id;
      history = [{ role: "system", content: SYSTEM }];
      $("bar").value = 100;
      $("progress").textContent = "Готово · " + model.id + " · " + result.status.device + "/" + result.status.dtype;
      $("status").textContent = JSON.stringify({
        status: result.status, cache: result.cache, metaSource: result.metaSource
      }, null, 2);
      $("send").disabled = false;
    } catch (error) {
      setError(error);
      $("load").disabled = false;
    }
  };
  $("unload").onclick = async () => {
    if (busy) return;
    try {
      await adapter.unload();
      loadedModelId = null;
      $("progress").textContent = "Модель выгружена из памяти. Кэшированные файлы сохранены.";
      $("send").disabled = true;
    } catch (error) { setError(error); }
  };
  $("send").onclick = async () => {
    const question = $("question").value.trim();
    if (!question || busy) return;
    if (!adapter.status().ready || loadedModelId !== selected().id) {
      setError({ code: "model_not_loaded", message: "Загрузи именно выбранную модель." });
      return;
    }
    busy = true;
    $("send").disabled = true;
    $("stop").disabled = false;
    $("answer").textContent = "";
    $("metrics").textContent = "";
    $("diagnostics").textContent = "";
    setError(null);
    const turn = history.concat([{ role: "user", content: question }]);
    try {
      const result = await adapter.generateDetailed(
        { schema: "NEUROGENESIS_LLM_REQUEST_V1", messages: turn },
        {
          promptDiagnostics: true,
          onToken: piece => { $("answer").textContent += piece; }
        }
      );
      history = turn.concat([{ role: "assistant", content: result.reply }]);
      const usage = result.usage || {};
      const metrics = result.metrics || {};
      $("metrics").textContent = [
        "Модель: " + result.model,
        "Устройство: " + result.device + "/" + result.dtype,
        "Токенов: " + (usage.completion_tokens || 0),
        "До первого токена: " + formatMs(metrics.timeToFirstTokenMs),
        "Генерация: " + formatMs(metrics.generationMs) + " · всего: " + formatMs(metrics.totalMs),
        "Скорость: " + (metrics.decodeTokensPerSecond == null ? "—" : metrics.decodeTokensPerSecond.toFixed(2) + " ток/с")
      ].join("\n");
      renderDiagnostics(result.promptDiagnostics, result.gpuProfile);
    } catch (error) { setError(error); }
    busy = false;
    $("stop").disabled = true;
    $("send").disabled = !adapter.status().ready;
    $("load").disabled = adapter.status().phase === "loading";
  };
  $("stop").onclick = () => adapter.stop();
  window.addEventListener("beforeunload", () => adapter.dispose());
  updateModelNote();
  $("status").textContent = JSON.stringify(adapter.status(), null, 2);
})();
