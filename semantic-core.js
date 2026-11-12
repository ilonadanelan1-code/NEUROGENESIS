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
  const COREFERENCE_SCHEMA = "NG_COREFERENCE_REFERENCE_V1";
  const FEMININE_HEADS = new Set(["система", "сеть", "память", "модель", "нейросеть",
    "связь", "активность", "энергия", "информация", "причина", "лаборатория", "комната",
    "дверь", "кость", "тень", "роль", "цель", "часть", "вещь", "жизнь", "площадь",
    "мощность", "скорость", "сущность", "новость", "ночь", "помощь"]);
  const MASCULINE_HEADS = new Set(["нейрон", "сигнал", "узел", "пакет", "токен",
    "процесс", "результат", "мозг", "импульс", "объект", "сервер", "модуль", "словарь", "путь", "исследователь",
    "день", "камень", "огонь", "конь", "корень", "гость", "рубль", "уголь", "ноль"]);
  const NEUTER_HEADS = new Set(["ядро", "состояние", "сообщение", "действие",
    "событие", "обучение", "питание", "значение", "соединение"]);
  const FEMININE_INFLECTED_HEADS = new Set([
    "комнате", "комнату", "комнатой", "системе", "систему", "системой",
    "лабораторию", "лабораторией", "нейросетью", "сетью", "моделью",
    "памятью", "связью", "причине", "причину", "причиной", "энергией",
    "информацией", "станцией", "станцию", "программе", "программу",
    "программой", "дверью", "цепью", "тенью", "ролью", "целью"
  ]);
  const MASCULINE_INFLECTED_HEADS = new Set([
    "сигнала", "сигналу", "сигналом", "модулю", "модулем", "словарю",
    "словарем", "процессу", "процессом", "нейрону", "нейроном",
    "объекту", "объектом", "результату", "результатом", "серверу", "сервером"
  ]);
  const NEUTER_INFLECTED_HEADS = new Set([
    "ядра", "ядру", "ядром", "состоянию", "состоянием", "сообщению",
    "сообщением", "действию", "действием", "значению", "значением",
    "соединению", "соединением"
  ]);
  const PLURAL_INFLECTED_HEADS = new Set([
    "нейроны", "нейронов", "нейронам", "нейронами", "нейронах",
    "сигналы", "сигналов", "сигналам", "сигналами", "сигналах",
    "узлы", "узлов", "узлам", "узлами", "узлах",
    "пакеты", "пакетов", "пакетам", "пакетами", "пакетах",
    "токены", "токенов", "токенам", "токенами", "токенах",
    "процессы", "процессов", "процессам", "процессами", "процессах",
    "результаты", "результатов", "результатам", "результатами", "результатах",
    "мозги", "мозгов", "мозгам", "мозгами", "мозгах",
    "импульсы", "импульсов", "импульсам", "импульсами", "импульсах",
    "объекты", "объектов", "объектам", "объектами", "объектах",
    "серверы", "серверов", "серверам", "серверами", "серверах",
    "модули", "модулей", "модулям", "модулями", "модулях",
    "словари", "словарей", "словарям", "словарями", "словарях",
    "пути", "путей", "путям", "путями", "путях",
    "ядра", "ядер", "ядрам", "ядрами", "ядрах",
    "состояния", "состояний", "состояниям", "состояниями", "состояниях",
    "сообщения", "сообщений", "сообщениям", "сообщениями", "сообщениях",
    "действия", "действий", "действиям", "действиями", "действиях",
    "события", "событий", "событиям", "событиями", "событиях",
    "обучения", "обучений", "обучениям", "обучениями", "обучениях",
    "питания", "питаний", "питаниям", "питаниями", "питаниях",
    "значения", "значений", "значениям", "значениями", "значениях",
    "соединения", "соединений", "соединениям", "соединениями", "соединениях",
    "системам", "системами", "системах", "сетей", "сетям", "сетями", "сетях",
    "моделей", "моделям", "моделями", "моделях", "нейросетям", "нейросетями", "нейросетях",
    "памятям", "памятями", "памятях", "связям", "связями", "связях",
    "комнатам", "комнатами", "комнатах", "дверям", "дверями", "дверях",
    "программам", "программами", "программах", "станциям", "станциями", "станциях",
    "причинам", "причинами", "причинах",
    "данные", "данных", "данным", "данными"
  ]);
  const AMBIGUOUS_SINGULAR_PLURAL_HEADS = new Set([
    "системы", "сети", "модели", "нейросети", "памяти", "связи",
    "комнаты", "двери", "программы", "станции", "причины", "пути",
    "ядра", "состояния", "сообщения", "действия", "события",
    "обучения", "питания", "значения", "соединения"
  ]);
  const GENITIVE_PREPOSITIONS = new Set([
    "без", "для", "до", "из", "от", "у", "около", "возле", "после",
    "среди", "внутри", "вне", "ради", "против", "вместо", "вокруг", "напротив"
  ]);
  const DATIVE_PREPOSITIONS = new Set(["к", "ко"]);
  const INSTRUMENTAL_PREPOSITIONS = new Set(["с", "со", "над", "перед", "между", "под"]);
  const PREPOSITIONAL_PREPOSITIONS = new Set(["в", "во", "на", "при", "о", "об", "обо"]);
  const GENITIVE_FEMININE_FORMS = new Set([
    "системы", "сети", "модели", "нейросети", "памяти", "связи",
    "комнаты", "двери", "программы", "станции", "причины"
  ]);
  const GENITIVE_MASCULINE_FORMS = new Set([
    "сигнала", "нейрона", "модуля", "словаря", "процесса", "объекта",
    "результата", "сервера", "узла", "пакета", "токена", "импульса", "мозга", "пути",
    "датчика", "сенсора"
  ]);
  const GENITIVE_NEUTER_FORMS = new Set([
    "ядра", "состояния", "сообщения", "действия", "события",
    "обучения", "питания", "значения", "соединения"
  ]);
  const DATIVE_FEMININE_FORMS = new Set([
    "системе", "сети", "модели", "нейросети", "памяти", "связи",
    "комнате", "двери", "программе", "станции", "причине"
  ]);
  const DATIVE_MASCULINE_FORMS = new Set([
    "сигналу", "нейрону", "модулю", "словарю", "процессу", "объекту",
    "результату", "серверу", "узлу", "пакету", "токену", "импульсу", "мозгу"
  ]);
  const DATIVE_NEUTER_FORMS = new Set([
    "ядру", "состоянию", "сообщению", "действию", "событию",
    "обучению", "питанию", "значению", "соединению"
  ]);
  const INSTRUMENTAL_FEMININE_FORMS = new Set([
    "системой", "сетью", "моделью", "нейросетью", "памятью", "связью",
    "комнатой", "дверью", "программой", "станцией", "причиной", "тенью", "ролью", "целью",
    "рукой", "клавиатурой", "отверткой", "отвёрткой"
  ]);
  const INSTRUMENTAL_MASCULINE_FORMS = new Set([
    "сигналом", "нейроном", "модулем", "словарем", "словарём", "процессом",
    "объектом", "результатом", "сервером", "узлом", "пакетом", "токеном",
    "импульсом", "мозгом", "путем", "путём", "ключом", "инструментом", "датчиком",
    "контроллером", "алгоритмом", "исследователем", "оператором",
    "пользователем", "инженером", "роботом", "администратором", "автором"
  ]);
  const INSTRUMENTAL_NEUTER_FORMS = new Set([
    "ядром", "состоянием", "сообщением", "действием", "событием",
    "обучением", "питанием", "значением", "соединением"
  ]);
  const PREPOSITIONAL_FEMININE_FORMS = new Set([
    "системе", "сети", "модели", "нейросети", "памяти", "связи",
    "комнате", "двери", "программе", "станции", "причине"
  ]);
  const PREPOSITIONAL_MASCULINE_FORMS = new Set([
    "сигнале", "нейроне", "модуле", "словаре", "процессе", "объекте",
    "результате", "сервере", "узле", "пакете", "токене", "импульсе", "мозге", "пути", "архиве"
  ]);
  const PREPOSITIONAL_NEUTER_FORMS = new Set([
    "ядре", "состоянии", "сообщении", "действии", "событии",
    "обучении", "питании", "значении", "соединении"
  ]);
  const OBLIQUE_PRONOUN_PREPOSITIONS = new Set([
    "с", "со", "к", "ко", "у", "от", "до", "из", "изо", "в", "во",
    "на", "о", "об", "обо", "для", "без", "под", "над", "между",
    "около", "возле", "перед", "после", "при", "про", "за", "через"
  ]);
  const GRAMMATICAL_FUNCTION_WORDS = new Set([
    "в", "во", "на", "из", "изо", "к", "ко", "у", "от", "до", "для", "без",
    "под", "над", "между", "около", "возле", "рядом", "с", "со", "по", "при",
    "о", "об", "обо", "за", "через", "про", "перед", "после", "среди", "внутри"
  ]);
  const NOMINATIVE_FORM_BY_INFLECTION = new Map([
    ["сигнала", "сигнал"], ["сигналу", "сигнал"], ["сигналом", "сигнал"], ["сигнале", "сигнал"],
    ["модуля", "модуль"], ["модулю", "модуль"], ["модулем", "модуль"], ["модуле", "модуль"],
    ["словаря", "словарь"], ["словарю", "словарь"], ["словарем", "словарь"], ["словарём", "словарь"],
    ["нейрона", "нейрон"], ["нейрону", "нейрон"], ["нейроном", "нейрон"], ["нейроне", "нейрон"],
    ["процесса", "процесс"], ["процессу", "процесс"], ["процессом", "процесс"], ["процессе", "процесс"],
    ["объекта", "объект"], ["объекту", "объект"], ["объектом", "объект"], ["объекте", "объект"],
    ["результата", "результат"], ["результату", "результат"], ["результатом", "результат"], ["результате", "результат"],
    ["сервера", "сервер"], ["серверу", "сервер"], ["сервером", "сервер"], ["сервере", "сервер"],
    ["узла", "узел"], ["узлу", "узел"], ["узлом", "узел"], ["узле", "узел"],
    ["пакета", "пакет"], ["пакету", "пакет"], ["пакетом", "пакет"], ["пакете", "пакет"],
    ["токена", "токен"], ["токену", "токен"], ["токеном", "токен"], ["токене", "токен"],
    ["системы", "система"], ["системе", "система"], ["систему", "система"], ["системой", "система"],
    ["моделью", "модель"], ["нейросетью", "нейросеть"], ["сетью", "сеть"], ["памятью", "память"],
    ["комнате", "комната"], ["комнату", "комната"], ["комнатой", "комната"],
    ["дверью", "дверь"], ["программой", "программа"], ["программе", "программа"], ["программу", "программа"],
    ["причине", "причина"], ["причиной", "причина"], ["станцией", "станция"],
    ["ядра", "ядро"], ["ядру", "ядро"], ["ядром", "ядро"], ["ядре", "ядро"],
    ["состояния", "состояние"], ["состоянию", "состояние"], ["состоянием", "состояние"], ["состоянии", "состояние"],
    ["сообщения", "сообщение"], ["сообщению", "сообщение"], ["сообщением", "сообщение"], ["сообщении", "сообщение"],
    ["действия", "действие"], ["действию", "действие"], ["действием", "действие"], ["действии", "действие"],
    ["нейронами", "нейроны"], ["нейронам", "нейроны"], ["нейронах", "нейроны"],
    ["модулями", "модули"], ["модулям", "модули"], ["модулях", "модули"],
    ["системами", "системы"], ["системам", "системы"], ["системах", "системы"],
    ["данных", "данные"], ["данным", "данные"], ["данными", "данные"]
  ]);
  const NOMINATIVE_ADJECTIVE_FORMS = new Map([
    ["нового", { masculine: "новый", feminine: "новая", neuter: "новое", plural: "новые" }],
    ["новому", { masculine: "новый", feminine: "новая", neuter: "новое", plural: "новые" }],
    ["новым", { masculine: "новый", feminine: "новая", neuter: "новое", plural: "новые" }],
    ["новом", { masculine: "новый", feminine: "новая", neuter: "новое", plural: "новые" }],
    ["новой", { feminine: "новая", plural: "новые" }],
    ["новую", { feminine: "новая" }],
    ["безопасного", { masculine: "безопасный", feminine: "безопасная", neuter: "безопасное", plural: "безопасные" }],
    ["безопасному", { masculine: "безопасный", feminine: "безопасная", neuter: "безопасное", plural: "безопасные" }],
    ["безопасным", { masculine: "безопасный", feminine: "безопасная", neuter: "безопасное", plural: "безопасные" }],
    ["безопасном", { masculine: "безопасный", feminine: "безопасная", neuter: "безопасное", plural: "безопасные" }],
    ["большого", { masculine: "большой", feminine: "большая", neuter: "большое", plural: "большие" }],
    ["большому", { masculine: "большой", feminine: "большая", neuter: "большое", plural: "большие" }],
    ["большим", { masculine: "большой", feminine: "большая", neuter: "большое", plural: "большие" }],
    ["большом", { masculine: "большой", feminine: "большая", neuter: "большое", plural: "большие" }],
    ["большой", { feminine: "большая" }],
    ["большую", { feminine: "большая" }]
  ]);


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

    const notAll = text.match(/(?:^|\s)не\s+(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую)(?=\s|$)/u);
    if (notAll) {
      const tail = text.slice(notAll.index + notAll[0].length);
      if (/(?:^|\s)не(?:\s|$)/u.test(tail)) {
        return { scope: "ambiguous", quantifier: "all", effect: "ambiguous",
          polarity: "unknown", confidence: 0.62 };
      }
      return { scope: "quantifier", quantifier: "all", effect: "not_all",
        polarity: "mixed", confidence: 0.76 };
    }

    const none = text.match(/(?:^|\s)ни\s+(?:один|одна|одно|одни|одного|одной|одному|одну)(?=\s|$)/u);
    if (none && /(?:^|\s)не(?:\s|$)/u.test(text.slice(none.index + none[0].length))) {
      return { scope: "quantifier", quantifier: "none", effect: "none_negative",
        polarity: "negative", confidence: 0.78 };
    }

    const notAlways = text.match(/(?:^|\s)не\s+всегда(?=\s|$)/u);
    if (notAlways) {
      const tail = text.slice(notAlways.index + notAlways[0].length);
      if (/(?:^|\s)не(?:\s|$)/u.test(tail)) {
        return { scope: "ambiguous", quantifier: "always", effect: "ambiguous",
          polarity: "unknown", confidence: 0.60 };
      }
      return { scope: "temporal", quantifier: "always", effect: "not_always",
        polarity: "mixed", confidence: 0.76 };
    }
    if (/(?:^|\s)всегда\s+не(?:\s|$)/u.test(text)) {
      return { scope: "temporal", quantifier: "always", effect: "always_negative",
        polarity: "negative", confidence: 0.76 };
    }

    const all = text.match(/(?:^|\s)(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую)(?=\s|$)/u);
    if (all && /(?:^|\s)не(?:\s|$)/u.test(text.slice(all.index + all[0].length))) {
      return { scope: "quantifier", quantifier: "all", effect: "all_negative",
        polarity: "negative", confidence: 0.72 };
    }
    if (/(?:^|\s)не(?:\s|$)/u.test(text)) {
      return { scope: "predicate", quantifier: "unspecified", effect: "negative",
        polarity: "negative", confidence: 0.74 };
    }
    return neutral;
  }

  function cleanQuantifiedSubject(value) {
    return clean(value, 180)
      .replace(/^если\s+/iu, "")
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
      .replace(/^не\s+(?=(?:все|вся|всё|каждый|каждая|каждое|каждые|каждого|каждой|каждому|каждую)(?:\s|$))/iu, "")
      .replace(/(^|\s)не\s+всегда\s+/u, "$1")
      .replace(/(^|\s)всегда\s+не\s+/u, "$1");

    const passive = propositionText.match(/^(.+?)\s+(?:(?:был|была|было|были)\s+)?(передан|передана|передано|переданы|отправлен|отправлена|отправлено|отправлены|сообщен|сообщён|сообщена|сообщено|сообщены|получен|получена|получено|получены|принят|принята|принято|приняты|открыт|открыта|открыто|открыты|создан|создана|создано|созданы|сохранен|сохранён|сохранена|сохранено|сохранены|обнаружен|обнаружена|обнаружено|обнаружены|обработан|обработана|обработано|обработаны|запущен|запущена|запущено|запущены|выбран|выбрана|выбрано|выбраны|измерен|измерена|измерено|измерены|проверен|проверена|проверено|проверены|активирован|активирована|активировано|активированы|защищен|защищён|защищена|защищено|защищены|изменен|изменён|изменена|изменено|изменены)(?:\s+(.+))?$/iu);
    if (passive && PASSIVE_PREDICATES.has(normalise(passive[2]))) {
      const modality = explicitPossible ? "possible" : "asserted";
      return {
        ...base,
        kind: conditional ? "conditional" : opinion ? "opinion" : modality === "possible" ? "hypothesis" : "assertion",
        subject: cleanQuantifiedSubject(passive[1]),
        predicate: clean(passive[2], 80),
        object: clean(passive[3], 220),
        relation: "predicate",
        polarity: polarityScope.polarity, polarityScope,
        modality: conditional ? "conditional" : opinion ? "opinion" : modality,
        confidence: 0.78,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

    const directCause = propositionText.match(/^(.+?)\s+(?:(может|могут|способен|способна|способны)\s+)?(не\s+)?(вызывает|вызывают|провоцирует|провоцируют|порождает|порождают|обусловливает|обусловливают)\s+(.+)$/iu);
    if (directCause) {
      const modality = directCause[2] ? "possible" : explicitPossible ? "possible" : "asserted";
      return {
        ...base, kind: conditional ? "conditional" : opinion ? "opinion" : modality === "possible" ? "hypothesis" : "assertion",
        subject: cleanQuantifiedSubject(directCause[1]), predicate: clean(directCause[4], 100),
        object: clean(directCause[5], 220), relation: "causal",
        polarity: polarityScope.scope !== "none" ? polarityScope.polarity : directCause[3] ? "negative" : "positive",
        polarityScope,
        modality: conditional ? "conditional" : opinion ? "opinion" : modality,
        confidence: 0.8,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

    const inverseCause = propositionText.match(/^(.+?)\s+(происходит|возникает|появляется|случается)\s+из-за\s+(.+)$/iu);
    if (inverseCause) {
      return {
        ...base, kind: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "hypothesis" : "assertion",
        subject: cleanQuantifiedSubject(inverseCause[1]),
        predicate: clean(inverseCause[2] + " из-за", 100),
        object: clean(inverseCause[3], 220), relation: "causal",
        polarity: polarityScope.polarity, polarityScope,
        modality: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "possible" : "asserted",
        confidence: 0.78,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

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

    const sovFinal = propositionText.match(/^([^\s]+)\s+([^\s]+)\s+(получает|сохраняет|проверяет)$/iu);
    if (sovFinal && grammaticalGender(sovFinal[1]) !== "unknown" &&
        grammaticalGender(sovFinal[2]) !== "unknown") {
      return {
        ...base, kind: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "hypothesis" : "assertion",
        subject: cleanQuantifiedSubject(sovFinal[2]), predicate: clean(sovFinal[3], 80),
        object: clean(sovFinal[1], 220), relation: "predicate",
        polarity: polarityScope.polarity, polarityScope,
        modality: conditional ? "conditional" : opinion ? "opinion" : explicitPossible ? "possible" : "asserted",
        confidence: 0.7,
        attribution: opinion ? { speaker: "user", source: "user_opinion", reportedBy: "user" } : base.attribution
      };
    }

    match = propositionText.match(/^(.+?)\s+(?:(может|могут|должен|должна|должны|обязан|обязана)\s+)?(не\s+)?(имеет|имеют|содержит|содержат|включает|включают|находится|находятся|расположен|расположена|расположено|расположены|активируется|активируются|работает|работают|работал|работала|работало|работали|существует|существуют|состоит|состоят|является|являются|обладает|обладают|поддерживает|поддерживают|использует|используют|получает|получают|получил|получила|получило|получили|обнаруживает|обнаруживают|фиксирует|фиксируют|регистрирует|регистрируют|делает|делают|обнаружить|получить|сохранить|активировать|запустить|измерить|сохраняет|сохраняют|выбирает|выбирают|проверяет|проверяют|измеряет|измеряют|обрабатывает|обрабатывают|активирует|активируют|хранит|хранят|изучает|изучают|меняет|меняют|защищает|защищают|открывает|открывают|принимает|принимают|передаёт|передает|передают|отправляет|отправляют|запускает|запускают|создаёт|создает|создают|усиливается|усиливаются|ослабевает|ослабевают|обрабатывается|обрабатываются|изменяется|изменяются|сохраняется|сохраняются|живу|живёт|живет|живут|был|была|было|были|станет|станут)(?:\s+(.+))?$/iu);
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


  function grammaticalGender(value) {
    const text = clean(value, 180).toLowerCase().replace(/^[«"']|[»"']$/gu, "");
    const words = text.split(/\s+/u).map(word =>
      word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").replace(/ё/gu, "е")).filter(Boolean);
    if (!words.length) return "unknown";

    const first = words[0];
    const caseWords = words.slice(1);
    const caseSets = GENITIVE_PREPOSITIONS.has(first)
      ? [GENITIVE_FEMININE_FORMS, GENITIVE_MASCULINE_FORMS, GENITIVE_NEUTER_FORMS]
      : DATIVE_PREPOSITIONS.has(first)
        ? [DATIVE_FEMININE_FORMS, DATIVE_MASCULINE_FORMS, DATIVE_NEUTER_FORMS]
        : INSTRUMENTAL_PREPOSITIONS.has(first)
          ? [INSTRUMENTAL_FEMININE_FORMS, INSTRUMENTAL_MASCULINE_FORMS, INSTRUMENTAL_NEUTER_FORMS]
          : PREPOSITIONAL_PREPOSITIONS.has(first)
            ? [PREPOSITIONAL_FEMININE_FORMS, PREPOSITIONAL_MASCULINE_FORMS, PREPOSITIONAL_NEUTER_FORMS]
            : null;
    if (caseSets) {
      for (const word of caseWords) {
        if (caseSets[0].has(word)) return "feminine";
        if (caseSets[1].has(word)) return "masculine";
        if (caseSets[2].has(word)) return "neuter";
      }
    }

    const ignored = /^(?:все|вся|всё|каждый|каждая|каждое|один|одна|одно|два|две|три|четыре|пять|много|несколько|этот|эта|это|эти|такой|такая|такое|такие|мой|моя|мое|мои)$/iu;
    const contentWords = words.filter(word =>
      !ignored.test(word) && !GRAMMATICAL_FUNCTION_WORDS.has(word));
    if (!contentWords.length) return "unknown";
    const foldedWords = contentWords;
    const firstKnown = foldedWords.find(word =>
      FEMININE_HEADS.has(word) || FEMININE_INFLECTED_HEADS.has(word) ||
      MASCULINE_HEADS.has(word) || MASCULINE_INFLECTED_HEADS.has(word) ||
      NEUTER_HEADS.has(word) || NEUTER_INFLECTED_HEADS.has(word));
    const lastKnown = [...foldedWords].reverse().find(word =>
      FEMININE_HEADS.has(word) || FEMININE_INFLECTED_HEADS.has(word) ||
      MASCULINE_HEADS.has(word) || MASCULINE_INFLECTED_HEADS.has(word) ||
      NEUTER_HEADS.has(word) || NEUTER_INFLECTED_HEADS.has(word));
    const head = firstKnown || lastKnown || foldedWords[0];
    if (AMBIGUOUS_SINGULAR_PLURAL_HEADS.has(head)) return "unknown";
    if (PLURAL_INFLECTED_HEADS.has(head)) return "plural";
    if (FEMININE_HEADS.has(head) || FEMININE_INFLECTED_HEADS.has(head)) return "feminine";
    if (MASCULINE_HEADS.has(head) || MASCULINE_INFLECTED_HEADS.has(head)) return "masculine";
    if (NEUTER_HEADS.has(head) || NEUTER_INFLECTED_HEADS.has(head)) return "neuter";
    if (/(?:ии)$/u.test(head)) return "unknown";
    if (/[аяую]$/u.test(head)) return "feminine";
    if (/[оеё]$/u.test(head)) return "neuter";
    if (/[ь]$/u.test(head)) return "unknown";
    if (/[бвгджзйклмнпрстфхцшщ]$/u.test(head)) return "masculine";
    return "unknown";
  }

  function pronounGenders(value, role) {
    const text = clean(value, 100);
    const words = text.split(/\s+/u).filter(Boolean);
    const subject = {
      "он": ["masculine"], "она": ["feminine"], "оно": ["neuter"], "они": ["plural"],
      "который": ["masculine"], "которая": ["feminine"],
      "которое": ["neuter"], "которые": ["plural"]
    };
    const object = {
      "его": ["masculine", "neuter"], "него": ["masculine", "neuter"],
      "ему": ["masculine", "neuter"], "нему": ["masculine", "neuter"],
      "им": ["masculine", "neuter", "plural"],
      "их": ["plural"], "них": ["plural"], "ими": ["plural"], "ними": ["plural"],
      "ее": ["feminine"], "её": ["feminine"], "нее": ["feminine"], "неё": ["feminine"],
      "ей": ["feminine"], "ней": ["feminine"], "ею": ["feminine"], "нею": ["feminine"],
      "которого": ["masculine", "neuter"], "которую": ["feminine"],
      "которому": ["masculine", "neuter"], "которой": ["feminine"],
      "которым": ["masculine", "neuter", "plural"], "которыми": ["plural"],
      "которых": ["plural"], "которое": ["neuter"]
    };
    const key = normalise(words[words.length - 1] || "").replace(/\s+/gu, "");
    if (role === "subject") return words.length === 1 ? subject[key] || null : null;
    if (words.length === 1) return object[key] || null;
    if (words.length !== 2 || !OBLIQUE_PRONOUN_PREPOSITIONS.has(normalise(words[0]))) return null;
    const preposition = normalise(words[0]);
    if (key === "ним") {
      if (["к", "ко", "по"].includes(preposition)) return ["plural"];
      if (["с", "со", "над", "перед", "под"].includes(preposition)) return ["masculine", "neuter"];
      return null;
    }
    return object[key] || null;
  }

  function pronounCaseOptions(value, role) {
    const words = clean(value, 100).split(/\s+/u).filter(Boolean);
    const key = normalise(words[words.length - 1] || "");
    if (!key) return [];
    if (role === "subject") return ["nominative"];
    if (words.length === 2 && OBLIQUE_PRONOUN_PREPOSITIONS.has(normalise(words[0]))) {
      const prep = normalise(words[0]);
      if (["к", "ко", "по"].includes(prep)) return ["dative"];
      if (["от", "из", "изо", "у", "для", "без", "до", "около", "возле", "после"].includes(prep)) return ["genitive"];
      if (["с", "со"].includes(prep)) return ["ним", "ней", "нею", "ними"].includes(key) ? ["instrumental"] : ["genitive"];
      if (["о", "об", "обо", "при"].includes(prep)) return ["prepositional"];
      if (["над", "перед", "между", "под"].includes(prep)) return ["instrumental"];
      if (["через", "за"].includes(prep)) return ["accusative"];
      if (["в", "во", "на"].includes(prep)) {
        if (["нем", "нём", "ней"].includes(key)) return ["prepositional"];
        return ["accusative", "prepositional"];
      }
    }
    const cases = {
      "ему": ["dative"], "нему": ["dative"], "ей": ["dative"], "ней": ["dative", "prepositional"],
      "им": ["dative", "instrumental"], "его": ["genitive", "accusative"], "него": ["genitive", "accusative"],
      "ее": ["genitive", "accusative"], "её": ["genitive", "accusative"], "нее": ["genitive", "accusative"],
      "неё": ["genitive", "accusative"], "их": ["genitive", "accusative"], "них": ["genitive", "accusative"],
      "ими": ["instrumental"], "ними": ["instrumental"], "ним": ["instrumental"], "нею": ["instrumental"], "ею": ["instrumental"],
      "которого": ["genitive", "accusative"], "которую": ["accusative"], "которому": ["dative"],
      "которой": ["genitive", "dative", "instrumental", "prepositional"], "которым": ["dative", "instrumental"],
      "которыми": ["instrumental"], "которых": ["genitive", "accusative"]
    };
    return cases[key] || [];
  }

  function canonicalNominativePhrase(value, gender, number) {
    const text = clean(value, 180);
    const words = text.split(/\s+/u).filter(Boolean);
    if (!words.length || words.length > 2 ||
        (words.length > 1 && GRAMMATICAL_FUNCTION_WORDS.has(normalise(words[0])))) return null;
    const head = normalise(words[words.length - 1]);
    const lemma = NOMINATIVE_FORM_BY_INFLECTION.get(head);
    if (!lemma) return null;
    if (words.length === 1) return lemma;
    const adjective = NOMINATIVE_ADJECTIVE_FORMS.get(normalise(words[0]));
    const adjectiveForm = adjective && adjective[number === "plural" ? "plural" : gender];
    return adjectiveForm ? adjectiveForm + " " + lemma : null;
  }

  function grammaticalFeatures(value, role = "object", suppliedCase = null) {
    const text = clean(value, 180);
    const gender = grammaticalGender(text);
    const number = gender === "plural" ? "plural"
      : ["masculine", "feminine", "neuter"].includes(gender) ? "singular" : "unknown";
    const words = text.split(/\s+/u).filter(Boolean);
    let marker = "", phrase = text;
    if (words.length > 1) {
      if (["рядом с", "с помощью"].includes(normalise(words.slice(0, 2).join(" ")))) {
        marker = normalise(words.slice(0, 2).join(" "));
        phrase = words.slice(2).join(" ");
      } else if (OBLIQUE_PRONOUN_PREPOSITIONS.has(normalise(words[0]))) {
        marker = normalise(words[0]);
        phrase = words.slice(1).join(" ");
      }
    }
    const allowedCases = ["nominative", "accusative", "genitive", "dative", "instrumental", "prepositional", "unknown"];
    const grammaticalCase = allowedCases.includes(suppliedCase) && suppliedCase !== "unknown"
      ? suppliedCase : role === "subject" && !marker ? "nominative"
      : semanticPhraseCase(phrase, marker, "");
    return {
      gender, number, grammaticalCase: allowedCases.includes(grammaticalCase) ? grammaticalCase : "unknown",
      canonicalText: canonicalNominativePhrase(text, gender, number)
    };
  }

  function validatePropositionReferences(raw, fallback = undefined) {
    const rows = Array.isArray(fallback) ? fallback : Array.isArray(raw) ? raw : [];
    const output = [];
    for (const row of rows.slice(0, 3)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const mention = clean(row.mention, 40);
      const targetType = ["entity", "proposition", "location", "time"].includes(row.targetType) ? row.targetType : "entity";
      let status = ["resolved", "ambiguous", "unresolved"].includes(row.status) ? row.status : "unresolved";
      const antecedentId = /^p[1-6]$/u.test(clean(row.antecedentId, 8)) ? clean(row.antecedentId, 8) : null;
      const antecedentText = clean(row.antecedentText, 180) || null;
      if (status === "resolved" && (!antecedentId || !antecedentText)) status = "unresolved";
      const candidates = (Array.isArray(row.candidates) ? row.candidates : []).slice(0, 3).map(candidate => ({
        id: /^p[1-6]$/u.test(clean(candidate && candidate.id, 8)) ? clean(candidate.id, 8) : null,
        text: clean(candidate && candidate.text, 120),
        role: ["subject", "object", "event", "location", "time", "agent", "recipient", "theme",
          "patient", "cause", "effect", "source", "instrument", "destination",
          "beneficiary", "indirect_object", "context"].includes(candidate && candidate.role)
          ? candidate.role : "object",
        grammaticalCase: ["nominative", "accusative", "genitive", "dative",
          "instrumental", "prepositional", "unknown"].includes(candidate && candidate.grammaticalCase)
          ? candidate.grammaticalCase : null,
        gender: ["masculine", "feminine", "neuter", "plural", "unknown"].includes(candidate && candidate.gender)
          ? candidate.gender : "unknown",
        number: ["singular", "plural", "unknown"].includes(candidate && candidate.number)
          ? candidate.number : "unknown",
        canonicalText: clean(candidate && candidate.canonicalText, 180) || null
      })).filter(candidate => candidate.text);
      const confidence = Number(row.confidence);
      const provenanceSource = row.provenance && row.provenance.source;
      const provenance = {
        source: ["semantic_core_rule", "model_candidate"].includes(provenanceSource) ? provenanceSource : "unknown",
        rule: clean(row.provenance && row.provenance.rule, 80) || null,
        window: Number.isInteger(Number(row.provenance && row.provenance.window))
          ? Math.max(0, Math.min(6, Number(row.provenance.window))) : null
      };
      if (!mention) continue;
      output.push({
        schema: COREFERENCE_SCHEMA, mention, mentionRole: ["subject", "object"].includes(row.mentionRole) ? row.mentionRole : null,
        mentionContext: clean(row.mentionContext, 40) || null,
        mentionCases: (Array.isArray(row.mentionCases) ? row.mentionCases : [])
          .filter(value => ["nominative", "accusative", "genitive", "dative", "instrumental", "prepositional"].includes(value))
          .slice(0, 3),
        targetType, status,
        antecedentId: status === "resolved" ? antecedentId : null,
        antecedentText: status === "resolved" ? antecedentText : null,
        candidates, provenance,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.2
      });
    }
    return output;
  }

  function resolvePropositionReferences(items) {
    const addEntityReference = (proposition, index, role, references) => {
      const surfaceMention = clean(proposition[role], 80);
      const genders = pronounGenders(surfaceMention, role);
      if (!genders) return;
      const words = surfaceMention.split(/\s+/u).filter(Boolean);
      const hasPrepositionContext = role === "object" && words.length === 2 &&
        OBLIQUE_PRONOUN_PREPOSITIONS.has(normalise(words[0]));
      const mention = words[words.length - 1] || surfaceMention;
      const mentionContext = hasPrepositionContext ? clean(words[0], 24) : null;
      const mentionCases = pronounCaseOptions(surfaceMention, role);
      const currentArgument = (Array.isArray(proposition.arguments) ? proposition.arguments : [])
        .find(argument => normalise(argument.text) === normalise(surfaceMention));
      // Only valency-specific roles provide a safe tie-breaker. Generic agent,
      // patient and cause labels are too broad to resolve competing antecedents.
      const roleSensitive = new Set([
        "recipient", "theme", "source", "instrument", "destination",
        "beneficiary", "indirect_object"
      ]);
      const desiredRole = currentArgument && roleSensitive.has(currentArgument.role)
        ? currentArgument.role : null;
      const candidatesByEntity = new Map();
      for (let priorIndex = index - 1; priorIndex >= Math.max(0, index - 6); priorIndex--) {
        const previous = items[priorIndex], prior = previous.proposition || {};
        const semanticArguments = Array.isArray(prior.arguments) ? prior.arguments : [];
        const semanticKeys = new Set();
        const legacyObject = clean(prior.object, 180);
        const nestedObject = legacyObject.match(/^(.+?)\s+(?:в|во|на|под|над|за|перед|при)\s+(.+)$/iu);
        const nestedObjectHead = nestedObject && semanticArguments.find(argument =>
          ["patient", "theme"].includes(argument && argument.role) &&
          normalise(argument.text) === normalise(nestedObject[1]));
        const nestedObjectLocation = nestedObject && semanticArguments.find(argument =>
          argument && argument.role === "location" &&
          normalise(argument.text) === normalise(nestedObject[2]));
        const collapseNestedObject = !!(nestedObjectHead && nestedObjectLocation &&
          genders.includes(grammaticalGender(nestedObject[1])) &&
          genders.includes(grammaticalGender(nestedObject[2])) &&
          genders.includes(grammaticalGender(legacyObject)));
        if (collapseNestedObject) {
          // The old proposition slot treats "систему в большой комнате" as
          // one noun phrase. When both its head and locative modifier agree
          // with the pronoun, keep that complete phrase as one antecedent
          // instead of presenting two pieces of the same noun phrase as rivals.
          const key = normalise(legacyObject);
          const score = (index - priorIndex) * 10;
          candidatesByEntity.set(key, {
            id: previous.id, text: legacyObject, role: "object",
            grammaticalCase: null, score, semantic: true
          });
          semanticKeys.add(key);
          semanticKeys.add(normalise(nestedObject[1]));
          semanticKeys.add(normalise(nestedObject[2]));
        }
        for (const argument of semanticArguments) {
          const rawText = clean(argument && argument.text, 180);
          if (!rawText || pronounGenders(rawText, "subject") || pronounGenders(rawText, "object")) continue;
          const candidateRole = clean(argument.role, 32) || "object";
          if (collapseNestedObject &&
              (normalise(rawText) === normalise(nestedObject[1]) ||
               normalise(rawText) === normalise(nestedObject[2]))) continue;
          let text = rawText;
          const legacyWords = legacyObject.split(/\s+/u);
          const hasObliquePrefix = legacyWords.length > 1 &&
            OBLIQUE_PRONOUN_PREPOSITIONS.has(normalise(legacyWords[0]));
          // Some older extractors keep the preposition in object while the new
          // argument frame stores only the noun phrase. Preserve the complete
          // surface group as the antecedent so "в большой комнате" is not
          // silently reduced to "большой комнате".
          if (!collapseNestedObject && hasObliquePrefix &&
              normalise(legacyObject).endsWith(" " + normalise(rawText))) {
            text = legacyObject;
          }
          const gender = grammaticalGender(text);
          if (!genders.includes(gender)) continue;
          const key = normalise(text);
          if (!key) continue;
          semanticKeys.add(key);
          semanticKeys.add(normalise(rawText));
          const rolePenalty = desiredRole && candidateRole !== desiredRole ? 2 : 0;
          const score = (index - priorIndex) * 10 + rolePenalty;
          const existing = candidatesByEntity.get(key);
          if (!existing || score < existing.score) {
            const features = grammaticalFeatures(text, candidateRole, argument.grammaticalCase);
            candidatesByEntity.set(key, {
              id: previous.id, text, role: candidateRole,
              grammaticalCase: features.grammaticalCase,
              gender: features.gender, number: features.number,
              canonicalText: features.canonicalText,
              score, semantic: true
            });
          }
        }
        // Backward-compatible fallback for propositions created before semantic
        // arguments existed, or for legacy phrases that the bounded role rules miss.
        for (const candidateRole of ["subject", "object"]) {
          const text = clean(prior[candidateRole], 180);
          if (!text || pronounGenders(text, candidateRole)) continue;
          const key = normalise(text);
          if (!key || semanticKeys.has(key)) continue;
          const gender = grammaticalGender(text);
          if (!genders.includes(gender)) continue;
          const score = (index - priorIndex) * 10 + (candidateRole === "subject" ? 0 : 1);
          const existing = candidatesByEntity.get(key);
          if (!existing || score < existing.score) {
            const features = grammaticalFeatures(text, candidateRole, null);
            candidatesByEntity.set(key, { id: previous.id, text, role: candidateRole,
              grammaticalCase: features.grammaticalCase, gender: features.gender,
              number: features.number, canonicalText: features.canonicalText,
              score, semantic: false });
          }
        }
      }
      let candidates = [...candidatesByEntity.values()].sort((a, b) => a.score - b.score);
      // A second non-reflexive object pronoun should not silently reuse the
      // participant already resolved as the current subject when an alternative
      // compatible participant is present.
      const priorSubjectReference = role === "object"
        ? references.find(reference => reference.mentionRole === "subject" &&
          reference.targetType === "entity" && reference.status === "resolved")
        : null;
      if (priorSubjectReference && candidates.length > 1) {
        const alternatives = candidates.filter(candidate =>
          normalise(candidate.text) !== normalise(priorSubjectReference.antecedentText));
        if (alternatives.length) candidates = alternatives;
      }
      // Role continuity is an explicit signal, not a proximity tie-breaker:
      // resolve only when exactly one candidate has the current argument role.
      const roleMatches = desiredRole
        ? candidates.filter(candidate => candidate.semantic && candidate.role === desiredRole)
        : [];
      const resolvedCandidate = candidates.length === 1 ? candidates[0]
        : roleMatches.length === 1 ? roleMatches[0] : null;
      const decisive = !!resolvedCandidate;
      references.push({
        schema: COREFERENCE_SCHEMA, mention, mentionContext, mentionRole: role,
        mentionCases, targetType: "entity",
        status: decisive ? "resolved" : candidates.length ? "ambiguous" : "unresolved",
        antecedentId: decisive ? resolvedCandidate.id : null,
        antecedentText: decisive ? resolvedCandidate.text : null,
        candidates: candidates.slice(0, 3).map(row => ({
          id: row.id, text: row.text, role: row.role,
          grammaticalCase: row.grammaticalCase || null,
          gender: row.gender || "unknown", number: row.number || "unknown",
          canonicalText: row.canonicalText || null
        })),
        provenance: { source: "semantic_core_rule", rule: "semantic_role_case_number_compatibility", window: 6 },
        confidence: decisive ? (roleMatches.length ? 0.88 : 0.84) : candidates.length ? 0.42 : 0.12
      });
      // Keep an oblique phrase such as "с ним" in its original case. Also avoid
      // copying a dative/instrumental antecedent into a nominative subject slot:
      // the reference is retained, but no ungrounded declension is fabricated.
      const antecedentWords = clean(resolvedCandidate && resolvedCandidate.text, 180).split(/\s+/u);
      const antecedentHasPreposition = antecedentWords.length > 1 &&
        OBLIQUE_PRONOUN_PREPOSITIONS.has(normalise(antecedentWords[0]));
      const caseMismatch = decisive && role === "subject" && !antecedentHasPreposition &&
        resolvedCandidate.grammaticalCase &&
        !["nominative", "accusative", "unknown"].includes(resolvedCandidate.grammaticalCase);
      const preserveCaseSurface = hasPrepositionContext ||
        (caseMismatch && !resolvedCandidate.canonicalText) ||
        (role === "object" && /^котор/iu.test(mention));
      if (decisive && !preserveCaseSurface) {
        proposition[role] = caseMismatch && resolvedCandidate.canonicalText
          ? resolvedCandidate.canonicalText : resolvedCandidate.text;
      }
    };

    return items.map((item, index) => {
      const proposition = { ...item.proposition };
      const references = [];
      addEntityReference(proposition, index, "subject", references);
      addEntityReference(proposition, index, "object", references);

      const text = clean(item.text, 300);
      const sourceText = clean(item.sourceText, 300);
      const demonstrative = /^(?:а\s+)?это(?=\s|$)/iu.test(text) ||
        normalise(proposition.subject) === "это";
      if (demonstrative) {
        const previous = index > 0 ? items[index - 1] : null;
        const candidate = previous ? {
          id: previous.id, text: clean(previous.sourceText || previous.text, 180), role: "event"
        } : null;
        references.push({
          schema: COREFERENCE_SCHEMA, mention: "это", mentionRole: "subject", targetType: "proposition",
          status: candidate ? "resolved" : "unresolved",
          antecedentId: candidate && candidate.id, antecedentText: candidate && candidate.text,
          candidates: candidate ? [candidate] : [],
          provenance: { source: "semantic_core_rule", rule: "immediate_demonstrative_antecedent", window: 1 },
          confidence: candidate ? 0.78 : 0.12
        });
      }

      if (/^(?:а\s+)?там(?=\s|$)/iu.test(text) || normalise(proposition.subject) === "там") {
        const places = new Map();
        for (let j = index - 1; j >= 0 && j >= index - 6; j--) {
          const object = clean(items[j].proposition && items[j].proposition.object, 180);
          if (object && /^(?:в|на|из|к|около|возле|рядом\s+с|под|над|между)\s+/iu.test(object)) {
            const key = normalise(object);
            if (!places.has(key)) places.set(key, { id: items[j].id, text: object, role: "location" });
          }
        }
        const candidates = [...places.values()].slice(0, 3);
        const resolved = candidates.length === 1 ? candidates[0] : null;
        references.push({
          schema: COREFERENCE_SCHEMA, mention: "там", targetType: "location",
          status: resolved ? "resolved" : candidates.length ? "ambiguous" : "unresolved",
          antecedentId: resolved && resolved.id, antecedentText: resolved && resolved.text,
          candidates,
          provenance: { source: "semantic_core_rule", rule: "bounded_prior_location_search", window: 6 },
          confidence: resolved ? 0.76 : candidates.length ? 0.4 : 0.12
        });
      }

      if (/^(?:а\s+)?тогда(?=\s|$)/iu.test(text) || /^(?:а\s+)?тогда(?=\s|$)/iu.test(sourceText) || normalise(proposition.subject) === "тогда") {
        const times = new Map();
        for (let j = index - 1; j >= 0 && j >= index - 6; j--) {
          const expression = clean(items[j].proposition && items[j].proposition.temporal &&
            items[j].proposition.temporal.expression, 100) || temporalSignal(items[j].text).expression;
          if (expression) {
            const key = normalise(expression);
            if (!times.has(key)) times.set(key, { id: items[j].id, text: expression, role: "time" });
          }
        }
        const candidates = [...times.values()].slice(0, 3);
        const resolved = candidates.length === 1 ? candidates[0] : null;
        references.push({
          schema: COREFERENCE_SCHEMA, mention: "тогда", targetType: "time",
          status: resolved ? "resolved" : candidates.length ? "ambiguous" : "unresolved",
          antecedentId: resolved && resolved.id, antecedentText: resolved && resolved.text,
          candidates,
          provenance: { source: "semantic_core_rule", rule: "bounded_prior_time_search", window: 6 },
          confidence: resolved ? 0.76 : candidates.length ? 0.4 : 0.12
        });
      }

      proposition.references = validatePropositionReferences(references);
      return { ...item, proposition };
    });
  }

  const PASSIVE_PREDICATES = new Set([
    "передан", "передана", "передано", "переданы",
    "отправлен", "отправлена", "отправлено", "отправлены",
    "сообщен", "сообщена", "сообщено", "сообщены",
    "получен", "получена", "получено", "получены",
    "принят", "принята", "принято", "приняты",
    "открыт", "открыта", "открыто", "открыты",
    "создан", "создана", "создано", "созданы",
    "сохранен", "сохранена", "сохранено", "сохранены",
    "обнаружен", "обнаружена", "обнаружено", "обнаружены",
    "обработан", "обработана", "обработано", "обработаны",
    "запущен", "запущена", "запущено", "запущены",
    "выбран", "выбрана", "выбрано", "выбраны",
    "измерен", "измерена", "измерено", "измерены",
    "проверен", "проверена", "проверено", "проверены",
    "активирован", "активирована", "активировано", "активированы",
    "защищен", "защищена", "защищено", "защищены",
    "изменен", "изменена", "изменено", "изменены"
  ]);
  const PASSIVE_TRANSFER_PREDICATES = new Set([
    "передан", "передана", "передано", "переданы",
    "отправлен", "отправлена", "отправлено", "отправлены",
    "сообщен", "сообщена", "сообщено", "сообщены"
  ]);
  const PASSIVE_AGENT_FORMS = new Set([
    "системой", "моделью", "нейросетью", "сетью", "программой",
    "контроллером", "алгоритмом", "сервером", "модулем",
    "исследователем", "оператором", "пользователем", "инженером",
    "роботом", "администратором", "автором"
  ]);
  const TRANSFER_PREDICATES = new Set([
    "передает", "передаёт", "передают", "передал", "передала", "передали",
    "отправляет", "отправляют", "отправил", "отправила", "отправили",
    "сообщает", "сообщают", "сообщил", "сообщила", "сообщили",
    "дает", "даёт", "дают", "вручает", "вручают",
    ...PASSIVE_TRANSFER_PREDICATES
  ]);
  const RECEIVING_PREDICATES = new Set([
    "получает", "получают", "получил", "получила", "получило", "получили",
    "принимает", "принимают", "принял", "приняла", "приняли"
  ]);
  const CAUSATIVE_PREDICATES = new Set([
    "вызывает", "вызывают", "провоцирует", "провоцируют", "порождает", "порождают",
    "обусловливает", "обусловливают", "приводит", "приводят"
  ]);

  function semanticPhraseCase(value, marker = "", predicate = "") {
    const text = clean(value, 180).toLowerCase().replace(/ё/gu, "е");
    const last = text.split(/\s+/u).filter(Boolean).pop() || "";
    const prep = normalise(marker);
    if (["от", "из", "из-за", "для", "без", "до", "у", "около", "возле", "после", "среди", "внутри"].includes(prep)) return "genitive";
    if (["к", "ко", "по"].includes(prep)) return "dative";
    if (["над", "перед", "между", "под", "рядом с"].includes(prep)) return "instrumental";
    if (["о", "об", "обо", "при"].includes(prep)) return "prepositional";
    if (prep === "через") return "accusative";
    if (["с", "со"].includes(prep)) {
      if (INSTRUMENTAL_FEMININE_FORMS.has(last) || INSTRUMENTAL_MASCULINE_FORMS.has(last) ||
          INSTRUMENTAL_NEUTER_FORMS.has(last) || /(?:ом|ем|ой|ей|ью|ами|ями)$/u.test(last)) return "instrumental";
      return "genitive";
    }
    if (["в", "во", "на"].includes(prep)) {
      if (PREPOSITIONAL_FEMININE_FORMS.has(last) || PREPOSITIONAL_MASCULINE_FORMS.has(last) ||
          PREPOSITIONAL_NEUTER_FORMS.has(last)) return "prepositional";
      if (TRANSFER_PREDICATES.has(normalise(predicate))) return "accusative";
      return "unknown";
    }
    if (DATIVE_FEMININE_FORMS.has(last) || DATIVE_MASCULINE_FORMS.has(last) ||
        DATIVE_NEUTER_FORMS.has(last) || ["системам", "модулям", "нейронам", "данным"].includes(last)) return "dative";
    if (INSTRUMENTAL_FEMININE_FORMS.has(last) || INSTRUMENTAL_MASCULINE_FORMS.has(last) ||
        INSTRUMENTAL_NEUTER_FORMS.has(last)) return "instrumental";
    if (PREPOSITIONAL_FEMININE_FORMS.has(last) || PREPOSITIONAL_MASCULINE_FORMS.has(last) ||
        PREPOSITIONAL_NEUTER_FORMS.has(last)) return "prepositional";
    if (GENITIVE_FEMININE_FORMS.has(last) || GENITIVE_MASCULINE_FORMS.has(last) ||
        GENITIVE_NEUTER_FORMS.has(last)) return "genitive";
    return "unknown";
  }

  function describeSemanticPhrase(value) {
    const text = clean(value, 180);
    const words = text.split(/\s+/u).filter(Boolean);
    const adjective = /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ую|юю|ыми|ими)$/iu;
    const headIndex = words.findIndex(word =>
      !GRAMMATICAL_FUNCTION_WORDS.has(normalise(word)) &&
      !adjective.test(normalise(word)) && !/^\d+$/u.test(word));
    const head = headIndex >= 0 ? words[headIndex] : words[0] || "";
    return {
      head: clean(head, 64) || null,
      modifiers: words.filter((word, index) => index !== headIndex).slice(0, 6).map(word => clean(word, 64))
    };
  }

  function splitSemanticComplement(value, predicate) {
    const original = clean(value, 220);
    if (!original) return { theme: "", complement: null };
    const prepMatch = original.match(/^(.+?)\s+(с помощью|посредством|из-за|рядом с|от|из|к|ко|для|без|до|у|около|возле|после|среди|внутри|над|перед|между|под|через|по|о|об|обо|в|во|на|при|с|со)\s+(.+)$/iu);
    if (prepMatch) {
      const marker = clean(prepMatch[2], 24);
      const phrase = clean(prepMatch[3], 120);
      const grammaticalCase = semanticPhraseCase(phrase, marker, predicate);
      const prep = normalise(marker);
      let role = "context";
      if (prep === "из-за") role = "cause";
      else if (["от", "из"].includes(prep) || (["с", "со"].includes(prep) && grammaticalCase === "genitive")) role = "source";
      else if (["с помощью", "посредством", "через"].includes(prep) ||
          ((prep === "с" || prep === "со") && grammaticalCase === "instrumental")) role = "instrument";
      else if (["к", "ко"].includes(prep)) role = TRANSFER_PREDICATES.has(normalise(predicate)) ? "recipient" : "destination";
      else if (prep === "для") role = "beneficiary";
      else if (["в", "во", "на", "при", "рядом с"].includes(prep)) {
        role = grammaticalCase === "prepositional" || prep === "при" || prep === "рядом с"
          ? "location" : TRANSFER_PREDICATES.has(normalise(predicate)) ? "destination" : "location";
      }
      return {
        theme: clean(prepMatch[1], 180),
        complement: { role, text: phrase, marker, grammaticalCase,
          confidence: grammaticalCase === "unknown" ? 0.52 : 0.82,
          rule: "preposition_and_case_valency" }
      };
    }

    const words = original.split(/\s+/u);
    if (words.length > 1) {
      const first = normalise(words[0]), last = normalise(words[words.length - 1]);
      const dativeLast = DATIVE_FEMININE_FORMS.has(last) || DATIVE_MASCULINE_FORMS.has(last) ||
        DATIVE_NEUTER_FORMS.has(last) || ["системам", "модулям", "нейронам"].includes(last);
      const instrumentalLast = INSTRUMENTAL_FEMININE_FORMS.has(last) ||
        INSTRUMENTAL_MASCULINE_FORMS.has(last) || INSTRUMENTAL_NEUTER_FORMS.has(last);
      if (dativeLast || instrumentalLast) {
        const adjectiveBefore = words.length > 2 && /(?:ому|ему|ой|ей|ым|им)$/iu.test(normalise(words[words.length - 2]));
        const take = adjectiveBefore ? 2 : 1;
        const complementText = words.slice(-take).join(" ");
        const role = dativeLast
          ? TRANSFER_PREDICATES.has(normalise(predicate)) ? "recipient" : "indirect_object"
          : "instrument";
        return {
          theme: clean(words.slice(0, -take).join(" "), 180),
          complement: { role, text: complementText, marker: null,
            grammaticalCase: dativeLast ? "dative" : "instrumental",
            confidence: 0.78, rule: "inflected_complement_valency" }
        };
      }
      if (DATIVE_FEMININE_FORMS.has(first) || DATIVE_MASCULINE_FORMS.has(first) ||
          DATIVE_NEUTER_FORMS.has(first)) {
        return {
          theme: clean(words.slice(1).join(" "), 180),
          complement: { role: TRANSFER_PREDICATES.has(normalise(predicate)) ? "recipient" : "indirect_object",
            text: words[0], marker: null, grammaticalCase: "dative",
            confidence: 0.78, rule: "dative_first_complement" }
        };
      }
    }
    return { theme: original, complement: null };
  }

  const SEMANTIC_PREPOSITION_MARKERS = [
    "с помощью", "рядом с", "посредством", "из-за", "изо", "около", "возле",
    "после", "среди", "внутри", "перед", "между", "через", "от", "из",
    "для", "без", "до", "у", "над", "под", "по", "к", "ко",
    "в", "во", "на", "при", "о", "об", "обо", "с", "со"
  ];
  function prepositionExpectedCase(marker, predicate) {
    const key = normalise(marker);
    if (["от", "из", "изо", "из-за", "для", "без", "до", "у", "около", "возле", "после", "среди", "внутри"].includes(key)) return "genitive";
    if (["к", "ко", "по"].includes(key)) return "dative";
    if (["над", "перед", "между", "рядом с"].includes(key)) return "instrumental";
    if (["о", "об", "обо", "при"].includes(key)) return "prepositional";
    if (key === "через") return "accusative";
    if (["в", "во", "на"].includes(key)) return TRANSFER_PREDICATES.has(normalise(predicate)) ? "accusative" : "prepositional";
    if (["с", "со"].includes(key) || key === "под") return null;
    return null;
  }

  function extractInflectedComplementTail(words, predicate) {
    const source = words.slice();
    if (!source.length || (source.length === 1 && !PASSIVE_PREDICATES.has(normalise(predicate)))) return null;
    const last = normalise(source[source.length - 1]);
    const dative = DATIVE_FEMININE_FORMS.has(last) || DATIVE_MASCULINE_FORMS.has(last) ||
      DATIVE_NEUTER_FORMS.has(last) || ["системам", "модулям", "нейронам", "данным"].includes(last);
    const instrumental = INSTRUMENTAL_FEMININE_FORMS.has(last) ||
      INSTRUMENTAL_MASCULINE_FORMS.has(last) || INSTRUMENTAL_NEUTER_FORMS.has(last);
    if (!dative && !instrumental) return null;
    const adjectiveBefore = source.length > 1 &&
      /(?:ого|его|ому|ему|ой|ей|ым|им|ую|юю|ыми|ими)$/iu.test(normalise(source[source.length - 2]));
    const take = adjectiveBefore ? 2 : 1;
    const phrase = source.slice(-take).join(" ");
    const role = dative
      ? TRANSFER_PREDICATES.has(normalise(predicate)) ? "recipient" : "indirect_object"
      : PASSIVE_PREDICATES.has(normalise(predicate)) && PASSIVE_AGENT_FORMS.has(last) ? "agent" : "instrument";
    return {
      remaining: source.slice(0, -take),
      complement: {
        role, text: phrase, marker: null,
        grammaticalCase: dative ? "dative" : "instrumental",
        confidence: 0.78,
        rule: dative ? "multi_complement_dative_suffix"
          : role === "agent" ? "passive_instrumental_agent" : "multi_complement_instrumental_suffix"
      }
    };
  }

  function splitSemanticComplements(value, predicate) {
    const original = clean(value, 220);
    if (!original) return { theme: "", complements: [] };
    const words = original.split(/\s+/u);
    const markers = [];
    for (let index = 0; index < words.length; index++) {
      const found = SEMANTIC_PREPOSITION_MARKERS.find(marker => {
        const markerWords = marker.split(/\s+/u);
        return markerWords.every((word, offset) => normalise(words[index + offset]) === word);
      });
      if (found) {
        markers.push({ index, marker: found, length: found.split(/\s+/u).length });
        index += found.split(/\s+/u).length - 1;
      }
    }
    if (!markers.length) {
      let remaining = words.slice();
      const complements = [];
      const first = normalise(remaining[0] || "");
      const second = normalise(remaining[1] || "");
      const firstIsDative = DATIVE_FEMININE_FORMS.has(first) || DATIVE_MASCULINE_FORMS.has(first) ||
        DATIVE_NEUTER_FORMS.has(first) || ["системам", "модулям", "нейронам", "данным"].includes(first);
      const adjectiveBeforeDative = remaining.length > 2 &&
        /(?:ому|ему|ой|ей|ым|им)$/iu.test(first) &&
        (DATIVE_FEMININE_FORMS.has(second) || DATIVE_MASCULINE_FORMS.has(second) ||
          DATIVE_NEUTER_FORMS.has(second) || ["системам", "модулям", "нейронам", "данным"].includes(second));
      const leadingDativeWords = adjectiveBeforeDative ? 2 : firstIsDative ? 1 : 0;
      if (leadingDativeWords && remaining.length > leadingDativeWords) {
        const phrase = remaining.slice(0, leadingDativeWords).join(" ");
        complements.push({
          role: TRANSFER_PREDICATES.has(normalise(predicate)) ? "recipient" : "indirect_object",
          text: phrase, marker: null, grammaticalCase: "dative",
          confidence: 0.78, rule: "dative_first_complement"
        });
        remaining = remaining.slice(leadingDativeWords);
      }
      while (remaining.length > 1 || PASSIVE_PREDICATES.has(normalise(predicate))) {
        const tail = extractInflectedComplementTail(remaining, predicate);
        if (!tail) break;
        complements.unshift(tail.complement);
        remaining = tail.remaining;
        if (!remaining.length) break;
      }
      return { theme: clean(remaining.join(" "), 180), complements };
    }

    let prefix = words.slice(0, markers[0].index);
    const complements = [];
    while (prefix.length > 1) {
      const tail = extractInflectedComplementTail(prefix, predicate);
      if (!tail) break;
      complements.unshift(tail.complement);
      prefix = tail.remaining;
    }
    const theme = clean(prefix.join(" "), 180);
    for (let markerIndex = 0; markerIndex < markers.length && complements.length < 5; markerIndex++) {
      const current = markers[markerIndex];
      const next = markers[markerIndex + 1];
      const end = next ? next.index : words.length;
      let segment = words.slice(current.index + current.length, end);
      const expectedCase = prepositionExpectedCase(current.marker, predicate);
      const trailingComplements = [];
      while (segment.length > 1 || PASSIVE_PREDICATES.has(normalise(predicate))) {
        const tail = extractInflectedComplementTail(segment, predicate);
        if (!tail || !expectedCase || tail.complement.grammaticalCase === expectedCase) break;
        trailingComplements.unshift(tail.complement);
        segment = tail.remaining;
        if (!segment.length) break;
      }
      const phrase = clean(segment.join(" "), 140);
      if (phrase) {
        const grammaticalCase = semanticPhraseCase(phrase, current.marker, predicate);
        const prep = normalise(current.marker);
        let role = "context";
        if (prep === "из-за") role = "cause";
        else if (["от", "из", "изо"].includes(prep) ||
          (["с", "со"].includes(prep) && grammaticalCase === "genitive")) role = "source";
        else if (["с помощью", "посредством", "через"].includes(prep) ||
          ((prep === "с" || prep === "со") && grammaticalCase === "instrumental")) role = "instrument";
        else if (["к", "ко"].includes(prep)) role = TRANSFER_PREDICATES.has(normalise(predicate)) ? "recipient" : "destination";
        else if (prep === "для") role = "beneficiary";
        else if (["в", "во", "на", "при", "рядом с", "под", "над", "перед", "между"].includes(prep)) {
          role = grammaticalCase === "prepositional" || ["при", "рядом с", "под", "над", "перед", "между"].includes(prep)
            ? "location" : TRANSFER_PREDICATES.has(normalise(predicate)) ? "destination" : "location";
        }
        complements.push({
          role, text: phrase, marker: current.marker, grammaticalCase,
          confidence: grammaticalCase === "unknown" ? 0.52 : 0.82,
          rule: "multi_preposition_case_valency"
        });
      }
      complements.push(...trailingComplements);
    }
    return { theme, complements: complements.slice(0, 5) };
  }

  function splitPassiveComplements(value, predicate) {
    const split = splitSemanticComplements(value, predicate);
    const complements = [];
    if (split.theme) complements.push({
      role: "theme", text: split.theme, marker: null,
      grammaticalCase: "accusative", confidence: 0.68,
      rule: "passive_secondary_theme"
    });
    complements.push(...split.complements);
    return complements.slice(0, 5);
  }

  function buildSemanticArguments(subject, predicate, object) {
    const actor = clean(subject, 180), verb = normalise(predicate);
    if (!actor || !verb) return [];
    const result = [];
    const add = (role, value, marker, grammaticalCase, confidence, rule) => {
      const text = clean(value, 180);
      if (!text) return;
      const phrase = describeSemanticPhrase(text);
      result.push({
        role, text, head: phrase.head, modifiers: phrase.modifiers,
        marker: clean(marker, 24) || null, grammaticalCase, confidence,
        provenance: { source: "semantic_core_rule", rule }
      });
    };
    if (PASSIVE_PREDICATES.has(verb)) {
      const passiveThemeRole = PASSIVE_TRANSFER_PREDICATES.has(verb) ? "theme" : "patient";
      add(passiveThemeRole, actor, null, "nominative", 0.82, "passive_surface_subject");
      for (const complement of splitPassiveComplements(object, predicate)) {
        add(complement.role, complement.text, complement.marker,
          complement.grammaticalCase, complement.confidence, complement.rule);
      }
      return result.slice(0, 7);
    }
    const subjectRole = RECEIVING_PREDICATES.has(verb) ? "recipient"
      : CAUSATIVE_PREDICATES.has(verb) ? "cause" : "agent";
    add(subjectRole, actor, null, "nominative", 0.8, "bounded_verb_valency");
    const split = splitSemanticComplements(object, predicate);
    if (split.theme) {
      const themeRole = CAUSATIVE_PREDICATES.has(verb) ? "effect"
        : RECEIVING_PREDICATES.has(verb) || TRANSFER_PREDICATES.has(verb) ||
          /^(?:сохраняет|сохраняют|хранит|хранят|выбирает|выбирают|измеряет|измеряют|обрабатывает|обрабатывают)$/u.test(verb)
          ? "theme" : "patient";
      add(themeRole, split.theme, null, "accusative", 0.76, "verb_object_valency");
    }
    for (const complement of split.complements) add(complement.role, complement.text, complement.marker,
      complement.grammaticalCase, complement.confidence, complement.rule);
    return result.slice(0, 7);
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
    const validatedSubject = part(source.subject || base.subject, 180);
    const validatedPredicate = part(source.predicate || base.predicate, 100);
    const validatedObject = part(source.object || base.object, 220);
    const argumentsFrame = buildSemanticArguments(validatedSubject, validatedPredicate, validatedObject);
    return {
      schema: "NG_PROPOSITION_FRAME_V1",
      kind,
      subject: validatedSubject || null,
      predicate: validatedPredicate || null,
      object: validatedObject || null,
      arguments: argumentsFrame,
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
      references: validatePropositionReferences(source.references,
        Array.isArray(base.references) ? base.references : undefined),
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.25
    };
  }

  const PROPOSITION_CHAIN_SCHEMA = "NG_PROPOSITION_CHAIN_V1";
  const PROPOSITION_LINK_TYPES = Object.freeze([
    "root", "next_sentence", "condition_result", "condition_of_previous",
    "cause_of_previous", "result_of_previous", "contrast", "sequence", "addition", "relative_modifier", "unknown"
  ]);

  function splitDiscourseSegments(value) {
    const source = String(value == null ? "" : value).slice(0, 800);
    if (!source.trim()) return [];
    const sentences = source.split(/(?<=[.!?;])\s+/u).map(part => part.trim()).filter(Boolean);
    const segments = [];
    const cleanClause = part => clean(part, 300).replace(/[.!?;]+$/u, "").trim();
    const add = (text, relation, metadata = {}) => {
      const clause = cleanClause(text);
      if (!clause) return;
      segments.push({
        text: clause,
        sourceText: String(metadata.sourceText == null ? text : metadata.sourceText).slice(0, 300).trim(),
        relation,
        marker: clean(metadata.marker, 40) || null,
        rule: clean(metadata.rule, 80) || "sentence_boundary",
        direction: ["current_to_previous", "previous_to_current", "current_before_previous", "undirected"].includes(metadata.direction)
          ? metadata.direction : "undirected",
        confidence: Number.isFinite(Number(metadata.confidence))
          ? Math.max(0, Math.min(1, Number(metadata.confidence))) : 0.48
      });
    };
    const detailsFor = (marker, hasPrevious) => {
      const key = normalise(marker);
      if (["потому что", "так как", "поскольку"].includes(key)) {
        return { type: hasPrevious ? "cause_of_previous" : "root", direction: "current_to_previous", confidence: 0.86, rule: "causal_subordinator" };
      }
      if (["поэтому", "в результате", "из за этого"].includes(key)) {
        return { type: hasPrevious ? "result_of_previous" : "root", direction: "previous_to_current", confidence: 0.86, rule: "causal_result_marker" };
      }
      if (["но", "однако", "хотя"].includes(key)) {
        return { type: hasPrevious ? "contrast" : "root", direction: "undirected", confidence: 0.82, rule: "contrast_marker" };
      }
      if (["затем", "потом", "после этого", "после", "позже", "впоследствии", "тогда"].includes(key)) {
        return { type: hasPrevious ? "sequence" : "root", direction: "previous_to_current", confidence: 0.84, rule: "temporal_forward_marker" };
      }
      if (["сначала", "первоначально", "до этого", "ранее", "раньше"].includes(key)) {
        return { type: hasPrevious ? "sequence" : "root", direction: "current_before_previous", confidence: 0.82, rule: "temporal_backward_marker" };
      }
      if (["а также", "кроме того"].includes(key)) {
        return { type: hasPrevious ? "addition" : "root", direction: "undirected", confidence: 0.78, rule: "addition_marker" };
      }
      return { type: hasPrevious ? "next_sentence" : "root", direction: "undirected", confidence: hasPrevious ? 0.48 : 1, rule: "sentence_boundary" };
    };

    for (const sentenceRaw of sentences) {
      const terminal = (sentenceRaw.match(/[.!?;]+$/u) || [""])[0];
      const body = sentenceRaw.replace(/[.!?;]+$/u, "").trim();
      if (!body) continue;
      let match;

      // Attach a bounded relative clause to its matrix clause. The main clause
      // is emitted first so the relative pronoun can resolve to its antecedent.
      match = body.match(/^(.+?),\s*(который|которая|которое|которые|которого|которую|которому|которой|которым|которыми|которых)\s+(.+?),\s*(.+)$/iu);
      if (match) {
        const antecedentPhrase = clean(match[1], 180);
        const relativePronoun = clean(match[2], 24);
        let relativeClause = clean(relativePronoun + " " + match[3], 260);
        const relativeAccusative = relativeClause.match(/^которую\s+(активирует|использует|получает|открывает|обрабатывает|сохраняет|проверяет|изучает|выбирает|измеряет|обнаруживает|запускает|создает|создаёт|защищает|принимает|передает|передаёт)\s+(.+)$/iu);
        if (relativeAccusative) {
          relativeClause = clean(relativeAccusative[2] + " " + relativeAccusative[1] + " которую", 260);
        }
        const mainClause = clean(antecedentPhrase + " " + match[4], 300);
        add(mainClause, segments.length ? "next_sentence" : "root", {
          sourceText: sentenceRaw, marker: relativePronoun,
          rule: "relative_clause_main_clause", confidence: 0.84
        });
        add(relativeClause, "relative_modifier", {
          sourceText: relativePronoun + " " + match[3] + ",", marker: relativePronoun,
          rule: "relative_clause_attachment", direction: "current_to_previous", confidence: 0.86
        });
        continue;
      }

      match = body.match(/^если\s+(.+?),\s*(?:то\s+)?(.+)$/iu);
      if (match) {
        const comma = body.indexOf(",");
        add("Если " + match[1], segments.length ? "next_sentence" : "root", {
          sourceText: body.slice(0, comma + 1), marker: "если", rule: "conditional_if_then",
          direction: "undirected", confidence: 0.9
        });
        add(match[2], "condition_result", {
          sourceText: body.slice(comma + 1).trim() + terminal, marker: "то", rule: "conditional_if_then",
          direction: "previous_to_current", confidence: 0.9
        });
        continue;
      }

      match = body.match(/^(.+?),\s*(?:если|при условии что)\s+(.+)$/iu);
      if (match) {
        const comma = body.indexOf(",");
        add(match[1], segments.length ? "next_sentence" : "root", {
          sourceText: body.slice(0, comma + 1), rule: "conditional_postposed",
          direction: "undirected", confidence: 0.86
        });
        add("Если " + match[2], "condition_of_previous", {
          sourceText: body.slice(comma + 1).trim() + terminal, marker: "если",
          rule: "conditional_postposed", direction: "current_to_previous", confidence: 0.86
        });
        continue;
      }

      match = body.match(/^(?:потому что|так как|поскольку)\s+(.+?),\s*(.+)$/iu);
      if (match) {
        const comma = body.indexOf(",");
        const marker = (body.match(/^(потому что|так как|поскольку)/iu) || [""])[0];
        add(match[1], segments.length ? "next_sentence" : "root", {
          sourceText: body.slice(0, comma + 1), marker, rule: "fronted_cause_clause",
          direction: "undirected", confidence: 0.86
        });
        add(match[2], "result_of_previous", {
          sourceText: body.slice(comma + 1).trim() + terminal, marker,
          rule: "fronted_cause_clause", direction: "previous_to_current", confidence: 0.86
        });
        continue;
      }

      match = body.match(/^(потому что|так как|поскольку|поэтому|в результате|из-за этого|однако|но|затем|потом|после этого|а также|кроме того|сначала|первоначально|после|позже|впоследствии|до этого|ранее|раньше|тогда)\s+(.+)$/iu);
      if (match) {
        const details = detailsFor(match[1], segments.length > 0);
        add(match[2], details.type, {
          sourceText: body + terminal, marker: match[1], rule: details.rule,
          direction: details.direction, confidence: details.confidence
        });
        continue;
      }

      match = body.match(/^хотя\s+(.+?),\s*(.+)$/iu);
      if (match) {
        const comma = body.indexOf(",");
        add("Хотя " + match[1], segments.length ? "next_sentence" : "root", {
          sourceText: body.slice(0, comma + 1), marker: "хотя",
          rule: "concessive_fronting", confidence: 0.82
        });
        add(match[2], "contrast", {
          sourceText: body.slice(comma + 1).trim() + terminal, marker: "хотя",
          rule: "concessive_fronting", direction: "undirected", confidence: 0.82
        });
        continue;
      }
      match = body.match(/^(.+?),\s*хотя\s+(.+)$/iu);
      if (match) {
        const comma = body.indexOf(",");
        add(match[1], segments.length ? "next_sentence" : "root", {
          sourceText: body.slice(0, comma + 1), rule: "concessive_postposing", confidence: 0.82
        });
        add(match[2], "contrast", {
          sourceText: body.slice(comma + 1).trim() + terminal, marker: "хотя",
          rule: "concessive_postposing", direction: "undirected", confidence: 0.82
        });
        continue;
      }

      match = body.match(/^(.+?),\s*(потому что|так как|поскольку|поэтому|в результате|из-за этого|однако|но|затем|потом|после этого|а также|кроме того|сначала|первоначально|после|позже|впоследствии|до этого|ранее|раньше)\s+(.+)$/iu);
      if (match) {
        const comma = body.indexOf(",");
        const details = detailsFor(match[2], true);
        add(match[1], segments.length ? "next_sentence" : "root", {
          sourceText: body.slice(0, comma + 1), rule: "clause_before_discourse_marker",
          direction: "undirected", confidence: 0.84
        });
        add(match[3], details.type, {
          sourceText: body.slice(comma + 1).trim() + terminal, marker: match[2],
          rule: details.rule, direction: details.direction, confidence: details.confidence
        });
        continue;
      }

      add(body, segments.length ? "next_sentence" : "root", {
        sourceText: sentenceRaw, rule: "sentence_boundary",
        direction: "undirected", confidence: segments.length ? 0.48 : 1
      });
    }
    return segments.slice(0, 6);
  }

  function validatePropositionChain(raw, fallback = null) {
    const validContainer = value => value && typeof value === "object" &&
      !Array.isArray(value) && Array.isArray(value.items);
    const local = validContainer(fallback) ? fallback : null;
    const supplied = validContainer(raw) ? raw : null;
    const localItems = local ? local.items : [];
    const useLocal = localItems.length >= 2;
    const source = useLocal ? local : supplied;
    const sourceItems = source ? source.items : localItems;
    const items = [];
    const known = new Set();

    for (let index = 0; index < sourceItems.length && items.length < 6; index++) {
      const row = sourceItems[index] && typeof sourceItems[index] === "object"
        ? sourceItems[index] : {};
      const id = clean(row.id || "p" + (index + 1), 8);
      if (!/^p[1-6]$/u.test(id) || known.has(id)) continue;
      const text = clean(row.text, 300);
      if (!text) continue;
      const link = row.relationToPrevious && typeof row.relationToPrevious === "object"
        ? row.relationToPrevious : {};
      const type = index === 0 ? "root"
        : PROPOSITION_LINK_TYPES.includes(link.type) && link.type !== "root"
          ? link.type : "unknown";
      const referenceId = index === 0 ? null : clean(link.referenceId, 8);
      if (index > 0 && !known.has(referenceId)) continue;
      const confidence = Number(link.confidence);
      const provenance = link.provenance && typeof link.provenance === "object" ? link.provenance : {};
      const direction = ["current_to_previous", "previous_to_current", "current_before_previous", "undirected"].includes(provenance.direction)
        ? provenance.direction : "undirected";
      items.push({
        id, text,
        sourceText: useLocal && typeof row.sourceText === "string" ? row.sourceText.slice(0, 300) : text,
        proposition: validateProposition(row.proposition, {}),
        relationToPrevious: {
          type, referenceId,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.2,
          provenance: {
            source: provenance.source === "semantic_core_rule" ? "semantic_core_rule"
              : provenance.source === "model_candidate" ? "model_candidate" : "unknown",
            rule: clean(provenance.rule, 80) || null,
            marker: clean(provenance.marker, 40) || null,
            direction
          }
        }
      });
      known.add(id);
    }

    const sourceText = local && typeof local.sourceText === "string" ? local.sourceText.slice(0, 800)
      : source && typeof source.sourceText === "string" ? source.sourceText.slice(0, 800) : null;
    return {
      schema: PROPOSITION_CHAIN_SCHEMA,
      version: 1,
      sourceText,
      items: items.length >= 2 ? items : []
    };
  }

  function extractPropositionChain(value) {
    const sourceText = String(value == null ? "" : value).slice(0, 800);
    const segments = splitDiscourseSegments(sourceText);
    if (segments.length < 2) {
      return { schema: PROPOSITION_CHAIN_SCHEMA, version: 1, sourceText, items: [] };
    }
    const items = segments.map((segment, index) => {
      const parseText = segment.text.replace(/^(?:(?:а\s+)?(?:там|тогда)|(?:то\s+)+)\s+/iu, "").trim();
      const type = intentType(parseText, answerType(parseText));
      const proposition = extractProposition(parseText, type, surfaceSlots(parseText));
      return {
        id: "p" + (index + 1),
        text: segment.text,
        sourceText: segment.sourceText,
        proposition,
        relationToPrevious: {
          type: index === 0 ? "root" : segment.relation,
          referenceId: index === 0 ? null : "p" + index,
          confidence: segment.confidence,
          provenance: {
            source: "semantic_core_rule",
            rule: segment.rule,
            marker: segment.marker,
            direction: segment.direction
          }
        }
      };
    });
    // Build validated semantic arguments before discourse resolution. Without
    // this pass the resolver can only see legacy subject/object strings and
    // loses the roles already available from the local proposition parser.
    const preparedItems = items.map(item => ({
      ...item,
      proposition: validateProposition(item.proposition, {})
    }));
    const localChain = {
      schema: PROPOSITION_CHAIN_SCHEMA, version: 1, sourceText,
      items: resolvePropositionReferences(preparedItems)
    };
    return validatePropositionChain(localChain, localChain);
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
      propositionChain: validatePropositionChain(source.propositionChain, base.propositionChain),
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
    const originalText = String(value == null ? "" : value).slice(0, 800);
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
      propositionChain: extractPropositionChain(originalText),
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
    validatePropositionChain,
    splitDiscourseSegments,
    extractPropositionChain,
    analyse,
    validateFrame,
    toSearchQueries
  });
})();