/**
 * Stage 4's page glue, executed under a shim DOM.
 *
 * The point is not to render the page -- a browser does that, and this file cannot. The point is
 * that the glue runs against the real engine and the real catalog, and that the DOM it builds
 * matches the decoded design: right number of slots, one `<img>` per filled cell, the icon and
 * name the catalog gives that component id, and the `--cell`/`--cols` the stylesheet reads.
 *
 * Run with a code to draw, e.g.
 *   ERP_CODE="$(node -e '...' )" node web/test/page.test.js
 * With no `ERP_CODE` the page is exercised on the empty board, which is a legitimate state.
 *
 * @see web/ui/app.js, web/test/page-shim.js
 */

import './page-shim.js';
import { pasteCode } from '../ui/app.js';
import { parseCatalog, getComponentCount } from '../engine/components.js';
import { describeBoard, CORE_COLS } from '../ui/board.js';
import { GRID_ROWS, GRID_COLS } from '../data/bounds.js';
import { codeDefaults } from '../engine/automation-simulator.js';
import { simulate } from '../ui/inspect.js';
import { componentToString } from '../engine/automation-simulator.js';
import { getI18n, formatI18n } from '../engine/i18n.js';
import { stringFormat } from '../engine/format.js';
import { shoppingList } from '../ui/materials.js';
import { temperatureEffects } from '../ui/heat.js';
import { maxHeatLabel, PULSE_DURATION_RANGE, PULSE_TEMP_RANGE, TICK_LIMIT_RANGE, INITIAL_HEAT_RANGE } from '../ui/config.js';
import { componentList } from '../ui/component-list.js';
import { runMarks } from '../ui/run-grid.js';
import { defaultDesign } from '../engine/reactor-code.js';
import { readFile } from 'node:fs/promises';

const code = process.env.ERP_CODE ?? '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
const pageSource = await readFile('web/ui/index.html', 'utf8');
// The page strips a paste's wrapping before it decodes (`pasteCode`, the desktop's paste button), so
// the expected board is the decoded stripped code -- and the test then checks the page did the same.
const board = describeBoard(pasteCode(code), catalog);
const total = getComponentCount(catalog);

const boardElement = globalThis.PAGE.registry.get('board');
const errorElement = globalThis.PAGE.registry.get('error');
const headerElement = globalThis.PAGE.registry.get('design');

for (const id of ['code', 'board', 'error', 'chambers', 'runlegend']) {
  assert(globalThis.PAGE.lookedUp.includes(id), `the page never looked up #${id}, which the stylesheet styles`);
}

if (!board.ok) {
  assert(errorElement.textContent !== '', 'an unreadable code left no message behind');
  assert(errorElement.textContent.includes(board.message), 'the message shown is not the decoder message');
  console.log(`page: rejected ${code.slice(0, 24)} with ${errorElement.textContent}`);
} else {
  checkValidBoard();
}

function checkValidBoard() {
assert(errorElement.textContent === '', 'a valid code also raised an error');
assert(boardElement.kids.length === board.bounds.rows * board.bounds.cols,
  `the page drew ${boardElement.kids.length} slots for a ${board.bounds.rows} x ${board.bounds.cols} board`);
assert(boardElement.props.get('--cols') === String(board.bounds.cols), 'the stylesheet grid does not match the board');
assert(boardElement.props.has('--cell'), 'no cell size was set');
// The frame is always the whole 6 x 9, whatever the design uses: the game opens columns one
// Reactor Chamber at a time and the ones it has not opened are drawn and crossed rather than left
// out, so the page never hands a visitor a smaller board than the reactor can grow to.
assert(board.bounds.rows === GRID_ROWS && board.bounds.cols === GRID_COLS, 'the frame is not the whole 6 x 9');
const lockedSlots = boardElement.kids.filter((slot) => slot.attributes.has('data-locked'));
assert(lockedSlots.length === (GRID_COLS - CORE_COLS - board.minChambers) * GRID_ROWS,
  `${board.minChambers} chambers crossed ${lockedSlots.length} cells, expected ${(GRID_COLS - CORE_COLS - board.minChambers) * GRID_ROWS}`);
assert(lockedSlots.length + (CORE_COLS + board.minChambers) * GRID_ROWS === boardElement.kids.length,
  'the crossed and open columns do not add up to the frame');

const images = boardElement.kids.filter((slot) => slot.kids.length > 0);
assert(images.length === board.filled, `${board.filled} components decoded, ${images.length} icons drawn`);

for (let i = 0; i < images.length; i++) {
  const img = images[i].kids[0];
  const cell = board.cells[i];
  assert(img.attributes.get('alt') === cell.name, `slot ${i} is labelled ${img.attributes.get('alt')}, expected ${cell.name}`);
  assert(img.attributes.get('src') === cell.icon, `slot ${i} shows the wrong icon`);
  assert(images[i].attributes.has('data-kind'), 'a filled slot carries no component class');
  assert(images[i].attributes.get('data-kind') === cell.kind, `slot ${i} claims the wrong class`);
}

const emptySlots = boardElement.kids.filter((slot) => slot.kids.length === 0);
assert(emptySlots.length === board.bounds.rows * board.bounds.cols - board.filled, 'empty slots miscounted');
for (const slot of emptySlots) assert(slot.attributes.has('data-empty'), 'an empty slot is unstyled');

// ---------------------------------------------------------------------------
// The header and the preference
// ---------------------------------------------------------------------------

assert(globalThis.PAGE.lookedUp.includes('design'), 'the header was never touched');
const chips = headerElement.kids;
const expectedFlags = [board.design.pulsed, board.design.automated, board.design.fluid, board.design.injectors]
  .filter((value) => value).length;
assert(chips.length === expectedFlags, `the header shows ${chips.length} flags, the design has ${expectedFlags}`);
for (const chip of chips) assert(chip.textContent !== '', 'a flag chip rendered empty (missing i18n key)');

if (code !== '') {
  assert(globalThis.PAGE.storage.blob !== null, 'a loaded code was not remembered');
  const stored = JSON.parse(globalThis.PAGE.storage.blob);
  assert(stored.lastCode === pasteCode(code),
    'the remembered code is not the code drawn — a paste that carried wrapping is remembered stripped, which is what was drawn');
  for (const key of Object.keys(stored)) assert(['lastCode', 'gtVersion', 'modPackFilter', 'chambers', 'showOldStyleReactorCode'].includes(key),
    `storage holds a key the preferences decision did not allow: ${key}`);
}

// ---------------------------------------------------------------------------
// The palette drawer: the chips the page authors, and the entries the filters leave
// ---------------------------------------------------------------------------

const modesElement = globalThis.PAGE.registry.get('modes');
const drawer = globalThis.PAGE.registry.get('palette');
assert(globalThis.PAGE.lookedUp.includes('modes'), 'the mode chips were never touched');
assert(modesElement.kids.length === 10, `the page authored ${modesElement.kids.length} mode chips, ten do something`);
assert(globalThis.PAGE.lookedUp.includes('automation'), 'the page never looked up #automation, which the stylesheet styles');
assert(globalThis.PAGE.lookedUp.includes('config'), 'the page never looked up #config, which the stylesheet styles');
assert(globalThis.PAGE.lookedUp.includes('components'), 'the page never looked up #components, which the stylesheet styles');
assert(globalThis.PAGE.lookedUp.includes('comparison'),
  'the page never looked up #comparison, which is where the desktop\'s updateComparison label lives');
const compareChip = modesElement.querySelector('[data-mode="Compare"]');
assert(compareChip !== null, 'the page has no Compare chip, which is where updateComparison lives');
assert(globalThis.PAGE.registry.get('comparison').hidden === true,
  'the comparison panel stayed open while Place is the lit chip');
const place = modesElement.querySelector('[data-mode="Place"]');
assert(place !== null && place.hasAttribute('data-active'), 'Place is authored active and the page lost it');
assert(drawer.hidden === false, 'the drawer stayed closed while Place is active');

const filters = drawer.firstElementChild;
assert(filters !== null && filters.hasAttribute('data-filters'), 'the filter chips were never built');
const classChips = filters.children.filter((chip) => chip.getAttribute('data-axis') === 'class');
const modChips = filters.children.filter((chip) => chip.getAttribute('data-axis') === 'mod');
assert(modChips.length === 1, `the page offers ${modChips.length} availability toggles`);
assert(classChips.length === 9, `the page offered ${classChips.length} class filters, the catalog has 9`);
for (const chip of classChips) assert(!chip.hasAttribute('data-off'), 'a class filter starts off');

const entries = drawer.querySelector('[data-entries]');
assert(entries !== null, 'the drawer has no entry list');
assert(entries.hasAttribute('data-entries'), 'the drawer has no entry list');
const shown = entries.children.filter((kid) => kid.tag === 'div');
assert(shown.length === total, `the drawer shows ${shown.length} components, the catalog has ${total}`);
assert(entries.getAttribute('data-count') === String(shown.length), 'the visible count disagrees with the entries');
for (const chip of shown) {
  assert(chip.hasAttribute('data-id') && chip.hasAttribute('data-kind'), 'an entry is missing its axes');
  const icon = chip.kids[0];
  assert(icon.tag === 'img' && icon.attributes.get('src').startsWith('../assets/icons/'), 'an entry has no icon');
}

// The availability toggle is the prefs key the preferences decision allows; the class filter is a
// viewing aid and must never reach storage.
assert(globalThis.PAGE.storage.blob !== null, 'the palette wrote no preference');
const prefs = JSON.parse(globalThis.PAGE.storage.blob);
assert(prefs.modPackFilter === 'all', 'an untouched toggle stored something other than the whole catalog');
for (const key of Object.keys(prefs)) assert(['lastCode', 'gtVersion', 'modPackFilter'].includes(key),
  `storage holds a key the preferences decision did not allow: ${key}`);

// ---------------------------------------------------------------------------
// Editing: a tap changes the design, and the design goes back as a code
// ---------------------------------------------------------------------------

// The claim is that the textarea is the design throughout: a tap re-encodes, and the code that
// comes back is what the desktop would read. `board-edit.test.js` proves the engine half; this
// proves the page actually calls it, and calls it with the chip the visitor lit.
const click = globalThis.PAGE.click;
const type = globalThis.PAGE.type;

/** A finger lands on the icon when a cell or an entry has one, and on the bare cell when it does
 * not. That is what a real tap aims at, and it is why `app.js` resolves a tap by walking up from
 * `event.target` rather than reading the target itself: a handler that read the target would answer
 * a tap on the padding and ignore a tap on the thing the visitor aimed at. */
function tap(node) {
  const icon = node.children.find((kid) => kid.tag === 'img');
  click(icon ?? node);
}
const textarea = globalThis.PAGE.registry.get('code');
const placingLine = drawer.querySelector('[data-placing]');
assert(placingLine !== null, 'the drawer has no placing line');
assert(placingLine.textContent === getI18n('UI.ComponentPlacingDefault'), 'the line starts somewhere other than None');

const entry = shown[0];
tap(entry);
assert(entry.hasAttribute('data-selected'), 'selecting an entry left no mark on it');
for (const other of shown) {
  if (other !== entry) assert(!other.hasAttribute('data-selected'), 'selecting an entry left two entries selected');
}
const entryName = entry.kids.find((kid) => kid.text !== undefined)?.text ?? '';
assert(placingLine.textContent === getI18n('UI.ComponentPlacingSpecific').replace('%s', entryName),
  `the placing line reads ${placingLine.textContent}, expected ${entryName}`);

const emptySlot = boardElement.kids.find((slot) => slot.attributes.has('data-empty'));
assert(emptySlot !== undefined && emptySlot !== null, 'the board was full, so there was nothing to place into');
const index = Number(emptySlot.attributes.get('data-index'));
click(emptySlot);

assert(textarea.value !== code, 'placing a component left the textarea alone');
const placed = describeBoard(textarea.value, catalog);
assert(placed.ok, `the code the page wrote back does not read: ${placed.message}`);
assert(placed.filled === board.filled + 1, `the tap changed ${placed.filled - board.filled} cells, expected one`);
const placedCell = placed.cells.find((cell) => cell.index === index);
assert(placedCell !== undefined && placedCell.id === Number(entry.attributes.get('data-id')),
  `the tap filled row ${Math.floor(index / 9)} column ${index % 9} with something other than the selected entry`);
assert(placedCell.initialHeat === 0, 'a placed component arrived with heat');
const touched = boardElement.kids.find((slot) => Number(slot.attributes.get('data-index')) === index);
assert(touched !== undefined && touched.kids.length === 1 && touched.hasAttribute('data-touched'),
  'the placed component is not on the redrawn board');
const placedCode = textarea.value;

// Pick first, while the board still holds the component the tap just put there.
const pickChip = modesElement.querySelector('[data-mode="Pick"]');
click(pickChip);
assert(pickChip.hasAttribute('data-active'), 'Pick stayed unlit');
assert(!place.hasAttribute('data-active'), 'two mode chips are lit at once');
assert(drawer.hidden === true, 'the drawer stayed open in Pick mode');
const source = boardElement.kids.find((slot) => Number(slot.attributes.get('data-index')) === index);
assert(source !== undefined && source.kids.length === 1, 'the placed component is not on the board to pick up');
tap(source);
assert(textarea.value === placedCode, 'Pick changed the design; it is meant to only read one');
const pickedName = source.kids[0].attributes.get('alt');
assert(placingLine.textContent === getI18n('UI.ComponentPlacingSpecific').replace('%s', pickedName),
  `Pick left the line reading ${placingLine.textContent}, expected ${pickedName}`);

const clearChip = modesElement.querySelector('[data-mode="Clear"]');
click(clearChip);
assert(clearChip.hasAttribute('data-active'), 'Clear stayed unlit');
assert(!pickChip.hasAttribute('data-active'), 'two mode chips are lit at once');

tap(source);
const back = describeBoard(textarea.value, catalog);
assert(back.ok, `the cleared design's code does not read: ${back.message}`);
assert(back.filled === board.filled, 'clearing a fresh placement left an extra component behind');
assert(back.cells.map((cell) => `${cell.index}:${cell.id}`).join(',') === board.cells.map((cell) => `${cell.index}:${cell.id}`).join(','),
  'clearing changed a different cell than the tap aimed at');
assert(errorElement.textContent === '', 'a tap that worked still left a message');
const clearedCode = textarea.value;

// A refusal is the engine's message, and the design must not move.
click(clearChip);
const stillEmpty = boardElement.kids.find((slot) => slot.attributes.has('data-empty'));
assert(stillEmpty !== undefined && stillEmpty !== null, 'the board was full, so there was nothing to refuse');
click(stillEmpty);
assert(errorElement.textContent.includes('already empty'), `clearing an empty cell said: ${errorElement.textContent}`);
assert(textarea.value === clearedCode, 'a refused tap changed the design');
assert(JSON.parse(globalThis.PAGE.storage.blob).lastCode === clearedCode, 'a refused tap changed what is remembered');

// ---------------------------------------------------------------------------
// Inspect: the readout belongs to a finished run, and a tap leaves the design alone
// ---------------------------------------------------------------------------

// The claim is the page's half of the same sentence `inspect.test.js` asserts against the run: the
// popover holds what the desktop's info button would have set, for the cell under the finger, and
// nothing about the design moved. The expected text is built here from the run's own `component.info`
// rather than taken from `inspectCell`, so a reader that picked the wrong cell fails.
const inspectChip = modesElement.querySelector('[data-mode="Inspect"]');
assert(inspectChip !== null, 'the page has no Inspect chip to light');
click(inspectChip);
assert(inspectChip.hasAttribute('data-active'), 'Inspect stayed unlit');
assert(!clearChip.hasAttribute('data-active'), 'two mode chips are lit at once');
assert(drawer.hidden === true, 'the drawer stayed open in Inspect mode');

let readout = null;
const filledSlot = boardElement.kids.find((slot) => slot.kids.some((kid) => kid.tag === 'img'));
if (filledSlot !== undefined && filledSlot !== null) {
  const seen = Number(filledSlot.attributes.get('data-index'));
  tap(filledSlot);

  const popovers = boardElement.kids.filter((slot) => slot.kids.some((kid) => kid.hasAttribute('data-inspect')));
  assert(popovers.length === 1, `${popovers.length} readouts are on the board, one tap asked for one`);
  assert(popovers[0] === filledSlot, 'the readout is on a different cell than the tap aimed at');

  const run = simulate(textarea.value, catalog);
  assert(run.ok, `the code the page holds does not run: ${run.message}`);
  const row = Math.floor(seen / 9);
  const col = seen % 9;
  const component = run.run.reactor.getComponentAt(row, col);
  assert(component !== null, `the board shows a cell the run does not have: row ${row} column ${col}`);
  const popover = popovers[0].kids.find((kid) => kid.hasAttribute('data-inspect'));
  assert(popover.textContent === formatI18n('UI.ComponentInfoLastSimRowCol', componentToString(component), row, col, component.info.join('')),
    `the readout for row ${row} column ${col} is not the desktop's sentence: ${popover.textContent}`);
  assert(textarea.value === clearedCode, 'Inspect changed the design; it is meant to only read one');
  assert(JSON.parse(globalThis.PAGE.storage.blob).lastCode === clearedCode, 'Inspect changed what is remembered');
  assert(errorElement.textContent === '', 'a readout that worked still left a message');
  readout = popover.textContent;
}

// The other branch of the info button: a cell the run left empty, which every board has room for.
const bareSlot = boardElement.kids.find((slot) => slot.hasAttribute('data-empty'));
assert(bareSlot !== undefined && bareSlot !== null, 'the board was full, so there was nothing to refuse');
const bare = Number(bareSlot.attributes.get('data-index'));
const before = boardElement.kids.filter((slot) => slot.kids.some((kid) => kid.hasAttribute('data-inspect'))).length;
click(bareSlot);
assert(errorElement.textContent === formatI18n('UI.NoComponentLastSimRowCol', Math.floor(bare / 9), bare % 9),
  `inspecting an empty cell said: ${errorElement.textContent}`);
assert(boardElement.kids.filter((slot) => slot.kids.some((kid) => kid.hasAttribute('data-inspect'))).length === before,
  'a refused readout changed the popovers on the board');
assert(textarea.value === clearedCode, 'a refused readout changed the design');

// ---------------------------------------------------------------------------
// Automate: the panel names the cell the finger aimed at, and a typed number goes back through the code
// ---------------------------------------------------------------------------

// The claim is the page's half of `automate.test.js`'s sentence: lighting the chip opens a panel of
// bundle lines, a tap fills it with the cell under the finger, and typing a number writes it into the
// code. The expected label is rebuilt from the board's own icon `alt` and the decoded design's heat,
// a different route than `openAutomationPanel` takes.
const automateChip = modesElement.querySelector('[data-mode="Automate"]');
assert(automateChip !== null, 'the page has no Automate chip to light');
const automationElement = globalThis.PAGE.registry.get('automation');
click(automateChip);
assert(automateChip.hasAttribute('data-active'), 'Automate stayed unlit');
assert(!inspectChip.hasAttribute('data-active'), 'two mode chips are lit at once');
assert(drawer.hidden === true, 'the drawer stayed open in Automate mode');
assert(automationElement.hidden === false, 'the automation panel stayed closed under its lit chip');

const chosenLine = automationElement.kids.find((kid) => kid.hasAttribute('data-chosen'));
assert(chosenLine !== undefined && chosenLine !== null, 'the automation panel has no label line');
assert(chosenLine.textContent === getI18n('Config.NoComponentSelected'),
  `the panel opens reading ${chosenLine.textContent}, the desktop opens it at ${getI18n('Config.NoComponentSelected')}`);
const thresholdField = automationElement.kids.find((kid) => kid.tag === 'input' && kid.attributes.get('data-field') === 'threshold');
const pauseField = automationElement.kids.find((kid) => kid.tag === 'input' && kid.attributes.get('data-field') === 'pause');
assert(thresholdField !== undefined && thresholdField !== null && pauseField !== undefined && pauseField !== null,
  'the automation panel has no two fields to type into');
assert(automationElement.kids.some((kid) => kid.hasAttribute('data-toggle')),
  'the automation panel has no automated-reactor checkbox');

const autoSlot = boardElement.kids.find((slot) => slot.kids.some((kid) => kid.tag === 'img'));
if (!autoSlot) console.log('page: an empty board has nothing to automate');
else checkAutomation(autoSlot);

/** The cell-dependent half: the panel names the cell, and a typed number goes back through the code. */
function checkAutomation(autoSlot) {
  const autoIndex = Number(autoSlot.attributes.get('data-index'));
  const autoRow = Math.floor(autoIndex / 9);
  const autoCol = autoIndex % 9;
  tap(autoSlot);

  const decoded = describeBoard(textarea.value, catalog);
  assert(decoded.ok, `the code the page holds does not read: ${decoded.message}`);
  const autoCell = decoded.design.cells[autoIndex];
  assert(autoCell !== null, `the board shows a cell the design does not have: row ${autoRow} column ${autoCol}`);
  const heatSuffix = autoCell.initialHeat > 0 ? stringFormat(getI18n('UI.InitialHeatDisplay'), Math.trunc(autoCell.initialHeat)) : '';
  assert(chosenLine.textContent === formatI18n('UI.ChosenComponentRowCol', `${autoSlot.kids[0].attributes.get('alt')}${heatSuffix}`, autoRow, autoCol),
    `the panel for row ${autoRow} column ${autoCol} reads ${chosenLine.textContent}`);
  assert(thresholdField.value === String(autoCell.automationThreshold) && pauseField.value === String(autoCell.reactorPause),
    `the panel shows ${thresholdField.value}/${pauseField.value}, the code carries ${autoCell.automationThreshold}/${autoCell.reactorPause}`);
  assert(textarea.value === clearedCode, 'opening the panel changed the design; opening is meant to read');

  // A cell with nothing in it answers in the desktop's words and leaves the panel where it was.
  const bareAuto = boardElement.kids.find((slot) => slot.hasAttribute('data-empty') && Number(slot.attributes.get('data-index')) !== autoIndex);
  assert(bareAuto !== undefined && bareAuto !== null, 'the board was full, so there was nothing to refuse');
  click(bareAuto);
  assert(errorElement.textContent === formatI18n('UI.NoComponentRowCol', Math.floor(Number(bareAuto.attributes.get('data-index')) / 9), Number(bareAuto.attributes.get('data-index')) % 9),
    `automating an empty cell said: ${errorElement.textContent}`);
  assert(chosenLine.textContent !== getI18n('Config.NoComponentSelected'), 'a refused tap blanked the panel the visitor was reading');
  assert(textarea.value === clearedCode, 'a refused tap changed the design');

  // Typing a number the format can carry. What the code then holds depends on the automated flag, so
  // both branches are asserted, and the sequence is written from the flag the sample happens to carry
  // rather than assuming it: a reactor that is not automated reads the number back as its default --
  // the desktop's own behaviour, and what the visibly-off checkbox is for -- and once the checkbox is
  // on, the same gesture has to land in the code.
  function toggleAutomation(expectedAfter) {
    const toggle = automationElement.kids.find((kid) => kid.tag === 'button' && kid.hasAttribute('data-toggle'));
    assert(toggle !== undefined && toggle !== null, 'the automation panel has no checkbox to toggle');
    click(toggle);
    const after = describeBoard(textarea.value, catalog);
    assert(after.ok, `the toggled code does not read: ${after.message}`);
    assert(after.design.automated === expectedAfter, `toggling the checkbox left the flag at ${after.design.automated}`);
    assert(errorElement.textContent === '', 'a toggle that worked still left a message');
    return after;
  }

  function typeThreshold(value) {
    type(thresholdField, value);
    const after = describeBoard(textarea.value, catalog);
    assert(after.ok, `the typed code does not read: ${after.message}`);
    assert(chosenLine.textContent !== getI18n('Config.NoComponentSelected'), 'typing moved the panel off the selected cell');
    assert(errorElement.textContent === '', 'a typed number that worked still left a message');
    return after;
  }

  const wantedThreshold = autoCell.automationThreshold + 1000;
  let state = decoded;
  if (state.design.automated) state = toggleAutomation(false); // start from a reactor that cannot carry one

  const dropped = typeThreshold(wantedThreshold);
  const droppedCell = dropped.design.cells[autoIndex];
  assert(droppedCell !== null, 'the typed code lost the component the panel was showing');
  const fallback = codeDefaults(catalog)[droppedCell.id];
  assert(droppedCell.automationThreshold === fallback.automationThreshold,
    `a reactor that is not automated still kept a typed threshold of ${droppedCell.automationThreshold} in the code`);
  assert(thresholdField.value === String(fallback.automationThreshold),
    `the panel kept showing the typed ${wantedThreshold} rather than the ${fallback.automationThreshold} the code holds`);
  assert(automationElement.kids.some((kid) => kid.hasAttribute('data-toggle') && kid.hasAttribute('data-off')),
    'the checkbox stayed lit while the panel refused a typed number the code cannot hold');

  state = toggleAutomation(true);
  const carried = typeThreshold(wantedThreshold + 1);
  assert(carried.design.automated, 'typing a number took the automated flag off');
  const carriedCell = carried.design.cells[autoIndex];
  assert(carriedCell.automationThreshold === wantedThreshold + 1,
    `an automated reactor read back ${carriedCell.automationThreshold} for a typed ${wantedThreshold + 1}`);
  assert(carriedCell.reactorPause === autoCell.reactorPause, 'typing one field changed the other field the panel was showing');
  assert(thresholdField.value === String(wantedThreshold + 1),
    `the panel shows ${thresholdField.value} while the code holds ${carriedCell.automationThreshold}`);
  assert(pauseField.value === String(autoCell.reactorPause),
    `the panel's other field drifted to ${pauseField.value}`);
}

// ---------------------------------------------------------------------------
// Materials: the shopping list for the board, and the two switches that rebuild it
// ---------------------------------------------------------------------------

const materialsPanel = globalThis.PAGE.registry.get('materials');
assert(globalThis.PAGE.lookedUp.includes('materials'), 'the page never looked up #materials');
assert(materialsPanel.hidden === true, 'the materials panel stayed open with Place lit; only the lit chip opens a panel');

const materialsChip = modesElement.querySelector('[data-mode="Materials"]');
assert(materialsChip !== null, 'the page has no Materials chip to light');
click(materialsChip);
assert(materialsPanel.hidden === false, 'lighting Materials left the panel closed');
assert(drawer.hidden === true, 'the drawer stayed open in Materials mode');

const caption = materialsPanel.firstElementChild;
assert(caption.hasAttribute('data-caption') && caption.textContent === getI18n('UI.MaterialsTab'),
  `the panel's caption reads ${caption.textContent}, the bundle's UI.MaterialsTab reads ${getI18n('UI.MaterialsTab')}`);

// The combo the desktop had, not a dropdown: four items, one lit, and the labels are the bundle's
// "None" plus the three strings the combo's model spelled out.
const gtRow = materialsPanel.querySelector('[data-gt-row]');
assert(gtRow !== null, 'the panel has no GregTech row');
const gtChips = gtRow.children.filter((chip) => chip.hasAttribute('data-gt'));
assert(gtChips.map((chip) => chip.getAttribute('data-gt')).join(',') === 'none,5.08,5.09,GTNH',
  `the combo's items are ${gtChips.map((chip) => chip.getAttribute('data-gt')).join(',')}, the desktop's are none,5.08,5.09,GTNH`);
const litAtLoad = gtChips.filter((chip) => chip.hasAttribute('data-active'));
assert(litAtLoad.length === 1 && litAtLoad[0].getAttribute('data-gt') === 'none',
  `${litAtLoad.length} GregTech chips are lit at load; exactly one is, and it is None`);

const alloyRow = materialsPanel.querySelector('[data-alloy-row]');
assert(alloyRow !== null, 'the panel has no expand-alloy row');
const alloyToggle = alloyRow.children.find((chip) => chip.hasAttribute('data-alloy'));
assert(alloyToggle !== undefined && alloyToggle !== null && alloyToggle.hasAttribute('data-off'),
  'the expand-alloy toggle is missing, or starts on; the desktop’s checkbox starts unchecked');

// The engine's list is pinned against the Java dump by `materials.test.js`; the claim here is only
// that the panel shows that same string for the board the page is holding, less the trailing newline
// the engine's `toString()` writes and a `pre-wrap` box would show as a blank line.
const listElement = materialsPanel.querySelector('[data-list]');
assert(listElement !== null, 'the panel has no list');
const current = describeBoard(textarea.value, catalog);
assert(current.ok, `the field's code does not read: ${current.message}`);
const plainList = shoppingList(current.design, catalog).replace(/\n$/, '');
assert(listElement.textContent === plainList, `the panel reads ${listElement.textContent}, expected ${plainList}`);
assert(plainList.includes('Advanced Alloy'), 'the sample design has plating, so its alloy must be listed');

click(gtChips[2]);
assert(gtChips[2].hasAttribute('data-active'), 'clicking 5.09 left it unlit');
assert(gtChips.filter((chip) => chip.hasAttribute('data-active')).length === 1, 'two GregTech versions are lit at once');
assert(JSON.parse(globalThis.PAGE.storage.blob).gtVersion === '5.09', 'a version click stored something other than 5.09');
const afterGt = listElement.textContent;
// 5.08 and 5.09 are the two versions the recipe table reads (`MaterialsList.java:240-269` swaps the
// reflector, the vent and the containment plate); GTNH is not asserted here because it changes the
// rods’ behaviour and not one material, which is the same reason the desktop’s combo tooltip gives
// the two effects separately.
assert(afterGt !== plainList, 'a GregTech version changed the recipes; the list stayed the same');
assert(afterGt.includes('Beryllium'), `the 5.09 list is missing the reflector’s beryllium: ${afterGt}`);

click(gtChips[0]);
assert(gtChips[0].hasAttribute('data-active'), 'clicking None left it unlit');
assert(listElement.textContent === plainList, 'going back to None left the list at the 5.09 recipes');
assert(JSON.parse(globalThis.PAGE.storage.blob).gtVersion === 'none', 'going back to None stored something else');

click(alloyToggle);
assert(!alloyToggle.hasAttribute('data-off'), 'the toggle stayed off');
const expanded = listElement.textContent;
assert(!expanded.includes('Advanced Alloy') && expanded.includes('Bronze'),
  `expanding alloy left the alloy line in (${expanded.includes('Advanced Alloy')}) and no bronze line (${expanded.includes('Bronze')})`);
click(alloyToggle);
assert(alloyToggle.hasAttribute('data-off'), 'a second click did not put the checkbox back');
assert(listElement.textContent === plainList, 'the second click left the list somewhere else');

// ---------------------------------------------------------------------------
// A window resize, and the one thing on the page that is not the design
// ---------------------------------------------------------------------------

// A window resize changes the viewport without changing the design, so nothing else re-runs the
// cell math and the board keeps the size the load made: a page opened in a small window stayed a
// fifth of the width it should be on a monitor. The claim is that the event the browser fires
// re-sizes the board for the new viewport, and re-sizes only that -- the board is not rebuilt, so
// the icons a visitor has placed stay where they are.
const cellBefore = boardElement.props.get('--cell');
const iconsBeforeResize = boardElement.kids.filter((slot) => slot.kids.length > 0);
const colsBefore = boardElement.props.get('--cols');
globalThis.window.innerWidth = 1798;
globalThis.window.innerHeight = 952;
globalThis.window.dispatchEvent({ type: 'resize' });
const cellAfter = boardElement.props.get('--cell');
assert(cellAfter !== cellBefore, `a resize left the cell at ${cellBefore}; the board kept the size the load made`);
assert(Number(cellAfter.replace('px', '')) % 16 === 0, `a resize set a cell of ${cellAfter}, which is not a whole number of sprite pixels`);
assert(boardElement.kids.filter((slot) => slot.kids.length > 0).every((slot, i) => slot === iconsBeforeResize[i]), 'a resize redrew the icons instead of reusing them');
assert(boardElement.props.get('--cols') === colsBefore, 'a resize changed the column count');

// ---------------------------------------------------------------------------
// Clear Grid: the desktop's button, and the one control that acts without a target
// ---------------------------------------------------------------------------

const clearGridButton = globalThis.PAGE.registry.get('cleargrid');
assert(clearGridButton !== undefined && clearGridButton !== null, 'the page has no Clear Grid button');
// The label is authored in `index.html` and rewritten from the bundle at startup, so both halves
// are checked: the file's words are what an English visitor sees, and the live element's are what
// any locale's bundle answers. The English answers are the authored words, which makes the rewrite
// a no-op for an English visitor (§36).
const authoredClear = /<button id="cleargrid"[^>]*>([^<]*)</.exec(pageSource);
assert(authoredClear !== null && authoredClear[1] === getI18n('UI.ClearGridButton'),
  `the button reads ${authoredClear === null ? 'nothing' : authoredClear[1]}, the bundle's UI.ClearGridButton reads ${getI18n('UI.ClearGridButton')}`);
assert(clearGridButton.textContent === getI18n('UI.ClearGridButton'),
  `the live button reads ${clearGridButton.textContent}, the bundle's UI.ClearGridButton reads ${getI18n('UI.ClearGridButton')}`);

const beforeClear = describeBoard(textarea.value, catalog);
assert(beforeClear.ok, `the field's code does not read before the clear: ${beforeClear.message}`);
const iconsBefore = boardElement.kids.filter((slot) => slot.kids.length > 0).length;
assert(iconsBefore > 0, 'the sample board is empty, so clearing it proves nothing');
const flagsBefore = [beforeClear.design.pulsed, beforeClear.design.automated, beforeClear.design.fluid, beforeClear.design.injectors];
const errorsBeforeClear = errorElement.textContent;
click(clearGridButton);

const afterClear = describeBoard(textarea.value, catalog);
assert(afterClear.ok, `the field the button left does not read: ${afterClear.title}: ${afterClear.message}`);
assert(afterClear.filled === 0, `one click left ${afterClear.filled} components on the board, expected none`);
assert(boardElement.kids.filter((slot) => slot.kids.length > 0).length === 0, 'the redrawn board still shows icons');
assert(boardElement.kids.length === GRID_ROWS * GRID_COLS, 'clearing the grid shrank the frame');
assert(boardElement.kids.filter((slot) => slot.attributes.has('data-locked')).length === lockedSlots.length,
  'clearing the grid moved the chamber gate');
assert(errorElement.textContent === errorsBeforeClear, 'clearing the grid added a message to the strip');
// `Reactor.java:106` walks the grid and touches nothing else, so the reactor-level switches survive
// the click -- which is also why the field keeps the encoded empty design rather than the desktop's
// null: an empty field would decode to defaults and drop them.
const flagsAfter = [afterClear.design.pulsed, afterClear.design.automated, afterClear.design.fluid, afterClear.design.injectors];
assert(JSON.stringify(flagsAfter) === JSON.stringify(flagsBefore),
  `the clear changed the reactor-level switches from ${flagsBefore} to ${flagsAfter}`);
assert(listElement.textContent === shoppingList(afterClear.design, catalog).replace(/\n$/, ''),
  'the materials panel still lists what the emptied reactor does not need');
assert(JSON.parse(globalThis.PAGE.storage.blob).lastCode === textarea.value, 'the cleared code was not what got stored');

// ---------------------------------------------------------------------------
// The chamber gate: columns the game has not opened take nothing
// ---------------------------------------------------------------------------

const chamberPanel = globalThis.PAGE.registry.get('chambers');
assert(chamberPanel !== undefined && chamberPanel !== null, 'the page has no chamber gate');
const chamberInput = chamberPanel.kids.find((kid) => kid.tag === 'input');
assert(chamberInput !== undefined && chamberInput !== null, 'the gate has no input');
assert(chamberInput.attributes.get('min') === '0'
    && chamberInput.attributes.get('max') === String(GRID_COLS - CORE_COLS),
  `the gate offers ${chamberInput.attributes.get('min')} to ${chamberInput.attributes.get('max')}, expected 0 to ${GRID_COLS - CORE_COLS}`);
const chamberLabel = chamberPanel.kids.find((kid) => kid.tag === 'label');
assert(chamberLabel !== undefined && chamberLabel.textContent === 'Reactor Chambers',
  `the gate is labelled ${chamberLabel === undefined ? 'nothing' : chamberLabel.textContent}`);

// The emptied design needs no chamber, so the gate can close all the way and every column past the
// core is crossed.
type(chamberInput, 0);
assert(errorElement.textContent === '', 'a legal chamber count was refused');
assert(boardElement.kids.filter((slot) => slot.attributes.has('data-locked')).length === (GRID_COLS - CORE_COLS) * GRID_ROWS,
  'a closed gate left columns open');

// Past the widest reactor the code can carry is refused in the page's own words, and the spinner is
// put back rather than left showing a number the page ignored.
const typedBack = chamberInput.value;
type(chamberInput, GRID_COLS - CORE_COLS + 1);
assert(errorElement.textContent !== '', 'a chamber count past the grid was accepted');
assert(chamberInput.value === typedBack, 'an out-of-range count left the gate somewhere else');

// A tap in a crossed column takes nothing: the refusal is the gate's, not the decoder's.
const closedSlot = boardElement.kids[GRID_COLS - 1];
click(place);
tap(closedSlot);
assert(errorElement.textContent.includes('no Reactor Chamber'), 'a closed column was not refused by the gate');
assert(describeBoard(textarea.value, catalog).filled === 0, 'a refused tap put something on the board');

// Opening the gate opens the columns, and the same tap now lands.
type(chamberInput, GRID_COLS - CORE_COLS);
assert(boardElement.kids.filter((slot) => slot.attributes.has('data-locked')).length === 0, 'opening the gate left columns crossed');
tap(closedSlot);
assert(describeBoard(textarea.value, catalog).filled === 1, 'an open column still took nothing');

// ---------------------------------------------------------------------------
// The temperature-effects readout and the Simulation panel: the run's own text
// ---------------------------------------------------------------------------

// The readout sits under the frame it describes, so it is filled before any chip is tapped, and it
// agrees with whatever design the field holds rather than with the sample it started from.
const temperaturePanel = globalThis.PAGE.registry.get('temperature');
assert(globalThis.PAGE.lookedUp.includes('temperature'), 'the page never looked up #temperature, which the stylesheet styles');
const effects = temperatureEffects(textarea.value, catalog);
assert(effects.ok, `the readout refused the design the field holds: ${effects.message}`);
const effectsLine = temperaturePanel.querySelector('[data-effects]');
assert(effectsLine !== null, 'the temperature panel has no effects line');
assert(effectsLine.textContent === effects.text,
  `the readout shows ${effectsLine.textContent}, the design's limits say ${effects.text}`);
assert(effects.gates.length === 5 && effects.gates[4] === Math.trunc(effects.maxHeat),
  `the readout's last gate is ${effects.gates[4]}, the reactor's max heat is ${Math.trunc(effects.maxHeat)}`);

// The Simulation panel ships closed like every other panel, and opening it is the desktop's tab:
// the run's report, line by line, in the same order the Swing JTextArea received it.
const simulationPanel = globalThis.PAGE.registry.get('simulation');
assert(globalThis.PAGE.lookedUp.includes('simulation'), 'the page never looked up #simulation, which the stylesheet styles');
assert(simulationPanel.hidden === true, 'the simulation panel stayed open while Place is the lit chip');
const simulationChip = modesElement.querySelector('[data-mode="Simulation"]');
assert(simulationChip !== null, 'the page has no Simulation chip, which is where the desktop\'s outputArea lives');

click(simulationChip);
const simCaption = simulationPanel.querySelector('[data-caption]');
assert(simCaption !== null && simCaption.textContent === getI18n('UI.SimulationTab'),
  `the simulation panel's caption is ${simCaption === null ? 'missing' : simCaption.textContent}, the bundle's tab label is ${getI18n('UI.SimulationTab')}`);
const simLines = simulationPanel.querySelector('[data-lines]');
assert(simLines !== null, 'the simulation panel has no line list');

const expected = simulate(textarea.value, catalog);
assert(expected.ok, `the field's design would not run: ${expected.message}`);
const reportLines = expected.run.report.split('\n');
if (reportLines.length > 0 && reportLines[reportLines.length - 1] === '') reportLines.pop();

// The elapsed-time line is the one line of a report that legitimately differs between two runs of
// the same design, so it is compared for presence here and for content in `corpus.test.js`, which
// strips it before hashing -- the same marker, the same rule.
const elapsedPrefix = getI18n('Simulation.ElapsedTime').split('%')[0];
const expectedRows = reportLines.filter((text) => !text.startsWith(elapsedPrefix));
const reportRows = simLines.kids.filter((row) => !row.textContent.startsWith(elapsedPrefix));
assert(reportRows.length === expectedRows.length,
  `the panel shows ${reportRows.length} lines, the run's report has ${expectedRows.length}`);
for (let at = 0; at < reportRows.length; at += 1) {
  assert(reportRows[at].textContent === expectedRows[at],
    `line ${at} reads ${reportRows[at].textContent}, the run wrote ${expectedRows[at]}`);
}
assert(simLines.kids.some((row) => row.textContent.startsWith(elapsedPrefix)),
  'the panel lost the elapsed-time line, which is the one line a run writes that changes');

// ---------------------------------------------------------------------------
// The Config panel, the Component List panel, and the Simulate button
// ---------------------------------------------------------------------------

/** The shim answers `querySelector` for direct children only, and the configuration panel's
 * controls sit inside row divs, so the test walks the way a browser's selector does. */
function descend(root, attribute, value) {
  const out = [];
  const walk = (node) => {
    for (const kid of node.kids) {
      if (kid.tag === undefined) continue;
      if (kid.attributes.has(attribute) && (value === null || kid.attributes.get(attribute) === value)) out.push(kid);
      walk(kid);
    }
  };
  walk(root);
  return out;
}

const configPanel = globalThis.PAGE.registry.get('config');
assert(configPanel.hidden === true, 'the configuration panel stayed open while Place is the lit chip');

click(modesElement.querySelector('[data-mode="Config"]'));
assert(configPanel.hidden === false, 'the Config chip left the panel closed');

// Whatever the field holds is what the panel must read, not the sample design it started from.
const fieldDesign = describeBoard(textarea.value, catalog);
assert(fieldDesign.ok, `the field's own design would not decode: ${fieldDesign.message}`);

const styleChips = descend(configPanel, 'data-style', null);
assert(styleChips.length === 2, `the panel has ${styleChips.length} style chips, the frame has a radio pair`);
const litStyles = styleChips.filter((chip) => chip.attributes.has('data-active'));
assert(litStyles.length === 1, `the radio pair has ${litStyles.length} lit chips, a radio has one`);
assert(litStyles[0].attributes.get('data-style') === (fieldDesign.design.fluid ? 'fluid' : 'eu'),
  `the lit style chip is ${litStyles[0].attributes.get('data-style')}, the design is ${fieldDesign.design.fluid ? 'fluid' : 'eu'}`);

const flagChips = descend(configPanel, 'data-flag', null);
assert(flagChips.length === 3, `the panel has ${flagChips.length} checkboxes, the frame has three`);
for (const chip of flagChips) {
  const field = chip.attributes.get('data-flag');
  assert(chip.attributes.has('data-off') === !fieldDesign.design[field],
    `${field}'s checkbox reads ${chip.attributes.has('data-off') ? 'off' : 'on'}, the design has ${fieldDesign.design[field]}`);
}

const legacyChip = descend(configPanel, 'data-legacy', null);
assert(legacyChip.length === 1, `the panel has ${legacyChip.length} old-style chips, the frame has one checkbox`);
assert(legacyChip[0].attributes.has('data-off') === true, 'the field started in the current format and the chip says otherwise');

const spinners = descend(configPanel, 'data-field', null).filter((node) => node.tag === 'input');
assert(spinners.length === 2, `the panel has ${spinners.length} spinners, the frame has two before the pulse tab exists`);
for (const spinner of spinners) {
  const field = spinner.attributes.get('data-field');
  const range = field === 'currentHeat' ? INITIAL_HEAT_RANGE : TICK_LIMIT_RANGE;
  assert(spinner.attributes.get('min') === String(range[0]) && spinner.attributes.get('max') === String(range[1]),
    `${field}'s spinner offers ${spinner.attributes.get('min')}..${spinner.attributes.get('max')}, the Swing model is ${range.join('..')}`);
  assert(spinner.value === String(fieldDesign.design[field]),
    `${field}'s spinner reads ${spinner.value}, the design holds ${fieldDesign.design[field]}`);
}

const heatLine = descend(configPanel, 'data-max-heat', null);
assert(heatLine.length === 1, `the panel has ${heatLine.length} max-heat lines, the frame has one label`);
const heat = maxHeatLabel(textarea.value, catalog);
assert(heat.ok, `the max-heat line refused the design the field holds: ${heat.message}`);
assert(heatLine[0].textContent === heat.text, `the line reads ${heatLine[0].textContent}, the design's limit says ${heat.text}`);

// The pulse tab exists only while the pulsed flag is on -- the desktop's `togglePulseConfigTab`
// inserts the Swing tab rather than greying four spinners out.
assert(descend(configPanel, 'data-pulse-row', null).length === 0,
  'the four pulse spinners are showing while the reactor is not pulsed');

const pulsedChip = descend(configPanel, 'data-flag', 'pulsed')[0];
assert(pulsedChip !== undefined, 'the panel has no pulsed checkbox to turn on');
click(pulsedChip);
const pulseRows = descend(configPanel, 'data-pulse-row', null);
assert(pulseRows.length === 4, `the pulse tab has ${pulseRows.length} rows, the Swing panel has four spinners`);
const pulseCaption = descend(configPanel, 'data-caption', null);
assert(pulseCaption.length === 1 && pulseCaption[0].textContent === getI18n('UI.PulseConfigurationTab'),
  `the pulse tab is titled ${pulseCaption.length === 0 ? 'nothing' : pulseCaption[0].textContent}, the bundle's tab label is ${getI18n('UI.PulseConfigurationTab')}`);
const helpLines = descend(configPanel, 'data-help', null);
assert(helpLines.length === 2, `the pulse tab carries ${helpLines.length} help lines, the Swing panel has two`);
for (const line of helpLines) assert(line.textContent !== '', 'a help line rendered empty, which is a missing bundle key');
const seconds = descend(configPanel, 'data-pulse-row', null)
  .flatMap((row) => row.kids)
  .filter((node) => node.tag === 'span');
assert(seconds.length === 2, `the pulse tab spells out the unit word ${seconds.length} times, two durations have one and two temperatures do not`);
for (const span of seconds) {
  assert(span.textContent === ` ${getI18n('Config.Seconds')}`, `a duration row's unit is ${JSON.stringify(span.textContent)}, the bundle's word is ${JSON.stringify(` ${getI18n('Config.Seconds')}`)}`);
}

// A typed number lands on the field and the page's own handler answers it, which is where a browser
// leaves a `change` event -- on the input, not on the panel.
const onPulse = descend(configPanel, 'data-field', 'onPulse').filter((node) => node.tag === 'input')[0];
assert(onPulse !== undefined, 'the pulse tab has no on-pulse spinner');
const beforePulse = onPulse.value;
type(onPulse, PULSE_DURATION_RANGE[1] + 1);
assert(errorElement.textContent.includes(getI18n('Config.OnPulse')),
  `the refusal for an out-of-range duration is ${errorElement.textContent}, which does not name the control in the bundle's words`);
assert(errorElement.textContent.includes(String(PULSE_DURATION_RANGE[1])),
  `the refusal for an out-of-range duration did not say the bound the spinner offers (${PULSE_DURATION_RANGE.join('..')})`);
assert(onPulse.value === beforePulse, `the refusal moved the on-pulse spinner to ${onPulse.value} instead of leaving it at ${beforePulse}`);

type(onPulse, 7);
assert(onPulse.value === '7', `the on-pulse spinner reads ${onPulse.value} after a typed 7`);
const afterPulse = describeBoard(textarea.value, catalog);
assert(afterPulse.ok && afterPulse.design.onPulse === 7, 'a typed duration never reached the code the field holds');

const resetButton = descend(configPanel, 'data-reset-pulse', null);
assert(resetButton.length === 1, `the pulse tab has ${resetButton.length} reset buttons, the Swing panel has one`);
click(resetButton[0]);
for (const [field, range] of [['onPulse', PULSE_DURATION_RANGE], ['offPulse', PULSE_DURATION_RANGE], ['suspendTemp', PULSE_TEMP_RANGE], ['resumeTemp', PULSE_TEMP_RANGE]]) {
  const input = descend(configPanel, 'data-field', field).filter((node) => node.tag === 'input')[0];
  assert(input !== undefined, `the pulse tab has no ${field} spinner`);
  assert(input.attributes.get('max') === String(range[1]), `${field}'s spinner offers up to ${input.attributes.get('max')}, the model is ${range[1]}`);
}
const afterReset = describeBoard(textarea.value, catalog);
assert(afterReset.ok, `the reset wrote a code the decoder rejects: ${afterReset.message}`);
const untouched = defaultDesign();
assert(afterReset.design.onPulse === untouched.onPulse
    && afterReset.design.offPulse === untouched.offPulse
    && afterReset.design.suspendTemp === untouched.suspendTemp
    && afterReset.design.resumeTemp === untouched.resumeTemp,
  'the reset left a pulse figure away from its default');
assert(afterReset.design.pulsed, 'the reset turned the pulsed flag off, which the button name does not promise');

// The old-style checkbox rewrites the field in the pre-2.3.1 format; the board is the same reactor,
// which is the only thing a visitor can check without reading the code.
const placedIcons = boardElement.kids.filter((slot) => slot.kids.some((kid) => kid.tag === 'img')).length;
click(descend(configPanel, 'data-legacy', null)[0]);
assert(!textarea.value.startsWith('erp='), 'the old-style checkbox left the field in the current format');
const legacyBoard = describeBoard(textarea.value, catalog);
assert(legacyBoard.ok, `the old-style code the page wrote cannot be read back: ${legacyBoard.message}`);
// The old format has no slot for the tick limit, so the text in the field cannot carry it -- the
// desktop has the same split, where the `Reactor` object keeps its limit and the textarea's text
// does not. The page follows the object, which is what its spinner shows.
assert(legacyBoard.filled === placedIcons, `the old-style code holds ${legacyBoard.filled} components, the board shows ${placedIcons}`);
const limitSpinner = descend(configPanel, 'data-field', 'maxSimulationTicks').filter((node) => node.tag === 'input')[0];
assert(limitSpinner !== undefined, 'the panel lost the tick-limit spinner under the old-style checkbox');
assert(legacyBoard.design.maxSimulationTicks === defaultDesign().maxSimulationTicks,
  `the old-style text carries a tick limit (${legacyBoard.design.maxSimulationTicks}), which the format has no slot for`);
assert(limitSpinner.value === String(afterReset.design.maxSimulationTicks),
  `the page's limit spinner reads ${limitSpinner.value} while the field's text says ${legacyBoard.design.maxSimulationTicks}`);
click(descend(configPanel, 'data-legacy', null)[0]);
assert(textarea.value.startsWith('erp='), 'the second old-style checkbox left the field in the old format');

// The Component List tab: the engine's whole list, one row per line.
const componentsPanel = globalThis.PAGE.registry.get('components');
assert(componentsPanel.hidden === true, 'the component list stayed open while Config is the lit chip');
click(modesElement.querySelector('[data-mode="Components"]'));
assert(componentsPanel.hidden === false, 'the Components chip left the panel closed');
const listCaption = componentsPanel.querySelector('[data-caption]');
assert(listCaption !== null && listCaption.textContent === getI18n('UI.ComponentListTab'),
  `the component list is titled ${listCaption === null ? 'nothing' : listCaption.textContent}, the bundle's tab label is ${getI18n('UI.ComponentListTab')}`);
const list = componentsPanel.querySelector('[data-list]');
assert(list !== null, 'the component list has no row list');
const wanted = componentList(textarea.value, catalog);
assert(wanted.ok, `the list refused the design the field holds: ${wanted.message}`);
assert(list.kids.length === wanted.lines.length, `the panel shows ${list.kids.length} rows, the list class wrote ${wanted.lines.length}`);
for (let at = 0; at < list.kids.length; at += 1) {
  assert(list.kids[at].textContent === wanted.lines[at],
    `row ${at} reads ${list.kids[at].textContent}, the list class wrote ${wanted.lines[at]}`);
}

// The Simulate button starts a run; it does not open the tab that shows one. Its label is the
// bundle's own words, checked on the file and on the live element for the same reason Clear Grid's
// is: the English answers are the authored words, so the file claim and the live claim only part
// company once a locale bundle is in play (§36).
const simulateButton = globalThis.PAGE.registry.get('simulate');
assert(simulateButton !== undefined, 'the page has no Simulate button');
const authoredSimulate = /<button id="simulate"[^>]*>([^<]*)</.exec(pageSource);
assert(authoredSimulate !== null && authoredSimulate[1] === getI18n('UI.SimulateButton'),
  `the button reads ${authoredSimulate === null ? 'nothing' : authoredSimulate[1]}, the bundle's UI.SimulateButton reads ${getI18n('UI.SimulateButton')}`);
assert(simulateButton.textContent === getI18n('UI.SimulateButton'),
  `the live button reads ${simulateButton.textContent}, the bundle's UI.SimulateButton reads ${getI18n('UI.SimulateButton')}`);
assert(simulationPanel.hidden === true, 'the Simulation tab is open, which the button is not supposed to do');
click(simulateButton);
assert(simulationPanel.hidden === true, 'the Simulate button opened the tab it only feeds');
assert(errorElement.textContent === '', 'the Simulate button answered a clean run with a message');
click(modesElement.querySelector('[data-mode="Simulation"]'));
const simRows = simulationPanel.querySelector('[data-lines]');
assert(simRows !== null, 'the simulation panel has no line list');
const freshRun = simulate(textarea.value, catalog);
assert(freshRun.ok, `the field's design would not run: ${freshRun.message}`);
const freshLines = freshRun.run.report.split('\n');
if (freshLines.length > 0 && freshLines[freshLines.length - 1] === '') freshLines.pop();
const freshElapsed = getI18n('Simulation.ElapsedTime').split('%')[0];
const freshExpected = freshLines.filter((text) => !text.startsWith(freshElapsed));
const freshRows = simRows.kids.filter((row) => !row.textContent.startsWith(freshElapsed));
assert(freshRows.length === freshExpected.length,
  `the panel shows ${freshRows.length} lines after the button ran, the run wrote ${freshExpected.length}`);
for (let at = 0; at < freshRows.length; at += 1) {
  assert(freshRows[at].textContent === freshExpected[at],
    `line ${at} reads ${freshRows[at].textContent}, the run wrote ${freshExpected[at]}`);
}

// ---------------------------------------------------------------------------
// What the run left on the grid: the cells that melted down and the cells that still held heat
// ---------------------------------------------------------------------------

// The desktop's run reports its grid state through the SwingWorker's message channel rather than
// through the report: `AutomationSimulator` publishes `R%dC%d:0xRRGGBB` (`:191` silver for every
// cell before the loop starts, `:367` orange for a component that still holds heat, `:686` red for
// one that broke) and its own `process` (`:984-997`) paints each chunk onto the design grid's button
// and sets that button's tooltip. So the marks belong on the cells the visitor edits, and they stay
// until the next run clears them.
const boardAfterRun = globalThis.PAGE.registry.get('board');
const filledAfterRun = boardAfterRun.kids.filter((slot) => slot.kids.some((kid) => kid.tag === 'img'));
const expectedMarks = new Map(runMarks(freshRun.run.cellPaint, filledAfterRun.map((slot) => Number(slot.attributes.get('data-index'))))
  .map((mark) => [mark.index, mark]));
const markedSlots = boardAfterRun.kids.filter((slot) => slot.attributes.has('data-melt') || slot.attributes.has('data-residual'));
assert(markedSlots.length === expectedMarks.size,
  `the board marks ${markedSlots.length} cells, the run painted ${expectedMarks.size}`);
for (const slot of markedSlots) {
  const index = Number(slot.attributes.get('data-index'));
  const expected = expectedMarks.get(index);
  assert(expected !== undefined, `cell ${index} is marked, the run did not paint it`);
  const kind = slot.attributes.has('data-melt') ? 'melt' : 'residual';
  assert(kind === expected.kind, `cell ${index} reads ${kind}, the run painted ${expected.kind}`);
  assert(slot.kids.some((kid) => kid.tag === 'img'), `cell ${index} is marked, which shows no component`);
  // The desktop's tooltip on the button, in the bundle's words.
  const words = kind === 'melt' ? getI18n('ComponentTooltip.Broken') : getI18n('ComponentTooltip.ResidualHeat');
  assert(slot.attributes.get('title') === words, `cell ${index} hovers as ${slot.attributes.get('title')}, the bundle says ${words}`);
}

// The legend strip: open exactly when the board is marked, and only naming what is on it.
const legendElement = globalThis.PAGE.registry.get('runlegend');
if (expectedMarks.size === 0) {
  assert(legendElement.hidden === true, 'the legend names colours for a run that marked nothing');
} else {
  assert(legendElement.hidden === false, `${expectedMarks.size} cells are marked and the legend stayed closed`);
  const rows = legendElement.kids;
  const kinds = new Set(expectedMarks.values().map((mark) => mark.kind));
  assert(rows.length === kinds.size, `the legend has ${rows.length} rows for ${kinds.size} colours on the board`);
  for (const row of rows) {
    const kind = row.attributes.get('data-key');
    assert(kinds.has(kind), `the legend names ${kind}, which is not on the board`);
    const words = kind === 'melt' ? getI18n('ComponentTooltip.Broken') : getI18n('ComponentTooltip.ResidualHeat');
    assert(row.textContent === words, `the legend reads ${row.textContent}, the bundle says ${words}`);
  }
}

// ---------------------------------------------------------------------------
// Copy Code: the desktop's button, and the fallback a browser has to leave visible
// ---------------------------------------------------------------------------

// The page reads the field only in the code's own characters, which is what makes a code pasted out
// of a chat window or a terminal still draw. The strip is the desktop's (`ReactorPlannerFrame:2388`).
assert(pasteCode(textarea.value) === textarea.value,
  `the field still holds characters outside the code's alphabet: ${textarea.value}`);

const copyButton = globalThis.PAGE.registry.get('copy');
assert(copyButton !== undefined && copyButton !== null, 'the page has no Copy Code button');
// The label is authored in `index.html` and rewritten from the bundle at startup, so both halves
// are checked, the same way Clear Grid's are.
const authoredCopy = /<button id="copy"[^>]*>([^<]*)</.exec(pageSource);
assert(authoredCopy !== null && authoredCopy[1] === getI18n('UI.CopyCodeButton'),
  `the copy button reads ${authoredCopy === null ? 'nothing' : authoredCopy[1]}, the bundle's UI.CopyCodeButton reads ${getI18n('UI.CopyCodeButton')}`);
assert(copyButton.textContent === getI18n('UI.CopyCodeButton'),
  `the live button reads ${copyButton.textContent}, the bundle's UI.CopyCodeButton reads ${getI18n('UI.CopyCodeButton')}`);
const codeBeforeCopy = textarea.value;
const errorsBefore = errorElement.textContent;
click(copyButton);
assert(errorElement.textContent === errorsBefore,
  'a copy added a message to the strip; the desktop’s button says nothing');
// Under the shim there is no clipboard, so the page must have taken the route it can finish: the
// field is left selected for the visitor's own keyboard. A browser that has the Clipboard API never
// gets here, and a browser will not let a test observe which route it took -- that is the gate.
assert(textarea.selected === true,
  'the copy fell back without selecting the field, which is the only gesture a browser can leave the visitor');
assert(textarea.value === codeBeforeCopy, 'the copy button changed the design');

// ---------------------------------------------------------------------------
// Copy Comparison Data: the desktop's second copy button, inside the Compare tab
// ---------------------------------------------------------------------------

// `UI.CopyComparisonData` (`ReactorPlannerFrame:1855`, action at `:2385-2389`) puts the Swing
// comparison label on the clipboard. The page's route is the same one Copy Code takes -- the
// Clipboard API, which a browser may refuse and a shim never has -- so what a test can hold is the
// label, the panel's undisturbed state, and the silence; the text itself is the browser probe's
// (§36), which compares the rows against the comparison the engine builds in node.
click(modesElement.querySelector('[data-mode="Compare"]'));
const comparisonPanel = globalThis.PAGE.registry.get('comparison');
assert(comparisonPanel !== undefined && comparisonPanel !== null, 'the page has no Compare panel');
const comparisonRows = comparisonPanel.querySelector('[data-lines]');
assert(comparisonRows !== null, 'the Compare panel has no line list');
const comparisonCopy = comparisonPanel.kids.find((kid) => kid.attributes.has('data-copy-comparison'));
assert(comparisonCopy !== undefined && comparisonCopy !== null, 'the Compare panel has no copy button');
assert(comparisonCopy.textContent === getI18n('UI.CopyComparisonData'),
  `the copy button reads ${comparisonCopy.textContent}, the bundle's UI.CopyComparisonData reads ${getI18n('UI.CopyComparisonData')}`);
const rowsBeforeComparisonCopy = comparisonRows.kids.map((row) => row.textContent).join('\n');
const errorsBeforeComparisonCopy = errorElement.textContent;
click(comparisonCopy);
assert(errorElement.textContent === errorsBeforeComparisonCopy,
  'a comparison copy answered with a message; the desktop’s button says nothing');
assert(comparisonRows.kids.map((row) => row.textContent).join('\n') === rowsBeforeComparisonCopy,
  'the comparison copy redrew the panel; the desktop’s button only hands the text over');

console.log(`page: ${board.filled} icons, ${chips.length} flag chips, ${shown.length} palette entries, one tap placed and cleared, Pick read ${pickedName}, Inspect read ${readout === null ? 'nothing, the board is empty' : readout.split('\n')[0]}, Automate read ${chosenLine.textContent}, Copy read ${textarea.value.slice(0, 24)}`);
}
