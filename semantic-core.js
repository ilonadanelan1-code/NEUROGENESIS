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
    if (/(?:^|\s)(?:сколько|скольк\w*|как много|какое количество|каково количество|количеств\w*|число|численност\w*)(?:\s|$)/u.test(query)) return "quantity";
    if (/(?:^|\s)(?:когда|во сколько|какого числа|в каком году|в какой день|дата|с какого года)(?:\s|$)/u.test(query)) return "time";
    if (/(?:^|\s)(?:где|куда|откуда|в каком городе|в какой стране|где расположен\w*|где находится)(?:\s|$)/u.test(query)) return "location";
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

    match = text.match(/^(?:сколько|скольк\w*|как много|какое количество)\s+(.+)$/iu);
    if (match) return { subject: "", attribute: stripAttributeNoise(match[1]), relation: "has" };

    return { subject: "", attribute: "", relation: "" };
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
    version: 2,
    schema: SCHEMA,
    answerTypes: ANSWER_TYPES,
    intents: INTENTS,
    normalise,
    tokens,
    answerType,
    intentType,
    surfaceSlots,
    analyse,
    validateFrame,
    toSearchQueries
  });
})();