/**
 * Stage 4's board model, verified without a browser.
 *
 * The claim under test is that the grid the UI draws is the grid the engine reads: every cell
 * `decodeCode` puts in the flat array appears exactly once, at the row/col its index implies,
 * with the icon and name the catalog gives its id. The corpus supplies the codes, so the shapes
 * exercised are real designs rather than hand-written ones.
 *
 * Run: `node web/test/board.test.js`
 *
 * @see web/ui/board.js, testResources/corpus-designs.json
 */

import { readFile, readdir } from 'node:fs/promises';
import { decodeCode } from '../engine/reactor-code.js';
import { parseCatalog, createComponent, getComponentCount } from '../engine/components.js';
import { loadBundle, getI18n } from '../engine/i18n.js';
import { describeBoard, catalogDisplay, CORE_COLS } from '../ui/board.js';
import { GRID_ROWS, GRID_COLS, CELL_COUNT } from '../data/bounds.js';

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));
const designs = JSON.parse(await readFile('testResources/corpus-designs.json', 'utf8')).designs;
const iconFiles = new Set(await readdir('web/assets/icons'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// 1. Every catalog icon resolves to a file that ships
// ---------------------------------------------------------------------------

const display = catalogDisplay(catalog);
let missingIcons = 0;
for (let id = 1; id <= getComponentCount(catalog); id++) {
  const entry = display[id];
  if (entry === undefined) continue;
  const file = entry.icon.replace(/^\.\.\/assets\/icons\//, '');
  if (!iconFiles.has(file) && (entry.iconFallback === null || !iconFiles.has(entry.iconFallback))) missingIcons++;
  assert(entry.name !== undefined && entry.name !== entry.nameKey, `id ${id} has no localized name`);
}
assert(missingIcons === 0, `${missingIcons} catalog entries have no icon on disk`);
console.log(`icons: ${iconFiles.size} files on disk, every catalog entry resolves`);

// ---------------------------------------------------------------------------
// 2. The board is the decoded design, cell for cell
// ---------------------------------------------------------------------------

let checkedCells = 0;
for (const design of designs) {
  const board = describeBoard(design.code, catalog);
  assert(board.ok, `corpus design ${design.id} no longer decodes: ${board.message}`);

  const read = decodeCode(design.code, { defaults: [] });
  let expected = 0;
  for (let index = 0; index < CELL_COUNT; index++) {
    if (read.design.cells[index] !== null) expected++;
  }
  assert(board.filled === expected, `${design.id}: board shows ${board.filled} cells, decoder has ${expected}`);

  const seen = new Set();
  for (const cell of board.cells) {
    const key = `${cell.row},${cell.col}`;
    assert(!seen.has(key), `${design.id}: two cells claim ${key}`);
    seen.add(key);
    assert(cell.row >= 0 && cell.row < GRID_ROWS, `${design.id}: row ${cell.row} is off the grid`);
    assert(cell.col >= 0 && cell.col < GRID_COLS, `${design.id}: col ${cell.col} is off the grid`);
    assert(cell.index === cell.row * GRID_COLS + cell.col, `${design.id}: cell ${cell.index} is positioned wrong`);
    assert(cell.id === read.design.cells[cell.index].id, `${design.id}: cell ${cell.index} shows the wrong component`);
    assert(cell.initialHeat === read.design.cells[cell.index].initialHeat, `${design.id}: cell ${cell.index} shows the wrong heat`);
    checkedCells++;
  }
  // The frame is always the whole grid: the game opens columns one Reactor Chamber at a time, and
  // the columns it has not opened are drawn and crossed rather than left out. An empty design
  // therefore still shows 6 x 9, and never collapses to the one cell it uses.
  assert(board.bounds.rows === GRID_ROWS && board.bounds.cols === GRID_COLS, `${design.id}: the frame is not the whole 6 x 9`);
  let widestCol = -1;
  for (const cell of board.cells) if (cell.col > widestCol) widestCol = cell.col;
  const impliedByCells = widestCol < 0 ? 0 : Math.max(0, widestCol + 1 - CORE_COLS);
  assert(board.minChambers === impliedByCells, `${design.id}: claims ${board.minChambers} chambers, the cells imply ${impliedByCells}`);
}
console.log(`board: ${designs.length} designs, ${checkedCells} cells, every cell positioned and named`);

// ---------------------------------------------------------------------------
// 3. The params a cell displays are the params the simulation runs with
// ---------------------------------------------------------------------------

// `codeDefaults` is the difference between a cell that shows its constructor-derived threshold
// and one that shows the bare 9000 field initialiser. A coolant cell that omits `a` must read
// back as 22000-ish, never 9000, or the Inspect panel would lie about automation.
const withDefaults = describeBoard(designs[0].code, catalog);
const withoutDefaults = decodeCode(designs[0].code, { defaults: [] });
let differs = 0;
for (let index = 0; index < CELL_COUNT; index++) {
  const a = withDefaults.cells.find((cell) => cell.index === index);
  const b = withoutDefaults.design.cells[index];
  if (a === null || b === null) continue;
  if (a.automationThreshold !== b.automationThreshold) differs++;
}
console.log(`defaults table: ${differs} cells read a different threshold without codeDefaults`);

// ---------------------------------------------------------------------------
// 4. An unreadable code says so, in Java's words
// ---------------------------------------------------------------------------

const bad = describeBoard('not a reactor code!!', catalog);
assert(bad.ok === false, 'a garbage code decoded');
assert(bad.title === 'Invalid reactor code', `unexpected failure title: ${bad.title}`);
assert(bad.message.includes('not a reactor code'), `unexpected failure message: ${bad.message}`);

const empty = describeBoard('', catalog);
assert(empty.ok && empty.filled === 0, 'an empty code is not an empty board');
console.log('codes: garbage rejected with the Java message, empty accepted as an empty board');

console.log('board: all checks pass');
