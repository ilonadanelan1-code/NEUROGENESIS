(() => {
"use strict";
const SCHEMA="NG_CONTEXTUAL_ATTENTION_V3",MAX_VOCABULARY=512,MAX_TOKENS=96,MAX_WINDOW_SIZE=8;
const clean=(value,limit=4000)=>String(value==null?"":value).replace(/\s+/gu," ").trim().slice(0,limit);
function tokenize(value){return clean(value,6000).normalize("NFKC").toLowerCase().replace(/ё/gu,"е").match(/[\p{L}\p{N}]+/gu)?.slice(0,MAX_TOKENS)||[];}
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
function makeRandom(seed){let state=(Math.floor(finite(seed,173))||173)>>>0;return()=>{state+=0x6D2B79F5;let v=state;v=Math.imul(v^v>>>15,v|1);v^=v+Math.imul(v^v>>>7,v|61);return((v^v>>>14)>>>0)/4294967296;};}
function matrix(rows,cols,random,scale){return Array.from({length:rows},()=>Array.from({length:cols},()=>((random()*2)-1)*scale));}
const zeros=n=>Array.from({length:n},()=>0);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const multiply=(weights,vector)=>weights.map(row=>dot(row,vector));
function transposeMultiply(weights,vector){const result=zeros(weights[0]?.length||0);for(let row=0;row<weights.length;row++)for(let col=0;col<result.length;col++)result[col]+=weights[row][col]*vector[row];return result;}
function softmax(values){if(!values.length)return[];const max=Math.max(...values),exponents=values.map(v=>Math.exp(Math.max(-60,Math.min(60,v-max)))),total=exponents.reduce((sum,v)=>sum+v,0)||1;return exponents.map(v=>v/total);}
function topPredictions(probabilities,vocabulary,limit=4){return probabilities.map((probability,index)=>({token:vocabulary[index],probability})).sort((a,b)=>b.probability-a.probability).slice(0,Math.max(1,Math.min(8,limit)));}
function layerNorm(input,gamma,beta){
 const mean=input.reduce((sum,value)=>sum+value,0)/input.length;
 const variance=input.reduce((sum,value)=>sum+(value-mean)*(value-mean),0)/input.length;
 const inverseStd=1/Math.sqrt(variance+1e-5);
 const normalized=input.map(value=>(value-mean)*inverseStd);
 return{output:normalized.map((value,index)=>value*gamma[index]+beta[index]),normalized,inverseStd};
}
function layerNormBackward(gradient,cache,gamma){
 const scaled=gradient.map((value,index)=>value*gamma[index]);
 const meanScaled=scaled.reduce((sum,value)=>sum+value,0)/scaled.length;
 const meanScaledNorm=scaled.reduce((sum,value,index)=>sum+value*cache.normalized[index],0)/scaled.length;
 const inputGradient=scaled.map((value,index)=>(value-meanScaled-cache.normalized[index]*meanScaledNorm)*cache.inverseStd);
 return{inputGradient,gammaGradient:gradient.map((value,index)=>value*cache.normalized[index]),betaGradient:gradient.slice()};
}
function clipped(value){return Math.max(-5,Math.min(5,value||0));}
function splitCorpus(texts,seed=902){
 const unique=new Map(),rows=(Array.isArray(texts)?texts:[texts]).map(value=>clean(value,1200)).filter(Boolean).slice(0,160);
 for(const row of rows){const identity=tokenize(row).join(" ");if(identity&&!unique.has(identity))unique.set(identity,row);}
 const entries=Array.from(unique.entries());
 if(entries.length<3)throw new TypeError("At least three distinct sentences are required for train, validation and test splits.");
 const safeSeed=Math.floor(finite(seed,902))>>>0;
 const hash=value=>{let result=(2166136261^safeSeed)>>>0;for(let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619);}return result>>>0;};
 entries.sort((a,b)=>hash(a[0])-hash(b[0])||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
 let trainCount=Math.max(1,Math.floor(entries.length*.7)),validationCount=Math.max(1,Math.floor(entries.length*.15));
 if(trainCount+validationCount>=entries.length){trainCount=entries.length-2;validationCount=1;}
 const rowsFrom=(start,end)=>entries.slice(start,end).map(entry=>entry[1]);
 return{train:rowsFrom(0,trainCount),validation:rowsFrom(trainCount,trainCount+validationCount),
  test:rowsFrom(trainCount+validationCount,entries.length),uniqueRows:entries.length,duplicateRows:rows.length-entries.length,seed:safeSeed};
}
function create(options={}){
 const dimension=Math.max(4,Math.min(48,Math.floor(finite(options.dimension,12))));
 const requestedHeads=Math.max(1,Math.min(6,Math.floor(finite(options.heads,3))));
 const heads=dimension%requestedHeads===0?requestedHeads:
  (options.heads==null?[3,2,1].find(value=>dimension%value===0):0);
 if(!heads)throw new RangeError("Model dimension must be divisible by the requested attention heads.");
 const headDimension=dimension/heads,feedForwardDimension=dimension*2;
 const windowSize=Math.max(1,Math.min(MAX_WINDOW_SIZE,Math.floor(finite(options.windowSize,4))));
 const random=makeRandom(options.seed),tokenSeed=finite(options.seed,173)+104729;
 let tokenRandom=makeRandom(tokenSeed);
 const scale=Math.sqrt(2/(dimension+headDimension));
 const vocabulary=[],indices=new Map(),embeddings=[],positions=matrix(windowSize*2,dimension,random,.04);
 const relativePositionBias=Array.from({length:heads},()=>zeros(windowSize*2));
 const attentionHeads=Array.from({length:heads},()=>({
  query:matrix(headDimension,dimension,random,scale),
  key:matrix(headDimension,dimension,random,scale),
  value:matrix(headDimension,dimension,random,scale)
 }));
 let attentionOutput=matrix(dimension,dimension,random,Math.sqrt(2/(dimension*2)));
 let norm1Gamma=Array.from({length:dimension},()=>1),norm1Beta=zeros(dimension);
 let norm2Gamma=Array.from({length:dimension},()=>1),norm2Beta=zeros(dimension);
 let feedForward1=matrix(feedForwardDimension,dimension,random,Math.sqrt(2/dimension));
 let feedForward1Bias=zeros(feedForwardDimension);
 let feedForward2=matrix(dimension,feedForwardDimension,random,Math.sqrt(2/feedForwardDimension));
 let feedForward2Bias=zeros(dimension);
 let outputWeights=[],outputBias=[],trainingSteps=0,lastLoss=null,lastTraining=null;

 function addToken(raw){
  const token=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
  if(!token||!/[\p{L}\p{N}]/u.test(token))return-1;
  if(indices.has(token))return indices.get(token);
  if(vocabulary.length>=MAX_VOCABULARY)return-1;
  const index=vocabulary.length;indices.set(token,index);vocabulary.push(token);
  embeddings.push(Array.from({length:dimension},()=>((tokenRandom()*2)-1)*.08));
  outputWeights.push(Array.from({length:dimension},()=>((tokenRandom()*2)-1)*.08));outputBias.push(0);
  return index;
 }
 function contextFor(sequence,targetIndex){
  const context=[];
  for(let offset=-windowSize;offset<=windowSize;offset++){
   if(offset===0)continue;const position=targetIndex+offset;
   if(position<0||position>=sequence.length)continue;const tokenIndex=sequence[position];
   if(tokenIndex==null||tokenIndex<0)continue;
   const slot=offset<0?offset+windowSize:offset+windowSize-1;
   context.push({tokenIndex,slot,offset});
  }return context;
 }
 function collectExamples(rows,expand){
  const examples=[];
  for(const row of rows.slice(0,160)){
   const sequence=expand?tokenize(row).map(addToken):tokenize(row).map(token=>indices.has(token)?indices.get(token):-1);
   for(let i=0;i<sequence.length;i++){const context=contextFor(sequence,i);if(sequence[i]>=0&&context.length)examples.push({context,target:sequence[i]});}
  }return examples;
 }
 function forward(context){
  const rows=context.map(item=>{
   const vector=zeros(dimension),embedding=embeddings[item.tokenIndex],position=positions[item.slot];
   for(let i=0;i<dimension;i++)vector[i]=embedding[i]+position[i];
   return{...item,vector};
  });
  const mean=zeros(dimension);
  for(const row of rows)for(let i=0;i<dimension;i++)mean[i]+=row.vector[i]/rows.length;
  const headPasses=[],concatenated=[];
  for(let h=0;h<heads;h++){
   const parameters=attentionHeads[h],query=multiply(parameters.query,mean);
   const keys=rows.map(row=>multiply(parameters.key,row.vector));
   const values=rows.map(row=>multiply(parameters.value,row.vector));
   const scores=keys.map((key,index)=>dot(query,key)/Math.sqrt(headDimension)+relativePositionBias[h][rows[index].slot]);
   const weights=softmax(scores),vector=zeros(headDimension);
   for(let row=0;row<rows.length;row++)for(let i=0;i<headDimension;i++)vector[i]+=weights[row]*values[row][i];
   headPasses.push({query,keys,values,scores,weights,vector});
   concatenated.push(...vector);
  }
  const projected=multiply(attentionOutput,concatenated);
  const residual1=mean.map((value,index)=>value+projected[index]);
  const norm1=layerNorm(residual1,norm1Gamma,norm1Beta);
  const ffPre=multiply(feedForward1,norm1.output).map((value,index)=>value+feedForward1Bias[index]);
  const ffHidden=ffPre.map(value=>Math.max(0,value));
  const ffOutput=multiply(feedForward2,ffHidden).map((value,index)=>value+feedForward2Bias[index]);
  const residual2=norm1.output.map((value,index)=>value+ffOutput[index]);
  const norm2=layerNorm(residual2,norm2Gamma,norm2Beta);
  const logits=multiply(outputWeights,norm2.output).map((value,index)=>value+outputBias[index]);
  return{rows,mean,headPasses,concatenated,projected,residual1,norm1,ffPre,ffHidden,ffOutput,residual2,norm2,probabilities:softmax(logits)};
 }
 function trainExample(example,learningRate){
  const pass=forward(example.context),loss=-Math.log(Math.max(1e-12,pass.probabilities[example.target]||0));
  const dLogits=pass.probabilities.slice();dLogits[example.target]-=1;
  const dOutputWeights=outputWeights.map((row,i)=>row.map((_,col)=>dLogits[i]*pass.norm2.output[col]));
  const dNorm2=transposeMultiply(outputWeights,dLogits);
  const ln2=layerNormBackward(dNorm2,pass.norm2,norm2Gamma);
  const dResidual2=ln2.inputGradient;
  const dNorm1Direct=dResidual2.slice(),dFfOutput=dResidual2.slice();
  const dFeedForward2=feedForward2.map((row,i)=>row.map((_,col)=>dFfOutput[i]*pass.ffHidden[col]));
  const dFeedForward2Bias=dFfOutput.slice();
  const dFfHidden=transposeMultiply(feedForward2,dFfOutput);
  const dFfPre=dFfHidden.map((value,index)=>pass.ffPre[index]>0?value:0);
  const dFeedForward1=feedForward1.map((row,i)=>row.map((_,col)=>dFfPre[i]*pass.norm1.output[col]));
  const dFeedForward1Bias=dFfPre.slice();
  const dNorm1FromFf=transposeMultiply(feedForward1,dFfPre);
  const dNorm1=dNorm1Direct.map((value,index)=>value+dNorm1FromFf[index]);
  const ln1=layerNormBackward(dNorm1,pass.norm1,norm1Gamma);
  const dResidual1=ln1.inputGradient;
  const dMean=dResidual1.slice(),dProjected=dResidual1.slice();
  const dAttentionOutput=attentionOutput.map((row,i)=>row.map((_,col)=>dProjected[i]*pass.concatenated[col]));
  const dConcatenated=transposeMultiply(attentionOutput,dProjected);
  const headGradients=[];
  for(let h=0;h<heads;h++){
   const head=pass.headPasses[h],offset=h*headDimension;
   const dHead=dConcatenated.slice(offset,offset+headDimension);
   const dAttention=head.values.map(value=>dot(dHead,value));
   const weightedGradient=dot(head.weights,dAttention);
   const dScores=dAttention.map((value,index)=>head.weights[index]*(value-weightedGradient));
   const dQuery=zeros(headDimension),dKeys=head.keys.map(()=>zeros(headDimension)),dValues=head.values.map(()=>zeros(headDimension));
   for(let row=0;row<pass.rows.length;row++)for(let i=0;i<headDimension;i++){
    dValues[row][i]=head.weights[row]*dHead[i];
    dQuery[i]+=dScores[row]*head.keys[row][i]/Math.sqrt(headDimension);
    dKeys[row][i]=dScores[row]*head.query[i]/Math.sqrt(headDimension);
   }
   const parameters=attentionHeads[h];
   const dQueryWeights=parameters.query.map((row,i)=>row.map((_,col)=>dQuery[i]*pass.mean[col]));
   const dKeyWeights=matrix(headDimension,dimension,()=>0,0),dValueWeights=matrix(headDimension,dimension,()=>0,0);
   const dMeanFromQuery=transposeMultiply(parameters.query,dQuery);
   for(let i=0;i<dimension;i++)dMean[i]+=dMeanFromQuery[i];
   const dInputRows=[];
   for(let row=0;row<pass.rows.length;row++){
    const item=pass.rows[row];
    const dKeyWeightInput=transposeMultiply(parameters.key,dKeys[row]);
    const dValueWeightInput=transposeMultiply(parameters.value,dValues[row]);
    const dInput=dKeyWeightInput.map((value,index)=>value+dValueWeightInput[index]);
    for(let i=0;i<headDimension;i++)for(let col=0;col<dimension;col++){
     dKeyWeights[i][col]+=dKeys[row][i]*item.vector[col];
     dValueWeights[i][col]+=dValues[row][i]*item.vector[col];
    }
    dInputRows.push(dInput);
   }
   headGradients.push({dQueryWeights,dKeyWeights,dValueWeights,dInputRows,dRelativePositionBias:dScores.slice()});
  }
  const embeddingGradients=new Map(),positionGradients=new Map();
  for(let row=0;row<pass.rows.length;row++){
   const item=pass.rows[row],gradient=dMean.map(value=>value/pass.rows.length);
   for(const headGradient of headGradients)for(let i=0;i<dimension;i++)gradient[i]+=headGradient.dInputRows[row][i];
   if(!embeddingGradients.has(item.tokenIndex))embeddingGradients.set(item.tokenIndex,zeros(dimension));
   if(!positionGradients.has(item.slot))positionGradients.set(item.slot,zeros(dimension));
   const eg=embeddingGradients.get(item.tokenIndex),pg=positionGradients.get(item.slot);
   for(let i=0;i<dimension;i++){eg[i]+=gradient[i];pg[i]+=gradient[i];}
  }
  const update=(weights,gradients)=>{for(let row=0;row<weights.length;row++)for(let col=0;col<weights[row].length;col++)weights[row][col]-=learningRate*clipped(gradients[row][col]);};
  const updateVector=(weights,gradients)=>{for(let i=0;i<weights.length;i++)weights[i]-=learningRate*clipped(gradients[i]);};
  update(outputWeights,dOutputWeights);update(attentionOutput,dAttentionOutput);
  update(feedForward1,dFeedForward1);update(feedForward2,dFeedForward2);
  updateVector(outputBias,dLogits);updateVector(feedForward1Bias,dFeedForward1Bias);updateVector(feedForward2Bias,dFeedForward2Bias);
  updateVector(norm1Gamma,ln1.gammaGradient);updateVector(norm1Beta,ln1.betaGradient);
  updateVector(norm2Gamma,ln2.gammaGradient);updateVector(norm2Beta,ln2.betaGradient);
  for(let h=0;h<heads;h++){
   update(attentionHeads[h].query,headGradients[h].dQueryWeights);
   update(attentionHeads[h].key,headGradients[h].dKeyWeights);
   update(attentionHeads[h].value,headGradients[h].dValueWeights);
   updateVector(relativePositionBias[h],headGradients[h].dRelativePositionBias);
  }
  for(const[token,gradient]of embeddingGradients)updateVector(embeddings[token],gradient);
  for(const[slot,gradient]of positionGradients)updateVector(positions[slot],gradient);
  return loss;
 }
 function evaluateExamples(examples){
  if(!examples.length)return{loss:null,accuracy:null,examples:0};
  let total=0,correct=0;
  for(const example of examples){
   const probabilities=forward(example.context).probabilities;
   total-=Math.log(Math.max(1e-12,probabilities[example.target]||0));
   let best=0;for(let i=1;i<probabilities.length;i++)if(probabilities[i]>probabilities[best])best=i;
   if(best===example.target)correct++;
  }
  return{loss:total/examples.length,accuracy:correct/examples.length,examples:examples.length};
 }
 function train(texts,trainOptions={}){
  const rows=(Array.isArray(texts)?texts:[texts]).map(value=>clean(value,1200)).filter(Boolean).slice(0,160);
  if(!rows.length)throw new TypeError("Add at least one training sentence.");
  const split=splitCorpus(rows,trainOptions.splitSeed);
  loadState(initialCheckpoint);tokenRandom=makeRandom(tokenSeed);
  let trainRows=split.train,validationRows=split.validation,testRows=split.test;
  let trainExamples=collectExamples(trainRows,true);
  let validationExamples=collectExamples(validationRows,false),testExamples=collectExamples(testRows,false);
  let evaluationMode="held_out_sentences",splitFallback=false;
  if(!validationExamples.length){
   // Tiny/low-overlap corpora cannot support meaningful sentence-level validation.
   // Train on the complete corpus, but explicitly report that no held-out score exists.
   loadState(initialCheckpoint);tokenRandom=makeRandom(tokenSeed);
   trainRows=rows;validationRows=[];testRows=[];
   trainExamples=collectExamples(trainRows,true);validationExamples=[];testExamples=[];
   evaluationMode="train_only_insufficient_validation";splitFallback=true;
  }
  if(!trainExamples.length||vocabulary.length<2)throw new Error("Training needs at least two known words in the training corpus.");
  const epochs=Math.max(1,Math.min(240,Math.floor(finite(trainOptions.epochs,40))));
  const learningRate=Math.max(.0001,Math.min(.2,finite(trainOptions.learningRate,.025)));
  const patience=Math.max(2,Math.min(60,Math.floor(finite(trainOptions.patience,Math.max(6,Math.min(30,epochs*.25))))));
  const initialTrain=evaluateExamples(trainExamples);
  const initialValidation=validationExamples.length?evaluateExamples(validationExamples):{loss:null,accuracy:null,examples:0};
  let bestValidationLoss=initialValidation.loss,bestEpoch=0,bestState=exportState(),staleEpochs=0,epochsRun=0,earlyStopped=false;
  if(splitFallback){
   for(let epoch=0;epoch<epochs;epoch++){for(const example of trainExamples)trainExample(example,learningRate);trainingSteps+=trainExamples.length;epochsRun=epoch+1;}
   bestEpoch=null;bestState=exportState();
  }else{
   for(let epoch=0;epoch<epochs;epoch++){
    for(const example of trainExamples)trainExample(example,learningRate);
    trainingSteps+=trainExamples.length;epochsRun=epoch+1;
    const validation=evaluateExamples(validationExamples);
    if(validation.loss<bestValidationLoss-1e-8){bestValidationLoss=validation.loss;bestEpoch=epochsRun;bestState=exportState();staleEpochs=0;}
    else{staleEpochs++;if(staleEpochs>=patience){earlyStopped=epochsRun<epochs;break;}}
   }
  }
  const attemptedSteps=trainingSteps;loadState(bestState);const selectedSteps=trainingSteps;
  const finalTrain=evaluateExamples(trainExamples);
  const finalValidation=validationExamples.length?evaluateExamples(validationExamples):{loss:null,accuracy:null,examples:0};
  const finalTest=testExamples.length?evaluateExamples(testExamples):{loss:null,accuracy:null,examples:0};
  lastLoss=finalTrain.loss;
  const eligibleTargets=rowsForTargets(validationRows)+rowsForTargets(testRows),coveredTargets=validationExamples.length+testExamples.length;
  lastTraining={examples:trainExamples.length,trainExamples:trainExamples.length,validationExamples:validationExamples.length,
   testExamples:testExamples.length,trainRows:trainRows.length,validationRows:validationRows.length,testRows:testRows.length,
   requestedTrainRows:split.train.length,requestedValidationRows:split.validation.length,requestedTestRows:split.test.length,
   uniqueRows:split.uniqueRows,duplicateRows:split.duplicateRows,splitSeed:split.seed,splitFallback,
   evaluationMode,evaluationAvailable:!splitFallback&&validationExamples.length>0,epochs:epochsRun,requestedEpochs:epochs,
   bestEpoch,patience,earlyStopped,learningRate,initialLoss:initialTrain.loss,finalLoss:finalTrain.loss,
   initialValidationLoss:initialValidation.loss,validationLoss:finalValidation.loss,validationAccuracy:finalValidation.accuracy,
   testLoss:finalTest.loss,testAccuracy:finalTest.accuracy,
   validationCoverage:validationExamples.length?validationExamples.length/Math.max(1,rowsForTargets(validationRows)):null,
   testCoverage:testExamples.length?testExamples.length/Math.max(1,rowsForTargets(testRows)):null,
   heldOutCoverage:eligibleTargets?coveredTargets/eligibleTargets:null,evaluationIsolated:!splitFallback,
   lossReduction:initialTrain.loss-finalTrain.loss,vocabularySize:vocabulary.length,
   trainingSteps:selectedSteps,attemptedTrainingSteps:attemptedSteps,heads,headDimension,feedForwardDimension};
  return{...lastTraining};
 }
 function rowsForTargets(rows){
  let count=0;for(const row of rows){const tokens=tokenize(row);if(tokens.length>1)count+=tokens.length;}
  return count;
 }
 function score(text,targetIndex){
  const tokens=tokenize(text),safeIndex=Math.max(0,Math.min(tokens.length-1,Math.floor(finite(targetIndex,0))));
  if(!tokens.length||!indices.has(tokens[safeIndex]))return null;
  const sequence=tokens.map(token=>indices.has(token)?indices.get(token):-1);
  const context=contextFor(sequence,safeIndex).filter(row=>row.tokenIndex>=0);
  if(!context.length)return null;
  const pass=forward(context),headRows=pass.headPasses.map((head,index)=>({
   head:index+1,attention:pass.rows.map((row,position)=>({token:tokens[safeIndex+row.offset],offset:row.offset,distance:Math.abs(row.offset),weight:head.weights[position]})),
   relativePositionBias:relativePositionBias[index].slice(),vector:head.vector.slice()
  }));
  const aggregate=pass.rows.map((row,index)=>({token:tokens[safeIndex+row.offset],offset:row.offset,distance:Math.abs(row.offset),
   weight:pass.headPasses.reduce((sum,head)=>sum+head.weights[index],0)/heads}));
  return{token:tokens[safeIndex],index:safeIndex,contextualVector:pass.norm2.output.slice(),attention:aggregate,heads:headRows,
   predictions:topPredictions(pass.probabilities,vocabulary),targetProbability:pass.probabilities[sequence[safeIndex]]||0,
   normalization:{first:pass.norm1.output.slice(),second:pass.norm2.output.slice()},
   feedForward:{hidden:pass.ffHidden.slice(),output:pass.ffOutput.slice()}};
 }
 function analyse(text){const tokens=tokenize(text),positions=[];for(let i=0;i<tokens.length;i++){const row=score(text,i);if(row)positions.push(row);}
  return{schema:SCHEMA,version:3,tokens,vocabularySize:vocabulary.length,trained:trainingSteps>0,heads,headDimension,feedForwardDimension,windowSize,maxWindowSize:MAX_WINDOW_SIZE,positions};}
 function status(){return{schema:SCHEMA,version:3,vocabularySize:vocabulary.length,dimension,windowSize,maxWindowSize:MAX_WINDOW_SIZE,heads,headDimension,
  feedForwardDimension,trainingSteps,trained:trainingSteps>0,lastLoss,lastTraining:lastTraining?{...lastTraining}:null};}
 function exportState(){
  const copy=rows=>rows.map(row=>row.slice());
  return{schema:SCHEMA,version:3,dimension,windowSize,heads,vocabulary:vocabulary.slice(),embeddings:copy(embeddings),
   positions:copy(positions),relativePositionBias:copy(relativePositionBias),attentionHeads:attentionHeads.map(head=>({query:copy(head.query),key:copy(head.key),value:copy(head.value)})),
   attentionOutput:copy(attentionOutput),norm1Gamma:norm1Gamma.slice(),norm1Beta:norm1Beta.slice(),
   norm2Gamma:norm2Gamma.slice(),norm2Beta:norm2Beta.slice(),feedForward1:copy(feedForward1),
   feedForward1Bias:feedForward1Bias.slice(),feedForward2:copy(feedForward2),feedForward2Bias:feedForward2Bias.slice(),
   outputWeights:copy(outputWeights),outputBias:outputBias.slice(),trainingSteps,lastLoss,lastTraining:lastTraining?{...lastTraining}:null};
 }
 function loadState(state){
  if(!state||state.schema!==SCHEMA||state.version!==3)throw new TypeError("Unsupported contextual model state.");
  if(state.dimension!==dimension||state.windowSize!==windowSize||state.heads!==heads||
   !Array.isArray(state.vocabulary)||state.vocabulary.length>MAX_VOCABULARY)throw new TypeError("Contextual model dimensions, heads or vocabulary are invalid.");
  const validMatrix=(rows,rowCount,colCount)=>Array.isArray(rows)&&rows.length===rowCount&&rows.every(row=>
   Array.isArray(row)&&row.length===colCount&&row.every(value=>Number.isFinite(Number(value))));
  const validVector=(values,length)=>Array.isArray(values)&&values.length===length&&values.every(value=>Number.isFinite(Number(value)));
  const count=state.vocabulary.length;
  const validHeads=Array.isArray(state.attentionHeads)&&state.attentionHeads.length===heads&&state.attentionHeads.every(head=>
   head&&validMatrix(head.query,headDimension,dimension)&&validMatrix(head.key,headDimension,dimension)&&validMatrix(head.value,headDimension,dimension));
  if(!validMatrix(state.embeddings,count,dimension)||!validMatrix(state.positions,windowSize*2,dimension)||
   !validMatrix(state.relativePositionBias,heads,windowSize*2)||!validHeads||
   !validMatrix(state.attentionOutput,dimension,dimension)||!validVector(state.norm1Gamma,dimension)||!validVector(state.norm1Beta,dimension)||
   !validVector(state.norm2Gamma,dimension)||!validVector(state.norm2Beta,dimension)||
   !validMatrix(state.feedForward1,feedForwardDimension,dimension)||!validVector(state.feedForward1Bias,feedForwardDimension)||
   !validMatrix(state.feedForward2,dimension,feedForwardDimension)||!validVector(state.feedForward2Bias,dimension)||
   !validMatrix(state.outputWeights,count,dimension)||!validVector(state.outputBias,count))
   throw new TypeError("Contextual model weights are malformed.");
  vocabulary.length=0;indices.clear();
  state.vocabulary.forEach((token,index)=>{const safe=clean(token,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
   if(!safe||indices.has(safe))throw new TypeError("Duplicate or empty vocabulary token.");vocabulary.push(safe);indices.set(safe,index);});
  const copy=rows=>rows.map(row=>row.map(Number)),copyVector=values=>values.map(Number);
  embeddings.length=0;embeddings.push(...copy(state.embeddings));positions.splice(0,positions.length,...copy(state.positions));
  relativePositionBias.splice(0,relativePositionBias.length,...copy(state.relativePositionBias));
  for(let h=0;h<heads;h++){attentionHeads[h].query=copy(state.attentionHeads[h].query);attentionHeads[h].key=copy(state.attentionHeads[h].key);attentionHeads[h].value=copy(state.attentionHeads[h].value);}
  attentionOutput=copy(state.attentionOutput);norm1Gamma=copyVector(state.norm1Gamma);norm1Beta=copyVector(state.norm1Beta);
  norm2Gamma=copyVector(state.norm2Gamma);norm2Beta=copyVector(state.norm2Beta);
  feedForward1=copy(state.feedForward1);feedForward1Bias=copyVector(state.feedForward1Bias);
  feedForward2=copy(state.feedForward2);feedForward2Bias=copyVector(state.feedForward2Bias);
  outputWeights=copy(state.outputWeights);outputBias=copyVector(state.outputBias);
  trainingSteps=Math.max(0,Math.floor(finite(state.trainingSteps,0)));lastLoss=Number.isFinite(Number(state.lastLoss))?Number(state.lastLoss):null;
  const report=state.lastTraining;
  lastTraining=report&&typeof report==="object"&&
   (report.validationLoss==null||Number.isFinite(Number(report.validationLoss)))
   ?{...report,validationLoss:report.validationLoss==null?null:Number(report.validationLoss),
     testLoss:report.testLoss==null?null:Number(report.testLoss)}:null;
  return status();
 }
 const initialCheckpoint=exportState();
 return Object.freeze({train,analyse,score,status,exportState,loadState,tokenize,splitCorpus});
}
function fromState(state){if(!state||state.schema!==SCHEMA)throw new TypeError("Invalid contextual model state.");const model=create({dimension:state.dimension,windowSize:state.windowSize,heads:state.heads});model.loadState(state);return model;}
const root=typeof window!=="undefined"?window:globalThis;
root.NGContextualModel=Object.freeze({schema:SCHEMA,version:3,create,fromState,tokenize});
})();