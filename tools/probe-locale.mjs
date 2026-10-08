import { readFile, writeFile } from 'node:fs/promises';
import { loadBundle, loadLocaleBundle, getI18n } from '../web/engine/i18n.js';
import { parseCatalog } from '../web/engine/components.js';
import { simulateCode } from '../web/engine/automation-simulator.js';

/**
 * Probes §36 in a real browser: the Chinese bundle.
 *
 * The desktop picks its properties file from the system locale (`BundleHelper.java:11` is
 * `ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle")`), and the page picks its JSON file from
 * the browser's locale, with `?lang=` as the override a visitor needs because a browser's locale is
 * not the language they read. Two things only a browser can show, and both are the interesting ones:
 *
 *  - **the merge, not the swap.** `Bundle_zh_CN.properties` has 419 entries against the default's
 *    422, and three keys exist only in English. The probe runs two designs in node -- the page's own
 *    sample, and the corpus's `single-fuelRodUranium`, which is the shortest design that shows one
 *    of the two before-overheated output lines -- and hands the browser both reports: the panel has
 *    to answer the merged one line for line, and the line the merged report keeps in English is a
 *    line the browser shows in English inside a Chinese panel. A page that swapped the bundle would
 *    answer nothing there, which is a hole in 201 of the 304 corpus designs' reports.
 *  - **the page's own words stay English.** The mode chips are authored in `index.html`, not looked
 *    up, because the bundle has no key for a mode -- so a Chinese visitor reads Chinese readouts
 *    under English chips. Asserted rather than hoped: it is the visible cost of the one thing this
 *    port cannot translate, and a reader who later adds chip keys to the bundle needs to know the
 *    page asks for none today.
 *
 * The expectations are computed here, in node, from the merged bundle; the probe then compares the
 * DOM against them. Run: `node tools/probe-locale.mjs`, then open
 * `http://localhost:8123/web/ui/probe-locale.html?lang=zh-CN` over `tools/serve.mjs`.
 */
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');
const authored = html.match(/<textarea id="code">([^<]*)/)[1];
const authoredChips = [...html.matchAll(/<button data-mode="([A-Za-z]+)"[^>]*>([^<]*)/g)].map((m) => m[2]);
const catalog = parseCatalog(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/components.json', 'utf8'));

loadBundle(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/i18n/en.json', 'utf8'));

/** The page drops a trailing empty line from a report, so both sides are trimmed the same way. */
function lines(report) {
  const rows = report.split('\n');
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

const englishOnly = ['Simulation.AbortedByError', 'Simulation.EUOutputsBeforeOverheated', 'Simulation.HeatOutputsBeforeOverheated'];

// The corpus design that writes one of the before-overheated output lines, which is the one the
// merge leaves in English.
const corpus = (await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/testResources/corpus-codes.tsv', 'utf8'))
  .replace(/\r/g, '').trim().split('\n').map((row) => row.split('\t')).filter((row) => row.length >= 5);

const designs = [{ code: authored, name: 'authored' }];
for (const row of corpus) {
  let english;
  try {
    english = lines(simulateCode(row[4], catalog, {}).report);
  } catch (problem) {
    continue;
  }
  if (!english.some((line) => line.includes('Total output before') || line.includes('EU output before'))) continue;
  designs.push({ code: row[4], name: row[0] });
  break;
}
if (designs.length < 2) throw new Error('no corpus design writes a before-overheated output line');

// Both reports, English alone and merged.
for (const design of designs) {
  design.english = lines(simulateCode(design.code, catalog, {}).report);
}

loadLocaleBundle(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/i18n/zh-CN.json', 'utf8'));

// The three keys Chinese lacks, asserted to answer the default's text once Chinese is merged in.
const enStrings = JSON.parse(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/i18n/en.json', 'utf8')).strings;
const zhStrings = JSON.parse(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/i18n/zh-CN.json', 'utf8')).strings;
for (const key of englishOnly) {
  if (key in zhStrings) throw new Error(`${key} is not English-only: Chinese has it too`);
  if (!(key in enStrings)) throw new Error(`${key} is missing from English too: the claim names the wrong key`);
  if (getI18n(key) !== enStrings[key]) throw new Error(`${key} answers something else under the merged map`);
}

for (const design of designs) {
  design.merged = lines(simulateCode(design.code, catalog, {}).report);
  if (design.english.length !== design.merged.length) {
    throw new Error(`a merged bundle must not change the report's shape: ${design.english.length} vs ${design.merged.length}`);
  }
  design.englishKept = design.merged
    .map((line, i) => (line === design.english[i] ? i : null))
    .filter((i) => i !== null)
    .filter((i) => design.merged[i].trim() !== '');
}
if (designs[0].merged.every((line, i) => line === designs[0].english[i])) {
  throw new Error('nothing translated: the locale never reached the panel');
}
if (designs[1].englishKept.length === 0) throw new Error('the second design was expected to keep an English line');

// The count the header quotes, recomputed here so the comment can be checked against a run rather
// than trusted: how many corpus designs show one of the two before-overheated output lines in English
// once Chinese is merged in.
let writesBeforeOverheated = 0;
let scanned = 0;
for (const row of corpus) {
  let report;
  try {
    report = lines(simulateCode(row[4], catalog, {}).report);
  } catch (problem) {
    continue;
  }
  scanned += 1;
  if (report.some((line) => line.includes('Total output before') || line.includes('EU output before'))) {
    writesBeforeOverheated += 1;
  }
}

const expected = {
  simulate: getI18n('UI.SimulateButton'),
  simulationTab: getI18n('UI.SimulationTab'),
};

/** A value as a JS literal, so the probe compares against the same text node read. */
function js(value) {
  return JSON.stringify(value);
}

const probe = `
<script type="module">
import "./app.js";
try {
const strip = document.getElementById("design");
const panel = document.getElementById("simulation");
const errorPanel = document.getElementById("error");
const simulateButton = document.getElementById("simulate");
const simulationChip = document.querySelector("#modes [data-mode=Simulation]");
const textarea = document.getElementById("code");

const RUNS = ${js(designs.map((d) => ({ code: d.code, merged: d.merged, englishKept: d.englishKept })))};
const TAB = ${js(expected.simulationTab)};
const SIMULATE = ${js(expected.simulate)};
const CHIPS = ${js(authoredChips)};

let failed = 0;
let detail = "";
const perRun = [];

for (let run = 0; run < RUNS.length; run += 1) {
  textarea.value = RUNS[run].code;
  simulateButton.click();
  await new Promise((r) => setTimeout(r, 200));
  simulationChip.click();
  await new Promise((r) => setTimeout(r, 200));

  const rows = [...panel.querySelectorAll("[data-line]")].map((row) => row.textContent);
  const want = RUNS[run].merged;
  if (rows.length !== want.length) {
    failed += 1;
    detail += " run" + run + " lines=" + rows.length + "/" + want.length;
  }
  let kept = 0;
  for (let i = 0; i < want.length; i += 1) {
    if (rows[i] !== want[i]) {
      failed += 1;
      detail += " run" + run + " line" + i + " got[" + rows[i] + "]";
      continue;
    }
    if (RUNS[run].englishKept.includes(i)) kept += 1;
  }
  if (kept !== RUNS[run].englishKept.length) {
    failed += 1;
    detail += " run" + run + " englishKept=" + kept + "/" + RUNS[run].englishKept.length;
  }
  perRun.push("run" + run + " lines=" + rows.length + " englishKept=" + kept);
}

if (panel.firstElementChild.textContent !== TAB) {
  failed += 1;
  detail += " tab got[" + panel.firstElementChild.textContent + "]";
}
if (simulateButton.textContent !== SIMULATE) {
  failed += 1;
  detail += " simulate got[" + simulateButton.textContent + "]";
}
const chips = [];
for (const chip of document.querySelectorAll("#modes [data-mode]")) chips.push(chip.textContent);
for (let i = 0; i < CHIPS.length; i += 1) {
  if (chips[i] !== CHIPS[i]) {
    failed += 1;
    detail += " chip" + i + " got[" + chips[i] + "]";
  }
}

strip.textContent =
  "LOCALE search=" + window.location.search +
  " open=" + !panel.hidden +
  " " + perRun.join(" ") +
  " chips[" + chips.join(",") + "]" +
  " failed=" + failed +
  " detail=" + detail +
  " err=" + errorPanel.textContent;
} catch (e) {
  document.getElementById("design").textContent = "PROBE THREW " + e;
}
</script>
`;

const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-locale.html', out);

console.log(`probe written; designs: ${designs.map((d) => d.name).join(", ")}`);
for (const design of designs) {
  console.log(`  ${design.name}: ${design.merged.length} lines, ${design.englishKept.length} kept English`);
  for (const i of design.englishKept) console.log(`    line ${i} stays English: ${design.merged[i]}`);
}
console.log(`  corpus: ${writesBeforeOverheated} of ${scanned} designs write a before-overheated output line`);
console.log(`expected Chinese: simulate=${expected.simulate}, tab=${expected.simulationTab}`);
