"use strict";
self.window=self;
self.importScripts("./knowledge.js","./semantic-core.js","./contextual-attention.js","./phrase-composition.js");
self.onmessage=function(event){
  const rows=event.data&&Array.isArray(event.data.rows)
    ?event.data.rows.map(value=>String(value||"").trim()).filter(Boolean).slice(0,160)
    :[];
  const unique=[...new Set(rows)];
  if(unique.length<3){
    self.postMessage({type:"error",message:"Нужно минимум три разных предложения для обучения."});
    return;
  }
  try{
    if(!self.NGContextualModel||!self.NGPhraseCompositionModel){
      throw new Error("Модули контекстного обучения не загрузились.");
    }
    const model=self.NGContextualModel.create({dimension:12,windowSize:4,heads:3,seed:9173});
    const contextualReport=model.train(unique,{epochs:55,learningRate:0.035,splitSeed:902});
    self.postMessage({type:"progress",message:"Контекстная модель готова. Теперь обучаю распознавание структуры фраз…"});
    const phraseModel=self.NGPhraseCompositionModel.create({dimension:12,seed:24081});
    let phraseReport=null,phraseError="";
    try{
      phraseReport=phraseModel.train(unique,model,self.NGSemanticCore,self.NGKnowledge,{epochs:35,learningRate:0.045});
    }catch(error){phraseError=String(error&&error.message||error);}
    self.postMessage({
      type:"complete",
      contextualState:model.exportState(),
      phraseState:phraseModel.exportState(),
      contextualReport,
      phraseReport,
      phraseError
    });
  }catch(error){
    self.postMessage({type:"error",message:String(error&&error.message||error)});
  }
};
