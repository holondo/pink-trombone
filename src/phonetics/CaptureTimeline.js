(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function() {
  "use strict";

  var PHASE_COLORS = {
    sustain: "#0f766e",
    target: "#0f766e",
    closure: "#9f1239",
    "nasal closure": "#7c3aed",
    frication: "#d97706",
    contact: "#be123c",
    velum: "#7c3aed",
    release: "#2563eb",
    context: "#64748b"
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function number(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : fallback;
  }

  function CaptureTimeline(canvas, options) {
    this.canvas = canvas;
    this.options = options || {};
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.frames = [];
    this.phases = [];
    this.selection = { startMs: 0, endMs: 1 };
    this.durationMs = 1;
    this.playheadMs = 0;
    this.selectedPhaseId = "";
    this.dragMode = "";
    this.dragged = false;
    this.cssWidth = 0;
    this.cssHeight = 232;
    this.labelWidth = 88;
    this.bind();
    this.resize();
  }

  CaptureTimeline.prototype.bind = function() {
    if (!this.canvas) return;
    var self = this;
    this.canvas.addEventListener("pointerdown", function(event) { self.pointerDown(event); });
    this.canvas.addEventListener("pointermove", function(event) { self.pointerMove(event); });
    this.canvas.addEventListener("pointerup", function(event) { self.pointerUp(event); });
    this.canvas.addEventListener("pointercancel", function(event) { self.pointerUp(event); });
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(function() { self.resize(); });
      this.resizeObserver.observe(this.canvas);
    }
  };

  CaptureTimeline.prototype.resize = function() {
    if (!this.canvas || !this.ctx) return;
    var rect = this.canvas.getBoundingClientRect();
    var dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
    this.cssWidth = Math.max(320, rect.width || this.canvas.clientWidth || 720);
    this.cssHeight = Math.max(210, rect.height || this.canvas.clientHeight || 232);
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  CaptureTimeline.prototype.setData = function(data) {
    data = data || {};
    this.frames = data.frames || [];
    this.phases = data.phases || [];
    this.durationMs = Math.max(1, number(data.durationMs, this.frames.length ? number(this.frames[this.frames.length - 1].t, 1) : 1));
    this.selection = data.selection || this.selection || { startMs: 0, endMs: this.durationMs };
    this.selectedPhaseId = data.selectedPhaseId === undefined ? this.selectedPhaseId : data.selectedPhaseId;
    this.playheadMs = clamp(number(data.playheadMs, this.playheadMs), 0, this.durationMs);
    this.draw();
  };

  CaptureTimeline.prototype.setPlayhead = function(timeMs) {
    this.playheadMs = clamp(number(timeMs, 0), 0, this.durationMs);
    this.draw();
  };

  CaptureTimeline.prototype.plotLeft = function() {
    return this.labelWidth;
  };

  CaptureTimeline.prototype.plotRight = function() {
    return Math.max(this.labelWidth + 1, this.cssWidth - 12);
  };

  CaptureTimeline.prototype.xForTime = function(timeMs) {
    return this.plotLeft() + clamp(timeMs / this.durationMs, 0, 1) * (this.plotRight() - this.plotLeft());
  };

  CaptureTimeline.prototype.timeForX = function(x) {
    return clamp((x - this.plotLeft()) / Math.max(1, this.plotRight() - this.plotLeft()), 0, 1) * this.durationMs;
  };

  CaptureTimeline.prototype.eventPoint = function(event) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  CaptureTimeline.prototype.selectedPhase = function() {
    var id = this.selectedPhaseId;
    return this.phases.filter(function(item) { return item.id === id; })[0] || null;
  };

  CaptureTimeline.prototype.editRange = function() {
    return this.selectedPhase() || this.selection;
  };

  CaptureTimeline.prototype.pointerDown = function(event) {
    if (!this.frames.length) return;
    var point = this.eventPoint(event);
    this.dragged = false;
    if (point.y <= 28) {
      var time = this.timeForX(point.x);
      var found = this.phases.filter(function(item) {
        return time >= item.startMs && time <= item.endMs;
      })[0] || null;
      this.selectedPhaseId = found ? found.id : "";
      if (this.options.onPhaseSelect) this.options.onPhaseSelect(found);
      this.draw();
      return;
    }
    var range = this.editRange();
    var startX = this.xForTime(range.startMs);
    var endX = this.xForTime(range.endMs);
    if (Math.abs(point.x - startX) <= 9) this.dragMode = "start";
    else if (Math.abs(point.x - endX) <= 9) this.dragMode = "end";
    else this.dragMode = "scrub";
    if (this.canvas.setPointerCapture) this.canvas.setPointerCapture(event.pointerId);
    this.updatePointer(point);
  };

  CaptureTimeline.prototype.pointerMove = function(event) {
    if (!this.dragMode) return;
    this.dragged = true;
    this.updatePointer(this.eventPoint(event));
  };

  CaptureTimeline.prototype.pointerUp = function(event) {
    if (!this.dragMode) return;
    this.updatePointer(this.eventPoint(event));
    this.dragMode = "";
    if (this.canvas.releasePointerCapture) {
      try { this.canvas.releasePointerCapture(event.pointerId); } catch (error) {}
    }
  };

  CaptureTimeline.prototype.updatePointer = function(point) {
    var time = this.timeForX(point.x);
    var range = this.editRange();
    if (this.dragMode === "start") {
      range.startMs = clamp(Math.round(time), 0, range.endMs - 1);
      this.emitRange(range);
    } else if (this.dragMode === "end") {
      range.endMs = clamp(Math.round(time), range.startMs + 1, this.durationMs);
      this.emitRange(range);
    } else {
      this.playheadMs = time;
      if (this.options.onScrub) this.options.onScrub(time, this.frameAt(time));
    }
    this.draw();
  };

  CaptureTimeline.prototype.emitRange = function(range) {
    var selected = this.selectedPhase();
    if (selected) {
      if (this.options.onPhaseChange) this.options.onPhaseChange(selected);
    } else if (this.options.onSelectionChange) {
      this.options.onSelectionChange(this.selection);
    }
  };

  CaptureTimeline.prototype.frameAt = function(timeMs) {
    if (!this.frames.length) return null;
    var best = this.frames[0];
    var bestDistance = Math.abs(number(best.t, 0) - timeMs);
    for (var i = 1; i < this.frames.length; i++) {
      var distance = Math.abs(number(this.frames[i].t, 0) - timeMs);
      if (distance < bestDistance) {
        best = this.frames[i];
        bestDistance = distance;
      }
    }
    return best;
  };

  CaptureTimeline.prototype.drawLabel = function(label, y) {
    var ctx = this.ctx;
    ctx.fillStyle = "#475569";
    ctx.font = "11px Quicksand, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(label, this.labelWidth - 9, y);
  };

  CaptureTimeline.prototype.drawPhases = function() {
    var ctx = this.ctx;
    this.drawLabel("Phases", 18);
    ctx.fillStyle = "#eef2f0";
    ctx.fillRect(this.plotLeft(), 4, this.plotRight() - this.plotLeft(), 22);
    this.phases.forEach(function(item) {
      var left = this.xForTime(item.startMs);
      var right = this.xForTime(item.endMs);
      ctx.globalAlpha = item.included === false ? 0.25 : 0.9;
      ctx.fillStyle = PHASE_COLORS[item.type] || "#64748b";
      ctx.fillRect(left, 4, Math.max(1, right - left), 22);
      if (right - left > 38) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px Quicksand, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(item.label || item.type, (left + right) / 2, 18);
      }
      if (item.id === this.selectedPhaseId) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2;
        ctx.strokeRect(left + 1, 5, Math.max(0, right - left - 2), 20);
      }
      if (item.edits && Object.keys(item.edits).length) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px Quicksand, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("●", right - 4, 18);
      }
    }, this);
    ctx.globalAlpha = 1;
  };

  CaptureTimeline.prototype.drawHeatmap = function(top, height) {
    var ctx = this.ctx;
    var left = this.plotLeft();
    var width = this.plotRight() - left;
    this.drawLabel("Tract", top + height / 2 + 4);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(left, top, width, height);
    if (!this.frames.length) return;
    var columns = Math.max(1, Math.floor(width));
    for (var x = 0; x < columns; x++) {
      var frame = this.frameAt((x / Math.max(1, columns - 1)) * this.durationMs);
      var diameters = frame && frame.tract && frame.tract.targetDiameter || [];
      if (!diameters.length) continue;
      var rowHeight = height / diameters.length;
      for (var index = 0; index < diameters.length; index++) {
        var diameter = clamp(number(diameters[index], 1.5), 0, 3.5);
        var closed = 1 - clamp(diameter / 1.5, 0, 1);
        var red = Math.round(217 - closed * 68);
        var green = Math.round(238 - closed * 196);
        var blue = Math.round(232 - closed * 170);
        ctx.fillStyle = "rgb(" + red + "," + green + "," + blue + ")";
        ctx.fillRect(left + x, top + index * rowHeight, 1.5, Math.max(1, rowHeight + 0.2));
      }
    }
  };

  CaptureTimeline.prototype.drawCurve = function(label, top, height, getter, min, max, color) {
    var ctx = this.ctx;
    var left = this.plotLeft();
    var width = this.plotRight() - left;
    this.drawLabel(label, top + height / 2 + 4);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top + height / 2);
    ctx.lineTo(left + width, top + height / 2);
    ctx.stroke();
    if (!this.frames.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    this.frames.forEach(function(frame, index) {
      var value = clamp(number(getter(frame), min), min, max);
      var x = this.xForTime(number(frame.t, 0));
      var y = top + height - ((value - min) / Math.max(0.0001, max - min)) * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }, this);
    ctx.stroke();
  };

  CaptureTimeline.prototype.drawSelection = function() {
    var ctx = this.ctx;
    var range = this.editRange();
    if (!range) return;
    var startX = this.xForTime(range.startMs);
    var endX = this.xForTime(range.endMs);
    ctx.fillStyle = "rgba(15, 118, 110, 0.08)";
    ctx.fillRect(startX, 28, Math.max(1, endX - startX), this.cssHeight - 34);
    [startX, endX].forEach(function(x) {
      ctx.strokeStyle = "#0f766e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.lineTo(x, this.cssHeight - 6);
      ctx.stroke();
      ctx.fillStyle = "#0f766e";
      ctx.fillRect(x - 4, 29, 8, 12);
    }, this);
  };

  CaptureTimeline.prototype.drawPlayhead = function() {
    var x = this.xForTime(this.playheadMs);
    var ctx = this.ctx;
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x, this.cssHeight - 5);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(x - 4, 1);
    ctx.lineTo(x + 4, 1);
    ctx.lineTo(x, 7);
    ctx.fill();
  };

  CaptureTimeline.prototype.draw = function() {
    if (!this.ctx || !this.canvas) return;
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.drawPhases();
    this.drawHeatmap(32, 92);
    this.drawCurve("Velum", 128, 26, function(frame) { return frame.tract.velum_target; }, 0, 0.5, "#7c3aed");
    this.drawCurve("Turbulence", 158, 26, function(frame) {
      return Math.max.apply(null, [0].concat((frame.touches || []).map(function(touch) { return number(touch.fricative_intensity, 0); })));
    }, 0, 1, "#d97706");
    this.drawCurve("Voice", 188, 26, function(frame) { return frame.glottis.intensity; }, 0, 1, "#0f766e");
    this.drawSelection();
    this.drawPlayhead();
  };

  return {
    CaptureTimeline: CaptureTimeline,
    CAPTURE_PHASE_COLORS: PHASE_COLORS
  };
});
