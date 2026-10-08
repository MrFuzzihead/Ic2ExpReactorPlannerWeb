#!/usr/bin/env node
/**
 * Port of `test/Ic2ExpReactorPlanner/ReactorCodeFuzzTest.java`.
 *
 * The property under test is that reading a code is atomic: every input, valid or not, ends in
 * one of exactly two states -- the design that existed before the call, or a whole design that
 * re-encodes to itself. A blend of the two is what P1-1 was, and no hand-written case finds it.
 *
 * The inputs are generated, not typed: truncations, single-character deletions and substitutions,
 * edge junk, and legacy-shaped mutations. Generation is deterministic, so a failure is
 * reproducible from the seed design alone.
 *
 * Two of the Java test's nine cases are not portable at this stage and are named rather than
 * quietly dropped:
 *
 *  - `aRefusedComponentFieldStillLandsOnAWritableDesign` needs component setters, which are
 *    Stage 2's `ReactorItem`.
 *  - The Java seed asserts on a *derived* max heat that plating adds on contact. That derivation
 *    is Stage 3's `Reactor`. The JS seed asserts on the whole design instead, which is a strictly
 *    stronger claim about everything that exists today.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  encodeBase64Code, encodeLegacyCode, decodeCode, defaultDesign,
} from '../engine/reactor-code.js';
import {
  CODE_TEMP_BOUND, CODE_HEAT_BOUND, MAX_PULSE_DURATION, MAX_SIMULATION_TICKS,
  GRID_COLS,
} from '../data/bounds.js';

const DEFAULTS_DOC = JSON.parse(readFileSync(new URL('../data/component-code-defaults.json', import.meta.url), 'utf8'));
const defaults = [];
for (const entry of DEFAULTS_DOC.components) defaults[entry.id] = entry;

/**
 * A distinctive design, so "the reactor is unchanged" is a claim with content in it.
 * Mirrors the Java seed: a quad uranium rod at (2,2), reactor plating at (0,8), fluid, pulsed,
 * on-pulse 1111, current heat 2222, tick limit 3333.
 */
function populated() {
  const design = defaultDesign();
  const place = (at, id) => {
    const fallback = defaults[id];
    design.cells[at] = { id, initialHeat: 0, automationThreshold: fallback.automationThreshold, reactorPause: fallback.reactorPause };
  };
  place(2 * GRID_COLS + 2, 3);   // quadFuelRodUranium
  place(0 * GRID_COLS + 8, 21);  // reactorPlating
  design.fluid = true;
  design.pulsed = true;
  design.onPulse = 1111;
  design.currentHeat = 2222;
  design.maxSimulationTicks = 3333;
  return design;
}

/**
 * The seed's two codes, straight from the Java oracle (`populated` in the frozen fixture).
 * Without these the fuzz test only proves the JS engine is self-consistent; with them, every
 * generated mutation is a mutation OF A JAVA CODE, which is what keeps the property check from
 * passing on an engine that is wrong in both directions.
 */
const JAVA_BASE64 = 'erp=AIcmCvGl3aTtofdH5D+g3vltfP/nfYO5W4YWhzT3yVLut4eR1vXXH8by9C/UE0/776gQ2CfhCkQNBA==';
const JAVA_LEGACY = '000000000000000015000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000|fpn1pq|nuv';
assert(encodeBase64Code(populated(), defaults) === JAVA_BASE64, 'the seed design writes the Java base64 code');
assert(encodeLegacyCode(populated(), defaults) === JAVA_LEGACY, 'the seed design writes the Java legacy code');
console.log('seed design matches the Java oracle in both formats');

function seedDesignWithField(field, value) {
  const design = populated();
  design.automated = true;
  writeField(design, field, value);
  return design;
}

// The reactor-level fields the code writer bounds, and the bound it gives each one. Kept as a
// table so the bound tests below walk every entry: a bounded field not in this table is a
// bounded field no bound test covers.
const BOUNDED_FIELDS = ['current heat', 'on-pulse', 'off-pulse', 'suspend temperature', 'resume temperature', 'max simulation ticks'];
const BOUNDED_MAXIMA = [CODE_HEAT_BOUND, MAX_PULSE_DURATION, MAX_PULSE_DURATION, CODE_TEMP_BOUND, CODE_TEMP_BOUND, MAX_SIMULATION_TICKS];

const FIELD_NAMES = ['currentHeat', 'onPulse', 'offPulse', 'suspendTemp', 'resumeTemp', 'maxSimulationTicks'];

function writeField(design, field, value) {
  design[FIELD_NAMES[field]] = value;
}

function readField(design, field) {
  return design[FIELD_NAMES[field]];
}

function normalize(design) {
  return JSON.stringify({
    cells: design.cells.map((cell) => cell === null ? null : [cell.id, cell.initialHeat, cell.automationThreshold, cell.reactorPause]),
    currentHeat: design.currentHeat,
    onPulse: design.onPulse,
    offPulse: design.offPulse,
    suspendTemp: design.suspendTemp,
    resumeTemp: design.resumeTemp,
    fluid: design.fluid,
    injectors: design.injectors,
    pulsed: design.pulsed,
    automated: design.automated,
    maxSimulationTicks: design.maxSimulationTicks,
  });
}

function countComponents(design) {
  return design.cells.reduce((n, cell) => n + (cell === null ? 0 : 1), 0);
}

// ---------------------------------------------------------------------------
// the atomicity property, for one generated input
// ---------------------------------------------------------------------------

let unchanged = 0;
let applied = 0;
let checked = 0;

function assertAtomic(description, code) {
  const base = populated();
  const before = encodeBase64Code(base, defaults);
  const beforeSnapshot = normalize(base);

  let result;
  try {
    result = decodeCode(code, { base, defaults });
  } catch (error) {
    assert(false, `${description} must not throw out of decodeCode: ${error}`);
  }

  if (!result.ok) {
    // Refused whole: nothing at all may have moved. `decodeCode` clones the base before reading,
    // and this is what catches a clone that is too shallow -- a partial read that leaks into the
    // caller's design fails here rather than shipping a half-parsed reactor.
    assert(normalize(base) === beforeSnapshot, `${description}: a refused code must leave the design alone`);
    assert(countComponents(base) === 2, `${description}: a refused code must leave the layout alone`);
    assert(base.currentHeat === 2222 && base.maxSimulationTicks === 3333 && base.pulsed,
      `${description}: a refused code must leave the mode flags and heat alone`);
    unchanged++;
    checked++;
    return;
  }

  // The other allowed state is a whole design, and "whole" means the code it just produced reads
  // back as itself. A layout applied without the flags, or flags without the plating, fails here.
  applied++;
  checked++;
  let after;
  try {
    after = encodeBase64Code(result.design, defaults);
  } catch (error) {
    assert(false, `${description} must land on a design the writer can describe: ${error}`);
  }
  const reread = decodeCode(after, { defaults });
  assert(reread.ok, `${description} must produce a code that reads back`);
  assert(encodeBase64Code(reread.design, defaults) === after, `${description} must land on a design that re-encodes to itself`);
  assert(countComponents(reread.design) === countComponents(result.design), `${description} must land on a design whose layout reads back`);
}

// ---------------------------------------------------------------------------
// generated families
// ---------------------------------------------------------------------------

function truncations() {
  const code = encodeBase64Code(populated(), defaults);
  unchanged = applied = checked = 0;
  for (let i = 0; i < code.length; i++) assertAtomic(`prefix of length ${i}`, code.slice(0, i));
  assert(code.length === checked, 'every truncation was checked');
  assert(unchanged > 0, 'at least some truncations are refused');
  console.log(`truncations: ${code.length} inputs, ${unchanged} refused, ${applied} applied`);
}

function deletions() {
  const code = encodeBase64Code(populated(), defaults);
  unchanged = applied = checked = 0;
  for (let i = 0; i < code.length; i++) assertAtomic(`character deleted at ${i}`, code.slice(0, i) + code.slice(i + 1));
  assert(code.length === checked, 'every deletion was checked');
  console.log(`deletions: ${code.length} inputs, ${unchanged} refused, ${applied} applied`);
}

function substitutions() {
  const alphabet = ['!', '(', ')', ',', '|', '+', '=', ' ', '\t', '0', 'z', 'Z', '\u00e9', '\u4e09'];
  const code = encodeBase64Code(populated(), defaults);
  unchanged = applied = checked = 0;
  for (let i = 0; i < code.length; i++) {
    for (const ch of alphabet) assertAtomic(`position ${i} set to '${ch}'`, code.slice(0, i) + ch + code.slice(i + 1));
  }
  assert(code.length * alphabet.length === checked, 'every substitution was checked');
  assert(applied > 0, 'some substitutions still land on a whole design');
  console.log(`substitutions: ${checked} inputs, ${unchanged} refused, ${applied} applied`);
}

function edgeJunk() {
  const code = encodeBase64Code(populated(), defaults);
  const cases = ['', ' ', ' ' + code, code + ' ', code + '\n', '\t' + code, 'erp=erp=' + code, code + '!', '!' + code, code + '%%', '\u00e9' + code, code + '\u{1F600}', code + code, code.slice(0, -1) + '='];
  unchanged = applied = checked = 0;
  for (const candidate of cases) assertAtomic('edge input', candidate);
  assert(cases.length === checked, 'every edge case was checked');
  assert(unchanged > 0, 'at least some edge junk is refused');
  console.log(`edge junk: ${cases.length} inputs, ${unchanged} refused, ${applied} applied`);
}

function legacyMutations() {
  const code = encodeLegacyCode(populated(), defaults);
  unchanged = applied = checked = 0;
  for (let i = 0; i < code.length; i++) {
    assertAtomic(`legacy prefix of length ${i}`, code.slice(0, i));
    assertAtomic(`legacy character deleted at ${i}`, code.slice(0, i) + code.slice(i + 1));
  }
  assert(code.length * 2 === checked, 'every legacy mutation was checked');
  assert(unchanged > 0, 'at least some legacy mutations are refused');
  console.log(`legacy mutations: ${checked} inputs, ${unchanged} refused, ${applied} applied`);
}

function applyingTwiceIsANoOp() {
  const code = encodeBase64Code(populated(), defaults);
  const first = decodeCode(code, { defaults });
  assert(first.ok, 'a valid code must not be refused');
  const afterFirst = encodeBase64Code(first.design, defaults);
  const second = decodeCode(code, { base: first.design, defaults });
  assert(second.ok, 're-applying a valid code must not be refused');
  assert(afterFirst === encodeBase64Code(second.design, defaults), 'the second application must be a no-op');
  assert(countComponents(second.design) === countComponents(first.design), 'the second application must not duplicate components');
  console.log('applying the same code twice is a no-op');
}

// ---------------------------------------------------------------------------
// bound mismatches
// ---------------------------------------------------------------------------

function writerBoundsRoundTrip() {
  for (let field = 0; field < BOUNDED_MAXIMA.length; field++) {
    const bound = BOUNDED_MAXIMA[field];
    let code;
    try {
      code = encodeBase64Code(seedDesignWithField(field, bound), defaults);
    } catch (error) {
      assert(false, `${BOUNDED_FIELDS[field]} at its writer bound must be writable: ${error}`);
    }
    const read = decodeCode(code, { base: populated(), defaults });
    assert(read.ok, `${BOUNDED_FIELDS[field]} at its writer bound must be readable`);
    assert(readField(read.design, field) === bound, `${BOUNDED_FIELDS[field]} must read back at its bound`);
    assert(encodeBase64Code(read.design, defaults) === code, `${BOUNDED_FIELDS[field]} at its bound must land on itself`);
  }
  console.log(`writer bounds: all ${BOUNDED_MAXIMA.length} fields survive at their bound`);
}

function onePastEachWriterBoundIsRefused() {
  for (let field = 0; field < BOUNDED_MAXIMA.length; field++) {
    const over = BOUNDED_MAXIMA[field] + 1;
    let threw = false;
    try {
      encodeBase64Code(seedDesignWithField(field, over), defaults);
    } catch (error) {
      threw = true;
    }
    assert(threw, `${BOUNDED_FIELDS[field]} one past its bound must not be written`);
  }
  console.log(`one past each writer bound: all ${BOUNDED_MAXIMA.length} refused rather than truncated`);
}

truncations();
deletions();
substitutions();
edgeJunk();
legacyMutations();
applyingTwiceIsANoOp();
writerBoundsRoundTrip();
onePastEachWriterBoundIsRefused();
console.log('all assertions passed');
