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
   for(let off=-windowSize;off<=windowSize;off++){if(!off)continue;const j=i+off;if(j<0||j>=sent.tokens.length)continue;const t=sent.tokens[j];context.push({form:t.form,lemma:t.lemma,upos:t.upos,offset:off,stem:stem(t.lemma)});}
   if(context.length>=2)examples.push({target:{form:target.form,lemma:target.lemma,upos:target.upos,feats:target.feats},context});
  }
 }
 if(!examples.length)throw new TypeError("The annotated corpus produced no context examples.");
 const forms=new Map(),lemmas=new Map(),stems=new Map(),lemmaDf=new Map();
 const post=(map,key,id)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(id);};
 examples.forEach((ex,id)=>{const sf=new Set(),sl=new Set(),ss=new Set();for(const t of ex.context){if(!sf.has(t.form)){post(forms,t.form,id);sf.add(t.form);}if(!sl.has(t.lemma)){post(lemmas,t.lemma,id);sl.add(t.lemma);}if(!ss.has(t.stem)){post(stems,t.stem,id);ss.add(t.stem);}}for(const l of sl)lemmaDf.set(l,(lemmaDf.get(l)||0)+1);});
 function contextFor(text,index){const tokens=words(text);if(!tokens.length)return{tokens,index:-1,context:[]};const i=Math.max(0,Math.min(tokens.length-1,Math.floor(Number(index)||0))),context=[];for(let off=-windowSize;off<=windowSize;off++){if(!off)continue;const j=i+off;if(j<0||j>=tokens.length)continue;const form=tokens[j];context.push({form,offset:off,stem:stem(form),analyses:analyses.get(form)||[]});}return{tokens,index:i,context};}
 function shortlist(query){const hits=new Map();const add=(ids,qi)=>{for(const id of ids||[]){if(!hits.has(id))hits.set(id,new Set());hits.get(id).add(qi);}};query.forEach((q,qi)=>{add(forms.get(q.form),qi);for(const a of q.analyses)add(lemmas.get(a.lemma),qi);if(!q.analyses.length&&q.stem.length>=3)add(stems.get(q.stem),qi);});return[...hits.entries()].filter(([,v])=>v.size>=2).map(([id])=>id).sort((a,b)=>a-b);}
 function compare(query,ex,allowInversion){
  const used=new Set(),evidence=[];let matched=0,exact=0,lemmaMatches=0,aligned=0,weighted=0,possible=0;
  for(const q of query){const df=lemmaDf.get(q.analyses[0]?.lemma||q.stem)||0,idf=1+Math.log((examples.length+1)/(df+1));possible+=idf;let best=null;
   for(let j=0;j<ex.context.length;j++){if(used.has(j))continue;const r=ex.context[j],isExact=q.form===r.form,isLemma=!isExact&&q.analyses.some(a=>a.lemma===r.lemma),isStem=!isExact&&!isLemma&&!q.analyses.length&&q.stem.length>=3&&q.stem===r.stem;if(!isExact&&!isLemma&&!isStem)continue;
    const same=q.offset===r.offset,inv=q.offset===-r.offset;let pw=same?1:0;if(!same&&allowInversion&&inv)pw=.55;if(!same&&!inv&&Math.sign(q.offset)===Math.sign(r.offset)&&Math.abs(q.offset-r.offset)===1)pw=.72;if(!pw)continue;
    const lw=isExact?1:isLemma?.86:.62,pos=q.analyses.some(a=>a.upos===r.upos)?.05:0,quality=(lw+pos)*pw*idf;if(!best||quality>best.quality)best={j,quality,isExact,isLemma,same,r};
   }
   if(!best)continue;used.add(best.j);matched++;weighted+=best.quality;if(best.isExact)exact++;else if(best.isLemma)lemmaMatches++;if(best.same)aligned++;
   evidence.push({token:q.form,matched:best.r.form,lemma:best.r.lemma,offset:q.offset,trainingOffset:best.r.offset,kind:best.isExact?"form":best.isLemma?"lemma":"stem"});
  }
  const coverage=query.length?matched/query.length:0,exactRatio=matched?exact/matched:0,alignment=matched?aligned/matched:0;
  return{matched,coverage,score:.72*(possible?weighted/possible:0)+.18*coverage+.06*exactRatio+.04*alignment,exact,lemmaMatches,aligned,evidence};
 }
 function predictMasked(text,index,predictOptions={}){
  const parsed=contextFor(text,index);if(parsed.index<0)return{available:false,reason:"empty_input",candidates:[],context:[]};
  if(parsed.context.length<2)return{available:false,reason:"insufficient_context",candidates:[],context:parsed.context};
  const ids=shortlist(parsed.context);if(!ids.length)return{available:false,reason:"no_context_match",candidates:[],context:parsed.context,targetSurfaceUsed:false};
  const hint=modelApi&&typeof modelApi.inferMaskedNumber==="function"?modelApi.inferMaskedNumber(parsed.tokens,parsed.index):null,byTarget=new Map();
  for(const id of ids){const ex=examples[id],m=compare(parsed.context,ex,predictOptions.allowOrderInversion===true);if(m.matched<2||m.coverage<.25)continue;const t=ex.target,k=t.form+"|"+t.lemma+"|"+t.upos;if(!byTarget.has(k))byTarget.set(k,{target:t,scores:[],best:null});const row=byTarget.get(k);row.scores.push(m.score);if(!row.best||m.score>row.best.score)row.best=m;}
  const out=[];for(const row of byTarget.values()){const avg=row.scores.reduce((s,v)=>s+v,0)/row.scores.length,t=row.target,f=t.feats||{};let score=Math.min(1,row.best.score*.82+avg*.12+Math.min(.06,Math.max(0,row.scores.length-1)*.015));if(hint?.number==="plural"&&f.Number)score+=f.Number==="Plur"?.08:-.08;if(hint?.number==="singular"&&f.Number)score+=f.Number==="Sing"?.08:-.08;score=Math.max(0,Math.min(1,score));out.push({form:t.form,surface:t.form,lemma:t.lemma,upos:t.upos,features:{...f},score,support:row.scores.length,matchedCount:row.best.matched,contextCoverage:row.best.coverage,exactContextMatches:row.best.exact,lemmaContextMatches:row.best.lemmaMatches,alignedOffsets:row.best.aligned,matchedContext:row.best.evidence});}
  out.sort((a,b)=>b.score-a.score||b.support-a.support||a.form.localeCompare(b.form));const unique=[],seen=new Set();for(const c of out){const k=c.form+"|"+c.lemma+"|"+c.upos;if(seen.has(k))continue;seen.add(k);unique.push(c);if(unique.length>=Math.max(1,Math.min(12,Math.floor(Number(predictOptions.limit)||8))))break;}
  return{available:unique.length>0,reason:unique.length?null:"no_context_match",maskedTokenIndex:parsed.index,candidateCount:unique.length,candidates:unique,morphologyHint:hint,contextTokenCount:parsed.context.length,method:"ud_annotated_context_retrieval",targetSurfaceUsed:false};
 }
 const status={sentenceCount:clean.length,annotatedTokenCount:clean.reduce((s,r)=>s+r.tokens.length,0),contextExamples:examples.length,vocabularyForms:analyses.size,vocabularyLemmas:new Set([...analyses.values()].flat().map(a=>a.lemma)).size,windowSize};
 return Object.freeze({predictMasked,status:()=>({...status})});
}
root.NGUDContextCandidateRanker=Object.freeze({schema:"NG_UD_CONTEXT_CANDIDATE_RANKER_V1",parseConllu,create,tokenize:words});
})();