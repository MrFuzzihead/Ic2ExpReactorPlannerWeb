/**
 * Every bound the reactor code format carries, named once.
 *
 * Ported from `Reactor.java`'s public constants. These are load-bearing in both directions:
 * `BigintStorage.store` refuses a value it cannot store, and `extract` must use the same bound
 * the writer used or every field after the first one shifts. A mismatch does not throw, it
 * silently decodes a different reactor -- which is why the bounds live here, in one file,
 * rather than being re-typed at each call site the way the Java original does.
 *
 * @see engine/bigint-storage.js, engine/reactor-code.js
 */

// --- grid ---------------------------------------------------------------------
export const GRID_ROWS = 6;
export const GRID_COLS = 9;
export const CELL_COUNT = GRID_ROWS * GRID_COLS;
export const MAX_PARAM_TYPES = 3;

// --- pulse / automation defaults ---------------------------------------------
export const DEFAULT_ON_PULSE = 5_000_000;
export const DEFAULT_OFF_PULSE = 0;
export const DEFAULT_SUSPEND_TEMP = 120_000;
export const DEFAULT_RESUME_TEMP = 120_000;

// --- code bounds --------------------------------------------------------------
// CODE_TEMP_BOUND is derived, not literal, in the original. It only happens to equal 120e3
// today; if the defaults ever change, the bound changes with them.
export const CODE_TEMP_BOUND = Math.max(DEFAULT_SUSPEND_TEMP, DEFAULT_RESUME_TEMP);
export const CODE_HEAT_BOUND = 120_000;
export const MAX_COMPONENT_HEAT = 1_080_000;
export const MAX_AUTOMATION_THRESHOLD = 1_000_000_000;
export const MAX_PULSE_DURATION = 5_000_000;
export const MAX_SIMULATION_TICKS = 5_000_000;
export const MAX_REACTOR_PAUSE = 10_000;

// The base64 writer stores initialHeat with a fixed 1e9 bound regardless of revision, while
// the reader extracts it with the revision's maxComponentHeat. Both numbers appear in the
// format; keeping them as one constant would break every pre-revision-4 code.
export const CODE_INITIAL_HEAT_BOUND = 1_000_000_000;

// --- revisions ---------------------------------------------------------------
export const CODE_REVISION = 4; // what this build writes
export const MAX_SUPPORTED_CODE_REVISION = 4;

/** The heat bound a reader of this revision extracts component heat with. */
export function maxComponentHeatForRevision(revision) {
  if (revision === 4) return 1_000_000_000;
  if (revision === 3) return 1_080_000;
  return 360_000; // revisions 0..2
}

/** The component-id bound a reader of this revision extracts ids with. */
export function componentIdBoundForRevision(revision) {
  if (revision <= 1) return 38;
  if (revision === 2) return 44;
  if (revision === 3) return 58;
  return 72;
}

// --- component parameter defaults (ReactorItem's field initialisers) ---------
export const DEFAULT_AUTOMATION_THRESHOLD = 9000;
export const DEFAULT_REACTOR_PAUSE = 0;
export const DEFAULT_INITIAL_HEAT = 0;
