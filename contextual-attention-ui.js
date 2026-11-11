(() => {
  "use strict";
  const root=typeof window!=="undefined"?window:globalThis;
  const Model=root.NGContextualModel;
  if(!Model||typeof document==="undefined")return;
  const STORAGE_KEY="neurogenesis.contextual-attention.v1";
  const STARTER_CORPUS=[
    "нейрон получает сигнал","нейрон обрабатывает сигнал","сигнал активирует нейрон",
    "сеть получает данные","сеть обрабатывает сигнал","память хранит информацию",
    "модель изучает контекст","контекст меняет значение слова","система получает сигнал",
    "система обрабатывает данные","ключ открывает замок","ключ запускает программу",
    "программа использует ключ","замок защищает помещение"
  ].join("\n");
  const byId=id=>document.getElementById(id);
  const corpusInput=byId("contextual-training-corpus"),trainButton=byId("contextual-train-button");
  const analyseButton=byId("contextual-analyse-button"),queryInput=byId("contextual-query");
  const stateLabel=byId("contextual-model-state"),metrics=byId("contextual-model-metrics");
  const output=byId("contextual-attention-output");
  if(!corpusInput||!trainButton||!analyseButton||!queryInput||!stateLabel||!metrics||!output)return;
  let model=Model.create({dimension:12,windowSize:2,seed:9173});
  function save(){
    try{root.localStorage?.setItem(STORAGE_KEY,JSON.stringify({state:model.exportState(),corpus:corpusInput.value}));}
    catch(_){}
  }
  function renderStatus(message=""){
    const status=model.status();
    stateLabel.textContent=status.trained?"ОБУЧЕНА":"ЕЩЁ НЕ ОБУЧЕНА";
    metrics.textContent=message||(status.trained
      ?"Словарь: "+status.vocabularySize+" · шаги обучения: "+status.trainingSteps+
       " · ошибка предсказания: "+Number(status.lastLoss).toFixed(3)
      :"Пока нет обученных весов. Добавь предложения и запусти обучение.");
  }
  try{
    const saved=JSON.parse(root.localStorage?.getItem(STORAGE_KEY)||"null");
    if(saved&&saved.state){model.loadState(saved.state);if(typeof saved.corpus==="string")corpusInput.value=saved.corpus;}
    else corpusInput.value=STARTER_CORPUS;
  }catch(_){corpusInput.value=STARTER_CORPUS;}
  root.NGContextualAttention=model;
  renderStatus();
  trainButton.addEventListener("click",()=>{
    const rows=corpusInput.value.split(/[\r\n]+/u).map(value=>value.trim()).filter(Boolean).slice(0,160);
    if(!rows.length){renderStatus("Добавь хотя бы одно предложение для обучения.");return;}
    trainButton.disabled=true;trainButton.textContent="ОБУЧЕНИЕ…";
    try{
      const report=model.train(rows,{epochs:55,learningRate:0.035});save();
      renderStatus("Готово: "+report.examples+" примеров · "+report.epochs+" эпох · ошибка "+
        report.initialLoss.toFixed(3)+" → "+report.finalLoss.toFixed(3));
      stateLabel.textContent="ОБУЧЕНА";
    }catch(error){renderStatus("Обучение не выполнено: "+error.message);}
    finally{trainButton.disabled=false;trainButton.textContent="Обучить контекстную модель";}
  });
  analyseButton.addEventListener("click",()=>{
    const text=queryInput.value.trim();
    if(!text){output.textContent="Введи фразу для анализа.";return;}
    if(!model.status().trained){output.textContent="Сначала обучи модель на нескольких примерах.";return;}
    const analysis=model.analyse(text),lines=[];
    for(const row of analysis.positions){
      const links=row.attention.slice().sort((a,b)=>b.weight-a.weight)
        .map(item=>item.token+" "+Math.round(item.weight*100)+"%").join(" · ");
      const guesses=row.predictions.slice(0,3)
        .map(item=>item.token+" "+Math.round(item.probability*100)+"%").join(" · ");
      lines.push(row.token+" ← "+(links||"нет контекста"));
      lines.push("  предсказание по контексту: "+guesses);
    }
    output.textContent=lines.join("\n")||"Для этой фразы пока недостаточно известных слов.";
  });
})();