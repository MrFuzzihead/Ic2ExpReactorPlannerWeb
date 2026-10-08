import { readFile, writeFile } from 'node:fs/promises';

/**
 * Probes the Reactor Chamber gate in a real browser: the spinner's bounds, the columns it crosses,
 * a tap in a closed column, and the remembered count. A typed number is modelled the way the shim
 * models one -- set `value`, then fire `change` on the input itself, which is where a browser leaves
 * it -- so the probe exercises the page's own handler rather than a script writing into a field.
 *
 * The run ends with the gate closed at 2 chambers and one component standing in the open part, so
 * the same run yields a screenshot of the crossed frame.
 */
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');

const probe = `
<script type="module">
import "./app.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const board = document.getElementById("board");
const code = document.getElementById("code");
const err = document.getElementById("error");
const panel = document.getElementById("chambers");
const input = panel.querySelector("input");
const label = panel.querySelector("label");

const slots = () => [...board.querySelectorAll(":scope > div")];
const icons = () => board.querySelectorAll("img").length;
const crossed = () => board.querySelectorAll("[data-locked]").length;

const loaded = { icons: icons(), crossed: crossed(), chambers: input.value, label: label.textContent, min: input.getAttribute("min"), max: input.getAttribute("max") };

document.getElementById("cleargrid").click();
await sleep(200);
const cleared = { icons: icons(), crossed: crossed(), chambers: input.value, code: code.value };

// A component has to be selected before a tap reaches the gate: placeInto refuses with the
// bundle's "no component selected" first, and that would hide the gate's own refusal.
const entry = document.getElementById("palette").querySelector("[data-id]");
if (entry !== null) entry.click();
await sleep(200);
const selected = { err: err.textContent };

const firstSlot = slots().find((slot) => slot.getAttribute("data-index") === "0");
if (firstSlot !== undefined) firstSlot.click();
await sleep(200);
const placed = { icons: icons(), crossed: crossed(), code: code.value, err: err.textContent };

input.value = "2";
input.dispatchEvent(new Event("change"));
await sleep(200);
const closed = { crossed: crossed(), icons: icons(), chambers: input.value, err: err.textContent };

const closedSlot = slots().find((slot) => slot.hasAttribute("data-locked"));
const closedIndex = closedSlot === undefined ? -1 : closedSlot.getAttribute("data-index");
if (closedSlot !== undefined) closedSlot.click();
await sleep(200);
const refused = { err: err.textContent, icons: icons(), crossed: crossed(), code: code.value };

const remembered = localStorage.getItem("erp-prefs");

const line = "CHAMBERS label=" + loaded.label + " bounds=" + loaded.min + "/" + loaded.max +
  " loadedChambers=" + loaded.chambers + " loadedCrossed=" + loaded.crossed + " loadedIcons=" + loaded.icons +
  " | cleared icons=" + cleared.icons + " crossed=" + cleared.crossed + " chambers=" + cleared.chambers +
  " code=" + cleared.code +
  " | selected err=" + selected.err +
  " | placed icons=" + placed.icons + " code=" + placed.code + " err=" + placed.err +
  " | closed chambers=" + closed.chambers + " crossed=" + closed.crossed + " icons=" + closed.icons +
  " | refused err=" + refused.err + " icons=" + refused.icons + " closedIndex=" + closedIndex +
  " | prefs=" + remembered;

await fetch("/_log", { method: "POST", body: line });
console.log(line);
</script>
`;

const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-chambers.html', out);
console.log('probe written: web/ui/probe-chambers.html');
