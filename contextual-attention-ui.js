(async () => {
  "use strict";
  const root=typeof window!=="undefined"?window:globalThis;
  const Model=root.NGContextualModel,Composition=root.NGPhraseCompositionModel;
  if(!Model||typeof document==="undefined")return;
  const STORAGE_KEY="neurogenesis.contextual-attention.v1";
  const STARTER_CORPUS=[
    "нейрон получает сигнал","нейрон обрабатывает сигнал","сигнал активирует нейрон",
    "сеть получает данные","сеть обрабатывает сигнал","память хранит информацию",
    "модель изучает контекст","контекст меняет значение слова","система получает сигнал",
    "система обрабатывает данные","ключ открывает замок","ключ запускает программу",
    "программа использует ключ","замок защищает помещение",
    "сенсор обнаруживает импульс","алгоритм выбирает маршрут",
    "исследователь проверяет гипотезу","память сохраняет событие",
    "датчик измеряет температуру","система передает сигнал"
  ].join("\n");
  const byId=id=>document.getElementById(id);
  const corpusInput=byId("contextual-training-corpus"),trainButton=byId("contextual-train-button");
  const analyseButton=byId("contextual-analyse-button"),queryInput=byId("contextual-query");
  const stateLabel=byId("contextual-model-state"),metrics=byId("contextual-model-metrics");
  const output=byId("contextual-attention-output");
  const trainingProgress=byId("contextual-training-progress");
  const friendlyResult=byId("contextual-friendly-result");
  const corpusCount=byId("contextual-corpus-count");
  const addExamplesButton=byId("contextual-add-examples-button");
  const progressTitle=byId("contextual-training-progress-title");
  const progressValue=byId("contextual-training-progress-value");
  const progressBar=byId("contextual-training-progress-bar");
  const progressText=byId("contextual-training-progress-text");
  let activeTrainingWorker=null;
  if(!corpusInput||!trainButton||!analyseButton||!queryInput||!stateLabel||!metrics||!output)return;
  let model=Model.create({dimension:12,windowSize:4,heads:3,seed:9173});
  let phraseModel=Composition?Composition.create({dimension:12,seed:24081}):null;
  let checkpointRequiresRetraining=false;
  function save(){
    try{root.localStorage?.setItem(STORAGE_KEY,JSON.stringify({state:model.exportState(),compositionState:phraseModel?phraseModel.exportState():null,corpus:corpusInput.value}));}
    catch(_){}
  }
  function showFriendlyResult(title,message,state="info"){
    if(!friendlyResult)return;
    friendlyResult.dataset.state=state;
    friendlyResult.textContent=title+"\n"+message;
  }
  function updateCorpusCount(){
    if(!corpusCount)return;
    const count=corpusInput.value.split(/[\r\n]+/u).map(value=>value.trim()).filter(Boolean).length;
    corpusCount.textContent="Предложений добавлено: "+count+" · минимум для запуска: 3";
    corpusCount.dataset.state=count>=3?"ready":"warning";
  }
  const EXTRA_EXAMPLES=[
    "Нейрон получает сигнал.",
    "Нейрон обрабатывает сигнал.",
    "Сеть хранит информацию.",
    "Память сохраняет событие.",
    "Система анализирует данные.",
    "Исследователь проверяет гипотезу.",
    "Датчик измеряет температуру.",
    "Алгоритм выбирает маршрут."
  ];
  corpusInput.addEventListener("input",updateCorpusCount);
  if(addExamplesButton)addExamplesButton.addEventListener("click",()=>{
    const existing=corpusInput.value.split(/[\r\n]+/u).map(value=>value.trim()).filter(Boolean);
    const known=new Set(existing.map(value=>value.toLocaleLowerCase("ru")));
    const additions=EXTRA_EXAMPLES.filter(value=>!known.has(value.toLocaleLowerCase("ru")));
    if(additions.length){
      corpusInput.value=[...existing,...additions].join("\n");
      corpusInput.dispatchEvent(new Event("input",{bubbles:true}));
    }
    updateCorpusCount();
    showFriendlyResult("Примеры добавлены","Я добавил несколько коротких предложений в конец списка, не удаляя твои тексты. Теперь можно запускать обучение.","success");
  });
  function renderStatus(message=""){
    const status=model.status(),phraseStatus=phraseModel&&phraseModel.status();
    stateLabel.textContent=status.trained?"ОБУЧЕНА":"ЕЩЁ НЕ ОБУЧЕНА";
    if(!activeTrainingWorker)trainButton.textContent=status.trained?"Переобучить на примерах":"Обучить на примерах";
    metrics.textContent=message||(status.trained
      ?"Головы: "+status.heads+" · окно: ±"+status.windowSize+" · словарь: "+status.vocabularySize+
       " · блоки: "+status.transformerBlocks+" · фразовая модель: "+(phraseStatus&&phraseStatus.trained?"обучена":"не обучена")+" · шаги: "+status.trainingSteps+" · subword: "+status.subwordBuckets+" корзин · train loss: "+Number(status.lastLoss).toFixed(3)+
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
  if(phraseModel&&saved&&saved.compositionState){try{phraseModel.loadState(saved.compositionState);}catch(_){}}
  // Preserve a trained model already stored by this user. Otherwise bootstrap from
  // the reproducible Pages checkpoint generated by GitHub Actions.
  if(!model.status().trained){
    try{
      const response=await fetch("./contextual-pretrained.json?v=0.58.106",{cache:"no-cache"});
      if(response.ok){
        const pretrained=await response.json();
        if(pretrained&&pretrained.schema==="NEUROGENESIS_PRETRAINED_CONTEXTUAL_V1"&&pretrained.contextualState){
          model.loadState(pretrained.contextualState);
          if(phraseModel&&pretrained.phraseState)phraseModel.loadState(pretrained.phraseState);
          if((!saved||typeof saved.corpus!=="string")&&Array.isArray(pretrained.corpus)){
            corpusInput.value=pretrained.corpus.join("\n");
          }
          checkpointRequiresRetraining=false;
          save();
        }
      }
    }catch(_){
      // Keep the starter corpus available when the network checkpoint is unavailable.
    }
  }
  if(model.status().trained&&model.status().trainingContextExamples===0&&typeof model.rebuildTrainingContextIndex==="function"){
    const rebuilt=model.rebuildTrainingContextIndex(corpusInput.value.split(/[\r\n]+/u).map(value=>value.trim()).filter(Boolean).slice(0,160));
    if(rebuilt.rebuilt)save();
  }
  root.NGContextualAttention=model;
  root.NGPhraseComposition=phraseModel;
  renderStatus();
  updateCorpusCount();
  showFriendlyResult(model.status().trained
    ?"Модель уже готова к проверке"
    :"Начни с нескольких предложений",
    model.status().trained
      ?"Модель загружена в этом браузере. Введи предложение ниже и нажми «Проверить фразу». Если изменишь примеры, запусти переобучение."
      :"Добавь минимум три предложения — по одному на строку — и нажми «Обучить на этих примерах». Данные останутся в этом браузере.",
    model.status().trained?"success":"info");
  if(checkpointRequiresRetraining){
    stateLabel.textContent="ТРЕБУЕТСЯ ПЕРЕОБУЧЕНИЕ";
    metrics.textContent="Архитектура обновлена: теперь используются два последовательных Transformer-блока. Твои обучающие предложения сохранены — запусти обучение заново.";
    showFriendlyResult("Нужно переобучить модель","Архитектура обновилась, но твои примеры сохранены. Нажми «Обучить на этих примерах».","warning");
  }
  function setTrainingProgress(percent,title,message){
    const safe=Math.max(0,Math.min(100,Number(percent)||0));
    if(trainingProgress)trainingProgress.hidden=false;
    if(progressTitle)progressTitle.textContent=title;
    if(progressValue)progressValue.textContent=Math.round(safe)+"%";
    if(progressBar)progressBar.style.width=safe+"%";
    if(progressText)progressText.textContent=message;
  }
  function finishTrainingWorker(){
    if(activeTrainingWorker){activeTrainingWorker.terminate();activeTrainingWorker=null;}
    trainButton.disabled=false;
    analyseButton.disabled=false;
    trainButton.textContent=model.status().trained?"Переобучить на примерах":"Обучить на примерах";
  }
  trainButton.addEventListener("click",()=>{
    if(activeTrainingWorker)return;
    const rows=corpusInput.value.split(/[\r\n]+/u).map(value=>value.trim()).filter(Boolean).slice(0,160);
    if(rows.length<3){renderStatus("Для честной проверки нужны минимум три разных предложения.");showFriendlyResult("Пока мало примеров","Добавь ещё предложения: для запуска нужно минимум три непустые строки.","warning");return;}
    if(typeof Worker==="undefined"){
      renderStatus("Этот браузер не поддерживает фоновое обучение (Web Worker). Основная модель сохранена без изменений.");
      showFriendlyResult("Обучение не запустилось","Браузер не поддерживает фоновый поток обучения. Существующая модель не изменена.","warning");
      return;
    }
    trainButton.disabled=true;
    analyseButton.disabled=true;
    trainButton.textContent="Обучение…";
    stateLabel.textContent="ОБУЧАЕТСЯ";
    stateLabel.dataset.state="training";
    metrics.textContent="Идёт обучение в отдельном потоке. Можно продолжать пользоваться графом и другими вкладками.";
    showFriendlyResult("Обучение началось","Сейчас я проверяю примеры и обновляю локальную модель. Не закрывай страницу до завершения.","loading");
    setTrainingProgress(1,"Подготовка модели","Создаю изолированный поток обучения. Текущие сохранённые веса не заменяются до успешного завершения.");
    let worker;
    try{
      worker=new Worker("./contextual-training-worker.js?v=0.58.107");
      activeTrainingWorker=worker;
    }catch(error){
      finishTrainingWorker();
      renderStatus("Не удалось запустить фоновое обучение: "+String(error.message||error));
      return;
    }
    worker.onmessage=event=>{
      const data=event.data||{};
      if(data.type==="progress"){
        if(data.phase==="contextual"){
          const fraction=data.totalEpochs?data.epoch/data.totalEpochs:0;
          setTrainingProgress(fraction*82,"Изучаю сочетания слов",
            "Сверяю подсказки на отдельных предложениях, чтобы модель не просто заучивала строки.");
        }else if(data.phase==="phrase-preparing"){
          setTrainingProgress(83,"Подготовка фразовой модели",
            "Собираю примеры и ищу повторяющиеся сочетания слов. Остальные вкладки остаются доступны.");
        }else if(data.phase==="phrase"){
          const fraction=data.totalEpochs?data.epoch/data.totalEpochs:0;
          setTrainingProgress(82+fraction*18,"Собираю структуру фраз",
            "Пробую определить, какие слова могут быть главным действием, его участником и дополнением.");
        }
        return;
      }
      if(data.type==="error"){
        finishTrainingWorker();
        stateLabel.textContent=model.status().trained?"ОБУЧЕНА":"ОШИБКА";
        stateLabel.dataset.state=model.status().trained?"ready":"error";
        renderStatus("Обучение не завершено: "+String(data.message||"неизвестная ошибка")+". Предыдущая модель сохранена.");
        showFriendlyResult("Не удалось завершить обучение","Предыдущая рабочая модель сохранена. Проверь примеры и попробуй ещё раз.","warning");
        setTrainingProgress(0,"Обучение остановлено","Старые обученные веса оставлены без изменений.");
        return;
      }
      if(data.type!=="complete")return;
      try{
        model.loadState(data.contextualState);
        if(phraseModel&&data.phraseState)phraseModel.loadState(data.phraseState);
        save();
        const report=data.report||{};
        const phraseReport=data.phraseReport;
        renderStatus();
        stateLabel.textContent="ОБУЧЕНА";
        stateLabel.dataset.state="ready";
        const test=Number.isFinite(report.testAccuracy)?Math.round(report.testAccuracy*100)+"%":"н/д";
        const validation=Number.isFinite(report.validationAccuracy)?Math.round(report.validationAccuracy*100)+"%":"н/д";
        const coverage=Number.isFinite(report.testCoverage)?Math.round(report.testCoverage*100)+"%":"н/д";
        metrics.textContent="Готово · тест "+test+" · покрытие "+coverage+" · проверка "+validation+
          " · словарь "+report.vocabularySize+" · шаги "+report.trainingSteps+
          (phraseReport?" · фразовая модель обучена (результат на обучающих примерах)":
            data.phraseError?" · фразовая модель: "+data.phraseError:"");
        setTrainingProgress(100,"Обучение завершено","Модель сохранена в этом браузере. Основной граф нейронов не изменён.");
        showFriendlyResult("Готово — модель обучена","Новая версия сохранена в этом браузере. Теперь введи предложение ниже и нажми «Проверить фразу». Помни: это небольшой эксперимент со словами, а не универсальный собеседник.","success");
        output.textContent="Обучение завершено.\n"+
          "Отложенная тестовая точность: "+test+"\n"+
          "Покрытие теста: "+coverage+"\n"+
          "Проверочная точность: "+validation+"\n"+
          "Обучающие предложения: "+(report.trainRows||0)+
          " · проверочные: "+(report.validationRows||0)+
          " · тестовые: "+(report.testRows||0)+"\n"+
          "Обрати внимание: это небольшой экспериментальный masked-word прогноз, а не полноценная языковая модель.";
      }catch(error){
        stateLabel.textContent="ОШИБКА ЗАГРУЗКИ";
        stateLabel.dataset.state="error";
        renderStatus("Обучение завершилось, но новый checkpoint не удалось применить: "+String(error.message||error)+". Предыдущие сохранения не удалены.");
        setTrainingProgress(0,"Не удалось применить checkpoint","Существующая локальная модель не заменена.");
      }finally{
        finishTrainingWorker();
      }
    };
    worker.onerror=event=>{
      finishTrainingWorker();
      stateLabel.textContent=model.status().trained?"ОБУЧЕНА":"ОШИБКА";
      stateLabel.dataset.state=model.status().trained?"ready":"error";
      renderStatus("Фоновое обучение завершилось с ошибкой: "+String(event.message||"ошибка Worker")+". Предыдущая модель сохранена.");
      showFriendlyResult("Обучение прервалось","Предыдущая версия модели сохранена. Обнови страницу и попробуй ещё раз.","warning");
      setTrainingProgress(0,"Ошибка фонового обучения","Перезагрузи страницу и повтори попытку. Текущие веса не повреждены.");
    };
    worker.onmessageerror=()=>{
      finishTrainingWorker();
      renderStatus("Не удалось получить результат от фонового процесса. Предыдущая модель сохранена.");
      showFriendlyResult("Не удалось получить результат","Старые веса не заменены. Попробуй повторить обучение.","warning");
      setTrainingProgress(0,"Ошибка передачи результата","Существующая модель не заменена.");
    };
    worker.postMessage({type:"train",rows});
  });
  analyseButton.addEventListener("click",()=>{
    const text=queryInput.value.trim();
    if(!text){output.textContent="Введи фразу для анализа.";showFriendlyResult("Нужна фраза для проверки","Напиши короткое предложение в поле выше.","warning");return;}
    if(!model.status().trained){output.textContent="Сначала обучи модель на нескольких примерах.";showFriendlyResult("Сначала нужно обучение","Добавь примеры и нажми «Обучить на этих примерах».","warning");return;}
    const analysis=model.analyse(text),lines=[];
    lines.push("ТОЧНЫЙ СЛОВАРЬ: "+analysis.knownTokenCount+"/"+analysis.tokens.length+
      " · морфологическое покрытие: "+analysis.morphologyCoveredTokenCount+"/"+analysis.tokens.length+
      " · распознано основ в контексте: "+analysis.contextMorphologyBackoffCount);
    if(analysis.morphologyBackoffTokens.length){
      lines.push("РЕЗЕРВ ПО ОСНОВЕ (это не точная генерация окончания): "+
        analysis.morphologyBackoffTokens.map(row=>row.token+" → "+row.vocabularyToken).join(" · "));
    }
    if(analysis.morphologyAmbiguousTokens.length){
      lines.push("Неоднозначные основы, не засчитанные в покрытие: "+analysis.morphologyAmbiguousTokens.join(" · "));
    }
    for(const row of analysis.positions){
      if(row.targetKnown)continue;
      const generated=model.predictMasked(text,row.index);
      if(generated&&generated.generatedPrediction){
        lines.push("КОНТЕКСТНАЯ ГЕНЕРАЦИЯ для «"+row.token+"»: "+
          generated.generatedPrediction.baseToken+" → "+generated.generatedPrediction.surface+
          " · подсказка: "+generated.morphologyHint.source+" · "+generated.generatedPrediction.method);
      if(generated.retrievalPrediction){
        lines.push("ПОИСК ПО ОБУЧАЮЩЕМУ КОНТЕКСТУ: "+
          generated.retrievalPrediction.baseToken+" → "+generated.retrievalPrediction.surface+
          " · совпадения: "+generated.retrievalPrediction.matchedContextTokens.join(", "));
      }
      }
    }
    for(const row of analysis.positions){
      const links=row.attention.slice().sort((a,b)=>b.weight-a.weight)
        .map(item=>item.token+" ("+(item.offset>0?"+":"")+item.offset+") "+Math.round(item.weight*100)+"%").join(" · ");
      const guesses=row.predictions.slice(0,3)
        .map(item=>item.token+" "+Math.round(item.probability*100)+"%").join(" · ");
      const morphologyNote=row.morphologyBackoff?" [OOV · основа → "+row.morphologyToken+"]":row.morphologyAmbiguous?" [OOV · неоднозначная основа]":row.targetKnown?"":" [OOV · субслова]";
      lines.push(row.token+morphologyNote+" ← среднее внимание: "+(links||"нет контекста"));
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
    const composition=phraseModel&&phraseModel.status().trained?phraseModel.analyse(text,model,root.NGSemanticCore,root.NGKnowledge):null;
    if(composition){
      lines.push("","ФРАЗОВАЯ СТРУКТУРА · слабая супервизия");
      lines.push("Разметка ядра: субъект "+(composition.weakFrame.subject||"—")+" · предикат "+(composition.weakFrame.predicate||"—")+" · объект "+(composition.weakFrame.object||"—"));
      lines.push("Роли модели: "+composition.roles.map(row=>row.token+" → "+row.role+" ("+Math.round(row.confidence*100)+"%)").join(" · "));
      lines.push("Связи: "+(composition.edges.slice(0,8).map(edge=>edge.fromToken+" → "+edge.toToken+" ["+edge.relation+" "+Math.round(edge.confidence*100)+"%]").join(" · ")||"уверенных связей пока нет"));
      lines.push("Вектор композиции: "+composition.phraseVector.length+" измерений · weak train examples: "+(composition.training&&composition.training.roleExamples||0));
    }else lines.push("Фразовая модель ещё не обучена. Запусти обучение корпуса для построения графа зависимостей.");
    const total=Array.isArray(analysis.tokens)?analysis.tokens.length:0;
    const exact=Number(analysis.knownTokenCount)||0;
    const morphological=Number(analysis.morphologyCoveredTokenCount)||0;
    const familiar=Math.min(total,Math.max(exact,morphological));
    const unknown=Array.isArray(analysis.positions)
      ?analysis.positions.filter(row=>!row.targetKnown).map(row=>row.token).filter(Boolean):[];
    if(total===0){
      showFriendlyResult("Не нашёл слов для проверки","Попробуй ввести обычное предложение, а не только знаки или числа.","warning");
    }else if(exact===0&&morphological===0){
      const names=unknown.length?" Пока незнакомые слова: "+unknown.join(", ")+".":"";
      showFriendlyResult("Пока не узнаю слова в этой фразе",
        "Ни одно слово не найдено в точном словаре примеров. Поэтому внутренние подсказки ниже ненадёжны и не означают, что модель поняла предложение."+names+
        " Добавь несколько предложений с похожими словами и снова обучи модель.","warning");
    }else if(familiar<total){
      showFriendlyResult("Я узнаю только часть слов",
        "Нашёл опору для "+familiar+" из "+total+" слов. Остальные пока незнакомы; выводы о всей фразе могут быть ошибочными. Добавь примеры с недостающими словами и переобучи модель.","warning");
    }else{
      showFriendlyResult("Слова знакомы модели",
        "Все "+total+" слов найдены в словаре или сопоставлены по основе. Это говорит о знакомстве со словами, но само по себе ещё не доказывает понимание смысла предложения.","success");
    }
    output.textContent=lines.join("\n")||"Для этой фразы пока недостаточно известных слов.";
  });
})();