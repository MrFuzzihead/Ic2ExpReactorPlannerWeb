/**
 * Stage 3's oracle: the whole corpus, run in JS, diffed against the committed Java baseline.
 *
 * `testResources/corpus-baseline.txt` is frozen golden data -- it was generated on the desktop
 * branch by running the real Swing engine over `Corpus.all()`. Nothing here regenerates it. A
 * clean diff across all 304 designs is the claim that the port is equivalent; a dirty diff names
 * the designs that moved and the component categories they share, which is what tells a fix where
 * to go.
 *
 * The comparison is the same 35-field line `CorpusRunner.Result#toLine()` writes, in the same
 * order, with the same compact number formatting -- `%.6f` in `Locale.US`, and anything at or
 * above 1e12 collapsed to `MAX` so `Double.MAX_VALUE` sentinels stay readable. The report itself
 * is covered by the SHA, so per-component figures (peak vent cooling, condensator cooling, max
 * reached heat) are in scope even though no scalar field holds them.
 *
 * Run: `node web/test/corpus.test.js` (add `--only <pattern>` to run a subset).
 *
 * @see test/Ic2ExpReactorPlanner/corpus/CorpusRunner.java, testResources/corpus-baseline.txt
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setGT509Behavior, setGTNHBehavior, parseCatalog } from '../engine/components.js';
import { loadBundle, getI18n } from '../engine/i18n.js';
import { simulateCode } from '../engine/automation-simulator.js';
import { INT_MAX, DOUBLE_MAX, BASELINE_MAX_MAGNITUDE } from '../data/limits.js';
import { formatDecimal } from '../engine/format.js';

const ONLY = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;

// ---------------------------------------------------------------- fixtures

const baselineText = await readFile('testResources/corpus-baseline.txt', 'utf8');
const designsFixture = await readFile('testResources/corpus-designs.json', 'utf8');
const catalogFixture = await readFile('web/data/components.json', 'utf8');
const bundleFixture = await readFile('web/data/i18n/en.json', 'utf8');

loadBundle(bundleFixture);
const catalog = parseCatalog(catalogFixture);
const designs = JSON.parse(designsFixture).designs;

const baseline = new Map();
for (const line of baselineText.split(/\r?\n/)) {
  if (line.startsWith('#') || line === '') continue;
  const id = line.split('|')[0];
  if (baseline.has(id)) throw new Error(`duplicate baseline id: ${id}`);
  baseline.set(id, line);
}

/**
 * The elapsed-time line is the one legitimately variable part of a report, so the Java runner
 * removes it before hashing. Same marker, same rule: from the pattern's literal prefix to the
 * next newline.
 */
function stripElapsedTime(report) {
  const marker = formatI18nPrefix('Simulation.ElapsedTime');
  const start = report.indexOf(marker);
  if (start < 0) return report;
  const end = report.indexOf('\n', start);
  return end < 0 ? report.slice(0, start) : report.slice(0, start) + report.slice(end);
}

function formatI18nPrefix(key) {
  return getI18n(key).split('%')[0];
}

/** `CorpusRunner.Result#fmt`: compact, locale-independent, sentinel-collapsing. */
function fmt(value) {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  if (Math.abs(value) >= BASELINE_MAX_MAGNITUDE) return value > 0 ? 'MAX' : '-MAX';
  return formatDecimal('0.000000', value);
}

/** `CorpusRunner.Result#sha256`, truncated to 8 bytes so a diff stays readable. */
function reportHash(report) {
  return createHash('sha256').update(report, 'utf8').digest().slice(0, 8).toString('hex');
}

// ---------------------------------------------------------------- one result line

function toLine(design, data, report) {
  const v = data.values();
  const fields = [
    design.id,
    design.tags,
    1,
    v.totalReactorTicks,
    v.timeToBurn,
    v.timeToEvaporate,
    v.timeToHurt,
    v.timeToLava,
    v.timeToXplode,
    v.timeToBelow50,
    fmt(v.minTemp),
    fmt(v.maxTemp),
    v.totalRodCount,
    fmt(v.totalEUoutput),
    fmt(v.avgEUoutput),
    fmt(v.minEUoutput),
    fmt(v.maxEUoutput),
    fmt(v.totalHUoutput),
    fmt(v.avgHUoutput),
    fmt(v.minHUoutput),
    fmt(v.maxHUoutput),
    v.firstComponentBrokenTime,
    v.firstComponentBrokenRow,
    v.firstComponentBrokenCol,
    v.firstRodDepletedTime,
    v.firstRodDepletedRow,
    v.firstRodDepletedCol,
    fmt(v.prebreakTotalEUoutput),
    fmt(v.predepleteTotalEUoutput),
    fmt(v.hullHeating),
    fmt(v.componentHeating),
    fmt(v.hullCooling),
    fmt(v.ventCooling),
    fmt(v.hullCoolingCapacity),
    fmt(v.ventCoolingCapacity),
    reportHash(stripElapsedTime(report)),
  ];
  return fields.join('|');
}

// ---------------------------------------------------------------- run and diff

const FIELDS = [
  'id', 'tags', 'completed', 'ticks', 'tBurn', 'tEvap', 'tHurt', 'tLava', 'tXplode', 'tBelow50',
  'minTemp', 'maxTemp', 'rods', 'totalEU', 'avgEU', 'minEU', 'maxEU',
  'totalHU', 'avgHU', 'minHU', 'maxHU',
  'brkTime', 'brkRow', 'brkCol', 'depTime', 'depRow', 'depCol',
  'prebreakEU', 'predepleteEU', 'hullHeat', 'compHeat', 'hullCool', 'ventCool',
  'hullCoolCap', 'ventCoolCap', 'reportSha',
];

const run = [];
const failures = [];
const started = process.hrtime.bigint();

for (const design of designs) {
  if (ONLY !== null && !design.id.includes(ONLY)) continue;
  // GT modes are process-wide statics in Java; the runner sets them per design and clears them
  // after, which is what `CorpusRunner.run`'s try/finally does.
  setGT509Behavior(design.gt509);
  setGTNHBehavior(design.gtnh);
  let line;
  try {
    const result = simulateCode(design.code, catalog, { tickCap: design.tickCap });
    line = toLine(design, result.data, result.report);
  } catch (error) {
    line = `${design.id}|ERROR|${error}`;
    failures.push({ id: design.id, line, expected: baseline.get(design.id), diff: ['run threw'] });
  }
  run.push(line);
  const expected = baseline.get(design.id);
  if (expected === undefined) {
    failures.push({ id: design.id, line, expected: null, diff: ['not in baseline'] });
  } else if (expected !== line) {
    const a = expected.split('|');
    const b = line.split('|');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diff.push(`${FIELDS[i]}: ${a[i]} -> ${b[i]}`);
    }
    failures.push({ id: design.id, line, expected, diff });
  }
}

const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

const runIds = new Set(run.map((line) => line.split('|')[0]));
const missing = ONLY === null ? [...baseline.keys()].filter((id) => !runIds.has(id)) : [];
const extra = run.filter((line) => !baseline.has(line.split('|')[0]));

console.log(`corpus: ${run.length} designs run in ${elapsedMs.toFixed(0)} ms `
  + `(${(elapsedMs / run.length).toFixed(1)} ms/design)`);
console.log(`baseline: ${baseline.size} lines, missing ${missing.length}, extra ${extra.length}`);

for (const failure of failures) {
  console.log(`\n${failure.id}  tags=${designs.find((d) => d.id === failure.id)?.tags}`);
  for (const entry of failure.diff) console.log(`  ${entry}`);
}

if (failures.length > 0 || missing.length > 0 || extra.length > 0) {
  console.log(`\n${failures.length} designs differ of ${run.length}`);
  const byTag = new Map();
  for (const failure of failures) {
    const tags = designs.find((d) => d.id === failure.id)?.tags ?? '?';
    byTag.set(tags, (byTag.get(tags) ?? 0) + 1);
  }
  console.log('shared categories:');
  for (const [tags, count] of [...byTag].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}  ${tags}`);
  }
  process.exitCode = 1;
} else {
  console.log('clean diff: every design matches the committed baseline');
}
