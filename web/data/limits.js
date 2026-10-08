/**
 * The numeric sentinels the engine inherits from Java's field initialisers.
 *
 * `SimulationData` and `AutomationSimulator` both start their running minima at
 * `Double.MAX_VALUE` and their threshold times at `Integer.MAX_VALUE`, and those values reach
 * the report: a design that never boils reports `Integer.MAX_VALUE` as its time-to-explode, and
 * the corpus baseline collapses both to a short token rather than printing 309 digits.
 *
 * Keeping them named here is what makes "this run recorded nothing" distinguishable from
 * "this run recorded a very large number" in the comparison view.
 *
 * @see src/Ic2ExpReactorPlanner/SimulationData.java, test/Ic2ExpReactorPlanner/corpus/CorpusRunner.java
 */

/** Java's `Integer.MAX_VALUE`, the "never reached" sentinel for the temperature thresholds. */
export const INT_MAX = 2147483647;

/** Java's `Double.MAX_VALUE`, the "never recorded" sentinel for running minima. */
export const DOUBLE_MAX = Number.MAX_VALUE;

/** The corpus baseline's cutoff: anything at or above this prints as `MAX`. */
export const BASELINE_MAX_MAGNITUDE = 1e12;
