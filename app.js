(() => {
  "use strict";

  const STORAGE_KEY = "neurogenesis.prototype.v1";
  const TYPES = ["core", "sensory", "memory", "logic", "output"];
  const TYPE_NAMES = { core: "Ядро", sensory: "Сенсорный", memory: "Память", logic: "Логический", output: "Выходной" };
  const TYPE_COLORS = { core: [103,229,209], sensory: [104,185,231], memory: [173,146,239], logic: [235,184,112], output: [238,135,163] };
  const $ = (id) => document.getElementById(id);
  const canvas = $("brain-canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) { $("system-status").textContent = "CANVAS НЕ ПОДДЕРЖИВАЕТСЯ"; return; }

  let neurons = [];
  let synapses = [];
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
  const view = { x: 0, y: 0, zoom: 1 };
  const pointers = new Map();
  let gesture = null;
  let drag = null;

  function makeNeuron(name, type, x, y, bias = 0.5) {
    return { id: "n" + nextId++, name, type, x, y, bias, activity: 0, phase: Math.random() * Math.PI * 2 };
  }
  function seedNetwork() {
    nextId = 1;
    neurons = [
      makeNeuron("Центральное ядро", "core", 0, 0, .78),
      makeNeuron("Восприятие", "sensory", -205, -105, .58),
      makeNeuron("Зрительный буфер", "sensory", -220, 95, .48),
      makeNeuron("Краткая память", "memory", -62, -210, .66),
      makeNeuron("Ассоциации", "memory", 145, -185, .62),
      makeNeuron("Логический узел", "logic", 215, -20, .72),
      makeNeuron("Анализ сигнала", "logic", 180, 170, .55),
      makeNeuron("Реакция", "output", -35, 210, .7),
      makeNeuron("Долгая память", "memory", -300, 225, .43)
    ];
    synapses = [
      ["n2","n1",.82],["n3","n1",.67],["n1","n4",.75],["n1","n5",.72],
      ["n4","n5",.58],["n5","n6",.84],["n6","n7",.71],["n7","n8",.9],
      ["n8","n1",.48],["n9","n3",.52],["n9","n1",.36],["n2","n4",.46],
      ["n3","n8",.4],["n5","n7",.62]
    ].map(([from,to,weight], i) => ({ id: "s" + (i+1), from, to, weight, activity: 0 }));
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
    $("save-dot").classList.add("unsaved");
    $("save-status").textContent = "Есть несохранённые изменения";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 700);
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, neurons: neurons.map(({id,name,type,x,y,bias,activity,phase}) => ({id,name,type,x,y,bias,activity,phase})),
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
  function currentNeuron() { return neurons.find(n => n.id === selectedId) || null; }
  function getNeuron(id) { return neurons.find(n => n.id === id); }
  function colorFor(type, alpha = 1) { const c = TYPE_COLORS[type] || TYPE_COLORS.core; return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`; }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!view.x && !view.y) { view.x = width / 2; view.y = height / 2; }
  }
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener("resize", resize);

  function worldAt(point) { return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }; }
  function screenAt(point) { return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y }; }
  function pointerPoint(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function zoomAt(factor, px = width/2, py = height/2) {
    const before = worldAt({x:px,y:py});
    view.zoom = Math.max(.16, Math.min(5.5, view.zoom * factor));
    view.x = px - before.x * view.zoom; view.y = py - before.y * view.zoom;
    $("zoom-value").textContent = Math.round(view.zoom * 100) + "%";
  }
  function fitNetwork() {
    if (!neurons.length) return;
    const xs = neurons.map(n => n.x), ys = neurons.map(n => n.y);
    const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 100, maxY = Math.max(...ys) + 100;
    view.zoom = Math.max(.2, Math.min(1.8, Math.min((width - 80) / Math.max(1,maxX-minX), (height - 100) / Math.max(1,maxY-minY))));
    view.x = width/2 - ((minX+maxX)/2) * view.zoom;
    view.y = height/2 - ((minY+maxY)/2) * view.zoom;
    $("zoom-value").textContent = Math.round(view.zoom*100) + "%";
  }

  function hitTest(point) {
    const p = worldAt(point);
    for (let i = neurons.length - 1; i >= 0; i--) {
      const n = neurons[i], r = 25;
      if (Math.hypot(p.x-n.x,p.y-n.y) <= r) return n;
    }
    return null;
  }
  function selectNeuron(id) {
    selectedId = id;
    renderInspector(); updateMetrics(); markDirty();
  }
  function addNeuron(x, y, type = "logic") {
    const n = makeNeuron("Новый нейрон " + nextId, type, x, y, .5);
    neurons.push(n); selectNeuron(n.id); showToast("Новый нейрон создан"); markDirty();
    return n;
  }
  function connect(a, b) {
    if (!a || !b || a === b) return false;
    if (synapses.some(s => s.from === a && s.to === b)) { showToast("Такая связь уже существует"); return false; }
    synapses.push({ id: "s" + (Date.now()) + Math.floor(Math.random()*1000), from:a, to:b, weight:.65, activity:0 });
    markDirty(); updateMetrics(); showToast("Связь сформирована"); return true;
  }
  function removeNeuron(id) {
    neurons = neurons.filter(n => n.id !== id);
    synapses = synapses.filter(s => s.from !== id && s.to !== id);
    pulses = pulses.filter(p => p.from !== id && p.to !== id);
    selectedId = neurons[0]?.id || null;
    connectFrom = null; renderInspector(); updateMetrics(); markDirty();
    showToast("Нейрон удалён");
  }
  function activate(id, strength = 1) {
    const n = getNeuron(id); if (!n) return;
    n.activity = Math.min(1, n.activity + strength);
    for (const edge of synapses) if (edge.from === id) pulses.push({ from:id, to:edge.to, progress:0, strength:strength * edge.weight });
    updateMetrics();
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
    ctx.clearRect(0,0,width,height);
    const grad = ctx.createRadialGradient(width*.52,height*.48,10,width*.52,height*.48,Math.max(width,height)*.8);
    grad.addColorStop(0,"rgba(17,68,79,.12)"); grad.addColorStop(1,"rgba(3,11,18,0)");
    ctx.fillStyle = grad; ctx.fillRect(0,0,width,height);
    ctx.save(); ctx.translate(view.x,view.y); ctx.scale(view.zoom,view.zoom);
    const step = 55, left = -view.x/view.zoom, top = -view.y/view.zoom;
    const right = left + width/view.zoom, bottom = top + height/view.zoom;
    ctx.beginPath();
    for(let x=Math.floor(left/step)*step;x<right;x+=step){ctx.moveTo(x,top);ctx.lineTo(x,bottom);}
    for(let y=Math.floor(top/step)*step;y<bottom;y+=step){ctx.moveTo(left,y);ctx.lineTo(right,y);}
    ctx.strokeStyle="rgba(109,174,185,.055)";ctx.lineWidth=1/view.zoom;ctx.stroke();
    ctx.restore();
  }
  function drawConnections(time) {
    ctx.save(); ctx.translate(view.x,view.y); ctx.scale(view.zoom,view.zoom);
    for (const s of synapses) {
      const a = getNeuron(s.from), b = getNeuron(s.to); if (!a || !b) continue;
      const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1;
      const bend=Math.min(34,dist*.13)*(s.from < s.to ? 1 : -1);
      const mx=(a.x+b.x)/2-(dy/dist)*bend, my=(a.y+b.y)/2+(dx/dist)*bend;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mx,my,b.x,b.y);
      ctx.strokeStyle="rgba(83,160,174,"+(.13 + s.weight*.17 + s.activity*.45)+")";ctx.lineWidth=(.8+s.weight*1.2+s.activity*1.4)/view.zoom;ctx.stroke();
      if(s.activity>.04){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mx,my,b.x,b.y);ctx.strokeStyle="rgba(106,239,219,"+(s.activity*.65)+")";ctx.lineWidth=(1+s.activity*2)/view.zoom;ctx.shadowColor="#65e7d4";ctx.shadowBlur=12/view.zoom;ctx.stroke();ctx.shadowBlur=0;}
    }
    for (const p of pulses) {
      const a=getNeuron(p.from),b=getNeuron(p.to);if(!a||!b)continue;
      const x=a.x+(b.x-a.x)*p.progress,y=a.y+(b.y-a.y)*p.progress;
      ctx.beginPath();ctx.arc(x,y,3.2/view.zoom,0,Math.PI*2);ctx.fillStyle="rgba(183,255,241,.95)";ctx.shadowColor="#68ffe3";ctx.shadowBlur=16/view.zoom;ctx.fill();ctx.shadowBlur=0;
    }
    ctx.restore();
  }
  function drawNeurons(time) {
    ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.zoom,view.zoom);
    for (const n of neurons) {
      const r = 18 + n.activity*2;
      const col = colorFor(n.type);
      const searching = searchTerm && n.name.toLowerCase().includes(searchTerm);
      const dimmed = searchTerm && !searching;
      const selected = n.id === selectedId;
      ctx.globalAlpha = dimmed ? .22 : 1;
      const halo=ctx.createRadialGradient(n.x,n.y,2,n.x,n.y,52+n.activity*18);
      halo.addColorStop(0,colorFor(n.type,.2+n.activity*.3));halo.addColorStop(1,colorFor(n.type,0));
      ctx.fillStyle=halo;ctx.beginPath();ctx.arc(n.x,n.y,52+n.activity*18,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(n.x,n.y,r+5+Math.sin(time*.001+n.phase)*1.3,0,Math.PI*2);
      ctx.strokeStyle=colorFor(n.type,.22+n.activity*.5);ctx.lineWidth=1.2/view.zoom;ctx.stroke();
      ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);
      const core=ctx.createRadialGradient(n.x-r*.35,n.y-r*.4,1,n.x,n.y,r);
      core.addColorStop(0,"rgba(207,255,248,.95)");core.addColorStop(.18,colorFor(n.type,.95));core.addColorStop(.65,colorFor(n.type,.42));core.addColorStop(1,"rgba(7,23,34,.98)");
      ctx.fillStyle=core;ctx.fill();ctx.strokeStyle=colorFor(n.type,.8);ctx.lineWidth=1.2/view.zoom;ctx.stroke();
      ctx.beginPath();ctx.arc(n.x,n.y,3.2+n.activity*2,0,Math.PI*2);ctx.fillStyle="rgba(224,255,250,.95)";ctx.fill();
      if (selected || searching) {ctx.beginPath();ctx.arc(n.x,n.y,r+10,0,Math.PI*2);ctx.strokeStyle=selected?"rgba(213,255,245,.8)":"rgba(255,222,151,.9)";ctx.lineWidth=1.5/view.zoom;ctx.setLineDash([4/view.zoom,4/view.zoom]);ctx.stroke();ctx.setLineDash([]);}
      if (connectFrom===n.id) {ctx.beginPath();ctx.arc(n.x,n.y,r+15,0,Math.PI*2);ctx.strokeStyle="rgba(255,211,128,.9)";ctx.lineWidth=2/view.zoom;ctx.stroke();}
      ctx.globalAlpha=1;
    }
    ctx.restore();
    if(view.zoom>.42){
      for(const n of neurons){
        const p=screenAt(n);const label=n.name;ctx.font="11px Inter,system-ui,sans-serif";
        const tw=ctx.measureText(label).width;const w=tw+16;const x=p.x-w/2;const y=p.y+27*view.zoom+8;
        ctx.fillStyle=n.id===selectedId?"rgba(16,43,52,.94)":"rgba(7,19,29,.82)";
        roundRect(ctx,x,y,w,22,7);ctx.fill();
        ctx.strokeStyle=n.id===selectedId?"rgba(103,229,209,.42)":"rgba(116,168,178,.13)";ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle=n.id===selectedId?"#d8f9f1":"#91aab2";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(label,p.x,y+11);
      }
    }
    ctx.globalAlpha=1;
  }
  function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function frame(time) {
    const dt=Math.min(50,time-lastFrame||16);lastFrame=time;
    if(running && time-lastStimulus>1850){const n=neurons[Math.floor(Math.random()*neurons.length)];if(n)activate(n.id,.35);lastStimulus=time;}
    for(const n of neurons)n.activity=Math.max(0,n.activity-dt*.00048);
    for(const s of synapses)s.activity=Math.max(0,s.activity-dt*.0013);
    for(const p of pulses){
      p.progress+=dt/720;
      const edge=synapses.find(s=>s.from===p.from&&s.to===p.to);if(edge)edge.activity=Math.max(edge.activity,p.strength);
      if(p.progress>=1){const target=getNeuron(p.to);if(target)target.activity=Math.min(1,target.activity+p.strength*.7);}
    }
    pulses=pulses.filter(p=>p.progress<1);
    drawBackground();drawConnections(time);drawNeurons(time);
    if(time%8<dt)updateMetrics();
    requestAnimationFrame(frame);
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
        else {connect(connectFrom,hit.id);connectFrom=null;setConnectMode(false);}
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
      view.zoom=Math.max(.16,Math.min(5.5,gesture.zoom*(dist/Math.max(1,gesture.distance))));
      view.x=mid.x-gesture.world.x*view.zoom;view.y=mid.y-gesture.world.y*view.zoom;
      $("zoom-value").textContent=Math.round(view.zoom*100)+"%";return;
    }
    if(!drag)return;
    if(drag.kind==="node"){
      const n=getNeuron(drag.id);if(!n)return;
      const w=worldAt(point);n.x+=w.x-drag.last.x;n.y+=w.y-drag.last.y;drag.last=w;markDirty();
    }else if(drag.kind==="pan"){
      view.x+=point.x-drag.last.x;view.y+=point.y-drag.last.y;drag.last=point;
    }
  });
  function endPointer(event){pointers.delete(event.pointerId);if(pointers.size<2)gesture=null;if(pointers.size===0)drag=null;}
  canvas.addEventListener("pointerup",endPointer);canvas.addEventListener("pointercancel",endPointer);
  canvas.addEventListener("wheel",event=>{event.preventDefault();const p=pointerPoint(event);zoomAt(event.deltaY<0?1.14:1/1.14,p.x,p.y);},{passive:false});
  canvas.addEventListener("dblclick",event=>{const p=pointerPoint(event),w=worldAt(p);addNeuron(w.x,w.y);});

  function setConnectMode(force) {
    connectMode=typeof force==="boolean"?force:!connectMode;
    if(!connectMode)connectFrom=null;
    $("connect-button").classList.toggle("active",connectMode);
    $("mode-note").textContent=connectMode?"Выбери два нейрона по очереди.":"Выбери нейрон, чтобы изучить его состояние.";
    if(connectMode)showToast("Режим связей: выбери первый нейрон");
  }
  $("stimulate-button").addEventListener("click",stimulateRandom);
  $("add-button").addEventListener("click",()=>{const p=worldAt({x:width/2,y:height/2});addNeuron(p.x+(Math.random()-.5)*80,p.y+(Math.random()-.5)*80);});
  $("connect-button").addEventListener("click",()=>setConnectMode());
  $("grow-button").addEventListener("click",grow);
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
  $("save-button").addEventListener("click",()=>{saveState();showToast("Сеть сохранена на этом устройстве");});
  $("delete-button").addEventListener("click",()=>{if(selectedId&&confirm("Удалить выбранный нейрон и все его связи?"))removeNeuron(selectedId);});
  $("neuron-name").addEventListener("change",event=>{const n=currentNeuron();if(n){n.name=event.target.value.trim()||"Безымянный нейрон";event.target.value=n.name;markDirty();}});
  $("neuron-type").addEventListener("change",event=>{const n=currentNeuron();if(n){n.type=event.target.value;markDirty();}});
  $("neuron-bias").addEventListener("input",event=>{const n=currentNeuron();if(n){n.bias=Number(event.target.value)/100;$("bias-value").textContent=event.target.value+"%";markDirty();}});
  $("search-input").addEventListener("input",event=>{searchTerm=event.target.value.trim().toLowerCase();const found=neurons.find(n=>n.name.toLowerCase().includes(searchTerm));if(searchTerm&&found){selectNeuron(found.id);const p=screenAt(found);zoomAt(1.1,p.x,p.y);}});
  document.addEventListener("keydown",event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();saveState();}
    if((event.key==="Delete"||event.key==="Backspace")&&!["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName)&&selectedId){removeNeuron(selectedId);}
    if(event.key==="Escape")setConnectMode(false);
  });
  window.addEventListener("beforeunload",()=>{if(dirty)saveState();});

  resize();
  loadState();
  requestAnimationFrame(()=>{if(!localStorage.getItem(STORAGE_KEY))fitNetwork();});
  requestAnimationFrame(frame);
})();