(() => {
  "use strict";

  const SCHEMA = "NG_SEMANTIC_FRAME_V1";
  const ANSWER_TYPES = Object.freeze([
    "quantity", "time", "location", "person", "boolean",
    "definition", "causal", "procedure", "comparison", "description"
  ]);
  const INTENTS = Object.freeze([
    "factual_question", "explanation_request", "comparison_request",
    "causal_question", "instruction_request", "memory_query",
    "statement", "conversation"
  ]);
  const ATTRIBUTE_HEAD = /(?:серд|камер|ног|лап|глаз|пальц|зуб|крыл|плавник|сосуд|нейрон|синапс|связ|человек|особ|клет|час|день|сутк|минут|раз|штук|вид|сторон|метр|килограмм|литр|процент)/iu;
  const PRONOUN_SUBJECT = /^(?:него|неё|нее|них|этого|этой|этих|он|она|они|это|там|тогда|его|ее|её)$/iu;

  const clean = (value, max = 240) =>
    String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, max);
  const normalise = (value, knowledge) =>
    knowledge && typeof knowledge.normalise === "function"
      ? knowledge.normalise(value)
      : clean(value, 1600).normalize("NFKC").toLowerCase()
        .replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ")
        .trim().replace(/\s+/g, " ");
  const tokens = (value, knowledge) => {
    const values = knowledge && typeof knowledge.tokens === "function"
      ? knowledge.tokens(value)
      : normalise(value, knowledge).split(" ").filter(word => word.length >= 3);
    return [...new Set((Array.isArray(values) ? values : [])
      .filter(word => typeof word === "string" && word.length >= 2))].slice(0, 32);
  };

  function answerType(value, knowledge) {
    const query = normalise(value, knowledge);
    if (/(?:^|\s)(?:сколько|скольк[а-яё]*|как много|какое количество|каково количество|количеств[а-яё]*|число|численност[а-яё]*)(?:\s|$)/u.test(query)) return "quantity";
    if (/(?:^|\s)(?:когда|во сколько|какого числа|в каком году|в какой день|дата|с какого года)(?:\s|$)/u.test(query)) return "time";
    if (/(?:^|\s)(?:где|куда|откуда|в каком городе|в какой стране|где расположен[а-яё]*|где находится)(?:\s|$)/u.test(query)) return "location";
    if (/(?:^|\s)(?:кто такой|кто такая|кто такие|чей|чья|чьё|чье)(?:\s|$)/u.test(query)) return "person";
    if (/(?:^|\s)(?:правда ли|верно ли|можно ли|есть ли|существует ли)(?:\s|$)/u.test(query)) return "boolean";
    if (/(?:^|\s)(?:что такое|что значит|что означает|что представляет собой|определение)(?:\s|$)/u.test(query)) return "definition";
    if (/(?:^|\s)(?:почему|зачем|по какой причине|из-за чего|отчего)(?:\s|$)/u.test(query)) return "causal";
    if (/(?:^|\s)(?:как сделать|как настроить|как установить|как использовать|как подключить|как собрать|как создать)(?:\s|$)/u.test(query)) return "procedure";
    if (/(?:^|\s)(?:сравни|чем отличается|в чем разница|в чём разница|разница между|что лучше)(?:\s|$)/u.test(query)) return "comparison";
    return "description";
  }

  function intentType(value, type) {
    const query = clean(value, 800);
    const normal = normalise(query);
    if (/(?:^|\s)(?:объясни|расскажи|опиши|поясни|разъясни)(?:\s|$)/u.test(normal)) return "explanation_request";
    if (type === "comparison") return "comparison_request";
    if (type === "causal") return "causal_question";
    if (type === "procedure") return "instruction_request";
    if (/(?:^|\s)(?:покажи|найди|вспомни|что ты помнишь|что сохранено)(?:\s|$)/u.test(normal)) return "memory_query";
    if (/[?？]/u.test(query) || /^(?:кто|что|где|куда|откуда|когда|сколько|почему|зачем|как|какой|какая|какие|какое|чей|чья)\b/iu.test(query)) return "factual_question";
    return normal.length < 3 ? "conversation" : "statement";
  }

  function splitQuantityTail(value) {
    const words = clean(value, 300).split(/\s+/u).filter(Boolean);
    if (words.length < 2) return { subject: "", attribute: words.join(" ") };
    const headIndex = words.findIndex((word, index) => index > 0 && ATTRIBUTE_HEAD.test(word));
    if (headIndex > 0) {
      return {
        subject: clean(words.slice(0, headIndex).join(" "), 160),
        attribute: clean(words.slice(headIndex).join(" "), 120)
      };
    }
    return {
      subject: clean(words.slice(0, -1).join(" "), 160),
      attribute: clean(words[words.length - 1], 120)
    };
  }

  function stripAttributeNoise(value) {
    return clean(value, 180)
      .replace(/^(?:всего|примерно|около|именно)\s+/iu, "")
      .replace(/\s+(?:имеется|имеют|имеет|насчитывается|насчитывают|содержит|содержат|всего)$/iu, "")
      .replace(/[,:;]+$/u, "").trim();
  }

  function surfaceSlots(value) {
    const text = clean(value, 800).replace(/^(?:(?:а|и|ну|так|но)\s+)+/iu, "")
      .replace(/[?!.…]+$/u, "")
      .replace(/[—–]/gu, " ").replace(/[,;:]+/gu, " ").replace(/\s+/gu, " ").trim();
    const action = "(?:(?:пожалуйста|подскажи|назови|скажи|укажи|определи|уточни)\\s+)*";
    let match;

    // Canonical order: "Сколько сердец у осьминога?"
    match = text.match(new RegExp("^" + action + "(?:сколько|как много|какое количество|каково количество|каков[ао]?)\\s+(.+?)\\s+(?:у|для)\\s+(.+)$", "iu"));
    if (match) return { subject: clean(match[2], 160), attribute: stripAttributeNoise(match[1]), relation: "has" };

    // Verb-medial order: "Сколько сердец имеет осьминог?"
    match = text.match(/^(?:сколько|как много|какое количество)\s+(.+?)\s+(?:имеет|насчитывает|содержит|обладает)\s+(.+)$/iu);
    if (match) return { subject: clean(match[2], 160), attribute: stripAttributeNoise(match[1]), relation: "has" };

    // Short pronoun-only follow-ups inherit subject and attribute from the active turn.
    match = text.match(/^у\s+(него|неё|нее|них|этого|этой|этих)\s+(?:сколько|как много|какое количество)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: "", relation: "has" };

    match = text.match(/^(?:сколько|как много|какое количество)\s+у\s+(него|неё|нее|них|этого|этой|этих)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: "", relation: "has" };

    // Inverted order: "У осьминога сколько сердец?"
    match = text.match(/^у\s+(.+?)\s+(?:сколько|как много|какое количество)\s+(.+)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: stripAttributeNoise(match[2]), relation: "has" };

    // Elliptical order: "Сколько у осьминога сердечных камер?"
    match = text.match(/^(?:сколько|как много|какое количество)\s+у\s+(.+?)\s+(.+)$/iu);
    if (match) {
      const split = splitQuantityTail(match[1] + " " + match[2]);
      return { subject: split.subject, attribute: stripAttributeNoise(split.attribute), relation: "has" };
    }

    // Postposed interrogative: "Сердец у осьминога сколько?"
    match = text.match(/^(.+?)\s+у\s+(.+?)\s+(?:сколько|как много|какое количество)$/iu);
    if (match) return { subject: clean(match[2], 160), attribute: stripAttributeNoise(match[1]), relation: "has" };

    // "Число сердечных камер головоногого" and related formulations.
    match = text.match(new RegExp("^" + action + "(?:(?:каково|какова|каков)\\s+)?(?:число|количество|численность)\\s+(.+)$", "iu"));
    if (match) {
      const withPreposition = match[1].match(/^(.+?)\s+(?:у|для|среди)\s+(.+)$/iu);
      if (withPreposition) return { subject: clean(withPreposition[2], 160), attribute: stripAttributeNoise(withPreposition[1]), relation: "has" };
      const words = clean(match[1], 300).split(/\s+/u).filter(Boolean);
      if (words.length > 1) return {
        subject: clean(words[words.length - 1], 160),
        attribute: stripAttributeNoise(words.slice(0, -1).join(" ")),
        relation: "has"
      };
      return { subject: "", attribute: stripAttributeNoise(match[1]), relation: "has" };
    }

    // "Какое у осьминога количество сердец?"
    match = text.match(/^(?:каково|какова|какое)\s+у\s+(.+?)\s+(?:число|количество)\s+(.+)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: stripAttributeNoise(match[2]), relation: "has" };

    match = text.match(/^(?:что такое|кто такой|кто такая|кто такие|что значит|что означает|что представляет собой)\s+(.+)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: "", relation: "is_a" };

    match = text.match(/^(?:как работает|как устроен|как устроена|как устроено|как устроены|как действует)\s+(.+)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: "mechanism", relation: "works" };

    match = text.match(/^(?:где находится|где расположен|где расположена|когда произошло|когда появился|почему|зачем)\s+(.+)$/iu);
    if (match) return { subject: clean(match[1], 160), attribute: "", relation: "about" };

    match = text.match(/(?:столица|население|возраст|автор|причина|цена|скорость|дата|площадь|высота)\s+(.+)$/iu);
    if (match) {
      const attribute = (text.match(/(?:столица|население|возраст|автор|причина|цена|скорость|дата|площадь|высота)/iu) || [])[0] || "";
      return { subject: clean(match[1], 160), attribute, relation: "has_attribute" };
    }

    match = text.match(/^(?:сколько|скольк[а-яё]*|как много|какое количество)\s+(.+)$/iu);
    if (match) return { subject: "", attribute: stripAttributeNoise(match[1]), relation: "has" };

    return { subject: "", attribute: "", relation: "" };
  }


  const PROPOSITION_KINDS = Object.freeze([
    "assertion", "hypothesis", "opinion", "question",
    "request", "conditional", "reported", "fragment"
  ]);

  function temporalSignal(text) {
    const patterns = [
      [/(?:позавчера|вчера|на прошлой неделе|в прошлом году|в прошлом месяце|раньше|ранее|до этого|в прошлом|был[аои]?|произош[её]л ранее)/iu, "past"],
      [/(?:завтра|послезавтра|на следующей неделе|в следующем году|в будущем|позже)/iu, "future"],
      [/(?:сегодня|сейчас|теперь|в настоящее время|в этом году|в этом месяце|на данный момент)/iu, "present"],
      [/(?:с\s+\d{4}\s+года|начиная с\s+\d{4})/iu, "since"]
    ];
    for (const [pattern, relation] of patterns) {
      const match = text.match(pattern);
      if (match) return { expression: clean(match[0], 100), relation };
    }
    return { expression: null, relation: "unspecified" };
  }

  function polarityScopeSignal(value) {
    const text = normalise(value);
    const neutral = {
      scope: "none", quantifier: "unspecified", effect: "none",
      polarity: "positive", confidence: 0.35
    };
    if (!text) return neutral;

    const notAll = text.match(/\bне\s+(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую)\b/u);
    if (notAll) {
      const tail = text.slice(notAll.index + notAll[0].length);
      if (/\bне\b/u.test(tail)) {
        return { scope: "ambiguous", quantifier: "all", effect: "ambiguous",
          polarity: "unknown", confidence: 0.62 };
      }
      return { scope: "quantifier", quantifier: "all", effect: "not_all",
        polarity: "mixed", confidence: 0.76 };
    }

    const none = text.match(/\bни\s+(?:один|одна|одно|одни|одного|одной|одному|одну)\b/u);
    if (none && /\bне\b/u.test(text.slice(none.index + none[0].length))) {
      return { scope: "quantifier", quantifier: "none", effect: "none_negative",
        polarity: "negative", confidence: 0.78 };
    }

    const notAlways = text.match(/\bне\s+всегда\b/u);
    if (notAlways) {
      const tail = text.slice(notAlways.index + notAlways[0].length);
      if (/\bне\b/u.test(tail)) {
        return { scope: "ambiguous", quantifier: "always", effect: "ambiguous",
          polarity: "unknown", confidence: 0.60 };
      }
      return { scope: "temporal", quantifier: "always", effect: "not_always",
        polarity: "mixed", confidence: 0.76 };
    }
    if (/\bвсегда\s+не\b/u.test(text)) {
      return { scope: "temporal", quantifier: "always", effect: "always_negative",
        polarity: "negative", confidence: 0.76 };
    }

    const all = text.match(/\b(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую)\b/u);
    if (all && /\bне\b/u.test(text.slice(all.index + all[0].length))) {
      return { scope: "quantifier", quantifier: "all", effect: "all_negative",
        polarity: "negative", confidence: 0.72 };
    }
    if (/\bне\b/u.test(text)) {
      return { scope: "predicate", quantifier: "unspecified", effect: "negative",
        polarity: "negative", confidence: 0.74 };
    }
    return neutral;
  }

  function cleanQuantifiedSubject(value) {
    return clean(value, 180)
      .replace(/^(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую|ни\s+(?:один|одна|одно|одни|одного|одной|одному|одну))\s+/iu, "")
      .trim();
  }

  function extractProposition(value, intent = "conversation", slots = {}) {
    const original = clean(value, 800);
    const text = original.replace(/[?!.…]+$/u, "").trim();
    const temporal = temporalSignal(original);
    const polarityScope = polarityScopeSignal(original);
    const base = {
      kind: "fragment", subject: "", predicate: "", object: "",
      relation: "", polarity: polarityScope.polarity, polarityScope, modality: "unknown",
      temporal, attribution: { speaker: "user", source: "user_utterance", reportedBy: "" },
      confidence: 0.28
    };
    if (!text) return base;

    const questionIntent = [
      "factual_question", "explanation_request", "comparison_request",
      "causal_question", "instruction_request", "memory_query"
    ].includes(intent);
    const requestPrefix = /^(?:пожалуйста\s+)?(?:подскажи|назови|скажи|укажи|определи|уточни|объясни|расскажи|опиши|покажи|найди|вспомни|сделай|создай|сравни|рассчитай|перечисли)(?=$|\s|[,.:!?])/iu;
    if (requestPrefix.test(text)) {
      return { ...base, kind: "request", modality: "directive", confidence: 0.72 };
    }
    if (/[?？]/u.test(original) || questionIntent) {
      return {
        ...base, kind: "question",
        subject: clean(slots.subject, 180),
        object: clean(slots.attribute, 180),
        modality: "interrogative", confidence: 0.78
      };
    }

    const quoted = text.match(/^[«“"](.+)[»”"]$/u);
    if (quoted) {
      return {
        ...base, kind: "reported", object: clean(quoted[1], 360),
        modality: "quoted", attribution: { speaker: "unknown", source: "quoted_text", reportedBy: "" },
        confidence: 0.58
      };
    }

    let match = text.match(/^(?:по словам\s+(.+?),?\s+)?(.+?)\s+(сказал|сказала|сказали|сообщил|сообщила|сообщили|утверждает|утверждают|говорит|говорят|пишет|заявил|заявила),?\s+что\s+(.+)$/iu);
    if (match) {
      return {
        ...base, kind: "reported", subject: clean(match[2], 180),
        predicate: clean(match[3], 80), object: clean(match[4], 240),
        modality: "reported",
        attribution: { speaker: "unknown", source: "reported_speech", reportedBy: clean(match[2], 180) },
        confidence: 0.76
      };
    }
    match = text.match(/^(?:(?:в отч[её]те|в исследовании|в статье)\s+(?:говорится|сообщается|указывается|отмечается)|(?:по данным источника|сообщается|говорится|указывается)),?\s+(?:что\s+)?(.+)$/iu);
    if (match) {
      return {
        ...base, kind: "reported", object: clean(match[1], 320),
        modality: "reported",
        attribution: { speaker: "unknown", source: "source_attributed", reportedBy: "external_source" },
        confidence: 0.64
      };
    }

    let opinionText = text;
    const opinion = text.match(/^(?:я думаю|я считаю|мне кажется|по-моему|по моему мнению|на мой взгляд),?\s*(?:что\s+)?(.+)$/iu);
    if (opinion) opinionText = opinion[1];

    const conditional = /(?:^|\s)если\s+/iu.test(opinionText);
    const possiblePrefix = /^(?:возможно|вероятно|предположительно|может быть),?\s*/iu;
    const explicitPossible = possiblePrefix.test(opinionText);
    const statement = opinionText.replace(possiblePrefix, "");
    const temporalWithoutPrefix = temporal.expression
      ? statement.replace(temporal.expression, "").replace(/^\s*[,—–-]\s*/u, "").trim()
      : statement;
    if (polarityScope.effect === "ambiguous") {
      return { ...base, kind: "fragment", polarity: "unknown", modality: "unknown", confidence: 0.32 };
    }
    const propositionText = temporalWithoutPrefix
      .replace(/^не\s+(?=(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую)\b)/iu, "")
      .replace(/\bне\s+всегда\s+/u, "")
      .replace(/\bвсегда\s+не\s+/u, "");

    const causal = propositionText.match(/^(.+?)\s+(?:(может|могут|способен|способна|способны)\s+)?(не\s+)?(приводит|приводят|приводить|вызывает|вызывают|влияет|влияют|повышает|повышают|снижает|снижают|уменьшает|уменьшают|увеличивает|увеличивают)\s+(к|на|от|в|из-за)\s+(.+)$/iu);
    if (causal) {
      const modality = causal[2] ? "possible" : explicitPossible ? "possible" : "asserted";
      return {
        ...base, kind: conditional ? "conditional" : opinion ? "opinion" : (modality === "possible" ? "hypothesis" : "assertion"),
        subject: cleanQuantifiedSubject(causal[1]),
        predicate: clean(causal[4] + " " + causal[5], 100),
        object: clean(causal[6], 220), relation: "causal",
        polarity: polarityScope.scope !== "none" ? polarityScope.polarity : causal[3] ? "negative" : "positive",
        polarityScope,
        modality: conditional ? "conditional" : opinion ? "opinion" : modality,
        confidence: 0.82,
        attribution: opinion
          ? { speaker: "user", source: "user_opinion", reportedBy: "user" }
          : base.attribution
      };
    }

    match = propositionText.match(/^у\s+(.+?)\s+(?:(есть|имеется|имеются)\s+)?(.+)$/iu);
    if (match) {
      return {
        ...base, kind: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "hypothesis" : "assertion",
        subject: clean(match[1], 180), predicate: "имеет", object: clean(match[3], 220),
        relation: "has", modality: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "possible" : "asserted",
        confidence: 0.72,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

    match = propositionText.match(/^(.+?)\s+(?:(может|могут|должен|должна|должны|обязан|обязана)\s+)?(не\s+)?(имеет|имеют|содержит|содержат|включает|включают|находится|находятся|расположен|расположена|расположено|расположены|активируется|активируются|работает|работают|работал|работала|работало|работали|существует|существуют|состоит|состоят|является|являются|обладает|обладают|поддерживает|поддерживают|использует|используют|создаёт|создает|создают|живу|живёт|живет|живут|был|была|было|были|станет|станут)(?:\s+(.+))?$/iu);
    if (match) {
      const modal = clean(match[2], 40);
      const predicate = clean(match[4], 80);
      const modality = modal === "может" || modal === "могут" ? "possible"
        : modal ? "necessary" : explicitPossible ? "possible" : "asserted";
      return {
        ...base,
        kind: conditional ? "conditional" : opinion ? "opinion" : modality === "possible" ? "hypothesis" : "assertion",
        subject: cleanQuantifiedSubject(match[1]), predicate, object: clean(match[5], 220),
        relation: /^(?:имеет|имеют|содержит|содержат|включает|включают)$/iu.test(predicate) ? "has" : "predicate",
        polarity: polarityScope.scope !== "none" ? polarityScope.polarity : match[3] ? "negative" : "positive",
        polarityScope,
        modality: conditional ? "conditional" : opinion ? "opinion" : modality,
        confidence: 0.74,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

    match = temporalWithoutPrefix.match(/^(.+?)\s+(?:это|—|–|:)\s+(.+)$/u);
    if (match) {
      return {
        ...base, kind: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "hypothesis" : "assertion",
        subject: clean(match[1], 180), predicate: "является", object: clean(match[2], 220),
        relation: "is_a", modality: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "possible" : "asserted",
        confidence: 0.62,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

    return {
      ...base,
      kind: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "hypothesis" : "fragment",
      modality: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "possible" : "unknown",
      attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
    };
  }

  function validateProposition(raw, fallback = {}) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};
    const part = (value, max = 220) => typeof value === "string" ? clean(value, max) : "";
    const baseKind = PROPOSITION_KINDS.includes(base.kind) ? base.kind : null;
    const sourceKind = PROPOSITION_KINDS.includes(source.kind) ? source.kind : null;
    const baseConfidence = Number(base.confidence);
    const preserveLocalSpeechAct = !!baseKind &&
      ["hypothesis", "opinion", "question", "request", "conditional", "reported"].includes(baseKind) &&
      Number.isFinite(baseConfidence) && baseConfidence >= 0.58;
    // A confident local speech-act signal is a safety boundary, not a suggestion
    // the model may silently rewrite as a user assertion.
    const kind = preserveLocalSpeechAct ? baseKind : sourceKind || baseKind || "fragment";
    const validPolarities = ["positive", "negative", "mixed", "unknown"];
    const sourcePolarity = validPolarities.includes(source.polarity) ? source.polarity : null;
    const basePolarity = validPolarities.includes(base.polarity) ? base.polarity : null;
    const validScopeKinds = ["none", "predicate", "quantifier", "temporal", "ambiguous"];
    const validQuantifiers = ["unspecified", "all", "none", "always", "unknown"];
    const validScopeEffects = ["none", "negative", "not_all", "all_negative",
      "none_negative", "not_always", "always_negative", "ambiguous"];
    const validScope = value => value && typeof value === "object" &&
      validScopeKinds.includes(value.scope) && validQuantifiers.includes(value.quantifier) &&
      validScopeEffects.includes(value.effect)
      ? { scope: value.scope, quantifier: value.quantifier, effect: value.effect }
      : null;
    const basePolarityScope = validScope(base.polarityScope);
    const sourcePolarityScope = validScope(source.polarityScope);
    const preserveLocalPolarityScope = !!basePolarityScope && basePolarityScope.scope !== "none" &&
      Number.isFinite(baseConfidence) && baseConfidence >= 0.58;
    const polarityScope = preserveLocalPolarityScope ? basePolarityScope
      : sourcePolarityScope || basePolarityScope ||
        { scope: "none", quantifier: "unspecified", effect: "none" };
    const preserveNegativePolarity = basePolarity === "negative" &&
      Number.isFinite(baseConfidence) && baseConfidence >= 0.58;
    const preserveScopedPolarity = preserveLocalPolarityScope &&
      ["negative", "mixed", "unknown"].includes(basePolarity);
    const polarity = preserveScopedPolarity ? basePolarity
      : preserveNegativePolarity ? "negative" : sourcePolarity || basePolarity || "unknown";
    const validModalities = ["asserted", "possible", "necessary", "conditional", "opinion",
      "reported", "quoted", "interrogative", "directive", "unknown"];
    const sourceModality = validModalities.includes(source.modality) ? source.modality : null;
    const baseModality = validModalities.includes(base.modality) ? base.modality : null;
    const modality = preserveLocalSpeechAct
      ? baseModality || sourceModality || "unknown"
      : sourceModality || baseModality || "unknown";
    const baseTemporal = base.temporal && typeof base.temporal === "object" ? base.temporal : {};
    const sourceTemporal = source.temporal && typeof source.temporal === "object" ? source.temporal : {};
    const temporal = preserveLocalSpeechAct && baseTemporal.expression
      ? baseTemporal : Object.keys(sourceTemporal).length ? sourceTemporal : baseTemporal;
    const baseAttribution = base.attribution && typeof base.attribution === "object" ? base.attribution : {};
    const sourceAttribution = source.attribution && typeof source.attribution === "object" ? source.attribution : {};
    const attribution = preserveLocalSpeechAct && Object.keys(baseAttribution).length
      ? baseAttribution : Object.keys(sourceAttribution).length ? sourceAttribution : baseAttribution;
    const confidenceValue = Number(source.confidence ?? base.confidence);
    const assertionStatus = kind === "assertion" ? "asserted"
      : kind === "hypothesis" ? "hypothetical"
      : kind === "opinion" ? "opinion"
      : kind === "reported" ? "reported"
      : kind === "question" ? "question"
      : kind === "request" ? "request"
      : kind === "conditional" ? "conditional" : "incomplete";
    return {
      schema: "NG_PROPOSITION_FRAME_V1",
      kind,
      subject: part(source.subject || base.subject, 180) || null,
      predicate: part(source.predicate || base.predicate, 100) || null,
      object: part(source.object || base.object, 220) || null,
      relation: part(source.relation || base.relation, 64) || null,
      polarity,
      polarityScope,
      modality,
      temporal: {
        expression: part(temporal.expression, 100) || null,
        relation: ["past", "present", "future", "since", "unspecified"].includes(temporal.relation)
          ? temporal.relation : "unspecified"
      },
      attribution: {
        speaker: ["user", "assistant", "unknown"].includes(attribution.speaker) ? attribution.speaker : "unknown",
        source: ["user_utterance", "user_opinion", "assistant_output", "reported_speech",
          "source_attributed", "quoted_text", "unknown"].includes(attribution.source)
          ? attribution.source : "unknown",
        reportedBy: part(attribution.reportedBy, 120) || null
      },
      assertionStatus,
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.25
    };
  }

  function validateFrame(raw, fallback = {}, knowledge = null) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};
    const part = value => typeof value === "string" ? clean(value, 180)
      : value && typeof value === "object" ? clean(value.text || value.label || "", 180) : "";
    const rawSubject = part(source.subject);
    const rawAttribute = part(source.attribute);
    const subject = rawSubject || part(base.subject);
    const attribute = rawAttribute || part(base.attribute);
    const type = ANSWER_TYPES.includes(source.answerType) ? source.answerType
      : ANSWER_TYPES.includes(base.answerType) ? base.answerType : "description";
    const intent = INTENTS.includes(source.intent) ? source.intent
      : INTENTS.includes(base.intent) ? base.intent : "factual_question";
    const discourse = source.discourse && typeof source.discourse === "object" ? source.discourse : {};
    const relation = ["new_topic", "follow_up", "same_topic", "unclear"].includes(discourse.relation)
      ? discourse.relation
      : ["new_topic", "follow_up", "same_topic", "unclear"].includes(base.discourseRelation)
        ? base.discourseRelation : "unclear";
    const entities = [];
    for (const entity of (Array.isArray(source.entities) ? source.entities : []).slice(0, 8)) {
      const text = part(entity);
      if (text && !entities.some(item => normalise(item.text, knowledge) === normalise(text, knowledge))) {
        entities.push({
          text,
          role: entity && typeof entity === "object" && ["subject", "object", "attribute", "context"].includes(entity.role)
            ? entity.role : "object",
          certainty: "model_candidate"
        });
      }
    }
    if (subject && !entities.some(item => normalise(item.text, knowledge) === normalise(subject, knowledge))) {
      entities.unshift({
        text: subject,
        role: "subject",
        certainty: rawSubject ? "model_candidate" : base.resolvedFrom ? "context_candidate" : "heuristic_candidate"
      });
    }
    // The subject has priority, but the complete frame must still respect the eight-entity cap.
    if (entities.length > 8) entities.length = 8;
    const suppliedConcepts = Array.isArray(source.concepts) ? source.concepts : [];
    const concepts = [...new Set([...suppliedConcepts, ...tokens(subject + " " + attribute, knowledge)]
      .map(item => clean(item, 64)).filter(Boolean))].slice(0, 24);
    const constraints = source.constraints && typeof source.constraints === "object" ? source.constraints : {};
    const number = Number(source.confidence);
    const confidence = Number.isFinite(number) ? Math.max(0, Math.min(1, number))
      : Number.isFinite(Number(base.confidence)) ? Math.max(0, Math.min(1, Number(base.confidence))) : 0.35;

    return {
      schema: SCHEMA,
      version: 1,
      intent,
      answerType: type,
      subject: subject ? {
        text: subject,
        certainty: rawSubject ? "model_candidate" : base.resolvedFrom ? "context_candidate" : "heuristic_candidate"
      } : null,
      attribute: attribute ? {
        text: attribute,
        certainty: rawAttribute ? "model_candidate" : "heuristic_candidate"
      } : null,
      relation: clean(source.relation || base.relation, 64) || null,
      proposition: validateProposition(source.proposition, base.proposition),
      entities,
      concepts,
      constraints: {
        polarity: constraints.polarity === "negative" ? "negative" : "positive",
        temporal: clean(constraints.temporal, 80) || null
      },
      discourse: {
        relation,
        resolvedFrom: clean(discourse.resolvedFrom || base.resolvedFrom, 180) || null
      },
      confidence,
      provenance: source.provenance === "model" ? "model" : "heuristic"
    };
  }

  function analyse(value, options = {}, knowledge = null) {
    const text = clean(value, 800);
    const type = answerType(text, knowledge);
    const intent = intentType(text, type);
    const slots = surfaceSlots(text);
    const relation = ["new_topic", "follow_up", "same_topic", "unclear"].includes(options.contextRelation)
      ? options.contextRelation : "unclear";
    let subject = slots.subject;
    let attribute = slots.attribute;
    let resolvedFrom = "";
    const contextText = clean(options.contextText, 500);

    if (relation === "follow_up" && contextText &&
        (!subject || PRONOUN_SUBJECT.test(normalise(subject, knowledge)))) {
      const inherited = surfaceSlots(contextText);
      subject = inherited.subject || clean(contextText, 160);
      attribute = attribute || inherited.attribute;
      resolvedFrom = contextText;
    } else if (relation === "follow_up" && subject && contextText) {
      resolvedFrom = contextText;
    }

    const frame = validateFrame({}, {
      intent,
      answerType: type,
      subject,
      attribute,
      relation: slots.relation,
      discourseRelation: relation,
      resolvedFrom,
      proposition: extractProposition(text, intent, slots),
      confidence: 0.56
    }, knowledge);
    frame.provenance = "heuristic";
    frame.entities = subject ? [{
      text: subject,
      role: "subject",
      certainty: resolvedFrom ? "context_candidate" : "heuristic_candidate"
    }] : [];
    frame.concepts = [...new Set(tokens(text + " " + subject + " " + attribute, knowledge))].slice(0, 24);
    frame.constraints.polarity = /(?:^|\s)(?:не|никогда|ни)(?:\s|$)/u.test(normalise(text, knowledge))
      ? "negative" : "positive";
    return frame;
  }

  function toSearchQueries(frame) {
    const value = frame && typeof frame === "object" ? frame : {};
    const subject = value.subject && clean(value.subject.text || value.subject, 180);
    const attribute = value.attribute && clean(value.attribute.text || value.attribute, 120);
    const concepts = Array.isArray(value.concepts)
      ? value.concepts.map(item => clean(item, 64)).filter(Boolean) : [];
    return [...new Set([
      subject && attribute ? subject + " " + attribute : "",
      attribute && subject ? attribute + " " + subject : "",
      subject || "",
      attribute || "",
      concepts.join(" ")
    ].map(item => clean(item, 300)).filter(Boolean))].slice(0, 6);
  }

  window.NGSemanticCore = Object.freeze({
    version: 3,
    schema: SCHEMA,
    answerTypes: ANSWER_TYPES,
    intents: INTENTS,
    normalise,
    tokens,
    answerType,
    intentType,
    surfaceSlots,
    extractProposition,
    validateProposition,
    analyse,
    validateFrame,
    toSearchQueries
  });
})();