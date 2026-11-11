(() => {
  "use strict";
  const INACTIVE_STATUSES = new Set(["historical","archived","retracted","expired","inactive","superseded"]);
  function parseClaimTime(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      return value > 0 && value < 1e11 ? value * 1000 : value;
    if (typeof value === "string" && value.trim()) {
      const numeric = /^\d+(?:\.\d+)?$/u.test(value.trim()) ? Number(value.trim()) : NaN;
      if (Number.isFinite(numeric)) return numeric > 0 && numeric < 1e11 ? numeric * 1000 : numeric;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function localDateStart(year, monthIndex, day = 1) {
    return new Date(year, monthIndex, day, 0, 0, 0, 0).getTime();
  }
  function parseTemporalPeriod(value, referenceTime = Date.now()) {
    const rawText=String(value||"").trim();
    const text = normalise(rawText);
    const anchor = new Date(parseClaimTime(referenceTime) || Date.now());
    const year = anchor.getFullYear(), month = anchor.getMonth(), day = anchor.getDate();
    const period = (start, end, precision, label) => ({start,end,precision,label,expression:String(value || "").trim()});
    let match = rawText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
    if (match) {
      const y=Number(match[1]),m=Number(match[2])-1,d=Number(match[3]);
      const start=localDateStart(y,m,d), check=new Date(start);
      if (check.getFullYear()===y && check.getMonth()===m && check.getDate()===d)
        return period(start,localDateStart(y,m,d+1),"day",d+"."+String(m+1).padStart(2,"0")+"."+y);
      return null;
    }
    match = rawText.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/u);
    if (match) {
      const d=Number(match[1]),m=Number(match[2])-1,y=Number(match[3]);
      const start=localDateStart(y,m,d),check=new Date(start);
      if (check.getFullYear()===y && check.getMonth()===m && check.getDate()===d)
        return period(start,localDateStart(y,m,d+1),"day",String(d).padStart(2,"0")+"."+String(m+1).padStart(2,"0")+"."+y);
      return null;
    }
    const monthNames = [
      ["январь","января","январе","январем","январю"],
      ["февраль","февраля","феврале","февралем","февралю"],
      ["март","марта","марте","мартом","марту"],
      ["апрель","апреля","апреле","апрелем","апрелю"],
      ["май","мая","мае","маем","маю"],
      ["июнь","июня","июне","июнем","июню"],
      ["июль","июля","июле","июлем","июлю"],
      ["август","августа","августе","августом","августу"],
      ["сентябрь","сентября","сентябре","сентябрем","сентябрю"],
      ["октябрь","октября","октябре","октябрем","октябрю"],
      ["ноябрь","ноября","ноябре","ноябрем","ноябрю"],
      ["декабрь","декабря","декабре","декабрем","декабрю"]
    ];
    const words=text.split(/\s+/u);
    const monthIndex=monthNames.findIndex(forms=>forms.includes(words[0]));
    if(monthIndex>=0 && words.length>=2 && /^\d{4}$/u.test(words[1])) {
      const y=Number(words[1]),start=localDateStart(y,monthIndex,1);
      return period(start,localDateStart(y,monthIndex+1,1),"month",monthNames[monthIndex][0]+" "+y);
    }
    match=text.match(/^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s+год(?:а|у)?)?$/iu);
    if(match) {
      const d=Number(match[1]),monthAt=monthNames.findIndex(forms=>forms.includes(normalise(match[2]))),y=Number(match[3]);
      if(monthAt<0)return null;
      const start=localDateStart(y,monthAt,d),check=new Date(start);
      if(check.getFullYear()===y&&check.getMonth()===monthAt&&check.getDate()===d)
        return period(start,localDateStart(y,monthAt,d+1),"day",String(d).padStart(2,"0")+"."+String(monthAt+1).padStart(2,"0")+"."+y);
      return null;
    }
    match=text.match(/^(летом|лето|лета|весной|весна|весне|осенью|осень|осени|зимой|зима|зиме)\s+(\d{4})$/u);
    if(match) {
      const season=match[1],y=Number(match[2]);
      const startMonth=/^лет/u.test(season)?5:/^вес/u.test(season)?2:/^ос/u.test(season)?8:11;
      const endMonth=startMonth===11?2:startMonth+3;
      const endYear=startMonth===11?y+1:y;
      return period(localDateStart(y,startMonth),localDateStart(endYear,endMonth),"season",
        (startMonth===5?"лето":startMonth===2?"весна":startMonth===8?"осень":"зима")+" "+y);
    }
    match=text.match(/^(\d{4})(?:\s+год(?:у|а)?)?$/u);
    if(match) {
      const y=Number(match[1]);
      return period(localDateStart(y,0,1),localDateStart(y+1,0,1),"year",String(y)+" год");
    }
    match=text.match(/^(позапрошл[\p{L}\p{M}]*|прошл[\p{L}\p{M}]*|эт[\p{L}\p{M}]*|следующ[\p{L}\p{M}]*)\s+год[\p{L}\p{M}]*$/u);
    if(match) {
      const offset=/^позапрошл/u.test(match[1])?-2:/^прошл/u.test(match[1])?-1:/^следующ/u.test(match[1])?1:0;
      const y=year+offset;
      return period(localDateStart(y,0,1),localDateStart(y+1,0,1),"year",String(y)+" год");
    }
    match=text.match(/^(позапрошл[\p{L}\p{M}]*|прошл[\p{L}\p{M}]*|эт[\p{L}\p{M}]*|следующ[\p{L}\p{M}]*)\s+месяц[\p{L}\p{M}]*$/u);
    if(match) {
      const offset=/^позапрошл/u.test(match[1])?-2:/^прошл/u.test(match[1])?-1:/^следующ/u.test(match[1])?1:0;
      const first=new Date(year,month+offset,1);
      return period(localDateStart(first.getFullYear(),first.getMonth(),1),
        localDateStart(first.getFullYear(),first.getMonth()+1,1),"month",
        first.toLocaleDateString("ru-RU",{month:"long",year:"numeric"}));
    }
    match=text.match(/^(позапрошл[\p{L}\p{M}]*|прошл[\p{L}\p{M}]*|эт[\p{L}\p{M}]*|следующ[\p{L}\p{M}]*)\s+недел[\p{L}\p{M}]*$/u);
    if(match) {
      const mondayOffset=(anchor.getDay()+6)%7;
      const thisMonday=localDateStart(year,month,day-mondayOffset);
      const offset=/^позапрошл/u.test(match[1])?-2:/^прошл/u.test(match[1])?-1:/^следующ/u.test(match[1])?1:0;
      const start=thisMonday+offset*7*86400000;
      return period(start,start+7*86400000,"week",new Date(start).toLocaleDateString("ru-RU")+" — "+new Date(start+6*86400000).toLocaleDateString("ru-RU"));
    }
    match=text.match(/^(позапрошл[\p{L}\p{M}]*|прошл[\p{L}\p{M}]*|эт[\p{L}\p{M}]*|следующ[\p{L}\p{M}]*)\s+(лет[\p{L}\p{M}]*|весн[\p{L}\p{M}]*|осен[\p{L}\p{M}]*|зим[\p{L}\p{M}]*)$/u);
    if(match) {
      const qualifier=match[1], seasonWord=match[2];
      const seasonMonth=/^лет/u.test(seasonWord)?5:/^вес/u.test(seasonWord)?2:/^ос/u.test(seasonWord)?8:11;
      const seasonName=seasonMonth===5?"лето":seasonMonth===2?"весна":seasonMonth===8?"осень":"зима";
      const candidates=[];
      for(let y=year-3;y<=year+2;y++){
        const start=localDateStart(y,seasonMonth,1);
        const end=localDateStart(seasonMonth===11?y+1:y,seasonMonth===11?2:seasonMonth+3,1);
        candidates.push({start,end,y});
      }
      let chosen=null;
      if(/^эт/u.test(qualifier)) {
        chosen=candidates.find(item=>item.start<=parseClaimTime(referenceTime)&&parseClaimTime(referenceTime)<item.end) ||
          candidates.filter(item=>item.y===year).sort((a,b)=>Math.abs(a.start-parseClaimTime(referenceTime))-Math.abs(b.start-parseClaimTime(referenceTime)))[0];
      } else if(/^следующ/u.test(qualifier)) {
        chosen=candidates.filter(item=>item.start>parseClaimTime(referenceTime)).sort((a,b)=>a.start-b.start)[0];
      } else {
        const completed=candidates.filter(item=>item.end<=parseClaimTime(referenceTime)).sort((a,b)=>b.start-a.start);
        chosen=completed[/^позапрошл/u.test(qualifier)?1:0];
      }
      return chosen?period(chosen.start,chosen.end,"season",seasonName+" "+chosen.y):null;
    }
    match=text.match(/^(сегодня|вчера|позавчера)$/u);
    if(match) {
      const offset=match[1]==="вчера"?-1:match[1]==="позавчера"?-2:0;
      const start=localDateStart(year,month,day+offset);
      return period(start,start+86400000,"day",new Date(start).toLocaleDateString("ru-RU"));
    }
    match=text.match(/^(\d+)\s+(день|дня|дней|недел[\p{L}\p{M}]*|месяц[\p{L}\p{M}]*|год|года|лет)\s+назад$/u);
    if(match) {
      const count=Math.max(1,Math.min(1000,Number(match[1])));
      let start;
      if(/^д/u.test(match[2])) start=localDateStart(year,month,day-count);
      else if(/^недел/u.test(match[2])) start=localDateStart(year,month,day-count*7);
      else if(/^месяц/u.test(match[2])) start=localDateStart(year,month-count,day);
      else start=localDateStart(year-count,month,day);
      const date=new Date(start);
      return period(start,localDateStart(date.getFullYear(),date.getMonth(),date.getDate()+1),"relative_day",date.toLocaleDateString("ru-RU"));
    }
    return null;
  }
  function extractTemporalHint(input, referenceTime = Date.now()) {
    const raw=String(input||"").trim();
    let match=raw.match(/^(раньше|ранее|прежде)\s+(.+)$/iu);
    if(match) return {text:match[2].trim(),status:"historical",expression:match[1].toLowerCase(),precision:"unknown",relation:"unspecified"};
    const prefixMarkers=[
      {pattern:/^(?:начиная\s+с|с)\s+/iu,relation:"since"},
      {pattern:/^(?:во\s+время|в\s+течение)\s+/iu,relation:"during"},
      {pattern:/^(?:до)\s+/iu,relation:"until"},
      {pattern:/^(?:после)\s+/iu,relation:"after"},
      {pattern:/^(?:по)\s+/iu,relation:"through"},
      {pattern:/^(?:на)\s+/iu,relation:"during"},
      {pattern:/^(?:в|за)\s+/iu,relation:"during"}
    ];
    for(const marker of prefixMarkers) {
      const found=raw.match(marker.pattern);
      if(!found) continue;
      const rest=raw.slice(found[0].length),parts=rest.split(/\s+/u);
      for(let size=Math.min(5,parts.length);size>=1;size--) {
        const expression=parts.slice(0,size).join(" ");
        const parsed=parseTemporalPeriod(expression,referenceTime);
        if(!parsed) continue;
        const tail=parts.slice(size).join(" ").trim();
        if(!tail) continue;
        const metadata={expression:expression,precision:parsed.precision,relation:marker.relation,
          validFrom:null,validTo:null,status:"current"};
        if(marker.relation==="since") metadata.validFrom=parsed.start;
        else if(marker.relation==="during"){metadata.validFrom=parsed.start;metadata.validTo=parsed.end;}
        else if(marker.relation==="until") metadata.validTo=parsed.start;
        else if(marker.relation==="through") metadata.validTo=parsed.end;
        else if(marker.relation==="after") metadata.validFrom=parsed.end;
        return {text:tail, ...metadata};
      }
    }
    const suffixPattern=/\s+(начиная\s+с|с|до|по|после|во\s+время|в\s+течение|на|в|за)\s+(.+)$/giu;
    const suffixes=[...raw.matchAll(suffixPattern)].reverse();
    for(const found of suffixes) {
      const parsed=parseTemporalPeriod(found[2],referenceTime);
      if(!parsed) continue;
      const marker=normalise(found[1]);
      const relation=marker==="с"||marker==="начиная с"?"since":
        marker==="до"?"until":marker==="по"?"through":marker==="после"?"after":"during";
      const metadata={expression:found[2].trim(),precision:parsed.precision,relation,
        validFrom:null,validTo:null,status:"current"};
      if(relation==="since")metadata.validFrom=parsed.start;
      else if(relation==="during"){metadata.validFrom=parsed.start;metadata.validTo=parsed.end;}
      else if(relation==="until")metadata.validTo=parsed.start;
      else if(relation==="through")metadata.validTo=parsed.end;
      else if(relation==="after")metadata.validFrom=parsed.end;
      return {text:raw.slice(0,found.index).trim(),...metadata};
    }
    const trailingDate=raw.match(/^(.+?)\s+(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[.\/]\d{1,2}[.\/]\d{4}|\d{1,2}\s+[а-яё]+\s+\d{4}(?:\s+год(?:а|у)?)?)[.!?]?$/iu);
    if(trailingDate) {
      const parsed=parseTemporalPeriod(trailingDate[2],referenceTime);
      if(parsed)return {text:trailingDate[1].trim(),expression:trailingDate[2],precision:parsed.precision,
        relation:"during",validFrom:parsed.start,validTo:parsed.end,status:"current"};
    }
    const firstParts=raw.split(/\s+/u);
    for(let size=Math.min(3,firstParts.length-1);size>=1;size--) {
      const expression=firstParts.slice(0,size).join(" ");
      const parsed=parseTemporalPeriod(expression,referenceTime);
      if(parsed) return {text:firstParts.slice(size).join(" ").trim(),expression,precision:parsed.precision,
        relation:"during",validFrom:parsed.start,validTo:parsed.end,status:"current"};
    }
    return {text:raw,status:null,expression:"",precision:"",relation:"",validFrom:null,validTo:null};
  }
  function isClaimValidAt(claim, at = Date.now()) {
    if(!claim||String(claim.status||"current").toLowerCase()!=="current"||claim.supersededBy)return false;
    const window=claimTimeWindow(claim),moment=parseClaimTime(at);
    return window.valid&&moment!==null&&(window.from===null||window.from<=moment)&&(window.to===null||moment<window.to);
  }
  function temporalPeriodFromQuery(query, referenceTime = Date.now()) {
    const words=String(query||"").toLowerCase().replace(/[?!,;:()]/gu," ").split(/\s+/u).filter(Boolean);
    let best=null,bestStart=-1,bestLength=0;
    for(let i=0;i<words.length;i++) {
      for(let size=1;size<=Math.min(5,words.length-i);size++) {
        const parsed=parseTemporalPeriod(words.slice(i,i+size).join(" "),referenceTime);
        if(parsed&&(i>bestStart||(i===bestStart&&size>bestLength))) {
          best=parsed;bestStart=i;bestLength=size;
        }
      }
    }
    return best;
  }
  function temporalLocationAnswer(query, claims, referenceTime = Date.now()) {
    const q=normalise(query);
    if(!q.includes("где")||!/(?:жив|жил|жила|жили|нахож|находил)/u.test(q))return null;
    const requested=temporalPeriodFromQuery(query,referenceTime);
    if(!requested)return null;
    const allLocations=(Array.isArray(claims)?claims:[]).filter(claim=>
      claim&&claim.kind==="fact"&&claim.subject==="user"&&factFamily(claim.predicate)==="location"&&!claim.supersededBy
    );
    const locations=allLocations.filter(claim=>String(claim.status||"current").toLowerCase()==="current");
    const intersects=locations.filter(claim=>{
      const window=claimTimeWindow(claim);
      if(!window.valid||(window.from===null&&window.to===null))return false;
      return (window.to===null||window.to>requested.start)&&(window.from===null||window.from<requested.end);
    });
    const unique=[...new Map(intersects.map(claim=>[canonicalEntity(claim.object),claim])).values()];
    const period=requested.label;
    if(unique.length===1) {
      const claim=unique[0],window=claimTimeWindow(claim);
      const start=window.from===null?"начало периода не указано":"с "+new Date(window.from).toLocaleDateString("ru-RU");
      const end=window.to===null?"дата окончания не указана":"по "+new Date(window.to-1).toLocaleDateString("ru-RU");
      const boundsKnown=window.from!==null&&window.to!==null;
      const covers=window.from!==null&&window.from<=requested.start&&
        (window.to===null||window.to>=requested.end);
      const wording=covers&&boundsKnown
        ?"По сохранённой временной записи, в период «"+period+"» ты жил в "+claim.object+"."
        :"В памяти есть временная запись о "+claim.object+", пересекающаяся с периодом «"+period+"». "+start+", "+end+". Поэтому я не могу утверждать, что она покрывает весь указанный период.";
      return wording+" Источник: «"+claim.evidence+"». Это твоё сообщение, а не независимая проверка.";
    }
    if(unique.length>1) {
      const details=unique.map(claim=>{
        const window=claimTimeWindow(claim);
        const from=window.from===null?"начало не указано":new Date(window.from).toLocaleDateString("ru-RU");
        const to=window.to===null?"окончание не указано":new Date(window.to-1).toLocaleDateString("ru-RU");
        return claim.object+" ("+from+" — "+to+")";
      });
      return "В период «"+period+"» встречаются записи о нескольких местах проживания: "+
        details.join("; ")+". Запрошенный период может охватывать разные отрезки времени; без более точной даты я не буду выбирать одно место для всего периода.";
    }
    const undated=allLocations.filter(claim=>["historical","superseded"].includes(String(claim.status||"").toLowerCase())&&
      claim.validFrom==null&&claim.validTo==null);
    if(undated.length) return "Я нашёл прежнее самоописание: "+undated.map(claim=>claim.object).join(", ")+
      ", но в нём нет даты или периода. Поэтому не могу надёжно определить, относилось ли оно к «"+period+"».";
    return "В памяти нет датированного утверждения о месте проживания за период «"+period+"».";
  }
  function formatTimelineDate(value) {
    const time=parseClaimTime(value);
    return time===null?"дата не указана":new Date(time).toLocaleDateString("ru-RU");
  }
  function buildTemporalEvents(input, options={}) {
    const claims=Array.isArray(input)?input.filter(Boolean):[];
    const knownAt=options&&options.knownAt!==undefined?parseClaimTime(options.knownAt):null;
    const available=claims.filter(claim=>{
      if(!claim||typeof claim!=="object")return false;
      const recorded=parseClaimTime(claim.createdAt);
      return knownAt===null||recorded===null||recorded<=knownAt;
    });
    const dated=available.filter(claim=>{
      const window=claimTimeWindow(claim);
      return window.valid&&(window.from!==null||window.to!==null);
    });
    const events=[];
    const familyNames={location:"места проживания",work:"работы",study:"обучения"};
    for(const newer of dated) {
      if(newer.kind!=="fact"||newer.subject!=="user"||newer.validFrom==null)continue;
      const family=factFamily(newer.predicate);
      if(!["location","work","study"].includes(family))continue;
      const priorRows=dated.filter(prior=>prior!==newer&&prior.kind==="fact"&&prior.subject==="user"&&
        factFamily(prior.predicate)===family&&!sameEntity(prior.object,newer.object)&&
        prior.validTo!=null&&parseClaimTime(prior.validTo)===parseClaimTime(newer.validFrom)&&
        (parseClaimTime(prior.createdAt)??0)<=(parseClaimTime(newer.createdAt)??Number.MAX_SAFE_INTEGER));
      if(!priorRows.length)continue;
      const priorValues=[...new Map(priorRows.map(item=>[canonicalEntity(item.object),item])).values()];
      const at=parseClaimTime(newer.validFrom);
      events.push({
        id:makeId("event-transition",family+"|"+at+"|"+priorValues.map(item=>item.id).join("|")+"|"+newer.id),
        type:"transition",at,start:at,end:at,precision:newer.temporalPrecision||"unknown",
        subject:"user",family,from:priorValues.map(item=>item.object),to:newer.object,
        label:priorValues.length===1
          ?"Изменение "+familyNames[family]+": "+priorValues[0].object+" → "+newer.object
          :"Неоднозначное изменение "+familyNames[family]+": "+priorValues.map(item=>item.object).join(" / ")+" → "+newer.object,
        claimIds:[...priorValues.map(item=>item.id),newer.id].filter(Boolean),
        evidence:[...priorValues.map(item=>item.evidence),newer.evidence].filter(Boolean),
        ambiguous:priorValues.length>1
      });
    }
    const grouped=new Map();
    for(const claim of dated) {
      const window=claimTimeWindow(claim);
      const start=window.from,end=window.to;
      const eventRef=claim.observationCase&&claim.observationCase.eventRef
        ?normalise(claim.observationCase.eventRef):"";
      const evidence=normalise(claim.evidence||"");
      const groupKey=(eventRef?"event-ref:"+eventRef:"source:"+evidence)+"|"+String(start)+"|"+String(end);
      const old=grouped.get(groupKey);
      if(old) {
        if(claim.id)old.claimIds.push(claim.id);
        old.labels.push(claimLabel(claim));
        if(claim.evidence&&!old.evidence.includes(claim.evidence))old.evidence.push(claim.evidence);
      } else {
        grouped.set(groupKey,{
          id:makeId("event-record",groupKey),
          type:claim.kind==="observation"?"observation":"state_period",
          at:start!==null?start:end,start,end,
          precision:claim.temporalPrecision||"unknown",
          subject:claim.subject,predicate:claim.predicate,object:claim.object,
          family:claim.kind==="fact"&&claim.subject==="user"?factFamily(claim.predicate):claim.kind,
          label:claimLabel(claim),labels:[claimLabel(claim)],
          claimIds:claim.id?[claim.id]:[],evidence:claim.evidence?[claim.evidence]:[],
          temporalExpression:claim.temporalExpression||"",
          status:claim.status||"current",eventRef:eventRef||""
        });
      }
    }
    for(const item of grouped.values()) {
      if(item.labels.length>1)item.label=item.labels.join("; ");
      events.push(item);
    }
    return events.sort((a,b)=>(a.at??a.start??a.end??0)-(b.at??b.start??b.end??0)||
      String(a.type).localeCompare(String(b.type)));
  }
  function temporalStatusAt(claim, allClaims, cutoff) {
    const status=String(claim&&claim.status||"current").toLowerCase();
    const replacement=claim&&claim.supersededBy
      ?allClaims.find(item=>item&&item.id===claim.supersededBy):null;
    const replacementAt=replacement?parseClaimTime(replacement.createdAt):null;
    if(replacementAt!==null&&replacementAt>cutoff)return "на тот момент ещё не уточнено";
    if(status==="superseded"||replacementAt!==null)return "позднее уточнено";
    return status==="current"?"актуальная запись":status==="historical"?"историческое самоописание":status;
  }
  function eventOverlapsPeriod(event, period) {
    const start=event.start===null||event.start===undefined?-Infinity:event.start;
    const end=event.end===null||event.end===undefined?Infinity:event.end;
    if(event.type==="transition")return event.at>=period.start&&event.at<period.end;
    return start<period.end&&end>period.start;
  }
  function temporalHistoryAnswer(query, claims) {
    const q=normalise(query);
    if(!q)return null;
    const period=temporalPeriodFromQuery(query);
    const asksKnown=/(?:что ты знал|что тебе было известно|что было известно|что было в памяти|какие сведения уже были известны)/u.test(q);
    const asksChange=/(?:когда изменил|когда изменилось|когда сменил|когда сменилось|когда переехал|когда перешел|когда перешла|когда перешли|в какой момент измен|в какой момент смен)/u.test(q);
    const asksSimultaneous=/(?:одновременно|было истинно|было верно|было актуально)/u.test(q);
    const asksTimeline=/(?:хронолог|какие события|что происходило|что менялось|какие изменения|покажи историю событий|событийная история)/u.test(q);
    const allClaims=Array.isArray(claims)?claims.filter(Boolean):[];
    const events=buildTemporalEvents(allClaims);
    if(asksKnown) {
      if(!period)return null;
      const cutoff=period.end-1;
      const known=allClaims.filter(claim=>{
        const recorded=parseClaimTime(claim.createdAt);
        return recorded!==null&&recorded<=cutoff;
      }).sort((a,b)=>(parseClaimTime(a.createdAt)||0)-(parseClaimTime(b.createdAt)||0));
      if(!known.length)return "К концу периода «"+period.label+"» в моей сохранённой памяти ещё не было утверждений с известным временем записи.";
      const lines=known.slice(-12).map(claim=>{
        const status=temporalStatusAt(claim,allClaims,cutoff);
        const window=claimTimeWindow(claim);
        const future=window.from!==null&&window.from>cutoff?" · относится к будущему периоду с "+formatTimelineDate(window.from):"";
        return "• "+claimLabel(claim)+" · "+status+future+
          "\n  Записано: "+formatTimelineDate(claim.createdAt)+
          (claim.evidence?"\n  Источник: «"+String(claim.evidence).slice(0,180)+"»":"");
      });
      const later=allClaims.filter(claim=>{
        const recorded=parseClaimTime(claim.createdAt);
        return recorded!==null&&recorded>cutoff&&claim.supersededBy;
      }).length;
      return "Снимок памяти на конец периода «"+period.label+"» (до "+formatTimelineDate(cutoff)+"):\n\n"+
        lines.join("\n\n")+
        (known.length>12?"\n\nПоказаны последние 12 из "+known.length+" известных тогда записей.":"")+
        (later?"\n\nЕсть "+later+" более поздних записей; они не использовались для восстановления снимка.":"")+
        "\n\nЭто реконструкция по сохранённому времени записей и их источникам. Она не означает, что система тогда уже делала все нынешние выводы.";
    }
    if(asksChange) {
      const changes=events.filter(event=>event.type==="transition");
      if(!changes.length)return "В памяти нет пары датированных утверждений с совпадающей границей, по которой можно было бы надёжно восстановить момент изменения.";
      return "Найденные переходы в сохранённой истории:\n\n"+
        changes.map(event=>"• "+event.label+" · "+formatTimelineDate(event.at)+
          (event.ambiguous?" · исходное состояние неоднозначно":" · граница следует из временных интервалов")+
          "\n  Источники: "+event.evidence.map(value=>"«"+String(value).slice(0,160)+"»").join("; ")).join("\n\n")+
        "\n\nЕсли даты были указаны только как год, месяц или сезон, точнее календарной границы этих периодов я не утверждаю.";
    }
    if(asksSimultaneous) {
      if(!period)return null;
      const simultaneous=allClaims.filter(claim=>{
        const window=claimTimeWindow(claim);
        if(!window.valid||(window.from===null&&window.to===null))return false;
        const status=String(claim.status||"current").toLowerCase();
        if(status==="retracted"||status==="inactive")return false;
        return (window.to===null||window.to>period.start)&&(window.from===null||window.from<period.end);
      });
      if(!simultaneous.length)return "В памяти нет датированных утверждений, пересекающихся с периодом «"+period.label+"».";
      const lines=simultaneous.slice(0,12).map(claim=>{
        const window=claimTimeWindow(claim);
        const partial=(window.from!==null&&window.from>period.start)||(window.to!==null&&window.to<period.end);
        return "• "+claimLabel(claim)+(partial?" · запись покрывает только часть периода":" · запись пересекается с периодом")+
          "\n  Интервал: "+(window.from===null?"начало не указано":formatTimelineDate(window.from))+" — "+
          (window.to===null?"окончание не указано":formatTimelineDate(window.to-1))+
          "\n  Источник: «"+String(claim.evidence||"").slice(0,180)+"»";
      });
      return "Датированные утверждения, которые пересекаются с периодом «"+period.label+"»:\n\n"+
        lines.join("\n\n")+
        "\n\nСовпадение интервалов показывает только временное сосуществование записей. Оно само по себе не доказывает причинную связь или то, что все события происходили одновременно внутри этого периода.";
    }
    if(asksTimeline) {
      const relevant=period?events.filter(event=>eventOverlapsPeriod(event,period)):events;
      if(!relevant.length)return period
        ?"В памяти пока нет датированных событий или состояний за период «"+period.label+"»."
        :"В памяти пока нет событий с распознаваемыми временными границами.";
      const lines=relevant.slice(0,16).map(event=>{
        const when=event.type==="transition"?formatTimelineDate(event.at):
          (event.start!==null&&event.start!==undefined?formatTimelineDate(event.start):"до "+formatTimelineDate(event.end))+
          (event.end!==null&&event.end!==undefined?" — "+formatTimelineDate(event.end-1):" — окончание не указано");
        return "• "+when+" · "+event.label+
          (event.type==="transition"?" · переход":"")+
          "\n  Источник: "+event.evidence.map(value=>"«"+String(value).slice(0,160)+"»").join("; ");
      });
      return "Временная последовательность"+(period?" за период «"+period.label+"»":"")+":\n\n"+
        lines.join("\n\n")+
        (relevant.length>16?"\n\nПоказаны первые 16 из "+relevant.length+" записей.":"")+
        "\n\nЭто реконструкция интервалов из сохранённых сообщений, а не независимая проверка произошедших событий.";
    }
    return null;
  }
  function claimTimeWindow(claim) {
    const hasFrom = !!(claim && claim.validFrom !== undefined && claim.validFrom !== null && claim.validFrom !== "");
    const hasTo = !!(claim && claim.validTo !== undefined && claim.validTo !== null && claim.validTo !== "");
    const from = hasFrom ? parseClaimTime(claim.validFrom) : null;
    const to = hasTo ? parseClaimTime(claim.validTo) : null;
    return { valid: (!hasFrom || from !== null) && (!hasTo || to !== null) &&
      !(from !== null && to !== null && from >= to), from, to };
  }
  function isCurrentClaim(claim, at = Date.now()) {
    if (!claim) return false;
    const status = String(claim.status || "current").toLowerCase();
    if (status !== "current" || claim.supersededBy) return false;
    const window = claimTimeWindow(claim), moment = parseClaimTime(at);
    if (!window.valid || moment === null) return false;
    return (window.from === null || window.from <= moment) &&
      (window.to === null || moment < window.to);
  }
  function claimPeriodsOverlap(left, right) {
    const a = claimTimeWindow(left), b = claimTimeWindow(right);
    if (!a.valid || !b.valid) return false;
    return !((a.to !== null && b.from !== null && a.to <= b.from) ||
      (b.to !== null && a.from !== null && b.to <= a.from));
  }
  const STOP = new Set(("и в во на я ты мы вы они он она оно мне меня тебя тебе ваш ваши мой моя мое мои свой свои себя это этот эта эти тот та те что как где когда зачем почему кто который а но или да нет не ни же бы ли для по из к со с от до над под при про у об обо есть был была были быть буду будет уже еще очень также тут там туда сюда его ее их твой твоя твое твои").split(/\s+/u));
  const RELATIONS = ["самый близкий друг","лучшая подруга","лучший друг","близкий друг","друг","подруга","коллега","наставник","учитель","партнер","партнёр","товарищ","брат","сестра","враг","знакомый","знакомая"];
  const OWNER = {"твой":"assistant","твоя":"assistant","твоё":"assistant","твои":"assistant","твое":"assistant","мой":"user","моя":"user","моё":"user","мои":"user","мое":"user","наш":"shared","наша":"shared","наше":"shared","наши":"shared"};
  const SYSTEM_PROFILE = Object.freeze({
    name:"NEUROGENESIS",
    type:"экспериментальный браузерный прототип цифрового организма",
    architecture:"визуальная симуляция нейронной сети, локальная память и структурированные знания",
    memoryLimit:500,
    recordCharacterLimit:1200,
    languageModelConnected:false
  });
  function systemDescription() {
    return "Я — " + SYSTEM_PROFILE.name + ", " + SYSTEM_PROFILE.type + ". В основе — " +
      SYSTEM_PROFILE.architecture + ". Это встроенное описание программы, а не вывод из твоих сообщений.";
  }
  function capabilitiesAnswer() {
    return "В этой версии я умею сохранять до " + SYSTEM_PROFILE.memoryLimit +
      " записей длиной до " + SYSTEM_PROFILE.recordCharacterLimit +
      " символов, искать воспоминания, выделять простые факты, отношения, предпочтения, мнения и гипотезы, собирать профили объектов, связывать энграммы и распространять по ним ограниченную активацию. Из нескольких сохранённых причинных связей я могу предложить новые непроверенные гипотезы и показать цепочки-основания. Я распознаю некоторые явные и относительные временные выражения, связываю их с отдельными фактами и строю временную последовательность. Я отдельно учитываю, когда событие происходило и когда запись попала в память, поэтому могу реконструировать состояние на дату, показать одновременные интервалы и перечислить переходы между состояниями. Если граница времени не названа, я отмечаю её как неизвестную, а не придумываю дату. Можно просматривать, исправлять, удалять, экспортировать и импортировать память.\n\n" +
      "Но подключённой большой языковой модели у меня пока нет: я не умею свободно рассуждать или понимать любые формулировки. Ответы строятся на явных правилах и сохранённых сведениях. Нейронная сеть и её активность — вычислительная визуальная симуляция, а память хранится в этом браузере.";
  }
  const SEMANTIC_GROUPS = [
    ["автомобил","машин","авто"],
    ["телефон","смартфон"],
    ["ноутбук","лэптоп"],
    ["музык","песн","мелод"],
    ["спорт","тренировк","фитнес"]
  ];
  const EVALUATIONS = ["прекрасн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","великолепн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","красив(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","интересн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","важн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","ужасн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","скучн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","хорош(?:ий|ая|ее|ие|его|ей|ую|им|ими|о|а)?","плох(?:ой|ая|ое|ие|ого|ой|ую|им|ими|о|а)?","сложн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","прост(?:ой|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","удивительн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","грустн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","радостн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?"];
  const EVALUATION_RE = new RegExp("^(?:" + EVALUATIONS.join("|") + ")$", "iu");
  function normalise(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim().replace(/\s+/g, " ");
  }
  const IRREGULAR_STEMS = Object.freeze({
    // Russian genitive plural of «сердце» does not follow the regular suffix table.
    сердец: "сердц"
  });
  function tokens(value) {
    return normalise(value).split(" ").filter(word => word.length >= 3 && !STOP.has(word))
      .map(word => {
        if (IRREGULAR_STEMS[word]) return IRREGULAR_STEMS[word];
        // Preserve common surname endings in nominative; normalize genitive forms to the same base.
        if (word.length >= 7 && /(ева|ова)$/u.test(word)) return word.slice(0, -1);
        if (word.length >= 6 && /(ев|ов)$/u.test(word)) return word;
        const stem=word.replace(/(ениями|ениях|ению|ения|ение|ением|ений|иями|ия|ию|ии|ием|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|ах|ях|ей|ом|ем|а|я|ы|и|е|у|ю|ь)$/u, "");
        return stem.replace(/([ое])к$/u,"к");
      }).filter(word => word.length >= 3);
  }
  function semanticMatch(query, candidate) {
    const queryWords = [...new Set(Array.isArray(query) ? query : tokens(query))];
    const candidateWords = new Set(Array.isArray(candidate) ? candidate : tokens(candidate));
    let weightedHits = 0, directHits = 0, associativeHits = 0;
    const matches = [];
    for (const word of queryWords) {
      if (candidateWords.has(word)) {
        weightedHits += 1;
        directHits++;
        matches.push({query:word,matched:word,kind:"direct",weight:1});
        continue;
      }
      const group = SEMANTIC_GROUPS.find(items=>items.includes(word));
      const related = group && group.find(item=>item!==word&&candidateWords.has(item));
      if (related) {
        weightedHits += 0.45;
        associativeHits++;
        matches.push({query:word,matched:related,kind:"associative",weight:0.45});
      }
    }
    return {score:queryWords.length?weightedHits/queryWords.length:0,weightedHits,directHits,associativeHits,matches};
  }
  function canonicalEntity(value) {
    return tokens(value).join(" ");
  }
  function sameEntity(left, right) {
    const a = canonicalEntity(left);
    const b = canonicalEntity(right);
    return !!a && a === b;
  }
  function relationFamily(value) {
    const role = canonicalEntity(value);
    if (role.includes("друг") || role.includes("подруг") || role.includes("товарищ")) return "friend";
    if (role.includes("коллег")) return "colleague";
    if (role.includes("брат") || role.includes("сестр")) return "sibling";
    return role;
  }
  function factFamily(value) {
    const predicate = normalise(value);
    if (/^(?:живу в|нахожусь в)/u.test(predicate)) return "location";
    if (/^работаю(?: в)?$/u.test(predicate)) return "work";
    if (/^учусь(?: в)?$/u.test(predicate)) return "study";
    return canonicalEntity(value);
  }
  function cleanPart(value, max = 100) {
    return String(value || "").replace(/\s+/g, " ").trim().replace(/^[,.;:—–-]+|[,.;:—–-]+$/g, "").slice(0, max);
  }
  function makeId(kind, source) {
    const value = kind + "|" + normalise(source);
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "c" + (hash >>> 0).toString(36);
  }
  function makeClaim(kind, subject, predicate, object, evidence, verification, extractionConfidence, polarity = true) {
    const cleanEvidence = cleanPart(evidence, 1200);
    const claim = {id:makeId(kind,cleanEvidence),kind,subject:cleanPart(subject),predicate:cleanPart(predicate,80),object:cleanPart(object,180),holder:"user",polarity,source:"user_message",evidence:cleanEvidence,verification,extractionConfidence,traceId:null,createdAt:Date.now()};
    return claim.subject && claim.predicate && claim.object ? claim : null;
  }
  function extractRelationship(text) {
    const roles = RELATIONS.join("|");
    const owners = "твой|твоя|твоё|твое|твои|мой|моя|моё|мое|мои|наш|наша|наше|наши";
    const prefixPattern = new RegExp("^(.+?)\\s+(?:[—–-]\\s*)?(не\\s+)?(" + owners + ")\\s+(?:(?:самый|самая|самое)\\s+)?(" + roles + ")$", "iu");
    let match = text.match(prefixPattern);
    let subject, owner, relation, polarity = true;
    if (match) {
      subject = cleanPart(match[1]);
      polarity = !match[2];
      owner = OWNER[match[3].toLowerCase()];
      relation = match[4].toLowerCase().replace(/ё/g, "е");
    } else {
      const suffixPattern = new RegExp("^(не\\s+)?(" + owners + ")\\s+(?:(?:самый|самая|самое)\\s+)?(" + roles + ")\\s*(?:[—–-]\\s*|\\s+)(.+)$", "iu");
      match = text.match(suffixPattern);
      if (!match) return null;
      polarity = !match[1];
      owner = OWNER[match[2].toLowerCase()];
      relation = match[3].toLowerCase().replace(/ё/g, "е");
      subject = cleanPart(match[4]);
    }
    if (!subject || subject.split(" ").length > 6) return null;
    return makeClaim("relationship", subject, relation, owner, text, "unverified", 0.96, polarity);
  }
  function extractAssistantIdentity(text) {
    const match = text.match(/^(?:(теперь|с\s+этого\s+момента|отныне)\s+)?(?:ты|вы)\s*(?:[—–-]\s*)?(?:мой|моя|моё|мое)\s+(ассистент|оссистент|асистент|assistant|помощник|помощница|советник|собеседник|компаньон|партнер|партнёр|друг)$/iu);
    if (!match) return null;
    const role = ({ "оссистент":"ассистент", "асистент":"ассистент", "assistant":"ассистент" })[match[2].toLowerCase()] || match[2].toLowerCase();
    const claim = makeClaim("identity","assistant","роль",role,text,"self_reported",0.98);
    if (claim) { claim.revision = !!match[1]; claim.status = "current"; }
    return claim;
  }
  function extractAssistantCreator(text) {
    const match = text.match(/^(?:твоего\s+создателя\s+зовут|твой\s+создатель\s*(?:[—–-]\s*|это\s+|\s+)|тебя\s+создал(?:а|и)?\s+)(.+)$/iu);
    if (!match) return null;
    const name = cleanPart(match[1],180);
    if (!name || name.split(" ").length > 6) return null;
    return makeClaim("fact","assistant","создатель",name,text,"self_reported",0.97);
  }
  function extractConditionalRule(text) {
    const match=String(text||"").match(/^если\s+(.+?)\s*,?\s+то\s+(.+)$/iu);
    if(!match)return null;
    const condition=cleanPart(match[1],180),result=cleanPart(match[2],180);
    if(!condition||!result||condition.split(" ").length>10||result.split(" ").length>10||sameEntity(condition,result))return null;
    return makeClaim("rule",condition,"если-то",result,text,"unverified",0.9);
  }
  function observationFieldFromValue(rawValue, source) {
    const value=cleanPart(rawValue,240),normalized=normalise(value);
    if(!value)return {status:"not_stated",value:"",source:source||""};
    if(/(?:неизвестно|не знаю|невозможно установить|не удалось установить)/u.test(normalized))return {status:"unknown",value:"",source:source||""};
    if(/(?:не записан|не фиксировал|не сохранял|нет записи|нет данных|нет сведений|не указан|не описан|не установлен|не определен|не измерял|не оценивал)/u.test(normalized))return {status:"not_recorded",value:"",source:source||""};
    if(/^(?:нет|не было|отсутствует|отсутствовали|не проводилось|не применялось|не существовало)$/u.test(normalized))return {status:"none_reported",value:"",source:source||""};
    return {status:"provided",value,source:source||""};
  }
  function sanitizeObservationField(raw, source) {
    if(!raw||typeof raw!=="object")return {status:"not_stated",value:"",source:source||""};
    const allowed=["provided","not_stated","not_recorded","unknown","none_reported"];
    const status=allowed.includes(raw.status)?raw.status:"not_stated";
    return {status,value:status==="provided"?cleanPart(raw.value,240):"",
      source:["direct_observation","inquiry_response","user_reported"].includes(raw.source)?raw.source:(source||"")};
  }
  function sanitizeObservationDetails(raw, fallbackSource="user_reported") {
    const source=raw&&["direct_observation","inquiry_response","user_reported"].includes(raw.source)?raw.source:fallbackSource;
    return {schema:2,context:sanitizeObservationField(raw&&raw.context,source),
      timing:sanitizeObservationField(raw&&raw.timing,source),
      criterion:sanitizeObservationField(raw&&raw.criterion,source),
      outcome:sanitizeObservationField(raw&&raw.outcome,source),
      eventRef:raw&&typeof raw.eventRef==="string"?cleanPart(raw.eventRef,100):"",
      source,sourceRef:raw&&typeof raw.sourceRef==="string"?raw.sourceRef.slice(0,100):""};
  }
  function parseObservationDetails(input, source="user_reported") {
    const text=String(input||"").slice(0,1200);
    const result={schema:2,context:{status:"not_stated",value:"",source},
      timing:{status:"not_stated",value:"",source},criterion:{status:"not_stated",value:"",source},
      outcome:{status:"not_stated",value:"",source},eventRef:"",source,sourceRef:""};
    const labels=[
      {key:"context",pattern:/^(?:контекст|обстоятельства|условия|сопутствующие условия)\s*[:—-]\s*(.*)$/iu},
      {key:"timing",pattern:/^(?:время|дата|временной порядок|момент наблюдения)\s*[:—-]\s*(.*)$/iu},
      {key:"criterion",pattern:/^(?:критерий(?: результата)?|метод|способ оценки|измерение|оценка результата)\s*[:—-]\s*(.*)$/iu},
      {key:"outcome",pattern:/^(?:измеренный результат|результат измерения|результат по шкале|значение по шкале|числовое значение|результат|значение|балл|уровень|оценка по шкале)\s*[:—-]\s*(.*)$/iu}
    ];
    const segments=text.split(/[;|\n]+|(?<=[.!?])\s+/u);
    for(const segment of segments) {
      const part=segment.trim(),normalizedPart=normalise(part);
      for(const label of labels) {
        const match=part.match(label.pattern);
        if(match)result[label.key]=observationFieldFromValue(match[1],source);
      }
      const eventMatch=part.match(/^(?:событие|эпизод|идентификатор события)\s*[:—-]\s*(.*)$/iu);
      if(eventMatch) {
        const ref=observationFieldFromValue(eventMatch[1],source);
        result.eventRef=ref.status==="provided"?ref.value.slice(0,100):"";
      }
      if(result.context.status==="not_stated"&&/(?:услови|обстоятельств|контекст|сопутствующ)/u.test(normalizedPart)&&
          /(?:различ|отлич|неодинаков|сопоставим|на фоне|в условиях)/u.test(normalizedPart))
        result.context=observationFieldFromValue(part,source);
      if(result.timing.status==="not_stated"&&/(?:утром|днем|днём|вечером|ночью|сегодня|вчера|позавчера|неделю назад|месяц назад|\b\d{1,2}:\d{2}\b)/u.test(normalizedPart))
        result.timing=observationFieldFromValue(part,source);
      if(result.criterion.status==="not_stated"&&
          /(?:результат|усталост|концентрац|показател|значение).{0,70}(?:оценивал|измерял|определял|фиксировал|считался|по шкал|по балл|по самочувств)|(?:критерием было|критерием являлось|по шкале|по баллам|по самочувствию)/u.test(normalizedPart))
        result.criterion=observationFieldFromValue(part,source);
    }
    const normalized=normalise(text);
    const missingPatterns={
      context:/(?:контекст|обстоятельств|услови|сопутствующ).{0,90}(?:не указан|не описан|неизвест|не записан|не сохран|не установлен|нет |отсутств)|(?:не указан|не описан|неизвест|не записан|не сохран|не установлен|нет |отсутств).{0,90}(?:контекст|обстоятельств|услови|сопутствующ)/u,
      timing:/(?:время|дата|временн|момент наблюдения|временной порядок).{0,90}(?:не указан|не описан|неизвест|не записан|не сохран|не установлен|нет |отсутств)|(?:не указан|не описан|неизвест|не записан|не сохран|не установлен|нет |отсутств).{0,90}(?:время|дата|временн|момент наблюдения|временной порядок)/u,
      criterion:/(?:критери|метод|способ оценки|измерени|оценка результата|показател).{0,90}(?:не указан|не описан|неизвест|не записан|не сохран|не установлен|нет |отсутств)|(?:не указан|не описан|неизвест|не записан|не сохран|не установлен|нет |отсутств).{0,90}(?:критери|метод|способ оценки|измерени|оценка результата|показател)/u
    };
    const fieldPatterns={
      context:/(?:контекст|обстоятельств|услови|сопутствующ)/u,
      timing:/(?:время|дат|временн|момент наблюдения)/u,
      criterion:/(?:критери|метод|способ оценки|измерени|оценка результата|показател)/u
    };
    const unknownPatterns={
      context:/(?:неизвест|не знаю|невозможно установить|не удалось установить)/u,
      timing:/(?:неизвест|не знаю|невозможно установить|не удалось установить)/u,
      criterion:/(?:неизвест|не знаю|невозможно установить|не удалось установить)/u
    };
    for(const key of Object.keys(missingPatterns))if(result[key].status==="not_stated"&&missingPatterns[key].test(normalized)) {
      const scopedSegments=segments.map(segment=>normalise(segment)).filter(segment=>fieldPatterns[key].test(segment));
      const unknown=scopedSegments.some(segment=>unknownPatterns[key].test(segment));
      result[key]={status:unknown?"unknown":"not_recorded",value:"",source};
    }
    return result;
  }
  function extractObservation(text) {
    const raw=String(text||""),parts=raw.split(/[;|]/u);
    const statement=parts.shift().trim().replace(/^наблюдение\s*:\s*/iu,"");
    const match=statement.match(/^(?:при|во время|в условиях)\s+(.+?)\s+(?:(не)\s+)?(наблюдалось|наблюдалась|наблюдался|наблюдались|было|была|были)\s+(.+)$/iu);
    if(!match)return null;
    const condition=cleanPart(match[1],180),result=cleanPart(match[4],180);
    if(!condition||!result||condition.split(" ").length>10||result.split(" ").length>10||sameEntity(condition,result))return null;
    const claim=makeClaim("observation",condition,"наблюдение",result,raw,"unverified",0.86,!match[2]);
    if(claim)claim.observationCase=parseObservationDetails(parts.join("; "),"direct_observation");
    return claim;
  }
  function isReportedCausalStatement(value) {
    const normalized=normalise(value);
    return /^(?:согласно|по\s+(?:словам|данным|результатам|информации|сведениям|материалам|тексту)|как\s+(?:сообщается|указано|отмечено)|(?:в|по)\s+(?:исследовани[ея]|отчет[еа]|стать[ея]|публикаци[ия]|документ[еа]|источник[еа]|сообщени[ие]|текст[еа])\s+(?:говор[а-я]*|сообща[а-я]*|указыва[а-я]*|отмеча[а-я]*|утвержда[а-я]*|показыва[а-я]*|свидетельству[а-я]*|сказан[а-я]*|указан[а-я]*|отмечен[а-я]*)\s+что)(?:\s|$)/u.test(normalized) ||
      /^(?:исследовани[ея]|исследовател[ьи]|эксперимент[аы]?|работ[аы]|автор[ыа]|учен(?:ый|ые)|отчет[ыа])\s+(?:показал[аио]?|выявил[аио]?|установил[аио]?|подтвердил[аио]?|обнаружил[аио]?|сообщил[аио]?|отметил[аио]?|указал[аио]?|описал[аио]?|доказал[аио]?)\s+что(?:\s|$)/u.test(normalized);
  }
  function isValidCausalSubject(value) {
    const subject=cleanPart(value,180);
    if(!subject)return false;
    const normalized=normalise(subject);
    if(/^(?:что|то\s+что)\s+/u.test(normalized))return false;
    if(/(?:^|\s)(?:утверждение|сообщение|формулировка|цитата)\s+(?:о\s+том\s*)?что(?:\s|$)/u.test(normalized))return false;
    if(/^(?:(?:в\s+)?(?:текст[\p{L}\p{N}_]*|отчет[\p{L}\p{N}_]*|источник[\p{L}\p{N}_]*|сообщение[\p{L}\p{N}_]*|документ[\p{L}\p{N}_]*|запись[\p{L}\p{N}_]*)\s+)?(?:говор[\p{L}\p{N}_]*|сообща[\p{L}\p{N}_]*|указыва[\p{L}\p{N}_]*|отмеча[\p{L}\p{N}_]*|утвержда[\p{L}\p{N}_]*|сказан[\p{L}\p{N}_]*|указан[\p{L}\p{N}_]*|отмечен[\p{L}\p{N}_]*)\s+что(?:\s|$)/u.test(normalized))return false;
    if(isReportedCausalStatement(normalized))return false;
    return true;
  }
  function extractCausal(text) {
    const match=String(text||"").match(/^(.+?)\s+(?:(не)\s+)?(?:(может|могут)\s+)?(?:(не)\s+)?(вызывает|вызывают|вызывать|вызвать|приводит\s+к|приводить\s+к|приводят\s+к|привести\s+к)\s+(.+)$/iu);
    if(!match)return null;
    const cause=cleanPart(match[1],180),effect=cleanPart(match[6],180);
    if(!isValidCausalSubject(cause))return null;
    if(!cause||!effect||cause.split(" ").length>10||effect.split(" ").length>10||sameEntity(cause,effect))return null;
    const relation=match[5];
    const predicate=/вызыв|вызва/u.test(relation)?"вызывает":"приводит к";
    const polarity=!match[2]&&!match[4];
    const claim=makeClaim("causal",cause,predicate,effect,text,"unverified",0.88,polarity);
    if(claim)claim.modality=(!!match[3]||/вызывать|вызвать|приводить|привести/u.test(relation))?"possible":"asserted";
    return claim;
  }
  function extractPreference(text) {
    const match = text.match(/^(?:(теперь|сейчас|отныне)\s+)?(?:я\s+(люблю|обожаю|предпочитаю|ненавижу)|мне\s+(нравится|не\s+нравится))\s+(.+)$/iu);
    if (!match) return null;
    const predicate = (match[2] || match[3]).toLowerCase();
    const polarity = !/ненавижу|не\s+нравится/u.test(predicate);
    const claim = makeClaim("preference","user",predicate.replace(/^не\s+/u,""),cleanPart(match[4]),text,"self_reported",0.94,polarity);
    if (claim) { claim.revision = !!match[1]; claim.status = "current"; }
    return claim;
  }
  function extractOpinion(text) {
    const match = text.match(/^(.+?)\s+(?:не\s+)?(?:(?:очень|довольно|невероятно|действительно)\s+)?([а-яё]+)$/iu);
    if (!match || !EVALUATION_RE.test(match[2])) return null;
    const negative = /\sне\s/iu.test(text);
    const subject = cleanPart(text.replace(/\s+(?:не\s+)?(?:(?:очень|довольно|невероятно|действительно)\s+)?[а-яё]+$/iu, ""));
    if (!subject || subject.split(" ").length > 6) return null;
    return makeClaim("opinion", subject, "оценка", match[2].toLowerCase(), text, "subjective", 0.91, !negative);
  }
  function extractDefinition(text) {
    let match = text.match(/^(.+?)\s+[—–-]\s+(?:это\s+)?(.+)$/iu);
    if (!match) match = text.match(/^(.+?)\s+это\s+(.+)$/iu);
    if (!match) return null;
    const subject = cleanPart(match[1]), object = cleanPart(match[2]);
    if (!subject || !object || subject.split(" ").length > 6 || object.length > 180) return null;
    return makeClaim("definition",subject,"определяется как",object,text,"unverified",0.87);
  }
  function extractSelfReport(text) {
    let match = text.match(/^(?:(теперь|сейчас|отныне)\s+)?(?:я\s+)?(живу в|жил в|жила в|жили в|нахожусь в|находился в|находилась в|работаю в|работал в|работала в|учусь в|учился в|училась в|работаю|работал|работала|учусь|учился|училась|занимаюсь)\s+(.+)$/iu);
    if (match) {
      const verb=match[2].toLowerCase();
      const predicates={"жил в":"живу в","жила в":"живу в","жили в":"живу в",
        "находился в":"нахожусь в","находилась в":"нахожусь в",
        "работал в":"работаю в","работала в":"работаю в",
        "учился в":"учусь в","училась в":"учусь в",
        "работал":"работаю","работала":"работаю","учился":"учусь","училась":"учусь"};
      const predicate=predicates[verb]||verb;
      const claim = makeClaim("fact","user",predicate,cleanPart(match[3],180),text,"self_reported",0.93);
      if (claim) { claim.revision = !!match[1]; claim.status = /^(?:жил|жила|жили|находился|находилась|работал|работала|учился|училась)/u.test(verb) ? "historical" : "current"; }
      return claim;
    }
    match = text.match(/^(?:(теперь|сейчас|отныне)\s+)?у меня есть\s+(.+)$/iu);
    if (match) {
      const claim = makeClaim("fact","user","имеет",cleanPart(match[2],180),text,"self_reported",0.93);
      if (claim) { claim.revision = !!match[1]; claim.status = "current"; }
      return claim;
    }
    return null;
  }
  function extractHypothesis(text) {
    const match = text.match(/^(?:(?:возможно|вероятно|кажется),?\s+|(?:я предполагаю|я думаю)(?:\s*,?\s*что)?\s+)(.+)$/iu);
    if (!match) return null;
    return makeClaim("hypothesis","user","предполагает",cleanPart(match[1],180),text,"hypothesis",0.78);
  }
  function extractSingleClaimCore(text) {
    return extractAssistantIdentity(text) || extractAssistantCreator(text) ||
      extractRelationship(text) || extractConditionalRule(text) || extractObservation(text) ||
      extractCausal(text) || extractPreference(text) || extractSelfReport(text) ||
      extractHypothesis(text) || extractOpinion(text) || extractDefinition(text);
  }
  function extractSingleClaim(text, referenceTime = Date.now()) {
    const temporal=extractTemporalHint(text,referenceTime);
    const claim=extractSingleClaimCore(temporal.text);
    if(!claim)return null;
    claim.evidence=cleanPart(text,1200);
    claim.createdAt=parseClaimTime(referenceTime)||Date.now();
    claim.validFrom=temporal.validFrom??null;
    claim.validTo=temporal.validTo??null;
    if(temporal.status)claim.status=temporal.status;
    if(temporal.expression) {
      claim.temporalExpression=cleanPart(temporal.expression,100);
      claim.temporalPrecision=temporal.precision||"unknown";
      claim.temporalRelation=temporal.relation||"unspecified";
      if(temporal.relation!=="unspecified")claim.status="current";
    }
    return claim;
  }
  function linkTemporalClaimIntervals(claims) {
    const rows=Array.isArray(claims)?claims:[];
    for(const newer of rows) {
      if(!newer||newer.kind!=="fact"||newer.subject!=="user"||newer.temporalRelation!=="since"||newer.validFrom==null)continue;
      for(const prior of rows) {
        if(!prior||prior===newer||prior.kind!=="fact"||prior.subject!=="user"||
          factFamily(prior.predicate)!==factFamily(newer.predicate)||sameEntity(prior.object,newer.object)||
          prior.createdAt>newer.createdAt||prior.validTo!=null||
          !["historical","current"].includes(String(prior.status||"current")))continue;
        if(prior.validFrom!=null&&prior.validFrom>=newer.validFrom)continue;
        prior.validTo=newer.validFrom;
        prior.status="current";
        prior.temporalRelation=prior.temporalRelation||"inferred-until";
        prior.temporalPrecision=prior.temporalPrecision||"unknown";
      }
    }
    return rows;
  }
  function extractClaims(input, referenceTime = Date.now()) {
    const text = cleanPart(input,1200);
    if (!text) return [];
    // Research answers and source-attributed reports are context, not fresh assertions.
    if (/^ответ на вопрос\s+#?\s*q\d+\s*:/iu.test(text)) return [];
    if (isReportedCausalStatement(text)) return [];
    const direct = extractSingleClaim(text, referenceTime);
    if(direct&&direct.kind==="observation"&&direct.observationCase&&["context","timing","criterion"].some(key=>direct.observationCase[key].status!=="not_stated"))return [direct];
    const clauses = text.split(/\s*[,;]\s*/u)
      .map(part => part.replace(/^(?:и|а|но|однако)\s+/iu,"").trim())
      .filter(Boolean).slice(0,8);
    if (clauses.length > 1) {
      const extracted = clauses.map(part=>extractSingleClaim(part,referenceTime)).filter(Boolean);
      if (extracted.length) {
        if (direct && direct.kind === "hypothesis" && !extracted.some(claim => claim.kind === "hypothesis")) {
          extracted.unshift(direct);
        }
        return linkTemporalClaimIntervals(extracted.slice(0,12));
      }
    }
    return direct ? linkTemporalClaimIntervals([direct]) : [];
  }
  function sanitizeClaims(input, evidenceFallback = "") {
    if (!Array.isArray(input)) return [];
    const kinds = new Set(["relationship","preference","fact","opinion","definition","hypothesis","identity","causal","rule","observation"]);
    return input.slice(0,12).map(raw => {
      if (!raw || typeof raw !== "object") return null;
      const kind = kinds.has(raw.kind) ? raw.kind : null;
      const subject = cleanPart(raw.subject), predicate = cleanPart(raw.predicate,80), object = cleanPart(raw.object,180);
      if (!kind || !subject || !predicate || !object) return null;
      const evidence = cleanPart(raw.evidence || evidenceFallback,1200);
      if (kind === "causal" && (!isValidCausalSubject(subject) || isReportedCausalStatement(evidence))) return null;
      const verification = ["unverified","subjective","self_reported","hypothesis"].includes(raw.verification) ? raw.verification : "unverified";
      const hasValidFrom = raw.validFrom !== undefined && raw.validFrom !== null && raw.validFrom !== "";
      const hasValidTo = raw.validTo !== undefined && raw.validTo !== null && raw.validTo !== "";
      const validFrom = hasValidFrom ? parseClaimTime(raw.validFrom) : null;
      const validTo = hasValidTo ? parseClaimTime(raw.validTo) : null;
      if ((hasValidFrom && validFrom === null) || (hasValidTo && validTo === null) ||
          (validFrom !== null && validTo !== null && validFrom >= validTo)) return null;
      const supersededBy = typeof raw.supersededBy === "string" ? raw.supersededBy.slice(0,80) : null;
      const requestedStatus = (["current",...INACTIVE_STATUSES].includes(raw.status) ? raw.status : "current");
      const status = supersededBy && requestedStatus === "current" ? "superseded" : requestedStatus;
      return {
        id:typeof raw.id==="string"?raw.id.slice(0,80):makeId(kind,evidence),kind,subject,predicate,object,
        holder:"user",polarity:raw.polarity!==false,source:"user_message",evidence,verification,
        extractionConfidence:Number.isFinite(Number(raw.extractionConfidence))?Math.max(0,Math.min(1,Number(raw.extractionConfidence))):0.7,
        traceId:typeof raw.traceId==="string"?raw.traceId.slice(0,80):null,
        createdAt:Number.isFinite(Number(raw.createdAt))&&Number(raw.createdAt)>0?Number(raw.createdAt):Date.now(),
        revision:raw.revision===true,status,supersededBy,validFrom,validTo,
        temporalExpression:typeof raw.temporalExpression==="string"?cleanPart(raw.temporalExpression,100):"",
        temporalPrecision:["day","month","year","season","week","relative_day","unknown"].includes(raw.temporalPrecision)?raw.temporalPrecision:"",
        temporalRelation:["since","during","until","after","through","inferred-until","unspecified"].includes(raw.temporalRelation)?raw.temporalRelation:"",
        modality:raw.modality==="possible"?"possible":"asserted",
        sourceMemoryId:kind==="observation"&&typeof raw.sourceMemoryId==="string"?raw.sourceMemoryId.slice(0,100):"",
        observationCase:kind==="observation"?sanitizeObservationDetails(raw.observationCase,"direct_observation"):null
      };
    }).filter(Boolean);
  }
  function mergeClaims(existing,incoming) {
    const merged=[...sanitizeClaims(existing),...sanitizeClaims(incoming)],seen=new Set();
    const result=[];
    const claimKey=claim=>JSON.stringify([
      claim.kind,canonicalEntity(claim.subject),normalise(claim.predicate),
      normalise(claim.object),claim.polarity,claim.validFrom,claim.validTo,
      ...(claim.kind==="observation"?[normalise(claim.observationCase&&claim.observationCase.eventRef||"")]:[])
    ]);
    for(const claim of merged){
      const key=claimKey(claim);
      const prior=result.find(item=>claimKey(item)===key);
      if(prior){
        if(!prior.traceId&&claim.traceId)prior.traceId=claim.traceId;
        if(prior.kind==="observation"&&claim.observationCase) {
          const rank={not_stated:0,unknown:1,not_recorded:2,none_reported:3,provided:4};
          for(const field of ["context","timing","criterion"])
            if((rank[claim.observationCase[field].status]||0)>(rank[prior.observationCase[field].status]||0))
              prior.observationCase[field]=claim.observationCase[field];
          if(!prior.sourceMemoryId&&claim.sourceMemoryId)prior.sourceMemoryId=claim.sourceMemoryId;
        }
        continue;
      }
      if(!seen.has(key)){seen.add(key);result.push(claim);}
    }
    return result.slice(0,12);
  }
  function preferencePhrase(claim, profileLabel = false) {
    const predicate = claim.predicate;
    if (predicate === "нравится") {
      return (profileLabel ? "Пользователю " : "тебе ") +
        (claim.polarity ? "нравится " : "не нравится ") + claim.object;
    }
    const verbs = profileLabel
      ? { "люблю":"любит", "обожаю":"обожает", "предпочитаю":"предпочитает", "ненавижу":"любит" }
      : { "люблю":"любишь", "обожаю":"обожаешь", "предпочитаю":"предпочитаешь", "ненавижу":"любишь" };
    const negative = !claim.polarity || predicate === "ненавижу";
    return (profileLabel ? "Пользователь " : "ты ") +
      (negative ? "не " : "") + (verbs[predicate] || predicate) + " " + claim.object;
  }
  function claimLabel(claim) {
    if(!claim)return "";
    if(claim.kind==="identity") return "Роль ассистента — " + claim.object;
    if(claim.kind==="causal") {
      const verb=claim.predicate==="вызывает"?"вызывает":"приводит к";
      if(claim.modality==="possible")return claim.subject+(claim.polarity?" может ":" не может ")+(claim.predicate==="вызывает"?"вызывать":"приводить к")+" "+claim.object;
      return claim.subject+(claim.polarity?" ":" не ")+verb+" "+claim.object;
    }
    if(claim.kind==="rule")return "Условное правило: если "+claim.subject+", то "+claim.object;
    if(claim.kind==="observation")return "Наблюдение: при "+claim.subject+" "+(claim.polarity?"наблюдалось ":"не наблюдалось ")+claim.object;
    if(claim.kind==="opinion") return claim.subject+" — "+(claim.polarity?"":"не ")+claim.object;
    if(claim.kind==="fact" && claim.subject==="assistant" && claim.predicate==="создатель") return "Создатель ассистента — " + claim.object;
    if(claim.kind==="fact" && claim.subject==="user") {
      const predicates = {"живу в":"живёт в","нахожусь в":"находится в","работаю в":"работает в","учусь в":"учится в","работаю":"работает","учусь":"учится","занимаюсь":"занимается"};
      if (claim.predicate === "имеет") return "У пользователя есть " + claim.object;
      return "Пользователь " + (predicates[claim.predicate] || claim.predicate) + " " + claim.object;
    }
    if(claim.kind==="preference") return preferencePhrase(claim,true);
    if(claim.kind==="relationship"){
      const target=claim.object==="assistant"?"ассистент":claim.object==="user"?"пользователь":"общее окружение";
      return claim.subject+" — "+(claim.polarity?"":"не ")+claim.predicate+" ("+target+")";
    }
    return claim.subject+" — "+(claim.polarity?"":"не ")+claim.predicate+" — "+claim.object;
  }
  function claimSearchText(claim) {
    if(!claim)return "";
    const object=claim.object==="assistant"?"я ассистент мой":claim.object==="user"?"ты пользователь твой":claim.object;
    if (claim.kind === "causal") return [claim.subject,"причина","следствие","влияние",claim.predicate,claim.object,claim.evidence].join(" ");
    if (claim.kind === "rule") return ["условное правило","если","то",claim.subject,claim.object,claim.evidence].join(" ");
    if (claim.kind === "observation") return ["наблюдение","условие","результат",claim.subject,claim.object,claim.evidence].join(" ");
    if (claim.subject === "assistant") return ["я","меня","мне","мой","моя","ассистент","создатель",claim.predicate,object,claim.evidence].join(" ");
    return [claim.subject,claim.predicate,object,claim.evidence].join(" ");
  }
  function claimHistoryLabel(claim, activeLabel) {
    if (!isCurrentClaim(claim)) {
      if (claim.status === "superseded" || claim.supersededBy) return "историческое сведение · позже уточнено";
      const labels = {historical:"историческое сведение",archived:"архивная запись",retracted:"отозванное утверждение",
        expired:"срок действия истёк",inactive:"неактивная запись"};
      if (labels[claim.status]) return labels[claim.status];
      const window = claimTimeWindow(claim), now = Date.now();
      if (window.valid && window.to !== null && window.to <= now) return "срок действия истёк";
      if (window.valid && window.from !== null && window.from > now) return "ещё не вступило в силу";
      return "неактуальная запись";
    }
    const window = claimTimeWindow(claim);
    if (window.from !== null || window.to !== null) {
      const date = value => new Date(value).toISOString().slice(0,10);
      return "срок действия: " + (window.from === null ? "без даты начала" : "с " + date(window.from)) +
        (window.to === null ? " и далее" : " по " + date(window.to - 1));
    }
    return activeLabel;
  }
  function entityProfile(query, claims) {
    const q = normalise(query);
    const match = q.match(/^(?:что ты знаешь|что известно|расскажи(?: мне)?|помнишь ли ты)\s+(?:(?:о|об|обо|про)\s+)?(.+)$/u) ||
      q.match(/^(?:кто такой|кто такая|кто такое)\s+(.+)$/u);
    if (!match || !Array.isArray(claims) || !claims.length) return null;
    const queryWords = [...new Set(tokens(match[1]))];
    if (!queryWords.length) return null;

    const candidates = new Map();
    for (const claim of claims) {
      if (!claim) continue;
      for (const value of [claim.subject, claim.object]) {
        if (!value || value === "assistant" || value === "user" || value === "shared") continue;
        const key = canonicalEntity(value);
        if (!key) continue;
        const words = [...new Set(tokens(value))];
        const similarity = semanticMatch(queryWords, words);
        const hits = similarity.weightedHits;
        if (!hits) continue;
        const coverage = hits / queryWords.length;
        const precision = hits / Math.max(1, words.length);
        const score = coverage * 0.75 + precision * 0.25;
        const old = candidates.get(key);
        if (!old || score > old.score) candidates.set(key, { value, key, score, hits, associativeHits:similarity.associativeHits });
      }
    }
    const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || b.hits - a.hits);
    if (!ranked.length || ranked[0].score < 0.45) return null;
    const best = ranked[0];
    const ambiguous = ranked.filter(item => item.key !== best.key && Math.abs(item.score - best.score) < 0.015);
    if (ambiguous.length) {
      return "Я нашёл несколько похожих объектов в памяти: " +
        [best.value, ...ambiguous.slice(0, 3).map(item => item.value)].join(", ") +
        ". Уточни, о ком или о чём именно ты спрашиваешь.";
    }

    const related = claims.filter(claim =>
      claim && (sameEntity(claim.subject, best.value) ||
        (claim.object !== "assistant" && claim.object !== "user" && claim.object !== "shared" && sameEntity(claim.object, best.value)))
    );
    const unique = [...new Map(related.map(claim => [claim.id || [claim.kind, claim.evidence].join("|"), claim])).values()]
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    if (!unique.length) return null;
    const visible = unique.slice(0, 6);
    const status = claim => claimHistoryLabel(claim,
      claim.verification === "subjective" ? "субъективное мнение" :
      claim.verification === "self_reported" ? "самоописание" :
      claim.verification === "hypothesis" ? "гипотеза" : "сообщение пользователя · не проверено");
    const lines = visible.map(claim =>
      "• " + claimLabel(claim) + "\n  Источник: «" + String(claim.evidence || "").slice(0, 220) + "» · " + status(claim)
    );
    const conflicts = findConflicts(unique);
    let answer = "Вот что я нашёл в сохранённой памяти о «" + best.value + "» (" + unique.length + " утверждений):\n\n" + lines.join("\n\n");
    if (unique.length > visible.length) answer += "\n\nПоказаны первые " + visible.length + " из " + unique.length + " связанных утверждений.";
    if (conflicts.length) answer += "\n\nВнимание: среди этих записей есть противоречие или возможное противоречие. Я не буду автоматически выбирать одну версию.";
    answer += "\n\nЭто сведения из твоих сохранённых сообщений, а не независимо проверенные факты.";
    return answer;
  }
  function userProfile(claims) {
    const relevant = (Array.isArray(claims) ? claims : []).filter(claim => claim && (
      (claim.kind==="fact" && claim.subject==="user") ||
      (claim.kind==="preference" && claim.subject==="user") ||
      (claim.kind==="relationship" && claim.object==="user") ||
      (claim.kind==="hypothesis" && claim.subject==="user") ||
      claim.kind==="opinion"
    ));
    const unique = [...new Map(relevant.map(claim=>[claim.id||[claim.kind,claim.evidence].join("|"),claim])).values()]
      .sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
    if (!unique.length) return "Пока в моей памяти нет конкретных сведений о тебе. Расскажи о себе через «Запомнить», и я смогу использовать эти записи в следующих вопросах.";
    const visible = unique.slice(-12);
    const sourceStatus = claim => claim.status === "superseded" || claim.supersededBy
      ? "историческое самоописание · позже уточнено"
      : claimHistoryLabel(claim,
        claim.verification==="subjective" ? "твоя субъективная оценка" :
        claim.verification==="self_reported" ? "самоописание из твоего сообщения" :
        claim.verification==="hypothesis" ? "твоя гипотеза" : "сообщение пользователя · не проверено");
    const label = claim => {
      if (claim.kind==="relationship" && claim.object==="user") return claim.subject+" — "+(claim.polarity?"твой ":"не твой ")+claim.predicate;
      if (claim.kind==="opinion") return "Твоя оценка: "+claimLabel(claim);
      if (claim.kind==="hypothesis") return "Твоё предположение: "+claim.object;
      return claimLabel(claim);
    };
    const lines = visible.map(claim=>"• "+label(claim)+"\n  Источник: «"+String(claim.evidence||"").slice(0,220)+"» · "+sourceStatus(claim));
    const conflicts = findConflicts(unique);
    let answer = "Вот что я могу собрать о тебе из сохранённых сообщений ("+unique.length+" утверждений):\n\n"+lines.join("\n\n");
    if (unique.length>visible.length) answer += "\n\nПоказаны последние "+visible.length+" из "+unique.length+" записей.";
    if (conflicts.length) answer += "\n\nВнимание: некоторые записи противоречат друг другу или могут конфликтовать. Я не выбираю одну версию автоматически.";
    answer += "\n\nЭто сведения, которыми ты поделился со мной, а не независимо проверенные факты.";
    return answer;
  }
  function findCausalPaths(start,input,options={}) {
    const claims=Array.isArray(input)?input:[];
    const maxDepth=Math.max(1,Math.min(3,Number(options.maxDepth)||3));
    const reverse=options.reverse===true,target=options.target?canonicalEntity(options.target):"";
    const startKey=canonicalEntity(start);
    if(!startKey)return [];
    const edges=claims.filter(c=>c&&c.kind==="causal"&&c.polarity!==false&&isCurrentClaim(c)&&canonicalEntity(c.subject)&&canonicalEntity(c.object));
    const paths=[],seen=new Set();
    const save=path=>{
      if(!path.length)return;
      const ordered=reverse?path.slice().reverse():path.slice();
      const key=ordered.map(edge=>edge.id||edge.evidence).join("|");
      if(!seen.has(key)){seen.add(key);paths.push(ordered);}
    };
    function walk(node,path,visited){
      if(paths.length>=8)return;
      if(path.length>=maxDepth){if(!target)save(path);return;}
      const candidates=edges.filter(edge=>canonicalEntity(reverse?edge.object:edge.subject)===node);
      let advanced=false;
      for(const edge of candidates){
        const next=canonicalEntity(reverse?edge.subject:edge.object);
        if(!next||visited.has(next))continue;
        if(target&&next===target){save([...path,edge]);advanced=true;continue;}
        if(target&&path.length+1>=maxDepth)continue;
        advanced=true;
        walk(next,[...path,edge],new Set([...visited,next]));
      }
      if(!target&&!advanced&&path.length)save(path);
    }
    walk(startKey,[],new Set([startKey]));
    return paths.sort((a,b)=>b.length-a.length).slice(0,4);
  }
  function causalEvidence(query,input) {
    const q=normalise(query),claims=Array.isArray(input)?input:[];
    let mode=null,from="",to="";
    let match=q.match(/^(?:как|каким образом)\s+(.+?)\s+(?:влияет на|может повлиять на)\s+(.+)$/u);
    if(match){mode="between";from=match[1];to=match[2];}
    if(!mode){
      match=q.match(/^(?:к чему может привести|к чему приводит|каковы последствия)\s+(.+)$/u);
      if(match){mode="forward";from=match[1];}
    }
    if(!mode){
      match=q.match(/^(?:что может вызвать|что вызывает|из-за чего возникает|почему возникает|почему появляется|от чего возникает)\s+(.+)$/u);
      if(match){mode="reverse";from=match[1];}
    }
    if(!mode){
      match=q.match(/^(?:какие есть альтернативные объяснения|какие еще альтернативные объяснения|какие еще есть объяснения|есть ли другие причины|что еще может вызвать|что еще вызывает)\s+(.+)$/u);
      if(match){mode="reverse";from=match[1];}
    }
    if(!mode)return null;
    const paths=findCausalPaths(from,claims,{reverse:mode==="reverse",target:mode==="between"?to:"",maxDepth:3});
    if(!paths.length)return null;
    const labels=paths.map((path,index)=>(index+1)+". "+[path[0].subject,...path.map(edge=>edge.object)].join(" → "));
    const used=[...new Map(paths.flat().map(edge=>[edge.id||edge.evidence,edge])).values()];
    const roots=mode==="reverse"?[...new Map(paths.map(path=>[canonicalEntity(path[0].subject),path[0].subject])).values()]:[];
    const relatedClaims=claims.filter(claim=>claim&&claim.kind==="causal"&&used.some(edge=>
      sameEntity(edge.subject,claim.subject)&&sameEntity(edge.object,claim.object)));
    const conflicts=findConflicts(relatedClaims).filter(conflict=>conflict.left.kind==="causal");
    const conflictClaims=[...new Map(conflicts.flatMap(conflict=>[conflict.left,conflict.right]).map(claim=>[claim.id||claim.evidence,claim])).values()];
    const evidenceClaims=[...new Map([...used,...conflictClaims].map(claim=>[claim.id||claim.evidence,claim])).values()];
    const evidence=evidenceClaims.slice(0,12).map(edge=>"• «"+String(edge.evidence||"").slice(0,220)+"»"+(edge.polarity===false?" · отрицание связи":"")).join("\n");
    const alternatives=roots.length>1;
    const opening=mode==="reverse"?(alternatives?"В памяти найдены несколько возможных объяснений:":"В памяти нашлась возможная причина или промежуточная цепочка:"):
      mode==="forward"?"По сохранённым связям можно проследить возможные последствия:":
      "Между этими понятиями найдена причинная цепочка:";
    let answer=opening+"\n\n"+labels.join("\n")+"\n\nИсходные записи:\n"+evidence;
    if(alternatives)answer+="\n\nЭто разные возможные причины одного события. По сохранённой информации нельзя определить, какая из них основная, была ли какая-либо из них реальной причиной или существуют другие объяснения.";
    if(conflicts.length)answer+="\n\nПротиворечие в памяти: для одной и той же причинной связи сохранены утверждение и отрицание. Я не могу считать её установленной и показываю обе исходные записи.";
    answer+="\n\nЭто вывод из нескольких сообщений, которые ты сохранил. Я не проверял причинность независимо: цепочка показывает возможную связь, а не доказывает, что одно событие обязательно вызовет другое.";
    return {answer,claimIds:evidenceClaims.map(edge=>edge.id).filter(Boolean),paths,alternativeCount:roots.length,conflicts};
  }
  function evaluateConditionalHypothesis(query,input) {
    const q=normalise(query),claims=Array.isArray(input)?input:[];
    const match=q.match(/^(?:проверь гипотезу|проверь правило|оцени гипотезу|оцени правило|найди контрпримеры к правилу|есть ли контрпримеры к правилу)\s+если\s+(.+?)\s+то\s+(.+)$/u);
    if(!match)return null;
    const condition=cleanPart(match[1],180),expected=cleanPart(match[2],180);
    if(!condition||!expected)return null;
    const storedRules=claims.filter(claim=>claim&&claim.kind==="rule"&&isCurrentClaim(claim)&&sameEntity(claim.subject,condition)&&sameEntity(claim.object,expected));
    const observations=claims.filter(claim=>isCurrentClaim(claim)&&claim.kind==="observation"&&sameEntity(claim.subject,condition)&&sameEntity(claim.object,expected));
    const support=observations.filter(claim=>claim.polarity!==false);
    const counterexamples=observations.filter(claim=>claim.polarity===false);
    const shownRules=storedRules.slice(-3).map(claim=>"• «"+String(claim.evidence||"").slice(0,220)+"»").join("\n");
    const supportLines=support.slice(-6).map(claim=>"• «"+String(claim.evidence||"").slice(0,220)+"»").join("\n");
    const counterLines=counterexamples.slice(-6).map(claim=>"• «"+String(claim.evidence||"").slice(0,220)+"»").join("\n");
    let status="insufficient";
    if(support.length&&counterexamples.length)status="mixed";
    else if(counterexamples.length)status="counterexample";
    else if(support.length)status="consistent";
    let answer="Проверяемое правило: если "+condition+", то "+expected+".\n\n";
    if(shownRules)answer+="В памяти сохранена формулировка правила:\n"+shownRules+"\n\n";
    if(support.length)answer+="Наблюдения, согласующиеся с правилом:\n"+supportLines+"\n\n";
    if(counterexamples.length)answer+="Потенциальные контрпримеры (условие было, но ожидаемый результат не наблюдался):\n"+counterLines+"\n\n";
    if(status==="mixed")answer+="Картина смешанная: в памяти есть как поддерживающие наблюдения, так и потенциальные контрпримеры. Возможно, правило слишком общее, условия различались или некоторые записи неточны.";
    else if(status==="counterexample")answer+="Найдены потенциальные контрпримеры. Они ставят под сомнение безусловную формулировку правила, но сами по себе не доказывают её ложность: каждое наблюдение нужно проверить и уточнить контекст.";
    else if(status==="consistent")answer+="Найденные наблюдения согласуются с правилом, но не доказывают, что оно выполняется всегда.";
    else answer+="Недостаточно данных: в памяти нет наблюдений, где указанное условие действительно выполнялось и можно проверить ожидаемый результат.";
    answer+="\n\nЧто ещё нужно для проверки: повторяемые наблюдения; чёткое измерение результата; описание времени и условий; независимая проверка источников; учёт других возможных факторов.";
    answer+="\n\nВажно: случай, когда условие не выполнялось, сам по себе не опровергает правило «если X, то Y». Для контрпримера нужен случай, когда X было, а Y не наблюдалось.";
    answer+="\n\nЯ анализирую только сохранённые тобой сообщения. Они не являются независимо проверенными экспериментальными данными.";
    const used=[...new Map([...storedRules,...observations].map(claim=>[claim.id||claim.evidence,claim])).values()];
    return {answer,status,supportCount:support.length,counterexampleCount:counterexamples.length,claimIds:used.map(claim=>claim.id).filter(Boolean)};
  }
  function designDiscriminatingTest(query,input) {
    const q=normalise(query),claims=Array.isArray(input)?input:[];
    const match=q.match(/^(?:как различить|как отличить|как проверить|составь план сравнения|составь план проверки)\s+(?:(?:возможные|альтернативные)\s+)?(?:причины|гипотезы)\s+(.+)$/u);
    if(!match)return null;
    const outcome=cleanPart(match[1],180);
    if(!outcome)return null;
    const paths=findCausalPaths(outcome,claims,{reverse:true,maxDepth:3});
    if(!paths.length)return null;
    const byRoot=new Map();
    for(const path of paths){
      const root=path[0]&&path[0].subject;
      const key=canonicalEntity(root);
      if(key&&!byRoot.has(key))byRoot.set(key,path);
    }
    const candidates=[...byRoot.values()].slice(0,4);
    const roots=candidates.map(path=>path[0].subject);
    const used=[...new Map(candidates.flat().map(edge=>[edge.id||edge.evidence,edge])).values()];
    const observations=claims.filter(claim=>isCurrentClaim(claim)&&claim.kind==="observation"&&
      roots.some(root=>sameEntity(root,claim.subject))&&sameEntity(outcome,claim.object));
    const related=claims.filter(claim=>claim&&claim.kind==="causal"&&used.some(edge=>
      sameEntity(edge.subject,claim.subject)&&sameEntity(edge.object,claim.object)));
    const conflicts=findConflicts(related);
    const conflictClaims=[...new Map(conflicts.flatMap(item=>[item.left,item.right]).map(claim=>[claim.id||claim.evidence,claim])).values()];
    const evidenceClaims=[...new Map([...used,...conflictClaims,...observations].map(claim=>[claim.id||claim.evidence,claim])).values()];
    const lines=candidates.map((path,index)=>(index+1)+". "+path[0].subject+" → "+path.map(edge=>edge.object).join(" → "));
    let answer="Цель сравнения: понять, какие из сохранённых возможных причин могут быть связаны с явлением «"+outcome+"».\n\n";
    if(roots.length>1)answer+="В памяти найдены разные гипотезы:\n"+lines.join("\n")+"\n\n";
    else answer+="В памяти пока найдено только одно возможное объяснение:\n"+lines.join("\n")+"\n\n";
    if(observations.length){
      answer+="Уже сохранённые наблюдения:\n"+observations.slice(-8).map(claim=>"• «"+String(claim.evidence||"").slice(0,220)+"»"+(claim.polarity===false?" · потенциальный контрпример":" · наблюдение согласуется с результатом")).join("\n")+"\n\n";
    }else{
      answer+="Пока нет отдельных наблюдений, сопоставляющих наличие этих условий с появлением явления.\n\n";
    }
    if(roots.length>1){
      answer+="План различающей проверки:\n";
      answer+="1. Заранее определить, что именно считается явлением «"+outcome+"», и как его одинаково фиксировать в каждом случае.\n";
      answer+="2. Для каждого возможного фактора отдельно определить проверяемый признак его наличия и способ записи.\n";
      answer+="3. Наблюдать естественно возникающие случаи и отмечать для каждого фактора: присутствовал ли он, когда возник результат и как именно он был измерен.\n";
      answer+="4. Сравнивать случаи, в которых факторы встречались по отдельности, вместе или отсутствовали. Если два фактора всегда появляются одновременно, эти данные не позволяют разделить их вклад.\n";
      answer+="5. Повторить наблюдения в разных ситуациях и записывать другие обстоятельства, которые могли повлиять на результат.\n\n";
      answer+="Как интерпретировать:\n";
      answer+="• Если результат чаще наблюдается вместе с одним фактором, это поддерживает связь, но ещё не доказывает причинность.\n";
      answer+="• Если оба фактора встречаются вместе, нельзя автоматически приписывать результат только одному из них.\n";
      answer+="• Если результат появляется без обоих факторов, нужно искать дополнительные объяснения.\n";
      answer+="• Если фактор присутствует, а ожидаемый результат отсутствует, это может быть контрпримером для слишком общего правила.\n\n";
      answer+="Не нужно специально создавать вредные условия или подвергать себя риску ради проверки. Используй только безопасные естественные наблюдения.";
    }else{
      answer+="Данных пока недостаточно, чтобы сравнить причины: нужно сохранить хотя бы ещё одно независимое объяснение и наблюдения, которые позволяют отличать факторы друг от друга.";
    }
    if(conflicts.length)answer+="\n\nВ исходных причинных записях есть противоречия. Их нужно уточнить до сравнения гипотез.";
    answer+="\n\nЭто план сбора и сравнения наблюдений, а не готовый экспериментальный вывод. Сохранённые сообщения не являются независимо проверенными данными.";
    return {answer,outcome,alternativeCount:roots.length,paths:candidates,observations,conflicts,claimIds:evidenceClaims.map(claim=>claim.id).filter(Boolean)};
  }
  function deriveHypotheses(query,input) {
    const q=normalise(query),claims=Array.isArray(input)?input:[];
    if(!/^(?:какие новые гипотезы можно вывести(?: из памяти)?|выведи новые гипотезы(?: из памяти)?|сформируй новые гипотезы(?: из памяти)?|предложи гипотезы из памяти|что можно вывести из причинных связей)$/u.test(q))return null;
    const edges=claims.filter(claim=>claim&&claim.kind==="causal"&&claim.polarity!==false&&isCurrentClaim(claim)&&canonicalEntity(claim.subject)&&canonicalEntity(claim.object)).slice(-180);
    if(edges.length<2)return null;
    const adjacency=new Map(),direct=new Set(),blockedEdges=new Set();
    const pairKey=(a,b)=>canonicalEntity(a)+"=>"+canonicalEntity(b);
    for(const edge of edges){
      const from=canonicalEntity(edge.subject);
      if(!adjacency.has(from))adjacency.set(from,[]);
      adjacency.get(from).push(edge);
      direct.add(pairKey(edge.subject,edge.object));
      if(claims.some(other=>isCurrentClaim(other)&&other.kind==="causal"&&other.polarity===false&&sameEntity(other.subject,edge.subject)&&sameEntity(other.object,edge.object)))blockedEdges.add(edge.id||edge.evidence);
    }
    const starts=[...new Set(edges.map(edge=>canonicalEntity(edge.subject)))];
    const proposals=new Map();
    let explored=0;
    const maxExplored=2400,maxProposals=8,maxDepth=3;
    function walk(node,path,visited){
      if(explored>=maxExplored||proposals.size>=maxProposals||path.length>=maxDepth)return;
      const nextEdges=adjacency.get(node)||[];
      for(const edge of nextEdges){
        explored++;
        if(explored>maxExplored)break;
        const next=canonicalEntity(edge.object);
        if(!next||visited.has(next))continue;
        const nextPath=[...path,edge];
        if(nextPath.length>=2){
          const first=nextPath[0].subject,last=edge.object,key=pairKey(first,last);
          const disputed=nextPath.some(item=>blockedEdges.has(item.id||item.evidence));
          if(!direct.has(key)&&!disputed){
            if(!proposals.has(key))proposals.set(key,{subject:first,object:last,paths:[]});
            const proposal=proposals.get(key);
            const pathKey=nextPath.map(item=>item.id||item.evidence).join("|");
            if(proposal.paths.length<3&&!proposal.paths.some(existing=>existing.map(item=>item.id||item.evidence).join("|")===pathKey))proposal.paths.push(nextPath);
          }
        }
        if(nextPath.length<maxDepth)walk(next,nextPath,new Set([...visited,next]));
        if(explored>=maxExplored||proposals.size>=maxProposals)break;
      }
    }
    for(const start of starts){
      walk(start,[],new Set([start]));
      if(explored>=maxExplored||proposals.size>=maxProposals)break;
    }
    if(!proposals.size)return null;
    const hypotheses=[...proposals.values()].slice(0,6);
    const used=[...new Map(hypotheses.flatMap(item=>item.paths.flat()).map(edge=>[edge.id||edge.evidence,edge])).values()];
    const lines=hypotheses.map((item,index)=>{
      const routes=item.paths.map(path=>path.map(edge=>edge.subject).concat(path[path.length-1].object).join(" → "));
      const sources=[...new Map(item.paths.flat().map(edge=>[edge.id||edge.evidence,edge])).values()]
        .map(edge=>"• «"+String(edge.evidence||"").slice(0,200)+"»").join("\n");
      return (index+1)+". "+item.subject+" ⇢ "+item.object+"\n   Возможный путь: "+routes.join(" ИЛИ ")+"\n   Основание:\n"+sources;
    });
    let answer="Я нашёл новые возможные гипотезы, которые можно построить из нескольких сохранённых причинных связей:\n\n"+lines.join("\n\n");
    answer+="\n\nКак читать вывод: знак ⇢ обозначает только предположение об опосредованной связи через промежуточные звенья. Он НЕ означает, что первая сущность напрямую вызывает последнюю.";
    answer+="\n\nПочему это ещё не знание: каждое звено цепочки само могло быть неточным, факторы могут иметь общую причину, а направление влияния и дополнительные условия могут быть неизвестны. Логическая цепочка помогает сформулировать вопрос, но не доказывает новую связь.";
    answer+="\n\nЭти гипотезы не добавлены в долговременную память и не изменяют исходные утверждения. Для проверки нужны независимые наблюдения и поиск контрпримеров.";
    return {answer,hypotheses,claimIds:used.map(edge=>edge.id).filter(Boolean),exploredEdges:explored};
  }
  function prioritizeHypotheses(query,input) {
    const q=normalise(query),claims=Array.isArray(input)?input:[];
    if(!/^(?:какую гипотезу проверять первой|какую из гипотез проверять первой|какую гипотезу стоит проверить первой|какую гипотезу проверять в первую очередь|какие гипотезы проверять в первую очередь|расставь гипотезы по приоритету|расставь гипотезы по порядку проверки|с чего начать проверку гипотез|что проверять первым)$/u.test(q))return null;
    const derived=deriveHypotheses("Выведи новые гипотезы из памяти",claims);
    if(!derived||!derived.hypotheses.length){
      return {answer:"В текущей памяти пока нет причинных цепочек из нескольких звеньев, из которых можно составить новые гипотезы. Сначала нужно сохранить хотя бы две связанные причинные записи. Я не буду придумывать порядок проверки без самих гипотез.",hypotheses:[],claimIds:[],counterexampleCount:0};
    }
    const keyOf=claim=>claim.id||claim.evidence||(canonicalEntity(claim.subject)+"=>"+canonicalEntity(claim.object));
    const observationsFor=edge=>claims.filter(claim=>isCurrentClaim(claim)&&claim.kind==="observation"&&
      sameEntity(claim.subject,edge.subject)&&sameEntity(claim.object,edge.object));
    const ranked=derived.hypotheses.map(item=>{
      const pathEdges=[...new Map(item.paths.flat().map(edge=>[keyOf(edge),edge])).values()];
      const counterexamples=[],support=[],unobserved=[];
      const involvedIds=new Set(pathEdges.map(keyOf));
      const details=[];
      for(const edge of pathEdges){
        const observations=observationsFor(edge);
        const negatives=observations.filter(claim=>claim.polarity===false);
        const positives=observations.filter(claim=>claim.polarity!==false);
        counterexamples.push(...negatives);
        support.push(...positives);
        if(!observations.length)unobserved.push(edge);
        details.push({edge,observations});
      }
      const uniqueCounter=[...new Map(counterexamples.map(claim=>[keyOf(claim),claim])).values()];
      const uniqueSupport=[...new Map(support.map(claim=>[keyOf(claim),claim])).values()];
      const rank=uniqueCounter.length?1:unobserved.length?2:3;
      return {
        subject:item.subject,object:item.object,paths:item.paths,edges:pathEdges,details,
        counterexamples:uniqueCounter,support:uniqueSupport,unobserved,
        rank,involvedIds:[...involvedIds]
      };
    }).sort((a,b)=>a.rank-b.rank);
    const sharedCounts=new Map();
    for(const item of ranked){
      for(const id of new Set(item.involvedIds))sharedCounts.set(id,(sharedCounts.get(id)||0)+1);
    }
    const edgeById=new Map(ranked.flatMap(item=>item.edges.map(edge=>[keyOf(edge),edge])));
    const shared=[...sharedCounts.entries()].filter(([,count])=>count>1).map(([id])=>edgeById.get(id)).filter(Boolean);
    const allUsed=new Map();
    for(const item of ranked){
      for(const edge of item.edges)allUsed.set(keyOf(edge),edge);
      for(const claim of [...item.counterexamples,...item.support])allUsed.set(keyOf(claim),claim);
    }
    let answer="Я расставил не вероятности причин, а порядок работы с пробелами и противоречиями в памяти. Этот приоритет не означает, что одна гипотеза истиннее другой.\\n\\n";
    for(let index=0;index<ranked.length;index++){
      const item=ranked[index];
      const route=item.paths[0].map(edge=>edge.subject).concat(item.paths[0][item.paths[0].length-1].object).join(" → ");
      const label=item.rank===1?"сначала уточнить потенциальный контрпример":item.rank===2?"сначала собрать недостающие наблюдения":"перепроверить уже записанные наблюдения";
      answer+=(index+1)+". ПРИОРИТЕТ "+(index+1)+" — "+label+"\\n";
      answer+="Гипотеза: "+item.subject+" ⇢ "+item.object+"\\n";
      answer+="Возможный путь: "+route+"\\n";
      if(item.counterexamples.length){
        for(const claim of item.counterexamples){
          const matching=item.details.find(detail=>detail.observations.some(observation=>keyOf(observation)===keyOf(claim)));
          const edge=matching&&matching.edge;
          answer+="Слабое звено: "+(edge?edge.subject+" → "+edge.object:"одно из исходных звеньев")+"\\n";
          answer+="Потенциальный контрпример: «"+String(claim.evidence||"").slice(0,220)+"»\\n";
        }
        answer+="Первым делом нужно уточнить контекст этого наблюдения и проверить, повторялось ли оно. Не следует автоматически отбрасывать ни правило, ни наблюдение.\\n";
      }
      if(item.unobserved.length){
        answer+="Нет отдельных наблюдений для звеньев: "+item.unobserved.map(edge=>edge.subject+" → "+edge.object).join("; ")+".\\n";
      }
      if(item.support.length){
        answer+="Наблюдения, согласующиеся со звеньями: "+item.support.map(claim=>"«"+String(claim.evidence||"").slice(0,160)+"»").join("; ")+".\\n";
      }
      if(!item.counterexamples.length&&!item.support.length){
        answer+="В памяти нет отдельных наблюдений, которые напрямую проверяли бы эти звенья. Это пробел данных, а не подтверждение гипотезы.\\n";
      }
      answer+="\\n";
    }
    if(shared.length){
      answer+="Общее звено между несколькими гипотезами: "+shared.map(edge=>edge.subject+" → "+edge.object).join("; ")+". Оно взято из общей исходной записи и не становится независимым подтверждением только потому, что встречается в нескольких цепочках.\\n\\n";
    }
    answer+="Практический порядок: сначала уточнить противоречивые наблюдения, затем собирать безопасные естественные наблюдения по звеньям, для которых данных нет. Не нужно специально создавать вредные условия. Все исходные связи остаются сообщениями из памяти, а не независимо проверенными данными. Новые гипотезы и этот порядок не сохраняются как факты.";
    const claimIds=[...allUsed.values()].map(claim=>claim.id).filter(Boolean);
    return {answer,hypotheses:ranked,sharedEdges:shared,claimIds:[...new Set(claimIds)],counterexampleCount:ranked.reduce((sum,item)=>sum+item.counterexamples.length,0)};
  }

  function answerQuestion(query, claims) {
    const q = normalise(query);
    if (!q || !Array.isArray(claims)) return null;
    const qWords = new Set(q.split(/\s+/u));
    const queryTokens = new Set(tokens(q));
    const hasAny = words => words.some(word => qWords.has(word));
    if (/^(?:что ты умеешь|что умеешь|что ты можешь|какие у тебя возможности|что может нейрогенезис|как ты устроен)$/u.test(q)) {
      return capabilitiesAnswer();
    }
    if (/^(?:что ты знаешь|что ты помнишь|что тебе известно)\s+(?:обо мне|о мне|про меня)$/u.test(q) ||
        /^(?:расскажи|расскажи мне)\s+(?:обо мне|про меня)$/u.test(q) ||
        /^каким ты меня знаешь$/u.test(q)) {
      return userProfile(claims);
    }
    const historyAnswer=temporalHistoryAnswer(query,claims);
    if(historyAnswer)return historyAnswer;
    const temporalAnswer=temporalLocationAnswer(query,claims);
    if(temporalAnswer)return temporalAnswer;
    const hypothesisPriority=prioritizeHypotheses(query,claims);
    if(hypothesisPriority)return hypothesisPriority.answer;
    const derivedHypotheses=deriveHypotheses(query,claims);
    if(derivedHypotheses)return derivedHypotheses.answer;
    const experimentPlan=designDiscriminatingTest(query,claims);
    if(experimentPlan)return experimentPlan.answer;
    const hypothesisCheck=evaluateConditionalHypothesis(query,claims);
    if(hypothesisCheck)return hypothesisCheck.answer;
    const causal=causalEvidence(query,claims);
    if(causal)return causal.answer;
    if (/^(?:кем ты был раньше|какая у тебя была роль|какую роль ты выполнял раньше|как я раньше тебя называл)$/u.test(q)) {
      const current = claims.filter(claim=>claim.kind==="identity"&&claim.subject==="assistant"&&isCurrentClaim(claim));
      const latest = current[current.length-1];
      const past = claims.filter(claim=>claim.kind==="identity"&&claim.subject==="assistant"&&claim.status==="superseded"&&(!latest||claim.supersededBy===latest.id));
      if (past.length) {
        const roles = [...new Map(past.map(claim=>[normalise(claim.object),claim])).values()];
        return "Ранее ты задавал мне роль " + roles.map(claim=>"«"+claim.object+"»").join(", ") +
          ". Я сохранил прежнее описание в истории. Источник: «" + roles[roles.length-1].evidence + "».";
      }
      return "Я не нашёл в памяти прежнего описания своей роли.";
    }
    if (/^(?:кто ты|ты кто|кто вы|вы кто|что ты такое|что вы такое|расскажи о себе|представься)$/u.test(q)) {
      const intro = systemDescription();
      const identities = claims.filter(claim => claim.kind === "identity" && claim.subject === "assistant" && claim.polarity && isCurrentClaim(claim));
      const roles = [...new Set(identities.map(claim => normalise(claim.object)))];
      if (roles.length > 1) {
        return intro + " В моей памяти есть несколько актуальных описаний роли: " + [...new Set(identities.map(claim => claim.object))].join(", ") +
          ". Я не стану выбирать одно наугад. Скажи, какое описание оставить актуальным.";
      }
      if (identities.length) {
        const claim = identities[identities.length - 1];
        const previous = claims.filter(item=>item.kind==="identity"&&item.subject==="assistant"&&item.status==="superseded"&&item.supersededBy===claim.id);
        let answer = intro + " По твоему сообщению, я — " + claim.object +
          ". Ты задал мне эту роль, и я сохранил её в памяти. Источник: «" + claim.evidence + "».";
        if (previous.length) answer += " Ранее ты называл меня " + [...new Set(previous.map(item=>item.object))].join(", ") + "; прежняя роль сохранена в истории.";
        return answer;
      }
      return intro + " Ты пока не задавал мне отдельную роль.";
    }
    const target = hasAny(["твой","твоя","твое","твои","твоего","твоей","твоему","твоим","твою"]) || (qWords.has("у") && qWords.has("тебя")) ? "assistant" :
      hasAny(["мой","моя","мое","мои","моего","моей","моему","моим","мою"]) || (qWords.has("у") && qWords.has("меня")) ? "user" : null;
    const asksCreator = /создател|создал|создала|создали/u.test(q) &&
      (target === "assistant" || qWords.has("тебя") || qWords.has("ты"));
    if (asksCreator) {
      const creators = claims.filter(claim => claim.kind === "fact" && claim.subject === "assistant" && claim.predicate === "создатель" && isCurrentClaim(claim));
      const creatorConflict = findConflicts(creators)[0];
      if (creatorConflict) {
        return "В памяти есть разные сведения о том, кто меня создал: «" + creatorConflict.left.evidence +
          "» и «" + creatorConflict.right.evidence + "». Я не буду выбирать наугад — нужно уточнение.";
      }
      if (creators.length) {
        const claim = creators[creators.length - 1];
        return "По твоему сообщению, моего создателя зовут " + claim.object +
          ". Я сохранил это как переданное тобой сведение; независимо подтвердить его я не могу. Источник: «" + claim.evidence + "».";
      }
    }
    const profile = entityProfile(q, claims);
    if (profile) return profile;

    if (qWords.has("где") && (qWords.has("я") || qWords.has("мне") || qWords.has("меня"))) {
      const location = claims.filter(claim => claim.kind === "fact" && claim.subject === "user" && isCurrentClaim(claim) && /живу в|нахожусь в/u.test(claim.predicate)).slice(-1)[0];
      if (location) return "Ты сообщал мне, что живёшь в " + location.object + ". Я храню это как твоё самоописание, а не как независимо проверенные данные.";
    }

    const asksWho = hasAny(["кто","кого","кому","чей","чья","чье","чьи"]) ||
      (hasAny(["как"]) && hasAny(["зовут","имя"]));
    const relationRoots = ["друг","подруг","коллег","наставник","учител","партнер","товарищ","брат","сестр","враг","знаком"];
    const asksRelation = [...queryTokens].some(token => relationRoots.some(root => token.startsWith(root)));
    if (asksWho && asksRelation) {
      const related = claims.filter(claim => claim.kind === "relationship" && isCurrentClaim(claim) && (!target || claim.object === target));
      const directConflict = findConflicts(related).find(conflict => conflict.type === "direct");
      if (directConflict) {
        return "В памяти есть противоречащие утверждения: «" + directConflict.left.evidence + "» и «" + directConflict.right.evidence + "». Я не буду угадывать, какое из них верно — нужно уточнение.";
      }
      const matches = related.filter(claim => claim.polarity);
      if (matches.length) {
        const targetKinds = new Set(matches.map(claim => claim.object));
        if (!target && targetKinds.size > 1) {
          return "Я нашёл отношения, относящиеся и ко мне, и к тебе. Уточни: ты спрашиваешь про моего друга или про своего?";
        }
        const uniqueSubjects = [...new Set(matches.map(claim => canonicalEntity(claim.subject)))];
        if (uniqueSubjects.length > 1 && matches.some(claim => /лучший друг|лучшая подруга|единственн/u.test(claim.predicate))) {
          const names = [...new Set(matches.map(claim => claim.subject))];
          return "В памяти есть несколько записей о лучшем друге: " + names.join(", ") + ". Они могут противоречить друг другу. Я не стану выбирать наугад — уточни, какая запись верна.";
        }
        const claim = matches[matches.length - 1];
        const feminine = /подруга|сестра|знакомая/u.test(claim.predicate);
        if (claim.object === "assistant") {
          return "По твоему сообщению, " + claim.subject + " — " + (feminine ? "моя " : "мой ") + claim.predicate + ". Я сохранил это как твоё утверждение; независимо проверить его я не могу.";
        }
        if (claim.object === "user") {
          return "По твоему сообщению, " + claim.subject + " — " + (feminine ? "твоя " : "твой ") + claim.predicate + ". Я сохранил это как твоё утверждение; независимо проверить его я не могу.";
        }
        return "В моей памяти записано: " + claimLabel(claim) + ". Источник — твоё сообщение; независимо проверить это утверждение я не могу.";
      }
    }

    const asksPreference = hasAny(["люблю","любишь","любит","нравится","нравятся","предпочитаю","предпочитаешь","обожаю","обожаешь"]);
    if (asksPreference) {
      const preferences = claims.filter(claim => claim.kind === "preference" && claim.subject === "user" && isCurrentClaim(claim));
      const relevantPreferences = preferences.map(claim => {
        const objectTokens = new Set(tokens(claim.object));
        const hits = [...queryTokens].filter(token => objectTokens.has(token)).length;
        return { claim, score: hits / Math.sqrt(Math.max(1, queryTokens.size) * Math.max(1, objectTokens.size)) };
      }).filter(row => row.score > 0 || queryTokens.size <= 2).sort((a,b) => b.score - a.score);
      if (relevantPreferences.length) {
        const claim = relevantPreferences[0].claim;
        return "Ты сообщал мне, что " + preferencePhrase(claim,false) + ". Я храню это как твоё самоописание.";
      }
    }

    const qTokens = new Set(tokens(q));
    if (!qTokens.size) return null;
    const relevant = claims.filter(claim=>isCurrentClaim(claim)).map(claim => {
      const cTokens = new Set(tokens(claimSearchText(claim)));
      let hits = 0;
      for (const token of qTokens) if (cTokens.has(token)) hits++;
      return { claim, score: hits / Math.sqrt(qTokens.size * Math.max(1, cTokens.size)) };
    }).filter(row => row.score >= 0.16).sort((a,b) => b.score - a.score);
    if (!relevant.length) return null;
    const claim = relevant[0].claim;
    if (claim.kind === "opinion") {
      return "В моей памяти сохранена твоя оценка: «" + claim.subject + " " + (claim.polarity ? "" : "не ") + claim.object + "». Это субъективное мнение, записанное с твоих слов, а не объективно установленный факт.";
    }
    if (claim.kind === "preference") {
      return "Ты сообщал мне, что " + preferencePhrase(claim,false) + ". Я храню это как твоё самоописание.";
    }
    if (claim.kind === "fact") {
      return "Ты сообщал мне: " + claim.predicate + " " + claim.object + ". Я храню это как твоё самоописание, а не как независимо проверенный факт.";
    }
    if (claim.kind === "definition") {
      return "В сохранённой записи сказано: " + claim.subject + " " + claim.predicate + " " + claim.object + ". Это определение из твоего сообщения; я не проверял его независимо.";
    }
    if (claim.kind === "hypothesis") {
      return "Я сохранил твоё предположение: " + claim.object + ". Оно помечено как гипотеза, а не как установленный факт.";
    }
    return "В памяти есть запись: " + claimLabel(claim) + ". Источник — твоё сообщение.";
  }
  function findConflicts(input, at = Date.now()) {
    const list=Array.isArray(input)?input:[];
    const conflicts=[];
    const isBestFriend=claim=>/лучший друг|лучшая подруга|самый близкий друг/u.test(normalise(claim.predicate));
    for(let i=0;i<list.length;i++){
      for(let j=i+1;j<list.length;j++){
        const a=list[i],b=list[j];
        if(!a||!b||a.kind!==b.kind||!isCurrentClaim(a,at)||!isCurrentClaim(b,at)||!claimPeriodsOverlap(a,b))continue;
        if(a.kind==="relationship"){
          const sameSubject=sameEntity(a.subject,b.subject),sameObject=a.object===b.object;
          const samePredicate=canonicalEntity(a.predicate)===canonicalEntity(b.predicate);
          if(sameSubject&&sameObject&&samePredicate&&a.polarity!==b.polarity){
            conflicts.push({type:"direct",left:a,right:b,reason:"Одно и то же отношение одновременно утверждается и отрицается."});
          }else if(!sameSubject&&sameObject&&a.polarity&&b.polarity&&isBestFriend(a)&&isBestFriend(b)){
            conflicts.push({type:"possible",left:a,right:b,reason:"Две разные персоны названы лучшим другом одного и того же человека."});
          }
        }else if(a.kind==="identity"&&sameEntity(a.subject,b.subject)&&
          (a.polarity!==b.polarity||!sameEntity(a.object,b.object))){
          conflicts.push({type:"possible",left:a,right:b,reason:"Для ассистента сохранены разные описания роли."});
        }else if(a.kind==="fact"&&sameEntity(a.subject,b.subject)&&
          factFamily(a.predicate)===factFamily(b.predicate)&&!sameEntity(a.object,b.object)){
          conflicts.push({type:"possible",left:a,right:b,reason:"Для одного самоописания сохранены разные значения."});
        }else if(a.kind==="preference"&&sameEntity(a.subject,b.subject)&&
          sameEntity(a.object,b.object)&&a.polarity!==b.polarity){
          conflicts.push({type:"direct",left:a,right:b,reason:"Одно предпочтение одновременно утверждается и отрицается."});
        }else if(a.kind==="causal"&&sameEntity(a.subject,b.subject)&&sameEntity(a.object,b.object)&&a.polarity!==b.polarity){
          conflicts.push({type:"direct",left:a,right:b,reason:"Одна и та же причинная связь одновременно утверждается и отрицается."});
        }
      }
    }
    return conflicts;
  }
  function reconcileIdentityHistory(input) {
    const claims = Array.isArray(input) ? input : [];
    const identities = claims.map((claim,index)=>({claim,index}))
      .filter(row=>row.claim&&row.claim.kind==="identity"&&row.claim.subject==="assistant")
      .sort((a,b)=>(Number(a.claim.createdAt)||0)-(Number(b.claim.createdAt)||0)||a.index-b.index)
      .map(row=>row.claim);
    const before = identities.map(claim=>[claim.id,claim.status,claim.supersededBy||null].join("|")).join(";");
    for (const claim of identities) {
      if (!INACTIVE_STATUSES.has(claim.status)) {
        if (claim.supersededBy) claim.status = "superseded";
        else claim.status = "current";
      }
    }
    const active = [];
    for (const claim of identities) {
      if (INACTIVE_STATUSES.has(claim.status)) continue;
      if (claim.revision) {
        for (const prior of active) {
          if (prior.id === claim.id) continue;
          prior.status = "superseded";
          prior.supersededBy = claim.id;
        }
        for (let i=active.length-1;i>=0;i--) if (active[i].status === "superseded") active.splice(i,1);
      }
      if (!active.some(prior=>prior.id===claim.id)) active.push(claim);
    }
    const after = identities.map(claim=>[claim.id,claim.status,claim.supersededBy||null].join("|")).join(";");
    return before !== after;
  }
  function reconcileMutableHistory(input) {
    const claims = Array.isArray(input) ? input : [];
    const slotFor = claim => {
      if (!claim) return null;
      if (claim.kind==="fact" && claim.subject==="user") {
        const family = factFamily(claim.predicate);
        return ["location","work","study"].includes(family) ? "fact:user:"+family : null;
      }
      if (claim.kind==="preference" && claim.subject==="user") {
        return "preference:user:"+normalise(claim.predicate)+":"+canonicalEntity(claim.object);
      }
      return null;
    };
    const rows = claims.map((claim,index)=>({claim,index,slot:slotFor(claim)}))
      .filter(row=>row.slot)
      .sort((a,b)=>(Number(a.claim.createdAt)||0)-(Number(b.claim.createdAt)||0)||a.index-b.index);
    const before = rows.map(row=>[row.claim.id,row.claim.status,row.claim.supersededBy||null,row.claim.validTo||null].join("|")).join(";");
    for(const row of rows) {
      const newer=row.claim;
      if(newer.temporalRelation!=="since"||newer.validFrom==null)continue;
      for(const priorRow of rows) {
        const prior=priorRow.claim;
        if(prior===newer||priorRow.slot!==row.slot||sameEntity(prior.object,newer.object)||
          prior.createdAt>newer.createdAt||prior.validTo!=null||
          !["historical","current"].includes(String(prior.status||"current")))continue;
        if(prior.validFrom!=null&&prior.validFrom>=newer.validFrom)continue;
        prior.validTo=newer.validFrom;
        prior.status="current";
        prior.temporalRelation=prior.temporalRelation||"inferred-until";
        prior.temporalPrecision=prior.temporalPrecision||"unknown";
      }
    }
    for (const row of rows) {
      if (!INACTIVE_STATUSES.has(row.claim.status)) {
        if (row.claim.supersededBy) row.claim.status = "superseded";
        else row.claim.status = "current";
      }
    }
    const activeBySlot = new Map();
    for (const row of rows) {
      const claim = row.claim;
      if (INACTIVE_STATUSES.has(claim.status)) continue;
      const active = activeBySlot.get(row.slot) || [];
      if (claim.revision) {
        const keep = [];
        for (const prior of active) {
          const sameValue = sameEntity(prior.object,claim.object) && prior.polarity===claim.polarity;
          if (sameValue) keep.push(prior);
          else { prior.status="superseded"; prior.supersededBy=claim.id; }
        }
        activeBySlot.set(row.slot,[...keep,claim]);
      } else {
        activeBySlot.set(row.slot,[...active,claim]);
      }
    }
    const after = rows.map(row=>[row.claim.id,row.claim.status,row.claim.supersededBy||null,row.claim.validTo||null].join("|")).join(";");
    return before !== after;
  }
  function reconcileKnowledgeHistory(input) {
    const identityChanged = reconcileIdentityHistory(input);
    const mutableChanged = reconcileMutableHistory(input);
    return identityChanged || mutableChanged;
  }
  function summary(claims) {
    const list=Array.isArray(claims)?claims:[];
    const conflicts=findConflicts(list);
    return {total:list.length,relationships:list.filter(x=>x.kind==="relationship").length,causal:list.filter(x=>x.kind==="causal").length,rules:list.filter(x=>x.kind==="rule").length,observations:list.filter(x=>x.kind==="observation").length,identities:list.filter(x=>x.kind==="identity").length,activeIdentities:list.filter(x=>x.kind==="identity"&&isCurrentClaim(x)).length,opinions:list.filter(x=>x.kind==="opinion").length,preferences:list.filter(x=>x.kind==="preference").length,facts:list.filter(x=>x.kind==="fact").length,definitions:list.filter(x=>x.kind==="definition").length,hypotheses:list.filter(x=>x.kind==="hypothesis").length,conflicts:conflicts.length};
  }
  window.NGKnowledge={version:25,systemProfile:()=>({...SYSTEM_PROFILE}),normalise,tokens,semanticMatch,canonicalEntity,sameEntity,isValidCausalSubject,isReportedCausalStatement,parseClaimTime,parseTemporalPeriod,isClaimValidAt,isCurrentClaim,extractClaims,sanitizeClaims,mergeClaims,parseObservationDetails,sanitizeObservationDetails,reconcileIdentityHistory,reconcileMutableHistory,reconcileKnowledgeHistory,claimLabel,claimSearchText,answerQuestion,entityProfile,userProfile,causalEvidence,evaluateConditionalHypothesis,designDiscriminatingTest,deriveHypotheses,prioritizeHypotheses,findCausalPaths,findConflicts,buildTemporalEvents,summary};
})();