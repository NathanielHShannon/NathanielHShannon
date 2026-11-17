/* See Figure X — preview page: try any figure on its own, no room needed. */
(function () {
  'use strict';
  const S = window.GBScoring;
  const { Chart, Pad, VAR_COLORS } = window.GBChart;
  const { animateScoreCard, animateReveal, revealDuration } = window.GBUI;

  const COLOR = '#4dabf7';
  document.documentElement.style.setProperty('--you', COLOR);

  const TYPE_LABEL = {
    line: 'Line graphs',
    trend: 'Trend lines',
    distribution: 'Distributions',
    bar: 'Bar charts',
    interaction: 'Interactions',
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

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let prompts = [];
  let current = null; // the prompt being shown
  let order = [0, 1]; // interaction: which series each displayed line is
  let pad = null;
  let revealed = false;
  let cancelAnim = null;
  let timers = [];

  // A standalone build embeds the figures in the page (window.SFX_PROMPTS);
  // otherwise they come live from the server.
  const STATIC = Array.isArray(window.SFX_PROMPTS);
  if (STATIC) {
    $('back').hidden = true;
    $('reload-note').hidden = true;
  }

  async function load() {
    let data;
    if (STATIC) {
      data = { prompts: [], errors: [] };
      for (const p of window.SFX_PROMPTS) {
        try {
          S.validatePrompt(p);
          data.prompts.push(p);
        } catch (e) {
          data.errors.push(e.message);
        }
      }
    } else try {
      const res = await fetch('/api/prompts', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      data = await res.json();
    } catch (e) {
      data = { prompts: [], errors: ['Could not load figures: ' + e.message] };
    }
    prompts = data.prompts;
    const box = $('problems');
    box.hidden = !data.errors.length;
    box.innerHTML = data.errors.length
      ? `<h2>${data.errors.length} figure${data.errors.length > 1 ? 's have' : ' has'} a problem and ${data.errors.length > 1 ? 'were' : 'was'} skipped</h2><ul>${data.errors
          .map((e) => `<li>${esc(e)}</li>`)
          .join('')}</ul>`
      : '';

    // Dropdown grouped by chart type.
    const pick = $('pick');
    pick.innerHTML = Object.keys(TYPE_LABEL)
      .map((type) => {
        const group = prompts.filter((p) => p.type === type);
        if (!group.length) return '';
        return `<optgroup label="${TYPE_LABEL[type]}">${group
          .map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`)
          .join('')}</optgroup>`;
      })
      .join('');
    if (!prompts.length) return;
    const wanted = decodeURIComponent(location.hash.slice(1));
    show(prompts.find((p) => p.id === wanted) || (current && prompts.find((p) => p.id === current.id)) || ordered()[0]);
  }

  // Prompts in dropdown order, for Prev/Next.
  const ordered = () => Object.keys(TYPE_LABEL).flatMap((t) => prompts.filter((p) => p.type === t));

  function step(delta) {
    const list = ordered();
    const i = list.findIndex((p) => p.id === current.id);
    show(list[(i + delta + list.length) % list.length]);
  }

  function reset() {
    if (cancelAnim) cancelAnim();
    cancelAnim = null;
    timers.forEach(clearTimeout);
    timers = [];
    revealed = false;
    $('result').hidden = true;
    $('tools').hidden = false;
    $('hint').hidden = false;
    $('series').hidden = false;
  }

  function show(p) {
    reset();
    current = p;
    history.replaceState(null, '', '#' + encodeURIComponent(p.id));
    $('pick').value = p.id;
    const list = ordered();
    $('meta').innerHTML = `${list.findIndex((x) => x.id === p.id) + 1} of ${list.length} · id <code>${esc(p.id)}</code> · type <code>${esc(p.type)}</code>`;
    $('prompt').innerHTML = `<h1>${esc(p.title)}</h1><p>${esc(p.prompt)}</p>`;
    $('hint').textContent = HINTS[p.type];
    const labeling = p.type === 'interaction';
    $('hint').hidden = labeling;
    $('undo').hidden = labeling;
    $('clear').hidden = labeling;
    $('swap').hidden = !labeling;
    $('tools').classList.toggle('two', labeling);

    // The pad gets the answer-free version, like players do: interaction lines
    // are shuffled and unlabeled.
    order = S.randomOrder();
    const { points, dist, values, value, series, ...pub } = p;
    if (series) {
      pub.series = series.map((s) => ({ name: s.name }));
      pub.lines = S.interactionLines(p, order);
    }
    pad = new Pad($('chart'), pub, COLOR, updateTools);

    const chip = (k) => `<span class="var" style="--c:${VAR_COLORS[k]}">${esc(p.series[k].name)}</span>`;
    $('series').innerHTML = labeling
      ? `<p class="label-task">Tap the line that shows ${chip(0)}<br>The other line becomes ${chip(1)}</p>`
      : '';
    updateTools();
  }

  function updateTools() {
    const empty = pad.isEmpty();
    $('undo').disabled = empty;
    $('clear').disabled = empty;
    $('swap').disabled = empty;
    $('reveal').textContent = empty ? 'Show answer' : 'Reveal';
  }

  function drawResult(chart, drawing) {
    if (drawing) chart.playerDrawing(drawing, COLOR, { width: 3.5, barMode: 'fill' });
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    pad.enabled = false;
    const p = current;
    const drawing = pad.isEmpty() ? null : S.sanitizeDrawing(p, pad.drawing);
    const r = S.scoreDrawing(p, drawing, order);
    const labeling = p.type === 'interaction';
    const errorText = !drawing
      ? labeling
        ? 'No answer'
        : 'No drawing'
      : labeling
        ? r.score === 100
          ? 'Matched! Error ='
          : 'Flipped. Error ='
        : 'Error =';

    $('tools').hidden = true;
    $('hint').hidden = true;
    $('series').hidden = true;
    $('result').hidden = false;
    $('legend-truth').hidden = labeling;
    $('legend-you').hidden = labeling || !drawing;
    $('legend-you').lastChild.textContent = p.type === 'percent' ? 'Your guess' : 'Your drawing';
    $('legend-series').innerHTML = labeling
      ? p.series.map((sr, k) => `<li><span class="swatch" style="--c:${VAR_COLORS[k]}"></span>${esc(sr.name)}</li>`).join('')
      : '';
    $('finding').innerHTML = `
      <p class="takeaway">${esc(p.takeaway)}</p>
      <p class="source">${esc(p.source)}</p>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}`;
    $('card').innerHTML = `
      <div class="score-card" style="--c:${COLOR}" data-error="${r.errorPct}" data-score="${r.score}">
        <div class="sc-name"><span class="dot"></span>${drawing ? 'Your score' : 'Answer only'}</div>
        <div class="sc-big" data-big>100</div>
        <div class="sc-error">${errorText} <span class="neg">−${r.errorPct}</span></div>
        <div class="sc-total">Round score ${r.score}</div>
      </div>`;

    // Swap the pad for a chart with the full prompt (including the answer).
    const chart = new Chart($('chart'), p);
    const hasGuess = !!drawing && p.type !== 'interaction';
    cancelAnim = animateReveal(chart, () => drawResult(chart, drawing), { hasGuesses: hasGuess });
    window.onresize = () => {
      if (!revealed) return;
      if (cancelAnim) cancelAnim();
      chart.resize();
      chart.drawAxes();
      drawResult(chart, drawing);
      chart.truth(1);
    };
    const el = $('card').firstElementChild;
    timers.push(
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        animateScoreCard(el);
      }, revealDuration(hasGuess) + 200)
    );
  }

  $('pick').onchange = () => show(prompts.find((p) => p.id === $('pick').value));
  $('prev').onclick = () => step(-1);
  $('next-fig').onclick = () => step(1);
  $('next-after').onclick = () => {
    step(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  $('random').onclick = () => {
    const others = prompts.filter((p) => p !== current);
    show(others[Math.floor(Math.random() * others.length)] || current);
  };
  $('undo').onclick = () => pad.undo();
  $('clear').onclick = () => pad.clear();
  $('swap').onclick = () => pad.swap();
  $('reveal').onclick = reveal;
  $('again').onclick = () => show(current);
  $('reload').onclick = load;
  window.addEventListener('resize', () => !revealed && pad && pad.resize());

  load();
})();
