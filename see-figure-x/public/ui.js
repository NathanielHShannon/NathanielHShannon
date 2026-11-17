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

  // Reveal timeline: everyone's guesses sweep in left to right, a short pause,
  // then the real data sweeps in over them. Interaction rounds have no guesses
  // to draw, so they go straight to the real data.
  const REVEAL = { lead: 250, guesses: 1500, pause: 500, truth: 1700 };

  function revealDuration(hasGuesses) {
    return REVEAL.lead + (hasGuesses ? REVEAL.guesses + REVEAL.pause : 0) + REVEAL.truth;
  }

  // drawGuesses() paints every guess; it is clipped as the sweep advances.
  // Returns a function that stops the animation.
  function animateReveal(chart, drawGuesses, { hasGuesses = true, onDone } = {}) {
    let raf;
    const t0 = performance.now();
    const truthStart = REVEAL.lead + (hasGuesses ? REVEAL.guesses + REVEAL.pause : 0);
    const frame = (t) => {
      const el = t - t0;
      chart.drawAxes();
      if (hasGuesses) {
        const g = Math.max(0, Math.min(1, (el - REVEAL.lead) / REVEAL.guesses));
        chart.sweep(easeOut(g), drawGuesses);
      }
      const k = Math.max(0, Math.min(1, (el - truthStart) / REVEAL.truth));
      if (k > 0) chart.truth(easeOut(k));
      if (k < 1) raf = requestAnimationFrame(frame);
      else if (onDone) onDone();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  window.GBUI = { easeOut, animateScoreCard, animateReveal, revealDuration };
})();
