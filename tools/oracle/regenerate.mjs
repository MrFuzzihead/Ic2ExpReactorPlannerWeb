/**
 * Rebuilds the Java fixtures the port is checked against, from this repository's own engine.
 *
 * The oracle used to live in a sibling working copy (`../erp-java-ref`) with no build script, so the
 * committed fixtures could not be reproduced anywhere except the machine that wrote them. That is
 * the one structural risk in the port: the corpus baseline is frozen, and a Java-side change would
 * be invisible. The harness is now vendored in `tools/oracle/java/`, and its inputs are this repo's
 * own `src/Ic2ExpReactorPlanner/` -- which is the same engine the fixtures came from -- so the whole
 * chain runs here.
 *
 * Default is **verify**: rebuild everything and diff against what is committed, exit non-zero on any
 * drift. `--write` refreshes the fixtures instead, for the day the engine changes on purpose.
 *
 *   node tools/oracle/regenerate.mjs
 *   node tools/oracle/regenerate.mjs --write
 *   node tools/oracle/regenerate.mjs --list
 *
 * What it cannot rebuild: `testResources/corpus-designs.json` is a projection of the same
 * `CorpusCodes` output into JSON (see `PROJECTIONS`), and `web/data/components.json` is
 * `Catalog`'s dump re-shaped by the Stage 2 extractor. Both are checked here as far as the oracle
 * can see them; the extractor itself is a web-side tool (`web/data` is the port's own format).
 *
 * A JDK is required. Resolution order: `JAVA_HOME`, then `javac` on PATH. The harness targets Java 8
 * and compiles on 21 and 25 unchanged; the flags below pin the locale and the console encoding,
 * because a default locale would translate the fixture and a Windows console would mangle it --
 * both were real failures while this tool was written.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLASSES = join(ROOT, '.oracle-classes');
const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');

/** Where a JDK lives: `JAVA_HOME` first, then the PATH. Both binaries have to be the same JDK or
 * the class files and the runtime disagree about the version. */
function jdk() {
  const home = process.env.JAVA_HOME;
  if (home && existsSync(join(home, 'bin'))) {
    return { javac: join(home, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), java: join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') };
  }
  return { javac: 'javac', java: 'java' };
}

const { javac, java } = jdk();

/** Every `.java` the harness needs: the engine, the corpus runner it drives, and the dumpers. */
function sources() {
  const engine = [];
  const walk = (dir) => {
    for (const entry of readdir(dir)) {
      const path = join(dir, entry);
      if (statIsDir(path)) walk(path);
      else if (entry.endsWith('.java')) engine.push(path);
    }
  };
  walk(join(ROOT, 'src/Ic2ExpReactorPlanner'));
  return [
    ...engine,
    join(ROOT, 'test/Ic2ExpReactorPlanner/corpus/Corpus.java'),
    join(ROOT, 'test/Ic2ExpReactorPlanner/corpus/CorpusRunner.java'),
    ...readdir(join(ROOT, 'tools/oracle/java'))
      .filter((entry) => entry.endsWith('.java'))
      .map((entry) => join(ROOT, 'tools/oracle/java', entry)),
  ];
}

// `readdirSync`/`statSync` through small wrappers, so the walk above stays readable.
import { readdirSync, statSync } from 'node:fs';
function readdir(dir) { return readdirSync(dir); }
function statIsDir(path) { return statSync(path).isDirectory(); }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stderr || result.stdout}`);
  }
  return result;
}

/** Compile once: the engine plus the corpus runner plus every dumper, into `.oracle-classes`. */
function compile() {
  rmSync(CLASSES, { recursive: true, force: true });
  mkdirSync(CLASSES, { recursive: true });
  run(javac, ['-encoding', 'UTF-8', '-nowarn', '-d', CLASSES, ...sources()]);
}

/** Run a main class with the flags that make the output reproducible: the fixtures are English, and
 * a console encoding is what turned every Chinese string into `??` the first time. */
function runJava(main) {
  const classpath = [CLASSES, join(ROOT, 'src')].join(process.platform === 'win32' ? ';' : ':');
  // The dumpers print `System.lineSeparator()`, so on Windows every line arrives with a `\r` the
  // committed fixtures do not have. The oracle is about numbers, not about the host's line endings.
  return run(java, [
    '-Duser.language=en',
    '-Duser.country=US',
    '-Dfile.encoding=UTF-8',
    '-Dstdout.encoding=UTF-8',
    '-Dstderr.encoding=UTF-8',
    '-cp', classpath, main,
  ]).stdout.replace(/\r\n/g, '\n');
}

/** The fixtures, each with the class that writes it and the rule for comparing.
 *
 * `body` fixtures carry `#` comment lines that are documentation rather than data, so a refresh keeps
 * the committed header and replaces only the rows -- which is also how a header change stays a
 * deliberate edit instead of a side effect of running a dumper. */
const FIXTURES = [
  {
    file: 'testResources/corpus-baseline.txt',
    main: 'CorpusDump',
    label: 'corpus baseline (304 designs, 35 fields + report SHA)',
    compare: 'body',
  },
  {
    file: 'testResources/corpus-codes.tsv',
    main: 'CorpusCodes',
    label: 'corpus codes (name, tags, GT versions, tick cap, code)',
    compare: 'exact',
  },
  {
    file: 'testResources/java-component-catalog.txt',
    main: 'Catalog',
    label: 'component catalog (72 entries, JSON lines)',
    compare: 'exact',
  },
  {
    file: 'testResources/java-reference-codes.txt',
    main: 'Ref',
    label: 'reference codes (12 designs, old and new form)',
    compare: 'body',
  },
  {
    file: 'testResources/materials-baseline.txt',
    main: 'MaterialsDump',
    label: 'materials list (4 GT variants x 72 components)',
    compare: 'exact',
  },
  {
    file: 'testResources/oracle/decimal-probe.txt',
    main: 'DecimalProbe',
    label: 'decimal formatting probe',
    compare: 'exact',
  },
  {
    file: 'testResources/oracle/format-probe.txt',
    main: 'FormatProbe',
    label: 'format/rounding probe',
    compare: 'exact',
  },
  {
    file: 'testResources/oracle/notation2.txt',
    main: 'NotationProbe',
    label: 'number notation probe',
    compare: 'exact',
  },
  {
    file: 'testResources/oracle/bundle-locale.txt',
    main: 'Ic2ExpReactorPlanner.BundleLocale',
    label: 'locale bundle probe (which keys Chinese lacks)',
    compare: 'exact',
  },
];

/** Projections: a fixture that is another fixture's data in the port's own shape. They are checked
 * by rebuilding the derivation, not by running Java twice. */
const PROJECTIONS = [
  {
    file: 'testResources/corpus-designs.json',
    label: 'corpus designs (JSON view of corpus-codes.tsv)',
    build: () => {
      const rows = read('testResources/corpus-designs.json');
      const existing = JSON.parse(rows);
      const tsv = read('testResources/corpus-codes.tsv').trim().split('\n');
      // The TSV packs the two GT switches into one two-character field (`"00"`, `"10"`, ...) and
      // prints the tick cap as text; the JSON the port reads carries them typed. That packing is
      // `CorpusCodes.java`'s own, so the projection unpacks exactly it.
      const designs = tsv.slice(1).map((line) => {
        const [id, tags, modes, tickCap, code] = line.split('\t');
        return {
          id,
          tags,
          gt509: modes[0] === '1',
          gtnh: modes[1] === '1',
          tickCap: Number(tickCap),
          code,
        };
      });
      return `${JSON.stringify({ ...existing, count: designs.length, designs }, null, 1)}\n`;
    },
  },
  {
    file: 'web/data/component-code-defaults.json',
    label: 'component code defaults (annotation + Defaults.java payload)',
    build: () => {
      const existing = JSON.parse(read('web/data/component-code-defaults.json'));
      const components = JSON.parse(runJava('Defaults'));
      return `${JSON.stringify({ ...existing, components }, null, 1)}\n`;
    },
  },
];

function read(file) {
  return readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
}

/** The comparable half of a fixture: for `body`, everything after the `#` header. */
function body(text, mode) {
  if (mode === 'exact') return text;
  return text
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

function firstDiff(expected, actual) {
  const left = expected.split('\n');
  const right = actual.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return `line ${i + 1}: committed ${JSON.stringify((left[i] ?? '<missing>').slice(0, 90))} `
        + `| rebuilt ${JSON.stringify((right[i] ?? '<missing>').slice(0, 90))}`;
    }
  }
  return '';
}

if (LIST) {
  for (const fixture of FIXTURES) console.log(`${fixture.file}\n  ${fixture.main}  --  ${fixture.label}`);
  for (const projection of PROJECTIONS) console.log(`${projection.file}\n  projection  --  ${projection.label}`);
  process.exit(0);
}

console.log(`javac ${javac}`);
compile();

let drift = 0;
for (const fixture of FIXTURES) {
  const rebuilt = runJava(fixture.main);
  const committed = read(fixture.file);
  const same = body(committed, fixture.compare) === body(rebuilt, fixture.compare);
  if (WRITE) {
    // Keep the committed header (the `#` lines), replace the data.
    const header = fixture.compare === 'body'
      ? committed.split('\n').filter((line) => line.startsWith('#')).join('\n')
      : '';
    const payload = header === '' ? rebuilt : `${header}\n${body(rebuilt, 'body')}`;
    writeFileSync(join(ROOT, fixture.file), payload);
    console.log(`wrote   ${fixture.file}  (${fixture.label})`);
    continue;
  }
  if (same) {
    console.log(`ok      ${fixture.file}  (${fixture.label})`);
  } else {
    drift += 1;
    console.log(`DRIFT   ${fixture.file}  (${fixture.label})\n        ${firstDiff(body(committed, fixture.compare), body(rebuilt, fixture.compare))}`);
  }
}

for (const projection of PROJECTIONS) {
  const rebuilt = projection.build();
  const committed = read(projection.file).replace(/\r\n/g, '\n');
  if (WRITE) {
    writeFileSync(join(ROOT, projection.file), rebuilt);
    console.log(`wrote   ${projection.file}  (${projection.label})`);
    continue;
  }
  if (rebuilt === committed) {
    console.log(`ok      ${projection.file}  (${projection.label})`);
  } else {
    drift += 1;
    console.log(`DRIFT   ${projection.file}  (${projection.label})\n        ${firstDiff(committed, rebuilt)}`);
  }
}

const total = FIXTURES.length + PROJECTIONS.length;
if (WRITE) {
  console.log(`\nrewrote ${total} fixtures`);
} else if (drift === 0) {
  console.log(`\n${total} fixtures match this repository's Java engine`);
} else {
  console.log(`\n${drift} of ${total} fixtures drifted; run with --write if the change is intended`);
  process.exit(1);
}
