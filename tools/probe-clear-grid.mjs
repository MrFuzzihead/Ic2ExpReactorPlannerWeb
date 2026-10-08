import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');
const probe = `
<script type="module">
import "./app.js";
const strip = document.getElementById("design");
const code = document.getElementById("code");
const board = document.getElementById("board");
const button = document.getElementById("cleargrid");

const iconsBefore = board.querySelectorAll("img").length;
const codeBefore = code.value;
const label = button.textContent;
const buttonH = Math.round(button.getBoundingClientRect().height);

button.click();
await new Promise((r) => setTimeout(r, 150));

const iconsAfter = board.querySelectorAll("img").length;
const flags = [...strip.querySelectorAll("[data-flag]")]
  .map((chip) => chip.getAttribute("data-flag"));
const list = document.getElementById("materials");
const listText = list.querySelector("[data-list]");
const listLen = listText === null ? "panel closed" : listText.textContent.length;

strip.textContent = "CLEARGRID label=" + label + " icons=" + iconsBefore + "->" + iconsAfter +
  " codeLen=" + codeBefore.length + "->" + code.value.length +
  " code=" + code.value.slice(0, 40) +
  " flags=" + flags.join(",") + " listLen=" + listLen + " buttonH=" + buttonH +
  " err=" + document.getElementById("error").textContent;
console.log(strip.textContent);
await fetch("/_log", { method: "POST", body: strip.textContent });
</script>
`;
const out = html.replace("</head>", probe + "\n</head>");
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-clear-grid.html', out);
console.log('probe written: web/ui/probe-clear-grid.html');
