'use strict';
// End-to-end: a shared-screen host and three players play a full game over WebSockets.
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { server, PROMPTS } = require('../server');

const sockets = [];

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(ws);
  const c = { ws, state: null, joined: null, errors: [], waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'state') c.state = m;
    if (m.type === 'joined') c.joined = m;
    if (m.type === 'error') c.errors.push(m.error);
    c.waiters = c.waiters.filter((w) => !(w.pred(c) && (w.resolve(), true)));
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.until = (pred, ms = 3000) =>
    new Promise((resolve, reject) => {
      if (pred(c)) return resolve();
      const t = setTimeout(() => reject(new Error('timeout waiting; phase=' + (c.state && c.state.phase))), ms);
      c.waiters.push({ pred, resolve: () => (clearTimeout(t), resolve()) });
    });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

// For an interaction prompt, the labeling that matches the lines shown (`lines`), or its opposite.
function labelingFor(prompt, lines, right) {
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const assign = prompt.series.map((s) => lines.findIndex((l) => same(l, s.values)));
  return { assign: right ? assign : assign.slice().reverse() };
}

function answerFor(prompt, quality) {
  // Percent: guess (1 − quality) × 100 points too low (every answer is at least 25%).
  if (prompt.type === 'percent') return { value: prompt.value - 100 * (1 - quality) };
  // quality 1 = exact, lower = shifted up by (1 − quality) of the chart height.
  // Shift up, not down: several answers sit at the axis floor, where a downward
  // shift would be clamped and score better than expected.
  const shift = (prompt.type === 'distribution' ? 0 : (prompt.y.max - prompt.y.min)) * (1 - quality);
  if (prompt.type === 'bar') {
    // Shift up, or down if that would pass the top of the axis (clamped answers score better than expected).
    const dir = prompt.values.every((v) => v + shift <= prompt.y.max) ? 1 : -1;
    return { values: prompt.values.map((v) => v + dir * shift) };
  }
  return { strokes: [[[prompt.x.min, 0.5], [prompt.x.max, 0.5]]] };
}

test('full game: create, join, draw, lock, reveal, final, play again', async (t) => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  // Close every socket even if an assertion fails, so a failure can't hang the run.
  t.after(() => {
    sockets.forEach((ws) => ws.terminate());
    server.close();
  });

  // Preview page and its live prompt list.
  const page = await fetch(`http://127.0.0.1:${port}/preview`);
  assert.match(await page.text(), /preview\.js/);
  const api = await (await fetch(`http://127.0.0.1:${port}/api/prompts`)).json();
  assert.strictEqual(api.prompts.length, PROMPTS.length);
  assert.deepStrictEqual(api.errors, []);

  const host = client(port);
  await host.open;
  host.send({ type: 'create', mode: 'display' });
  await host.until((c) => c.state && c.state.phase === 'lobby');
  const code = host.state.code;
  assert.match(code, /^[A-Z]{4}$/);
  assert.strictEqual(host.state.you.isHost, true);
  assert.strictEqual(host.state.you.role, 'display');

  const players = [client(port), client(port), client(port)];
  await Promise.all(players.map((p) => p.open));
  players.forEach((p, i) => p.send({ type: 'join', code: code.toLowerCase(), name: i === 2 ? 'Ada' : 'Ada' }));
  await host.until((c) => c.state.players.length === 3);
  assert.deepStrictEqual(host.state.players.map((p) => p.name).sort(), ['Ada', 'Ada 2', 'Ada 3']);
  assert.strictEqual(new Set(host.state.players.map((p) => p.color)).size, 3);

  // Non-hosts can't start; bad codes are rejected.
  players[0].send({ type: 'start' });
  const stranger = client(port);
  await stranger.open;
  stranger.send({ type: 'join', code: 'ZZZZ', name: 'x' });
  await stranger.until((c) => c.errors.length);
  stranger.ws.close();

  host.send({ type: 'settings', rounds: 5, drawSeconds: 30 });
  await host.until((c) => c.state.settings.rounds === 5);
  host.send({ type: 'start' });
  await host.until((c) => c.state.phase === 'preview');

  // The answer must not leak before the reveal.
  const pub = players[0].state.round.prompt;
  assert.ok(!pub.points && !pub.values && !pub.dist && pub.value === undefined, 'no answer data in preview');
  if (pub.series) assert.ok(!pub.series[0].values, 'interaction labels hidden');

  const seen = new Set();
  for (let round = 0; round < 5; round++) {
    await host.until((c) => c.state.phase === 'preview' && c.state.round.index === round);
    host.send({ type: 'skip' }); // skip the 8 s preview
    await host.until((c) => c.state.phase === 'draw');
    const full = PROMPTS.find((p) => p.id === host.state.round.prompt.id);
    seen.add(full.type);
    const labeling = full.type === 'interaction';
    const lines = players[0].state.round.prompt.lines;
    if (labeling) assert.strictEqual(lines.length, 2, 'unlabeled lines are sent to players');

    // Player 0 answers perfectly, player 1 slightly off (or flipped), player 2 only saves a draft (never locks).
    const answer = (q) => (labeling ? labelingFor(full, lines, q === 1) : answerFor(full, q));
    players[2].send({ type: 'draft', drawing: answer(0.8) });
    players[0].send({ type: 'lock', drawing: answer(1) });
    players[1].send({ type: 'lock', drawing: answer(0.9) });
    await host.until((c) => c.state.players.filter((p) => p.locked).length === 2);
    assert.strictEqual(host.state.phase, 'draw', 'still waiting on player 2');
    players[2].send({ type: 'lock', drawing: answer(0.1) });
    await host.until((c) => c.state.phase === 'reveal');

    const results = host.state.round.results;
    assert.strictEqual(results.length, 3);
    for (const r of results) assert.strictEqual(r.score, 100 - r.errorPct);
    assert.ok(host.state.round.prompt.source, 'citation sent at reveal');
    const [a, b] = results;
    if (full.type === 'bar' || full.type === 'percent') {
      assert.strictEqual(a.score, 100);
      assert.strictEqual(b.score, 90);
    }
    if (labeling) {
      assert.strictEqual(a.score, 100, 'right labeling');
      assert.strictEqual(b.score, 0, 'flipped labeling');
    }
    players[1].send({ type: 'next' }); // not host: ignored
    host.send({ type: 'next' });
  }
  await host.until((c) => c.state.phase === 'final');
  assert.strictEqual(host.state.standings.length, 3);
  assert.strictEqual(host.state.roundsPlayed, 5);
  const totals = host.state.standings.map((s) => s.total);
  assert.deepStrictEqual(totals, totals.slice().sort((a, b) => b - a), 'standings sorted');

  // A player reconnecting resumes the same identity.
  const oldId = players[0].joined.id;
  players[0].ws.close();
  const again = client(port);
  await again.open;
  again.send({ type: 'resume', code, id: oldId });
  await again.until((c) => c.state && c.state.you.id === oldId);
  assert.strictEqual(again.state.phase, 'final');

  host.send({ type: 'playAgain' });
  await host.until((c) => c.state.phase === 'lobby');
  assert.ok(host.state.players.every((p) => p.total === 0));
  assert.ok(seen.size >= 2, 'mixed chart types');

  [host, again, players[1], players[2]].forEach((c) => c.ws.close());
});
