'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../shared/scoring');
const PROMPTS = require('../data/prompts.json');

const byId = (id) => PROMPTS.find((p) => p.id === id);

// Draw a curve exactly along the truth, as one stroke.
function perfectStroke(p) {
  const t = S.truthCurve(p);
  const k = p.type === 'distribution' ? S.distributionDisplayScale(p) : 1;
  return { strokes: [t.xs.map((x, i) => [x, t.ys[i] * k])] };
}

test('every prompt is valid and every chart type is represented', () => {
  PROMPTS.forEach(S.validatePrompt);
  assert.strictEqual(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length, 'ids are unique');
  for (const t of S.TYPES) assert.ok(PROMPTS.some((p) => p.type === t), `has a ${t} prompt`);
});

test('distribution densities integrate to about 1 over their axes', () => {
  for (const p of PROMPTS.filter((q) => q.type === 'distribution')) {
    const n = 4000;
    const dx = (p.x.max - p.x.min) / n;
    let area = 0;
    for (let i = 0; i < n; i++) area += S.density(p.dist, p.x.min + (i + 0.5) * dx) * dx;
    assert.ok(area > 0.9 && area < 1.01, `${p.id} area ${area.toFixed(3)}`);
  }
});

test('a perfect drawing scores 100 for every prompt', () => {
  for (const p of PROMPTS) {
    let d;
    if (S.isFreehand(p)) d = perfectStroke(p);
    else if (p.type === 'bar') d = { values: p.values.slice() };
    else d = { series: p.series.map((s) => s.values.slice()) };
    const r = S.scoreDrawing(p, S.sanitizeDrawing(p, d));
    assert.strictEqual(r.score, 100, `${p.id}: ${JSON.stringify(r)}`);
  }
});

test('score is 100 minus error, where error is RMSE as % of the y-axis', () => {
  const p = byId('bystander'); // y: 0–100, truth 85/62/31
  const r = S.scoreDrawing(p, { values: [55, 32, 1] }); // each bar 30 too low
  assert.deepStrictEqual(r, { errorPct: 30, score: 70, empty: false });
});

test('a flat line through a line chart is penalized proportionally', () => {
  const p = byId('keeling-curve'); // y: 300–440
  const flat = { strokes: [[[1959, 370], [2023, 370]]] };
  const r = S.scoreDrawing(p, flat);
  assert.ok(r.errorPct > 15 && r.errorPct < 25, JSON.stringify(r));
  assert.strictEqual(r.score, 100 - r.errorPct);
});

test('distribution scoring ignores how tall the drawing is', () => {
  const p = byId('adult-height');
  const d = perfectStroke(p);
  const half = { strokes: d.strokes.map((s) => s.map(([x, y]) => [x, y / 2])) };
  assert.strictEqual(S.scoreDrawing(p, half).score, 100);
  // A bimodal guess should lose points against the single-humped truth.
  const twoHumps = {
    strokes: [S.sampleXs(p).map((x) => [x, Math.exp(-((x - 63.5) ** 2) / 3) + Math.exp(-((x - 69) ** 2) / 3)])],
  };
  assert.ok(S.scoreDrawing(p, twoHumps).score < 90);
});

test('empty and missing drawings score zero', () => {
  for (const p of PROMPTS) {
    assert.deepStrictEqual(S.scoreDrawing(p, null), { errorPct: 100, score: 0, empty: true });
  }
  assert.strictEqual(S.scoreDrawing(byId('benford'), { values: Array(9).fill(null) }).score, 0);
});

test('error is capped so scores never go below zero', () => {
  const p = byId('milgram');
  const r = S.scoreDrawing(p, { values: [40, 40, 40, 40, 40, 0] });
  assert.ok(r.score >= 0 && r.errorPct <= 100);
});

test('rasterize fills gaps and averages overlapping strokes', () => {
  const xs = [0, 1, 2, 3, 4];
  assert.deepStrictEqual(S.rasterizeStrokes([[[1, 10], [1.2, 10]], [[3, 30]]], xs), [10, 10, 20, 30, 30]);
  assert.deepStrictEqual(S.rasterizeStrokes([[[0, 0], [4, 40]], [[0, 20], [4, 20]]], xs), [10, 15, 20, 25, 30]);
  assert.strictEqual(S.rasterizeStrokes([], xs), null);
});

test('sanitizeDrawing clamps values and rejects junk', () => {
  const p = byId('bystander');
  assert.deepStrictEqual(S.sanitizeDrawing(p, { values: [150, -5, 'x'] }), { values: [100, 0, null] });
  assert.strictEqual(S.sanitizeDrawing(p, 'nope'), null);
  const line = byId('keeling-curve');
  const clean = S.sanitizeDrawing(line, { strokes: [[[1900, 1000], [NaN, 3], [2000, 350]]] });
  assert.deepStrictEqual(clean, { strokes: [[[1959, 440], [2000, 350]]] });
  const many = { strokes: [Array.from({ length: 10000 }, (_, i) => [1960 + (i % 60), 350])] };
  assert.ok(S.sanitizeDrawing(line, many).strokes[0].length <= 6000);
});
