/**
 * Stage 1 verification: the JavaScript code layer must agree with the Java engine's output.
 *
 * Run: node web/test/code-roundtrip.test.js
 *
 * The fixture is real Java output (testResources/java-reference-codes.txt), generated once on
 * the `desktop` branch and frozen. It is never regenerated here -- if it were, a porting
 * mistake would move both sides of the comparison at once and the test would go green.
 *
 * Three checks, in order of how much they prove:
 *
 *  1. decode(Java code) -> encode -> byte-identical to the Java code. This is the headline
 *     claim: the JS reader reads the Java format and the JS writer writes it back, bit for bit.
 *  2. decode(Java base64 code) and decode(Java legacy code) describe the same design. Two
 *     independent Java encodings of one design, so a reader that agrees with both is reading
 *     semantics rather than pattern-matching one string.
 *  3. Hand-written expectations for the empty design and for the payload packing itself --
 *     these are the only place a value is written down by hand, which is what makes 1 and 2
 *     able to fail at all.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { encodeBase64Code, encodeLegacyCode, decodeCode, readLegacyCode, readCodeString, defaultDesign } from '../engine/reactor-code.js';

// The code format compares a component's automation parameters against that component's own
// defaults, which are derived from its capacity. Stage 2's components.json supersedes this.
const DEFAULTS_DOC = JSON.parse(readFileSync(new URL('../data/component-code-defaults.json', import.meta.url), 'utf8'));
const defaults = [];
for (const entry of DEFAULTS_DOC.components) defaults[entry.id] = entry;
console.log(`defaults table: ${DEFAULTS_DOC.components.length} components`);

import { BigintStorage } from '../engine/bigint-storage.js';

const FIXTURE = readFileSync(new URL('../../testResources/java-reference-codes.txt', import.meta.url), 'utf8');

const cases = FIXTURE.split('\n')
  .filter((line) => line.length > 0 && !line.startsWith('#'))
  .map((line) => {
    const [name, code, legacyCode, selfOk] = line.split('\t');
    return { name, code, legacyCode, selfOk };
  });

console.log(`fixture designs: ${cases.length}`);

// ---------------------------------------------------------------------------
// 3. payload packing, checked against values written down by hand
// ---------------------------------------------------------------------------
{
  // store/extract is a big-endian mixed-radix number. Written by hand, not derived from Java.
  const s = new BigintStorage();
  s.store(3, 255);
  s.store(7, 9);
  s.store(123456, 999999);
  assert(Number(s.extract(999999)) === 123456, 'field 3 round trip');
  assert(Number(s.extract(9)) === 7, 'field 2 round trip');
  assert(Number(s.extract(255)) === 3, 'field 1 round trip');

  // The leading-zero-byte trap. 128 needs a sign byte; 127 does not.
  assert(BigintStorage.inputBase64('AA==').peek() === 0n, 'zero payload is one zero byte');
  const a = new BigintStorage(127n);
  const b = new BigintStorage(128n);
  const encA = a.outputBase64();
  const encB = b.outputBase64();
  assert(encA === 'fw==', `127 encodes as fw== (got ${encA})`);
  assert(encB === 'AIA=', `128 encodes as AIA= with a leading zero byte (got ${encB})`);
  assert(BigintStorage.inputBase64(encA).peek() === 127n, '127 round trip');
  assert(BigintStorage.inputBase64(encB).peek() === 128n, '128 round trip');

  // A payload whose top byte has the sign bit set is refused, not silently mis-decoded.
  let threw = false;
  try {
    BigintStorage.inputBase64('gA==');
  } catch (error) {
    threw = true;
  }
  assert(threw, 'a payload starting with a high-bit byte is refused');

  // store refuses out-of-range values rather than clamping, so a bad design cannot write a
  // code that reads back as something else.
  let rangeThrew = false;
  try {
    new BigintStorage().store(2, 1);
  } catch (error) {
    rangeThrew = true;
  }
  assert(rangeThrew, 'store(2, 1) throws');
}

// ---------------------------------------------------------------------------
// 1. byte-identical round trip against every Java code
// ---------------------------------------------------------------------------
for (const c of cases) {
  const result = decodeCode(c.code, { defaults });
  assert(result.ok, `${c.name}: Java code was rejected`);
  const again = encodeBase64Code(result.design, defaults);
  assert(again === c.code, `${c.name}: re-encoded code differs from Java's
  java: ${c.code}
  js:   ${again}`);
}
console.log('base64 round trip: byte-identical for all designs');

// ---------------------------------------------------------------------------
// 2. the two Java encodings of one design decode to one design
// ---------------------------------------------------------------------------
// The legacy format couples the two automation flags: its middle character is a three-way
// switch ('s' neither, 'p' pulsed only, 'a' both), while the current format stores them
// independently. An automated-but-not-pulsed design therefore has a legacy code that reads
// back as pulsed. Java does the same, so the comparison below applies the coupling to both
// sides rather than pretending the formats agree.
function normalize(design) {
  return JSON.stringify({
    cells: design.cells.map((cell) =>
      cell === null ? null : [cell.id, cell.initialHeat, cell.automationThreshold, cell.reactorPause]),
    currentHeat: design.currentHeat,
    onPulse: design.onPulse,
    offPulse: design.offPulse,
    suspendTemp: design.suspendTemp,
    resumeTemp: design.resumeTemp,
    fluid: design.fluid,
    injectors: design.injectors,
    pulsed: design.pulsed || design.automated, // the legacy coupling, applied to both sides
    automated: design.automated,
  });
}

for (const c of cases) {
  const viaBase64 = decodeCode(c.code, { defaults });
  const viaLegacy = decodeCode(c.legacyCode, { defaults });
  assert(viaLegacy.ok, `${c.name}: Java legacy code was rejected`);
  assert(normalize(viaBase64.design) === normalize(viaLegacy.design),
    `${c.name}: base64 and legacy codes decode to different designs
  b64: ${normalize(viaBase64.design)}
  legacy: ${normalize(viaLegacy.design)}`);
}
console.log('base64 and legacy codes agree for all designs');

// ---------------------------------------------------------------------------
// hand-written expectations for the empty design
// ---------------------------------------------------------------------------
{
  const empty = defaultDesign();
  const expectedCells = Array(54).fill(null);
  assert(normalize(empty) === normalize(JSON.parse(JSON.stringify(empty))), 'sanity');

  const emptyCase = cases.find((c) => c.name === 'empty');
  const decoded = decodeCode(emptyCase.code, { defaults }).design;
  assert(decoded.cells.every((cell) => cell === null), 'empty code places nothing');
  assert(decoded.currentHeat === 0, 'empty code has no current heat');
  assert(decoded.fluid === false && decoded.injectors === false, 'empty code is neither fluid nor injectors');
  assert(decoded.pulsed === false && decoded.automated === false, 'empty code is neither pulsed nor automated');
  assert(decoded.onPulse === 5_000_000 && decoded.offPulse === 0, 'empty code leaves pulse durations at defaults');
  assert(decoded.suspendTemp === 120_000 && decoded.resumeTemp === 120_000, 'empty code leaves pulse temps at defaults');
  assert(decoded.maxSimulationTicks === 5_000_000, 'empty code leaves the tick cap at its default');
  assert(decoded.revision === 4, 'empty code is revision 4');

  // The two fields the comparison above leaves out, stated as their own expectations.
  const automatedOnly = decodeCode(emptyCase.code, { defaults }).design;
  automatedOnly.automated = true;
  automatedOnly.pulsed = false;
  const coupledBack = decodeCode(encodeLegacyCode(automatedOnly, defaults), { defaults });
  assert(coupledBack.ok && coupledBack.design.pulsed === true && coupledBack.design.automated,
    'an automated legacy code reads back as pulsed too -- the legacy format couples them');
  const tickCapped = defaultDesign();
  tickCapped.maxSimulationTicks = 123456;
  const tickCapBack = decodeCode(encodeLegacyCode(tickCapped, defaults), { defaults });
  assert(tickCapBack.ok && tickCapBack.design.maxSimulationTicks === 5_000_000,
    'the legacy format has no field for maxSimulationTicks, so it cannot carry it');

  // The legacy writer's shape, checked against a string written down here.
  const legacyEmpty = encodeLegacyCode(empty, defaults);
  assert(legacyEmpty === '0'.repeat(108) + '|esn', `empty legacy code (got ${legacyEmpty})`);
  const back = readLegacyCode(legacyEmpty, defaultDesign(), defaults);
  assert(normalize(back) === normalize(empty), 'empty legacy code round trips');
}

// ---------------------------------------------------------------------------
// refusals: a bad code must be reported, never half-applied
// ---------------------------------------------------------------------------
{
  const bad = [
    'erp=',                       // no payload: Java's `new BigInteger([])` says "Zero length BigInteger"
    'erp=!!!!',                   // not base64
    'erp=gA==',                   // negative payload
    'x'.repeat(108),              // looks legacy, is not hex
    'a'.repeat(108),              // id 170 in every cell, past the id bound
    'zz',                         // see the note below
  ];
  for (const code of bad) {
    const result = decodeCode(code, { defaults });
    assert(result.ok === false, `${code}: should have been refused`);
    assert(typeof result.message === 'string' && result.message.includes(code), `${code}: warning names the code`);
  }

  // `zz` is the one place the web build deliberately differs from Java. Java routes an all-
  // lowercase string to Talonius's planner decoder, which was dropped from this port, so the
  // string falls through to the base64 branch and is refused. The refusal is the point: a
  // dropped reader must refuse rather than guess.

  // Accepted edge cases, taken from the Java oracle rather than reasoned about.
  const rev0 = decodeCode('erp=AAAAAAAA', { defaults });
  assert(rev0.ok && rev0.design.revision === 0 && rev0.design.maxSimulationTicks === 0
      && rev0.design.onPulse === 0 && rev0.design.suspendTemp === 0,
    'a short payload fills with zeros and claims revision 0');

  const bareGrid = decodeCode('0'.repeat(108), { defaults });
  assert(bareGrid.ok, 'a legacy code with no suffix at all is just the grid');

  const empty = decodeCode('', { defaults });
  assert(empty.ok && normalize(empty.design) === normalize(defaultDesign()), 'an empty code changes nothing');
}

console.log('all assertions passed');
