/**
 * Stage 4's `Inspect` readout: a finished run and one cell in, the desktop's popover text out.
 *
 * The desktop's shape is two buttons on every cell (`ReactorPlannerFrame` lines 217-226): the info
 * button reads `simulatedReactor.getComponentAt(row, col)` and sets
 * `UI.ComponentInfoLastSimRowCol` with the component's label, its position, and whatever the run
 * appended to `component.info`. There is no per-cell computation here at all -- the run already put
 * the figures on the component (`automation-simulator.js`'s twelve `ComponentInfo.*` sites), so this
 * module only picks the right cell and formats the desktop's own sentence around it.
 *
 * A run is a separate step because the desktop keeps one too: `simulatedReactor` is null until a
 * simulation has finished, and the info button says `UI.NoSimulationRun` rather than inventing a
 * readout. The page holds the run the last `Inspect` tap produced and re-runs only when the code
 * changes, which is why `simulate` is exported apart from `inspectCell`.
 *
 * @see src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java (the info button), engine/automation-simulator.js
 */

import { simulateCode, componentToString } from '../engine/automation-simulator.js';
import { getI18n, formatI18n } from '../engine/i18n.js';
import { GRID_COLS } from '../data/bounds.js';

/**
 * Run the design a code holds, the way the desktop's `simulatedReactor` does.
 *
 * @param code a reactor code
 * @param catalog a parsed catalog
 * @param options passed through to `simulateCode` (`tickCap`, `csvRow`)
 * @returns {Object} `{ ok: true, run }`, or `{ ok: false, message }` for a code the decoder
 *   rejects -- `simulateCode` throws, and a readout module reports rather than throws.
 */
export function simulate(code, catalog, options = {}) {
  try {
    return { ok: true, run: simulateCode(code, catalog, options) };
  } catch (problem) {
    return { ok: false, message: problem.message };
  }
}

/**
 * One cell of a finished run.
 *
 * @param run a run from `simulate` (or its `null` before the first one, which is Java's
 *   `simulatedReactor == null`)
 * @param index the flat cell index the page tapped; anything off the grid answers through
 *   `getComponentAt`, which returns `null` for it
 * @returns {Object} `{ ok: true, index, row, col, name, lines, text }`, or
 *   `{ ok: false, message }` -- the message is always the bundle's (`UI.NoSimulationRun` for a
 *   page that has not run yet, `UI.NoComponentLastSimRowCol` for a cell the run left empty).
 *
 * `lines` is the run's own `component.info`, in the order the run appended it, each entry already
 * carrying its leading newline; `text` is the desktop's whole string, which is what a Swing label
 * gets. The page renders `lines` one line at a time and the test asserts `text`.
 */
export function inspectCell(run, index) {
  if (run === null || run === undefined) return { ok: false, message: getI18n('UI.NoSimulationRun') };

  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  const component = run.reactor.getComponentAt(row, col); // null for an empty or off-grid cell
  if (component === null) {
    return { ok: false, message: formatI18n('UI.NoComponentLastSimRowCol', row, col) };
  }

  const name = componentToString(component);
  const lines = component.info;
  return {
    ok: true,
    index,
    row,
    col,
    name,
    lines,
    text: formatI18n('UI.ComponentInfoLastSimRowCol', name, row, col, lines.join('')),
  };
}
