/**
 * The simulation engine: the reactor tick loop, the report it publishes, and the `SimulationData`
 * it leaves behind.
 *
 * Port of `AutomationSimulator.java`. The Swing half is gone -- `JTextArea output`,
 * `JPanel[][] reactorButtonPanels`, `SwingWorker`, `firePropertyChange` -- but its *observable*
 * half is not: `publish()` routes through `process()`, which drops the `R%dC%d:0xRRGGBB` cell
 * chunks (they recolour a button) and clears the report on an empty chunk. The corpus baseline is
 * that report with the wall-clock line removed, so the routing has to be ported exactly or every
 * hash moves for a reason no simulation behaviour explains.
 *
 * Three Java features get a deliberate translation here:
 * - `do { } while (... && !isCancelled())` becomes a plain loop; cancellation is a Swing UI
 *   concern and the corpus never cancels.
 * - `csvOut` is always `null` in the corpus, so the CSV branch is kept as a callback rather than
 *   a file handle: `onCsvRow` receives the same values the Java writer would have formatted.
 * - `System.nanoTime()` around the loop feeds `Simulation.ElapsedTime`, the one line the baseline
 *   strips. It stays, because the web UI shows it, but the test strips it the same way.
 *
 * @see src/Ic2ExpReactorPlanner/AutomationSimulator.java, ../testResources/corpus-baseline.txt
 */

import { getI18n, formatI18n } from './i18n.js';
import { stringFormat, formatDecimal } from './format.js';
import { SimulationData } from './simulation-data.js';
import { MaterialsList, copyMaterialsList } from './materials-list.js';
import {
  isBroken, getRodCount, getMaxDamage, producesOutput, getCurrentOutput,
  createComponent, getComponentCount,
  needsCoolantInjected, injectCoolant, clearDamage, clearCurrentHeat, preReactorTick,
  generateHeat, generateEnergy, dissipate, transfer,
  getVentCoolingCapacity, getHullCoolingCapacity, getExplosionPowerOffset,
  getExplosionPowerMultiplier,
} from './components.js';
import { blankReactor } from './reactor.js';
import { decodeCode } from './reactor-code.js';
import { INT_MAX, DOUBLE_MAX } from '../data/limits.js';
import { GRID_ROWS, GRID_COLS } from '../data/bounds.js';

/** The one format every numeric figure in the report goes through (`Simulation.DecimalFormat`). */
let DECIMAL_FORMAT = '#,##0.##';

/**
 * The report chunk filter Java's `process(List<String>)` applies.
 *
 * Java's `chunk.matches("R\\dC\\d:.*")` is written out rather than expressed as a regex: the JDK's
 * `.` stops at `\n`, `\r`, `\u0085`, `\u2028` and `\u2029`, and a JS `.` stops at `\n`, `\r` and
 * `\u2028`/`\u2029` but *not* `\u0085`. A regex port would therefore accept a cell chunk with a
 * NEL in it and Java would not. `AutomationSimulatorTest` pins the two against each other.
 *
 * @param chunk
 * @returns {Boolean} true when this chunk recolours a grid button instead of extending the report
 */
export function isReactorCellChunk(chunk) {
  if (chunk.length < 5 || chunk[0] !== 'R' || chunk[2] !== 'C' || chunk[4] !== ':') return false;
  const rowChar = chunk[1];
  const colChar = chunk[3];
  if (rowChar < '0' || rowChar > '9' || colChar < '0' || colChar > '9') return false;
  for (let i = 5; i < chunk.length; i++) {
    const c = chunk[i];
    if (c === '\n' || c === '\r' || c === '\u0085' || c === '\u2028' || c === '\u2029') return false;
  }
  return true;
}

/**
 * `ReactorItem#toString`, which is what `Simulation.FirstComponentBrokenDetails` prints and what
 * the desktop's info button puts into `UI.ComponentInfoLastSimRowCol` -- both name the component
 * and append its initial heat when it has any, so the label a cell shows is the label the run made.
 */
export function componentToString(component) {
  const name = getI18n(component.nameKey);
  if (component.initialHeat > 0) {
    return name + stringFormat(getI18n('UI.InitialHeatDisplay'), Math.trunc(component.initialHeat));
  }
  return name;
}

/** The name `handleAutomation` records as a replaced "material". */
function componentName(component) {
  return getI18n(component.nameKey);
}

/**
 * Runs one design to completion, the way `CorpusRunner.run` does it: decode the code into a fresh
 * reactor, set the tick cap, then simulate.
 *
 * @param code the design's reactor code (`erp=` prefixed)
 * @param catalog the component catalog
 * @param options {{ tickCap, csvRow }} `tickCap` is Java's `setMaxSimulationTicks`
 * @returns {{ data: SimulationData, report: String, reactor: Reactor }}
 */
/**
 * The per-component parameter defaults the code format compares against.
 *
 * Java's `setCode` applies only the parameters a code actually carries, so a component that
 * carries none keeps the threshold its constructor derived from capacity (`maxHeat * 0.9`, or
 * `maxDamage * 1.1`). A fresh catalog component has exactly that, so reading it off one is the
 * faithful table -- passing an empty table instead makes every component that omits `a` fall back
 * to the bare `9000`, which silently disables automation for vents and coolant cells.
 *
 * @param catalog the component catalog
 * @returns {Array} sparse array indexed by component id
 */
export function codeDefaults(catalog) {
  const table = [];
  for (let id = 1; id <= getComponentCount(catalog); id++) {
    const component = createComponent(catalog, id);
    if (component !== null) {
      table[id] = { automationThreshold: component.automationThreshold, reactorPause: component.reactorPause };
    }
  }
  return table;
}

export function simulateCode(code, catalog, options = {}) {
  const read = decodeCode(code, { defaults: options.defaults ?? codeDefaults(catalog) });
  if (!read.ok) throw new Error(`cannot decode design: ${read.message}`);
  const design = read.design;
  if (options.tickCap !== undefined) design.maxSimulationTicks = options.tickCap;
  const reactor = blankReactor(catalog);
  reactor.placeDesign(design);
  reactor.setMaxSimulationTicks(design.maxSimulationTicks);
  return new AutomationSimulator(reactor, catalog, options).run();
}

export class AutomationSimulator {
  #reactor;
  #catalog;
  #csvRow;
  #report;
  #data;
  #cellPaint;
  #tickComponents;
  #tickCell;
  #alreadyBroken;
  #needsCooldown;
  #replacedItems;
  #s;
  #startedAt;


  constructor(reactor, catalog, options = {}) {
    this.#reactor = reactor;
    this.#catalog = catalog;
    this.#csvRow = options.csvRow;
    this.#report = '';
    this.#data = new SimulationData();
    this.#cellPaint = new Map();
    this.#tickComponents = [];
    this.#tickCell = [];
    this.#alreadyBroken = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(false));
    this.#needsCooldown = Array.from({ length: GRID_ROWS }, () => new Array(GRID_COLS).fill(false));
    this.#replacedItems = new MaterialsList();
    this.#s = {
      minEUoutput: DOUBLE_MAX,
      maxEUoutput: 0.0,
      minHeatOutput: DOUBLE_MAX,
      maxHeatOutput: 0.0,
      reachedBelow50: false,
      reachedBurn: false,
      reachedEvaporate: false,
      reachedHurt: false,
      reachedLava: false,
      reachedExplode: false,
      allFuelRodsDepleted: false,
      componentsIntact: true,
      anyRodsDepleted: false,
      activeTime: 0,
      inactiveTime: 0,
      currentActiveTime: 0,
      minActiveTime: INT_MAX,
      maxActiveTime: 0,
      currentInactiveTime: 0,
      minInactiveTime: INT_MAX,
      maxInactiveTime: 0,
      totalHullHeating: 0,
      totalComponentHeating: 0,
      totalHullCooling: 0,
      totalVentCooling: 0,
      showHeatingCoolingCalled: false,
      active: true,
      pauseTimer: 0,
      redstoneUsed: 0,
      lapisUsed: 0,
    };
  }

  /** Java's `publish(String... chunks)`: every chunk goes through `process` on its own. */
  publish(...chunks) {
    for (const chunk of chunks) this.process(chunk);
  }

  process(chunk) {
    if (chunk === '') {
      this.#report = ''; // Java clears the JTextArea rather than appending nothing.
      return;
    }
    if (isReactorCellChunk(chunk)) {
      // Java's `process:984-997`: the chunk recolours the cell's button instead of writing a
      // report line. A chunk that reads as a cell but whose tail is not a colour is dropped by
      // both sides -- it reaches neither the report nor a button -- so the `return` is outside
      // the `0x` test, not inside it.
      this.#paintCell(chunk);
      return;
    }
    this.#report += chunk;
  }

  /**
   * Java's `process:988-996`: `setBackground(Color.decode(...))` on `reactorButtonPanels[row][col]`,
   * plus the tooltip the three known colours set. The tooltip is stored rather than derived at
   * paint time because an unknown colour leaves the button's tooltip alone -- a cell that was
   * already `Broken` and is then painted an unrecognised colour still reads `Broken`, which a
   * colour-to-words lookup at paint time cannot reproduce.
   */
  #paintCell(chunk) {
    const colour = chunk.substring(5);
    if (!colour.startsWith('0x')) return;
    const index = (chunk.charCodeAt(1) - 48) * 9 + (chunk.charCodeAt(3) - 48);
    const previous = this.#cellPaint.get(index);
    let tooltip = previous === undefined ? null : previous.tooltip;
    if (colour === '0xC0C0C0') tooltip = null; // Java's `setToolTipText(null)`
    else if (colour === '0xFF0000') tooltip = getI18n('ComponentTooltip.Broken');
    else if (colour === '0xFFA500') tooltip = getI18n('ComponentTooltip.ResidualHeat');
    this.#cellPaint.set(index, { colour, tooltip });
  }

  result() {
    return { data: this.#data, report: this.#report, reactor: this.#reactor, cellPaint: this.#cellPaint };
  }

  // ---------------------------------------------------------------- main run

  run() {
    const reactor = this.#reactor;
    const s = this.#s;
    DECIMAL_FORMAT = getI18n('Simulation.DecimalFormat');
    this.#startedAt = readClock();
    let reactorTicks = 0;
    let cooldownTicks = 0;
    let totalRodCount = 0;
    const initialHeat = Math.trunc(reactor.getCurrentHeat());

    this.publish('');
    this.publish(getI18n('Simulation.Started'));
    reactor.setCurrentHeat(initialHeat);
    reactor.clearVentedHeat();
    let minReactorHeat = initialHeat;
    let maxReactorHeat = initialHeat;
    s.reachedBelow50 = false;
    s.reachedBurn = initialHeat >= 0.4 * reactor.getMaxHeat();
    s.reachedEvaporate = initialHeat >= 0.5 * reactor.getMaxHeat();
    s.reachedHurt = initialHeat >= 0.7 * reactor.getMaxHeat();
    s.reachedLava = initialHeat >= 0.85 * reactor.getMaxHeat();
    s.reachedExplode = false;
    this.snapshotGrid();

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const component = reactor.getComponentAt(row, col);
        if (component !== null) {
          clearCurrentHeat(component);
          clearDamage(component);
          totalRodCount += getRodCount(component);
        }
        this.publish(stringFormat('R%dC%d:0xC0C0C0', row, col));
      }
    }
    this.#data.set('totalRodCount', totalRodCount);

    let lastEUoutput = 0.0;
    let totalEUoutput = 0.0;
    let lastHeatOutput = 0.0;
    let totalHeatOutput = 0.0;
    let maxGeneratedHeat = 0.0;
    s.allFuelRodsDepleted = false;
    s.componentsIntact = true;
    s.anyRodsDepleted = false;

    do {
      reactorTicks++;
      reactor.clearEUOutput();
      reactor.clearVentedHeat();
      for (const component of this.#tickComponents) preReactorTick(component);
      if (s.active) s.allFuelRodsDepleted = true; // assume depleted until a live rod says otherwise
      let generatedHeat = 0.0;
      for (const component of this.#tickComponents) {
        if (isBroken(component)) continue;
        if (s.allFuelRodsDepleted && getRodCount(component) > 0) s.allFuelRodsDepleted = false;
        if (s.active) generatedHeat += generateHeat(component);
        dissipate(component);
        transfer(component);
      }
      maxReactorHeat = Math.max(reactor.getCurrentHeat(), maxReactorHeat);
      minReactorHeat = Math.min(reactor.getCurrentHeat(), minReactorHeat);
      this.checkReactorTemperature(reactorTicks);
      maxGeneratedHeat = Math.max(generatedHeat, maxGeneratedHeat);
      if (s.active) {
        for (const component of this.#tickComponents) {
          if (!isBroken(component)) generateEnergy(component);
        }
      }
      lastEUoutput = reactor.getCurrentEUoutput();
      totalEUoutput += lastEUoutput;
      lastHeatOutput = reactor.getVentedHeat();
      totalHeatOutput += lastHeatOutput;
      if (reactor.getCurrentHeat() <= reactor.getMaxHeat()) {
        if (reactor.isPulsed() || reactor.isAutomated()) this.updateActiveTime(reactorTicks);
        s.minEUoutput = Math.min(lastEUoutput, s.minEUoutput);
        s.maxEUoutput = Math.max(lastEUoutput, s.maxEUoutput);
        s.minHeatOutput = Math.min(lastHeatOutput, s.minHeatOutput);
        s.maxHeatOutput = Math.max(lastHeatOutput, s.maxHeatOutput);
      }
      this.calculateHeatingCooling(reactorTicks);
      this.handleAutomation(reactorTicks);
      if (this.#csvRow !== undefined && reactorTicks <= this.#csvRow.limit) {
        this.#csvRow.row(reactorTicks, reactor, this.#tickComponents);
      }
      this.handleBrokenComponents(reactorTicks, totalHeatOutput, totalRodCount, totalEUoutput,
        minReactorHeat, maxReactorHeat);
    } while (reactor.getCurrentHeat() < reactor.getMaxHeat()
      && (!s.allFuelRodsDepleted || lastEUoutput > 0 || lastHeatOutput > 0)
      && reactorTicks < reactor.getMaxSimulationTicks());

    this.finishRun(reactorTicks, cooldownTicks, totalRodCount, totalHeatOutput, totalEUoutput,
      lastHeatOutput, minReactorHeat, maxReactorHeat, maxGeneratedHeat);
    return this.result();
  }

  /**
   * The grid as a flat list, plus the cell index each entry came from.
   *
   * Taken once, before the loop: the grid is never mutated during a run, so the ordering cannot
   * go stale, and it is what the CSV columns and the `R%dC%d` colour codes depend on.
   */
  snapshotGrid() {
    const components = [];
    const cells = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const component = this.#reactor.getComponentAt(row, col);
        if (component !== null) {
          components.push(component);
          cells.push(row * GRID_COLS + col);
        }
      }
    }
    this.#tickComponents = components;
    this.#tickCell = cells;
  }

  updateActiveTime(reactorTicks) {
    const reactor = this.#reactor;
    const s = this.#s;
    const clockPeriod = reactor.getOnPulse() + reactor.getOffPulse();
    if (s.active) {
      s.activeTime++;
      s.currentActiveTime++;
      if (reactor.isPulsed()
        && (reactor.getCurrentHeat() >= reactor.getSuspendTemp()
          || (reactorTicks % clockPeriod) >= reactor.getOnPulse())) {
        s.active = false;
        s.minActiveTime = Math.min(s.currentActiveTime, s.minActiveTime);
        s.maxActiveTime = Math.max(s.currentActiveTime, s.maxActiveTime);
        s.currentActiveTime = 0;
      }
    } else {
      s.inactiveTime++;
      s.currentInactiveTime++;
      if (reactor.isAutomated() && s.pauseTimer > 0) {
        s.pauseTimer--;
      } else if (reactor.isPulsed()
        && reactor.getCurrentHeat() <= reactor.getResumeTemp()
        && (reactorTicks % clockPeriod) < reactor.getOnPulse()) {
        s.active = true;
        s.minInactiveTime = Math.min(s.currentInactiveTime, s.minInactiveTime);
        s.maxInactiveTime = Math.max(s.currentInactiveTime, s.maxInactiveTime);
        s.currentInactiveTime = 0;
      }
    }
  }

  checkReactorTemperature(reactorTicks) {
    const reactor = this.#reactor;
    const s = this.#s;
    const heat = reactor.getCurrentHeat();
    const max = reactor.getMaxHeat();
    if (heat < 0.5 * max && !s.reachedBelow50 && s.reachedEvaporate) {
      this.publish(formatI18n('Simulation.TimeToBelow50', reactorTicks));
      s.reachedBelow50 = true;
      this.#data.set('timeToBelow50', reactorTicks);
    }
    if (heat >= 0.4 * max && !s.reachedBurn) {
      this.publish(formatI18n('Simulation.TimeToBurn', reactorTicks));
      s.reachedBurn = true;
      this.#data.set('timeToBurn', reactorTicks);
    }
    if (heat >= 0.5 * max && !s.reachedEvaporate) {
      this.publish(formatI18n('Simulation.TimeToEvaporate', reactorTicks));
      s.reachedEvaporate = true;
      this.#data.set('timeToEvaporate', reactorTicks);
    }
    if (heat >= 0.7 * max && !s.reachedHurt) {
      this.publish(formatI18n('Simulation.TimeToHurt', reactorTicks));
      s.reachedHurt = true;
      this.#data.set('timeToHurt', reactorTicks);
    }
    if (heat >= 0.85 * max && !s.reachedLava) {
      this.publish(formatI18n('Simulation.TimeToLava', reactorTicks));
      s.reachedLava = true;
      this.#data.set('timeToLava', reactorTicks);
    }
    if (heat >= max && !s.reachedExplode) {
      this.publish(formatI18n('Simulation.TimeToXplode', reactorTicks));
      s.reachedExplode = true;
      this.#data.set('timeToXplode', reactorTicks);
    }
  }

  calculateHeatingCooling(reactorTicks) {
    if (reactorTicks <= 20) return; // the first twenty ticks are a warm-up and are not averaged
    const s = this.#s;
    for (const component of this.#tickComponents) {
      s.totalHullHeating += component.currentHullHeating;
      s.totalComponentHeating += component.currentComponentHeating;
      s.totalHullCooling += component.currentHullCooling;
      s.totalVentCooling += component.currentVentCooling;
    }
  }

  /**
   * The heating/cooling averages, emitted once per run.
   *
   * The guard is the flag, not the tick count: the first call sets it even when the run is too
   * short to average, which is why a design that breaks a component at tick 12 reports no
   * heating figures at all.
   */
  showHeatingCooling(reactorTicks) {
    const s = this.#s;
    if (s.showHeatingCoolingCalled) return;
    s.showHeatingCoolingCalled = true;
    if (reactorTicks < 40) return;
    const reactor = this.#reactor;
    let totalHullCoolingCapacity = 0;
    let totalVentCoolingCapacity = 0;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const component = reactor.getComponentAt(row, col);
        if (component === null) continue;
        totalHullCoolingCapacity += getHullCoolingCapacity(component);
        totalVentCoolingCapacity += getVentCoolingCapacity(component);
      }
    }
    this.#data.set('hullHeating', s.totalHullHeating / (reactorTicks - 20));
    this.#data.set('componentHeating', s.totalComponentHeating / (reactorTicks - 20));
    this.#data.set('hullCooling', s.totalHullCooling / (reactorTicks - 20));
    this.#data.set('hullCoolingCapacity', totalHullCoolingCapacity);
    this.#data.set('ventCooling', s.totalVentCooling / (reactorTicks - 20));
    this.#data.set('ventCoolingCapacity', totalVentCoolingCapacity);
    if (s.totalHullHeating > 0) {
      this.publish(formatI18n('Simulation.HullHeating', s.totalHullHeating / (reactorTicks - 20)));
    }
    if (s.totalComponentHeating > 0) {
      this.publish(formatI18n('Simulation.ComponentHeating',
        s.totalComponentHeating / (reactorTicks - 20)));
    }
    if (totalHullCoolingCapacity > 0) {
      this.publish(formatI18n('Simulation.HullCooling', s.totalHullCooling / (reactorTicks - 20),
        totalHullCoolingCapacity));
    }
    if (totalVentCoolingCapacity > 0) {
      this.publish(formatI18n('Simulation.VentCooling', s.totalVentCooling / (reactorTicks - 20),
        totalVentCoolingCapacity));
    }
  }

  handleAutomation(reactorTicks) {
    const reactor = this.#reactor;
    const s = this.#s;
    for (let i = 0; i < this.#tickComponents.length; i++) {
      const component = this.#tickComponents[i];
      if (reactor.isAutomated()) {
        if (component.maxHeat > 1) {
          const overThreshold = component.automationThreshold > component.initialHeat
            && component.currentHeat >= component.automationThreshold;
          const underThreshold = component.automationThreshold < component.initialHeat
            && component.currentHeat <= component.automationThreshold;
          if (overThreshold || underThreshold) this.replaceComponent(component, reactorTicks);
        } else if (isBroken(component)
          || (getMaxDamage(component) > 1 && component.currentDamage >= component.automationThreshold)) {
          this.replaceComponent(component, reactorTicks);
        }
      }
      if (reactor.isUsingReactorCoolantInjectors() && needsCoolantInjected(component)) {
        injectCoolant(component);
        if (component.baseName === 'rshCondensator') s.redstoneUsed++;
        else if (component.baseName === 'lzhCondensator') s.lapisUsed++;
      }
    }
  }

  /** A replaced component is logged as a material, and one that pauses stops the reactor. */
  replaceComponent(component, reactorTicks) {
    const s = this.#s;
    if (component.maxHeat > 1) clearCurrentHeat(component);
    else clearDamage(component);
    this.#replacedItems.add(componentName(component));
    component.info.push(formatI18n('ComponentInfo.ReplacedTime', reactorTicks));
    if (component.reactorPause <= 0) return;
    s.active = false;
    s.pauseTimer = Math.max(s.pauseTimer, component.reactorPause);
    s.minActiveTime = Math.min(s.currentActiveTime, s.minActiveTime);
    s.maxActiveTime = Math.max(s.currentActiveTime, s.maxActiveTime);
    s.currentActiveTime = 0;
  }

  handleBrokenComponents(reactorTicks, totalHeatOutput, totalRodCount, totalEUoutput,
    minReactorHeat, maxReactorHeat) {
    const s = this.#s;
    for (let i = 0; i < this.#tickComponents.length; i++) {
      const component = this.#tickComponents[i];
      const cell = this.#tickCell[i];
      const row = Math.floor(cell / GRID_COLS);
      const col = cell % GRID_COLS;
      if (!isBroken(component) || this.#alreadyBroken[row][col]) continue;
      this.#alreadyBroken[row][col] = true;
      if (getRodCount(component) === 0) {
        this.publish(stringFormat('R%dC%d:0xFF0000', row, col));
        component.info.push(formatI18n('ComponentInfo.BrokeTime', reactorTicks));
        if (!s.componentsIntact) {
          this.showHeatingCooling(reactorTicks);
          continue;
        }
        s.componentsIntact = false;
        this.#data.set('firstComponentBrokenTime', reactorTicks);
        this.#data.set('firstComponentBrokenRow', row);
        this.#data.set('firstComponentBrokenCol', col);
        this.#data.set('firstComponentBrokenDescription', componentToString(component));
        this.publish(formatI18n('Simulation.FirstComponentBrokenDetails',
          componentToString(component), row, col, reactorTicks));
        this.recordOutputs('prebreak', totalHeatOutput, totalEUoutput, reactorTicks);
        this.publishOutputs('BeforeBreak', totalHeatOutput, totalEUoutput, reactorTicks, totalRodCount);
      } else if (!s.anyRodsDepleted) {
        s.anyRodsDepleted = true;
        this.#data.set('firstRodDepletedTime', reactorTicks);
        this.#data.set('firstRodDepletedRow', row);
        this.#data.set('firstRodDepletedCol', col);
        this.#data.set('firstRodDepletedDescription', componentToString(component));
        this.publish(formatI18n('Simulation.FirstRodDepletedDetails',
          componentToString(component), row, col, reactorTicks));
        this.recordOutputs('predeplete', totalHeatOutput, totalEUoutput, reactorTicks);
        this.publishOutputs('BeforeDepleted', totalHeatOutput, totalEUoutput, reactorTicks,
          totalRodCount);
        this.#data.set('predepleteMinTemp', minReactorHeat);
        this.#data.set('predepleteMaxTemp', maxReactorHeat);
        this.publish(formatI18n('Simulation.ReactorMinTempBeforeDepleted', minReactorHeat));
        this.publish(formatI18n('Simulation.ReactorMaxTempBeforeDepleted', maxReactorHeat));
      }
      this.showHeatingCooling(reactorTicks);
    }
  }

  /**
   * The running totals a partial run is summarised under, folded into `SimulationData`.
   *
   * `prefix` is `prebreak` or `predeplete`; the full-run version is written by
   * `reportOutputTotals` because it also carries `totalReactorTicks`.
   */
  recordOutputs(prefix, totalHeatOutput, totalEUoutput, reactorTicks) {
    const d = this.#data;
    const s = this.#s;
    if (this.#reactor.isFluid()) {
      d.set(`${prefix}TotalHUoutput`, 40 * totalHeatOutput);
      d.set(`${prefix}AvgHUoutput`, 2 * totalHeatOutput / reactorTicks);
      d.set(`${prefix}MinHUoutput`, 2 * s.minHeatOutput);
      d.set(`${prefix}MaxHUoutput`, 2 * s.maxHeatOutput);
    } else {
      d.set(`${prefix}TotalEUoutput`, totalEUoutput);
      d.set(`${prefix}AvgEUoutput`, totalEUoutput / (reactorTicks * 20));
      d.set(`${prefix}MinEUoutput`, s.minEUoutput / 20.0);
      d.set(`${prefix}MaxEUoutput`, s.maxEUoutput / 20.0);
    }
  }

  /**
   * The output lines for a partial run: `suffix` is `BeforeBreak` or `BeforeDepleted`, and the
   * full-run version lives in `reportOutputTotals`.
   */
  publishOutputs(suffix, totalHeatOutput, totalEUoutput, reactorTicks, totalRodCount) {
    const s = this.#s;
    if (this.#reactor.isFluid()) {
      this.publish(formatI18n(`Simulation.HeatOutputs${suffix}`,
        formatDecimal(DECIMAL_FORMAT, 40 * totalHeatOutput),
        formatDecimal(DECIMAL_FORMAT, 2 * totalHeatOutput / reactorTicks),
        formatDecimal(DECIMAL_FORMAT, 2 * s.minHeatOutput),
        formatDecimal(DECIMAL_FORMAT, 2 * s.maxHeatOutput)));
      if (totalRodCount > 0) {
        this.publish(formatI18n('Simulation.Efficiency',
          totalHeatOutput / reactorTicks / 4 / totalRodCount,
          s.minHeatOutput / 4 / totalRodCount,
          s.maxHeatOutput / 4 / totalRodCount));
      }
      return;
    }
    this.publish(formatI18n(`Simulation.EUOutputs${suffix}`,
      formatDecimal(DECIMAL_FORMAT, totalEUoutput),
      formatDecimal(DECIMAL_FORMAT, totalEUoutput / (reactorTicks * 20)),
      formatDecimal(DECIMAL_FORMAT, s.minEUoutput / 20.0),
      formatDecimal(DECIMAL_FORMAT, s.maxEUoutput / 20.0)));
    if (totalRodCount > 0) {
      this.publish(formatI18n('Simulation.Efficiency',
        totalEUoutput / reactorTicks / 100 / totalRodCount,
        s.minEUoutput / 100 / totalRodCount,
        s.maxEUoutput / 100 / totalRodCount));
    }
  }

  /**
   * The tail of the run: everything after the tick loop, in Java's order.
   *
   * `reportOutputTotals` is the same summary as the one `handleBrokenComponents` emits, under a
   * different heading, and it bails out when no tick stayed below max heat -- which is what keeps
   * a first-tick explosion from reporting `Double.MAX_VALUE` as its minimum.
   */
  finishRun(reactorTicks, cooldownTicks, totalRodCount, totalHeatOutput, totalEUoutput,
    lastHeatOutput, minReactorHeat, maxReactorHeat, maxGeneratedHeat) {
    const reactor = this.#reactor;
    const s = this.#s;
    const d = this.#data;
    d.set('minTemp', minReactorHeat);
    d.set('maxTemp', maxReactorHeat);
    this.publish(formatI18n('Simulation.ReactorMinTemp', minReactorHeat));
    this.publish(formatI18n('Simulation.ReactorMaxTemp', maxReactorHeat));

    if (reactor.getCurrentHeat() < reactor.getMaxHeat()) {
      this.publish(formatI18n('Simulation.TimeWithoutExploding', reactorTicks));
      if (reactor.isPulsed()) this.publishPulseTiming();
      const replacedItemsString = this.#replacedItems.toString();
      if (replacedItemsString !== '') {
        d.set('replacedItems', copyMaterialsList(this.#replacedItems));
        this.publish(formatI18n('Simulation.ComponentsReplaced', replacedItemsString));
      }
      this.reportOutputTotals(reactorTicks, totalRodCount, totalHeatOutput, s.minHeatOutput,
        s.maxHeatOutput, totalEUoutput, s.minEUoutput, s.maxEUoutput, false);
      if (reactor.getCurrentHeat() > 0.0) {
        this.publish(formatI18n('Simulation.ReactorRemainingHeat', reactor.getCurrentHeat()));
      }
      this.runCooldownPhase(reactorTicks, cooldownTicks, totalHeatOutput, lastHeatOutput);
      this.publishComponentFigures(reactorTicks, maxGeneratedHeat);
    } else {
      this.publish(formatI18n('Simulation.ReactorOverheatedTime', reactorTicks));
      let explosionPower = 10.0;
      let explosionPowerMult = 1.0;
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const component = reactor.getComponentAt(row, col);
          if (component === null) continue;
          explosionPower += getExplosionPowerOffset(component);
          explosionPowerMult *= getExplosionPowerMultiplier(component);
        }
      }
      explosionPower *= explosionPowerMult;
      this.publish(formatI18n('Simulation.ExplosionPower', explosionPower));
      this.reportOutputTotals(reactorTicks, totalRodCount, totalHeatOutput, s.minHeatOutput,
        s.maxHeatOutput, totalEUoutput, s.minEUoutput, s.maxEUoutput, true);
      this.publishComponentFigures(reactorTicks, maxGeneratedHeat);
    }
    this.publish(formatI18n('Simulation.ElapsedTime', (readClock() - this.#startedAt) / 1000));
  }

  publishPulseTiming() {
    const s = this.#s;
    let rangeString = '';
    if (s.maxActiveTime > s.minActiveTime) {
      rangeString = formatI18n('Simulation.ActiveTimeRange', s.minActiveTime, s.maxActiveTime);
    } else if (s.minActiveTime < s.activeTime) {
      rangeString = formatI18n('Simulation.ActiveTimeSingle', s.minActiveTime);
    }
    this.publish(formatI18n('Simulation.ActiveTime', s.activeTime, rangeString));
    rangeString = '';
    if (s.maxInactiveTime > s.minInactiveTime) {
      rangeString = formatI18n('Simulation.InactiveTimeRange', s.minInactiveTime, s.maxInactiveTime);
    } else if (s.minInactiveTime < s.inactiveTime) {
      rangeString = formatI18n('Simulation.InactiveTimeSingle', s.minInactiveTime);
    }
    this.publish(formatI18n('Simulation.InactiveTime', s.inactiveTime, rangeString));
  }

  reportOutputTotals(reactorTicks, totalRodCount, totalHeatOutput, minHeatOutput, maxHeatOutput,
    totalEUoutput, minEUoutput, maxEUoutput, overheated) {
    if (reactorTicks <= 0 || minEUoutput >= DOUBLE_MAX) return;
    const d = this.#data;
    d.set('totalReactorTicks', reactorTicks);
    if (this.#reactor.isFluid()) {
      d.set('totalHUoutput', 40 * totalHeatOutput);
      d.set('avgHUoutput', 2 * totalHeatOutput / reactorTicks);
      d.set('minHUoutput', 2 * minHeatOutput);
      d.set('maxHUoutput', 2 * maxHeatOutput);
      if (totalHeatOutput > 0) {
        this.publish(formatI18n(overheated ? 'Simulation.HeatOutputsBeforeOverheated'
          : 'Simulation.HeatOutputs',
          formatDecimal(DECIMAL_FORMAT, 40 * totalHeatOutput),
          formatDecimal(DECIMAL_FORMAT, 2 * totalHeatOutput / reactorTicks),
          formatDecimal(DECIMAL_FORMAT, 2 * minHeatOutput),
          formatDecimal(DECIMAL_FORMAT, 2 * maxHeatOutput)));
        if (totalRodCount > 0) {
          this.publish(formatI18n('Simulation.Efficiency',
            totalHeatOutput / reactorTicks / 4 / totalRodCount,
            minHeatOutput / 4 / totalRodCount,
            maxHeatOutput / 4 / totalRodCount));
        }
      }
      return;
    }
    d.set('totalEUoutput', totalEUoutput);
    d.set('avgEUoutput', totalEUoutput / (reactorTicks * 20));
    d.set('minEUoutput', minEUoutput / 20.0);
    d.set('maxEUoutput', maxEUoutput / 20.0);
    if (totalEUoutput > 0) {
      this.publish(formatI18n(overheated ? 'Simulation.EUOutputsBeforeOverheated'
        : 'Simulation.EUOutputs',
        formatDecimal(DECIMAL_FORMAT, totalEUoutput),
        formatDecimal(DECIMAL_FORMAT, totalEUoutput / (reactorTicks * 20)),
        formatDecimal(DECIMAL_FORMAT, minEUoutput / 20.0),
        formatDecimal(DECIMAL_FORMAT, maxEUoutput / 20.0)));
      if (totalRodCount > 0) {
        this.publish(formatI18n('Simulation.Efficiency',
          totalEUoutput / reactorTicks / 100 / totalRodCount,
          minEUoutput / 100 / totalRodCount,
          maxEUoutput / 100 / totalRodCount));
      }
    }
  }

  /**
   * The cooldown period: only dissipate/transfer run, so a cooldown tick produces no energy.
   *
   * `reactorCooldownTime` records the tick at which the reactor itself first read zero, which is
   * why it stays 0 when the reactor was already cold and the residual-heat line is skipped.
   */
  runCooldownPhase(reactorTicks, cooldownTicks, totalHeatOutput, lastHeatOutput) {
    const reactor = this.#reactor;
    const s = this.#s;
    let prevReactorHeat = reactor.getCurrentHeat();
    let prevTotalComponentHeat = 0.0;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const component = reactor.getComponentAt(row, col);
        if (component === null || isBroken(component)) continue;
        if (component.currentHeat > 0.0) {
          prevTotalComponentHeat += component.currentHeat;
          this.publish(stringFormat('R%dC%d:0xFFA500', row, col));
          component.info.push(formatI18n('ComponentInfo.RemainingHeat', component.currentHeat));
          this.#needsCooldown[row][col] = true;
        }
      }
    }
    if (prevReactorHeat === 0.0 && prevTotalComponentHeat === 0.0) {
      this.publish(getI18n('Simulation.NoCooldown'));
      return;
    }
    if (!(reactor.getCurrentHeat() < reactor.getMaxHeat())) return;

    let currentTotalComponentHeat = prevTotalComponentHeat;
    let reactorCooldownTime = 0;
    do {
      reactor.clearVentedHeat();
      prevReactorHeat = reactor.getCurrentHeat();
      if (prevReactorHeat === 0.0) reactorCooldownTime = cooldownTicks;
      prevTotalComponentHeat = currentTotalComponentHeat;
      for (const component of this.#tickComponents) {
        if (isBroken(component)) continue;
        dissipate(component);
        transfer(component);
      }
      lastHeatOutput = reactor.getVentedHeat();
      totalHeatOutput += lastHeatOutput;
      s.minHeatOutput = Math.min(lastHeatOutput, s.minHeatOutput);
      s.maxHeatOutput = Math.max(lastHeatOutput, s.maxHeatOutput);
      cooldownTicks++;
      currentTotalComponentHeat = 0.0;
      for (let i = 0; i < this.#tickComponents.length; i++) {
        const component = this.#tickComponents[i];
        if (isBroken(component)) continue;
        currentTotalComponentHeat += component.currentHeat;
        const cell = this.#tickCell[i];
        const row = Math.floor(cell / GRID_COLS);
        const col = cell % GRID_COLS;
        if (component.currentHeat === 0.0 && this.#needsCooldown[row][col]) {
          component.info.push(formatI18n('ComponentInfo.CooldownTime', cooldownTicks));
          this.#needsCooldown[row][col] = false;
        }
      }
    } while (lastHeatOutput > 0 && cooldownTicks < 50000);

    if (reactor.getCurrentHeat() < reactor.getMaxHeat()) {
      if (reactor.getCurrentHeat() === 0.0) {
        this.publish(formatI18n('Simulation.ReactorCooldownTime', reactorCooldownTime));
      } else if (reactorCooldownTime > 0) {
        this.publish(formatI18n('Simulation.ReactorResidualHeat', reactor.getCurrentHeat(),
          reactorCooldownTime));
      }
      this.publish(formatI18n('Simulation.TotalCooldownTime', cooldownTicks));
    }
  }

  /**
   * The per-component figures, and the four totals that come out of that walk.
   *
   * The figures themselves go to `component.info`, which the UI renders per cell; only the totals
   * are published. Java's vent-cooling totals are commented out in the source and stay commented
   * out here -- `showHeatingCooling` already reports vent cooling, and this would double-count it.
   */
  publishComponentFigures(reactorTicks, maxGeneratedHeat) {
    const reactor = this.#reactor;
    const s = this.#s;
    const fluid = reactor.isFluid();
    let totalCellCooling = 0.0;
    let totalCondensatorCooling = 0.0;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const component = reactor.getComponentAt(row, col);
        if (component === null) continue;
        if (getVentCoolingCapacity(component) > 0) {
          component.info.push(formatI18n('ComponentInfo.UsedCooling',
            component.bestVentCooling, getVentCoolingCapacity(component)));
        } else if (component.bestCellCooling > 0) {
          component.info.push(formatI18n('ComponentInfo.ReceivedHeat', component.bestCellCooling));
          totalCellCooling += component.bestCellCooling;
        } else if (component.bestCondensatorCooling > 0) {
          component.info.push(formatI18n('ComponentInfo.ReceivedHeat',
            component.bestCondensatorCooling));
          totalCondensatorCooling += component.bestCondensatorCooling;
        } else if (component.maxHeatGenerated > 0) {
          if (!fluid && component.maxEUGenerated > 0) {
            component.info.push(formatI18n('ComponentInfo.GeneratedEU',
              component.minEUGenerated, component.maxEUGenerated));
          }
          component.info.push(formatI18n('ComponentInfo.GeneratedHeat',
            component.minHeatGenerated, component.maxHeatGenerated));
        } else if (component.kind === 'BreederCell') {
          component.info.push(formatI18n('ComponentInfo.BreederProgress',
            component.currentDamage > getMaxDamage(component)
              ? Math.trunc(getMaxDamage(component)) : Math.trunc(component.currentDamage),
            Math.trunc(getMaxDamage(component))));
        }
        if (component.maxReachedHeat > 0) {
          component.info.push(formatI18n('ComponentInfo.ReachedHeat',
            component.maxReachedHeat, component.maxHeat));
        }
      }
    }
    this.showHeatingCooling(reactorTicks);
    if (totalCellCooling > 0) this.publish(formatI18n('Simulation.TotalCellCooling', totalCellCooling));
    if (totalCondensatorCooling > 0) {
      this.publish(formatI18n('Simulation.TotalCondensatorCooling', totalCondensatorCooling));
    }
    if (maxGeneratedHeat > 0) this.publish(formatI18n('Simulation.MaxHeatGenerated', maxGeneratedHeat));
    if (s.redstoneUsed > 0) this.publish(formatI18n('Simulation.RedstoneUsed', s.redstoneUsed));
    if (s.lapisUsed > 0) this.publish(formatI18n('Simulation.LapisUsed', s.lapisUsed));
  }
}

/** Java's `System.nanoTime()` delta, in seconds; the corpus baseline strips the line it feeds. */
function readClock() {
  return performance.now(); // milliseconds; Java's nanoseconds are finer than anything we report
}
