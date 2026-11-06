/* See Figure X — UI helpers shared by the game and the preview page. */
(function () {
  'use strict';

  const easeOut = (k) => 1 - Math.pow(1 - k, 3);

  // Score card animation: 100 → show "Error = −30" in red → count down to 70.
  // The card needs data-error, data-score and a [data-big] element.
  function animateScoreCard(el) {
    const error = Number(el.dataset.error);
    const score = Number(el.dataset.score);
    const big = el.querySelector('[data-big]');
    el.classList.add('in');
    setTimeout(() => el.classList.add('show-error'), 650);
    setTimeout(() => {
      el.classList.add('counting');
      const start = performance.now();
      const dur = 500 + error * 12;
      const step = (t) => {
        const k = Math.min(1, (t - start) / dur);
        big.textContent = Math.round(100 - error * easeOut(k));
        if (k < 1) requestAnimationFrame(step);
        else {
          el.classList.remove('counting');
          el.classList.add('done');
          if (score >= 85) el.classList.add('great');
        }
      };
      requestAnimationFrame(step);
    }, 1250);
  }

  // Draw the real data over drawings, sweeping left to right. Returns a cancel function.
  // drawUnder() paints everything that sits beneath the truth line.
  function animateTruth(chart, drawUnder, { delay = 300, duration = 1700, onDone } = {}) {
    let raf;
    const t0 = performance.now();
    const frame = (t) => {
      chart.drawAxes();
      drawUnder();
      const prog = Math.max(0, Math.min(1, (t - t0 - delay) / duration));
      if (prog > 0) chart.truth(easeOut(prog));
      if (prog < 1) raf = requestAnimationFrame(frame);
      else if (onDone) onDone();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  window.GBUI = { easeOut, animateScoreCard, animateTruth };
})();
