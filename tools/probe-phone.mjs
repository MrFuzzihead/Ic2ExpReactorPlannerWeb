import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/index.html', 'utf8');

/**
 * The phone's own report, written where the phone can read it.
 *
 * §20 named the instrument limit: headless Edge answers `pointer: fine` whatever the window size, so
 * every capture this repository can take proves what the coarse declarations *would* do, not what a
 * phone does. A phone can answer the question itself, and it does not need a screenshot to be read --
 * the numbers go into the page's own status strip, which is already a box the page uses for one-line
 * reports.
 *
 * Open this over the dev server's LAN address (`tools/serve.mjs` prints it) from a phone on the same
 * network. The strip then reads what the phone's browser decided: which media condition selected the
 * touch sizing, how wide the viewport is, whether the board fits without sideways scrolling, and how
 * tall the tap targets came out against the 40 px guideline `WEB_DESIGN.md` states.
 *
 * Nothing here drives the page: `Place` is the lit chip at load, so the drawer is already open and
 * its entries are already the ones a visitor would see.
 */
const probe = `
<script type="module">
import "./app.js";
const strip = document.getElementById("design");
const coarse = matchMedia("(pointer: coarse)").matches;
const fine = matchMedia("(pointer: fine)").matches;
const hoverNone = matchMedia("(hover: none)").matches;
const vw = Math.round(innerWidth);
const scale = visualViewport ? Math.round(visualViewport.scale * 100) / 100 : 1;

function height(selector) {
  const node = document.querySelector(selector);
  return node === null ? -1 : Math.round(node.getBoundingClientRect().height);
}
function width(selector) {
  const node = document.querySelector(selector);
  return node === null ? -1 : Math.round(node.getBoundingClientRect().width);
}

const chipH = height("#modes [data-mode]");
const copyH = height("#copy");
const entryH = height("#palette [data-id]");
const iconW = width("#palette [data-id] img");
const cellW = width("#board [data-index='0']");
const boardW = width("#board");
const scrollW = Math.round(document.documentElement.scrollWidth);

const targets = [chipH, copyH, entryH].filter((n) => n > 0);
strip.textContent =
  "PHONE coarse=" + coarse + " fine=" + fine + " hoverNone=" + hoverNone +
  " vw=" + vw + " scale=" + scale + " dpr=" + devicePixelRatio +
  " boardW=" + boardW + " cellW=" + cellW +
  " sideways=" + (scrollW > vw + 2) + " scrollW=" + scrollW +
  " chipH=" + chipH + " copyH=" + copyH + " entryH=" + entryH + " iconW=" + iconW +
  " all40=" + (targets.length > 0 && targets.every((n) => n >= 40)) +
  " err=" + document.getElementById("error").textContent;
</script>
`;
const out = html.replace('</head>', probe + '\n</head>');
if (out === html) throw new Error('no </head>');
await writeFile('C:/Users/Duncan/Documents/Workspace/Ic2ExpReactorPlannerWeb/web/ui/probe-phone.html', out);
console.log('probe written: web/ui/probe-phone.html');
