(() => {
  "use strict";
  const side = document.querySelector(".side-panel");
  if (!side || side.dataset.navigationReady === "true") return;

  const find = selector => side.querySelector(selector);
  const contextual = find("#contextual-model-panel");
  const llmSettings = find("#llm-settings");
  const wasmLearning = find("#wasm-learning-panel");

  const nav = document.createElement("nav");
  nav.className = "side-tabs";
  nav.setAttribute("aria-label", "Разделы NEUROGENESIS");
  nav.setAttribute("role", "tablist");

  const pagesRoot = document.createElement("div");
  pagesRoot.className = "side-tab-pages";

  const definitions = [
    { id: "overview", label: "Обзор", icon: "◉", selectors: ["#first-experiment", ".organism-block", ".inspector-block", ".search-block"] },
    { id: "network", label: "Сеть", icon: "⟷", selectors: [".controls-block"] },
    { id: "memory", label: "Память", icon: "▤", selectors: [".memory-block"] },
    { id: "learning", label: "Обучение", icon: "✳", selectors: [] },
    { id: "settings", label: "Связь", icon: "⌁", selectors: [] }
  ];

  const pages = new Map();
  const buttons = new Map();
  for (const definition of definitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "side-tab";
    button.id = "side-tab-" + definition.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "side-page-" + definition.id);
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    button.innerHTML = '<span class="side-tab-icon" aria-hidden="true">' + definition.icon + '</span><span>' + definition.label + '</span>';
    nav.appendChild(button);
    buttons.set(definition.id, button);

    const page = document.createElement("div");
    page.className = "side-tab-page";
    page.id = "side-page-" + definition.id;
    page.setAttribute("role", "tabpanel");
    page.setAttribute("aria-labelledby", button.id);
    page.hidden = true;
    pagesRoot.appendChild(page);
    pages.set(definition.id, page);
  }

  const originalChildren = Array.from(side.children);
  for (const node of originalChildren) {
    let target = "overview";
    if (node.matches(".controls-block")) target = "network";
    else if (node.matches(".memory-block")) target = "memory";
    else if (node.matches(".organism-block, .inspector-block, .search-block, #first-experiment")) target = "overview";
    else continue;
    pages.get(target).appendChild(node);
  }

  const learningPage = pages.get("learning");
  const learningIntro = document.createElement("p");
  learningIntro.className = "side-tab-intro";
  learningIntro.textContent = "Здесь два разных механизма. Контекстная модель учится работать со словами и фразами. Экспериментальная пластичность меняет веса отдельной копии нейросети. Ни один из режимов сам по себе не создаёт новые нейроны.";
  learningPage.appendChild(learningIntro);
  if (contextual) learningPage.appendChild(contextual);
  if (wasmLearning) learningPage.appendChild(wasmLearning);

  const settingsPage = pages.get("settings");
  const settingsIntro = document.createElement("p");
  settingsIntro.className = "side-tab-intro";
  settingsIntro.textContent = "Подключение внешнего языкового сервиса. Для обычной локальной памяти и контекстного обучения этот раздел не нужен.";
  settingsPage.appendChild(settingsIntro);
  if (llmSettings) settingsPage.appendChild(llmSettings);

  function activate(id, focus) {
    for (const definition of definitions) {
      const active = definition.id === id;
      const button = buttons.get(definition.id);
      const page = pages.get(definition.id);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("is-active", active);
      page.hidden = !active;
    }
    if (focus) buttons.get(id).focus();
  }

  for (const definition of definitions) {
    const button = buttons.get(definition.id);
    button.addEventListener("click", () => activate(definition.id, false));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = definitions.findIndex(item => item.id === definition.id);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? definitions.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + definitions.length) % definitions.length;
      activate(definitions[next].id, true);
    });
  }

  side.replaceChildren(nav, pagesRoot);
  side.dataset.navigationReady = "true";
  activate("overview", false);
})();
