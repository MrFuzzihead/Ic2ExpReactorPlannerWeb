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

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  process.env.EDGE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const URL = process.env.ERP_URL ?? 'http://127.0.0.1:8123/web/ui/';

/** The three phones that bracket the layout, and one desktop window for contrast. */
const DEVICES = [
  { name: 'se', width: 375, height: 667, dpr: 2, mobile: true },
  { name: 'iphone15', width: 393, height: 852, dpr: 3, mobile: true },
  { name: 'promax', width: 430, height: 932, dpr: 3, mobile: true },
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The first browser that exists, or a sentence saying none does. */
async function browserPath() {
  for (const candidate of BROWSERS) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (problem) {
      continue;
    }
  }
  throw new Error(`no browser found; set EDGE to one of: ${BROWSERS.join(', ')}`);
}

const profile = await mkdtemp(join(tmpdir(), 'erp-cdp-'));

async function launch() {
  const path = await browserPath();
  const child = spawn(path, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  // The port is in the profile directory, not on stdout: with `=0` the browser chooses one.
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`the browser exited (${child.exitCode})`);
    try {
      const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      const port = Number(text.split('\n')[0]);
      if (port > 0) return { child, port };
    } catch (problem) {
      // not written yet
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('the browser never wrote DevToolsActivePort');
}

const { child, port } = await launch();
// A hung browser must not hang the probe; the report is worth more than a perfect run.
const deadline = setTimeout(() => {
  child.kill();
  console.log('PROBE TIMED OUT after 90s');
  process.exit(2);
}, 90_000);
deadline.unref();

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((entry) => entry.type === 'page');
if (!target) throw new Error('the browser opened no page target');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((open, fail) => {
  socket.onopen = open;
  socket.onerror = fail;
});

let nextId = 0;
const waiting = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const done = waiting.get(message.id);
  if (done) {
    waiting.delete(message.id);
    done(message);
  }
};

/** One protocol call. Rejects on a protocol error rather than returning an empty result, so a
 * mistyped method reads as a failure instead of a measurement of nothing. */
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

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
  const boardRect = board ? board.getBoundingClientRect() : null;
  // Who is wider than the viewport. A phone cannot scroll sideways to find a control, so the ones
  // that push the document past clientWidth are named rather than counted.
  const limit = document.documentElement.clientWidth;
  const overflowing = [...document.querySelectorAll('body *')]
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter((entry) => entry.rect.right > limit + 1 && entry.rect.width > 0)
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
    overflowing,
    title: document.title,
  });
})()`;

const report = [];
for (const device of DEVICES) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: device.width,
    height: device.height,
    deviceScaleFactor: device.dpr,
    mobile: device.mobile,
    screenWidth: device.width,
    screenHeight: device.height,
  });
  // This is the bit a window resize cannot do: it makes the browser answer `pointer: coarse`.
  // `maxTouchPoints` has to be 1..16, so the desktop pass turns emulation off instead of asking for
  // zero touch points (which the protocol rejects).
  await send('Emulation.setTouchEmulationEnabled', device.mobile
    ? { enabled: true, maxTouchPoints: 5 }
    : { enabled: false });
  // A fresh navigation per device, so nothing (the resize listener, a stored design) carries over.
  await send('Page.navigate', { url: `${URL}?device=${device.name}` });
  await sleep(1200);
  // Re-applying the override after load is not a workaround for slowness: Blink lays the page out
  // once against the metrics in force at navigation, so the first pass at a phone width can keep a
  // stale layout viewport. This second call also fires `resize`, which is exactly the path a phone's
  // rotation takes through `sizeBoard` -- so the measurement below is of the listener, not of load.
  await send('Emulation.setDeviceMetricsOverride', {
    width: device.width,
    height: device.height,
    deviceScaleFactor: device.dpr,
    mobile: device.mobile,
    screenWidth: device.width,
    screenHeight: device.height,
  });
  await sleep(400);
  const measured = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  if (measured.exceptionDetails) throw new Error(`${device.name}: ${measured.exceptionDetails.text}`);
  const values = JSON.parse(measured.result.value);
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
    + (values.overflowing.length ? `\n         wide: ${values.overflowing.join(' | ')}` : ''),
  );
}

await writeFile('probe-iphone.json', `${JSON.stringify(report, null, 2)}\n`);
socket.close();
clearTimeout(deadline);
child.kill();
console.log(`written: probe-iphone.json and probe-iphone-<device>.png (${report.length} devices)`);
