(() => {
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
  if(!corpusInput||!trainButton||!analyseButton||!queryInput||!stateLabel||!metrics||!output)return;
  let model=Model.create({dimension:12,windowSize:4,heads:3,seed:9173});
  let phraseModel=Composition?Composition.create({dimension:12,seed:24081}):null;
  let checkpointRequiresRetraining=false;
  function save(){
    try{root.localStorage?.setItem(STORAGE_KEY,JSON.stringify({state:model.exportState(),compositionState:phraseModel?phraseModel.exportState():null,corpus:corpusInput.value}));}
    catch(_){}
  }
  function renderStatus(message=""){
    const status=model.status(),phraseStatus=phraseModel&&phraseModel.status();
    stateLabel.textContent=status.trained?"ОБУЧЕНА":"ЕЩЁ НЕ ОБУЧЕНА";
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
  root.NGContextualAttention=model;
  root.NGPhraseComposition=phraseModel;
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
      const report=model.train(rows,{epochs:55,learningRate:0.035,splitSeed:902});
      let phraseReport=null,phraseError="";
      if(phraseModel){try{phraseReport=phraseModel.train(rows,model,root.NGSemanticCore,root.NGKnowledge,{epochs:35,learningRate:0.045});root.NGPhraseComposition=phraseModel;}
        catch(error){phraseError=error.message;}}
      save();
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
      if(phraseReport)renderStatus("Контекстный encoder обучен · фразовый head обучен на слабых метках: "+phraseReport.sentences+" предложений · роли "+phraseReport.roleExamples+" · отношения "+phraseReport.relationExamples+" · training acc "+Math.round(phraseReport.roleTrainingAccuracy*100)+"%/"+Math.round(phraseReport.relationTrainingAccuracy*100)+"%. Это не независимая проверка.");
      else if(phraseError)renderStatus("Контекстная модель обучена; фразовая модель пока не обучилась: "+phraseError);
      stateLabel.textContent="ОБУЧЕНА";
    }catch(error){renderStatus("Обучение не выполнено: "+error.message);}
    finally{trainButton.disabled=false;trainButton.textContent="Обучить контекстную модель";}
  });
  analyseButton.addEventListener("click",()=>{
    const text=queryInput.value.trim();
    if(!text){output.textContent="Введи фразу для анализа.";return;}
    if(!model.status().trained){output.textContent="Сначала обучи модель на нескольких примерах.";return;}
    const analysis=model.analyse(text),lines=[];
    lines.push("ТОЧНЫЙ СЛОВАРЬ: "+analysis.knownTokenCount+"/"+analysis.tokens.length+
      " · морфологическое покрытие: "+analysis.morphologyCoveredTokenCount+"/"+analysis.tokens.length);
    if(analysis.morphologyBackoffTokens.length){
      lines.push("РЕЗЕРВ ПО ОСНОВЕ (это не точная генерация окончания): "+
        analysis.morphologyBackoffTokens.map(row=>row.token+" → "+row.vocabularyToken).join(" · "));
    }
    if(analysis.morphologyAmbiguousTokens.length){
      lines.push("Неоднозначные основы, не засчитанные в покрытие: "+analysis.morphologyAmbiguousTokens.join(" · "));
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
    output.textContent=lines.join("\n")||"Для этой фразы пока недостаточно известных слов.";
  });
})();