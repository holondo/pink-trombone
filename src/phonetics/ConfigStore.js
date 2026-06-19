(function(root, factory) {
  var api = factory(root.Phonetics || {}, root);
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns, root) {
  "use strict";

  function ConfigStore(options) {
    this.localStorageKey = (options && options.localStorageKey) || "pinkTrombone.ipaUserOverrides";
  }

  ConfigStore.prototype.empty = function() {
    return ns.normalizeOverrideDoc ? ns.normalizeOverrideDoc() : { version: 1, overrides: {} };
  };

  ConfigStore.prototype.load = function() {
    try {
      if (!root.localStorage) return this.empty();
      var raw = root.localStorage.getItem(this.localStorageKey);
      return raw && ns.normalizeOverrideDoc ? ns.normalizeOverrideDoc(JSON.parse(raw)) : this.empty();
    } catch (error) {
      return this.empty();
    }
  };

  ConfigStore.prototype.save = function(doc) {
    var normalized = ns.normalizeOverrideDoc ? ns.normalizeOverrideDoc(doc) : doc;
    normalized.updated_at = new Date().toISOString();
    if (root.localStorage) root.localStorage.setItem(this.localStorageKey, JSON.stringify(normalized, null, 2));
    return normalized;
  };

  ConfigStore.prototype.exportFile = function(doc, filename) {
    var normalized = ns.normalizeOverrideDoc ? ns.normalizeOverrideDoc(doc) : doc;
    var blob = new Blob([JSON.stringify(normalized, null, 2) + "\n"], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename || "ipa_user_overrides.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function() {
      URL.revokeObjectURL(link.href);
    }, 1000);
  };

  ConfigStore.prototype.importFile = function(file) {
    return file.text().then(function(text) {
      var parsed = JSON.parse(text);
      return ns.normalizeOverrideDoc ? ns.normalizeOverrideDoc(parsed) : parsed;
    });
  };

  ConfigStore.prototype.canSaveDirectly = function() {
    return typeof root.showSaveFilePicker === "function";
  };

  ConfigStore.prototype.saveDirectly = function(doc) {
    if (!this.canSaveDirectly()) return Promise.reject(new Error("File System Access API is not available."));
    var normalized = ns.normalizeOverrideDoc ? ns.normalizeOverrideDoc(doc) : doc;
    return root.showSaveFilePicker({
      suggestedName: "ipa_user_overrides.json",
      types: [{
        description: "JSON",
        accept: { "application/json": [".json"] }
      }]
    }).then(function(handle) {
      return handle.createWritable();
    }).then(function(writable) {
      return writable.write(JSON.stringify(normalized, null, 2) + "\n").then(function() {
        return writable.close();
      });
    });
  };

  return {
    ConfigStore: ConfigStore
  };
});
