(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function average(values, fallback) {
    var nums = values.filter(function(value) { return Number.isFinite(Number(value)); }).map(Number);
    if (!nums.length) return fallback;
    return nums.reduce(function(sum, value) { return sum + value; }, 0) / nums.length;
  }

  function clone(value) {
    return ns.deepClone ? ns.deepClone(value) : JSON.parse(JSON.stringify(value));
  }

  function ParameterCapture(synth) {
    this.synth = synth;
    this.samples = [];
    this.recording = false;
    this.startedAt = 0;
    this.timer = 0;
  }

  ParameterCapture.prototype.start = function() {
    this.samples = [];
    this.recording = true;
    this.startedAt = performance.now();
    var self = this;
    function step() {
      if (!self.recording) return;
      self.samples.push(self.sample());
      self.timer = requestAnimationFrame(step);
    }
    step();
  };

  ParameterCapture.prototype.stop = function() {
    this.recording = false;
    if (this.timer) cancelAnimationFrame(this.timer);
    this.timer = 0;
    return this.samples.slice();
  };

  ParameterCapture.prototype.sample = function() {
    var Glottis = this.synth.Glottis;
    var Tract = this.synth.Tract;
    var TractUI = this.synth.TractUI;
    var UI = this.synth.UI;
    return {
      t: performance.now(),
      glottis: {
        voiced: Boolean(Glottis.isTouched || Glottis.isTouchingSomewhere || Glottis.intensity > 0.08),
        ui_frequency: Glottis.UIFrequency,
        ui_tenseness: Glottis.UITenseness,
        intensity: Glottis.intensity,
        loudness: Glottis.loudness
      },
      tract: {
        tongue_index: TractUI.tongueIndex,
        tongue_diameter: TractUI.tongueDiameter,
        lip_diameter: Tract.targetDiameter[Tract.n - 2],
        velum_target: Tract.velumTarget,
        targetDiameter: Array.prototype.slice.call(Tract.targetDiameter),
        restDiameter: Array.prototype.slice.call(Tract.restDiameter)
      },
      touches: (UI.touchesWithMouse || []).filter(function(touch) {
        return touch && touch.alive && !touch.syntheticPhonemeTouch;
      }).map(function(touch) {
        return {
          index: touch.index,
          diameter: touch.diameter,
          fricative_intensity: touch.fricative_intensity || 0
        };
      })
    };
  };

  ParameterCapture.prototype.lastSamples = function(ms) {
    var samples = this.samples.length ? this.samples : [this.sample()];
    var last = samples[samples.length - 1].t;
    return samples.filter(function(sample) {
      return sample.t >= last - ms;
    });
  };

  ParameterCapture.prototype.detectConstrictions = function(samples, options) {
    options = options || {};
    var source = samples && samples.length ? samples : [this.sample()];
    var n = source[0].tract.targetDiameter.length;
    var avgTarget = [];
    var avgRest = [];
    for (var i = 0; i < n; i++) {
      avgTarget[i] = average(source.map(function(sample) { return sample.tract.targetDiameter[i]; }), 1.5);
      avgRest[i] = average(source.map(function(sample) { return sample.tract.restDiameter[i]; }), 1.5);
    }
    var groups = [];
    var current = null;
    var threshold = options.threshold === undefined ? 0.18 : options.threshold;
    for (var index = 2; index < n; index++) {
      var shrink = avgRest[index] - avgTarget[index];
      var active = shrink > threshold || avgTarget[index] < (options.closedOnly ? 0.3 : 1.2);
      if (active) {
        if (!current) current = { start: index, end: index, minIndex: index, minDiameter: avgTarget[index] };
        current.end = index;
        if (avgTarget[index] < current.minDiameter) {
          current.minDiameter = avgTarget[index];
          current.minIndex = index;
        }
      } else if (current) {
        groups.push(current);
        current = null;
      }
    }
    if (current) groups.push(current);
    var touchTurbulence = Math.max.apply(null, [0].concat(source.map(function(sample) {
      return Math.max.apply(null, [0].concat(sample.touches.map(function(touch) { return touch.fricative_intensity || 0; })));
    })));
    return groups.sort(function(left, right) {
      return left.minDiameter - right.minDiameter;
    }).slice(0, options.limit || 2).map(function(group) {
      return ns.normalizeConstriction({
        index: group.minIndex,
        diameter: clamp(group.minDiameter, 0, 2.5),
        width: Math.max(2, (group.end - group.start + 1) / 2),
        turbulence_intensity: options.turbulence ? Math.max(touchTurbulence, 0.8) : touchTurbulence,
        label: options.label || "captured"
      });
    });
  };

  ParameterCapture.prototype.summarize = function(baseParams, templateType, options) {
    options = options || {};
    var params = clone(baseParams);
    var samples;
    if (options.windowMs) samples = this.lastSamples(options.windowMs);
    else samples = this.samples.length ? this.samples.slice() : [this.sample()];
    if (!samples.length) samples = [this.sample()];
    var type = templateType || (ns.classifyPhoneme ? ns.classifyPhoneme(baseParams) : "other");
    var glottis = {
      voiced: samples.some(function(sample) { return sample.glottis.voiced; }) || params.glottis.voiced,
      ui_frequency: Math.round(average(samples.map(function(sample) { return sample.glottis.ui_frequency; }), params.glottis.ui_frequency)),
      ui_tenseness: Number(average(samples.map(function(sample) { return sample.glottis.ui_tenseness; }), params.glottis.ui_tenseness).toFixed(3)),
      intensity: Number(average(samples.map(function(sample) { return sample.glottis.intensity; }), params.glottis.intensity).toFixed(3)),
      loudness: Number(average(samples.map(function(sample) { return sample.glottis.loudness; }), params.glottis.loudness).toFixed(3))
    };
    var tract = {
      tongue_index: Number(average(samples.map(function(sample) { return sample.tract.tongue_index; }), params.tract.tongue_index || 12.9).toFixed(2)),
      tongue_diameter: Number(average(samples.map(function(sample) { return sample.tract.tongue_diameter; }), params.tract.tongue_diameter || 2.43).toFixed(2)),
      lip_diameter: Number(average(samples.map(function(sample) { return sample.tract.lip_diameter; }), params.tract.lip_diameter || 1.5).toFixed(2)),
      velum_target: Number(average(samples.map(function(sample) { return sample.tract.velum_target; }), params.tract.velum_target || 0.01).toFixed(3))
    };

    params.glottis = Object.assign({}, params.glottis, glottis);
    params.tract = Object.assign({}, params.tract, tract);

    if (type === "vowel") {
      params.tract.constrictions = (params.tract.lip_diameter < 1.1) ? [ns.normalizeConstriction({
        index: 41,
        diameter: params.tract.lip_diameter,
        width: 4,
        label: "captured lip rounding"
      })] : [];
      params.noise.turbulence = false;
      params.noise.turbulence_intensity = 0;
    } else if (type === "nasal") {
      params.glottis.voiced = true;
      params.tract.velum_target = Math.max(0.25, params.tract.velum_target);
      params.tract.constrictions = this.detectConstrictions(samples, { closedOnly: true, limit: 1, label: "captured nasal closure" });
      if (!params.tract.constrictions.length) params.tract.constrictions = clone(baseParams.tract.constrictions || []);
    } else if (type === "stop") {
      params.tract.velum_target = Math.min(0.06, params.tract.velum_target);
      params.tract.constrictions = this.detectConstrictions(samples, { closedOnly: true, limit: 1, label: "captured stop closure" });
      if (!params.tract.constrictions.length) params.tract.constrictions = clone(baseParams.tract.constrictions || []);
      params.release.transient = true;
      params.release.strength = Math.max(params.release.strength || 0.3, 0.3);
      params.timing.closure_ms = params.timing.closure_ms || 70;
    } else if (type === "fricative") {
      params.tract.constrictions = this.detectConstrictions(samples, { turbulence: true, limit: 1, label: "captured fricative constriction" });
      if (!params.tract.constrictions.length) params.tract.constrictions = clone(baseParams.tract.constrictions || []);
      params.noise.turbulence = true;
      params.noise.turbulence_intensity = Math.max(params.noise.turbulence_intensity || 0.8, 0.8);
    } else if (type === "affricate") {
      var captured = this.detectConstrictions(samples, { turbulence: options.stage === "frication", limit: 1, label: options.stage === "frication" ? "captured fricative release" : "captured stop closure" });
      if (options.existingParams && options.stage === "frication") {
        var closure = (options.existingParams.tract.constrictions || params.tract.constrictions || []).slice(0, 1);
        params.tract.constrictions = closure.concat(captured.length ? captured : (baseParams.tract.constrictions || []).slice(1, 2));
      } else if (options.existingParams && options.stage === "closure") {
        var fric = (options.existingParams.tract.constrictions || params.tract.constrictions || []).slice(1, 2);
        params.tract.constrictions = (captured.length ? captured : (baseParams.tract.constrictions || []).slice(0, 1)).concat(fric);
      } else if (captured.length) {
        params.tract.constrictions = captured.concat((baseParams.tract.constrictions || []).slice(1, 2));
      }
      params.release.transient = true;
      params.noise.turbulence = true;
      params.noise.turbulence_intensity = Math.max(params.noise.turbulence_intensity || 1, 1);
      params.timing.closure_ms = params.timing.closure_ms || 55;
      params.timing.frication_ms = params.timing.frication_ms || 60;
    } else {
      var partials = this.detectConstrictions(samples, { threshold: 0.28, limit: 1, label: "captured constriction" });
      params.tract.constrictions = partials.length ? partials : clone(params.tract.constrictions || []);
    }
    params.duration_ms = params.timing.duration_ms || params.duration_ms;
    params.metadata.notes = (params.metadata.notes || []).concat(["Captured from manual Pink Trombone calibration."]);
    return params;
  };

  return {
    ParameterCapture: ParameterCapture
  };
});
