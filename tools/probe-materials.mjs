import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');

/**
 * The `Materials` panel under a real browser.
 *
 * `page.test.js` proves the panel's DOM and its strings under the shim; what a browser adds is the
 * layout the shim has none of -- how tall the panel gets, whether the four GregTech chips wrap
 * inside 92 vw, and whether the engine's newlines survive as lines in a `pre-wrap` box. The strip
 * reports the numbers, the screenshot shows them.
 *
 * The probe drives the page the way a visitor taps it: it lights the chip, then taps a version and
 * the alloy checkbox, so the panel it leaves open is one the page actually built rather than one the
 * probe assembled.
 */
const probe = `
<script type="module">
import "./app.js";
const strip = document.getElementById("design");
const panel = document.getElementById("materials");
const modes = document.getElementById("modes");

const materialsChip = document.querySelector("#modes [data-mode=Materials]");
materialsChip.click();
await new Promise((r) => setTimeout(r, 120));

const gtChips = panel.querySelectorAll("[data-gt]");
const alloy = panel.querySelector("[data-alloy]");
const list = panel.querySelector("[data-list]");
const caption = panel.firstElementChild;

const before = list.textContent;
gtChips[2].click();                       // 5.09, the version the recipe table reads
await new Promise((r) => setTimeout(r, 60));
const afterGt = list.textContent;
alloy.click();                            // expand Advanced Alloy
await new Promise((r) => setTimeout(r, 60));
const expanded = list.textContent;

const lit = [...panel.querySelectorAll("[data-gt]")].filter((c) => c.hasAttribute("data-active"));
strip.textContent =
  "MATERIALS open=" + !panel.hidden +
  " caption=" + caption.textContent +
  " gt=" + gtChips.length + "/" + lit.map((c) => c.getAttribute("data-gt")).join(",") +
  " alloyOff=" + alloy.hasAttribute("data-off") +
  " lines=" + before.split("\\n").length +
  " gtChanged=" + (afterGt !== before) +
  " beryllium=" + afterGt.includes("Beryllium") +
  " alloyGone=" + !expanded.includes("Advanced Alloy") +
  " bronze=" + expanded.includes("Bronze") +
  " err=" + document.getElementById("error").textContent +
  " panelH=" + Math.round(panel.getBoundingClientRect().height) +
  " panelW=" + Math.round(panel.getBoundingClientRect().width) +
  " gtH=" + Math.round(gtChips[0].getBoundingClientRect().height) +
  " listH=" + Math.round(list.getBoundingClientRect().height);
</script>
`;
const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-materials.html', out);

// The same page with the coarse-pointer condition forced to always hold: headless Edge reports a
// fine pointer and cannot claim a touch device, so this is the instrument that measures what a phone
// gets -- the declarations are the page's own, only the condition is overridden.
const forced = out.replace('@media (pointer: coarse)', '@media all');
if (forced === out) throw new Error('no coarse media block to force');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-materials-touch.html', forced);
console.log('probes written: probe-materials.html, probe-materials-touch.html');
