(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const DEFAULT_EPSILON = 1e-6;

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(name + " must be finite");
    return number;
  }

  function readSnapshot(getSnapshot) {
    const source = getSnapshot();
    if (!source || typeof source !== "object") {
      throw new TypeError("Experience snapshot must be an object");
    }
    const neurons = Array.isArray(source.neurons) ? source.neurons : [];
    const synapses = Array.isArray(source.synapses) ? source.synapses : [];
    return {
      neurons: neurons.filter(Boolean).map(row => ({
        id: String(row.id ?? ""),
        activation: finite(row.activation ?? row.activity ?? 0, "neuron.activation")
      })),
      synapses: synapses.filter(Boolean).map(row => ({
        from: String(row.from ?? ""),
        to: String(row.to ?? ""),
        weight: finite(row.weight ?? 0, "synapse.weight"),
        signal: finite(row.signal ?? 0, "synapse.signal"),
        eligibility: finite(row.eligibility ?? 0, "synapse.eligibility")
      }))
    };
  }

  function measure(snapshot, epsilon) {
    const activeNeurons = snapshot.neurons.filter(row => row.activation > epsilon).length;
    const eligible = snapshot.synapses.filter(row => row.eligibility > epsilon);
    const traceMass = snapshot.synapses.reduce((sum, row) => sum + Math.max(0, row.eligibility), 0);
    const signalMass = snapshot.synapses.reduce((sum, row) => sum + Math.max(0, row.signal), 0);
    return {
      neurons: snapshot.neurons.length,
      activeNeurons,
      synapses: snapshot.synapses.length,
      eligibleSynapses: eligible.length,
      traceMass,
      meanTrace: snapshot.synapses.length ? traceMass / snapshot.synapses.length : 0,
      maxTrace: snapshot.synapses.reduce((max, row) => Math.max(max, row.eligibility), 0),
      signalMass
    };
  }

  function weightMap(snapshot) {
    return new Map(snapshot.synapses.map(edge => [edge.from + "\u0000" + edge.to, edge.weight]));
  }

  function create(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    if (typeof settings.getSnapshot !== "function") {
      throw new TypeError("getSnapshot must be a function");
    }
    if (typeof settings.resetEligibility !== "function") {
      throw new TypeError("resetEligibility must be a function");
    }
    if (typeof settings.applyReward !== "function") {
      throw new TypeError("applyReward must be a function");
    }

    const epsilon = Math.max(0, finite(settings.epsilon ?? DEFAULT_EPSILON, "epsilon"));
    const historyLimit = Math.max(1, Math.min(100, Math.floor(finite(settings.historyLimit ?? 20, "historyLimit"))));
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const history = [];
    let nextId = 1;
    let current = null;
    let latestReport = null;

    function pushHistory(report) {
      history.push(report);
      while (history.length > historyLimit) history.shift();
      latestReport = report;
    }

    function publicEpisode(episode) {
      if (!episode) return null;
      return {
        id: episode.id,
        label: episode.label,
        status: episode.status,
        startedAt: episode.startedAt,
        finishedAt: episode.finishedAt ?? null,
        steps: episode.steps,
        stepsWithEligibleTraces: episode.stepsWithEligibleTraces,
        peakEligibleSynapses: episode.peakEligibleSynapses,
        peakTraceMass: episode.peakTraceMass,
        latestMetrics: episode.latestMetrics ? { ...episode.latestMetrics } : null
      };
    }

    function status() {
      return {
        state: current ? current.status : latestReport ? latestReport.status : "idle",
        current: publicEpisode(current),
        latestReport: latestReport ? { ...latestReport } : null,
        historyCount: history.length
      };
    }

    function beginEpisode(label = "") {
      if (current && current.status === "open") {
        return { ok: false, code: "episode-already-open", status: status() };
      }
      try {
        if (settings.resetEligibility() !== true) {
          return { ok: false, code: "trace-reset-failed", status: status() };
        }
        const initial = readSnapshot(settings.getSnapshot);
        const metrics = measure(initial, epsilon);
        current = {
          id: "episode-" + String(nextId++).padStart(4, "0"),
          label: String(label || "").replace(/\s+/g, " ").trim().slice(0, 64),
          status: "open",
          startedAt: finite(now(), "timestamp"),
          steps: 0,
          stepsWithEligibleTraces: 0,
          peakEligibleSynapses: 0,
          peakTraceMass: 0,
          latestMetrics: metrics
        };
        return { ok: true, code: "episode-started", episode: publicEpisode(current) };
      } catch (error) {
        return { ok: false, code: "snapshot-error", error: error.message, status: status() };
      }
    }

    function observeStep() {
      if (!current || current.status !== "open") {
        return { ok: false, code: "no-open-episode" };
      }
      try {
        const snapshot = readSnapshot(settings.getSnapshot);
        const metrics = measure(snapshot, epsilon);
        current.steps++;
        current.latestMetrics = metrics;
        if (metrics.eligibleSynapses > 0) current.stepsWithEligibleTraces++;
        current.peakEligibleSynapses = Math.max(current.peakEligibleSynapses, metrics.eligibleSynapses);
        current.peakTraceMass = Math.max(current.peakTraceMass, metrics.traceMass);
        return { ok: true, episode: publicEpisode(current) };
      } catch (error) {
        return { ok: false, code: "snapshot-error", error: error.message };
      }
    }

    function closeWithoutReward(code, message) {
      const episode = current;
      let resetSucceeded = false;
      let remainingMetrics = null;
      try {
        resetSucceeded = settings.resetEligibility() === true;
        remainingMetrics = measure(readSnapshot(settings.getSnapshot), epsilon);
      } catch (_) {}
      const report = {
        id: episode.id,
        label: episode.label,
        status: code,
        message,
        startedAt: episode.startedAt,
        finishedAt: finite(now(), "timestamp"),
        steps: episode.steps,
        stepsWithEligibleTraces: episode.stepsWithEligibleTraces,
        peakEligibleSynapses: episode.peakEligibleSynapses,
        peakTraceMass: episode.peakTraceMass,
        eligibleSynapsesBeforeReward: 0,
        traceMassBeforeReward: 0,
        changedSynapses: 0,
        changedEligibleSynapses: 0,
        changedNonEligibleSynapses: 0,
        meanAbsoluteWeightDelta: 0,
        maxAbsoluteWeightDelta: 0,
        totalAbsoluteWeightDelta: 0,
        applicationReportedUpdates: 0,
        remainingEligibleSynapses: remainingMetrics ? remainingMetrics.eligibleSynapses : null,
        remainingTraceMass: remainingMetrics ? remainingMetrics.traceMass : null,
        traceConsumed: resetSucceeded && !!remainingMetrics &&
          remainingMetrics.eligibleSynapses === 0 && remainingMetrics.traceMass <= epsilon
      };
      current = null;
      pushHistory(report);
      return { ok: false, code, report: { ...report } };
    }

    function evaluate(reward, learningRate = 0.05, weightDecay = 0) {
      if (!current || current.status !== "open") {
        return { ok: false, code: "no-open-episode", status: status() };
      }
      let reinforcement, rate, decay;
      try {
        reinforcement = finite(reward, "reward");
        rate = finite(learningRate, "learningRate");
        decay = finite(weightDecay, "weightDecay");
      } catch (error) {
        return { ok: false, code: "invalid-parameters", error: error.message };
      }
      if (reinforcement < -1 || reinforcement > 1 || rate < 0 || rate > 1 || decay < 0 || decay > 1) {
        return { ok: false, code: "parameters-out-of-range" };
      }
      if (current.steps === 0) {
        return closeWithoutReward("empty-episode", "No simulation steps were observed; reward was not applied.");
      }

      try {
        const before = readSnapshot(settings.getSnapshot);
        const beforeMetrics = measure(before, epsilon);
        if (beforeMetrics.eligibleSynapses === 0 || beforeMetrics.traceMass <= epsilon) {
          return closeWithoutReward("no-eligible-traces", "No eligible synapses remained; reward and weight decay were not applied.");
        }

        const reported = finite(settings.applyReward(reinforcement, rate, decay), "applicationReportedUpdates");
        if (reported < 0) throw new RangeError("applicationReportedUpdates cannot be negative");
        const after = readSnapshot(settings.getSnapshot);
        const afterMetrics = measure(after, epsilon);
        const beforeWeights = weightMap(before);
        const afterWeights = weightMap(after);
        let changedSynapses = 0;
        let changedEligibleSynapses = 0;
        let changedNonEligibleSynapses = 0;
        let totalAbsoluteWeightDelta = 0;
        let maxAbsoluteWeightDelta = 0;
        let comparedSynapses = 0;

        for (const edge of before.synapses) {
          const key = edge.from + "\u0000" + edge.to;
          if (!afterWeights.has(key)) continue;
          const delta = Math.abs(afterWeights.get(key) - beforeWeights.get(key));
          comparedSynapses++;
          totalAbsoluteWeightDelta += delta;
          maxAbsoluteWeightDelta = Math.max(maxAbsoluteWeightDelta, delta);
          if (delta > epsilon) {
            changedSynapses++;
            if (edge.eligibility > epsilon) changedEligibleSynapses++;
            else changedNonEligibleSynapses++;
          }
        }

        const report = {
          id: current.id,
          label: current.label,
          status: "evaluated",
          reward: reinforcement,
          learningRate: rate,
          weightDecay: decay,
          startedAt: current.startedAt,
          finishedAt: finite(now(), "timestamp"),
          steps: current.steps,
          stepsWithEligibleTraces: current.stepsWithEligibleTraces,
          peakEligibleSynapses: current.peakEligibleSynapses,
          peakTraceMass: current.peakTraceMass,
          eligibleSynapsesBeforeReward: beforeMetrics.eligibleSynapses,
          traceMassBeforeReward: beforeMetrics.traceMass,
          meanTraceBeforeReward: beforeMetrics.meanTrace,
          changedSynapses,
          changedEligibleSynapses,
          changedNonEligibleSynapses,
          meanAbsoluteWeightDelta: comparedSynapses ? totalAbsoluteWeightDelta / comparedSynapses : 0,
          maxAbsoluteWeightDelta,
          totalAbsoluteWeightDelta,
          applicationReportedUpdates: reported,
          remainingEligibleSynapses: afterMetrics.eligibleSynapses,
          remainingTraceMass: afterMetrics.traceMass,
          traceConsumed: afterMetrics.eligibleSynapses === 0 && afterMetrics.traceMass <= epsilon
        };
        current = null;
        pushHistory(report);
        return { ok: true, code: "episode-evaluated", report: { ...report } };
      } catch (error) {
        return { ok: false, code: "evaluation-error", error: error.message, status: status() };
      }
    }

    function cancel(reason = "cancelled-by-user") {
      if (!current || current.status !== "open") {
        return { ok: false, code: "no-open-episode", status: status() };
      }
      const safeReason = String(reason || "cancelled").slice(0, 80);
      const episode = current;
      try {
        if (settings.resetEligibility() !== true) {
          return { ok: false, code: "trace-reset-failed", status: status() };
        }
      } catch (error) {
        return { ok: false, code: "trace-reset-failed", error: error.message, status: status() };
      }
      const report = {
        id: episode.id,
        label: episode.label,
        status: "cancelled",
        reason: safeReason,
        startedAt: episode.startedAt,
        finishedAt: finite(now(), "timestamp"),
        steps: episode.steps,
        stepsWithEligibleTraces: episode.stepsWithEligibleTraces,
        peakEligibleSynapses: episode.peakEligibleSynapses,
        peakTraceMass: episode.peakTraceMass,
        eligibleSynapsesBeforeReward: 0,
        traceMassBeforeReward: 0,
        changedSynapses: 0,
        changedEligibleSynapses: 0,
        changedNonEligibleSynapses: 0,
        meanAbsoluteWeightDelta: 0,
        maxAbsoluteWeightDelta: 0,
        totalAbsoluteWeightDelta: 0,
        applicationReportedUpdates: 0,
        traceConsumed: true
      };
      current = null;
      pushHistory(report);
      return { ok: true, code: "episode-cancelled", report: { ...report } };
    }

    function getHistory() {
      return history.map(report => ({ ...report }));
    }

    return Object.freeze({
      beginEpisode,
      observeStep,
      evaluate,
      cancel,
      status,
      history: getHistory
    });
  }

  root.NGExperienceQuality = Object.freeze({ create, measure });
})();