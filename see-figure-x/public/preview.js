/* See Figure X — preview page: try any figure on its own, no room needed. */
(function () {
  'use strict';
  const S = window.GBScoring;
  const { Chart, Pad } = window.GBChart;
  const { animateScoreCard, animateTruth } = window.GBUI;

  const COLOR = '#4dabf7';
  document.documentElement.style.setProperty('--you', COLOR);

  const TYPE_LABEL = {
    line: 'Line graphs',
    trend: 'Trend lines',
    distribution: 'Distributions',
    bar: 'Bar charts',
    interaction: 'Interactions',
  };
  const HINTS = {
    line: 'Draw the line from left to right. Lift your finger and redraw any part — overlapping parts are averaged.',
    trend: 'Draw the trend line through where you think the data falls.',
    distribution: 'Draw the shape of the distribution. Only the shape is judged, not how tall you draw it.',
    bar: 'Tap or drag in each column to set the bar height.',
    interaction: 'Choose a line below, then tap each column to place its point.',
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let prompts = [];
  let current = null; // the prompt being shown
  let pad = null;
  let revealed = false;
  let cancelAnim = null;
  let timers = [];

  async function load() {
    let data;
    try {
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

    // The pad gets the answer-free version, like players do.
    const { points, dist, values, series, ...pub } = p;
    if (series) pub.series = series.map((s) => ({ name: s.name }));
    pad = new Pad($('chart'), pub, COLOR, updateTools);

    $('series').innerHTML =
      p.type === 'interaction'
        ? `<div class="series-pick">${p.series
            .map(
              (s, i) =>
                `<button data-series="${i}" class="${i === 0 ? 'on' : ''}"><svg viewBox="0 0 40 12" aria-hidden="true"><line x1="2" y1="6" x2="38" y2="6" ${
                  i ? 'stroke-dasharray="7 5"' : ''
                }/>${i ? '<rect x="16" y="2" width="8" height="8"/>' : '<circle cx="20" cy="6" r="4"/>'}</svg>${esc(s.name)}</button>`
            )
            .join('')}</div>`
        : '';
    $('series')
      .querySelectorAll('[data-series]')
      .forEach((b) => {
        b.onclick = () => {
          pad.activeSeries = Number(b.dataset.series);
          $('series')
            .querySelectorAll('[data-series]')
            .forEach((x) => x.classList.toggle('on', x === b));
          pad.render();
        };
      });
    updateTools();
  }

  function updateTools() {
    const empty = pad.isEmpty();
    $('undo').disabled = empty;
    $('clear').disabled = empty;
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
    const r = S.scoreDrawing(p, drawing);

    $('tools').hidden = true;
    $('hint').hidden = true;
    $('series').hidden = true;
    $('result').hidden = false;
    $('legend-series').innerHTML =
      p.type === 'interaction'
        ? p.series
            .map(
              (s, i) =>
                `<li class="legend-series"><svg viewBox="0 0 40 12" aria-hidden="true"><line x1="2" y1="6" x2="38" y2="6" ${
                  i ? 'stroke-dasharray="7 5"' : ''
                }/>${i ? '<rect x="16" y="2" width="8" height="8"/>' : '<circle cx="20" cy="6" r="4"/>'}</svg>${esc(s.name)}</li>`
            )
            .join('')
        : '';
    $('finding').innerHTML = `
      <p class="takeaway">${esc(p.takeaway)}</p>
      <p class="source">${esc(p.source)}</p>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}`;
    $('card').innerHTML = `
      <div class="score-card" style="--c:${COLOR}" data-error="${r.errorPct}" data-score="${r.score}">
        <div class="sc-name"><span class="dot"></span>${drawing ? 'Your score' : 'Answer only'}</div>
        <div class="sc-big" data-big>100</div>
        <div class="sc-error">${drawing ? 'Error =' : 'No drawing'} <span class="neg">−${r.errorPct}</span></div>
        <div class="sc-total">Round score ${r.score}</div>
      </div>`;

    // Swap the pad for a chart with the full prompt (including the answer).
    const chart = new Chart($('chart'), p);
    cancelAnim = animateTruth(chart, () => drawResult(chart, drawing));
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
      }, 2200)
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
  $('reveal').onclick = reveal;
  $('again').onclick = () => show(current);
  $('reload').onclick = load;
  window.addEventListener('resize', () => !revealed && pad && pad.resize());

  load();
})();
