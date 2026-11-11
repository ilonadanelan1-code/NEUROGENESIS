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
  let model=Model.create({dimension:12,windowSize:4,heads:3,seed:9173});
  let checkpointRequiresRetraining=false;
  function save(){
    try{root.localStorage?.setItem(STORAGE_KEY,JSON.stringify({state:model.exportState(),corpus:corpusInput.value}));}
    catch(_){}
  }
  function renderStatus(message=""){
    const status=model.status();
    stateLabel.textContent=status.trained?"ОБУЧЕНА":"ЕЩЁ НЕ ОБУЧЕНА";
    metrics.textContent=message||(status.trained
      ?"Головы: "+status.heads+" · окно: ±"+status.windowSize+" · словарь: "+status.vocabularySize+
       " · блоки: "+status.transformerBlocks+" · шаги: "+status.trainingSteps+" · subword: "+status.subwordBuckets+" корзин · train loss: "+Number(status.lastLoss).toFixed(3)+
       (status.lastTraining?" · val loss: "+(status.lastTraining.validationLoss==null?"н/д":Number(status.lastTraining.validationLoss).toFixed(3))+
        " · test loss: "+(status.lastTraining.testLoss==null?"н/д":Number(status.lastTraining.testLoss).toFixed(3)):"")
      :"Архитектура: "+status.transformerBlocks+" блока · "+status.heads+" головы · окно ±"+status.windowSize+" · символьные n-граммы · LayerNorm · FFN. Добавь предложения и запусти обучение.");
  }
  let saved=null;
  try{saved=JSON.parse(root.localStorage?.getItem(STORAGE_KEY)||"null");}catch(_){}
  if(saved&&typeof saved.corpus==="string")corpusInput.value=saved.corpus;
  else corpusInput.value=STARTER_CORPUS;
  if(saved&&saved.state){
    try{model.loadState(saved.state);}
    catch(_){
      // A previous checkpoint is intentionally not misread as the v5 stacked-transformer model.
      checkpointRequiresRetraining=true;
    }
  }
  root.NGContextualAttention=model;
  renderStatus();
  if(checkpointRequiresRetraining){
    stateLabel.textContent="ТРЕБУЕТСЯ ПЕРЕОБУЧЕНИЕ";
    metrics.textContent="Архитектура обновлена: теперь используются два последовательных Transformer-блока. Твои обучающие предложения сохранены — запусти обучение заново.";
  }
  trainButton.addEventListener("click",()=>{
    const rows=corpusInput.value.split(/[\r\n]+/u).map(value=>value.trim()).filter(Boolean).slice(0,160);
    if(!rows.length){renderStatus("Добавь хотя бы одно предложение для обучения.");return;}
    trainButton.disabled=true;trainButton.textContent="ОБУЧЕНИЕ…";
    try{
      const report=model.train(rows,{epochs:55,learningRate:0.035,splitSeed:902});save();
      renderStatus(report.splitFallback
        ?"Обучено на небольшом корпусе · "+report.trainRows+" предложений · "+report.epochs+" эпох. Отложенная оценка не выполнялась: недостаточно независимых примеров."
        :"Готово · train "+report.trainExamples+" примеров · val "+report.validationExamples+
         " · test "+report.testExamples+" · покрытие val/test "+Math.round(report.validationCoverage*100)+"%/"+
         Math.round(report.testCoverage*100)+"% · val acc "+Math.round(report.validationAccuracy*100)+"%"+
         " · test acc "+(report.testAccuracy==null?"нет покрытия":Math.round(report.testAccuracy*100)+"%")+
         " · лучшая эпоха "+report.bestEpoch+"/"+report.epochs+
         " · train loss "+report.initialLoss.toFixed(3)+" → "+report.finalLoss.toFixed(3)+
         " · val loss "+report.validationLoss.toFixed(3)+
         " · test loss "+(report.testLoss==null?"недостаточно известных слов":report.testLoss.toFixed(3)));
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
        .map(item=>item.token+" ("+(item.offset>0?"+":"")+item.offset+") "+Math.round(item.weight*100)+"%").join(" · ");
      const guesses=row.predictions.slice(0,3)
        .map(item=>item.token+" "+Math.round(item.probability*100)+"%").join(" · ");
      lines.push(row.token+" ← среднее внимание: "+(links||"нет контекста"));
      for(const head of row.heads){
        const detail=head.attention.slice().sort((a,b)=>b.weight-a.weight)
          .map(item=>item.token+" ("+(item.offset>0?"+":"")+item.offset+") "+Math.round(item.weight*100)+"%").join(" · ");
        lines.push("  голова "+head.head+": "+detail);
        const positionalBias=head.relativePositionBias.map((value,index)=>{
          const offset=index<analysis.windowSize?index-analysis.windowSize:index-analysis.windowSize+1;
          return (offset>0?"+":"")+offset+":"+value.toFixed(3);
        }).join(" · ");
        lines.push("    позиционные bias: "+positionalBias);
      }
      lines.push("  предсказание по контексту: "+guesses);
    }
    output.textContent=lines.join("\n")||"Для этой фразы пока недостаточно известных слов.";
  });
})();