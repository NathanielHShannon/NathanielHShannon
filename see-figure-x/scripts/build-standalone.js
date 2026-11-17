#!/usr/bin/env node
'use strict';
/*
 * Bundles the preview page (CSS, scripts and every figure) into one HTML file
 * that works without the game server, e.g. to open on a phone or share.
 *
 *   node scripts/build-standalone.js [out.html] [--fragment]
 *
 * --fragment leaves out <!doctype>/<html>/<head>/<body> for hosts that wrap the
 * page themselves (such as a claude.ai artifact).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'dist', 'see-figure-x-preview.html');

// Keep inlined code from closing its own <script> tag early.
const safe = (code) => code.replace(/<\/script/gi, '<\\/script');

const prompts = JSON.parse(read('data/prompts.json'));
const html = read('public/preview.html');
const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
const markup = body
  .slice(body.indexOf('>') + 1)
  .replace(/\s*<script src="[^"]+"><\/script>/g, '');

// Small adjustments for a page hosted inside another app's frame.
const extraCss = `
:root { color-scheme: dark; }
.bar { top: env(safe-area-inset-top, 0px); }
.round { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
`;

const scripts = [
  `window.SFX_PROMPTS = ${JSON.stringify(prompts)};`,
  read('shared/scoring.js'),
  read('public/chart.js'),
  read('public/ui.js'),
  read('public/preview.js'),
]
  .map((code) => `<script>\n${safe(code)}\n</script>`)
  .join('\n');

const content = `<title>See Figure X</title>
<style>
${read('public/style.css')}
${extraCss}
</style>
<div data-role="preview">
${markup.trim()}
</div>
${scripts}
`;

const page = fragment
  ? content
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${content}</body>
</html>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`Wrote ${out} (${prompts.length} figures, ${(page.length / 1024).toFixed(0)} KB)`);
