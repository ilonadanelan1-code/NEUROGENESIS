(() => {
  "use strict";

  const STORAGE_KEY = "neurogenesis.prototype.v2";
  const LAYOUT_UNDO_KEY = STORAGE_KEY + ".layout-undo";
  const TYPES = ["core", "sensory", "memory", "logic", "output"];
  const TYPE_NAMES = { core: "Ядро", sensory: "Сенсорный", memory: "Память", logic: "Логический", output: "Выходной" };
  const TYPE_COLORS = { core: [103,229,209], sensory: [104,185,231], memory: [173,146,239], logic: [235,184,112], output: [238,135,163] };
  const $ = (id) => document.getElementById(id);
  const canvas = $("brain-canvas");
  const systemStatus = $("system-status");
  function reportCanvasStartupFailure(message, error) {
    if (systemStatus) systemStatus.textContent = message;
    if (error && typeof console !== "undefined" && typeof console.error === "function") {
      console.error("NEUROGENESIS canvas startup failed:", error);
    }
  }
  if (!canvas || typeof canvas.getContext !== "function") {
    reportCanvasStartupFailure("CANVAS НЕ НАЙДЕН");
    return;
  }
  let ctx = null;
  try {
    ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  } catch (error) {
    reportCanvasStartupFailure("CANVAS НЕ УДАЛОСЬ ИНИЦИАЛИЗИРОВАТЬ", error);
    return;
  }
  if (!ctx) {
    reportCanvasStartupFailure("CANVAS НЕ ПОДДЕРЖИВАЕТСЯ");
    return;
  }

  let neurons = [];
  let synapses = [];
  let layoutUndoSnapshot = null;
  let layoutUndoSignature = "";
  let focusMode = false;
  let selectedId = null;
  let running = false;
  let connectMode = false;
  let connectFrom = null;
  let searchTerm = "";
  let pulses = [];
  let nextId = 1;
  let lastFrame = 0;
  let lastStimulus = 0;
  let dirty = false;
  let toastTimer = 0;
  let saveTimer = 0;
  let width = 0, height = 0, dpr = 1;
  let lastMetricsUpdate = 0;
  let visualDirty = true;
  let fpsFrames = 0;
  let fpsLast = 0;
  let frameScheduled = false;
  let frameHandle = null;
  let pageSuspended = typeof document.hidden === "boolean" && document.hidden;
  let animationWasActive = false;
  const activeNeuronIds = new Set();
  let wasmShadow = null;
  let wasmShadowStepElapsed = 0;
  let experienceQuality = null;
  let experienceBenchmarkRunning = false;
  const MAX_PULSES = 180;
  const MAX_BRANCH_PULSES = 28;
  const neuronById = new Map();
  const synapseByKey = new Map();
  const outgoingById = new Map();
  const edgeKey = (from, to) => from + "\u0000" + to;
  const backgroundLayer = document.createElement("canvas");
  const connectionLayer = document.createElement("canvas");
  const nodeLayer = document.createElement("canvas");
  let backgroundCtx = null;
  let connectionCtx = null;
  let nodeCtx = null;
  try {
    backgroundCtx = backgroundLayer.getContext("2d", {alpha:false});
    connectionCtx = connectionLayer.getContext("2d", {alpha:true});
    nodeCtx = nodeLayer.getContext("2d", {alpha:true});
  } catch (error) {
    reportCanvasStartupFailure("ГРАФИЧЕСКИЕ СЛОИ НЕ УДАЛОСЬ СОЗДАТЬ", error);
    return;
  }
  if (!backgroundCtx || !connectionCtx || !nodeCtx) {
    reportCanvasStartupFailure("НЕ УДАЛОСЬ СОЗДАТЬ ВСЕ ГРАФИЧЕСКИЕ СЛОИ");
    return;
  }
  const neuronSprites = new Map();
  let backgroundDirty = true;
  let connectionsDirty = true;
  let nodesDirty = true;
  const curveByKey = new Map();
  function scheduleFrame() {
    if (pageSuspended || document.hidden || frameScheduled) return;
    frameScheduled = true;
    frameHandle = requestAnimationFrame(frame);
  }
  function cancelScheduledFrame() {
    if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
    frameHandle = null;
    frameScheduled = false;
  }
  function rebuildIndexes() {
    neuronById.clear();
    synapseByKey.clear();
    outgoingById.clear();
    for (const n of neurons) {
      neuronById.set(n.id, n);
      outgoingById.set(n.id, []);
    }
    for (const s of synapses) {
      synapseByKey.set(edgeKey(s.from, s.to), s);
      if (!outgoingById.has(s.from)) outgoingById.set(s.from, []);
      outgoingById.get(s.from).push(s);
    }
    connectionsDirty = true;
    nodesDirty = true;
    syncWasmShadow();
  }
  function wasmShadowSnapshot() {
    return {
      neurons: neurons.map(n => ({
        id: n.id, name: n.name, type: n.type, x: n.x, y: n.y,
        bias: n.bias, activity: n.activity
      })),
      synapses: synapses.map(edge => ({
        from: edge.from, to: edge.to, weight: edge.weight
      }))
    };
  }
  function syncWasmShadow() {
    if (!wasmShadow) return false;
    const status = wasmShadow.diagnostics();
    if (status.state !== "ready" && status.state !== "error") return false;
    const ok = wasmShadow.rebuild();
    if (!ok) console.warn("NEUROGENESIS WebAssembly shadow sync failed:", wasmShadow.diagnostics().lastError);
    refreshWasmLearningUi(ok ? "" : "Не удалось синхронизировать теневую сеть.");
    return ok;
  }
  function refreshExperienceEpisodeUi(message) {
    const statusElement = $("wasm-experience-status");
    const reportElement = $("wasm-experience-report");
    const beginButton = $("wasm-episode-begin-button");
    const cancelButton = $("wasm-episode-cancel-button");
    const evaluateButton = $("wasm-sequence-learn-button");
    const benchmarkButton = $("wasm-experience-benchmark-button");
    const status = experienceQuality ? experienceQuality.status() : { state: "unavailable", current: null, latestReport: null };
    const isOpen = status.state === "open" && !!status.current;
    const wasmReady = !!(wasmShadow && wasmShadow.diagnostics().state === "ready");
    if (beginButton) beginButton.disabled = !wasmReady || isOpen;
    if (cancelButton) cancelButton.disabled = !isOpen;
    if (evaluateButton) evaluateButton.disabled = !isOpen;
    if (benchmarkButton) benchmarkButton.disabled = !wasmReady || experienceBenchmarkRunning;
    if (statusElement) {
      if (isOpen) {
        const current = status.current;
        statusElement.textContent = "ЭПИЗОД " + current.id +
          " · шаги " + current.steps +
          " · следов сейчас " + (current.latestMetrics?.eligibleSynapses || 0);
        statusElement.dataset.state = "open";
      } else if (status.latestReport) {
        const report = status.latestReport;
        statusElement.textContent = report.id + " · " + report.status +
          " · шагов " + report.steps +
          (report.changedSynapses != null ? " · изменено связей " + report.changedSynapses : "");
        statusElement.dataset.state = report.status;
      } else {
        statusElement.textContent = wasmReady ? "ЭПИЗОД НЕ НАЧАТ" : "ОЖИДАНИЕ WASM";
        statusElement.dataset.state = status.state;
      }
    }
    if (reportElement) {
      const report = status.latestReport;
      reportElement.textContent = message || (report
        ? "Последний отчёт: следов до оценки " + (report.eligibleSynapsesBeforeReward || 0) +
          ", изменено связанных весов " + (report.changedEligibleSynapses || 0) +
          ", изменено остальных весов " + (report.changedNonEligibleSynapses || 0) +
          ", изменение среднего веса " + Number(report.meanAbsoluteWeightDelta || 0).toFixed(5) +
          (report.traceConsumed ? ". Следы использованы." : ". Остались неиспользованные следы.")
        : "Начни эпизод, запусти симуляцию и только затем оцени результат.");
    }
  }
  function refreshWasmLearningUi(message) {
    const stateElement = $("wasm-learning-state");
    const feedbackElement = $("wasm-learning-feedback");
    if (!stateElement) return;
    const diagnostics = wasmShadow ? wasmShadow.diagnostics() : {
      state: window.NGWasm ? "not-started" : "unavailable",
      learnedSynapses: 0,
      learningUpdates: 0
    };
    const labels = {
      ready: "ГОТОВО",
      loading: "ЗАГРУЗКА",
      idle: "ОЖИДАНИЕ",
      "not-started": "ОЖИДАНИЕ",
      unavailable: "OFFLINE",
      error: "ОШИБКА",
      disposed: "ОСТАНОВЛЕНО"
    };
    stateElement.textContent = labels[diagnostics.state] || "НЕИЗВЕСТНО";
    stateElement.dataset.state = diagnostics.state;
    if (feedbackElement) {
      feedbackElement.textContent = message ||
        ("Обученных связей: " + (diagnostics.learnedSynapses || 0) +
         " · обновлений весов: " + (diagnostics.learningUpdates || 0) +
         " · подкреплений опыта: " + (diagnostics.sequenceRewards || 0));
    }
    refreshExperienceEpisodeUi();
    if (window.NGDisposableExperimentUI &&
        typeof window.NGDisposableExperimentUI.refresh === "function") {
      window.NGDisposableExperimentUI.refresh();
    }
  }
  function startWasmShadow() {
    if (!window.NGWasm || typeof window.NGWasm.createShadowController !== "function") return;
    wasmShadow = window.NGWasm.createShadowController({ getSnapshot: wasmShadowSnapshot });
    if (window.NGExperienceQuality && typeof window.NGExperienceQuality.create === "function") {
      experienceQuality = window.NGExperienceQuality.create({
        getSnapshot: () => wasmShadow ? wasmShadow.snapshot() : { neurons: [], synapses: [] },
        resetEligibility: () => wasmShadow ? wasmShadow.resetEligibility() : false,
        applyReward: (reward, rate, decay) =>
          wasmShadow ? wasmShadow.learnFromReward(rate, reward, decay) : 0
      });
    }
    wasmShadow.start().then(ok => {
      refreshWasmLearningUi(ok ? "" : "WASM недоступен: " + (wasmShadow.diagnostics().lastError || "ошибка запуска"));
      if (!ok) console.warn("NEUROGENESIS WebAssembly shadow unavailable:", wasmShadow.diagnostics().lastError);
    }).catch(error => {
      refreshWasmLearningUi("Ошибка запуска WASM: " + error.message);
      console.warn("NEUROGENESIS WebAssembly shadow startup failed:", error);
    });
  }
  function stepWasmShadow(deltaMilliseconds) {
    if (!wasmShadow || wasmShadow.diagnostics().state !== "ready") return;
    wasmShadowStepElapsed += Math.max(0, Math.min(100, deltaMilliseconds));
    if (wasmShadowStepElapsed < 100) return;
    const elapsed = wasmShadowStepElapsed;
    wasmShadowStepElapsed = 0;
    if (wasmShadow.step(elapsed / 1000) && experienceQuality) {
      const observed = experienceQuality.observeStep();
      if (observed.ok && observed.episode.steps % 5 === 0) refreshExperienceEpisodeUi();
    }
  }
  const view = { x: 0, y: 0, zoom: 1 };
  const stars = Array.from({length:window.innerWidth <= 700 ? 65 : 95},()=>({x:Math.random(),y:Math.random(),r:.35+Math.random()*1.05,alpha:.2+Math.random()*.48,phase:Math.random()*Math.PI*2,tint:Math.random()>.82?"#c3a9ff":"#91e8ef"}));
  const pointers = new Map();
  let gesture = null;
  let drag = null;

  function makeNeuron(name, type, x, y, bias = 0.5) {
    return { id: "n" + nextId++, name, type, x, y, bias, activity: 0, phase: Math.random() * Math.PI * 2 };
  }
  function seedNetwork() {
    nextId = 1;
    const layout = [
      ["Центральное ядро","core",0,0,.92],
      ["Восприятие","sensory",-205,-105,.58],
      ["Зрительный буфер","sensory",-220,95,.48],
      ["Краткая память","memory",-62,-210,.66],
      ["Ассоциации","memory",145,-185,.72],
      ["Логический узел","logic",215,-20,.78],
      ["Анализ сигнала","logic",180,170,.55],
      ["Реакция","output",-35,210,.7],
      ["Долгая память","memory",-300,225,.52],
      ["Распознавание образов","sensory",-360,-35,.62],
      ["Языковая память","memory",20,-340,.57],
      ["Прогнозирование","logic",335,180,.64],
      ["Карта тела","output",-70,355,.46]
    ];
    neurons = layout.map(([name,type,x,y,bias]) => makeNeuron(name,type,x,y,bias));
    const links = [
      [0,1,.82],[0,2,.67],[0,3,.75],[0,4,.72],[4,5,.58],[5,6,.84],
      [6,7,.71],[7,0,.9],[2,7,.48],[8,2,.52],[8,0,.36],[1,3,.46],
      [4,6,.62],[1,9,.76],[9,3,.55],[3,10,.7],[10,4,.63],
      [6,11,.68],[11,7,.58],[8,9,.42],[3,12,.49],[12,0,.44],[2,12,.38]
    ];
    synapses = links.map(([from,to,weight],i) => ({
      id:"s"+(i+1), from:"n"+(from+1), to:"n"+(to+1), weight, activity:0
    }));
    rebuildIndexes();
    selectedId = "n1";
    pulses = [];
    markDirty();
    renderInspector();
    updateMetrics();
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { seedNetwork(); fitNetwork(); return; }
      const data = JSON.parse(raw);
      if (!Array.isArray(data.neurons) || !Array.isArray(data.synapses) || data.neurons.length < 1) throw new Error("invalid save");
      neurons = data.neurons.filter(n => n && typeof n.id === "string" && Number.isFinite(n.x) && Number.isFinite(n.y) && TYPES.includes(n.type));
      const ids = new Set(neurons.map(n => n.id));
      synapses = data.synapses.filter(s => ids.has(s.from) && ids.has(s.to) && s.from !== s.to);
      rebuildIndexes();
      nextId = Math.max(1, ...neurons.map(n => Number(n.id.slice(1)) || 0)) + 1;
      selectedId = ids.has(data.selectedId) ? data.selectedId : neurons[0].id;
      renderInspector(); updateMetrics(); $("save-status").textContent = "Сохранённая сеть загружена";
      requestAnimationFrame(fitNetwork);
    } catch (error) {
      console.warn("Could not load saved network:", error);
      seedNetwork(); fitNetwork();
      showToast("Создана новая сеть: прежнее сохранение не удалось прочитать");
    }
  }

  function markDirty() {
    dirty = true;
    visualDirty = true;
    $("save-dot").classList.add("unsaved");
    $("save-status").textContent = "Есть несохранённые изменения";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 700);
    scheduleFrame();
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, neurons: neurons.map(({id,name,type,x,y,bias,activity,phase,memoryTrace,memoryKey}) => ({id,name,type,x,y,bias,activity,phase,memoryTrace:!!memoryTrace,memoryKey:memoryKey||null})),
        synapses: synapses.map(({id,from,to,weight,activity}) => ({id,from,to,weight,activity})), selectedId
      }));
      dirty = false;
      $("save-dot").classList.remove("unsaved");
      $("save-status").textContent = "Сохранено на этом устройстве";
    } catch (error) {
      console.error("Save failed:", error);
      $("save-status").textContent = "Не удалось сохранить: память браузера недоступна";
      showToast("Браузер не разрешил локальное сохранение");
    }
  }

  function showToast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function layoutTopologySignature() {
    const nodeIds = neurons.map(node => String(node.id)).sort();
    const edgeIds = synapses.map(edge => [String(edge.from), String(edge.to)])
      .sort((left, right) => (left[0] + "\u0000" + left[1]).localeCompare(right[0] + "\u0000" + right[1]));
    return JSON.stringify({ nodeIds, edgeIds });
  }
  function updateLayoutUndoButton() {
    const button = $("undo-layout-button");
    if (button) button.disabled = !layoutUndoSnapshot;
  }
  function clearLayoutUndo() {
    if (!layoutUndoSnapshot && !layoutUndoSignature) return;
    layoutUndoSnapshot = null;
    layoutUndoSignature = "";
    try { localStorage.removeItem(LAYOUT_UNDO_KEY); } catch (_) {}
    updateLayoutUndoButton();
  }
  function restoreLayoutUndo() {
    layoutUndoSnapshot = null;
    layoutUndoSignature = "";
    try {
      const raw = localStorage.getItem(LAYOUT_UNDO_KEY);
      if (!raw) { updateLayoutUndoButton(); return; }
      const saved = JSON.parse(raw), signature = layoutTopologySignature();
      if (!saved || saved.version !== 1 || saved.signature !== signature ||
          !Array.isArray(saved.positions) || saved.positions.length !== neurons.length) {
        localStorage.removeItem(LAYOUT_UNDO_KEY);
        updateLayoutUndoButton();
        return;
      }
      const valid = saved.positions.every(row => row && typeof row.id === "string" &&
        Number.isFinite(row.x) && Number.isFinite(row.y));
      const ids = new Set(saved.positions.map(row => row.id));
      if (!valid || ids.size !== neurons.length || neurons.some(node => !ids.has(String(node.id)))) {
        localStorage.removeItem(LAYOUT_UNDO_KEY);
        updateLayoutUndoButton();
        return;
      }
      layoutUndoSnapshot = saved.positions.map(row => ({ ...row }));
      layoutUndoSignature = signature;
    } catch (error) {
      console.warn("Could not restore the previous neuron layout:", error);
      try { localStorage.removeItem(LAYOUT_UNDO_KEY); } catch (_) {}
    }
    updateLayoutUndoButton();
  }
  function separateNeuronLayout() {
    const api = window.NGNeuronLayout;
    if (!api || typeof api.separate !== "function") {
      showToast("Модуль раскладки недоступен");
      return;
    }
    try {
      const result = api.separate(neurons, { minDistance: 86, iterations: 400, relaxation: 0.38, maxMove: 24 });
      if (!result.movedCount) { showToast("Перекрывающихся узлов не обнаружено"); return; }
      const signature = layoutTopologySignature();
      const previous = neurons.map(node => ({ id: String(node.id), x: node.x, y: node.y }));
      layoutUndoSnapshot = previous;
      layoutUndoSignature = signature;
      try {
        localStorage.setItem(LAYOUT_UNDO_KEY, JSON.stringify({ version: 1, signature, positions: previous }));
      } catch (error) { console.warn("Could not persist the layout undo snapshot:", error); }
      const positions = new Map(result.positions.map(row => [row.id, row]));
      for (const node of neurons) {
        const position = positions.get(String(node.id));
        if (position) { node.x = position.x; node.y = position.y; }
      }
      updateLayoutUndoButton();
      markDirty();
      fitNetwork();
      showToast("Разведено узлов: " + result.movedCount +
        " · столкновения " + result.overlapsBefore + " → " + result.overlapsAfter);
    } catch (error) {
      console.error("Neuron layout failed:", error);
      showToast("Не удалось перестроить расположение узлов");
    }
  }
  function undoNeuronLayout() {
    if (!layoutUndoSnapshot) return;
    if (layoutUndoSignature !== layoutTopologySignature()) {
      clearLayoutUndo();
      showToast("Граф изменился — отмена старой раскладки недоступна");
      return;
    }
    const positions = new Map(layoutUndoSnapshot.map(row => [row.id, row]));
    for (const node of neurons) {
      const position = positions.get(String(node.id));
      if (position) { node.x = position.x; node.y = position.y; }
    }
    clearLayoutUndo();
    markDirty();
    fitNetwork();
    showToast("Предыдущее расположение восстановлено");
  }

  function currentNeuron() { return neurons.find(n => n.id === selectedId) || null; }
  function getNeuron(id) { return neuronById.get(id); }
  function colorFor(type, alpha = 1) { const c = TYPE_COLORS[type] || TYPE_COLORS.core; return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`; }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const previousDpr = dpr;
    const maxDpr = window.innerWidth <= 700 ? 2 : 2.25;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (Math.abs(dpr - previousDpr) > 0.01) neuronSprites.clear();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const layer of [backgroundLayer, connectionLayer, nodeLayer]) {
      layer.width = canvas.width;
      layer.height = canvas.height;
    }
    backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    connectionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nodeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    backgroundDirty = true;
    connectionsDirty = true;
    nodesDirty = true;
    visualDirty = true;
    if (!view.x && !view.y) { view.x = width / 2; view.y = height / 2; }
  }
  const handleCanvasResize = () => { resize(); scheduleFrame(); };
  let canvasResizeObserver = null;
  function connectCanvasResizeObserver() {
    if (typeof ResizeObserver === "function") {
      if (canvasResizeObserver) return;
      let observer = null;
      try {
        observer = new ResizeObserver(handleCanvasResize);
        observer.observe(canvas);
        canvasResizeObserver = observer;
      } catch (error) {
        if (observer && typeof observer.disconnect === "function") {
          try { observer.disconnect(); } catch (disconnectError) {
            console.warn("Could not disconnect failed ResizeObserver:", disconnectError);
          }
        }
        canvasResizeObserver = null;
        console.warn("ResizeObserver failed; using the window-resize fallback:", error);
      }
    }
  }
  function disconnectCanvasResizeObserver() {
    const observer = canvasResizeObserver;
    canvasResizeObserver = null;
    if (!observer || typeof observer.disconnect !== "function") return;
    try { observer.disconnect(); } catch (error) {
      console.warn("Could not disconnect ResizeObserver:", error);
    }
  }
  function clearPointerState() {
    pointers.clear();
    gesture = null;
    drag = null;
  }
  function suspendRendering() {
    pageSuspended = true;
    clearPointerState();
    cancelScheduledFrame();
    lastFrame = 0;
    animationWasActive = false;
    fpsFrames = 0;
    fpsLast = 0;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = 0;
    }
    if (dirty) saveState();
  }
  function resumeRendering() {
    if (document.hidden) return;
    pageSuspended = false;
    lastFrame = 0;
    visualDirty = true;
    backgroundDirty = true;
    connectionsDirty = true;
    nodesDirty = true;
    connectCanvasResizeObserver();
    resize();
    scheduleFrame();
  }
  function handleVisibilityChange() {
    if (document.hidden) suspendRendering();
    else resumeRendering();
  }
  function handlePageHide() {
    suspendRendering();
    disconnectCanvasResizeObserver();
  }
  function handlePageShow() {
    connectCanvasResizeObserver();
    resumeRendering();
  }
  connectCanvasResizeObserver();
  window.addEventListener("resize", handleCanvasResize);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  for (const eventName of ["click","input","change","keydown","pointerdown","pointermove","pointerup","pointercancel","wheel"]) {
    document.addEventListener(eventName, scheduleFrame, {capture:true,passive:true});
  }

  function worldAt(point) { return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }; }
  function screenAt(point) { return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y }; }
  function pointerPoint(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function zoomAt(factor, px = width/2, py = height/2) {
    const before = worldAt({x:px,y:py});
    view.zoom = Math.max(.12, Math.min(5.5, view.zoom * factor));
    view.x = px - before.x * view.zoom; view.y = py - before.y * view.zoom;
    backgroundDirty = true; connectionsDirty = true; nodesDirty = true; visualDirty = true;
    $("zoom-value").textContent = Math.round(view.zoom * 100) + "%";
    scheduleFrame();
  }
  function fitNetwork() {
    if (!neurons.length) return;
    const xs = neurons.map(n => n.x), ys = neurons.map(n => n.y);
    const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 100, maxY = Math.max(...ys) + 100;
    view.zoom = Math.max(.12, Math.min(1.8, Math.min((width - 80) / Math.max(1,maxX-minX), (height - 100) / Math.max(1,maxY-minY))));
    view.x = width/2 - ((minX+maxX)/2) * view.zoom;
    view.y = height/2 - ((minY+maxY)/2) * view.zoom;
    backgroundDirty = true; connectionsDirty = true; nodesDirty = true; visualDirty = true;
    $("zoom-value").textContent = Math.round(view.zoom*100) + "%";
    scheduleFrame();
  }

  function hitTest(point) {
    let closest = null;
    let closestDistance = Infinity;
    const hitRadius = 19;
    for (const neuron of neurons) {
      const screen = screenAt(neuron);
      const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
      if (distance < closestDistance) { closestDistance = distance; closest = neuron; }
    }
    return closestDistance <= hitRadius ? closest : null;
  }
  function selectNeuron(id) {
    selectedId = id;
    nodesDirty = true;
    if(focusMode) connectionsDirty = true;
    visualDirty = true;
    renderInspector(); updateMetrics();
    scheduleFrame();
  }
  function addNeuron(x, y, type = "logic") {
    clearLayoutUndo();
    const n = makeNeuron("Новый нейрон " + nextId, type, x, y, .5);
    neurons.push(n); neuronById.set(n.id, n); nodesDirty=true; selectNeuron(n.id); showToast("Новый нейрон создан"); markDirty();
    syncWasmShadow();
    return n;
  }
  function connect(a, b) {
    if (!a || !b || a === b) return false;
    if (synapses.some(s => s.from === a && s.to === b)) { showToast("Такая связь уже существует"); return false; }
    clearLayoutUndo();
    const edge = { id: "s" + (Date.now()) + Math.floor(Math.random()*1000), from:a, to:b, weight:.65, activity:0 };
    synapses.push(edge);
    synapseByKey.set(edgeKey(a, b), edge);
    if (!outgoingById.has(a)) outgoingById.set(a, []);
    outgoingById.get(a).push(edge);
    connectionsDirty = true;
    markDirty(); updateMetrics(); showToast("Связь сформирована");
    return true;
  }
  function removeNeuron(id) {
    clearLayoutUndo();
    neurons = neurons.filter(n => n.id !== id);
    synapses = synapses.filter(s => s.from !== id && s.to !== id);
    rebuildIndexes();
    pulses = pulses.filter(p => p.from !== id && p.to !== id);
    selectedId = neurons[0]?.id || null;
    connectFrom = null; renderInspector(); updateMetrics(); markDirty();
    showToast("Нейрон удалён");
  }
  function activate(id, strength = 1) {
    const n = getNeuron(id);
    if (!n) return;
    n.activity = Math.min(1, n.activity + strength);
    if (wasmShadow) wasmShadow.stimulate(id, strength);
    activeNeuronIds.add(id);
    const outgoing = outgoingById.get(id) || [];
    let emitted = 0;
    for (const edge of outgoing) {
      if (pulses.length >= MAX_PULSES || emitted >= MAX_BRANCH_PULSES) break;
      pulses.push({ from:id, to:edge.to, progress:0, strength:strength * edge.weight });
      emitted++;
    }
    updateMetrics();
    scheduleFrame();
  }
  function stimulateRandom() {
    if (!neurons.length) return;
    const candidates = neurons.filter(n => n.type === "sensory" || n.type === "core");
    const n = candidates[Math.floor(Math.random() * candidates.length)] || neurons[0];
    activate(n.id, .95); showToast("Импульс отправлен: " + n.name);
  }
  function grow() {
    if (!neurons.length) return;
    const parent = getNeuron(selectedId) || neurons[Math.floor(Math.random()*neurons.length)];
    const angle = Math.random()*Math.PI*2, distance = 95 + Math.random()*45;
    const child = addNeuron(parent.x + Math.cos(angle)*distance, parent.y + Math.sin(angle)*distance, ["memory","logic","sensory","output"][Math.floor(Math.random()*4)]);
    connect(parent.id, child.id);
    if (Math.random() > .55) {
      const other = neurons.filter(n => n.id !== parent.id && n.id !== child.id).sort((a,b) => Math.hypot(a.x-child.x,a.y-child.y)-Math.hypot(b.x-child.x,b.y-child.y))[0];
      if (other) connect(child.id, other.id);
    }
    syncWasmShadow();
    activate(parent.id, .6); showToast("Организм сформировал новую ветвь");
  }

  function renderInspector() {
    const n = currentNeuron();
    $("empty-inspector").hidden = !!n;
    $("neuron-inspector").hidden = !n;
    $("selected-id").textContent = n ? n.id.toUpperCase() : "NO SELECTION";
    if (!n) return;
    $("neuron-name").value = n.name;
    $("neuron-type").value = n.type;
    $("neuron-bias").value = Math.round(n.bias*100);
    $("bias-value").textContent = Math.round(n.bias*100) + "%";
    $("neuron-activity").textContent = Math.round(n.activity*100) + "%";
  }
  function updateMetrics() {
    $("neuron-count").textContent = neurons.length;
    $("synapse-count").textContent = synapses.length;
    const avg = neurons.length ? neurons.reduce((sum,n)=>sum+n.activity,0)/neurons.length : 0;
    $("activity-value").textContent = Math.round(avg*100) + "%";
    $("organism-mood").textContent = avg > .5 ? "Повышенная активность" : running ? "Самостоятельная активность" : "Нестабильное равновесие";
    const n = currentNeuron();
    if (n && !$("neuron-inspector").hidden) $("neuron-activity").textContent = Math.round(n.activity*100) + "%";
  }


  function drawBackground() {
    if (!backgroundDirty) {
      ctx.drawImage(backgroundLayer, 0, 0, width, height);
      return;
    }
    backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    backgroundCtx.clearRect(0, 0, width, height);
    const base = backgroundCtx.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "#050b18");
    base.addColorStop(.52, "#071522");
    base.addColorStop(1, "#080d1c");
    backgroundCtx.fillStyle = base;
    backgroundCtx.fillRect(0, 0, width, height);

    const glow = backgroundCtx.createRadialGradient(width*.48,height*.46,4,width*.48,height*.46,Math.max(width,height)*.72);
    glow.addColorStop(0, "rgba(22,104,119,.23)");
    glow.addColorStop(.46, "rgba(27,65,104,.10)");
    glow.addColorStop(1, "rgba(3,8,18,0)");
    backgroundCtx.fillStyle = glow;
    backgroundCtx.fillRect(0, 0, width, height);

    for (const star of stars) {
      backgroundCtx.globalAlpha = star.alpha;
      backgroundCtx.fillStyle = star.tint;
      backgroundCtx.beginPath();
      backgroundCtx.arc(star.x*width, star.y*height, star.r, 0, Math.PI*2);
      backgroundCtx.fill();
    }
    backgroundCtx.globalAlpha = 1;

    backgroundCtx.save();
    backgroundCtx.translate(view.x, view.y);
    backgroundCtx.scale(view.zoom, view.zoom);
    const step=54,left=-view.x/view.zoom,top=-view.y/view.zoom;
    const right=left+width/view.zoom,bottom=top+height/view.zoom;
    backgroundCtx.fillStyle="rgba(116,192,207,.12)";
    for(let x=Math.floor(left/step)*step;x<right;x+=step){
      for(let y=Math.floor(top/step)*step;y<bottom;y+=step){
        backgroundCtx.beginPath();
        backgroundCtx.arc(x,y,.85/view.zoom,0,Math.PI*2);
        backgroundCtx.fill();
      }
    }
    backgroundCtx.setLineDash([3/view.zoom,9/view.zoom]);
    backgroundCtx.lineWidth=1/view.zoom;
    backgroundCtx.strokeStyle="rgba(91,172,185,.075)";
    for(const radius of [190,360]){
      backgroundCtx.beginPath();
      backgroundCtx.arc(0,0,radius,0,Math.PI*2);
      backgroundCtx.stroke();
    }
    backgroundCtx.setLineDash([]);
    backgroundCtx.restore();
    backgroundDirty = false;
    ctx.drawImage(backgroundLayer, 0, 0, width, height);
  }

  function drawConnections() {
    if (connectionsDirty) {
      connectionCtx.setTransform(dpr,0,0,dpr,0,0);
      connectionCtx.clearRect(0,0,width,height);
      connectionCtx.save();
      connectionCtx.translate(view.x,view.y);
      connectionCtx.scale(view.zoom,view.zoom);
      const glowPath = new Path2D(), linePath = new Path2D(), focusPath = new Path2D();
      let focusEdges = 0;
      curveByKey.clear();
      const left=-view.x/view.zoom-120, top=-view.y/view.zoom-120;
      const right=left+width/view.zoom+240, bottom=top+height/view.zoom+240;
      const denseGraph = neurons.length > 100 || synapses.length > 320;
      const overview = denseGraph && view.zoom < .62;
      const focusSnapshot = focusMode && window.NGNeuronFocus
        ? window.NGNeuronFocus.build(neurons, synapses, selectedId)
        : null;
      const focusEdgeKeys = focusSnapshot ? new Set(focusSnapshot.edgeKeys) : null;
      for(let i=0;i<synapses.length;i++){
        const edge=synapses[i],a=getNeuron(edge.from),b=getNeuron(edge.to);
        if(!a||!b) continue;
        const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1;
        const bend=Math.min(58,dist*.22)*(i%2===0?1:-1);
        const mx=(a.x+b.x)/2-(dy/dist)*bend, my=(a.y+b.y)/2+(dx/dist)*bend;
        const minX=Math.min(a.x,b.x,mx),maxX=Math.max(a.x,b.x,mx);
        const minY=Math.min(a.y,b.y,my),maxY=Math.max(a.y,b.y,my);
        if(maxX<left||minX>right||maxY<top||minY>bottom) continue;
        const key=edgeKey(edge.from,edge.to);
        curveByKey.set(key,{a,b,mx,my});
        glowPath.moveTo(a.x,a.y);glowPath.quadraticCurveTo(mx,my,b.x,b.y);
        linePath.moveTo(a.x,a.y);linePath.quadraticCurveTo(mx,my,b.x,b.y);
        const isFocusEdge = focusEdgeKeys
          ? focusEdgeKeys.has(key)
          : !!(selectedId&&(edge.from===selectedId||edge.to===selectedId));
        if(isFocusEdge){
          focusPath.moveTo(a.x,a.y);focusPath.quadraticCurveTo(mx,my,b.x,b.y);focusEdges++;
        }
      }
      connectionCtx.lineCap="round";connectionCtx.lineJoin="round";
      if(focusEdgeKeys){
        connectionCtx.strokeStyle="rgba(110,205,221,.035)";
        connectionCtx.lineWidth=.62/view.zoom;
        connectionCtx.stroke(linePath);
        if(focusEdges){
          connectionCtx.strokeStyle="rgba(48,185,190,.24)";
          connectionCtx.lineWidth=4/view.zoom;
          connectionCtx.stroke(focusPath);
          connectionCtx.strokeStyle="rgba(132,245,226,.96)";
          connectionCtx.lineWidth=1.55/view.zoom;
          connectionCtx.stroke(focusPath);
        }
      }else if(overview){
        if(synapses.length<1400){
          connectionCtx.strokeStyle="rgba(48,185,190,.035)";
          connectionCtx.lineWidth=1.8/view.zoom;connectionCtx.stroke(glowPath);
        }
        connectionCtx.strokeStyle=synapses.length>700?"rgba(110,205,221,.14)":"rgba(110,205,221,.19)";
        connectionCtx.lineWidth=.68/view.zoom;connectionCtx.stroke(linePath);
      }else{
        connectionCtx.strokeStyle="rgba(48,185,190,.105)";
        connectionCtx.lineWidth=5/view.zoom;connectionCtx.stroke(glowPath);
        connectionCtx.strokeStyle="rgba(110,205,221,.34)";
        connectionCtx.lineWidth=1.05/view.zoom;connectionCtx.stroke(linePath);
      }
      if(focusEdges){
        connectionCtx.strokeStyle="rgba(132,245,226,.9)";
        connectionCtx.lineWidth=(overview?1.15:1.45)/view.zoom;
        connectionCtx.stroke(focusPath);
      }
      connectionCtx.restore();
      connectionsDirty=false;
    }
    ctx.drawImage(connectionLayer,0,0,width,height);
    if(pulses.length){
      ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.zoom,view.zoom);
      ctx.fillStyle="rgba(210,255,248,.96)";
      for(const pulse of pulses){
        const curve=curveByKey.get(edgeKey(pulse.from,pulse.to));
        if(!curve) continue;
        const t=pulse.progress,one=1-t;
        const x=one*one*curve.a.x+2*one*t*curve.mx+t*t*curve.b.x;
        const y=one*one*curve.a.y+2*one*t*curve.my+t*t*curve.b.y;
        ctx.beginPath();ctx.arc(x,y,2.8/view.zoom,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
  }

  function getNeuronSprite(type, compact = false) {
    const cacheKey=type+(compact?":compact":":detail");
    let sprite=neuronSprites.get(cacheKey);
    if(sprite) return sprite;
    const size=compact?96:184,center=size/2,r=compact?16:19,auraRadius=compact?40:84;
    sprite=document.createElement("canvas");
    sprite.width=Math.round(size*dpr);sprite.height=Math.round(size*dpr);
    const c=sprite.getContext("2d");c.setTransform(dpr,0,0,dpr,0,0);
    const aura=c.createRadialGradient(center,center,2,center,center,auraRadius);
    aura.addColorStop(0,colorFor(type,compact?.17:.24));
    aura.addColorStop(.38,colorFor(type,compact?.045:.075));
    aura.addColorStop(1,colorFor(type,0));
    c.fillStyle=aura;c.beginPath();c.arc(center,center,auraRadius,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(center,center,r+(compact?5:12),0,Math.PI*2);
    c.strokeStyle=colorFor(type,compact?.13:.19);c.lineWidth=compact?1:1.3;c.stroke();
    c.beginPath();c.ellipse(center,center,r+(compact?3:8),r+(compact?6:13),0,Math.PI*.13,Math.PI*1.72);
    c.strokeStyle=colorFor(type,compact?.24:.36);c.lineWidth=compact?.9:1.15;c.stroke();
    c.beginPath();c.arc(center,center,r+(compact?1:3),0,Math.PI*2);
    c.strokeStyle=colorFor(type,compact?.55:.63);c.lineWidth=compact?1.15:1.4;c.stroke();
    c.beginPath();c.arc(center,center,r,0,Math.PI*2);
    const core=c.createRadialGradient(center-r*.36,center-r*.42,1,center,center,r);
    core.addColorStop(0,"rgba(239,255,255,.98)");
    core.addColorStop(.12,colorFor(type,1));core.addColorStop(.43,colorFor(type,.78));
    core.addColorStop(.76,"rgba(14,40,58,.98)");core.addColorStop(1,"rgba(3,12,25,1)");
    c.fillStyle=core;c.fill();c.strokeStyle=colorFor(type,.95);c.lineWidth=compact?1.05:1.25;c.stroke();
    c.fillStyle="rgba(242,255,251,.98)";c.beginPath();c.arc(center,center,compact?3.5:4.2,0,Math.PI*2);c.fill();
    if(!compact) for(let k=0;k<3;k++){
      const angle=k*Math.PI*2/3;
      c.beginPath();c.arc(center+Math.cos(angle)*(r+4),center+Math.sin(angle)*(r+4),1.55,0,Math.PI*2);
      c.fillStyle="rgba(230,255,250,.88)";c.fill();
    }
    neuronSprites.set(cacheKey,sprite);return sprite;
  }

  function drawNeurons() {
    if(nodesDirty){
      nodeCtx.setTransform(dpr,0,0,dpr,0,0);nodeCtx.clearRect(0,0,width,height);
      const left=-view.x/view.zoom-100,top=-view.y/view.zoom-100;
      const right=left+width/view.zoom+200,bottom=top+height/view.zoom+200;
      const compactView=view.zoom<.42||((neurons.length>100||synapses.length>320)&&view.zoom<.68);
      const focusSnapshot = focusMode && window.NGNeuronFocus
        ? window.NGNeuronFocus.build(neurons, synapses, selectedId)
        : null;
      const focusNodeIds = focusSnapshot ? new Set(focusSnapshot.nodeIds) : null;
      const spriteSize=compactView?96:184,spriteOffset=spriteSize/2;
      nodeCtx.save();nodeCtx.translate(view.x,view.y);nodeCtx.scale(view.zoom,view.zoom);
      for(const neuron of neurons){
        if(neuron.x<left||neuron.x>right||neuron.y<top||neuron.y>bottom) continue;
        const searching=!!searchTerm&&neuron.name.toLowerCase().includes(searchTerm);
        const searchAlpha=(searchTerm&&!searching)?.16:1;
        const focusAlpha=(focusNodeIds&&!focusNodeIds.has(neuron.id))?.13:1;
        nodeCtx.globalAlpha=searchAlpha*focusAlpha;
        nodeCtx.drawImage(getNeuronSprite(neuron.type,compactView),
          neuron.x-spriteOffset,neuron.y-spriteOffset,spriteSize,spriteSize);
        if(focusNodeIds&&focusNodeIds.has(neuron.id)&&neuron.id!==selectedId){
          nodeCtx.beginPath();nodeCtx.arc(neuron.x,neuron.y,compactView?23:31,0,Math.PI*2);
          nodeCtx.strokeStyle="rgba(122,226,218,.5)";
          nodeCtx.lineWidth=1.2/view.zoom;nodeCtx.stroke();
        }
        if(neuron.id===selectedId||connectFrom===neuron.id){
          nodeCtx.beginPath();nodeCtx.arc(neuron.x,neuron.y,compactView?29:41,0,Math.PI*2);
          nodeCtx.strokeStyle=connectFrom===neuron.id?"rgba(255,207,126,.95)":"rgba(230,255,249,.92)";
          nodeCtx.lineWidth=1.6/view.zoom;nodeCtx.setLineDash([3/view.zoom,5/view.zoom]);
          nodeCtx.stroke();nodeCtx.setLineDash([]);
        }
      }
      nodeCtx.restore();
      if(view.zoom>.22||selectedId||searchTerm){
        const crowded=neurons.length>60;
        const labelTargets=focusNodeIds
          ?neurons.filter(neuron=>focusNodeIds.has(neuron.id)).slice(0,32)
          :(crowded||view.zoom<=.38)
            ?neurons.filter(neuron=>neuron.id===selectedId||
              (searchTerm&&neuron.name.toLowerCase().includes(searchTerm))||
              connectFrom===neuron.id).slice(0,32)
            :neurons.slice(0,80);
        const occupied=[];nodeCtx.font="10px Inter,system-ui,sans-serif";
        for(const neuron of labelTargets){
          const point=screenAt(neuron);
          if(point.x < -180||point.x>width+180||point.y < -55||point.y>height+70) continue;
          const label=neuron.name,w=Math.min(168,Math.max(108,nodeCtx.measureText(label).width+20));
          const x=Math.max(7,Math.min(width-w-7,point.x-w/2));
          const candidates=[point.y+Math.max(27,26*view.zoom),point.y-Math.max(31,27*view.zoom)-21,point.y+Math.max(48,43*view.zoom)];
          let y=candidates[0];
          for(const candidate of candidates){
            const clear=occupied.every(box=>x+w<box.x-5||x>box.x+box.w+5||
              candidate+21<box.y-4||candidate>box.y+box.h+4);
            if(clear){y=candidate;break;}
          }
          occupied.push({x,y,w,h:21});
          nodeCtx.fillStyle=neuron.id===selectedId?"rgba(14,50,59,.96)":"rgba(5,17,29,.88)";
          roundRect(nodeCtx,x,y,w,21,8);nodeCtx.fill();
          nodeCtx.strokeStyle=neuron.id===selectedId?"rgba(114,245,222,.72)":"rgba(113,187,202,.2)";
          nodeCtx.lineWidth=1;nodeCtx.stroke();
          nodeCtx.fillStyle=neuron.id===selectedId?"#e7fff9":"#abc8d1";
          nodeCtx.textAlign="center";nodeCtx.textBaseline="middle";
          nodeCtx.fillText(label,x+w/2,y+10.5,w-14);
        }
      }
      nodesDirty=false;
    }
    ctx.drawImage(nodeLayer,0,0,width,height);
    if(activeNeuronIds.size){
      ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.zoom,view.zoom);
      for(const id of activeNeuronIds){
        const neuron=neuronById.get(id);
        if(!neuron||neuron.activity<=.04) continue;
        ctx.beginPath();ctx.arc(neuron.x,neuron.y,25+neuron.activity*8,0,Math.PI*2);
        ctx.fillStyle="rgba(112,255,224,"+(neuron.activity*.13)+")";ctx.fill();
      }
      ctx.restore();
    }
  }

  function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function frame(time) {
    frameScheduled = false;
    frameHandle = null;
    if (pageSuspended || document.hidden) {
      pageSuspended = true;
      return;
    }
    const dt=Math.min(50,time-lastFrame||16);lastFrame=time;
    stepWasmShadow(dt);
    if(running && time-lastStimulus>1850){const n=neurons[Math.floor(Math.random()*neurons.length)];if(n)activate(n.id,.35);lastStimulus=time;}
    for(const id of activeNeuronIds){
      const n=neuronById.get(id);
      if(!n){activeNeuronIds.delete(id);continue;}
      n.activity=Math.max(0,n.activity-dt*.00048);
      if(n.activity<=.04){activeNeuronIds.delete(id);visualDirty=true;}
    }
    for(let i=pulses.length-1;i>=0;i--){
      const p=pulses[i];
      p.progress+=dt/720;
      if(p.progress>=1){
        const target=neuronById.get(p.to);
        if(target){target.activity=Math.min(1,target.activity+p.strength*.7);activeNeuronIds.add(target.id);}
        pulses.splice(i,1);
      }
    }
    const animationActive=running||pulses.length>0||activeNeuronIds.size>0;
    if(visualDirty||animationActive){
      drawBackground();drawConnections();drawNeurons();
      visualDirty=false;
    }
    if(animationActive){
      if(!animationWasActive){fpsFrames=0;fpsLast=time;}
      animationWasActive=true;
      fpsFrames++;
      if(time-fpsLast>=500){
        const fps=Math.round(fpsFrames*1000/(time-fpsLast));
        const fpsEl=$("fps-value");
        if(fpsEl){fpsEl.textContent=fps+" FPS";fpsEl.dataset.level=fps>=55?"good":fps>=40?"mid":"low";}
        fpsFrames=0;fpsLast=time;
      }
      scheduleFrame();
    }else{
      animationWasActive=false;fpsFrames=0;fpsLast=0;
      const fpsEl=$("fps-value");
      if(fpsEl){fpsEl.textContent="— FPS";fpsEl.dataset.level="idle";}
    }
    if((animationActive||visualDirty)&&time-lastMetricsUpdate>250){updateMetrics();lastMetricsUpdate=time;}
  }

  canvas.addEventListener("pointerdown", event => {
    event.preventDefault();canvas.setPointerCapture(event.pointerId);
    const point=pointerPoint(event);pointers.set(event.pointerId,point);
    if(pointers.size===2){
      const pts=[...pointers.values()];gesture={distance:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),zoom:view.zoom,mid:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2},world:worldAt({x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2})};drag=null;return;
    }
    if(connectMode){
      const hit=hitTest(point);
      if(hit){
        if(!connectFrom){connectFrom=hit.id;selectNeuron(hit.id);$("mode-note").textContent="Теперь нажми на второй нейрон.";}
        else if(connectFrom===hit.id){connectFrom=null;$("mode-note").textContent="Выбери первый нейрон для связи.";}
        else {if(connect(connectFrom,hit.id))syncWasmShadow();connectFrom=null;setConnectMode(false);}
      }
      return;
    }
    const hit=hitTest(point);
    if(hit){selectNeuron(hit.id);drag={kind:"node",id:hit.id,last:worldAt(point)};}
    else {drag={kind:"pan",last:point};}
  });
  canvas.addEventListener("pointermove", event => {
    if(!pointers.has(event.pointerId))return;
    const point=pointerPoint(event);pointers.set(event.pointerId,point);
    if(pointers.size>=2 && gesture){
      const pts=[...pointers.values()].slice(0,2);
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      view.zoom=Math.max(.12,Math.min(5.5,gesture.zoom*(dist/Math.max(1,gesture.distance))));
      view.x=mid.x-gesture.world.x*view.zoom;view.y=mid.y-gesture.world.y*view.zoom;
      backgroundDirty=true;connectionsDirty=true;nodesDirty=true;visualDirty=true;
      $("zoom-value").textContent=Math.round(view.zoom*100)+"%";return;
    }
    if(!drag)return;
    if(drag.kind==="node"){
      const n=getNeuron(drag.id);if(!n)return;
      clearLayoutUndo();
      const w=worldAt(point);n.x+=w.x-drag.last.x;n.y+=w.y-drag.last.y;drag.last=w;connectionsDirty=true;nodesDirty=true;visualDirty=true;markDirty();
    }else if(drag.kind==="pan"){
      view.x+=point.x-drag.last.x;view.y+=point.y-drag.last.y;drag.last=point;backgroundDirty=true;connectionsDirty=true;nodesDirty=true;visualDirty=true;
    }
  });
  function endPointer(event){
    pointers.delete(event.pointerId);
    if(pointers.size<2)gesture=null;
    if(pointers.size===0){
      if(drag&&drag.kind==="node")syncWasmShadow();
      drag=null;
    }
  }
  canvas.addEventListener("pointerup",endPointer);
  canvas.addEventListener("pointercancel",endPointer);
  canvas.addEventListener("lostpointercapture",endPointer);
  canvas.addEventListener("wheel",event=>{event.preventDefault();const p=pointerPoint(event);zoomAt(event.deltaY<0?1.14:1/1.14,p.x,p.y);},{passive:false});
  canvas.addEventListener("dblclick",event=>{const p=pointerPoint(event),w=worldAt(p);addNeuron(w.x,w.y);});

  function setConnectMode(force) {
    connectMode=typeof force==="boolean"?force:!connectMode;
    if(!connectMode)connectFrom=null;
    nodesDirty=true;visualDirty=true;
    $("connect-button").classList.toggle("active",connectMode);
    $("mode-note").textContent=connectMode?"Выбери два нейрона по очереди.":"Выбери нейрон, чтобы изучить его состояние.";
    if(connectMode)showToast("Режим связей: выбери первый нейрон");
  }
  $("stimulate-button").addEventListener("click",stimulateRandom);
  $("add-button").addEventListener("click",()=>{const p=worldAt({x:width/2,y:height/2});addNeuron(p.x+(Math.random()-.5)*80,p.y+(Math.random()-.5)*80);});
  $("connect-button").addEventListener("click",()=>setConnectMode());
  $("grow-button").addEventListener("click",grow);
  $("wasm-learning-rate").addEventListener("input",event=>{
    $("wasm-learning-rate-value").textContent=Math.round(Number(event.target.value)*100)+"%";
  });
  $("wasm-learning-decay").addEventListener("input",event=>{
    $("wasm-learning-decay-value").textContent=(Number(event.target.value)*100).toFixed(1)+"%";
  });
  $("wasm-learn-button").addEventListener("click",()=>{
    if(!wasmShadow||wasmShadow.diagnostics().state!=="ready"){
      refreshWasmLearningUi("Теневой WASM ещё не готов. Основная симуляция продолжает работать.");
      return;
    }
    const changed=wasmShadow.learn(
      Number($("wasm-learning-rate").value),
      Number($("wasm-learning-reward").value),
      Number($("wasm-learning-decay").value)
    );
    refreshWasmLearningUi(changed
      ? "Обучение применено. Изменено синапсов: "+changed+". Основная сеть не затронута."
      : "Веса не изменились. Сначала подай импульс или запусти симуляцию.");
  });

  $("wasm-episode-begin-button").addEventListener("click",()=>{
    if(!experienceQuality){
      refreshWasmLearningUi("Менеджер эпизодов недоступен.");
      return;
    }
    const result=experienceQuality.beginEpisode("ручной эпизод");
    if(!result.ok){
      refreshExperienceEpisodeUi(result.code==="episode-already-open"
        ? "Эпизод уже открыт. Заверши его оценкой или сбрось перед началом нового."
        : "Не удалось начать эпизод: "+result.code+".");
      return;
    }
    refreshExperienceEpisodeUi("Эпизод начат. Следы старых эпизодов очищены; теперь запусти симуляцию.");
  });

  $("wasm-episode-cancel-button").addEventListener("click",()=>{
    if(!experienceQuality)return;
    const result=experienceQuality.cancel("сброшен пользователем");
    refreshExperienceEpisodeUi(result.ok
      ? "Эпизод сброшен без подкрепления. Веса не изменялись."
      : "Нет открытого эпизода для сброса.");
  });

  $("wasm-experience-benchmark-button").addEventListener("click",async()=>{
    const button=$("wasm-experience-benchmark-button");
    const reportElement=$("wasm-experience-benchmark-report");
    if(!window.NGExperienceBenchmark||typeof window.NGExperienceBenchmark.run!=="function"){
      if(reportElement)reportElement.textContent="Модуль контрольного теста недоступен.";
      return;
    }
    experienceBenchmarkRunning=true;
    const originalLabel=button.textContent;
    button.disabled=true;
    button.textContent="Проверка…";
    if(reportElement)reportElement.textContent="Проверяю эффект подкрепления, сохранение двух ассоциаций и перекрёстное обучение в плотной сети.";
    try{
      const report=await window.NGExperienceBenchmark.run();
      const contrastive=window.NGContrastiveBenchmark
        ? await window.NGContrastiveBenchmark.run()
        : {passed:false,aThenB:null,bThenA:null};
      const passedChecks=Object.values(report.checks).filter(Boolean).length;
      const contrastiveChecks=contrastive.aThenB
        ? Object.values(contrastive.aThenB.checks).filter(Boolean).length+
          Object.values(contrastive.bThenA.checks).filter(Boolean).length+
          Object.values(contrastive.checks).filter(Boolean).length
        : 0;
      const p=report.positive,n=report.negative,z=report.neutral;
      const ab=report.multiPattern.orders.AB;
      const ba=report.multiPattern.orders.BA;
      const dense=report.sharedPathInterference.orders.AB;
      if(reportElement){
        reportElement.textContent=(report.passed&&contrastive.passed?"БАЗОВЫЕ И КОНТРАСТНЫЕ ТЕСТЫ ПРОЙДЕНЫ":"ЕСТЬ НЕПРОЙДЕННЫЕ ПРОВЕРКИ")+
          " · базовых проверок "+passedChecks+"/"+Object.keys(report.checks).length+
          ", контрастных "+contrastiveChecks+
          ". Одиночная связь: до "+p.responseBefore.toFixed(4)+
          ", после +reward "+p.responseAfter.toFixed(4)+
          ", после −reward "+n.responseAfter.toFixed(4)+
          ", после нейтральной оценки "+z.responseAfter.toFixed(4)+
          ". Две отдельные ассоциации A→X и B→Y: A-B — "+
          ab.patterns.A.responseAfter.toFixed(3)+" / "+ab.patterns.B.responseAfter.toFixed(3)+
          ", B-A — "+ba.patterns.A.responseAfter.toFixed(3)+" / "+
          ba.patterns.B.responseAfter.toFixed(3)+
          ". Диагностика плотной сети обнаружила побочное обучение: вес A→Y изменился на "+
          dense.patterns.A.crossWeightDelta.toFixed(3)+
          ", конкурирующий выход Y на вход A отвечает "+dense.patterns.A.incorrectResponseAfter.toFixed(3)+
          ". Это выявленная граница старого правила. Контрастное обучение: "+
          (contrastive.passed?"пройдено":"НЕ ПРОЙДЕНО")+
          (contrastive.aThenB
            ? "; порядок AB, отрыв A="+contrastive.aThenB.after.A.margin.toFixed(3)+
              ", B="+contrastive.aThenB.after.B.margin.toFixed(3)
            : "")+
          ". Оно меняет только связи текущего входа; основная JS-сеть не изменяется.";
      }
    }catch(error){
      if(reportElement)reportElement.textContent="Контрольный тест завершился ошибкой: "+error.message;
    }finally{
      experienceBenchmarkRunning=false;
      button.textContent=originalLabel;
      refreshExperienceEpisodeUi();
    }
  });

  $("wasm-sequence-learn-button").addEventListener("click",()=>{
    if(!wasmShadow||wasmShadow.diagnostics().state!=="ready"||!experienceQuality){
      refreshWasmLearningUi("Теневой WASM или менеджер эпизодов ещё не готов.");
      return;
    }
    const result=experienceQuality.evaluate(
      Number($("wasm-learning-reward").value),
      Number($("wasm-learning-rate").value),
      Number($("wasm-learning-decay").value)
    );
    if(!result.ok){
      const messages={
        "no-open-episode":"Сначала начни эпизод. Без открытого эпизода оценка не применяется.",
        "empty-episode":"В эпизоде не было шагов симуляции. Награда и затухание не применялись.",
        "no-eligible-traces":"Не осталось подходящих следов. Награда и затухание весов не применялись.",
        "parameters-out-of-range":"Параметры оценки вне допустимого диапазона."
      };
      refreshExperienceEpisodeUi(messages[result.code]||("Не удалось оценить эпизод: "+(result.error||result.code)+"."));
      return;
    }
    const report=result.report;
    const diagnostics=wasmShadow.diagnostics();
    refreshWasmLearningUi(
      "Эпизод "+report.id+" оценён: шагов "+report.steps+
      ", следов "+report.eligibleSynapsesBeforeReward+
      ", изменено связей "+report.changedSynapses+
      " (с eligibility "+report.changedEligibleSynapses+
      ", без eligibility "+report.changedNonEligibleSynapses+
      "), среднее |Δ веса| "+report.meanAbsoluteWeightDelta.toFixed(5)+
      ". Подкреплений всего: "+diagnostics.sequenceRewards+
      ". Основная JS-сеть не затронута."
    );
  });
  $("wasm-learning-export").addEventListener("click",()=>{
    if(!wasmShadow||wasmShadow.diagnostics().state!=="ready"){
      refreshWasmLearningUi("Нельзя экспортировать: теневой WASM ещё не готов.");
      return;
    }
    try{
      const payload={
        format:"NEUROGENESIS_WASM_LEARNED_WEIGHTS",
        version:1,
        release:"0.58.34",
        weights:wasmShadow.learnedWeights()
      };
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;
      link.download="neurogenesis-learned-weights.json";
      link.style.display="none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1500);
      refreshWasmLearningUi("Экспортировано обученных связей: "+payload.weights.length+".");
    }catch(error){
      refreshWasmLearningUi("Не удалось экспортировать веса: "+error.message);
    }
  });
  $("wasm-learning-import").addEventListener("click",()=>$("wasm-learning-file").click());
  $("wasm-learning-file").addEventListener("change",async event=>{
    const file=event.target.files&&event.target.files[0];
    if(!file)return;
    try{
      const raw=typeof file.text==="function"
        ? await file.text()
        : await new Promise((resolve,reject)=>{
            const reader=new FileReader();
            reader.onload=()=>resolve(String(reader.result||""));
            reader.onerror=()=>reject(reader.error||new Error("File read failed"));
            reader.readAsText(file);
          });
      const payload=JSON.parse(raw);
      if(!payload||payload.format!=="NEUROGENESIS_WASM_LEARNED_WEIGHTS"||
         payload.version!==1||!Array.isArray(payload.weights)){
        throw new Error("Формат файла обученных весов не распознан");
      }
      if(!wasmShadow||!wasmShadow.restoreLearnedWeights(payload.weights)){
        throw new Error("Не удалось восстановить обученные веса");
      }
      refreshWasmLearningUi("Совпавших связей восстановлено: "+wasmShadow.learnedWeights().length+
        " из "+payload.weights.length+".");
    }catch(error){
      refreshWasmLearningUi("Импорт не выполнен: "+error.message);
    }finally{
      event.target.value="";
    }
  });
  $("run-button").addEventListener("click",()=>{
    running=!running;$("run-button").classList.toggle("active",running);
    $("run-button").innerHTML=running?"<span>Ⅱ</span>Пауза":"<span>▶</span>Запуск";
    $("run-label").textContent=running?"СИМУЛЯЦИЯ":"ОЖИДАНИЕ";
    $("system-status").textContent=running?"НЕЙРОСЕТЬ АКТИВНА":"СИСТЕМА ГОТОВА";
  });
  $("zoom-in").addEventListener("click",()=>zoomAt(1.25));
  $("zoom-out").addEventListener("click",()=>zoomAt(.8));
  $("fit-button").addEventListener("click",fitNetwork);
  $("center-button").addEventListener("click",fitNetwork);
  $("layout-button").addEventListener("click",separateNeuronLayout);
  $("undo-layout-button").addEventListener("click",undoNeuronLayout);
  $("focus-button").addEventListener("click",()=>{
    if(!selectedId){showToast("Сначала выбери нейрон");return;}
    focusMode=!focusMode;
    const button=$("focus-button");
    button.setAttribute("aria-pressed",String(focusMode));
    button.title=focusMode?"Показать всю сеть":"Показать связи выбранного нейрона";
    button.setAttribute("aria-label",focusMode?"Показать всю сеть":"Показать связи выбранного нейрона");
    connectionsDirty=true;nodesDirty=true;visualDirty=true;
    showToast(focusMode?"Фокус: выбранный нейрон и его соседи":"Показана вся сеть");
    scheduleFrame();
  });
  $("save-button").addEventListener("click",()=>{saveState();showToast("Сеть сохранена на этом устройстве");});
  $("delete-button").addEventListener("click",()=>{if(selectedId&&confirm("Удалить выбранный нейрон и все его связи?"))removeNeuron(selectedId);});
  $("neuron-name").addEventListener("change",event=>{const n=currentNeuron();if(n){n.name=event.target.value.trim()||"Безымянный нейрон";event.target.value=n.name;nodesDirty=true;markDirty();syncWasmShadow();}});
  $("neuron-type").addEventListener("change",event=>{const n=currentNeuron();if(n){n.type=event.target.value;nodesDirty=true;markDirty();syncWasmShadow();}});
  $("neuron-bias").addEventListener("input",event=>{const n=currentNeuron();if(n){n.bias=Number(event.target.value)/100;$("bias-value").textContent=event.target.value+"%";markDirty();}});
  $("neuron-bias").addEventListener("change",()=>syncWasmShadow());
  $("search-input").addEventListener("input",event=>{searchTerm=event.target.value.trim().toLowerCase();nodesDirty=true;visualDirty=true;const found=neurons.find(n=>n.name.toLowerCase().includes(searchTerm));if(searchTerm&&found){selectNeuron(found.id);const p=screenAt(found);zoomAt(1.1,p.x,p.y);}});
  document.addEventListener("keydown",event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();saveState();}
    if((event.key==="Delete"||event.key==="Backspace")&&!["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName)&&selectedId){removeNeuron(selectedId);}
    if(event.key==="Escape")setConnectMode(false);
  });
  window.addEventListener("beforeunload",()=>{if(dirty)saveState();});

  window.NGBrain = {
    createMemoryTrace(key, displayName) {
      const cleanKey = String(key || "общее").slice(0, 34);
      const cleanName = String(displayName || cleanKey).replace(/\s+/g, " ").trim().slice(0, 42);
      const existing = neurons.find(n => n.memoryTrace && n.memoryKey === cleanKey);
      if (existing) return existing.id;
      const traces = neurons.filter(n => n.memoryTrace);
      const anchor = neurons.find(n => n.name === "Долгая память") || neurons.find(n => n.type === "memory") || neurons[0];
      if (!anchor) return null;
      if (traces.length >= 64) return null;
      const index = traces.length;
      const angle = index * 2.399963229728653;
      const radius = 112 + Math.floor(index / 12) * 46;
      const trace = makeNeuron("Энграмма · " + cleanName, "memory",
        anchor.x + Math.cos(angle) * radius,
        anchor.y + Math.sin(angle) * radius, .62);
      trace.memoryTrace = true;
      trace.memoryKey = cleanKey;
      neurons.push(trace);
      neuronById.set(trace.id, trace);
      connect(anchor.id, trace.id);
      connect(trace.id, anchor.id);
      syncWasmShadow();
      connectionsDirty = true;
      nodesDirty = true;
      markDirty();
      return trace.id;
    },
    associateMemoryTraces(ids) {
      const unique = [...new Set((ids || []).filter(id => neuronById.has(id)))].slice(0, 8);
      let changed = false;
      const pairs = window.NGActivation && typeof window.NGActivation.bidirectionalPairs === "function"
        ? window.NGActivation.bidirectionalPairs(unique, 8)
        : unique.flatMap((from, index) => unique.slice(index + 1).flatMap(to => [[from, to], [to, from]]));
      for (const [from, to] of pairs) {
        const edge = synapseByKey.get(edgeKey(from, to));
        if (edge) {
          const previous = edge.weight;
          edge.weight = Math.min(1, edge.weight + .025);
          changed = changed || edge.weight !== previous;
        } else if (synapses.length < 1200) {
          connect(from, to);
          changed = true;
        }
      }
      if (changed) { connectionsDirty = true; markDirty(); syncWasmShadow(); }
    },
    hasNeuron(id) { return neuronById.has(id); },
    hasMemoryTrace(id, key) {
      const neuron = neuronById.get(id);
      const expectedKey = key == null ? null : String(key).slice(0, 34);
      return !!(neuron && neuron.memoryTrace === true && (expectedKey == null || neuron.memoryKey === expectedKey));
    },
    removeMemoryTraces(ids) {
      const doomed = new Set([...new Set((ids || []).filter(id => {
        const neuron = neuronById.get(id);
        return neuron && neuron.memoryTrace === true;
      }))]);
      if (!doomed.size) return 0;
      neurons = neurons.filter(neuron => !doomed.has(neuron.id));
      synapses = synapses.filter(edge => !doomed.has(edge.from) && !doomed.has(edge.to));
      pulses = pulses.filter(pulse => !doomed.has(pulse.from) && !doomed.has(pulse.to));
      for (const id of doomed) activeNeuronIds.delete(id);
      rebuildIndexes();
      if (doomed.has(selectedId)) selectedId = neurons[0]?.id || null;
      if (doomed.has(connectFrom)) connectFrom = null;
      renderInspector();
      updateMetrics();
      markDirty();
      visualDirty = true;
      return doomed.size;
    },
    activateMemoryTraces(ids) {
      const unique = [...new Set((ids || []).filter(id => {
        const neuron = neuronById.get(id);
        return neuron && neuron.memoryTrace === true;
      }))].slice(0, 8);
      const associationEdges = synapses
        .filter(edge => {
          const from = neuronById.get(edge.from), to = neuronById.get(edge.to);
          return from && to && from.memoryTrace === true && to.memoryTrace === true;
        })
        .map(edge => ({ from: edge.from, to: edge.to, weight: edge.weight }));
      const spread = window.NGActivation && typeof window.NGActivation.spread === "function"
        ? window.NGActivation.spread(unique, associationEdges, {
            maxDepth: 2, maxNodes: 18, decay: .62, threshold: .12
          })
        : unique.map(id => ({ id, strength: .72 }));
      for (const item of spread) activate(item.id, item.strength);
      const anchor = neurons.find(n => n.name === "Долгая память");
      if (anchor) activate(anchor.id, .35);
      visualDirty = true;
      scheduleFrame();
      return spread.length;
    },
    wasmLearn(learningRate = 0.05, reward = 1, weightDecay = 0) {
      return wasmShadow ? wasmShadow.learn(learningRate, reward, weightDecay) : 0;
    },
    wasmLearnSequence(learningRate = 0.05, reward = 1, weightDecay = 0) {
      return wasmShadow ? wasmShadow.learnFromReward(learningRate, reward, weightDecay) : 0;
    },
    wasmLearnContrastiveReward(learningRate, inputNeuronId, positiveNeuronId, negativeNeuronId) {
      return wasmShadow
        ? wasmShadow.learnContrastiveReward(
            learningRate, inputNeuronId, positiveNeuronId, negativeNeuronId)
        : 0;
    },
    wasmResetSequence() {
      return wasmShadow ? wasmShadow.resetEligibility() : false;
    },
    wasmExperienceBegin(label = "") {
      return experienceQuality ? experienceQuality.beginEpisode(label) : { ok: false, code: "unavailable" };
    },
    wasmExperienceObserve() {
      return experienceQuality ? experienceQuality.observeStep() : { ok: false, code: "unavailable" };
    },
    wasmExperienceEvaluate(reward, learningRate = 0.05, weightDecay = 0) {
      return experienceQuality ? experienceQuality.evaluate(reward, learningRate, weightDecay) : { ok: false, code: "unavailable" };
    },
    wasmExperienceCancel(reason) {
      return experienceQuality ? experienceQuality.cancel(reason) : { ok: false, code: "unavailable" };
    },
    wasmExperienceStatus() {
      return experienceQuality ? experienceQuality.status() : { state: "unavailable", current: null, latestReport: null, historyCount: 0 };
    },
    wasmExperienceHistory() {
      return experienceQuality ? experienceQuality.history() : [];
    },
    wasmRunExperienceBenchmark() {
      return window.NGExperienceBenchmark
        ? window.NGExperienceBenchmark.run()
        : Promise.resolve({ passed: false, error: "benchmark-unavailable" });
    },
    wasmSnapshot() {
      return wasmShadow ? wasmShadow.snapshot() : { neurons: [], synapses: [] };
    },
    wasmSourceSnapshot() {
      return wasmShadowSnapshot();
    },
    wasmCreateDisposableExperiment(options = {}) {
      return wasmShadow ? wasmShadow.createExperiment(options) : null;
    },
    wasmLearningExport() {
      return wasmShadow ? wasmShadow.learnedWeights() : [];
    },
    wasmLearningImport(rows) {
      return wasmShadow ? wasmShadow.restoreLearnedWeights(rows) : false;
    },
    wasmDiagnostics() {
      return wasmShadow ? wasmShadow.diagnostics() : {
        backend: "wasm-shadow", authority: "javascript",
        state: window.NGWasm ? "not-started" : "unavailable",
        neurons: 0, synapses: 0, steps: 0, stimulations: 0, rebuilds: 0,
        learningUpdates: 0, sequenceRewards: 0, learnedSynapses: 0,
        lastError: null
      };
    }
  };

  resize();
  loadState();
  restoreLayoutUndo();
  if(!neurons.length){seedNetwork();fitNetwork();}
  startWasmShadow();
  requestAnimationFrame(()=>{if(neurons.length)fitNetwork();});
  scheduleFrame();
})();