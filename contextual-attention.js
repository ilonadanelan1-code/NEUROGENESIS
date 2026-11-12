(() => {
"use strict";
const SCHEMA="NG_CONTEXTUAL_ATTENTION_V5",MAX_VOCABULARY=512,MAX_TOKENS=96,MAX_WINDOW_SIZE=8,SUBWORD_BUCKETS=256,MAX_SUBWORD_FEATURES=24,MAX_TRANSFORMER_BLOCKS=4;
const clean=(value,limit=4000)=>String(value==null?"":value).replace(/\s+/gu," ").trim().slice(0,limit);
function tokenize(value){return clean(value,6000).normalize("NFKC").toLowerCase().replace(/ё/gu,"е").match(/[\p{L}\p{N}]+/gu)?.slice(0,MAX_TOKENS)||[];}
const RUSSIAN_VERB_ENDINGS=["ировались","ировалось","ировали","ировать","ируются","ируется","ируете","ируешь","ируют","ирует","ываете","ывают","ываешь","ывает","ывают","ивает","ивают","аете","ают","яете","яют","уете","уют","ает","яет","ует","вает","вают","ишь","ешь","ите","ете","или","ыли","ет","ит","ят","ат","ут","ют"].sort((a,b)=>b.length-a.length);
const RUSSIAN_NOUN_ENDINGS=["иями","ями","ами","иях","ах","ях","иям","ием","ией","ого","его","ому","ыми","ими","ую","юю","ая","яя","ое","ее","ые","ие","ых","их","ым","им","ом","ем","ою","ею","ию","ью","ия","ья","ие","ье","ии","ев","ов","ей","ой","ям","ам","а","я","ы","и","е","у","ю","о","ь"].sort((a,b)=>b.length-a.length);
function russianStem(raw){
 const word=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
 if(!/^[а-я]+$/u.test(word))return word;
 for(const suffix of RUSSIAN_VERB_ENDINGS)if(word.length-suffix.length>=3&&word.endsWith(suffix))return word.slice(0,-suffix.length);
 for(const suffix of RUSSIAN_NOUN_ENDINGS)if(word.length-suffix.length>=3&&word.endsWith(suffix))return word.slice(0,-suffix.length);
 return word;
}
const RUSSIAN_PLURAL_VERB_ENDINGS=["аются","яются","ываются","иваются","ают","яют","уют","ют","ут","ат","ят"].sort((a,b)=>b.length-a.length);
const RUSSIAN_SINGULAR_VERB_ENDINGS=["ается","яется","ывает","ивает","ает","яет","ует","ит","ет"].sort((a,b)=>b.length-a.length);
const RUSSIAN_PLURAL_ADJECTIVE_ENDINGS=["ыми","ими","ых","их","ые","ие"].sort((a,b)=>b.length-a.length);
function russianVerbNumber(raw){
 const word=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
 if(!/^[а-я]+$/u.test(word))return null;
 if(RUSSIAN_PLURAL_VERB_ENDINGS.some(suffix=>word.endsWith(suffix)))return "plural";
 if(RUSSIAN_SINGULAR_VERB_ENDINGS.some(suffix=>word.endsWith(suffix)))return "singular";
 return null;
}
function inferMaskedNumber(tokens,targetIndex){
 const left=targetIndex>0?tokens[targetIndex-1]:"",right=targetIndex+1<tokens.length?tokens[targetIndex+1]:"";
 if(left&&RUSSIAN_PLURAL_ADJECTIVE_ENDINGS.some(suffix=>left.endsWith(suffix)))return{number:"plural",source:"preceding_plural_adjective",confidence:"rule"};
 const rightNumber=russianVerbNumber(right);
 if(rightNumber)return{number:rightNumber,source:"following_finite_verb",confidence:"rule"};
 return null;
}
function russianNounPlural(raw){
 const word=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
 if(!/^[а-я]+$/u.test(word)||word.length<4)return null;
 if(RUSSIAN_VERB_ENDINGS.some(suffix=>word.length-suffix.length>=3&&word.endsWith(suffix)))return null;
 if(["ый","ий","ая","яя","ое","ее","ые","ие","ого","его","ому","ему","ыми","ими"].some(suffix=>word.endsWith(suffix)))return null;
 let stem=word,suffix="";
 if(word.endsWith("а")){stem=word.slice(0,-1);suffix=/[гкхжчшщ]$/u.test(stem)?"и":"ы";}
 else if(word.endsWith("я")){stem=word.slice(0,-1);suffix="и";}
 else if(word.endsWith("о")){stem=word.slice(0,-1);suffix="а";}
 else if(word.endsWith("е")){stem=word.slice(0,-1);suffix="я";}
 else if(word.endsWith("й")){stem=word.slice(0,-1);suffix="и";}
 else if(word.endsWith("ь")){stem=word.slice(0,-1);suffix="и";}
 else if(/[бвгджзйклмнпрстфхцчшщ]$/u.test(word)){suffix=/[гкхжчшщ]$/u.test(word)?"и":"ы";}
 else return null;
 return stem.length>=3?stem+suffix:null;
}
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
function subwordFeatures(raw){
 const token=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е"),chars=Array.from("<"+token+">"),features=new Set();
 const hash=value=>{let result=2166136261;for(let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619);}return(result>>>0)%SUBWORD_BUCKETS;};
 for(let size=2;size<=4;size++){
  const candidates=[];for(let start=0;start+size<=chars.length;start++)candidates.push(hash(chars.slice(start,start+size).join("")));
  const sampleCount=Math.min(8,candidates.length);
  for(let index=0;index<sampleCount;index++)features.add(candidates[sampleCount===1?0:Math.round(index*(candidates.length-1)/(sampleCount-1))]);
 }
 if(!features.size&&token)features.add(hash(token));return[...features].slice(0,MAX_SUBWORD_FEATURES);
}
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
 const blockCount=Math.max(1,Math.min(MAX_TRANSFORMER_BLOCKS,Math.floor(finite(options.blocks,2))));
 const vocabulary=[],indices=new Map(),embeddings=[],subwordEmbeddings=matrix(SUBWORD_BUCKETS,dimension,random,.04),positions=matrix(windowSize*2,dimension,random,.04);
 const makeBlock=()=>({
  attentionHeads:Array.from({length:heads},()=>({query:matrix(headDimension,dimension,random,scale),key:matrix(headDimension,dimension,random,scale),value:matrix(headDimension,dimension,random,scale)})),
  relativePositionBias:Array.from({length:heads},()=>zeros(windowSize*2+1)),
  attentionOutput:matrix(dimension,dimension,random,Math.sqrt(2/(dimension*2))),
  norm1Gamma:Array.from({length:dimension},()=>1),norm1Beta:zeros(dimension),norm2Gamma:Array.from({length:dimension},()=>1),norm2Beta:zeros(dimension),
  feedForward1:matrix(feedForwardDimension,dimension,random,Math.sqrt(2/dimension)),feedForward1Bias:zeros(feedForwardDimension),
  feedForward2:matrix(dimension,feedForwardDimension,random,Math.sqrt(2/feedForwardDimension)),feedForward2Bias:zeros(dimension)
 });
 const blocks=Array.from({length:blockCount},makeBlock);
 let outputWeights=[],outputBias=[],trainingSteps=0,lastLoss=null,lastTraining=null,stemIndexCache=null,trainingContextExamples=[];
 function relativeSlot(delta){return Math.max(-windowSize,Math.min(windowSize,delta))+windowSize;}
 function zeroMatrix(rows,cols){return Array.from({length:rows},()=>zeros(cols));}

 function addToken(raw){
  const token=clean(raw,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
  if(!token||!/[\p{L}\p{N}]/u.test(token))return-1;
  if(indices.has(token))return indices.get(token);
  if(vocabulary.length>=MAX_VOCABULARY)return-1;
  const index=vocabulary.length;indices.set(token,index);vocabulary.push(token);stemIndexCache=null;
  embeddings.push(Array.from({length:dimension},()=>((tokenRandom()*2)-1)*.08));
  outputWeights.push(Array.from({length:dimension},()=>((tokenRandom()*2)-1)*.08));outputBias.push(0);
  return index;
 }
 function morphologyCandidates(raw){
  const stem=russianStem(raw);if(stem.length<3)return[];
  if(!stemIndexCache){
   const next=new Map();
   vocabulary.forEach((token,index)=>{const key=russianStem(token);if(key.length<3)return;if(!next.has(key))next.set(key,[]);next.get(key).push(index);});
   stemIndexCache=next;
  }
  return stemIndexCache.get(stem)||[];
 }
 function featureForToken(token,expand=false){
  const tokenIndex=expand?addToken(token):(indices.has(token)?indices.get(token):-1);
  const candidates=tokenIndex<0?morphologyCandidates(token):[];
  const contextTokenIndex=tokenIndex>=0?tokenIndex:(candidates.length===1?candidates[0]:-1);
  return{token,tokenIndex,contextTokenIndex,contextMorphologyBackoff:tokenIndex<0&&contextTokenIndex>=0,
   contextMorphologyToken:tokenIndex<0&&contextTokenIndex>=0?vocabulary[contextTokenIndex]:null,
   subwordBuckets:subwordFeatures(token)};
 }
 function contextFor(sequence,targetIndex){
  const context=[];
  for(let offset=-windowSize;offset<=windowSize;offset++){
   if(offset===0)continue;const position=targetIndex+offset;
   if(position<0||position>=sequence.length)continue;const feature=sequence[position];
   const tokenIndex=feature?(feature.tokenIndex>=0?feature.tokenIndex:feature.contextTokenIndex??-1):-1;
   if(!feature||tokenIndex<0&&!feature.subwordBuckets.length)continue;
   const slot=offset<0?offset+windowSize:offset+windowSize-1;
   context.push({tokenIndex,subwordBuckets:feature.subwordBuckets,slot,offset,
    contextMorphologyBackoff:!!feature.contextMorphologyBackoff,
    contextSourceToken:feature.token||"",contextMorphologyToken:feature.contextMorphologyToken||null});
  }return context;
 }
 function recordTrainingContext(targetIndex,context){
  if(trainingContextExamples.length>=12000||targetIndex<0)return;
  const lexicalContext=context.filter(item=>item.tokenIndex>=0)
   .map(item=>({offset:item.offset,token:vocabulary[item.tokenIndex]}));
  if(new Set(lexicalContext.map(item=>item.token)).size<2)return;
  trainingContextExamples.push({target:vocabulary[targetIndex],context:lexicalContext.map(item=>({...item,stem:russianStem(item.token)}))});
 }
 function collectExamples(rows,expand){
  const examples=[];
  for(const row of rows.slice(0,160)){
   const sequence=tokenize(row).map(token=>featureForToken(token,expand));
   for(let i=0;i<sequence.length;i++){
    const context=contextFor(sequence,i);
    if(sequence[i].tokenIndex>=0&&context.length){
     examples.push({context,target:sequence[i].tokenIndex});
     if(expand)recordTrainingContext(sequence[i].tokenIndex,context);
    }
   }
  }return examples;
 }
 function retrieveContextCandidate(context){
  if(!Array.isArray(context)||!trainingContextExamples.length)return null;
  const query=context.map(item=>{
   const surface=item.contextSourceToken||item.contextMorphologyToken||
    (item.tokenIndex>=0?vocabulary[item.tokenIndex]:"");
   const token=item.contextMorphologyToken||(item.tokenIndex>=0?vocabulary[item.tokenIndex]:null);
   return{offset:item.offset,surface,token,stem:russianStem(surface)};
  }).filter(item=>item.surface);
  if(query.length<2)return null;
  const bestByTarget=new Map();
  for(const example of trainingContextExamples){
   const used=new Set(),matches=[];
   for(const item of query){
    let best=null,bestWeight=-1;
    for(let index=0;index<example.context.length;index++){
     if(used.has(index))continue;
     const row=example.context[index],exact=!!item.token&&item.token===row.token;
     const sameStem=!!item.stem&&item.stem.length>=3&&item.stem===(row.stem||russianStem(row.token));
     if(!exact&&!sameStem)continue;
     const aligned=item.offset===row.offset,weight=(exact?4:2)+(aligned?2:0);
     if(weight>bestWeight){best={index,exact,aligned,surface:item.surface,matchedToken:row.token};bestWeight=weight;}
    }
    if(best){used.add(best.index);matches.push(best);}
   }
   if(matches.length<2)continue;
   const exactMatches=matches.filter(row=>row.exact).length;
   const offsetMatches=matches.filter(row=>row.aligned).length;
   // Fully stem-based matches are accepted only when both context positions align.
   if(exactMatches===0&&offsetMatches<2)continue;
   const shared=matches.map(row=>row.surface);
   const score=exactMatches*4+(matches.length-exactMatches)*2+offsetMatches*2;
   const prior=bestByTarget.get(example.target);
   if(!prior||score>prior.score)bestByTarget.set(example.target,{token:example.target,score,sharedTokens:shared,
    exactMatches,stemMatches:matches.length-exactMatches,offsetMatches,support:1});
   else if(score===prior.score)prior.support++;
  }
  const ranked=[...bestByTarget.values()].sort((a,b)=>b.score-a.score||a.token.localeCompare(b.token));
  if(!ranked.length)return null;
  if(ranked.length>1&&ranked[0].score===ranked[1].score)return null;
  return{token:ranked[0].token,score:ranked[0].score,sharedTokens:ranked[0].sharedTokens,
   exactMatches:ranked[0].exactMatches,stemMatches:ranked[0].stemMatches,
   offsetMatches:ranked[0].offsetMatches,support:ranked[0].support,method:"unique_training_context_retrieval"};
 }
 function forwardBlock(inputRows,block){
  const count=inputRows.length,headPasses=[],concatenated=Array.from({length:count},()=>[]);
  for(let h=0;h<heads;h++){
   const p=block.attentionHeads[h],queries=inputRows.map(row=>multiply(p.query,row.vector));
   const keys=inputRows.map(row=>multiply(p.key,row.vector)),values=inputRows.map(row=>multiply(p.value,row.vector)),attentions=[];
   for(let i=0;i<count;i++){
    const keyIndexes=Array.from({length:count},(_,index)=>index);
    const scores=keyIndexes.map(j=>dot(queries[i],keys[j])/Math.sqrt(headDimension)+block.relativePositionBias[h][relativeSlot(inputRows[j].offset-inputRows[i].offset)]);
    const weights=softmax(scores),vector=zeros(headDimension);
    for(let k=0;k<keyIndexes.length;k++)for(let d=0;d<headDimension;d++)vector[d]+=weights[k]*values[keyIndexes[k]][d];
    concatenated[i].push(...vector);attentions.push({keyIndexes,scores,weights,vector});
   }headPasses.push({queries,keys,values,attentions});
  }
  const rowPasses=[],outputRows=[];
  for(let i=0;i<count;i++){
   const projected=multiply(block.attentionOutput,concatenated[i]),residual1=inputRows[i].vector.map((v,k)=>v+projected[k]);
   const norm1=layerNorm(residual1,block.norm1Gamma,block.norm1Beta);
   const ffPre=multiply(block.feedForward1,norm1.output).map((v,k)=>v+block.feedForward1Bias[k]),ffHidden=ffPre.map(v=>Math.max(0,v));
   const ffOutput=multiply(block.feedForward2,ffHidden).map((v,k)=>v+block.feedForward2Bias[k]);
   const residual2=norm1.output.map((v,k)=>v+ffOutput[k]),norm2=layerNorm(residual2,block.norm2Gamma,block.norm2Beta);
   rowPasses.push({projected,residual1,norm1,ffPre,ffHidden,ffOutput,residual2,norm2});outputRows.push({...inputRows[i],vector:norm2.output.slice()});
  }return{inputRows,headPasses,concatenated,rowPasses,outputRows};
 }
 function forward(context){
  const inputRows=context.map(item=>{
   const vector=zeros(dimension),embedding=item.tokenIndex>=0?embeddings[item.tokenIndex]:null,position=positions[item.slot];
   for(let i=0;i<dimension;i++){let subword=0;for(const bucket of item.subwordBuckets||[])subword+=subwordEmbeddings[bucket][i];
    vector[i]=(embedding?embedding[i]:0)+(item.subwordBuckets&&item.subwordBuckets.length?subword/item.subwordBuckets.length:0)+position[i];}
   return{...item,vector};
  });
  const layerPasses=[];let rows=inputRows;for(const block of blocks){const pass=forwardBlock(rows,block);layerPasses.push(pass);rows=pass.outputRows;}
  const pooled=zeros(dimension);for(const row of rows)for(let i=0;i<dimension;i++)pooled[i]+=row.vector[i]/rows.length;
  const logits=multiply(outputWeights,pooled).map((v,i)=>v+outputBias[i]);
  return{inputRows,layerPasses,finalRows:rows,pooled,probabilities:softmax(logits)};
 }
 function createBlockGradients(){return{
  attentionHeads:Array.from({length:heads},()=>({query:zeroMatrix(headDimension,dimension),key:zeroMatrix(headDimension,dimension),value:zeroMatrix(headDimension,dimension)})),
  relativePositionBias:Array.from({length:heads},()=>zeros(windowSize*2+1)),attentionOutput:zeroMatrix(dimension,dimension),
  norm1Gamma:zeros(dimension),norm1Beta:zeros(dimension),norm2Gamma:zeros(dimension),norm2Beta:zeros(dimension),
  feedForward1:zeroMatrix(feedForwardDimension,dimension),feedForward1Bias:zeros(feedForwardDimension),
  feedForward2:zeroMatrix(dimension,feedForwardDimension),feedForward2Bias:zeros(dimension)
 };}
 function backwardBlock(pass,outputGradients,block){
  const count=pass.inputRows.length,g=createBlockGradients(),dProjected=zeroMatrix(count,dimension);
  for(let i=0;i<count;i++){
   const cache=pass.rowPasses[i],ln2=layerNormBackward(outputGradients[i],cache.norm2,block.norm2Gamma);
   const dResidual2=ln2.inputGradient,dNorm1Direct=dResidual2.slice(),dFfOutput=dResidual2.slice();
   for(let row=0;row<dimension;row++){
    g.norm2Gamma[row]+=ln2.gammaGradient[row];g.norm2Beta[row]+=ln2.betaGradient[row];
    for(let col=0;col<feedForwardDimension;col++)g.feedForward2[row][col]+=dFfOutput[row]*cache.ffHidden[col];
    g.feedForward2Bias[row]+=dFfOutput[row];
   }
   const dFfHidden=transposeMultiply(block.feedForward2,dFfOutput),dFfPre=dFfHidden.map((v,k)=>cache.ffPre[k]>0?v:0);
   for(let row=0;row<feedForwardDimension;row++){for(let col=0;col<dimension;col++)g.feedForward1[row][col]+=dFfPre[row]*cache.norm1.output[col];g.feedForward1Bias[row]+=dFfPre[row];}
   const dNorm1FromFf=transposeMultiply(block.feedForward1,dFfPre),dNorm1=dNorm1Direct.map((v,k)=>v+dNorm1FromFf[k]);
   const ln1=layerNormBackward(dNorm1,cache.norm1,block.norm1Gamma);
   for(let k=0;k<dimension;k++){g.norm1Gamma[k]+=ln1.gammaGradient[k];g.norm1Beta[k]+=ln1.betaGradient[k];}
   dProjected[i]=ln1.inputGradient;
   for(let r=0;r<dimension;r++)for(let c=0;c<dimension;c++)g.attentionOutput[r][c]+=dProjected[i][r]*pass.concatenated[i][c];
  }
  const dConcatenated=dProjected.map(row=>transposeMultiply(block.attentionOutput,row)),dInput=dProjected.map(row=>row.slice());
  for(let h=0;h<heads;h++){
   const head=pass.headPasses[h],p=block.attentionHeads[h],dQuery=zeroMatrix(count,headDimension),dKeys=zeroMatrix(count,headDimension),dValues=zeroMatrix(count,headDimension);
   for(let i=0;i<count;i++){
    const a=head.attentions[i],dHead=dConcatenated[i].slice(h*headDimension,(h+1)*headDimension);
    const dWeights=a.keyIndexes.map(j=>dot(dHead,head.values[j])),weighted=dot(a.weights,dWeights),dScores=dWeights.map((v,k)=>a.weights[k]*(v-weighted));
    for(let k=0;k<a.keyIndexes.length;k++){
     const j=a.keyIndexes[k],slot=relativeSlot(pass.inputRows[j].offset-pass.inputRows[i].offset);
     for(let d=0;d<headDimension;d++){dValues[j][d]+=a.weights[k]*dHead[d];dQuery[i][d]+=dScores[k]*head.keys[j][d]/Math.sqrt(headDimension);dKeys[j][d]+=dScores[k]*head.queries[i][d]/Math.sqrt(headDimension);}
     g.relativePositionBias[h][slot]+=dScores[k];
    }
   }
   for(let i=0;i<count;i++){
    for(let d=0;d<headDimension;d++)for(let col=0;col<dimension;col++){
     g.attentionHeads[h].query[d][col]+=dQuery[i][d]*pass.inputRows[i].vector[col];
     g.attentionHeads[h].key[d][col]+=dKeys[i][d]*pass.inputRows[i].vector[col];
     g.attentionHeads[h].value[d][col]+=dValues[i][d]*pass.inputRows[i].vector[col];
    }
    const q=transposeMultiply(p.query,dQuery[i]),k=transposeMultiply(p.key,dKeys[i]),v=transposeMultiply(p.value,dValues[i]);
    for(let col=0;col<dimension;col++)dInput[i][col]+=q[col]+k[col]+v[col];
   }
  }return{inputGradients:dInput,gradients:g};
 }
 function trainExample(example,learningRate){
  const pass=forward(example.context),loss=-Math.log(Math.max(1e-12,pass.probabilities[example.target]||0));
  const dLogits=pass.probabilities.slice();dLogits[example.target]-=1;
  const dOutputWeights=outputWeights.map((row,i)=>row.map((_,col)=>dLogits[i]*pass.pooled[col]));
  const dOutputBias=dLogits.slice(),dPooled=transposeMultiply(outputWeights,dLogits);
  let rowGradients=pass.finalRows.map(()=>dPooled.map(v=>v/pass.finalRows.length));const blockGradients=Array(blockCount);
  for(let layer=blockCount-1;layer>=0;layer--){const back=backwardBlock(pass.layerPasses[layer],rowGradients,blocks[layer]);blockGradients[layer]=back.gradients;rowGradients=back.inputGradients;}
  const embeddingGradients=new Map(),subwordGradients=new Map(),positionGradients=new Map();
  for(let row=0;row<pass.inputRows.length;row++){
   const item=pass.inputRows[row],gradient=rowGradients[row];
   if(item.tokenIndex>=0&&!embeddingGradients.has(item.tokenIndex))embeddingGradients.set(item.tokenIndex,zeros(dimension));
   const buckets=item.subwordBuckets||[];for(const bucket of buckets)if(!subwordGradients.has(bucket))subwordGradients.set(bucket,zeros(dimension));
   if(!positionGradients.has(item.slot))positionGradients.set(item.slot,zeros(dimension));
   const eg=item.tokenIndex>=0?embeddingGradients.get(item.tokenIndex):null,pg=positionGradients.get(item.slot);
   for(let i=0;i<dimension;i++){if(eg)eg[i]+=gradient[i];pg[i]+=gradient[i];for(const bucket of buckets)subwordGradients.get(bucket)[i]+=gradient[i]/buckets.length;}
  }
  const update=(weights,grads)=>{for(let r=0;r<weights.length;r++)for(let c=0;c<weights[r].length;c++)weights[r][c]-=learningRate*clipped(grads[r][c]);};
  const updateVector=(weights,grads)=>{for(let i=0;i<weights.length;i++)weights[i]-=learningRate*clipped(grads[i]);};
  update(outputWeights,dOutputWeights);updateVector(outputBias,dOutputBias);
  for(let layer=0;layer<blockCount;layer++){
   const block=blocks[layer],g=blockGradients[layer];update(block.attentionOutput,g.attentionOutput);update(block.feedForward1,g.feedForward1);update(block.feedForward2,g.feedForward2);
   updateVector(block.feedForward1Bias,g.feedForward1Bias);updateVector(block.feedForward2Bias,g.feedForward2Bias);
   updateVector(block.norm1Gamma,g.norm1Gamma);updateVector(block.norm1Beta,g.norm1Beta);updateVector(block.norm2Gamma,g.norm2Gamma);updateVector(block.norm2Beta,g.norm2Beta);
   for(let h=0;h<heads;h++){update(block.attentionHeads[h].query,g.attentionHeads[h].query);update(block.attentionHeads[h].key,g.attentionHeads[h].key);update(block.attentionHeads[h].value,g.attentionHeads[h].value);updateVector(block.relativePositionBias[h],g.relativePositionBias[h]);}
  }
  for(const[token,gradient]of embeddingGradients)updateVector(embeddings[token],gradient);
  for(const[bucket,gradient]of subwordGradients)updateVector(subwordEmbeddings[bucket],gradient);
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
   lossReduction:initialTrain.loss-finalTrain.loss,vocabularySize:vocabulary.length,transformerBlocks:blockCount,
   trainingSteps:selectedSteps,attemptedTrainingSteps:attemptedSteps,heads,headDimension,feedForwardDimension,
   trainingContextExamples:trainingContextExamples.length};
  return{...lastTraining};
 }
 function rowsForTargets(rows){
  let count=0;for(const row of rows){const tokens=tokenize(row);if(tokens.length>1)count+=tokens.length;}
  return count;
 }
 function rebuildTrainingContextIndex(texts){
  if(!lastTraining||!vocabulary.length)return{rebuilt:false,reason:"model_not_trained",examples:trainingContextExamples.length};
  if(trainingContextExamples.length)return{rebuilt:false,reason:"index_already_present",examples:trainingContextExamples.length};
  const rows=(Array.isArray(texts)?texts:[texts]).map(value=>clean(value,1200)).filter(Boolean).slice(0,160);
  if(!rows.length)return{rebuilt:false,reason:"empty_corpus",examples:0};
  let split;
  try{split=splitCorpus(rows,lastTraining.splitSeed);}catch(_){return{rebuilt:false,reason:"invalid_corpus",examples:0};}
  if(split.uniqueRows!==lastTraining.uniqueRows)return{rebuilt:false,reason:"corpus_mismatch",examples:0};
  const sourceRows=lastTraining.splitFallback?rows:split.train;
  if(!lastTraining.splitFallback&&sourceRows.length!==lastTraining.trainRows)
   return{rebuilt:false,reason:"training_partition_mismatch",examples:0};
  trainingContextExamples=[];
  for(const row of sourceRows){
   const sequence=tokenize(row).map(token=>featureForToken(token,false));
   for(let index=0;index<sequence.length;index++){
    const target=sequence[index].tokenIndex,context=contextFor(sequence,index);
    if(target>=0&&context.length)recordTrainingContext(target,context);
   }
  }
  return{rebuilt:trainingContextExamples.length>0,reason:trainingContextExamples.length?"rebuilt":"no_retrievable_examples",
   examples:trainingContextExamples.length,sourceRows:sourceRows.length,splitFallback:!!lastTraining.splitFallback};
 }
 function predictMasked(text,targetIndex){
  const tokens=tokenize(text),safeIndex=Math.max(0,Math.min(tokens.length-1,Math.floor(finite(targetIndex,0))));
  if(!tokens.length)return null;
  const sequence=tokens.map(token=>featureForToken(token,false));
  const context=contextFor(sequence,safeIndex),contextMorphologyBackoffs=context.filter(row=>row.contextMorphologyBackoff)
   .map(row=>({token:row.contextSourceToken,vocabularyToken:row.contextMorphologyToken,offset:row.offset}));
  if(!context.length)return{maskedTokenIndex:safeIndex,available:false,predictions:[],morphologyHint:null,generatedCandidates:[],generatedPrediction:null,contextMorphologyBackoffs};
  const pass=forward(context),predictions=pass.probabilities.map((probability,index)=>({token:vocabulary[index],probability})).sort((a,b)=>b.probability-a.probability);
  const morphologyHint=inferMaskedNumber(tokens,safeIndex),generatedCandidates=[];
  const retrievalCandidate=retrieveContextCandidate(context);
  const retrievalSurface=retrievalCandidate&&morphologyHint&&morphologyHint.number==="plural"?russianNounPlural(retrievalCandidate.token):null;
  const retrievalPrediction=retrievalSurface?{surface:retrievalSurface,baseToken:retrievalCandidate.token,
   features:{number:"plural"},method:"training_context_retrieval_plus_plural_rule",
   retrievalScore:retrievalCandidate.score,matchedContextTokens:retrievalCandidate.sharedTokens}:null;
  if(morphologyHint&&morphologyHint.number==="plural"){
   for(const candidate of predictions){
    const surface=russianNounPlural(candidate.token);
    if(surface)generatedCandidates.push({surface,baseToken:candidate.token,probability:candidate.probability,features:{number:"plural"},method:"contextual_lemma_plus_plural_rule"});
    if(generatedCandidates.length>=8)break;
   }
  }
  return{maskedTokenIndex:safeIndex,available:true,predictions:predictions.slice(0,8),morphologyHint,generatedCandidates,generatedPrediction:generatedCandidates[0]||null,
   retrievalCandidate,retrievalPrediction,contextMorphologyBackoffs};
 }
 function score(text,targetIndex){
  const tokens=tokenize(text),safeIndex=Math.max(0,Math.min(tokens.length-1,Math.floor(finite(targetIndex,0))));if(!tokens.length)return null;
  const sequence=tokens.map(token=>featureForToken(token,false));
  const context=contextFor(sequence,safeIndex);if(!context.length)return null;
  const contextMorphologyBackoffs=context.filter(row=>row.contextMorphologyBackoff)
   .map(row=>({token:row.contextSourceToken,vocabularyToken:row.contextMorphologyToken,offset:row.offset}));
  const pass=forward(context),last=pass.layerPasses[blockCount-1];
  const headRows=last.headPasses.map((head,index)=>{
   const accumulated=zeros(context.length),vector=zeros(headDimension);
   for(let query=0;query<context.length;query++){const a=head.attentions[query];for(let k=0;k<a.keyIndexes.length;k++)accumulated[a.keyIndexes[k]]+=a.weights[k]/context.length;for(let d=0;d<headDimension;d++)vector[d]+=a.vector[d]/context.length;}
   return{head:index+1,attention:accumulated.map((weight,row)=>({token:tokens[safeIndex+context[row].offset],offset:context[row].offset,distance:Math.abs(context[row].offset),weight})),relativePositionBias:blocks[blockCount-1].relativePositionBias[index].slice(),vector};
  });
  const aggregate=context.map((row,index)=>({token:tokens[safeIndex+row.offset],offset:row.offset,distance:Math.abs(row.offset),weight:headRows.reduce((sum,head)=>sum+head.attention[index].weight,0)/heads}));
  const target=sequence[safeIndex],targetIndexInVocabulary=target.tokenIndex,targetStem=russianStem(tokens[safeIndex]),stemMatches=morphologyCandidates(tokens[safeIndex]);
  const morphologyTargetIndex=targetIndexInVocabulary>=0?targetIndexInVocabulary:(stemMatches.length===1?stemMatches[0]:-1);
  const morphologyKnown=morphologyTargetIndex>=0,morphologyBackoff=targetIndexInVocabulary<0&&morphologyKnown,morphologyAmbiguous=targetIndexInVocabulary<0&&stemMatches.length>1;
  const tokenVector=targetIndexInVocabulary>=0?embeddings[targetIndexInVocabulary].slice():zeros(dimension);
  for(const bucket of target.subwordBuckets)for(let i=0;i<dimension;i++)tokenVector[i]+=subwordEmbeddings[bucket][i]/target.subwordBuckets.length;
  const rows=last.rowPasses,meanVector=selector=>Array.from({length:dimension},(_,i)=>rows.reduce((sum,row)=>sum+selector(row)[i],0)/rows.length);
  const hidden=Array.from({length:feedForwardDimension},(_,i)=>rows.reduce((sum,row)=>sum+row.ffHidden[i],0)/rows.length);
  const predictions=topPredictions(pass.probabilities,vocabulary),morphologyPrediction=predictions[0];
  const morphologyCorrect=morphologyKnown&&!!morphologyPrediction&&russianStem(morphologyPrediction.token)===targetStem;
  return{token:tokens[safeIndex],index:safeIndex,targetKnown:targetIndexInVocabulary>=0,subwordFeatures:target.subwordBuckets.length,tokenVector,contextualVector:pass.pooled.slice(),attention:aggregate,heads:headRows,predictions,
   targetProbability:targetIndexInVocabulary>=0?pass.probabilities[targetIndexInVocabulary]:null,
   morphologyKnown,morphologyBackoff,morphologyAmbiguous,morphologyToken:morphologyTargetIndex>=0?vocabulary[morphologyTargetIndex]:null,
   morphologyStem:targetStem,morphologyProbability:morphologyTargetIndex>=0?pass.probabilities[morphologyTargetIndex]:null,
   morphologyCorrect,morphologyCandidateCount:stemMatches.length,contextMorphologyBackoffs,normalization:{first:meanVector(row=>row.norm1.output),second:pass.pooled.slice()},
   feedForward:{hidden,output:meanVector(row=>row.ffOutput)},transformerBlocks:blockCount};
 }
 function analyse(text){const tokens=tokenize(text),positions=[];for(let i=0;i<tokens.length;i++){const row=score(text,i);if(row)positions.push(row);}
  const unknownTokens=tokens.filter(token=>!indices.has(token));
  const morphologyBackoffTokens=positions.filter(row=>row.morphologyBackoff).map(row=>({token:row.token,vocabularyToken:row.morphologyToken,stem:row.morphologyStem}));
  const morphologyAmbiguousTokens=positions.filter(row=>row.morphologyAmbiguous).map(row=>row.token);
  const morphologyCoveredTokenCount=positions.filter(row=>row.morphologyKnown).length;
  const contextMorphologyBackoffCount=positions.reduce((sum,row)=>sum+row.contextMorphologyBackoffs.length,0);
  return{schema:SCHEMA,version:5,tokens,vocabularySize:vocabulary.length,trained:trainingSteps>0,heads,headDimension,feedForwardDimension,transformerBlocks:blockCount,windowSize,maxWindowSize:MAX_WINDOW_SIZE,
   knownTokenCount:tokens.length-unknownTokens.length,unknownTokens,oovCount:unknownTokens.length,morphologyCoveredTokenCount,
   morphologyBackoffCount:morphologyBackoffTokens.length,morphologyBackoffTokens,morphologyAmbiguousTokens,
   contextMorphologyBackoffCount,positions};}
 function status(){return{schema:SCHEMA,version:5,vocabularySize:vocabulary.length,subwordBuckets:SUBWORD_BUCKETS,transformerBlocks:blockCount,dimension,windowSize,maxWindowSize:MAX_WINDOW_SIZE,heads,headDimension,
  feedForwardDimension,trainingSteps,trainingContextExamples:trainingContextExamples.length,trained:trainingSteps>0,lastLoss,lastTraining:lastTraining?{...lastTraining}:null};}
 function exportState(){
  const copy=rows=>rows.map(row=>row.slice()),copyBlock=block=>({
   attentionHeads:block.attentionHeads.map(head=>({query:copy(head.query),key:copy(head.key),value:copy(head.value)})),relativePositionBias:copy(block.relativePositionBias),attentionOutput:copy(block.attentionOutput),
   norm1Gamma:block.norm1Gamma.slice(),norm1Beta:block.norm1Beta.slice(),norm2Gamma:block.norm2Gamma.slice(),norm2Beta:block.norm2Beta.slice(),
   feedForward1:copy(block.feedForward1),feedForward1Bias:block.feedForward1Bias.slice(),feedForward2:copy(block.feedForward2),feedForward2Bias:block.feedForward2Bias.slice()
  });
  return{schema:SCHEMA,version:5,dimension,windowSize,heads,transformerBlocks:blockCount,vocabulary:vocabulary.slice(),embeddings:copy(embeddings),subwordEmbeddings:copy(subwordEmbeddings),positions:copy(positions),blocks:blocks.map(copyBlock),outputWeights:copy(outputWeights),outputBias:outputBias.slice(),trainingSteps,lastLoss,lastTraining:lastTraining?{...lastTraining}:null,
   trainingContextExamples:trainingContextExamples.map(example=>({target:example.target,context:example.context.map(item=>({...item}))}))};
 }
 function loadState(state){
  if(!state||state.schema!==SCHEMA||state.version!==5)throw new TypeError("Unsupported contextual model state.");
  if(state.dimension!==dimension||state.windowSize!==windowSize||state.heads!==heads||state.transformerBlocks!==blockCount||!Array.isArray(state.vocabulary)||state.vocabulary.length>MAX_VOCABULARY||!Array.isArray(state.blocks)||state.blocks.length!==blockCount)
   throw new TypeError("Contextual model dimensions, heads, blocks or vocabulary are invalid.");
  const validMatrix=(rows,rowCount,colCount)=>Array.isArray(rows)&&rows.length===rowCount&&rows.every(row=>Array.isArray(row)&&row.length===colCount&&row.every(value=>Number.isFinite(Number(value))));
  const validVector=(values,length)=>Array.isArray(values)&&values.length===length&&values.every(value=>Number.isFinite(Number(value)));
  const count=state.vocabulary.length,vocabularySet=new Set(state.vocabulary),storedContextExamples=state.trainingContextExamples??[],
   validContextExamples=Array.isArray(storedContextExamples)&&storedContextExamples.length<=12000&&storedContextExamples.every(example=>
    example&&typeof example.target==="string"&&vocabularySet.has(example.target)&&Array.isArray(example.context)&&example.context.length>=2&&example.context.length<=16&&
    example.context.every(item=>item&&typeof item.token==="string"&&vocabularySet.has(item.token)&&
     (item.stem==null||typeof item.stem==="string")&&Number.isInteger(item.offset)&&item.offset!==0&&Math.abs(item.offset)<=windowSize)),
   validBlock=block=>block&&Array.isArray(block.attentionHeads)&&block.attentionHeads.length===heads&&
   block.attentionHeads.every(head=>head&&validMatrix(head.query,headDimension,dimension)&&validMatrix(head.key,headDimension,dimension)&&validMatrix(head.value,headDimension,dimension))&&
   validMatrix(block.relativePositionBias,heads,windowSize*2+1)&&validMatrix(block.attentionOutput,dimension,dimension)&&validVector(block.norm1Gamma,dimension)&&validVector(block.norm1Beta,dimension)&&validVector(block.norm2Gamma,dimension)&&validVector(block.norm2Beta,dimension)&&
   validMatrix(block.feedForward1,feedForwardDimension,dimension)&&validVector(block.feedForward1Bias,feedForwardDimension)&&validMatrix(block.feedForward2,dimension,feedForwardDimension)&&validVector(block.feedForward2Bias,dimension);
  if(!validContextExamples||!validMatrix(state.embeddings,count,dimension)||!validMatrix(state.subwordEmbeddings,SUBWORD_BUCKETS,dimension)||!validMatrix(state.positions,windowSize*2,dimension)||!state.blocks.every(validBlock)||!validMatrix(state.outputWeights,count,dimension)||!validVector(state.outputBias,count))
   throw new TypeError("Contextual model weights are malformed.");
  vocabulary.length=0;indices.clear();
  state.vocabulary.forEach((token,index)=>{const safe=clean(token,48).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");if(!safe||indices.has(safe))throw new TypeError("Duplicate or empty vocabulary token.");vocabulary.push(safe);indices.set(safe,index);});stemIndexCache=null;
  const copy=rows=>rows.map(row=>row.map(Number)),copyVector=values=>values.map(Number);
  embeddings.length=0;embeddings.push(...copy(state.embeddings));subwordEmbeddings.splice(0,subwordEmbeddings.length,...copy(state.subwordEmbeddings));positions.splice(0,positions.length,...copy(state.positions));
  for(let layer=0;layer<blockCount;layer++){
   const source=state.blocks[layer],target=blocks[layer];
   for(let h=0;h<heads;h++){target.attentionHeads[h].query=copy(source.attentionHeads[h].query);target.attentionHeads[h].key=copy(source.attentionHeads[h].key);target.attentionHeads[h].value=copy(source.attentionHeads[h].value);}
   target.relativePositionBias=copy(source.relativePositionBias);target.attentionOutput=copy(source.attentionOutput);target.norm1Gamma=copyVector(source.norm1Gamma);target.norm1Beta=copyVector(source.norm1Beta);
   target.norm2Gamma=copyVector(source.norm2Gamma);target.norm2Beta=copyVector(source.norm2Beta);target.feedForward1=copy(source.feedForward1);target.feedForward1Bias=copyVector(source.feedForward1Bias);
   target.feedForward2=copy(source.feedForward2);target.feedForward2Bias=copyVector(source.feedForward2Bias);
  }
  outputWeights=copy(state.outputWeights);outputBias=copyVector(state.outputBias);
  trainingContextExamples=storedContextExamples.map(example=>({target:example.target,context:example.context.map(item=>({
   offset:item.offset,token:item.token,stem:item.stem||russianStem(item.token)}))}));
  trainingSteps=Math.max(0,Math.floor(finite(state.trainingSteps,0)));lastLoss=Number.isFinite(Number(state.lastLoss))?Number(state.lastLoss):null;
  const report=state.lastTraining;lastTraining=report&&typeof report==="object"&&(report.validationLoss==null||Number.isFinite(Number(report.validationLoss)))?{...report,validationLoss:report.validationLoss==null?null:Number(report.validationLoss),testLoss:report.testLoss==null?null:Number(report.testLoss)}:null;
  return status();
 }
 const initialCheckpoint=exportState();
 return Object.freeze({train,analyse,score,predictMasked,rebuildTrainingContextIndex,status,exportState,loadState,tokenize,splitCorpus,subwordFeatures,russianStem,russianVerbNumber,inferMaskedNumber,russianNounPlural});
}
function fromState(state){if(!state||state.schema!==SCHEMA)throw new TypeError("Invalid contextual model state.");const model=create({dimension:state.dimension,windowSize:state.windowSize,heads:state.heads,blocks:state.transformerBlocks});model.loadState(state);return model;}
const root=typeof window!=="undefined"?window:globalThis;
root.NGContextualModel=Object.freeze({schema:SCHEMA,version:5,create,fromState,tokenize,subwordFeatures,russianStem,russianVerbNumber,inferMaskedNumber,russianNounPlural});
})();