(function(root, factory) {
  var api = factory(root.Phonetics || {});
  root.Phonetics = root.Phonetics || {};
  for (var key in api) root.Phonetics[key] = api[key];
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function(ns) {
  "use strict";

  function TractOverlayRenderer(synth) {
    this.synth = synth;
    this.visible = true;
    this.layers = {};
    this.activeLabel = "";
  }

  TractOverlayRenderer.prototype.setLayers = function(layers) {
    this.layers = layers || {};
  };

  TractOverlayRenderer.prototype.setActiveLabel = function(label) {
    this.activeLabel = label || "";
  };

  TractOverlayRenderer.prototype.point = function(index, diameter) {
    var ui = this.synth.TractUI;
    var tract = this.synth.Tract;
    var angle = ui.angleOffset + index * ui.angleScale * Math.PI / (tract.lipStart - 1);
    var radius = ui.radius - ui.scale * diameter;
    return {
      x: ui.originX - radius * Math.cos(angle),
      y: ui.originY - radius * Math.sin(angle)
    };
  };

  TractOverlayRenderer.prototype.drawConstriction = function(ctx, constriction, style, label) {
    var index = Number(constriction.index);
    var diameter = Number(constriction.diameter);
    if (!Number.isFinite(index) || !Number.isFinite(diameter)) return;
    var p = this.point(index, diameter);
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.alpha;
    ctx.lineWidth = style.width || 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9 + Math.max(0, 1 - diameter) * 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 28);
    ctx.lineTo(p.x, p.y + 28);
    ctx.stroke();
    ctx.font = "bold 12px Quicksand";
    ctx.textAlign = "center";
    ctx.globalAlpha = Math.min(1, style.alpha + 0.15);
    ctx.fillText(label || constriction.label || "constriction", p.x, p.y - 34);
    ctx.restore();
  };

  TractOverlayRenderer.prototype.drawTongue = function(ctx, params, style, label) {
    if (!params || !params.tract) return;
    var index = params.tract.tongue_index;
    var diameter = params.tract.tongue_diameter;
    if (index === null || index === undefined || diameter === null || diameter === undefined) return;
    var p = this.point(Number(index), Number(diameter));
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.alpha;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 12px Quicksand";
    ctx.textAlign = "center";
    ctx.fillText(label, p.x, p.y + 28);
    ctx.restore();
  };

  TractOverlayRenderer.prototype.drawVelum = function(ctx, params, style, label) {
    if (!params || !params.tract) return;
    var velum = Number(params.tract.velum_target || 0.01);
    var ui = this.synth.TractUI;
    var p = this.point(this.synth.Tract.noseStart + velum * 12, -ui.noseOffset);
    ctx.save();
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.alpha;
    ctx.font = "bold 12px Quicksand";
    ctx.textAlign = "left";
    ctx.fillText(label + " velum " + velum.toFixed(2), p.x + 8, p.y - 8);
    ctx.restore();
  };

  TractOverlayRenderer.prototype.drawLegend = function(ctx) {
    var items = [
      ["base", "#6b7280"],
      ["saved", "#7c3aed"],
      ["draft", "#0f766e"],
      ["recording", "#d97706"]
    ];
    ctx.save();
    ctx.font = "bold 12px Quicksand";
    ctx.textAlign = "left";
    ctx.globalAlpha = 0.95;
    var y = 34;
    if (this.activeLabel) {
      ctx.fillStyle = "#2f2a35";
      ctx.fillText("Active: " + this.activeLabel, 20, y);
      y += 18;
    }
    items.forEach(function(item) {
      ctx.fillStyle = item[1];
      ctx.fillRect(20, y - 9, 10, 10);
      ctx.fillStyle = "#2f2a35";
      ctx.fillText(item[0], 36, y);
      y += 15;
    });
    ctx.restore();
  };

  TractOverlayRenderer.prototype.draw = function() {
    if (!this.visible) return;
    var ctx = this.synth.tractCtx || (typeof tractCtx !== "undefined" ? tractCtx : null);
    if (!ctx) return;
    var styles = {
      base: { color: "#6b7280", alpha: 0.38, width: 2 },
      saved: { color: "#7c3aed", alpha: 0.62, width: 3 },
      draft: { color: "#0f766e", alpha: 0.78, width: 4 },
      recording: { color: "#d97706", alpha: 0.82, width: 4 }
    };
    Object.keys(styles).forEach(function(key) {
      var params = this.layers[key];
      if (!params) return;
      this.drawTongue(ctx, params, styles[key], key);
      this.drawVelum(ctx, params, styles[key], key);
      ((params.tract && params.tract.constrictions) || []).forEach(function(constriction) {
        this.drawConstriction(ctx, constriction, styles[key], key);
      }, this);
    }, this);
    this.drawLegend(ctx);
  };

  return {
    TractOverlayRenderer: TractOverlayRenderer
  };
});
