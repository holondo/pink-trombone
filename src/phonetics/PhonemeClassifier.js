(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function text(value) {
    return String(value || "").toLowerCase();
  }

  function hasEvent(params, part) {
    return ((params && params.events) || []).some(function(event) {
      return text(event && event.type).indexOf(part) !== -1;
    });
  }

  function hasClosedConstriction(params) {
    return ((params && params.tract && params.tract.constrictions) || []).some(function(constriction) {
      return Number(constriction.diameter) <= 0.08;
    });
  }

  function classifyPhoneme(params) {
    params = params || {};
    var category = text(params.category);
    var manner = text(params.features && params.features.manner);
    var support = text(params.metadata && params.metadata.support);
    var label = text(params.label);
    var nasal = manner === "nasal" || label.indexOf("nasal") !== -1 || (params.tract && Number(params.tract.velum_target) > 0.15);
    var noisy = params.noise && (params.noise.turbulence || Number(params.noise.turbulence_intensity) > 0);
    var affricate = category.indexOf("affricate") !== -1 || manner === "affricate" || hasEvent(params, "fricated_release");
    var stop = manner === "stop" || manner === "plosive" || label.indexOf("plosive") !== -1 || hasEvent(params, "closure") || (hasClosedConstriction(params) && !nasal && !noisy);
    var approximant = manner === "approximant" || manner === "lateral" || label.indexOf("approximant") !== -1 || label.indexOf("lateral") !== -1 || label.indexOf("glide") !== -1;
    var tap = manner === "tap" || manner === "flap" || manner === "trill" || label.indexOf("tap") !== -1 || label.indexOf("trill") !== -1;

    if (category.indexOf("vowel") !== -1 || (params.features && params.features.syllabic)) return "vowel";
    if (affricate) return "affricate";
    if (nasal) return "nasal";
    if (noisy || manner === "fricative" || label.indexOf("fricative") !== -1 || support.indexOf("fricative") !== -1) return "fricative";
    if (stop) return "stop";
    if (approximant) return "approximant";
    if (tap) return "tap";
    return "other";
  }

  var TEMPLATES = {
    vowel: {
      title: "Vowel Calibrator",
      capturePrimary: "stable posture",
      preview: function(token) { return token; },
      windows: ["Use Current", "Use Average", "Use Last 500ms"],
      sections: ["glottis", "tongue", "lips", "velum"],
      fields: ["glottis.ui_frequency", "glottis.ui_tenseness", "glottis.intensity", "glottis.loudness", "tract.tongue_index", "tract.tongue_diameter", "tract.lip_diameter", "tract.velum_target"]
    },
    nasal: {
      title: "Nasal Calibrator",
      capturePrimary: "oral closure + open velum",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Capture closure", "Use Average", "Use Last 500ms"],
      sections: ["glottis", "closure", "velum"],
      fields: ["glottis.ui_frequency", "glottis.ui_tenseness", "glottis.intensity", "glottis.loudness", "tract.velum_target", "tract.constrictions"]
    },
    stop: {
      title: "Stop Calibrator",
      capturePrimary: "closure, hold, release",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Capture closure", "Use Last 300ms"],
      sections: ["closure", "release", "timing", "glottis"],
      fields: ["glottis.voiced", "glottis.ui_tenseness", "glottis.intensity", "glottis.loudness", "tract.velum_target", "tract.constrictions", "release.transient", "release.strength", "timing.closure_ms", "duration_ms"]
    },
    fricative: {
      title: "Fricative Calibrator",
      capturePrimary: "narrow constriction + turbulence",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Capture constriction", "Use Average", "Use Last 500ms"],
      sections: ["constriction", "turbulence", "glottis"],
      fields: ["glottis.voiced", "glottis.ui_tenseness", "glottis.intensity", "glottis.loudness", "tract.constrictions", "noise.turbulence", "noise.turbulence_intensity", "duration_ms"]
    },
    affricate: {
      title: "Affricate Calibrator",
      capturePrimary: "closure stage + fricative release",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Capture closure stage", "Capture frication stage"],
      sections: ["closure", "frication", "timing", "release"],
      fields: ["glottis.voiced", "tract.constrictions", "noise.turbulence_intensity", "release.transient", "timing.closure_ms", "timing.frication_ms", "duration_ms"]
    },
    approximant: {
      title: "Approximant Calibrator",
      capturePrimary: "partial constriction + transition posture",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Use Current", "Use Average", "Use Last 500ms"],
      sections: ["glottis", "tongue", "partial constriction", "lips"],
      fields: ["glottis.ui_frequency", "glottis.ui_tenseness", "glottis.intensity", "glottis.loudness", "tract.tongue_index", "tract.tongue_diameter", "tract.lip_diameter", "tract.constrictions", "duration_ms"]
    },
    tap: {
      title: "Tap/Trill Calibrator",
      capturePrimary: "short approximated contact",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Capture contact", "Use Last 200ms"],
      sections: ["brief contact", "timing", "glottis"],
      fields: ["glottis.voiced", "tract.constrictions", "duration_ms", "metadata.approximation_level"]
    },
    other: {
      title: "General Calibrator",
      capturePrimary: "best available articulatory target",
      preview: function(token) { return "a " + token + " a"; },
      windows: ["Use Current", "Use Average", "Use Last 500ms"],
      sections: ["glottis", "tract", "noise", "release"],
      fields: ["glottis", "tract", "noise", "release", "duration_ms"]
    }
  };

  function getTemplate(params) {
    var type = classifyPhoneme(params);
    return Object.assign({ type: type }, TEMPLATES[type] || TEMPLATES.other);
  }

  return {
    classifyPhoneme: classifyPhoneme,
    getCalibrationTemplate: getTemplate,
    PHONEME_TEMPLATES: TEMPLATES
  };
});
