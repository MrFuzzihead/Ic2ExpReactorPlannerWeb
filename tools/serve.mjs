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
 * Run: `node tools/serve.mjs --open` (port from `--port` or `PORT`, default 8123). `--open`
 * launches the default browser at the page; without it, open the printed URL yourself. Ctrl+C
 * stops it.
 *
 * ## Lifecycle
 *
 * One server, one PID file (`.web-preview.pid`). A second start refuses rather than replacing --
 * two servers on one port is how a visitor ends up looking at a stale module graph and blaming the
 * code -- and `--stop` is the one command that ends a run, whether it was started from the IDE, a
 * terminal, or a previous press of the Run button. The file is removed on every exit path, so a
 * stale entry means the process died hard; `--stop` treats a PID whose command line is not this
 * script as somebody else's and leaves it alone.
 *
 * `--die-with-parent` is what makes the IDE's Stop button enough on its own. Two independent
 * signals, because neither covers every way a launcher dies:
 *   - **stdin EOF.** The launcher holds the write end of this process's stdin. When it exits or is
 *     killed, the pipe closes and `stdin` ends -- the child is orphaned but it knows.
 *   - **ppid poll.** A parent that is still alive but no longer our launcher (an IDE that killed a
 *     shell wrapper, not us) is caught by asking the OS whether the parent PID still exists.
 * A launch from a terminal has no pipe, so this is opt-in and never inferred: Ctrl+C is the right
 * signal there, and `--die-with-parent` would turn "close the terminal window" into a kill.
 *
 * `--log <file>` mirrors every line below into a file. An IDE Run console only relays what the
 * build forwards, and a crash inside the server is the one line that matters, so the log also
 * keeps a run's output after the console has moved on.
 *
 * A LAN address is printed under the local one. `listen(PORT)` binds every interface, so a phone on
 * the same Wi-Fi opens the page over `http://<this PC's address>:<port>/web/ui/`, and the phone's own
 * report of `pointer: coarse` is the one measurement a headless browser cannot supply (§20's
 * instrument limit). `tools/probe-phone.mjs` writes the page that reads the numbers on the phone,
 * and `tools/probe-iphone.mjs` drives the same metrics over CDP when no handset is at reach.
 */

import { createServer } from 'node:http';
import { appendFileSync, existsSync, fstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PID_FILE = resolve(ROOT, '.web-preview.pid');

/** `--name value` from the argv, or the fallback when the flag is absent. */
function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
}

const PORT = Number(flag('--port', process.env.PORT ?? 8123));
const OPEN = process.argv.includes('--open');
const STOP = process.argv.includes('--stop');
const STATUS = process.argv.includes('--status');
const DIE_WITH_PARENT = process.argv.includes('--die-with-parent');
const LOG = flag('--log', null);

/** One line out: the console, and the file when `--log` names one. Synchronous, because the last
 * line is often the reason a run stopped (a busy port), and an async write would not be there
 * before the process exits. */
let logBroken = false;
function say(line) {
  console.log(line);
  if (!LOG || logBroken) return;
  try {
    appendFileSync(resolve(ROOT, LOG), `${line}\n`);
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

/** Whether a PID from the file is still there. Signal 0 is the existence probe: Node documents it
 * as the Windows-safe way to ask, and POSIX gives it the same meaning. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (problem) {
    return problem.code === 'EPERM';
  }
}

/** The command line of a PID, so `--stop` can prove the process is this server before killing it.
 * Windows has no `/proc`; PowerShell's CIM query is the replacement for `wmic`, which is gone from
 * current Windows builds. Best effort: an unreadable command line is treated as "not ours". */
function commandLineOf(pid) {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('powershell', ['-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8' });
      return out.stdout.trim();
    }
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch (problem) {
    return '';
  }
}

/** The PID file, read and validated: a file whose process is gone (or is not this script) is
 * stale, and a stale file must not block the next start. */
function recordedServer() {
  if (!existsSync(PID_FILE)) return null;
  const [rawPid, rawPort] = readFileSync(PID_FILE, 'utf8').trim().split('\n');
  const pid = Number(rawPid);
  if (!Number.isFinite(pid) || pid <= 4 || pid === process.pid) return null;
  if (!alive(pid)) {
    rmSync(PID_FILE, { force: true });
    return null;
  }
  if (!commandLineOf(pid).includes('serve.mjs')) {
    // Alive, but something else re-used the PID. Say so and never touch it.
    say(`pid ${pid} in ${PID_FILE} is not this server (${commandLineOf(pid) || 'unknown command'}); ignoring the file`);
    return null;
  }
  // The port is recorded too: `--status` and `--stop` run without knowing which port the running
  // server chose, and a message naming the wrong one is worse than no message.
  return { pid, port: Number(rawPort) > 0 ? Number(rawPort) : PORT };
}

if (STATUS) {
  const running = recordedServer();
  say(running === null
    ? `no preview server recorded (port ${PORT}: ${claimable().length ? 'something else is listening' : 'free'})`
    : `preview server pid ${running.pid} at http://127.0.0.1:${running.port}/web/ui/`);
  process.exit(running === null ? 1 : 0);
}

if (STOP) {
  const recorded = recordedServer();
  const targets = recorded === null ? [] : [recorded.pid];
  if (recorded === null) {
    // No file: a server started before this file existed, or by a hand-edited PORT. The port scan
    // is the only lead, and a PID without a matching command line is somebody else's server.
    for (const pid of claimable()) {
      if (commandLineOf(pid).includes('serve.mjs')) targets.push(pid);
      else say(`pid ${pid} holds ${PORT} but is not this server; leaving it alone`);
    }
  }
  if (!targets.length) say(`nothing to stop on ${PORT}`);
  for (const pid of targets) {
    try {
      process.kill(pid);
      say(`stopped the earlier server (pid ${pid})`);
    } catch (problem) {
      say(`pid ${pid} is still there (${problem.code}): stop it yourself`);
    }
  }
  if (targets.length) await new Promise((done) => setTimeout(done, 400));
  if (existsSync(PID_FILE) && recordedServer() === null) rmSync(PID_FILE, { force: true });
  // Non-zero when something refused to die, so the IDE task can say so rather than assume.
  process.exit(targets.some((pid) => alive(pid)) ? 1 : 0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
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

/** The repository path a request names, or null when it tries to leave the tree.
 *
 * The old code pasted the URL onto ROOT and read it, which serves `GET /../..` -- the guard is
 * the point of a `ROOT`, not decoration. The separators are the platform's, so this works on the
 * POSIX machines the probes run on as well as on the Windows box the IDE runs on. */
function targetFor(urlPath) {
  const base = resolve(ROOT);
  const target = resolve(base, `.${urlPath}`);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  // Same-origin POST from the page, not a navigation: report it and answer without touching disk.
  if (request.method === 'POST' && request.url === '/_log') {
    say(`[${new Date().toISOString()}] browser: ${(await readBody(request)).replaceAll('\n', ' ')}`);
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD, POST' });
    response.end();
    return;
  }

  const url = decodeURIComponent(request.url.split('?')[0]);
  const target = targetFor(url.endsWith('/') ? `${url}index.html` : url);
  if (target === null) {
    say(`403 ${url} <- ${request.headers.referer ?? 'no referrer'} (outside the repository)`);
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('outside the repository');
    return;
  }
  try {
    const body = await readFile(target);
    const ext = target.slice(target.lastIndexOf('.'));
    response.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      // A dev server that lets the browser cache ES modules hands the visitor the previous edit
      // and calls it a broken change. `no-store` is the whole reason this is not `python -m
      // http.server`: that one sends a Last-Modified and every module reload needs a hard refresh.
      'cache-control': 'no-store, must-revalidate',
      'content-length': body.length,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (problem) {
    // A miss is the most common way the page breaks (a renamed icon, a moved data file), and the
    // browser only shows a broken-image glyph. Print the path that was asked for.
    say(`404 ${url} <- ${request.headers.referer ?? 'no referrer'}`);
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`not found: ${url}`);
  }
});

// Hitting the Run button twice leaves the second server on a busy port; a stack trace next to the
// green button is worse than a sentence.
server.on('error', (problem) => {
  say(problem.code === 'EADDRINUSE'
    ? `port ${PORT} is already taken — run --stop, or set --port to another value`
    : `server error: ${problem.code}`);
  rmSync(PID_FILE, { force: true });
});

// `--port 0` asks the OS for a free port (the verify gate does, so it never collides with the
// preview server the IDE is running), and the number it picked is only knowable after `listen`.
let boundPort = PORT;
const url = () => `http://127.0.0.1:${boundPort}/web/ui/`;

/** Every exit path unlinks the PID file, or the next start refuses to run over a ghost. */
function quitBecause(line) {
  say(line);
  rmSync(PID_FILE, { force: true });
  server.close();
  process.exit(0);
}

if (DIE_WITH_PARENT) {
  // A launcher's pipe is the signal; a terminal is not, and neither is `/dev/null` or `NUL` -- a
  // server started with `> /dev/null 2>&1 &` has a character device on stdin, which reads EOF at
  // once and would turn this flag into "exit immediately". On Windows a real pipe reports neither
  // FIFO nor character device, so the test is on the two refusals rather than on a FIFO match.
  const stdinStat = (() => {
    try {
      return fstatSync(0);
    } catch (problem) {
      return null; // closed descriptor: nothing to watch, the ppid poll still runs
    }
  })();
  const launcherPipe = stdinStat !== null && !stdinStat.isCharacterDevice() && process.stdin.isTTY !== true;
  if (launcherPipe) {
    // The launcher's end of the pipe is closed when it dies; a read of the pipe then ends.
    process.stdin.resume();
    process.stdin.on('end', () => quitBecause('stdin closed: the launcher is gone, closing'));
    process.stdin.on('close', () => quitBecause('stdin closed: the launcher is gone, closing'));
  }
  // A launcher that dies without closing the pipe (a killed shell wrapper) leaves the PID check as
  // the only witness. Two seconds is under a human's patience and far above a healthy launcher's
  // jitter.
  const parent = process.ppid;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch (problem) {
      quitBecause(`parent ${parent} is gone, closing`);
    }
  }, 2000).unref();
}

// A second start is a mistake worth refusing: two servers answer one port, so the visitor sees
// whichever bound first. `--stop` is the documented way through, and the IDE task runs it.
const running = recordedServer();
if (running !== null) {
  say(`a preview server is already running (pid ${running.pid}) at http://127.0.0.1:${running.port}/web/ui/ — run --stop first`);
  process.exit(1);
}

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

// `--port 0` asks the OS for a free port (the verify gate does, so it never collides with the
// preview server the IDE is running); the number it picked is only knowable after `listen`.
boundPort = server.address().port;
writeFileSync(PID_FILE, `${process.pid}\n${boundPort}\n`);

say(`serving ${ROOT} at ${url()} — Ctrl+C to stop`);

// `listen(PORT)` binds every interface, so a phone on the same Wi-Fi can open the page: it needs an
// address that names the PC rather than the PC itself, and this is the only place the PC's own
// network address is printed. Windows reports the LAN route with `internal: false` and the loopback
// entries with `internal: true`, the reverse of a macOS route, so the filter is on the address rather
// than on that flag: an IPv4 dotted address that is not a loopback.
for (const entry of Object.values(networkInterfaces()).flat()) {
  const lan = entry.cidr === undefined ? entry.address : entry.cidr.split('/')[0];
  if (!lan.includes('.') || lan.startsWith('127.') || lan === '0.0.0.0') continue;
  say(`phone: http://${lan}:${boundPort}/web/ui/ — same network as this PC, http not https`);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => quitBecause(`${signal}: closing`));
}

if (OPEN) {
  // `explorer.exe <url>` hands the URL to the registered browser handler; `open` and `xdg-open`
  // are the same trick on the other platforms. Detached, so the server keeps running.
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [url()]]
    : process.platform === 'darwin' ? ['open', [url()]] : ['xdg-open', [url()]];
  // A missing handler arrives as an 'error' event, not a throw: without this listener the server
  // would die of an unhandled ENOENT on a headless machine.
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
  opener.on('error', (problem) => say(`no browser launched (${problem.code ?? problem}): open ${url()} yourself`));
  opener.unref();
}
