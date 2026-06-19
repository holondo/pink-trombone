(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  var DEFAULT_PREFIX_MARKS = ["\u02c8", "\u02cc", "\ua71b", "\ua71c"];
  var DEFAULT_BOUNDARIES = [".", "|", "\u2016", "/", "[", "]", "(", ")", ",", ";"];

  function firstCodePoint(value, index) {
    var point = value.codePointAt(index);
    var char = String.fromCodePoint(point);
    return {
      char: char,
      length: point > 0xffff ? 2 : 1
    };
  }

  function isWhitespace(char) {
    return /\s/.test(char);
  }

  function normalizeOptions(options) {
    options = options || {};
    var tokenList = (options.tokens || []).slice().sort(function(left, right) {
      return right.length - left.length || left.localeCompare(right);
    });
    var diacritics = (options.diacritics || []).slice().sort(function(left, right) {
      return right.length - left.length || left.localeCompare(right);
    });
    var boundaryMap = {};
    DEFAULT_BOUNDARIES.concat(options.boundaries || []).forEach(function(value) {
      boundaryMap[value] = true;
    });
    var prefixMap = {};
    DEFAULT_PREFIX_MARKS.concat(options.prefixMarks || []).forEach(function(value) {
      prefixMap[value] = true;
    });
    return {
      tokens: tokenList,
      diacritics: diacritics,
      boundaryMap: boundaryMap,
      prefixMap: prefixMap
    };
  }

  function matchOne(input, index, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      if (input.slice(index, index + candidates[i].length) === candidates[i]) return candidates[i];
    }
    return "";
  }

  function IPATokenizer(options) {
    this.options = normalizeOptions(options || {});
  }

  IPATokenizer.prototype.setOptions = function(options) {
    this.options = normalizeOptions(options || {});
  };

  IPATokenizer.prototype.isBoundaryAt = function(input, index) {
    var point = firstCodePoint(input, index);
    return isWhitespace(point.char) || this.options.boundaryMap[point.char];
  };

  IPATokenizer.prototype.collectTrailingDiacritics = function(input, index) {
    var marks = [];
    var current = index;
    while (current < input.length) {
      if (this.isBoundaryAt(input, current)) break;
      var mark = matchOne(input, current, this.options.diacritics);
      if (!mark) break;
      marks.push(mark);
      current += mark.length;
    }
    return {
      marks: marks,
      index: current
    };
  };

  IPATokenizer.prototype.tokenize = function(input) {
    var text = String(input || "").normalize("NFC");
    var tokens = [];
    var warnings = [];
    var index = 0;
    var pendingPrefix = [];

    while (index < text.length) {
      var point = firstCodePoint(text, index);
      if (isWhitespace(point.char) || this.options.boundaryMap[point.char]) {
        pendingPrefix = [];
        index += point.length;
        continue;
      }

      var prefix = matchOne(text, index, this.options.diacritics);
      if (prefix && this.options.prefixMap[prefix]) {
        pendingPrefix.push(prefix);
        index += prefix.length;
        continue;
      }

      var match = matchOne(text, index, this.options.tokens);
      if (match) {
        var trailing = this.collectTrailingDiacritics(text, index + match.length);
        var raw = pendingPrefix.join("") + match + trailing.marks.join("");
        tokens.push({
          token: raw,
          raw: raw,
          base: match,
          diacritics: pendingPrefix.concat(trailing.marks),
          index: index
        });
        pendingPrefix = [];
        index = trailing.index;
        continue;
      }

      var diacritic = matchOne(text, index, this.options.diacritics);
      if (diacritic) {
        warnings.push({
          token: diacritic,
          index: index,
          message: "Ignoring unattached IPA diacritic " + diacritic
        });
        index += diacritic.length;
        continue;
      }

      var unknownStart = index;
      var unknown = point.char;
      index += point.length;
      warnings.push({
        token: unknown,
        index: unknownStart,
        message: "Unknown IPA token " + unknown
      });
      pendingPrefix = [];
    }

    return {
      tokens: tokens,
      warnings: warnings
    };
  };

  return {
    IPATokenizer: IPATokenizer
  };
});
