(() => {
"use strict";
const root=typeof window!=="undefined"?window:globalThis,WIN=4;
const POS=new Set(["NOUN","PROPN","VERB","AUX","ADJ","ADV","PRON","NUM"]);
const norm=v=>String(v==null?"":v).normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
const words=v=>norm(v).match(/[\p{L}\p{N}]+/gu)||[];
const stem=v=>{const w=norm(v),ends=["иями","ями","ами","иях","ого","его","ому","ему","ыми","ими","ать","ять","ить","еть","ут","ют","ат","ят","ет","ит","ов","ев","ей","ам","ям","ах","ях","ом","ем","а","я","ы","и","у","ю","е","о","ь"];for(const e of ends)if(w.length-e.length>=3&&w.endsWith(e))return w.slice(0,-e.length);return w;};
function parseFeatures(raw){const out=Object.create(null);if(!raw||raw==="_")return out;for(const p of String(raw).split("|")){const i=p.indexOf("=");if(i>0&&i<p.length-1&&/^[A-Z][A-Za-z0-9]*$/u.test(p.slice(0,i)))out[p.slice(0,i)]=p.slice(i+1);}return out;}
function parseConllu(content){
 if(typeof content!=="string"||!content.trim())throw new TypeError("CoNLL-U content must be a non-empty string.");
 const result=[];let id=null,text=null,tokens=[];
 const flush=()=>{const lexical=tokens.filter(t=>words(t.form).length===1&&t.upos!=="PUNCT"&&t.upos!=="SYM");const sentenceText=text||lexical.map(t=>t.form).join(" ");if(lexical.length&&words(sentenceText).length)result.push({sentenceId:id,text:sentenceText,tokens:lexical});id=null;text=null;tokens=[];};
 for(const line of content.replace(/^\uFEFF/u,"").split(/\r?\n/u)){
  if(!line.trim()){flush();continue;}
  if(line.startsWith("# sent_id = ")){id=line.slice(12).trim()||null;continue;}
  if(line.startsWith("# text = ")){text=line.slice(9);continue;}
  if(line.startsWith("#"))continue;
  const c=line.split("\t"),rawId=c[0]||"";
  if(!/^\d+$/u.test(rawId)||!c[1])continue;
  const form=String(c[1]).normalize("NFKC"),lemma=c[2]&&c[2]!=="_"?norm(c[2]):norm(form);
  tokens.push({id:Number(rawId),form,lemma,upos:c[3]&&c[3]!=="_"?c[3]:"X",feats:parseFeatures(c[5]||"_"),deprel:c[7]&&c[7]!=="_"?c[7]:null});
 }
 flush();return result;
}
function buildNaiveBayes(rows,labelOf,featuresOf){
 const labelCounts=new Map(),featureCounts=new Map(),featureTotals=new Map(),vocabulary=new Set();let total=0;
 for(const row of rows){const label=labelOf(row);if(!label)continue;const features=featuresOf(row);if(!features.length)continue;total++;labelCounts.set(label,(labelCounts.get(label)||0)+1);if(!featureCounts.has(label))featureCounts.set(label,new Map());const counts=featureCounts.get(label),seen=new Set(features);for(const feature of seen){vocabulary.add(feature);counts.set(feature,(counts.get(feature)||0)+1);featureTotals.set(label,(featureTotals.get(label)||0)+1);}}
 return{labelCounts,featureCounts,featureTotals,vocabularySize:Math.max(1,vocabulary.size),total,labels:[...labelCounts.keys()]};
}
function scoreNaiveBayes(model,features){
 if(!model||!model.total)return[];const rows=[],alpha=.5,V=model.vocabularySize;
 for(const label of model.labels){const count=model.labelCounts.get(label)||0,counts=model.featureCounts.get(label)||new Map(),denom=(model.featureTotals.get(label)||0)+alpha*V;let score=Math.log((count+.5)/(model.total+.5*model.labels.length));for(const feature of features)score+=Math.log(((counts.get(feature)||0)+alpha)/denom);rows.push({label,logScore:score});}
 if(!rows.length)return[];const max=Math.max(...rows.map(r=>r.logScore)),values=rows.map(r=>Math.exp(r.logScore-max)),sum=values.reduce((a,b)=>a+b,0)||1;return rows.map((r,i)=>({label:r.label,probability:values[i]/sum})).sort((a,b)=>b.probability-a.probability);
}
function makeTagFeatures(context){
 const out=new Set();
 for(const row of context){const side=row.offset<0?"L":"R",offset=String(row.offset),form=norm(row.form||"");if(form){out.add("F:"+offset+":"+form);out.add("F:"+side+":"+form);}
  const analyses=Array.isArray(row.analyses)&&row.analyses.length?row.analyses:[{lemma:row.lemma,upos:row.upos,feats:row.feats||{}}];
  for(const a of analyses){const lemma=norm(a.lemma||""),upos=a.upos||"X",feats=a.feats||{};if(lemma){out.add("L:"+offset+":"+lemma);out.add("L:"+side+":"+lemma);}if(upos!=="X"){out.add("P:"+offset+":"+upos);out.add("P:"+side+":"+upos);}for(const key of ["Case","Number","Gender","Animacy","Tense","Aspect","Person","VerbForm","Mood","Voice","Degree","NumType"])if(feats[key])out.add("M:"+offset+":"+key+"="+feats[key]);}
 }
 return[...out];
}
function create(records,options={}){
 if(!Array.isArray(records)||!records.length)throw new TypeError("A non-empty array of annotated training sentences is required.");
 const windowSize=Math.max(1,Math.min(8,Math.floor(Number(options.windowSize)||WIN))),modelApi=options.modelApi||root.NGContextualModel||null;
 const clean=records.map(r=>{if(!r||!Array.isArray(r.tokens))return null;const tokens=r.tokens.filter(t=>t&&typeof t.form==="string"&&words(t.form).length===1&&t.upos!=="PUNCT"&&t.upos!=="SYM").map(t=>({form:norm(t.form),lemma:norm(t.lemma||t.form),upos:t.upos||"X",feats:t.feats||Object.create(null)})).filter(t=>t.form&&t.lemma);return tokens.length?{text:r.text||tokens.map(t=>t.form).join(" "),tokens}:null;}).filter(Boolean);
 if(!clean.length)throw new TypeError("No usable annotated tokens were found.");
 const examples=[],analyses=new Map();
 for(const sent of clean){
  for(const t of sent.tokens){if(!analyses.has(t.form))analyses.set(t.form,[]);const list=analyses.get(t.form),k=t.lemma+"|"+t.upos;if(!list.some(x=>x.key===k))list.push({key:k,lemma:t.lemma,upos:t.upos,feats:t.feats});}
  for(let i=0;i<sent.tokens.length;i++){
   const target=sent.tokens[i];if(!POS.has(target.upos))continue;const context=[];
   for(let off=-windowSize;off<=windowSize;off++){if(!off)continue;const j=i+off;if(j<0||j>=sent.tokens.length)continue;const t=sent.tokens[j];context.push({form:t.form,lemma:t.lemma,upos:t.upos,feats:t.feats||Object.create(null),offset:off,stem:stem(t.lemma)});}
   if(context.length>=2)examples.push({target:{form:target.form,lemma:target.lemma,upos:target.upos,feats:target.feats},context});
  }
 }
 if(!examples.length)throw new TypeError("The annotated corpus produced no context examples.");
 const taggerRows=examples.map(example=>({target:example.target,context:example.context}));
 const posTagger=buildNaiveBayes(taggerRows,row=>row.target.upos,row=>makeTagFeatures(row.context));
 const morphologyTaggers=new Map();
 for(const key of ["Case","Number","Gender","Animacy","Tense","Aspect","Person","VerbForm","Mood","Voice","Degree","NumType"]){
  const groups=new Map();for(const row of taggerRows){const value=row.target.feats&&row.target.feats[key],upos=row.target.upos;if(!value)continue;const groupKey=upos+"|"+key;if(!groups.has(groupKey))groups.set(groupKey,[]);groups.get(groupKey).push({target:value,context:row.context});}
  for(const [groupKey,rows] of groups)morphologyTaggers.set(groupKey,buildNaiveBayes(rows,row=>row.target,row=>makeTagFeatures(row.context)));
 }
 function predictTags(context){const features=makeTagFeatures(context),upos=scoreNaiveBayes(posTagger,features),morphology=Object.create(null);for(const [key,model] of morphologyTaggers){const [pos,feature]=key.split("|");if(!morphology[pos])morphology[pos]=Object.create(null);morphology[pos][feature]=scoreNaiveBayes(model,features);}return{upos,morphology,featureCount:features.length};}

 const forms=new Map(),lemmas=new Map(),stems=new Map(),lemmaDf=new Map();
 const post=(map,key,id)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(id);};
 examples.forEach((ex,id)=>{const sf=new Set(),sl=new Set(),ss=new Set();for(const t of ex.context){if(!sf.has(t.form)){post(forms,t.form,id);sf.add(t.form);}if(!sl.has(t.lemma)){post(lemmas,t.lemma,id);sl.add(t.lemma);}if(!ss.has(t.stem)){post(stems,t.stem,id);ss.add(t.stem);}}for(const l of sl)lemmaDf.set(l,(lemmaDf.get(l)||0)+1);});
 function contextFor(text,index){const tokens=words(text);if(!tokens.length)return{tokens,index:-1,context:[]};const i=Math.max(0,Math.min(tokens.length-1,Math.floor(Number(index)||0))),context=[];for(let off=-windowSize;off<=windowSize;off++){if(!off)continue;const j=i+off;if(j<0||j>=tokens.length)continue;const form=tokens[j];context.push({form,offset:off,stem:stem(form),analyses:analyses.get(form)||[]});}return{tokens,index:i,context};}
 function shortlist(query){
  const lists=query.map((q,qi)=>{
   const ids=new Set(forms.get(q.form)||[]);
   for(const a of q.analyses)for(const id of lemmas.get(a.lemma)||[])ids.add(id);
   if(!q.analyses.length&&q.stem.length>=3)for(const id of stems.get(q.stem)||[])ids.add(id);
   return{qi,ids,size:ids.size};
  }).filter(row=>row.size).sort((a,b)=>a.size-b.size||a.qi-b.qi);
  const hits=new Map(),selected=lists.slice(0,Math.min(5,lists.length));
  for(const item of selected){
   const rarity=1+Math.log((examples.length+1)/(item.size+1));
   for(const id of item.ids){let row=hits.get(id);if(!row){row={count:0,weight:0};hits.set(id,row);}row.count++;row.weight+=rarity;}
  }
  return[...hits.entries()].filter(([,row])=>row.count>=2)
   .sort((a,b)=>b[1].count-a[1].count||b[1].weight-a[1].weight||a[0]-b[0])
   .slice(0,1400).map(([id])=>id);
 }
 function compare(query,ex,allowInversion){
  const used=new Set(),evidence=[];let matched=0,exact=0,lemmaMatches=0,aligned=0,weighted=0,possible=0;
  for(const q of query){const df=lemmaDf.get(q.analyses[0]?.lemma||q.stem)||0,idf=1+Math.log((examples.length+1)/(df+1));possible+=idf;let best=null;
   for(let j=0;j<ex.context.length;j++){if(used.has(j))continue;const r=ex.context[j],isExact=q.form===r.form,isLemma=!isExact&&q.analyses.some(a=>a.lemma===r.lemma),isStem=!isExact&&!isLemma&&!q.analyses.length&&q.stem.length>=3&&q.stem===r.stem;if(!isExact&&!isLemma&&!isStem)continue;
    const same=q.offset===r.offset,inv=q.offset===-r.offset;let pw=same?1:0;if(!same&&allowInversion&&inv)pw=.55;if(!same&&!inv&&Math.sign(q.offset)===Math.sign(r.offset)&&Math.abs(q.offset-r.offset)===1)pw=.72;if(!pw)continue;
    const lw=isExact?1:isLemma ? 0.86 : 0.62,pos=q.analyses.some(a=>a.upos===r.upos)? 0.05 : 0,quality=(lw+pos)*pw*idf;if(!best||quality>best.quality)best={j,quality,isExact,isLemma,same,r};
   }
   if(!best)continue;used.add(best.j);matched++;weighted+=best.quality;if(best.isExact)exact++;else if(best.isLemma)lemmaMatches++;if(best.same)aligned++;
   evidence.push({token:q.form,matched:best.r.form,lemma:best.r.lemma,offset:q.offset,trainingOffset:best.r.offset,kind:best.isExact?"form":best.isLemma?"lemma":"stem"});
  }
  const coverage=query.length?matched/query.length:0,exactRatio=matched?exact/matched:0,alignment=matched?aligned/matched:0;
  return{matched,coverage,score:.72*(possible?weighted/possible:0)+.18*coverage+.06*exactRatio+.04*alignment,exact,lemmaMatches,aligned,evidence};
 }
 function inferHints(parsed,numberHint){
  const byOffset=new Map(parsed.context.map(row=>[row.offset,row]));
  const left=byOffset.get(-1),right=byOffset.get(1);
  const analyses=row=>row&&Array.isArray(row.analyses)?row.analyses:[];
  const has=(row,upos)=>analyses(row).some(a=>a.upos===upos);
  const hasAny=(row,upos)=>analyses(row).some(a=>upos.includes(a.upos));
  const featureValues=(row,upos,key)=>{
   const values=analyses(row).filter(a=>!upos||upos.includes(a.upos)).map(a=>a.feats&&a.feats[key]).filter(Boolean);
   const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);
   if(!counts.size)return[];
   const max=Math.max(...counts.values());return[...counts.entries()].filter(([,count])=>count===max).map(([value])=>value);
  };
  const pos=Object.create(null),features=[];
  const addPos=(name,value)=>{pos[name]=(pos[name]||0)+value;};
  const addFeature=(upos,key,values,weight)=>{if(values&&values.length)features.push({upos,key,values:[...new Set(values)],weight});};
  if(has(left,"ADP")){
   addPos("NOUN",.12);addPos("PROPN",.08);addPos("PRON",.08);addPos("ADJ",.04);addPos("VERB",-.12);addPos("AUX",-.08);
   const prep=left.form;
   const prepCases={"к":["Dat"],"ко":["Dat"],"из":["Gen"],"изо":["Gen"],"от":["Gen"],"ото":["Gen"],"у":["Gen"],"без":["Gen"],"до":["Gen"],"для":["Gen"],"после":["Gen"],"около":["Gen"],"вокруг":["Gen"],"о":["Loc"],"об":["Loc"],"обо":["Loc"],"над":["Ins"],"перед":["Ins"],"между":["Ins"],"при":["Loc"],"с":["Ins","Gen"]};
   addFeature(["NOUN","PROPN","PRON","ADJ"],"Case",prepCases[prep],.11);
  }
  if(has(left,"ADJ")){
   addPos("NOUN",.13);addPos("PROPN",.07);
   addFeature(["NOUN","PROPN"],"Number",featureValues(left,["ADJ"],"Number"),.07);
   addFeature(["NOUN","PROPN"],"Case",featureValues(left,["ADJ"],"Case"),.07);
   addFeature(["NOUN","PROPN"],"Gender",featureValues(left,["ADJ"],"Gender"),.05);
  }
  if(has(left,"NUM")){addPos("NOUN",.10);addPos("PROPN",.04);addFeature(["NOUN","PROPN"],"Number",["Sing","Plur"],.015);}
  if(has(right,"NOUN")||has(right,"PROPN")){
   addFeature(["ADJ"],"Number",featureValues(right,["NOUN","PROPN"],"Number"),.07);
   addFeature(["ADJ"],"Case",featureValues(right,["NOUN","PROPN"],"Case"),.07);
   addFeature(["ADJ"],"Gender",featureValues(right,["NOUN","PROPN"],"Gender"),.05);
  }
  const leftSubject=analyses(left).filter(a=>["NOUN","PROPN","PRON"].includes(a.upos)&&a.feats&&a.feats.Case==="Nom");
  const rightObject=analyses(right).filter(a=>["NOUN","PROPN","PRON"].includes(a.upos)&&a.feats&&a.feats.Case==="Acc");
  if(leftSubject.length&&rightObject.length){
   addPos("VERB",.24);addPos("AUX",.08);addPos("NOUN",-.10);addPos("ADJ",-.08);addPos("PRON",-.06);
  }else if(leftSubject.length&&hasAny(right,["NOUN","PROPN","PRON"])){
   addPos("VERB",.14);addPos("AUX",.05);
  }
  if(hasAny(right,["VERB","AUX"])&&hasAny(left,["NOUN","PROPN","PRON"])){
   const leftCase=featureValues(left,["NOUN","PROPN","PRON"],"Case");
   if(leftCase.includes("Ins")||leftCase.includes("Gen")||leftCase.includes("Dat")){
    addPos("PRON",.11);addPos("NOUN",.08);addPos("PROPN",.05);
    addFeature(["NOUN","PROPN","PRON"],"Case",leftCase,.04);
   }
  }
  if(numberHint&&numberHint.number)addFeature(["NOUN","PROPN","PRON","VERB","AUX","ADJ"],"Number",[numberHint.number==="plural"?"Plur":"Sing"],.08);
  return{pos,features,numberHint};
 }
 function predictMasked(text,index,predictOptions={}){
  const parsed=contextFor(text,index);if(parsed.index<0)return{available:false,reason:"empty_input",candidates:[],context:[]};
  if(parsed.context.length<2)return{available:false,reason:"insufficient_context",candidates:[],context:parsed.context};
  const tagPrediction=predictTags(parsed.context),ids=shortlist(parsed.context);if(!ids.length)return{available:false,reason:"no_context_match",candidates:[],context:parsed.context,targetSurfaceUsed:false,tagPrediction};
  const numberHint=modelApi&&typeof modelApi.inferMaskedNumber==="function"?modelApi.inferMaskedNumber(parsed.tokens,parsed.index):null,hints=inferHints(parsed,numberHint),hint=numberHint,byTarget=new Map();
  for(const id of ids){const ex=examples[id],m=compare(parsed.context,ex,predictOptions.allowOrderInversion===true);if(m.matched<2||m.coverage<.25)continue;const t=ex.target,k=t.form+"|"+t.lemma+"|"+t.upos;if(!byTarget.has(k))byTarget.set(k,{target:t,scores:[],best:null});const row=byTarget.get(k);row.scores.push(m.score);if(!row.best||m.score>row.best.score)row.best=m;}
  const out=[];for(const row of byTarget.values()){const avg=row.scores.reduce((s,v)=>s+v,0)/row.scores.length,t=row.target,f=t.feats||{};let score=Math.min(1,row.best.score*.82+avg*.12+Math.min(.06,Math.max(0,row.scores.length-1)*.015));
   score+=hints.pos[t.upos]||0;
   const posProbability=tagPrediction.upos.find(item=>item.label===t.upos)?.probability||0,maxPosProbability=tagPrediction.upos[0]?.probability||1;
   if(posProbability>0)score+=.045*Math.log(Math.max(1e-8,posProbability)/Math.max(1e-8,maxPosProbability));
   for(const key of Object.keys(f)){const distribution=tagPrediction.morphology[t.upos]&&tagPrediction.morphology[t.upos][key];if(!distribution||!distribution.length)continue;const predicted=distribution.find(item=>item.label===f[key])?.probability||0,maximum=distribution[0].probability||1;if(predicted>0)score+=.022*Math.log(Math.max(1e-8,predicted)/Math.max(1e-8,maximum));}
   for(const constraint of hints.features){
    if(!constraint.upos.includes(t.upos)||!f[constraint.key])continue;
    score+=constraint.values.includes(f[constraint.key])?constraint.weight:-constraint.weight*.75;
   }
   score=Math.max(0,Math.min(1,score));out.push({form:t.form,surface:t.form,lemma:t.lemma,upos:t.upos,features:{...f},score,support:row.scores.length,matchedCount:row.best.matched,contextCoverage:row.best.coverage,exactContextMatches:row.best.exact,lemmaContextMatches:row.best.lemmaMatches,alignedOffsets:row.best.aligned,matchedContext:row.best.evidence});}
  out.sort((a,b)=>b.score-a.score||b.support-a.support||a.form.localeCompare(b.form));const unique=[],seen=new Set();for(const c of out){const k=c.form+"|"+c.lemma+"|"+c.upos;if(seen.has(k))continue;seen.add(k);unique.push(c);if(unique.length>=Math.max(1,Math.min(12,Math.floor(Number(predictOptions.limit)||8))))break;}
  return{available:unique.length>0,reason:unique.length?null:"no_context_match",maskedTokenIndex:parsed.index,candidateCount:unique.length,candidates:unique,morphologyHint:hint,contextHints:hints,tagPrediction,contextTokenCount:parsed.context.length,method:"ud_annotated_context_retrieval",targetSurfaceUsed:false};
 }
 const status={sentenceCount:clean.length,annotatedTokenCount:clean.reduce((s,r)=>s+r.tokens.length,0),contextExamples:examples.length,vocabularyForms:analyses.size,vocabularyLemmas:new Set([...analyses.values()].flat().map(a=>a.lemma)).size,windowSize};
 return Object.freeze({predictMasked,status:()=>({...status,tagExamples:taggerRows.length,posLabels:posTagger.labels.length,morphologyHeads:morphologyTaggers.size})});
}
root.NGUDContextCandidateRanker=Object.freeze({schema:"NG_UD_CONTEXT_CANDIDATE_RANKER_V1",parseConllu,create,tokenize:words});
})();