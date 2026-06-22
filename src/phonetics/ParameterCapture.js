(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  var PARAMETER_INVENTORY = {
    glottis: [
      "voiced", "explicit_voice", "ui_frequency", "ui_tenseness", "intensity",
      "loudness", "vibrato_amount", "vibrato_frequency"
    ],
    articulation: [
      "tongue_index", "tongue_diameter", "lip_diameter", "velum_target",
      "target_diameter[44]", "manual_touch.index", "manual_touch.diameter"
    ],
    diagnostics: [
      "actual_diameter[44]", "rest_diameter[44]", "velum_diameter",
      "manual_touch.turbulence", "release_transients"
    ]
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function now() {
    if (typeof performance !== "undefined" && performance.now) return performance.now();
    return Date.now();
  }

  function number(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : fallback;
  }

  function numeric(values) {
    return (values || []).filter(function(value) {
      return Number.isFinite(Number(value));
    }).map(Number).sort(function(left, right) { return left - right; });
  }

  function average(values, fallback) {
    var nums = numeric(values);
    if (!nums.length) return fallback;
    return nums.reduce(function(sum, value) { return sum + value; }, 0) / nums.length;
  }

  function percentile(values, amount, fallback) {
    var nums = numeric(values);
    if (!nums.length) return fallback;
    var position = clamp(amount, 0, 1) * (nums.length - 1);
    var lower = Math.floor(position);
    var upper = Math.ceil(position);
    if (lower === upper) return nums[lower];
    return nums[lower] + (nums[upper] - nums[lower]) * (position - lower);
  }

  function median(values, fallback) {
    return percentile(values, 0.5, fallback);
  }

  function clone(value) {
    if (value === undefined) return value;
    return ns.deepClone ? ns.deepClone(value) : JSON.parse(JSON.stringify(value));
  }

  function round(value, digits) {
    var scale = Math.pow(10, digits || 0);
    return Math.round(number(value, 0) * scale) / scale;
  }

  function frameTime(frame, fallback) {
    return number(frame && frame.t, fallback || 0);
  }

  function phase(id, type, startMs, endMs, confidence) {
    return {
      id: id,
      type: type,
      label: type.replace(/(^|\s)\S/g, function(letter) { return letter.toUpperCase(); }),
      startMs: Math.max(0, Math.round(startMs)),
      endMs: Math.max(Math.round(startMs) + 1, Math.round(endMs)),
      confidence: round(confidence === undefined ? 1 : confidence, 2),
      included: true
    };
  }

  function maxTouchTurbulence(sample) {
    return Math.max.apply(null, [0].concat(((sample && sample.touches) || []).map(function(touch) {
      return number(touch.fricative_intensity, 0);
    })));
  }

  function minimumDiameter(frame) {
    var diameters = frame && frame.tract && frame.tract.targetDiameter || [];
    var min = Infinity;
    var index = -1;
    for (var i = 2; i < diameters.length; i++) {
      var value = number(diameters[i], Infinity);
      if (value < min) {
        min = value;
        index = i;
      }
    }
    return { index: index, diameter: min === Infinity ? 1.5 : min };
  }

  function frameFeatures(frame) {
    if (frame && frame.derived) return frame.derived;
    var minimum = minimumDiameter(frame || {});
    var touches = (frame && frame.touches) || [];
    var glottis = (frame && frame.glottis) || {};
    var tract = (frame && frame.tract) || {};
    var maxDeviation = 0;
    var target = tract.targetDiameter || [];
    var rest = tract.restDiameter || [];
    for (var i = 0; i < Math.min(target.length, rest.length); i++) {
      maxDeviation = Math.max(maxDeviation, Math.abs(number(target[i], 0) - number(rest[i], 0)));
    }
    var turbulence = maxTouchTurbulence(frame || {});
    var activeTouch = touches.some(function(touch) { return touch.alive !== false; });
    return {
      min_index: minimum.index,
      min_diameter: minimum.diameter,
      closure: minimum.diameter <= 0.12,
      turbulence: turbulence,
      velum_open: number(tract.velum_target, 0.01) > 0.12,
      explicit_voice: Boolean(glottis.explicit_voice || glottis.touch_active),
      source_active: Boolean(glottis.source_active || glottis.voiced || number(glottis.intensity, 0) > 0.08),
      active: activeTouch || Boolean(glottis.touch_active) || maxDeviation > 0.12 ||
        number(tract.velum_target, 0.01) > 0.08 || turbulence > 0.05
    };
  }

  function smoothFlags(flags, radius) {
    radius = radius || 2;
    return flags.map(function(flag, index) {
      var yes = 0;
      var total = 0;
      for (var offset = -radius; offset <= radius; offset++) {
        if (index + offset < 0 || index + offset >= flags.length) continue;
        total += 1;
        if (flags[index + offset]) yes += 1;
      }
      return flag ? yes >= Math.max(1, Math.floor(total / 3)) : yes > total / 2;
    });
  }

  function rangesFor(frames, predicate, minMs) {
    if (!frames || !frames.length) return [];
    var flags = smoothFlags(frames.map(function(frame) { return Boolean(predicate(frameFeatures(frame), frame)); }), 2);
    var ranges = [];
    var start = -1;
    for (var i = 0; i <= frames.length; i++) {
      if (i < frames.length && flags[i] && start === -1) start = i;
      if ((i === frames.length || !flags[i]) && start !== -1) {
        var endIndex = Math.max(start, i - 1);
        var startMs = frameTime(frames[start], 0);
        var endMs = frameTime(frames[endIndex], startMs) + 17;
        if (endMs - startMs >= (minMs || 0)) {
          ranges.push({ startMs: startMs, endMs: endMs, startIndex: start, endIndex: endIndex });
        }
        start = -1;
      }
    }
    return ranges;
  }

  function longestRange(ranges) {
    return (ranges || []).slice().sort(function(left, right) {
      return (right.endMs - right.startMs) - (left.endMs - left.startMs);
    })[0] || null;
  }

  function firstRangeAfter(ranges, time) {
    return (ranges || []).filter(function(range) { return range.endMs > time; }).sort(function(left, right) {
      return left.startMs - right.startMs;
    })[0] || null;
  }

  function framesInRange(frames, range) {
    if (!range) return (frames || []).slice();
    return (frames || []).filter(function(frame) {
      var time = frameTime(frame, 0);
      return time >= range.startMs && time <= range.endMs;
    });
  }

  function rangeForPhases(phases, fallback) {
    var included = (phases || []).filter(function(item) { return item.included !== false && item.type !== "context"; });
    if (!included.length) return fallback;
    return {
      startMs: Math.min.apply(null, included.map(function(item) { return item.startMs; })),
      endMs: Math.max.apply(null, included.map(function(item) { return item.endMs; }))
    };
  }

  function findPhase(phases, names) {
    names = Array.isArray(names) ? names : [names];
    return (phases || []).filter(function(item) {
      return item.included !== false && names.indexOf(item.type) !== -1;
    })[0] || null;
  }

  function phaseEdits(item) {
    return item && item.edits && typeof item.edits === "object" ? item.edits : {};
  }

  function editedNumber(edits, path) {
    return edits[path] === undefined ? null : number(edits[path], null);
  }

  function ParameterCapture(synth) {
    this.synth = synth || {};
    this.samples = [];
    this.session = null;
    this.recording = false;
    this.startedAt = 0;
    this.timer = 0;
  }

  ParameterCapture.prototype.start = function(meta) {
    if (this.recording) this.stop();
    this.samples = [];
    this.recording = true;
    this.startedAt = now();
    this.session = {
      version: 1,
      id: "take-" + Math.round(this.startedAt),
      createdAt: new Date().toISOString(),
      meta: clone(meta || {}),
      frames: this.samples,
      durationMs: 0
    };
    var self = this;
    function step(timestamp) {
      if (!self.recording) return;
      self.samples.push(self.sample(timestamp));
      self.session.durationMs = self.samples.length ? frameTime(self.samples[self.samples.length - 1], 0) + 17 : 0;
      self.timer = requestAnimationFrame(step);
    }
    step(this.startedAt);
    return this.session;
  };

  ParameterCapture.prototype.stop = function() {
    this.recording = false;
    if (this.timer && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.timer);
    this.timer = 0;
    if (this.session) {
      this.session.durationMs = this.samples.length ? frameTime(this.samples[this.samples.length - 1], 0) + 17 : 0;
      this.session.endedAt = new Date().toISOString();
    }
    return this.session;
  };

  ParameterCapture.prototype.snapshot = function(meta) {
    this.recording = false;
    this.startedAt = now();
    this.samples = [this.sample(this.startedAt)];
    this.session = {
      version: 1,
      id: "snapshot-" + Math.round(this.startedAt),
      createdAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      meta: clone(meta || {}),
      frames: this.samples,
      durationMs: 17,
      snapshot: true
    };
    return this.session;
  };

  ParameterCapture.prototype.clear = function() {
    if (this.recording) this.stop();
    this.samples = [];
    this.session = null;
    this.startedAt = 0;
  };

  ParameterCapture.prototype.sample = function(timestamp) {
    var Glottis = this.synth.Glottis || {};
    var Tract = this.synth.Tract || { targetDiameter: [], restDiameter: [], diameter: [], transients: [] };
    var TractUI = this.synth.TractUI || {};
    var UI = this.synth.UI || { touchesWithMouse: [] };
    var target = Array.prototype.slice.call(Tract.targetDiameter || []);
    var rest = Array.prototype.slice.call(Tract.restDiameter || []);
    var actual = Array.prototype.slice.call(Tract.diameter || []);
    var manualTouches = (UI.touchesWithMouse || []).filter(function(touch) {
      return touch && !touch.syntheticPhonemeTouch;
    }).map(function(touch) {
      return {
        alive: touch.alive !== false,
        x: number(touch.x, 0),
        y: number(touch.y, 0),
        index: number(touch.index, 0),
        diameter: number(touch.diameter, 1.5),
        fricative_intensity: number(touch.fricative_intensity, 0),
        start_time: number(touch.startTime, 0),
        end_time: number(touch.endTime, 0)
      };
    });
    var frame = {
      t: Math.max(0, number(timestamp, now()) - (this.startedAt || number(timestamp, now()))),
      glottis: {
        voiced: Boolean(Glottis.isTouched || Glottis.isTouchingSomewhere || number(Glottis.intensity, 0) > 0.08),
        explicit_voice: Boolean(Glottis.isTouched),
        source_active: Boolean(Glottis.isTouched || Glottis.isTouchingSomewhere),
        ui_frequency: number(Glottis.UIFrequency, 140),
        ui_tenseness: number(Glottis.UITenseness, 0.6),
        intensity: number(Glottis.intensity, 0),
        loudness: number(Glottis.loudness, 1),
        vibrato_amount: number(Glottis.vibratoAmount, 0.005),
        vibrato_frequency: number(Glottis.vibratoFrequency, 6)
      },
      tract: {
        tongue_index: number(TractUI.tongueIndex, 12.9),
        tongue_diameter: number(TractUI.tongueDiameter, 2.43),
        lip_diameter: target.length ? number(target[target.length - 2], 1.5) : 1.5,
        velum_target: number(Tract.velumTarget, 0.01),
        velum_diameter: Tract.noseDiameter && Tract.noseDiameter.length ? number(Tract.noseDiameter[0], 0.01) : number(Tract.velumTarget, 0.01),
        targetDiameter: target,
        restDiameter: rest,
        diameter: actual
      },
      touches: manualTouches,
      transients: (Tract.transients || []).map(function(transient) {
        return {
          position: number(transient.position, 0),
          strength: number(transient.strength, 0.3),
          time_alive: number(transient.timeAlive, 0),
          life_time: number(transient.lifeTime, 0.2)
        };
      })
    };
    frame.derived = frameFeatures(frame);
    return frame;
  };

  ParameterCapture.prototype.lastSamples = function(ms) {
    var samples = this.samples.length ? this.samples : [this.sample(now())];
    var last = frameTime(samples[samples.length - 1], 0);
    return samples.filter(function(sample) { return frameTime(sample, 0) >= last - ms; });
  };

  ParameterCapture.prototype.detectConstrictions = function(samples, options) {
    options = options || {};
    var source = samples && samples.length ? samples : [this.sample(now())];
    var first = source[0] && source[0].tract || {};
    var n = (first.targetDiameter || []).length;
    if (!n) return [];
    var targetProfile = [];
    var restProfile = [];
    for (var i = 0; i < n; i++) {
      targetProfile[i] = median(source.map(function(sample) { return sample.tract.targetDiameter[i]; }), 1.5);
      restProfile[i] = median(source.map(function(sample) { return sample.tract.restDiameter[i]; }), 1.5);
    }
    var groups = [];
    var current = null;
    var threshold = options.threshold === undefined ? 0.18 : options.threshold;
    for (var index = 2; index < n; index++) {
      var shrink = restProfile[index] - targetProfile[index];
      var active = shrink > threshold || targetProfile[index] < (options.closedOnly ? 0.3 : 1.2);
      if (active) {
        if (!current) current = { start: index, end: index, minIndex: index, minDiameter: targetProfile[index] };
        current.end = index;
        if (targetProfile[index] < current.minDiameter) {
          current.minDiameter = targetProfile[index];
          current.minIndex = index;
        }
      } else if (current) {
        groups.push(current);
        current = null;
      }
    }
    if (current) groups.push(current);
    var touchTurbulence = percentile(source.map(maxTouchTurbulence), 0.75, 0);
    return groups.sort(function(left, right) {
      return left.minDiameter - right.minDiameter;
    }).slice(0, options.limit || 2).map(function(group) {
      return ns.normalizeConstriction({
        index: group.minIndex,
        diameter: clamp(group.minDiameter, 0, 2.5),
        width: Math.max(2, (group.end - group.start + 1) / 2),
        turbulence_intensity: options.turbulence ? touchTurbulence : 0,
        label: options.label || "captured"
      });
    });
  };

  ParameterCapture.prototype.analyze = function(baseParams, templateType, options) {
    options = options || {};
    var frames = options.frames || (this.session && this.session.frames) || this.samples || [];
    var type = templateType || (ns.classifyPhoneme ? ns.classifyPhoneme(baseParams) : "other");
    var duration = frames.length ? Math.max(1, frameTime(frames[frames.length - 1], 0) + 17) : 1;
    var active = rangesFor(frames, function(features) { return features.active; }, 35);
    var closure = rangesFor(frames, function(features) { return features.closure && !features.velum_open; }, 18);
    var nasal = rangesFor(frames, function(features) { return features.closure && features.velum_open; }, 30);
    var velumOpen = rangesFor(frames, function(features) { return features.velum_open; }, 30);
    var frication = rangesFor(frames, function(features) {
      return features.turbulence > 0.12 && features.min_diameter > 0.03 && features.min_diameter < 1.05;
    }, 35);
    var voiced = rangesFor(frames, function(features) { return features.source_active; }, 35);
    var partial = rangesFor(frames, function(features) {
      return features.active && !features.closure && features.turbulence < 0.16 && features.min_diameter < 1.45;
    }, 35);
    var phases = [];
    var primary = null;
    var fallback = longestRange(active) || { startMs: 0, endMs: duration };

    if (type === "vowel") {
      primary = longestRange(voiced) || fallback;
      phases.push(phase("sustain", "sustain", primary.startMs, primary.endMs, voiced.length ? 0.85 : 0.45));
    } else if (type === "nasal") {
      primary = longestRange(nasal) || longestRange(closure) || fallback;
      phases.push(phase("nasal-closure", "nasal closure", primary.startMs, primary.endMs, nasal.length ? 0.95 : 0.6));
      if (!nasal.length && velumOpen.length) {
        var velumStage = longestRange(velumOpen);
        phases.push(phase("velum", "velum", velumStage.startMs, velumStage.endMs, 0.85));
      }
    } else if (type === "stop") {
      primary = longestRange(closure) || fallback;
      phases.push(phase("closure", "closure", primary.startMs, primary.endMs, closure.length ? 0.95 : 0.4));
      var releaseEnd = Math.min(duration, Math.max(primary.endMs + 25, primary.endMs + Math.min(80, duration - primary.endMs)));
      if (releaseEnd > primary.endMs + 1) phases.push(phase("release", "release", primary.endMs, releaseEnd, 0.75));
    } else if (type === "fricative") {
      primary = longestRange(frication) || fallback;
      phases.push(phase("frication", "frication", primary.startMs, primary.endMs, frication.length ? 0.95 : 0.4));
    } else if (type === "affricate") {
      var closeStage = closure.slice().sort(function(left, right) { return left.startMs - right.startMs; })[0] || null;
      var fricStage = firstRangeAfter(frication, closeStage ? closeStage.endMs - 20 : 0) || longestRange(frication);
      if (closeStage) phases.push(phase("closure", "closure", closeStage.startMs, closeStage.endMs, 0.95));
      if (fricStage) phases.push(phase("frication", "frication", Math.max(closeStage ? closeStage.endMs : 0, fricStage.startMs), fricStage.endMs, 0.95));
      if (!phases.length) phases.push(phase("target", "target", fallback.startMs, fallback.endMs, 0.35));
      primary = rangeForPhases(phases, fallback);
    } else if (type === "approximant") {
      primary = longestRange(partial) || fallback;
      phases.push(phase("target", "target", primary.startMs, primary.endMs, partial.length ? 0.85 : 0.4));
    } else if (type === "tap") {
      var contacts = closure.length ? closure : [fallback];
      primary = { startMs: contacts[0].startMs, endMs: contacts[contacts.length - 1].endMs };
      phases.push(phase("contact", "contact", primary.startMs, primary.endMs, closure.length ? 0.9 : 0.4));
      var tapReleaseEnd = Math.min(duration, primary.endMs + 35);
      if (tapReleaseEnd > primary.endMs + 1) phases.push(phase("release", "release", primary.endMs, tapReleaseEnd, 0.7));
    } else {
      primary = fallback;
      phases.push(phase("target", "target", primary.startMs, primary.endMs, active.length ? 0.75 : 0.3));
    }

    var selection = rangeForPhases(phases, fallback);
    return {
      type: type,
      durationMs: duration,
      phases: phases,
      selection: selection,
      diagnostics: {
        activeRanges: active,
        closureRanges: closure,
        nasalRanges: nasal,
        velumRanges: velumOpen,
        fricationRanges: frication,
        voicedRanges: voiced
      }
    };
  };

  ParameterCapture.prototype.summarizeFrames = function(frames, fallbackParams) {
    frames = frames && frames.length ? frames : [];
    var fallbackGlottis = fallbackParams && fallbackParams.glottis || {};
    var fallbackTract = fallbackParams && fallbackParams.tract || {};
    var explicitRatio = frames.length ? average(frames.map(function(frame) {
      return frame.glottis && frame.glottis.explicit_voice ? 1 : 0;
    }), 0) : 0;
    return {
      glottis: {
        explicit_voice_ratio: explicitRatio,
        ui_frequency: round(median(frames.map(function(frame) { return frame.glottis.ui_frequency; }), fallbackGlottis.ui_frequency || 140), 0),
        ui_tenseness: round(median(frames.map(function(frame) { return frame.glottis.ui_tenseness; }), fallbackGlottis.ui_tenseness || 0.6), 3),
        intensity: round(median(frames.map(function(frame) { return frame.glottis.intensity; }), fallbackGlottis.intensity || 0), 3),
        loudness: round(median(frames.map(function(frame) { return frame.glottis.loudness; }), fallbackGlottis.loudness || 0.9), 3)
      },
      tract: {
        tongue_index: round(median(frames.map(function(frame) { return frame.tract.tongue_index; }), fallbackTract.tongue_index === null ? 12.9 : fallbackTract.tongue_index), 2),
        tongue_diameter: round(median(frames.map(function(frame) { return frame.tract.tongue_diameter; }), fallbackTract.tongue_diameter === null ? 2.43 : fallbackTract.tongue_diameter), 2),
        lip_diameter: round(median(frames.map(function(frame) { return frame.tract.lip_diameter; }), fallbackTract.lip_diameter === null ? 1.5 : fallbackTract.lip_diameter), 2),
        velum_target: round(median(frames.map(function(frame) { return frame.tract.velum_target; }), fallbackTract.velum_target || 0.01), 3)
      },
      turbulence: round(percentile(frames.map(maxTouchTurbulence), 0.75, 0), 3)
    };
  };

  ParameterCapture.prototype.summarize = function(baseParams, templateType, options) {
    options = options || {};
    var params = clone(baseParams);
    var frames = options.frames || (this.session && this.session.frames) || this.samples || [];
    if (!frames.length) frames = [this.sample(now())];
    var type = templateType || (ns.classifyPhoneme ? ns.classifyPhoneme(baseParams) : "other");
    var analysis = options.analysis || this.analyze(baseParams, type, { frames: frames });
    var phases = options.phases || analysis.phases || [];
    var selection = options.range || rangeForPhases(phases, analysis.selection);
    var selectedFrames = framesInRange(frames, selection);
    if (!selectedFrames.length) selectedFrames = frames.slice();
    var selectedStats = this.summarizeFrames(selectedFrames, params);
    var closurePhase = findPhase(phases, ["closure", "nasal closure", "contact"]);
    var fricationPhase = findPhase(phases, "frication");
    var velumPhase = findPhase(phases, "velum") || findPhase(phases, "nasal closure");
    var closureFrames = framesInRange(frames, closurePhase || selection);
    var fricationFrames = framesInRange(frames, fricationPhase || selection);
    var closureStats = this.summarizeFrames(closureFrames, params);
    var fricationStats = this.summarizeFrames(fricationFrames, params);
    var velumStats = this.summarizeFrames(framesInRange(frames, velumPhase || selection), params);
    var duration = clamp(Math.round(selection.endMs - selection.startMs), type === "tap" ? 20 : 40, 600);

    function applySource(stats, preserveVoicing) {
      params.glottis.ui_frequency = stats.glottis.ui_frequency;
      params.glottis.ui_tenseness = stats.glottis.ui_tenseness;
      if (stats.glottis.intensity > 0.03) params.glottis.intensity = stats.glottis.intensity;
      if (stats.glottis.loudness > 0.03) params.glottis.loudness = stats.glottis.loudness;
      if (!preserveVoicing && stats.glottis.explicit_voice_ratio > 0.2) params.glottis.voiced = true;
    }

    function capturedConstrictions(capture, source, config, fallback) {
      var found = capture.detectConstrictions(source, config);
      return found.length ? found : clone(fallback || []);
    }

    params.duration_ms = duration;
    params.timing.duration_ms = duration;

    if (type === "vowel") {
      applySource(selectedStats, false);
      params.glottis.voiced = true;
      params.tract.tongue_index = selectedStats.tract.tongue_index;
      params.tract.tongue_diameter = selectedStats.tract.tongue_diameter;
      params.tract.lip_diameter = selectedStats.tract.lip_diameter;
      params.tract.velum_target = selectedStats.tract.velum_target;
      params.tract.constrictions = params.tract.lip_diameter < 1.1 ? [ns.normalizeConstriction({
        index: 41, diameter: params.tract.lip_diameter, width: 4, label: "captured lip rounding"
      })] : [];
      params.noise.turbulence = false;
      params.noise.turbulence_intensity = 0;
    } else if (type === "nasal") {
      applySource(closureStats, true);
      params.tract.velum_target = clamp(Math.max(0.15, velumStats.tract.velum_target), 0.15, 0.5);
      params.tract.constrictions = capturedConstrictions(this, closureFrames, {
        closedOnly: true, limit: 1, label: "captured nasal closure"
      }, baseParams.tract.constrictions);
      params.noise.turbulence = false;
      params.noise.turbulence_intensity = 0;
      params.timing.closure_ms = duration;
    } else if (type === "stop") {
      applySource(closureStats, true);
      params.tract.velum_target = Math.min(0.06, closureStats.tract.velum_target);
      params.tract.constrictions = capturedConstrictions(this, closureFrames, {
        closedOnly: true, limit: 1, label: "captured stop closure"
      }, baseParams.tract.constrictions);
      var closureMs = clamp(Math.round((closurePhase ? closurePhase.endMs - closurePhase.startMs : duration * 0.7)), 20, duration);
      params.timing.closure_ms = closureMs;
      params.release.transient = true;
      params.release.strength = Math.max(params.release.strength || 0.3, 0.3);
      params.events = [
        { type: "closure", duration_ms: closureMs },
        { type: "release_transient", amplitude: params.release.strength }
      ];
      params.gesture = {
        version: 1,
        duration_ms: duration,
        phases: [
          { id: "closure", type: "closure", start_ms: 0, end_ms: closureMs, target: {
            tract: { constrictions: clone(params.tract.constrictions), velum_target: params.tract.velum_target },
            noise: { turbulence: false, turbulence_intensity: 0 },
            release: { transient: false, strength: params.release.strength }
          } },
          { id: "release", type: "release", start_ms: closureMs, end_ms: duration, target: {
            tract: { constrictions: [] },
            noise: { turbulence: false, turbulence_intensity: 0 },
            release: { transient: true, strength: params.release.strength }
          } }
        ]
      };
    } else if (type === "fricative") {
      applySource(fricationStats, true);
      params.tract.velum_target = Math.min(0.08, fricationStats.tract.velum_target);
      params.tract.constrictions = capturedConstrictions(this, fricationFrames, {
        turbulence: true, limit: 1, label: "captured fricative constriction"
      }, baseParams.tract.constrictions);
      params.noise.turbulence = true;
      params.noise.turbulence_intensity = clamp(Math.max(0.1, fricationStats.turbulence), 0, 1);
      if (params.tract.constrictions[0]) params.tract.constrictions[0].turbulence_intensity = params.noise.turbulence_intensity;
    } else if (type === "affricate") {
      applySource(closureStats, true);
      var closeConstrictions = capturedConstrictions(this, closureFrames, {
        closedOnly: true, limit: 1, label: "captured affricate closure"
      }, (baseParams.tract.constrictions || []).slice(0, 1));
      var fricConstrictions = capturedConstrictions(this, fricationFrames, {
        turbulence: true, limit: 1, label: "captured affricate frication"
      }, (baseParams.tract.constrictions || []).slice(1, 2));
      var affricateNoise = clamp(Math.max(0.1, fricationStats.turbulence), 0, 1);
      if (fricConstrictions[0]) fricConstrictions[0].turbulence_intensity = affricateNoise;
      params.tract.constrictions = closeConstrictions.concat(fricConstrictions);
      params.noise.turbulence = true;
      params.noise.turbulence_intensity = affricateNoise;
      params.release.transient = true;
      var closeDuration = clamp(Math.round(closurePhase ? closurePhase.endMs - closurePhase.startMs : duration * 0.48), 20, duration - 1);
      var fricDuration = Math.max(1, duration - closeDuration);
      params.timing.closure_ms = closeDuration;
      params.timing.frication_ms = fricDuration;
      params.events = [
        { type: "closure", duration_ms: closeDuration },
        { type: "fricated_release", duration_ms: fricDuration }
      ];
      params.gesture = {
        version: 1,
        duration_ms: duration,
        phases: [
          { id: "closure", type: "closure", start_ms: 0, end_ms: closeDuration, target: {
            tract: { constrictions: clone(closeConstrictions) },
            noise: { turbulence: false, turbulence_intensity: 0 },
            release: { transient: false, strength: params.release.strength || 0.3 }
          } },
          { id: "frication", type: "frication", start_ms: closeDuration, end_ms: duration, target: {
            tract: { constrictions: clone(fricConstrictions) },
            noise: { turbulence: true, turbulence_intensity: affricateNoise },
            release: { transient: true, strength: params.release.strength || 0.3 }
          } }
        ]
      };
    } else if (type === "approximant") {
      applySource(selectedStats, true);
      params.tract.tongue_index = selectedStats.tract.tongue_index;
      params.tract.tongue_diameter = selectedStats.tract.tongue_diameter;
      params.tract.lip_diameter = selectedStats.tract.lip_diameter;
      params.tract.velum_target = selectedStats.tract.velum_target;
      params.tract.constrictions = capturedConstrictions(this, selectedFrames, {
        threshold: 0.28, limit: 1, label: "captured partial constriction"
      }, params.tract.constrictions);
      params.noise.turbulence = false;
      params.noise.turbulence_intensity = 0;
    } else if (type === "tap") {
      applySource(closureStats, true);
      params.tract.constrictions = capturedConstrictions(this, closureFrames, {
        closedOnly: true, limit: 1, label: "captured brief contact"
      }, baseParams.tract.constrictions);
      var contactMs = clamp(Math.round(closurePhase ? closurePhase.endMs - closurePhase.startMs : duration * 0.55), 10, duration);
      params.timing.closure_ms = contactMs;
      params.release.transient = true;
      params.events = [
        { type: "brief_closure", duration_ms: contactMs },
        { type: "release_transient", amplitude: params.release.strength || 0.2 }
      ];
      params.gesture = {
        version: 1,
        duration_ms: duration,
        phases: [
          { id: "contact", type: "contact", start_ms: 0, end_ms: contactMs, target: {
            tract: { constrictions: clone(params.tract.constrictions) },
            release: { transient: false, strength: params.release.strength || 0.2 }
          } },
          { id: "release", type: "release", start_ms: contactMs, end_ms: duration, target: {
            tract: { constrictions: [] },
            release: { transient: true, strength: params.release.strength || 0.2 }
          } }
        ]
      };
    } else {
      applySource(selectedStats, true);
      params.tract.tongue_index = selectedStats.tract.tongue_index;
      params.tract.tongue_diameter = selectedStats.tract.tongue_diameter;
      params.tract.lip_diameter = selectedStats.tract.lip_diameter;
      params.tract.velum_target = selectedStats.tract.velum_target;
      params.tract.constrictions = capturedConstrictions(this, selectedFrames, {
        threshold: 0.28, limit: 2, label: "captured constriction"
      }, params.tract.constrictions);
    }

    (phases || []).filter(function(item) { return item.included !== false; }).forEach(function(item) {
      var edits = phaseEdits(item);
      ["ui_frequency", "ui_tenseness", "intensity", "loudness"].forEach(function(field) {
        var value = editedNumber(edits, "glottis." + field);
        if (value !== null) params.glottis[field] = value;
      });
      ["tongue_index", "tongue_diameter", "lip_diameter", "velum_target"].forEach(function(field) {
        var value = editedNumber(edits, "tract." + field);
        if (value !== null) params.tract[field] = value;
      });
      var turbulenceEdit = editedNumber(edits, "noise.turbulence_intensity");
      if (turbulenceEdit !== null) {
        params.noise.turbulence_intensity = clamp(turbulenceEdit, 0, 1);
        params.noise.turbulence = params.noise.turbulence_intensity > 0;
      }
      var constrictionIndex = type === "affricate" && item.type === "frication" ? 1 : 0;
      var constriction = params.tract.constrictions && params.tract.constrictions[constrictionIndex];
      if (constriction) {
        var indexEdit = editedNumber(edits, "tract.constriction.index");
        var diameterEdit = editedNumber(edits, "tract.constriction.diameter");
        var widthEdit = editedNumber(edits, "tract.constriction.width");
        if (indexEdit !== null) constriction.index = clamp(indexEdit, 2, 43);
        if (diameterEdit !== null) constriction.diameter = clamp(diameterEdit, 0, 2.5);
        if (widthEdit !== null) constriction.width = clamp(widthEdit, 1, 12);
        if (item.type === "frication" && turbulenceEdit !== null) constriction.turbulence_intensity = params.noise.turbulence_intensity;
      }
    });

    if (params.gesture && Array.isArray(params.gesture.phases)) {
      params.gesture.phases.forEach(function(gesturePhase) {
        var sourcePhase = findPhase(phases, gesturePhase.type);
        if (!sourcePhase || !gesturePhase.target) return;
        var edits = phaseEdits(sourcePhase);
        gesturePhase.target.glottis = gesturePhase.target.glottis || {};
        ["ui_frequency", "ui_tenseness", "intensity", "loudness"].forEach(function(field) {
          var value = editedNumber(edits, "glottis." + field);
          if (value !== null) gesturePhase.target.glottis[field] = value;
        });
        if (gesturePhase.type === "closure" || gesturePhase.type === "contact") {
          gesturePhase.target.tract = gesturePhase.target.tract || {};
          gesturePhase.target.tract.constrictions = clone((params.tract.constrictions || []).slice(0, 1));
        }
        if (gesturePhase.type === "frication") {
          gesturePhase.target.tract = gesturePhase.target.tract || {};
          gesturePhase.target.tract.constrictions = clone((params.tract.constrictions || []).slice(type === "affricate" ? 1 : 0, type === "affricate" ? 2 : 1));
          gesturePhase.target.noise = clone(params.noise);
        }
        var velumEdit = editedNumber(edits, "tract.velum_target");
        if (velumEdit !== null) {
          gesturePhase.target.tract = gesturePhase.target.tract || {};
          gesturePhase.target.tract.velum_target = params.tract.velum_target;
        }
      });
    }

    params.metadata.notes = params.metadata.notes || [];
    if (params.metadata.notes.indexOf("Captured from a Pink Trombone UI take.") === -1) {
      params.metadata.notes.push("Captured from a Pink Trombone UI take.");
    }
    return params;
  };

  return {
    ParameterCapture: ParameterCapture,
    CAPTURE_PARAMETER_INVENTORY: PARAMETER_INVENTORY,
    captureFrameFeatures: frameFeatures,
    captureFramesInRange: framesInRange
  };
});
