/* See Figure X — client app. */
(function () {
  'use strict';
  const S = window.GBScoring;
  const { Chart, Pad, VAR_COLORS, UNLABELED, hexToRgba } = window.GBChart;

  const app = document.getElementById('app');
  const banner = document.getElementById('banner');

  const TYPE_LABEL = {
    line: 'Line graph',
    trend: 'Trend line',
    distribution: 'Distribution',
    bar: 'Bar chart',
    interaction: 'Interaction',
    percent: 'Guess the percent',
  };
  const HINTS = {
    line: 'Draw the line from left to right. Lift your finger and redraw any part — overlapping parts are averaged.',
    trend: 'Draw the trend line through where you think the data falls.',
    distribution: 'Draw the shape of the distribution. Only the shape is judged, not how tall you draw it.',
    bar: 'Tap or drag in each column to set the bar height.',
    interaction: '',
    percent: 'Drag around the ring to set your guess.',
  };

  // ---------- state ----------
  let ws = null;
  let state = null;
  let clockOffset = 0;
  let reconnectDelay = 500;
  let view = { key: null };
  let pendingAction = null;

  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
    },
  };
  let session = store.get('gb-session'); // { code, id }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const now = () => Date.now() + clockOffset;
  const me = () => state && state.players.find((p) => p.id === state.you.id);
  const playerById = (id) => state.players.find((p) => p.id === id);

  // ---------- connection ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => {
      reconnectDelay = 500;
      banner.hidden = true;
      if (session) send({ type: 'resume', code: session.code, id: session.id });
      else if (pendingAction) send(pendingAction);
      pendingAction = null;
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (state) {
        banner.textContent = 'Connection lost — reconnecting…';
        banner.hidden = false;
      }
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(5000, reconnectDelay * 2);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else pendingAction = msg;
  }

  function onMessage(msg) {
    if (msg.type === 'joined') {
      session = { code: msg.code, id: msg.id };
      store.set('gb-session', session);
      history.replaceState(null, '', '/');
    } else if (msg.type === 'state') {
      clockOffset = msg.serverNow - Date.now();
      state = msg;
      render();
    } else if (msg.type === 'error') {
      if (msg.error === 'stale') {
        session = null;
        store.set('gb-session', null);
        state = null;
        render();
      } else toast(msg.error);
    }
  }

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }

  function leave() {
    send({ type: 'leave' });
    session = null;
    store.set('gb-session', null);
    state = null;
    render();
  }

  // ---------- rendering ----------
  function render() {
    const key = !state
      ? 'home'
      : [state.phase, state.round ? state.round.index : '', state.you.role, state.you.isHost].join(':');
    document.body.dataset.role = state ? state.you.role : 'home';
    if (key !== view.key) {
      teardown();
      view = { key };
      window.scrollTo(0, 0);
      if (!state) renderHome();
      else if (state.phase === 'lobby') renderLobby();
      else if (state.phase === 'preview') renderQuestion();
      else if (state.phase === 'draw') renderRound();
      else if (state.phase === 'reveal') renderReveal();
      else if (state.phase === 'final') renderFinal();
    }
    if (view.update) view.update();
  }

  function teardown() {
    if (view.stopAnim) view.stopAnim();
    (view.timeouts || []).forEach(clearTimeout);
  }

  function later(fn, ms) {
    view.timeouts = view.timeouts || [];
    view.timeouts.push(setTimeout(fn, ms));
  }

  const logo = (small) =>
    `<div class="logo ${small ? 'small' : ''}"><span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M4 26 L11 15 L17 19 L27 6" /></svg></span>See Figure <b>X</b></div>`;

  // ----- home -----
  function renderHome() {
    const params = new URLSearchParams(location.search);
    const name = store.get('gb-name') || '';
    app.innerHTML = `
      <main class="home">
        ${logo()}
        <p class="tagline">Sketch what you think the science says.<br>Then see what the data really shows.</p>
        <section class="card">
          <h2>Join a game</h2>
          <label>Room code<input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(params.get('code') || '')}"></label>
          <label>Your name<input id="name" maxlength="16" autocomplete="nickname" placeholder="Name" value="${esc(name)}"></label>
          <button id="join" class="primary">Join</button>
          <button id="watch" class="link">Show this room on this screen instead</button>
        </section>
        <section class="card">
          <h2>Host a game</h2>
          <button id="host-display" class="primary">Use this screen as the shared board</button>
          <p class="fine">Best on a TV or laptop everyone can see. Players join from their phones.</p>
          <button id="host-player">Host and play from this device</button>
          <p class="fine">Uses the name above.</p>
        </section>
        <p class="preview-link">Just want to try the figures? <a href="/preview">Practice on your own</a></p>
        <details class="how">
          <summary>How to play</summary>
          <ol>
            <li>Every round shows a prompt about a real scientific finding, plus labeled axes.</li>
            <li>Draw what you think the data looks like on your own phone before time runs out.</li>
            <li>The real data is revealed. You start the round with 100, and your error — the gap between your drawing and the data, as a % of the chart — is subtracted.</li>
            <li>The highest total after the last round wins.</li>
          </ol>
        </details>
      </main>`;
    const codeEl = document.getElementById('code');
    const nameEl = document.getElementById('name');
    codeEl.addEventListener('input', () => (codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, '')));
    const getName = () => {
      const n = nameEl.value.trim();
      store.set('gb-name', n);
      return n;
    };
    document.getElementById('join').onclick = () => {
      if (codeEl.value.length !== 4) return toast('Enter the 4-letter room code.');
      if (!getName()) return toast('Enter your name.');
      send({ type: 'join', code: codeEl.value, name: getName() });
    };
    document.getElementById('watch').onclick = () => {
      if (codeEl.value.length !== 4) return toast('Enter the 4-letter room code to watch.');
      send({ type: 'watch', code: codeEl.value });
    };
    document.getElementById('host-display').onclick = () => send({ type: 'create', mode: 'display' });
    document.getElementById('host-player').onclick = () => {
      if (!getName()) return toast('Enter your name first.');
      send({ type: 'create', mode: 'player', name: getName() });
    };
    [codeEl, nameEl].forEach((el) =>
      el.addEventListener('keydown', (e) => e.key === 'Enter' && document.getElementById('join').click())
    );
  }

  // ----- shared bits -----
  function playerChip(p, extra = '') {
    return `<li class="chip ${p.connected ? '' : 'offline'}" style="--c:${p.color}"><span class="dot"></span>${esc(p.name)}${extra}</li>`;
  }

  function header() {
    const r = state.round;
    return `
      <header class="bar">
        ${logo(true)}
        <div class="bar-mid">${r ? `<span class="round-no">Round ${r.index + 1} / ${r.total}</span><span class="badge">${TYPE_LABEL[r.prompt.type]}</span>` : ''}</div>
        <div class="bar-right"><span class="timer" data-timer></span><span class="code">${esc(state.code)}</span></div>
      </header>`;
  }

  function hostControls(buttons) {
    if (!state.you.isHost) return '';
    return `<div class="host-controls">${buttons}</div>`;
  }

  function joinUrl() {
    return `${location.host}`;
  }

  // ----- lobby -----
  function renderLobby() {
    const isDisplay = state.you.role === 'display';
    app.innerHTML = `
      ${header()}
      <main class="lobby ${isDisplay ? 'wide' : ''}">
        ${
          isDisplay
            ? `<div class="join-panel">
                 <p>Join on your phone at <b>${esc(joinUrl())}</b></p>
                 <p class="label">Room code</p>
                 <div class="big-code">${esc(state.code)}</div>
               </div>`
            : `<div class="you-panel" data-you></div>`
        }
        <section class="card">
          <h2>Players <span class="count" data-count></span></h2>
          <ul class="chips" data-players></ul>
          <p class="fine" data-wait></p>
        </section>
        <section class="card" data-settings></section>
        <button class="link" id="leave">${isDisplay ? 'Close room on this screen' : 'Leave game'}</button>
      </main>`;
    document.getElementById('leave').onclick = leave;
    view.update = () => {
      const { players, limits, settings } = state;
      app.querySelector('[data-players]').innerHTML = players.map((p) => playerChip(p)).join('') || '<li class="empty">Waiting for players to join…</li>';
      app.querySelector('[data-count]').textContent = `${players.length} / ${limits.maxPlayers}`;
      const you = app.querySelector('[data-you]');
      if (you) {
        const m = me();
        you.innerHTML = `<p class="label">You're in as</p><div class="you-name" style="--c:${m.color}">${esc(m.name)}</div><p class="fine">Room code <b>${esc(state.code)}</b> · others join at ${esc(joinUrl())}</p>`;
      }
      const ready = players.filter((p) => p.connected).length >= limits.minPlayers;
      app.querySelector('[data-wait]').textContent = state.you.isHost
        ? ready
          ? 'Everyone in? Start when ready.'
          : `Need at least ${limits.minPlayers} players to start.`
        : 'Waiting for the host to start the game…';
      const box = app.querySelector('[data-settings]');
      if (state.you.isHost) {
        box.hidden = false;
        box.innerHTML = `
          <h2>Game settings</h2>
          <div class="seg-row"><span>Rounds</span><div class="seg" data-key="rounds">${limits.rounds
            .map((n) => `<button class="${n === settings.rounds ? 'on' : ''}" data-v="${n}">${n}</button>`)
            .join('')}</div></div>
          <div class="seg-row"><span>Drawing time</span><div class="seg" data-key="drawSeconds">${limits.drawSeconds
            .map((n) => `<button class="${n === settings.drawSeconds ? 'on' : ''}" data-v="${n}">${n}s</button>`)
            .join('')}</div></div>
          <button class="primary big" id="start" ${ready ? '' : 'disabled'}>Start game</button>`;
        box.querySelectorAll('.seg button').forEach((b) => {
          b.onclick = () => send({ type: 'settings', ...settings, [b.parentElement.dataset.key]: Number(b.dataset.v) });
        });
        box.querySelector('#start').onclick = () => send({ type: 'start' });
      } else {
        box.hidden = false;
        box.innerHTML = `<h2>Game settings</h2><p class="fine">${settings.rounds} rounds · ${settings.drawSeconds} seconds to draw</p>`;
      }
    };
  }

  // Paper-style caption number, e.g. "Figure 3."
  const figNo = () => `<span class="fig-no">Figure ${state.round.index + 1}.</span> `;

  // ----- round, step 1: the question on its own (no chart, no timer) -----
  const WHAT_YOU_DO = {
    line: "You'll draw a line graph.",
    trend: "You'll draw a trend line.",
    distribution: "You'll draw the shape of a distribution.",
    bar: "You'll set the height of each bar.",
    interaction: "You'll label which line is which.",
    percent: "You'll guess a percentage.",
  };

  function renderQuestion() {
    const p = state.round.prompt;
    const isDisplay = state.you.role === 'display';
    const hostPlayer = state.players.find((x) => x.id === state.hostId);
    const who = hostPlayer && !state.you.isHost ? esc(hostPlayer.name) : 'the host';
    app.innerHTML = `
      ${header()}
      <main class="question ${isDisplay ? 'wide' : ''}">
        <p class="label">Read the question</p>
        ${promptCard(p, true)}
        <p class="what">${esc(WHAT_YOU_DO[p.type])} The chart and the ${state.settings.drawSeconds}-second timer appear when the round starts.</p>
        ${
          state.you.isHost
            ? `<button class="primary big" id="begin">Start drawing</button>`
            : `<p class="waiting">Waiting for ${who} to start the round…</p>`
        }
        ${isDisplay ? `<ul class="chips" data-status></ul>` : ''}
        ${state.you.isHost ? '<button class="link" id="end">End game</button>' : ''}
      </main>`;
    if (state.you.isHost) {
      document.getElementById('begin').onclick = () => send({ type: 'begin' });
      document.getElementById('end').onclick = () => confirm('End the game now and show final results?') && send({ type: 'end' });
    }
    view.update = () => {
      const status = app.querySelector('[data-status]');
      if (status) status.innerHTML = state.players.map((x) => playerChip(x)).join('');
    };
  }

  // ----- round, step 2: drawing -----
  function promptCard(p, big) {
    const vars =
      big && p.type === 'interaction'
        ? `<p class="var-row">Which line is which? ${varChips(p)}</p>`
        : '';
    return `<section class="prompt-card ${big ? 'big' : ''}"><h1>${figNo()}${esc(p.title)}</h1><p>${esc(p.prompt)}</p>${vars}</section>`;
  }

  const varChip = (p, k) => `<span class="var" style="--c:${VAR_COLORS[k]}">${esc(p.series[k].name)}</span>`;
  const varChips = (p) => `${varChip(p, 0)} ${varChip(p, 1)}`;

  // Empty axes, plus the unlabeled lines for an interaction chart.
  function drawBase(chart, p) {
    chart.drawAxes();
    if (p.lines) chart.interaction(p.lines, { colors: [UNLABELED, UNLABELED], width: 4, markerSize: 7 });
  }

  function renderRound() {
    const p = state.round.prompt;
    const isDisplay = state.you.role === 'display';
    const drawing = state.phase === 'draw' && !isDisplay;

    app.innerHTML = `
      ${header()}
      <main class="round ${isDisplay ? 'wide' : ''}">
        ${promptCard(p, isDisplay)}
        <div class="chart-wrap ${drawing ? 'pad' : ''}">
          <canvas id="chart" aria-label="${esc(p.xLabel ? `Chart: ${p.yLabel} by ${p.xLabel}` : p.yLabel)}"></canvas>
          <div class="overlay" data-overlay hidden></div>
        </div>
        ${drawing ? drawTools(p) : ''}
        ${
          isDisplay
            ? `<section class="status"><ul class="chips" data-status></ul>${hostControls(
                `<button id="skip">End drawing now</button><button class="link" id="end">End game</button>`
              )}</section>`
            : ''
        }
      </main>`;

    const canvas = document.getElementById('chart');
    const overlay = app.querySelector('[data-overlay]');

    if (drawing) {
      const m = me();
      let lastSent = '';
      const sendDraft = () => {
        const payload = JSON.stringify(view.pad.drawing);
        if (payload !== lastSent) {
          lastSent = payload;
          send({ type: 'draft', drawing: view.pad.drawing });
        }
      };
      view.pad = new Pad(canvas, p, m.color, () => {
        sendDraft();
        updateTools();
      });
      if (state.you.draft) view.pad.load(state.you.draft);
      const lockBtn = document.getElementById('lock');
      const btn = (id) => document.getElementById(id);
      const updateTools = () => {
        const empty = view.pad.isEmpty();
        lockBtn.disabled = empty || m.locked;
        ['undo', 'clear', 'swap'].forEach((id) => btn(id) && (btn(id).disabled = empty));
      };
      if (btn('undo')) btn('undo').onclick = () => view.pad.undo();
      if (btn('clear')) btn('clear').onclick = () => view.pad.clear();
      if (btn('swap')) btn('swap').onclick = () => view.pad.swap();
      lockBtn.onclick = () => {
        if (view.pad.isEmpty()) return;
        send({ type: 'lock', drawing: view.pad.drawing });
        if (navigator.vibrate) navigator.vibrate(30);
      };
      updateTools();
      view.resize = () => view.pad.resize();
    } else {
      view.chart = new Chart(canvas, p);
      drawBase(view.chart, p);
      view.resize = () => {
        view.chart.resize();
        drawBase(view.chart, p);
      };
    }

    if (isDisplay && state.you.isHost) {
      document.getElementById('skip').onclick = () => send({ type: 'skip' });
      document.getElementById('end').onclick = () => confirm('End the game now and show final results?') && send({ type: 'end' });
    }

    view.update = () => {
      const m = me();
      const locked = state.players.filter((x) => x.locked).length;
      const active = state.players.filter((x) => x.connected).length;
      if (state.phase === 'preview') {
        overlay.hidden = false;
        overlay.innerHTML = `<div class="countdown"><span class="label">Get ready to draw</span><span class="num" data-timer></span></div>`;
      } else if (m && m.locked) {
        overlay.hidden = false;
        overlay.innerHTML = `<div class="locked-msg"><span class="check">✓</span>Locked in!<span class="fine">${locked} of ${active} players done</span></div>`;
        if (view.pad) view.pad.enabled = false;
        const lockBtn = document.getElementById('lock');
        if (lockBtn) {
          lockBtn.disabled = true;
          lockBtn.textContent = 'Locked in';
        }
        app.querySelectorAll('.tools button').forEach((b) => (b.disabled = true));
      } else overlay.hidden = true;
      const status = app.querySelector('[data-status]');
      if (status) {
        status.innerHTML = state.players
          .map((x) =>
            playerChip(x, state.phase === 'draw' ? `<span class="state">${x.locked ? '✓' : x.connected ? '✎' : '—'}</span>` : '')
          )
          .join('');
      }
    };
  }

  function drawTools(p) {
    if (p.type === 'interaction') {
      return `
        <p class="label-task">Tap the line that shows ${varChip(p, 0)}<br>The other line becomes ${varChip(p, 1)}</p>
        <div class="tools two">
          <button id="swap">Swap</button>
          <button id="lock" class="primary">Lock in</button>
        </div>`;
    }
    return `
      <p class="hint">${esc(HINTS[p.type])}</p>
      <div class="tools">
        <button id="undo">Undo</button>
        <button id="clear">Clear</button>
        <button id="lock" class="primary">Lock in</button>
      </div>`;
  }

  // ----- reveal -----
  function renderReveal() {
    const p = state.round.prompt;
    const isDisplay = state.you.role === 'display';
    const results = state.round.results.slice();
    const mine = results.find((r) => r.playerId === state.you.id);
    // Everyone's guesses are shown on every screen; on a phone your own is drawn on top and thicker.
    const shown = results;
    const ranked = results.slice().sort((a, b) => b.score - a.score);
    const last = state.round.index + 1 >= state.round.total;
    const nextLabel = last ? 'See final results' : 'Next round';

    const isLabeling = p.type === 'interaction';
    const legendSeries = isLabeling
      ? p.series.map((sr, k) => `<li><span class="swatch" style="--c:${VAR_COLORS[k]}"></span>${esc(sr.name)}</li>`).join('')
      : '';

    const cards = `
      <div class="score-cards">
        ${(isDisplay ? ranked : mine ? [mine] : []).map((r) => scoreCard(r, isDisplay)).join('')}
      </div>
      ${isDisplay || !mine ? '' : '<p class="rank" data-rank></p>'}`;

    app.innerHTML = `
      ${header()}
      <main class="reveal ${isDisplay ? 'wide' : ''}">
        <div class="reveal-main">
          <section class="prompt-card compact"><h1>${figNo()}${esc(p.title)}</h1><p>${esc(p.prompt)}</p></section>
          <div class="chart-wrap"><canvas id="chart"></canvas></div>
          <ul class="legend">
            ${
              isLabeling
                ? legendSeries
                : `<li><span class="swatch truth"></span>Real data</li>${shown
                    .map((r) => {
                      const pl = playerById(r.playerId);
                      if (!pl) return '';
                      const you = !isDisplay && pl.id === state.you.id;
                      return `<li class="${you ? 'you' : ''}"><span class="swatch" style="--c:${pl.color}"></span>${esc(pl.name)}${you ? ' (you)' : ''}</li>`;
                    })
                    .join('')}`
            }
          </ul>
          ${isLabeling ? matchRow(shown, isDisplay) : ''}
          ${isDisplay ? '' : cards}
          <section class="finding" data-finding>
            <p class="takeaway">${esc(p.takeaway)}</p>
            <p class="source">${esc(p.source)}</p>
            ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
          </section>
        </div>
        <aside class="reveal-side">
          ${isDisplay ? cards : ''}
          <section class="card standings" data-standings hidden></section>
          ${hostControls(`<button class="primary big" id="next">${nextLabel}</button>${last ? '' : '<button class="link" id="end">End game</button>'}`)}
          ${!state.you.isHost ? '<p class="fine center">The host will start the next round.</p>' : ''}
        </aside>
      </main>`;

    if (state.you.isHost) {
      document.getElementById('next').onclick = () => send({ type: 'next' });
      const end = document.getElementById('end');
      if (end) end.onclick = () => confirm('End the game now and show final results?') && send({ type: 'end' });
    }

    // Chart animation: drawings first, then the real data sweeps in.
    const chart = new Chart(document.getElementById('chart'), p);
    // Each player keeps a fixed slot (for bar markers); others are drawn first so yours ends on top.
    const players = shown
      .map((r, slot) => ({ r, pl: playerById(r.playerId), slot }))
      .filter((x) => x.pl && x.r.drawing)
      .sort((a, b) => (a.pl.id === state.you.id) - (b.pl.id === state.you.id));
    const styleFor = (pl) => {
      if (isDisplay) return { alpha: 0.85, width: 2.5 };
      return pl.id === state.you.id ? { alpha: 1, width: 4, highlight: true } : { alpha: 0.5, width: 2 };
    };
    const drawPlayers = () =>
      players.forEach(({ r, pl, slot }) => chart.playerDrawing(r.drawing, pl.color, { slot, slots: shown.length, ...styleFor(pl) }));
    // Guesses sweep in, then the real data sweeps over them.
    const hasGuesses = players.length > 0;
    view.stopAnim = animateReveal(chart, drawPlayers, { hasGuesses });
    view.resize = () => {
      chart.resize();
      view.stopAnim();
      chart.drawAxes();
      drawPlayers();
      chart.truth(1);
    };

    // Score cards animate after the real data has been drawn.
    const startScores = revealDuration(hasGuesses) + 200;
    app.querySelectorAll('.score-card').forEach((el, i) =>
      later(() => {
        // Scroll just enough to show the card, keeping as much of the chart in view as possible.
        if (!isDisplay) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        animateScoreCard(el);
      }, startScores + i * 120)
    );
    const after = startScores + 2600 + (isDisplay ? shown.length : 1) * 120;
    later(() => {
      const st = app.querySelector('[data-standings]');
      st.hidden = false;
      st.innerHTML = standingsTable(state.players.slice().sort((a, b) => b.total - a.total || a.totalError - b.totalError), 'Standings');
      const rank = app.querySelector('[data-rank]');
      if (rank) {
        const order = state.players.slice().sort((a, b) => b.total - a.total || a.totalError - b.totalError);
        const pos = order.findIndex((x) => x.id === state.you.id) + 1;
        rank.textContent = `You're ${ordinal(pos)} of ${order.length}`;
      }
    }, after);
    view.update = null;
  }

  // Interaction rounds: who matched the lines and who flipped them.
  function matchRow(results, isDisplay) {
    const chips = results
      .map((r) => {
        const pl = playerById(r.playerId);
        if (!pl) return '';
        const mark = r.empty ? '— no answer' : r.score === 100 ? '✓ matched' : '✗ flipped';
        const you = !isDisplay && pl.id === state.you.id ? ' (you)' : '';
        return `<li class="chip ${r.score === 100 ? 'ok' : 'miss'}" style="--c:${pl.color}"><span class="dot"></span>${esc(pl.name)}${you}<span class="state">${mark}</span></li>`;
      })
      .join('');
    return `<ul class="chips match-row" aria-label="Who matched the lines">${chips}</ul>`;
  }

  function errorLabel(r) {
    if (r.empty) return state.round.prompt.type === 'interaction' ? 'No answer' : 'No drawing';
    if (state.round.prompt.type === 'interaction') return r.score === 100 ? 'Matched! Error =' : 'Flipped. Error =';
    return 'Error =';
  }

  function scoreCard(r, isDisplay) {
    const pl = playerById(r.playerId);
    return `
      <div class="score-card ${isDisplay ? 'mini' : ''}" style="--c:${pl ? pl.color : '#888'}" data-error="${r.errorPct}" data-score="${r.score}" data-empty="${r.empty ? 1 : 0}" data-total="${pl ? pl.total : 0}">
        <div class="sc-name"><span class="dot"></span>${esc(pl ? pl.name : 'Player')}</div>
        <div class="sc-big" data-big>100</div>
        <div class="sc-error" data-err>${errorLabel(r)} <span class="neg">−${r.errorPct}</span></div>
        <div class="sc-total" data-tot>Round score ${r.score} · Total ${pl ? pl.total : 0}</div>
      </div>`;
  }

  const { easeOut, animateScoreCard, animateReveal, revealDuration } = window.GBUI;
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

  function standingsTable(list, title) {
    return `
      <h2>${esc(title)}</h2>
      <ol class="table">
        ${list
          .map(
            (p, i) => `<li style="--c:${p.color}" class="${p.id === state.you.id ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="dot"></span><span class="nm">${esc(
              p.name
            )}</span><span class="pts">${p.total}</span></li>`
          )
          .join('')}
      </ol>`;
  }

  // ----- final -----
  function renderFinal() {
    const list = state.standings;
    const rounds = Math.max(1, state.roundsPlayed || 0);
    const podium = list.slice(0, 3);
    const order = [1, 0, 2].filter((i) => podium[i]);
    app.innerHTML = `
      ${header()}
      <main class="final ${state.you.role === 'display' ? 'wide' : ''}">
        <h1 class="final-title">Final results</h1>
        <div class="podium">
          ${order
            .map((i) => {
              const p = podium[i];
              return `<div class="step s${i + 1}" style="--c:${p.color}"><div class="pname">${esc(p.name)}</div><div class="ppts">${p.total}</div><div class="block">${
                i + 1
              }</div></div>`;
            })
            .join('')}
        </div>
        <section class="card">
          <h2>All players</h2>
          <ol class="table full">
            ${list
              .map(
                (p, i) => `<li style="--c:${p.color}" class="${p.id === state.you.id ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="dot"></span><span class="nm">${esc(
                  p.name
                )}</span><span class="err">avg error ${Math.round(p.totalError / rounds)}%</span><span class="pts">${p.total}</span></li>`
              )
              .join('')}
          </ol>
          <p class="fine">Ties are broken by lowest total error.</p>
        </section>
        ${hostControls('<button class="primary big" id="again">Play again</button>')}
        <button class="link" id="leave">Leave</button>
      </main>`;
    if (state.you.isHost) document.getElementById('again').onclick = () => send({ type: 'playAgain' });
    document.getElementById('leave').onclick = leave;
    view.update = null;
  }

  // ---------- timers & resize ----------
  setInterval(() => {
    if (!state || !state.phaseEndsAt) {
      document.querySelectorAll('[data-timer]').forEach((el) => (el.textContent = ''));
      return;
    }
    const left = Math.max(0, Math.ceil((state.phaseEndsAt - now()) / 1000));
    document.querySelectorAll('[data-timer]').forEach((el) => {
      el.textContent = left;
      el.classList.toggle('urgent', state.phase === 'draw' && left <= 10);
    });
  }, 200);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => view.resize && view.resize(), 120);
  });

  render();
  connect();

  // Exposed for automated tests.
  window.__gb = { get state() { return state; }, get view() { return view; }, hexToRgba };
})();
