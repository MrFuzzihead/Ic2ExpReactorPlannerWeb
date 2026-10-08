import { readFile, writeFile } from 'node:fs/promises';
import { loadBundle, getI18n } from '../web/engine/i18n.js';
import { parseCatalog } from '../web/engine/components.js';
import { simulateCode } from '../web/engine/automation-simulator.js';
import { compareRuns } from '../web/engine/comparison.js';
import { designReactor, comparisonLines } from '../web/ui/comparison.js';

const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');
const designs = JSON.parse(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/testResources/corpus-designs.json', 'utf8')).designs;
const authored = html.match(/<textarea id="code">([^<]*)/)[1];
const other = designs.find((d) => d.code !== authored).code;

loadBundle(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/i18n/en.json', 'utf8'));
const catalog = parseCatalog(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/components.json', 'utf8'));

// What the copy button has to write, built here from the engine rather than read off the page. The
// page ran `authored` first and `other` second, so the comparison it draws is `other` against
// `authored` -- the desktop's own order, where `updateComparison` puts the finished run on the left
// and the one before it on the right.
const left = designReactor(other, catalog);
const right = designReactor(authored, catalog);
if (!left.ok || !right.ok) throw new Error(`cannot rebuild the pair: ${left.message ?? right.message}`);
const got = compareRuns(
  { data: simulateCode(other, catalog, {}).data, reactor: left.reactor },
  { data: simulateCode(authored, catalog, {}).data, reactor: right.reactor },
  { onlyShowDiff: false },
);
if (!got.ok) throw new Error(`the pair must compare: ${got.message}`);
const expectedText = comparisonLines(got.html)
  .map((line) => line.runs.map((run) => run.text).join(''))
  .join('\n');
const expectedLabel = getI18n('UI.CopyComparisonData');

/**
 * The `Compare` panel under a real browser.
 *
 * `comparison.test.js` proves the label's strings and the renderer's runs; what a browser adds is
 * the layout the shim has none of -- whether thirty-odd rows of comparison fit the collapsed panel's
 * expansion, whether the three colour words the stylesheet carries actually paint, and whether an
 * empty row survives as a gap rather than a collapsed nothing.
 *
 * The probe drives the page the way a visitor taps it: it runs one design, pastes a second and runs
 * that, and only then lights the chip -- so the panel it leaves open is one the page built from two
 * finished runs rather than one the probe assembled.
 *
 * The copy button is the second thing this probe carries. `UI.CopyComparisonData` (`ReactorPlannerFrame.java:1855`,
 * action at `:2385-2389`) puts `comparisonLabel.getText()` on the system clipboard as an `HtmlSelection`;
 * the page writes the panel's own rows joined with newlines, because the Clipboard API only offers
 * `writeText`. A headless browser cannot read a system clipboard back, and Edge refuses a probe that
 * swaps `navigator.clipboard` for a recorder (it is a getter-only accessor), so the instrument stops
 * one step short: it asserts the rows the button hands over are exactly the comparison the engine
 * builds in node, line for line, and that the tap neither throws nor disturbs the panel. That the
 * text is right and that a browser lets the page write it are the two halves; only the second one
 * needs a real click, and §20's rule already says a headless browser cannot grant one.
 */

/**
 * The `Compare` panel under a real browser.
 *
 * `comparison.test.js` proves the label's strings and the renderer's runs; what a browser adds is
 * the layout the shim has none of -- whether thirty-odd rows of comparison fit the collapsed panel's
 * expansion, whether the three colour words the stylesheet carries actually paint, and whether an
 * empty row survives as a gap rather than a collapsed nothing.
 *
 * The probe drives the page the way a visitor taps it: it runs one design, pastes a second and runs
 * that, and only then lights the chip -- so the panel it leaves open is one the page built from two
 * finished runs rather than one the probe assembled.
 */
const probe = `
<script type="module">
import "./app.js";
try {
const EXPECTED = ${JSON.stringify(expectedText)};
const EXPECTED_LABEL = ${JSON.stringify(expectedLabel)};
const strip = document.getElementById("design");
const panel = document.getElementById("comparison");
const textarea = document.getElementById("code");

const inspectChip = document.querySelector("#modes [data-mode=Inspect]");
const compareChip = document.querySelector("#modes [data-mode=Compare]");

function runOn(code) {
  textarea.value = code;
  const slot = document.querySelector("#board [data-index='0']");
  inspectChip.click();
  if (slot !== null) slot.click();
}

runOn("${authored}");
await new Promise((r) => setTimeout(r, 150));
runOn("${other}");
await new Promise((r) => setTimeout(r, 150));

compareChip.click();
await new Promise((r) => setTimeout(r, 150));

const rows = panel.querySelectorAll("[data-line]");
const coloured = panel.querySelectorAll("[data-color]");
const toggle = panel.querySelector("[data-toggle]");
const prevCode = panel.querySelector("[data-prev-code]");
const caption = panel.firstElementChild;
const copyButton = panel.querySelector("[data-copy-comparison]");
const rowsBefore = panel.querySelectorAll("[data-line]").length;
if (copyButton !== null) copyButton.click();
await new Promise((r) => setTimeout(r, 100));

// The text the button hands over, read back off the panel rather than off a clipboard a headless
// browser will not show.
let panelText = "";
for (let i = 0; i < rows.length; i += 1) panelText += (i === 0 ? "" : "\\n") + rows[i].textContent;

const words = new Set();
for (const span of coloured) words.add(span.getAttribute("data-color"));
const painted = new Set();
for (const span of coloured) painted.add(getComputedStyle(span).color);

strip.textContent =
  "COMPARE open=" + !panel.hidden +
  " caption=" + caption.textContent +
  " rows=" + rows.length +
  " emptyRows=" + [...rows].filter((r) => r.textContent === "").length +
  " coloured=" + coloured.length +
  " words=" + [...words].sort().join(",") +
  " painted=" + [...painted].sort().join(" | ") +
  " toggleOff=" + (toggle !== null && toggle.hasAttribute("data-off")) +
  " prevCode=" + (prevCode !== null && prevCode.textContent !== "") +
  " err=" + document.getElementById("error").textContent +
  " copyLabel=" + (copyButton === null ? "MISSING" : copyButton.textContent) +
  " copyLabelOk=" + (copyButton !== null && copyButton.textContent === EXPECTED_LABEL) +
  " copyExact=" + (panelText === EXPECTED) +
  " copyChars=" + panelText.length +
  " expectedChars=" + EXPECTED.length +
  " rowsUnchanged=" + (panel.querySelectorAll("[data-line]").length === rowsBefore) +
  " panelH=" + Math.round(panel.getBoundingClientRect().height) +
  " rowH=" + Math.round(rows[0].getBoundingClientRect().height);
} catch (e) {
  document.getElementById("design").textContent = "PROBE THREW " + e;
}
</script>
`;
const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-comparison.html', out);

// The same page with the coarse-pointer condition forced to always hold: headless Edge reports a
// fine pointer and cannot claim a touch device, so this is the instrument that measures what a phone
// gets -- the declarations are the page's own, only the condition is overridden.
const forced = out.replace('@media (pointer: coarse)', '@media all');
if (forced === out) throw new Error('no coarse media block to force');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-comparison-touch.html', forced);
console.log('probes written: probe-comparison.html, probe-comparison-touch.html');
