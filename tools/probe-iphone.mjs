/**
 * Measures the page at iPhone metrics, over the DevTools protocol.
 *
 * §20 left the phone pass on `tools/probe-phone.mjs`, which writes a page that reports `pointer:
 * coarse` and the tap-target heights *on the device*. That is the right instrument when a handset is
 * at reach, and it is useless when one is not: a desktop browser answers `coarse=false` no matter
 * how narrow the window is, because the media feature describes the input, not the width.
 *
 * Chrome and Edge can be asked to be a phone. `Emulation.setDeviceMetricsOverride` sets the viewport,
 * the device pixel ratio and `mobile`; `Emulation.setTouchEmulationEnabled` is what flips
 * `pointer: coarse` and `any-pointer: coarse`, which is exactly the bit a resize cannot change. The
 * protocol is a WebSocket with a JSON request per line, so this needs no package: Node 24 has a
 * global `WebSocket`, and `--remote-debugging-port=0` writes the chosen port into the profile
 * directory's `DevToolsActivePort` file.
 *
 * What is measured, and why each one is a claim and not a number:
 *   - **cell** — the board is 9 columns wide, and `sizeBoard` snaps the cell to a whole multiple of
 *     16 so sprite pixels stay square (`app.js:173`). On a 390 px phone the choices are 32 px
 *     (288 px of board, comfortably inside) or 48 px (432 px, which does not fit). 32 px cells are
 *     also 32 px tap targets, against the 40 px `WEB_DESIGN.md` §1 asks for, so the two rules
 *     collide on a phone and the report has to say which one won.
 *   - **overflowX** — `scrollWidth > clientWidth` on the document is the horizontal scrollbar a
 *     phone must not have. Any panel wider than the viewport shows up here.
 *   - **tapMin** — the shortest control anywhere on the page. A thumb's target is 40 px by the
 *     design doc; a 24 px chip is a miss waiting to happen.
 *   - **codeFont** — iOS Safari zooms the page in when a form control with `font-size` below 16 px
 *     takes focus, and does not zoom back out on blur. `#code` is 12 px. This is the one iPhone
 *     behaviour that no desktop browser reproduces, so it is reported rather than inferred.
 *   - **pageH / boardBottom / codeTop** — how far the visitor scrolls before reaching the string they
 *     came for.
 *
 * Run: `node tools/probe-iphone.mjs` (Edge or Chrome must be installed; set `EDGE` to override the
 * path, `ERP_URL` to point at a different origin). It writes `probe-iphone.json` and prints one line
 * per device.
 */

import { writeFile } from 'node:fs/promises';
import { connect, emulateDevice, evaluate, launchBrowser, sleep } from './lib/cdp.mjs';

const URL = process.env.ERP_URL ?? 'http://127.0.0.1:8123/web/ui/';

/** The three phones that bracket the layout, and one desktop window for contrast. */
const DEVICES = [
  { name: 'se', width: 375, height: 667, dpr: 2, mobile: true },
  { name: 'iphone15', width: 393, height: 852, dpr: 3, mobile: true },
  { name: 'promax', width: 430, height: 932, dpr: 3, mobile: true },
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
];

const browser = await launchBrowser();
// A hung browser must not hang the probe; the report is worth more than a perfect run.
const deadline = setTimeout(() => {
  browser.child.kill();
  console.log('PROBE TIMED OUT after 90s');
  process.exit(2);
}, 90_000);
deadline.unref();

const { send, close } = await connect(browser.target.webSocketDebuggerUrl);
await send('Page.enable');
await send('Runtime.enable');

/** The measurement, as a string expression: everything is read in the page, because that is where
 * the media queries resolve and where the layout is real. */
const MEASURE = `(() => {
  const px = (value) => Math.round(Number(String(value).replace('px', '')) || 0);
  const board = document.getElementById('board');
  const code = document.getElementById('code');
  const cell = board ? getComputedStyle(board).getPropertyValue('--cell') : '';
  const controls = [...document.querySelectorAll('button, input, textarea, [data-id], [data-mode]')];
  const heights = controls.map((node) => Math.round(node.getBoundingClientRect().height)).filter((h) => h > 0);
  const reach = (node) => (node ? Math.round(node.getBoundingClientRect().bottom + window.scrollY) : null);
  const top = (selector) => {
    const node = document.querySelector(selector);
    if (node === null || node.hidden) return null;
    return Math.round(node.getBoundingClientRect().top + window.scrollY);
  };
  // Where each band starts, so a layout change can be argued from the page's own geometry rather
  // than from a screenshot with a ruler. A band that is absent (a closed panel) is null, not 0.
  const sections = {
    design: top('#design'), board: top('#board'), chambers: top('#chambers'),
    temperature: top('#temperature'), modes: top('#modes'), code: top('#code'),
    palette: top('#palette'),
  };
  const boardRect = board ? board.getBoundingClientRect() : null;
  // Who is wider than the viewport. A phone cannot scroll sideways to find a control, so the ones
  // that push the document past clientWidth are named rather than counted.
  const limit = document.documentElement.clientWidth;
  // A horizontally scrolling band (the chip row, on a phone) is supposed to be wider than the
  // viewport; only the document is not.
  const inScroller = (node) => {
    for (let parent = node.parentElement; parent !== null && parent !== document.body; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowX)) return true;
    }
    return false;
  };
  const overflowing = [...document.querySelectorAll('body *')]
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter((entry) => entry.rect.right > limit + 1 && entry.rect.width > 0 && !inScroller(entry.node))
    .slice(0, 6)
    .map((entry) => entry.node.tagName.toLowerCase()
      + (entry.node.id ? '#' + entry.node.id : '')
      + ' right=' + Math.round(entry.rect.right) + ' w=' + Math.round(entry.rect.width));
  return JSON.stringify({
    coarse: matchMedia('(pointer: coarse)').matches,
    anyCoarse: matchMedia('(any-pointer: coarse)').matches,
    hover: matchMedia('(hover: hover)').matches,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
    cell: px(cell),
    boardW: boardRect ? Math.round(boardRect.width) : null,
    boardH: boardRect ? Math.round(boardRect.height) : null,
    boardBottom: reach(board),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pageH: document.documentElement.scrollHeight,
    tapMin: heights.length ? Math.min(...heights) : null,
    tapMax: heights.length ? Math.max(...heights) : null,
    tapUnder40: heights.filter((h) => h < 40).length,
    tapCount: heights.length,
    codeFont: code ? px(getComputedStyle(code).fontSize) : null,
    codeTop: reach(code),
    codeW: code ? Math.round(code.getBoundingClientRect().width) : null,
    sections,
    overflowing,
    title: document.title,
  });
})()`;

const report = [];
for (const device of DEVICES) {
  // `emulateDevice` is the bit a window resize cannot do: it makes the browser answer
  // `pointer: coarse`.
  await emulateDevice(send, device);
  // A fresh navigation per device, so nothing (the resize listener, a stored design) carries over.
  await send('Page.navigate', { url: `${URL}?device=${device.name}` });
  await sleep(1200);
  // Re-applying the override after load is not a workaround for slowness: Blink lays the page out
  // once against the metrics in force at navigation, so the first pass at a phone width can keep a
  // stale layout viewport. This second call also fires `resize`, which is exactly the path a phone's
  // rotation takes through `sizeBoard` -- so the measurement below is of the listener, not of load.
  await emulateDevice(send, device);
  await sleep(400);
  const values = JSON.parse(await evaluate(send, MEASURE));
  report.push({ device: device.name, ...values });

  // A picture per device, because the numbers say a control is 40 px and no number says the page
  // looks like a planner rather than a form. `captureBeyondViewport: false` keeps the shot to what a
  // phone actually shows in one screen.
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`probe-iphone-${device.name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(
    `${device.name.padEnd(8)} ${device.width}x${device.height} inner=${values.innerW}x${values.innerH} `
    + `coarse=${values.coarse} cell=${values.cell} `
    + `board=${values.boardW}x${values.boardH} overflowX=${values.overflowX} pageH=${values.pageH} `
    + `boardBottom=${values.boardBottom} codeTop=${values.codeTop} codeFont=${values.codeFont} `
    + `tapMin=${values.tapMin} under40=${values.tapUnder40}/${values.tapCount}`
    + (values.overflowing.length ? `\n         wide: ${values.overflowing.join(' | ')}` : '')
    + `\n         bands: ${Object.entries(values.sections).filter(([, v]) => v !== null).map(([k, v]) => k + '=' + v).join(' ')}`,
  );
}

await writeFile('probe-iphone.json', `${JSON.stringify(report, null, 2)}\n`);
close();
clearTimeout(deadline);
browser.child.kill();
console.log(`written: probe-iphone.json and probe-iphone-<device>.png (${report.length} devices)`);
