/**
 * Generates the `Automate` probe page on demand and prints where it put it.
 *
 * The probe is `index.html` plus a module script that lights the `Automate` chip, clicks a filled
 * cell's `<img>`, types a threshold, toggles the checkbox, and writes what it found into `#design`
 * -- which the stylesheet already paints, so a headless screenshot reads it. The probe is generated
 * rather than committed because a page that taps itself would be a page that lies about what a
 * visitor did.
 *
 * Run: `node tools/probe-automate.mjs` (then screenshot `web/ui/probe-automate.html`).
 */

import { readFile, writeFile } from 'node:fs/promises';

const html = await readFile('web/ui/index.html', 'utf8');

const probe = [
  '<script type="module">',
  'import "./app.js";',
  'const modes = document.getElementById("modes");',
  'const board = document.getElementById("board");',
  'const panel = document.getElementById("automation");',
  'const strip = document.getElementById("design");',
  'const code = document.getElementById("code");',
  '',
  'modes.querySelector("[data-mode=\'Automate\']").click();',
  '',
  'const slot = [...board.children].find((s) => s.children.length > 0 && s.children[0].tagName === "IMG");',
  'slot.querySelector("img").click();',
  '',
  'const chosen = panel.querySelector("[data-chosen]");',
  'const threshold = panel.querySelector("input[data-field=\'threshold\']");',
  'const pause = panel.querySelector("input[data-field=\'pause\']");',
  'const toggle = panel.querySelector("[data-toggle]");',
  'let sawChange = false;',
  'panel.addEventListener("change", () => { sawChange = true; });',
  'let fired = false;',
  'threshold.addEventListener("change", () => { fired = true; });',
  'const error = document.getElementById("error");',
  'const stamp = (tag) => `${tag} chosen=${chosen.textContent} fields=${threshold.value}/${pause.value} off=${toggle.hasAttribute("data-off")} len=${code.value.length} err=${error.textContent}`;',,,
  '',
  'const before = stamp("before");',
  'threshold.value = String(Number(threshold.value) + 1000);',
  'threshold.dispatchEvent(new Event("change"));',
  'const after = stamp("after");',
  'toggle.click();',
  'const flagged = stamp("toggled");',
  '',
  'strip.textContent = `AUTOMATE inputs=${panel.querySelectorAll("input").length} ${before} saw=${sawChange} fired=${fired} || ${after} || ${flagged}`;',,,
  '</script>',
].join('\n');

const out = html.replace('</head>', `${probe}\n</head>`);
if (out === html) throw new Error('no </head> to insert into');
await writeFile('web/ui/probe-automate.html', out);
console.log(`probe written to web/ui/probe-automate.html (${out.length} bytes)`);
