/* See Figure X — chart rendering and the touch drawing pad. */
(function () {
  'use strict';
  const S = window.GBScoring;

  const THEME = {
    bg: '#0d1526',
    grid: 'rgba(140, 170, 220, 0.10)',
    gridStrong: 'rgba(140, 170, 220, 0.22)',
    axis: '#7f93b8',
    text: '#c3d0ea',
    muted: '#7f93b8',
    truth: '#ffffff',
    font: '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSmall: '500 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontTitle: '700 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  };
  const SERIES_DASH = [[], [9, 6]];

  function niceStep(range, target) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function ticks(min, max, target) {
    const step = niceStep(max - min, target);
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  // Axis ticks. An axis with format "feet" holds inches and ticks on whole
  // 3, 6 or 12 inch steps so labels read like 5′6″.
  function axisTicks(axis, target) {
    if (axis.format !== 'feet') return ticks(axis.min, axis.max, target);
    const range = axis.max - axis.min;
    const step = [3, 6, 12].find((s) => range / s <= target) || 12;
    const out = [];
    for (let v = Math.ceil(axis.min / step) * step; v <= axis.max; v += step) out.push(v);
    return out;
  }

  function axisLabel(axis, v) {
    if (axis.format !== 'feet') return fmt(v);
    return `${Math.floor(v / 12)}′${Math.round(v % 12)}″`;
  }

  function fmt(v) {
    return String(+v.toFixed(2)).replace('-', '−');
  }

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 2);
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  class Chart {
    constructor(canvas, prompt) {
      this.canvas = canvas;
      this.prompt = prompt;
      this.ctx = canvas.getContext('2d');
      this.categorical = prompt.type === 'bar' || prompt.type === 'interaction';
      this.yr = prompt.type === 'distribution' ? { min: 0, max: 1 } : prompt.y;
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = Math.max(200, rect.width);
      this.h = Math.max(160, rect.height);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const compact = this.w < 420;
      const left = this.prompt.type === 'distribution' ? 34 : compact ? 52 : 62;
      const bottom = this.categorical ? (compact ? 62 : 66) : compact ? 50 : 54;
      this.plot = { l: left, t: 14, r: this.w - 14, b: this.h - bottom };
      this.plot.w = this.plot.r - this.plot.l;
      this.plot.h = this.plot.b - this.plot.t;
    }

    // ----- coordinate mapping -----
    xToPx(x) {
      const { min, max } = this.prompt.x;
      return this.plot.l + ((x - min) / (max - min)) * this.plot.w;
    }
    yToPx(y) {
      return this.plot.b - ((y - this.yr.min) / (this.yr.max - this.yr.min)) * this.plot.h;
    }
    pxToX(px) {
      const { min, max } = this.prompt.x;
      return min + ((px - this.plot.l) / this.plot.w) * (max - min);
    }
    pxToY(py) {
      return this.yr.min + ((this.plot.b - py) / this.plot.h) * (this.yr.max - this.yr.min);
    }
    band() {
      return this.plot.w / this.prompt.categories.length;
    }
    catCenter(i) {
      return this.plot.l + this.band() * (i + 0.5);
    }
    catAt(px) {
      const i = Math.floor((px - this.plot.l) / this.band());
      return Math.max(0, Math.min(this.prompt.categories.length - 1, i));
    }

    // ----- base -----
    drawAxes() {
      const { ctx, plot, prompt } = this;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(0, 0, this.w, this.h);

      // graph-paper grid
      ctx.lineWidth = 1;
      const minor = 24;
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath();
      for (let x = plot.l; x <= plot.r + 0.5; x += minor) {
        ctx.moveTo(Math.round(x) + 0.5, plot.t);
        ctx.lineTo(Math.round(x) + 0.5, plot.b);
      }
      for (let y = plot.b; y >= plot.t - 0.5; y -= minor) {
        ctx.moveTo(plot.l, Math.round(y) + 0.5);
        ctx.lineTo(plot.r, Math.round(y) + 0.5);
      }
      ctx.stroke();

      ctx.font = THEME.fontSmall;
      ctx.fillStyle = THEME.text;

      // y ticks
      if (prompt.type !== 'distribution') {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = THEME.gridStrong;
        ctx.beginPath();
        for (const v of axisTicks(this.yr, this.plot.h < 220 ? 4 : 6)) {
          const y = Math.round(this.yToPx(v)) + 0.5;
          ctx.moveTo(plot.l, y);
          ctx.lineTo(plot.r, y);
          ctx.fillText(axisLabel(this.yr, v), plot.l - 6, y);
        }
        ctx.stroke();
        if (this.yr.min < 0 && this.yr.max > 0) {
          ctx.strokeStyle = THEME.axis;
          ctx.beginPath();
          const y0 = Math.round(this.yToPx(0)) + 0.5;
          ctx.moveTo(plot.l, y0);
          ctx.lineTo(plot.r, y0);
          ctx.stroke();
        }
      }

      // x ticks / categories
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (this.categorical) {
        const bw = this.band();
        prompt.categories.forEach((c, i) => {
          const lines = wrap(ctx, c, bw - 4);
          lines.forEach((ln, k) => ctx.fillText(ln, this.catCenter(i), plot.b + 6 + k * 13));
        });
      } else {
        ctx.strokeStyle = THEME.gridStrong;
        ctx.beginPath();
        const target = Math.max(3, Math.min(8, Math.floor(plot.w / 70)));
        for (const v of axisTicks(prompt.x, target)) {
          const x = Math.round(this.xToPx(v)) + 0.5;
          ctx.moveTo(x, plot.t);
          ctx.lineTo(x, plot.b);
          ctx.fillText(axisLabel(prompt.x, v), x, plot.b + 6);
        }
        ctx.stroke();
      }

      // axes
      ctx.strokeStyle = THEME.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plot.l, plot.t);
      ctx.lineTo(plot.l, plot.b);
      ctx.lineTo(plot.r, plot.b);
      ctx.stroke();

      // axis titles
      ctx.fillStyle = THEME.text;
      ctx.font = THEME.fontTitle;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(prompt.xLabel, plot.l + plot.w / 2, this.h - 6);
      ctx.save();
      ctx.translate(13, plot.t + plot.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'middle';
      ctx.fillText(prompt.yLabel, 0, 0);
      ctx.restore();
    }

    // Clip drawing to the plot area.
    clipped(fn) {
      const { ctx, plot } = this;
      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.l, plot.t - 4, plot.w + 2, plot.h + 6);
      ctx.clip();
      fn(ctx);
      ctx.restore();
    }

    // ----- marks -----
    strokes(strokes, color, width = 3.5) {
      this.clipped((ctx) => {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of strokes) {
          if (s.length === 1) {
            ctx.beginPath();
            ctx.arc(this.xToPx(s[0][0]), this.yToPx(s[0][1]), width / 2 + 1, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.beginPath();
          s.forEach(([x, y], i) => (i ? ctx.lineTo(this.xToPx(x), this.yToPx(y)) : ctx.moveTo(this.xToPx(x), this.yToPx(y))));
          ctx.stroke();
        }
      });
    }

    // A sampled curve, optionally revealed left-to-right up to `progress` (0–1).
    curve(xs, ys, { color, width = 3, progress = 1, glow = false, alpha = 1 }) {
      const n = Math.max(2, Math.ceil(xs.length * progress));
      this.clipped((ctx) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (glow) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
        }
        ctx.beginPath();
        for (let i = 0; i < n && i < xs.length; i++) {
          const px = this.xToPx(xs[i]);
          const py = this.yToPx(ys[i]);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      });
    }

    // Bars. mode 'fill' draws solid bars; mode 'tick' draws a marker line at the
    // value, offset within the band so several players can share a category.
    bars(values, { color, mode = 'fill', progress = 1, slot = 0, slots = 1, alpha = 1, showEmpty = false }) {
      const { ctx } = this;
      const bw = this.band();
      const base = this.yToPx(Math.max(this.yr.min, Math.min(this.yr.max, 0)));
      values.forEach((v, i) => {
        const cx = this.catCenter(i);
        if (v === null || v === undefined) {
          if (showEmpty) {
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = hexToRgba(color, 0.5);
            ctx.lineWidth = 1.5;
            ctx.strokeRect(cx - bw * 0.3, this.plot.t + this.plot.h * 0.35, bw * 0.6, this.plot.b - (this.plot.t + this.plot.h * 0.35));
            ctx.fillStyle = THEME.muted;
            ctx.font = THEME.fontSmall;
            ctx.textAlign = 'center';
            ctx.fillText('tap', cx, this.plot.t + this.plot.h * 0.6);
            ctx.restore();
          }
          return;
        }
        const y = this.yToPx(this.yr.min + (v - this.yr.min) * progress);
        if (mode === 'fill') {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          const w = bw * 0.6;
          ctx.fillRect(cx - w / 2, Math.min(y, base), w, Math.abs(base - y));
          ctx.globalAlpha = 1;
        } else {
          const inner = bw * 0.7;
          const w = Math.max(6, inner / slots - 3);
          const x0 = cx - inner / 2 + (inner / slots) * slot + 1.5;
          ctx.fillStyle = color;
          ctx.fillRect(x0, y - 2, w, 4);
          ctx.beginPath();
          ctx.arc(x0 + w / 2, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // Two-series interaction plot. seriesValues: [[...],[...]]
    interaction(seriesValues, { color, colors, width = 3, progress = 1, glow = false, markerSize = 6 }) {
      const { ctx } = this;
      seriesValues.forEach((vals, si) => {
        const c = colors ? colors[si] : color;
        ctx.save();
        ctx.strokeStyle = c;
        ctx.fillStyle = c;
        ctx.lineWidth = width;
        ctx.setLineDash(SERIES_DASH[si]);
        if (glow) {
          ctx.shadowColor = c;
          ctx.shadowBlur = 12;
        }
        const pts = vals
          .map((v, i) => (v === null || v === undefined ? null : [this.catCenter(i), this.yToPx(this.yr.min + (v - this.yr.min) * progress)]))
          .filter(Boolean);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [x, y] of pts) {
          ctx.beginPath();
          if (si === 0) ctx.arc(x, y, markerSize, 0, Math.PI * 2);
          else ctx.rect(x - markerSize, y - markerSize, markerSize * 2, markerSize * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    // Draws a player's drawing in the form used on the reveal (scored curve).
    playerDrawing(drawing, color, opts = {}) {
      const p = this.prompt;
      if (!drawing) return;
      if (S.isFreehand(p)) {
        if (p.type === 'distribution') {
          const c = S.playerCurve(p, drawing);
          if (!c) return;
          const k = S.distributionDisplayScale(p);
          this.curve(c.xs, c.ys.map((y) => y * k), { color, width: opts.width || 2.5, alpha: opts.alpha || 0.95 });
        } else {
          this.strokes(drawing.strokes, hexToRgba(color, opts.alpha || 0.95), opts.width || 2.5);
        }
      } else if (p.type === 'bar') {
        this.bars(drawing.values, { color, mode: opts.barMode || 'tick', slot: opts.slot || 0, slots: opts.slots || 1, alpha: 0.85 });
      } else {
        this.interaction(drawing.series, { color, width: opts.width || 2.5, markerSize: 5 });
      }
    }

    // The real data, animated by progress (0–1).
    truth(progress = 1) {
      const p = this.prompt;
      if (S.isFreehand(p)) {
        const t = S.truthCurve(p);
        const k = p.type === 'distribution' ? S.distributionDisplayScale(p) : 1;
        this.curve(t.xs, t.ys.map((y) => y * k), { color: THEME.truth, width: 4.5, progress, glow: true });
      } else if (p.type === 'bar') {
        this.bars(p.values, { color: 'rgba(255,255,255,0.22)', mode: 'fill', progress });
        this.bars(
          p.values.map((v) => v),
          { color: THEME.truth, mode: 'tick', progress, slots: 1 }
        );
      } else {
        this.interaction(
          p.series.map((s) => s.values),
          { color: THEME.truth, width: 4, progress, glow: true, markerSize: 7 }
        );
      }
    }
  }

  // ---------- drawing pad ----------
  class Pad {
    constructor(canvas, prompt, color, onChange) {
      this.chart = new Chart(canvas, prompt);
      this.prompt = prompt;
      this.color = color;
      this.onChange = onChange;
      this.activeSeries = 0;
      this.enabled = true;
      this.drawing = Pad.empty(prompt);
      this.current = null;
      this.bind();
      this.render();
    }

    static empty(prompt) {
      if (S.isFreehand(prompt)) return { strokes: [] };
      const blank = () => prompt.categories.map(() => null);
      if (prompt.type === 'bar') return { values: blank() };
      return { series: [blank(), blank()] };
    }

    load(drawing) {
      if (drawing) this.drawing = JSON.parse(JSON.stringify(drawing));
      this.render();
    }

    isEmpty() {
      const d = this.drawing;
      if (d.strokes) return d.strokes.length === 0;
      const vals = d.values || [].concat(...d.series);
      return vals.every((v) => v === null);
    }

    clear() {
      this.drawing = Pad.empty(this.prompt);
      this.render();
      this.onChange(true);
    }

    undo() {
      const d = this.drawing;
      if (d.strokes) d.strokes.pop();
      else if (this.lastEdit) {
        const { list, i, prev } = this.lastEdit;
        list[i] = prev;
        this.lastEdit = null;
      }
      this.render();
      this.onChange(true);
    }

    bind() {
      const c = this.chart.canvas;
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      c.style.touchAction = 'none';
      c.onpointerdown = (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        c.setPointerCapture(e.pointerId);
        this.pointer = e.pointerId;
        this.start(...pos(e));
      };
      c.onpointermove = (e) => {
        if (!this.enabled || this.pointer !== e.pointerId) return;
        e.preventDefault();
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events.length ? events : [e]) this.move(...pos(ev));
        this.render();
      };
      const end = (e) => {
        if (this.pointer !== e.pointerId) return;
        this.pointer = null;
        this.current = null;
        this.onChange(true);
      };
      c.onpointerup = end;
      c.onpointercancel = end;
    }

    dataPoint(px, py) {
      const ch = this.chart;
      const x = Math.max(this.prompt.x.min, Math.min(this.prompt.x.max, ch.pxToX(px)));
      const y = Math.max(ch.yr.min, Math.min(ch.yr.max, ch.pxToY(py)));
      return [+x.toPrecision(6), +y.toPrecision(6)];
    }

    start(px, py) {
      if (S.isFreehand(this.prompt)) {
        this.current = [this.dataPoint(px, py)];
        this.drawing.strokes.push(this.current);
        this.lastPx = [px, py];
        this.render();
      } else {
        this.setColumn(px, py, true);
      }
    }

    move(px, py) {
      if (S.isFreehand(this.prompt)) {
        if (!this.current) return;
        const [lx, ly] = this.lastPx;
        if (Math.hypot(px - lx, py - ly) < 2) return;
        this.lastPx = [px, py];
        this.current.push(this.dataPoint(px, py));
      } else {
        this.setColumn(px, py, false);
      }
    }

    setColumn(px, py, isStart) {
      const ch = this.chart;
      const i = ch.catAt(px);
      const y = Math.max(ch.yr.min, Math.min(ch.yr.max, ch.pxToY(py)));
      const list = this.prompt.type === 'bar' ? this.drawing.values : this.drawing.series[this.activeSeries];
      if (isStart || !this.lastEdit || this.lastEdit.i !== i || this.lastEdit.list !== list) {
        this.lastEdit = { list, i, prev: list[i] };
      }
      list[i] = +y.toPrecision(5);
      this.render();
    }

    render() {
      const ch = this.chart;
      ch.drawAxes();
      const p = this.prompt;
      if (S.isFreehand(p)) ch.strokes(this.drawing.strokes, this.color, 4);
      else if (p.type === 'bar') ch.bars(this.drawing.values, { color: this.color, mode: 'fill', alpha: 0.9, showEmpty: true });
      else {
        // Inactive series is drawn dimmer.
        const colors = [0, 1].map((si) => (si === this.activeSeries ? this.color : hexToRgba(this.color, 0.4)));
        ch.interaction(this.drawing.series, { colors, width: 3.5, markerSize: 7 });
      }
    }

    resize() {
      this.chart.resize();
      this.render();
    }
  }

  window.GBChart = { Chart, Pad, THEME, SERIES_DASH, hexToRgba };
})();
