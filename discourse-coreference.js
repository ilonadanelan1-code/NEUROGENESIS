(() => {
  "use strict";

  const SCHEMA = "NG_DISCOURSE_COREFERENCE_V1";
  const MAX_MESSAGES = 24;
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
    "нем": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"prepositional" },
    "нём": { genders:["masculine","neuter"], number:"singular", grammaticalCase:"prepositional" },
    "нею": { genders:["feminine"], number:"singular", grammaticalCase:"instrumental" },
    "ею": { genders:["feminine"], number:"singular", grammaticalCase:"instrumental" }
  });
  const PREPOSITIONS = new Set(["с","со","к","ко","у","от","из","для","без","до","около",
    "возле","после","о","об","обо","при","над","перед","между","под","через","за","в","во","на"]);
  const FEMININE_SOFT_SIGN = new Set(["дверь","память","сеть","модель","площадь","ночь","мышь",
    "вещь","любовь","связь","роль","цепь","часть","жизнь","мысль","тень","цель","новость"]);
  const MASCULINE_A_NAMES = new Set(["петя","илья","никита","дима","коля","ваня","сережа",
    "миша","леша","паша","валера","юра","фома"]);
  const AMBIGUOUS_A_NAMES = new Set(["женя","саша"]);
  const COMMON_FUNCTION = new Set(["это","этот","эта","эти","тот","та","те","такой","такая",
    "такое","такие","который","которая","которое","которые","я","ты","вы","мы","он","она",
    "оно","они","его","ее","её","их","ему","ей","им","ним","нем","нём","ней","ними","нею","ею"]);

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
      const possessiveNextLooksNominal = /(?:а|я|о|е|ё|ы|и|у|ю|ом|ем|ой|ей|ого|его|ому|ему|ую|ый|ий|ая|ое|ые|ых|ыми|ами|ями|ь)$/iu.test(next);
      const nextIsAdverb = /^(?:вчера|сегодня|завтра|потом|сейчас|тогда|позже|недавно|уже|ещ[её]|снова|здесь|там|рядом|быстро|медленно|сразу)$/iu.test(next);
      const nextLooksVerb = /^(?:видел|видела|видели|знаю|знает|знают|встретил|встретила|встретили|помнит|помнят|обнаружил|обнаружила|обнаружили|получил|получила|получили|сказал|сказала|сказали|сделал|сделала|сделали|работает|работают|активируется|активируются|пришёл|пришла|пришли|ушёл|ушла|ушли|был|была|были|стал|стала|стали|нашли|ударили|собрали|пригласили|запустили|включили|закрыли|открыли|увидели|слышали|позвали|проверили|обсудили|выбрали|связали|отправили|оставили|передали|сохранили|записали|удалили|потеряли|показали|говорили|объяснили)$/iu.test(next);
      if (["его","ее","её","их"].includes(word) && possessiveNextLooksNominal &&
          !nextIsAdverb && !nextLooksVerb) return null;
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
    if (AMBIGUOUS_A_NAMES.has(head)) return { gender:"unknown", number:"singular" };
    if (/[оеё]$/u.test(head)) return { gender:"neuter", number:"singular" };
    if (MASCULINE_A_NAMES.has(head)) return { gender:"masculine", number:"singular" };
    if (/[ая]$/u.test(head)) return { gender:"feminine", number:"singular" };
    if (FEMININE_SOFT_SIGN.has(head)) return { gender:"feminine", number:"singular" };
    if (/[й]$/u.test(head) || /[бвгджзйклмнпрстфхцчшщ]$/u.test(head)) {
      return { gender:"masculine", number:"singular" };
    }
    return { gender:"unknown", number:"unknown" };
  }

  function semanticMorphology(value, syntacticRole, grammaticalCase, core) {
    if (!core || typeof core.grammaticalFeatures !== "function") return null;
    try {
      const features = core.grammaticalFeatures(value, syntacticRole, grammaticalCase || null);
      return features && typeof features === "object" ? features : null;
    } catch (_) {
      return null;
    }
  }

  function morphologyIdentity(value, features) {
    if (!features) return null;
    const words = normalise(value).split(" ").filter(Boolean);
    const head = words[words.length - 1] || "";
    if (words.length === 1 && (AMBIGUOUS_A_NAMES.has(head) || MASCULINE_A_NAMES.has(head))) return null;
    const gender = ["masculine","feminine","neuter","plural"].includes(features.gender)
      ? features.gender : "unknown";
    const number = ["singular","plural"].includes(features.number) ? features.number : "unknown";
    if (gender === "unknown" || number === "unknown" ||
        (gender === "plural") !== (number === "plural")) return null;
    const canonicalText = clean(features.canonicalText, 180) ||
      (features.grammaticalCase === "nominative" ? clean(value, 180) : "");
    const canonicalKey = normalise(canonicalText);
    if (!canonicalKey) return null;
    return {
      key: gender + "|" + number + "|" + canonicalKey,
      canonicalText,
      gender,
      number
    };
  }

  function candidateFeatures(candidate) {
    const words = normalise(candidate && candidate.text).split(" ").filter(Boolean);
    const head = words[words.length - 1] || "";
    if (words.length === 1 && AMBIGUOUS_A_NAMES.has(head)) return { gender:"unknown", number:"singular" };
    if (words.length === 1 && MASCULINE_A_NAMES.has(head)) return { gender:"masculine", number:"singular" };
    const inferred = inferFeatures(candidate && candidate.text);
    const semanticFeaturesAreAuthoritative = candidate && candidate.featureSource === "semantic_core";
    let gender = candidate && ["masculine","feminine","neuter","plural"].includes(candidate.gender)
      ? candidate.gender : semanticFeaturesAreAuthoritative ? "unknown" : inferred.gender;
    let number = candidate && ["singular","plural"].includes(candidate.number)
      ? candidate.number : semanticFeaturesAreAuthoritative ? "unknown" : inferred.number;
    if (!semanticFeaturesAreAuthoritative && number === "unknown" && candidate &&
        candidate.grammaticalCase === "nominative" &&
        /[ыи]$/u.test(normalise(candidate.text).split(" ").pop() || "")) number = "plural";
    if (number === "plural") gender = "plural";
    return { gender, number };
  }

  function compatible(mention, candidate) {
    const features = candidateFeatures(candidate);
    // Unknown gender or number is not positive evidence for a gendered/numbered
    // personal pronoun. Keep the candidate visible in diagnostics, but abstain.
    if (features.gender === "unknown" || features.number === "unknown") return false;
    if (!mention.genders.includes(features.gender)) return false;
    return features.number === mention.number;
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
    const expectedSemanticRoles = mention.grammaticalCase === "dative"
      ? ["recipient","beneficiary","indirect_object"]
      : mention.grammaticalCase === "instrumental"
        ? ["instrument","agent"]
        : mention.grammaticalCase === "prepositional"
          ? ["location","context"]
          : mention.grammaticalCase === "genitive_or_accusative" || mention.grammaticalCase === "genitive_or_instrumental"
            ? ["theme","patient","object","source","recipient"]
            : mention.syntacticRole === "subject"
              ? ["agent","experiencer","source","subject"] : ["theme","patient","recipient","instrument","source","object","beneficiary"];
    if (mention.syntacticRole === "subject") {
      score += syntacticRole === "subject" ? 0.45 : syntacticRole === "object" ? 0.18 : 0.28;
      if (expectedSemanticRoles.includes(semanticRole)) score += 0.35;
      reasons.push(syntacticRole === "subject" ? "subject_prominence" : "subject_role_weak");
    } else {
      score += syntacticRole === "object" ? 0.25 : syntacticRole === "subject" ? 0.1 : 0.18;
      if (expectedSemanticRoles.includes(semanticRole)) score += 0.65;
      reasons.push(expectedSemanticRoles.includes(semanticRole)
        ? "case_compatible_semantic_role" : "object_role_weak");
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
      .filter(candidate => !topicId || candidate.topicId === topicId)
      .filter(candidate => compatible(mention,candidate))
      .map(candidate => ({...candidate,...scoreCandidate(mention,candidate)}))
      .sort((a,b)=>b.score-a.score);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const margin = best ? Number((best.score - (second ? second.score : 0)).toFixed(4)) : 0;
    const minimumScore = Number.isFinite(Number(options.minimumScore)) ? Number(options.minimumScore) : 2.5;
    const minimumMargin = Number.isFinite(Number(options.minimumMargin)) ? Number(options.minimumMargin) : 0.5;
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
        turnDistance:Math.max(1,Number(best.turnDistance)||1),sentenceDistance:Math.max(0,Number(best.sentenceDistance)||0),
        identityBasis:best.identityBasis||"provided_candidate",
        surfaceForms:Array.isArray(best.surfaceForms)?best.surfaceForms.slice(0,8):[clean(best.text,180)]
      }:null,
      candidates:candidates.slice(0,5).map(row=>({
        id:row.id||null,text:clean(row.text,180),score:row.score,reasons:row.reasons,
        gender:row.features.gender,number:row.features.number,
        syntacticRole:row.syntacticRole||"unknown",semanticRole:row.semanticRole||row.role||"unknown",
        turnDistance:Math.max(1,Number(row.turnDistance)||1),
        identityBasis:row.identityBasis||"provided_candidate",
        surfaceForms:Array.isArray(row.surfaceForms)?row.surfaceForms.slice(0,8):[clean(row.text,180)]
      })),
      confidence,margin,reason,
      provenance:{source:"discourse_coreference",rule:"agreement_role_salience_recency",window:MAX_MESSAGES,
        candidateSource:"active_thread_messages",identityBasis:"exact_surface_or_guarded_morphological_lemma",
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
          const parserFeatures = semanticMorphology(text,syntacticRole,grammaticalCase,core);
          const identity = morphologyIdentity(text,parserFeatures);
          const nameWords = normalise(text).split(" ").filter(Boolean);
          const nameHead = nameWords[nameWords.length - 1] || "";
          const singleName = nameWords.length === 1;
          const inferred = parserFeatures
            ? {
                gender:singleName && AMBIGUOUS_A_NAMES.has(nameHead) ? "unknown"
                  : singleName && MASCULINE_A_NAMES.has(nameHead) ? "masculine"
                  : ["masculine","feminine","neuter","plural"].includes(parserFeatures.gender)
                    ? parserFeatures.gender : "unknown",
                number:singleName && (AMBIGUOUS_A_NAMES.has(nameHead) || MASCULINE_A_NAMES.has(nameHead)) ? "singular"
                  : ["singular","plural"].includes(parserFeatures.number)
                    ? parserFeatures.number : "unknown"
              }
            : inferFeatures(text);
          const argumentRole = clean(semanticRole,32)||syntacticRole;
          rows.push({
            id:"d"+messageIndex+"-"+propositionIndex+"-"+syntacticRole+"-"+key.replace(/\s+/gu,"-").slice(0,36),
            text,gender:inferred.gender,number:inferred.number,
            featureSource:parserFeatures?"semantic_core":"surface_heuristic",
            morphologyKey:identity&&identity.key||null,
            morphologyCanonicalText:identity&&identity.canonicalText||null,
            morphologyGender:identity&&identity.gender||null,
            morphologyNumber:identity&&identity.number||null,
            syntacticRole,semanticRole:argumentRole,
            grammaticalCase:grammaticalCase || parserFeatures&&parserFeatures.grammaticalCase || null,
            turnDistance:messages.length-messageIndex,
            sentenceDistance:propositions.length-propositionIndex-1,
            topicId:clean(message.threadId,80),
            sourceRole:message.role==="user"?"user":"assistant",
            salience:syntacticRole==="subject"?0.9:0.55,
            mentionCount:1,
            messageIndex
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

    // First preserve the old exact-surface clusters. A surface cluster is eligible
    // for morphology only when every occurrence has the same trusted, unambiguous
    // parser identity; mixed/unknown morphology blocks automatic merging.
    const grouped = new Map();
    for (const row of rows) {
      const key = row.topicId+"|"+normalise(row.text);
      const prior = grouped.get(key);
      if (!prior) {
        grouped.set(key,{
          ...row,mentionCount:1,
          _messageIndexes:new Set([row.messageIndex]),
          _surfaceForms:new Set([row.text]),
          _morphologyKey:row.morphologyKey,
          _morphologyIdentity:row.morphologyKey?{
            key:row.morphologyKey,
            canonicalText:row.morphologyCanonicalText,
            gender:row.morphologyGender,
            number:row.morphologyNumber
          }:null,
          _morphologyInvalid:!row.morphologyKey
        });
      } else {
        prior.mentionCount++;
        prior._messageIndexes.add(row.messageIndex);
        prior._surfaceForms.add(row.text);
        prior.turnDistance = Math.min(prior.turnDistance,row.turnDistance);
        prior.sentenceDistance = Math.min(prior.sentenceDistance,row.sentenceDistance);
        if (!row.morphologyKey || prior._morphologyKey !== row.morphologyKey) {
          prior._morphologyInvalid = true;
        }
        if (row.salience>prior.salience) {
          prior.salience=row.salience;
          prior.syntacticRole=row.syntacticRole;
          prior.semanticRole=row.semanticRole;
        }
      }
    }

    const surfaceGroups = [...grouped.values()];
    const morphologyBuckets = new Map();
    for (const group of surfaceGroups) {
      if (group._morphologyInvalid || !group._morphologyIdentity) continue;
      const bucketKey = group.topicId + "|" + group._morphologyKey;
      const bucket = morphologyBuckets.get(bucketKey) || [];
      bucket.push(group);
      morphologyBuckets.set(bucketKey,bucket);
    }

    // Merge distinct inflections only when the same lemma is never represented
    // by two different surface forms in one message. If co-occurrence suggests
    // two separate referents (or a parser ambiguity), keep both candidates.
    const replacements = new Map();
    const skipped = new Set();
    for (const bucket of morphologyBuckets.values()) {
      if (bucket.length < 2) continue;
      let collision = false;
      for (let left=0;left<bucket.length && !collision;left++) {
        for (let right=left+1;right<bucket.length && !collision;right++) {
          for (const index of bucket[left]._messageIndexes) {
            if (bucket[right]._messageIndexes.has(index)) {
              collision = true;
              break;
            }
          }
        }
      }
      if (collision) continue;
      const first = bucket[0];
      const identity = first._morphologyIdentity;
      const merged = {
        ...first,
        text:identity.canonicalText || first.text,
        gender:identity.gender,
        number:identity.number,
        mentionCount:bucket.reduce((sum,row)=>sum+row.mentionCount,0),
        turnDistance:Math.min(...bucket.map(row=>row.turnDistance)),
        sentenceDistance:Math.min(...bucket.map(row=>row.sentenceDistance)),
        identityBasis:"morphological_lemma",
        surfaceForms:[...new Set(bucket.flatMap(row=>[...row._surfaceForms]))]
      };
      for (const group of bucket) {
        for (const index of group._messageIndexes) merged._messageIndexes.add(index);
        if (group.salience>merged.salience) {
          merged.salience=group.salience;
          merged.syntacticRole=group.syntacticRole;
          merged.semanticRole=group.semanticRole;
        }
      }
      replacements.set(first,merged);
      for (const group of bucket.slice(1)) skipped.add(group);
    }

    const output = [];
    for (const group of surfaceGroups) {
      if (skipped.has(group)) continue;
      const selected = replacements.get(group) || group;
      const surfaceForms = selected.surfaceForms || [...selected._surfaceForms];
      output.push({
        id:selected.id,
        text:selected.text,
        gender:selected.gender,
        number:selected.number,
        featureSource:selected.featureSource,
        syntacticRole:selected.syntacticRole,
        semanticRole:selected.semanticRole,
        grammaticalCase:selected.grammaticalCase,
        turnDistance:selected.turnDistance,
        sentenceDistance:selected.sentenceDistance,
        topicId:selected.topicId,
        sourceRole:selected.sourceRole,
        salience:selected.salience,
        mentionCount:selected.mentionCount,
        identityBasis:selected.identityBasis || "surface_form",
        surfaceForms:surfaceForms.slice(0,8)
      });
    }
    return output.slice(-MAX_CANDIDATES);
  }

  function resolveFromHistory(query, messages, core, options = {}) {
    const mention = detectMention(query);
    if (!mention) return resolveMention(null,[],options);
    const topicId = clean(options.topicId,80);
    const scopedMessages = topicId
      ? (Array.isArray(messages) ? messages.filter(message => message && clean(message.threadId,80) === topicId) : [])
      : messages;
    const rows = extractCandidates(scopedMessages,core);
    return resolveMention(mention,rows,{...options,topicId});
  }

  window.NGDiscourseCoreference = Object.freeze({
    version:1,schema:SCHEMA,detectMention,inferFeatures,extractCandidates,
    resolveMention,resolveFromHistory
  });
})();