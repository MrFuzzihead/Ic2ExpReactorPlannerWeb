/**
 * The whole gate, in one command: unit and page tests, the import graph, the Java oracle, and a real
 * browser load of the page at desktop and iPhone sizes.
 *
 * This exists because "green" used to mean remembering five different invocations -- `ERP_CODE` for
 * `page.test.js`, a server on 8123 for the probes, a JDK for the oracle, and each probe's own page
 * read by eye in a browser. A gate nobody runs is not a gate. Everything here runs unattended and
 * exits non-zero on the first real problem.
 *
 *   node tools/verify.mjs            # everything
 *   node tools/verify.mjs --fast     # skip the Java oracle (no JDK, or in a hurry)
 *   node tools/verify.mjs --verbose  # print each step's output
 *
 * What each step is for, and what it would catch:
 *
 *   suite    17 test files over the engine and the page, plus the formatting oracle. A changed
 *            number, a broken selector, a decoder that stops round-tripping.
 *   imports  the module graph: an edge that no longer resolves is a page that cannot load.
 *   oracle   recompiles this repo's own Java engine and diffs eleven fixtures against it. A JS-only
 *            change cannot move these; a Java-side change that the port missed will.
 *   browser  the page in a real browser, at 1440 x 900 and at 375 x 667. Layout, images, and the
 *            four phone rules from §38 are things no Node test can see.
 *
 * The browser step starts its own server on a port of its own choosing (`PORT=0`), so it never
 * fights the preview server the IDE is running.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, emulateDevice, evaluate, launchBrowser, sleep } from './lib/cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FAST = process.argv.includes('--fast');
const VERBOSE = process.argv.includes('--verbose');

const results = [];
const started = Date.now();

function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : `  ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

/** Run a node script in the repo and hand back its combined output. */
function node(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw new Error(`${args.join(' ')}: ${result.error.message}`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (VERBOSE) console.log(output.trimEnd().replace(/^/gm, '     '));
  return { code: result.status, output };
}

// ---------------------------------------------------------------- the suite

const suite = node(['tools/test.mjs']);
const suiteSummary = suite.output.trim().split('\n').at(-1) ?? '';
step('suite', suite.code === 0, suiteSummary);

// ---------------------------------------------------------------- the graph

const imports = node(['tools/check-imports.mjs']);
step('imports', imports.code === 0, imports.output.trim().split('\n').at(-1) ?? '');

// ---------------------------------------------------------------- the Java oracle

if (FAST) {
  console.log('skip oracle  (--fast)');
} else if (spawnSync('javac', ['-version'], { encoding: 'utf8' }).status !== 0) {
  step('oracle', false, 'no javac on PATH; install a JDK or run with --fast');
} else {
  const oracle = node(['tools/oracle/regenerate.mjs']);
  step('oracle', oracle.code === 0, oracle.output.trim().split('\n').at(-1) ?? '');
}

// ---------------------------------------------------------------- the browser

/**
 * A server of our own, on a port of our own. `PORT=0` lets the OS pick, and the server prints the
 * URL it bound -- parsed rather than assumed, because two checkouts on one machine is normal.
 */
function startServer() {
  return new Promise((started, failed) => {
    const child = spawn(process.execPath, ['tools/serve.mjs', '--port', '0'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '0' },
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      failed(new Error(`the server never printed a URL:\n${output}`));
    }, 20_000);
    const onData = (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)\/web\/ui\//.exec(output);
      if (match) {
        clearTimeout(timer);
        started({ child, port: Number(match[1]), output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      failed(new Error(`the server exited (${code}):\n${output}`));
    });
  });
}

/** What a page load has to be true of, at any size. */
const PAGE_CLAIMS = `(() => {
  const px = (value) => Math.round(Number(String(value).replace('px', '')) || 0);
  const board = document.getElementById('board');
  const slots = board ? [...board.children] : [];
  const icons = slots.filter((slot) => slot.querySelector('img'));
  // complete-without-pixels is a broken image; not-complete is a lazy image the viewport has not
  // reached, which is normal on a phone and not a fault.
  const broken = [...document.images].filter((img) => img.complete && img.naturalWidth === 0)
    .map((img) => img.getAttribute('src'));
  const cell = board ? px(getComputedStyle(board).getPropertyValue('--cell')) : 0;
  return JSON.stringify({
    error: document.getElementById('error')?.textContent ?? '',
    slots: slots.length,
    icons: icons.length,
    broken,
    cell,
    boardW: board ? Math.round(board.getBoundingClientRect().width) : 0,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    codeLen: document.getElementById('code')?.value.length ?? 0,
    coarse: matchMedia('(pointer: coarse)').matches,
  });
})()`;

/**
 * One loading of the page, with the exceptions and console errors the page itself would have hidden.
 * `Runtime.exceptionThrown` is the important listener: a module that throws at import time leaves a
 * blank page and an empty error strip, and the strip is what every probe reads.
 */
async function loadPage(browser, port, device) {
  const session = await connect(browser.target.webSocketDebuggerUrl);
  const problems = [];
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  // `Runtime.exceptionThrown` and `Log.entryAdded` arrive as events, not as replies; the session
  // keeps them out of the request map, so they are collected with a listener on the socket itself.
  session.onEvent((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push(params.entry.text);
  });

  await emulateDevice(session.send, { width: device.width, height: device.height, dpr: device.dpr, mobile: device.mobile });
  await session.send('Page.navigate', { url: `http://127.0.0.1:${port}/web/ui/?verify=${device.name}` });
  await sleep(1800);
  // The page's own error strip is the last line of defence: it is where a decode failure is shown.
  const measured = JSON.parse(await evaluate(session.send, PAGE_CLAIMS));
  session.close();
  return { ...measured, problems };
}

function startBrowser() {
  return launchBrowser();
}

let browser;
try {
  const server = await startServer();
  browser = await startBrowser();
  try {
    for (const device of [
      { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
      { name: 'iphone', width: 375, height: 667, dpr: 3, mobile: true },
    ]) {
      const page = await loadPage(browser, server.port, device);
      const faults = [];
      if (page.error !== '') faults.push(`error strip: ${page.error}`);
      if (page.problems.length) faults.push(`console: ${page.problems.join(' | ')}`);
      if (page.slots !== 54) faults.push(`${page.slots} slots, expected 54`);
      if (page.icons === 0) faults.push('no icons drawn');
      if (page.broken.length) faults.push(`broken images: ${page.broken.join(', ')}`);
      // §38's four rules, measured rather than read out of the stylesheet.
      if (page.overflowX !== 0) faults.push(`${page.overflowX} px of horizontal overflow`);
      if (page.coarse !== device.mobile) faults.push(`pointer coarse=${page.coarse}, expected ${device.mobile}`);
      if (device.mobile && page.cell < 24) faults.push(`${page.cell} px cells on a phone`);
      if (device.mobile && page.boardW > device.width) faults.push(`${page.boardW} px board on a ${device.width} px screen`);
      step(`browser ${device.name}`, faults.length === 0,
        faults.length === 0
          ? `${page.slots} slots, ${page.icons} icons, cell ${page.cell}, code ${page.codeLen} chars`
          : faults.join('; '));
    }
  } finally {
    browser.child.kill();
    server.child.kill();
  }
} catch (problem) {
  if (browser) browser.child.kill();
  step('browser', false, problem.message);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length} of ${results.length} check groups passed in ${seconds}s`);
if (failed.length) {
  console.log(`failed: ${failed.map((entry) => entry.name).join(', ')}`);
  process.exitCode = 1;
}
