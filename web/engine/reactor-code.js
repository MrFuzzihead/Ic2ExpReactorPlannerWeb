/**
 * The reactor code layer: turn a design into a string, and a string back into a design.
 *
 * Ported from `Reactor.getCode()`, `Reactor.buildCodeString()`, `Reactor.setCode(String)`,
 * `Reactor.readCodeString(String)`, `Reactor.getOldCode()` and `Reactor.readLegacyCode(String)`.
 * Deliberately component-agnostic: a cell is `{ id, initialHeat, automationThreshold,
 * reactorPause }`, with no reference to the component catalog. Resolving ids to component
 * instances is Stage 2's job; the code format only ever carries ids and three integers.
 *
 * Field order is the whole contract. `BigintStorage` packs fields by multiplying and unpacks
 * them by dividing, so the reader must extract in exactly the reverse order the writer stored
 * them. The Java original encodes that coupling twice -- once in `buildCodeString`, once in
 * `readCodeString` -- and nothing checks that the two agree. The two functions below are
 * written side by side against one shared field list so that a future edit has one place to
 * change.
 *
 * @see data/bounds.js, engine/bigint-storage.js
 */

import {
  CELL_COUNT,
  CODE_HEAT_BOUND,
  CODE_INITIAL_HEAT_BOUND,
  CODE_REVISION,
  CODE_TEMP_BOUND,
  DEFAULT_AUTOMATION_THRESHOLD,
  DEFAULT_INITIAL_HEAT,
  DEFAULT_OFF_PULSE,
  DEFAULT_ON_PULSE,
  DEFAULT_REACTOR_PAUSE,
  DEFAULT_RESUME_TEMP,
  DEFAULT_SUSPEND_TEMP,
  GRID_COLS,
  GRID_ROWS,
  MAX_AUTOMATION_THRESHOLD,
  MAX_PULSE_DURATION,
  MAX_REACTOR_PAUSE,
  MAX_SIMULATION_TICKS,
  MAX_SUPPORTED_CODE_REVISION,
  componentIdBoundForRevision,
  maxComponentHeatForRevision,
} from '../data/bounds.js';
import { BigintStorage } from './bigint-storage.js';

const CODE_PREFIX = 'erp=';

/**
 * A component's default automation parameters, which is what "the code did not carry them"
 * means. These are per component, not global: `buildCodeString` compares against
 * `getDefaultComponent(id)`, and `ReactorItem`'s constructor derives the threshold from the
 * component's own capacity (maxHeat*0.9, else maxDamage*1.1, else 9000). Assuming the global
 * 9000 makes a code that reads back as a different design -- it was one of the two divergences
 * this port found against the Java oracle.
 *
 * @param defaults an array indexed by id, an object keyed by id, or a Map
 */
function defaultParamsFor(id, defaults) {
  const entry = defaults instanceof Map ? defaults.get(id)
              : Array.isArray(defaults) ? defaults[id]
              : defaults[id];
  return entry ?? { automationThreshold: DEFAULT_AUTOMATION_THRESHOLD, reactorPause: DEFAULT_REACTOR_PAUSE };
}

/** A blank design: everything at its default, no components placed. */
export function defaultDesign() {
  return {
    revision: CODE_REVISION,
    cells: Array(CELL_COUNT).fill(null),
    currentHeat: 0,
    onPulse: DEFAULT_ON_PULSE,
    offPulse: DEFAULT_OFF_PULSE,
    suspendTemp: DEFAULT_SUSPEND_TEMP,
    resumeTemp: DEFAULT_RESUME_TEMP,
    fluid: false,
    injectors: false,
    pulsed: false,
    automated: false,
    maxSimulationTicks: MAX_SIMULATION_TICKS,
  };
}

/**
 * @param design a design
 * @param defaults per-component parameter defaults (see `defaultParamsFor`)
 * @returns {String} the code, including the `erp=` prefix
 * @throws {RangeError} when a field cannot be stored
 */
export function encodeBase64Code(design, defaults) {
  const storage = new BigintStorage();
  storage.store(design.maxSimulationTicks, MAX_SIMULATION_TICKS);
  storage.store(design.injectors ? 1 : 0, 1);
  storage.store(design.fluid ? 1 : 0, 1);
  if (design.pulsed) {
    storage.store(design.resumeTemp, CODE_TEMP_BOUND);
    storage.store(design.suspendTemp, CODE_TEMP_BOUND);
    storage.store(design.offPulse, MAX_PULSE_DURATION);
    storage.store(design.onPulse, MAX_PULSE_DURATION);
  }
  storage.store(design.currentHeat, CODE_HEAT_BOUND);

  for (let row = GRID_ROWS - 1; row >= 0; row--) {
    for (let col = GRID_COLS - 1; col >= 0; col--) {
      const cell = design.cells[row * GRID_COLS + col];
      if (cell === null) {
        storage.store(0, componentIdBoundForRevision(CODE_REVISION));
        continue;
      }
      // The flag bit is written when any parameter differs from this component's default.
      const fallback = defaultParamsFor(cell.id, defaults);
      if (cell.initialHeat > 0
          || cell.automationThreshold !== fallback.automationThreshold
          || cell.reactorPause !== fallback.reactorPause) {
        if (design.automated) {
          storage.store(cell.reactorPause, MAX_REACTOR_PAUSE);
          storage.store(cell.automationThreshold, MAX_AUTOMATION_THRESHOLD);
        }
        storage.store(cell.initialHeat, CODE_INITIAL_HEAT_BOUND);
        storage.store(1, 1);
      } else {
        storage.store(0, 1);
      }
      storage.store(cell.id, componentIdBoundForRevision(CODE_REVISION));
    }
  }

  storage.store(design.automated ? 1 : 0, 1);
  storage.store(design.pulsed ? 1 : 0, 1);
  storage.store(CODE_REVISION, 255);
  return CODE_PREFIX + storage.outputBase64();
}

/**
 * Reads one code into a design.
 * @param code with or without the `erp=` prefix
 * @param base design to start from; fields the code does not carry keep their base value.
 *        Defaults to a blank design, which is what a fresh reactor gives.
 * @param defaults per-component parameter defaults
 * @returns {BigIntStorage} the same storage the caller then extracts from
 * @throws whatever `extract` throws -- the caller catches and reports one warning
 */
function readCodeFields(code, base, defaults) {
  const design = base ?? defaultDesign();
  const storage = BigintStorage.inputBase64(code);

  const revision = Number(storage.extract(255));
  if (revision > MAX_SUPPORTED_CODE_REVISION) {
    throw new RangeError(`Unsupported reactor code revision ${revision}`);
  }
  const maxComponentHeat = maxComponentHeatForRevision(revision);
  const idBound = componentIdBoundForRevision(revision);

  // The writer stores automated then pulsed, so the reader must extract pulsed first.
  // Reactor.java:669-670 has that order; reading them the other way round silently swaps the
  // two flags and shifts every field after the grid.
  const newPulsed = revision >= 1 ? Number(storage.extract(1)) > 0 : design.pulsed;
  const newAutomated = revision >= 1 ? Number(storage.extract(1)) > 0 : design.automated;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const id = Number(storage.extract(idBound));
      const at = row * GRID_COLS + col;
      if (id === 0) {
        design.cells[at] = null;
        continue;
      }
      const fallback = defaultParamsFor(id, defaults);
      const cell = {
        id,
        initialHeat: DEFAULT_INITIAL_HEAT,
        automationThreshold: fallback.automationThreshold,
        reactorPause: fallback.reactorPause,
      };
      if (Number(storage.extract(1)) > 0) {
        cell.initialHeat = Number(storage.extract(maxComponentHeat));
        if (revision === 0 || newAutomated) {
          cell.automationThreshold = Number(storage.extract(maxComponentHeat));
          cell.reactorPause = Number(storage.extract(MAX_REACTOR_PAUSE));
        }
      }
      design.cells[at] = cell;
    }
  }

  const newCurrentHeat = Number(storage.extract(CODE_HEAT_BOUND));
  if (revision === 0 || newPulsed) {
    const newOnPulse = Number(storage.extract(MAX_PULSE_DURATION));
    const newOffPulse = Number(storage.extract(MAX_PULSE_DURATION));
    const newSuspendTemp = Number(storage.extract(CODE_TEMP_BOUND));
    const newResumeTemp = Number(storage.extract(CODE_TEMP_BOUND));
    if (newOnPulse !== design.onPulse
        || newOffPulse !== design.offPulse
        || newSuspendTemp !== design.suspendTemp
        || newResumeTemp !== design.resumeTemp) {
      design.onPulse = newOnPulse;
      design.offPulse = newOffPulse;
      design.suspendTemp = newSuspendTemp;
      design.resumeTemp = newResumeTemp;
    }
  }
  design.fluid = Number(storage.extract(1)) > 0;
  design.injectors = Number(storage.extract(1)) > 0;
  if (revision === 0) {
    design.pulsed = Number(storage.extract(1)) > 0;
    design.automated = Number(storage.extract(1)) > 0;
  } else {
    design.pulsed = newPulsed;
    design.automated = newAutomated;
  }
  design.currentHeat = newCurrentHeat;
  design.maxSimulationTicks = Number(storage.extract(MAX_SIMULATION_TICKS));
  design.revision = revision;
  return design;
}

/**
 * @param code with or without the `erp=` prefix
 * @returns {Object} design
 * @throws {TypeError|RangeError} malformed payload, unsupported revision, or a field out of
 *   range -- all of which `decodeCode` turns into a single user-facing warning.
 */
export function readCodeString(code, base, defaults) {
  return readCodeFields(code, base, defaults);
}

// ---------------------------------------------------------------------------
// Legacy pre-2.3.1 hex code. A shared code format, not a legacy feature: codes this build
// writes are read by other planners, and codes other planners write have to read here.
// ---------------------------------------------------------------------------

/**
 * @param design
 * @param defaults per-component parameter defaults
 * @returns {String} the 108-hex-digit legacy code
 * @throws {RangeError} an id above 255, which `%02X` cannot carry
 */
export function encodeLegacyCode(design, defaults) {
  let out = '';
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cell = design.cells[row * GRID_COLS + col];
      if (cell === null) {
        out += '00';
        continue;
      }
      if (cell.id > 255) {
        throw new RangeError(`Cannot write id ${cell.id} in the legacy code format`);
      }
      out += cell.id.toString(16).toUpperCase().padStart(2, '0');
      // Unlike the base64 writer, the legacy writer only carries the automation parameters
      // when the reactor is automated -- the format predates per-component automation.
      const fallback = defaultParamsFor(cell.id, defaults);
      const hasParams = cell.initialHeat > 0
          || (design.automated && cell.automationThreshold !== fallback.automationThreshold)
          || (design.automated && cell.reactorPause !== fallback.reactorPause);
      if (hasParams) {
        const parts = [];
        if (cell.initialHeat > 0) parts.push('h' + Math.round(cell.initialHeat).toString(36));
        if (design.automated && cell.automationThreshold !== fallback.automationThreshold) {
          parts.push('a' + cell.automationThreshold.toString(36));
        }
        if (design.automated && cell.reactorPause !== fallback.reactorPause) {
          parts.push('p' + cell.reactorPause.toString(36));
        }
        out += '(' + parts.join(',') + ')';
      }
    }
  }
  out += '|';
  out += design.fluid ? 'f' : 'e';
  out += design.automated ? 'a' : design.pulsed ? 'p' : 's';
  out += design.injectors ? 'i' : 'n';
  if (design.currentHeat > 0) out += Math.round(design.currentHeat).toString(36);
  if (design.pulsed && design.onPulse !== DEFAULT_ON_PULSE) {
    out += '|n' + design.onPulse.toString(36);
  }
  if (design.pulsed && design.offPulse !== DEFAULT_OFF_PULSE) {
    out += '|f' + design.offPulse.toString(36);
  }
  if (design.pulsed && design.suspendTemp !== DEFAULT_SUSPEND_TEMP) {
    out += '|s' + design.suspendTemp.toString(36);
  }
  if (design.pulsed && design.resumeTemp !== DEFAULT_RESUME_TEMP) {
    out += '|r' + design.resumeTemp.toString(36);
  }
  return out;
}

/**
 * Java's `String.split` drops trailing empty segments; `String.split` does not. A code ending
 * in `|` therefore parses differently in the two languages, and the Java reading is the one
 * that has to be reproduced.
 */
function javaSplitOnPipe(code) {
  const parts = code.split('|');
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Java's `String.charAt(i)` throws when out of range; JS yields `undefined`. */
function charAtOrThrow(s, i) {
  if (i < 0 || i >= s.length) {
    throw new RangeError(`Index ${i} out of range for string of length ${s.length}`);
  }
  return s[i];
}

/**
 * Java's `Integer.parseInt(s, radix)`, which throws rather than returning NaN.
 *
 * JS's `parseInt` is much laxer, and the difference matters here: it returns NaN only when the
 * FIRST character is invalid, silently truncates the rest, and has no range limit. Java rejects
 * an empty string, any character that is not a digit in `radix`, and anything outside signed 32-
 * bit -- which is exactly what makes `|nzyzzzz` a refusal rather than a huge on-pulse.
 */
function parseIntOrThrow(s, radix) {
  // Java's Integer.parseInt is strict about the digit set, not just "is this a number": for radix
  // 16 it rejects `5x`, while JS's parseInt would quietly return 5. Build the digit class from
  // the radix so a code that leans on either laxness is refused rather than mis-read.
  const letters = 'abcdefghijklmnopqrstuvwxyz'.slice(0, Math.max(0, radix - 10));
  if (!new RegExp(`^[+-]?[0-9${letters}]+$`, 'i').test(s)) {
    throw new TypeError(`Cannot parse ${JSON.stringify(s)} as a base ${radix} integer`);
  }
  const value = Number.parseInt(s, radix);
  if (Number.isNaN(value) || value < -2147483648 || value > 2147483647) {
    throw new RangeError(`${JSON.stringify(s)} is not a base ${radix} integer Java can hold`);
  }
  return value;
}

/**
 * Reads a legacy pre-2.3.1 code.
 * @param code
 * @param base design to start from
 * @returns {Object} design
 * @throws {TypeError|RangeError}
 */
export function readLegacyCode(code, base, defaults) {
  const design = base ?? defaultDesign();
  // Java parses the suffix into locals and only assigns them if the suffix is present, so a
  // code with no suffix leaves the base design's flags alone. `automated` has to be function-
  // scoped because the switch that sets it lives inside that presence check.
  let pulsed = design.pulsed;
  let automated = design.automated;
  let haveCurrentHeat = false;
  const parts = javaSplitOnPipe(code);
  const idsAndParams = parts[0];

  // The suffix is only parsed when it is there. Java's switches call charAt on it and throw when
  // it is missing, which the caller turns into a warning; a code with no suffix at all is simply
  // the grid, and leaves the base design's flags alone.
  if (parts.length > 1) {
    const extraCode = parts[1];
    switch (charAtOrThrow(extraCode, 0)) {
      case 'f': design.fluid = true; break;
      case 'e': design.fluid = false; break;
      default: break;
    }
    switch (charAtOrThrow(extraCode, 1)) {
      case 's': pulsed = false; automated = false; break;
      case 'p': pulsed = true; automated = false; break;
      case 'a': pulsed = true; automated = true; break;
      default: break;
    }
    switch (charAtOrThrow(extraCode, 2)) {
      case 'i': design.injectors = true; break;
      case 'n': design.injectors = false; break;
      default: break;
    }
    if (extraCode.length > 3) {
      design.currentHeat = parseIntOrThrow(extraCode.slice(3), 36);
      haveCurrentHeat = true;
    }
  }
  for (let i = 2; i < parts.length; i++) {
    const flag = charAtOrThrow(parts[i], 0);
    const value = parseIntOrThrow(parts[i].slice(1), 36);
    switch (flag) {
      case 'n': design.onPulse = value; break;
      case 'f': design.offPulse = value; break;
      case 's': design.suspendTemp = value; break;
      case 'r': design.resumeTemp = value; break;
      default: break; // Java's switch default breaks
    }
  }

  let pos = 0;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const id = parseIntOrThrow(idsAndParams.slice(pos, pos + 2), 16);
      pos += 2;
      const at = row * GRID_COLS + col;
      if (id === 0) {
        design.cells[at] = null;
        continue;
      }
      const fallback = defaultParamsFor(id, defaults);
      const cell = {
        id,
        initialHeat: DEFAULT_INITIAL_HEAT,
        automationThreshold: fallback.automationThreshold,
        reactorPause: fallback.reactorPause,
      };
      // Java's guard is measured against the WHOLE code, not the part before the first pipe:
      // `pos + 1 < code.length() && code.charAt(pos) == '('`. Walking only the 108 id characters
      // makes a code whose last cell is the 54th one throw, which rejected a perfectly valid
      // legacy code (the `pulsed-defaults` fixture hits exactly this).
      const cellTypes = [];
      if (pos + 1 < code.length && code[pos] === '(') {
        pos++;
        while (pos < idsAndParams.length && idsAndParams[pos] !== ')') {
          const paramType = idsAndParams[pos];
          pos++;
          let paramValue = '';
          while (pos < idsAndParams.length && idsAndParams[pos] !== ',' && idsAndParams[pos] !== ')') {
            paramValue += idsAndParams[pos];
            pos++;
          }
          cellTypes.push([paramType, paramValue]);
          if (idsAndParams[pos] === ',') pos++;
        }
        pos++; // consume ')'
      }
      for (const [paramType, paramValue] of cellTypes) {
        switch (paramType) {
          case 'h': cell.initialHeat = parseIntOrThrow(paramValue, 36); break;
          case 'a': cell.automationThreshold = parseIntOrThrow(paramValue, 36); break;
          case 'p': cell.reactorPause = parseIntOrThrow(paramValue, 36); break;
          default: break;
        }
      }
      design.cells[at] = cell;
    }
  }

  // A legacy code carries values the current code format cannot store. Refuse rather than
  // accept a design that would then fail to write back out. The reactor-level checks below are
  // load-bearing: the fuzz test found a legacy code that carries a current heat far above
  // CODE_HEAT_BOUND, and without this refusal the design it lands on has a getCode() that throws
  // -- exactly the state setCode promises never to create.
  if (haveCurrentHeat) requireValueEncodable('current heat', design.currentHeat, CODE_HEAT_BOUND);
  requireValueEncodable('on-pulse', design.onPulse, MAX_PULSE_DURATION);
  requireValueEncodable('off-pulse', design.offPulse, MAX_PULSE_DURATION);
  requireValueEncodable('suspend temperature', design.suspendTemp, CODE_TEMP_BOUND);
  requireValueEncodable('resume temperature', design.resumeTemp, CODE_TEMP_BOUND);
  if (design.onPulse + design.offPulse > 2147483647) {
    throw new RangeError('the pulse durations overflow');
  }
  requireDesignEncodable(design);
  design.pulsed = pulsed;
  design.automated = automated;
  return design;
}

/** Java's `requireEncodable`: a value the code writer could not store, negative included. */
function requireValueEncodable(what, value, max) {
  if (value < 0 || value > max) {
    throw new RangeError(`${what} of ${value} is outside the encodable range of ${max}`);
  }
}

function requireDesignEncodable(design) {
  const idBound = componentIdBoundForRevision(CODE_REVISION);
  const heatBound = maxComponentHeatForRevision(CODE_REVISION);
  for (const cell of design.cells) {
    if (cell === null) continue;
    if (cell.id > idBound) {
      throw new RangeError(`Cannot store component id ${cell.id} in a reactor code`);
    }
    if (cell.initialHeat > heatBound) {
      throw new RangeError(`Cannot store initial heat ${cell.initialHeat} in a reactor code`);
    }
    if (cell.automationThreshold > MAX_AUTOMATION_THRESHOLD) {
      throw new RangeError(`Cannot store automation threshold ${cell.automationThreshold} in a reactor code`);
    }
    if (cell.reactorPause > MAX_REACTOR_PAUSE) {
      throw new RangeError(`Cannot store reactor pause ${cell.reactorPause} in a reactor code`);
    }
  }
}

/**
 * The single entry point for pasted codes. Java's `setCode` shows a dialog and leaves the
 * design untouched on failure; this returns a result the caller can render, and never
 * partially applies a code.
 *
 * The Talonius branch of the original dispatch is gone: the decoder was dropped, so a
 * lowercase-only string now falls through to the base64 branch and is refused there. That branch
 * is also where the five obsolete-component warnings lived (`Warning.DepletedIsotope`,
 * `Warning.Heating`, `Warning.Plutonium`, `Warning.DualPlutonium`, `Warning.QuadPlutonium` and
 * `Warning.Unrecognized`, all of them appended inside `Reactor.handleTaloniusCode` at
 * `Reactor.java:524-626`), so in this build the only reachable warning is the one this function
 * reports: `Warning.Title` around `Warning.InvalidReactorCode`.
 *
 * The failure carries the pieces the desktop composes rather than only a sentence: `code` is the
 * string that was offered (the bundle's line has one `%s` for it) and `detail` is the reader's own
 * reason, which `Reactor.java:297-300` appends after a newline when it has one.
 *
 * @param code
 * @param options {{ base, defaults }}
 * @returns {{ ok: boolean, design?: Object, title?: String, message?: String, code?: String,
 *   detail?: String }}
 */
export function decodeCode(code, options) {
  const base = options?.base;
  const defaults = options?.defaults ?? [];
  const design = base === undefined ? defaultDesign() : cloneDesign(base);
  if (code === null || code === undefined || code === '') {
    return { ok: true, design };
  }
  let failure;
  try {
    if (code.startsWith(CODE_PREFIX)) {
      readCodeFields(code.slice(CODE_PREFIX.length), design, defaults);
    } else if (code.length >= 108 && /^[0-9A-Za-z(),|]+$/.test(code)) {
      readLegacyCode(code, design, defaults);
    } else if (/^[0-9A-Za-z+/=]+$/.test(code)) {
      readCodeFields(code, design, defaults);
    } else {
      failure = { ok: false, title: 'Invalid reactor code', message: `Cannot read reactor code: ${code}`, code, detail: null };
    }
  } catch (error) {
    failure = { ok: false, title: 'Invalid reactor code', message: `Cannot read reactor code: ${code}`, code, detail: error.message };
  }
  if (failure !== undefined) return failure;
  return { ok: true, design };
}

/** Deep copy of a design, so a failed read cannot leave a half-applied one behind. */
function cloneDesign(design) {
  return {
    ...design,
    cells: design.cells.map((cell) => cell === null ? null : { ...cell }),
  };
}
