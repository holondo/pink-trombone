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

  function lerp(left, right, amount) {
    if (left === null || left === undefined) return right;
    if (right === null || right === undefined) return left;
    return left + (right - left) * amount;
  }

  function smoothstep(value) {
    var x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function clone(value) {
    return ns.deepClone ? ns.deepClone(value) : JSON.parse(JSON.stringify(value));
  }

  function PinkTromboneController(synth) {
    this.AudioSystem = synth.AudioSystem;
    this.UI = synth.UI;
    this.Glottis = synth.Glottis;
    this.Tract = synth.Tract;
    this.TractUI = synth.TractUI;
    this.mode = "manual";
    this.active = false;
    this.loop = false;
    this.autoVoice = true;
    this.pitchMultiplier = 1;
    this.intensityMultiplier = 1;
    this.events = [];
    this.currentEventIndex = -1;
    this.currentEvent = null;
    this.currentStageKey = "";
    this.animationFrame = 0;
    this.syntheticTouches = [];
    this.transitionStart = 0;
    this.transitionMs = 40;
    this.fromState = this.captureState();
    this.targetState = this.captureState();
    this.onUpdate = function() {};
  }

  PinkTromboneController.prototype.ensureAudioStarted = function() {
    if (!this.AudioSystem.started) {
      this.AudioSystem.started = true;
      this.AudioSystem.startSound();
    }
    if (this.AudioSystem.audioContext && this.AudioSystem.audioContext.state === "suspended") {
      this.AudioSystem.audioContext.resume();
    }
  };

  PinkTromboneController.prototype.setMode = function(mode) {
    this.mode = mode;
    if (mode === "manual" || mode === "calibrator" || mode === "browser") this.stop();
    else if (mode === "capture") this.stop(false);
    else this.clearManualTouches();
  };

  PinkTromboneController.prototype.clearManualTouches = function() {
    if (!this.UI || !Array.isArray(this.UI.touchesWithMouse)) return;
    this.UI.touchesWithMouse = this.UI.touchesWithMouse.filter(function(touch) {
      return touch && touch.syntheticPhonemeTouch;
    });
  };

  PinkTromboneController.prototype.captureState = function() {
    return {
      glottis: {
        ui_frequency: this.Glottis ? this.Glottis.UIFrequency : 140,
        ui_tenseness: this.Glottis ? this.Glottis.UITenseness : 0.6,
        intensity: this.Glottis ? this.Glottis.intensity : 0,
        loudness: this.Glottis ? this.Glottis.loudness : 1
      },
      tract: {
        tongue_index: this.TractUI ? this.TractUI.tongueIndex : 12.9,
        tongue_diameter: this.TractUI ? this.TractUI.tongueDiameter : 2.43,
        lip_diameter: this.Tract ? this.Tract.targetDiameter[this.Tract.n - 2] : 1.5,
        velum_target: this.Tract ? this.Tract.velumTarget : 0.01,
        constrictions: []
      }
    };
  };

  PinkTromboneController.prototype.stateFromParams = function(params) {
    var tract = params.tract || {};
    var glottis = params.glottis || {};
    return {
      glottis: {
        ui_frequency: Number(glottis.ui_frequency || 140) * this.pitchMultiplier,
        ui_tenseness: Number(glottis.ui_tenseness !== undefined ? glottis.ui_tenseness : 0.6),
        intensity: clamp(Number(glottis.intensity !== undefined ? glottis.intensity : 0.82) * this.intensityMultiplier, 0, 1),
        loudness: clamp(Number(glottis.loudness !== undefined ? glottis.loudness : 0.9) * this.intensityMultiplier, 0, 1.5),
        voiced: Boolean(glottis.voiced)
      },
      tract: {
        tongue_index: tract.tongue_index,
        tongue_diameter: tract.tongue_diameter,
        lip_diameter: tract.lip_diameter,
        velum_target: Number(tract.velum_target !== undefined ? tract.velum_target : 0.01),
        constrictions: clone(tract.constrictions || [])
      },
      noise: clone(params.noise || {}),
      release: clone(params.release || {}),
      events: clone(params.events || [])
    };
  };

  PinkTromboneController.prototype.applyPhoneme = function(params, transitionMs) {
    this.transitionStart = performance.now();
    this.transitionMs = transitionMs || (params.timing && params.timing.transition_ms) || 45;
    this.fromState = this.captureState();
    this.targetState = this.stateFromParams(params);
    this.updateInterpolated(this.transitionStart);
  };

  PinkTromboneController.prototype.setGlottis = function(glottis, voiced) {
    this.Glottis.UIFrequency = glottis.ui_frequency;
    this.Glottis.UITenseness = clamp(glottis.ui_tenseness, 0, 1);
    this.Glottis.loudness = clamp(glottis.loudness, 0, 1.5);
    this.Glottis.intensity = clamp(glottis.intensity, 0, 1);
    this.Glottis.isTouched = Boolean(this.autoVoice && voiced);
    this.Glottis.isTouchingSomewhere = Boolean(this.autoVoice && voiced);
    this.Glottis.x = 240 + Math.log2(Math.max(1, glottis.ui_frequency) / 140) * 110;
    this.Glottis.y = 540 - glottis.ui_tenseness * 42;
  };

  PinkTromboneController.prototype.applyConstriction = function(constriction) {
    var index = Number(constriction.index);
    var diameter = Math.max(0, Number(constriction.diameter));
    var width = Math.max(1, Number(constriction.width || 5));
    if (!Number.isFinite(index) || !Number.isFinite(diameter)) return;
    var intIndex = Math.round(index);
    for (var offset = -Math.ceil(width) - 1; offset < width + 1; offset++) {
      var tractIndex = intIndex + offset;
      if (tractIndex < 0 || tractIndex >= this.Tract.n) continue;
      var relpos = Math.abs(tractIndex - index) - 0.5;
      var shrink;
      if (relpos <= 0) shrink = 0;
      else if (relpos > width) shrink = 1;
      else shrink = 0.5 * (1 - Math.cos(Math.PI * relpos / width));
      if (diameter < this.Tract.targetDiameter[tractIndex]) {
        this.Tract.targetDiameter[tractIndex] = diameter + (this.Tract.targetDiameter[tractIndex] - diameter) * shrink;
      }
    }
  };

  PinkTromboneController.prototype.setConstrictions = function(constrictions) {
    (constrictions || []).forEach(function(constriction) {
      this.applyConstriction(constriction);
    }, this);
  };

  PinkTromboneController.prototype.setTract = function(tract) {
    if (tract.tongue_index !== null && tract.tongue_index !== undefined) {
      this.TractUI.tongueIndex = clamp(Number(tract.tongue_index), this.TractUI.tongueLowerIndexBound, this.TractUI.tongueUpperIndexBound);
    }
    if (tract.tongue_diameter !== null && tract.tongue_diameter !== undefined) {
      this.TractUI.tongueDiameter = clamp(Number(tract.tongue_diameter), this.TractUI.innerTongueControlRadius, this.TractUI.outerTongueControlRadius);
    }
    this.TractUI.setRestDiameter();
    for (var i = 0; i < this.Tract.n; i++) this.Tract.targetDiameter[i] = this.Tract.restDiameter[i];
    this.Tract.velumTarget = clamp(Number(tract.velum_target !== undefined ? tract.velum_target : 0.01), 0.01, 0.5);
    if (tract.lip_diameter !== null && tract.lip_diameter !== undefined && Number(tract.lip_diameter) < 1.45) {
      this.applyConstriction({
        index: this.Tract.lipStart + 2,
        diameter: Number(tract.lip_diameter),
        width: 4,
        label: "lip diameter"
      });
    }
    this.setConstrictions(tract.constrictions || []);
  };

  PinkTromboneController.prototype.updateSyntheticTouches = function(state, now) {
    this.removeSyntheticTouches();
    var constrictions = (state.tract && state.tract.constrictions) || [];
    var turbulence = state.noise && Number(state.noise.turbulence_intensity || 0);
    constrictions.forEach(function(constriction, index) {
      var intensity = Math.max(Number(constriction.turbulence_intensity || 0), turbulence || 0);
      if (intensity <= 0) return;
      var touch = {
        syntheticPhonemeTouch: true,
        alive: true,
        id: "phoneme-" + index,
        startTime: now / 1000,
        endTime: 0,
        fricative_intensity: clamp(intensity, 0, 1),
        index: Number(constriction.index),
        diameter: Math.max(0.05, Number(constriction.diameter || 0.2)),
        x: 0,
        y: 0
      };
      this.syntheticTouches.push(touch);
      this.UI.touchesWithMouse.push(touch);
    }, this);
  };

  PinkTromboneController.prototype.removeSyntheticTouches = function() {
    if (!this.UI || !Array.isArray(this.UI.touchesWithMouse)) return;
    this.UI.touchesWithMouse = this.UI.touchesWithMouse.filter(function(touch) {
      return !touch.syntheticPhonemeTouch;
    });
    this.syntheticTouches = [];
  };

  PinkTromboneController.prototype.updateInterpolated = function(now) {
    var amount = smoothstep((now - this.transitionStart) / Math.max(1, this.transitionMs));
    var target = this.targetState;
    var glottis = {
      ui_frequency: lerp(this.fromState.glottis.ui_frequency, target.glottis.ui_frequency, amount),
      ui_tenseness: lerp(this.fromState.glottis.ui_tenseness, target.glottis.ui_tenseness, amount),
      intensity: lerp(this.fromState.glottis.intensity, target.glottis.intensity, amount),
      loudness: lerp(this.fromState.glottis.loudness, target.glottis.loudness, amount)
    };
    var tract = {
      tongue_index: lerp(this.fromState.tract.tongue_index, target.tract.tongue_index, amount),
      tongue_diameter: lerp(this.fromState.tract.tongue_diameter, target.tract.tongue_diameter, amount),
      lip_diameter: lerp(this.fromState.tract.lip_diameter, target.tract.lip_diameter, amount),
      velum_target: lerp(this.fromState.tract.velum_target, target.tract.velum_target, amount),
      constrictions: target.tract.constrictions
    };
    this.setGlottis(glottis, target.glottis.voiced);
    this.setTract(tract);
    this.updateSyntheticTouches(target, now);
  };

  PinkTromboneController.prototype.paramsForEventStage = function(event, localMs) {
    var params = clone(event.params);
    var events = params.events || [];
    var closure = events.filter(function(item) {
      return item && item.type === "closure";
    })[0];
    var fricatedRelease = events.filter(function(item) {
      return item && item.type === "fricated_release";
    })[0];
    if (closure && fricatedRelease && localMs >= Number(closure.duration_ms || 0)) {
      params.tract.constrictions = params.tract.constrictions.slice(1);
      params.noise.turbulence = true;
      params.noise.turbulence_intensity = Math.max(params.noise.turbulence_intensity || 0, 1);
      return {
        key: "fricated-release",
        params: params
      };
    }
    if (closure) {
      params.tract.constrictions = params.tract.constrictions.slice(0, 1);
      params.noise.turbulence_intensity = 0;
      params.noise.turbulence = false;
      return {
        key: "closure",
        params: params
      };
    }
    return {
      key: "steady",
      params: params
    };
  };

  PinkTromboneController.prototype.play = function(events, options) {
    options = options || {};
    this.stop(false);
    this.ensureAudioStarted();
    this.events = events || [];
    this.loop = Boolean(options.loop);
    this.autoVoice = options.autoVoice !== false;
    this.pitchMultiplier = Number(options.pitchMultiplier || 1);
    this.intensityMultiplier = Number(options.intensityMultiplier || 1);
    this.currentEventIndex = -1;
    this.currentStageKey = "";
    this.active = true;
    this.startedAt = performance.now();
    this.totalDuration = Math.max(0.001, this.events.reduce(function(max, event) {
      return Math.max(max, event.start + event.duration);
    }, 0));
    this.tick();
  };

  PinkTromboneController.prototype.playOne = function(params, options) {
    options = options || {};
    this.play([{
      token: params.ipa || "?",
      start: 0,
      duration: Math.max(0.08, Number(params.duration_ms || 140) / 1000),
      params: clone(params)
    }], {
      loop: false,
      autoVoice: options.autoVoice !== false,
      pitchMultiplier: options.pitchMultiplier || 1,
      intensityMultiplier: options.intensityMultiplier || 1
    });
  };

  PinkTromboneController.prototype.tick = function() {
    if (!this.active) return;
    var now = performance.now();
    var elapsed = (now - this.startedAt) / 1000;
    if (this.loop && this.totalDuration > 0) elapsed = elapsed % this.totalDuration;
    if (!this.loop && elapsed > this.totalDuration) {
      this.stop();
      return;
    }

    var activeIndex = -1;
    for (var i = 0; i < this.events.length; i++) {
      if (elapsed >= this.events[i].start && elapsed < this.events[i].start + this.events[i].duration) {
        activeIndex = i;
        break;
      }
    }

    if (activeIndex !== -1) {
      var event = this.events[activeIndex];
      var stage = this.paramsForEventStage(event, (elapsed - event.start) * 1000);
      if (activeIndex !== this.currentEventIndex || stage.key !== this.currentStageKey) {
        this.currentEventIndex = activeIndex;
        this.currentEvent = event;
        this.currentStageKey = stage.key;
        this.applyPhoneme(stage.params, stage.params.timing && stage.params.timing.transition_ms);
        if (stage.key === "fricated-release" && stage.params.release && stage.params.release.transient) {
          this.addReleaseTransient(stage.params);
        }
      } else {
        this.updateInterpolated(now);
      }
      this.onUpdate({
        event: event,
        index: activeIndex,
        elapsed: elapsed,
        stage: stage.key
      });
    }

    var self = this;
    this.animationFrame = requestAnimationFrame(function() {
      self.tick();
    });
  };

  PinkTromboneController.prototype.addReleaseTransient = function(params) {
    var constrictions = params.tract && params.tract.constrictions;
    var position = constrictions && constrictions[0] ? Math.round(constrictions[0].index) : this.Tract.tipStart;
    if (this.Tract && typeof this.Tract.addTransient === "function") this.Tract.addTransient(position);
  };

  PinkTromboneController.prototype.resetToRest = function() {
    this.removeSyntheticTouches();
    this.TractUI.tongueIndex = 12.9;
    this.TractUI.tongueDiameter = 2.43;
    this.TractUI.setRestDiameter();
    for (var i = 0; i < this.Tract.n; i++) this.Tract.targetDiameter[i] = this.Tract.restDiameter[i];
    this.Tract.velumTarget = 0.01;
    this.Glottis.isTouched = false;
    this.Glottis.isTouchingSomewhere = false;
    this.Glottis.intensity = 0;
  };

  PinkTromboneController.prototype.stop = function(reset) {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.active = false;
    this.currentEventIndex = -1;
    this.currentEvent = null;
    this.currentStageKey = "";
    this.removeSyntheticTouches();
    this.Glottis.isTouched = false;
    this.Glottis.isTouchingSomewhere = false;
    if (reset !== false) this.resetToRest();
    this.onUpdate({
      event: null,
      index: -1,
      elapsed: 0,
      stage: "stopped"
    });
  };

  return {
    PinkTromboneController: PinkTromboneController
  };
});
