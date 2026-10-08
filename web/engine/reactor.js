/**
 * An IndustrialCraft2 Experimental Nuclear Reactor: the 6x9 grid plus the reactor-level state
 * the simulation mutates every tick.
 *
 * Port of `Reactor.java`. The code read/write half (`getCode`, `setCode`, `getOldCode`) lives in
 * `reactor-code.js` and was already proven against the Java oracle in Stage 1; what lands here is
 * the grid and the stateful accessors, which is what makes a component's `parent` exist at all.
 *
 * A JS `class` rather than a plain object literal: the simulation loop reads through `parent` on
 * every tick of every component, and a class instance keeps one hidden class for all reactors so
 * those accesses stay monomorphic.
 *
 * The grid is flat (`row * 9 + col`) where Java is `grid[6][9]`. `getComponentAt` keeps Java's
 * bounds check -- out-of-range returns `null` rather than throwing -- because half the component
 * code leans on it for edge cells.
 *
 * @see src/Ic2ExpReactorPlanner/Reactor.java, ../data/bounds.js
 */

import { GRID_ROWS, GRID_COLS, CELL_COUNT, DEFAULT_ON_PULSE, DEFAULT_OFF_PULSE,
  DEFAULT_SUSPEND_TEMP, DEFAULT_RESUME_TEMP, MAX_SIMULATION_TICKS } from '../data/bounds.js';
import { addToReactor, createComponent } from './components.js';
import { getMaterialsForComponent, MaterialsList } from './materials-list.js';
import { getI18n } from './i18n.js';

/**
 * @param catalog the parsed component catalog (see `components.js#parseCatalog`)
 * @returns {Reactor} an empty reactor at its defaults
 */
export function blankReactor(catalog) {
  return new Reactor({
    fluid: false,
    pulsed: false,
    automated: false,
    injectors: false,
    currentHeat: 0,
    onPulse: DEFAULT_ON_PULSE,
    offPulse: DEFAULT_OFF_PULSE,
    suspendTemp: DEFAULT_SUSPEND_TEMP,
    resumeTemp: DEFAULT_RESUME_TEMP,
    maxSimulationTicks: MAX_SIMULATION_TICKS,
  }, catalog);
}

export class Reactor {
  #grid;
  #currentEUoutput;
  #currentHeat;
  #maxHeat;
  #ventedHeat;
  #fluid;
  #pulsed;
  #automated;
  #usingReactorCoolantInjectors;
  #onPulse;
  #offPulse;
  #suspendTemp;
  #resumeTemp;
  #maxSimulationTicks;
  #catalog;

  /**
   * @param options the reactor-level settings; anything omitted takes Java's field initialiser.
   * @param catalog the component catalog, needed to instantiate the grid's component ids.
   */
  constructor(options = {}, catalog = null) {
    this.#grid = new Array(CELL_COUNT).fill(null);
    this.#currentEUoutput = 0.0;
    this.#currentHeat = options.currentHeat ?? 0;
    this.#maxHeat = 10000.0;
    this.#ventedHeat = 0.0;
    this.#fluid = options.fluid ?? false;
    this.#pulsed = options.pulsed ?? false;
    this.#automated = options.automated ?? false;
    this.#usingReactorCoolantInjectors = options.injectors ?? false;
    this.#onPulse = options.onPulse ?? DEFAULT_ON_PULSE;
    this.#offPulse = options.offPulse ?? DEFAULT_OFF_PULSE;
    this.#suspendTemp = options.suspendTemp ?? DEFAULT_SUSPEND_TEMP;
    this.#resumeTemp = options.resumeTemp ?? DEFAULT_RESUME_TEMP;
    this.#maxSimulationTicks = options.maxSimulationTicks ?? MAX_SIMULATION_TICKS;
    this.#catalog = catalog;
  }

  /**
   * Places a design's components. Java builds the grid inside `setCode`; here the design is
   * already a decoded value, so this is the placement step alone -- and it goes through
   * `setComponentAt`, which is what gives each component its `parent` and what lets Plating
   * adjust the reactor's max heat.
   *
   * @param design a decoded design (see `reactor-code.js#decodeCode`)
   */
  placeDesign(design) {
    for (let index = 0; index < CELL_COUNT; index++) {
      const cell = design.cells[index];
      if (cell === null) continue;
      const component = createComponent(this.#catalog, cell.id);
      if (component === null) continue;
      component.initialHeat = cell.initialHeat;
      component.automationThreshold = cell.automationThreshold;
      component.reactorPause = cell.reactorPause;
      this.setComponentAt(Math.floor(index / GRID_COLS), index % GRID_COLS, component);
    }
    // Java applies the reactor-level state after the grid, in `setCode`'s tail: the components
    // exist by then, which is what lets Plating's max-heat adjustment settle before the flags
    // that read it.
    this.setPulsed(design.pulsed);
    this.setAutomated(design.automated);
    this.setCurrentHeat(design.currentHeat);
    this.setOnPulse(design.onPulse);
    this.setOffPulse(design.offPulse);
    this.setSuspendTemp(design.suspendTemp);
    this.setResumeTemp(design.resumeTemp);
    this.setFluid(design.fluid);
    this.setUsingReactorCoolantInjectors(design.usingReactorCoolantInjectors ?? false);
    this.setMaxSimulationTicks(design.maxSimulationTicks);
  }

  getComponentAt(row, col) {
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      return this.#grid[row * GRID_COLS + col];
    }
    return null;
  }

  /** Replacing a component removes the old one first, which is how Plating's adjustment unwinds. */
  setComponentAt(row, col, component) {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return;
    const index = row * GRID_COLS + col;
    if (this.#grid[index] !== null) {
      this.#grid[index].removeFromReactor();
    }
    this.#grid[index] = component;
    if (component !== null) {
      addToReactor(component, this, row, col);
    }
  }

  clearGrid() {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        this.setComponentAt(row, col, null);
      }
    }
  }

  /** Every cell in row-major order, with its cell index, as `AutomationSimulator#snapshotGrid` builds it. */
  snapshotGrid() {
    const components = [];
    for (let index = 0; index < CELL_COUNT; index++) {
      const component = this.#grid[index];
      if (component !== null) components.push(component);
    }
    return components;
  }

  getCurrentEUoutput() {
    return this.#currentEUoutput;
  }

  getCurrentHeat() {
    return this.#currentHeat;
  }

  getMaxHeat() {
    return this.#maxHeat;
  }

  adjustMaxHeat(adjustment) {
    this.#maxHeat += adjustment;
  }

  setCurrentHeat(currentHeat) {
    this.#currentHeat = currentHeat;
  }

  /** Heat floors at zero, but max heat has no floor -- plating can drive it there. */
  adjustCurrentHeat(adjustment) {
    this.#currentHeat += adjustment;
    if (this.#currentHeat < 0.0) this.#currentHeat = 0.0;
  }

  addEUOutput(amount) {
    this.#currentEUoutput += amount;
  }

  clearEUOutput() {
    this.#currentEUoutput = 0.0;
  }

  /**
   * The shopping list: every material needed to build what is currently on the grid.
   *
   * Java's `Reactor.getMaterials` -- recomputed on demand, never stored, so the panel cannot go
   * stale. A component with no recipe entry contributes nothing rather than throwing; all 72
   * factory components have entries today, so that branch is a trap guard (see CODE_REVIEW.md
   * P3-9 and `MaterialsList.java:187`).
   *
   * @returns {MaterialsList}
   */
  getMaterials() {
    const materials = new MaterialsList();
    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const component = this.getComponentAt(row, col);
        if (component !== null) {
          const recipe = getMaterialsForComponent(component);
          if (recipe !== null) {
            materials.add(recipe);
          }
        }
      }
    }
    return materials;
  }

  /**
   * What is on the board, counted by display name rather than by recipe.
   *
   * The list is a `MaterialsList` wearing component names as its keys, which is why the desktop's
   * comparison can diff it with `MaterialsList.buildComparisonString` at all. Java reads
   * `component.name`, the localized display name, so this reads the name key through the bundle
   * rather than `componentToString`: the desktop's component list never carries the
   * `UI.InitialHeatDisplay` suffix its `toString()` adds.
   *
   * @returns {MaterialsList}
   * @see src/Ic2ExpReactorPlanner/Reactor.java:203
   */
  getComponentList() {
    const list = new MaterialsList();
    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const component = this.getComponentAt(row, col);
        if (component !== null) list.add(getI18n(component.nameKey));
      }
    }
    return list;
  }

  getVentedHeat() {
    return this.#ventedHeat;
  }

  ventHeat(amount) {
    this.#ventedHeat += amount;
  }

  clearVentedHeat() {
    this.#ventedHeat = 0;
  }

  isFluid() {
    return this.#fluid;
  }

  setFluid(fluid) {
    this.#fluid = fluid;
  }

  isUsingReactorCoolantInjectors() {
    return this.#usingReactorCoolantInjectors;
  }

  setUsingReactorCoolantInjectors(value) {
    this.#usingReactorCoolantInjectors = value;
  }

  getOnPulse() {
    return this.#onPulse;
  }

  setOnPulse(value) {
    this.#onPulse = value;
  }

  getOffPulse() {
    return this.#offPulse;
  }

  setOffPulse(value) {
    this.#offPulse = value;
  }

  getSuspendTemp() {
    return this.#suspendTemp;
  }

  setSuspendTemp(value) {
    this.#suspendTemp = value;
  }

  getResumeTemp() {
    return this.#resumeTemp;
  }

  setResumeTemp(value) {
    this.#resumeTemp = value;
  }

  isPulsed() {
    return this.#pulsed;
  }

  setPulsed(value) {
    this.#pulsed = value;
  }

  isAutomated() {
    return this.#automated;
  }

  setAutomated(value) {
    this.#automated = value;
  }

  getMaxSimulationTicks() {
    return this.#maxSimulationTicks;
  }

  setMaxSimulationTicks(value) {
    this.#maxSimulationTicks = value;
  }

  resetPulseConfig() {
    this.#onPulse = DEFAULT_ON_PULSE;
    this.#offPulse = DEFAULT_OFF_PULSE;
    this.#suspendTemp = DEFAULT_SUSPEND_TEMP;
    this.#resumeTemp = DEFAULT_RESUME_TEMP;
  }
}
