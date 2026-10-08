/**
 * A component (item) in an IndustrialCraft2 Experimental Nuclear Reactor.
 *
 * Port of `components/ReactorItem.java` and its nine subclasses. The Java hierarchy is folded
 * into one object shape plus a `kind` tag rather than nine JS classes: every field a subclass
 * declares is present on every instance, zeroed where the subclass does not use it. That is
 * deliberate -- nine JS classes with different field sets would make `cell.automationThreshold`
 * megamorphic in the simulation loop, which is the one place this port has to stay fast.
 *
 * Stage boundary: this file carries the data, the queries (`isHeatAcceptor`, `getRodCount`,
 * ...), the primitives that mutate one component (`adjustCurrentHeat`, `applyDamage`, the
 * three setters), and -- once `Reactor` landed -- the four per-tick actions (`generateHeat`,
 * `generateEnergy`, `dissipate`, `transfer`). `formatTooltip` still belongs to Stage 5 with
 * the i18n layer.
 *
 * @see ../data/components.json, ../data/bounds.js
 */

import {
  MAX_AUTOMATION_THRESHOLD, MAX_REACTOR_PAUSE,
  DEFAULT_AUTOMATION_THRESHOLD, DEFAULT_REACTOR_PAUSE, DEFAULT_INITIAL_HEAT,
} from '../data/bounds.js';

/**
 * The catalog is frozen data extracted from `ComponentFactory.java`'s ITEMS array on the desktop
 * tree. It is not regenerated in the web tree.
 *
 * Java's ITEMS is an array of constructed `ReactorItem` objects, so this materialises one live
 * component per entry rather than handing out the raw JSON: the derived automation threshold,
 * the field initialisers, and the mutability of the shared prototype are all part of what
 * `getDefaultComponent` has to behave like.
 *
 * @param text the JSON text of `web/data/components.json`
 * @returns {{ count, byId }} with `byId` indexed by id
 */
export function parseCatalog(text) {
  const parsed = JSON.parse(text);
  const byId = [];
  for (const entry of parsed.components) byId[entry.id] = blank(entry);
  return { count: parsed.count, byId };
}

// --- class-level statics ----------------------------------------------------------------------
// Java holds these as `private static volatile` on Reflector and FuelRod, written on the UI's
// event-dispatch path when the version toggle changes. They are module state, not per-component
// state, exactly as in the original.
let mcVersion = '1.12.2';
let gt509behavior = false;
let gtnhbehavior = false;

export function setMcVersion(newVersion) { mcVersion = newVersion ?? '1.12.2'; }
export function setGT509Behavior(value) { gt509behavior = !!value; }
export function setGTNHBehavior(value) { gtnhbehavior = !!value; }

/** Java's `(int)` cast: truncation toward zero, which is what `Math.trunc` already is. */
function intCast(value) {
  return Math.trunc(value);
}

/**
 * The constructor-derived automation threshold. The base class initialises the field to 9000
 * and the constructor body overwrites it only when one of the two branches applies, so a
 * component with `maxHeat == 1 && maxDamage == 1` keeps 9000.
 */
function derivedThreshold(maxDamage, maxHeat) {
  if (maxHeat > 1) return intCast(maxHeat * 0.9);
  if (maxDamage > 1) return intCast(maxDamage * 1.1);
  return DEFAULT_AUTOMATION_THRESHOLD;
}

// --- construction ---------------------------------------------------------------------------

/**
 * A component at rest: constructor fields plus simulation fields at their initialisers.
 *
 * @param entry one catalog entry
 * @returns {Object} a fresh component
 */
function blank(entry) {
  return {
    // identity and capacity -- final in Java, set once at construction
    kind: entry.class,
    id: entry.id,
    baseName: entry.baseName,
    nameKey: entry.name.i18n,
    image: entry.image.image,
    fallbackImage: entry.image.fallback ?? null,
    sourceMod: entry.sourceMod,
    maxDamage: entry.maxDamage,
    maxHeat: entry.maxHeat,
    // subclass-specific constructor arguments, present on every instance so all components
    // share one hidden class
    energyMult: entry.energyMult ?? 0,
    heatMult: entry.heatMult ?? 0,
    rodCount: entry.rodCount ?? 0,
    moxStyle: entry.moxStyle ?? false,
    heatBonus: entry.heatBonus ?? 0,
    selfVent: entry.selfVent ?? 0,
    hullDraw: entry.hullDraw ?? 0,
    sideVent: entry.sideVent ?? 0,
    switchSide: entry.switchSide ?? 0,
    switchReactor: entry.switchReactor ?? 0,
    heatAdjustment: entry.heatAdjustment ?? 0,
    explosionPowerMultiplier: entry.explosionPowerMultiplier ?? 1,
    mHeatBonusStep: entry.mHeatBonusStep ?? 0,
    mHeatBonusMultiplier: entry.mHeatBonusMultiplier ?? 0,
    // simulation settings
    initialHeat: DEFAULT_INITIAL_HEAT,
    automationThreshold: derivedThreshold(entry.maxDamage, entry.maxHeat),
    reactorPause: DEFAULT_REACTOR_PAUSE,
    // placement
    parent: null,
    row: -10,
    col: -10,
    // per-simulation state, at ReactorItem's field initialisers
    currentDamage: 0,
    currentHeat: 0,
    maxReachedHeat: 0,
    currentEUGenerated: 0,
    minEUGenerated: Number.MAX_VALUE,
    maxEUGenerated: 0,
    currentHeatGenerated: 0,
    minHeatGenerated: Number.MAX_VALUE,
    maxHeatGenerated: 0,
    currentHullHeating: 0,
    currentComponentHeating: 0,
    currentHullCooling: 0,
    currentVentCooling: 0,
    bestVentCooling: 0,
    currentCellCooling: 0,
    bestCellCooling: 0,
    currentCondensatorCooling: 0,
    bestCondensatorCooling: 0,
    // Java's `StringBuffer info`: the per-component report lines the UI renders per cell.
    info: [],
  };
}

/**
 * Java's protected copy constructor, which is deliberately narrower than the field list: it
 * copies the constructor fields and the three simulation settings, and nothing below the
 * "not to be copied" line. A placed component therefore starts a fresh simulation, but keeps
 * the user's initial heat, threshold, and pause.
 */
function copyComponent(source) {
  return {
    ...source,
    currentDamage: 0,
    currentHeat: 0,
    maxReachedHeat: 0,
    currentEUGenerated: 0,
    minEUGenerated: Number.MAX_VALUE,
    maxEUGenerated: 0,
    currentHeatGenerated: 0,
    minHeatGenerated: Number.MAX_VALUE,
    maxHeatGenerated: 0,
    currentHullHeating: 0,
    currentComponentHeating: 0,
    currentHullCooling: 0,
    currentVentCooling: 0,
    bestVentCooling: 0,
    currentCellCooling: 0,
    bestCellCooling: 0,
    currentCondensatorCooling: 0,
    bestCondensatorCooling: 0,
    info: [],
    parent: null,
    row: -10,
    col: -10,
  };
}

/**
 * The shared mutable prototype. Java returns `ITEMS[id]` itself, not a copy, and `ComponentFactory`
 * relies on callers going through `createComponent` to get a private one. Preserved, including
 * the aliasing: mutating the result of this mutates the catalog.
 */
export function getDefaultComponent(catalog, id) {
  return catalog.byId[id];
}

/** A private component, as every caller that places one should use. */
export function createComponent(catalog, id) {
  const prototype = catalog.byId[id];
  if (prototype === undefined) return null;
  return copyComponent(prototype);
}

/** The same, by the non-localized name. */
export function createComponentByName(catalog, baseName) {
  for (let id = 1; id <= catalog.count; id++) {
    if (catalog.byId[id]?.baseName === baseName) return createComponent(catalog, id);
  }
  return null;
}

export function getComponentCount(catalog) {
  return catalog.count;
}

// --- queries ----------------------------------------------------------------------------------

export function isBroken(component) {
  return component.currentHeat >= component.maxHeat || component.currentDamage >= component.maxDamage;
}

/** `maxHeat` of 1 means this component never accepts heat (though it might take damage). */
export function isHeatAcceptor(component) {
  return component.maxHeat > 1 && !isBroken(component);
}

export function isCoolable(component) {
  return component.maxHeat > 1 && component.kind !== 'Condensator';
}

/** Base returns false; Reflector and every FuelRod return `!isBroken()`. */
export function isNeutronReflector(component) {
  switch (component.kind) {
    case 'Reflector':
    case 'FuelRod':
    case 'GGFuelRod':
      return !isBroken(component);
    default:
      return false;
  }
}

/** Reflector overrides `getMaxDamage()` for the 1.7.10 damage values. */
export function getMaxDamage(component) {
  if (component.kind === 'Reflector' && component.maxDamage > 1 && mcVersion === '1.7.10') {
    return component.maxDamage / 3;
  }
  return component.maxDamage;
}

export function getRodCount(component) {
  return component.rodCount;
}

/**
 * The vent's side-vent contribution needs neighbours, so an unplaced vent reports only
 * `selfVent`. The `parent != null` half of that guard is what keeps a catalog prototype
 * queryable at all -- only `componentHeatVent` has a non-zero `sideVent`, and `parent` stays
 * null until `addToReactor` runs.
 */
export function getVentCoolingCapacity(component) {
  if (component.kind !== 'Vent') return 0;
  let result = component.selfVent;
  if (component.sideVent > 0 && component.parent !== null) {
    for (const neighbour of neighboursOf(component)) {
      if (neighbour !== null && isCoolable(neighbour)) result += component.sideVent;
    }
  }
  return result;
}

export function getHullCoolingCapacity(component) {
  if (component.kind === 'Vent') return component.hullDraw;
  if (component.kind === 'Exchanger') return component.switchReactor;
  return 0;
}

export function getExplosionPowerMultiplier(component) {
  return component.explosionPowerMultiplier;
}

export function getExplosionPowerOffset(component) {
  if (!isBroken(component)) {
    if (getRodCount(component) === 0 && isNeutronReflector(component)) return -1;
    return 2 * getRodCount(component);
  }
  return 0;
}

export function producesOutput(component) {
  return getVentCoolingCapacity(component) > 0 || getRodCount(component) > 0;
}

export function needsCoolantInjected(component) {
  if (component.kind !== 'Condensator') return false;
  return component.currentHeat > 0.85 * component.maxHeat;
}

export function getCurrentOutput(component) {
  switch (component.kind) {
    case 'Vent':
      return component.currentVentCooling;
    case 'FuelRod':
    case 'GGFuelRod':
      if (component.parent !== null) {
        return component.parent.isFluid() ? component.currentHeatGenerated : component.currentEUGenerated;
      }
      return 0;
    default:
      return 0;
  }
}

/** The vent's own heat bonus replaces the mode-derived one; vanilla rods derive it from the toggle. */
function getHeatBonus(component) {
  if (component.kind === 'GGFuelRod') return component.heatBonus;
  if (gt509behavior || component.sourceMod === 'GT5.09' || gtnhbehavior || component.sourceMod === 'GTNH') {
    return 1.5;
  }
  return 4.0;
}

/** Up, right, down, left -- the order the original uses everywhere. */
const DIRECTIONS = [[1, 0], [-1, 0], [0, -1], [0, 1]];

function neighboursOf(component) {
  const parent = component.parent;
  if (parent === null) return [];
  return DIRECTIONS.map(([dr, dc]) => parent.getComponentAt(component.row + dr, component.col + dc));
}

// --- the three user-facing setters -----------------------------------------------------------

/**
 * The guards are load-bearing, not defensive: a value the setter refuses is left alone rather
 * than clamped, which is what keeps `getCode()` from throwing on a design the writer cannot
 * describe.
 */
export function setInitialHeat(component, value) {
  if (isHeatAcceptor(component) && value >= 0 && value < component.maxHeat) {
    component.initialHeat = value;
  }
}

/**
 * Bounded to the range the code format can carry, deliberately not to this component's capacity:
 * a threshold above the component's own capacity is coherent intent ("never automate this part").
 */
export function setAutomationThreshold(component, value) {
  if ((component.maxHeat > 1 || component.maxDamage > 1) && value >= 0 && value <= MAX_AUTOMATION_THRESHOLD) {
    component.automationThreshold = value;
  }
}

export function setReactorPause(component, value) {
  if ((component.maxHeat > 1 || component.maxDamage > 1) && value >= 0 && value <= MAX_REACTOR_PAUSE) {
    component.reactorPause = value;
  }
}

// --- heat and damage primitives ---------------------------------------------------------------

/**
 * @param heat the adjustment (positive adds, negative removes)
 * @returns the amount refused, following the base class's sign convention
 */
export function adjustCurrentHeat(component, heat) {
  if (component.kind === 'Condensator') {
    // Condensator overrides the whole method, and returns the *positive* amount refused -- the
    // opposite sign to the base class. Preserved: no caller reads it, and changing it would be
    // an unrelated behaviour change.
    if (heat < 0.0) return heat;
    const acceptedHeat = Math.min(heat, component.maxHeat - component.currentHeat);
    component.currentHeat += acceptedHeat;
    component.maxReachedHeat = Math.max(component.maxReachedHeat, component.currentHeat);
    component.currentCondensatorCooling += acceptedHeat;
    component.bestCondensatorCooling = Math.max(component.currentCondensatorCooling, component.bestCondensatorCooling);
    return heat - acceptedHeat;
  }

  if (component.kind === 'CoolantCell' && heat > 0.0) {
    // Draining the cell is not "negative cooling"; only a positive adjustment counts toward the
    // running figure the report prints.
    component.currentCellCooling += heat;
    component.bestCellCooling = Math.max(component.currentCellCooling, component.bestCellCooling);
  }

  // Base class. isHeatAcceptor() folds in !isBroken(), deliberately: a component at capacity or
  // out of durability accepts nothing at all and reports the whole adjustment as refused.
  if (!isHeatAcceptor(component)) return heat;

  let result = 0.0;
  let tempHeat = component.currentHeat + heat;
  if (tempHeat > component.maxHeat) {
    result = component.maxHeat - tempHeat;
    tempHeat = component.maxHeat;
  } else if (tempHeat < 0.0) {
    result = tempHeat;
    tempHeat = 0.0;
  }
  component.currentHeat = tempHeat;
  component.maxReachedHeat = Math.max(component.maxReachedHeat, component.currentHeat);
  return result;
}

export function applyDamage(component, damage) {
  if (component.maxDamage > 1 && damage > 0.0) {
    component.currentDamage += damage;
  }
}

export function clearDamage(component) {
  component.currentDamage = 0.0;
}

/** Used when resetting a simulation. Note `currentHeat` returns to `initialHeat`, not to 0. */
export function clearCurrentHeat(component) {
  component.currentHeat = component.initialHeat;
  component.bestVentCooling = 0.0;
  component.bestCondensatorCooling = 0.0;
  component.bestCellCooling = 0.0;
  component.minEUGenerated = Number.MAX_VALUE;
  component.maxEUGenerated = 0.0;
  component.minHeatGenerated = Number.MAX_VALUE;
  component.maxHeatGenerated = 0.0;
  component.maxReachedHeat = component.initialHeat;
}

export function preReactorTick(component) {
  component.currentHullHeating = 0.0;
  component.currentComponentHeating = 0.0;
  component.currentHullCooling = 0.0;
  component.currentVentCooling = 0.0;
  component.currentCellCooling = 0.0;
  component.currentCondensatorCooling = 0.0;
  component.currentEUGenerated = 0;
  component.currentHeatGenerated = 0;
}

export function injectCoolant(component) {
  if (component.kind === 'Condensator') component.currentHeat = 0;
}

// --- placement -------------------------------------------------------------------------------

/**
 * Plating is the only subclass that changes the reactor on contact, and this is how `heatAdjustment`
 * becomes observable at all.
 *
 * @param parent a Reactor (Stage 3)
 * @param row
 * @param col
 */
export function addToReactor(component, parent, row, col) {
  removeFromReactor(component);
  if (component.kind === 'Plating' && parent !== null) {
    parent.adjustMaxHeat(component.heatAdjustment);
  }
  component.parent = parent;
  component.row = row;
  component.col = col;
}

export function removeFromReactor(component) {
  if (component.kind === 'Plating' && component.parent !== null) {
    component.parent.adjustMaxHeat(-component.heatAdjustment);
  }
  component.parent = null;
  component.row = -10;
  component.col = -10;
}

// --- the four per-tick actions -----------------------------------------------------------------
// Every one of these is called by `AutomationSimulator` once per reactor tick per component, so
// the Java integer arithmetic they were written against has to survive the port: `heat / size`
// and `heat % size` in `handleHeat`, `heat / rodCount` in `handleGTHeat`, and `rodCount / 2` in
// both `getHeat` and `getEnergy` are integer operations in Java and truncating them is what makes
// a quad rod's heat figure come out right. `intCast` is the port's spelling of that.

/** FuelRod's `DIRECTIONS`: down, up, left, right -- the order the remainder heat is handed out in. */
const ROD_DIRECTIONS = [[1, 0], [-1, 0], [0, -1], [0, 1]];
/** `Exchanger#transfer` and `Vent#dissipate` walk left, right, up, down instead. */
const SIDE_DIRECTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
/** `Reflector#generateHeat` and `BreederCell#generateHeat` walk up, right, down, left. */
const AROUND_DIRECTIONS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

function heatableNeighbours(component, directions) {
  const out = [];
  for (const [dr, dc] of directions) {
    const neighbour = component.parent.getComponentAt(component.row + dr, component.col + dc);
    if (neighbour !== null && isHeatAcceptor(neighbour)) out.push(neighbour);
  }
  return out;
}

function neutronNeighbourCount(component) {
  let count = 0;
  for (const [dr, dc] of ROD_DIRECTIONS) {
    const neighbour = component.parent.getComponentAt(component.row + dr, component.col + dc);
    if (neighbour !== null && isNeutronReflector(neighbour)) count++;
  }
  return count;
}

/** Rods contribute their own rod count; a Reflector contributes the asking rod's count. */
function neutronNumberCount(component) {
  let count = 0;
  for (const [dr, dc] of ROD_DIRECTIONS) {
    const neighbour = component.parent.getComponentAt(component.row + dr, component.col + dc);
    if (neighbour === null || !isNeutronReflector(neighbour)) continue;
    if (neighbour.kind === 'FuelRod' || neighbour.kind === 'GGFuelRod') count += neighbour.rodCount;
    else if (neighbour.kind === 'Reflector') count += component.rodCount;
  }
  return count;
}

/**
 * @param component
 * @returns {Number} the heat this component generated this tick
 */
export function generateHeat(component) {
  switch (component.kind) {
    case 'FuelRod':
    case 'GGFuelRod': {
      const pulses = neutronNeighbourCount(component) + 1 + intCast(component.rodCount / 2);
      let heat = intCast(component.heatMult * pulses * (pulses + 1));
      if (component.moxStyle && component.parent.isFluid()
          && component.parent.getCurrentHeat() / component.parent.getMaxHeat() > 0.5) {
        heat *= 2;
      }
      component.currentHeatGenerated = heat;
      component.minHeatGenerated = Math.min(component.minHeatGenerated, heat);
      component.maxHeatGenerated = Math.max(component.maxHeatGenerated, heat);
      if (gt509behavior || gtnhbehavior) handleGTHeat(component, heat);
      else handleHeat(component, heat);
      return heat;
    }
    case 'Reflector': {
      // A Reflector generates nothing but damage: every neighbour's rod count, whatever that
      // component is (a non-rod contributes 0), which is how a rod next to a reflector corrodes.
      for (const [dr, dc] of AROUND_DIRECTIONS) {
        applyDamage(component, component.parent.getComponentAt(component.row + dr, component.col + dc)?.rodCount ?? 0);
      }
      return 0;
    }
    case 'BreederCell': {
      for (const [dr, dc] of AROUND_DIRECTIONS) {
        const neighbour = component.parent.getComponentAt(component.row + dr, component.col + dc);
        if (neighbour === null || neighbour.kind !== 'FuelRod' && neighbour.kind !== 'GGFuelRod') continue;
        const targetDamage = 1 + component.parent.getCurrentHeat() / component.mHeatBonusStep * component.mHeatBonusMultiplier;
        for (let i = 0; i < neighbour.rodCount; i++) applyDamage(component, targetDamage);
      }
      return 0;
    }
    default:
      return 0;
  }
}

function handleHeat(component, heat) {
  const heatable = heatableNeighbours(component, ROD_DIRECTIONS);
  if (heatable.length === 0) {
    component.parent.adjustCurrentHeat(heat);
    component.currentHullHeating = heat;
    return;
  }
  component.currentComponentHeating = heat;
  const share = intCast(heat / heatable.length);
  for (const neighbour of heatable) adjustCurrentHeat(neighbour, share);
  adjustCurrentHeat(heatable[0], heat % heatable.length);
}

/** GT 5.09's spread: a per-rod budget, then handed out one acceptor at a time. */
function handleGTHeat(component, heat) {
  const heatable = heatableNeighbours(component, SIDE_DIRECTIONS);
  if (heatable.length === 0) {
    component.parent.adjustCurrentHeat(heat);
    component.currentHullHeating = heat;
    return;
  }
  component.currentComponentHeating = heat;
  let everCycleHeat = intCast(heat / component.rodCount);
  for (let i = 0; i < heatable.length; i++) {
    const toNeighborHeat = intCast(everCycleHeat / (heatable.length - i));
    everCycleHeat -= toNeighborHeat;
    adjustCurrentHeat(heatable[i], component.rodCount * toNeighborHeat);
  }
}

/**
 * @param component
 * @returns {Number} the EU this component generated this tick
 */
export function generateEnergy(component) {
  if (component.kind !== 'FuelRod' && component.kind !== 'GGFuelRod') return 0;
  const ratio = component.parent.getCurrentHeat() / component.parent.getMaxHeat();
  let energy;
  if (gtnhbehavior || component.sourceMod === 'GTNH') {
    // GTNH scales off the *number* of neutron-producing neighbours, not their count.
    const energyMulti = component.energyMult * 10 * (1 + intCast(component.rodCount / 2));
    const coefficient = (component.energyMult * 10) / component.rodCount;
    energy = energyMulti + coefficient * neutronNumberCount(component);
  } else {
    const pulses = neutronNeighbourCount(component) + 1 + intCast(component.rodCount / 2);
    energy = component.energyMult * pulses;
    if (gt509behavior || component.sourceMod === 'GT5.09') energy *= 2;
  }
  if (component.moxStyle) energy *= 1 + getHeatBonus(component) * ratio;
  component.minEUGenerated = Math.min(component.minEUGenerated, energy);
  component.maxEUGenerated = Math.max(component.maxEUGenerated, energy);
  component.currentEUGenerated = energy;
  component.parent.addEUOutput(energy);
  applyDamage(component, 1.0);
  return energy;
}

/**
 * @param component
 * @returns {Number} the heat this component successfully vented this tick
 */
export function dissipate(component) {
  if (component.kind !== 'Vent') return 0;
  const deltaHeat = Math.min(component.hullDraw, component.parent.getCurrentHeat());
  component.currentHullCooling = deltaHeat;
  component.parent.adjustCurrentHeat(-deltaHeat);
  adjustCurrentHeat(component, deltaHeat);
  const currentDissipation = Math.min(component.selfVent, component.currentHeat);
  component.currentVentCooling = currentDissipation;
  component.parent.ventHeat(currentDissipation);
  adjustCurrentHeat(component, -currentDissipation);
  if (component.sideVent > 0) {
    for (const neighbour of heatableNeighbours(component, SIDE_DIRECTIONS)) {
      if (!isCoolable(neighbour)) continue;
      const rejectedCooling = adjustCurrentHeat(neighbour, -component.sideVent);
      const tempDissipatedHeat = component.sideVent + rejectedCooling;
      component.parent.ventHeat(tempDissipatedHeat);
      component.currentVentCooling += tempDissipatedHeat;
    }
  }
  component.bestVentCooling = Math.max(component.bestVentCooling, component.currentVentCooling);
  return currentDissipation;
}

/**
 * `Exchanger` is the only component that moves heat between cells, and it does the side pass and
 * the reactor pass in sequence. The two passes are not the same arithmetic: the side pass works in
 * `double add` and the reactor pass in `int add`, so the cascade's `switchReactor / 8` truncates
 * where the side cascade's `switchSide / 8` is already exact. Preserved rather than unified.
 */
export function transfer(component) {
  if (component.kind !== 'Exchanger') return;
  const heatable = heatableNeighbours(component, SIDE_DIRECTIONS);
  let myHeat = 0;
  if (component.switchSide > 0) {
    const mymed = component.currentHeat * 100.0 / component.maxHeat;
    for (const neighbour of heatable) {
      const heatablemed = neighbour.currentHeat * 100.0 / neighbour.maxHeat;
      let add = intCast(neighbour.maxHeat / 100.0 * (heatablemed + mymed / 2.0));
      if (add > component.switchSide) add = component.switchSide;
      if (heatablemed + mymed / 2.0 < 1.0) add = intCast(component.switchSide / 2);
      if (heatablemed + mymed / 2.0 < 0.75) add = intCast(component.switchSide / 4);
      if (heatablemed + mymed / 2.0 < 0.5) add = intCast(component.switchSide / 8);
      if (heatablemed + mymed / 2.0 < 0.25) add = 1;
      if (javaRound(heatablemed * 10.0) / 10.0 > javaRound(mymed * 10.0) / 10.0) add -= 2 * add;
      else if (javaRound(heatablemed * 10.0) / 10.0 === javaRound(mymed * 10.0) / 10.0) add = 0;
      myHeat -= add;
      adjustCurrentHeat(neighbour, add);
    }
  }
  if (component.switchReactor > 0) {
    const mymed = component.currentHeat * 100.0 / component.maxHeat;
    const reactormed = component.parent.getCurrentHeat() * 100.0 / component.parent.getMaxHeat();
    let add = javaRound(component.parent.getMaxHeat() / 100.0 * (reactormed + mymed / 2.0));
    if (add > component.switchReactor) add = component.switchReactor;
    if (reactormed + mymed / 2.0 < 1.0) add = intCast(component.switchReactor / 2);
    if (reactormed + mymed / 2.0 < 0.75) add = intCast(component.switchReactor / 4);
    if (reactormed + mymed / 2.0 < 0.5) add = intCast(component.switchReactor / 8);
    if (reactormed + mymed / 2.0 < 0.25) add = 1;
    if (javaRound(reactormed * 10.0) / 10.0 > javaRound(mymed * 10.0) / 10.0) add = intCast(add - 2 * add);
    else if (javaRound(reactormed * 10.0) / 10.0 === javaRound(mymed * 10.0) / 10.0) add = 0;
    myHeat -= add;
    component.parent.adjustCurrentHeat(add);
  }
  adjustCurrentHeat(component, myHeat);
}

/** Java's `Math.round` on a double: half away from zero, not JS's half toward positive infinity. */
function javaRound(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
