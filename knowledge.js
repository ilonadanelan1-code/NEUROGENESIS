(() => {
  "use strict";
  const STOP = new Set(("и в во на я ты мы вы они он она оно мне меня тебя тебе ваш ваши мой моя мое мои свой свои себя это этот эта эти тот та те что как где когда зачем почему кто который а но или да нет не ни же бы ли для по из к со с от до над под при про у об обо есть был была были быть буду будет уже еще очень также тут там туда сюда его ее их твой твоя твое твои").split(/\s+/u));
  const RELATIONS = ["самый близкий друг","лучшая подруга","лучший друг","близкий друг","друг","подруга","коллега","наставник","учитель","партнер","партнёр","товарищ","брат","сестра","враг","знакомый","знакомая"];
  const OWNER = {"твой":"assistant","твоя":"assistant","твоё":"assistant","твои":"assistant","твое":"assistant","мой":"user","моя":"user","моё":"user","мои":"user","мое":"user","наш":"shared","наша":"shared","наше":"shared","наши":"shared"};
  const EVALUATIONS = ["прекрасн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","великолепн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","красив(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","интересн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","важн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","ужасн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","скучн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","хорош(?:ий|ая|ее|ие|его|ей|ую|им|ими|о|а)?","плох(?:ой|ая|ое|ие|ого|ой|ую|им|ими|о|а)?","сложн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","прост(?:ой|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","удивительн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","грустн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?","радостн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми|а|о)?"];
  const EVALUATION_RE = new RegExp("^(?:" + EVALUATIONS.join("|") + ")$", "iu");
  function normalise(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim().replace(/\s+/g, " ");
  }
  function tokens(value) {
    return normalise(value).split(" ").filter(word => word.length >= 3 && !STOP.has(word))
      .map(word => word.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|ах|ях|ов|ев|ей|ом|ем|а|я|ы|и|е|у|ю|ь)$/u, "")).filter(word => word.length >= 3);
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
  function extractPreference(text) {
    const match = text.match(/^(?:я\s+(люблю|обожаю|предпочитаю|ненавижу)|мне\s+(нравится|не\s+нравится))\s+(.+)$/iu);
    if (!match) return null;
    const predicate = (match[1] || match[2]).toLowerCase();
    const polarity = !/ненавижу|не\s+нравится/u.test(predicate);
    return makeClaim("preference","user",predicate.replace(/^не\s+/u,""),cleanPart(match[3]),text,"self_reported",0.94,polarity);
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
    let match = text.match(/^я\s+(живу в|нахожусь в|работаю в|учусь в|работаю|учусь|занимаюсь)\s+(.+)$/iu);
    if (match) return makeClaim("fact","user",match[1].toLowerCase(),cleanPart(match[2],180),text,"self_reported",0.93);
    match = text.match(/^у меня есть\s+(.+)$/iu);
    if (match) return makeClaim("fact","user","имеет",cleanPart(match[1],180),text,"self_reported",0.93);
    return null;
  }
  function extractHypothesis(text) {
    const match = text.match(/^(?:(?:возможно|вероятно|кажется),?\s+|(?:я предполагаю|я думаю)(?:\s*,?\s*что)?\s+)(.+)$/iu);
    if (!match) return null;
    return makeClaim("hypothesis","user","предполагает",cleanPart(match[1],180),text,"hypothesis",0.78);
  }
  function extractClaims(input) {
    const text = cleanPart(input,1200);
    if (!text) return [];
    const claim = extractRelationship(text) || extractPreference(text) || extractSelfReport(text) || extractHypothesis(text) || extractOpinion(text) || extractDefinition(text);
    return claim ? [claim] : [];
  }
  function sanitizeClaims(input, evidenceFallback = "") {
    if (!Array.isArray(input)) return [];
    const kinds = new Set(["relationship","preference","fact","opinion","definition","hypothesis"]);
    return input.slice(0,12).map(raw => {
      if (!raw || typeof raw !== "object") return null;
      const kind = kinds.has(raw.kind) ? raw.kind : null;
      const subject = cleanPart(raw.subject), predicate = cleanPart(raw.predicate,80), object = cleanPart(raw.object,180);
      if (!kind || !subject || !predicate || !object) return null;
      const evidence = cleanPart(raw.evidence || evidenceFallback,1200);
      const verification = ["unverified","subjective","self_reported","hypothesis"].includes(raw.verification) ? raw.verification : "unverified";
      return {id:typeof raw.id==="string"?raw.id.slice(0,80):makeId(kind,evidence),kind,subject,predicate,object,holder:"user",polarity:raw.polarity!==false,source:"user_message",evidence,verification,extractionConfidence:Number.isFinite(Number(raw.extractionConfidence))?Math.max(0,Math.min(1,Number(raw.extractionConfidence))):0.7,traceId:typeof raw.traceId==="string"?raw.traceId.slice(0,80):null,createdAt:Number.isFinite(Number(raw.createdAt))&&Number(raw.createdAt)>0?Number(raw.createdAt):Date.now()};
    }).filter(Boolean);
  }
  function mergeClaims(existing,incoming) {
    const merged=[...sanitizeClaims(existing),...sanitizeClaims(incoming)],seen=new Set();
    const result=[];
    for(const claim of merged){
      const key=[claim.kind,canonicalEntity(claim.subject),normalise(claim.predicate),normalise(claim.object),claim.polarity].join("|");
      const prior=result.find(item=>[item.kind,canonicalEntity(item.subject),normalise(item.predicate),normalise(item.object),item.polarity].join("|")===key);
      if(prior){if(!prior.traceId&&claim.traceId)prior.traceId=claim.traceId;continue;}
      if(!seen.has(key)){seen.add(key);result.push(claim);}
    }
    return result.slice(0,12);
  }
  function claimLabel(claim) {
    if(!claim)return "";
    if(claim.kind==="opinion") return claim.subject+" — "+(claim.polarity?"":"не ")+claim.object;
    if(claim.kind==="fact" && claim.subject==="user") return "Пользователь "+claim.predicate+" "+claim.object;
    if(claim.kind==="preference") return "Пользователь "+(claim.polarity?"":"не ")+claim.predicate+" "+claim.object;
    if(claim.kind==="relationship"){
      const target=claim.object==="assistant"?"ассистент":claim.object==="user"?"пользователь":"общее окружение";
      return claim.subject+" — "+(claim.polarity?"":"не ")+claim.predicate+" ("+target+")";
    }
    return claim.subject+" — "+(claim.polarity?"":"не ")+claim.predicate+" — "+claim.object;
  }
  function claimSearchText(claim) {
    if(!claim)return "";
    const object=claim.object==="assistant"?"я ассистент мой":claim.object==="user"?"ты пользователь твой":claim.object;
    return [claim.subject,claim.predicate,object,claim.evidence].join(" ");
  }
  function answerQuestion(query, claims) {
    const q = normalise(query);
    if (!q || !Array.isArray(claims) || !claims.length) return null;
    const qWords = new Set(q.split(/\s+/u));
    const queryTokens = new Set(tokens(q));
    const hasAny = words => words.some(word => qWords.has(word));
    const target = hasAny(["твой","твоя","твое","твои","твоего","твоей","твоему","твоим","твою"]) || (qWords.has("у") && qWords.has("тебя")) ? "assistant" :
      hasAny(["мой","моя","мое","мои","моего","моей","моему","моим","мою"]) || (qWords.has("у") && qWords.has("меня")) ? "user" : null;

    if (qWords.has("где") && (qWords.has("я") || qWords.has("мне") || qWords.has("меня"))) {
      const location = claims.filter(claim => claim.kind === "fact" && /живу в|нахожусь в/u.test(claim.predicate)).slice(-1)[0];
      if (location) return "Ты сообщал мне, что живёшь в " + location.object + ". Я храню это как твоё самоописание, а не как независимо проверенные данные.";
    }

    const asksWho = hasAny(["кто","кого","кому","чей","чья","чье","чьи"]) ||
      (hasAny(["как"]) && hasAny(["зовут","имя"]));
    const relationRoots = ["друг","подруг","коллег","наставник","учител","партнер","товарищ","брат","сестр","враг","знаком"];
    const asksRelation = [...queryTokens].some(token => relationRoots.some(root => token.startsWith(root)));
    if (asksWho && asksRelation) {
      const related = claims.filter(claim => claim.kind === "relationship" && (!target || claim.object === target));
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
      const preferences = claims.filter(claim => claim.kind === "preference" && claim.subject === "user");
      const relevantPreferences = preferences.map(claim => {
        const objectTokens = new Set(tokens(claim.object));
        const hits = [...queryTokens].filter(token => objectTokens.has(token)).length;
        return { claim, score: hits / Math.sqrt(Math.max(1, queryTokens.size) * Math.max(1, objectTokens.size)) };
      }).filter(row => row.score > 0 || queryTokens.size <= 2).sort((a,b) => b.score - a.score);
      if (relevantPreferences.length) {
        const claim = relevantPreferences[0].claim;
        return "Ты сообщал мне, что " + (claim.polarity ? "тебе " : "тебе не ") + claim.predicate + " " + claim.object + ". Я храню это как твоё самоописание.";
      }
    }

    const qTokens = new Set(tokens(q));
    if (!qTokens.size) return null;
    const relevant = claims.map(claim => {
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
      return "Ты сообщал мне, что " + (claim.polarity ? "тебе " : "тебе не ") + claim.predicate + " " + claim.object + ". Я храню это как твоё самоописание.";
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
  function findConflicts(input) {
    const list = Array.isArray(input) ? input : [];
    const conflicts = [];
    const isBestFriend = claim => /лучший друг|лучшая подруга|самый близкий друг/u.test(canonicalEntity(claim.predicate).replace(/ /g, " "));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (!a || !b || a.kind !== b.kind) continue;
        if (a.kind === "relationship") {
          const sameSubject = sameEntity(a.subject, b.subject);
          const sameObject = a.object === b.object;
          const samePredicate = canonicalEntity(a.predicate) === canonicalEntity(b.predicate);
          if (sameSubject && sameObject && samePredicate && a.polarity !== b.polarity) {
            conflicts.push({type:"direct",left:a,right:b,reason:"Одно и то же отношение одновременно утверждается и отрицается."});
          } else if (!sameSubject && sameObject && a.polarity && b.polarity && isBestFriend(a) && isBestFriend(b)) {
            conflicts.push({type:"possible",left:a,right:b,reason:"Две разные персоны названы лучшим другом одного и того же человека."});
          }
        } else if (a.kind === "fact" && sameEntity(a.subject,b.subject) &&
          relationFamily(a.predicate) === relationFamily(b.predicate) && !sameEntity(a.object,b.object)) {
          conflicts.push({type:"possible",left:a,right:b,reason:"Для одного самоописания сохранены разные значения."});
        } else if (a.kind === "preference" && sameEntity(a.subject,b.subject) &&
          sameEntity(a.object,b.object) && a.polarity !== b.polarity) {
          conflicts.push({type:"direct",left:a,right:b,reason:"Одно предпочтение одновременно утверждается и отрицается."});
        }
      }
    }
    return conflicts;
  }
  function summary(claims) {
    const list=Array.isArray(claims)?claims:[];
    const conflicts=findConflicts(list);
    return {total:list.length,relationships:list.filter(x=>x.kind==="relationship").length,opinions:list.filter(x=>x.kind==="opinion").length,preferences:list.filter(x=>x.kind==="preference").length,facts:list.filter(x=>x.kind==="fact").length,definitions:list.filter(x=>x.kind==="definition").length,hypotheses:list.filter(x=>x.kind==="hypothesis").length,conflicts:conflicts.length};
  }
  window.NGKnowledge={version:2,normalise,tokens,canonicalEntity,sameEntity,extractClaims,sanitizeClaims,mergeClaims,claimLabel,claimSearchText,answerQuestion,findConflicts,summary};
})();