/**
 * The report half of a simulation: threshold times, first-break/first-deplete details, running
 * output statistics, and the heating/cooling totals.
 *
 * Port of `SimulationData.java`. The field names stay Java's because the report template reads
 * them by name and the corpus test compares them one by one.
 *
 * Three of these fields start at `Double.MAX_VALUE` rather than 0 -- `prebreakMinEUoutput`,
 * `predepleteMinTemp`, `minTemp` and their siblings are running minima, so an empty simulation
 * reports `MAX_VALUE` for them. That is Java's behaviour, and the report prints it; initialising
 * minima at 0 would silently hide a design that never produced output.
 *
 * @see src/Ic2ExpReactorPlanner/SimulationData.java
 */

import { INT_MAX, DOUBLE_MAX } from '../data/limits.js';

export class SimulationData {
  #d;

  constructor() {
    this.#d = {
      timeToBelow50: INT_MAX,
      timeToBurn: INT_MAX,
      timeToEvaporate: INT_MAX,
      timeToHurt: INT_MAX,
      timeToLava: INT_MAX,
      timeToXplode: INT_MAX,
      totalRodCount: 0,
      firstComponentBrokenTime: INT_MAX,
      firstComponentBrokenRow: -1,
      firstComponentBrokenCol: -1,
      firstComponentBrokenDescription: '',
      prebreakTotalEUoutput: 0,
      prebreakAvgEUoutput: 0,
      prebreakMinEUoutput: DOUBLE_MAX,
      prebreakMaxEUoutput: 0,
      prebreakTotalHUoutput: 0,
      prebreakAvgHUoutput: 0,
      prebreakMinHUoutput: DOUBLE_MAX,
      prebreakMaxHUoutput: 0,
      firstRodDepletedTime: INT_MAX,
      firstRodDepletedRow: -1,
      firstRodDepletedCol: -1,
      firstRodDepletedDescription: '',
      predepleteTotalEUoutput: 0,
      predepleteAvgEUoutput: 0,
      predepleteMinEUoutput: DOUBLE_MAX,
      predepleteMaxEUoutput: 0,
      predepleteTotalHUoutput: 0,
      predepleteAvgHUoutput: 0,
      predepleteMinHUoutput: DOUBLE_MAX,
      predepleteMaxHUoutput: 0,
      predepleteMinTemp: DOUBLE_MAX,
      predepleteMaxTemp: 0,
      totalReactorTicks: 0,
      totalEUoutput: 0,
      avgEUoutput: 0,
      minEUoutput: DOUBLE_MAX,
      maxEUoutput: 0,
      totalHUoutput: 0,
      avgHUoutput: 0,
      minHUoutput: DOUBLE_MAX,
      maxHUoutput: 0,
      minTemp: DOUBLE_MAX,
      maxTemp: 0,
      hullHeating: 0,
      componentHeating: 0,
      hullCooling: 0,
      hullCoolingCapacity: 0,
      ventCooling: 0,
      ventCoolingCapacity: 0,
      replacedItems: null,
    };
  }

  get(name) {
    return this.#d[name];
  }

  set(name, value) {
    this.#d[name] = value;
  }

  /** The whole record, for comparison and for the web UI's export. */
  values() {
    return this.#d;
  }
}
