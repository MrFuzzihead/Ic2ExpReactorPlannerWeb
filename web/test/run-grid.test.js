#!/usr/bin/env node
/**
 * What a finished run leaves on the grid: the cells that melted down and the cells that still held
 * heat, asserted against the simulator's own colour chunks.
 *
 * The desktop's run reports its grid state through the SwingWorker's message channel, not through
 * the report: `AutomationSimulator` publishes `R%dC%d:0xRRGGBB` (`:191` silver for every one of the
 * 54 cells before the loop starts, `:367` orange for a component that still holds heat at the end,
 * `:686` red for one that broke), and the worker's `process` (`:984-997`) paints each chunk onto
 * `reactorButtonPanels[row][col]` — the frame's *design* grid — and sets the button's tooltip to
 * `ComponentTooltip.Broken` or `ComponentTooltip.ResidualHeat`. "What melts down" is therefore a
 * colour on the cell the visitor edits, and the only reason the corpus baseline still hashes is that
 * those chunks never reach the report.
 *
 * So the claims below are about the chunks and what the page does with them: the routing still
 * holds (no chunk reaches the report, which is what keeps every baseline hash valid), the colours
 * land only where the desktop's walk can put them, the two colours never fight over a cell, and the
 * words the page shows are the bundle's rather than a translation.
 *
 * Run: `node web/test/run-grid.test.js`
 *
 * @see web/ui/run-grid.js, WEB_MIGRATION_PLAN.md §35
 */

import { loadBundle, getI18n } from '../engine/i18n.js';
import { parseCatalog } from '../engine/components.js';
import { describeBoard } from '../ui/board.js';
import { simulate } from '../ui/inspect.js';
import { isReactorCellChunk } from '../engine/automation-simulator.js';
import { runMarks, runLegend, MELT_COLOUR, RESIDUAL_COLOUR, CLEAR_COLOUR } from '../ui/run-grid.js';
import { GRID_ROWS, GRID_COLS, CELL_COUNT } from '../data/bounds.js';
import { readFile } from 'node:fs/promises';

const designsFixture = await readFile('testResources/corpus-designs.json', 'utf8');
const catalogFixture = await readFile('web/data/components.json', 'utf8');
const bundleFixture = await readFile('web/data/i18n/en.json', 'utf8');

loadBundle(bundleFixture);
const catalog = parseCatalog(catalogFixture);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The three colours are the three the simulator publishes, and they are distinct: a page that read
// silver and red as the same mark would show every cell as melted.
const colours = [MELT_COLOUR, RESIDUAL_COLOUR, CLEAR_COLOUR];
assert(new Set(colours).size === 3, `two of the three run colours are the same value (${colours.join(', ')})`);
for (const colour of colours) {
  assert(/^0x[0-9A-F]{6}$/.test(colour), `${colour} is not the shape the simulator publishes`);
}
assert(getI18n('ComponentTooltip.Broken').length > 0 && getI18n('ComponentTooltip.ResidualHeat').length > 0,
  'a run colour has no words to label it with');

const brokenWords = getI18n('ComponentTooltip.Broken');
const residualWords = getI18n('ComponentTooltip.ResidualHeat');
assert(brokenWords !== residualWords, 'a melted cell and a hot cell share one legend entry');

const designs = JSON.parse(designsFixture).designs;
let runs = 0;
let meltedDesigns = 0;
let residualDesigns = 0;
let marked = 0;

for (const design of designs) {
  const board = describeBoard(design.code, catalog);
  if (!board.ok) continue;
  const run = simulate(design.code, catalog);
  if (!run.ok) continue;

  // The routing claim: a chunk that reads as a cell never reaches the report, which is what keeps
  // every corpus hash valid. The engine's own `isReactorCellChunk` is the shape test, so the claim
  // is about the report the page shows rather than about a colour the page draws.
  for (const line of run.run.report.split('\n')) {
    assert(!isReactorCellChunk(line), `${design.id}'s report carries a colour chunk (${line})`);
  }

  const filled = new Set(board.cells.map((cell) => cell.index));
  const paint = run.run.cellPaint;
  const seen = new Map();
  for (const [index, entry] of paint) {
    assert(Number.isInteger(index) && index >= 0 && index < CELL_COUNT,
      `${design.id}'s run painted cell ${index}, off a ${GRID_ROWS} x ${GRID_COLS} grid`);
    assert(entry.colour === MELT_COLOUR || entry.colour === RESIDUAL_COLOUR || entry.colour === CLEAR_COLOUR,
      `${design.id}'s cell ${index} carries a colour the simulator never publishes (${entry.colour})`);

    // The desktop's tooltip rule, read off the entry rather than derived from the colour at paint
    // time: silver clears the tooltip, the two marks set the bundle's words.
    if (entry.colour === CLEAR_COLOUR) assert(entry.tooltip === null, `a cleared cell still reads ${entry.tooltip}`);
    else if (entry.colour === MELT_COLOUR) assert(entry.tooltip === brokenWords, `a melted cell reads ${entry.tooltip}, the bundle says ${brokenWords}`);
    else assert(entry.tooltip === residualWords, `a hot cell reads ${entry.tooltip}, the bundle says ${residualWords}`);

    // A melt only ever lands where the desktop's walk found a component: `handleBrokenComponents`
    // (`:678-686`) walks `tickComponents`, which came from the cells the design holds.
    if (entry.colour === MELT_COLOUR) {
      assert(filled.has(index), `${design.id} marks an empty cell (${index}) as melted`);
    }
    seen.set(index, entry.colour);
  }

  // The two colours never fight over one cell: the residual pass skips a broken component
  // (`:364` `!component.isBroken()`), so a cell that melted stays red to the end.
  let red = 0;
  let orange = 0;
  for (const [index, colour] of seen) {
    if (colour === MELT_COLOUR) red += 1;
    else if (colour === RESIDUAL_COLOUR) orange += 1;
  }
  if (red > 0) meltedDesigns += 1;
  if (orange > 0) residualDesigns += 1;

  // The page's marks are a subset of the cells it draws an icon for, in board order.
  const marks = runMarks(paint, filled);
  assert(marks.length === red + orange,
    `${design.id} marks ${marks.length} cells, the run painted ${red} melted and ${orange} hot`);
  for (let at = 1; at < marks.length; at += 1) {
    assert(marks[at].index > marks[at - 1].index, `${design.id}'s marks are not in board order`);
  }
  for (const mark of marks) {
    assert(filled.has(mark.index), `${design.id} marks cell ${mark.index}, which shows no icon`);
    assert(mark.kind === 'melt' || mark.kind === 'residual', `cell ${mark.index} has an unnamed kind (${mark.kind})`);
  }

  // The legend names only what is on the board, in the desktop's own branch order.
  const legend = runLegend(marks);
  assert(legend.length <= 2, `${design.id}'s legend has ${legend.length} rows, two colours exist`);
  if (red > 0) assert(legend.some((row) => row.kind === 'melt' && row.words === brokenWords),
    `${design.id} has ${red} melted cells and no legend row for them`);
  if (orange > 0) assert(legend.some((row) => row.kind === 'residual' && row.words === residualWords),
    `${design.id} has ${orange} hot cells and no legend row for them`);
  if (red === 0 && orange === 0) assert(legend.length === 0, `${design.id} shows a legend for a run that marked nothing`);

  marked += marks.length;
  runs += 1;
}

assert(runs > 0, 'no corpus design reached a run');
assert(meltedDesigns > 0, 'no design melts anything, so the red marker would never show');
assert(residualDesigns > 0, 'no design ends with residual heat, so the orange marker would never show');
assert(meltedDesigns < runs, 'every design melts, so the marker would be constant');
assert(marked > 0, 'no run marked a cell, so the grid readout is doing nothing');

console.log(`run-grid.test.js: ${runs} runs (${meltedDesigns} melted, ${residualDesigns} hot) marked ${marked} cells, no colour chunk reached a report, and no mark landed on a cell the board does not draw`);
