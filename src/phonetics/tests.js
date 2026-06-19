(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function loadBaseMapping() {
    if (typeof window !== "undefined" && typeof fetch === "function") {
      return fetch("data/ipa_to_pink_trombone_full.json").then(function(response) {
        if (!response.ok) throw new Error("Could not load base mapping.");
        return response.json();
      });
    }
    var fs = require("fs");
    return Promise.resolve(JSON.parse(fs.readFileSync("data/ipa_to_pink_trombone_full.json", "utf8")));
  }

  function createScheduler(baseMapping, overrides) {
    var loader = new ns.MappingLoader();
    loader.setBaseMapping(baseMapping);
    loader.setOverrideDoc(overrides || { version: 1, overrides: {} });
    var tokenizer = new ns.IPATokenizer({
      tokens: loader.getTokenList(),
      diacritics: loader.getDiacriticList()
    });
    return {
      loader: loader,
      tokenizer: tokenizer,
      scheduler: new ns.PhonemeScheduler(loader, tokenizer)
    };
  }

  function runPhoneticsTests() {
    return loadBaseMapping().then(function(baseMapping) {
      var kit = createScheduler(baseMapping, {
        version: 1,
        overrides: {
          a: {
            duration_ms: 220,
            tract: {
              tongue_diameter: 3.2
            }
          }
        }
      });

      var tests = [];
      function test(name, fn) {
        tests.push({ name: name, fn: fn });
      }

      test("base + override merge", function() {
        var a = kit.loader.getPhoneme("a");
        assert(a.duration_ms === 220, "duration override was not applied");
        assert(a.tract.tongue_diameter === 3.2, "nested tract override was not applied");
      });

      test("single-character tokenization without spaces", function() {
        var result = kit.scheduler.createEvents("mama");
        assert(result.events.map(function(event) { return event.token; }).join(" ") === "m a m a", "mama did not split into four phonemes");
      });

      test("longest-match affricate tokenization", function() {
        var result = kit.scheduler.createEvents("t͡ʃa");
        assert(result.events[0].canonical === "t͡ʃ", "tie-bar affricate was not matched greedily");
      });

      test("tie-less affricate alias tokenization", function() {
        var result = kit.scheduler.createEvents("dʒu");
        assert(result.events[0].canonical === "d͡ʒ", "tie-less affricate did not resolve to tied affricate mapping");
      });

      test("diacritic patch handling", function() {
        var nasalized = kit.loader.getPhoneme("ã");
        assert(nasalized.tract.velum_target === 0.25, "nasalization diacritic did not open the velum");
      });

      test("unknown token reporting", function() {
        var result = kit.scheduler.createEvents("a?");
        assert(result.events.length === 1, "known token should still schedule");
        assert(result.warnings.length === 1, "unknown token should produce one warning");
      });

      test("phoneme event scheduling", function() {
        var result = kit.scheduler.createEvents("m a");
        assert(result.events.length === 2, "expected two scheduled events");
        assert(result.events[0].start === 0, "first event should start at zero");
        assert(result.events[1].start > result.events[0].start, "second event should start after the first");
        assert(result.events[0].params && result.events[0].params.glottis, "scheduled event should include normalized params");
      });

      test("phoneme type classification", function() {
        assert(ns.classifyPhoneme(kit.loader.getPhoneme("a")) === "vowel", "a should classify as vowel");
        assert(ns.classifyPhoneme(kit.loader.getPhoneme("m")) === "nasal", "m should classify as nasal");
        assert(ns.classifyPhoneme(kit.loader.getPhoneme("s")) === "fricative", "s should classify as fricative");
        assert(ns.classifyPhoneme(kit.loader.getPhoneme("t͡ʃ")) === "affricate", "t͡ʃ should classify as affricate");
      });

      test("calibration section patches", function() {
        var source = kit.loader.getPhoneme("a");
        source.tract.tongue_index = 19;
        var patch = ns.calibrationSectionPatch(source, "tongue");
        assert(patch.tract.tongue_index === 19, "tongue section patch should include tongue index");
        assert(patch.glottis === undefined, "tongue section patch should not include glottis");
      });

      test("captured constriction detection", function() {
        var capture = new ns.ParameterCapture({});
        var target = new Array(44).fill(1.5);
        var rest = new Array(44).fill(1.5);
        target[35] = 0.5;
        target[36] = 0.12;
        target[37] = 0.4;
        var constrictions = capture.detectConstrictions([{
          tract: { targetDiameter: target, restDiameter: rest },
          touches: [{ fricative_intensity: 0.7 }]
        }], { turbulence: true, limit: 1 });
        assert(constrictions.length === 1, "expected one detected constriction");
        assert(constrictions[0].index === 36, "expected constriction around index 36");
        assert(constrictions[0].turbulence_intensity >= 0.8, "turbulence capture should be marked");
      });

      var results = tests.map(function(item) {
        try {
          item.fn();
          return { name: item.name, ok: true };
        } catch (error) {
          return { name: item.name, ok: false, error: error.message };
        }
      });
      return results;
    });
  }

  if (typeof window !== "undefined") {
    root.runPhoneticsTests = runPhoneticsTests;
  }

  return {
    runPhoneticsTests: runPhoneticsTests
  };
});
