#!/usr/bin/env node
/**
 * The reactor-level configuration's oracle: the four switches, the six spinners, the reset button,
 * and the max-heat line — asserted against the Swing frame's own widget models rather than against
 * a screenshot.
 *
 * The desktop keeps all of this as ten widgets in the frame's left column, and every handler is the
 * same two lines: write one field on the `Reactor`, then `updateCodeField()`. There is no
 * configuration *model* on either side — the ten figures are already in the code format and the
 * simulator already reads them — so what this file has to pin is the part that was missing from the
 * page: the bounds. Each spinner's range is its own Swing model (`heatSpinner` `:1410` is
 * `SpinnerNumberModel(0.0, 0.0, 9999.0, 1.0)` while `pulseDurationModel` and `temperatureModel`
 * (`:1978`, `:1983`) take a bound from `Reactor.java`, and `tickLimitModel` `:1988` takes another),
 * and the two pulse ranges differ from each other by four orders of magnitude, which is the
 * difference between a duration in seconds and a temperature in kelvin.
 *
 * A figure outside a spinner's range is refused rather than clamped, so the assertions below are
 * about the refusal: the design stays where it was, and the message names the field the visitor
 * actually touched.
 *
 * Run: `node web/test/config.test.js`
 *
 * @see web/ui/config.js, WEB_MIGRATION_PLAN.md §32
 */

import { loadBundle, getI18n, formatI18n } from '../engine/i18n.js';
import { parseCatalog } from '../engine/components.js';
import { describeBoard } from '../ui/board.js';
import { writeCode, writeLegacyCode, readDesign, copyDesign } from '../ui/board-edit.js';
import { defaultDesign } from '../engine/reactor-code.js';
import {
  setReactorFlag, setReactorNumbers, resetPulseConfig, pulseAtDefaults, maxHeatLabel,
  INITIAL_HEAT_RANGE, PULSE_DURATION_RANGE, PULSE_TEMP_RANGE, TICK_LIMIT_RANGE,
  PULSE_FIELDS, REACTOR_STYLES, REACTOR_FLAGS,
} from '../ui/config.js';
import { readFile } from 'node:fs/promises';

const designsFixture = await readFile('testResources/corpus-designs.json', 'utf8');
const catalogFixture = await readFile('web/data/components.json', 'utf8');
const bundleFixture = await readFile('web/data/i18n/en.json', 'utf8');

loadBundle(bundleFixture);
const catalog = parseCatalog(catalogFixture);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** A fresh design, so each case starts from the same ten figures. */
function fresh() {
  return copyDesign(defaultDesign());
}

// The four ranges are the four Swing models, and no two of them are the same number: the pulse
// durations run to the desktop's "5 million to mimic having no redstone timing", the pulse
// temperatures to the code's temperature bound.
assert(INITIAL_HEAT_RANGE[0] === 0 && INITIAL_HEAT_RANGE[1] === 9999,
  `heatSpinner's model is 0..9999, the page carries ${INITIAL_HEAT_RANGE.join('..')}`);
assert(PULSE_DURATION_RANGE[1] > PULSE_TEMP_RANGE[1],
  `a pulse duration and a pulse temperature share one range (${PULSE_DURATION_RANGE.join('..')} / ${PULSE_TEMP_RANGE.join('..')})`);
assert(TICK_LIMIT_RANGE[1] > PULSE_TEMP_RANGE[1],
  `the tick limit's model sits at or below the temperature bound (${TICK_LIMIT_RANGE.join('..')})`);
for (const [field, , , range] of PULSE_FIELDS) {
  assert(range[0] === 0 && range[1] > 0, `${field}'s spinner has no room to move (${range.join('..')})`);
}
assert(REACTOR_STYLES.length === 2 && REACTOR_FLAGS.length === 3,
  `the Swing frame has a radio pair and three checkboxes, the page lists ${REACTOR_STYLES.length} styles and ${REACTOR_FLAGS.length} flags`);
for (const [, key] of REACTOR_FLAGS) {
  assert(getI18n(key).length > 0, `${key} has no words to label the checkbox with`);
}

// Every switch flips, and an unknown name is refused rather than silently ignored.
for (const field of ['fluid', 'pulsed', 'automated', 'injectors']) {
  const design = fresh();
  const before = design[field];
  const edit = setReactorFlag(design, field, !before);
  assert(edit.ok, `turning ${field} over was refused: ${edit.message}`);
  assert(edit.design[field] === !before, `turning ${field} over left it at ${edit.design[field]}`);
  const other = field === 'fluid' ? 'pulsed' : 'fluid';
  assert(edit.design[other] === fresh()[other], `turning ${field} over moved ${other} as well`);
}
assert(!setReactorFlag(fresh(), 'chambers', true).ok,
  'a switch the frame does not have was accepted');

// Each spinner takes its own bound, and one step past it is refused.
for (const [field, range] of [
  ['currentHeat', INITIAL_HEAT_RANGE],
  ['maxSimulationTicks', TICK_LIMIT_RANGE],
  ['onPulse', PULSE_DURATION_RANGE],
  ['offPulse', PULSE_DURATION_RANGE],
  ['suspendTemp', PULSE_TEMP_RANGE],
  ['resumeTemp', PULSE_TEMP_RANGE],
]) {
  const atMax = fresh();
  assert(setReactorNumbers(atMax, { [field]: range[1] }).ok,
    `${field} refused its own upper bound ${range[1]}`);
  assert(atMax[field] === range[1], `${field} kept ${atMax[field]} after being set to ${range[1]}`);

  const past = fresh();
  const refused = setReactorNumbers(past, { [field]: range[1] + 1 });
  assert(!refused.ok, `${field} accepted ${range[1] + 1}, past its spinner's bound`);
  assert(past[field] === fresh()[field],
    `the refusal for ${field} left the design at ${past[field]} instead of where it started`);

  const below = fresh();
  assert(!setReactorNumbers(below, { [field]: range[0] - 1 }).ok,
    `${field} accepted ${range[0] - 1}, below its spinner's bound`);

  const half = fresh();
  assert(!setReactorNumbers(half, { [field]: range[1] - 0.5 }).ok,
    `${field} accepted a fraction, which the Swing spinner's step of 1 cannot reach`);
}

// A mixed change with one bad figure applies none of it: the panel would otherwise show a design
// that is neither what the visitor asked for nor what it was before.
const mixed = fresh();
mixed.onPulse = 7;
const mixedEdit = setReactorNumbers(mixed, { offPulse: 3, suspendTemp: PULSE_TEMP_RANGE[1] + 1 });
assert(!mixedEdit.ok, 'the bad suspend temperature was accepted');
assert(mixed.offPulse === fresh().offPulse && mixed.onPulse === 7,
  `the refusal moved ${mixed.onPulse}/${mixed.offPulse} instead of leaving both alone`);

// The reset button is `Reactor.resetPulseConfig` (`Reactor.java:970`): four figures back to their
// defaults, and nothing else.
const moved = fresh();
moved.pulsed = true;
moved.onPulse = 7;
moved.offPulse = 12;
moved.suspendTemp = 400;
moved.resumeTemp = 500;
moved.currentHeat = 250;
moved.maxSimulationTicks = 100;
assert(!pulseAtDefaults(moved), 'a design with four moved pulse figures reads as already reset');
const reset = resetPulseConfig(moved);
assert(reset.ok, `the reset was refused: ${reset.message}`);
for (const [field, , , , def] of PULSE_FIELDS) {
  assert(reset.design[field] === def, `the reset left ${field} at ${reset.design[field]} instead of ${def}`);
}
assert(reset.design.currentHeat === 250 && reset.design.maxSimulationTicks === 100 && reset.design.pulsed,
  `the reset moved a figure the button's name does not mention (heat ${reset.design.currentHeat}, ticks ${reset.design.maxSimulationTicks}, pulsed ${reset.design.pulsed})`);
assert(pulseAtDefaults(reset.design), 'after the reset the panel still thinks there is something to reset');

// The ten figures survive the code the page writes for them, which is what makes the panel's
// readings the design's rather than a copy the field keeps behind its own glass.
const configured = fresh();
configured.currentHeat = 250;
configured.maxSimulationTicks = 100;
configured.pulsed = true;
configured.onPulse = 7;
configured.offPulse = 12;
configured.suspendTemp = 400;
configured.resumeTemp = 500;
configured.fluid = true;
configured.injectors = true;
const current = writeCode(configured, catalog);
assert(current.ok, `the configured design no longer fits a reactor code: ${current.message}`);
const back = readDesign(current.code, catalog);
assert(back.ok, `the code the page wrote could not be read back: ${back.message}`);
for (const field of ['currentHeat', 'maxSimulationTicks', 'onPulse', 'offPulse', 'suspendTemp', 'resumeTemp', 'fluid', 'injectors', 'pulsed']) {
  assert(back.design[field] === configured[field],
    `the current-format code lost ${field}: ${back.design[field]} where the design held ${configured[field]}`);
}

// The old-style format is narrower, and the difference is not cosmetic: it has no slot for the
// tick limit, and its one style letter cannot carry automated and pulsed at once. Both are the
// desktop's own behaviour, and the page compensates for the first one by keeping the design's
// limit rather than re-reading the field.
const legacy = writeLegacyCode(configured, catalog);
assert(legacy.ok, `the configured design no longer fits an old-style code: ${legacy.message}`);
const oldBack = readDesign(legacy.code, catalog);
assert(oldBack.ok, `the old-style code could not be read back: ${oldBack.message}`);
for (const field of ['currentHeat', 'onPulse', 'offPulse', 'suspendTemp', 'resumeTemp', 'fluid', 'injectors', 'pulsed']) {
  assert(oldBack.design[field] === configured[field],
    `the old-style code lost ${field}: ${oldBack.design[field]} where the design held ${configured[field]}`);
}
assert(oldBack.design.maxSimulationTicks !== configured.maxSimulationTicks,
  `the old-style format kept a tick limit it has no slot for (${configured.maxSimulationTicks})`);

// The old-style format's one style letter cannot carry the two automation flags separately:
// `encodeLegacyCode` writes `a` for an automated reactor, and `readLegacyCode` reads `a` as
// automated *and* pulsed — in this build automation only runs inside a pulse cycle, so the format
// gains a flag rather than losing one. Same for both directions of the pair.
const both = fresh();
both.pulsed = false;
both.automated = true;
const bothLegacy = writeLegacyCode(both, catalog);
assert(bothLegacy.ok, 'a reactor that is automated without being pulsed no longer fits an old-style code');
const bothBack = readDesign(bothLegacy.code, catalog);
assert(bothBack.ok, 'the old-style code for an automated reactor could not be read back');
assert(bothBack.design.automated && bothBack.design.pulsed,
  `the old-style format carries ${bothBack.design.automated}/${bothBack.design.pulsed} for a reactor that was pulsed ${both.pulsed} and automated ${both.automated}`);

// The max-heat line under every corpus design: one `%,d` slot, the design's own limit, and a line
// that moves when the design does.
const heatPattern = getI18n('UI.MaxHeatSpecific');
assert((heatPattern.match(/%,\.0f/g) ?? []).length === 1,
  `UI.MaxHeatSpecific has ${(heatPattern.match(/%,\.0f/g) ?? []).length} grouped-number slots, the label fills one`);

const designs = JSON.parse(designsFixture).designs;
let checked = 0;
const lines = new Set();
for (const design of designs) {
  const board = describeBoard(design.code, catalog);
  if (!board.ok) continue; // a design the decoder rejects has no resting reactor to read
  const got = maxHeatLabel(design.code, catalog);
  if (!got.ok) {
    assert(false, `the max-heat line refused ${design.id}: ${got.message}`);
  }
  assert(got.text === formatI18n('UI.MaxHeatSpecific', got.maxHeat),
    `${design.id}'s line is ${got.text}, its limit is ${got.maxHeat}`);
  assert(got.text.includes(got.maxHeat.toLocaleString('en-US')),
    `${design.id}'s line lost the grouping the bundle asks for`);
  lines.add(got.text);
  checked += 1;
}
assert(checked > 0, 'no corpus design reached the max-heat line');
assert(lines.size > 1, `every design printed the same max-heat line, so the label never moves`);

console.log(`config.test.js: ${checked} corpus designs read the max-heat line, four switches flip, six spinners keep their own bounds, the reset moves only the four pulse figures, and the old-style format loses the tick limit and gains the pulsed flag an automated reactor does not have`);
