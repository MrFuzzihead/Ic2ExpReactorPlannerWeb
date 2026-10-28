/**
 * The suite, in one command, with the setup each file needs done for it.
 *
 * `page.test.js` reads the design to draw from `ERP_CODE` and does noticeably less when it is unset
 * -- it exercises the empty board, which is a real state but not the one 90 % of the assertions are
 * about. Running the suite by hand therefore meant remembering an environment variable *and* a
 * shell substitution from `index.html`, and a suite that quietly runs a weaker case is worse than
 * one that is not run at all. This file reads the sample design out of the page and runs both
 * cases: the sample, and the empty board.
 *
 *   node tools/test.mjs
 *   node tools/test.mjs --only page       # one file, by substring
 *
 * Exit code is the number of failing files, capped at 1.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/** The design `index.html` ships, which is the one `page.test.js` should be drawing. */
const sampleCode = (() => {
  const html = readFileSync(join(ROOT, 'web/ui/index.html'), 'utf8');
  const match = /<textarea id="code">([^<]*)/.exec(html);
  if (match === null) throw new Error('the page has no #code field to read the sample design from');
  return match[1].trim();
})();

/** Every `*.test.js` under `web/test`, plus the two standalone oracles. The oracle scripts are not
 * named `*.test.js` because they predate the convention; they are still part of the gate. */
const files = [
  ...readdirSync(join(ROOT, 'web/test'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => `web/test/${name}`),
  'test/format-oracle.mjs',
].filter((file) => ONLY === null || file.includes(ONLY));

if (files.length === 0) {
  console.log(`no test file matches "${ONLY}"`);
  process.exit(1);
}

let passed = 0;
const failures = [];
const started = Date.now();

for (const file of files) {
  // The page test runs twice: the shipped design, and the empty board it also has to survive.
  const runs = file.endsWith('web/test/page.test.js')
    ? [{ label: '', env: { ERP_CODE: sampleCode } }, { label: ' (empty board)', env: { ERP_CODE: '' } }]
    : [{ label: '', env: {} }];

  for (const run of runs) {
    const began = Date.now();
    const result = spawnSync(process.execPath, [file], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...run.env },
    });
    const ms = Date.now() - began;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const last = output.split('\n').filter((line) => line.trim() !== '').at(-1) ?? '(no output)';

    if (result.status === 0) {
      passed += 1;
      console.log(`ok    ${String(ms).padStart(5)} ms  ${file}${run.label}`);
      // The file's own last line is its claim; printing it is what makes the run readable without
      // opening the source.
      console.log(`                   ${last.slice(0, 190)}`);
    } else {
      failures.push({ file, run, output, last });
      console.log(`FAIL  ${String(ms).padStart(5)} ms  ${file}${run.label}`);
      console.log(`                   ${last.slice(0, 190)}`);
    }
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length > 0) {
  console.log(`\n${passed} passed, ${failures.length} failed (${seconds}s)`);
  for (const failure of failures) {
    console.log(`\n--- ${failure.file}${failure.run.label}\n${failure.output.split('\n').slice(-25).join('\n')}`);
  }
  process.exit(1);
}

console.log(`\n${passed} of ${passed} runs passed in ${seconds}s`);
