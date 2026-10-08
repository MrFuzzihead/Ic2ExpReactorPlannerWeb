/**
 * Stage 4's board editing: a design and one tap in, a design out. DOM-free on purpose, like
 * `board.js` and `palette.js`, so the design a phone produces after a tap is a design a test can
 * re-read.
 *
 * The code string is the design (the preferences decision, `WEB_DESIGN.md` §2), so every edit ends
 * by writing one back through `encodeBase64Code` — the same function `code-roundtrip` and
 * `code-fuzz` prove green against the desktop. Editing therefore cannot invent a second
 * representation of a reactor that the desktop would read differently: what a tap produces is a
 * code the desktop already accepts.
 *
 * A cell is `{ id, initialHeat, automationThreshold, reactorPause }` (`reactor-code.js`'s shape,
 * deliberately catalog-agnostic), and the two automation parameters have *per-component* defaults —
 * placing one at the wrong default would encode a flag bit the desktop does not encode.
 *
 * @see engine/reactor-code.js, engine/automation-simulator.js#codeDefaults, WEB_DESIGN.md
 */

import { encodeBase64Code, encodeLegacyCode, decodeCode } from '../engine/reactor-code.js';
import { codeDefaults } from '../engine/automation-simulator.js';
import { createComponent } from '../engine/components.js';
import { CELL_COUNT } from '../data/bounds.js';

/** Is that tap on the board at all? A tap outside the grid is a miss, not an error. */
export function onBoard(index) {
  return Number.isInteger(index) && index >= 0 && index < CELL_COUNT;
}

/**
 * Take a component out of a cell.
 *
 * @param design a design (mutated in place — the page keeps exactly one)
 * @param index a board index
 * @returns {Object} `{ ok, design }`, or `{ ok: false, message }`
 */
export function clearCell(design, index) {
  if (!onBoard(index)) return { ok: false, message: 'no such cell' };
  if (design.cells[index] === null) return { ok: false, message: 'that cell is already empty' };
  design.cells[index] = null;
  return { ok: true, design };
}

/**
 * Every cell emptied, the reactor-level switches left alone -- the design half of the engine's
 * `Reactor#clearGrid` (`Reactor.java:106`), which walks the grid and touches nothing else. Unlike
 * `clearCell` there is nothing to refuse: the desktop's button acts on an already-empty grid too.
 */
export function clearDesign(design) {
  for (let index = 0; index < design.cells.length; index++) design.cells[index] = null;
  return { ok: true, design };
}

/**
 * Put the selected component into a cell.
 *
 * `params` is what `Pick` hands over: the three settings of the cell it was taken from. Left out,
 * the component's own defaults are used, which is what makes a freshly placed rod encode without
 * a parameter flag — the desktop writes the same bits.
 *
 * @param design a design (mutated in place)
 * @param index a board index
 * @param id a catalog id
 * @param catalog a parsed catalog
 * @param params optional `{ initialHeat, automationThreshold, reactorPause }`
 * @returns {Object} `{ ok, design, cell }`, or `{ ok: false, message }`
 */
export function placeComponent(design, index, id, catalog, params) {
  if (!onBoard(index)) return { ok: false, message: 'no such cell' };
  const component = createComponent(catalog, id);
  if (component === null) return { ok: false, message: 'that component is not in this catalog' };

  const cell = {
    id,
    initialHeat: params?.initialHeat ?? 0,
    automationThreshold: params?.automationThreshold ?? component.automationThreshold,
    reactorPause: params?.reactorPause ?? component.reactorPause,
  };
  design.cells[index] = cell;
  return { ok: true, design, cell };
}

/**
 * Read a cell's component and its three settings, for the palette to adopt. The design is
 * untouched: `Pick` copies, it does not move.
 *
 * @returns {Object} `{ ok, id, params }`, or `{ ok: false, message }`
 */
export function pickUp(design, index) {
  if (!onBoard(index)) return { ok: false, message: 'no such cell' };
  const cell = design.cells[index];
  if (cell === null) return { ok: false, message: 'that cell is empty' };
  return {
    ok: true,
    id: cell.id,
    params: {
      initialHeat: cell.initialHeat,
      automationThreshold: cell.automationThreshold,
      reactorPause: cell.reactorPause,
    },
  };
}

/** A copy of a design, so an edit that fails to encode cannot leave a half-applied one behind. */
export function copyDesign(design) {
  return {
    ...design,
    cells: design.cells.map((cell) => cell === null ? null : { ...cell }),
  };
}

/**
 * The code for a design, or the reason there is none. `encodeBase64Code` throws when a field
 * cannot be stored — a heat above the code's bound, an automation threshold past its own — and a
 * thrown error in the middle of a tap would be an uncaught one in the page.
 *
 * @param design a design
 * @param catalog a parsed catalog
 * @returns {Object} `{ ok: true, code }` or `{ ok: false, message }`
 */
export function writeCode(design, catalog) {
  try {
    return { ok: true, code: encodeBase64Code(design, codeDefaults(catalog)) };
  } catch (problem) {
    return { ok: false, message: `the design no longer fits a reactor code (${problem.message})` };
  }
}

/**
 * The same design in the desktop's old-style format (`Reactor#getOldCode`, which the page reaches
 * through `UI.ShowOldStyleReactorCode`). Two fields are worth naming because the old format is
 * narrower than the current one, and the difference is not cosmetic:
 *
 *   - a component id above 255 does not fit the two hex digits the format writes, so a catalog
 *     that big cannot be rendered at all — `encodeLegacyCode` throws rather than truncating;
 *   - the tick limit has no slot in the format at all, so a code read back through
 *     `readLegacyCode` gets the default limit instead of the design's own.
 *
 * The page therefore keeps the tick limit from the design it just wrote rather than re-reading it
 * from the field, and refuses a design the format cannot render.
 *
 * @param design a design
 * @param catalog a parsed catalog
 * @returns {Object} `{ ok: true, code }` or `{ ok: false, message }`
 */
export function writeLegacyCode(design, catalog) {
  try {
    return { ok: true, code: encodeLegacyCode(design, codeDefaults(catalog)) };
  } catch (problem) {
    return { ok: false, message: `the design no longer fits an old-style reactor code (${problem.message})` };
  }
}

/** A code back into a design, for a page that has a code and no decoded one yet. */
export function readDesign(code, catalog) {
  const read = decodeCode(code, { defaults: codeDefaults(catalog) });
  return read.ok ? { ok: true, design: read.design } : read;
}
