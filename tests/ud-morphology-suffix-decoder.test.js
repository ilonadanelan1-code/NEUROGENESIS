"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

function normalize(value, tokenize) {
  return tokenize(value || "").join(" ");
}

function featureSignature(feats) {
  return Object.keys(feats || {}).sort()
    .map(key => key + "=" + String(feats[key])).join("|") || "_";
}

function annotationRows(record, tokenize) {
  return record.tokens.flatMap(token => {
    const formParts = tokenize(token.form);
    const lemma = normalize(token.lemma, tokenize);
    return formParts.map(form => ({
      form,
      lemma: lemma || null,
      upos: token.upos || null,
      feats: {...(token.feats || {})}
    }));
  });
}

function alignedRecord(record, tokenize) {
  const sentenceTokens = tokenize(record.text);
  const rows = annotationRows(record, tokenize);
  if (rows.length !== sentenceTokens.length ||
      rows.map(row => row.form).join(" ") !== sentenceTokens.join(" ")) {
    return null;
  }
  return {key:sentenceTokens.join(" "), rows};
}

function createRuleBank(trainingRows, maximumSuffixLength = 5) {
  const bank = new Map();
  let eligibleExamples = 0;
  let skippedExamples = 0;
  for (const row of trainingRows) {
    if (!row.form || !row.lemma || !row.upos || row.lemma.length < 2) {
      skippedExamples++;
      continue;
    }
    eligibleExamples++;
    const signature = featureSignature(row.feats);
    const maximum = Math.min(maximumSuffixLength, row.lemma.length - 1);
    for (let width = 1; width <= maximum; width++) {
      const sourceSuffix = row.lemma.slice(-width);
      const stem = row.lemma.slice(0, -width);
      if (!row.form.startsWith(stem)) continue;
      const outputSuffix = row.form.slice(stem.length);
      const key = JSON.stringify([row.upos, signature, sourceSuffix]);
      let outputs = bank.get(key);
      if (!outputs) {
        outputs = new Map();
        bank.set(key, outputs);
      }
      let rule = outputs.get(outputSuffix);
      if (!rule) {
        rule = {outputSuffix, lemmas:new Set()};
        outputs.set(outputSuffix, rule);
      }
      rule.lemmas.add(row.lemma);
    }
  }
  return {bank,eligibleExamples,skippedExamples};
}

function predictBySuffixRule(target, ruleBank, maximumSuffixLength = 5) {
  if (!target || !target.form || !target.lemma || !target.upos) {
    return {token:null,reason:"missing_annotation"};
  }
  const signature = featureSignature(target.feats);
  const maximum = Math.min(maximumSuffixLength, target.lemma.length - 1);
  let sawAmbiguousRule = false;
  for (let width = maximum; width >= 1; width--) {
    const sourceSuffix = target.lemma.slice(-width);
    const key = JSON.stringify([target.upos, signature, sourceSuffix]);
    const outputs = ruleBank.get(key);
    if (!outputs) continue;
    const candidates = [];
    for (const rule of outputs.values()) {
      const support = rule.lemmas.size - (rule.lemmas.has(target.lemma) ? 1 : 0);
      if (support < 1) continue;
      const token = target.lemma.slice(0, -width) + rule.outputSuffix;
      if (!token) continue;
      candidates.push({token,support,suffixLength:width});
    }
    if (!candidates.length) continue;
    const bestSupport = Math.max(...candidates.map(row => row.support));
    const best = candidates.filter(row => row.support === bestSupport);
    const unique = [...new Map(best.map(row => [row.token,row])).values()];
    if (unique.length !== 1) {
      sawAmbiguousRule = true;
      continue;
    }
    return {...unique[0],reason:"cross_lemma_suffix_rule"};
  }
  return {
    token:null,
    reason:sawAmbiguousRule ? "ambiguous_rule_backoff_exhausted" : "no_cross_lemma_rule"
  };
}

function createSlice() {
  return {targets:0,candidates:0,correct:0,ambiguous:0,supportTotal:0};
}

function createMetrics() {
  return {
    oov:createSlice(),
    unseenSurface:createSlice(),
    seenSurfaceOutsideVocabulary:createSlice(),
    knownLemma:createSlice(),
    unseenLemma:createSlice(),
    byUpos:Object.create(null)
  };
}

function updateSlice(slice, prediction, goldForm) {
  slice.targets++;
  if (prediction.token) {
    slice.candidates++;
    slice.supportTotal += prediction.support || 0;
    if (prediction.token === goldForm) slice.correct++;
  } else if (prediction.reason === "ambiguous_rule_backoff_exhausted") {
    slice.ambiguous++;
  }
}

function mergeMetrics(target, source) {
  for (const key of ["oov","unseenSurface","seenSurfaceOutsideVocabulary","knownLemma","unseenLemma"]) {
    for (const field of Object.keys(target[key])) target[key][field] += source[key][field];
  }
  for (const upos of Object.keys(source.byUpos)) {
    if (!target.byUpos[upos]) target.byUpos[upos] = createSlice();
    for (const field of Object.keys(target.byUpos[upos])) {
      target.byUpos[upos][field] += source.byUpos[upos][field];
    }
  }
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function summarizeSlice(slice) {
  return {
    targets:slice.targets,
    generated:slice.candidates,
    correct:slice.correct,
    ambiguous:slice.ambiguous,
    coverage:ratio(slice.candidates,slice.targets),
    precisionAmongGenerated:ratio(slice.correct,slice.candidates),
    exactRecallAcrossTargets:ratio(slice.correct,slice.targets),
    meanSupportingLemmas:ratio(slice.supportTotal,slice.candidates)
  };
}

function summarizeMetrics(metrics) {
  return {
    oov:summarizeSlice(metrics.oov),
    unseenSurface:summarizeSlice(metrics.unseenSurface),
    seenSurfaceOutsideVocabulary:summarizeSlice(metrics.seenSurfaceOutsideVocabulary),
    knownLemma:summarizeSlice(metrics.knownLemma),
    unseenLemma:summarizeSlice(metrics.unseenLemma),
    byUpos:Object.fromEntries(Object.keys(metrics.byUpos).sort()
      .map(upos => [upos,summarizeSlice(metrics.byUpos[upos])]))
  };
}

// A small no-leakage fixture: the decoder learns the "ент -> ента" pattern
// from two different lemmas and applies it to a third unseen lemma.
const fixtureFeatures = {Case:"Gen",Number:"Sing"};
const fixtureTraining = [
  {form:"студента",lemma:"студент",upos:"NOUN",feats:fixtureFeatures},
  {form:"документа",lemma:"документ",upos:"NOUN",feats:fixtureFeatures}
];
const fixtureBank = createRuleBank(fixtureTraining);
const fixturePrediction = predictBySuffixRule({
  form:"президента",lemma:"президент",upos:"NOUN",feats:fixtureFeatures
},fixtureBank);
assert.equal(fixturePrediction.token,"президента",
  "a suffix rule learned from other lemmas must generate a held-out inflection");
assert.equal(fixturePrediction.reason,"cross_lemma_suffix_rule");
const sameLemmaOnlyBank = createRuleBank([
  {form:"студента",lemma:"студент",upos:"NOUN",feats:fixtureFeatures},
  {form:"студенту",lemma:"студент",upos:"NOUN",feats:{Case:"Dat",Number:"Sing"}}
]);
const noSelfLeakPrediction = predictBySuffixRule({
  form:"студента",lemma:"студент",upos:"NOUN",feats:fixtureFeatures
},sameLemmaOnlyBank);
assert.equal(noSelfLeakPrediction.token,null,
  "a target lemma's own training forms must not count as cross-lemma rule support");

const trainPath = process.argv[2];
const testPath = process.argv[3];
if (!trainPath && !testPath) {
  console.log("NEUROGENESIS morphology suffix-rule fixtures: passed; external corpus files not supplied.");
} else {
  assert.ok(trainPath && testPath,"supply both pinned UD train and test CoNLL-U files");
  const trainContent = fs.readFileSync(trainPath,"utf8");
  const testContent = fs.readFileSync(testPath,"utf8");
  const prepared = importer.prepareCorpus(trainContent,testContent,{
    trainLimit:320,testLimit:240,seed:20261112,minimumTokens:4,maximumTokens:40
  });
  assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps,0);
  assert.equal(prepared.trainingTexts.length,320);
  assert.equal(prepared.testTexts.length,240);

  const window = {};
  const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
  vm.runInNewContext(fs.readFileSync("contextual-attention.js","utf8"),sandbox,
    {filename:"contextual-attention.js"});
  const Attention = window.NGContextualModel;
  assert.ok(Attention && Attention.schema === "NG_CONTEXTUAL_ATTENTION_V5");

  const seeds = [
    {model:9173,split:902},
    {model:31415,split:2718},
    {model:2718,split:9044}
  ];
  const aggregate = createMetrics();
  const seedReports = [];
  for (const seed of seeds) {
    const model = Attention.create({
      dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model
    });
    const split = model.splitCorpus(prepared.trainingTexts,seed.split);
    const trainSentenceKeys = new Set(split.train.map(row => Attention.tokenize(row).join(" ")));
    const trainingRows = [];
    let alignedTrainingSentences = 0;
    let skippedTrainingSentences = 0;
    for (const record of prepared.trainingRecords) {
      const aligned = alignedRecord(record,Attention.tokenize);
      if (!aligned || !trainSentenceKeys.has(aligned.key)) continue;
      alignedTrainingSentences++;
      trainingRows.push(...aligned.rows);
    }
    for (const key of trainSentenceKeys) {
      if (!prepared.trainingRecords.some(record => {
        const aligned = alignedRecord(record,Attention.tokenize);
        return aligned && aligned.key === key;
      })) skippedTrainingSentences++;
    }
    assert.ok(alignedTrainingSentences >= Math.floor(split.train.length*0.9),
      "at least 90% of internal training sentences must have aligned UD morphology");

    const testRowsBySentence = new Map();
    let skippedTestSentences = 0;
    for (const record of prepared.testRecords) {
      const aligned = alignedRecord(record,Attention.tokenize);
      if (!aligned) {
        skippedTestSentences++;
        continue;
      }
      testRowsBySentence.set(aligned.key,aligned.rows);
    }
    assert.ok(testRowsBySentence.size >= Math.floor(prepared.testTexts.length*0.95),
      "at least 95% of independent test sentences must have aligned UD morphology");

    const trainTokenFrequency = new Map();
    const outputVocabulary = new Set();
    for (const sentence of split.train) {
      for (const token of Attention.tokenize(sentence)) {
        trainTokenFrequency.set(token,(trainTokenFrequency.get(token)||0)+1);
        if (outputVocabulary.size < 1024) outputVocabulary.add(token);
      }
    }
    const trainLemmaSet = new Set(trainingRows.map(row => row.lemma).filter(Boolean));
    const bankResult = createRuleBank(trainingRows,5);
    const metrics = createMetrics();
    let totalTestTokens = 0;
    let goldAnnotatedTokens = 0;
    for (const sentence of prepared.testTexts) {
      const tokens = Attention.tokenize(sentence);
      const rows = testRowsBySentence.get(tokens.join(" "));
      assert.ok(rows,"independent test sentence lost its UD annotation alignment");
      assert.equal(rows.length,tokens.length);
      for (let index = 0; index < tokens.length; index++) {
        totalTestTokens++;
        const gold = rows[index];
        if (!gold.lemma || !gold.upos) continue;
        goldAnnotatedTokens++;
        if (outputVocabulary.has(gold.form)) continue;
        const frequency = trainTokenFrequency.get(gold.form)||0;
        const prediction = predictBySuffixRule(gold,bankResult.bank,5);
        updateSlice(metrics.oov,prediction,gold.form);
        if (frequency === 0) updateSlice(metrics.unseenSurface,prediction,gold.form);
        else updateSlice(metrics.seenSurfaceOutsideVocabulary,prediction,gold.form);
        if (trainLemmaSet.has(gold.lemma)) updateSlice(metrics.knownLemma,prediction,gold.form);
        else updateSlice(metrics.unseenLemma,prediction,gold.form);
        const upos = gold.upos;
        if (!metrics.byUpos[upos]) metrics.byUpos[upos] = createSlice();
        updateSlice(metrics.byUpos[upos],prediction,gold.form);
      }
    }
    assert.ok(goldAnnotatedTokens > 0);
    const report = {
      modelSeed:seed.model,
      splitSeed:seed.split,
      trainSentences:split.train.length,
      validationSentences:split.validation.length,
      internalTestSentences:split.test.length,
      alignedTrainingSentences,
      skippedTrainingSentences,
      alignedIndependentTestSentences:testRowsBySentence.size,
      skippedIndependentTestSentences:skippedTestSentences,
      totalIndependentTestTokens:totalTestTokens,
      goldAnnotatedTokens,
      outputVocabularySize:outputVocabulary.size,
      outputVocabularySaturated:outputVocabulary.size===1024,
      trainingSurfaceTypes:trainTokenFrequency.size,
      trainingLemmaTypes:trainLemmaSet.size,
      morphologyRuleExamples:bankResult.eligibleExamples,
      skippedRuleExamples:bankResult.skippedExamples,
      distinctRuleKeys:bankResult.bank.size,
      metrics:summarizeMetrics(metrics)
    };
    mergeMetrics(aggregate,metrics);
    seedReports.push(report);
  }

  const summary = {
    benchmark:"NEUROGENESIS cross-lemma morphology suffix-rule oracle",
    version:"0.58.122",
    source:{
      treebank:"UD_Russian-GSD",
      release:"r2.18",
      commit:"9acc9d677327043bd416fcc89e4b3407c620d885",
      license:"CC BY-SA 4.0"
    },
    protocol:{
      seeds,
      trainSentences:320,
      independentTestSentences:240,
      maximumSuffixLength:5,
      ruleCondition:"exact UPOS + exact FEATS + matching lemma suffix",
      ruleSupport:"distinct training lemmas; target lemma itself is excluded at prediction",
      onlyTrainingPartitionBuildsRules:true,
      heldOutGoldLemmaUposFeatsUsedAsOracleInput:true,
      heldOutGoldSurfaceUsedOnlyForScoring:true,
      normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps,
      outputVocabularySimulation:"1024-cap, first-seen training-token order",
      independentTestUse:"evaluation only"
    },
    aggregate:summarizeMetrics(aggregate),
    seeds:seedReports
  };
  assert.equal(summary.protocol.normalizedSentenceLeakage,0);
  console.log("NEUROGENESIS 0.58.122 morphology suffix-rule oracle: "+JSON.stringify(summary));
}
