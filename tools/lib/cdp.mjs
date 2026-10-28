/**
 * The DevTools-protocol plumbing two tools need, in one place.
 *
 * `--remote-debugging-port=0` makes the browser choose a port and write it into the profile
 * directory's `DevToolsActivePort`; the protocol itself is a WebSocket carrying one JSON request per
 * message. Node 24 has a global `WebSocket`, so none of this needs a package.
 *
 * The two callers want different things from it -- `probe-iphone.mjs` emulates devices one after
 * another, `verify.mjs` loads the page once and asks whether it is broken -- so what lives here is
 * only the part that must not diverge: finding the browser, waiting for it, and the request/response
 * bookkeeping that turns a protocol error into a thrown `Error` instead of a silent `undefined`.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The browsers this has been run against, in the order they are tried. `EDGE` overrides. */
const CANDIDATES = [
  process.env.EDGE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The first candidate that exists on disk. */
export async function browserPath() {
  for (const candidate of CANDIDATES) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (problem) {
      continue;
    }
  }
  throw new Error(`no browser found; set EDGE to one of: ${CANDIDATES.join(', ')}`);
}

/**
 * A headless browser with a debugging port, and the page target to drive.
 *
 * `timeoutMs` is a real deadline, not politeness: a browser that starts but never writes its port
 * file would otherwise hang the caller, and both callers have something better to report than a
 * hang.
 */
export async function launchBrowser({ timeoutMs = 20_000 } = {}) {
  const path = await browserPath();
  const profile = await mkdtemp(join(tmpdir(), 'erp-cdp-'));
  const child = spawn(path, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const deadline = Date.now() + timeoutMs;
  let port = 0;
  while (Date.now() < deadline && port === 0) {
    if (child.exitCode !== null) throw new Error(`the browser exited (${child.exitCode})`);
    try {
      const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      port = Number(text.split('\n')[0]);
    } catch (problem) {
      // not written yet
    }
    if (port === 0) await sleep(100);
  }
  if (port === 0) {
    child.kill();
    throw new Error('the browser never wrote DevToolsActivePort');
  }

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.type === 'page');
  if (!target) {
    child.kill();
    throw new Error('the browser opened no page target');
  }
  return { child, port, target };
}

/**
 * A connected session. `send` resolves with the protocol result and rejects on a protocol error, so
 * a mistyped method or an invalid parameter reads as a failure rather than as a measurement of
 * nothing -- which is exactly how the first version of `setTouchEmulationEnabled` was caught.
 */
export async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((open, fail) => {
    socket.onopen = open;
    socket.onerror = fail;
  });

  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) {
      // A protocol event (`Runtime.exceptionThrown`, `Log.entryAdded`, `Page.loadEventFired`), not a
      // reply. Nobody waiting for a result sees it.
      for (const listener of listeners) listener(message.method, message.params);
      return;
    }
    const done = waiting.get(message.id);
    if (done) {
      waiting.delete(message.id);
      done(message);
    }
  };

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        waiting.set(id, (message) => {
          if (message.error) reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    /** Subscribe to protocol events. Returns an unsubscribe function. */
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}

/** The device override both callers need, in the order the protocol wants it. `mobile` is what makes
 * the page use a phone's layout viewport; `setTouchEmulationEnabled` is what flips `pointer: coarse`,
 * which no window size can do. */
export async function emulateDevice(send, { width, height, dpr = 1, mobile = true }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  // `maxTouchPoints` has to be 1..16, so a desktop pass turns emulation off rather than asking for
  // zero touch points.
  await send('Emulation.setTouchEmulationEnabled', mobile
    ? { enabled: true, maxTouchPoints: 5 }
    : { enabled: false });
}

/** A one-shot `Runtime.evaluate` that insists on a value: a page expression that throws is a failed
 * probe, not an empty result. */
export async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}
