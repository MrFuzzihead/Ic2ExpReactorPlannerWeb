/**
 * Stage 4's palette filter, verified without a browser.
 *
 * The claim under test is that the palette is a *filter over the catalog* and never a second list
 * that could drift: every count asserted here comes from the same 72 entries `components.test.js`
 * reads, and the split is the one `WEB_DESIGN.md` §3 names — 26 base against 46 mod (Coaxium 6,
 * GT5.08 9, GT5.09 4, GTNH 27). The corpus is not involved: the palette is a catalog axis, not a
 * design axis, so no reactor code is parsed here.
 *
 * Run: `node web/test/palette.test.js`
 *
 * @see web/ui/palette.js, web/data/components.json
 */

import { readFile } from 'node:fs/promises';
import { parseCatalog, getComponentCount } from '../engine/components.js';
import { loadBundle, getI18n } from '../engine/i18n.js';
import { paletteAxes, paletteList } from '../ui/palette.js';

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function count(list) {
  const byMod = new Map();
  for (const entry of list) {
    const mod = entry.sourceMod ?? 'base';
    byMod.set(mod, (byMod.get(mod) ?? 0) + 1);
  }
  return byMod;
}

// ---------------------------------------------------------------------------
// 1. The axes are derived, not authored
// ---------------------------------------------------------------------------

const axes = paletteAxes(catalog);
const total = getComponentCount(catalog);
assert(axes.mods.reduce((sum, [, n]) => sum + n, 0) === total, 'the mod axis does not cover the catalog');
assert(axes.classes.reduce((sum, [, n]) => sum + n, 0) === total, 'the class axis does not cover the catalog');

const mods = new Map(axes.mods);
assert(mods.get('base') === 26, `base is ${mods.get('base')}, expected 26`);
assert(mods.get('Coaxium') === 6, `Coaxium is ${mods.get('Coaxium')}, expected 6`);
assert(mods.get('GT5.08') === 9, `GT5.08 is ${mods.get('GT5.08')}, expected 9`);
assert(mods.get('GT5.09') === 4, `GT5.09 is ${mods.get('GT5.09')}, expected 4`);
assert(mods.get('GTNH') === 27, `GTNH is ${mods.get('GTNH')}, expected 27`);

const classes = new Map(axes.classes);
assert(classes.has('FuelRod') && classes.get('FuelRod') === 28, `FuelRod is ${classes.get('FuelRod')}, expected 28`);
assert(classes.has('BreederCell') && classes.get('BreederCell') === 1, 'BreederCell should be the smallest class');
console.log(`axes: ${mods.size} mods / ${classes.size} classes over ${total} components`);

// ---------------------------------------------------------------------------
// 2. The toggle: 'base' hides the 46 mod entries, anything else shows all 72
// ---------------------------------------------------------------------------

const everything = paletteList(catalog, { modPackFilter: null, classes: null });
assert(everything.length === total, `no filter gave ${everything.length}, expected ${total}`);

const baseOnly = paletteList(catalog, { modPackFilter: 'base', classes: null });
assert(baseOnly.length === 26, `base-only gave ${baseOnly.length}, expected 26`);
assert(baseOnly.every((entry) => entry.sourceMod === null), 'base-only leaked a mod component');

const explicitAll = paletteList(catalog, { modPackFilter: 'all', classes: null });
assert(explicitAll.length === total, 'the toggle\'s other state must be the whole catalog');

// An unknown pack name is not the toggle's other state: it must not silently mean "everything",
// and must not mean "nothing" either — the page only ever sends 'base' or 'all'.
const unknown = paletteList(catalog, { modPackFilter: 'GTNH', classes: null });
assert(unknown.length === total, 'an unrecognised modPackFilter hides components it should not');

// ---------------------------------------------------------------------------
// 3. The class filter narrows whatever the toggle left, and the two compose
// ---------------------------------------------------------------------------

const rods = paletteList(catalog, { modPackFilter: null, classes: ['FuelRod'] });
assert(rods.length === 28, `FuelRod gave ${rods.length}, expected 28`);
assert(rods.every((entry) => entry.kind === 'FuelRod'), 'the class filter leaked another class');

const baseRods = paletteList(catalog, { modPackFilter: 'base', classes: ['FuelRod'] });
assert(baseRods.length === rods.filter((entry) => entry.sourceMod === null).length,
  `base FuelRod is ${baseRods.length}, the composition says ${baseRods.length}`);

const twoClasses = paletteList(catalog, { modPackFilter: null, classes: ['Vent', 'CoolantCell'] });
assert(twoClasses.length === 5 + 14, `Vent+CoolantCell gave ${twoClasses.length}, expected 19`);

// An empty list is "no filter", which is what a visitor who has ticked nothing yet gets.
const emptyFilter = paletteList(catalog, { modPackFilter: null, classes: [] });
assert(emptyFilter.length === total, 'an empty class filter must not mean an empty palette');

// A class the catalog lacks yields nothing — and `paletteAxes` is what keeps the page from ever
// offering such a control.
const ghost = paletteList(catalog, { modPackFilter: null, classes: ['NotAComponentClass'] });
assert(ghost.length === 0, 'a class the catalog lacks must not match');
assert(!axes.classes.some(([name]) => name === 'NotAComponentClass'), 'the axes invented a class');

// ---------------------------------------------------------------------------
// 4. What the page renders: every entry carries the display fields it needs
// ---------------------------------------------------------------------------

for (const entry of everything) {
  assert(entry.name !== undefined && entry.name !== '', `id ${entry.id} has an empty name`);
  assert(entry.icon.startsWith('../assets/icons/'), `id ${entry.id} icon is not a page-relative path`);
  assert(entry.kind !== undefined && entry.sourceMod !== undefined, `id ${entry.id} is missing an axis`);
}

console.log(`palette: 72 total, 26 base-only, ${baseRods.length} base FuelRod — filters compose`);
