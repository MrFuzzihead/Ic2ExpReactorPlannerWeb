import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');
const designs = JSON.parse(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/testResources/corpus-designs.json', 'utf8')).designs;
const authored = html.match(/<textarea id="code">([^<]*)/)[1];
const other = designs.find((d) => d.code !== authored).code;

/**
 * The desktop's own layout report.
 *
 * Every panel this repository has built is a column of rows: the automation panel is 17 rows, the
 * materials list 29, the comparison 62. At a phone width that is fine — the page scrolls and a thumb
 * scrolls further. At a monitor width the same columns sit in the reading order the design doc chose
 * (board, controls, code, Copy, then the panels), and the page gets taller than the screen several
 * times over: the code and the Copy button, the two things a desktop visitor uses most, end up below
 * a fold that needs scrolling to reach.
 *
 * This page measures that rather than eyeballing a screenshot: it drives two corpus designs so the
 * readouts have data, then visits every mode chip and reports, per mode, how tall the page got, how
 * tall that mode's panel is, and whether the Copy button is still above the fold. The chips are
 * exclusive — `wireModes` clears `data-active` from every other chip — so at most one panel is open
 * at a time, and the worst case is the tallest one: `Compare`, 62 rows.
 */
const probe = `
<script type="module">
import "./app.js";
const strip = document.getElementById("design");
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

const vw = Math.round(innerWidth);
const vh = Math.round(innerHeight);
const board = document.getElementById("board");
const boardBottom = board === null ? -1 : Math.round(board.getBoundingClientRect().bottom);

function tick(ms) { return new Promise((r) => setTimeout(r, ms)); }
function panelHeight(id) {
  const panel = document.getElementById(id);
  return panel === null ? -1 : Math.round(panel.getBoundingClientRect().height);
}

const parts = [];
for (const label of ["Place", "Clear", "Pick", "Inspect", "Automate", "Materials", "Compare"]) {
  const chip = document.querySelector('#modes [data-mode="' + label + '"]');
  if (chip === null) { parts.push(label + "=missing"); continue; }
  chip.click();
  await tick(120);
  const copyTop = Math.round(document.getElementById("copy").getBoundingClientRect().top);
  const pageH = Math.round(document.documentElement.scrollHeight);
  const panelH = label === "Automate" ? panelHeight("automation")
    : label === "Materials" ? panelHeight("materials")
    : label === "Compare" ? panelHeight("comparison") : -1;
  const lines = label === "Compare" ? document.getElementById("comparison").querySelectorAll("[data-line]") : [];
  const rowHeights = Array.from(lines).map((line) => Math.round(line.getBoundingClientRect().height));
  const maxRowH = rowHeights.length === 0 ? -1 : Math.max(...rowHeights);
  const box = label === "Compare" ? document.getElementById("comparison") : null;
  const scrollH = box === null ? -1 : Math.round(box.scrollHeight);
  const viewH = box === null ? -1 : Math.round(box.clientHeight);
  const overflowY = box === null ? "-" : getComputedStyle(box).overflowY;
  parts.push(label + " pageH=" + pageH + " panelH=" + panelH + " rows=" + lines.length +
    " maxRowH=" + maxRowH + " scrollH=" + scrollH + " viewH=" + viewH + " overflowY=" + overflowY +
    " copyTop=" + copyTop +
    " copyAboveFold=" + (copyTop >= 0 && copyTop < vh));
}

const report =
  "DESKTOP vw=" + vw + " vh=" + vh + " boardBottom=" + boardBottom + " " + parts.join(" | ");

const box = document.getElementById("comparison");
const all = box.querySelectorAll("[data-line]");
box.scrollTop = box.scrollHeight;
await tick(120);
const lastTop = Math.round(all[all.length - 1].getBoundingClientRect().top);
const boxBottom = Math.round(box.getBoundingClientRect().bottom);

// The stale-cell case the wide screenshot showed: force the board back to a size a smaller window
// produced, then fire a resize event and require the cell to come back to this viewport's size.
const boardElement = document.getElementById("board");
const slot = boardElement.querySelector("[data-index='0']");
boardElement.style.setProperty("--cell", "27px");
const cellBefore = Math.round(slot.getBoundingClientRect().width);
window.dispatchEvent(new Event("resize"));
await tick(60);
const cellAfter = Math.round(slot.getBoundingClientRect().width);
const codeW = Math.round(document.getElementById("code").getBoundingClientRect().width);

strip.textContent = "DESKTOP vw=" + vw + " vh=" + vh + " — per-mode report posted to the dev server";
await fetch("/_log", { method: "POST", body: report + " scrolled lastRowTop=" + lastTop + " boxBottom=" + boxBottom + " lastRowReachable=" + (lastTop < boxBottom) + " cellForced=" + cellBefore + " cellAfterResize=" + cellAfter + " codeW=" + codeW });
</script>
`;
const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-desktop.html', out);
console.log('probe written: web/ui/probe-desktop.html');
