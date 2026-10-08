import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');
const probe = `
<script type="module">
import "./app.js";
const strip = document.getElementById("design");
const code = document.getElementById("code");
const err = document.getElementById("error");

let execTried = 0;
const realExec = document.execCommand;
document.execCommand = (command) => { execTried++; return realExec(command); };

const hasClipboard = globalThis.navigator?.clipboard !== undefined;
const button = document.getElementById("copy");
button.click();
await new Promise((r) => setTimeout(r, 120));   // the clipboard call is async; let its catch run

const manifest = document.querySelector("link[rel=manifest]");
let manifestHref = manifest === null ? "none" : manifest.href;
let theme = "none";
document.querySelectorAll("meta[name=theme-color]").forEach((m) => { theme = m.content; });

strip.textContent = "COPY clipboard=" + hasClipboard + " exec=" + execTried +
  " code=" + code.value.slice(0, 28) +
  " manifest=" + manifestHref + " theme=" + theme + " err=" + err.textContent;

let coarseRule = "absent";
for (const sheet of document.styleSheets) {
  for (const rule of sheet.cssRules) {
    if (rule.conditionText && rule.conditionText.includes("pointer: coarse")) coarseRule = "present";
  }
}
strip.textContent = strip.textContent + " coarseRule=" + coarseRule +
  " chipH=" + Math.round(document.getElementById("modes").firstElementChild.getBoundingClientRect().height) +
  " copyH=" + Math.round(button.getBoundingClientRect().height);
</script>
`;
const out = html.replace("</head>", probe + "\n</head>");
if (out === html) throw new Error("no </head>");
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-copy.html', out);

// The same page with the coarse-pointer condition forced to always hold: headless Edge reports a
// fine pointer and cannot claim a touch device, so this is the instrument that measures what a phone
// gets -- the declarations are the page's own, only the condition is overridden.
const forced = out.replace("@media (pointer: coarse)", "@media all");
if (forced === out) throw new Error("no coarse media block to force");
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-touch.html', forced);
console.log("probes written: probe-copy.html, probe-touch.html");
