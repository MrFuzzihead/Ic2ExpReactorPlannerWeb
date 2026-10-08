/**
 * What a finished run left on the grid: the cells that melted down and the cells that still held
 * heat.
 *
 * The desktop's simulator is a `SwingWorker`, and the run's grid state travels through its message
 * channel as one-line chunks: `AutomationSimulator` publishes `R%dC%d:0xRRGGBB` (`:191` silver,
 * `:367` orange, `:686` red), and the worker's own `process` (`:984-997`) decodes each one onto
 * `reactorButtonPanels[row][col]` — the frame's *design* grid, not a grid of the run's own — and
 * sets the button's tooltip to `ComponentTooltip.Broken` or `ComponentTooltip.ResidualHeat`. So
 * "what melts down" is not a report line: it is a background colour on the cell the visitor edits,
 * and it stays there until the next run paints every cell silver again (`:191-193` walks all 54
 * cells before the loop starts).
 *
 * `automation-simulator.js` already ports the routing — `process` records the chunks in
 * `run.cellPaint` rather than dropping them — so this file is only the page's two decisions over
 * that data:
 *
 * - **Only a cell the board shows an icon for gets a marker.** The desktop paints all 54 buttons
 *   silver, which on a Swing grid is the same colour every button starts with; on this page an
 *   empty cell carries its own drawing and a closed column carries the cross-hatch, and a run that
 *   painted over both would silently flatten the page's two pieces of board vocabulary. Silver is
 *   therefore read as "no marker" rather than as a colour.
 * - **The colour is the data, the words are the bundle's.** `0xFF0000` and `0xFFA500` are named
 *   once here, next to the Java lines that publish them, and the tooltip text comes from the
 *   bundle — the page shows those words as a legend because a browser has no hover on a phone and
 *   a screenshot has no tooltip at all.
 *
 * @see src/Ic2ExpReactorPlanner/AutomationSimulator.java:984-997, web/engine/automation-simulator.js
 */

import { getI18n } from '../engine/i18n.js';

/** The red the run publishes for a component that broke (`AutomationSimulator:686`). */
export const MELT_COLOUR = '0xFF0000';
/** The orange for a component that still held heat at the end (`:367`). */
export const RESIDUAL_COLOUR = '0xFFA500';
/** The silver every cell is cleared to before the loop starts (`:191`). */
export const CLEAR_COLOUR = '0xC0C0C0';

/**
 * The cells a finished run marks, in board order.
 *
 * @param cellPaint the run's `cellPaint` map (flat cell index → `{colour, tooltip}`)
 * @param filled the indices the board shows an icon for
 * @returns {Array} one `{index, kind, colour, tooltip}` per marked cell, lowest index first
 */
export function runMarks(cellPaint, filled) {
  const marks = [];
  for (const index of filled) {
    const paint = cellPaint.get(index);
    if (paint === undefined) continue;
    // A cell the run painted with a colour the desktop does not name stays unmarked: the page has
    // no word for it, and inventing one here would be a legend the bundle cannot back.
    if (paint.colour === MELT_COLOUR) marks.push({ index, kind: 'melt', colour: paint.colour, tooltip: paint.tooltip });
    else if (paint.colour === RESIDUAL_COLOUR) marks.push({ index, kind: 'residual', colour: paint.colour, tooltip: paint.tooltip });
  }
  marks.sort((a, b) => a.index - b.index);
  return marks;
}

/**
 * The legend the colours need: the words for the marks that are actually on the board, in the
 * order the desktop's `process` tests the colours (`:990` silver, `:992` broken, `:994` residual).
 *
 * @param marks the array from `runMarks`
 * @returns {Array} `{kind, words}` pairs, empty when nothing is marked
 */
export function runLegend(marks) {
  const kinds = new Set(marks.map((mark) => mark.kind));
  const legend = [];
  if (kinds.has('melt')) legend.push({ kind: 'melt', words: getI18n('ComponentTooltip.Broken') });
  if (kinds.has('residual')) legend.push({ kind: 'residual', words: getI18n('ComponentTooltip.ResidualHeat') });
  return legend;
}
