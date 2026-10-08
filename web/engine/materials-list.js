/**
 * A multiset of material names with counts, used by the report for "Components replaced:".
 *
 * Port of `MaterialsList.java`. The whole class lives here now: `add(name)` from
 * `AutomationSimulator#handleAutomation`, `toString()` for `Simulation.ComponentsReplaced`, and
 * the shopping-list half (`buildComponentMaterialsMap`, the three static switches, and
 * `getMaterialsForComponent`), which `Reactor.getMaterials` reads to fill the panel.
 *
 * The switches are module-level state exactly as Java has it -- `ReactorPlannerFrame` calls
 * `MaterialsList.setUseUfcForCoolantCells(...)` with no receiver -- and the map is built lazily on
 * first read rather than at class-initialisation time, because the bundle is not loaded when this
 * module is imported. Same defaults, same rebuild-on-write rule: every setter recomputes the whole
 * map, so a recipe is never read through a stale table.
 *
 * `materials` is a `Map`, and iteration is sorted -- Java backs it with a `TreeMap`, so the report
 * lists materials in `String.compareTo` order, which is UTF-16 code-unit order. JS's default sort
 * is the same comparison, so `keys()` sorts rather than relying on insertion order.
 *
 * @see src/Ic2ExpReactorPlanner/MaterialsList.java
 */

import { getI18n } from './i18n.js';
import { formatDecimal, stringFormat } from './format.js';

export class MaterialsList {
  #materials;

  constructor() {
    this.#materials = new Map();
  }

  /**
   * Java's variadic `add(Object...)`: a bare name counts 1, a number before a name or sublist is
   * its count, and a sublist's counts are multiplied in. Only the first two forms are reachable
   * from the simulator, but the rule is short and the third is what the shopping list needs.
   *
   * @param materials names, counts, and/or other MaterialsList objects
   */
  add(...materials) {
    let itemCount = 1;
    for (const material of materials) {
      if (typeof material === 'string') {
        this.#materials.set(material, (this.#materials.get(material) ?? 0) + itemCount);
        itemCount = 1;
      } else if (typeof material === 'number') {
        itemCount = material;
      } else if (material instanceof MaterialsList) {
        for (const [key, value] of material.#materials) {
          this.#materials.set(key, (this.#materials.get(key) ?? 0) + itemCount * value);
        }
        itemCount = 1;
      } else {
        throw new TypeError(`Invalid material type: ${typeof material}`);
      }
    }
  }

  /** The counts in Java's `TreeMap` order, which is what the report and the comparison view print. */
  entries() {
    const keys = [...this.#materials.keys()];
    keys.sort();
    return keys.map((key) => [key, this.#materials.get(key)]);
  }

  size() {
    return this.#materials.size;
  }

  toString() {
    const format = getI18n('UI.MaterialDecimalFormat');
    let result = '';
    for (const [key, count] of this.entries()) {
      result += `${formatDecimal(format, count)} ${key}\n`;
    }
    return result;
  }

  /**
   * The comparison view's materials diff: one coloured line per material present on either side.
   *
   * @param rhs the other list
   * @param alwaysDiff emit equal entries too
   * @returns {String} HTML fragments, as the bundle's `Comparison.MaterialsEntry` spells them
   */
  buildComparisonString(rhs, alwaysDiff) {
    const keys = new Set([...this.#materials.keys(), ...rhs.#materials.keys()]);
    const sorted = [...keys];
    sorted.sort();
    const comparisonFormat = getI18n('Comparison.CompareDecimalFormat');
    const simpleFormat = getI18n('Comparison.SimpleDecimalFormat');
    const entry = getI18n('Comparison.MaterialsEntry');
    let result = '';
    for (const key of sorted) {
      const left = this.#materials.get(key) ?? 0;
      const right = rhs.#materials.get(key) ?? 0;
      let color = 'orange';
      if (left < right) color = 'green';
      else if (left > right) color = 'red';
      if (alwaysDiff || left !== right) {
        result += stringFormat(entry, color, formatDecimal(comparisonFormat, left - right), key,
          formatDecimal(simpleFormat, left), formatDecimal(simpleFormat, right));
      }
    }
    return result;
  }
}

/** Copy a list, which is how the simulator hands its result to `SimulationData`. */
export function copyMaterialsList(source) {
  const copy = new MaterialsList();
  for (const [key, value] of source.entries()) copy.add(value, key);
  return copy;
}

/* -----------------------------------------------------------------------------------------------
 * The shopping list. Everything below is the component -> materials table and the three switches
 * that rebuild it, as `MaterialsList.java` has them.
 *
 * `MaterialName.*` lookups are resolved when the table is built, not at import time, and the
 * `=Helium` quirk in the bundle (`MaterialName.Helium==Helium`) is kept verbatim: Java's
 * `PropertiesReader` skips whitespace after the separator but not a second `=`, so the desktop's
 * helium coolant cells really do print `=Helium` in their shopping list.
 * ----------------------------------------------------------------------------------------------- */

/** Java's material-name constants, keyed by the constant's own name. */
let names = null;

function materialNames() {
  if (names === null) {
    names = {
      ALUMINIUM: getI18n('MaterialName.Aluminium'),
      BERYLLIUM: getI18n('MaterialName.Beryllium'),
      BRONZE: getI18n('MaterialName.Bronze'),
      CALLISTOICEDUST: getI18n('MaterialName.CallistoIceDust'),
      CESIUM: getI18n('MaterialName.CesiumFuel'),
      COAL: getI18n('MaterialName.Coal'),
      COAXIUM: getI18n('MaterialName.CoaxiumFuel'),
      COPPER: getI18n('MaterialName.Copper'),
      DIAMOND: getI18n('MaterialName.Diamond'),
      DISTILLED_WATER: getI18n('MaterialName.DistilledWater'),
      EMPTY_CELL: getI18n('MaterialName.EmptyCell'),
      ENRICHEDNAQUADAH: getI18n('MaterialName.EnrichedNaquadah'),
      FLUXEDELECTRUM: getI18n('MaterialName.FluxedElectrum'),
      GLASS: getI18n('MaterialName.Glass'),
      GLOWSTONE: getI18n('MaterialName.GlowstoneDust'),
      GOLD: getI18n('MaterialName.Gold'),
      GRAPHITE: getI18n('MaterialName.Graphite'),
      HELIUM: getI18n('MaterialName.Helium'),
      IRIDIUM: getI18n('MaterialName.Iridium'),
      IRON: getI18n('MaterialName.Iron'),
      LAPIS: getI18n('MaterialName.LapisLazuli'),
      LEAD: getI18n('MaterialName.Lead'),
      LEDOXDUST: getI18n('MaterialName.LedoxDust'),
      MOX: getI18n('MaterialName.MoxFuel'),
      NAQUADRIA: getI18n('MaterialName.Naquadria'),
      NEUTRONIUM: getI18n('MaterialName.Neutronium'),
      PLATINUM: getI18n('MaterialName.Platinum'),
      POTASSIUM: getI18n('MaterialName.Potassium'),
      REDSTONE: getI18n('MaterialName.Redstone'),
      REINFORCEDGLASS: getI18n('MaterialName.ReinforcedGlass'),
      RUBBER: getI18n('MaterialName.Rubber'),
      SODIUM: getI18n('MaterialName.Sodium'),
      THORIUM: getI18n('MaterialName.Thorium'),
      TIBERIUM: getI18n('MaterialName.Tiberium'),
      TIN: getI18n('MaterialName.Tin'),
      TUNGSTEN: getI18n('MaterialName.Tungsten'),
      URANIUM: getI18n('MaterialName.UraniumFuel'),
      U238: getI18n('MaterialName.U238'),
      CARBON: getI18n('MaterialName.Carbon'),
      ZIRCALOY_2: getI18n('MaterialName.ZIRCALOY_2'),
      ZIRCALOY_4: getI18n('MaterialName.ZIRCALOY_4'),
      Pu239: getI18n('MaterialName.Pu239'),
      HSS_S: getI18n('MaterialName.HSS_S'),
      LIQUID_URANIUM: getI18n('MaterialName.LiquidUranium'),
      LIQUID_PLUTONIUM: getI18n('MaterialName.LiquidPlutonium'),
      ADVANCED_ALLOY: getI18n('MaterialName.AdvancedAlloy'),
      BASIC_CIRCUIT: getI18n('MaterialName.BasicCircuit'),
      ADVANCED_CIRCUIT: getI18n('MaterialName.AdvancedCircuit'),
    };
  }
  return names;
}

/** The three switches, as Java's static fields. */
let gtVersion = 'none';
let useUfcForCoolantCells = false;
let expandAdvancedAlloy = false;

/** The lists that a switch can replace. Built once the bundle is available. */
let basicCircuit = null;
let advancedCircuit = null;
let alloy = null;
let coolantCell = null;
let iridiumPlate = null;

/** The lists that no switch touches. */
let tinCasing = null;
let coil = null;
let electricMotor = null;
let ironBars = null;
let glassPane = null;
let tinAlloy = null;

let componentMaterialsMap = null;

/** A spec token that means "the list already built for this other component". */
function ref(key) {
  return { ref: key };
}

/**
 * Builds one list from a spec: the same token sequence Java passes to `new MaterialsList(...)`.
 *
 * @param spec counts, material names, and `ref(key)` lookups into `built`
 * @param built the map being built, for `ref` tokens
 */
function buildList(spec, built) {
  const args = spec.map((token) => {
    if (token instanceof MaterialsList) return token;
    if (typeof token === 'object') return built.get(token.ref);
    return token;
  });
  const list = new MaterialsList();
  list.add(...args); // one call, so a count still applies to the token that follows it
  return list;
}

/** Java's `buildComponentMaterialsMap`, in the same insertion order so the `ref` lookups resolve. */
function buildComponentMaterialsMap() {
  const m = materialNames();
  const result = new Map();
  const put = (key, spec) => result.set(key, buildList(spec, result));

  put('fuelRodUranium', [m.IRON, m.URANIUM]);
  put('dualFuelRodUranium', [m.IRON, 2, ref('fuelRodUranium')]);
  put('quadFuelRodUranium', [3, m.IRON, 2, m.COPPER, 4, ref('fuelRodUranium')]);
  put('fuelRodMox', [m.IRON, m.MOX]);
  put('dualFuelRodMox', [m.IRON, 2, ref('fuelRodMox')]);
  put('quadFuelRodMox', [3, m.IRON, 2, m.COPPER, 4, ref('fuelRodMox')]);
  if (gtVersion === '5.09') {
    put('neutronReflector', [6, tinAlloy, 2, m.GRAPHITE, m.BERYLLIUM]);
    put('thickNeutronReflector', [4, ref('neutronReflector'), 2, m.BERYLLIUM]);
  } else {
    put('neutronReflector', [m.COPPER, 4, m.TIN, 4, m.COAL]);
    put('thickNeutronReflector', [4, ref('neutronReflector'), 5, m.COPPER]);
  }
  if (gtVersion === '5.08' || gtVersion === '5.09') {
    put('heatVent', [4, m.ALUMINIUM, 4, ironBars]);
  } else {
    put('heatVent', [electricMotor, 4, m.IRON, 4, ironBars]);
  }
  put('advancedHeatVent', [2, ref('heatVent'), 6, ironBars, m.DIAMOND]);
  put('reactorHeatVent', [ref('heatVent'), 8, m.COPPER]);
  put('componentHeatVent', [ref('heatVent'), 4, m.TIN, 4, ironBars]);
  put('overclockedHeatVent', [ref('reactorHeatVent'), 4, m.GOLD]);
  put('coolantCell10k', [coolantCell, 4, m.TIN]);
  put('coolantCell30k', [3, ref('coolantCell10k'), 6, m.TIN]);
  put('coolantCell60k', [2, ref('coolantCell30k'), 6, m.TIN, m.IRON]);
  put('heatExchanger', [basicCircuit, 3, m.TIN, 5, m.COPPER]);
  put('advancedHeatExchanger', [2, ref('heatExchanger'), 2, basicCircuit, m.COPPER, 4, m.LAPIS]);
  put('coreHeatExchanger', [ref('heatExchanger'), 8, m.COPPER]);
  put('componentHeatExchanger', [ref('heatExchanger'), 4, m.GOLD]);
  put('reactorPlating', [m.LEAD, alloy]);
  put('heatCapacityReactorPlating', [ref('reactorPlating'), 8, m.COPPER]);
  if (gtVersion === '5.08' || gtVersion === '5.09') {
    put('containmentReactorPlating', [ref('reactorPlating'), m.LEAD]);
  } else {
    put('containmentReactorPlating', [ref('reactorPlating'), 2, alloy]);
  }
  put('rshCondensator', [ref('heatVent'), ref('heatExchanger'), 7, m.REDSTONE]);
  put('lzhCondensator', [2, ref('rshCondensator'), ref('reactorHeatVent'), ref('coreHeatExchanger'),
    9, m.LAPIS, 4, m.REDSTONE]);
  put('fuelRodThorium', [m.IRON, 3, m.THORIUM]);
  put('dualFuelRodThorium', [m.IRON, 2, ref('fuelRodThorium')]);
  put('quadFuelRodThorium', [3, m.IRON, 2, m.COPPER, 4, ref('fuelRodThorium')]);
  put('coolantCellHelium60k', [m.EMPTY_CELL, m.HELIUM, 4, m.TIN]);
  put('coolantCellHelium180k', [3, ref('coolantCellHelium60k'), 6, m.TIN]);
  put('coolantCellHelium360k', [2, ref('coolantCellHelium180k'), 6, m.TIN, 9, m.COPPER]);
  put('coolantCellNak60k', [ref('coolantCell10k'), 4, m.TIN, 2, m.POTASSIUM, 2, m.SODIUM]);
  put('coolantCellNak180k', [3, ref('coolantCellNak60k'), 6, m.TIN]);
  put('coolantCellNak360k', [2, ref('coolantCellNak180k'), 6, m.TIN, 9, m.COPPER]);
  put('iridiumNeutronReflector', [6, ref('thickNeutronReflector'), 18, m.COPPER, iridiumPlate]);
  put('fuelRodNaquadah', [m.IRON, 3, m.ENRICHEDNAQUADAH]);
  put('dualFuelRodNaquadah', [m.IRON, 2, ref('fuelRodNaquadah')]);
  put('quadFuelRodNaquadah', [3, m.IRON, 2, m.COPPER, 4, ref('fuelRodNaquadah')]);
  put('fuelRodCoaxium', [4, m.IRIDIUM, 36, m.DIAMOND, 3, m.COAXIUM]);
  put('dualFuelRodCoaxium', [m.IRON, 2, ref('fuelRodCoaxium')]);
  put('quadFuelRodCoaxium', [3, m.IRON, 2, m.COPPER, 4, ref('fuelRodCoaxium')]);
  put('fuelRodCesium', [m.IRON, 3, m.CESIUM]);
  put('dualFuelRodCesium', [m.IRON, 2, ref('fuelRodCesium')]);
  put('quadFuelRodCesium', [3, m.IRON, 2, m.COPPER, 4, ref('fuelRodCesium')]);
  put('fuelRodNaquadahGTNH', [4, m.IRON, 4, m.TUNGSTEN, 1, m.PLATINUM, 3, m.ENRICHEDNAQUADAH]);
  put('dualFuelRodNaquadahGTNH', [m.IRON, m.TUNGSTEN, 2, ref('fuelRodNaquadahGTNH')]);
  put('quadFuelRodNaquadahGTNH', [3, m.IRON, 3, m.TUNGSTEN, 4, ref('fuelRodNaquadahGTNH')]);
  put('fuelRodNaquadria', [4, m.IRON, 4, m.TUNGSTEN, 1, m.PLATINUM, 3, m.NAQUADRIA]);
  put('dualFuelRodNaquadria', [m.IRON, m.TUNGSTEN, 2, ref('fuelRodNaquadria')]);
  put('quadFuelRodNaquadria', [3, m.IRON, 3, m.TUNGSTEN, 4, ref('fuelRodNaquadria')]);
  put('fuelRodTiberium', [4, m.IRON, 4, m.TUNGSTEN, 1, m.PLATINUM, 3, m.TIBERIUM]);
  put('dualFuelRodTiberium', [m.IRON, m.TUNGSTEN, 2, ref('fuelRodTiberium')]);
  put('quadFuelRodTiberium', [3, m.IRON, 3, m.TUNGSTEN, 4, ref('fuelRodTiberium')]);
  put('fuelRodTheCore', [96, m.IRON, 96, m.TUNGSTEN, 128, m.TIBERIUM, 32, ref('fuelRodNaquadah')]);
  put('coolantCellSpace180k', [0.5, m.CALLISTOICEDUST, 0.5, m.LEDOXDUST, 1000, m.DISTILLED_WATER,
    m.LAPIS, m.REINFORCEDGLASS, 2, m.IRON, 2, m.TUNGSTEN]);
  put('coolantCellSpace360k', [1.5, m.IRON, 1.5, m.TUNGSTEN, 2, ref('coolantCellSpace180k')]);
  put('coolantCellSpace540k', [3, m.IRON, 3, m.TUNGSTEN, 3, ref('coolantCellSpace180k')]);
  put('coolantCellSpace1080k', [3, m.IRON, 3, m.TUNGSTEN, 9, m.FLUXEDELECTRUM,
    3, ref('coolantCellSpace540k')]);
  put('coolantCellNeutronium1G', [72, m.NEUTRONIUM, 4, m.IRIDIUM]);
  put('advancedFuelRod', [4, m.ZIRCALOY_4, 1.0 / 2, m.ZIRCALOY_2]);
  put('fuelRodCompressedUranium', [108, m.GRAPHITE, 36, m.U238, 9, m.TUNGSTEN, 9, m.CARBON,
    ref('advancedFuelRod')]);
  put('dualFuelRodCompressedUranium', [2, ref('fuelRodCompressedUranium'), 2, m.ZIRCALOY_2]);
  put('quadFuelRodCompressedUranium', [2, ref('dualFuelRodCompressedUranium'), 2, m.ZIRCALOY_2]);
  put('fuelRodCompressedPlutonium', [45, m.Pu239, 9, m.U238, 36, m.CARBON, 18, m.HSS_S,
    ref('advancedFuelRod')]);
  put('dualFuelRodCompressedPlutonium', [2, ref('fuelRodCompressedPlutonium'), 2, m.ZIRCALOY_2]);
  put('quadFuelRodCompressedPlutonium', [2, ref('dualFuelRodCompressedPlutonium'), 2, m.ZIRCALOY_2]);
  put('fuelRodLiquidUranium', [250, m.LIQUID_URANIUM, ref('advancedFuelRod')]);
  put('dualFuelRodLiquidUranium', [2, ref('fuelRodLiquidUranium'), 2, m.ZIRCALOY_2]);
  put('quadFuelRodLiquidUranium', [2, ref('dualFuelRodLiquidUranium'), 2, m.ZIRCALOY_2]);
  put('fuelRodLiquidPlutonium', [250, m.LIQUID_PLUTONIUM, ref('advancedFuelRod')]);
  put('dualFuelRodLiquidPlutonium', [2, ref('fuelRodLiquidPlutonium'), 2, m.ZIRCALOY_2]);
  put('quadFuelRodLiquidPlutonium', [2, ref('fuelRodLiquidPlutonium'), 2, m.ZIRCALOY_2]);
  put('fuelRodGlowstone', [9, m.GLOWSTONE, 250, m.HELIUM]);
  return result;
}

/** The lists no switch replaces, and the ones the default switches imply. */
function initLists() {
  const m = materialNames();
  tinCasing = buildList([0.5, m.TIN], new Map());
  coil = buildList([m.IRON, 8.0 / 3, m.COPPER], new Map());
  electricMotor = buildList([m.IRON, 2, coil, 2, tinCasing], new Map());
  ironBars = buildList([6.0 / 16, m.IRON], new Map());
  glassPane = buildList([6.0 / 16, m.GLASS], new Map());
  tinAlloy = buildList([0.5, m.TIN, 0.5, m.IRON], new Map());
  basicCircuit = buildList([m.IRON, 2, m.REDSTONE, 2, m.COPPER, 6, m.RUBBER], new Map());
  advancedCircuit = buildList([basicCircuit, 4, m.REDSTONE, 2, m.LAPIS, 2, m.GLOWSTONE], new Map());
  alloy = buildList([m.ADVANCED_ALLOY], new Map());
  coolantCell = buildList([1.0 / 3, m.TIN, m.DISTILLED_WATER, m.LAPIS], new Map());
  iridiumPlate = buildList([4, m.IRIDIUM, 4, alloy, m.DIAMOND], new Map());
}

function ensureBuilt() {
  if (componentMaterialsMap === null) {
    initLists();
    componentMaterialsMap = buildComponentMaterialsMap();
  }
}

/** Java's `setUseUfcForCoolantCells`. */
export function setUseUfcForCoolantCells(value) {
  useUfcForCoolantCells = value;
  ensureBuilt();
  const m = materialNames();
  coolantCell = value
    ? buildList([4, tinCasing, glassPane, m.DISTILLED_WATER, m.LAPIS], new Map())
    : buildList([1.0 / 3, m.TIN, m.DISTILLED_WATER, m.LAPIS], new Map());
  componentMaterialsMap = buildComponentMaterialsMap();
}

/** Java's `setExpandAdvancedAlloy`. */
export function setExpandAdvancedAlloy(value) {
  expandAdvancedAlloy = value;
  ensureBuilt();
  const m = materialNames();
  alloy = value
    ? buildList([3.0 / 2, m.IRON, 3.0 / 2, m.BRONZE, 3.0 / 2, m.TIN], new Map())
    : buildList([m.ADVANCED_ALLOY], new Map());
  iridiumPlate = buildList([4, m.IRIDIUM, 4, alloy, m.DIAMOND], new Map());
  componentMaterialsMap = buildComponentMaterialsMap();
}

/** Java's `setGTVersion`. */
export function setGTVersion(value) {
  gtVersion = value;
  ensureBuilt();
  const m = materialNames();
  if (value === '5.08' || value === '5.09') {
    coolantCell = buildList([m.EMPTY_CELL, m.DISTILLED_WATER, m.LAPIS], new Map());
    alloy = buildList([m.ADVANCED_ALLOY], new Map());
    basicCircuit = buildList([m.BASIC_CIRCUIT], new Map());
    advancedCircuit = buildList([m.ADVANCED_CIRCUIT], new Map());
  } else {
    basicCircuit = buildList([m.IRON, 2, m.REDSTONE, 2, m.COPPER, 6, m.RUBBER], new Map());
    advancedCircuit = buildList([basicCircuit, 4, m.REDSTONE, 2, m.LAPIS, 2, m.GLOWSTONE], new Map());
    coolantCell = useUfcForCoolantCells
      ? buildList([4, tinCasing, glassPane, m.DISTILLED_WATER, m.LAPIS], new Map())
      : buildList([1.0 / 3, m.TIN, m.DISTILLED_WATER, m.LAPIS], new Map());
    alloy = expandAdvancedAlloy
      ? buildList([3.0 / 2, m.IRON, 3.0 / 2, m.BRONZE, 3.0 / 2, m.TIN], new Map())
      : buildList([m.ADVANCED_ALLOY], new Map());
  }
  iridiumPlate = buildList([4, m.IRIDIUM, 4, alloy, m.DIAMOND], new Map());
  componentMaterialsMap = buildComponentMaterialsMap();
}

/** Java's `getMaterialsForComponent`: keyed by `baseName`, and null when there is no recipe. */
export function getMaterialsForComponent(component) {
  ensureBuilt();
  return componentMaterialsMap.get(component.baseName);
}

/** The current switch settings, for the panel that shows them. */
export function switches() {
  return { gtVersion, useUfcForCoolantCells, expandAdvancedAlloy };
}
