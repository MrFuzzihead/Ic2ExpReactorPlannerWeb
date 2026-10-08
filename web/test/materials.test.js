/**
 * The shopping list's oracle: the recipe table under every switch combo, and the whole-board
 * shopping list for every corpus design, both diffed against the Java dump.
 *
 * `testResources/materials-baseline.txt` is frozen golden data, written by
 * `../erp-java-ref/src/MaterialsDump.java` running the real Swing engine. Nothing here
 * regenerates it. Two sections, tab-separated:
 *
 *   R  gt  ufc  alloy  id  baseName  toString()   16 combos x 72 components
 *   B  gt  designId                               toString() of Reactor.getMaterials()
 *
 * `toString()` is the exact text the desktop's `materialsArea` shows, so the oracle is the panel
 * rather than an internal representation: the `#,##0.##` pattern, the fractional counts (a coolant
 * cell is 1/3 of a tin), the `TreeMap` key order, and the bundle's `=Helium` typo all have to
 * reproduce here.
 *
 * Run: `node web/test/materials.test.js` (add `--only <pattern>` to restrict the board lines).
 *
 * @see ../erp-java-ref/src/MaterialsDump.java, testResources/materials-baseline.txt
 */

import { readFile } from 'node:fs/promises';
import { loadBundle } from '../engine/i18n.js';
import { parseCatalog, createComponent } from '../engine/components.js';
import { blankReactor } from '../engine/reactor.js';
import { decodeCode } from '../engine/reactor-code.js';
import { codeDefaults } from '../engine/automation-simulator.js';
import {
  MaterialsList,
  getMaterialsForComponent,
  setGTVersion,
  setUseUfcForCoolantCells,
  setExpandAdvancedAlloy,
  switches,
} from '../engine/materials-list.js';

const ONLY = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;

// ---------------------------------------------------------------- fixtures

const baselineText = await readFile('testResources/materials-baseline.txt', 'utf8');
const catalogFixture = await readFile('web/data/components.json', 'utf8');
const bundleFixture = await readFile('web/data/i18n/en.json', 'utf8');
const designsFixture = await readFile('testResources/corpus-designs.json', 'utf8');

loadBundle(bundleFixture);
const catalog = parseCatalog(catalogFixture);
const designs = JSON.parse(designsFixture).designs;

/** One list per key, in the order the dump writes them. */
const recipeExpect = new Map();
const boardExpect = new Map();
for (const line of baselineText.split(/\r?\n/)) {
  if (line === '' || line.startsWith('#')) continue;
  const fields = line.split('\t');
  if (fields[0] === 'R') {
    const [, gt, ufc, alloy, id, baseName, text] = fields;
    const key = `${gt}/${ufc}/${alloy}/${id}`;
    if (recipeExpect.has(key)) throw new Error(`duplicate recipe line: ${key}`);
    recipeExpect.set(key, { gt, ufc, alloy, id: Number(id), baseName, text });
  } else if (fields[0] === 'B') {
    const [, gt, id, text] = fields;
    const key = `${gt}/${id}`;
    if (boardExpect.has(key)) throw new Error(`duplicate board line: ${key}`);
    boardExpect.set(key, text);
  }
}

/** The dump escapes a list's newlines so one list stays on one line. */
function oneLine(list) {
  return list.toString().replaceAll('\n', '\\n');
}

// ---------------------------------------------------------------- recipes

const combos = [];
for (const entry of recipeExpect.values()) {
  const key = `${entry.gt}/${entry.ufc}/${entry.alloy}`;
  if (!combos.includes(key)) combos.push(key);
}

const recipeFailures = [];
let recipeChecked = 0;

for (const combo of combos) {
  const [gt, ufc, alloy] = combo.split('/');
  // Setter order mirrors ReactorPlannerFrame.java:2408-2411: flags first, GT version last,
  // because setGTVersion re-derives the coolant cell and circuits from the flags already set.
  setUseUfcForCoolantCells(ufc === '1');
  setExpandAdvancedAlloy(alloy === '1');
  setGTVersion(gt);
  const current = switches();
  if (current.gtVersion !== gt || current.useUfcForCoolantCells !== (ufc === '1')
    || current.expandAdvancedAlloy !== (alloy === '1')) {
    recipeFailures.push({ id: `switch-${combo}`, diff: [`switches drifted: ${current}`] });
    continue;
  }
  for (const entry of recipeExpect.values()) {
    if (`${entry.gt}/${entry.ufc}/${entry.alloy}` !== combo) continue;
    const component = createComponent(catalog, entry.id);
    if (component === null) {
      recipeFailures.push({ id: `${combo}/${entry.id}`, diff: ['no such component id'] });
      continue;
    }
    if (component.baseName !== entry.baseName) {
      recipeFailures.push({ id: `${combo}/${entry.id}`, diff: [`baseName: ${entry.baseName} -> ${component.baseName}`] });
      continue;
    }
    const recipe = getMaterialsForComponent(component);
    const line = recipe === null ? 'NULL' : oneLine(recipe);
    recipeChecked++;
    if (line !== entry.text) {
      const want = entry.text.split('\\n').filter((s) => s !== '');
      const got = line.split('\\n').filter((s) => s !== '');
      const diff = [];
      for (let i = 0; i < Math.max(want.length, got.length); i++) {
        if (want[i] !== got[i]) diff.push(`${i}: ${want[i] ?? '-'} -> ${got[i] ?? '-'}`);
      }
      recipeFailures.push({ id: `${combo}/${entry.id} ${entry.baseName}`, diff });
    }
  }
}

// ---------------------------------------------------------------- boards

const boardFailures = [];
let boardChecked = 0;

for (const design of designs) {
  if (ONLY !== null && !design.id.includes(ONLY)) continue;
  const read = decodeCode(design.code, { defaults: codeDefaults(catalog) });
  if (!read.ok) {
    boardFailures.push({ id: design.id, diff: [`cannot decode: ${read.message}`] });
    continue;
  }
  for (const gt of ['none', '5.08', '5.09', 'GTNH']) {
    const expected = boardExpect.get(`${gt}/${design.id}`);
    if (expected === undefined) continue;
    // The board dump holds the two booleans at their defaults, as the desktop ships them.
    setUseUfcForCoolantCells(false);
    setExpandAdvancedAlloy(false);
    setGTVersion(gt);
    const reactor = blankReactor(catalog);
    reactor.placeDesign(read.design);
    const line = oneLine(reactor.getMaterials());
    boardChecked++;
    if (line !== expected) {
      const want = expected.split('\\n').filter((s) => s !== '');
      const got = line.split('\\n').filter((s) => s !== '');
      const diff = [];
      for (let i = 0; i < Math.max(want.length, got.length); i++) {
        if (want[i] !== got[i]) diff.push(`${i}: ${want[i] ?? '-'} -> ${got[i] ?? '-'}`);
      }
      boardFailures.push({ id: `${gt}/${design.id}`, diff });
    }
  }
}

// ---------------------------------------------------------------- verdict

console.log(`recipes: ${recipeChecked} of ${recipeExpect.size} checked across ${combos.length} switch combos`);
console.log(`boards: ${boardChecked} of ${boardExpect.size} checked`);

for (const failure of [...recipeFailures, ...boardFailures].slice(0, 25)) {
  console.log(`\n${failure.id}`);
  for (const entry of failure.diff) console.log(`  ${entry}`);
}

const total = recipeFailures.length + boardFailures.length;
if (total > 0) {
  console.log(`\n${total} lines differ (${recipeFailures.length} recipes, ${boardFailures.length} boards)`);
  process.exitCode = 1;
} else {
  console.log('materials: recipe table and shopping lists match the Java dump');
}
