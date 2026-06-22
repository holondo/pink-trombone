(function(root, factory) {
  var api = factory(root.Phonetics || {}, root);
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns, root) {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return ns.deepClone ? ns.deepClone(value) : JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function deepEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function setPath(object, path, value) {
    var parts = String(path).split(".");
    var current = object;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  function readValue(control) {
    if (control.type === "checkbox") return control.checked;
    if (control.dataset.valueType === "number" || control.type === "number" || control.type === "range") {
      if (control.value === "" && control.dataset.nullable === "true") return null;
      var number = Number(control.value);
      return Number.isFinite(number) ? number : null;
    }
    return control.value;
  }

  function field(label, path, value, options) {
    options = options || {};
    var type = options.type || "number";
    if (type === "checkbox") {
      return '<label class="pt-field pt-checkbox"><input type="checkbox" data-path="' + path + '"' + (value ? " checked" : "") + "> " + escapeHtml(label) + "</label>";
    }
    if (type === "select") {
      return '<label class="pt-field"><span>' + escapeHtml(label) + '</span><select data-path="' + path + '">' +
        options.options.map(function(option) {
          return '<option value="' + escapeHtml(option) + '"' + (option === value ? " selected" : "") + ">" + escapeHtml(option) + "</option>";
        }).join("") + "</select></label>";
    }
    if (type === "text") {
      return '<label class="pt-field"><span>' + escapeHtml(label) + '</span><input type="text" data-path="' + path + '" value="' + escapeHtml(value || "") + '"></label>';
    }
    var min = options.min === undefined ? "" : ' min="' + options.min + '"';
    var max = options.max === undefined ? "" : ' max="' + options.max + '"';
    var step = options.step === undefined ? ' step="0.01"' : ' step="' + options.step + '"';
    var nullable = options.nullable ? ' data-nullable="true"' : "";
    var range = options.range ? '<input type="range" data-range-for="' + path + '"' + min + max + step + ' value="' + escapeHtml(value === null || value === undefined ? 0 : value) + '">' : "";
    return '<label class="pt-field"><span>' + escapeHtml(label) + '</span><input type="number" data-path="' + path + '" data-value-type="number"' +
      nullable + min + max + step + ' value="' + escapeHtml(value === null || value === undefined ? "" : value) + '">' + range + "</label>";
  }

  function shortJson(value) {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function stripTieBars(token) {
    return String(token || "").replace(/[\u0361\u035c]/g, "");
  }

  function sortedTokensFromAliases(aliases) {
    var tokens = Object.keys(aliases || {});
    return ns.sortedByLengthDesc ? ns.sortedByLengthDesc(tokens) : tokens.sort(function(left, right) {
      return right.length - left.length || left.localeCompare(right);
    });
  }

  function PhoneticsRuntime(synth) {
    this.synth = synth;
    this.tools = { playback: false, keyboard: false, calibrator: false };
    this.activeConfigSet = "local";
    this.elements = {};
    this.mappingLoader = null;
    this.configStore = null;
    this.tokenizer = null;
    this.scheduler = null;
    this.controller = null;
    this.capture = null;
    this.overlay = null;
    this.keyboard = null;
    this.currentToken = "";
    this.baseParams = null;
    this.activeParams = null;
    this.draftParams = null;
    this.captureDraftParams = null;
    this.captureTimer = 0;
    this.captureSession = null;
    this.captureAnalysis = null;
    this.captureSelection = null;
    this.selectedCapturePhaseId = "";
    this.captureTimeline = null;
    this.captureState = "idle";
  }

  PhoneticsRuntime.prototype.init = function() {
    this.mount = byId("phoneticsPanel");
    this.mount.className = "pt-studio-shell";
    this.mount.setAttribute("aria-label", "Pink Trombone IPA studio");
    this.mount.innerHTML = this.renderShell();
    this.collectElements();
    this.mappingLoader = new ns.MappingLoader();
    this.configStore = new ns.ConfigStore();
    this.controller = new ns.PinkTromboneController(this.synth);
    this.capture = new ns.ParameterCapture(this.synth);
    this.captureTimeline = new ns.CaptureTimeline(this.elements.captureTimeline, {
      onPhaseSelect: this.selectCapturePhase.bind(this),
      onPhaseChange: this.changeCapturePhase.bind(this),
      onSelectionChange: this.changeCaptureSelection.bind(this),
      onScrub: this.scrubCapture.bind(this)
    });
    this.overlay = new ns.TractOverlayRenderer(this.synth);
    this.keyboard = new ns.PhonemeKeyboard(this.elements.keyboard, {
      onAction: this.handleKeyboardAction.bind(this)
    });
    this.bind();
    this.elements.input.value = "mama\npata\nsasa\nt\u0361\u0283a\nd\u0361\u0292u";
    this.setStatus("Loading IPA mapping...");
    this.setTool("playback", false);
    this.setTool("keyboard", false);
    this.setTool("calibrator", false);
    return this.loadMapping();
  };

  PhoneticsRuntime.prototype.renderShell = function() {
    return '' +
      '<div class="pt-studio-toolbar">' +
        '<div class="pt-brand"><strong>IPA Studio</strong><span id="phoneticsStatus">Loading IPA mapping...</span></div>' +
        '<label class="pt-config-select"><span>Config Set</span><select id="configSetSelect">' +
          '<option value="local">Saved overrides</option>' +
          '<option value="base">Base mapping</option>' +
        '</select></label>' +
        '<div class="pt-tool-tabs" aria-label="Studio tools">' +
          '<button type="button" data-tool-toggle="playback">Playback</button>' +
          '<button type="button" data-tool-toggle="keyboard">Keyboard</button>' +
          '<button type="button" data-tool-toggle="calibrator">Calibrate</button>' +
          '<button type="button" id="hideStudioTools">Hide</button>' +
        '</div>' +
      '</div>' +

      '<section id="phoneticPlaybackPanel" class="pt-floating-panel pt-playback-panel" hidden>' +
        '<header><div><strong>Playback</strong><span>Uses the active config set and unsaved draft for the loaded phoneme.</span></div><button type="button" data-close-tool="playback">Close</button></header>' +
        '<textarea id="ipaInput" rows="5" spellcheck="false"></textarea>' +
        '<div class="pt-transport">' +
          '<button type="button" id="playPhonetics">Play</button>' +
          '<button type="button" id="stopPhonetics">Stop</button>' +
          '<label class="pt-inline-check"><input type="checkbox" id="loopPhonetics"> Loop</label>' +
          '<button type="button" id="openKeyboardFromPlayback">Keyboard</button>' +
        '</div>' +
        '<div class="pt-control-strip">' +
          '<label><span>Duration</span><select id="durationMultiplier">' +
            '<option value="1">0.5x quick</option>' +
            '<option value="2" selected>1x natural</option>' +
            '<option value="3">1.5x slow</option>' +
            '<option value="4">2x slower</option>' +
            '<option value="6">3x very slow</option>' +
            '<option value="8">4x study</option>' +
          '</select><output id="durationMultiplierValue">1x natural</output></label>' +
          '<label><span>Pitch</span><input type="range" id="pitchControl" min="80" max="240" step="1" value="140"><output id="pitchControlValue">140 Hz</output></label>' +
          '<label><span>Intensity</span><input type="range" id="intensityControl" min="0.2" max="1.4" step="0.05" value="1"><output id="intensityControlValue">1.00x</output></label>' +
          '<label class="pt-inline-check"><input type="checkbox" id="autoVoice" checked> Auto voice</label>' +
        '</div>' +
        '<div class="pt-readout"><span>Current</span><strong id="currentPhoneme">Stopped</strong></div>' +
        '<details class="pt-collapsible" open><summary>Warnings</summary><div id="ipaWarnings" class="pt-warning-panel"><p class="pt-muted">No warnings.</p></div></details>' +
        '<details class="pt-collapsible"><summary>Timeline</summary><div id="phonemeTimeline" class="pt-timeline"><p class="pt-muted">No events scheduled.</p></div></details>' +
      '</section>' +

      '<section id="keyboardLayer" class="pt-floating-panel pt-keyboard-panel" hidden>' +
        '<header><div><strong>Phoneme Keyboard</strong><span>Preview consonants with an auxiliary vowel, then insert or load them.</span></div><button type="button" data-close-tool="keyboard">Close</button></header>' +
        '<div id="phonemeKeyboard"></div>' +
      '</section>' +

      '<section id="calibratorPanel" class="pt-floating-panel pt-calibrate-panel" hidden>' +
        '<header><div><strong id="selectedPhonemeLabel">No phoneme selected</strong><span id="phonemeTemplateBadge">Draft</span></div><button type="button" data-close-tool="calibrator">Close</button></header>' +
        '<div class="pt-calibrate-layout">' +
          '<section class="pt-card pt-draft-card">' +
            '<div id="templateSummary" class="pt-note"></div>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="previewDraft">Preview draft</button>' +
              '<button type="button" id="compareBase">Compare base</button>' +
              '<button type="button" id="openKeyboardFromCalibrate">Load phoneme</button>' +
              '<button type="button" id="revertDraft">Revert draft</button>' +
              '<button type="button" id="saveDraftOverride">Save draft</button>' +
            '</div>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="removeSavedOverride">Remove saved override</button>' +
              '<button type="button" id="resetAllOverrides">Reset all saved</button>' +
            '</div>' +
            '<p id="configStatus" class="pt-status"></p>' +
          '</section>' +
          '<section class="pt-card pt-recorder-card">' +
            '<div class="pt-recorder-heading"><div><h2>Take recorder</h2><span>Pink Trombone UI parameters — no audio recording</span></div><strong id="captureStateBadge" data-state="idle">Idle</strong></div>' +
            '<div id="captureGuide" class="pt-note"></div>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="startCapture">Record take</button>' +
              '<button type="button" id="stopCapture" disabled>Stop recording</button>' +
              '<button type="button" id="captureCurrent">Take snapshot</button>' +
            '</div>' +
            '<div id="captureStats" class="pt-capture-stats"><span><small>Frames</small><strong>0</strong></span><span><small>Duration</small><strong>0 ms</strong></span><span><small>Phases</small><strong>0</strong></span></div>' +
            '<div class="pt-take-toolbar">' +
              '<button type="button" id="autoSegmentCapture" disabled>Auto-segment</button>' +
              '<button type="button" id="previewCapture" disabled>Preview selection</button>' +
              '<label class="pt-inline-check"><input type="checkbox" id="loopCapture"> Loop</label>' +
            '</div>' +
            '<div class="pt-capture-timeline-wrap">' +
              '<canvas id="captureTimeline" class="pt-capture-timeline" aria-label="Captured Pink Trombone parameter timeline"></canvas>' +
              '<div class="pt-timeline-legend"><span><i class="is-selection"></i>Selected</span><span><i class="is-playhead"></i>Playhead</span><span>Tracks show the immutable raw take</span><span>Drag phase edges to tune timing</span></div>' +
            '</div>' +
            '<div id="capturePhaseInspector" class="pt-phase-inspector"><p class="pt-muted">Record a take to inspect and edit its phases.</p></div>' +
            '<div><h3>Parameters to update</h3><div id="sectionApplyPanel" class="pt-chip-row"></div></div>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="applyCaptureAll" disabled>Build draft from take</button>' +
              '<button type="button" id="discardCapture" disabled>Delete take</button>' +
            '</div>' +
            '<div id="capturedSummary" class="pt-diff-panel"><p class="pt-muted">No capture draft yet.</p></div>' +
          '</section>' +
          '<section class="pt-card pt-editor-card">' +
            '<h2>Draft parameters</h2>' +
            '<div id="calibrationEditor" class="pt-config-editor"></div>' +
          '</section>' +
          '<section class="pt-card pt-diff-card">' +
            '<h2>Draft changes</h2>' +
            '<div id="parameterDiff" class="pt-diff-panel"></div>' +
          '</section>' +
          '<section class="pt-card pt-library-card">' +
            '<div class="pt-browser-toolbar"><h2>Saved custom phonemes</h2><span id="mappingBrowserCount"></span></div>' +
            '<div id="mappingBrowserList" class="pt-mapping-list"></div>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="exportOverrides">Export override JSON</button>' +
              '<button type="button" id="importOverrides">Import override JSON</button>' +
              '<button type="button" id="directSaveOverrides" hidden>Save to file</button>' +
              '<input id="overrideImportFile" type="file" accept="application/json,.json" hidden>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</section>';
  };

  PhoneticsRuntime.prototype.collectElements = function() {
    this.elements = {
      root: this.mount,
      toolbar: this.mount.querySelector(".pt-studio-toolbar"),
      status: byId("phoneticsStatus"),
      configSet: byId("configSetSelect"),
      playback: byId("phoneticPlaybackPanel"),
      keyboardLayer: byId("keyboardLayer"),
      calibrator: byId("calibratorPanel"),
      keyboard: byId("phonemeKeyboard"),
      input: byId("ipaInput"),
      play: byId("playPhonetics"),
      stop: byId("stopPhonetics"),
      loop: byId("loopPhonetics"),
      duration: byId("durationMultiplier"),
      durationValue: byId("durationMultiplierValue"),
      pitch: byId("pitchControl"),
      pitchValue: byId("pitchControlValue"),
      intensity: byId("intensityControl"),
      intensityValue: byId("intensityControlValue"),
      autoVoice: byId("autoVoice"),
      warnings: byId("ipaWarnings"),
      current: byId("currentPhoneme"),
      timeline: byId("phonemeTimeline"),
      selectedLabel: byId("selectedPhonemeLabel"),
      templateBadge: byId("phonemeTemplateBadge"),
      templateSummary: byId("templateSummary"),
      editor: byId("calibrationEditor"),
      diff: byId("parameterDiff"),
      sectionApply: byId("sectionApplyPanel"),
      configStatus: byId("configStatus"),
      captureStateBadge: byId("captureStateBadge"),
      captureGuide: byId("captureGuide"),
      captureStats: byId("captureStats"),
      captureTimeline: byId("captureTimeline"),
      capturePhaseInspector: byId("capturePhaseInspector"),
      capturedSummary: byId("capturedSummary"),
      browserList: byId("mappingBrowserList"),
      browserCount: byId("mappingBrowserCount"),
      export: byId("exportOverrides"),
      directSave: byId("directSaveOverrides"),
      importButton: byId("importOverrides"),
      importFile: byId("overrideImportFile")
    };
  };

  PhoneticsRuntime.prototype.bind = function() {
    var self = this;
    this.mount.addEventListener("mousedown", function(event) { event.stopPropagation(); });
    this.mount.addEventListener("touchstart", function(event) { event.stopPropagation(); });
    this.mount.addEventListener("click", function(event) {
      var toggle = event.target.closest && event.target.closest("[data-tool-toggle]");
      if (toggle) {
        self.toggleTool(toggle.dataset.toolToggle);
        return;
      }
      var close = event.target.closest && event.target.closest("[data-close-tool]");
      if (close) {
        self.setTool(close.dataset.closeTool, false);
      }
    });
    byId("hideStudioTools").addEventListener("click", function() {
      self.setTool("playback", false);
      self.setTool("keyboard", false);
      self.setTool("calibrator", false);
    });
    byId("openKeyboardFromPlayback").addEventListener("click", function() { self.setTool("keyboard", true); });
    byId("openKeyboardFromCalibrate").addEventListener("click", function() { self.setTool("keyboard", true); });
    this.elements.configSet.addEventListener("change", function() { self.setActiveConfigSet(self.elements.configSet.value); });
    this.elements.play.addEventListener("click", function() { self.playInput(); });
    this.elements.stop.addEventListener("click", function() { self.controller.stop(); });
    [this.elements.duration, this.elements.pitch, this.elements.intensity].forEach(function(control) {
      control.addEventListener("input", function() { self.updateControlLabels(); });
      control.addEventListener("change", function() { self.updateControlLabels(); });
    });
    this.elements.editor.addEventListener("input", function(event) {
      self.syncRangePair(event.target);
      self.draftParams = self.readEditor();
      self.renderDraftHeader();
      self.renderDiff();
      self.refreshKeyboard();
      self.updateOverlay();
    });
    this.elements.editor.addEventListener("click", function(event) {
      if (event.target.id === "addConstriction") self.addConstriction();
      if (event.target.dataset.removeConstriction !== undefined) self.removeConstriction(Number(event.target.dataset.removeConstriction));
    });
    byId("previewDraft").addEventListener("click", function() { self.playParams(self.readEditor()); });
    byId("compareBase").addEventListener("click", function() { self.playParams(self.baseParams); });
    byId("revertDraft").addEventListener("click", function() { self.loadDraftFromActive("Draft reverted to the active config set."); });
    byId("saveDraftOverride").addEventListener("click", function() { self.saveDraftOverride(); });
    byId("removeSavedOverride").addEventListener("click", function() { self.removeSavedOverride(); });
    byId("resetAllOverrides").addEventListener("click", function() { self.resetAllOverrides(); });
    byId("startCapture").addEventListener("click", function() { self.startCapture(); });
    byId("stopCapture").addEventListener("click", function() { self.stopCapture(); });
    byId("captureCurrent").addEventListener("click", function() { self.captureCurrent(); });
    byId("autoSegmentCapture").addEventListener("click", function() { self.autoSegmentCapture(); });
    byId("previewCapture").addEventListener("click", function() { self.previewCapture(); });
    byId("applyCaptureAll").addEventListener("click", function() { self.applyCapture("all"); });
    byId("discardCapture").addEventListener("click", function() { self.discardCapture(); });
    this.elements.capturePhaseInspector.addEventListener("change", function(event) {
      if (event.target.dataset.phaseField) self.editCapturePhase(event.target.dataset.phaseField, event.target);
    });
    this.elements.capturePhaseInspector.addEventListener("input", function(event) {
      if (event.target.dataset.phaseParam) self.editCapturePhaseParameter(event.target.dataset.phaseParam, event.target);
    });
    this.elements.browserList.addEventListener("click", function(event) {
      var button = event.target.closest && event.target.closest("[data-token][data-action]");
      if (!button) return;
      var token = button.dataset.token;
      if (button.dataset.action === "preview") self.playParams(self.getPhonemeForConfig(token, "local"));
      if (button.dataset.action === "load") {
        self.selectToken(token);
        self.setTool("calibrator", true);
      }
    });
    this.elements.export.addEventListener("click", function() { self.configStore.exportFile(self.mappingLoader.getOverrideDoc(), "ipa_user_overrides.json"); });
    this.elements.importButton.addEventListener("click", function() { self.elements.importFile.click(); });
    this.elements.importFile.addEventListener("change", function() {
      if (self.elements.importFile.files.length) self.importOverrideFile(self.elements.importFile.files[0]);
    });
    if (this.configStore.canSaveDirectly()) {
      this.elements.directSave.hidden = false;
      this.elements.directSave.addEventListener("click", function() {
        self.configStore.saveDirectly(self.mappingLoader.getOverrideDoc()).then(function() {
          self.setConfigStatus("Override JSON saved to selected file.");
        });
      });
    }
    this.controller.onUpdate = function(state) {
      self.updateCurrentPhoneme(state);
      self.overlay.setActiveLabel(state.event ? state.event.token + " / " + state.stage : "");
    };
    this.controller.onCaptureUpdate = function(state) {
      if (self.captureTimeline) self.captureTimeline.setPlayhead(state.timeMs || 0);
      if (state.done) self.setCaptureState("review", "Take preview finished.");
    };
    this.updateControlLabels();
  };

  PhoneticsRuntime.prototype.loadMapping = function() {
    var self = this;
    return this.mappingLoader.load().then(function() {
      self.rebuildActiveScheduler();
      var all = self.getAllPhonemesForConfig(self.activeConfigSet);
      if (all.length) self.selectToken(all[0].ipa);
      self.refreshKeyboard();
      self.renderSavedCustomList();
      self.setStatus("Loaded " + self.mappingLoader.getAllPhonemes().length + " phonemes.");
      self.renderWarnings(self.mappingLoader.warnings || []);
    }).catch(function(error) {
      self.setStatus("Mapping load failed: " + error.message);
      self.renderWarnings([{ message: error.message, token: "mapping" }]);
    });
  };

  PhoneticsRuntime.prototype.setStatus = function(message) {
    this.elements.status.textContent = message || "";
  };

  PhoneticsRuntime.prototype.setConfigStatus = function(message) {
    this.elements.configStatus.textContent = message || "";
  };

  PhoneticsRuntime.prototype.toggleTool = function(tool) {
    this.setTool(tool, !this.tools[tool]);
  };

  PhoneticsRuntime.prototype.setTool = function(tool, open) {
    if (!this.tools.hasOwnProperty(tool)) return;
    if (!open && tool === "calibrator" && this.capture && this.capture.recording) this.stopCapture();
    if (open && tool === "keyboard") {
      if (this.capture && this.capture.recording) this.stopCapture();
      this.tools.calibrator = false;
      this.elements.calibrator.hidden = true;
    }
    if (open && tool === "calibrator") {
      this.tools.keyboard = false;
      this.elements.keyboardLayer.hidden = true;
    }
    this.tools[tool] = Boolean(open);
    if (tool === "playback") this.elements.playback.hidden = !open;
    if (tool === "keyboard") this.elements.keyboardLayer.hidden = !open;
    if (tool === "calibrator") this.elements.calibrator.hidden = !open;
    this.mount.querySelectorAll("[data-tool-toggle]").forEach(function(button) {
      button.setAttribute("aria-pressed", button.dataset.toolToggle === tool ? String(Boolean(open)) : String(this.tools[button.dataset.toolToggle]));
    }, this);
    this.overlay.visible = this.tools.calibrator;
    this.updateOverlay();
  };

  PhoneticsRuntime.prototype.isManualMode = function() {
    return !this.tools.playback && !this.tools.keyboard && !this.tools.calibrator;
  };

  PhoneticsRuntime.prototype.setActiveConfigSet = function(configSet) {
    this.activeConfigSet = configSet === "base" ? "base" : "local";
    this.elements.configSet.value = this.activeConfigSet;
    this.rebuildActiveScheduler();
    this.refreshKeyboard();
    if (this.currentToken) this.loadDraftFromActive("Draft loaded from " + this.configSetLabel() + ".");
  };

  PhoneticsRuntime.prototype.configSetLabel = function() {
    return this.activeConfigSet === "base" ? "Base mapping" : "Saved overrides";
  };

  PhoneticsRuntime.prototype.rebuildActiveScheduler = function() {
    this.tokenizer = new ns.IPATokenizer({
      tokens: this.getTokenListForConfig(this.activeConfigSet),
      diacritics: this.mappingLoader.getDiacriticList()
    });
    this.scheduler = new ns.PhonemeScheduler(this.createMappingAdapter(this.activeConfigSet), this.tokenizer);
  };

  PhoneticsRuntime.prototype.createMappingAdapter = function(configSet) {
    var self = this;
    return {
      resolveToken: function(token) {
        return self.resolveTokenForConfig(token, configSet);
      }
    };
  };

  PhoneticsRuntime.prototype.getTokenListForConfig = function(configSet) {
    return configSet === "base" ? sortedTokensFromAliases(this.mappingLoader.baseAliases) : this.mappingLoader.getTokenList();
  };

  PhoneticsRuntime.prototype.resolveTokenForConfig = function(token, configSet) {
    var resolved = this.mappingLoader.resolveToken(token);
    if (!resolved) return null;
    if (this.draftParams && resolved.canonical === this.currentToken) {
      return {
        token: token,
        canonical: resolved.canonical,
        params: clone(this.draftParams),
        diacritics: resolved.diacritics || []
      };
    }
    if (configSet !== "base") return resolved;
    var base = this.mappingLoader.basePhonemes[resolved.canonical];
    if (!base) return null;
    var params = clone(base);
    if (resolved.diacritics && resolved.diacritics.length) this.mappingLoader.applyDiacritics(params, resolved.diacritics);
    return {
      token: token,
      canonical: resolved.canonical,
      params: params,
      diacritics: resolved.diacritics || []
    };
  };

  PhoneticsRuntime.prototype.getBaseParams = function(token) {
    var canonical = this.mappingLoader.getCanonicalToken(token) || stripTieBars(token) || token;
    return clone(this.mappingLoader.basePhonemes[canonical] || this.mappingLoader.getPhoneme(canonical));
  };

  PhoneticsRuntime.prototype.getPhonemeForConfig = function(token, configSet) {
    if (configSet === "base") return this.getBaseParams(token);
    return this.mappingLoader.getPhoneme(token);
  };

  PhoneticsRuntime.prototype.getAllPhonemesForConfig = function(configSet) {
    var source = configSet === "base" ? this.mappingLoader.basePhonemes : this.mappingLoader.phonemes;
    return Object.keys(source || {}).sort(function(left, right) {
      return left.localeCompare(right);
    }).map(function(token) {
      return clone(source[token]);
    });
  };

  PhoneticsRuntime.prototype.isOverridden = function(token) {
    var canonical = this.mappingLoader.getCanonicalToken(token) || stripTieBars(token) || token;
    var overrides = (this.mappingLoader.getOverrideDoc().overrides || {});
    return Boolean(overrides[canonical]);
  };

  PhoneticsRuntime.prototype.hasDraftChanges = function() {
    return Boolean(this.draftParams && this.activeParams && !deepEqual(this.draftParams, this.activeParams));
  };

  PhoneticsRuntime.prototype.keyboardData = function() {
    var overrides = this.mappingLoader.getOverrideDoc().overrides || {};
    return this.getAllPhonemesForConfig(this.activeConfigSet).map(function(params) {
      var canonical = this.mappingLoader.getCanonicalToken(params.ipa) || params.ipa;
      var template = ns.getCalibrationTemplate ? ns.getCalibrationTemplate(params).type : params.category;
      params.templateType = template;
      if (canonical === this.currentToken && this.hasDraftChanges()) params.status = "draft";
      else params.status = this.activeConfigSet === "base" ? "base" : (overrides[canonical] ? "saved" : "base");
      return params;
    }, this);
  };

  PhoneticsRuntime.prototype.refreshKeyboard = function() {
    if (!this.keyboard || !this.mappingLoader) return;
    this.keyboard.setPhonemes(this.keyboardData());
    this.keyboard.setSelectedToken(this.currentToken);
  };

  PhoneticsRuntime.prototype.handleKeyboardAction = function(payload) {
    if (payload.action === "preview") this.playPreviewText(payload.previewText);
    if (payload.action === "insert") {
      this.insertToken(payload.token);
      this.setTool("playback", true);
    }
    if (payload.action === "load") {
      this.selectToken(payload.token);
      this.setTool("keyboard", false);
      this.setTool("calibrator", true);
    }
  };

  PhoneticsRuntime.prototype.playPreviewText = function(text) {
    if (!this.scheduler) return;
    var result = this.scheduler.createEvents(text, { durationMultiplier: Number(this.elements.duration.value || 2) });
    this.renderWarnings(result.warnings);
    this.renderTimeline(result.events);
    if (result.events.length) this.controller.play(result.events, { autoVoice: true });
  };

  PhoneticsRuntime.prototype.insertToken = function(token) {
    var input = this.elements.input;
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || start;
    var before = input.value.slice(0, start);
    var after = input.value.slice(end);
    var prefix = before && !/\s$/.test(before) ? " " : "";
    var suffix = after && !/^\s/.test(after) ? " " : "";
    var insert = prefix + token + suffix;
    input.value = before + insert + after;
    input.focus();
    var cursor = before.length + insert.length;
    if (input.setSelectionRange) input.setSelectionRange(cursor, cursor);
  };

  PhoneticsRuntime.prototype.selectToken = function(token) {
    if (!token) return;
    this.currentToken = this.mappingLoader.getCanonicalToken(token) || token;
    this.baseParams = this.getBaseParams(this.currentToken);
    this.activeParams = this.getPhonemeForConfig(this.currentToken, this.activeConfigSet) || this.baseParams;
    this.draftParams = clone(this.activeParams);
    this.resetCaptureSession();
    this.renderDraftHeader();
    this.renderEditor();
    this.renderCaptureTargets();
    this.renderCaptureSummary();
    this.renderDiff();
    this.renderSavedCustomList();
    this.refreshKeyboard();
    this.updateOverlay();
  };

  PhoneticsRuntime.prototype.loadDraftFromActive = function(message) {
    if (!this.currentToken) return;
    this.baseParams = this.getBaseParams(this.currentToken);
    this.activeParams = this.getPhonemeForConfig(this.currentToken, this.activeConfigSet) || this.baseParams;
    this.draftParams = clone(this.activeParams);
    this.resetCaptureSession();
    this.renderDraftHeader();
    this.renderEditor();
    this.renderCaptureTargets();
    this.renderCaptureSummary();
    this.renderDiff();
    this.refreshKeyboard();
    this.updateOverlay();
    this.setConfigStatus(message || "");
  };

  PhoneticsRuntime.prototype.renderDraftHeader = function() {
    if (!this.draftParams) return;
    var template = ns.getCalibrationTemplate(this.draftParams);
    var savedStatus = this.isOverridden(this.currentToken) ? "saved override" : "base";
    var draftStatus = this.hasDraftChanges() ? "unsaved draft" : "clean draft";
    this.elements.selectedLabel.textContent = "/" + this.currentToken + "/ " + this.draftParams.label;
    this.elements.templateBadge.textContent = template.type + " / " + savedStatus + " / " + draftStatus;
    this.elements.templateSummary.innerHTML = '<strong>' + escapeHtml(template.title) + '</strong><br>' +
      'Source: ' + escapeHtml(this.configSetLabel()) + '<br>' +
      'Playback preview uses this draft while it is loaded.';
  };

  PhoneticsRuntime.prototype.renderEditor = function() {
    if (!this.draftParams) return;
    var params = this.draftParams;
    var approx = params.metadata.approximation_level || "approximate";
    var html = "";
    html += '<fieldset><legend>General</legend><div class="pt-editor-grid">';
    html += field("IPA symbol", "ipa", params.ipa, { type: "text" });
    html += field("Label", "label", params.label, { type: "text" });
    html += field("Duration ms", "duration_ms", params.duration_ms, { min: 20, max: 500, step: 1, range: true });
    html += field("Approximation", "metadata.approximation_level", approx, { type: "select", options: ["native", "approximate", "unsupported"] });
    html += "</div></fieldset>";
    html += '<fieldset><legend>Voice</legend><div class="pt-editor-grid">';
    html += field("Voiced", "glottis.voiced", params.glottis.voiced, { type: "checkbox" });
    html += field("Frequency", "glottis.ui_frequency", params.glottis.ui_frequency, { min: 60, max: 400, step: 1, range: true });
    html += field("Tenseness", "glottis.ui_tenseness", params.glottis.ui_tenseness, { min: 0, max: 1, step: 0.01, range: true });
    html += field("Intensity", "glottis.intensity", params.glottis.intensity, { min: 0, max: 1, step: 0.01, range: true });
    html += field("Loudness", "glottis.loudness", params.glottis.loudness, { min: 0, max: 1.5, step: 0.01, range: true });
    html += "</div></fieldset>";
    html += '<fieldset><legend>Tract</legend><div class="pt-editor-grid">';
    html += field("Tongue index", "tract.tongue_index", params.tract.tongue_index, { min: 10, max: 32, step: 0.1, range: true, nullable: true });
    html += field("Tongue diameter", "tract.tongue_diameter", params.tract.tongue_diameter, { min: 1.5, max: 4, step: 0.01, range: true, nullable: true });
    html += field("Lip diameter", "tract.lip_diameter", params.tract.lip_diameter, { min: 0, max: 2, step: 0.01, range: true, nullable: true });
    html += field("Velum target", "tract.velum_target", params.tract.velum_target, { min: 0.01, max: 0.5, step: 0.01, range: true });
    html += "</div></fieldset>";
    html += '<fieldset><legend>Constrictions</legend><div id="constrictionRows">' + this.renderConstrictions(params.tract.constrictions || []) + '</div><button type="button" id="addConstriction">Add constriction</button></fieldset>';
    if (params.gesture && Array.isArray(params.gesture.phases) && params.gesture.phases.length) {
      html += '<fieldset><legend>Gesture phases</legend><div class="pt-gesture-list">' + params.gesture.phases.map(function(gesturePhase, phaseIndex) {
        return '<div class="pt-gesture-row">' +
          '<label><span>Type</span><input type="text" data-path="gesture.phases.' + phaseIndex + '.type" value="' + escapeHtml(gesturePhase.type || "phase") + '"></label>' +
          '<label><span>Start ms</span><input type="number" data-value-type="number" min="0" step="1" data-path="gesture.phases.' + phaseIndex + '.start_ms" value="' + escapeHtml(gesturePhase.start_ms || 0) + '"></label>' +
          '<label><span>End ms</span><input type="number" data-value-type="number" min="1" step="1" data-path="gesture.phases.' + phaseIndex + '.end_ms" value="' + escapeHtml(gesturePhase.end_ms || params.duration_ms) + '"></label>' +
          '<small>' + escapeHtml(shortJson(gesturePhase.target || {})) + '</small>' +
        '</div>';
      }).join("") + '</div></fieldset>';
    }
    html += '<fieldset><legend>Noise, Release, Timing</legend><div class="pt-editor-grid">';
    html += field("Turbulence", "noise.turbulence", params.noise.turbulence, { type: "checkbox" });
    html += field("Turbulence intensity", "noise.turbulence_intensity", params.noise.turbulence_intensity, { min: 0, max: 1, step: 0.01, range: true });
    html += field("Release transient", "release.transient", params.release.transient, { type: "checkbox" });
    html += field("Release strength", "release.strength", params.release.strength, { min: 0, max: 1, step: 0.01, range: true });
    html += field("Closure ms", "timing.closure_ms", params.timing.closure_ms, { min: 0, max: 200, step: 1, range: true });
    html += field("Frication ms", "timing.frication_ms", params.timing.frication_ms, { min: 0, max: 220, step: 1, range: true });
    html += "</div></fieldset>";
    this.elements.editor.innerHTML = html;
    this.renderSectionChips();
  };

  PhoneticsRuntime.prototype.renderConstrictions = function(constrictions) {
    if (!constrictions.length) return '<p class="pt-muted">No constrictions.</p>';
    return constrictions.map(function(constriction, index) {
      return '<div class="pt-constriction-row" data-constriction-row="' + index + '">' +
        '<label><span>Index</span><input type="number" step="0.1" data-constriction="' + index + '" data-field="index" value="' + escapeHtml(constriction.index) + '"></label>' +
        '<label><span>Diameter</span><input type="number" step="0.01" data-constriction="' + index + '" data-field="diameter" value="' + escapeHtml(constriction.diameter) + '"></label>' +
        '<label><span>Width</span><input type="number" step="0.1" data-constriction="' + index + '" data-field="width" value="' + escapeHtml(constriction.width) + '"></label>' +
        '<label><span>Turbulence</span><input type="number" step="0.01" min="0" max="1" data-constriction="' + index + '" data-field="turbulence_intensity" value="' + escapeHtml(constriction.turbulence_intensity || 0) + '"></label>' +
        '<label><span>Label</span><input type="text" data-constriction="' + index + '" data-field="label" value="' + escapeHtml(constriction.label || "") + '"></label>' +
        '<button type="button" data-remove-constriction="' + index + '">Remove</button>' +
        "</div>";
    }).join("");
  };

  PhoneticsRuntime.prototype.syncRangePair = function(control) {
    if (!control) return;
    if (control.dataset.rangeFor) {
      var number = this.elements.editor.querySelector('[data-path="' + control.dataset.rangeFor + '"]');
      if (number) number.value = control.value;
    }
    if (control.dataset.path) {
      var range = this.elements.editor.querySelector('[data-range-for="' + control.dataset.path + '"]');
      if (range && control.value !== "") range.value = control.value;
    }
  };

  PhoneticsRuntime.prototype.readEditor = function() {
    var params = clone(this.draftParams || this.activeParams || this.baseParams);
    this.elements.editor.querySelectorAll("[data-path]").forEach(function(control) {
      setPath(params, control.dataset.path, readValue(control));
    });
    params.timing.duration_ms = params.duration_ms;
    if (params.gesture) params.gesture.duration_ms = params.duration_ms;
    var constrictions = [];
    this.elements.editor.querySelectorAll("[data-constriction-row]").forEach(function(row) {
      var constriction = {};
      row.querySelectorAll("[data-field]").forEach(function(control) {
        constriction[control.dataset.field] = control.dataset.field === "label" ? control.value : Number(control.value);
      });
      constrictions.push(ns.normalizeConstriction(constriction));
    });
    params.tract.constrictions = constrictions;
    if (params.noise.turbulence_intensity > 0) params.noise.turbulence = true;
    return params;
  };

  PhoneticsRuntime.prototype.setDraftParams = function(params, message) {
    this.draftParams = clone(params);
    this.renderDraftHeader();
    this.renderEditor();
    this.renderDiff();
    this.refreshKeyboard();
    this.updateOverlay();
    this.setConfigStatus(message || "");
  };

  PhoneticsRuntime.prototype.addConstriction = function() {
    this.draftParams = this.readEditor();
    this.draftParams.tract.constrictions.push({ index: 36, diameter: 0.3, width: 5, turbulence_intensity: 0, label: "manual" });
    this.renderEditor();
    this.renderDiff();
    this.updateOverlay();
  };

  PhoneticsRuntime.prototype.removeConstriction = function(index) {
    this.draftParams = this.readEditor();
    this.draftParams.tract.constrictions.splice(index, 1);
    this.renderEditor();
    this.renderDiff();
    this.updateOverlay();
  };

  PhoneticsRuntime.prototype.renderCaptureTargets = function() {
    if (!this.draftParams) return;
    var template = ns.getCalibrationTemplate(this.draftParams);
    this.elements.captureGuide.innerHTML = '<strong>' + escapeHtml(template.capturePrimary) + '</strong><br>' + escapeHtml(template.captureGuide || "Record the useful articulatory target.");
    this.renderSectionChips();
    this.renderCaptureTimeline();
  };

  PhoneticsRuntime.prototype.renderSectionChips = function() {
    var template = this.draftParams ? ns.getCalibrationTemplate(this.draftParams) : { sections: [] };
    var controls = template.sections.map(function(section) {
      return '<label class="pt-parameter-chip"><input type="checkbox" data-capture-section="' + escapeHtml(section) + '" checked> ' + escapeHtml(section) + "</label>";
    });
    this.elements.sectionApply.innerHTML = controls.join("");
    this.elements.sectionApply.querySelectorAll("input").forEach(function(control) {
      control.disabled = !this.captureDraftParams;
    }, this);
    byId("applyCaptureAll").disabled = !this.captureDraftParams;
    byId("discardCapture").disabled = !this.captureSession;
  };

  PhoneticsRuntime.prototype.setCaptureState = function(state, message) {
    this.captureState = state || "idle";
    var labels = { idle: "Idle", recording: "Recording", review: "Review", preview: "Preview" };
    this.elements.captureStateBadge.textContent = labels[this.captureState] || this.captureState;
    this.elements.captureStateBadge.dataset.state = this.captureState;
    byId("startCapture").disabled = this.captureState === "recording";
    byId("captureCurrent").disabled = this.captureState === "recording";
    byId("stopCapture").disabled = this.captureState !== "recording";
    byId("autoSegmentCapture").disabled = !this.captureSession || this.captureState === "recording";
    byId("previewCapture").disabled = !this.captureSession || this.captureState === "recording";
    byId("discardCapture").disabled = !this.captureSession;
    if (message !== undefined) this.setConfigStatus(message);
  };

  PhoneticsRuntime.prototype.resetCaptureSession = function(message) {
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = 0;
    if (this.controller) this.controller.stop(false);
    this.capture.clear();
    this.captureSession = null;
    this.captureAnalysis = null;
    this.captureSelection = null;
    this.captureDraftParams = null;
    this.selectedCapturePhaseId = "";
    this.renderCaptureStats();
    this.renderCaptureInspector();
    this.renderCaptureSummary();
    this.renderSectionChips();
    this.renderCaptureTimeline();
    this.updateOverlay();
    this.setCaptureState("idle", message);
  };

  PhoneticsRuntime.prototype.renderCaptureStats = function() {
    var frames = this.captureSession && this.captureSession.frames || [];
    var duration = this.captureSession ? Math.round(this.captureSession.durationMs || 0) : 0;
    var phases = this.captureAnalysis && this.captureAnalysis.phases || [];
    this.elements.captureStats.innerHTML = '<span><small>Frames</small><strong>' + frames.length + '</strong></span>' +
      '<span><small>Duration</small><strong>' + duration + ' ms</strong></span>' +
      '<span><small>Phases</small><strong>' + phases.length + '</strong></span>';
  };

  PhoneticsRuntime.prototype.renderCaptureTimeline = function() {
    if (!this.captureTimeline) return;
    var frames = this.captureSession && this.captureSession.frames || [];
    var duration = this.captureSession ? Math.max(1, this.captureSession.durationMs || (frames.length ? frames[frames.length - 1].t + 17 : 1)) : 1;
    this.captureTimeline.setData({
      frames: frames,
      durationMs: duration,
      phases: this.captureAnalysis && this.captureAnalysis.phases || [],
      selection: this.captureSelection || { startMs: 0, endMs: duration },
      selectedPhaseId: this.selectedCapturePhaseId
    });
  };

  PhoneticsRuntime.prototype.startCapture = function() {
    if (!this.draftParams || this.capture.recording) return;
    this.controller.stop(false);
    this.captureDraftParams = null;
    var template = ns.getCalibrationTemplate(this.draftParams);
    this.captureSession = this.capture.start({ token: this.currentToken, type: template.type });
    this.captureAnalysis = null;
    this.captureSelection = null;
    this.selectedCapturePhaseId = "";
    this.renderCaptureSummary();
    this.renderSectionChips();
    this.setCaptureState("recording", "Recording Pink Trombone UI parameters. Perform the complete gesture, then stop.");
    var self = this;
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = setInterval(function() {
      self.captureSession = self.capture.session;
      self.renderCaptureStats();
      self.renderCaptureTimeline();
    }, 100);
  };

  PhoneticsRuntime.prototype.stopCapture = function() {
    if (!this.capture.recording) return;
    this.captureSession = this.capture.stop();
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = 0;
    this.analyzeCapture("Take ready. Review the detected phases and drag their edges before building the draft.");
  };

  PhoneticsRuntime.prototype.captureCurrent = function() {
    if (!this.draftParams) return;
    var template = ns.getCalibrationTemplate(this.draftParams);
    this.controller.stop(false);
    this.captureSession = this.capture.snapshot({ token: this.currentToken, type: template.type });
    this.analyzeCapture("Snapshot ready. Review the captured posture before building the draft.");
  };

  PhoneticsRuntime.prototype.analyzeCapture = function(message) {
    if (!this.captureSession || !this.draftParams) return;
    var template = ns.getCalibrationTemplate(this.draftParams);
    this.captureAnalysis = this.capture.analyze(this.readEditor(), template.type, {
      frames: this.captureSession.frames
    });
    this.captureSelection = clone(this.captureAnalysis.selection);
    this.selectedCapturePhaseId = this.captureAnalysis.phases.length ? this.captureAnalysis.phases[0].id : "";
    this.updateCaptureDraft();
    this.renderCaptureStats();
    this.renderCaptureInspector();
    this.renderCaptureTimeline();
    this.setCaptureState("review", message || "Take analyzed.");
  };

  PhoneticsRuntime.prototype.autoSegmentCapture = function() {
    this.analyzeCapture("Phases detected again from the original take.");
  };

  PhoneticsRuntime.prototype.captureIncludedRange = function() {
    var phases = this.captureAnalysis && this.captureAnalysis.phases || [];
    var included = phases.filter(function(item) { return item.included !== false; });
    if (!included.length) return this.captureSelection || { startMs: 0, endMs: this.captureSession ? this.captureSession.durationMs : 1 };
    return {
      startMs: Math.min.apply(null, included.map(function(item) { return item.startMs; })),
      endMs: Math.max.apply(null, included.map(function(item) { return item.endMs; }))
    };
  };

  PhoneticsRuntime.prototype.updateCaptureDraft = function() {
    if (!this.captureSession || !this.captureAnalysis || !this.draftParams) return;
    this.captureSelection = this.captureIncludedRange();
    var template = ns.getCalibrationTemplate(this.draftParams);
    this.captureDraftParams = this.capture.summarize(this.readEditor(), template.type, {
      frames: this.captureSession.frames,
      analysis: this.captureAnalysis,
      phases: this.captureAnalysis.phases,
      range: this.captureSelection
    });
    this.renderCaptureSummary();
    this.renderSectionChips();
    this.updateOverlay();
  };

  PhoneticsRuntime.prototype.selectCapturePhase = function(item) {
    this.selectedCapturePhaseId = item ? item.id : "";
    this.renderCaptureInspector();
    this.renderCaptureTimeline();
  };

  PhoneticsRuntime.prototype.changeCapturePhase = function() {
    this.captureSelection = this.captureIncludedRange();
    this.updateCaptureDraft();
    this.renderCaptureInspector();
    this.renderCaptureTimeline();
  };

  PhoneticsRuntime.prototype.changeCaptureSelection = function(range) {
    this.captureSelection = clone(range);
    this.updateCaptureDraft();
    this.renderCaptureInspector();
  };

  PhoneticsRuntime.prototype.scrubCapture = function(timeMs, frame) {
    if (frame) this.controller.previewCaptureFrame(frame);
    if (this.captureTimeline) this.captureTimeline.setPlayhead(timeMs);
  };

  PhoneticsRuntime.prototype.editCapturePhase = function(field, control) {
    if (!this.captureAnalysis) return;
    if (field === "select") {
      this.selectedCapturePhaseId = control.value;
      this.renderCaptureInspector();
      this.renderCaptureTimeline();
      return;
    }
    var selected = this.captureAnalysis.phases.filter(function(item) { return item.id === this.selectedCapturePhaseId; }, this)[0];
    if (!selected) return;
    if (field === "included") selected.included = control.checked;
    if (field === "startMs") selected.startMs = Math.max(0, Math.min(Number(control.value), selected.endMs - 1));
    if (field === "endMs") selected.endMs = Math.max(selected.startMs + 1, Math.min(Number(control.value), this.captureAnalysis.durationMs));
    this.changeCapturePhase(selected);
  };

  PhoneticsRuntime.prototype.editCapturePhaseParameter = function(path, control) {
    if (!this.captureAnalysis) return;
    var selected = this.captureAnalysis.phases.filter(function(item) { return item.id === this.selectedCapturePhaseId; }, this)[0];
    if (!selected) return;
    selected.edits = selected.edits || {};
    var value = Number(control.value);
    if (Number.isFinite(value)) selected.edits[path] = value;
    this.updateCaptureDraft();
    this.renderCaptureTimeline();
    this.setConfigStatus("Phase parameter edited. The original take remains unchanged.");
  };

  PhoneticsRuntime.prototype.renderCaptureInspector = function() {
    if (!this.captureAnalysis || !this.captureSession) {
      this.elements.capturePhaseInspector.innerHTML = '<p class="pt-muted">Record a take to inspect and edit its phases.</p>';
      return;
    }
    var phases = this.captureAnalysis.phases || [];
    var selected = phases.filter(function(item) { return item.id === this.selectedCapturePhaseId; }, this)[0] || phases[0];
    if (!selected) {
      this.elements.capturePhaseInspector.innerHTML = '<p class="pt-muted">No usable phase detected. Record again or use a snapshot.</p>';
      return;
    }
    this.selectedCapturePhaseId = selected.id;
    var frames = ns.captureFramesInRange(this.captureSession.frames, selected);
    var stats = this.capture.summarizeFrames(frames, this.draftParams);
    var minimum = frames.length ? ns.captureFrameFeatures(frames[Math.floor(frames.length / 2)]) : { min_index: 0, min_diameter: 0 };
    var template = ns.getCalibrationTemplate(this.draftParams);
    var edits = selected.edits || {};
    var constrictionIndex = template.type === "affricate" && selected.type === "frication" ? 1 : 0;
    var capturedConstriction = this.captureDraftParams && this.captureDraftParams.tract && this.captureDraftParams.tract.constrictions[constrictionIndex] || {};
    function editValue(path, fallback) {
      return edits[path] === undefined ? fallback : edits[path];
    }
    function parameterField(label, path, value, min, max, step) {
      return '<label><span>' + escapeHtml(label) + '</span><input type="number" data-phase-param="' + escapeHtml(path) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + escapeHtml(value) + '"></label>';
    }
    var showTongue = template.type === "vowel" || template.type === "approximant" || template.type === "other";
    var showConstriction = ["closure", "nasal closure", "frication", "contact", "target"].indexOf(selected.type) !== -1 && template.type !== "vowel";
    var parameterEditor = '<details class="pt-phase-parameter-editor" open><summary>Edit selected phase parameters</summary>' +
      '<div class="pt-phase-parameter-groups">' +
        '<fieldset><legend>Voice source</legend><div class="pt-phase-parameter-grid">' +
          parameterField("Frequency", "glottis.ui_frequency", editValue("glottis.ui_frequency", stats.glottis.ui_frequency), 60, 400, 1) +
          parameterField("Tenseness", "glottis.ui_tenseness", editValue("glottis.ui_tenseness", stats.glottis.ui_tenseness), 0, 1, 0.01) +
          parameterField("Intensity", "glottis.intensity", editValue("glottis.intensity", stats.glottis.intensity), 0, 1, 0.01) +
          parameterField("Loudness", "glottis.loudness", editValue("glottis.loudness", stats.glottis.loudness), 0, 1.5, 0.01) +
        '</div></fieldset>' +
        '<fieldset><legend>Velum and noise</legend><div class="pt-phase-parameter-grid">' +
          parameterField("Velum", "tract.velum_target", editValue("tract.velum_target", stats.tract.velum_target), 0.01, 0.5, 0.01) +
          parameterField("Turbulence", "noise.turbulence_intensity", editValue("noise.turbulence_intensity", stats.turbulence), 0, 1, 0.01) +
        '</div></fieldset>' +
        (showTongue ? '<fieldset><legend>Tongue and lips</legend><div class="pt-phase-parameter-grid">' +
          parameterField("Tongue index", "tract.tongue_index", editValue("tract.tongue_index", stats.tract.tongue_index), 10, 32, 0.1) +
          parameterField("Tongue diameter", "tract.tongue_diameter", editValue("tract.tongue_diameter", stats.tract.tongue_diameter), 1.5, 4, 0.01) +
          parameterField("Lip diameter", "tract.lip_diameter", editValue("tract.lip_diameter", stats.tract.lip_diameter), 0, 3, 0.01) +
        '</div></fieldset>' : '') +
        (showConstriction ? '<fieldset><legend>Constriction</legend><div class="pt-phase-parameter-grid">' +
          parameterField("Index", "tract.constriction.index", editValue("tract.constriction.index", capturedConstriction.index === undefined ? minimum.min_index : capturedConstriction.index), 2, 43, 0.1) +
          parameterField("Diameter", "tract.constriction.diameter", editValue("tract.constriction.diameter", capturedConstriction.diameter === undefined ? minimum.min_diameter : capturedConstriction.diameter), 0, 2.5, 0.01) +
          parameterField("Width", "tract.constriction.width", editValue("tract.constriction.width", capturedConstriction.width || 5), 1, 12, 0.1) +
        '</div></fieldset>' : '') +
      '</div></details>';
    this.elements.capturePhaseInspector.innerHTML =
      '<div class="pt-phase-fields">' +
        '<label><span>Phase</span><select data-phase-field="select">' + phases.map(function(item) {
          return '<option value="' + escapeHtml(item.id) + '"' + (item.id === selected.id ? " selected" : "") + '>' + escapeHtml(item.label) + '</option>';
        }).join("") + '</select></label>' +
        '<label><span>Start ms</span><input type="number" min="0" max="' + Math.round(this.captureAnalysis.durationMs) + '" step="1" data-phase-field="startMs" value="' + Math.round(selected.startMs) + '"></label>' +
        '<label><span>End ms</span><input type="number" min="1" max="' + Math.round(this.captureAnalysis.durationMs) + '" step="1" data-phase-field="endMs" value="' + Math.round(selected.endMs) + '"></label>' +
        '<label class="pt-inline-check"><input type="checkbox" data-phase-field="included"' + (selected.included !== false ? " checked" : "") + '> Include in draft</label>' +
      '</div>' +
      '<div class="pt-phase-metrics">' +
        '<span><small>Minimum target</small><strong>' + Number(minimum.min_index || 0).toFixed(1) + ' / ' + Number(minimum.min_diameter || 0).toFixed(2) + '</strong></span>' +
        '<span><small>Velum</small><strong>' + Number(stats.tract.velum_target).toFixed(2) + '</strong></span>' +
        '<span><small>Turbulence</small><strong>' + Number(stats.turbulence).toFixed(2) + '</strong></span>' +
        '<span><small>Voice intensity</small><strong>' + Number(stats.glottis.intensity).toFixed(2) + '</strong></span>' +
      '</div>' + parameterEditor;
  };

  PhoneticsRuntime.prototype.previewCapture = function() {
    if (!this.captureSession) return;
    this.controller.playCapture(this.captureSession, this.captureSelection || this.captureIncludedRange(), {
      loop: byId("loopCapture").checked
    });
    this.setCaptureState("preview", "Previewing the selected Pink Trombone parameter take.");
  };

  PhoneticsRuntime.prototype.applyCapture = function(section) {
    if (!this.captureDraftParams) return;
    if (section === "all") {
      var selectedSections = Array.prototype.slice.call(this.elements.sectionApply.querySelectorAll("[data-capture-section]:checked")).map(function(control) {
        return control.dataset.captureSection;
      });
      var template = ns.getCalibrationTemplate(this.draftParams);
      if (selectedSections.length === template.sections.length) {
        this.setDraftParams(this.captureDraftParams, "Draft built from the edited take.");
        return;
      }
      var result = this.readEditor();
      selectedSections.forEach(function(selectedSection) {
        result = ns.applyCalibrationPatch(result, ns.calibrationSectionPatch(this.captureDraftParams, selectedSection));
      }, this);
      if (selectedSections.some(function(name) { return ["closure", "frication", "brief contact", "release", "timing"].indexOf(name) !== -1; })) {
        result.events = clone(this.captureDraftParams.events || result.events);
        result.gesture = clone(this.captureDraftParams.gesture || result.gesture);
      }
      this.setDraftParams(result, "Selected take parameters applied to the draft.");
      return;
    }
    if (section === "legacy-all") {
      this.setDraftParams(this.captureDraftParams, "Capture applied to draft.");
      return;
    }
    var patch = ns.calibrationSectionPatch(this.captureDraftParams, section);
    this.setDraftParams(ns.applyCalibrationPatch(this.readEditor(), patch), "Capture " + section + " applied to draft.");
  };

  PhoneticsRuntime.prototype.discardCapture = function() {
    this.controller.stop(false);
    this.resetCaptureSession("Take deleted. The draft was not changed.");
  };

  PhoneticsRuntime.prototype.renderCaptureSummary = function() {
    if (!this.captureDraftParams) {
      this.elements.capturedSummary.innerHTML = '<p class="pt-muted">No capture draft yet.</p>';
      this.renderSectionChips();
      return;
    }
    var rows = ns.flattenParameterDiff(this.draftParams, this.captureDraftParams).filter(function(row) {
      return row.path.indexOf("original") !== 0;
    }).slice(0, 50);
    this.elements.capturedSummary.innerHTML = rows.length ? rows.map(function(row) {
      return '<div class="pt-diff-row"><strong>' + escapeHtml(row.path) + '</strong><span>' +
        escapeHtml(shortJson(row.before)) + '</span><span>' + escapeHtml(shortJson(row.after)) + "</span></div>";
    }).join("") : '<p class="pt-muted">Capture matches the current draft.</p>';
  };

  PhoneticsRuntime.prototype.renderDiff = function() {
    if (!this.draftParams || !this.baseParams) return;
    var rows = ns.flattenParameterDiff(this.baseParams, this.draftParams).filter(function(row) {
      return row.path.indexOf("original") !== 0;
    }).slice(0, 80);
    if (!rows.length) {
      this.elements.diff.innerHTML = '<p class="pt-muted">Draft matches the base mapping.</p>';
      return;
    }
    this.elements.diff.innerHTML = rows.map(function(row) {
      return '<div class="pt-diff-row"><strong>' + escapeHtml(row.path) + '</strong><span>' +
        escapeHtml(shortJson(row.before)) + '</span><span>' + escapeHtml(shortJson(row.after)) + "</span></div>";
    }).join("");
  };

  PhoneticsRuntime.prototype.updateOverlay = function() {
    if (!this.overlay) return;
    var saved = this.isOverridden(this.currentToken) ? this.mappingLoader.getPhoneme(this.currentToken) : null;
    this.overlay.setLayers({
      base: this.baseParams,
      saved: saved,
      draft: this.draftParams,
      recording: this.captureDraftParams
    });
  };

  PhoneticsRuntime.prototype.drawOverlay = function() {
    if (this.overlay) this.overlay.draw();
  };

  PhoneticsRuntime.prototype.playParams = function(params) {
    if (!params) return;
    this.controller.playOne(params);
  };

  PhoneticsRuntime.prototype.saveDraftOverride = function() {
    if (!this.currentToken || !this.draftParams) return;
    var params = this.readEditor();
    var doc = this.mappingLoader.setPhonemeOverride(this.currentToken, params);
    var saved = this.configStore.save(doc);
    this.mappingLoader.setOverrideDoc(saved);
    this.activeConfigSet = "local";
    this.elements.configSet.value = "local";
    this.rebuildActiveScheduler();
    this.refreshKeyboard();
    this.selectToken(this.currentToken);
    this.setConfigStatus("Draft saved into Saved overrides.");
  };

  PhoneticsRuntime.prototype.removeSavedOverride = function() {
    if (!this.currentToken) return;
    var doc = this.mappingLoader.resetOverride(this.currentToken);
    var saved = this.configStore.save(doc);
    this.mappingLoader.setOverrideDoc(saved);
    this.rebuildActiveScheduler();
    this.refreshKeyboard();
    this.selectToken(this.currentToken);
    this.setConfigStatus("Saved override removed.");
  };

  PhoneticsRuntime.prototype.resetAllOverrides = function() {
    if (!root.confirm("Reset all saved IPA overrides?")) return;
    var saved = this.configStore.save({ version: 1, overrides: {} });
    this.mappingLoader.setOverrideDoc(saved);
    this.rebuildActiveScheduler();
    this.refreshKeyboard();
    if (this.currentToken) this.selectToken(this.currentToken);
    this.renderSavedCustomList();
    this.setConfigStatus("All saved overrides were reset.");
  };

  PhoneticsRuntime.prototype.importOverrideFile = function(file) {
    var self = this;
    this.configStore.importFile(file).then(function(doc) {
      var saved = self.configStore.save(doc);
      self.mappingLoader.setOverrideDoc(saved);
      self.activeConfigSet = "local";
      self.elements.configSet.value = "local";
      self.rebuildActiveScheduler();
      self.refreshKeyboard();
      if (self.currentToken) self.selectToken(self.currentToken);
      self.renderSavedCustomList();
      self.setConfigStatus("Override JSON imported.");
    }).catch(function(error) {
      self.setConfigStatus("Import failed: " + error.message);
    }).finally(function() {
      self.elements.importFile.value = "";
    });
  };

  PhoneticsRuntime.prototype.renderSavedCustomList = function() {
    if (!this.elements.browserList) return;
    var overrides = this.mappingLoader.getOverrideDoc().overrides || {};
    var tokens = Object.keys(overrides).sort(function(left, right) {
      return left.localeCompare(right);
    });
    this.elements.browserCount.textContent = tokens.length + " saved";
    if (!tokens.length) {
      this.elements.browserList.innerHTML = '<p class="pt-muted">No saved custom phonemes.</p>';
      return;
    }
    this.elements.browserList.innerHTML = tokens.map(function(token) {
      var params = this.mappingLoader.getPhoneme(token) || this.getBaseParams(token);
      var template = ns.getCalibrationTemplate ? ns.getCalibrationTemplate(params).type : params.category;
      return '<div class="pt-map-row" data-token="' + escapeHtml(token) + '">' +
        '<strong>' + escapeHtml(token) + '</strong><span>' + escapeHtml(template) + '</span><small>' + escapeHtml(params.label || "") + '</small>' +
        '<button type="button" data-action="preview" data-token="' + escapeHtml(token) + '">Play</button>' +
        '<button type="button" data-action="load" data-token="' + escapeHtml(token) + '">Load</button>' +
      "</div>";
    }, this).join("");
  };

  PhoneticsRuntime.prototype.updateControlLabels = function() {
    var selectedDuration = this.elements.duration.options[this.elements.duration.selectedIndex];
    this.elements.durationValue.textContent = selectedDuration ? selectedDuration.textContent : "1x natural";
    this.elements.pitchValue.textContent = this.elements.pitch.value + " Hz";
    this.elements.intensityValue.textContent = Number(this.elements.intensity.value).toFixed(2) + "x";
  };

  PhoneticsRuntime.prototype.playInput = function() {
    if (!this.scheduler) return;
    var result = this.scheduler.createEvents(this.elements.input.value, { durationMultiplier: Number(this.elements.duration.value || 2) });
    this.renderWarnings(result.warnings);
    this.renderTimeline(result.events);
    if (!result.events.length) {
      this.elements.current.textContent = "No playable phonemes.";
      return;
    }
    this.controller.play(result.events, {
      loop: this.elements.loop.checked,
      autoVoice: this.elements.autoVoice.checked,
      pitchMultiplier: Number(this.elements.pitch.value) / 140,
      intensityMultiplier: Number(this.elements.intensity.value)
    });
  };

  PhoneticsRuntime.prototype.renderWarnings = function(warnings) {
    if (!warnings || !warnings.length) {
      this.elements.warnings.innerHTML = '<p class="pt-muted">No warnings.</p>';
      return;
    }
    this.elements.warnings.innerHTML = warnings.map(function(warning) {
      return '<p><strong>' + escapeHtml(warning.token || "") + '</strong> ' + escapeHtml(warning.message || warning) + "</p>";
    }).join("");
  };

  PhoneticsRuntime.prototype.renderTimeline = function(events) {
    if (!events.length) {
      this.elements.timeline.innerHTML = '<p class="pt-muted">No events scheduled.</p>';
      return;
    }
    this.elements.timeline.innerHTML = events.map(function(event, index) {
      return '<div class="pt-timeline-item" data-event-index="' + index + '"><strong>' + escapeHtml(event.token) + "</strong><span>" +
        event.start.toFixed(2) + "s</span><span>" + Math.round(event.duration * 1000) + "ms</span><span>" + escapeHtml(event.params.category) + "</span></div>";
    }).join("");
  };

  PhoneticsRuntime.prototype.updateCurrentPhoneme = function(state) {
    this.elements.timeline.querySelectorAll("[data-event-index]").forEach(function(item) {
      item.classList.toggle("is-active", Number(item.dataset.eventIndex) === state.index);
    });
    this.elements.current.textContent = state.event ? state.event.token + " (" + state.stage + ")" : "Stopped";
  };

  var publicApp = {
    instance: null,
    bootstrap: function(synth) {
      this.instance = new PhoneticsRuntime(synth);
      return this.instance.init();
    },
    drawOverlay: function() {
      if (this.instance) this.instance.drawOverlay();
    },
    isManualMode: function() {
      return !this.instance || this.instance.isManualMode();
    }
  };

  root.PhoneticsApp = publicApp;

  return {
    ConfigModeUI: PhoneticsRuntime,
    PhoneticsRuntime: PhoneticsRuntime
  };
});
