(function(root, factory) {
  var api = factory(root.Phonetics || {}, root);
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns, root) {
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

      function captureFrame(t, options) {
        options = options || {};
        var rest = new Array(44).fill(1.5);
        var target = rest.slice();
        if (options.index !== undefined) target[options.index] = options.diameter === undefined ? 0 : options.diameter;
        return {
          t: t,
          glottis: {
            voiced: Boolean(options.voiced),
            explicit_voice: Boolean(options.explicitVoice),
            source_active: options.sourceActive !== false,
            ui_frequency: 140,
            ui_tenseness: options.voiced ? 0.6 : 0.15,
            intensity: options.voiced ? 0.82 : 0,
            loudness: options.voiced ? 0.9 : 0
          },
          tract: {
            tongue_index: options.tongueIndex === undefined ? 12.9 : options.tongueIndex,
            tongue_diameter: options.tongueDiameter === undefined ? 2.43 : options.tongueDiameter,
            lip_diameter: options.lipDiameter === undefined ? 1.5 : options.lipDiameter,
            velum_target: options.velum === undefined ? 0.01 : options.velum,
            targetDiameter: target,
            restDiameter: rest,
            diameter: target.slice()
          },
          touches: options.active === false ? [] : [{
            alive: true,
            index: options.index === undefined ? 20 : options.index,
            diameter: options.diameter === undefined ? 1.4 : options.diameter,
            fricative_intensity: options.turbulence || 0
          }],
          transients: []
        };
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
        var tap = kit.loader.getAllPhonemes().filter(function(params) { return String(params.label).indexOf("tap/flap") !== -1; })[0];
        assert(tap && ns.classifyPhoneme(tap) === "tap", "tap/flap should not be classified as a stop");
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
        assert(constrictions[0].turbulence_intensity >= 0.7, "captured turbulence should preserve the UI intensity");
      });

      test("capture parameter inventory", function() {
        assert(ns.CAPTURE_PARAMETER_INVENTORY.glottis.indexOf("ui_frequency") !== -1, "frequency should be captured");
        assert(ns.CAPTURE_PARAMETER_INVENTORY.articulation.indexOf("target_diameter[44]") !== -1, "full target tract profile should be captured");
        assert(ns.CAPTURE_PARAMETER_INVENTORY.diagnostics.indexOf("release_transients") !== -1, "release transients should be captured for diagnostics");
      });

      test("stop take segmentation excludes carrier posture", function() {
        var capture = new ns.ParameterCapture({});
        capture.samples = [
          captureFrame(0, { voiced: true, tongueIndex: 16 }),
          captureFrame(20, { voiced: true, tongueIndex: 16 }),
          captureFrame(40, { voiced: true, tongueIndex: 16 }),
          captureFrame(60, { index: 36, diameter: 0 }),
          captureFrame(80, { index: 36, diameter: 0 }),
          captureFrame(100, { index: 36, diameter: 0 }),
          captureFrame(120, { index: 36, diameter: 0 }),
          captureFrame(140, { index: 36, diameter: 0 }),
          captureFrame(160, { voiced: true, tongueIndex: 16 }),
          captureFrame(180, { voiced: true, tongueIndex: 16 })
        ];
        capture.session = { frames: capture.samples, durationMs: 197 };
        var base = kit.loader.getPhoneme("p");
        var analysis = capture.analyze(base, "stop");
        assert(analysis.phases[0].type === "closure", "stop should detect a closure phase");
        var summarized = capture.summarize(base, "stop", { analysis: analysis, phases: analysis.phases });
        assert(summarized.tract.tongue_index === null, "carrier tongue must not leak into a stop override");
        assert(summarized.gesture && summarized.gesture.phases.length === 2, "stop should produce closure and release gesture phases");
        analysis.phases[0].edits = { "tract.constriction.diameter": 0.05, "glottis.intensity": 0.4 };
        var edited = capture.summarize(base, "stop", { analysis: analysis, phases: analysis.phases });
        assert(edited.tract.constrictions[0].diameter === 0.05, "phase constriction edit should update the draft target");
        assert(edited.gesture.phases[0].target.tract.constrictions[0].diameter === 0.05, "phase edit should update gesture playback");
        assert(edited.glottis.intensity === 0.4, "phase voice edit should update the draft source");
      });

      test("nasal and fricative takes use distinct cues", function() {
        var capture = new ns.ParameterCapture({});
        var nasalFrames = [0, 20, 40, 60, 80].map(function(t) {
          return captureFrame(t, { index: 41, diameter: 0, velum: 0.4, voiced: true });
        });
        capture.samples = nasalFrames;
        capture.session = { frames: nasalFrames, durationMs: 97 };
        var nasalAnalysis = capture.analyze(kit.loader.getPhoneme("m"), "nasal");
        assert(nasalAnalysis.phases[0].type === "nasal closure", "nasal should require closure plus open velum");

        var sequentialNasalFrames = [
          captureFrame(0, { index: 41, diameter: 0, velum: 0.01, voiced: true }),
          captureFrame(20, { index: 41, diameter: 0, velum: 0.01, voiced: true }),
          captureFrame(40, { index: 41, diameter: 0, velum: 0.01, voiced: true }),
          captureFrame(60, { index: 20, diameter: 1.4, velum: 0.4, voiced: true }),
          captureFrame(80, { index: 20, diameter: 1.4, velum: 0.4, voiced: true }),
          captureFrame(100, { index: 20, diameter: 1.4, velum: 0.4, voiced: true })
        ];
        capture.samples = sequentialNasalFrames;
        capture.session = { frames: sequentialNasalFrames, durationMs: 117 };
        var sequentialAnalysis = capture.analyze(kit.loader.getPhoneme("m"), "nasal");
        assert(sequentialAnalysis.phases.some(function(item) { return item.type === "velum"; }), "mouse nasal take should accept a separate velum phase");
        var sequentialNasal = capture.summarize(kit.loader.getPhoneme("m"), "nasal", { analysis: sequentialAnalysis, phases: sequentialAnalysis.phases });
        assert(sequentialNasal.tract.velum_target >= 0.39, "separate velum phase should supply the nasal opening");

        var fricativeFrames = [0, 20, 40, 60, 80].map(function(t) {
          return captureFrame(t, { index: 36, diameter: 0.3, turbulence: 0.85 });
        });
        capture.samples = fricativeFrames;
        capture.session = { frames: fricativeFrames, durationMs: 97 };
        var fricativeAnalysis = capture.analyze(kit.loader.getPhoneme("s"), "fricative");
        assert(fricativeAnalysis.phases[0].type === "frication", "fricative should require narrow constriction plus turbulence");
        var summarized = capture.summarize(kit.loader.getPhoneme("s"), "fricative", { analysis: fricativeAnalysis, phases: fricativeAnalysis.phases });
        assert(summarized.noise.turbulence_intensity >= 0.8, "fricative turbulence should come from the selected phase");
      });

      test("affricate take creates closure and frication phases", function() {
        var capture = new ns.ParameterCapture({});
        var frames = [
          captureFrame(0, { index: 36, diameter: 0 }),
          captureFrame(20, { index: 36, diameter: 0 }),
          captureFrame(40, { index: 36, diameter: 0 }),
          captureFrame(60, { index: 31, diameter: 0.3, turbulence: 0.9 }),
          captureFrame(80, { index: 31, diameter: 0.3, turbulence: 0.9 }),
          captureFrame(100, { index: 31, diameter: 0.3, turbulence: 0.9 }),
          captureFrame(120, { index: 31, diameter: 0.3, turbulence: 0.9 })
        ];
        capture.samples = frames;
        capture.session = { frames: frames, durationMs: 137 };
        var affricate = kit.loader.getAllPhonemes().filter(function(params) { return ns.classifyPhoneme(params) === "affricate"; })[0];
        var analysis = capture.analyze(affricate, "affricate");
        assert(analysis.phases.some(function(item) { return item.type === "closure"; }), "affricate should contain closure");
        assert(analysis.phases.some(function(item) { return item.type === "frication"; }), "affricate should contain frication");
      });

      test("controller executes stop release and captured gesture phases", function() {
        var controller = new ns.PinkTromboneController({
          AudioSystem: {},
          UI: { touchesWithMouse: [] },
          Glottis: { UIFrequency: 140, UITenseness: 0.6, intensity: 0, loudness: 1 },
          Tract: { n: 44, targetDiameter: new Array(44).fill(1.5), velumTarget: 0.01 },
          TractUI: { tongueIndex: 12.9, tongueDiameter: 2.43 }
        });
        var stop = kit.loader.getPhoneme("p");
        var release = controller.paramsForEventStage({ params: stop }, 80);
        assert(release.key === "release", "plain stop should enter a release stage after closure");
        var gestured = ns.deepClone(stop);
        gestured.gesture = {
          duration_ms: 100,
          phases: [
            { id: "closure", type: "closure", start_ms: 0, end_ms: 50, target: { tract: { constrictions: stop.tract.constrictions } } },
            { id: "release", type: "release", start_ms: 50, end_ms: 100, target: { tract: { constrictions: [] }, release: { transient: true } } }
          ]
        };
        var gestureRelease = controller.paramsForEventStage({ params: gestured }, 75);
        assert(gestureRelease.key === "gesture-release", "captured gesture phase should drive playback");
        assert(gestureRelease.params.tract.constrictions.length === 0, "release gesture should open the tract");
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
