(() => {
  "use strict";

  const SCHEMA = "NG_DISCOURSE_COREFERENCE_V1";
  const MAX_MESSAGES = 8;
  const MAX_CANDIDATES = 64;
  const clean = (value, limit = 240) => String(value == null ? "" : value)
    .replace(/\s+/gu, " ").trim().slice(0, limit);
  const normalise = value => clean(value, 240).normalize("NFKC").toLowerCase()
    .replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  const PRONOUNS = Object.freeze({
    "он": { genders:["masculine"], number:"singular", grammaticalCase:"nominative" },
    "она": { genders:["feminine"], number:"singular", grammaticalCase:"nominative" },
    "оно": { genders:["neuter"], number:"singular", grammaticalCase:"nominative" },
    "они": { genders:["plural"], number:"plural", grammaticalCase:"nominative" },
    "его": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"genitive_or_accusative" },
    "него": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"genitive_or_accusative" },
    "ее": { genders:["feminine"], number:"singular", grammaticalCase:"genitive_or_accusative" },
    "неё": { genders:["feminine"], number:"singular", grammaticalCase:"genitive_or_accusative" },
    "их": { genders:["plural"], number:"plural", grammaticalCase:"genitive_or_accusative" },
    "них": { genders:["plural"], number:"plural", grammaticalCase:"genitive_or_accusative" },
    "ему": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"dative" },
    "нему": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"dative" },
    "ей": { genders:["feminine"], number:"singular", grammaticalCase:"dative_or_prepositional" },
    "ней": { genders:["feminine"], number:"singular", grammaticalCase:"dative_or_prepositional" },
    "им": { genders:["plural"], number:"plural", grammaticalCase:"dative_or_instrumental" },
    "ними": { genders:["plural"], number:"plural", grammaticalCase:"instrumental" },
    "ним": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"instrumental" },
    "нею": { genders:["feminine"], number:"singular", grammaticalCase:"instrumental" },
    "ею": { genders:["feminine"], number:"singular", grammaticalCase:"instrumental" }
  });
  const PREPOSITIONS = new Set(["с","со","к","ко","у","от","из","для","без","до","около",
    "возле","после","о","об","обо","при","над","перед","между","под","через","за","в","во","на"]);
  const FEMININE_SOFT_SIGN = new Set(["дверь","память","сеть","модель","площадь","ночь","мышь",
    "вещь","любовь","связь","роль","цепь","часть","жизнь","мысль","тень","цель","новость"]);
  const MASCULINE_A_NAMES = new Set(["петя","илья","никита","дима","коля","ваня","сережа",
    "миша","леша","паша","женя","валера","юра","фома","саша"]);
  const COMMON_FUNCTION = new Set(["это","этот","эта","эти","тот","та","те","такой","такая",
    "такое","такие","который","которая","которое","которые","я","ты","вы","мы","он","она",
    "оно","они","его","ее","её","их","ему","ей","им","ним","ней","ними","нею","ею"]);

  function detectMention(value) {
    const text = clean(value, 500);
    const words = text.toLowerCase().replace(/[«»„“”"'()[\]{}.,!?;:]/gu, " ")
      .split(/\s+/u).filter(Boolean);
    for (let index = 0; index < words.length; index++) {
      const word = words[index].replace(/[—–-]+$/u, "");
      const spec = PRONOUNS[word];
      if (!spec) continue;
      const previous = words[index - 1] || "";
      const next = words[index + 1] || "";
      // "его/её/их + noun" is usually possessive, not a standalone anaphoric argument.
      if (["его","ее","её","их"].includes(word) && next &&
          /[\p{L}]/u.test(next) && !/^(?:видел|видела|видели|знаю|знает|знают|встретил|встретила|встретили|помнит|помнят|обнаружил|обнаружила|обнаружили|получил|получила|получили|сказал|сказала|сказали|сделал|сделала|сделали|работает|работают|активируется|активируются|пришёл|пришла|пришли|ушёл|ушла|ушли|был|была|были|стал|стала|стали)$/iu.test(next)) {
        return null;
      }
      const prepositional = PREPOSITIONS.has(previous) ? previous : "";
      let grammaticalCase = spec.grammaticalCase;
      if (prepositional) {
        if (["к","ко","по"].includes(prepositional)) grammaticalCase = "dative";
        else if (["у","от","из","для","без","до","около","возле","после"].includes(prepositional)) grammaticalCase = "genitive";
        else if (["с","со"].includes(prepositional)) grammaticalCase = ["ним","ней","ними","нею","ею"].includes(word)
          ? "instrumental" : "genitive_or_instrumental";
        else if (["о","об","обо","при"].includes(prepositional)) grammaticalCase = "prepositional";
        else if (["над","перед","между","под"].includes(prepositional)) grammaticalCase = "instrumental";
        else if (["через","за"].includes(prepositional)) grammaticalCase = "accusative";
        else if (["в","во","на"].includes(prepositional)) grammaticalCase = "accusative_or_prepositional";
      }
      const role = grammaticalCase === "nominative" ? "subject" : "object";
      return {
        text: prepositional ? previous + " " + word : word,
        token: word,
        tokenIndex: index,
        genders: spec.genders.slice(),
        number: spec.number,
        grammaticalCase,
        syntacticRole: role,
        preposition: prepositional || null
      };
    }
    return null;
  }

  function inferFeatures(value) {
    const text = clean(value, 180);
    const words = text.split(/\s+/u).filter(Boolean);
    const head = normalise(words[words.length - 1] || "");
    if (!head || COMMON_FUNCTION.has(head)) return { gender:"unknown", number:"unknown" };
    if (/[ыи]$/u.test(head) && !FEMININE_SOFT_SIGN.has(head)) {
      // Russian plural forms can coincide with singular oblique forms; do not force plural
      // unless a caller supplied an explicit number.
      return { gender:"unknown", number:"unknown" };
    }
    if (/[оеё]$/u.test(head)) return { gender:"neuter", number:"singular" };
    if (MASCULINE_A_NAMES.has(head)) return { gender:"masculine", number:"singular" };
    if (/[ая]$/u.test(head)) return { gender:"feminine", number:"singular" };
    if (FEMININE_SOFT_SIGN.has(head)) return { gender:"feminine", number:"singular" };
    if (/[й]$/u.test(head) || /[бвгджзйклмнпрстфхцчшщ]$/u.test(head)) {
      return { gender:"masculine", number:"singular" };
    }
    return { gender:"unknown", number:"unknown" };
  }

  function candidateFeatures(candidate) {
    const inferred = inferFeatures(candidate && candidate.text);
    const gender = ["masculine","feminine","neuter","plural","unknown"].includes(candidate && candidate.gender)
      ? candidate.gender : inferred.gender;
    const number = ["singular","plural","unknown"].includes(candidate && candidate.number)
      ? candidate.number : inferred.number;
    return { gender, number };
  }

  function compatible(mention, candidate) {
    const features = candidateFeatures(candidate);
    if (features.gender !== "unknown" && !mention.genders.includes(features.gender)) return false;
    if (features.number !== "unknown" && features.number !== mention.number) return false;
    return true;
  }

  function scoreCandidate(mention, candidate) {
    const features = candidateFeatures(candidate);
    const reasons = [];
    let score = 0;
    if (features.gender === "unknown") {
      score += 0.3;
      reasons.push("gender_unknown_neutral");
    } else {
      score += 1.2;
      reasons.push("gender_agreement");
    }
    if (features.number === "unknown") {
      score += 0.25;
      reasons.push("number_unknown_neutral");
    } else {
      score += 1;
      reasons.push("number_agreement");
    }

    const syntacticRole = candidate.syntacticRole === "subject" ? "subject"
      : candidate.syntacticRole === "object" ? "object" : "unknown";
    const semanticRole = clean(candidate.semanticRole || candidate.role, 32).toLowerCase();
    if (mention.syntacticRole === "subject") {
      score += syntacticRole === "subject" ? 1.05 : syntacticRole === "object" ? 0.12 : 0.28;
      if (["agent","experiencer","source","recipient","subject"].includes(semanticRole)) score += 0.3;
      reasons.push(syntacticRole === "subject" ? "subject_prominence" : "subject_role_weak");
    } else {
      score += syntacticRole === "object" ? 0.5 : syntacticRole === "subject" ? 0.12 : 0.25;
      if (["theme","patient","recipient","instrument","source","object","beneficiary"].includes(semanticRole)) score += 0.55;
      reasons.push(["theme","patient","recipient","instrument","source","object","beneficiary"].includes(semanticRole)
        ? "semantic_argument_compatibility" : "object_role_weak");
    }

    const turnDistance = Math.max(1, Math.min(32, Number(candidate.turnDistance) || 1));
    const sentenceDistance = Math.max(0, Math.min(32, Number(candidate.sentenceDistance) || 0));
    const recency = Math.max(0, 0.9 - 0.13 * (turnDistance - 1) - 0.045 * sentenceDistance);
    score += recency;
    reasons.push("recency_decay");
    const salience = Math.max(0, Math.min(1, Number(candidate.salience) || 0));
    score += salience * 0.25;
    if (Number(candidate.mentionCount) > 1) score += Math.min(0.25, (Number(candidate.mentionCount) - 1) * 0.08);
    if (candidate.sourceRole === "user") score += 0.05;
    return { score: Number(score.toFixed(4)), reasons, features };
  }

  function resolveMention(mentionInput, candidatesInput, options = {}) {
    const mention = mentionInput && typeof mentionInput === "object"
      ? mentionInput : detectMention(mentionInput);
    if (!mention) return {
      schema:SCHEMA,status:"not_applicable",mention:null,antecedent:null,candidates:[],
      confidence:0,margin:0,reason:"no_supported_personal_pronoun",
      provenance:{source:"discourse_coreference",rule:"bounded_candidate_ranking",memoryEffect:"none"}
    };
    const topicId = clean(options.topicId, 80);
    const candidates = (Array.isArray(candidatesInput) ? candidatesInput : [])
      .filter(candidate => candidate && typeof candidate.text === "string" && clean(candidate.text,180))
      .filter(candidate => !topicId || !candidate.topicId || candidate.topicId === topicId)
      .filter(candidate => compatible(mention,candidate))
      .map(candidate => ({...candidate,...scoreCandidate(mention,candidate)}))
      .sort((a,b)=>b.score-a.score);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const margin = best ? Number((best.score - (second ? second.score : 0)).toFixed(4)) : 0;
    const minimumScore = Number.isFinite(Number(options.minimumScore)) ? Number(options.minimumScore) : 2.5;
    const minimumMargin = Number.isFinite(Number(options.minimumMargin)) ? Number(options.minimumMargin) : 0.55;
    let status = "unresolved", reason = "no_compatible_antecedent", confidence = 0;
    if (best) {
      if (best.score < minimumScore) {
        reason = "weak_evidence";
      } else if (second && margin < minimumMargin) {
        status = "ambiguous";
        reason = "competing_antecedents";
      } else {
        status = "resolved";
        reason = "agreement_role_recency_margin";
        confidence = Math.max(0.52,Math.min(0.94,0.52+(best.score-minimumScore)*0.075+margin*0.045));
      }
    }
    return {
      schema:SCHEMA,status,mention,antecedent:status==="resolved"?{
        id:best.id||null,text:clean(best.text,180),gender:best.features.gender,number:best.features.number,
        syntacticRole:best.syntacticRole||"unknown",semanticRole:best.semanticRole||best.role||"unknown",
        turnDistance:Math.max(1,Number(best.turnDistance)||1),sentenceDistance:Math.max(0,Number(best.sentenceDistance)||0)
      }:null,
      candidates:candidates.slice(0,5).map(row=>({
        id:row.id||null,text:clean(row.text,180),score:row.score,reasons:row.reasons,
        gender:row.features.gender,number:row.features.number,
        syntacticRole:row.syntacticRole||"unknown",semanticRole:row.semanticRole||row.role||"unknown",
        turnDistance:Math.max(1,Number(row.turnDistance)||1)
      })),
      confidence,margin,reason,
      provenance:{source:"discourse_coreference",rule:"agreement_role_salience_recency",window:MAX_MESSAGES,
        candidateSource:"active_thread_messages",identityBasis:"surface_cluster_or_single_mention",
        memoryEffect:"none",uncalibrated:true}
    };
  }

  function extractCandidates(messagesInput, core) {
    const messages = (Array.isArray(messagesInput)?messagesInput:[]).slice(-MAX_MESSAGES);
    if (!core || typeof core.analyse !== "function") return [];
    const rows = [];
    messages.forEach((message,messageIndex)=>{
      if (!message || typeof message.text !== "string" || !message.text.trim()) return;
      let frame;
      try { frame = core.analyse(message.text,{contextRelation:"new_topic"}); }
      catch (_) { return; }
      const chain = frame && frame.propositionChain && Array.isArray(frame.propositionChain.items)
        ? frame.propositionChain.items : [];
      const propositions = chain.length ? chain.map(item=>item.proposition||{}) :
        frame && frame.proposition ? [frame.proposition] : [];
      propositions.forEach((proposition,propositionIndex)=>{
        const args = Array.isArray(proposition.arguments)?proposition.arguments:[];
        const add = (rawText,syntacticRole,semanticRole,grammaticalCase)=>{
          const text = clean(rawText,180);
          const key = normalise(text);
          if (!key || COMMON_FUNCTION.has(key) || PRONOUNS[key] || key.split(" ").some(token=>COMMON_FUNCTION.has(token))) return;
          const features = inferFeatures(text);
          const argumentRole = clean(semanticRole,32)||syntacticRole;
          rows.push({
            id:"d"+messageIndex+"-"+propositionIndex+"-"+syntacticRole+"-"+key.replace(/\s+/gu,"-").slice(0,36),
            text,gender:features.gender,number:features.number,
            syntacticRole,semanticRole:argumentRole,grammaticalCase:grammaticalCase||null,
            turnDistance:messages.length-messageIndex,
            sentenceDistance:propositions.length-propositionIndex-1,
            topicId:clean(message.threadId,80),
            sourceRole:message.role==="user"?"user":"assistant",
            salience:syntacticRole==="subject"?0.9:0.55,
            mentionCount:1
          });
        };
        const subject = clean(proposition.subject,180), object = clean(proposition.object,180);
        const subjectArg = args.find(argument=>normalise(argument && argument.text)===normalise(subject));
        const objectArg = args.find(argument=>normalise(argument && argument.text)===normalise(object));
        if (subject) add(subject,"subject",subjectArg&&subjectArg.role||"agent",subjectArg&&subjectArg.grammaticalCase);
        if (object && normalise(object)!==normalise(subject)) add(object,"object",objectArg&&objectArg.role||"theme",objectArg&&objectArg.grammaticalCase);
        for (const argument of args) {
          const text = clean(argument&&argument.text,180);
          if (!text || normalise(text)===normalise(subject) || normalise(text)===normalise(object)) continue;
          const role = clean(argument&&argument.role,32)||"object";
          const syntacticRole = ["agent","experiencer","source","subject"].includes(role)?"subject":"object";
          add(text,syntacticRole,role,argument&&argument.grammaticalCase);
        }
      });
    });
    // Exact surface forms are grouped only inside this bounded active-thread window.
    // This is a retrieval convenience, not a persistent real-world identity assertion.
    const grouped = new Map();
    for (const row of rows) {
      const key = row.topicId+"|"+normalise(row.text);
      const prior = grouped.get(key);
      if (!prior) grouped.set(key,{...row,mentionCount:1});
      else {
        prior.mentionCount++;
        prior.turnDistance = Math.min(prior.turnDistance,row.turnDistance);
        prior.sentenceDistance = Math.min(prior.sentenceDistance,row.sentenceDistance);
        if (row.salience>prior.salience) {
          prior.salience=row.salience;
          prior.syntacticRole=row.syntacticRole;
          prior.semanticRole=row.semanticRole;
        }
      }
    }
    return [...grouped.values()].slice(-MAX_CANDIDATES);
  }

  function resolveFromHistory(query, messages, core, options = {}) {
    const mention = detectMention(query);
    if (!mention) return resolveMention(null,[],options);
    const rows = extractCandidates(messages,core);
    return resolveMention(mention,rows,options);
  }

  window.NGDiscourseCoreference = Object.freeze({
    version:1,schema:SCHEMA,detectMention,inferFeatures,extractCandidates,
    resolveMention,resolveFromHistory
  });
})();