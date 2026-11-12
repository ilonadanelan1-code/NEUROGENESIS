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
const phraseGroups = {};
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
  for (const testCase of cases) {
    const tokens = knowledge.tokens(testCase.text);
    const group = maskGroups[testCase.group] || (maskGroups[testCase.group] = {
      correct: 0, covered: 0, total: 0,
      morphologyCorrect: 0, morphologyCovered: 0, morphologyBackoffs: 0, morphologyAmbiguous: 0
    });
    for (let index = 0; index < tokens.length; index++) {
      const score = contextual.score(testCase.text, index);
      group.total++;
      seedTotal++;
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
    }
  }

  for (const testCase of cases.filter(row => row.roles)) {
    const result = composer.analyse(testCase.text, contextual, core, knowledge);
    const tokens = result.tokens.map(normalise);
    const expectedRoles = tokens.map(token =>
      testCase.roles.s.some(value => normalise(value) === token) ? "subject" :
      testCase.roles.p.some(value => normalise(value) === token) ? "predicate" :
      testCase.roles.o.some(value => normalise(value) === token) ? "object" : "other"
    );
    assert.equal(result.roles.length, expectedRoles.length, "phrase-role output must align with manual token labels");
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
        oovBackoffCoverage: seedTotal > seedCovered ? seedMorphologyBackoffs / (seedTotal - seedCovered) : null
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
    }
  });
}

// Frozen results from commit 6b28016004cb73525ffd5687dbc8ffab9e6693f2 (0.58.93).
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
  oovBackoffCoverage: ratio(group.morphologyBackoffs, group.total - group.covered)
}]));
const phraseOutput = Object.fromEntries(Object.entries(phraseGroups).map(([name, group]) => [name, {
  ...group,
  roleAccuracy: ratio(group.roleCorrect, group.roleTotal),
  edgePrecision: ratio(group.tp, group.tp + group.fp),
  edgeRecall: ratio(group.tp, group.tp + group.fn)
}]));
const maskTotal = Object.values(maskGroups).reduce((sum, group) => ({
  correct: sum.correct + group.correct,
  covered: sum.covered + group.covered,
  total: sum.total + group.total,
  morphologyCorrect: sum.morphologyCorrect + group.morphologyCorrect,
  morphologyCovered: sum.morphologyCovered + group.morphologyCovered,
  morphologyBackoffs: sum.morphologyBackoffs + group.morphologyBackoffs,
  morphologyAmbiguous: sum.morphologyAmbiguous + group.morphologyAmbiguous
}), { correct: 0, covered: 0, total: 0, morphologyCorrect: 0, morphologyCovered: 0, morphologyBackoffs: 0, morphologyAmbiguous: 0 });
const phraseTotal = Object.values(phraseGroups).reduce((sum, group) => ({
  roleCorrect: sum.roleCorrect + group.roleCorrect,
  roleTotal: sum.roleTotal + group.roleTotal,
  tp: sum.tp + group.tp,
  fp: sum.fp + group.fp,
  fn: sum.fn + group.fn
}), { roleCorrect: 0, roleTotal: 0, tp: 0, fp: 0, fn: 0 });
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
assert.ok(phraseTotal.roleTotal > 0 && phraseTotal.tp + phraseTotal.fn > 0);
assert.equal(semanticTotal.cases, cases.length);

const groupNames = [...new Set([
  ...Object.keys(semanticGroups), ...Object.keys(maskOutput), ...Object.keys(phraseOutput)
])];
const groups = Object.fromEntries(groupNames.map(name => [name, {
  semantic: semanticGroups[name] || null,
  maskedToken: maskOutput[name] || null,
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
assert.equal(maskTotal.total, baseline05893.maskedTokens.total,
  "masked-token coverage comparison must use the same token denominator as 0.58.93");

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
console.log("NEUROGENESIS 0.58.94 independent language benchmark: " + JSON.stringify(summary));
console.log("No train/test sentence leakage; metrics retain exact numerators, denominators, coverage and three-seed variation.");
