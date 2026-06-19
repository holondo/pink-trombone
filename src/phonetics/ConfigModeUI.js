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
            '<h2>Recorder</h2>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="startCapture">Start capture</button>' +
              '<button type="button" id="stopCapture">Stop</button>' +
              '<button type="button" id="captureCurrent">Use current posture</button>' +
            '</div>' +
            '<label class="pt-field"><span>Capture target</span><select id="captureWindow"></select></label>' +
            '<div id="captureStats" class="pt-readout"><span>Samples</span><strong>0</strong></div>' +
            '<div class="pt-button-row">' +
              '<button type="button" id="applyCaptureAll">Apply capture to draft</button>' +
              '<button type="button" id="discardCapture">Discard capture</button>' +
            '</div>' +
            '<div id="sectionApplyPanel" class="pt-chip-row"></div>' +
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
      captureWindow: byId("captureWindow"),
      captureStats: byId("captureStats"),
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
    byId("applyCaptureAll").addEventListener("click", function() { self.applyCapture("all"); });
    byId("discardCapture").addEventListener("click", function() { self.discardCapture(); });
    this.elements.sectionApply.addEventListener("click", function(event) {
      var button = event.target.closest && event.target.closest("[data-section]");
      if (button) self.applyCapture(button.dataset.section);
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
    this.captureDraftParams = null;
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
    this.captureDraftParams = null;
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
    this.elements.captureWindow.innerHTML = template.windows.map(function(label) {
      var value = label.toLowerCase().replace(/\s+/g, "-");
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(label) + "</option>";
    }).join("");
    this.renderSectionChips();
  };

  PhoneticsRuntime.prototype.renderSectionChips = function() {
    var template = this.draftParams ? ns.getCalibrationTemplate(this.draftParams) : { sections: [] };
    var buttons = template.sections.map(function(section) {
      return '<button type="button" data-section="' + escapeHtml(section) + '">Apply ' + escapeHtml(section) + "</button>";
    });
    this.elements.sectionApply.innerHTML = buttons.join("");
    this.elements.sectionApply.querySelectorAll("button").forEach(function(button) {
      button.disabled = !this.captureDraftParams;
    }, this);
    byId("applyCaptureAll").disabled = !this.captureDraftParams;
    byId("discardCapture").disabled = !this.captureDraftParams;
  };

  PhoneticsRuntime.prototype.startCapture = function() {
    this.controller.stop(false);
    this.capture.start();
    var self = this;
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = setInterval(function() {
      self.elements.captureStats.innerHTML = '<span>Samples</span><strong>' + self.capture.samples.length + "</strong>";
    }, 100);
    this.setConfigStatus("Capturing manual articulation.");
  };

  PhoneticsRuntime.prototype.stopCapture = function() {
    this.capture.stop();
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = 0;
    this.summarizeCaptureDraft("Capture draft ready. Apply or discard it.");
  };

  PhoneticsRuntime.prototype.captureCurrent = function() {
    this.capture.samples = [this.capture.sample()];
    this.summarizeCaptureDraft("Current posture captured. Apply or discard it.", { currentOnly: true });
  };

  PhoneticsRuntime.prototype.summarizeCaptureDraft = function(message, options) {
    options = options || {};
    if (!this.draftParams) return;
    var template = ns.getCalibrationTemplate(this.draftParams);
    var windowValue = this.elements.captureWindow.value || "";
    var stage = windowValue.indexOf("frication") !== -1 ? "frication" : (windowValue.indexOf("closure") !== -1 ? "closure" : "");
    var windowMs = windowValue.indexOf("300") !== -1 ? 300 : (windowValue.indexOf("200") !== -1 ? 200 : (windowValue.indexOf("500") !== -1 ? 500 : 0));
    if (options.currentOnly || windowValue.indexOf("current") !== -1) this.capture.samples = [this.capture.sample()];
    this.captureDraftParams = this.capture.summarize(this.readEditor(), template.type, {
      stage: stage,
      windowMs: windowMs,
      existingParams: this.captureDraftParams || this.draftParams
    });
    this.renderCaptureSummary();
    this.renderSectionChips();
    this.updateOverlay();
    this.setConfigStatus(message || "");
  };

  PhoneticsRuntime.prototype.applyCapture = function(section) {
    if (!this.captureDraftParams) return;
    if (section === "all") {
      this.setDraftParams(this.captureDraftParams, "Capture applied to draft.");
      return;
    }
    var patch = ns.calibrationSectionPatch(this.captureDraftParams, section);
    this.setDraftParams(ns.applyCalibrationPatch(this.readEditor(), patch), "Capture " + section + " applied to draft.");
  };

  PhoneticsRuntime.prototype.discardCapture = function() {
    this.captureDraftParams = null;
    this.renderCaptureSummary();
    this.renderSectionChips();
    this.updateOverlay();
    this.setConfigStatus("Capture draft discarded.");
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
