(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function equal(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function flattenDiff(base, value, prefix, rows) {
    rows = rows || [];
    prefix = prefix || "";
    if (equal(base, value)) return rows;
    if (Array.isArray(base) || Array.isArray(value) || !isObject(base) || !isObject(value)) {
      rows.push({
        path: prefix || "value",
        before: base,
        after: value
      });
      return rows;
    }
    Object.keys(value).forEach(function(key) {
      if (key === "original") return;
      flattenDiff(base ? base[key] : undefined, value[key], prefix ? prefix + "." + key : key, rows);
    });
    return rows;
  }

  function sectionPatch(params, section) {
    var patch = {};
    if (!params) return patch;
    if (section === "glottis" && params.glottis) patch.glottis = ns.deepClone(params.glottis);
    if ((section === "tongue" || section === "lips" || section === "velum") && params.tract) {
      patch.tract = patch.tract || {};
      if (section === "tongue") {
        patch.tract.tongue_index = params.tract.tongue_index;
        patch.tract.tongue_diameter = params.tract.tongue_diameter;
      }
      if (section === "lips") patch.tract.lip_diameter = params.tract.lip_diameter;
      if (section === "velum") patch.tract.velum_target = params.tract.velum_target;
    }
    if ((section === "closure" || section === "constriction" || section === "partial constriction" || section === "frication" || section === "brief contact") && params.tract) {
      patch.tract = patch.tract || {};
      patch.tract.constrictions = ns.deepClone(params.tract.constrictions || []);
    }
    if (section === "turbulence" && params.noise) patch.noise = ns.deepClone(params.noise);
    if (section === "release" && params.release) patch.release = ns.deepClone(params.release);
    if (section === "timing") {
      patch.duration_ms = params.duration_ms;
      patch.timing = ns.deepClone(params.timing || {});
    }
    return patch;
  }

  function applyPatch(params, patch) {
    return ns.deepMerge ? ns.deepMerge(params, patch) : Object.assign({}, params, patch);
  }

  return {
    flattenParameterDiff: flattenDiff,
    calibrationSectionPatch: sectionPatch,
    applyCalibrationPatch: applyPatch
  };
});
