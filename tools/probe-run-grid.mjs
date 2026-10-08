import { readFile, writeFile } from 'node:fs/promises';
import { loadBundle, getI18n } from '../web/engine/i18n.js';
import { parseCatalog } from '../web/engine/components.js';
import { describeBoard } from '../web/ui/board.js';
import { simulate } from '../web/ui/inspect.js';
import { runMarks, runLegend } from '../web/ui/run-grid.js';

/**
 * Probes §35 in a real browser: what a run leaves on the grid.
 *
 * The desktop's simulator is a `SwingWorker`, and the run's grid state travels through its message
 * channel as one-line chunks — `AutomationSimulator` publishes `R%dC%d:0xRRGGBB` (`:191` silver for
 * every one of the 54 cells before the loop starts, `:367` orange for a component that still holds
 * heat at the end, `:686` red for one that broke) and the worker's own `process` (`:984-997`) paints
 * each chunk onto `reactorButtonPanels[row][col]`, which is the frame's *design* grid, and sets that
 * button's tooltip to `ComponentTooltip.Broken` or `ComponentTooltip.ResidualHeat`. The page marks
 * the same cells with the same two colours and the same words, and adds a legend strip because a
 * phone has no hover and a screenshot has no tooltip.
 *
 * The expectations are computed here, in node, from the engine's own chunks; the probe then compares
 * the DOM against them, so a page that marked the wrong cells, or the right cells in the wrong
 * colour, fails in the browser rather than in review. `gen-084` is a corpus design that melts two
 * components and leaves one hot, which is what makes the probe worth running: a design that marks
 * nothing would pass with a page that draws no marks at all.
 */
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');

loadBundle(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/i18n/en.json', 'utf8'));
const catalog = parseCatalog(await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/data/components.json', 'utf8'));

const sample = /<textarea id="code">([^<]*)/.exec(html)[1];
const melting = 'erp=URakFLliiThkikWEL8zI5jIKskXDwZr9kPzzQNrdwOzNqNhkWIyCmKQ6KhaBOmFpb089sAzodgGZBA==';

// The probe page is the authored one with the field pointed at a corpus design that melts two
// components and leaves one hot, so the board it draws is that design's and the run it starts is
// that design's run — the same pairing a visitor gets when they paste a design and click Simulate.
const probeHtml = html.replace(/<textarea id="code">[^<]*/, `<textarea id="code">${melting}`);
if (probeHtml === html) throw new Error('the authored field was not found to point at the melting design');

// The board the page draws is the melting design's; the run the probe starts is that design's run.
// The page marks the intersection, which is its rule: a colour only goes on a cell it shows an icon
// for. That is also what the probe checks — the marks have to land on the cells already drawn.
const sampleBoard = describeBoard(melting, catalog);
if (!sampleBoard.ok) throw new Error(`the authored field does not decode: ${sampleBoard.title}: ${sampleBoard.message}`);
const filled = new Set(sampleBoard.cells.map((cell) => cell.index));

const run = simulate(melting, catalog);
if (!run.ok) throw new Error(`the melting design does not run: ${run.message}`);
const marks = runMarks(run.run.cellPaint, filled);
if (marks.length === 0) throw new Error('the melting design marks no cell of the authored board; the probe would prove nothing');

const want = marks.map((mark) => `${mark.index}=${mark.kind === 'melt' ? 'melt' : 'hot'}`).sort();
const wantTitles = marks.map((mark) => `${mark.index}:${mark.tooltip}`).sort();
const wantRows = runLegend(marks).map((row) => row.words);

const probe = `
<script type="module">
import "./app.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = document.getElementById("code");
const err = document.getElementById("error");
const board = document.getElementById("board");
const modes = document.getElementById("modes");
const simulation = document.getElementById("simulation");
const legend = document.getElementById("runlegend");

const marked = () => [...board.querySelectorAll("[data-melt]")].map((n) => n.getAttribute("data-index") + "=melt")
  .concat([...board.querySelectorAll("[data-residual]")].map((n) => n.getAttribute("data-index") + "=hot")).sort();
const titles = () => [...board.querySelectorAll("[data-melt],[data-residual]")].map((n) => n.getAttribute("data-index") + ":" + n.getAttribute("title")).sort();
const words = () => [...legend.querySelectorAll("[data-key]")].map((n) => n.textContent).sort();

const closed = { hidden: simulation.hidden, legendHidden: legend.hidden, marks: marked() };

// A corpus design that melts two components and leaves one hot: the desktop shows both colours for
// it, so a page that draws nothing would pass a probe against a design that marks nothing.
document.getElementById("simulate").click();
await sleep(400);

const ran = { hidden: simulation.hidden, err: err.textContent, marks: marked(), titles: titles(), legendHidden: legend.hidden, rows: words() };

modes.querySelector('[data-mode="Simulation"]').click();
await sleep(250);
const opened = { hidden: simulation.hidden, legendHidden: legend.hidden, marks: marked(), rows: words() };

const same = (a, b) => a.join("|") === b.join("|");
const verdict = [
  same(ran.marks, ${JSON.stringify(want)}) ? "marks=ok" : "marks=BAD " + ran.marks.join(",") + " want " + ${JSON.stringify(want.join(","))},
  same(ran.titles, ${JSON.stringify(wantTitles)}) ? "titles=ok" : "titles=BAD " + ran.titles.join(" ~ "),
  ran.legendHidden ? "legend=BAD closed" : (same(ran.rows, ${JSON.stringify(wantRows)}) ? "legend=ok" : "legend=BAD " + ran.rows.join(" ~ ")),
  opened.legendHidden === false && same(opened.rows, ${JSON.stringify(wantRows)}) ? "legendKeptOpen=ok" : "legendKeptOpen=BAD",
  closed.marks.length === 0 && closed.legendHidden ? "loadMarksNothing=ok" : "loadMarksNothing=BAD " + closed.marks.join(","),
].join(" ");

const line = "RUNGRID closed hidden=" + closed.hidden + " legendClosed=" + closed.legendHidden + " marks=" + closed.marks.join(",") +
  " | ran hidden=" + ran.hidden + " err=" + ran.err + " marks=" + ran.marks.join(",") + " titles=" + ran.titles.join(" ~ ") +
  " legend=" + (ran.legendHidden ? "closed" : "open " + ran.rows.join(" ~ ")) +
  " | opened hidden=" + opened.hidden + " marks=" + opened.marks.join(",") + " rows=" + opened.rows.join(" ~ ") +
  " | verdict " + verdict;

await fetch("/_log", { method: "POST", body: line });
console.log(line);
</script>
`;

const out = probeHtml.replace('</head>', probe + '\n</head>');
if (out === probeHtml) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-run-grid.html', out);
console.log('probe written: web/ui/probe-run-grid.html');
console.log('want marks: ' + want.join(',') + ' | titles: ' + wantTitles.join(' ~ ') + ' | legend rows: ' + wantRows.join(' ~ '));
