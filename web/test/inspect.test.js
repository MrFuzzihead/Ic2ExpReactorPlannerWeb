/**
 * Stage 4's `Inspect` readout, asserted against the corpus rather than against a screenshot.
 *
 * The claim has three parts. The reader picks the right cell: every readout is compared, string for
 * string, against the `component.info` the run left on the component at the same flat index, so an
 * off-by-one in the row/column math shows up as a mismatched pair rather than as a plausible popover.
 * Every line is the bundle's: each one matches exactly one of the eleven `ComponentInfo.*` templates
 * once its numbers are masked, so nothing here is a sentence invented for the web target. And the
 * refusals are the desktop's: a cell the run left empty answers `UI.NoComponentLastSimRowCol` naming
 * that cell, and a page that has not run yet answers `UI.NoSimulationRun`.
 *
 * What is *not* claimed: that the figures are right. They come from the run, and `corpus.test.js`
 * already holds the run against the Java baseline through the report's SHA.
 *
 * Run: `node web/test/inspect.test.js` (add `--only <pattern>` to run a subset).
 *
 * @see web/ui/inspect.js, src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java (the info button)
 */

import { readFile } from 'node:fs/promises';
import { parseCatalog } from '../engine/components.js';
import { loadBundle, getI18n, formatI18n } from '../engine/i18n.js';
import { simulate, inspectCell } from '../ui/inspect.js';
import { GRID_COLS, CELL_COUNT } from '../data/bounds.js';

const ONLY = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));
const designs = JSON.parse(await readFile('testResources/corpus-designs.json', 'utf8')).designs;

// ---------------------------------------------------------------------------
// The bundle's own readout lines, as patterns
// ---------------------------------------------------------------------------

/**
 * Each `ComponentInfo.*` template becomes a pattern with its format specifiers masked to a number.
 * A line that matches none of them is a line this port wrote rather than copied from the bundle,
 * which is the failure the migration is meant to prevent.
 */
const INFO_KEYS = [
  'BreederProgress', 'BrokeTime', 'CooldownTime', 'GeneratedEU', 'GeneratedHeat', 'ReceivedHeat',
  'RemainingHeat', 'ReplacedTime', 'ResidualHeat', 'ReachedHeat', 'UsedCooling',
];

const INFO_PATTERNS = INFO_KEYS.map((key) => {
  const template = getI18n(`ComponentInfo.${key}`);
  const parts = template.split(/%[^a-zA-Z]*[dfs]/);
  const literals = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  return { key, pattern: new RegExp(`^${literals.join(String.raw`[-+\d.,eE]+`)}$`) };
});

function lineKey(line) {
  const matched = INFO_PATTERNS.filter((entry) => entry.pattern.test(line));
  return matched.length === 1 ? matched[0].key : null;
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

let inspected = 0;
let silent = 0;
let longest = 0;
const perKey = new Map();
let heated = 0;
let refused = 0;

for (const design of designs) {
  if (ONLY !== null && !design.id.includes(ONLY)) continue;
  const run = simulate(design.code, catalog, { tickCap: design.tickCap });
  if (!run.ok) {
    // The corpus is all readable codes, so a refusal here is a decoder regression, not a readout one.
    throw new Error(`corpus design ${design.id} does not decode: ${run.message}`);
  }

  for (let index = 0; index < CELL_COUNT; index++) {
    const row = Math.floor(index / GRID_COLS);
    const col = index % GRID_COLS;
    const component = run.run.reactor.getComponentAt(row, col);
    const got = inspectCell(run.run, index);

    if (component === null) {
      assert(!got.ok, `a cell the run left empty at row ${row} column ${col} still answered ${got.name}`);
      assert(got.message === formatI18n('UI.NoComponentLastSimRowCol', row, col),
        `an empty cell refused with something other than the bundle's sentence: ${got.message}`);
      refused++;
      continue;
    }

    assert(got.ok, `the run left a component at row ${row} column ${col} and the readout refused it`);

    // The reader and the run have to agree on the cell, array for array: this is what catches a
    // row/column mapping that is off by one rather than off by nothing.
    assert(got.lines === component.info, `the readout for cell ${index} is not the run's own array`);

    // Every line is the bundle's. The kinds are what the design document's "up to 11 lines" counts:
    // a rod an automated reactor replaces every 84 seconds says `ReplacedTime` fifty times, so the
    // line *count* is unbounded and the *kinds* are what have a ceiling.
    for (const line of got.lines) {
      const key = lineKey(line);
      assert(key !== null, `cell ${index} carries a line no ComponentInfo template wrote: ${line}`);
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    const kinds = new Set(got.lines.map((line) => lineKey(line)));
    assert(kinds.size <= INFO_KEYS.length,
      `cell ${index} mixes ${kinds.size} kinds of readout line, more than the ${INFO_KEYS.length} the bundle can write`);
    if (got.lines.length > longest) longest = got.lines.length;

    // The header is the desktop's sentence around the component's own label, and that label is
    // `ReactorItem#toString`: the name, plus initial heat when the cell was configured with any.
    const label = formatI18n('UI.ComponentInfoLastSimRowCol', got.name, row, col, got.lines.join(''));
    assert(got.text === label, `cell ${index}'s popover is not the desktop's sentence: ${got.text}`);
    assert(got.text.startsWith(`${got.name} at row ${row} column ${col}`),
      `cell ${index}'s header does not name where it is: ${got.text}`);
    if (component.initialHeat > 0) {
      heated++;
      const heat = formatI18n('UI.InitialHeatDisplay', Math.trunc(component.initialHeat));
      assert(got.name.endsWith(heat), `cell ${index} was configured with heat ${Math.trunc(component.initialHeat)} and its header says ${got.name}`);
    }

    inspected++;
    if (got.lines.length === 0) silent++;
    if (got.lines.length > longest) longest = got.lines.length;
  }
}

// ---------------------------------------------------------------------------
// The two refusals a page can hit that the corpus cannot
// ---------------------------------------------------------------------------

const before = inspectCell(null, 0);
assert(!before.ok && before.message === getI18n('UI.NoSimulationRun'),
  `a page that has not run yet says: ${before.message}`);

const sample = simulate('', catalog);
assert(sample.ok, `the empty design does not run: ${sample.message}`);
const offGrid = inspectCell(sample.run, CELL_COUNT);
assert(!offGrid.ok && offGrid.message === formatI18n('UI.NoComponentLastSimRowCol', 6, 0),
  `a cell off the grid says: ${offGrid.message}`);

console.log(`inspect: ${inspected} readouts over ${refused} empty cells, ${silent} of them saying nothing, longest ${longest} lines`);
console.log(`inspect: lines by template -- ${[...perKey].map(([key, n]) => `${key} ${n}`).sort().join(', ')}`);
console.log(`inspect: ${heated} headers carry an initial heat, every line matched a ComponentInfo template`);
