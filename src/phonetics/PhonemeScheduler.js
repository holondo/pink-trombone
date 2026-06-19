(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function PhonemeScheduler(mappingLoader, tokenizer) {
    this.mappingLoader = mappingLoader;
    this.tokenizer = tokenizer;
  }

  function isVowel(params) {
    return params && params.category && String(params.category).indexOf("vowel") !== -1;
  }

  function hasClosure(params) {
    var constrictions = (params && params.tract && params.tract.constrictions) || [];
    return constrictions.some(function(constriction) {
      return Number(constriction.diameter) <= 0.05;
    });
  }

  function blendNumber(left, right, amount) {
    if (left === null || left === undefined) return right;
    if (right === null || right === undefined) return left;
    return left * (1 - amount) + right * amount;
  }

  function neighboringVowel(events, index, direction) {
    for (var i = index + direction; i >= 0 && i < events.length; i += direction) {
      if (isVowel(events[i].params)) return events[i].params;
      if (hasClosure(events[i].params)) break;
    }
    return null;
  }

  function coarticulate(events) {
    events.forEach(function(event, index) {
      var params = event.params;
      if (!params || isVowel(params)) return;
      var previous = neighboringVowel(events, index, -1);
      var next = neighboringVowel(events, index, 1);
      var vowel = previous && next ? {
        tract: {
          tongue_index: blendNumber(previous.tract.tongue_index, next.tract.tongue_index, 0.5),
          tongue_diameter: blendNumber(previous.tract.tongue_diameter, next.tract.tongue_diameter, 0.5),
          lip_diameter: blendNumber(previous.tract.lip_diameter, next.tract.lip_diameter, 0.5)
        }
      } : previous || next;
      if (!vowel || !vowel.tract) return;
      if (params.tract.tongue_index === null || params.tract.tongue_index === undefined) {
        params.tract.tongue_index = vowel.tract.tongue_index;
      } else if (!hasClosure(params)) {
        params.tract.tongue_index = blendNumber(params.tract.tongue_index, vowel.tract.tongue_index, 0.18);
      }
      if (params.tract.tongue_diameter === null || params.tract.tongue_diameter === undefined) {
        params.tract.tongue_diameter = vowel.tract.tongue_diameter;
      } else if (!hasClosure(params)) {
        params.tract.tongue_diameter = blendNumber(params.tract.tongue_diameter, vowel.tract.tongue_diameter, 0.18);
      }
      if (params.tract.lip_diameter === null || params.tract.lip_diameter === undefined) {
        params.tract.lip_diameter = vowel.tract.lip_diameter;
      } else if (!hasClosure(params)) {
        params.tract.lip_diameter = blendNumber(params.tract.lip_diameter, vowel.tract.lip_diameter, 0.15);
      }
    });
    return events;
  }

  PhonemeScheduler.prototype.createEvents = function(input, options) {
    options = options || {};
    var durationMultiplier = Number(options.durationMultiplier || 1);
    var tokenized = this.tokenizer.tokenize(input);
    var warnings = tokenized.warnings.slice();
    var events = [];
    var currentStart = 0;

    tokenized.tokens.forEach(function(tokenInfo) {
      var resolved = this.mappingLoader.resolveToken(tokenInfo.raw);
      if (!resolved) {
        warnings.push({
          token: tokenInfo.raw,
          index: tokenInfo.index,
          message: "No Pink Trombone mapping for " + tokenInfo.raw
        });
        return;
      }
      var params = ns.deepClone ? ns.deepClone(resolved.params) : JSON.parse(JSON.stringify(resolved.params));
      var duration = Math.max(30, Number(params.duration_ms || 140) * durationMultiplier) / 1000;
      events.push({
        token: tokenInfo.raw,
        base: tokenInfo.base,
        canonical: resolved.canonical,
        start: currentStart,
        duration: duration,
        params: params,
        diacritics: resolved.diacritics
      });
      currentStart += duration;
    }, this);

    coarticulate(events);
    return {
      events: events,
      warnings: warnings,
      totalDuration: currentStart
    };
  };

  return {
    PhonemeScheduler: PhonemeScheduler,
    coarticulateEvents: coarticulate
  };
});
