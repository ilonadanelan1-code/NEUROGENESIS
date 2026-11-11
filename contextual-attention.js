(() => {
"use strict";
const SCHEMA="NG_CONTEXTUAL_ATTENTION_V1",MAX_VOCABULARY=512,MAX_TOKENS=96;
const clean=(value,limit=4000)=>String(value==null?"":value).replace(/\s+/gu," ").trim().slice(0,limit);
function tokenize(value){return clean(value,6000).normalize("NFKC").toLowerCase().replace(/ё/gu,"е").match(/[\p{L}\p{N}]+/gu)?.slice(0,MAX_TOKENS)||[];}
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
function makeRandom(seed){let state=(Math.floor(finite(seed,173))||173)>>>0;return()=>{state+=0x6D2B79F5;let value=state;value=Math.imul(value^value>>>15,value|1);value^=value+Math.imul(value^value>>>7,value|61);return((value^value>>>14)>>>0)/4294967296;};}
function matrix(rows,cols,random,scale){return Array.from({length:rows},()=>Array.from({length:cols},()=>((random()*2)-1)*scale));}
const zeros=n=>Array.from({length:n},()=>0);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const multiply=(weights,vector)=>weights.map(row=>dot(row,vector));
function transposeMultiply(weights,vector){const result=zeros(weights[0]?.length||0);for(let row=0;row<weights.length;row++)for(let col=0;col<result.length;col++)result[col]+=weights[row][col]*vector[row];return result;}
function softmax(values){if(!values.length)return[];const max=Math.max(...values),exponents=values.map(v=>Math.exp(Math.max(-60,Math.min(60,v-max)))),total=exponents.reduce((s,v)=>s+v,0)||1;return exponents.map(v=>v/total);}
function topPredictions(probabilities,vocabulary,limit=4){return probabilities.map((probability,index)=>({token:vocabulary[index],probability})).sort((a,b)=>b.probability-a.probability).slice(0,Math.max(1,Math.min(8,limit)));}
function create(options={}){
 const dimension=Math.max(4,Math.min(48,Math.floor(finite(options.dimension,12))));
 const windowSize=Math.max(1,Math.min(4,Math.floor(finite(options.windowSize,2))));
 const random=makeRandom(options.seed),scale=Math.sqrt(2/(dimension*2));
 const vocabulary=[],indices=new Map(),embeddings=[],positions=matrix(windowSize*2,dimension,random,.04);
 let queryWeights=matrix(dimension,dimension,random,scale),keyWeights=matrix(dimension,dimension,random,scale),valueWeights=matrix(dimension,dimension,random,scale);
 let outputWeights=[],outputBias=[],trainingSteps=0,lastLoss=null,lastTraining=null;
 function addToken(raw){
  const token=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
  if(!token||!/[\p{L}\p{N}]/u.test(token))return-1;
  if(indices.has(token))return indices.get(token);
  if(vocabulary.length>=MAX_VOCABULARY)return-1;
  const index=vocabulary.length;indices.set(token,index);vocabulary.push(token);
  embeddings.push(Array.from({length:dimension},()=>((random()*2)-1)*.08));
  outputWeights.push(Array.from({length:dimension},()=>((random()*2)-1)*.08));outputBias.push(0);return index;
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
  const rows=context.map(item=>{const vector=zeros(dimension),embedding=embeddings[item.tokenIndex],position=positions[item.slot];for(let i=0;i<dimension;i++)vector[i]=embedding[i]+position[i];return{...item,vector};});
  const mean=zeros(dimension);for(const row of rows)for(let i=0;i<dimension;i++)mean[i]+=row.vector[i]/rows.length;
  const query=multiply(queryWeights,mean),keys=rows.map(row=>multiply(keyWeights,row.vector)),values=rows.map(row=>multiply(valueWeights,row.vector));
  const scores=keys.map(key=>dot(query,key)/Math.sqrt(dimension)),attention=softmax(scores),contextual=zeros(dimension);
  for(let row=0;row<rows.length;row++)for(let i=0;i<dimension;i++)contextual[i]+=attention[row]*values[row][i];
  const logits=multiply(outputWeights,contextual).map((v,i)=>v+outputBias[i]);
  return{rows,mean,query,keys,values,attention,contextual,probabilities:softmax(logits)};
 }
 function trainExample(example,learningRate){
  const pass=forward(example.context),loss=-Math.log(Math.max(1e-12,pass.probabilities[example.target]||0));
  const dLogits=pass.probabilities.slice();dLogits[example.target]-=1;
  const dOutputWeights=outputWeights.map((row,i)=>row.map((_,col)=>dLogits[i]*pass.contextual[col]));
  const dContextual=transposeMultiply(outputWeights,dLogits),dAttention=pass.values.map(value=>dot(dContextual,value));
  const weightedGradient=dot(pass.attention,dAttention),dScores=dAttention.map((v,i)=>pass.attention[i]*(v-weightedGradient));
  const dQuery=zeros(dimension),dKeys=pass.keys.map(()=>zeros(dimension)),dValues=pass.values.map(()=>zeros(dimension));
  for(let row=0;row<pass.rows.length;row++)for(let i=0;i<dimension;i++){
   dValues[row][i]=pass.attention[row]*dContextual[i];
   dQuery[i]+=dScores[row]*pass.keys[row][i]/Math.sqrt(dimension);
   dKeys[row][i]=dScores[row]*pass.query[i]/Math.sqrt(dimension);
  }
  const dQueryWeights=queryWeights.map((row,i)=>row.map((_,col)=>dQuery[i]*pass.mean[col]));
  const dMean=transposeMultiply(queryWeights,dQuery),dKeyWeights=matrix(dimension,dimension,()=>0,0),dValueWeights=matrix(dimension,dimension,()=>0,0);
  const embeddingGradients=new Map(),positionGradients=new Map();
  for(let row=0;row<pass.rows.length;row++){
   const item=pass.rows[row],keyInputGradient=transposeMultiply(keyWeights,dKeys[row]),valueInputGradient=transposeMultiply(valueWeights,dValues[row]),dInput=zeros(dimension);
   for(let i=0;i<dimension;i++){
    dInput[i]=keyInputGradient[i]+valueInputGradient[i]+dMean[i]/pass.rows.length;
    for(let col=0;col<dimension;col++){dKeyWeights[i][col]+=dKeys[row][i]*item.vector[col];dValueWeights[i][col]+=dValues[row][i]*item.vector[col];}
   }
   if(!embeddingGradients.has(item.tokenIndex))embeddingGradients.set(item.tokenIndex,zeros(dimension));
   if(!positionGradients.has(item.slot))positionGradients.set(item.slot,zeros(dimension));
   const eg=embeddingGradients.get(item.tokenIndex),pg=positionGradients.get(item.slot);
   for(let i=0;i<dimension;i++){eg[i]+=dInput[i];pg[i]+=dInput[i];}
  }
  const update=(weights,gradients)=>{for(let row=0;row<weights.length;row++)for(let col=0;col<weights[row].length;col++)weights[row][col]-=learningRate*Math.max(-5,Math.min(5,gradients[row][col]||0));};
  update(outputWeights,dOutputWeights);update(queryWeights,dQueryWeights);update(keyWeights,dKeyWeights);update(valueWeights,dValueWeights);
  for(let i=0;i<outputBias.length;i++)outputBias[i]-=learningRate*Math.max(-5,Math.min(5,dLogits[i]));
  for(const[token,gradient]of embeddingGradients)for(let i=0;i<dimension;i++)embeddings[token][i]-=learningRate*Math.max(-5,Math.min(5,gradient[i]));
  for(const[slot,gradient]of positionGradients)for(let i=0;i<dimension;i++)positions[slot][i]-=learningRate*Math.max(-5,Math.min(5,gradient[i]));
  return loss;
 }
 function evaluateExamples(examples){if(!examples.length)return null;let total=0;for(const example of examples){const pass=forward(example.context);total-=Math.log(Math.max(1e-12,pass.probabilities[example.target]||0));}return total/examples.length;}
 function train(texts,trainOptions={}){
  const rows=(Array.isArray(texts)?texts:[texts]).map(v=>clean(v,1200)).filter(Boolean).slice(0,160);
  if(!rows.length)throw new TypeError("Add at least one training sentence.");
  const examples=collectExamples(rows,true);
  if(!examples.length||vocabulary.length<2)throw new Error("Training needs at least two known words in context.");
  const epochs=Math.max(1,Math.min(240,Math.floor(finite(trainOptions.epochs,40)))),learningRate=Math.max(.0001,Math.min(.2,finite(trainOptions.learningRate,.035)));
  const initialLoss=evaluateExamples(examples);let finalLoss=initialLoss;
  for(let epoch=0;epoch<epochs;epoch++){let total=0;for(const example of examples)total+=trainExample(example,learningRate);finalLoss=total/examples.length;}
  trainingSteps+=examples.length*epochs;lastLoss=finalLoss;
  lastTraining={examples:examples.length,epochs,learningRate,initialLoss,finalLoss,lossReduction:initialLoss-finalLoss,vocabularySize:vocabulary.length,trainingSteps};
  return{...lastTraining};
 }
 function score(text,targetIndex){
  const tokens=tokenize(text),safeIndex=Math.max(0,Math.min(tokens.length-1,Math.floor(finite(targetIndex,0))));
  if(!tokens.length||!indices.has(tokens[safeIndex]))return null;
  const sequence=tokens.map(token=>indices.has(token)?indices.get(token):-1),context=contextFor(sequence,safeIndex).filter(row=>row.tokenIndex>=0);
  if(!context.length)return null;const pass=forward(context);
  return{token:tokens[safeIndex],index:safeIndex,contextualVector:pass.contextual.slice(),
   attention:pass.rows.map((row,i)=>({token:tokens[safeIndex+row.offset],offset:row.offset,weight:pass.attention[i]})),
   predictions:topPredictions(pass.probabilities,vocabulary),targetProbability:pass.probabilities[sequence[safeIndex]]||0};
 }
 function analyse(text){const tokens=tokenize(text),positions=[];for(let i=0;i<tokens.length;i++){const row=score(text,i);if(row)positions.push(row);}
  return{schema:SCHEMA,version:1,tokens,vocabularySize:vocabulary.length,trained:trainingSteps>0,positions};}
 function status(){return{schema:SCHEMA,version:1,vocabularySize:vocabulary.length,dimension,windowSize,trainingSteps,trained:trainingSteps>0,lastLoss,lastTraining:lastTraining?{...lastTraining}:null};}
 function exportState(){const copy=rows=>rows.map(row=>row.slice());return{schema:SCHEMA,version:1,dimension,windowSize,vocabulary:vocabulary.slice(),embeddings:copy(embeddings),positions:copy(positions),queryWeights:copy(queryWeights),keyWeights:copy(keyWeights),valueWeights:copy(valueWeights),outputWeights:copy(outputWeights),outputBias:outputBias.slice(),trainingSteps,lastLoss};}
 function loadState(state){
  if(!state||state.schema!==SCHEMA||state.version!==1)throw new TypeError("Unsupported contextual model state.");
  if(state.dimension!==dimension||state.windowSize!==windowSize||!Array.isArray(state.vocabulary)||state.vocabulary.length>MAX_VOCABULARY)throw new TypeError("Contextual model dimensions or vocabulary are invalid.");
  const valid=(rows,n,m)=>Array.isArray(rows)&&rows.length===n&&rows.every(row=>Array.isArray(row)&&row.length===m&&row.every(v=>Number.isFinite(Number(v))));
  const count=state.vocabulary.length;
  if(!valid(state.embeddings,count,dimension)||!valid(state.positions,windowSize*2,dimension)||!valid(state.queryWeights,dimension,dimension)||!valid(state.keyWeights,dimension,dimension)||!valid(state.valueWeights,dimension,dimension)||!valid(state.outputWeights,count,dimension)||!Array.isArray(state.outputBias)||state.outputBias.length!==count||!state.outputBias.every(v=>Number.isFinite(Number(v))))throw new TypeError("Contextual model weights are malformed.");
  vocabulary.length=0;indices.clear();
  state.vocabulary.forEach((token,index)=>{const safe=clean(token,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");if(!safe||indices.has(safe))throw new TypeError("Duplicate or empty vocabulary token.");vocabulary.push(safe);indices.set(safe,index);});
  const copy=rows=>rows.map(row=>row.map(Number));embeddings.length=0;embeddings.push(...copy(state.embeddings));positions.splice(0,positions.length,...copy(state.positions));
  queryWeights=copy(state.queryWeights);keyWeights=copy(state.keyWeights);valueWeights=copy(state.valueWeights);outputWeights=copy(state.outputWeights);outputBias=state.outputBias.map(Number);
  trainingSteps=Math.max(0,Math.floor(finite(state.trainingSteps,0)));lastLoss=Number.isFinite(Number(state.lastLoss))?Number(state.lastLoss):null;return status();
 }
 return Object.freeze({train,analyse,score,status,exportState,loadState,tokenize});
}
function fromState(state){if(!state||state.schema!==SCHEMA)throw new TypeError("Invalid contextual model state.");const model=create({dimension:state.dimension,windowSize:state.windowSize});model.loadState(state);return model;}
const root=typeof window!=="undefined"?window:globalThis;
root.NGContextualModel=Object.freeze({schema:SCHEMA,version:1,create,fromState,tokenize});
})();