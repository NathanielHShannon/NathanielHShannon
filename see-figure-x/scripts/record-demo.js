#!/usr/bin/env node
'use strict';
/*
 * Records the scripted gameplay demo (public/demo.html) to an MP4.
 * Steps through the demo frame by frame, so the video is perfectly smooth.
 *
 *   node scripts/record-demo.js [out.mp4] [--fps=30] [--link="text for end card"]
 *
 * Needs Playwright (with Chromium) and ffmpeg installed on this machine; they are
 * not dependencies of the game itself.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const out = path.resolve(args.find((a) => !a.startsWith('--')) || 'see-figure-x-demo.mp4');
const fps = Number(flag('fps', 30));
const link = flag('link', '');

(async () => {
  const { chromium } = require('playwright');
  process.env.PREVIEW = 'on';
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-frames-'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/demo?record=1${link ? '&link=' + encodeURIComponent(link) : ''}`);
  await page.waitForFunction(() => window.__demo && window.__demo.ready);
  const duration = await page.evaluate(() => window.__demo.duration);
  const total = Math.ceil(duration * fps);

  for (let i = 0; i <= total; i++) {
    await page.evaluate((t) => window.__demo.render(t), i / fps);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(5, '0')}.png`) });
    if (i % fps === 0) process.stdout.write(`\rframes: ${i}/${total}`);
  }
  process.stdout.write('\n');
  await browser.close();
  server.close();

  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`Wrote ${out} (${duration.toFixed(1)} s, ${fps} fps, 1080×1080)`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
