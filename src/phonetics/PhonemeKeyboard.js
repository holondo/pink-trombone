(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  var CATEGORY_ORDER = [
    { id: "vowel", label: "Vowels" },
    { id: "stop", label: "Stops" },
    { id: "fricative", label: "Fricatives" },
    { id: "nasal", label: "Nasals" },
    { id: "affricate", label: "Affricates" },
    { id: "approximant", label: "Approximants" },
    { id: "tap", label: "Taps" },
    { id: "other", label: "Other" }
  ];

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function classify(phoneme) {
    if (!phoneme) return "other";
    if (phoneme.templateType) return phoneme.templateType;
    if (ns.getCalibrationTemplate) return ns.getCalibrationTemplate(phoneme).type;
    return String(phoneme.category || "other").toLowerCase();
  }

  function isVowel(phoneme) {
    return classify(phoneme) === "vowel";
  }

  function vowelSortKey(phoneme) {
    var label = String((phoneme && phoneme.label) || "").toLowerCase();
    var height = label.indexOf("close") !== -1 ? 0 : (label.indexOf("mid") !== -1 ? 1 : (label.indexOf("open") !== -1 ? 2 : 3));
    var backness = label.indexOf("front") !== -1 ? 0 : (label.indexOf("central") !== -1 ? 1 : (label.indexOf("back") !== -1 ? 2 : 3));
    return height * 10 + backness;
  }

  function sortedForCategory(phonemes, category) {
    return phonemes.slice().sort(function(left, right) {
      if (category === "vowel") return vowelSortKey(left) - vowelSortKey(right) || left.ipa.localeCompare(right.ipa);
      return left.ipa.localeCompare(right.ipa);
    });
  }

  function PhonemeKeyboard(container, options) {
    this.container = container;
    this.options = options || {};
    this.phonemes = [];
    this.category = "vowel";
    this.contextVowel = "a";
    this.searchValue = "";
    this.selectedToken = "";
    this.onAction = this.options.onAction || function() {};
    this.bind();
  }

  PhonemeKeyboard.prototype.bind = function() {
    var self = this;
    if (!this.container) return;
    this.container.addEventListener("input", function(event) {
      if (event.target.dataset.keyboardSearch !== undefined) {
        self.searchValue = event.target.value || "";
        self.renderBody();
      }
    });
    this.container.addEventListener("change", function(event) {
      if (event.target.dataset.contextVowel !== undefined) {
        self.contextVowel = event.target.value || "a";
        self.renderBody();
      }
    });
    this.container.addEventListener("click", function(event) {
      var categoryButton = event.target.closest && event.target.closest("[data-keyboard-category]");
      if (categoryButton) {
        self.category = categoryButton.dataset.keyboardCategory;
        self.render();
        return;
      }
      var actionButton = event.target.closest && event.target.closest("[data-key-action]");
      var key = event.target.closest && event.target.closest("[data-token]");
      if (!actionButton || !key) return;
      var token = key.dataset.token;
      var phoneme = self.phonemes.filter(function(item) { return item.ipa === token; })[0] || null;
      if (!phoneme) return;
      self.selectedToken = token;
      self.renderBody();
      self.onAction({
        action: actionButton.dataset.keyAction,
        contextVowel: self.contextVowel,
        phoneme: phoneme,
        previewText: self.previewText(phoneme),
        token: token
      });
    });
  };

  PhonemeKeyboard.prototype.previewText = function(phoneme) {
    if (isVowel(phoneme)) return phoneme.ipa;
    return this.contextVowel + phoneme.ipa + this.contextVowel;
  };

  PhonemeKeyboard.prototype.setPhonemes = function(phonemes) {
    this.phonemes = (phonemes || []).slice();
    this.render();
  };

  PhonemeKeyboard.prototype.setSelectedToken = function(token) {
    this.selectedToken = token || "";
    this.renderBody();
  };

  PhonemeKeyboard.prototype.matchesSearch = function(phoneme) {
    var filter = this.searchValue.trim().toLowerCase();
    if (!filter) return true;
    return [phoneme.ipa, phoneme.label, phoneme.category, phoneme.templateType, phoneme.status].some(function(value) {
      return String(value || "").toLowerCase().indexOf(filter) !== -1;
    });
  };

  PhonemeKeyboard.prototype.categoryCounts = function() {
    var counts = {};
    CATEGORY_ORDER.forEach(function(item) { counts[item.id] = 0; });
    this.phonemes.forEach(function(phoneme) {
      var type = classify(phoneme);
      if (!counts.hasOwnProperty(type)) type = "other";
      counts[type] += 1;
    });
    return counts;
  };

  PhonemeKeyboard.prototype.render = function() {
    if (!this.container) return;
    var counts = this.categoryCounts();
    this.container.innerHTML =
      '<div class="pt-keyboard-controls">' +
        '<input type="search" data-keyboard-search value="' + escapeHtml(this.searchValue) + '" placeholder="Search phoneme">' +
        '<label><span>Consonant preview</span><select data-context-vowel>' +
          '<option value="a"' + (this.contextVowel === "a" ? " selected" : "") + '>a _ a</option>' +
          '<option value="i"' + (this.contextVowel === "i" ? " selected" : "") + '>i _ i</option>' +
          '<option value="u"' + (this.contextVowel === "u" ? " selected" : "") + '>u _ u</option>' +
        '</select></label>' +
      '</div>' +
      '<div class="pt-keyboard-tabs">' + CATEGORY_ORDER.map(function(item) {
        var active = item.id === this.category ? ' aria-pressed="true"' : ' aria-pressed="false"';
        return '<button type="button" data-keyboard-category="' + item.id + '"' + active + '>' +
          escapeHtml(item.label) + ' <span>' + (counts[item.id] || 0) + '</span></button>';
      }, this).join("") + '</div>' +
      '<div class="pt-keyboard-body"></div>';
    this.renderBody();
  };

  PhonemeKeyboard.prototype.renderBody = function() {
    if (!this.container) return;
    var body = this.container.querySelector(".pt-keyboard-body");
    if (!body) return;
    var rows = sortedForCategory(this.phonemes.filter(function(phoneme) {
      var type = classify(phoneme);
      if (CATEGORY_ORDER.map(function(item) { return item.id; }).indexOf(type) === -1) type = "other";
      return type === this.category && this.matchesSearch(phoneme);
    }, this), this.category);
    if (!rows.length) {
      body.innerHTML = '<p class="pt-muted">No phonemes in this section.</p>';
      return;
    }
    body.innerHTML = '<div class="pt-key-grid ' + (this.category === "vowel" ? "is-vowels" : "is-consonants") + '">' +
      rows.map(function(phoneme) {
        var selected = phoneme.ipa === this.selectedToken ? " is-selected" : "";
        var preview = this.previewText(phoneme);
        return '<div class="pt-key' + selected + '" data-token="' + escapeHtml(phoneme.ipa) + '">' +
          '<button type="button" class="pt-key-main" data-key-action="preview">' +
            '<strong>' + escapeHtml(phoneme.ipa) + '</strong>' +
            '<span>' + escapeHtml(phoneme.label || "") + '</span>' +
            '<small>' + escapeHtml(isVowel(phoneme) ? "preview: " + preview : "preview: " + preview) + '</small>' +
          '</button>' +
          '<div class="pt-key-actions">' +
            '<button type="button" data-key-action="insert">Insert</button>' +
            '<button type="button" data-key-action="load">Load</button>' +
          '</div>' +
          (phoneme.status ? '<em>' + escapeHtml(phoneme.status) + '</em>' : "") +
        '</div>';
      }, this).join("") +
    '</div>';
  };

  return {
    PhonemeKeyboard: PhonemeKeyboard,
    PHONEME_KEYBOARD_CATEGORIES: CATEGORY_ORDER
  };
});
