(() => {
"use strict";
const SCHEMA="NG_PHRASE_COMPOSITION_V1",ROLES=["other","subject","predicate","object"],
 RELATIONS=["none","subject_to_predicate","predicate_to_object","subject_to_object"],MAX_SENTENCES=160,MAX_TOKENS=48;
function normaliseFrameText(value){return String(value==null?"":value).normalize("NFKC").toLowerCase().replace(/ё/gu,"е").replace(/\s+/gu," ").trim();}

const clean=(value,limit=500)=>String(value==null?"":value).replace(/\s+/gu," ").trim().slice(0,limit);
const zeros=n=>Array.from({length:n},()=>0);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const softmax=values=>{const max=Math.max(...values),exps=values.map(v=>Math.exp(Math.max(-40,Math.min(40,v-max)))),sum=exps.reduce((a,b)=>a+b,0)||1;return exps.map(v=>v/sum);};
const makeRandom=seed=>{let state=(Math.floor(Number(seed)||431)>>>0)||431;return()=>{state+=0x6D2B79F5;let v=state;v=Math.imul(v^v>>>15,v|1);v^=v+Math.imul(v^v>>>7,v|61);return((v^v>>>14)>>>0)/4294967296;};};
function matrix(rows,cols,random,scale){return Array.from({length:rows},()=>Array.from({length:cols},()=>((random()*2)-1)*scale));}
function normalToken(value){return clean(value,64).normalize("NFKC").toLowerCase().replace(/ё/gu,"е").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,"");}
function spanIndexes(tokens,phrase,tokenize){
 const wanted=tokenize(phrase).map(normalToken).filter(Boolean);if(!wanted.length)return[];
 const haystack=tokens.map(normalToken),out=[];
 for(let i=0;i<=haystack.length-wanted.length;i++){
  if(wanted.every((word,index)=>haystack[i+index]===word))for(let j=0;j<wanted.length;j++)out.push(i+j);
 }
 return out;
}
function create(options={}){
 const dimension=Math.max(4,Math.min(48,Math.floor(Number(options.dimension)||12))),featureSize=dimension*2,pairSize=featureSize*3+2;
 const random=makeRandom(options.seed||431),roleWeights=matrix(ROLES.length,featureSize,random,.035),roleBias=zeros(ROLES.length);
 const relationWeights=matrix(RELATIONS.length,pairSize,random,.025),relationBias=zeros(RELATIONS.length);
 let trainingSteps=0,lastTraining=null;
 const tokenize=text=>String(text||"").normalize("NFKC").toLowerCase().replace(/ё/gu,"е").match(/[\p{L}\p{N}]+/gu)?.slice(0,MAX_TOKENS)||[];
 function build(text,contextual,core,knowledge){
  if(!contextual||typeof contextual.score!=="function"||!contextual.status().trained)throw new TypeError("Train the contextual transformer before phrase composition.");
  if(!core||typeof core.analyse!=="function")throw new TypeError("The semantic core is required for weak phrase labels.");
  const tokens=tokenize(text).slice(0,MAX_TOKENS);
  const features=tokens.map((_,index)=>{
   const score=contextual.score(text,index),tokenVector=score&&Array.isArray(score.tokenVector)?score.tokenVector:zeros(dimension);
   const contextVector=score&&Array.isArray(score.contextualVector)?score.contextualVector:zeros(dimension);
   return tokenVector.slice(0,dimension).concat(contextVector.slice(0,dimension)).map(value=>Number.isFinite(value)?value:0);
  });
  const frame=core.analyse(text,{contextRelation:"new_topic"},knowledge).proposition||{};
  const labels=zeros(tokens.length),spans={
   subject:spanIndexes(tokens,frame.subject,tokenize),
   predicate:spanIndexes(tokens,frame.predicate,tokenize),
   object:spanIndexes(tokens,frame.object,tokenize)
  };
  for(const [role,indexes] of [["subject",spans.subject],["predicate",spans.predicate],["object",spans.object]]){
   const label=ROLES.indexOf(role);for(const index of indexes)if(labels[index]===0)labels[index]=label;
  }
  const positives=[],positiveKeys=new Set();
  const addPositive=(left,right,label)=>{const key=left+":"+right;if(left!==right&&!positiveKeys.has(key)){positiveKeys.add(key);positives.push({left,right,label});}};
  for(const left of spans.subject)for(const right of spans.predicate)addPositive(left,right,1);
  for(const left of spans.predicate)for(const right of spans.object)addPositive(left,right,2);
  for(const left of spans.subject)for(const right of spans.object)addPositive(left,right,3);
  const candidates=[];
  for(let left=0;left<tokens.length;left++)for(let right=0;right<tokens.length;right++){
   if(left===right||Math.abs(right-left)>8||positiveKeys.has(left+":"+right))continue;
   candidates.push({left,right,label:0});
  }
  const maxNegatives=Math.min(candidates.length,Math.max(2,positives.length*3)),negatives=[];
  for(let i=0;i<maxNegatives;i++)negatives.push(candidates[Math.floor(i*candidates.length/Math.max(1,maxNegatives))]);
  const relationExamples=positives.concat(negatives).map(pair=>({...pair,features:pairFeatures(features[pair.left],features[pair.right],pair.right-pair.left)}));
  return{tokens,features,labels,spans,relationExamples,frame};
 }
 function pairFeatures(left,right,offset){
  const product=left.map((value,index)=>value*right[index]);
  return left.concat(right,product,[Math.max(-1,Math.min(1,offset/8)),Math.min(1,Math.abs(offset)/8)]);
 }
 function probabilities(weights,bias,features){return softmax(weights.map((row,index)=>dot(row,features)+bias[index]));}
 function update(weights,bias,features,label,learningRate,classWeight=1){
  const probs=probabilities(weights,bias,features);
  for(let row=0;row<weights.length;row++){
   const gradient=(probs[row]-(row===label?1:0))*classWeight;
   for(let col=0;col<features.length;col++)weights[row][col]-=learningRate*Math.max(-3,Math.min(3,gradient*features[col]));
   bias[row]-=learningRate*Math.max(-3,Math.min(3,gradient));
  }
  return{probs,loss:-Math.log(Math.max(1e-12,probs[label]))};
 }
 function train(texts,contextual,core,knowledge,trainOptions={}){
  const rows=(Array.isArray(texts)?texts:[texts]).map(value=>clean(value,1200)).filter(Boolean).slice(0,MAX_SENTENCES);
  if(!rows.length)throw new TypeError("Add sentences for phrase-structure training.");
  const prepared=rows.map(text=>({text,data:build(text,contextual,core,knowledge)})).filter(row=>row.data.labels.some(label=>label>0));
  const roleExamples=prepared.flatMap(row=>row.data.features.map((features,index)=>({features,label:row.data.labels[index]})));
  const relationExamples=prepared.flatMap(row=>row.data.relationExamples);
  if(!prepared.length||!roleExamples.some(row=>row.label>0))throw new Error("The semantic parser could not identify subject, predicate or object spans in this corpus.");
  if(!relationExamples.some(row=>row.label>0))throw new Error("The corpus does not contain enough aligned phrase relations.");
  const epochs=Math.max(1,Math.min(120,Math.floor(Number(trainOptions.epochs)||35)));
  const learningRate=Math.max(.001,Math.min(.2,Number(trainOptions.learningRate)||.055));
  let roleLoss=0,relationLoss=0;
  const roleCounts=zeros(ROLES.length),relationCounts=zeros(RELATIONS.length);
  for(const row of roleExamples)roleCounts[row.label]++;
  for(const row of relationExamples)relationCounts[row.label]++;
  for(let epoch=0;epoch<epochs;epoch++){
   roleLoss=0;relationLoss=0;
   for(const example of roleExamples){
    const weight=example.label===0?.45:1.4,updated=update(roleWeights,roleBias,example.features,example.label,learningRate,weight);
    roleLoss+=updated.loss*weight;
   }
   for(const example of relationExamples){
    const weight=example.label===0?.35:2.0,updated=update(relationWeights,relationBias,example.features,example.label,learningRate,weight);
    relationLoss+=updated.loss*weight;
   }
   trainingSteps+=roleExamples.length+relationExamples.length;
  }
  const roleCorrect=roleExamples.filter(row=>argmax(probabilities(roleWeights,roleBias,row.features))===row.label).length;
  const relationCorrect=relationExamples.filter(row=>argmax(probabilities(relationWeights,relationBias,row.features))===row.label).length;
  lastTraining={sentences:prepared.length,roleExamples:roleExamples.length,relationExamples:relationExamples.length,positiveRelations:relationExamples.filter(row=>row.label>0).length,
   roleCounts,relationCounts,epochs,learningRate,roleTrainingAccuracy:roleCorrect/roleExamples.length,relationTrainingAccuracy:relationCorrect/relationExamples.length,
   roleTrainingLoss:roleLoss/roleExamples.length,relationTrainingLoss:relationLoss/relationExamples.length,
   supervision:"weak_semantic_parser_labels",evaluation:"training_only_not_held_out"};
  return{...lastTraining};
 }
 function argmax(values){let best=0;for(let i=1;i<values.length;i++)if(values[i]>values[best])best=i;return best;}
 function analyse(text,contextual,core,knowledge){
  const data=build(text,contextual,core,knowledge);
  const roles=data.features.map((features,index)=>{
   const distribution=probabilities(roleWeights,roleBias,features),role=argmax(distribution);
   return{index,token:data.tokens[index],role:ROLES[role],roleId:role,confidence:distribution[role],probabilities:Object.fromEntries(ROLES.map((name,i)=>[name,distribution[i]])),weakRole:ROLES[data.labels[index]]};
  });
  const relationCandidates=[];
  for(let left=0;left<data.tokens.length;left++)for(let right=0;right<data.tokens.length;right++){
   if(left===right||Math.abs(right-left)>8)continue;
   const distribution=probabilities(relationWeights,relationBias,pairFeatures(data.features[left],data.features[right],right-left));
   const relation=argmax(distribution);
   if(relation>0)relationCandidates.push({from:left,to:right,fromToken:data.tokens[left],toToken:data.tokens[right],relation:RELATIONS[relation],confidence:distribution[relation],probabilities:Object.fromEntries(RELATIONS.map((name,i)=>[name,distribution[i]]))});
  }
  relationCandidates.sort((a,b)=>b.confidence-a.confidence);
  const edges=relationCandidates.filter(edge=>edge.confidence>=.34).slice(0,16),nodes=[];
  for(let i=0;i<roles.length;i++){
   const item=roles[i];if(item.roleId===0||item.confidence<.30)continue;
   const previous=nodes[nodes.length-1];
   if(previous&&previous.role===item.role&&previous.end===i){previous.end=i+1;previous.tokens.push(item.token);previous.text=previous.tokens.join(" ");}
   else nodes.push({id:"n"+(nodes.length+1),role:item.role,start:i,end:i+1,tokens:[item.token],text:item.token,confidence:item.confidence});
  }
  const phraseVector=zeros(featureSize),roleVectors={},weights={subject:1,predicate:2,object:3};
  for(const role of ["subject","predicate","object"]){
   const selected=roles.filter(item=>item.role===role&&item.confidence>=.22),vector=zeros(featureSize);
   for(const item of selected)for(let i=0;i<featureSize;i++)vector[i]+=data.features[item.index][i]/selected.length;
   roleVectors[role]=selected.length?vector:null;
   if(selected.length)for(let i=0;i<featureSize;i++)phraseVector[i]+=vector[i]*weights[role];
  }
  for(let i=0;i<phraseVector.length;i++)phraseVector[i]/=6;
  return{schema:SCHEMA,trained:trainingSteps>0,tokens:data.tokens,roles,nodes,edges,relationCandidates:relationCandidates.slice(0,24),
   phraseVector,roleVectors,weakFrame:{kind:data.frame.kind||"unknown",subject:normaliseFrameText(data.frame.subject||""),predicate:normaliseFrameText(data.frame.predicate||""),object:normaliseFrameText(data.frame.object||""),
    relation:normaliseFrameText(data.frame.relation||""),polarity:data.frame.polarity||"unknown",modality:data.frame.modality||"unknown",confidence:Number(data.frame.confidence)||0},
   supervision:"weak_semantic_parser_labels",training:lastTraining?{...lastTraining}:null};
 }
 function status(){return{schema:SCHEMA,dimension,featureSize,roleCount:ROLES.length,relationCount:RELATIONS.length,trainingSteps,trained:trainingSteps>0,lastTraining:lastTraining?{...lastTraining}:null};}
 function exportState(){return{schema:SCHEMA,version:1,dimension,featureSize,roleWeights:roleWeights.map(row=>row.slice()),roleBias:roleBias.slice(),
  relationWeights:relationWeights.map(row=>row.slice()),relationBias:relationBias.slice(),trainingSteps,lastTraining:lastTraining?{...lastTraining,roleCounts:lastTraining.roleCounts.slice(),relationCounts:lastTraining.relationCounts.slice()}:null};}
 function loadState(state){
  const validMatrix=(rows,count,width)=>Array.isArray(rows)&&rows.length===count&&rows.every(row=>Array.isArray(row)&&row.length===width&&row.every(value=>Number.isFinite(Number(value))));
  const validVector=(values,count)=>Array.isArray(values)&&values.length===count&&values.every(value=>Number.isFinite(Number(value)));
  if(!state||state.schema!==SCHEMA||state.version!==1||state.dimension!==dimension||state.featureSize!==featureSize||
   !validMatrix(state.roleWeights,ROLES.length,featureSize)||!validVector(state.roleBias,ROLES.length)||
   !validMatrix(state.relationWeights,RELATIONS.length,pairSize)||!validVector(state.relationBias,RELATIONS.length))
   throw new TypeError("Phrase-composition checkpoint is malformed or incompatible.");
  for(let i=0;i<ROLES.length;i++){roleWeights[i].splice(0,roleWeights[i].length,...state.roleWeights[i]);roleBias[i]=state.roleBias[i];}
  for(let i=0;i<RELATIONS.length;i++){relationWeights[i].splice(0,relationWeights[i].length,...state.relationWeights[i]);relationBias[i]=state.relationBias[i];}
  trainingSteps=Math.max(0,Math.floor(Number(state.trainingSteps)||0));lastTraining=state.lastTraining&&typeof state.lastTraining==="object"?{...state.lastTraining}:null;
  return status();
 }
 return Object.freeze({train,analyse,status,exportState,loadState});
}
const root=typeof window!=="undefined"?window:globalThis;
root.NGPhraseCompositionModel=Object.freeze({schema:SCHEMA,version:1,create});
})();