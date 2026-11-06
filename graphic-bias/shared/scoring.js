/*
 * Graphic Bias — shared scoring and curve math.
 * Loaded by the Node server (require) and by the browser (window.GBScoring),
 * so the score a player sees is computed by exactly the same code the server uses.
 *
 * Score for a round = 100 − error, where
 *   error = round(100 × RMSE / scale), clamped to 0–100
 *   scale = height of the chart's y-axis (line, trend, bar, interaction)
 *         = peak height of the true curve (distribution; both curves are first
 *           rescaled to the same area, so only the shape is judged)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GBScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SAMPLES = 80; // points along the x-axis at which drawings are compared
  const FREEHAND_TYPES = ['line', 'trend', 'distribution'];
  const TYPES = FREEHAND_TYPES.concat(['bar', 'interaction']);

  // Limits for sanitizing drawings sent by clients.
  const MAX_STROKES = 60;
  const MAX_POINTS = 6000;

  function linspace(a, b, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
    return out;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // Linear interpolation through points sorted by x; flat beyond the ends.
  function interpPoints(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    const last = pts[pts.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      if (x <= x1) {
        const [x0, y0] = pts[i - 1];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return last[1];
  }

  // Abramowitz & Stegun 7.1.26 (max error ~1.5e-7).
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x);
    return s * y;
  }

  function normPdf(x, mean, sd) {
    const z = (x - mean) / sd;
    return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
  }

  function normCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  // Probability density for the distribution specs used in data/prompts.json.
  function density(dist, x) {
    switch (dist.kind) {
      case 'mixture':
        return dist.components.reduce((s, c) => s + c.w * normPdf(x, c.mean, c.sd), 0);
      case 'splitNormal': {
        const { mode, sdLeft, sdRight } = dist;
        const sd = x < mode ? sdLeft : sdRight;
        const c = 2 / (Math.sqrt(2 * Math.PI) * (sdLeft + sdRight));
        return c * Math.exp(-((x - mode) ** 2) / (2 * sd * sd));
      }
      case 'exGaussian': {
        const { mu, sigma, tau } = dist;
        const expo = (sigma * sigma) / (2 * tau * tau) - (x - mu) / tau;
        return (1 / tau) * Math.exp(expo) * normCdf((x - mu) / sigma - sigma / tau);
      }
      case 'logNormal': {
        if (x <= 0) return 0;
        const { median, sigma } = dist;
        const z = (Math.log(x) - Math.log(median)) / sigma;
        return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI));
      }
      default:
        throw new Error('Unknown distribution kind: ' + dist.kind);
    }
  }

  function isFreehand(prompt) {
    return FREEHAND_TYPES.includes(prompt.type);
  }

  // The x positions at which a freehand prompt is judged.
  function sampleXs(prompt) {
    if (prompt.type === 'distribution') return linspace(prompt.x.min, prompt.x.max, SAMPLES);
    const pts = prompt.points;
    return linspace(pts[0][0], pts[pts.length - 1][0], SAMPLES);
  }

  // The true curve for a freehand prompt, in data units.
  function truthCurve(prompt) {
    const xs = sampleXs(prompt);
    const ys =
      prompt.type === 'distribution'
        ? xs.map((x) => density(prompt.dist, x))
        : xs.map((x) => interpPoints(prompt.points, x));
    return { xs, ys };
  }

  // Distributions are drawn on a unitless 0–1 y-axis. This scale maps the true
  // density so its peak sits at 85% of the chart height.
  function distributionDisplayScale(prompt) {
    const { ys } = truthCurve(prompt);
    return 0.85 / Math.max(...ys);
  }

  // Turn freehand strokes into one y value per sample x. Each stroke segment
  // contributes wherever it crosses a sample x; overlapping strokes are averaged;
  // gaps are bridged linearly and the ends are extended flat.
  function rasterizeStrokes(strokes, xs) {
    const n = xs.length;
    const x0 = xs[0];
    const step = (xs[n - 1] - x0) / (n - 1);
    const sums = new Array(n).fill(0);
    const counts = new Array(n).fill(0);
    const add = (k, y) => {
      if (k >= 0 && k < n) {
        sums[k] += y;
        counts[k] += 1;
      }
    };

    for (const stroke of strokes) {
      let crossed = false;
      for (let i = 0; i + 1 < stroke.length; i++) {
        const [ax, ay] = stroke[i];
        const [bx, by] = stroke[i + 1];
        const lo = Math.min(ax, bx);
        const hi = Math.max(ax, bx);
        const k0 = Math.max(0, Math.ceil((lo - x0) / step - 1e-9));
        const k1 = Math.min(n - 1, Math.floor((hi - x0) / step + 1e-9));
        for (let k = k0; k <= k1; k++) {
          const x = xs[k];
          const y = ax === bx ? (ay + by) / 2 : ay + ((by - ay) * (x - ax)) / (bx - ax);
          add(k, y);
          crossed = true;
        }
      }
      if (!crossed) {
        // A dot or a tiny squiggle between two samples: snap to the nearest sample.
        for (const [x, y] of stroke) add(Math.round((x - x0) / step), y);
      }
    }

    const ys = sums.map((s, k) => (counts[k] ? s / counts[k] : null));
    const known = [];
    ys.forEach((y, k) => {
      if (y !== null) known.push(k);
    });
    if (!known.length) return null;
    for (let k = 0; k < n; k++) {
      if (ys[k] !== null) continue;
      const prev = known.filter((j) => j < k).pop();
      const next = known.find((j) => j > k);
      if (prev === undefined) ys[k] = ys[next];
      else if (next === undefined) ys[k] = ys[prev];
      else ys[k] = ys[prev] + ((ys[next] - ys[prev]) * (k - prev)) / (next - prev);
    }
    return ys;
  }

  const sum = (a) => a.reduce((s, v) => s + v, 0);

  // A player's freehand drawing as a curve comparable to truthCurve().
  // For distributions the curve is clipped at 0 and rescaled to the true area.
  function playerCurve(prompt, drawing) {
    if (!drawing || !drawing.strokes) return null;
    const xs = sampleXs(prompt);
    let ys = rasterizeStrokes(drawing.strokes, xs);
    if (!ys) return null;
    if (prompt.type === 'distribution') {
      ys = ys.map((y) => Math.max(0, y));
      const area = sum(ys);
      if (area <= 0) return null;
      const target = sum(truthCurve(prompt).ys);
      ys = ys.map((y) => (y * target) / area);
    }
    return { xs, ys };
  }

  function truthValues(prompt) {
    if (prompt.type === 'bar') return prompt.values.slice();
    return [].concat(...prompt.series.map((s) => s.values));
  }

  // Bars or interaction points the player left unset count as the axis floor.
  function playerValues(prompt, drawing) {
    if (!drawing) return null;
    const raw = prompt.type === 'bar' ? drawing.values : drawing.series && [].concat(...drawing.series);
    if (!raw || raw.every((v) => v === null || v === undefined)) return null;
    return raw.map((v) => (v === null || v === undefined ? prompt.y.min : v));
  }

  function rmse(a, b) {
    return Math.sqrt(sum(a.map((v, i) => (v - b[i]) ** 2)) / a.length);
  }

  // Score one drawing. Returns { errorPct, score, empty }.
  function scoreDrawing(prompt, drawing) {
    let truth, player, scale;
    if (isFreehand(prompt)) {
      const t = truthCurve(prompt);
      const p = playerCurve(prompt, drawing);
      truth = t.ys;
      player = p && p.ys;
      scale = prompt.type === 'distribution' ? Math.max(...t.ys) : prompt.y.max - prompt.y.min;
    } else {
      truth = truthValues(prompt);
      player = playerValues(prompt, drawing);
      scale = prompt.y.max - prompt.y.min;
    }
    if (!player) return { errorPct: 100, score: 0, empty: true };
    const errorPct = clamp(Math.round((100 * rmse(player, truth)) / scale), 0, 100);
    return { errorPct, score: 100 - errorPct, empty: false };
  }

  // Validate and clamp a drawing received from a client. Returns null if unusable.
  function sanitizeDrawing(prompt, d) {
    if (!d || typeof d !== 'object') return null;
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const yMin = prompt.type === 'distribution' ? 0 : prompt.y.min;
    const yMax = prompt.type === 'distribution' ? 1 : prompt.y.max;
    const cy = (v) => clamp(v, yMin, yMax);

    if (isFreehand(prompt)) {
      if (!Array.isArray(d.strokes)) return null;
      let budget = MAX_POINTS;
      const strokes = [];
      for (const s of d.strokes.slice(0, MAX_STROKES)) {
        if (!Array.isArray(s)) continue;
        const pts = [];
        for (const p of s) {
          if (budget <= 0) break;
          if (Array.isArray(p) && num(p[0]) && num(p[1])) {
            pts.push([clamp(p[0], prompt.x.min, prompt.x.max), cy(p[1])]);
            budget--;
          }
        }
        if (pts.length) strokes.push(pts);
      }
      return { strokes };
    }

    const cleanList = (list, n) =>
      Array.from({ length: n }, (_, i) => (Array.isArray(list) && num(list[i]) ? cy(list[i]) : null));
    if (prompt.type === 'bar') return { values: cleanList(d.values, prompt.categories.length) };
    if (!Array.isArray(d.series)) return null;
    return {
      series: prompt.series.map((_, si) => cleanList(d.series[si], prompt.categories.length)),
    };
  }

  // Throws a descriptive error if a prompt is malformed.
  function validatePrompt(p) {
    const fail = (msg) => {
      throw new Error(`Prompt "${p && p.id}": ${msg}`);
    };
    if (!p || typeof p !== 'object') fail('not an object');
    for (const k of ['id', 'type', 'title', 'prompt', 'xLabel', 'yLabel', 'source', 'takeaway'])
      if (typeof p[k] !== 'string' || !p[k]) fail(`missing "${k}"`);
    if (!TYPES.includes(p.type)) fail(`unknown type "${p.type}"`);
    if (!p.y || !(p.y.max > p.y.min)) {
      if (p.type !== 'distribution') fail('needs y.min < y.max');
    }
    if (isFreehand(p) && (!p.x || !(p.x.max > p.x.min))) fail('needs x.min < x.max');
    if (p.type === 'line' || p.type === 'trend') {
      if (!Array.isArray(p.points) || p.points.length < 2) fail('needs at least 2 points');
      for (let i = 1; i < p.points.length; i++)
        if (!(p.points[i][0] > p.points[i - 1][0])) fail('points must be sorted by x');
    }
    if (p.type === 'distribution') {
      if (!p.dist) fail('needs "dist"');
      truthCurve(p).ys.forEach((y) => {
        if (!Number.isFinite(y)) fail('density is not finite');
      });
    }
    if (p.type === 'bar') {
      if (!Array.isArray(p.categories) || p.categories.length !== (p.values || []).length)
        fail('categories and values must have the same length');
    }
    if (p.type === 'interaction') {
      if (!Array.isArray(p.series) || p.series.length !== 2) fail('needs exactly 2 series');
      p.series.forEach((s) => {
        if (s.values.length !== p.categories.length) fail(`series "${s.name}" has wrong length`);
      });
    }
    return true;
  }

  return {
    SAMPLES,
    TYPES,
    isFreehand,
    density,
    interpPoints,
    sampleXs,
    truthCurve,
    distributionDisplayScale,
    rasterizeStrokes,
    playerCurve,
    truthValues,
    playerValues,
    scoreDrawing,
    sanitizeDrawing,
    validatePrompt,
  };
});
