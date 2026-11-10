(() => {
  "use strict";

  const EDGE_EPSILON = 1e-7;

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(name + " must be finite");
    return number;
  }

  function edgeKey(from, to) {
    return JSON.stringify([String(from), String(to)]);
  }

  function findEdge(snapshot, from, to) {
    return snapshot.synapses.find(edge =>
      edge && String(edge.from) === String(from) && String(edge.to) === String(to)
    ) || null;
  }

  function failure(code, message, report = null) {
    return { ok: false, code, message, report, proposal: null };
  }

  function runContrastiveTrial(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    if (typeof settings.createExperiment !== "function") {
      return failure("experiment-factory-unavailable", "Не удалось создать изолированную WASM-копию.");
    }

    const inputId = String(settings.inputId ?? "").trim();
    const positiveId = String(settings.positiveId ?? "").trim();
    const negativeId = String(settings.negativeId ?? "").trim();
    if (!inputId || !positiveId || !negativeId ||
        inputId === positiveId || inputId === negativeId || positiveId === negativeId) {
      return failure("invalid-neuron-selection", "Выбери три разных нейрона.");
    }

    let positiveRate, negativeRate, stimulus, deltaSeconds, retention, steps;
    try {
      positiveRate = finite(settings.positiveLearningRate ?? 0.02, "positiveLearningRate");
      negativeRate = finite(settings.negativeLearningRate ?? 1, "negativeLearningRate");
      stimulus = finite(settings.stimulus ?? 0.8, "stimulus");
      deltaSeconds = finite(settings.deltaSeconds ?? 0.1, "deltaSeconds");
      retention = finite(settings.eligibilityRetention ?? 0.9, "eligibilityRetention");
      steps = Number(settings.steps ?? 6);
    } catch (error) {
      return failure("invalid-parameters", error.message);
    }

    if (positiveRate < 0 || positiveRate > 1 || negativeRate < 0 || negativeRate > 1 ||
        stimulus <= 0 || stimulus > 1 || deltaSeconds <= 0 || deltaSeconds > 0.25 ||
        retention < 0 || retention > 1 || !Number.isInteger(steps) || steps < 1 || steps > 64) {
      return failure("parameters-out-of-range", "Параметры опыта выходят за безопасные пределы.");
    }

    let experiment = null;
    try {
      experiment = settings.createExperiment({ resetState: true });
      if (!experiment || !experiment.candidate ||
          typeof experiment.baselineSnapshot !== "function" ||
          typeof experiment.compare !== "function" ||
          typeof experiment.exportProposal !== "function") {
        return failure("experiment-unavailable", "WASM не вернул корректную изолированную копию.");
      }

      const baseline = experiment.baselineSnapshot();
      const neurons = new Map((baseline.neurons || []).map(row => [String(row.id), row]));
      const input = neurons.get(inputId);
      const positive = neurons.get(positiveId);
      const negative = neurons.get(negativeId);
      if (!input || !positive || !negative) {
        return failure("neuron-not-found", "Один из выбранных нейронов отсутствует в снимке сети.");
      }
      if (String(input.type || input.kind || "") === "output" ||
          String(positive.type || positive.kind || "") !== "output" ||
          String(negative.type || negative.kind || "") !== "output") {
        return failure("invalid-neuron-types", "Нужен один входной нейрон и два выходных.");
      }

      const positiveBaselineEdge = findEdge(baseline, inputId, positiveId);
      const negativeBaselineEdge = findEdge(baseline, inputId, negativeId);
      if (!positiveBaselineEdge || !negativeBaselineEdge) {
        return failure("direct-routes-required",
          "Для этого метода нужны прямые связи от выбранного входа к обоим выходам.");
      }

      const candidate = experiment.candidate;
      if (typeof candidate.stimulate !== "function" ||
          typeof candidate.step !== "function" ||
          typeof candidate.learnContrastiveRewardAsymmetric !== "function" ||
          typeof candidate.snapshot !== "function") {
        return failure("candidate-api-incomplete", "Изолированная копия не поддерживает нужные операции.");
      }
      if (!candidate.stimulate(inputId, stimulus)) {
        return failure("stimulation-failed", "Не удалось активировать выбранный вход в изолированной копии.");
      }
      for (let step = 0; step < steps; step++) {
        if (candidate.step(deltaSeconds, retention) === false) {
          return failure("simulation-step-failed", "Один из шагов изолированной симуляции завершился ошибкой.");
        }
      }

      const stimulated = candidate.snapshot();
      const positiveTrace = findEdge(stimulated, inputId, positiveId);
      const negativeTrace = findEdge(stimulated, inputId, negativeId);
      if (!positiveTrace || !negativeTrace ||
          !(Number(positiveTrace.eligibility) > EDGE_EPSILON) ||
          !(Number(negativeTrace.eligibility) > EDGE_EPSILON)) {
        return failure("no-eligible-target-traces",
          "На обеих выбранных прямых связях не накопились следы. Коррекция не выполнялась.");
      }

      const activationOf = id => {
        const row = (stimulated.neurons || []).find(neuron => neuron && String(neuron.id) === id);
        return row ? finite(row.activity ?? row.activation ?? 0, "neuron.activation") : 0;
      };
      const beforePositiveWeight = finite(positiveTrace.weight, "positive.weight");
      const beforeNegativeWeight = finite(negativeTrace.weight, "negative.weight");
      const positiveActivation = activationOf(positiveId);
      const negativeActivation = activationOf(negativeId);

      const updates = candidate.learnContrastiveRewardAsymmetric(
        positiveRate, negativeRate, inputId, positiveId, negativeId
      );
      if (!Number.isInteger(updates) || updates < 0) {
        return failure("learning-call-failed", "WASM вернул некорректный результат коррекции.");
      }

      const after = candidate.snapshot();
      const positiveAfter = findEdge(after, inputId, positiveId);
      const negativeAfter = findEdge(after, inputId, negativeId);
      if (!positiveAfter || !negativeAfter) {
        return failure("target-edge-disappeared", "Целевая связь исчезла во время опыта.");
      }

      const changes = experiment.compare();
      const allowed = new Set([edgeKey(inputId, positiveId), edgeKey(inputId, negativeId)]);
      const unexpected = changes.changedWeights.filter(edge => !allowed.has(edgeKey(edge.from, edge.to)));
      if (unexpected.length || changes.addedEdges.length || changes.removedEdges.length) {
        return failure("isolation-contract-violation",
          "Коррекция затронула связи вне выбранной пары. Предложение отклонено.");
      }
      if (changes.changedWeights.length !== updates) {
        return failure("update-count-mismatch",
          "Число обновлений WASM не совпало с фактическим изменением весов.");
      }

      const afterPositiveWeight = finite(positiveAfter.weight, "positive.weight.after");
      const afterNegativeWeight = finite(negativeAfter.weight, "negative.weight.after");
      if (afterPositiveWeight + EDGE_EPSILON < beforePositiveWeight ||
          afterNegativeWeight - EDGE_EPSILON > beforeNegativeWeight) {
        return failure("correction-direction-violation",
          "Направление одного из изменений не совпало с заданной контрастной целью.");
      }

      const report = {
        input: { id: inputId, name: String(input.name || inputId) },
        positive: {
          id: positiveId,
          name: String(positive.name || positiveId),
          activationBeforeLearning: positiveActivation,
          eligibility: finite(positiveTrace.eligibility, "positive.eligibility"),
          weightBefore: beforePositiveWeight,
          weightAfter: afterPositiveWeight
        },
        negative: {
          id: negativeId,
          name: String(negative.name || negativeId),
          activationBeforeLearning: negativeActivation,
          eligibility: finite(negativeTrace.eligibility, "negative.eligibility"),
          weightBefore: beforeNegativeWeight,
          weightAfter: afterNegativeWeight
        },
        steps,
        stimulus,
        positiveLearningRate: positiveRate,
        negativeLearningRate: negativeRate,
        changedSynapses: changes.changedWeights.length,
        updates,
        changes
      };
      const proposal = changes.changedWeights.length ? experiment.exportProposal() : null;
      return {
        ok: !!proposal,
        code: proposal ? "proposal-ready" : "no-weight-changes",
        message: proposal
          ? "Создано предложение изменений. Оно не применено к основной сети."
          : "Следы были обработаны, но веса не изменились: возможно, они уже достигли границы.",
        report,
        proposal
      };
    } catch (error) {
      return failure("trial-error", String(error && error.message || error).slice(0, 240));
    } finally {
      if (experiment && experiment.disposed !== true && typeof experiment.dispose === "function") {
        experiment.dispose();
      }
    }
  }

  root.NGDisposableExperimentSession = Object.freeze({ runContrastiveTrial });
})();
