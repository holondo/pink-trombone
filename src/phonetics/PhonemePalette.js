(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function PhonemePalette(container, options) {
    this.container = container;
    this.options = options || {};
    this.phonemes = [];
    this.filtered = [];
    this.selectedToken = "";
    this.searchValue = "";
    this.actions = this.options.actions || [];
    this.onAction = this.options.onAction || function() {};
    this.placeholder = this.options.placeholder || "Search phoneme";
    this.emptyText = this.options.emptyText || "No phonemes found.";
    this.maxRows = this.options.maxRows || 80;
    this.bind();
  }

  PhonemePalette.prototype.bind = function() {
    var self = this;
    if (!this.container) return;
    this.container.addEventListener("input", function(event) {
      if (event.target && event.target.dataset.paletteSearch !== undefined) {
        self.searchValue = event.target.value || "";
        self.renderRows();
      }
    });
    this.container.addEventListener("click", function(event) {
      var actionButton = event.target.closest && event.target.closest("[data-palette-action]");
      var row = event.target.closest && event.target.closest("[data-token]");
      if (!row) return;
      var token = row.dataset.token;
      var phoneme = self.phonemes.filter(function(item) { return item.ipa === token; })[0] || null;
      if (!phoneme) return;
      var action = actionButton ? actionButton.dataset.paletteAction : (self.options.rowAction || "select");
      self.selectedToken = token;
      self.renderRows();
      self.onAction({
        action: action,
        token: token,
        phoneme: phoneme,
        event: event
      });
    });
  };

  PhonemePalette.prototype.setActions = function(actions) {
    this.actions = actions || [];
    this.render();
  };

  PhonemePalette.prototype.setPhonemes = function(phonemes) {
    this.phonemes = (phonemes || []).slice();
    this.render();
  };

  PhonemePalette.prototype.setSelectedToken = function(token) {
    this.selectedToken = token || "";
    this.renderRows();
  };

  PhonemePalette.prototype.matches = function(phoneme) {
    var filter = this.searchValue.toLowerCase().trim();
    if (!filter) return true;
    return [phoneme.ipa, phoneme.label, phoneme.category, phoneme.templateType, phoneme.status].some(function(value) {
      return String(value || "").toLowerCase().indexOf(filter) !== -1;
    });
  };

  PhonemePalette.prototype.render = function() {
    if (!this.container) return;
    this.container.innerHTML =
      '<input class="pt-palette-search" data-palette-search type="search" value="' + escapeHtml(this.searchValue) + '" placeholder="' + escapeHtml(this.placeholder) + '">' +
      '<div class="pt-palette-list"></div>';
    this.renderRows();
  };

  PhonemePalette.prototype.renderRows = function() {
    if (!this.container) return;
    var list = this.container.querySelector(".pt-palette-list");
    if (!list) return;
    var rows = this.phonemes.filter(this.matches, this).slice(0, this.maxRows);
    if (!rows.length) {
      list.innerHTML = '<p class="pt-muted">' + escapeHtml(this.emptyText) + "</p>";
      return;
    }
    list.innerHTML = rows.map(function(phoneme) {
      var template = phoneme.templateType || (ns.getCalibrationTemplate ? ns.getCalibrationTemplate(phoneme).type : phoneme.category);
      var selected = phoneme.ipa === this.selectedToken ? " is-selected" : "";
      var actions = this.actions.map(function(action) {
        return '<button type="button" data-palette-action="' + escapeHtml(action.id) + '">' + escapeHtml(action.label) + "</button>";
      }).join("");
      return '<div class="pt-palette-row' + selected + '" data-token="' + escapeHtml(phoneme.ipa) + '">' +
        '<button type="button" class="pt-token-button" data-palette-action="' + escapeHtml(this.options.rowAction || "select") + '">' +
        '<strong>' + escapeHtml(phoneme.ipa) + '</strong><span>' + escapeHtml(template) + '</span><small>' + escapeHtml(phoneme.label || "") + '</small></button>' +
        '<div class="pt-palette-actions">' + actions + '</div>' +
        (phoneme.status ? '<em>' + escapeHtml(phoneme.status) + '</em>' : "") +
      "</div>";
    }, this).join("");
  };

  return {
    PhonemePalette: PhonemePalette
  };
});
