(() => {
  "use strict";
  const aside=document.querySelector(".side-panel");
  if(!aside||aside.dataset.navigationReady==="true")return;
  const byId=id=>document.getElementById(id);
  const get=selector=>aside.querySelector(selector);
  const groups=[
    {id:"overview",label:"Старт",glyph:"⌂",title:"Главная панель",description:"Быстрый опыт, состояние организма и основные действия.",elements:[byId("first-experiment"),get(".organism-block"),get(".controls-block")]},
    {id:"network",label:"Сеть",glyph:"⌘",title:"Управление сетью",description:"Выбирай узлы, ищи нейроны и меняй их параметры.",elements:[get(".inspector-block"),get(".search-block")]},
    {id:"memory",label:"Память",glyph:"▤",title:"Память и диалог",description:"Сохраняй факты, задавай вопросы и управляй записями.",elements:[get(".memory-block")]},
    {id:"learning",label:"Обучение",glyph:"✳",title:"Обучение моделей",description:"Здесь разные механизмы обучения разделены и объяснены отдельно.",elements:[byId("contextual-model-panel"),byId("wasm-learning-panel")]},
    {id:"settings",label:"ИИ",glyph:"⚙",title:"Подключение языковой модели",description:"Настройки внешней модели и соединения.",elements:[byId("llm-settings"),byId("memory-feedback")]}
  ];
  if(groups.some(group=>group.elements.some(element=>!element)))return;
  const nav=document.createElement("nav");
  nav.className="side-tabs";
  nav.setAttribute("role","tablist");
  nav.setAttribute("aria-label","Разделы NEUROGENESIS");
  const scroll=document.createElement("div");
  scroll.className="side-tab-scroll";
  const pages=new Map(),buttons=new Map();
  for(const group of groups){
    const page=document.createElement("section");
    page.className="side-tab-page";
    page.id="side-page-"+group.id;
    page.setAttribute("role","tabpanel");
    page.setAttribute("aria-labelledby","side-tab-"+group.id);
    page.hidden=group.id!=="overview";
    const heading=document.createElement("div");
    heading.className="side-tab-heading";
    const title=document.createElement("h2");
    title.textContent=group.title;
    const description=document.createElement("p");
    description.textContent=group.description;
    heading.append(title,description);
    page.appendChild(heading);
    if(group.id==="learning"){
      const note=document.createElement("div");
      note.className="panel-guide-note";
      note.innerHTML="<strong>Два независимых эксперимента</strong><p><span class='guide-accent'>Модель предсказания слов</span> учится продолжать и анализировать предложения. Она сохраняет свои веса в этом браузере и <b>не добавляет нейроны</b>.</p><p><span class='guide-accent'>Пластичность сети</span> меняет веса в отдельной WASM-копии. Это не то же самое, что обучение языковой модели.</p>";
      page.appendChild(note);
    }
    if(group.id==="memory"){
      const note=document.createElement("div");
      note.className="panel-guide-note";
      note.innerHTML="<strong>Почему в сети иногда появляется новый узел?</strong><p>Сохранение нового воспоминания может создать узел-энграмму — визуальный след этой записи. Это ожидаемая связь памяти с картой нейронов, а не результат обучения контекстной модели.</p>";
      page.appendChild(note);
    }
    for(const element of group.elements)page.appendChild(element);
    scroll.appendChild(page);
    pages.set(group.id,page);
    const button=document.createElement("button");
    button.type="button";
    button.className="side-tab-button";
    button.id="side-tab-"+group.id;
    button.setAttribute("role","tab");
    button.setAttribute("aria-controls",page.id);
    button.setAttribute("aria-selected",group.id==="overview"?"true":"false");
    button.tabIndex=group.id==="overview"?0:-1;
    const glyph=document.createElement("span");
    glyph.className="side-tab-glyph";
    glyph.setAttribute("aria-hidden","true");
    glyph.textContent=group.glyph;
    const label=document.createElement("span");
    label.textContent=group.label;
    button.append(glyph,label);
    button.addEventListener("click",()=>activate(group.id));
    button.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      const index=groups.findIndex(item=>item.id===group.id);
      const next=event.key==="Home"?0:event.key==="End"?groups.length-1:(index+(event.key==="ArrowRight"?1:-1)+groups.length)%groups.length;
      buttons.get(groups[next].id).focus();
      activate(groups[next].id);
    });
    nav.appendChild(button);
    buttons.set(group.id,button);
  }
  function activate(id){
    for(const group of groups){
      const active=group.id===id;
      pages.get(group.id).hidden=!active;
      buttons.get(group.id).setAttribute("aria-selected",active?"true":"false");
      buttons.get(group.id).tabIndex=active?0:-1;
    }
    scroll.scrollTop=0;
    aside.dataset.activeTab=id;
  }
  aside.replaceChildren(nav,scroll);
  aside.dataset.navigationReady="true";
  aside.dataset.activeTab="overview";
  const contextual=byId("contextual-model-panel");
  if(contextual)contextual.open=true;
})();
