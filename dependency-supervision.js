(() => {
  "use strict";

  const SCHEMA = "NG_DEPENDENCY_HEAD_RELATION_V1";
  function normaliseLemma(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/ё/gu, "е")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }
  function cleanRelation(value) {
    const label = String(value || "").trim().toLowerCase();
    return /^[a-z][a-z0-9_]*(?::[a-z0-9_]+)*$/u.test(label) ? label : "";
  }
  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function seededRandom(seed) {
    let state = (Math.floor(finite(seed, 9173)) >>> 0) || 9173;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function softmax(logits) {
    if (!logits.length) return [];
    const maximum = Math.max(...logits);
    const exponents = logits.map(value => Math.exp(Math.max(-60, Math.min(60, value - maximum))));
    const total = exponents.reduce((sum, value) => sum + value, 0) || 1;
    return exponents.map(value => value / total);
  }
  function dot(left, right) {
    let total = 0;
    for (let index = 0; index < left.length; index++) total += left[index] * right[index];
    return total;
  }
  function clip(value) {
    return Math.max(-5, Math.min(5, Number.isFinite(value) ? value : 0));
  }
  function pairFeatures(dependent, head, relativePosition, isRoot) {
    const product = dependent.map((value, index) => value * head[index]);
    return dependent.concat(head, product, [
      Math.max(-1, Math.min(1, relativePosition)),
      Math.min(1, Math.abs(relativePosition)),
      isRoot ? 1 : 0
    ]);
  }

  function extractExamples(records, contextualModel) {
    if (!Array.isArray(records)) throw new TypeError("Annotated sentence records must be an array.");
    if (!contextualModel || typeof contextualModel.tokenize !== "function" ||
        typeof contextualModel.score !== "function") {
      throw new TypeError("A trained contextual model with tokenize() and score() is required.");
    }
    const groups = [];
    const reasons = Object.create(null);
    let alignedSentences = 0, annotatedTokens = 0, rootExamples = 0;
    const skip = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };

    for (const record of records) {
      if (!record || typeof record.text !== "string" || !Array.isArray(record.tokens)) {
        skip("missing_sentence_annotations");
        continue;
      }
      const textTokens = contextualModel.tokenize(record.text);
      const alignedPieces = [];
      let invalidForm = false;
      for (const token of record.tokens) {
        const pieces = contextualModel.tokenize(token && token.form);
        if (!token || !pieces.length || pieces.length > 4) {
          invalidForm = true;
          break;
        }
        for (const piece of pieces) alignedPieces.push({token, piece});
      }
      if (invalidForm) {
        skip("unsupported_token_form");
        continue;
      }
      if (alignedPieces.length !== textTokens.length ||
          alignedPieces.some((row, index) => row.piece !== textTokens[index])) {
        skip("tokenization_mismatch");
        continue;
      }

      const wordRows = [];
      let cursor = 0, invalidFeatures = false;
      for (const token of record.tokens) {
        const pieces = contextualModel.tokenize(token.form);
        const pieceFeatures = [], pieceKnown = [];
        for (let offset = 0; offset < pieces.length; offset++) {
          const score = contextualModel.score(record.text, cursor + offset);
          if (!score || !Array.isArray(score.tokenVector) ||
              !Array.isArray(score.contextualVector) ||
              score.tokenVector.length !== score.contextualVector.length) {
            invalidFeatures = true;
            break;
          }
          const features = score.tokenVector.concat(score.contextualVector).map(Number);
          if (!features.length || !features.every(Number.isFinite)) {
            invalidFeatures = true;
            break;
          }
          pieceFeatures.push(features);
          pieceKnown.push(score.targetKnown === true);
        }
        if (invalidFeatures) break;
        const dimension = pieceFeatures[0].length;
        if (pieceFeatures.some(row => row.length !== dimension)) {
          invalidFeatures = true;
          break;
        }
        const meanFeatures = Array.from({length:dimension}, (_, index) =>
          pieceFeatures.reduce((sum, row) => sum + row[index], 0) / pieceFeatures.length);
        const id = Number(token.id);
        if (!Number.isInteger(id) || id < 1) {
          invalidFeatures = true;
          break;
        }
        wordRows.push({
          id,
          features:meanFeatures,
          lemma:normaliseLemma(token.lemma || token.form),
          form:pieces.join(" "),
          targetKnown:pieceKnown.every(Boolean)
        });
        cursor += pieces.length;
      }
      if (invalidFeatures) {
        skip("invalid_contextual_features");
        continue;
      }
      if (new Set(wordRows.map(row => row.id)).size !== wordRows.length) {
        skip("duplicate_token_id");
        continue;
      }
      const byId = new Map(wordRows.map((row, index) => [row.id, index]));
      const sentenceLength = wordRows.length;
      if (sentenceLength < 2) {
        skip("sentence_too_short");
        continue;
      }
      alignedSentences++;

      for (let dependentIndex = 0; dependentIndex < record.tokens.length; dependentIndex++) {
        const annotation = record.tokens[dependentIndex];
        const dependent = wordRows[dependentIndex];
        const relation = cleanRelation(annotation.deprel);
        const headId = Number(annotation.head);
        if (!relation || !Number.isInteger(headId) || headId < 0) {
          skip("missing_dependency_annotation");
          continue;
        }
        if (headId === dependent.id) {
          skip("self_head");
          continue;
        }
        if (headId !== 0 && !byId.has(headId)) {
          skip("unknown_head_id");
          continue;
        }
        const candidateHeadIds = [0, ...wordRows
          .filter(row => row.id !== dependent.id).map(row => row.id)];
        const candidateHeadIndexes = candidateHeadIds.map(id => id === 0 ? -1 : byId.get(id));
        const targetCandidateIndex = candidateHeadIds.indexOf(headId);
        if (targetCandidateIndex < 0) {
          skip("unmapped_gold_head");
          continue;
        }
        const candidateFeatures = candidateHeadIndexes.map(headIndex => {
          const isRoot = headIndex < 0;
          const head = isRoot ? Array(dependent.features.length).fill(0) : wordRows[headIndex].features;
          const relative = isRoot ? -1 :
            (headIndex - dependentIndex) / Math.max(1, sentenceLength - 1);
          return pairFeatures(dependent.features, head, relative, isRoot);
        });
        groups.push({
          sentenceId:record.sentenceId || null,
          sentenceLength,
          tokenIds:wordRows.map(row => row.id),
          dependentIndex,
          dependentId:dependent.id,
          dependentToken:dependent.form,
          lemma:dependent.lemma,
          targetKnown:dependent.targetKnown,
          candidateHeadIds,
          candidateHeadIndexes,
          candidateFeatures,
          targetCandidateIndex,
          relation
        });
        annotatedTokens++;
        if (headId === 0) rootExamples++;
      }
    }
    return {
      groups,
      stats:{
        inputSentences:records.length,
        alignedSentences,
        skippedSentences:records.length-alignedSentences,
        dependencyExamples:groups.length,
        annotatedTokens,
        rootExamples,
        skippedReasons:reasons
      }
    };
  }

  function create(options = {}) {
    const seed = Math.floor(finite(options.seed, 9173)) >>> 0;
    let labels = [], arcWeights = [], relationWeights = [], relationBias = [];
    let featureDimension = 0, trainingSteps = 0, lastTraining = null, labelCounts = {};

    function validateGroup(group, dimension) {
      return !!(group && Array.isArray(group.candidateFeatures) &&
        Array.isArray(group.candidateHeadIds) &&
        group.candidateFeatures.length === group.candidateHeadIds.length &&
        group.candidateFeatures.length >= 2 &&
        Number.isInteger(group.targetCandidateIndex) &&
        group.targetCandidateIndex >= 0 &&
        group.targetCandidateIndex < group.candidateFeatures.length &&
        typeof group.relation === "string" && cleanRelation(group.relation) === group.relation &&
        group.candidateFeatures.every(row => Array.isArray(row) && row.length === dimension &&
          row.every(value => Number.isFinite(Number(value)))));
    }
    function relationLogits(features) {
      return labels.map((label, index) => dot(relationWeights[index], features) + relationBias[index]);
    }
    function predictRelation(features) {
      if (!labels.length || !Array.isArray(features) || features.length !== featureDimension) return null;
      const probabilities = softmax(relationLogits(features));
      let best = 0;
      for (let index = 1; index < probabilities.length; index++) {
        if (probabilities[index] > probabilities[best]) best = index;
      }
      return {
        label:labels[best],
        confidence:probabilities[best],
        probabilities:labels.map((label, index) => ({label, probability:probabilities[index]}))
          .sort((left, right) => right.probability-left.probability)
      };
    }
    function predictedHeadIndex(group) {
      let best = 0, bestScore = -Infinity;
      for (let index = 0; index < group.candidateFeatures.length; index++) {
        const score = dot(arcWeights, group.candidateFeatures[index]);
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      }
      return best;
    }
    function evaluate(examples) {
      const rows = Array.isArray(examples) ? examples.filter(Boolean) : [];
      if (!rows.length) return {
        targets:0,headCorrect:0,headAccuracy:null,oracleRelationCorrect:0,
        oracleRelationAccuracy:null,relationMacroF1:null,lasCorrect:0,las:null,perRelation:{}
      };
      let headCorrect = 0, oracleRelationCorrect = 0, lasCorrect = 0;
      const totals = Object.create(null), predicted = Object.create(null), correct = Object.create(null);
      for (const group of rows) {
        const predictedIndex = predictedHeadIndex(group);
        const headIsCorrect = predictedIndex === group.targetCandidateIndex;
        if (headIsCorrect) headCorrect++;
        const oracleRelation = predictRelation(group.candidateFeatures[group.targetCandidateIndex]);
        const predictedRelation = predictRelation(group.candidateFeatures[predictedIndex]);
        if (oracleRelation && oracleRelation.label === group.relation) oracleRelationCorrect++;
        if (headIsCorrect && predictedRelation && predictedRelation.label === group.relation) lasCorrect++;
        totals[group.relation] = (totals[group.relation] || 0) + 1;
        if (oracleRelation) predicted[oracleRelation.label] = (predicted[oracleRelation.label] || 0) + 1;
        if (oracleRelation && oracleRelation.label === group.relation) {
          correct[group.relation] = (correct[group.relation] || 0) + 1;
        }
      }
      const perRelation = Object.create(null), f1 = [];
      for (const label of new Set([...Object.keys(totals), ...Object.keys(predicted)])) {
        const support = totals[label] || 0;
        const predictedCount = predicted[label] || 0;
        const truePositive = correct[label] || 0;
        const precision = predictedCount ? truePositive / predictedCount : 0;
        const recall = support ? truePositive / support : 0;
        const score = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
        perRelation[label] = {targets:support,predicted:predictedCount,correct:truePositive,precision,recall,f1:score};
        if (support) f1.push(score);
      }
      return {
        targets:rows.length,
        headCorrect,
        headAccuracy:headCorrect/rows.length,
        oracleRelationCorrect,
        relationCovered:rows.filter(row=>labels.includes(row.relation)).length,
        relationCoverage:rows.filter(row=>labels.includes(row.relation)).length/rows.length,
        oracleRelationAccuracy:labels.length
          ?oracleRelationCorrect/Math.max(1,rows.filter(row=>labels.includes(row.relation)).length):null,
        relationMacroF1:f1.length?f1.reduce((sum,value)=>sum+value,0)/f1.length:null,
        lasCorrect,
        las:lasCorrect/rows.length,
        perRelation
      };
    }

    function train(trainExamples, validationExamples = [], trainOptions = {}) {
      const rows = Array.isArray(trainExamples) ? trainExamples.filter(Boolean) : [];
      if (!rows.length) throw new TypeError("Dependency training needs annotated head/relation examples.");
      const dimension = rows[0].candidateFeatures && rows[0].candidateFeatures[0] &&
        rows[0].candidateFeatures[0].length;
      if (!Number.isInteger(dimension) || dimension < 4 ||
          rows.some(row => !validateGroup(row, dimension))) {
        throw new TypeError("Dependency training examples have invalid candidate features or gold heads.");
      }
      const validation = Array.isArray(validationExamples) ? validationExamples.filter(Boolean) : [];
      if (validation.some(row => !validateGroup(row, dimension))) {
        throw new TypeError("Dependency validation examples have invalid candidate features or gold heads.");
      }
      const requestedMetric = trainOptions.selectionMetric;
      if (requestedMetric && requestedMetric !== "las") {
        throw new TypeError("Dependency checkpoint selection supports only the paired LAS metric.");
      }

      trainingSteps = 0;
      lastTraining = null;
      featureDimension = dimension;
      const allLabels = [...new Set(rows.map(row => cleanRelation(row.relation)).filter(Boolean))].sort();
      if (allLabels.length < 2) throw new TypeError("Dependency training needs at least two relation labels.");
      labelCounts = Object.create(null);
      for (const row of rows) labelCounts[row.relation] = (labelCounts[row.relation] || 0) + 1;
      const minimumClassExamples=Math.max(1,Math.floor(finite(trainOptions.minimumClassExamples,1)));
      labels = Object.entries(labelCounts)
        .filter(([,count])=>count>=minimumClassExamples)
        .map(([label])=>label).sort();
      if(labels.length<2) throw new TypeError("Dependency training needs at least two relations meeting minimumClassExamples.");
      const supportedLabels=new Set(labels);
      const relationRows=rows.filter(row=>supportedLabels.has(row.relation));
      const random = seededRandom(trainOptions.seed == null ? seed : trainOptions.seed);
      arcWeights = Array.from({length:featureDimension}, () => (random()*2-1)*0.006);
      relationWeights = Array.from({length:labels.length}, () =>
        Array.from({length:featureDimension}, () => (random()*2-1)*0.012));
      relationBias = Array.from({length:labels.length}, () => 0);

      const classWeighting = trainOptions.classWeighting === "sqrt_inverse" ? "sqrt_inverse" : "none";
      const classWeights = new Map(labels.map(label => [label,1]));
      if (classWeighting === "sqrt_inverse") {
        const raw = labels.map(label =>
          Math.sqrt(relationRows.length / (labels.length * Math.max(1,labelCounts[label] || 0))));
        const weightedMass = labels.reduce((sum,label,index) =>
          sum + (labelCounts[label] || 0) * raw[index],0);
        const normalizer = weightedMass > 0 ? relationRows.length/weightedMass : 1;
        labels.forEach((label,index)=>classWeights.set(label,raw[index]*normalizer));
      }
      const classWeightReport = Object.fromEntries(labels.map(label=>[label,classWeights.get(label)]));
      const epochs = Math.max(1,Math.min(60,Math.floor(finite(trainOptions.epochs,18))));
      const learningRate = Math.max(0.0001,Math.min(0.08,finite(trainOptions.learningRate,0.012)));
      const patience = Math.max(2,Math.min(20,Math.floor(finite(trainOptions.patience,5))));
      const l2 = Math.max(0,Math.min(0.01,finite(trainOptions.l2,0.00002)));
      const shuffleRandom = seededRandom(trainOptions.shuffleSeed == null ? seed ^ 0x9e3779b9 : trainOptions.shuffleSeed);
      let bestScore = validation.length ? evaluate(validation).las : -Infinity;
      let bestArcWeights = arcWeights.slice();
      let bestRelationWeights = relationWeights.map(row=>row.slice());
      let bestRelationBias = relationBias.slice();
      let bestEpoch = 0, staleEpochs = 0, epochsRun = 0, earlyStopped = false;

      for (let epoch=0;epoch<epochs;epoch++) {
        const order=rows.slice();
        for(let index=order.length-1;index>0;index--){
          const swap=Math.floor(shuffleRandom()*(index+1));
          const item=order[index];order[index]=order[swap];order[swap]=item;
        }
        for(const group of order){
          const arcScores=group.candidateFeatures.map(features=>dot(arcWeights,features));
          const arcProbabilities=softmax(arcScores);
          const arcGradient=Array(featureDimension).fill(0);
          for(let candidate=0;candidate<group.candidateFeatures.length;candidate++){
            const error=arcProbabilities[candidate]-(candidate===group.targetCandidateIndex?1:0);
            const features=group.candidateFeatures[candidate];
            for(let feature=0;feature<featureDimension;feature++) {
              arcGradient[feature]+=error*Number(features[feature]);
            }
          }
          for(let feature=0;feature<featureDimension;feature++) {
            arcWeights[feature]-=learningRate*(clip(arcGradient[feature])+l2*arcWeights[feature]);
          }

          const targetFeatures=group.candidateFeatures[group.targetCandidateIndex];
          const targetClass=labels.indexOf(group.relation);
          if(targetClass>=0){
            const probabilities=softmax(relationLogits(targetFeatures));
            const sampleWeight=classWeights.get(group.relation) || 1;
            for(let category=0;category<labels.length;category++){
              const error=(probabilities[category]-(category===targetClass?1:0))*sampleWeight;
              for(let feature=0;feature<featureDimension;feature++){
                relationWeights[category][feature]-=learningRate*
                  (clip(error*Number(targetFeatures[feature]))+l2*relationWeights[category][feature]);
              }
              relationBias[category]-=learningRate*clip(error);
            }
          }
          trainingSteps++;
        }
        epochsRun=epoch+1;
        if(validation.length){
          const report=evaluate(validation);
          const improved=report.las>bestScore+1e-8;
          if(improved){
            bestScore=report.las;
            bestArcWeights=arcWeights.slice();
            bestRelationWeights=relationWeights.map(row=>row.slice());
            bestRelationBias=relationBias.slice();
            bestEpoch=epochsRun;
            staleEpochs=0;
          }else{
            staleEpochs++;
            if(staleEpochs>=patience){
              earlyStopped=epochsRun<epochs;
              break;
            }
          }
        }
      }
      if(validation.length){
        arcWeights=bestArcWeights;
        relationWeights=bestRelationWeights;
        relationBias=bestRelationBias;
      }else{
        bestEpoch=epochsRun;
      }
      const trainReport=evaluate(rows);
      const validationReport=validation.length?evaluate(validation):null;
      const majorityLabel=Object.entries(labelCounts)
        .sort((left,right)=>right[1]-left[1]||left[0].localeCompare(right[0]))[0][0];
      lastTraining={
        trainExamples:rows.length,
        validationExamples:validation.length,
        classes:labels.slice(),
        featureDimension,
        epochs:epochsRun,
        requestedEpochs:epochs,
        bestEpoch,
        earlyStopped,
        learningRate,
        l2,
        classWeighting,
        classWeights:classWeightReport,
        minimumClassExamples,
        relationTrainingExamples:relationRows.length,
        unsupportedRelationTrainingExamples:rows.length-relationRows.length,
        selectionMetric:"validation_las",
        bestSelectionScore:Number.isFinite(bestScore)?bestScore:null,
        trainingHeadAccuracy:trainReport.headAccuracy,
        trainingOracleRelationAccuracy:trainReport.oracleRelationAccuracy,
        trainingRelationMacroF1:trainReport.relationMacroF1,
        trainingLAS:trainReport.las,
        validationHeadAccuracy:validationReport?validationReport.headAccuracy:null,
        validationOracleRelationAccuracy:validationReport?validationReport.oracleRelationAccuracy:null,
        validationRelationMacroF1:validationReport?validationReport.relationMacroF1:null,
        validationLAS:validationReport?validationReport.las:null,
        majorityLabel,
        majorityTrainingCount:labelCounts[majorityLabel],
        trainingSteps
      };
      return {...lastTraining};
    }

    function predict(group) {
      if (!labels.length || !group || !Array.isArray(group.candidateFeatures) ||
          group.candidateFeatures.length !== (group.candidateHeadIds || []).length) return null;
      const index=predictedHeadIndex(group);
      const relation=predictRelation(group.candidateFeatures[index]);
      const scores=group.candidateFeatures.map(features=>dot(arcWeights,features));
      const probabilities=softmax(scores);
      return {
        headId:group.candidateHeadIds[index],
        headIndex:group.candidateHeadIndexes[index],
        headConfidence:probabilities[index],
        relation:relation&&relation.label,
        relationConfidence:relation&&relation.confidence
      };
    }
    function status() {
      return {
        schema:SCHEMA,version:1,trained:labels.length>0,labels:labels.slice(),
        featureDimension,trainingSteps,labelCounts:{...labelCounts},
        lastTraining:lastTraining?{...lastTraining}:null
      };
    }
    function exportState() {
      return {
        schema:SCHEMA,version:1,labels:labels.slice(),featureDimension,
        arcWeights:arcWeights.slice(),relationWeights:relationWeights.map(row=>row.slice()),
        relationBias:relationBias.slice(),trainingSteps,labelCounts:{...labelCounts},
        lastTraining:lastTraining?{...lastTraining}:null
      };
    }
    function loadState(state) {
      if(!state||state.schema!==SCHEMA||state.version!==1||
        !Array.isArray(state.labels)||state.labels.length<2||
        !Number.isInteger(state.featureDimension)||state.featureDimension<4||
        !Array.isArray(state.arcWeights)||state.arcWeights.length!==state.featureDimension||
        !state.arcWeights.every(value=>Number.isFinite(Number(value)))||
        !Array.isArray(state.relationWeights)||state.relationWeights.length!==state.labels.length||
        state.relationWeights.some(row=>!Array.isArray(row)||row.length!==state.featureDimension||
          !row.every(value=>Number.isFinite(Number(value))))||
        !Array.isArray(state.relationBias)||state.relationBias.length!==state.labels.length||
        !state.relationBias.every(value=>Number.isFinite(Number(value)))) {
        throw new TypeError("Dependency checkpoint is malformed.");
      }
      labels=state.labels.map(cleanRelation);
      if(labels.some(label=>!label)||new Set(labels).size!==labels.length) {
        throw new TypeError("Dependency checkpoint labels are invalid.");
      }
      featureDimension=state.featureDimension;
      arcWeights=state.arcWeights.map(Number);
      relationWeights=state.relationWeights.map(row=>row.map(Number));
      relationBias=state.relationBias.map(Number);
      trainingSteps=Math.max(0,Math.floor(finite(state.trainingSteps,0)));
      labelCounts=state.labelCounts&&typeof state.labelCounts==="object"?{...state.labelCounts}:{};
      lastTraining=state.lastTraining&&typeof state.lastTraining==="object"?{...state.lastTraining}:null;
      return status();
    }
    return Object.freeze({train,predict,evaluate,status,exportState,loadState});
  }

  const root=typeof window!=="undefined"?window:globalThis;
  root.NGDependencySupervision=Object.freeze({
    schema:SCHEMA,version:1,extractExamples,normaliseLemma,cleanRelation
  });
})();