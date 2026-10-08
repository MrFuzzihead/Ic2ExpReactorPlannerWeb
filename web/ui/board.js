/**
 * Stage 4's board model: a reactor code in, a renderable grid out. DOM-free on purpose, so the
 * grid a phone draws is the grid a test can assert against.
 *
 * The code string is the design, so this module's whole job is the one translation the app needs
 * most often: `decodeCode`'s flat `CELL_COUNT` array into positioned cells, with the display
 * fields (name, icon, per-cell automation params) resolved against the catalog. `decodeCode` is
 * called with the same defaults table the simulator uses -- see `codeDefaults`'s comment on why
 * an empty table is wrong -- so a cell shown here carries the same `h`/`a`/`p` values the
 * simulation runs with.
 *
 * @see engine/reactor-code.js, engine/automation-simulator.js
 */

import { decodeCode } from '../engine/reactor-code.js';
import { codeDefaults } from '../engine/automation-simulator.js';
import { parseCatalog, createComponent, getComponentCount } from '../engine/components.js';
import { getI18n } from '../engine/i18n.js';
import { GRID_ROWS, GRID_COLS, CELL_COUNT } from '../data/bounds.js';

/** Where the copied icons live, relative to the page at `web/ui/index.html`. */
const ICON_ROOT = '../assets/icons/';

/**
 * Columns the Nuclear Reactor block itself brings, before any Reactor Chamber is installed. The
 * engine has no chamber concept -- `Reactor.java` is a fixed 6 x 9 grid with nothing modelling how
 * wide a build is -- so this is a web-side rule, and the one the game enforces: each chamber opens
 * one 6 x 1 column, and six of them take the grid from these 3 columns to the 9 the code can carry.
 */
export const CORE_COLS = 3;

/**
 * The fewest Reactor Chambers a design needs: the widest column it fills, past the 3 the Nuclear
 * Reactor block brings itself. The code format has no field for this -- `Reactor.java` is a fixed
 * 6 x 9 grid -- so it is a property of the cells rather than of the code, and it is what the page
 * refuses to lower its chamber selection below.
 *
 * @param design a design (see `board-edit.js`)
 * @returns {Number} 0..6
 */
export function impliedChambers(design) {
  let widest = -1;
  for (let index = 0; index < design.cells.length; index++) {
    if (design.cells[index] === null) continue;
    const col = index % GRID_COLS;
    if (col > widest) widest = col;
  }
  return Math.max(0, Math.min(widest + 1, GRID_COLS) - CORE_COLS);
}

/**
 * @param code a reactor code (`erp=…`, legacy, or empty for the default board)
 * @param catalog a parsed catalog (see `components.js#parseCatalog`)
 * @returns {Object} `{ ok: true, design, cells, filled, bounds, minChambers }`, or the decoder's
 *   `{ ok: false, title, message }` unchanged -- the UI shows that text verbatim, which is
 *   Java's own behaviour for an unreadable code.
 */
export function describeBoard(code, catalog) {
  const read = decodeCode(code, { defaults: codeDefaults(catalog) });
  if (!read.ok) return read;

  const design = read.design;
  const cells = [];
  for (let index = 0; index < CELL_COUNT; index++) {
    const cell = design.cells[index];
    if (cell === null) continue;
    const prototype = createComponent(catalog, cell.id);
    if (prototype === null) continue; // a code that names an id this catalog lacks
    cells.push({
      index,
      row: Math.floor(index / GRID_COLS),
      col: index % GRID_COLS,
      id: cell.id,
      kind: prototype.kind,
      name: getI18n(prototype.nameKey),
      icon: ICON_ROOT + prototype.image,
      iconFallback: prototype.fallbackImage,
      initialHeat: cell.initialHeat,
      automationThreshold: cell.automationThreshold,
      reactorPause: cell.reactorPause,
    });
  }

  return {
    ok: true,
    design,
    cells,
    filled: cells.length,
    bounds: { rows: GRID_ROWS, cols: GRID_COLS },
    minChambers: impliedChambers(design),
  };
}

/**
 * The catalog's per-component display fields, keyed by id, for the palette and the legend.
 * Resolved once per catalog rather than per cell. Each entry carries its own `id` as well: a
 * visitor places a component *by* id, and a palette entry that cannot name its id is a control
 * that draws a component the page then has to guess back.
 */
export function catalogDisplay(catalog) {
  const display = [];
  for (let id = 1; id <= getComponentCount(catalog); id++) {
    const prototype = createComponent(catalog, id);
    if (prototype === null) continue;
    display[id] = {
      id,
      kind: prototype.kind,
      name: getI18n(prototype.nameKey),
      icon: ICON_ROOT + prototype.image,
      iconFallback: prototype.fallbackImage,
      sourceMod: prototype.sourceMod,
    };
  }
  return display;
}
