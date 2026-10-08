/**
 * The temperature-effects readout's oracle: the five gates under every corpus design.
 *
 * The Swing frame has one expression for the label and four places that call it
 * (`ReactorPlannerFrame:285-291`, `:327-333`, `:2073-2079`, `:2695-2701`), all of the same shape:
 *
 *     formatI18n("UI.TemperatureEffectsSpecific",
 *                (int) (reactor.getMaxHeat() * 0.4),
 *                (int) (reactor.getMaxHeat() * 0.5),
 *                (int) (reactor.getMaxHeat() * 0.7),
 *                (int) (reactor.getMaxHeat() * 0.85),
 *                (int) (reactor.getMaxHeat() * 1.0));
 *
 * There is no frozen baseline for this line — the corpus baseline carries a run's figures, not a
 * resting reactor's limits, and the label is never part of a report. The oracle is therefore the
 * expression itself, read off the source above, plus three things it pins: the max heat comes from
 * `Reactor.getMaxHeat()` (which the corpus test exercises on every gate decision), the factors are
 * the simulator's own (`automation-simulator.js:224-227` decides the four `reached*` flags against
 * 0.4, 0.5, 0.7 and 0.85 of the same number), and the line is `UI.TemperatureEffectsSpecific`'s five
 * `%,d` slots, which `format.test.js` already pins the grouping of.
 *
 * What this file adds is the seam between them: the page's readout must show the same five numbers
 * the run decided on, for every design in the corpus, and must move when the design moves.
 *
 * Run: `node web/test/heat.test.js`
 *
 * @see web/ui/heat.js, WEB_MIGRATION_PLAN.md §31
 */

import { loadBundle, getI18n } from '../engine/i18n.js';
import { parseCatalog } from '../engine/components.js';
import { describeBoard } from '../ui/board.js';
import { temperatureEffects } from '../ui/heat.js';
import { readFile } from 'node:fs/promises';

const designsFixture = await readFile('testResources/corpus-designs.json', 'utf8');
const catalogFixture = await readFile('web/data/components.json', 'utf8');
const bundleFixture = await readFile('web/data/i18n/en.json', 'utf8');

loadBundle(bundleFixture);
const catalog = parseCatalog(catalogFixture);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The bundle's line must have exactly the five slots the readout fills, in the order it names them.
const pattern = getI18n('UI.TemperatureEffectsSpecific');
assert((pattern.match(/%,d/g) ?? []).length === 5,
  `UI.TemperatureEffectsSpecific has ${(pattern.match(/%,d/g) ?? []).length} grouped-integer slots, the readout fills five`);
for (const word of ['Burn', 'Evaporate', 'Hurt', 'Lava', 'Explode']) {
  assert(pattern.includes(word), `the bundle's line lost ${word}`);
}

const designs = JSON.parse(designsFixture).designs;
let checked = 0;
const seen = new Set();

for (const design of designs) {
  const board = describeBoard(design.code, catalog);
  if (!board.ok) continue; // a design the decoder rejects has no limits to read
  const got = temperatureEffects(design.code, catalog);
  if (!got.ok) {
    assert(false, `the readout refused ${design.id}: ${got.message}`);
  }

  // Java's `(int)` cast truncates toward zero, which is what `Math.trunc` does; a floor would move
  // a negative limit one step the wrong way, and plating can drive max heat below zero.
  for (const [at, factor] of [[0, 0.4], [1, 0.5], [2, 0.7], [3, 0.85], [4, 1.0]]) {
    assert(got.gates[at] === Math.trunc(got.maxHeat * factor),
      `${design.id} gate ${at} is ${got.gates[at]}, max heat ${got.maxHeat} times ${factor} is ${Math.trunc(got.maxHeat * factor)}`);
  }
  assert(got.gates[4] === Math.trunc(got.maxHeat),
    `${design.id}'s last gate is ${got.gates[4]}, its max heat is ${got.maxHeat}`);
  assert(got.gates[0] <= got.gates[4], `${design.id}'s Burn gate sits above its Explode gate`);

  // The line the Swing label would hold, spelled out rather than compared to itself.
  const expected = ['Burn', 'Evaporate', 'Hurt', 'Lava', 'Explode']
    .map((word, at) => `${word}: ${got.gates[at].toLocaleString('en-US')}`)
    .join('  ');
  assert(got.text === expected, `${design.id} reads ${got.text}, the five gates spell ${expected}`);

  seen.add(got.text);
  checked += 1;
}

assert(checked > 0, 'no corpus design reached the readout');
assert(seen.size > 1, `every design printed the same line, so the readout never moves with the design`);
