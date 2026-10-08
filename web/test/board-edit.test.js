/**
 * Stage 4's board editing, verified without a browser.
 *
 * The claim under test is that a tap produces a *code*, and that code re-reads to the design the
 * tap intended. That matters because the design is the code string: an edit that only lived in the
 * page would be a second representation of a reactor the desktop reads differently. The corpus
 * supplies the starting designs, so the shapes exercised are real ones — including the designs
 * whose cells carry non-default automation parameters, which is where a wrong per-component default
 * would show up as an extra flag bit in the code.
 *
 * Run: `node web/test/board-edit.test.js`
 *
 * @see web/ui/board-edit.js, testResources/corpus-designs.json
 */

import { readFile, readdir } from 'node:fs/promises';
import { parseCatalog, createComponent, getComponentCount } from '../engine/components.js';
import { loadBundle, getI18n } from '../engine/i18n.js';
import { decodeCode } from '../engine/reactor-code.js';
import { codeDefaults } from '../engine/automation-simulator.js';
import { clearCell, placeComponent, pickUp, writeCode, readDesign, copyDesign } from '../ui/board-edit.js';
import { CELL_COUNT } from '../data/bounds.js';

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));
const designs = JSON.parse(await readFile('testResources/corpus-designs.json', 'utf8')).designs;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filled(design) {
  return design.cells.map((cell, index) => cell === null ? null : { index, cell })
    .filter((entry) => entry !== null);
}

function ids(design) {
  return design.cells.filter((cell) => cell !== null).map((cell) => cell.id).sort();
}

// ---------------------------------------------------------------------------
// 1. Clear: one component out, and the code says so
// ---------------------------------------------------------------------------

let cleared = 0;
for (const entry of designs) {
  const start = readDesign(entry.code, catalog);
  assert(start.ok, `a corpus design no longer reads: ${entry.id}`);
  const design = start.design;

  const before = filled(design);
  if (before.length === 0) continue;
  const target = before[0];
  const beforeIds = ids(copyDesign(design));

  const edit = clearCell(design, target.index);
  assert(edit.ok, `clearing a filled cell was refused: ${edit.message}`);
  const written = writeCode(edit.design, catalog);
  assert(written.ok, `a cleared design could not be written: ${written.message}`);

  const back = readDesign(written.code, catalog);
  assert(back.ok, `the cleared design's code does not read back: ${entry.id}`);
  assert(filled(back.design).length === before.length - 1,
    `clearing ${entry.id} left ${filled(back.design).length} cells, expected ${before.length - 1}`);
  const expected = [...beforeIds];
  expected.splice(expected.indexOf(target.cell.id), 1);
  assert(ids(back.design).join(',') === expected.sort().join(','),
    `clearing ${entry.id} at row ${Math.floor(target.index / 9)} changed the wrong component`);
  cleared++;
}
assert(cleared > 0, 'no corpus design had a component to clear');
console.log(`clear: ${cleared} designs lost one component and still read back`);

// ---------------------------------------------------------------------------
// 2. Place: a base component into an empty cell, at that component's own defaults
// ---------------------------------------------------------------------------

const baseIds = [];
for (let id = 1; id <= getComponentCount(catalog); id++) {
  const component = createComponent(catalog, id);
  if (component !== null && component.sourceMod === null) baseIds.push(id);
}
assert(baseIds.length === 26, `the catalog has ${baseIds.length} base components, expected 26`);

let placed = 0;
for (const entry of designs) {
  const design = readDesign(entry.code, catalog).design;
  const empty = design.cells.findIndex((cell) => cell === null);
  if (empty < 0) continue;

  const id = baseIds[placed % baseIds.length];
  const component = createComponent(catalog, id);
  const beforeCount = filled(copyDesign(design)).length;
  const edit = placeComponent(design, empty, id, catalog);
  assert(edit.ok, `placing ${id} was refused: ${edit.message}`);
  const written = writeCode(edit.design, catalog);
  assert(written.ok, `a placed component could not be written: ${written.message}`);

  const back = readDesign(written.code, catalog).design;
  assert(filled(back).length === beforeCount + 1, 'the placed component is not in the code');
  const cell = back.cells[empty];
  assert(cell !== null && cell.id === id, `the placed cell holds ${cell?.id}, expected ${id}`);
  assert(cell.initialHeat === 0, `a fresh placement carries heat: ${cell.initialHeat}`);
  assert(cell.automationThreshold === component.automationThreshold && cell.reactorPause === component.reactorPause,
    `the placed ${id} carries defaults the catalog does not give it`);
  placed++;
}
assert(placed > 0, 'every design was already full');
console.log(`place: ${placed} fresh components carry the catalog's own defaults`);

// ---------------------------------------------------------------------------
// 3. Pick: the three settings come across exactly, and placing them keeps them
// ---------------------------------------------------------------------------

let picked = 0;
let nonDefault = 0;
for (const entry of designs) {
  const design = readDesign(entry.code, catalog).design;
  const used = filled(design);
  if (used.length === 0) continue;

  const source = used[0];
  const beforePick = filled(copyDesign(design)).length;
  const got = pickUp(design, source.index);
  assert(got.ok, `picking a filled cell was refused: ${got.message}`);
  assert(got.id === source.cell.id, 'Pick read a different component than the cell holds');
  assert(got.params.initialHeat === source.cell.initialHeat, 'Pick lost the initial heat');
  assert(got.params.automationThreshold === source.cell.automationThreshold, 'Pick lost the threshold');
  assert(got.params.reactorPause === source.cell.reactorPause, 'Pick lost the pause');
  assert(filled(copyDesign(design)).length === beforePick, 'Pick moved something it should only read');

  const empty = design.cells.findIndex((cell) => cell === null);
  if (empty >= 0) {
    const edit = placeComponent(design, empty, got.id, catalog, got.params);
    assert(edit.ok, `placing the picked component was refused: ${edit.message}`);
    const written = writeCode(edit.design, catalog);
    assert(written.ok, `the picked settings could not be written: ${written.message}`);
    const back = readDesign(written.code, catalog).design;
    const cell = back.cells[empty];
    assert(cell.id === got.id && cell.initialHeat === got.params.initialHeat
      && cell.automationThreshold === got.params.automationThreshold && cell.reactorPause === got.params.reactorPause,
      `the picked settings did not survive the code (${JSON.stringify(cell)})`);
  }

  if (source.cell.initialHeat > 0) nonDefault++;
  picked++;
}
console.log(`pick: ${picked} cells read, ${nonDefault} of them carrying a non-default initial heat`);

// ---------------------------------------------------------------------------
// 4. The refusals, and the one failure that is not a refusal
// ---------------------------------------------------------------------------

const emptyDesign = readDesign('', catalog).design;
assert(!clearCell(emptyDesign, 0).ok, 'clearing an empty cell claimed to work');
assert(clearCell(emptyDesign, -1).ok === false, 'an index off the board was accepted');
assert(clearCell(emptyDesign, CELL_COUNT).ok === false, 'the cell past the board was accepted');
assert(!pickUp(emptyDesign, 0).ok, 'Pick invented a component for an empty cell');
assert(!placeComponent(emptyDesign, 0, 0, catalog).ok, 'id 0 is not a component and was accepted');
assert(!placeComponent(emptyDesign, 0, 9999, catalog).ok, 'an id this catalog lacks was accepted');

// A heat above what a code can store is a RangeError inside the encoder; the page must see a
// message rather than an uncaught throw.
const hot = readDesign('', catalog).design;
const hotEdit = placeComponent(hot, 0, baseIds[0], catalog, { initialHeat: 10 ** 12 });
const hotCode = writeCode(hotEdit.design, catalog);
assert(!hotCode.ok, `a heat no code can hold was written anyway: ${hotCode.code}`);
assert(hotCode.message.includes('reactor code'), 'the refusal says nothing useful');

// Clearing the whole board is the empty design, which is what an emptied textarea means.
const full = readDesign(designs[0].code, catalog).design;
for (let index = 0; index < CELL_COUNT; index++) clearCell(full, index);
const emptied = writeCode(full, catalog);
assert(emptied.ok, 'an emptied board could not be written back');
assert(filled(readDesign(emptied.code, catalog).design).length === 0, 'the emptied board still holds components');

console.log(`refusals: empty cell, off-board index, unknown id, unstorable heat — all reported, none thrown`);
