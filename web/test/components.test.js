#!/usr/bin/env node
/**
 * Stage 2 verification: the component catalog and the component primitives.
 *
 * Two independent sources of truth, and the test says which one each claim comes from:
 *
 *  - `web/data/components.json` is a source extraction. It has to be, because every subclass
 *    constructor argument (energyMult, switchSide, heatBonus, ...) is `private final` with no
 *    getter -- the oracle cannot print it.
 *  - `testResources/java-component-catalog.txt` is an oracle dump of everything the engine CAN
 *    see: capacity, derived automation threshold, and the nine class-level predicates.
 *
 * A field that appears in the JSON but not in the dump (energyMult, heatMult, switchSide,
 * mHeatBonusStep, ...) is only pinned here as "extracted correctly from the source". Its
 * numeric effect is pinned by Stage 3's corpus diff, and this file says so rather than
 * pretending the oracle covered it.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  parseCatalog, createComponent, getDefaultComponent, getComponentCount,
  setMcVersion, setInitialHeat, setAutomationThreshold, setReactorPause,
  adjustCurrentHeat, applyDamage, clearCurrentHeat, isBroken, isHeatAcceptor, isCoolable,
  isNeutronReflector, getMaxDamage, getRodCount, getVentCoolingCapacity, getHullCoolingCapacity,
  getExplosionPowerOffset, getExplosionPowerMultiplier, producesOutput, needsCoolantInjected,
  getCurrentOutput, addToReactor, removeFromReactor, injectCoolant,
} from '../engine/components.js';

const catalog = parseCatalog(readFileSync(new URL('../data/components.json', import.meta.url), 'utf8'));
const oracle = readFileSync(new URL('../../testResources/java-component-catalog.txt', import.meta.url), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));

const byId = {};
const extras = { maxHeatWith: {} };
for (const row of oracle) {
  if ('id' in row) {
    byId[row.id] = row;
  } else if ('__maxHeatWith' in row) {
    extras.maxHeatWith[row.at] = row.__maxHeatWith;
  } else {
    for (const [key, value] of Object.entries(row)) extras[key] = value;
  }
}

assert(getComponentCount(catalog) === Object.keys(byId).length, 'the catalog and the oracle agree on the component count');

// ---------------------------------------------------------------------------
// 1. every observable field, for every component, against the oracle
// ---------------------------------------------------------------------------

const OBSERVABLE = ['baseName', 'sourceMod', 'maxDamage', 'maxHeat', 'automationThreshold', 'reactorPause', 'initialHeat', 'isHeatAcceptor', 'isCoolable', 'isNeutronReflector', 'rodCount', 'ventCoolingCapacity', 'hullCoolingCapacity', 'explosionPowerMultiplier', 'explosionPowerOffset', 'producesOutput', 'needsCoolantInjected', 'getCurrentOutput'];

const jsOf = {
  baseName: (c) => c.baseName,
  sourceMod: (c) => c.sourceMod,
  maxDamage: (c) => c.maxDamage,
  maxHeat: (c) => c.maxHeat,
  automationThreshold: (c) => c.automationThreshold,
  reactorPause: (c) => c.reactorPause,
  initialHeat: (c) => c.initialHeat,
  isHeatAcceptor: (c) => isHeatAcceptor(c),
  isCoolable: (c) => isCoolable(c),
  isNeutronReflector: (c) => isNeutronReflector(c),
  rodCount: (c) => getRodCount(c),
  ventCoolingCapacity: (c) => getVentCoolingCapacity(c),
  hullCoolingCapacity: (c) => getHullCoolingCapacity(c),
  explosionPowerMultiplier: (c) => getExplosionPowerMultiplier(c),
  explosionPowerOffset: (c) => getExplosionPowerOffset(c),
  producesOutput: (c) => producesOutput(c),
  needsCoolantInjected: (c) => needsCoolantInjected(c),
  getCurrentOutput: (c) => getCurrentOutput(c),
};

let compared = 0;
for (let id = 1; id <= catalog.count; id++) {
  const component = createComponent(catalog, id);
  const expected = byId[id];
  assert(component !== null, `id ${id} must be constructible`);
  for (const field of OBSERVABLE) {
    const actual = jsOf[field](component);
    assert(actual === expected[field], `id ${id} ${field}: JS ${actual} vs Java ${expected[field]}`);
    compared++;
  }
}
console.log(`observable fields: ${compared} values match the Java oracle across ${catalog.count} components`);

// The derived threshold is the interesting one: it is not a catalog field, the constructor
// computes it, and 22000 (not 9000) is what a uranium rod carries.
assert(getDefaultComponent(catalog, 1).automationThreshold === 22000, 'a fuel rod derives maxDamage * 1.1, not the 9000 field initialiser');
assert(getDefaultComponent(catalog, 14).automationThreshold === 9000, 'a coolant cell derives maxHeat * 0.9');
assert(getDefaultComponent(catalog, 59).automationThreshold === 900000000, 'the neutronium cell derives 1e9 * 0.9');

// ---------------------------------------------------------------------------
// 2. Reflector's version-dependent damage, which only exists as an override
// ---------------------------------------------------------------------------

setMcVersion('1.7.10');
const at1710 = [];
for (let id = 1; id <= catalog.count; id++) at1710.push(getMaxDamage(createComponent(catalog, id)));
assert(JSON.stringify(at1710) === JSON.stringify(extras.__reflectorMaxDamageAt1710), 'the 1.7.10 damage table matches Java, and only reflectors divide by 3');
setMcVersion('1.12.2');
for (let id = 1; id <= catalog.count; id++) {
  const c = createComponent(catalog, id);
  assert(getMaxDamage(c) === c.maxDamage, 'at 1.12.2 every component reports its own max damage');
}
console.log('reflector version override: both versions match');

// ---------------------------------------------------------------------------
// 3. plating changes the reactor on contact -- the only way heatAdjustment is observable
// ---------------------------------------------------------------------------

const baseMaxHeat = extras.__baseMaxHeat;
for (let id = 1; id <= catalog.count; id++) {
  const stubReactor = { maxHeat: baseMaxHeat, adjustMaxHeat: (delta) => { stubReactor.maxHeat += delta; }, isFluid: () => false, getComponentAt: () => null };
  const component = createComponent(catalog, id);
  addToReactor(component, stubReactor, 0, 0);
  assert(stubReactor.maxHeat === extras.maxHeatWith[id], `id ${id} must change the reactor capacity to Java's value`);
  removeFromReactor(component);
  assert(stubReactor.maxHeat === baseMaxHeat, 'removing a component gives the capacity back exactly');
}
console.log('plating: heatAdjustment applied on contact and undone on removal');

// ---------------------------------------------------------------------------
// 4. the setters refuse rather than clamp, and the guard is the component's capacity
// ---------------------------------------------------------------------------

const cell = createComponent(catalog, 14);   // coolantCell10k, maxHeat 10000
assert(cell.maxHeat > 1, 'the seed component has to be one the setters accept at all');
setInitialHeat(cell, cell.maxHeat - 1);
assert(cell.initialHeat === cell.maxHeat - 1, 'just under the component maximum is accepted');
setInitialHeat(cell, cell.maxHeat);
assert(cell.initialHeat === cell.maxHeat - 1, 'at the component maximum the setter refuses rather than clamps');
setInitialHeat(cell, -1);
assert(cell.initialHeat === cell.maxHeat - 1, 'a negative initial heat is refused');

const rod = createComponent(catalog, 1);     // maxHeat 1: accepts damage, not heat
setInitialHeat(rod, 500);
assert(rod.initialHeat === 0, 'a component that cannot hold heat cannot carry initial heat');
setAutomationThreshold(rod, 12345);
assert(rod.automationThreshold === 12345, 'the guard is "either capacity is real", so a damage-bearing rod does accept a threshold');

const plated = createComponent(catalog, 21); // plating: maxHeat 1, maxDamage 1
setAutomationThreshold(plated, 12345);
setReactorPause(plated, 5000);
assert(plated.automationThreshold === 9000 && plated.reactorPause === 0, 'a component with neither capacity accepts neither parameter');

setAutomationThreshold(cell, 1_000_000_000);
assert(cell.automationThreshold === 1_000_000_000, 'the top of the code range is accepted, well above the component capacity');
setAutomationThreshold(cell, 1_000_000_001);
assert(cell.automationThreshold === 1_000_000_000, 'one past the code range is refused');
setReactorPause(cell, 10_000);
assert(cell.reactorPause === 10_000, 'the top of the pause range is accepted');
setReactorPause(cell, 10_001);
assert(cell.reactorPause === 10_000, 'one past the pause range is refused');
console.log('setters: refuse rather than clamp, at every bound');

// ---------------------------------------------------------------------------
// 5. the shared prototype is shared, and a created component is private
// ---------------------------------------------------------------------------

const shared = getDefaultComponent(catalog, 14);
const originalThreshold = shared.automationThreshold;
setAutomationThreshold(shared, 42);
assert(shared.automationThreshold === 42 && getDefaultComponent(catalog, 14).automationThreshold === 42, 'getDefaultComponent returns the shared prototype, as Java does');
assert(createComponent(catalog, 14).automationThreshold === 42, 'the copy constructor carries whatever the prototype settings are at the moment, which is why callers must go through createComponent');
setAutomationThreshold(shared, originalThreshold);
assert(getDefaultComponent(catalog, 14).automationThreshold === originalThreshold, 'restoring the prototype leaves the catalog as it started');
console.log('prototype aliasing: getDefaultComponent shares, createComponent copies');

// ---------------------------------------------------------------------------
// 6. heat and damage primitives
// ---------------------------------------------------------------------------

const vent = createComponent(catalog, 9);   // heatVent, maxHeat 1000
assert(adjustCurrentHeat(vent, 500) === 0, 'an accepted adjustment refuses nothing');
assert(vent.currentHeat === 500, 'the heat landed');
assert(adjustCurrentHeat(vent, 900) === -400, 'offering 900 to a cell with room for 500 returns exactly the overflow');
assert(vent.currentHeat === 1000 && isBroken(vent), 'the cell is now at capacity, and broken');
assert(adjustCurrentHeat(vent, -500) === -500, 'a broken component passes the whole adjustment through as refused');
assert(vent.currentHeat === 1000, 'and leaves the stored heat alone -- relaxing this would turn an overheating design into a safe one');
assert(adjustCurrentHeat(vent, -400) === -400, 'cooling cannot un-break it either');

const condensator = createComponent(catalog, 24);
assert(adjustCurrentHeat(condensator, -100) === -100, 'a condensator refuses to lose heat');
assert(condensator.currentHeat === 0, 'and stays put');
assert(adjustCurrentHeat(condensator, 500) === 0, 'absorbing 500 of 20000 refuses nothing');
assert(condensator.currentHeat === 500 && condensator.currentCondensatorCooling === 500, 'the cooling credit tracks what was absorbed');
assert(needsCoolantInjected(condensator) === false, 'at 2.5 percent it does not need a coolant injector');
condensator.currentHeat = 17001;
assert(needsCoolantInjected(condensator), 'past 85 percent it does');
injectCoolant(condensator);
assert(condensator.currentHeat === 0, 'injecting coolant empties it');

const coolCell = createComponent(catalog, 14);
adjustCurrentHeat(coolCell, 500);
adjustCurrentHeat(coolCell, -900);
adjustCurrentHeat(coolCell, -2000);
adjustCurrentHeat(coolCell, 300);
assert(coolCell.currentCellCooling === 800, 'draining the cell is not negative cooling, so the running figure is the sum of what it absorbed');
assert(coolCell.bestCellCooling === 800, 'and the running figure agrees with the peak the report prints');

const reflector = createComponent(catalog, 7);
applyDamage(reflector, 4);
assert(reflector.currentDamage === 4, 'a neutron reflector takes damage');
applyDamage(vent, 100);
assert(vent.currentDamage === 0, 'a component with maxDamage 1 takes none');
assert(getExplosionPowerOffset(reflector) === -1, 'an intact reflector with no rods dampens the explosion');
assert(getExplosionPowerOffset(createComponent(catalog, 3)) === 8, 'a quad rod contributes twice its rod count');
clearCurrentHeat(vent);
assert(vent.currentHeat === 0 && !isBroken(vent), 'resetting a simulation clears the break');

console.log('heat and damage primitives match the Java semantics');
console.log('all assertions passed');
