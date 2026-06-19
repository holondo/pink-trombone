(function(root, factory) {
  var api = factory(root.Phonetics || {}, root);
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns, root) {
  "use strict";

  var EMPTY_OVERRIDE_DOC = {
    version: 1,
    overrides: {}
  };

  var PATH_ALIASES = {
    "glottis.ui_frequency_hz": "glottis.ui_frequency",
    "glottis.frequency": "glottis.ui_frequency",
    "excitation.turbulence_noise": "noise.turbulence_intensity",
    "excitation.release_transient": "release.transient",
    "excitation.nasal_coupling": "metadata.nasal_coupling",
    "pink_trombone.timing.duration_ms": "timing.duration_ms",
    "pink_trombone.tract.constrictions": "tract.constrictions"
  };

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function deepMerge(base, override) {
    if (override === undefined) return deepClone(base);
    if (Array.isArray(base) || Array.isArray(override)) return deepClone(override);
    if (!isPlainObject(base) || !isPlainObject(override)) return deepClone(override);

    var result = deepClone(base);
    Object.keys(override).forEach(function(key) {
      result[key] = deepMerge(result[key], override[key]);
    });
    return result;
  }

  function deepEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function deepDiff(base, value) {
    if (deepEqual(base, value)) return undefined;
    if (Array.isArray(base) || Array.isArray(value)) return deepClone(value);
    if (!isPlainObject(base) || !isPlainObject(value)) return deepClone(value);

    var diff = {};
    Object.keys(value).forEach(function(key) {
      if (key === "original") return;
      var childDiff = deepDiff(base ? base[key] : undefined, value[key]);
      if (childDiff !== undefined) diff[key] = childDiff;
    });
    return Object.keys(diff).length ? diff : undefined;
  }

  function toNumber(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function firstDefined(values, fallback) {
    for (var i = 0; i < values.length; i++) {
      if (values[i] !== undefined && values[i] !== null) return values[i];
    }
    return fallback;
  }

  function firstNumber(values, fallback) {
    return toNumber(firstDefined(values, fallback), fallback);
  }

  function getPath(object, path) {
    var parts = Array.isArray(path) ? path : String(path).split(".");
    var current = object;
    for (var i = 0; i < parts.length; i++) {
      if (current === null || current === undefined) return undefined;
      current = current[parts[i]];
    }
    return current;
  }

  function setPath(object, path, value) {
    var parts = Array.isArray(path) ? path : String(path).split(".");
    var current = object;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!isPlainObject(current[parts[i]])) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  function normalizedPatchPath(path) {
    return PATH_ALIASES[path] || path;
  }

  function applyRelativeValue(current, patchValue) {
    if (typeof patchValue !== "string") return patchValue;
    var match = patchValue.match(/^([*+\-])\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return patchValue;
    var number = Number(match[2]);
    var currentNumber = toNumber(current, 0);
    if (match[1] === "*") return currentNumber * number;
    if (match[1] === "+") return currentNumber + number;
    return currentNumber - number;
  }

  function normalizeConstriction(constriction) {
    var source = constriction || {};
    return {
      index: firstNumber([source.index, source.position, source.tract_index], 36),
      diameter: firstNumber([source.diameter, source.target_diameter], 0.3),
      width: firstNumber([source.width], 5),
      label: firstDefined([source.label, source.name], ""),
      turbulence_intensity: firstNumber([
        source.turbulence_intensity,
        source.turbulenceIntensity,
        source.turbulence
      ], 0)
    };
  }

  function normalizeConstrictions(constrictions) {
    if (!Array.isArray(constrictions)) return [];
    return constrictions.map(normalizeConstriction);
  }

  function supportToApproximationLevel(support) {
    if (support === false || support === "unsupported") return "unsupported";
    if (support === "native") return "native";
    return "approximate";
  }

  function normalizeEntry(token, entry, defaults) {
    var source = entry || {};
    var pink = source.pink_trombone || source.pinkTrombone || {};
    var defaultTiming = (defaults && defaults.timing) || {};
    var defaultGlottis = (defaults && defaults.glottis) || {};
    var defaultTract = (defaults && defaults.tract) || {};
    var timing = deepMerge(defaultTiming, deepMerge(source.timing || {}, pink.timing || {}));
    var glottis = deepMerge(defaultGlottis, deepMerge(source.glottis || {}, pink.glottis || {}));
    var tract = deepMerge(defaultTract, deepMerge(source.tract || {}, pink.tract || {}));
    var excitation = deepMerge(source.excitation || {}, pink.excitation || {});
    var rawEvents = source.events || pink.events || [];
    var rawMetadata = source.metadata || {};
    var category = firstDefined([
      source.category,
      source.type,
      source.features && source.features.syllabic ? "vowel" : undefined
    ], "unknown");
    var duration = firstNumber([source.duration_ms, timing.duration_ms], 140);
    var turbulenceIntensity = firstNumber([
      source.noise && source.noise.turbulence_intensity,
      source.noise && source.noise.turbulenceIntensity,
      excitation.turbulence_noise,
      excitation.turbulence_intensity
    ], 0);
    var hasReleaseEvent = rawEvents.some(function(event) {
      return event && String(event.type || "").indexOf("release") !== -1;
    });
    var releaseEvent = rawEvents.filter(function(event) {
      return event && String(event.type || "").indexOf("release") !== -1;
    })[0] || {};
    var voiced = firstDefined([glottis.voiced, source.voiced], category === "vowel");
    var support = firstDefined([source.support, rawMetadata.approximation_level], "approximate");
    var supported = firstDefined([
      rawMetadata.supported,
      source.supported
    ], support !== "unsupported");

    return {
      ipa: firstDefined([source.ipa, source.symbol], token),
      label: firstDefined([source.label, source.ipa_name, source.unicode_name], token),
      category: category,
      duration_ms: duration,
      timing: {
        duration_ms: duration,
        attack_ms: firstNumber([source.attack_ms, timing.attack_ms], 25),
        hold_ms: firstNumber([source.hold_ms, timing.hold_ms], Math.max(20, duration - 50)),
        release_ms: firstNumber([source.release_ms, timing.release_ms], 25),
        transition_ms: firstNumber([source.transition_ms, timing.transition_ms], 45),
        closure_ms: firstNumber([source.closure_ms, timing.closure_ms], 0),
        frication_ms: firstNumber([source.frication_ms, timing.frication_ms], 0)
      },
      glottis: {
        voiced: Boolean(voiced),
        ui_frequency: firstNumber([
          glottis.ui_frequency,
          glottis.ui_frequency_hz,
          glottis.frequency
        ], 140),
        ui_tenseness: firstNumber([glottis.ui_tenseness, glottis.tenseness], voiced ? 0.6 : 0.15),
        intensity: firstNumber([glottis.intensity], voiced ? 0.82 : 0),
        loudness: firstNumber([glottis.loudness], voiced ? 0.9 : 0),
        aspiration_noise: firstNumber([glottis.aspiration_noise], 0),
        phonation: firstDefined([glottis.phonation], voiced ? "modal" : "voiceless")
      },
      tract: {
        tongue_index: firstDefined([tract.tongue_index, tract.tongueIndex], null),
        tongue_diameter: firstDefined([tract.tongue_diameter, tract.tongueDiameter], null),
        lip_diameter: firstDefined([tract.lip_diameter, tract.lipDiameter], null),
        velum_target: firstNumber([tract.velum_target, tract.velumTarget], 0.01),
        constrictions: normalizeConstrictions(firstDefined([
          tract.constrictions,
          source.constrictions
        ], []))
      },
      noise: {
        turbulence: Boolean(firstDefined([
          source.noise && source.noise.turbulence,
          turbulenceIntensity > 0
        ], false)),
        turbulence_intensity: turbulenceIntensity
      },
      release: {
        transient: Boolean(firstDefined([
          source.release && source.release.transient,
          excitation.release_transient,
          hasReleaseEvent
        ], false)),
        strength: firstNumber([
          source.release && source.release.strength,
          releaseEvent.amplitude,
          releaseEvent.strength
        ], hasReleaseEvent ? 0.3 : 0)
      },
      features: deepClone(source.features || {}),
      events: deepClone(rawEvents),
      metadata: {
        supported: Boolean(supported),
        approximation_level: firstDefined([
          rawMetadata.approximation_level,
          supportToApproximationLevel(support)
        ], "approximate"),
        notes: deepClone(firstDefined([rawMetadata.notes, source.notes], [])),
        support: support,
        nasal_coupling: Boolean(firstDefined([excitation.nasal_coupling], false))
      },
      original: deepClone(source)
    };
  }

  function syncDerivedFields(params) {
    if (!params || !isPlainObject(params)) return params;
    if (!isPlainObject(params.timing)) params.timing = {};
    if (params.duration_ms !== undefined) params.timing.duration_ms = params.duration_ms;
    if (params.timing.duration_ms !== undefined) params.duration_ms = params.timing.duration_ms;
    if (!isPlainObject(params.noise)) params.noise = {};
    params.noise.turbulence = Number(params.noise.turbulence_intensity || 0) > 0 || Boolean(params.noise.turbulence);
    if (!isPlainObject(params.metadata)) params.metadata = {};
    if (!params.metadata.approximation_level) params.metadata.approximation_level = "approximate";
    if (params.metadata.supported === undefined) params.metadata.supported = params.metadata.approximation_level !== "unsupported";
    if (!isPlainObject(params.tract)) params.tract = {};
    params.tract.constrictions = normalizeConstrictions(params.tract.constrictions || []);
    return params;
  }

  function normalizeOverrideDoc(doc) {
    var normalized = deepMerge(EMPTY_OVERRIDE_DOC, doc || {});
    if (!isPlainObject(normalized.overrides)) normalized.overrides = {};
    return normalized;
  }

  function normalizeOverridePatch(token, patch, defaults) {
    var normalized;
    var fullEntry = patch && (patch.pink_trombone || patch.pinkTrombone || patch.symbol || patch.ipa_name);
    if (fullEntry) {
      normalized = normalizeEntry(token, patch, defaults);
    } else {
      normalized = deepClone(patch || {});
    }
    if (normalized.approximation_level !== undefined) {
      normalized.metadata = normalized.metadata || {};
      normalized.metadata.approximation_level = normalized.approximation_level;
      delete normalized.approximation_level;
    }
    if (normalized.supported !== undefined) {
      normalized.metadata = normalized.metadata || {};
      normalized.metadata.supported = normalized.supported;
      delete normalized.supported;
    }
    if (normalized.constrictions !== undefined) {
      normalized.tract = normalized.tract || {};
      normalized.tract.constrictions = normalized.constrictions;
      delete normalized.constrictions;
    }
    if (normalized.glottis && normalized.glottis.ui_frequency_hz !== undefined) {
      normalized.glottis.ui_frequency = normalized.glottis.ui_frequency_hz;
      delete normalized.glottis.ui_frequency_hz;
    }
    if (normalized.timing && normalized.timing.duration_ms !== undefined) {
      normalized.duration_ms = normalized.timing.duration_ms;
    } else if (normalized.duration_ms !== undefined) {
      normalized.timing = normalized.timing || {};
      normalized.timing.duration_ms = normalized.duration_ms;
    }
    if (normalized.tract && normalized.tract.constrictions) {
      normalized.tract.constrictions = normalizeConstrictions(normalized.tract.constrictions);
    }
    if (normalized.noise && normalized.noise.turbulence_intensity !== undefined) {
      normalized.noise.turbulence = Number(normalized.noise.turbulence_intensity || 0) > 0 || Boolean(normalized.noise.turbulence);
    }
    return fullEntry ? syncDerivedFields(normalized) : normalized;
  }

  function stripTieBars(token) {
    return String(token).replace(/[\u0361\u035c]/g, "");
  }

  function unique(values) {
    var seen = {};
    return values.filter(function(value) {
      if (seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function sortedByLengthDesc(values) {
    return unique(values.slice()).sort(function(left, right) {
      return right.length - left.length || left.localeCompare(right);
    });
  }

  function MappingLoader(options) {
    this.options = options || {};
    this.baseUrl = this.options.baseUrl || "data/ipa_to_pink_trombone_full.json";
    this.overrideUrl = this.options.overrideUrl || "data/ipa_user_overrides.json";
    this.localStorageKey = this.options.localStorageKey || "pinkTrombone.ipaUserOverrides";
    this.warnings = [];
    this.baseRaw = null;
    this.basePhonemes = {};
    this.phonemes = {};
    this.aliases = {};
    this.baseAliases = {};
    this.diacritics = {};
    this.overrideDoc = normalizeOverrideDoc();
    this.defaults = {};
  }

  MappingLoader.EMPTY_OVERRIDE_DOC = EMPTY_OVERRIDE_DOC;

  MappingLoader.prototype.fetchJson = function(url, fallback) {
    if (typeof fetch !== "function") return Promise.resolve(deepClone(fallback));
    return fetch(url, { cache: "no-cache" }).then(function(response) {
      if (!response.ok) {
        if (fallback !== undefined) return deepClone(fallback);
        throw new Error("Could not load " + url + " (" + response.status + ")");
      }
      return response.json();
    }).catch(function(error) {
      if (fallback !== undefined) return deepClone(fallback);
      throw error;
    });
  };

  MappingLoader.prototype.readLocalOverrides = function() {
    try {
      if (!root.localStorage) return normalizeOverrideDoc();
      var raw = root.localStorage.getItem(this.localStorageKey);
      return raw ? normalizeOverrideDoc(JSON.parse(raw)) : normalizeOverrideDoc();
    } catch (error) {
      this.warnings.push("Could not read local override config: " + error.message);
      return normalizeOverrideDoc();
    }
  };

  MappingLoader.prototype.load = function() {
    var self = this;
    return this.fetchJson(this.baseUrl).then(function(base) {
      return Promise.all([
        Promise.resolve(base),
        self.fetchJson(self.overrideUrl, EMPTY_OVERRIDE_DOC),
        Promise.resolve(self.readLocalOverrides())
      ]);
    }).then(function(results) {
      var base = results[0];
      var fileOverrides = normalizeOverrideDoc(results[1]);
      var localOverrides = normalizeOverrideDoc(results[2]);
      self.setBaseMapping(base);
      self.setOverrideDoc(deepMerge(fileOverrides, localOverrides));
      return self;
    });
  };

  MappingLoader.prototype.setBaseMapping = function(raw) {
    this.baseRaw = raw || {};
    this.defaults = this.baseRaw.defaults || {};
    this.diacritics = this.baseRaw.diacritics_and_suprasegmentals || this.baseRaw.diacritics || {};
    var source = this.baseRaw.phonemes || this.baseRaw.mapping || this.baseRaw.ipa || {};
    this.basePhonemes = {};
    Object.keys(source).forEach(function(token) {
      this.basePhonemes[token] = normalizeEntry(token, source[token], this.defaults);
    }, this);
    this.baseAliases = this.buildAliases(this.basePhonemes);
    this.rebuildFinalMapping();
  };

  MappingLoader.prototype.setOverrideDoc = function(doc) {
    this.overrideDoc = normalizeOverrideDoc(doc);
    this.rebuildFinalMapping();
  };

  MappingLoader.prototype.getOverrideDoc = function() {
    return normalizeOverrideDoc(this.overrideDoc);
  };

  MappingLoader.prototype.rebuildFinalMapping = function() {
    var finalMap = deepClone(this.basePhonemes);
    var overrides = (this.overrideDoc && this.overrideDoc.overrides) || {};
    Object.keys(overrides).forEach(function(token) {
      var patch = normalizeOverridePatch(token, overrides[token], this.defaults);
      if (finalMap[token]) finalMap[token] = syncDerivedFields(deepMerge(finalMap[token], patch));
      else finalMap[token] = syncDerivedFields(deepMerge(normalizeEntry(token, { symbol: token }, this.defaults), patch));
    }, this);
    this.phonemes = finalMap;
    this.aliases = this.buildAliases(finalMap);
  };

  MappingLoader.prototype.buildAliases = function(map) {
    var aliases = {};
    Object.keys(map || {}).forEach(function(token) {
      aliases[token] = token;
      var stripped = stripTieBars(token);
      if (stripped !== token && !aliases[stripped]) aliases[stripped] = token;
      if (token.indexOf("\u0361") !== -1) {
        aliases[token.replace(/\u0361/g, "\u035c")] = token;
      }
    });
    return aliases;
  };

  MappingLoader.prototype.getTokenList = function() {
    return sortedByLengthDesc(Object.keys(this.aliases));
  };

  MappingLoader.prototype.getCanonicalToken = function(token) {
    return this.aliases[token] || this.aliases[stripTieBars(token)] || null;
  };

  MappingLoader.prototype.getDiacriticList = function() {
    return sortedByLengthDesc(Object.keys(this.diacritics));
  };

  MappingLoader.prototype.splitDiacritics = function(value) {
    var remaining = value || "";
    var marks = [];
    var diacritics = this.getDiacriticList();
    while (remaining.length) {
      var matched = "";
      for (var i = 0; i < diacritics.length; i++) {
        if (remaining.indexOf(diacritics[i]) === 0) {
          matched = diacritics[i];
          break;
        }
      }
      if (!matched) return null;
      marks.push(matched);
      remaining = remaining.slice(matched.length);
    }
    return marks;
  };

  MappingLoader.prototype.resolveToken = function(token) {
    var canonical = this.getCanonicalToken(token);
    if (canonical && this.phonemes[canonical]) {
      return {
        token: token,
        canonical: canonical,
        params: deepClone(this.phonemes[canonical]),
        diacritics: []
      };
    }

    var searchTokens = this.getTokenList();
    for (var i = 0; i < searchTokens.length; i++) {
      var base = searchTokens[i];
      var index = token.indexOf(base);
      if (index < 0) continue;
      var before = token.slice(0, index);
      var after = token.slice(index + base.length);
      var beforeMarks = this.splitDiacritics(before);
      var afterMarks = this.splitDiacritics(after);
      if (!beforeMarks || !afterMarks) continue;
      canonical = this.getCanonicalToken(base);
      if (!canonical || !this.phonemes[canonical]) continue;
      var params = deepClone(this.phonemes[canonical]);
      var marks = beforeMarks.concat(afterMarks);
      this.applyDiacritics(params, marks);
      return {
        token: token,
        canonical: canonical,
        params: params,
        diacritics: marks
      };
    }
    return null;
  };

  MappingLoader.prototype.applyDiacritics = function(params, marks) {
    var applied = [];
    (marks || []).forEach(function(mark) {
      var definition = this.diacritics[mark];
      if (!definition || !definition.pink_trombone_patch) return;
      Object.keys(definition.pink_trombone_patch).forEach(function(path) {
        this.applyPatch(params, path, definition.pink_trombone_patch[path]);
      }, this);
      applied.push(mark);
    }, this);
    if (applied.length) {
      params.ipa += applied.join("");
      params.metadata = params.metadata || {};
      params.metadata.applied_diacritics = (params.metadata.applied_diacritics || []).concat(applied);
    }
    syncDerivedFields(params);
    return params;
  };

  MappingLoader.prototype.applyPatch = function(params, path, value) {
    var normalizedPath = normalizedPatchPath(path);
    if (normalizedPath.slice(-7) === ".append") {
      var arrayPath = normalizedPath.slice(0, -7);
      var currentArray = getPath(params, arrayPath) || [];
      if (!Array.isArray(currentArray)) currentArray = [];
      currentArray.push(arrayPath === "tract.constrictions" ? normalizeConstriction(value) : deepClone(value));
      setPath(params, arrayPath, currentArray);
      return;
    }
    var current = getPath(params, normalizedPath);
    setPath(params, normalizedPath, applyRelativeValue(current, value));
    if (normalizedPath === "timing.duration_ms") params.duration_ms = getPath(params, normalizedPath);
    if (normalizedPath === "duration_ms") params.timing.duration_ms = params.duration_ms;
  };

  MappingLoader.prototype.getPhoneme = function(token) {
    var resolved = this.resolveToken(token);
    return resolved ? resolved.params : null;
  };

  MappingLoader.prototype.getAllPhonemes = function() {
    return Object.keys(this.phonemes).sort(function(left, right) {
      return left.localeCompare(right);
    }).map(function(token) {
      return deepClone(this.phonemes[token]);
    }, this);
  };

  MappingLoader.prototype.diffFromBase = function(token, current) {
    var canonical = this.getCanonicalToken(token) || token;
    var base = this.basePhonemes[canonical] || normalizeEntry(canonical, { symbol: canonical }, this.defaults);
    return deepDiff(base, syncDerivedFields(deepClone(current)));
  };

  MappingLoader.prototype.setPhonemeOverride = function(token, current) {
    var canonical = this.getCanonicalToken(token) || token;
    var diff = this.diffFromBase(canonical, current);
    var doc = this.getOverrideDoc();
    if (diff === undefined) delete doc.overrides[canonical];
    else doc.overrides[canonical] = diff;
    doc.updated_at = new Date().toISOString();
    this.setOverrideDoc(doc);
    return doc;
  };

  MappingLoader.prototype.resetOverride = function(token) {
    var canonical = this.getCanonicalToken(token) || token;
    var doc = this.getOverrideDoc();
    delete doc.overrides[canonical];
    doc.updated_at = new Date().toISOString();
    this.setOverrideDoc(doc);
    return doc;
  };

  return {
    MappingLoader: MappingLoader,
    normalizeEntry: normalizeEntry,
    normalizeOverrideDoc: normalizeOverrideDoc,
    normalizeOverridePatch: normalizeOverridePatch,
    normalizeConstriction: normalizeConstriction,
    deepClone: deepClone,
    deepMerge: deepMerge,
    deepDiff: deepDiff,
    sortedByLengthDesc: sortedByLengthDesc
  };
});
