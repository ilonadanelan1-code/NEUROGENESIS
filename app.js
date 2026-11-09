(() => {
  "use strict";

  const STORAGE_KEY = "neurogenesis.prototype.v2";
  const TYPES = ["core", "sensory", "memory", "logic", "output"];
  const TYPE_NAMES = { core: "Ядро", sensory: "Сенсорный", memory: "Память", logic: "Логический", output: "Выходной" };
  const TYPE_COLORS = { core: [103,229,209], sensory: [104,185,231], memory: [173,146,239], logic: [235,184,112], output: [238,135,163] };
  const $ = (id) => document.getElementById(id);
  const canvas = $("brain-canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
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
  let lastMetricsUpdate = 0;
  let visualDirty = true;
  let fpsFrames = 0;
  let fpsLast = 0;
  let frameScheduled = false;
  let animationWasActive = false;
  const activeNeuronIds = new Set();
  const MAX_PULSES = 180;
  const MAX_BRANCH_PULSES = 28;
  const neuronById = new Map();
  const synapseByKey = new Map();
  const outgoingById = new Map();
  const edgeKey = (from, to) => from + "\u0000" + to;
  const backgroundLayer = document.createElement("canvas");
  const connectionLayer = document.createElement("canvas");
  const nodeLayer = document.createElement("canvas");
  const backgroundCtx = backgroundLayer.getContext("2d", {alpha:false});
  const connectionCtx = connectionLayer.getContext("2d", {alpha:true});
  const nodeCtx = nodeLayer.getContext("2d", {alpha:true});
  const neuronSprites = new Map();
  let backgroundDirty = true;
  let connectionsDirty = true;
  let nodesDirty = true;
  const curveByKey = new Map();
  function scheduleFrame() {
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(frame);
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
  new ResizeObserver(() => { resize(); scheduleFrame(); }).observe(canvas);
  window.addEventListener("resize", () => { resize(); scheduleFrame(); });
  for (const eventName of ["click","input","change","keydown","pointerdown","pointermove","pointerup","pointercancel","wheel"]) {
    document.addEventListener(eventName, scheduleFrame, {capture:true,passive:true});
  }

  function worldAt(point) { return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }; }
  function screenAt(point) { return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y }; }
  function pointerPoint(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function zoomAt(factor, px = width/2, py = height/2) {
    const before = worldAt({x:px,y:py});
    view.zoom = Math.max(.16, Math.min(5.5, view.zoom * factor));
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
    view.zoom = Math.max(.2, Math.min(1.8, Math.min((width - 80) / Math.max(1,maxX-minX), (height - 100) / Math.max(1,maxY-minY))));
    view.x = width/2 - ((minX+maxX)/2) * view.zoom;
    view.y = height/2 - ((minY+maxY)/2) * view.zoom;
    backgroundDirty = true; connectionsDirty = true; nodesDirty = true; visualDirty = true;
    $("zoom-value").textContent = Math.round(view.zoom*100) + "%";
    scheduleFrame();
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
    nodesDirty = true;
    visualDirty = true;
    renderInspector(); updateMetrics();
    scheduleFrame();
  }
  function addNeuron(x, y, type = "logic") {
    const n = makeNeuron("Новый нейрон " + nextId, type, x, y, .5);
    neurons.push(n); neuronById.set(n.id, n); nodesDirty=true; selectNeuron(n.id); showToast("Новый нейрон создан"); markDirty();
    return n;
  }
  function connect(a, b) {
    if (!a || !b || a === b) return false;
    if (synapses.some(s => s.from === a && s.to === b)) { showToast("Такая связь уже существует"); return false; }
    const edge = { id: "s" + (Date.now()) + Math.floor(Math.random()*1000), from:a, to:b, weight:.65, activity:0 };
    synapses.push(edge);
    synapseByKey.set(edgeKey(a, b), edge);
    if (!outgoingById.has(a)) outgoingById.set(a, []);
    outgoingById.get(a).push(edge);
    connectionsDirty = true;
    markDirty(); updateMetrics(); showToast("Связь сформирована"); return true;
  }
  function removeNeuron(id) {
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
      const glowPath = new Path2D();
      const linePath = new Path2D();
      curveByKey.clear();
      const left=-view.x/view.zoom-120, top=-view.y/view.zoom-120;
      const right=left+width/view.zoom+240, bottom=top+height/view.zoom+240;
      for(let i=0;i<synapses.length;i++){
        const s=synapses[i],a=getNeuron(s.from),b=getNeuron(s.to);
        if(!a||!b) continue;
        const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1;
        const bend=Math.min(58,dist*.22)*(i%2===0?1:-1);
        const mx=(a.x+b.x)/2-(dy/dist)*bend;
        const my=(a.y+b.y)/2+(dx/dist)*bend;
        const minX=Math.min(a.x,b.x,mx),maxX=Math.max(a.x,b.x,mx);
        const minY=Math.min(a.y,b.y,my),maxY=Math.max(a.y,b.y,my);
        if(maxX<left||minX>right||maxY<top||minY>bottom) continue;
        const key=edgeKey(s.from,s.to);
        curveByKey.set(key,{a,b,mx,my});
        glowPath.moveTo(a.x,a.y);
        glowPath.quadraticCurveTo(mx,my,b.x,b.y);
        linePath.moveTo(a.x,a.y);
        linePath.quadraticCurveTo(mx,my,b.x,b.y);
      }
      connectionCtx.lineCap="round";
      connectionCtx.lineJoin="round";
      connectionCtx.strokeStyle="rgba(48,185,190,.105)";
      connectionCtx.lineWidth=5/view.zoom;
      connectionCtx.stroke(glowPath);
      connectionCtx.strokeStyle="rgba(110,205,221,.34)";
      connectionCtx.lineWidth=1.05/view.zoom;
      connectionCtx.stroke(linePath);
      connectionCtx.restore();
      connectionsDirty=false;
    }
    ctx.drawImage(connectionLayer,0,0,width,height);

    if(pulses.length){
      ctx.save();
      ctx.translate(view.x,view.y);
      ctx.scale(view.zoom,view.zoom);
      ctx.fillStyle="rgba(210,255,248,.96)";
      for(const p of pulses){
        const curve=curveByKey.get(edgeKey(p.from,p.to));
        if(!curve) continue;
        const t=p.progress,one=1-t;
        const x=one*one*curve.a.x+2*one*t*curve.mx+t*t*curve.b.x;
        const y=one*one*curve.a.y+2*one*t*curve.my+t*t*curve.b.y;
        ctx.beginPath();
        ctx.arc(x,y,2.8/view.zoom,0,Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function getNeuronSprite(type) {
    let sprite=neuronSprites.get(type);
    if(sprite) return sprite;
    const size=184,center=92,r=19;
    sprite=document.createElement("canvas");
    sprite.width=Math.round(size*dpr);
    sprite.height=Math.round(size*dpr);
    const c=sprite.getContext("2d");
    c.setTransform(dpr,0,0,dpr,0,0);
    const aura=c.createRadialGradient(center,center,2,center,center,84);
    aura.addColorStop(0,colorFor(type,.24));
    aura.addColorStop(.38,colorFor(type,.075));
    aura.addColorStop(1,colorFor(type,0));
    c.fillStyle=aura;c.beginPath();c.arc(center,center,84,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(center,center,r+12,0,Math.PI*2);
    c.strokeStyle=colorFor(type,.19);c.lineWidth=1.3;c.stroke();
    c.beginPath();c.ellipse(center,center,r+8,r+13,0,Math.PI*.13,Math.PI*1.72);
    c.strokeStyle=colorFor(type,.36);c.lineWidth=1.15;c.stroke();
    c.beginPath();c.arc(center,center,r+3,0,Math.PI*2);
    c.strokeStyle=colorFor(type,.63);c.lineWidth=1.4;c.stroke();
    c.beginPath();c.arc(center,center,r,0,Math.PI*2);
    const core=c.createRadialGradient(center-r*.36,center-r*.42,1,center,center,r);
    core.addColorStop(0,"rgba(239,255,255,.98)");
    core.addColorStop(.12,colorFor(type,1));
    core.addColorStop(.43,colorFor(type,.78));
    core.addColorStop(.76,"rgba(14,40,58,.98)");
    core.addColorStop(1,"rgba(3,12,25,1)");
    c.fillStyle=core;c.fill();
    c.strokeStyle=colorFor(type,.95);c.lineWidth=1.25;c.stroke();
    c.fillStyle="rgba(242,255,251,.98)";
    c.beginPath();c.arc(center,center,4.2,0,Math.PI*2);c.fill();
    for(let k=0;k<3;k++){
      const a=k*Math.PI*2/3;
      c.beginPath();c.arc(center+Math.cos(a)*(r+4),center+Math.sin(a)*(r+4),1.55,0,Math.PI*2);
      c.fillStyle="rgba(230,255,250,.88)";c.fill();
    }
    neuronSprites.set(type,sprite);
    return sprite;
  }


  function drawNeurons() {
    if(nodesDirty){
      nodeCtx.setTransform(dpr,0,0,dpr,0,0);
      nodeCtx.clearRect(0,0,width,height);
      const left=-view.x/view.zoom-100,top=-view.y/view.zoom-100;
      const right=left+width/view.zoom+200,bottom=top+height/view.zoom+200;
      nodeCtx.save();
      nodeCtx.translate(view.x,view.y);
      nodeCtx.scale(view.zoom,view.zoom);
      for(const n of neurons){
        if(n.x<left||n.x>right||n.y<top||n.y>bottom) continue;
        const searching=!!searchTerm&&n.name.toLowerCase().includes(searchTerm);
        nodeCtx.globalAlpha=(searchTerm&&!searching)?0.18:1;
        nodeCtx.drawImage(getNeuronSprite(n.type),n.x-92,n.y-92,184,184);
        if(n.id===selectedId||connectFrom===n.id){
          nodeCtx.beginPath();nodeCtx.arc(n.x,n.y,41,0,Math.PI*2);
          nodeCtx.strokeStyle=connectFrom===n.id?"rgba(255,207,126,.95)":"rgba(230,255,249,.84)";
          nodeCtx.lineWidth=1.6/view.zoom;nodeCtx.setLineDash([3/view.zoom,5/view.zoom]);nodeCtx.stroke();nodeCtx.setLineDash([]);
        }
      }
      nodeCtx.restore();
      if(view.zoom>.38){
        const crowded=neurons.length>60;
        const occupied=[];
        const labelTargets = crowded
          ? neurons.filter(n=>n.id===selectedId || (searchTerm&&n.name.toLowerCase().includes(searchTerm)) || connectFrom===n.id).slice(0,32)
          : neurons.slice(0,80);
        nodeCtx.font="10px Inter,system-ui,sans-serif";
        for(const n of labelTargets){
          const p=screenAt(n);
          if(p.x < -180 || p.x > width+180 || p.y < -55 || p.y > height+70) continue;
          const label=n.name;
          const w=Math.min(168,Math.max(108,nodeCtx.measureText(label).width+20));
          const x=Math.max(7,Math.min(width-w-7,p.x-w/2));
          const candidates=[p.y+Math.max(27,26*view.zoom),p.y-Math.max(31,27*view.zoom)-21,p.y+Math.max(48,43*view.zoom)];
          let y=candidates[0];
          for(const candidate of candidates){
            const clear=occupied.every(box=>x+w<box.x-5||x>box.x+box.w+5||candidate+21<box.y-4||candidate>box.y+box.h+4);
            if(clear){y=candidate;break;}
          }
          occupied.push({x,y,w,h:21});
          nodeCtx.fillStyle=n.id===selectedId?"rgba(14,50,59,.94)":"rgba(5,17,29,.88)";
          roundRect(nodeCtx,x,y,w,21,8);nodeCtx.fill();
          nodeCtx.strokeStyle=n.id===selectedId?"rgba(114,245,222,.62)":"rgba(113,187,202,.2)";
          nodeCtx.lineWidth=1;nodeCtx.stroke();
          nodeCtx.fillStyle=n.id===selectedId?"#e7fff9":"#abc8d1";
          nodeCtx.textAlign="center";nodeCtx.textBaseline="middle";
          nodeCtx.fillText(label,x+w/2,y+10.5,w-14);
        }
      }
      nodesDirty=false;
    }
    ctx.drawImage(nodeLayer,0,0,width,height);
    if(activeNeuronIds.size){
      ctx.save();
      ctx.translate(view.x,view.y);
      ctx.scale(view.zoom,view.zoom);
      for(const id of activeNeuronIds){
        const n=neuronById.get(id);
        if(!n||n.activity<=.04) continue;
        ctx.beginPath();ctx.arc(n.x,n.y,25+n.activity*8,0,Math.PI*2);
        ctx.fillStyle="rgba(112,255,224,"+(n.activity*.13)+")";
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
  function frame(time) {
    frameScheduled = false;
    const dt=Math.min(50,time-lastFrame||16);lastFrame=time;
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
      backgroundDirty=true;connectionsDirty=true;nodesDirty=true;visualDirty=true;
      $("zoom-value").textContent=Math.round(view.zoom*100)+"%";return;
    }
    if(!drag)return;
    if(drag.kind==="node"){
      const n=getNeuron(drag.id);if(!n)return;
      const w=worldAt(point);n.x+=w.x-drag.last.x;n.y+=w.y-drag.last.y;drag.last=w;connectionsDirty=true;nodesDirty=true;visualDirty=true;markDirty();
    }else if(drag.kind==="pan"){
      view.x+=point.x-drag.last.x;view.y+=point.y-drag.last.y;drag.last=point;backgroundDirty=true;connectionsDirty=true;nodesDirty=true;visualDirty=true;
    }
  });
  function endPointer(event){pointers.delete(event.pointerId);if(pointers.size<2)gesture=null;if(pointers.size===0)drag=null;}
  canvas.addEventListener("pointerup",endPointer);canvas.addEventListener("pointercancel",endPointer);
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
  $("neuron-name").addEventListener("change",event=>{const n=currentNeuron();if(n){n.name=event.target.value.trim()||"Безымянный нейрон";event.target.value=n.name;nodesDirty=true;markDirty();}});
  $("neuron-type").addEventListener("change",event=>{const n=currentNeuron();if(n){n.type=event.target.value;nodesDirty=true;markDirty();}});
  $("neuron-bias").addEventListener("input",event=>{const n=currentNeuron();if(n){n.bias=Number(event.target.value)/100;$("bias-value").textContent=event.target.value+"%";markDirty();}});
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
      if (changed) { connectionsDirty = true; markDirty(); }
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
    }
  };

  resize();
  loadState();
  if(!neurons.length){seedNetwork();fitNetwork();}
  requestAnimationFrame(()=>{if(neurons.length)fitNetwork();});
  scheduleFrame();
})();