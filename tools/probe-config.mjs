import { readFile, writeFile } from 'node:fs/promises';

/**
 * Probes the three pieces §32-§33 add in a real browser: the reactor-level configuration panel
 * (radio pair, three checkboxes, six spinners, the max-heat readout, the pulse group that only
 * exists while the pulsed flag is on, and the old-style code toggle), the Component List panel,
 * and the Simulate button that starts a run rather than showing one.
 *
 * A typed number is modelled the way the shim models one -- set `value`, then fire `change` on the
 * input itself, which is where a browser leaves it. The input is re-queried before every type
 * because the panel is rebuilt when the pulsed flag changes, and a handle taken before a rebuild
 * points at a detached node.
 *
 * The run ends with the field holding an old-style code, so the same run yields a screenshot in
 * which the legacy format is visible.
 */
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');

const probe = `
<script type="module">
import "./app.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = document.getElementById("code");
const err = document.getElementById("error");
const board = document.getElementById("board");
const modes = document.getElementById("modes");
const config = document.getElementById("config");
const components = document.getElementById("components");
const compare = document.getElementById("comparison");
const simulation = document.getElementById("simulation");

const all = (root, name) => [...root.querySelectorAll("[" + name + "]")];
const chips = (name) => all(config, name).map((c) => c.textContent + (c.hasAttribute("data-off") ? "!" : "") + (c.hasAttribute("data-active") ? "*" : ""));
const spinners = () => all(config, "data-field").filter((n) => n.tagName === "INPUT").map((i) => i.getAttribute("data-field") + "=" + i.value + "/" + i.getAttribute("min") + ".." + i.getAttribute("max"));
const spinnerLabels = () => all(config, "data-field").filter((n) => n.tagName === "LABEL").map((l) => l.getAttribute("data-field") + ":" + l.textContent);
const heatLine = () => { const n = all(config, "data-max-heat"); return n.length === 0 ? "?" : n[0].textContent; };
const pulseRows = () => all(config, "data-pulse-row").map((r) => [...r.children].map((k) => k.tagName + ":" + (k.tagName === "INPUT" ? k.value : k.textContent)).join(" "));
const pulseCaption = () => { const n = all(config, "data-caption"); return n.length === 0 ? "?" : n[0].textContent; };
const helpLines = () => all(config, "data-help").map((n) => n.textContent);
const compLines = () => [...components.querySelectorAll("[data-line]")].map((n) => n.textContent);
const icons = () => board.querySelectorAll("img").length;
const prevCode = () => { const n = compare.querySelector("[data-prev-code]"); return n === null ? "?" : n.textContent; };
const lockState = () => { const n = compare.querySelector('[data-toggle="lock"]'); return n === null ? "?" : n.textContent + (n.hasAttribute("data-off") ? "!" : ""); };
const pulseInput = () => config.querySelector('input[data-field="onPulse"]');

const closed = { hidden: config.hidden, icons: icons(), code: code.value };

modes.querySelector('[data-mode="Config"]').click();
await sleep(250);
const opened = { hidden: config.hidden, styles: chips("data-style"), flags: chips("data-flag"), legacy: chips("data-legacy"), spinners: spinners(), labels: spinnerLabels(), heat: heatLine(), pulse: pulseRows(), caption: pulseCaption(), help: helpLines(), err: err.textContent };

// The pulsed flag is the one control that changes the panel's shape: the desktop's togglePulseConfigTab
// inserts the Swing tab rather than greying it out.
config.querySelector('[data-flag="pulsed"]').click();
await sleep(250);
const pulsed = { flags: chips("data-flag"), spinners: spinners(), pulse: pulseRows(), caption: pulseCaption(), code: code.value };

pulseInput().value = "7";
pulseInput().dispatchEvent(new Event("change"));
await sleep(250);
const typed = { pulse: pulseRows(), spinners: spinners(), code: code.value, err: err.textContent };

pulseInput().value = "6000000";
pulseInput().dispatchEvent(new Event("change"));
await sleep(250);
const refused = { pulse: pulseRows(), spinners: spinners(), err: err.textContent, code: code.value };

config.querySelector("[data-reset-pulse]").click();
await sleep(250);
const resetBack = { pulse: pulseRows(), code: code.value, err: err.textContent };

config.querySelector('[data-style="fluid"]').click();
await sleep(250);
const styled = { styles: chips("data-style"), code: code.value, err: err.textContent };

const legacyChip = config.querySelector("[data-legacy]");
legacyChip.click();
await sleep(250);
const legacy = { chip: chips("data-legacy"), code: code.value, icons: icons(), spinners: spinners(), err: err.textContent };

// Back to the current format, which is what the tick limit survives in.
config.querySelector("[data-legacy]").click();
await sleep(250);
const current = { chip: chips("data-legacy"), code: code.value, icons: icons(), spinners: spinners(), err: err.textContent };

document.getElementById("simulate").click();
await sleep(400);
const ran = { hidden: simulation.hidden, lines: [...simulation.querySelectorAll("[data-line]")].map((n) => n.textContent), err: err.textContent };

modes.querySelector('[data-mode="Compare"]').click();
await sleep(250);
const compared = { hidden: compare.hidden, prev: prevCode(), lock: lockState() };

document.getElementById("simulate").click();
await sleep(400);
const rerun = { prev: prevCode(), lines: [...compare.querySelectorAll("[data-line]")].map((n) => n.textContent).slice(0, 3) };

modes.querySelector('[data-mode="Components"]').click();
await sleep(250);
const listed = { hidden: components.hidden, caption: (() => { const n = components.querySelector("[data-caption]"); return n === null ? "?" : n.textContent; })(), lines: compLines() };

const prefs = localStorage.getItem("erp-prefs");

const line = "CONFIG closedHidden=" + closed.hidden +
  " | opened styles=" + opened.styles.join(",") + " flags=" + opened.flags.join(",") + " legacy=" + opened.legacy.join(",") +
  " spinners=" + opened.spinners.join(",") + " labels=" + opened.labels.join(" ") + " heat=" + opened.heat +
  " pulse=" + opened.pulse.join(" ~ ") + " caption=" + opened.caption + " help=" + opened.help.join(" ~ ") +
  " | pulsed flags=" + pulsed.flags.join(",") + " spinners=" + pulsed.spinners.join(",") + " pulse=" + pulsed.pulse.join(" ~ ") +
  " caption=" + pulsed.caption + " code=" + pulsed.code +
  " | typed pulse=" + typed.pulse.join(" ~ ") + " code=" + typed.code +
  " | refused err=" + refused.err + " pulse=" + refused.pulse.join(" ~ ") +
  " | reset=" + resetBack.pulse.join(" ~ ") + " | styles=" + styled.styles.join(",") +
  " | legacy chip=" + legacy.chip.join(",") + " code=" + legacy.code + " icons=" + legacy.icons +
  " | current chip=" + current.chip.join(",") + " code=" + current.code + " err=" + current.err +
  " | ran hidden=" + ran.hidden + " lines=" + ran.lines.join(" ~ ") +
  " | compare lock=" + compared.lock + " prev=" + compared.prev +
  " | rerun prev=" + rerun.prev + " lines=" + rerun.lines.join(" ~ ") +
  " | components hidden=" + listed.hidden + " caption=" + listed.caption + " lines=" + listed.lines.join(" ~ ") +
  " | prefs=" + prefs;

await fetch("/_log", { method: "POST", body: line });
console.log(line);
</script>
`;

const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-config.html', out);
console.log('probe written: web/ui/probe-config.html');
