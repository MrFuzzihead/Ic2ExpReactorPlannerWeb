/**
 * A static file server for the web target, so `web/ui/` can be opened at all.
 *
 * Nothing here is part of the product: the page is served from the repository, and the module
 * paths in `app.js` (`../engine/components.js`, `../data/components.json`) only resolve over an
 * http origin. This is the smallest thing that provides one. Content types are explicit because a
 * mis-typed ES module is refused by the browser rather than failing quietly.
 *
 * It is also the console. Everything a browser gets wrong shows up here:
 *   - a 404 prints the path, which is how a wrong icon prefix reads in one line;
 *   - `POST /_log` prints what the page's error handler caught, so an uncaught JS error lands in
 *     the IDE console next to the green Run button rather than only in the page's red strip.
 *
 * Run: `node tools/serve.mjs --open` (port from `PORT`, default 8123). `--open` launches the
 * default browser at the page; without it, open the printed URL yourself. Ctrl+C stops it.
 *
 * `--log web-preview.log` mirrors every line below into a file. An IDE Run console captures a
 * child process's output and only shows it when the child exits, and this child never exits, so
 * the console is where the log has to go: IntelliJ's `webPreview` task passes the flag for it.
 *
 * `--stop` frees the port and exits: it kills whatever already listens there. A Run button that
 * leaves a server behind on every press accumulates processes, so `webPreview` runs this first
 * and `webStop` is the whole task on its own.
 *
 * A LAN address is printed under the local one. `listen(PORT)` binds every interface, so a phone on
 * the same Wi-Fi opens the page over `http://<this PC's address>:<port>/web/ui/`, and the phone's own
 * report of `pointer: coarse` is the one measurement a headless browser cannot supply (§20's
 * instrument limit). `tools/probe-phone.mjs` writes the page that reads the numbers on the phone.
 */

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 8123);
const ROOT = '.';
const OPEN = process.argv.includes('--open');
const STOP = process.argv.includes('--stop');
const LOG = process.argv.includes('--log')
  ? process.argv[process.argv.indexOf('--log') + 1]
  : null;

/** One line out: the console, and the file when `--log` names one. Synchronous, because the last
 * line is often the reason a run stopped (a busy port), and an async write would not be there
 * before the process exits. */
let logBroken = false;
function say(line) {
  console.log(line);
  if (!LOG || logBroken) return;
  try {
    appendFileSync(LOG, `${line}\n`);
  } catch (problem) {
    // Say it once: a log that silently stops mirroring reads as a page that stopped breaking.
    logBroken = true;
    console.log(`log file ${LOG} is unwritable (${problem.code}); the console still works`);
  }
}

/** Who holds the port: netstat answers on Windows, lsof on the others. */
function listenerPids() {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    return out.stdout.split('\n')
      .filter((line) => /LISTENING/i.test(line) && new RegExp(`:${PORT}\\b`).test(line))
      .map((line) => Number(line.trim().split(/\s+/).at(-1)));
  }
  const out = spawnSync('lsof', ['-sTCP:LISTEN', '-ti', `:${PORT}`], { encoding: 'utf8' });
  return out.stdout.split('\n').slice(1).map((line) => Number(line.trim().split(/\s+/)[1]));
}

/** Real processes only: netstat lists PID 0 for internals, and never this run itself. One
 * process answers twice (0.0.0.0 and [::]), so the list is deduplicated. */
function claimable() {
  const pids = listenerPids().filter((pid) => Number.isFinite(pid) && pid > 4 && pid !== process.pid);
  return [...new Set(pids)];
}

if (STOP) {
  const before = claimable();
  if (!before.length) say(`nothing is listening on ${PORT}`);
  for (const pid of before) {
    try {
      process.kill(pid);
      say(`stopped the earlier server (pid ${pid})`);
    } catch (problem) {
      say(`pid ${pid} is still there (${problem.code}): stop it yourself`);
    }
  }
  if (before.length) await new Promise((done) => setTimeout(done, 400));
  // Non-zero when something refused to die, so the IDE task can say so rather than assume.
  process.exit(claimable().length ? 1 : 0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** The page's error handler posts here; see the classic script in `web/ui/index.html`. */
async function readBody(request) {
  return new Promise((done) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => done(body));
  });
}

const server = createServer(async (request, response) => {
  // Same-origin POST from the page, not a navigation: report it and answer without touching disk.
  if (request.method === 'POST' && request.url === '/_log') {
    say(`[${new Date().toISOString()}] browser: ${(await readBody(request)).replaceAll('\n', ' ')}`);
    response.writeHead(204);
    response.end();
    return;
  }

  const url = decodeURIComponent(request.url.split('?')[0]);
  let path = url.endsWith('/') ? `${url}index.html` : url;
  // Resolve inside ROOT and stop: this serves a repository, not the whole disk.
  const target = `${ROOT}/${path.replace(/^\/+/, '')}`.replace(/\//g, '\\');
  try {
    const body = await readFile(target);
    const ext = target.slice(target.lastIndexOf('.'));
    response.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream' });
    response.end(body);
  } catch (problem) {
    // A miss is the most common way the page breaks (a renamed icon, a moved data file), and the
    // browser only shows a broken-image glyph. Print the path that was asked for.
    say(`404 ${path} <- ${request.headers.referer ?? 'no referrer'}`);
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`not found: ${path}`);
  }
});

// Hitting the Run button twice leaves the second server on a busy port; a stack trace next to the
// green button is worse than a sentence.
server.on('error', (problem) => say(problem.code === 'EADDRINUSE'
  ? `port ${PORT} is already taken — stop the earlier server, or set PORT to another value`
  : `server error: ${problem.code}`));

const url = `http://127.0.0.1:${PORT}/web/ui/`;

// `listen` is asynchronous, and the browser used to be launched in the same breath: a visitor
// pressing the Run button could otherwise get "this site can't be reached" from a port that had
// not answered yet. The promise waits for the 'listening' event; a busy port answers with 'error'
// instead, which the handler above already turns into a sentence.
const started = new Promise((listening, refused) => {
  server.once('listening', () => listening(true));
  server.once('error', (problem) => refused(problem));
});

server.listen(PORT);

try {
  await started;
} catch (ignored) {
  process.exit(1);
}

say(`serving ${ROOT} at ${url} — Ctrl+C to stop`);

// `listen(PORT)` binds every interface, so a phone on the same Wi-Fi can open the page: it needs an
// address that names the PC rather than the PC itself, and this is the only place the PC's own
// network address is printed. Windows reports the LAN route with `internal: false` and the loopback
// entries with `internal: true`, the reverse of a macOS route, so the filter is on the address rather
// than on that flag: an IPv4 dotted address that is not a loopback.
for (const entry of Object.values(networkInterfaces()).flat()) {
  const lan = entry.cidr === undefined ? entry.address : entry.cidr.split('/')[0];
  if (!lan.includes('.') || lan.startsWith('127.') || lan === '0.0.0.0') continue;
  say(`phone: http://${lan}:${PORT}/web/ui/ — same network as this PC, http not https`);
}

if (OPEN) {
  // `explorer.exe <url>` hands the URL to the registered browser handler; `open` and `xdg-open`
  // are the same trick on the other platforms. Detached, so the server keeps running.
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' });
  } catch (problem) {
    say(`no browser launched (${problem.code ?? problem}): open ${url} yourself`);
  }
}
