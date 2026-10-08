import { readFile, writeFile } from 'node:fs/promises';

/**
 * Probes the two readouts a run answers with, in a real browser: the temperature-effects line under
 * the board, and the Simulation panel's report.
 *
 * The interesting moves are the two that prove the readouts follow the design rather than the load:
 * opening the panel runs a simulation for whatever the field holds, and a tap that adds a component
 * repaints both while the panel is still open.
 */
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');

const probe = `
<script type="module">
import "./app.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const board = document.getElementById("board");
const code = document.getElementById("code");
const err = document.getElementById("error");
const heat = document.getElementById("temperature");
const panel = document.getElementById("simulation");
const modes = document.getElementById("modes");

const icons = () => board.querySelectorAll("img").length;
const crossed = () => board.querySelectorAll("[data-locked]").length;
const effects = () => heat.querySelector("[data-effects]").textContent;
const rows = () => [...panel.querySelectorAll("[data-lines] > div")];

const loaded = {
  effects: effects(),
  crossed: crossed(),
  icons: icons(),
  hidden: panel.hidden,
  chips: [...modes.children].map((chip) => chip.getAttribute("data-mode")).join(","),
};

const chip = modes.querySelector("[data-mode=\\"Simulation\\"]");
if (chip !== null) chip.click();
await sleep(400);
const opened = {
  caption: panel.querySelector("[data-caption]").textContent,
  lines: rows().length,
  first: rows().length === 0 ? "" : rows()[0].textContent,
  last: rows().length === 0 ? "" : rows()[rows().length - 1].textContent,
  effects: effects(),
};

const entry = document.getElementById("palette").querySelector("[data-id]");
if (entry !== null) entry.click();
await sleep(200);
const firstSlot = [...board.querySelectorAll(":scope > div")].find((slot) => slot.getAttribute("data-index") === "0");
if (firstSlot !== undefined) firstSlot.click();
await sleep(300);
const edited = {
  icons: icons(),
  crossed: crossed(),
  code: code.value,
  effects: effects(),
  lines: rows().length,
  err: err.textContent,
};

const compare = modes.querySelector("[data-mode=\\"Compare\\"]");
if (compare !== null) compare.click();
await sleep(200);
const switched = { simulationHidden: panel.hidden, effects: effects() };
const codeLength = code.value.length;

const line = "TEMPERATURE effects=" + loaded.effects + " crossed=" + loaded.crossed + " icons=" + loaded.icons +
  " chips=" + loaded.chips + " simHidden=" + loaded.hidden +
  " | opened caption=" + opened.caption + " lines=" + opened.lines + " first=" + opened.first +
  " last=" + opened.last + " effects=" + opened.effects +
  " | edited icons=" + edited.icons + " crossed=" + edited.crossed + " lines=" + edited.lines +
  " effects=" + edited.effects + " err=" + edited.err +
  " | switched simHidden=" + switched.simulationHidden + " effects=" + switched.effects +
  " codeLen=" + codeLength;
await fetch("/_log", { method: "POST", body: line });
console.log(line);
</script>
`;

const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-temperature.html', out);
console.log('probe written: web/ui/probe-temperature.html');
