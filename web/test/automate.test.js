/**
 * Stage 5's `Automate`, asserted against the corpus rather than against a screenshot.
 *
 * Three claims. The panel names the cell the finger aimed at: its label is rebuilt here from the
 * decoded design's own catalog entry and the bundle's `UI.InitialHeatDisplay`, rather than from
 * `openAutomationPanel`, so an off-by-one in the row/column math or a panel that read a different
 * cell shows up as a mismatched pair. The two numbers survive the round trip they have to survive:
 * written onto a cell, encoded, decoded, and read back, they are the numbers the engine stored --
 * which is what makes an automated design a *code* rather than a page-local second model. And a
 * value the engine's setter refuses leaves the cell alone rather than clamped, which is asserted
 * both for a number outside the format's bound and for a component that cannot be automated at all.
 *
 * What is *not* claimed: that the automation the run then performs is right. `corpus.test.js`
 * already holds the run against the Java baseline through the report's SHA; this file only claims
 * that editing the two fields lands where the finger aimed and survives the code.
 *
 * Run: `node web/test/automate.test.js` (add `--only <pattern>` to run a subset).
 *
 * @see web/ui/automate.js, src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java (the per-cell button
 * @see and the spinner change handlers), WEB_MIGRATION_PLAN.md section 21
 */

import { readFile } from 'node:fs/promises';
import { parseCatalog, createComponent, setInitialHeat, setAutomationThreshold, setReactorPause } from '../engine/components.js';
import { loadBundle, getI18n, formatI18n } from '../engine/i18n.js';
import { stringFormat } from '../engine/format.js';
import { componentToString } from '../engine/automation-simulator.js';
import { readDesign, writeCode, copyDesign } from '../ui/board-edit.js';
import { codeDefaults } from '../engine/automation-simulator.js';
import { openAutomationPanel, applyAutomationParams } from '../ui/automate.js';
import { GRID_COLS, CELL_COUNT, MAX_AUTOMATION_THRESHOLD, MAX_REACTOR_PAUSE } from '../data/bounds.js';

const ONLY = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));
const designs = JSON.parse(await readFile('testResources/corpus-designs.json', 'utf8')).designs;

// ---------------------------------------------------------------------------
// The label, rebuilt from the design rather than from the panel
// ---------------------------------------------------------------------------

/**
 * What the desktop's label line would say for the cell at `index`: `UI.ChosenComponentRowCol`
 * around the component's name and its position, with the heat suffix the component's `toString`
 * adds when the code carries an initial heat. Assembled from the catalog entry the *decoded design*
 * names, so this is a second route to the same fact rather than a call to the module under test.
 */
function expectedLabel(design, index) {
  const cell = design.cells[index];
  const entry = catalog.byId[cell.id];
  assert(entry !== undefined, `the design names a component id this catalog lacks: ${cell.id}`);
  const name = getI18n(entry.nameKey);
  const label = cell.initialHeat > 0
    ? name + stringFormat(getI18n('UI.InitialHeatDisplay'), Math.trunc(cell.initialHeat))
    : name;
  return formatI18n('UI.ChosenComponentRowCol', label, Math.floor(index / GRID_COLS), index % GRID_COLS);
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

let opened = 0;
let refused = 0;
let carriedBack = 0;
let droppedIntoDefaults = 0;
let keptUnchanged = 0;
let refusedOutOfRange = 0;
let refusedUnautomatable = 0;
let emptyRefusals = 0;

for (const design of designs) {
  if (ONLY !== null && !design.id.includes(ONLY)) continue;

  const read = readDesign(design.code, catalog);
  assert(read.ok, `corpus design ${design.id} does not decode: ${read.message}`);
  const decoded = read.design;

  for (let index = 0; index < CELL_COUNT; index++) {
    const panel = openAutomationPanel(decoded, index, catalog);

    if (!panel.ok) {
      emptyRefusals++;
      // The desktop's own words for the automate button on an empty cell, naming that cell.
      assert(panel.message === formatI18n('UI.NoComponentRowCol', Math.floor(index / GRID_COLS), index % GRID_COLS),
        `automating an empty cell said: ${panel.message}`);
      continue;
    }

    opened++;
    assert(panel.label === expectedLabel(decoded, index),
      `the panel for index ${index} reads ${panel.label}, the design says ${expectedLabel(decoded, index)}`);
    assert(panel.automationThreshold === decoded.cells[index].automationThreshold
      && panel.reactorPause === decoded.cells[index].reactorPause,
      `the panel for index ${index} shows numbers the code does not carry`);

    // The round trip: ask for two numbers the format can carry, write them back through the code,
    // and read them out of the code. The values asked for are derived from the cell so the pair
    // differs from whatever the corpus happened to carry.
    const wanted = {
      automationThreshold: Math.min(MAX_AUTOMATION_THRESHOLD, decoded.cells[index].automationThreshold + 1234),
      reactorPause: Math.min(MAX_REACTOR_PAUSE, decoded.cells[index].reactorPause + 7),
    };
    const scratch = copyDesign(decoded);
    const applied = applyAutomationParams(scratch, index, wanted.automationThreshold, wanted.reactorPause, catalog);
    assert(applied.ok, `automating index ${index} refused: ${applied.message}`);

    const written = writeCode(scratch, catalog);
    assert(written.ok, `the automated design no longer fits a code: ${written.message}`);
    const back = readDesign(written.code, catalog);
    assert(back.ok, `the automated code does not read back: ${back.message}`);
    const stored = back.design.cells[index];
    assert(stored !== null, `the automated code lost the component at index ${index}`);

    if (decoded.automated) {
      assert(applied.carried, `an automated design reported its numbers as not carried`);
      assert(stored.automationThreshold === applied.kept.automationThreshold
        && stored.reactorPause === applied.kept.reactorPause,
        `the code round trip changed index ${index}'s numbers: asked ${applied.kept.automationThreshold}/${applied.kept.reactorPause}, read ${stored.automationThreshold}/${stored.reactorPause}`);
      carriedBack++;
    } else {
      // The code writes these two fields only for a reactor flagged automated, so an edit made on
      // a reactor that is not automated reads back as the component's own default. Asserting that
      // is the point: the trap is real in the desktop too, and the page has to surface the flag
      // rather than let an edit look applied and then vanish.
      assert(!applied.carried, `a reactor that is not automated reported its numbers as carried`);
      const fallback = codeDefaults(catalog)[decoded.cells[index].id];
      assert(stored.automationThreshold === fallback.automationThreshold
        && stored.reactorPause === fallback.reactorPause,
        `a reactor that is not automated still kept index ${index}'s edited numbers in the code`);
      droppedIntoDefaults++;
    }

    // The guard, not a clamp: a number outside the format's bound leaves the cell alone.
    const over = copyDesign(decoded);
    const tooBig = applyAutomationParams(over, index, MAX_AUTOMATION_THRESHOLD + 1, MAX_REACTOR_PAUSE + 1, catalog);
    assert(tooBig.ok, `an out-of-range automation value threw: ${tooBig.message}`);
    assert(tooBig.kept.automationThreshold === decoded.cells[index].automationThreshold
      && tooBig.kept.reactorPause === decoded.cells[index].reactorPause,
      `an out-of-range value changed index ${index} instead of leaving it alone`);
    refusedOutOfRange++;

    // The other half of the same guard: a component with no heat and no damage cannot be automated.
    const prototype = createComponent(catalog, decoded.cells[index].id);
    if (prototype.maxHeat <= 1 && prototype.maxDamage <= 1) {
      // The invariant automate.js relies on when it seeds a component from a cell: a component that
      // cannot be automated never arrives carrying anything but its defaults, so seeding is identity
      // rather than a reset.
      const fallback = codeDefaults(catalog)[decoded.cells[index].id];
      assert(decoded.cells[index].automationThreshold === fallback.automationThreshold
        && decoded.cells[index].reactorPause === fallback.reactorPause,
        `a component that cannot be automated arrived carrying index ${index}'s numbers`);
      const still = copyDesign(decoded);
      const refusedHere = applyAutomationParams(still, index, 500, 5, catalog);
      assert(refusedHere.kept.automationThreshold === decoded.cells[index].automationThreshold
        && refusedHere.kept.reactorPause === decoded.cells[index].reactorPause,
        `a component that cannot be automated had its numbers changed at index ${index}`);
      refusedUnautomatable++;
    } else if (decoded.cells[index].automationThreshold !== wanted.automationThreshold
      || decoded.cells[index].reactorPause !== wanted.reactorPause) {
      keptUnchanged++;
    }
  }

  // A cell outside the grid is a miss, in the same words board editing uses.
  const off = openAutomationPanel(decoded, CELL_COUNT, catalog);
  assert(!off.ok && off.message === 'no such cell', `a tap off the board answered: ${off.ok ? 'a panel' : off.message}`);
  const offWrite = applyAutomationParams(decoded, -1, 10, 1, catalog);
  assert(!offWrite.ok && offWrite.message === 'no such cell', `a write off the board answered: ${offWrite.ok ? 'kept' : offWrite.message}`);
}

console.log(`automate: ${opened} panels named the cell the finger aimed at, ${emptyRefusals} empty cells refused in the desktop's words, ${carriedBack} threshold/pause pairs survived the code, ${droppedIntoDefaults} edits on a reactor that is not automated read back as defaults, ${refusedOutOfRange} out-of-range values left their cell alone, ${refusedUnautomatable} components that cannot be automated were left alone`);
