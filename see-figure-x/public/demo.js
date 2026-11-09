/*
 * See Figure X — scripted gameplay demo for screen recording.
 * Every frame is a pure function of time: render(t) draws the moment t seconds
 * in. It plays in real time in the browser, and scripts/record-demo.js steps
 * through it frame by frame to make a smooth video.
 *
 * URL options: ?link=your-text (end card line), ?loop=0 (play once).
 */
(async function () {
  'use strict';
  const S = window.GBScoring;
  const { Chart } = window.GBChart;
  const $ = (id) => document.getElementById(id);

  const prompts = Array.isArray(window.SFX_PROMPTS)
    ? window.SFX_PROMPTS
    : (await (await fetch('/api/prompts')).json()).prompts;
  const height = prompts.find((p) => p.id === 'adult-height');
  const linda = prompts.find((p) => p.id === 'linda-problem');

  // ----- the cast and their guesses -----
  const PLAYERS = [
    { name: 'Nathaniel', color: '#ff6b6b' },
    { name: 'Rosa', color: '#4dabf7' },
    { name: 'Ben', color: '#69db7c' },
    { name: 'Maya', color: '#ffd43b' },
  ];
  const gauss = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
  const xs = Array.from({ length: 90 }, (_, i) => height.x.min + ((height.x.max - height.x.min) * i) / 89);
  const SHAPES = [
    (x) => 0.75 * gauss(x, 62, 1.8) + 0.75 * gauss(x, 71.5, 1.8) + 0.02, // two humps (the classic wrong guess)
    (x) => 0.8 * gauss(x, 66.5, 4.0), // one fairly narrow hump
    (x) => 0.8 * gauss(x, 65, x < 65 ? 2.6 : 5.5), // skewed
    (x) => 0.62 * gauss(x, 66, 6.5), // wide and flat
  ];
  const heightDrawings = SHAPES.map((f) => ({ strokes: [xs.map((x) => [x, Math.min(1, f(x))])] }));
  const heightResults = heightDrawings.map((d) => S.scoreDrawing(height, d));
  const lindaGuesses = [30, 55, 80, 15];
  const lindaResults = lindaGuesses.map((v) => S.scoreDrawing(linda, { value: v }));

  // ----- timeline (seconds) -----
  const SCENES = {
    title: [0, 2.8],
    question: [2.8, 6.6],
    draw: [6.6, 11.8],
    reveal: [11.8, 19.6],
    percent: [19.6, 25.8],
    end: [25.8, 29.5],
  };
  const DURATION = SCENES.end[1];
  const FADE = 0.35;
  const LOCK_TIMES = [9.4, 10.0, 10.5, 11.0]; // when each player locks in
  const DRAW_STROKE = [7.0, 9.2]; // the phone's finger stroke

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const prog = (t, a, b) => clamp01((t - a) / (b - a));

  // ----- static content -----
  $('end-link').textContent = new URLSearchParams(location.search).get('link') || 'Free to play · link in the comments';
  $('rows').innerHTML = PLAYERS.map(
    (p, i) => `<div class="prow"><span class="dot" style="background:${p.color}"></span>${p.name}<span class="st" id="st${i}"></span></div>`
  ).join('');
  $('legend1').innerHTML =
    '<span><i style="background:#fff;box-shadow:0 0 8px #fff"></i>Real data</span>' +
    PLAYERS.map((p) => `<span><i style="background:${p.color}"></i>${p.name}</span>`).join('');
  const cardHtml = (results) =>
    PLAYERS.map(
      (p, i) =>
        `<div class="card" style="border-top-color:${p.color}"><div class="nm">${p.name}</div><div class="big">100</div><div class="er">Error = <b>−${results[i].errorPct}</b></div></div>`
    ).join('');
  $('cards1').innerHTML = cardHtml(heightResults);
  $('cards2').innerHTML = cardHtml(lindaResults);

  // ----- charts (built once; redrawn each frame) -----
  const padPrompt = { ...height };
  delete padPrompt.dist;
  const pad = new Chart($('pad'), padPrompt);
  const reveal = new Chart($('reveal'), height);
  const dial = new Chart($('dial'), linda);

  // ----- per-frame rendering -----
  function sceneOpacity(t, [a, b]) {
    if (t < a - FADE / 2 || t > b + FADE / 2) return 0;
    return Math.min(clamp01((t - (a - FADE / 2)) / FADE), clamp01((b + FADE / 2 - t) / FADE));
  }

  // Score card: appears, shows "Error = −N", counts 100 down to the score.
  function renderCard(el, r, t, start) {
    el.style.opacity = clamp01((t - start) / 0.3);
    el.style.transform = `translateY(${(1 - ease(clamp01((t - start) / 0.3))) * 16}px)`;
    el.querySelector('.er').style.opacity = clamp01((t - start - 0.6) / 0.3);
    const k = clamp01((t - start - 1.1) / (0.4 + r.errorPct * 0.012));
    const big = el.querySelector('.big');
    big.textContent = Math.round(100 - r.errorPct * ease(k));
    big.style.color = k > 0 && k < 1 ? 'var(--bad)' : k >= 1 && r.score >= 85 ? 'var(--good)' : 'var(--text)';
  }

  function renderTitle(t) {
    const k = ease(prog(t, 0.1, 0.9));
    $('title-logo').style.transform = `scale(${0.85 + 0.15 * k})`;
    $('title-logo').style.opacity = k;
    $('title-tag').style.opacity = prog(t, 0.8, 1.4);
  }

  function renderQuestion(t) {
    const press = prog(t, 5.7, 5.85) - prog(t, 5.95, 6.15);
    $('start-btn').style.transform = `scale(${1 - 0.05 * press})`;
    $('start-btn').style.boxShadow = press > 0 ? `0 0 0 ${10 * press}px rgba(255, 212, 59, 0.25)` : 'none';
  }

  function renderDraw(t) {
    const secs = Math.max(0, 45 - Math.floor(Math.max(0, t - SCENES.draw[0])));
    $('ph-timer').textContent = secs;
    $('big-timer').textContent = `0:${String(secs).padStart(2, '0')}`;
    PLAYERS.forEach((_, i) => {
      const st = $('st' + i);
      const done = t >= LOCK_TIMES[i];
      st.textContent = done ? '✓ locked in' : 'drawing…';
      st.className = 'st' + (done ? ' ok' : '');
    });
    // Nathaniel's finger draws the two-humped guess.
    pad.drawAxes();
    const k = prog(t, DRAW_STROKE[0], DRAW_STROKE[1]);
    const pts = heightDrawings[0].strokes[0];
    const n = Math.max(1, Math.round(pts.length * k));
    if (k > 0) pad.strokes([pts.slice(0, n)], PLAYERS[0].color, 5);
    if (k > 0 && k < 1) {
      const [x, y] = pts[n - 1];
      const ctx = pad.ctx;
      ctx.beginPath();
      ctx.arc(pad.xToPx(x), pad.yToPx(y), 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
    }
    const locked = t >= LOCK_TIMES[0];
    $('lock-btn').textContent = locked ? '✓ Locked in' : 'Lock in';
    $('lock-btn').style.opacity = locked ? 0.55 : 1;
  }

  function renderReveal(t) {
    const r = t - SCENES.reveal[0];
    reveal.drawAxes();
    reveal.sweep(ease(prog(r, 0.4, 1.9)), () =>
      heightDrawings.forEach((d, i) => reveal.playerDrawing(d, PLAYERS[i].color, { width: 3.5, alpha: 0.9 }))
    );
    const k = prog(r, 2.4, 4.1);
    if (k > 0) reveal.truth(ease(k));
    $('takeaway1').style.opacity = prog(r, 4.1, 4.5);
    [...$('cards1').children].forEach((el, i) => renderCard(el, heightResults[i], r, 4.4 + i * 0.15));
  }

  function renderPercent(t) {
    const r = t - SCENES.percent[0];
    dial.drawAxes();
    dial.sweep(prog(r, 0.5, 1.3), () => lindaGuesses.forEach((v, i) => dial.dialMarker(v, PLAYERS[i].color)));
    const k = prog(r, 1.6, 3.0);
    if (k > 0) dial.truth(ease(k));
    [...$('cards2').children].forEach((el, i) => renderCard(el, lindaResults[i], r, 3.2 + i * 0.15));
  }

  const RENDERERS = { title: renderTitle, question: renderQuestion, draw: renderDraw, reveal: renderReveal, percent: renderPercent, end: () => {} };

  function render(t) {
    for (const [name, span] of Object.entries(SCENES)) {
      const o = sceneOpacity(t, span);
      $('s-' + name).style.opacity = o;
      if (o > 0) RENDERERS[name](t);
    }
  }

  // ----- fit the 1080 stage to the window -----
  function fit() {
    const s = Math.min(innerWidth / 1080, innerHeight / 1080);
    $('stage').style.transform = `scale(${s}) translate(-50%, -50%)`;
  }
  addEventListener('resize', fit);
  fit();

  // ----- play in real time unless a recorder is driving it -----
  window.__demo = { duration: DURATION, render, ready: true };
  if (!/[?&]record=1/.test(location.search)) {
    const loop = !/[?&]loop=0/.test(location.search);
    const t0 = performance.now();
    const tick = (now) => {
      let t = (now - t0) / 1000;
      if (loop) t %= DURATION + 1;
      render(Math.min(t, DURATION));
      if (loop || t < DURATION) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } else {
    render(0);
  }
})();
