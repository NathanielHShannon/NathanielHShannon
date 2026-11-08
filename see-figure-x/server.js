'use strict';
/*
 * See Figure X — game server.
 * Serves the web client and runs rooms over WebSockets. The server is the source
 * of truth for phases, timers, drawings and scores; answers are only sent to
 * clients once a round reaches its reveal.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const scoring = require('./shared/scoring');

const PROMPTS_FILE = path.join(__dirname, 'data/prompts.json');
const PROMPTS = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
PROMPTS.forEach(scoring.validatePrompt);

const PORT = Number(process.env.PORT) || 3000;
// The preview page exposes every answer, so it can be turned off for public servers.
const PREVIEW_ENABLED = process.env.PREVIEW !== 'off';
const PREVIEW_MS = 8000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const ROUND_OPTIONS = [5, 8, 12];
const DRAW_OPTIONS = [30, 45, 60];
const HOST_HANDOFF_MS = 20000;
const ROOM_IDLE_MS = 15 * 60 * 1000;
const COLORS = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#da77f2', '#ff922b', '#3bc9db', '#f783ac'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const STATIC_ROOTS = { '/shared/': path.join(__dirname, 'shared'), '/': path.join(__dirname, 'public') };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (urlPath === '/preview' || urlPath === '/api/prompts') {
    if (!PREVIEW_ENABLED) {
      res.writeHead(404);
      return res.end('Preview is disabled on this server.');
    }
    if (urlPath === '/api/prompts') return sendPreviewPrompts(res);
    return sendFile(res, path.join(STATIC_ROOTS['/'], 'preview.html'));
  }
  const prefix = urlPath.startsWith('/shared/') ? '/shared/' : '/';
  const root = STATIC_ROOTS[prefix];
  const rel = urlPath.slice(prefix.length) || 'index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the app so links like /?code=ABCD work.
      if (prefix === '/' && !path.extname(rel)) return sendIndex(res);
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 500 : 200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function sendIndex(res) {
  sendFile(res, path.join(STATIC_ROOTS['/'], 'index.html'));
}

// The preview page re-reads prompts.json on every load, so edits show up on
// refresh without restarting. Bad entries are reported instead of thrown.
// (The game itself uses the copy loaded at startup.)
function sendPreviewPrompts(res) {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  fs.readFile(PROMPTS_FILE, 'utf8', (err, text) => {
    if (err) return reply(500, { prompts: [], errors: ['Could not read data/prompts.json: ' + err.message] });
    let list;
    try {
      list = JSON.parse(text);
      if (!Array.isArray(list)) throw new Error('the file must contain a JSON array');
    } catch (e) {
      return reply(200, { prompts: [], errors: ['data/prompts.json is not valid JSON: ' + e.message] });
    }
    const prompts = [];
    const errors = [];
    for (const p of list) {
      try {
        scoring.validatePrompt(p);
        prompts.push(p);
      } catch (e) {
        errors.push(e.message);
      }
    }
    reply(200, { prompts, errors });
  });
}

// ---------- rooms ----------
const rooms = new Map();

const newId = () => crypto.randomBytes(12).toString('base64url');

function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick n prompts, preferring not to show the same chart type twice in a row.
// Set GB_ONLY=id1,id2 to play only specific prompts (handy for previewing new ones).
const ONLY = (process.env.GB_ONLY || '').split(',').filter(Boolean);

function pickPrompts(n) {
  const pool = ONLY.length ? PROMPTS.filter((p) => ONLY.includes(p.id)) : shuffle(PROMPTS);
  if (ONLY.length) return pool.slice(0, n);
  const out = [];
  while (out.length < n && pool.length) {
    const lastType = out.length ? out[out.length - 1].type : null;
    let idx = pool.findIndex((p) => p.type !== lastType);
    if (idx < 0) idx = 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function createRoom() {
  const room = {
    code: makeCode(),
    hostId: null,
    phase: 'lobby', // lobby → preview → draw → reveal → … → final
    settings: { rounds: 8, drawSeconds: 45 },
    players: new Map(), // id → { id, name, color, total, totalError, sockets:Set }
    displays: new Map(), // id → { id, sockets:Set }
    prompts: [],
    roundIndex: -1,
    roundsPlayed: 0,
    phaseEndsAt: null,
    round: null, // { drafts: Map, locked: Set, results: [] }
    timer: null,
    hostTimer: null,
    idleTimer: null,
  };
  rooms.set(room.code, room);
  return room;
}

const isConnected = (member) => member && member.sockets.size > 0;
const connectedPlayers = (room) => [...room.players.values()].filter(isConnected);

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Player';
}

function uniqueName(room, name) {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

function addPlayer(room, name) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  const player = {
    id: newId(),
    name: uniqueName(room, cleanName(name)),
    color: COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length],
    total: 0,
    totalError: 0,
    sockets: new Set(),
  };
  room.players.set(player.id, player);
  return player;
}

function memberOf(room, id) {
  return room.players.get(id) || room.displays.get(id) || null;
}

function attach(ws, room, member, role) {
  ws.ctx = { code: room.code, id: member.id, role };
  member.sockets.add(ws);
  clearTimeout(room.idleTimer);
  if (member.id === room.hostId) clearTimeout(room.hostTimer);
  send(ws, { type: 'joined', code: room.code, id: member.id, role });
}

// ---------- state sent to clients ----------
// The prompt without its answer. Interaction prompts keep their lines (shuffled,
// unlabeled) because the task is to label them.
function publicPrompt(p, order) {
  const { points, dist, values, series, ...rest } = p;
  if (series) {
    rest.series = series.map((s) => ({ name: s.name }));
    rest.lines = scoring.interactionLines(p, order);
  }
  return rest;
}

function stateFor(room, viewerId) {
  const viewer = memberOf(room, viewerId);
  const role = room.players.has(viewerId) ? 'player' : 'display';
  const inRound = ['preview', 'draw', 'reveal'].includes(room.phase);
  const prompt = inRound ? room.prompts[room.roundIndex] : null;
  const state = {
    type: 'state',
    serverNow: Date.now(),
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    limits: { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, rounds: ROUND_OPTIONS, drawSeconds: DRAW_OPTIONS },
    you: { id: viewerId, role, isHost: viewerId === room.hostId },
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: isConnected(p),
      total: p.total,
      totalError: p.totalError,
      locked: room.round ? room.round.locked.has(p.id) : false,
    })),
    phaseEndsAt: room.phaseEndsAt,
  };
  if (inRound) {
    state.round = {
      index: room.roundIndex,
      total: room.prompts.length,
      prompt: room.phase === 'reveal' ? prompt : publicPrompt(prompt, room.round.order),
    };
    if (room.phase === 'draw' && role === 'player') {
      state.you.draft = room.round.drafts.get(viewerId) || null;
    }
    if (room.phase === 'reveal') state.round.results = room.round.results;
  }
  if (viewer && room.phase === 'final') {
    state.standings = standings(room);
    state.roundsPlayed = room.roundsPlayed;
  }
  return state;
}

function standings(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, color: p.color, total: p.total, totalError: p.totalError }))
    .sort((a, b) => b.total - a.total || a.totalError - b.totalError);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  for (const member of [...room.players.values(), ...room.displays.values()]) {
    if (!member.sockets.size) continue;
    const payload = JSON.stringify(stateFor(room, member.id));
    for (const ws of member.sockets) if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// ---------- phases ----------
function setPhase(room, phase, durationMs, next) {
  clearTimeout(room.timer);
  room.phase = phase;
  room.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
  if (durationMs) room.timer = setTimeout(next, durationMs);
  broadcast(room);
}

function startGame(room) {
  room.prompts = pickPrompts(room.settings.rounds);
  room.roundIndex = -1;
  room.roundsPlayed = 0;
  for (const p of room.players.values()) {
    p.total = 0;
    p.totalError = 0;
  }
  nextRound(room);
}

function nextRound(room) {
  room.roundIndex++;
  if (room.roundIndex >= room.prompts.length) {
    room.round = null;
    return setPhase(room, 'final');
  }
  room.round = { drafts: new Map(), locked: new Set(), results: [], order: scoring.randomOrder(() => crypto.randomInt(2)) };
  setPhase(room, 'preview', PREVIEW_MS, () => startDraw(room));
}

function startDraw(room) {
  setPhase(room, 'draw', room.settings.drawSeconds * 1000, () => reveal(room));
}

function maybeEndDraw(room) {
  const active = connectedPlayers(room);
  if (room.phase === 'draw' && active.length && active.every((p) => room.round.locked.has(p.id))) reveal(room);
}

function reveal(room) {
  const prompt = room.prompts[room.roundIndex];
  room.round.results = [...room.players.values()].map((p) => {
    const drawing = room.round.drafts.get(p.id) || null;
    const r = scoring.scoreDrawing(prompt, drawing, room.round.order);
    p.total += r.score;
    p.totalError += r.errorPct;
    return { playerId: p.id, drawing, ...r };
  });
  room.roundsPlayed++;
  setPhase(room, 'reveal');
}

function backToLobby(room) {
  clearTimeout(room.timer);
  room.round = null;
  room.prompts = [];
  room.roundIndex = -1;
  for (const p of room.players.values()) {
    p.total = 0;
    p.totalError = 0;
  }
  // Drop players who left during the game.
  for (const [id, p] of room.players) if (!isConnected(p) && id !== room.hostId) room.players.delete(id);
  setPhase(room, 'lobby');
}

// ---------- messages ----------
function handle(ws, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  const fail = (error) => send(ws, { type: 'error', error });

  if (msg.type === 'create') {
    if (ws.ctx) return fail('Already in a room.');
    const room = createRoom();
    let member;
    if (msg.mode === 'player') {
      member = addPlayer(room, msg.name);
      room.hostId = member.id;
      attach(ws, room, member, 'player');
    } else {
      member = { id: newId(), sockets: new Set() };
      room.displays.set(member.id, member);
      room.hostId = member.id;
      attach(ws, room, member, 'display');
    }
    return broadcast(room);
  }

  if (msg.type === 'join' || msg.type === 'watch' || msg.type === 'resume') {
    if (ws.ctx) return fail('Already in a room.');
    const room = rooms.get(String(msg.code || '').toUpperCase().trim());
    if (!room) return fail(msg.type === 'resume' ? 'stale' : 'No game with that code. Check the letters and try again.');
    if (msg.type === 'resume') {
      const member = memberOf(room, msg.id);
      if (!member) return fail('stale');
      attach(ws, room, member, room.players.has(member.id) ? 'player' : 'display');
      return broadcast(room);
    }
    if (msg.type === 'watch') {
      const member = { id: newId(), sockets: new Set() };
      room.displays.set(member.id, member);
      attach(ws, room, member, 'display');
      return broadcast(room);
    }
    if (room.players.size >= MAX_PLAYERS) return fail(`That game is full (${MAX_PLAYERS} players max).`);
    const player = addPlayer(room, msg.name);
    attach(ws, room, player, 'player');
    return broadcast(room);
  }

  // Everything below requires being in a room.
  if (!ws.ctx) return fail('Not in a room.');
  const room = rooms.get(ws.ctx.code);
  if (!room) return fail('stale');
  const me = ws.ctx.id;
  const isHost = me === room.hostId;
  const prompt = room.round && room.prompts[room.roundIndex];

  switch (msg.type) {
    case 'settings': {
      if (!isHost || room.phase !== 'lobby') return;
      if (ROUND_OPTIONS.includes(msg.rounds)) room.settings.rounds = msg.rounds;
      if (DRAW_OPTIONS.includes(msg.drawSeconds)) room.settings.drawSeconds = msg.drawSeconds;
      return broadcast(room);
    }
    case 'start': {
      if (!isHost || room.phase !== 'lobby') return;
      if (connectedPlayers(room).length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players to start.`);
      return startGame(room);
    }
    case 'draft':
    case 'lock': {
      if (room.phase !== 'draw' || !room.players.has(me) || room.round.locked.has(me)) return;
      const clean = scoring.sanitizeDrawing(prompt, msg.drawing);
      if (clean) room.round.drafts.set(me, clean);
      if (msg.type === 'lock') {
        room.round.locked.add(me);
        broadcast(room);
        maybeEndDraw(room);
      }
      return;
    }
    case 'skip': {
      // Host can end the drawing timer early (e.g. someone wandered off).
      if (isHost && room.phase === 'draw') reveal(room);
      else if (isHost && room.phase === 'preview') startDraw(room);
      return;
    }
    case 'next': {
      if (isHost && room.phase === 'reveal') nextRound(room);
      return;
    }
    case 'end': {
      if (isHost && ['preview', 'draw', 'reveal'].includes(room.phase)) {
        clearTimeout(room.timer);
        room.round = null;
        setPhase(room, 'final');
      }
      return;
    }
    case 'playAgain': {
      if (isHost && room.phase === 'final') backToLobby(room);
      return;
    }
    case 'leave': {
      leave(ws, room);
      return;
    }
  }
}

function leave(ws, room) {
  const id = ws.ctx.id;
  ws.ctx = null;
  const member = memberOf(room, id);
  if (!member) return;
  member.sockets.delete(ws);
  if (!member.sockets.size) {
    // In the lobby a player who leaves is removed; mid-game they keep their score.
    if (room.phase === 'lobby' && room.players.has(id)) room.players.delete(id);
    if (room.displays.has(id) && id !== room.hostId) room.displays.delete(id);
  }
  if (id === room.hostId && !room.players.has(id) && !room.displays.has(id)) handOffHost(room);
  afterDeparture(room, id);
}

function handleClose(ws) {
  if (!ws.ctx) return;
  const room = rooms.get(ws.ctx.code);
  if (!room) return;
  const member = memberOf(room, ws.ctx.id);
  if (member) member.sockets.delete(ws);
  afterDeparture(room, ws.ctx.id);
}

function afterDeparture(room, id) {
  const member = memberOf(room, id);
  if (id === room.hostId && !isConnected(member)) {
    clearTimeout(room.hostTimer);
    room.hostTimer = setTimeout(() => handOffHost(room), HOST_HANDOFF_MS);
    room.hostTimer.unref();
  }
  const anyone = [...room.players.values(), ...room.displays.values()].some(isConnected);
  if (!anyone) {
    clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(() => destroyRoom(room), ROOM_IDLE_MS);
    room.idleTimer.unref();
  }
  if (room.phase === 'draw') maybeEndDraw(room);
  if (rooms.has(room.code)) broadcast(room);
}

function handOffHost(room) {
  if (isConnected(memberOf(room, room.hostId))) return;
  const next = connectedPlayers(room)[0] || [...room.displays.values()].find(isConnected);
  if (next) {
    room.hostId = next.id;
    broadcast(room);
  }
}

function destroyRoom(room) {
  clearTimeout(room.timer);
  clearTimeout(room.hostTimer);
  rooms.delete(room.code);
}

// ---------- sockets ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  ws.ctx = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handle(ws, msg);
    } catch (err) {
      console.error('Error handling message', msg && msg.type, err);
    }
  });
  ws.on('close', () => handleClose(ws));
});

// Drop dead connections (phones that went to sleep) so lock-in checks stay accurate.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
heartbeat.unref();
wss.on('close', () => clearInterval(heartbeat));

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`See Figure X running at http://localhost:${PORT}  (${PROMPTS.length} prompts loaded)`);
  });
}

module.exports = { server, rooms, PROMPTS };
