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

function answerFor(prompt, quality) {
  // quality 1 = exact, lower = shifted up by (1 − quality) of the chart height.
  // Shift up, not down: several answers sit at the axis floor, where a downward
  // shift would be clamped and score better than expected.
  const shift = (prompt.type === 'distribution' ? 0 : (prompt.y.max - prompt.y.min)) * (1 - quality);
  if (prompt.type === 'bar') return { values: prompt.values.map((v) => v + shift) };
  if (prompt.type === 'interaction') return { series: prompt.series.map((s) => s.values.map((v) => v + shift)) };
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
  assert.ok(!pub.points && !pub.values && !pub.dist, 'no answer data in preview');
  if (pub.series) assert.ok(!pub.series[0].values);

  const seen = new Set();
  for (let round = 0; round < 5; round++) {
    await host.until((c) => c.state.phase === 'preview' && c.state.round.index === round);
    host.send({ type: 'skip' }); // skip the 8 s preview
    await host.until((c) => c.state.phase === 'draw');
    const full = PROMPTS.find((p) => p.id === host.state.round.prompt.id);
    seen.add(full.type);

    // Player 0 draws perfectly, player 1 slightly off, player 2 only saves a draft (never locks).
    players[2].send({ type: 'draft', drawing: answerFor(full, 0.8) });
    players[0].send({ type: 'lock', drawing: answerFor(full, 1) });
    players[1].send({ type: 'lock', drawing: answerFor(full, 0.9) });
    await host.until((c) => c.state.players.filter((p) => p.locked).length === 2);
    assert.strictEqual(host.state.phase, 'draw', 'still waiting on player 2');
    players[2].send({ type: 'lock', drawing: answerFor(full, 0.1) }); // ignored? no — first lock counts
    await host.until((c) => c.state.phase === 'reveal');

    const results = host.state.round.results;
    assert.strictEqual(results.length, 3);
    for (const r of results) assert.strictEqual(r.score, 100 - r.errorPct);
    assert.ok(host.state.round.prompt.source, 'citation sent at reveal');
    if (full.type === 'bar' || full.type === 'interaction') {
      const [a, b] = results;
      assert.strictEqual(a.score, 100);
      assert.strictEqual(b.score, 90);
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
