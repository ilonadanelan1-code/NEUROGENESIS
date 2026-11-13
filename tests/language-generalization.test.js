"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const window = {};
const sandbox = { window, Date, Math, Map, Set, JSON, RegExp, Object, Array, String, Number };
for (const file of ["knowledge.js", "semantic-core.js", "contextual-attention.js", "phrase-composition.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const core = window.NGSemanticCore;
const knowledge = window.NGKnowledge;
const Attention = window.NGContextualModel;
const Composer = window.NGPhraseCompositionModel;
assert.ok(core && knowledge && Attention && Composer, "all language benchmark modules must load");

const trainRows = [
  "нейрон получает сигнал", "сеть получает сигнал", "система получает данные", "память получает данные",
  "нейрон обрабатывает данные", "сеть обрабатывает сигнал", "система обрабатывает данные", "модель обрабатывает сигнал",
  "память хранит данные", "система хранит сигнал", "ключ открывает замок", "программа открывает файл",
  "алгоритм выбирает маршрут", "система выбирает режим", "сенсор обнаруживает сигнал", "датчик обнаруживает импульс",
  "исследователь проверяет гипотезу", "модель проверяет гипотезу", "память сохраняет событие", "система сохраняет данные",
  "датчик измеряет температуру", "сенсор измеряет сигнал", "модель изучает контекст", "контекст меняет значение",
  "замок защищает помещение", "сигнал активирует нейрон", "ключ запускает программу", "программа использует ключ"
];

const cases = [
  { group: "short", text: "нейросеть обрабатывает команду", roles: { s: ["нейросеть"], p: ["обрабатывает"], o: ["команду"] }, expected: { kind: "assertion", s: "нейросеть", p: "обрабатывает", o: "команду" } },
  { group: "short", text: "датчик обнаруживает вибрацию", roles: { s: ["датчик"], p: ["обнаруживает"], o: ["вибрацию"] }, expected: { kind: "assertion", s: "датчик", p: "обнаруживает", o: "вибрацию" } },
  { group: "short", text: "система сохраняет результат", roles: { s: ["система"], p: ["сохраняет"], o: ["результат"] }, expected: { kind: "assertion", s: "система", p: "сохраняет", o: "результат" } },
  { group: "short", text: "алгоритм выбирает решение", roles: { s: ["алгоритм"], p: ["выбирает"], o: ["решение"] }, expected: { kind: "assertion", s: "алгоритм", p: "выбирает", o: "решение" } },
  { group: "short", text: "сигнал активирует механизм", roles: { s: ["сигнал"], p: ["активирует"], o: ["механизм"] }, expected: { kind: "assertion", s: "сигнал", p: "активирует", o: "механизм" } },
  { group: "short", text: "контекст меняет интерпретацию", roles: { s: ["контекст"], p: ["меняет"], o: ["интерпретацию"] }, expected: { kind: "assertion", s: "контекст", p: "меняет", o: "интерпретацию" } },

  { group: "long", text: "Новый сенсорный модуль обнаруживает вибрацию корпуса.", roles: { s: ["новый", "сенсорный", "модуль"], p: ["обнаруживает"], o: ["вибрацию", "корпуса"] }, expected: { kind: "assertion", s: "модуль", p: "обнаруживает", o: "вибрацию корпуса" } },
  { group: "long", text: "Центральный контроллер сохраняет результаты измерения в архиве.", roles: { s: ["центральный", "контроллер"], p: ["сохраняет"], o: ["результаты", "измерения"] }, expected: { kind: "assertion", s: "контроллер", p: "сохраняет", o: "результаты измерения" } },
  { group: "long", text: "После проверки алгоритм выбирает безопасный маршрут обхода.", roles: { s: ["алгоритм"], p: ["выбирает"], o: ["безопасный", "маршрут", "обхода"] }, expected: { kind: "assertion", s: "алгоритм", p: "выбирает", o: "безопасный маршрут обхода" } },

  { group: "word_order", text: "Сигнал нейрон получает.", roles: { s: ["нейрон"], p: ["получает"], o: ["сигнал"] }, expected: { kind: "assertion", s: "нейрон", p: "получает", o: "сигнал" } },
  { group: "word_order", text: "Данные система сохраняет.", roles: { s: ["система"], p: ["сохраняет"], o: ["данные"] }, expected: { kind: "assertion", s: "система", p: "сохраняет", o: "данные" } },
  { group: "word_order", text: "Гипотезу исследователь проверяет.", roles: { s: ["исследователь"], p: ["проверяет"], o: ["гипотезу"] }, expected: { kind: "assertion", s: "исследователь", p: "проверяет", o: "гипотезу" } },
  { group: "word_order", text: "Сигнал система сохраняет.", roles: { s: ["система"], p: ["сохраняет"], o: ["Сигнал"] }, expected: { kind: "assertion", s: "система", p: "сохраняет", o: "Сигнал" } },
  { group: "word_order", text: "Новый сигнал опытный нейрон получает.", roles: { s: ["опытный", "нейрон"], p: ["получает"], o: ["Новый", "сигнал"] }, expected: { kind: "assertion", s: "опытный нейрон", p: "получает", o: "Новый сигнал" } },
  { group: "word_order", text: "Безопасный маршрут алгоритм выбирает.", roles: { s: ["алгоритм"], p: ["выбирает"], o: ["безопасный", "маршрут"] }, expected: { kind: "assertion", s: "алгоритм", p: "выбирает", o: "безопасный маршрут" } },
  { group: "word_order", text: "Вибрацию сенсор обнаруживает.", roles: { s: ["сенсор"], p: ["обнаруживает"], o: ["Вибрацию"] }, expected: { kind: "assertion", s: "сенсор", p: "обнаруживает", o: "Вибрацию" } },
  { group: "word_order", text: "Новое сообщение сервер отправляет.", roles: { s: ["сервер"], p: ["отправляет"], o: ["Новое", "сообщение"] }, expected: { kind: "assertion", s: "сервер", p: "отправляет", o: "Новое сообщение" } },
  { group: "word_order", text: "Сигнал сенсор не получает.", roles: { s: ["сенсор"], p: ["получает"], o: ["Сигнал"] }, expected: { kind: "assertion", s: "сенсор", p: "получает", o: "Сигнал", polarity: "negative" } },
  { group: "word_order", text: "Сигнал новые нейроны получают.", roles: { s: ["новые", "нейроны"], p: ["получают"], o: ["Сигнал"] }, expected: { kind: "assertion", s: "новые нейроны", p: "получают", o: "Сигнал" } },

  { group: "oov", text: "Кварцевый сенсор обнаруживает микровибрацию.", roles: { s: ["кварцевый", "сенсор"], p: ["обнаруживает"], o: ["микровибрацию"] }, expected: { kind: "assertion", s: "сенсор", p: "обнаруживает", o: "микровибрацию" } },
  { group: "oov", text: "Лидар обнаруживает препятствие.", roles: { s: ["лидар"], p: ["обнаруживает"], o: ["препятствие"] }, expected: { kind: "assertion", s: "лидар", p: "обнаруживает", o: "препятствие" } },
  { group: "oov", text: "Гироскоп измеряет угловую скорость.", roles: { s: ["гироскоп"], p: ["измеряет"], o: ["угловую", "скорость"] }, expected: { kind: "assertion", s: "гироскоп", p: "измеряет", o: "угловую скорость" } },

  { group: "paraphrase", text: "Сенсор фиксирует колебания.", roles: { s: ["сенсор"], p: ["фиксирует"], o: ["колебания"] }, expected: { kind: "assertion", s: "сенсор", p: "фиксирует", o: "колебания" } },
  { group: "paraphrase", text: "Устройство регистрирует импульс.", roles: { s: ["устройство"], p: ["регистрирует"], o: ["импульс"] }, expected: { kind: "assertion", s: "устройство", p: "регистрирует", o: "импульс" } },
  { group: "paraphrase", text: "Алгоритм делает выбор маршрута.", roles: { s: ["алгоритм"], p: ["делает"], o: ["выбор", "маршрута"] }, expected: { kind: "assertion", s: "алгоритм", p: "делает", o: "выбор маршрута" } },

  { group: "negation", text: "Система не получает сигнал.", expected: { kind: "assertion", polarity: "negative", scope: "predicate", effect: "negative" } },
  { group: "negation", text: "Не все датчики обнаруживают вибрацию.", expected: { kind: "assertion", polarity: "mixed", scope: "quantifier", quantifier: "all", effect: "not_all" } },
  { group: "negation", text: "Ни один модуль не сохраняет данные.", expected: { kind: "assertion", polarity: "negative", scope: "quantifier", quantifier: "none", effect: "none_negative" } },

  { group: "modality", text: "Возможно, новый модуль активирует резервный канал.", expected: { kind: "hypothesis", modality: "possible" } },
  { group: "modality", text: "Система может обнаружить помеху.", expected: { kind: "hypothesis", modality: "possible" } },
  { group: "modality", text: "Вероятно, датчик сохранит измерение.", expected: { kind: "hypothesis", modality: "possible" } },

  { group: "causality", text: "Недостаток сна может приводить к усталости.", expected: { kind: "hypothesis", modality: "possible", relation: "causal" } },
  { group: "causality", text: "Сеть не активируется, потому что питание не работает.", expected: { chain: ["root", "cause_of_previous"], chainPolarities: ["negative", "negative"] } },
  { group: "causality", text: "Потому что питание не работает, сеть не активируется.", expected: { chain: ["root", "result_of_previous"], chainPolarities: ["negative", "negative"] } },
  { group: "causality", text: "Перегрев вызывает сбой.", expected: { kind: "assertion", relation: "causal" } },
  { group: "causality", text: "Сбой происходит из-за перегрева.", expected: { kind: "assertion", relation: "causal" } },

  { group: "condition", text: "Если датчик обнаруживает вибрацию, система запускает защитный режим.", expected: { chain: ["root", "condition_result"] } },
  { group: "condition", text: "Модуль активируется, если система получает сигнал.", expected: { chain: ["root", "condition_of_previous"] } },

  { group: "contrast", text: "Модуль получает данные, однако контроллер не сохраняет результат.", expected: { chain: ["root", "contrast"] } },
  { group: "contrast", text: "Система работает, однако сеть не активируется.", expected: { chain: ["root", "contrast"] } },

  { group: "temporal", text: "Модель запускает процесс. Затем он сохраняет результат.", expected: { chain: ["root", "sequence"], secondSubject: "процесс", references: ["resolved"] } },
  { group: "temporal", text: "Вчера система работала. Тогда система активировалась.", expected: { chain: ["root", "sequence"], referenceTarget: { type: "time", status: "resolved", text: "вчера" } } },

  { group: "coref_resolved", text: "Система получает сигнал. Она активируется.", expected: { references: ["resolved"], secondSubject: "система" } },
  { group: "coref_resolved", text: "Модель получает данные. Затем она обрабатывает их.", expected: { references: ["resolved", "resolved"], secondSubject: "модель" } },

  { group: "coref_ambiguous", text: "Модель использует нейросеть. Она активируется.", expected: { references: ["ambiguous"], secondSubject: "она", candidateCount: 2 } },
  { group: "coref_ambiguous", text: "Система активирует модель. Она работает.", expected: { references: ["ambiguous"], secondSubject: "она", candidateCount: 2 } },

  { group: "coref_unresolved", text: "Она активируется. Система получает сигнал.", expected: { references: ["unresolved"], firstSubject: "она" } },
  { group: "coref_unresolved", text: "Он сохраняет результат. Модуль работает.", expected: { references: ["unresolved"], firstSubject: "он" } },

  { group: "location", text: "Система работает в лаборатории. Там система активируется.", expected: { referenceTarget: { type: "location", status: "resolved", text: "лаборатории" } } }
];

const normalise = value => String(value == null ? "" : value).normalize("NFKC").toLowerCase()
  .replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
const trainingKeys = new Set(trainRows.map(normalise));
const heldOutKeys = new Set(cases.map(row => normalise(row.text)));
const leakage = cases.filter(row => trainingKeys.has(normalise(row.text))).map(row => row.text);
assert.equal(trainingKeys.size, trainRows.length, "training sentences must be unique");
assert.equal(heldOutKeys.size, cases.length, "independent benchmark sentences must be unique");
assert.deepEqual(leakage, [], "no independent benchmark sentence may appear in the training corpus");
assert.equal(cases.length, 49, "the independent benchmark corpus size is fixed and documented");

function semanticResult(testCase) {
  const frame = core.analyse(testCase.text, { contextRelation: "new_topic" }, knowledge);
  const proposition = frame.proposition || {};
  const chain = frame.propositionChain && Array.isArray(frame.propositionChain.items)
    ? frame.propositionChain.items : [];
  const references = chain.flatMap(row => Array.isArray(row.proposition.references) ? row.proposition.references : []);
  const expected = testCase.expected || {};
  const checks = [];
  const add = (name, ok) => checks.push({ name, ok: !!ok });

  if (expected.kind !== undefined) add("kind", proposition.kind === expected.kind);
  if (expected.polarity !== undefined) add("polarity", proposition.polarity === expected.polarity);
  if (expected.modality !== undefined) add("modality", proposition.modality === expected.modality);
  if (expected.relation !== undefined) add("relation", proposition.relation === expected.relation);
  if (expected.scope !== undefined) add("scope", proposition.polarityScope && proposition.polarityScope.scope === expected.scope);
  if (expected.quantifier !== undefined) add("quantifier", proposition.polarityScope && proposition.polarityScope.quantifier === expected.quantifier);
  if (expected.effect !== undefined) add("scopeEffect", proposition.polarityScope && proposition.polarityScope.effect === expected.effect);
  if (expected.s !== undefined) add("subject", normalise(proposition.subject).includes(normalise(expected.s)));
  if (expected.p !== undefined) add("predicate", normalise(proposition.predicate).includes(normalise(expected.p)));
  if (expected.o !== undefined) add("object", normalise(proposition.object).includes(normalise(expected.o)));
  if (expected.chain !== undefined) {
    add("chainRelations", JSON.stringify(chain.map(row => row.relationToPrevious.type)) === JSON.stringify(expected.chain));
    add("sourceText", !!frame.propositionChain && frame.propositionChain.sourceText === testCase.text);
  }
  if (expected.chainPolarities !== undefined) {
    add("chainPolarities", JSON.stringify(chain.map(row => row.proposition.polarity)) === JSON.stringify(expected.chainPolarities));
  }
  if (expected.references !== undefined) {
    add("referenceStatuses", JSON.stringify(references.map(row => row.status)) === JSON.stringify(expected.references));
  }
  if (expected.secondSubject !== undefined) {
    add("secondSubject", normalise(chain[1] && chain[1].proposition.subject).includes(normalise(expected.secondSubject)));
  }
  if (expected.firstSubject !== undefined) {
    add("firstSubject", normalise(chain[0] && chain[0].proposition.subject).includes(normalise(expected.firstSubject)));
  }
  if (expected.referenceTarget !== undefined) {
    const target = expected.referenceTarget;
    add("referenceTarget", references.some(row => row.targetType === target.type &&
      row.status === target.status && normalise(row.antecedentText).includes(normalise(target.text))));
  }
  if (expected.candidateCount !== undefined) {
    add("candidateCount", references.some(row => row.status === "ambiguous" && row.candidates.length === expected.candidateCount));
  }
  return { checks, passed: checks.every(row => row.ok) };
}

const semanticGroups = {};
const semanticFailures = [];
for (const testCase of cases) {
  const result = semanticResult(testCase);
  const group = semanticGroups[testCase.group] || (semanticGroups[testCase.group] = {
    cases: 0, passedCases: 0, checks: 0, passedChecks: 0
  });
  group.cases++;
  if (result.passed) group.passedCases++;
  group.checks += result.checks.length;
  group.passedChecks += result.checks.filter(row => row.ok).length;
  if (!result.passed) semanticFailures.push({
    group: testCase.group, text: testCase.text,
    failed: result.checks.filter(row => !row.ok).map(row => row.name)
  });
}

const seeds = [
  { model: 9173, split: 902, phrase: 9044 },
  { model: 2718, split: 1207, phrase: 1207 },
  { model: 31415, split: 2718, phrase: 2718 }
];
const maskGroups = {};
const surfaceMaskGroups = {};
const phraseGroups = {};
const phraseGroupsWithoutAugmentation = {};
const relationThresholds = [0.34, 0.40, 0.45, 0.50, 0.55];
const makeThresholdBuckets = () => Object.fromEntries(
  relationThresholds.map(value => [value.toFixed(2), {tp:0,fp:0,fn:0}])
);
const relationThresholdSweep = {
  withAugmentation: makeThresholdBuckets(),
  withoutAugmentation: makeThresholdBuckets()
};
const roleGatedRelationThresholdSweep = {
  withAugmentation: makeThresholdBuckets(),
  withoutAugmentation: makeThresholdBuckets()
};
const relationRolePairs = {
  subject_to_predicate:["subject","predicate"],
  predicate_to_object:["predicate","object"],
  subject_to_object:["subject","object"]
};
function accumulateThresholdSweep(buckets, result, expectedEdges) {
  const candidates = Array.isArray(result.relationCandidates)
    ? result.relationCandidates : result.edges;
  for (const threshold of relationThresholds) {
    const predicted = new Set(candidates.filter(edge => edge.confidence >= threshold).slice(0, 16)
      .map(edge => [edge.from, edge.to, edge.relation].join(":")));
    const bucket = buckets[threshold.toFixed(2)];
    for (const edge of expectedEdges) {
      if (predicted.has(edge)) bucket.tp++;
      else bucket.fn++;
    }
    for (const edge of predicted) if (!expectedEdges.has(edge)) bucket.fp++;
  }
}
function accumulateRoleGatedThresholdSweep(buckets, result, expectedEdges) {
  const candidates = Array.isArray(result.relationCandidates)
    ? result.relationCandidates : result.edges;
  for (const threshold of relationThresholds) {
    const predicted = new Set(candidates.filter(edge => {
      const required = relationRolePairs[edge.relation];
      return required && edge.confidence >= threshold &&
        result.roles[edge.from]?.role === required[0] &&
        result.roles[edge.to]?.role === required[1];
    }).slice(0, 16).map(edge => [edge.from, edge.to, edge.relation].join(":")));
    const bucket = buckets[threshold.toFixed(2)];
    for (const edge of expectedEdges) {
      if (predicted.has(edge)) bucket.tp++;
      else bucket.fn++;
    }
    for (const edge of predicted) if (!expectedEdges.has(edge)) bucket.fp++;
  }
}
const seedReports = [];
let baselineShort = null;
let firstModel = null;

for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++) {
  const seed = seeds[seedIndex];
  const contextual = Attention.create({
    dimension: 12, windowSize: 4, heads: 3, blocks: 2, seed: seed.model
  });
  const contextualReport = contextual.train(trainRows, {
    epochs: 55, learningRate: 0.035, splitSeed: seed.split, patience: 24
  });
  assert.equal(contextualReport.evaluationMode, "held_out_sentences");
  assert.equal(contextualReport.evaluationIsolated, true);
  assert.equal(contextualReport.splitFallback, false);
  assert.equal(contextualReport.uniqueRows, trainRows.length);
  assert.equal(contextualReport.duplicateRows, 0);
  assert.equal(contextualReport.trainRows + contextualReport.validationRows + contextualReport.testRows, trainRows.length);
  assert.ok(contextualReport.validationExamples > 0 && contextualReport.testExamples > 0);
  if (seedIndex === 0) firstModel = contextual;

  // Paired control: same encoder, same phrase seed and hyperparameters; only SOV augmentation is disabled.
  const composerWithoutAugmentation = Composer.create({ dimension: 12, seed: seed.phrase });
  const composerWithoutAugmentationTraining = composerWithoutAugmentation.train(
    trainRows, contextual, core, knowledge, {
      epochs: 45, learningRate: 0.045,
      augmentWordOrder: false, augmentationWeight: 0.3, excludeSentences: cases.map(row => row.text)
    }
  );
  assert.equal(composerWithoutAugmentationTraining.sourceSentences, trainRows.length);
  assert.equal(composerWithoutAugmentationTraining.augmentedSentences, 0);
  assert.equal(composerWithoutAugmentationTraining.evaluation, "training_only_not_held_out");

  const composer = Composer.create({ dimension: 12, seed: seed.phrase });
  const composerTraining = composer.train(trainRows, contextual, core, knowledge, {
    epochs: 45, learningRate: 0.045,
    augmentWordOrder: true, augmentationWeight: 0.3, excludeSentences: cases.map(row => row.text)
  });
  assert.equal(composerTraining.sourceSentences, trainRows.length);
  assert.ok(composerTraining.augmentedSentences > 0, "verified word-order permutations must expand phrase training");
  assert.ok(composerTraining.excludedAugmentations > 0, "held-out phrases must be excluded from augmentation");
  assert.equal(composerTraining.sentences, trainRows.length + composerTraining.augmentedSentences);
  assert.equal(composerTraining.evaluation, "training_only_not_held_out");

  let seedCorrect = 0;
  let seedCovered = 0;
  let seedTotal = 0;
  let seedMorphologyCorrect = 0, seedMorphologyCovered = 0, seedMorphologyBackoffs = 0, seedMorphologyAmbiguous = 0;
  let seedGeneratedCorrect = 0, seedGeneratedCovered = 0, seedGeneratedOovTargets = 0, seedGeneratedCandidateHits = 0;
  let seedContextMorphologyBackoffs = 0;
  let seedRetrievalCorrect=0,seedRetrievalCovered=0,seedRetrievalOovTargets=0;
  const seedRetrievalExamples=[];
  const seedGeneratedExamples = [];
  for (const testCase of cases) {
    const tokens = knowledge.tokens(testCase.text);
    const group = maskGroups[testCase.group] || (maskGroups[testCase.group] = {
      correct: 0, covered: 0, total: 0,
      morphologyCorrect: 0, morphologyCovered: 0, morphologyBackoffs: 0, morphologyAmbiguous: 0,
      generatedCorrect: 0, generatedCovered: 0, generatedOovTargets: 0,
      generatedCandidateHits: 0, generatedExamples: [], contextMorphologyBackoffs: 0,
      retrievalCorrect:0,retrievalCovered:0,retrievalOovTargets:0,retrievalExamples:[]
    });
    for (let index = 0; index < tokens.length; index++) {
      const score = contextual.score(testCase.text, index);
      group.total++;
      seedTotal++;
      if(score){
        group.contextMorphologyBackoffs+=score.contextMorphologyBackoffs.length;
        seedContextMorphologyBackoffs+=score.contextMorphologyBackoffs.length;
      }
      if (score && score.targetKnown) {
        group.covered++;
        seedCovered++;
        if (score.predictions[0] && score.predictions[0].token === tokens[index]) {
          group.correct++;
          seedCorrect++;
        }
      }
      if (score && score.morphologyKnown) {
        group.morphologyCovered++;
        seedMorphologyCovered++;
        if (score.morphologyCorrect) {
          group.morphologyCorrect++;
          seedMorphologyCorrect++;
        }
      }
      if (score && score.morphologyBackoff) {
        group.morphologyBackoffs++;
        seedMorphologyBackoffs++;
      }
      if (score && score.morphologyAmbiguous) {
        group.morphologyAmbiguous++;
        seedMorphologyAmbiguous++;
      }
      if (score && !score.targetKnown) {
        group.generatedOovTargets++;
        seedGeneratedOovTargets++;
        const maskedPrediction=contextual.predictMasked(testCase.text,index);
        const generated=maskedPrediction&&maskedPrediction.generatedPrediction;
        if(generated){
          group.generatedCovered++;
          seedGeneratedCovered++;
          if(generated.surface===tokens[index]){
            group.generatedCorrect++;
            seedGeneratedCorrect++;
          }
        }
        const candidateHit=!!(maskedPrediction&&maskedPrediction.generatedCandidates.some(row=>row.surface===tokens[index]));
        if(candidateHit){
          group.generatedCandidateHits++;
          seedGeneratedCandidateHits++;
        }
        if(seedGeneratedExamples.length<12){
          seedGeneratedExamples.push({
            group:testCase.group,target:tokens[index],
            top1:generated?generated.surface:null,
            base:generated?generated.baseToken:null,
            candidateForms:maskedPrediction?maskedPrediction.generatedCandidates.map(row=>row.surface):[],
            candidateHit
          });
        }
        group.retrievalOovTargets++;
        seedRetrievalOovTargets++;
        const retrieved=maskedPrediction&&maskedPrediction.retrievalPrediction;
        if(retrieved){
          group.retrievalCovered++;
          seedRetrievalCovered++;
          if(retrieved.surface===tokens[index]){
            group.retrievalCorrect++;
            seedRetrievalCorrect++;
          }
        }
        if(seedRetrievalExamples.length<12){
          seedRetrievalExamples.push({group:testCase.group,target:tokens[index],
            surface:retrieved?retrieved.surface:null,base:retrieved?retrieved.baseToken:null,
            matchedContext:retrieved?retrieved.matchedContextTokens:[]});
        }
        if(group.retrievalExamples.length<12)group.retrievalExamples.push({
          target:tokens[index],surface:retrieved?retrieved.surface:null,base:retrieved?retrieved.baseToken:null,
          matchedContext:retrieved?retrieved.matchedContextTokens:[]});
      }
    }
  }

  let seedSurfaceCorrect=0,seedSurfaceCovered=0,seedSurfaceTotal=0;
  let seedSurfaceMorphologyCorrect=0,seedSurfaceMorphologyCovered=0;
  let seedSurfaceGeneratedCorrect=0,seedSurfaceGeneratedCovered=0,seedSurfaceOovTargets=0,seedSurfaceCandidateHits=0;
  let seedSurfaceRetrievalLemmaCorrect=0,seedSurfaceRetrievalLemmaCovered=0,seedSurfaceRetrievalSurfaceCorrect=0,seedSurfaceRetrievalSurfaceCovered=0;
  let seedSurfaceContextMorphologyBackoffs=0;
  let seedInversionLemmaCorrect=0,seedInversionLemmaCovered=0,seedInversionSurfaceCorrect=0,seedInversionSurfaceCovered=0;
  let seedInversionIdfLemmaCorrect=0,seedInversionIdfLemmaCovered=0,seedInversionIdfSurfaceCorrect=0,seedInversionIdfSurfaceCovered=0;
  for(const testCase of cases){
    const surfaceTokens=Attention.tokenize(testCase.text);
    const group=surfaceMaskGroups[testCase.group]||(surfaceMaskGroups[testCase.group]={
      correct:0,covered:0,total:0,morphologyCorrect:0,morphologyCovered:0,
      generatedCorrect:0,generatedCovered:0,oovTargets:0,candidateHits:0,
      retrievalLemmaCorrect:0,retrievalLemmaCovered:0,retrievalSurfaceCorrect:0,retrievalSurfaceCovered:0,
      contextMorphologyBackoffs:0,examples:[]
    });
    for(let index=0;index<surfaceTokens.length;index++){
      const score=contextual.score(testCase.text,index);
      group.total++;seedSurfaceTotal++;
      if(!score)continue;
      group.contextMorphologyBackoffs+=score.contextMorphologyBackoffs.length;
      seedSurfaceContextMorphologyBackoffs+=score.contextMorphologyBackoffs.length;
      if(score.targetKnown){
        group.covered++;seedSurfaceCovered++;
        if(score.predictions[0]?.token===surfaceTokens[index]){group.correct++;seedSurfaceCorrect++;}
      }
      if(score.morphologyKnown){
        group.morphologyCovered++;seedSurfaceMorphologyCovered++;
        if(score.morphologyCorrect){group.morphologyCorrect++;seedSurfaceMorphologyCorrect++;}
      }
      if(!score.targetKnown){
        group.oovTargets++;seedSurfaceOovTargets++;
        const prediction=contextual.predictMasked(testCase.text,index);
        const generated=prediction?.generatedPrediction;
        if(generated){
          group.generatedCovered++;seedSurfaceGeneratedCovered++;
          if(generated.surface===surfaceTokens[index]){group.generatedCorrect++;seedSurfaceGeneratedCorrect++;}
        }
        if(prediction?.generatedCandidates.some(row=>row.surface===surfaceTokens[index])){
          group.candidateHits++;seedSurfaceCandidateHits++;
        }
        const retrieval=prediction?.retrievalCandidate;
        if(retrieval){
          group.retrievalLemmaCovered++;seedSurfaceRetrievalLemmaCovered++;
          if(Attention.russianStem(retrieval.token)===Attention.russianStem(surfaceTokens[index])){
            group.retrievalLemmaCorrect++;seedSurfaceRetrievalLemmaCorrect++;
          }
        }
        const retrievalSurface=prediction?.retrievalPrediction;
        if(retrievalSurface){
          group.retrievalSurfaceCovered++;seedSurfaceRetrievalSurfaceCovered++;
          if(retrievalSurface.surface===surfaceTokens[index]){
            group.retrievalSurfaceCorrect++;seedSurfaceRetrievalSurfaceCorrect++;
          }
        }
        const inversionPrediction=contextual.predictMasked(testCase.text,index,{allowOrderInversion:true});
        const inversionCandidate=inversionPrediction?.retrievalCandidate;
        if(inversionCandidate){
          seedInversionLemmaCovered++;
          if(Attention.russianStem(inversionCandidate.token)===Attention.russianStem(surfaceTokens[index])){
            seedInversionLemmaCorrect++;
          }
          if(inversionCandidate.token===surfaceTokens[index]){
            seedInversionSurfaceCovered++;
            seedInversionSurfaceCorrect++;
          }
        }
        const inversionIdfPrediction=contextual.predictMasked(testCase.text,index,
          {allowOrderInversion:true,scoring:"inverse_frequency"});
        const inversionIdfCandidate=inversionIdfPrediction?.retrievalCandidate;
        if(inversionIdfCandidate){
          seedInversionIdfLemmaCovered++;
          if(Attention.russianStem(inversionIdfCandidate.token)===Attention.russianStem(surfaceTokens[index])){
            seedInversionIdfLemmaCorrect++;
          }
          if(inversionIdfCandidate.token===surfaceTokens[index]){
            seedInversionIdfSurfaceCovered++;
            seedInversionIdfSurfaceCorrect++;
          }
        }
        if(group.examples.length<12)group.examples.push({
          target:surfaceTokens[index],neuralSurface:generated?.surface||null,
          retrievalBase:retrieval?.token||null,retrievalSurface:retrievalSurface?.surface||null,
          retrievalMatched:retrieval?.sharedTokens||[]
        });
      }
    }
  }
  const seedSurfaceAlignedMasked={
    correct:seedSurfaceCorrect,covered:seedSurfaceCovered,total:seedSurfaceTotal,
    accuracy:seedSurfaceCovered?seedSurfaceCorrect/seedSurfaceCovered:null,
    coverage:seedSurfaceTotal?seedSurfaceCovered/seedSurfaceTotal:null,
    morphology:{correct:seedSurfaceMorphologyCorrect,covered:seedSurfaceMorphologyCovered,
      accuracy:seedSurfaceMorphologyCovered?seedSurfaceMorphologyCorrect/seedSurfaceMorphologyCovered:null},
    neuralOovGeneration:{correct:seedSurfaceGeneratedCorrect,covered:seedSurfaceGeneratedCovered,
      oovTargets:seedSurfaceOovTargets,accuracy:seedSurfaceGeneratedCovered?seedSurfaceGeneratedCorrect/seedSurfaceGeneratedCovered:null,
      coverage:seedSurfaceOovTargets?seedSurfaceGeneratedCovered/seedSurfaceOovTargets:null,
      candidateRecallAt8:seedSurfaceOovTargets?seedSurfaceCandidateHits/seedSurfaceOovTargets:null},
    contextRetrievalLemma:{correct:seedSurfaceRetrievalLemmaCorrect,covered:seedSurfaceRetrievalLemmaCovered,
      oovTargets:seedSurfaceOovTargets,accuracy:seedSurfaceRetrievalLemmaCovered?seedSurfaceRetrievalLemmaCorrect/seedSurfaceRetrievalLemmaCovered:null,
      coverage:seedSurfaceOovTargets?seedSurfaceRetrievalLemmaCovered/seedSurfaceOovTargets:null},
    contextRetrievalSurface:{correct:seedSurfaceRetrievalSurfaceCorrect,covered:seedSurfaceRetrievalSurfaceCovered,
      oovTargets:seedSurfaceOovTargets,accuracy:seedSurfaceRetrievalSurfaceCovered?seedSurfaceRetrievalSurfaceCorrect/seedSurfaceRetrievalSurfaceCovered:null,
      coverage:seedSurfaceOovTargets?seedSurfaceRetrievalSurfaceCovered/seedSurfaceOovTargets:null},
    contextMorphologyBackoffUses:seedSurfaceContextMorphologyBackoffs,
    orderInvariantRetrievalLemma:{correct:seedInversionLemmaCorrect,covered:seedInversionLemmaCovered,oovTargets:seedSurfaceOovTargets,
      accuracy:seedInversionLemmaCovered?seedInversionLemmaCorrect/seedInversionLemmaCovered:null,
      coverage:seedSurfaceOovTargets?seedInversionLemmaCovered/seedSurfaceOovTargets:null},
    orderInvariantRetrievalSurface:{correct:seedInversionSurfaceCorrect,covered:seedInversionSurfaceCovered,oovTargets:seedSurfaceOovTargets,
      accuracy:seedInversionSurfaceCovered?seedInversionSurfaceCorrect/seedInversionSurfaceCovered:null,
      coverage:seedSurfaceOovTargets?seedInversionSurfaceCovered/seedSurfaceOovTargets:null}
,
    orderInvariantIdfLemma:{correct:seedInversionIdfLemmaCorrect,covered:seedInversionIdfLemmaCovered,oovTargets:seedSurfaceOovTargets,
      accuracy:seedInversionIdfLemmaCovered?seedInversionIdfLemmaCorrect/seedInversionIdfLemmaCovered:null,
      coverage:seedSurfaceOovTargets?seedInversionIdfLemmaCovered/seedSurfaceOovTargets:null},
    orderInvariantIdfSurface:{correct:seedInversionIdfSurfaceCorrect,covered:seedInversionIdfSurfaceCovered,oovTargets:seedSurfaceOovTargets,
      accuracy:seedInversionIdfSurfaceCovered?seedInversionIdfSurfaceCorrect/seedInversionIdfSurfaceCovered:null,
      coverage:seedSurfaceOovTargets?seedInversionIdfSurfaceCovered/seedSurfaceOovTargets:null}
  };
  for (const testCase of cases.filter(row => row.roles)) {
    const result = composer.analyse(testCase.text, contextual, core, knowledge);
    const resultWithoutAugmentation = composerWithoutAugmentation.analyse(
      testCase.text, contextual, core, knowledge
    );
    const tokens = result.tokens.map(normalise);
    const controlTokens = resultWithoutAugmentation.tokens.map(normalise);
    assert.deepEqual(controlTokens, tokens,
      "paired phrase heads must be evaluated on identical tokenized test examples");
    const expectedRoles = tokens.map(token =>
      testCase.roles.s.some(value => normalise(value) === token) ? "subject" :
      testCase.roles.p.some(value => normalise(value) === token) ? "predicate" :
      testCase.roles.o.some(value => normalise(value) === token) ? "object" : "other"
    );
    assert.equal(result.roles.length, expectedRoles.length, "phrase-role output must align with manual token labels");
    assert.ok(Array.isArray(result.trustedEdges),
      "analysis must expose a separate role-consistent edge list");
    const legacyEdgeKeys = result.relationCandidates
      .filter(edge => edge.confidence >= 0.34).slice(0, 16)
      .map(edge => [edge.from, edge.to, edge.relation].join(":"));
    assert.deepEqual(result.edges.map(edge => [edge.from, edge.to, edge.relation].join(":")),
      legacyEdgeKeys, "the legacy edge output must remain unchanged");
    const expectedTrustedEdgeKeys = result.relationCandidates.filter(edge => {
      const required = relationRolePairs[edge.relation];
      return required && edge.confidence >= 0.34 &&
        result.roles[edge.from]?.role === required[0] &&
        result.roles[edge.to]?.role === required[1];
    }).slice(0, 16).map(edge => [edge.from, edge.to, edge.relation].join(":"));
    assert.deepEqual(result.trustedEdges.map(edge => [edge.from, edge.to, edge.relation].join(":")),
      expectedTrustedEdgeKeys, "trusted edges must be exactly the confidence- and role-consistent subset");
    for (const edge of result.trustedEdges) {
      const required = relationRolePairs[edge.relation];
      assert.ok(required, "trusted edge relation must have a role signature");
      assert.equal(result.roles[edge.from]?.role, required[0]);
      assert.equal(result.roles[edge.to]?.role, required[1]);
      assert.ok(edge.confidence >= 0.34);
    }
    for (const role of ["s", "p", "o"]) {
      for (const value of testCase.roles[role]) {
        assert.ok(tokens.includes(normalise(value)), "manual phrase annotation must point to an existing token");
      }
    }

    const group = phraseGroups[testCase.group] || (phraseGroups[testCase.group] = {
      roleCorrect: 0, roleTotal: 0, tp: 0, fp: 0, fn: 0
    });
    result.roles.forEach((row, index) => {
      group.roleTotal++;
      if (row.role === expectedRoles[index]) group.roleCorrect++;
    });
    const controlGroup = phraseGroupsWithoutAugmentation[testCase.group] ||
      (phraseGroupsWithoutAugmentation[testCase.group] = {
        roleCorrect: 0, roleTotal: 0, tp: 0, fp: 0, fn: 0
      });
    resultWithoutAugmentation.roles.forEach((row, index) => {
      controlGroup.roleTotal++;
      if (row.role === expectedRoles[index]) controlGroup.roleCorrect++;
    });

    const subjectHead = tokens.indexOf(normalise(testCase.roles.s[testCase.roles.s.length - 1]));
    const predicateHead = tokens.indexOf(normalise(testCase.roles.p[0]));
    const objectHead = tokens.indexOf(normalise(testCase.roles.o[0]));
    assert.ok(subjectHead >= 0 && predicateHead >= 0 && objectHead >= 0, "manual edge heads must exist");
    const expectedEdges = new Set([
      [subjectHead, predicateHead, "subject_to_predicate"].join(":"),
      [predicateHead, objectHead, "predicate_to_object"].join(":"),
      [subjectHead, objectHead, "subject_to_object"].join(":")
    ]);
    const predictedEdges = new Set(result.edges.map(row => [row.from, row.to, row.relation].join(":")));
    for (const edge of expectedEdges) {
      if (predictedEdges.has(edge)) group.tp++;
      else group.fn++;
    }
    for (const edge of predictedEdges) if (!expectedEdges.has(edge)) group.fp++;

    const controlPredictedEdges = new Set(resultWithoutAugmentation.edges
      .map(row => [row.from, row.to, row.relation].join(":")));
    for (const edge of expectedEdges) {
      if (controlPredictedEdges.has(edge)) controlGroup.tp++;
      else controlGroup.fn++;
    }
    for (const edge of controlPredictedEdges) if (!expectedEdges.has(edge)) controlGroup.fp++;

    accumulateThresholdSweep(relationThresholdSweep.withAugmentation, result, expectedEdges);
    accumulateThresholdSweep(
      relationThresholdSweep.withoutAugmentation, resultWithoutAugmentation, expectedEdges
    );
    accumulateRoleGatedThresholdSweep(
      roleGatedRelationThresholdSweep.withAugmentation, result, expectedEdges
    );
    accumulateRoleGatedThresholdSweep(
      roleGatedRelationThresholdSweep.withoutAugmentation, resultWithoutAugmentation, expectedEdges
    );

    if (seedIndex === 0 && testCase.group === "short") {
      if (!baselineShort) baselineShort = { roleCorrect: 0, roleTotal: 0, tp: 0, fp: 0, fn: 0 };
      result.roles.forEach((row, index) => {
        baselineShort.roleTotal++;
        if (row.role === expectedRoles[index]) baselineShort.roleCorrect++;
      });
      for (const edge of expectedEdges) {
        if (predictedEdges.has(edge)) baselineShort.tp++;
        else baselineShort.fn++;
      }
      for (const edge of predictedEdges) if (!expectedEdges.has(edge)) baselineShort.fp++;
    }
  }

  const validationCorrect = Math.round(contextualReport.validationAccuracy * contextualReport.validationExamples);
  const testCorrect = Math.round(contextualReport.testAccuracy * contextualReport.testExamples);
  seedReports.push({
    modelSeed: seed.model,
    splitSeed: seed.split,
    phraseSeed: seed.phrase,
    split: {
      trainRows: contextualReport.trainRows,
      validationRows: contextualReport.validationRows,
      testRows: contextualReport.testRows,
      vocabularySize: contextualReport.vocabularySize
    },
    validation: {
      correct: validationCorrect,
      covered: contextualReport.validationExamples,
      total: Math.round(contextualReport.validationExamples / contextualReport.validationCoverage)
    },
    test: {
      correct: testCorrect,
      covered: contextualReport.testExamples,
      total: Math.round(contextualReport.testExamples / contextualReport.testCoverage)
    },
    surfaceAlignedMasked: seedSurfaceAlignedMasked,
    independentMasked: {
      correct: seedCorrect,
      covered: seedCovered,
      total: seedTotal,
      accuracy: seedCovered ? seedCorrect / seedCovered : null,
      coverage: seedTotal ? seedCovered / seedTotal : null,
      morphology: {
        correct: seedMorphologyCorrect,
        covered: seedMorphologyCovered,
        total: seedTotal,
        accuracy: seedMorphologyCovered ? seedMorphologyCorrect / seedMorphologyCovered : null,
        coverage: seedTotal ? seedMorphologyCovered / seedTotal : null,
        uniqueOovBackoffs: seedMorphologyBackoffs,
        ambiguousOovForms: seedMorphologyAmbiguous,
        strictOovTargets: seedTotal - seedCovered,
        oovBackoffCoverage: seedTotal > seedCovered ? seedMorphologyBackoffs / (seedTotal - seedCovered) : null,
        generatedOovPrediction: {correct:seedGeneratedCorrect,covered:seedGeneratedCovered,oovTargets:seedGeneratedOovTargets,
          accuracy:seedGeneratedCovered?seedGeneratedCorrect/seedGeneratedCovered:null,
          coverage:seedGeneratedOovTargets?seedGeneratedCovered/seedGeneratedOovTargets:null,
          candidateHits:seedGeneratedCandidateHits,
          candidateRecallAt8:seedGeneratedOovTargets?seedGeneratedCandidateHits/seedGeneratedOovTargets:null,
          examples:seedGeneratedExamples,
          contextMorphologyBackoffUses:seedContextMorphologyBackoffs,
          trainingContextExamples:contextual.status().trainingContextExamples,
          contextRetrieval:{correct:seedRetrievalCorrect,covered:seedRetrievalCovered,oovTargets:seedRetrievalOovTargets,
            accuracy:seedRetrievalCovered?seedRetrievalCorrect/seedRetrievalCovered:null,
            coverage:seedRetrievalOovTargets?seedRetrievalCovered/seedRetrievalOovTargets:null,
            examples:seedRetrievalExamples}}
      }
    },
    phraseTrainingOnly: {
      sourceSentences: composerTraining.sourceSentences,
      augmentedSentences: composerTraining.augmentedSentences,
      excludedAugmentations: composerTraining.excludedAugmentations,
      augmentationWeight: composerTraining.augmentationWeight,
      unverifiedAugmentations: composerTraining.unverifiedAugmentations,
      augmentation: composerTraining.augmentation,
      roleAccuracy: composerTraining.roleTrainingAccuracy,
      relationAccuracy: composerTraining.relationTrainingAccuracy,
      evaluation: composerTraining.evaluation
    },
    phraseTrainingWithoutAugmentation: {
      sourceSentences: composerWithoutAugmentationTraining.sourceSentences,
      augmentedSentences: composerWithoutAugmentationTraining.augmentedSentences,
      roleAccuracy: composerWithoutAugmentationTraining.roleTrainingAccuracy,
      relationAccuracy: composerWithoutAugmentationTraining.relationTrainingAccuracy,
      evaluation: composerWithoutAugmentationTraining.evaluation
    }
  });
}

// Frozen results from commit 6b28016004cb73525ffd5687dbc8ffab9e6693f2 (0.58.93).
const surfaceInversionTotal=seedReports.reduce((sum,row)=>({
 lemmaCorrect:sum.lemmaCorrect+row.surfaceAlignedMasked.orderInvariantRetrievalLemma.correct,
 lemmaCovered:sum.lemmaCovered+row.surfaceAlignedMasked.orderInvariantRetrievalLemma.covered,
 surfaceCorrect:sum.surfaceCorrect+row.surfaceAlignedMasked.orderInvariantRetrievalSurface.correct,
 surfaceCovered:sum.surfaceCovered+row.surfaceAlignedMasked.orderInvariantRetrievalSurface.covered,
 oovTargets:sum.oovTargets+row.surfaceAlignedMasked.orderInvariantRetrievalLemma.oovTargets
}),{lemmaCorrect:0,lemmaCovered:0,surfaceCorrect:0,surfaceCovered:0,oovTargets:0});

const surfaceInversionIdfTotal=seedReports.reduce((sum,row)=>({
 lemmaCorrect:sum.lemmaCorrect+row.surfaceAlignedMasked.orderInvariantIdfLemma.correct,
 lemmaCovered:sum.lemmaCovered+row.surfaceAlignedMasked.orderInvariantIdfLemma.covered,
 surfaceCorrect:sum.surfaceCorrect+row.surfaceAlignedMasked.orderInvariantIdfSurface.correct,
 surfaceCovered:sum.surfaceCovered+row.surfaceAlignedMasked.orderInvariantIdfSurface.covered,
 oovTargets:sum.oovTargets+row.surfaceAlignedMasked.orderInvariantIdfLemma.oovTargets
}),{lemmaCorrect:0,lemmaCovered:0,surfaceCorrect:0,surfaceCovered:0,oovTargets:0});

const baseline05893 = Object.freeze({
  heldOutSentences: 49,
  phraseRoles: { correct: 147, total: 285, tp: 106, fp: 314, fn: 119 },
  maskedTokens: { correct: 19, covered: 225, total: 609 },
  wordOrder: { roleCorrect: 15, roleTotal: 108, tp: 5, fp: 132, fn: 85 }
});

const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const maskOutput = Object.fromEntries(Object.entries(maskGroups).map(([name, group]) => [name, {
  ...group,
  accuracy: ratio(group.correct, group.covered),
  coverage: ratio(group.covered, group.total),
  allTargetAccuracy: ratio(group.correct, group.total),
  morphologyAccuracy: ratio(group.morphologyCorrect, group.morphologyCovered),
  morphologyCoverage: ratio(group.morphologyCovered, group.total),
  uniqueOovBackoffs: group.morphologyBackoffs,
  ambiguousOovForms: group.morphologyAmbiguous,
  oovBackoffCoverage: ratio(group.morphologyBackoffs, group.total - group.covered),
  generatedOovPredictionAccuracy: ratio(group.generatedCorrect,group.generatedCovered),
  generatedOovPredictionCoverage: ratio(group.generatedCovered,group.generatedOovTargets),
  generatedOovCandidateRecallAt8: ratio(group.generatedCandidateHits,group.generatedOovTargets),
  contextRetrievalAccuracy:ratio(group.retrievalCorrect,group.retrievalCovered),
  contextRetrievalCoverage:ratio(group.retrievalCovered,group.retrievalOovTargets)
}]));
const surfaceMaskOutput=Object.fromEntries(Object.entries(surfaceMaskGroups).map(([name,group])=>[name,{
  ...group,
  accuracy:ratio(group.correct,group.covered),
  coverage:ratio(group.covered,group.total),
  allTargetAccuracy:ratio(group.correct,group.total),
  morphologyAccuracy:ratio(group.morphologyCorrect,group.morphologyCovered),
  neuralOovGenerationAccuracy:ratio(group.generatedCorrect,group.generatedCovered),
  neuralOovGenerationCoverage:ratio(group.generatedCovered,group.oovTargets),
  contextRetrievalLemmaAccuracy:ratio(group.retrievalLemmaCorrect,group.retrievalLemmaCovered),
  contextRetrievalLemmaCoverage:ratio(group.retrievalLemmaCovered,group.oovTargets),
  contextRetrievalSurfaceAccuracy:ratio(group.retrievalSurfaceCorrect,group.retrievalSurfaceCovered),
  contextRetrievalSurfaceCoverage:ratio(group.retrievalSurfaceCovered,group.oovTargets)
}]));
const surfaceMaskTotal=Object.values(surfaceMaskGroups).reduce((sum,group)=>({
  correct:sum.correct+group.correct,covered:sum.covered+group.covered,total:sum.total+group.total,
  morphologyCorrect:sum.morphologyCorrect+group.morphologyCorrect,morphologyCovered:sum.morphologyCovered+group.morphologyCovered,
  generatedCorrect:sum.generatedCorrect+group.generatedCorrect,generatedCovered:sum.generatedCovered+group.generatedCovered,
  oovTargets:sum.oovTargets+group.oovTargets,candidateHits:sum.candidateHits+group.candidateHits,
  retrievalLemmaCorrect:sum.retrievalLemmaCorrect+group.retrievalLemmaCorrect,
  retrievalLemmaCovered:sum.retrievalLemmaCovered+group.retrievalLemmaCovered,
  retrievalSurfaceCorrect:sum.retrievalSurfaceCorrect+group.retrievalSurfaceCorrect,
  retrievalSurfaceCovered:sum.retrievalSurfaceCovered+group.retrievalSurfaceCovered,
  contextMorphologyBackoffs:sum.contextMorphologyBackoffs+group.contextMorphologyBackoffs,
  examples:sum.examples.concat(group.examples).slice(0,36)
}),{correct:0,covered:0,total:0,morphologyCorrect:0,morphologyCovered:0,generatedCorrect:0,generatedCovered:0,oovTargets:0,candidateHits:0,
 retrievalLemmaCorrect:0,retrievalLemmaCovered:0,retrievalSurfaceCorrect:0,retrievalSurfaceCovered:0,contextMorphologyBackoffs:0,examples:[]});
const phraseOutput = Object.fromEntries(Object.entries(phraseGroups).map(([name, group]) => [name, {
  ...group,
  roleAccuracy: ratio(group.roleCorrect, group.roleTotal),
  edgePrecision: ratio(group.tp, group.tp + group.fp),
  edgeRecall: ratio(group.tp, group.tp + group.fn)
}]));
const phraseOutputWithoutAugmentation = Object.fromEntries(
  Object.entries(phraseGroupsWithoutAugmentation).map(([name, group]) => [name, {
    ...group,
    roleAccuracy: ratio(group.roleCorrect, group.roleTotal),
    edgePrecision: ratio(group.tp, group.tp + group.fp),
    edgeRecall: ratio(group.tp, group.tp + group.fn)
  }])
);
const maskTotal = Object.values(maskGroups).reduce((sum, group) => ({
  correct: sum.correct + group.correct,
  covered: sum.covered + group.covered,
  total: sum.total + group.total,
  morphologyCorrect: sum.morphologyCorrect + group.morphologyCorrect,
  morphologyCovered: sum.morphologyCovered + group.morphologyCovered,
  morphologyBackoffs: sum.morphologyBackoffs + group.morphologyBackoffs,
  morphologyAmbiguous: sum.morphologyAmbiguous + group.morphologyAmbiguous,
  generatedCorrect: sum.generatedCorrect + group.generatedCorrect,
  generatedCovered: sum.generatedCovered + group.generatedCovered,
  generatedOovTargets: sum.generatedOovTargets + group.generatedOovTargets,
  generatedCandidateHits: sum.generatedCandidateHits + group.generatedCandidateHits,
  generatedExamples: sum.generatedExamples.concat(group.generatedExamples).slice(0,24),
  contextMorphologyBackoffs:sum.contextMorphologyBackoffs+group.contextMorphologyBackoffs,
  retrievalCorrect:sum.retrievalCorrect+group.retrievalCorrect,
  retrievalCovered:sum.retrievalCovered+group.retrievalCovered,
  retrievalOovTargets:sum.retrievalOovTargets+group.retrievalOovTargets,
  retrievalExamples:sum.retrievalExamples.concat(group.retrievalExamples).slice(0,24)
}), { correct: 0, covered: 0, total: 0, morphologyCorrect: 0, morphologyCovered: 0, morphologyBackoffs: 0, morphologyAmbiguous: 0, generatedCorrect: 0, generatedCovered: 0, generatedOovTargets: 0, generatedCandidateHits: 0, generatedExamples: [], contextMorphologyBackoffs:0, retrievalCorrect:0, retrievalCovered:0, retrievalOovTargets:0, retrievalExamples:[] });
const phraseTotal = Object.values(phraseGroups).reduce((sum, group) => ({
  roleCorrect: sum.roleCorrect + group.roleCorrect,
  roleTotal: sum.roleTotal + group.roleTotal,
  tp: sum.tp + group.tp,
  fp: sum.fp + group.fp,
  fn: sum.fn + group.fn
}), { roleCorrect: 0, roleTotal: 0, tp: 0, fp: 0, fn: 0 });
const phraseTotalWithoutAugmentation = Object.values(phraseGroupsWithoutAugmentation).reduce((sum, group) => ({
  roleCorrect: sum.roleCorrect + group.roleCorrect,
  roleTotal: sum.roleTotal + group.roleTotal,
  tp: sum.tp + group.tp,
  fp: sum.fp + group.fp,
  fn: sum.fn + group.fn
}), { roleCorrect: 0, roleTotal: 0, tp: 0, fp: 0, fn: 0 });
const summarizeThresholdBuckets = buckets => Object.fromEntries(
  Object.entries(buckets).map(([threshold, counts]) => [threshold, {
    ...counts,
    precision: ratio(counts.tp, counts.tp + counts.fp),
    recall: ratio(counts.tp, counts.tp + counts.fn)
  }])
);
const relationThresholdSummary = Object.fromEntries(
  Object.entries(relationThresholdSweep).map(([variant, buckets]) => [variant,
    summarizeThresholdBuckets(buckets)
  ])
);
const roleGatedRelationThresholdSummary = Object.fromEntries(
  Object.entries(roleGatedRelationThresholdSweep).map(([variant, buckets]) => [variant,
    summarizeThresholdBuckets(buckets)
  ])
);
const internalValidation = seedReports.reduce((sum, row) => ({
  correct: sum.correct + row.validation.correct,
  covered: sum.covered + row.validation.covered,
  total: sum.total + row.validation.total
}), { correct: 0, covered: 0, total: 0 });
const internalTest = seedReports.reduce((sum, row) => ({
  correct: sum.correct + row.test.correct,
  covered: sum.covered + row.test.covered,
  total: sum.total + row.test.total
}), { correct: 0, covered: 0, total: 0 });
const semanticTotal = Object.values(semanticGroups).reduce((sum, group) => ({
  cases: sum.cases + group.cases,
  passedCases: sum.passedCases + group.passedCases,
  checks: sum.checks + group.checks,
  passedChecks: sum.passedChecks + group.passedChecks
}), { cases: 0, passedCases: 0, checks: 0, passedChecks: 0 });

const oovProbe = firstModel.score("Кварцевый сенсор обнаруживает микровибрацию.", 0);
assert.equal(oovProbe.targetKnown, false);
assert.equal(oovProbe.targetProbability, null);
assert.equal(oovProbe.tokenVector.length, 12);
assert.ok(oovProbe.tokenVector.every(Number.isFinite), "OOV subword vectors must remain finite");
assert.equal(baselineShort.roleTotal, 18, "the six-sentence 0.58.82 phrase baseline has 18 role labels");
assert.equal(baselineShort.tp + baselineShort.fn, 18, "the six-sentence 0.58.82 phrase baseline has 18 expected edges");
assert.equal(maskTotal.total, seedReports.length * cases.reduce((sum, row) => sum + knowledge.tokens(row.text).length, 0), "all independent token positions must remain in the coverage denominator");
assert.ok(maskTotal.covered <= maskTotal.total);
assert.equal(maskTotal.morphologyCovered, maskTotal.covered + maskTotal.morphologyBackoffs,
  "morphology coverage must add only unique OOV backoffs to exact vocabulary coverage");
assert.ok(maskTotal.morphologyCovered >= maskTotal.covered);
assert.ok(maskTotal.morphologyBackoffs <= maskTotal.total - maskTotal.covered);
assert.ok(maskTotal.morphologyCorrect <= maskTotal.morphologyCovered);
assert.ok(maskTotal.morphologyBackoffs > 0, "the independent corpus must exercise a unique Russian inflection fallback");
assert.equal(maskTotal.generatedOovTargets,maskTotal.total-maskTotal.covered,
  "generated-form accuracy must include every exact-vocabulary OOV target in its denominator");
assert.ok(maskTotal.generatedCovered<=maskTotal.generatedOovTargets);
assert.equal(maskTotal.retrievalOovTargets,maskTotal.generatedOovTargets,
 "retrieval must be evaluated on every same exact-vocabulary OOV target");
assert.ok(maskTotal.retrievalCovered<=maskTotal.retrievalOovTargets);
assert.ok(maskTotal.retrievalCorrect<=maskTotal.retrievalCovered);
assert.ok(maskTotal.generatedCorrect<=maskTotal.generatedCovered);
assert.ok(phraseTotal.roleTotal > 0 && phraseTotal.tp + phraseTotal.fn > 0);
assert.equal(semanticTotal.cases, cases.length);

const groupNames = [...new Set([
  ...Object.keys(semanticGroups), ...Object.keys(maskOutput), ...Object.keys(surfaceMaskOutput), ...Object.keys(phraseOutput)
])];
const groups = Object.fromEntries(groupNames.map(name => [name, {
  semantic: semanticGroups[name] || null,
  maskedToken: maskOutput[name] || null,
  surfaceAlignedMaskedToken:surfaceMaskOutput[name]||null,
  phraseComposition: phraseOutput[name] || null
}]));

const comparisonTo05893 = {
  phraseRoleAccuracy: {
    previous: ratio(baseline05893.phraseRoles.correct, baseline05893.phraseRoles.total),
    current: ratio(phraseTotal.roleCorrect, phraseTotal.roleTotal),
    previousCount: baseline05893.phraseRoles.correct, previousTotal: baseline05893.phraseRoles.total,
    currentCount: phraseTotal.roleCorrect, currentTotal: phraseTotal.roleTotal,
    deltaPercentagePoints: (ratio(phraseTotal.roleCorrect, phraseTotal.roleTotal) -
      ratio(baseline05893.phraseRoles.correct, baseline05893.phraseRoles.total)) * 100
  },
  wordOrderRoleAccuracy: {
    previous: ratio(baseline05893.wordOrder.roleCorrect, baseline05893.wordOrder.roleTotal),
    current: ratio(phraseGroups.word_order.roleCorrect, phraseGroups.word_order.roleTotal),
    previousCount: baseline05893.wordOrder.roleCorrect, previousTotal: baseline05893.wordOrder.roleTotal,
    currentCount: phraseGroups.word_order.roleCorrect, currentTotal: phraseGroups.word_order.roleTotal,
    deltaPercentagePoints: (ratio(phraseGroups.word_order.roleCorrect, phraseGroups.word_order.roleTotal) -
      ratio(baseline05893.wordOrder.roleCorrect, baseline05893.wordOrder.roleTotal)) * 100
  },
  maskedTokenAccuracy: {
    previous: ratio(baseline05893.maskedTokens.correct, baseline05893.maskedTokens.covered),
    current: ratio(maskTotal.correct, maskTotal.covered),
    previousCount: baseline05893.maskedTokens.correct, previousTotal: baseline05893.maskedTokens.covered,
    currentCount: maskTotal.correct, currentTotal: maskTotal.covered,
    deltaPercentagePoints: (ratio(maskTotal.correct, maskTotal.covered) -
      ratio(baseline05893.maskedTokens.correct, baseline05893.maskedTokens.covered)) * 100
  },
  maskedTokenCoverage: {
    previous: ratio(baseline05893.maskedTokens.covered, baseline05893.maskedTokens.total),
    current: ratio(maskTotal.covered, maskTotal.total),
    previousCount: baseline05893.maskedTokens.covered, previousTotal: baseline05893.maskedTokens.total,
    currentCount: maskTotal.covered, currentTotal: maskTotal.total,
    deltaPercentagePoints: (ratio(maskTotal.covered, maskTotal.total) -
      ratio(baseline05893.maskedTokens.covered, baseline05893.maskedTokens.total)) * 100
  },
  relationEdgePrecision: {
    previous: ratio(baseline05893.phraseRoles.tp, baseline05893.phraseRoles.tp + baseline05893.phraseRoles.fp),
    current: ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fp),
    previousCount: baseline05893.phraseRoles.tp, previousTotal: baseline05893.phraseRoles.tp + baseline05893.phraseRoles.fp,
    currentCount: phraseTotal.tp, currentTotal: phraseTotal.tp + phraseTotal.fp,
    deltaPercentagePoints: (ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fp) -
      ratio(baseline05893.phraseRoles.tp, baseline05893.phraseRoles.tp + baseline05893.phraseRoles.fp)) * 100
  },
  relationEdgeRecall: {
    previous: ratio(baseline05893.phraseRoles.tp, baseline05893.phraseRoles.tp + baseline05893.phraseRoles.fn),
    current: ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fn),
    previousCount: baseline05893.phraseRoles.tp, previousTotal: baseline05893.phraseRoles.tp + baseline05893.phraseRoles.fn,
    currentCount: phraseTotal.tp, currentTotal: phraseTotal.tp + phraseTotal.fn,
    deltaPercentagePoints: (ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fn) -
      ratio(baseline05893.phraseRoles.tp, baseline05893.phraseRoles.tp + baseline05893.phraseRoles.fn)) * 100
  }
};

assert.equal(cases.length, baseline05893.heldOutSentences,
  "the comparison must keep the exact 0.58.93 held-out sentence set");
assert.equal(phraseTotal.roleTotal, baseline05893.phraseRoles.total,
  "phrase-role comparison must use the same token denominator as 0.58.93");
assert.equal(phraseTotalWithoutAugmentation.roleTotal, phraseTotal.roleTotal,
  "paired phrase heads must use the identical held-out role denominator");
assert.deepEqual(
  relationThresholdSweep.withAugmentation["0.34"],
  {tp:phraseTotal.tp,fp:phraseTotal.fp,fn:phraseTotal.fn},
  "0.34 threshold reproduction must match the existing edge output"
);
assert.deepEqual(
  relationThresholdSweep.withoutAugmentation["0.34"],
  {tp:phraseTotalWithoutAugmentation.tp,fp:phraseTotalWithoutAugmentation.fp,fn:phraseTotalWithoutAugmentation.fn},
  "0.34 threshold reproduction must match the control edge output"
);
for (const variant of ["withAugmentation","withoutAugmentation"]) {
  for (const threshold of relationThresholds) {
    const rows = roleGatedRelationThresholdSweep[variant][threshold.toFixed(2)];
    assert.equal(rows.tp + rows.fn, phraseTotal.tp + phraseTotal.fn,
      "role-gated relation scoring must preserve the fixed expected-edge denominator");
    assert.ok(rows.tp >= 0 && rows.fp >= 0 && rows.fn >= 0);
  }
}
assert.equal(maskTotal.total, baseline05893.maskedTokens.total,
  "legacy knowledge-token metric must retain the 0.58.93 denominator");
assert.equal(surfaceMaskTotal.total,seedReports.length*cases.reduce((sum,row)=>sum+Attention.tokenize(row.text).length,0),
  "surface-aligned metric must count actual contextual token positions");
assert.equal(surfaceMaskTotal.oovTargets,surfaceMaskTotal.total-surfaceMaskTotal.covered,
  "surface-aligned OOV denominator must use exact vocabulary coverage");
assert.ok(surfaceMaskTotal.retrievalLemmaCovered<=surfaceMaskTotal.oovTargets);
assert.ok(surfaceMaskTotal.retrievalSurfaceCovered<=surfaceMaskTotal.oovTargets);

const summary = {
  trainingSentences: trainRows.length,
  augmentation: {
    enabled: true,
    perSeed: seedReports.map(row => ({...row.phraseTrainingOnly}))
  },
  baselineVersion: "0.58.93",
  comparisonTo05893,
  independentHeldOutSentences: cases.length,
  exactSentenceLeakage: leakage.length,
  surfaceAlignedMaskedToken:{
    correct:surfaceMaskTotal.correct,covered:surfaceMaskTotal.covered,total:surfaceMaskTotal.total,
    accuracy:ratio(surfaceMaskTotal.correct,surfaceMaskTotal.covered),
    coverage:ratio(surfaceMaskTotal.covered,surfaceMaskTotal.total),
    allTargetAccuracy:ratio(surfaceMaskTotal.correct,surfaceMaskTotal.total),
    morphology:{correct:surfaceMaskTotal.morphologyCorrect,covered:surfaceMaskTotal.morphologyCovered,
      accuracy:ratio(surfaceMaskTotal.morphologyCorrect,surfaceMaskTotal.morphologyCovered)},
    neuralOovGeneration:{correct:surfaceMaskTotal.generatedCorrect,covered:surfaceMaskTotal.generatedCovered,
      oovTargets:surfaceMaskTotal.oovTargets,accuracy:ratio(surfaceMaskTotal.generatedCorrect,surfaceMaskTotal.generatedCovered),
      coverage:ratio(surfaceMaskTotal.generatedCovered,surfaceMaskTotal.oovTargets),
      candidateRecallAt8:ratio(surfaceMaskTotal.candidateHits,surfaceMaskTotal.oovTargets)},
    contextRetrievalLemma:{correct:surfaceMaskTotal.retrievalLemmaCorrect,covered:surfaceMaskTotal.retrievalLemmaCovered,
      oovTargets:surfaceMaskTotal.oovTargets,accuracy:ratio(surfaceMaskTotal.retrievalLemmaCorrect,surfaceMaskTotal.retrievalLemmaCovered),
      coverage:ratio(surfaceMaskTotal.retrievalLemmaCovered,surfaceMaskTotal.oovTargets)},
    contextRetrievalSurface:{correct:surfaceMaskTotal.retrievalSurfaceCorrect,covered:surfaceMaskTotal.retrievalSurfaceCovered,
      oovTargets:surfaceMaskTotal.oovTargets,accuracy:ratio(surfaceMaskTotal.retrievalSurfaceCorrect,surfaceMaskTotal.retrievalSurfaceCovered),
      coverage:ratio(surfaceMaskTotal.retrievalSurfaceCovered,surfaceMaskTotal.oovTargets)},
    contextMorphologyBackoffUses:surfaceMaskTotal.contextMorphologyBackoffs,
    orderInvariantRetrievalLemma:{
      correct:surfaceInversionTotal.lemmaCorrect,covered:surfaceInversionTotal.lemmaCovered,oovTargets:surfaceInversionTotal.oovTargets,
      accuracy:ratio(surfaceInversionTotal.lemmaCorrect,surfaceInversionTotal.lemmaCovered),
      coverage:ratio(surfaceInversionTotal.lemmaCovered,surfaceInversionTotal.oovTargets)
    },
    orderInvariantRetrievalSurface:{
      correct:surfaceInversionTotal.surfaceCorrect,covered:surfaceInversionTotal.surfaceCovered,oovTargets:surfaceInversionTotal.oovTargets,
      accuracy:ratio(surfaceInversionTotal.surfaceCorrect,surfaceInversionTotal.surfaceCovered),
      coverage:ratio(surfaceInversionTotal.surfaceCovered,surfaceInversionTotal.oovTargets)
    },
    orderInvariantRetrievalInverseFrequencyLemma:{
      correct:surfaceInversionIdfTotal.lemmaCorrect,covered:surfaceInversionIdfTotal.lemmaCovered,oovTargets:surfaceInversionIdfTotal.oovTargets,
      accuracy:ratio(surfaceInversionIdfTotal.lemmaCorrect,surfaceInversionIdfTotal.lemmaCovered),
      coverage:ratio(surfaceInversionIdfTotal.lemmaCovered,surfaceInversionIdfTotal.oovTargets)
    },
    orderInvariantRetrievalInverseFrequencySurface:{
      correct:surfaceInversionIdfTotal.surfaceCorrect,covered:surfaceInversionIdfTotal.surfaceCovered,oovTargets:surfaceInversionIdfTotal.oovTargets,
      accuracy:ratio(surfaceInversionIdfTotal.surfaceCorrect,surfaceInversionIdfTotal.surfaceCovered),
      coverage:ratio(surfaceInversionIdfTotal.surfaceCovered,surfaceInversionIdfTotal.oovTargets)
    },
    examples:surfaceMaskTotal.examples,
    baselineComparison:"new raw-token metric; no frozen 0.58.93 baseline"
  },
  seeds: seedReports,
  internalValidation: {
    ...internalValidation,
    accuracy: ratio(internalValidation.correct, internalValidation.covered),
    coverage: ratio(internalValidation.covered, internalValidation.total)
  },
  internalTest: {
    ...internalTest,
    accuracy: ratio(internalTest.correct, internalTest.covered),
    coverage: ratio(internalTest.covered, internalTest.total)
  },
  independentMaskedToken: {
    ...maskTotal,
    accuracy: ratio(maskTotal.correct, maskTotal.covered),
    coverage: ratio(maskTotal.covered, maskTotal.total),
    allTargetAccuracy: ratio(maskTotal.correct, maskTotal.total),
    morphology: {
      correct: maskTotal.morphologyCorrect,
      covered: maskTotal.morphologyCovered,
      total: maskTotal.total,
      accuracy: ratio(maskTotal.morphologyCorrect, maskTotal.morphologyCovered),
      coverage: ratio(maskTotal.morphologyCovered, maskTotal.total),
      uniqueOovBackoffs: maskTotal.morphologyBackoffs,
      ambiguousOovForms: maskTotal.morphologyAmbiguous,
      strictOovTargets: maskTotal.total - maskTotal.covered,
      oovBackoffCoverage: ratio(maskTotal.morphologyBackoffs, maskTotal.total - maskTotal.covered),
      generatedOovPrediction: {
        correct:maskTotal.generatedCorrect,covered:maskTotal.generatedCovered,oovTargets:maskTotal.generatedOovTargets,
        accuracy:ratio(maskTotal.generatedCorrect,maskTotal.generatedCovered),
        coverage:ratio(maskTotal.generatedCovered,maskTotal.generatedOovTargets),
        candidateHits:maskTotal.generatedCandidateHits,
        candidateRecallAt8:ratio(maskTotal.generatedCandidateHits,maskTotal.generatedOovTargets),
        examples:maskTotal.generatedExamples,
        contextMorphologyBackoffUses:maskTotal.contextMorphologyBackoffs,
        contextRetrieval:{correct:maskTotal.retrievalCorrect,covered:maskTotal.retrievalCovered,oovTargets:maskTotal.retrievalOovTargets,
          accuracy:ratio(maskTotal.retrievalCorrect,maskTotal.retrievalCovered),
          coverage:ratio(maskTotal.retrievalCovered,maskTotal.retrievalOovTargets),
          examples:maskTotal.retrievalExamples,
          baselineComparison:"new metric; no frozen training-context retrieval baseline exists"},
        baselineComparison:"new metric; no frozen contextual-form-generation baseline exists"
      },
      baselineComparison: "new metric; no frozen 0.58.93 morphology score exists"
    }
  },
  semanticCoreRules: {
    ...semanticTotal,
    caseAccuracy: ratio(semanticTotal.passedCases, semanticTotal.cases),
    checkAccuracy: ratio(semanticTotal.passedChecks, semanticTotal.checks)
  },
  phraseCompositionHeldOut: {
    ...phraseTotal,
    roleAccuracy: ratio(phraseTotal.roleCorrect, phraseTotal.roleTotal),
    edgePrecision: ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fp),
    edgeRecall: ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fn)
  },
  phraseAugmentationAblation: {
    pairedSeeds: seeds.map(row => ({model:row.model,split:row.split,phrase:row.phrase})),
    onlyChangedTrainingVariable: "verified SOV word-order augmentation enabled versus disabled",
    withAugmentation: {
      ...phraseTotal,
      roleAccuracy: ratio(phraseTotal.roleCorrect, phraseTotal.roleTotal),
      edgePrecision: ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fp),
      edgeRecall: ratio(phraseTotal.tp, phraseTotal.tp + phraseTotal.fn)
    },
    withoutAugmentation: {
      ...phraseTotalWithoutAugmentation,
      roleAccuracy: ratio(phraseTotalWithoutAugmentation.roleCorrect, phraseTotalWithoutAugmentation.roleTotal),
      edgePrecision: ratio(phraseTotalWithoutAugmentation.tp,
        phraseTotalWithoutAugmentation.tp + phraseTotalWithoutAugmentation.fp),
      edgeRecall: ratio(phraseTotalWithoutAugmentation.tp,
        phraseTotalWithoutAugmentation.tp + phraseTotalWithoutAugmentation.fn)
    },
    wordOrderWithAugmentation: phraseOutput.word_order || null,
    wordOrderWithoutAugmentation: phraseOutputWithoutAugmentation.word_order || null,
    relationThresholdSweep: relationThresholdSummary,
    roleGatedRelationThresholdSweep: roleGatedRelationThresholdSummary,
    roleGateDefinition: "emit an edge only when predicted source and target phrase roles match the edge relation"
  },
  historicalSixSentenceBaseline: {
    ...baselineShort,
    roleAccuracy: ratio(baselineShort.roleCorrect, baselineShort.roleTotal),
    edgePrecision: ratio(baselineShort.tp, baselineShort.tp + baselineShort.fp),
    edgeRecall: ratio(baselineShort.tp, baselineShort.tp + baselineShort.fn)
  },
  groups,
  semanticFailures
};

assert.deepEqual(semanticFailures, [], "all independent semantic proposition cases must pass");
console.log("NEUROGENESIS 0.58.103 independent language benchmark: " + JSON.stringify(summary));
console.log("No train/test sentence leakage; metrics retain exact numerators, denominators, coverage and three-seed variation.");
