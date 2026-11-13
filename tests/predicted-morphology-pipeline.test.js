"use strict";

// Follow-up benchmark: compare global FEATS heads with UPOS-routed heads.
// Gold-UPOS routing is diagnostic only; predicted-UPOS routing is end-to-end.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const importer = require("../scripts/ud-russian-gsd.js");

const trainPath = process.argv[2];
const testPath = process.argv[3];
const requestedTrainLimit = Number(process.argv[4] || 320);
if (!trainPath && !testPath) {
  console.log("NEUROGENESIS predicted morphology pipeline fixtures: passed; external corpus files not supplied.");
  process.exit(0);
}
assert.ok(trainPath && testPath, "supply both pinned UD train and test CoNLL-U files");
assert.ok(Number.isSafeInteger(requestedTrainLimit) && requestedTrainLimit >= 320 && requestedTrainLimit <= 1280,
  "training-size experiment must use an integer from 320 to 1280 sentences");
const trainContent = fs.readFileSync(trainPath, "utf8");
const testContent = fs.readFileSync(testPath, "utf8");
const preparationOptions = {trainLimit:requestedTrainLimit,testLimit:240,seed:20261112,minimumTokens:4,maximumTokens:40};
const prepared = importer.prepareCorpus(trainContent,testContent,preparationOptions);
assert.equal(prepared.stats.normalizedSampleTrainTestOverlaps,0);
assert.equal(prepared.trainingRecords.length,requestedTrainLimit,
  "the requested decontaminated training sample must be available");
assert.equal(prepared.testRecords.length,240);
if (requestedTrainLimit > 320) {
  const baselineSample = importer.prepareCorpus(trainContent,testContent,
    {...preparationOptions,trainLimit:320});
  assert.deepEqual(prepared.trainingRecords.slice(0,320).map(row=>row.normalized),
    baselineSample.trainingRecords.map(row=>row.normalized),
    "larger training samples must strictly extend the same deterministic 320-sentence baseline");
}

const window = {};
const sandbox = {window,Date,Math,Map,Set,JSON,RegExp,Object,Array,String,Number};
for (const file of ["contextual-attention.js","upos-supervision.js","feats-supervision.js"]) {
  vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
}
const Attention = window.NGContextualModel;
const Upos = window.NGWordSupervision;
const Feats = window.NGFeatsSupervision;
assert.ok(Attention && Upos && Feats);

const seeds = [
  {model:9173,split:902},
  {model:31415,split:2718},
  {model:2718,split:9044}
];
const attributes = ["Case","Number","Gender","Animacy","Degree","Aspect","VerbForm","Voice","Tense"];
const noFeature = "NONE";
const weightings = {
  unweighted:{classWeighting:"none",selectionMetric:"macro_f1"},
  sqrtInverse:{classWeighting:"sqrt_inverse",selectionMetric:"macro_f1"},
  sqrtInverseCapped:{
    classWeighting:"sqrt_inverse_capped",
    minClassWeight:0.75,maxClassWeight:1.5,
    selectionMetric:"macro_f1"
  }
};
const weightingPriority = {unweighted:0,sqrtInverse:1,sqrtInverseCapped:2};

function norm(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/gu,"е");
}
function cleanFeatureValue(value) {
  if (value == null || value === "") return noFeature;
  return [...new Set(String(value).split(",").map(part=>part.trim()).filter(Boolean))]
    .sort().join(",") || noFeature;
}
function trackedFeatures(raw) {
  const result = Object.create(null);
  for (const attribute of attributes) {
    const value = cleanFeatureValue(raw && raw[attribute]);
    if (value !== noFeature) result[attribute] = value;
  }
  return result;
}
function featureSignature(raw) {
  const values = trackedFeatures(raw);
  return JSON.stringify(Object.keys(values).sort().map(key=>[key,values[key]]));
}
function alignedTokenRows(records,model) {
  const rows = [];
  const stats = {inputSentences:records.length,alignedSentences:0,skippedSentences:0,tokenRows:0};
  for (const record of records) {
    const sentenceTokens = model.tokenize(record.text);
    const aligned = [];
    let invalid = false;
    for (const token of record.tokens) {
      const pieces = model.tokenize(token && token.form);
      if (!pieces.length) continue;
      if (!token || pieces.length > 4) { invalid=true; break; }
      for (const piece of pieces) aligned.push({token,piece});
    }
    if (invalid || aligned.length !== sentenceTokens.length ||
        aligned.some((row,index)=>row.piece !== sentenceTokens[index])) {
      stats.skippedSentences++;
      continue;
    }
    stats.alignedSentences++;
    for (let index=0; index<aligned.length; index++) {
      const {token,piece} = aligned[index];
      const score = model.score(record.text,index);
      if (!score || !Array.isArray(score.tokenVector) ||
          !Array.isArray(score.contextualVector) ||
          score.tokenVector.length !== score.contextualVector.length) continue;
      const features = score.tokenVector.concat(score.contextualVector).map(Number);
      if (!features.length || !features.every(Number.isFinite)) continue;
      rows.push({
        features,form:norm(piece),lemma:token.lemma?norm(token.lemma):null,
        upos:token.upos||null,feats:trackedFeatures(token.feats||{}),
        sentenceId:record.sentenceId||null,targetKnown:score.targetKnown===true
      });
    }
  }
  stats.tokenRows=rows.length;
  return {rows,stats};
}
function recordsFor(texts,recordMap) {
  return texts.map(text=>{
    const record=recordMap.get(importer.normalizeSentence(text));
    assert.ok(record,"every internal model split must map to its annotated training sentence");
    return record;
  });
}
function headRows(rows,labelFor) {
  return rows.filter(row=>row.features&&row.features.length&&labelFor(row))
    .map(row=>({features:row.features,label:labelFor(row),lemma:row.lemma}));
}
function chooseHead(Factory,trainRows,validationRows,seed,options) {
  const reports={};
  for(const [name,weighting] of Object.entries(weightings)) {
    const head=Factory.create({seed});
    const training=head.train(trainRows,validationRows,{
      seed,epochs:options.epochs,learningRate:options.learningRate,
      patience:options.patience,...weighting
    });
    assert.ok(Number.isFinite(training.validationMacroF1),
      "checkpoint selection must use finite validation macro-F1");
    reports[name]={head,training};
  }
  const [selected,chosen]=Object.entries(reports).sort((left,right)=>{
    const delta=right[1].training.validationMacroF1-left[1].training.validationMacroF1;
    return Math.abs(delta)>1e-12?delta:weightingPriority[left[0]]-weightingPriority[right[0]];
  })[0];
  return {
    head:chosen.head,selected,validationMacroF1:chosen.training.validationMacroF1,
    reports:Object.fromEntries(Object.entries(reports).map(([name,row])=>[
      name,{validationMacroF1:row.training.validationMacroF1,
        epochs:row.training.epochs,selectionMetric:row.training.selectionMetric}
    ]))
  };
}
function createRuleBank(rows) {
  const bank=new Map();
  let eligible=0,skipped=0;
  for(const row of rows) {
    if(!row.form||!row.lemma||!row.upos||!/[\p{L}\p{N}]/u.test(row.form)) {
      skipped++;
      continue;
    }
    eligible++;
    const signature=featureSignature(row.feats);
    const maximum=Math.min(5,Math.max(0,row.form.length-1));
    for(let width=0;width<=maximum;width++) {
      const sourceSuffix=width?row.form.slice(-width):"";
      const stem=width?row.form.slice(0,-width):row.form;
      if(!row.lemma.startsWith(stem)) continue;
      const outputSuffix=row.lemma.slice(stem.length);
      const key=JSON.stringify([row.upos,signature,sourceSuffix]);
      let outputs=bank.get(key);
      if(!outputs){outputs=new Map();bank.set(key,outputs);}
      let lemmas=outputs.get(outputSuffix);
      if(!lemmas){lemmas=new Set();outputs.set(outputSuffix,lemmas);}
      lemmas.add(row.lemma);
    }
  }
  return {bank,eligible,skipped,keys:bank.size};
}
function predictLemma(form,upos,feats,ruleBank) {
  if(!form||!upos) return {lemma:null,reason:"missing_input"};
  const signature=featureSignature(feats);
  const maximum=Math.min(5,Math.max(0,form.length-1));
  let sawAmbiguous=false;
  for(let width=maximum;width>=0;width--) {
    const suffix=width?form.slice(-width):"";
    const outputs=ruleBank.get(JSON.stringify([upos,signature,suffix]));
    if(!outputs) continue;
    const candidates=[];
    for(const [outputSuffix,lemmas] of outputs) {
      const support=lemmas.size;
      if(support<1) continue;
      const lemma=(width?form.slice(0,-width):form)+outputSuffix;
      if(lemma) candidates.push({lemma,support,width});
    }
    if(!candidates.length) continue;
    const bestSupport=Math.max(...candidates.map(row=>row.support));
    const best=candidates.filter(row=>row.support===bestSupport);
    const unique=[...new Map(best.map(row=>[row.lemma,row])).values()];
    if(unique.length!==1){sawAmbiguous=true;continue;}
    return {...unique[0],reason:"exact_upos_feats_suffix"};
  }
  return {lemma:null,reason:sawAmbiguous?"ambiguous_rule":"no_matching_rule"};
}
function emptySlice(){return {targets:0,generated:0,correct:0,ambiguous:0,supportTotal:0};}
function emptyMetrics(){return {all:emptySlice(),knownLemma:emptySlice(),unseenLemma:emptySlice()};}
function updateSlice(slice,prediction,gold) {
  slice.targets++;
  if(prediction.lemma) {
    slice.generated++;slice.supportTotal+=prediction.support||0;
    if(prediction.lemma===gold) slice.correct++;
  } else if(prediction.reason==="ambiguous_rule") slice.ambiguous++;
}
function mergeMetrics(target,source) {
  for(const group of ["all","knownLemma","unseenLemma"])
    for(const key of Object.keys(target[group])) target[group][key]+=source[group][key];
}
function summariseSlice(slice) {
  return {
    targets:slice.targets,generated:slice.generated,correct:slice.correct,ambiguous:slice.ambiguous,
    coverage:slice.targets?slice.generated/slice.targets:null,
    precisionAmongGenerated:slice.generated?slice.correct/slice.generated:null,
    exactRecallAcrossTargets:slice.targets?slice.correct/slice.targets:null,
    meanSupportingLemmas:slice.generated?slice.supportTotal/slice.generated:null
  };
}
function mergeCounter(target,source) {
  for(const key of Object.keys(source)) target[key]=(target[key]||0)+source[key];
}
function ratio(n,d){return d?n/d:null;}


function constantFeatureHead(label) {
  return Object.freeze({predict(){return {label,confidence:1,probabilities:[{label,probability:1}]};}});
}
function fitPosConditionedFeats(trainRows,validationRows,globalHeads,seed) {
  const heads=Object.create(null),byUpos=Object.create(null);
  const summary={minimumTrainingExamples:24,minimumSupportedValidationExamples:6,trainedHeads:0,constantHeads:0,globalFallbackHeads:0,upos:{}};
  const tags=[...new Set(trainRows.map(row=>row.upos).filter(Boolean))].sort();
  for(const tag of tags) {
    heads[tag]=Object.create(null);byUpos[tag]=Object.create(null);
    const trainForPos=trainRows.filter(row=>row.upos===tag),validationForPos=validationRows.filter(row=>row.upos===tag);
    for(const attribute of attributes) {
      const trainExamples=headRows(trainForPos,row=>cleanFeatureValue(row.feats[attribute]));
      const validationExamples=headRows(validationForPos,row=>cleanFeatureValue(row.feats[attribute]));
      const labels=[...new Set(trainExamples.map(row=>row.label))].sort();
      if(trainExamples.length>=summary.minimumTrainingExamples&&labels.length===1) {
        heads[tag][attribute]=constantFeatureHead(labels[0]);
        byUpos[tag][attribute]={method:"constant",trainingExamples:trainExamples.length,validationExamples:validationExamples.length,classes:labels};
        summary.constantHeads++;
      } else {
        const knownLabels=new Set(labels),supportedValidation=validationExamples.filter(row=>knownLabels.has(row.label));
        if(trainExamples.length>=summary.minimumTrainingExamples&&labels.length>=2&&supportedValidation.length>=summary.minimumSupportedValidationExamples) {
          const seedOffset=[...(tag+":"+attribute)].reduce((sum,char)=>sum+char.charCodeAt(0),0);
          const selected=chooseHead(Feats,trainExamples,supportedValidation,(seed+seedOffset*101)>>>0,{epochs:55,learningRate:0.03,patience:9});
          heads[tag][attribute]=selected.head;
          byUpos[tag][attribute]={method:"trained",trainingExamples:trainExamples.length,validationExamples:supportedValidation.length,classes:labels,selectedWeighting:selected.selected,validationMacroF1:selected.validationMacroF1};
          summary.trainedHeads++;
        } else {
          heads[tag][attribute]=globalHeads[attribute].head;
          byUpos[tag][attribute]={method:"global_fallback",trainingExamples:trainExamples.length,validationExamples:validationExamples.length,classes:labels};
          summary.globalFallbackHeads++;
        }
      }
    }
    summary.upos[tag]={trainingTokens:trainForPos.length,validationTokens:validationForPos.length,
      trained:Object.values(byUpos[tag]).filter(row=>row.method==="trained").length,
      constant:Object.values(byUpos[tag]).filter(row=>row.method==="constant").length,
      globalFallback:Object.values(byUpos[tag]).filter(row=>row.method==="global_fallback").length};
  }
  return {heads,summary:{...summary,byUpos}};
}
function predictPosConditionedFeats(features,upos,conditionedHeads,globalHeads) {
  const selected=conditionedHeads[upos]||Object.create(null),result=Object.create(null);
  for(const attribute of attributes) {
    const head=selected[attribute]||globalHeads[attribute].head,prediction=head.predict(features);
    const value=prediction&&prediction.label||noFeature;
    if(value!==noFeature)result[attribute]=value;
  }
  return result;
}


function selectUposWithMorphologyEvidence(features,uposHead,conditionedTraining,globalHeads,lambda) {
  const base=uposHead.predict(features);
  if(!base||!base.label) return {label:null,baseLabel:null,confidence:0,evidence:0,evidenceAttributes:0};
  const candidates=Array.isArray(base.probabilities)&&base.probabilities.length
    ?base.probabilities:[{label:base.label,probability:1}];
  let bestLabel=base.label,bestScore=Math.log(Math.max(1e-12,base.confidence||1));
  let bestEvidence=0,bestEvidenceAttributes=0,bestConfidence=base.confidence||1;
  for(const candidate of candidates) {
    const tag=candidate.label;
    const probability=Math.max(1e-12,Number(candidate.probability)||0);
    const meta=conditionedTraining.summary.byUpos[tag]||Object.create(null);
    const heads=conditionedTraining.heads[tag]||Object.create(null);
    let evidenceTotal=0,evidenceAttributes=0;
    for(const attribute of attributes) {
      if(!meta[attribute]||meta[attribute].method!=="trained") continue;
      const head=heads[attribute];
      const prediction=head&&head.predict(features);
      const probabilities=prediction&&prediction.probabilities;
      if(!Array.isArray(probabilities)||!probabilities.length) continue;
      const maximum=Math.max(...probabilities.map(row=>Number(row.probability)||0));
      if(!(maximum>0)) continue;
      // Lift over a uniform class baseline; constants and global fallbacks are not evidence.
      evidenceTotal+=Math.log(Math.max(1e-12,maximum*probabilities.length));
      evidenceAttributes++;
    }
    const evidence=evidenceAttributes?evidenceTotal/evidenceAttributes:0;
    const candidateWeight=typeof lambda==="number"?lambda:(lambda&&lambda[tag]);
    const score=Math.log(probability)+Math.max(0,Number(candidateWeight)||0)*evidence;
    if(score>bestScore+1e-12) {
      bestScore=score;
      bestLabel=tag;
      bestEvidence=evidence;
      bestEvidenceAttributes=evidenceAttributes;
      bestConfidence=probability;
    }
  }
  return {
    label:bestLabel,baseLabel:base.label,confidence:bestConfidence,
    evidence:bestEvidence,evidenceAttributes:bestEvidenceAttributes,score:bestScore
  };
}
function lambdaIsZero(lambda) {
  if(typeof lambda==="number") return lambda===0;
  return Object.values(lambda||{}).every(value=>Number(value)===0);
}
function evaluateJointPosEvidence(rows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,lambda) {
  const metrics=emptyMetrics();
  const upos={targets:0,correct:0};
  const featsExact={targets:0,correct:0};
  const joint={targets:0,correct:0};
  let evidenceTotal=0,evidenceRows=0;
  for(const row of rows) {
    if(!row.form||!row.lemma||!row.upos||!/[\p{L}\p{N}]/u.test(row.form)) continue;
    if(outputVocabulary.has(row.form)) continue;
    const selected=selectUposWithMorphologyEvidence(
      row.features,uposHead,conditionedTraining,globalHeads,lambda
    );
    if(!selected.label) continue;
    if(lambdaIsZero(lambda)) assert.equal(selected.label,selected.baseLabel,
      "zero morphology-evidence weight must exactly preserve the base UPOS prediction");
    const predictedFeats=predictPosConditionedFeats(
      row.features,selected.label,conditionedTraining.heads,globalHeads
    );
    const goldFeats=trackedFeatures(row.feats);
    const sameUpos=selected.label===row.upos;
    const sameFeats=featureSignature(predictedFeats)===featureSignature(goldFeats);
    upos.targets++;if(sameUpos)upos.correct++;
    featsExact.targets++;if(sameFeats)featsExact.correct++;
    joint.targets++;if(sameUpos&&sameFeats)joint.correct++;
    evidenceTotal+=selected.evidence;evidenceRows++;
    const prediction=predictLemma(row.form,selected.label,predictedFeats,ruleBank.bank);
    const group=trainLemmas.has(row.lemma)?"knownLemma":"unseenLemma";
    updateSlice(metrics.all,prediction,row.lemma);
    updateSlice(metrics[group],prediction,row.lemma);
  }
  const all=summariseSlice(metrics.all);
  const recall=all.exactRecallAcrossTargets||0;
  const precision=all.precisionAmongGenerated||0;
  const qualityF1=precision+recall?2*precision*recall/(precision+recall):0;
  return {
    metrics,targets:metrics.all.targets,upos,featsExact,joint,
    uposAccuracy:ratio(upos.correct,upos.targets),
    trackedFeatsExactAccuracy:ratio(featsExact.correct,featsExact.targets),
    jointTagsAccuracy:ratio(joint.correct,joint.targets),
    precision,exactRecall:recall,qualityF1,
    meanMorphologyEvidence:evidenceRows?evidenceTotal/evidenceRows:null
  };
}
function tuneJointPosEvidenceLambda(validationRows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas) {
  const candidates=[0,0.125,0.25,0.5,0.75,1,1.5,2,3,4,6,8,12];
  const results=candidates.map(lambda=>{
    const evaluation=evaluateJointPosEvidence(
      validationRows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,lambda
    );
    return {
      lambda,targets:evaluation.targets,
      uposAccuracy:evaluation.uposAccuracy,
      trackedFeatsExactAccuracy:evaluation.trackedFeatsExactAccuracy,
      precision:evaluation.precision,exactRecall:evaluation.exactRecall,
      qualityF1:evaluation.qualityF1,meanMorphologyEvidence:evaluation.meanMorphologyEvidence
    };
  });
  const rank=(a,b)=>b.qualityF1-a.qualityF1 ||
    b.exactRecall-a.exactRecall ||
    b.precision-a.precision ||
    a.lambda-b.lambda;
  const unconstrained=results.slice().sort(rank)[0];
  const baseline=results.find(row=>row.lambda===0);
  const maximumUposAccuracyDrop=0.05;
  const admissible=results.filter(row=>
    row.uposAccuracy!=null&&baseline.uposAccuracy!=null&&
    row.uposAccuracy>=baseline.uposAccuracy-maximumUposAccuracyDrop-1e-12
  );
  const constrained=(admissible.length?admissible:[baseline]).slice().sort(rank)[0];
  return {
    lambda:constrained.lambda,
    constrainedLambda:constrained.lambda,
    unconstrainedLambda:unconstrained.lambda,
    maximumUposAccuracyDrop,
    baselineValidationUposAccuracy:baseline.uposAccuracy,
    results,
    selectedValidation:constrained,
    unconstrainedValidation:unconstrained,
    admissibleCandidateCount:admissible.length,
    usedBaselineFallback:admissible.length===0
  };
}


function tunePosSpecificJointPosEvidenceLambda(validationRows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,globalTuning) {
  const candidates=[0,0.125,0.25,0.5,0.75,1,1.5,2,3,4,6,8,12];
  const minimumTargets=30;
  const maximumUposAccuracyDrop=0.05;
  const globalLambda=globalTuning.constrainedLambda;
  const tags=Object.keys(conditionedTraining.summary.upos).sort();
  let lambdaByUpos=Object.fromEntries(tags.map(tag=>[tag,globalLambda]));
  const rank=(a,b)=>b.qualityF1-a.qualityF1 ||
    b.exactRecall-a.exactRecall ||
    b.precision-a.precision ||
    Math.abs(a.lambda-globalLambda)-Math.abs(b.lambda-globalLambda) ||
    a.lambda-b.lambda;
  const byUpos=Object.create(null);

  for(const tag of tags) {
    const rows=validationRows.filter(row=>row.upos===tag);
    const targets=rows.filter(row=>row.form&&row.lemma&&/[\p{L}\p{N}]/u.test(row.form)&&
      !outputVocabulary.has(row.form)).length;
    if(targets<minimumTargets) {
      byUpos[tag]={targets,selectedLambda:globalLambda,localCandidateLambda:globalLambda,
        baselineUposAccuracy:null,selectedUposAccuracy:null,baselineF1:null,selectedF1:null,
        admissibleCandidateCount:0,fallback:true,reason:"insufficient_validation_targets"};
      continue;
    }

    const baseline=evaluateJointPosEvidence(
      rows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,0
    );
    const reference=evaluateJointPosEvidence(
      rows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,lambdaByUpos
    );
    const results=candidates.map(lambda=>{
      const trial={...lambdaByUpos,[tag]:lambda};
      const evaluation=evaluateJointPosEvidence(
        rows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,trial
      );
      return {lambda,targets:evaluation.targets,uposAccuracy:evaluation.uposAccuracy,
        precision:evaluation.precision,exactRecall:evaluation.exactRecall,qualityF1:evaluation.qualityF1};
    });
    const admissible=results.filter(row=>row.uposAccuracy!=null&&baseline.uposAccuracy!=null&&
      row.uposAccuracy>=baseline.uposAccuracy-maximumUposAccuracyDrop-1e-12);
    const best=(admissible.length?admissible:[results.find(row=>row.lambda===0)]).slice().sort(rank)[0];
    const improves=best.qualityF1>=reference.qualityF1+0.005;
    const referenceAllowed=reference.uposAccuracy!=null&&
      reference.uposAccuracy>=baseline.uposAccuracy-maximumUposAccuracyDrop-1e-12;
    const chosen=improves?best.lambda:(referenceAllowed?globalLambda:0);
    lambdaByUpos[tag]=chosen;
    const selected=results.find(row=>row.lambda===chosen);
    byUpos[tag]={
      targets,selectedLambda:chosen,localCandidateLambda:best.lambda,
      baselineUposAccuracy:baseline.uposAccuracy,
      selectedUposAccuracy:selected?selected.uposAccuracy:null,
      baselineF1:reference.qualityF1,selectedF1:selected?selected.qualityF1:null,
      admissibleCandidateCount:admissible.length,fallback:!improves,
      reason:improves?null:"no_validation_f1_gain_of_at_least_0.005",
      candidates:results
    };
  }

  const globalBaseline=evaluateJointPosEvidence(
    validationRows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,0
  );
  const allowed=globalBaseline.uposAccuracy-maximumUposAccuracyDrop;
  let finalEvaluation=evaluateJointPosEvidence(
    validationRows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,lambdaByUpos
  );
  let shrinkageScale=1;
  if(finalEvaluation.uposAccuracy<allowed-1e-12) {
    for(const scale of [0.75,0.5,0.25,0]) {
      const shrunk=Object.fromEntries(tags.map(tag=>[
        tag,globalLambda+(lambdaByUpos[tag]-globalLambda)*scale
      ]));
      const evaluation=evaluateJointPosEvidence(
        validationRows,outputVocabulary,uposHead,conditionedTraining,globalHeads,ruleBank,trainLemmas,shrunk
      );
      lambdaByUpos=shrunk;
      finalEvaluation=evaluation;
      shrinkageScale=scale;
      if(evaluation.uposAccuracy>=allowed-1e-12) break;
    }
  }
  assert.ok(finalEvaluation.uposAccuracy>=allowed-1e-12,
    "POS-specific calibration must preserve the global validation UPOS guardrail");
  for(const tag of tags) byUpos[tag].effectiveLambda=lambdaByUpos[tag];
  return {
    lambdaByUpos,globalLambda,minimumTargets,maximumUposAccuracyDrop,
    globalBaselineValidationUposAccuracy:globalBaseline.uposAccuracy,
    validation:finalEvaluation,shrinkageScale,byUpos
  };
}

function evaluatePipeline(testRows,outputVocabulary,uposHead,featHeads,conditionedHeads,ruleBank,trainLemmas) {
  const predictedBoth=emptyMetrics(),oracle=emptyMetrics();
  const goldUposPredFeats=emptyMetrics(),predictedUposGoldFeats=emptyMetrics();
  const goldUposConditionedFeats=emptyMetrics(),predictedUposConditionedFeats=emptyMetrics();
  const upos={targets:0,correct:0},featsExact={targets:0,correct:0},joint={targets:0,correct:0};
  const goldUposFeatsExact={targets:0,correct:0},predictedUposFeatsExact={targets:0,correct:0};
  const perAttribute=Object.fromEntries(attributes.map(a=>[a,{targets:0,correct:0}]));
  const perAttributeGoldUpos=Object.fromEntries(attributes.map(a=>[a,{targets:0,correct:0}]));
  const perAttributePredictedUpos=Object.fromEntries(attributes.map(a=>[a,{targets:0,correct:0}]));
  const diagnostics=[];
  for(const row of testRows) {
    if(!row.form||!row.lemma||!row.upos||!/[\p{L}\p{N}]/u.test(row.form)) continue;
    if(outputVocabulary.has(row.form)) continue;
    const uposPrediction=uposHead.predict(row.features);
    const predictedUpos=uposPrediction&&uposPrediction.label;
    const predictedFeats=Object.create(null);
    for(const attribute of attributes) {
      const prediction=featHeads[attribute].head.predict(row.features);
      const value=prediction&&prediction.label||noFeature;
      if(value!==noFeature) predictedFeats[attribute]=value;
      perAttribute[attribute].targets++;
      if(value===cleanFeatureValue(row.feats[attribute])) perAttribute[attribute].correct++;
    }
    const goldFeats=trackedFeatures(row.feats);
    const goldPosFeats=predictPosConditionedFeats(row.features,row.upos,conditionedHeads,featHeads);
    const predictedPosFeats=predictPosConditionedFeats(row.features,predictedUpos,conditionedHeads,featHeads);
    const sameFeats=featureSignature(predictedFeats)===featureSignature(goldFeats);
    const sameGoldPosFeats=featureSignature(goldPosFeats)===featureSignature(goldFeats);
    const samePredictedPosFeats=featureSignature(predictedPosFeats)===featureSignature(goldFeats);
    const sameUpos=predictedUpos===row.upos;
    upos.targets++;if(sameUpos)upos.correct++;
    featsExact.targets++;if(sameFeats)featsExact.correct++;
    goldUposFeatsExact.targets++;if(sameGoldPosFeats)goldUposFeatsExact.correct++;
    predictedUposFeatsExact.targets++;if(samePredictedPosFeats)predictedUposFeatsExact.correct++;
    joint.targets++;if(sameUpos&&sameFeats)joint.correct++;
    for(const attribute of attributes) {
      const goldValue=cleanFeatureValue(row.feats[attribute]);
      perAttributeGoldUpos[attribute].targets++;
      if(cleanFeatureValue(goldPosFeats[attribute])===goldValue)perAttributeGoldUpos[attribute].correct++;
      perAttributePredictedUpos[attribute].targets++;
      if(cleanFeatureValue(predictedPosFeats[attribute])===goldValue)perAttributePredictedUpos[attribute].correct++;
    }
    const group=trainLemmas.has(row.lemma)?"knownLemma":"unseenLemma";
    const predictions={
      oracle:predictLemma(row.form,row.upos,goldFeats,ruleBank.bank),
      goldUposPredFeats:predictLemma(row.form,row.upos,predictedFeats,ruleBank.bank),
      predictedUposGoldFeats:predictLemma(row.form,predictedUpos,goldFeats,ruleBank.bank),
      goldUposConditionedFeats:predictLemma(row.form,row.upos,goldPosFeats,ruleBank.bank),
      predictedUposConditionedFeats:predictLemma(row.form,predictedUpos,predictedPosFeats,ruleBank.bank),
      predictedBoth:predictLemma(row.form,predictedUpos,predictedFeats,ruleBank.bank)
    };
    updateSlice(oracle.all,predictions.oracle,row.lemma);
    updateSlice(oracle[group],predictions.oracle,row.lemma);
    updateSlice(goldUposPredFeats.all,predictions.goldUposPredFeats,row.lemma);
    updateSlice(goldUposPredFeats[group],predictions.goldUposPredFeats,row.lemma);
    updateSlice(predictedUposGoldFeats.all,predictions.predictedUposGoldFeats,row.lemma);
    updateSlice(predictedUposGoldFeats[group],predictions.predictedUposGoldFeats,row.lemma);
    updateSlice(goldUposConditionedFeats.all,predictions.goldUposConditionedFeats,row.lemma);
    updateSlice(goldUposConditionedFeats[group],predictions.goldUposConditionedFeats,row.lemma);
    updateSlice(predictedUposConditionedFeats.all,predictions.predictedUposConditionedFeats,row.lemma);
    updateSlice(predictedUposConditionedFeats[group],predictions.predictedUposConditionedFeats,row.lemma);
    updateSlice(predictedBoth.all,predictions.predictedBoth,row.lemma);
    updateSlice(predictedBoth[group],predictions.predictedBoth,row.lemma);
    if(diagnostics.length<12) diagnostics.push({
      form:row.form,goldLemma:row.lemma,goldUpos:row.upos,predictedUpos,
      goldFeats,predictedFeats,
      oracleLemma:predictions.oracle.lemma,
      predictedLemma:predictions.predictedBoth.lemma
    });
  }
  return {
    predictedBoth,oracle,goldUposPredFeats,predictedUposGoldFeats,
    goldUposConditionedFeats,predictedUposConditionedFeats,
    upos,featsExact,goldUposFeatsExact,predictedUposFeatsExact,joint,
    perAttribute,perAttributeGoldUpos,perAttributePredictedUpos,diagnostics
  };
}

// Rules learned from two different lemmas must restore a third, unseen lemma.
const fixtureFeatures={Case:"Gen",Number:"Sing"};
const fixtureBank=createRuleBank([
  {form:"документа",lemma:"документ",upos:"NOUN",feats:fixtureFeatures},
  {form:"аргумента",lemma:"аргумент",upos:"NOUN",feats:fixtureFeatures}
]);
assert.equal(predictLemma("президента","NOUN",fixtureFeatures,fixtureBank.bank).lemma,"президент");
assert.equal(predictLemma("президента","VERB",fixtureFeatures,fixtureBank.bank).lemma,null,
  "the inverse generator must not ignore predicted UPOS");

const recordMap=new Map(prepared.trainingRecords.map(row=>[row.normalized,row]));
const aggregate={
  predictedBoth:emptyMetrics(),oracle:emptyMetrics(),
  goldUposPredFeats:emptyMetrics(),predictedUposGoldFeats:emptyMetrics(),
  goldUposConditionedFeats:emptyMetrics(),predictedUposConditionedFeats:emptyMetrics(),
  jointUposEvidenceReranked:emptyMetrics(),
  jointUposEvidenceRerankedUPOS:{targets:0,correct:0},
  jointUposEvidenceRerankedFeatsExact:{targets:0,correct:0},
  jointUposEvidenceRerankedJointTags:{targets:0,correct:0},
  jointUposEvidenceConstrained:emptyMetrics(),
  jointUposEvidenceConstrainedUPOS:{targets:0,correct:0},
  jointUposEvidenceConstrainedFeatsExact:{targets:0,correct:0},
  jointUposEvidenceConstrainedJointTags:{targets:0,correct:0},
  jointUposEvidencePosSpecific:emptyMetrics(),
  jointUposEvidencePosSpecificUPOS:{targets:0,correct:0},
  jointUposEvidencePosSpecificFeatsExact:{targets:0,correct:0},
  jointUposEvidencePosSpecificJointTags:{targets:0,correct:0},
  upos:{targets:0,correct:0},featsExact:{targets:0,correct:0},
  goldUposFeatsExact:{targets:0,correct:0},predictedUposFeatsExact:{targets:0,correct:0},
  joint:{targets:0,correct:0},
  perAttribute:Object.fromEntries(attributes.map(a=>[a,{targets:0,correct:0}])),
  perAttributeGoldUpos:Object.fromEntries(attributes.map(a=>[a,{targets:0,correct:0}])),
  perAttributePredictedUpos:Object.fromEntries(attributes.map(a=>[a,{targets:0,correct:0}]))
};
const seedReports=[];
const vocabularyLimit=1024;

for(const seed of seeds) {
  const contextual=Attention.create({
    dimension:12,windowSize:4,heads:3,blocks:2,seed:seed.model
  });
  const contextualTraining=contextual.train(prepared.trainingTexts,{
    epochs:20,learningRate:0.02,patience:8,splitSeed:seed.split
  });
  assert.ok(contextualTraining.evaluationIsolated===true,
    "contextual encoder validation/test partitions must remain isolated");
  const split=contextual.splitCorpus(prepared.trainingTexts,seed.split);
  assert.equal(split.train.length,contextualTraining.trainRows);
  assert.equal(split.validation.length,contextualTraining.validationRows);
  const trainExtracted=alignedTokenRows(recordsFor(split.train,recordMap),contextual);
  const validationExtracted=alignedTokenRows(recordsFor(split.validation,recordMap),contextual);
  const testExtracted=alignedTokenRows(prepared.testRecords,contextual);
  for(const [name,result] of [["train",trainExtracted],["validation",validationExtracted],["independentTest",testExtracted]]) {
    assert.equal(result.stats.skippedSentences,0,name+" sentence annotations must align completely");
  }
  const trainRows=trainExtracted.rows.filter(row=>row.upos&&row.lemma);
  const validationRows=validationExtracted.rows.filter(row=>row.upos&&row.lemma);
  const testRows=testExtracted.rows.filter(row=>row.upos&&row.lemma);
  assert.ok(trainRows.length&&validationRows.length&&testRows.length);

  const uposSelected=chooseHead(
    Upos,
    headRows(trainRows,row=>row.upos),
    headRows(validationRows,row=>row.upos),
    seed.model,{epochs:80,learningRate:0.035,patience:12}
  );
  const featHeads=Object.create(null),featSelection={};
  for(const attribute of attributes) {
    const trainExamples=headRows(trainRows,row=>cleanFeatureValue(row.feats[attribute]));
    const validationExamples=headRows(validationRows,row=>cleanFeatureValue(row.feats[attribute]));
    assert.ok(new Set(trainExamples.map(row=>row.label)).size>=2,
      "each FEATS head must learn absent and present/alternative values");
    featHeads[attribute]=chooseHead(
      Feats,trainExamples,validationExamples,seed.model,
      {epochs:55,learningRate:0.03,patience:9}
    );
    featSelection[attribute]={
      weighting:featHeads[attribute].selected,
      validationMacroF1:featHeads[attribute].validationMacroF1
    };
  }

  const conditionedTraining=fitPosConditionedFeats(trainRows,validationRows,featHeads,seed.model);
  const outputVocabulary=new Set();
  for(const sentence of split.train) {
    for(const token of contextual.tokenize(sentence)) {
      if(outputVocabulary.size<vocabularyLimit) outputVocabulary.add(norm(token));
    }
  }
  assert.equal(outputVocabulary.size,vocabularyLimit);
  const trainLemmas=new Set(trainRows.map(row=>row.lemma).filter(Boolean));
  const ruleBank=createRuleBank(trainRows);
  const evaluation=evaluatePipeline(
    testRows,outputVocabulary,uposSelected.head,featHeads,conditionedTraining.heads,ruleBank,trainLemmas
  );
  const rerankingTuning=tuneJointPosEvidenceLambda(
    validationRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas
  );
  const rerankedValidation=evaluateJointPosEvidence(
    validationRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas,
    rerankingTuning.constrainedLambda
  );
  const rerankedTest=evaluateJointPosEvidence(
    testRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas,
    rerankingTuning.constrainedLambda
  );
  const unconstrainedValidation=evaluateJointPosEvidence(
    validationRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas,
    rerankingTuning.unconstrainedLambda
  );
  const unconstrainedTest=evaluateJointPosEvidence(
    testRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas,
    rerankingTuning.unconstrainedLambda
  );
  const posSpecificTuning=tunePosSpecificJointPosEvidenceLambda(
    validationRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas,
    rerankingTuning
  );
  const posSpecificValidation=posSpecificTuning.validation;
  const posSpecificTest=evaluateJointPosEvidence(
    testRows,outputVocabulary,uposSelected.head,conditionedTraining,featHeads,ruleBank,trainLemmas,
    posSpecificTuning.lambdaByUpos
  );
  assert.ok(rerankedValidation.targets>0,"joint POS evidence must tune on internal OOV validation targets");
  assert.ok(rerankedValidation.uposAccuracy>=rerankingTuning.baselineValidationUposAccuracy-
    rerankingTuning.maximumUposAccuracyDrop-1e-12,
    "constrained lambda must respect the validation UPOS accuracy guardrail");
  assert.ok(posSpecificValidation.targets>0,"POS-specific calibration must tune on validation OOV targets");
  assert.ok(posSpecificValidation.uposAccuracy>=posSpecificTuning.globalBaselineValidationUposAccuracy-
    posSpecificTuning.maximumUposAccuracyDrop-1e-12,
    "POS-specific calibration must respect the global validation UPOS guardrail");
  assert.equal(posSpecificTest.targets,evaluation.predictedUposConditionedFeats.all.targets,
    "POS-specific calibration must score the same independent OOV test targets");
  assert.equal(rerankedTest.targets,evaluation.predictedUposConditionedFeats.all.targets,
    "constrained reranking must score the same independent OOV targets as the raw UPOS route");
  mergeMetrics(aggregate.jointUposEvidenceReranked,unconstrainedTest.metrics);
  mergeCounter(aggregate.jointUposEvidenceRerankedUPOS,unconstrainedTest.upos);
  mergeCounter(aggregate.jointUposEvidenceRerankedFeatsExact,unconstrainedTest.featsExact);
  mergeCounter(aggregate.jointUposEvidenceRerankedJointTags,unconstrainedTest.joint);
  mergeMetrics(aggregate.jointUposEvidenceConstrained,rerankedTest.metrics);
  mergeCounter(aggregate.jointUposEvidenceConstrainedUPOS,rerankedTest.upos);
  mergeCounter(aggregate.jointUposEvidenceConstrainedFeatsExact,rerankedTest.featsExact);
  mergeCounter(aggregate.jointUposEvidenceConstrainedJointTags,rerankedTest.joint);
  mergeMetrics(aggregate.jointUposEvidencePosSpecific,posSpecificTest.metrics);
  mergeCounter(aggregate.jointUposEvidencePosSpecificUPOS,posSpecificTest.upos);
  mergeCounter(aggregate.jointUposEvidencePosSpecificFeatsExact,posSpecificTest.featsExact);
  mergeCounter(aggregate.jointUposEvidencePosSpecificJointTags,posSpecificTest.joint);
  for(const key of ["predictedBoth","oracle","goldUposPredFeats","predictedUposGoldFeats","goldUposConditionedFeats","predictedUposConditionedFeats"])
    mergeMetrics(aggregate[key],evaluation[key]);
  for(const key of ["upos","featsExact","goldUposFeatsExact","predictedUposFeatsExact","joint"])
    mergeCounter(aggregate[key],evaluation[key]);
  for(const attribute of attributes) {
    mergeCounter(aggregate.perAttribute[attribute],evaluation.perAttribute[attribute]);
    mergeCounter(aggregate.perAttributeGoldUpos[attribute],evaluation.perAttributeGoldUpos[attribute]);
    mergeCounter(aggregate.perAttributePredictedUpos[attribute],evaluation.perAttributePredictedUpos[attribute]);
  }

  seedReports.push({
    modelSeed:seed.model,splitSeed:seed.split,
    contextualTraining:{
      trainRows:contextualTraining.trainRows,validationRows:contextualTraining.validationRows,
      internalTestRows:contextualTraining.testRows,vocabularySize:contextualTraining.vocabularySize,
      epochs:contextualTraining.epochs
    },
    extraction:{
      training:trainExtracted.stats,validation:validationExtracted.stats,
      independentTest:testExtracted.stats,supervisedTrainingRows:trainRows.length,
      supervisedValidationRows:validationRows.length,supervisedIndependentTestRows:testRows.length
    },
    heads:{
      upos:{selectedWeighting:uposSelected.selected,
        validationMacroF1:uposSelected.validationMacroF1,candidates:uposSelected.reports},
      feats:featSelection,
      posConditionedFeats:conditionedTraining.summary
    },
    inverseLemmaRuleBank:{
      eligibleTrainingExamples:ruleBank.eligible,
      skippedTrainingExamples:ruleBank.skipped,
      distinctRuleKeys:ruleBank.keys
    },
    outputVocabulary:{capacity:vocabularyLimit,size:outputVocabulary.size},
    oovTargets:evaluation.predictedBoth.all.targets,
    tokenMetrics:{
      uposAccuracy:ratio(evaluation.upos.correct,evaluation.upos.targets),
      trackedFeatsExactAccuracy:ratio(evaluation.featsExact.correct,evaluation.featsExact.targets),
      jointTagsAccuracy:ratio(evaluation.joint.correct,evaluation.joint.targets)
    },
    lemma:Object.fromEntries(["oracle","goldUposPredFeats","predictedUposGoldFeats","predictedBoth"].map(key=>[
      key,Object.fromEntries(Object.entries(evaluation[key]).map(([slice,value])=>[slice,summariseSlice(value)]))
    ])),
    posSpecificJointPosEvidence:{
      globalFallbackLambda:posSpecificTuning.globalLambda,
      minimumValidationTargets:posSpecificTuning.minimumTargets,
      maximumGlobalUposAccuracyDrop:posSpecificTuning.maximumUposAccuracyDrop,
      baselineValidationUposAccuracy:posSpecificTuning.globalBaselineValidationUposAccuracy,
      validationUposAccuracy:posSpecificValidation.uposAccuracy,
      validationLemmaF1:posSpecificValidation.qualityF1,
      shrinkageScale:posSpecificTuning.shrinkageScale,
      lambdaByUpos:posSpecificTuning.lambdaByUpos,
      byUpos:posSpecificTuning.byUpos,
      independentTest:{
        targets:posSpecificTest.targets,uposAccuracy:posSpecificTest.uposAccuracy,
        trackedFeatsExactAccuracy:posSpecificTest.trackedFeatsExactAccuracy,
        jointTagsAccuracy:posSpecificTest.jointTagsAccuracy,
        precision:posSpecificTest.precision,exactRecall:posSpecificTest.exactRecall,
        qualityF1:posSpecificTest.qualityF1,
        meanMorphologyEvidence:posSpecificTest.meanMorphologyEvidence,
        lemma:summariseMetrics(posSpecificTest.metrics)
      }
    },
    jointPosEvidenceReranking:{
      selectedLambda:rerankingTuning.constrainedLambda,
      unconstrainedLambda:rerankingTuning.unconstrainedLambda,
      maximumUposAccuracyDrop:rerankingTuning.maximumUposAccuracyDrop,
      baselineValidationUposAccuracy:rerankingTuning.baselineValidationUposAccuracy,
      admissibleCandidateCount:rerankingTuning.admissibleCandidateCount,
      usedBaselineFallback:rerankingTuning.usedBaselineFallback,
      selectionObjective:"maximize exact-lemma F1 subject to validation UPOS accuracy no more than 5 percentage points below lambda=0; ties prefer recall, precision, then smaller lambda",
      validationTuning:rerankingTuning.results,
      unconstrainedValidation:{
        targets:unconstrainedValidation.targets,uposAccuracy:unconstrainedValidation.uposAccuracy,
        trackedFeatsExactAccuracy:unconstrainedValidation.trackedFeatsExactAccuracy,
        precision:unconstrainedValidation.precision,exactRecall:unconstrainedValidation.exactRecall,
        qualityF1:unconstrainedValidation.qualityF1,
        lemma:summariseMetrics(unconstrainedValidation.metrics)
      },
      unconstrainedIndependentTest:{
        targets:unconstrainedTest.targets,uposAccuracy:unconstrainedTest.uposAccuracy,
        trackedFeatsExactAccuracy:unconstrainedTest.trackedFeatsExactAccuracy,
        jointTagsAccuracy:unconstrainedTest.jointTagsAccuracy,
        precision:unconstrainedTest.precision,exactRecall:unconstrainedTest.exactRecall,
        qualityF1:unconstrainedTest.qualityF1,
        meanMorphologyEvidence:unconstrainedTest.meanMorphologyEvidence,
        lemma:summariseMetrics(unconstrainedTest.metrics)
      },
      validation:{
        targets:rerankedValidation.targets,uposAccuracy:rerankedValidation.uposAccuracy,
        trackedFeatsExactAccuracy:rerankedValidation.trackedFeatsExactAccuracy,
        precision:rerankedValidation.precision,exactRecall:rerankedValidation.exactRecall,
        qualityF1:rerankedValidation.qualityF1,
        lemma:summariseMetrics(rerankedValidation.metrics)
      },
      independentTest:{
        targets:rerankedTest.targets,uposAccuracy:rerankedTest.uposAccuracy,
        trackedFeatsExactAccuracy:rerankedTest.trackedFeatsExactAccuracy,
        jointTagsAccuracy:rerankedTest.jointTagsAccuracy,
        precision:rerankedTest.precision,exactRecall:rerankedTest.exactRecall,
        qualityF1:rerankedTest.qualityF1,
        meanMorphologyEvidence:rerankedTest.meanMorphologyEvidence,
        lemma:summariseMetrics(rerankedTest.metrics)
      }
    },
    diagnosticExamples:evaluation.diagnostics
  });
}
function summariseMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([key,value])=>[key,summariseSlice(value)]));
}
function summariseTokens(value) {
  return {...value,accuracy:ratio(value.correct,value.targets)};
}
const report={
  benchmark:"NEUROGENESIS UPOS-conditioned FEATS to inverse morphology lemma pipeline",
  version:"0.58.128",
  source:{
    treebank:"UD_Russian-GSD",release:"r2.18",
    commit:"9acc9d677327043bd416fcc89e4b3407c620d885",license:"CC BY-SA 4.0"
  },
  protocol:{
    seeds,trainSentences:prepared.trainingRecords.length,requestedTrainSentences:requestedTrainLimit,eligibleTrainSentences:prepared.stats.eligibleTrainSentencesAfterDecontamination,independentTestSentences:240,outputVocabularyCapacity:vocabularyLimit,
    trackedFeatures:attributes,
    featurePrediction:"global contextual classifiers plus UPOS-conditioned contextual heads; compare global constrained morphology-evidence lambda with POS-specific validation-calibrated weights, minimum POS support and global UPOS guardrail; test annotations remain scoring-only; constant and fallback heads are excluded from evidence; NONE is explicit",
    headSelection:"validation macro-F1 among unweighted, sqrt-inverse and capped sqrt-inverse",
    inverseLemmaRules:"surface suffix to lemma suffix, conditioned on predicted UPOS and exact tracked FEATS",
    maximumSuffixLength:5,ruleSupport:"distinct training lemmas",
    noGoldLemmaOrUPOSOrFEATSAtInference:true,
    testGoldAnnotations:"scoring and seen/unseen-lemma slicing only",
    normalizedSentenceLeakage:prepared.stats.normalizedSampleTrainTestOverlaps
  },
  tokenPrediction:{
    upos:summariseTokens(aggregate.upos),
    trackedFeatsExact:summariseTokens(aggregate.featsExact),
    goldUposConditionedFeatsExact:summariseTokens(aggregate.goldUposFeatsExact),
    predictedUposConditionedFeatsExact:summariseTokens(aggregate.predictedUposFeatsExact),
    jointPosEvidenceUPOS:summariseTokens(aggregate.jointUposEvidenceRerankedUPOS),
    jointPosEvidenceTrackedFeatsExact:summariseTokens(aggregate.jointUposEvidenceRerankedFeatsExact),
    jointPosEvidenceJointTags:summariseTokens(aggregate.jointUposEvidenceRerankedJointTags),
    constrainedJointPosEvidenceUPOS:summariseTokens(aggregate.jointUposEvidenceConstrainedUPOS),
    constrainedJointPosEvidenceTrackedFeatsExact:summariseTokens(aggregate.jointUposEvidenceConstrainedFeatsExact),
    constrainedJointPosEvidenceJointTags:summariseTokens(aggregate.jointUposEvidenceConstrainedJointTags),
    posSpecificJointPosEvidenceUPOS:summariseTokens(aggregate.jointUposEvidencePosSpecificUPOS),
    posSpecificJointPosEvidenceTrackedFeatsExact:summariseTokens(aggregate.jointUposEvidencePosSpecificFeatsExact),
    posSpecificJointPosEvidenceJointTags:summariseTokens(aggregate.jointUposEvidencePosSpecificJointTags),
    jointTags:summariseTokens(aggregate.joint)
  },
  perAttribute:Object.fromEntries(Object.entries(aggregate.perAttribute).map(([key,value])=>[key,summariseTokens(value)])),
  perAttributeConditioned:{
    goldUpos:Object.fromEntries(Object.entries(aggregate.perAttributeGoldUpos).map(([key,value])=>[key,summariseTokens(value)])),
    predictedUpos:Object.fromEntries(Object.entries(aggregate.perAttributePredictedUpos).map(([key,value])=>[key,summariseTokens(value)]))
  },
  lemma:{
    predictedBoth:summariseMetrics(aggregate.predictedBoth),
    goldUposPredFeats:summariseMetrics(aggregate.goldUposPredFeats),
    predictedUposGoldFeats:summariseMetrics(aggregate.predictedUposGoldFeats),
    goldUposConditionedFeats:summariseMetrics(aggregate.goldUposConditionedFeats),
    predictedUposConditionedFeats:summariseMetrics(aggregate.predictedUposConditionedFeats),
    jointUposEvidenceUnconstrained:summariseMetrics(aggregate.jointUposEvidenceReranked),
    jointUposEvidenceConstrained:summariseMetrics(aggregate.jointUposEvidenceConstrained),
    jointUposEvidencePosSpecific:summariseMetrics(aggregate.jointUposEvidencePosSpecific),
    oracleGoldTags:summariseMetrics(aggregate.oracle)
  },
  seeds:seedReports
};
assert.equal(report.protocol.normalizedSentenceLeakage,0);
assert.ok(report.lemma.oracleGoldTags.unseenLemma.targets>0);
assert.ok(report.lemma.oracleGoldTags && report.lemma.oracleGoldTags.all,
  "oracle lemma metrics must be present in the report");
assert.equal(report.lemma.predictedBoth.all.targets,report.lemma.oracleGoldTags.all.targets);
console.log("NEUROGENESIS 0.58.127 POS-specific UPOS-evidence calibration pipeline: "+JSON.stringify(report));
