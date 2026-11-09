(() => {
  "use strict";
  const clean=(value,limit=180)=>String(value==null?"":value).replace(/\\s+/gu," ").trim().slice(0,limit);
  function create(knowledge) {
    if(!knowledge||typeof knowledge.sameEntity!=="function"||typeof knowledge.normalise!=="function")
      throw new Error("NGDiscriminatingObservations requires NGKnowledge comparison methods");
    const entityKey=value=>knowledge.canonicalEntity?knowledge.canonicalEntity(value):knowledge.normalise(value);
    const edgeKey=edge=>entityKey(edge&&edge.subject)+"=>"+entityKey(edge&&edge.object);
    const routeLabel=path=>[path[0].subject,...path.map(edge=>edge.object)].map(value=>clean(value,90)).join(" → ").slice(0,150);
    function observationState(edge,claims) {
      const matches=(claims||[]).filter(claim=>claim&&claim.kind==="observation"&&claim.status!=="superseded"&&
        knowledge.sameEntity(claim.subject,edge.subject)&&knowledge.sameEntity(claim.object,edge.object));
      const unique=new Map();
      for(const claim of matches) {
        const key=claim.id||knowledge.normalise(claim.evidence||"");
        if(key&&!unique.has(key))unique.set(key,claim);
      }
      const rows=[...unique.values()];
      const polarities=new Set(rows.map(claim=>claim.polarity===false?"counter":"support"));
      const incomplete=rows.some(claim=>{
        const details=claim.observationCase||{};
        return ["context","timing","criterion"].some(field=>!details[field]||details[field].status!=="provided");
      });
      return {present:rows.length>0,mixed:polarities.size>1,incomplete};
    }
    function gapScore(state) {
      if(!state.present)return 1;
      if(state.mixed)return state.incomplete?0.96:0.9;
      return state.incomplete?0.84:0.68;
    }
    function firstDivergence(left,right) {
      let index=0;
      while(index<left.length&&index<right.length&&edgeKey(left[index])===edgeKey(right[index]))index++;
      if(index>=left.length||index>=right.length)return null;
      if(edgeKey(left[index])===edgeKey(right[index]))return null;
      return {index,left:left[index],right:right[index]};
    }
    function analyze(conclusion,claims) {
      if(!conclusion||typeof conclusion.subject!=="string"||typeof conclusion.object!=="string")return null;
      const paths=(Array.isArray(conclusion.paths)?conclusion.paths:[]).slice(0,3).map(path=>
        (Array.isArray(path)?path:[]).filter(edge=>edge&&typeof edge.subject==="string"&&typeof edge.object==="string")
          .slice(0,3)).filter(path=>path.length>=1);
      if(paths.length<2)return null;
      const uniquePaths=[...new Map(paths.map(path=>[path.map(edgeKey).join("|"),path])).values()];
      if(uniquePaths.length<2)return null;
      const ordered=uniquePaths.map(path=>({path,label:routeLabel(path)}))
        .sort((a,b)=>a.label.localeCompare(b.label,"ru"));
      const pairs=[];
      for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++) {
        const divergence=firstDivergence(ordered[i].path,ordered[j].path);
        if(!divergence)continue;
        const leftState=observationState(divergence.left,claims);
        const rightState=observationState(divergence.right,claims);
        const score=(gapScore(leftState)+gapScore(rightState))/2;
        const keys=[edgeKey(divergence.left),edgeKey(divergence.right)].sort();
        pairs.push({left:ordered[i],right:ordered[j],divergence,leftState,rightState,score,
          pairKey:keys.join("~")});
      }
      if(!pairs.length)return null;
      pairs.sort((a,b)=>b.score-a.score||a.pairKey.localeCompare(b.pairKey));
      const selected=pairs[0],target=clean(conclusion.object,100);
      const signature="discriminating_observations|"+entityKey(conclusion.subject)+"=>"+entityKey(conclusion.object)+"|"+selected.pairKey;
      const question="В сохранённом выводе «"+clean(conclusion.subject,90)+" → "+target+"» есть два возможных маршрута:\n"+
        "1) "+selected.left.label+"\n"+
        "2) "+selected.right.label+"\n\n"+
        "Вспомни естественные случаи, если они были, когда условия двух объяснений различались: одно исходное условие присутствовало без другого или наоборот. Что происходило с итогом «"+
        target+"» в каждом случае? Уточни контекст, время и критерий результата. Если таких случаев не помнишь, так и скажи. Не нужно специально создавать условия.";
      const edges=[selected.divergence.left,selected.divergence.right].map(edge=>({
        subject:clean(edge.subject,180),object:clean(edge.object,180)
      }));
      const sourceClaimIds=[...new Set((claims||[]).filter(claim=>claim&&typeof claim.id==="string"&&
        claim.status!=="superseded"&&edges.some(edge=>
          knowledge.sameEntity(claim.subject,edge.subject)&&knowledge.sameEntity(claim.object,edge.object))&&
        ["causal","observation"].includes(claim.kind)).map(claim=>claim.id))].slice(0,12);
      const commonPrefix=selected.divergence.index;
      const reason="Два сохранённых маршрута ведут к одному результату, но расходятся после "+
        commonPrefix+" общих звеньев. Я выбрал различающиеся звенья «"+edges[0].subject+" → "+edges[0].object+
        "» и «"+edges[1].subject+" → "+edges[1].object+"». По ним не хватает сопоставимых прямых наблюдений; вопрос ищет естественные случаи, которые могли бы различить объяснения. Общие звенья и число маршрутов не считаются независимыми подтверждениями.";
      return {signature,edgeSubject:edges[0].subject,edgeObject:edges[0].object,comparisonEdges:edges,
        question:question.slice(0,700),reason:reason.slice(0,700),score:Math.round(selected.score*100),
        commonPrefix,sourceClaimIds};
    }
    return {version:1,analyze};
  }
  window.NGDiscriminatingObservations={version:1,create};
})();