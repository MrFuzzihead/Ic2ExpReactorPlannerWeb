/**
 * The reactor-level configuration: the four switches, the two spinners, and the pulse panel.
 * DOM-free like every other `ui/` model, so a phone's change of a pulse duration is a design a
 * test can re-read.
 *
 * The desktop keeps all of this as widgets in the left column of the Swing frame — a radio pair
 * (`euReactorRadio`, `fluidReactorRadio` at `:1347`, `:1357`), three checkboxes
 * (`pulsedReactorCheck` `:1430`, `automatedReactorCheck` `:1444`,
 * `reactorCoolantInjectorCheckbox` `:1476`), two spinners (`heatSpinner` `:1410`,
 * `maxSimulationTicksSpinner` `:1460`), and a `pulsePanel` of four more spinners plus a reset
 * button (`:675-786`). Every handler does the same two things: write one field on the `Reactor`,
 * then `updateCodeField()` — which is why each function here takes a design and returns one, and
 * the page puts the result back through the code like every other edit.
 *
 * There is no configuration *model* here on purpose: all nine fields are already in the code
 * format (`reactor-code.js#defaultDesign` carries `currentHeat`, `onPulse`, `offPulse`,
 * `suspendTemp`, `resumeTemp`, `fluid`, `injectors`, `pulsed`, `automated`,
 * `maxSimulationTicks`), and the simulator already reads them. What is missing on the page was
 * the controls, not the state.
 *
 * The bounds are the Swing spinner models' own, not the code's: `heatSpinner` is
 * `SpinnerNumberModel(0.0, 0.0, 9999.0, 1.0)` while the code's heat field is 120,000 wide, and
 * `pulseDurationModel` / `temperatureModel` / `tickLimitModel` (`:1978-1990`) each take a bound
 * from `Reactor.java`. A value outside a spinner's range is refused by the page rather than
 * clamped, which is what the chamber gate does too — a spinner that quietly moved the number is
 * a spinner whose reading lies.
 *
 * @see src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java (the widgets and their handlers),
 * @see src/Ic2ExpReactorPlanner/Reactor.java (`resetPulseConfig` at `:970`),
 * @see web/data/bounds.js, WEB_MIGRATION_PLAN.md §32
 */

import { designReactor } from '../ui/comparison.js';
import { formatI18n } from '../engine/i18n.js';
import {
  DEFAULT_ON_PULSE,
  DEFAULT_OFF_PULSE,
  DEFAULT_SUSPEND_TEMP,
  DEFAULT_RESUME_TEMP,
  MAX_PULSE_DURATION,
  CODE_TEMP_BOUND,
  MAX_SIMULATION_TICKS,
} from '../data/bounds.js';

/** The desktop's `heatSpinner` model (`ReactorPlannerFrame:1410`), as a range the page can check. */
export const INITIAL_HEAT_RANGE = [0, 9999];
/** The desktop's `pulseDurationModel(0)` and `temperatureModel(0)` (`:1978`, `:1983`). */
export const PULSE_DURATION_RANGE = [0, MAX_PULSE_DURATION];
export const PULSE_TEMP_RANGE = [0, CODE_TEMP_BOUND];
/** The desktop's `tickLimitModel` (`:1988`). */
export const TICK_LIMIT_RANGE = [0, MAX_SIMULATION_TICKS];

/** The four pulse figures, in the order the Swing panel lays them out (`:675-760`). */
export const PULSE_FIELDS = [
  ['onPulse', 'Config.OnPulse', 'Config.Seconds', PULSE_DURATION_RANGE, DEFAULT_ON_PULSE],
  ['offPulse', 'Config.OffPulse', 'Config.Seconds', PULSE_DURATION_RANGE, DEFAULT_OFF_PULSE],
  ['suspendTemp', 'Config.SuspendTemp', null, PULSE_TEMP_RANGE, DEFAULT_SUSPEND_TEMP],
  ['resumeTemp', 'Config.ResumeTemp', null, PULSE_TEMP_RANGE, DEFAULT_RESUME_TEMP],
];

/** The two reactor-style radios: a pair with one value, not two checkboxes (`:1347`, `:1357`). */
export const REACTOR_STYLES = [
  ['eu', 'Config.EUReactor', false],
  ['fluid', 'Config.FluidReactor', true],
];

/** The three checkboxes, in the Swing frame's order (`:1430`, `:1444`, `:1476`). */
export const REACTOR_FLAGS = [
  ['pulsed', 'UI.PulsedReactor'],
  ['automated', 'UI.AutomatedReactor'],
  ['injectors', 'Config.ReactorCoolantInjectors'],
];

/**
 * One of the four switches. Each handler in the desktop is one line of `setX(check.isSelected())`
 * plus `updateCodeField()` (`euReactorRadioActionPerformed` `:2126`,
 * `fluidReactorRadioActionPerformed` `:2142`, `pulsedReactorCheckActionPerformed` `:2256`,
 * `automatedReactorCheckActionPerformed` `:2274`,
 * `reactorCoolantInjectorCheckboxActionPerformed` `:2226`), so there is nothing here to refuse:
 * a flag is a flag.
 *
 * @param design a design (mutated in place — the page keeps exactly one)
 * @param field one of `fluid`, `pulsed`, `automated`, `injectors`
 * @param value the flag
 * @returns {Object} `{ ok: true, design }`
 */
export function setReactorFlag(design, field, value) {
  if (field !== 'fluid' && field !== 'pulsed' && field !== 'automated' && field !== 'injectors') {
    return { ok: false, message: `no reactor switch named ${field}` };
  }
  design[field] = Boolean(value);
  return { ok: true, design };
}

/**
 * One of the six spinners. `null` leaves a figure alone, which is what a visitor turning one
 * spinner and ignoring the other five does — the desktop's change handlers are per-spinner
 * (`heatSpinnerStateChanged` `:2211`, `maxSimulationTicksSpinnerStateChanged` `:2291`,
 * `onPulseSpinnerStateChanged` `:2189`, and the three after it) and each writes only its own
 * field.
 *
 * A figure outside its spinner's range is refused rather than stored: the code's writer would
 * accept some of those and reject others, and a spinner that shows one number while the design
 * holds another is a lie either way.
 *
 * @param design a design (mutated in place)
 * @param changes `{ onPulse, offPulse, suspendTemp, resumeTemp, currentHeat, maxSimulationTicks }`,
 *   each `null` or a number
 * @returns {Object} `{ ok: true, design }`, or `{ ok: false, message }`
 */
export function setReactorNumbers(design, changes) {
  const ranges = {
    currentHeat: INITIAL_HEAT_RANGE,
    maxSimulationTicks: TICK_LIMIT_RANGE,
    onPulse: PULSE_DURATION_RANGE,
    offPulse: PULSE_DURATION_RANGE,
    suspendTemp: PULSE_TEMP_RANGE,
    resumeTemp: PULSE_TEMP_RANGE,
  };
  // Checked before anything is written: a refusal that left three of six spinners moved is a panel
  // showing a mix of two visitors' intentions.
  for (const [field, value] of Object.entries(changes)) {
    if (value === null || value === undefined) continue;
    const range = ranges[field];
    if (range === undefined) return { ok: false, message: `no reactor spinner named ${field}` };
    if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
      return { ok: false, message: `${field} has to be a whole number from ${range[0]} to ${range[1]}` };
    }
  }
  for (const [field, value] of Object.entries(changes)) {
    if (value === null || value === undefined) continue;
    design[field] = value;
  }
  return { ok: true, design };
}

/**
 * The desktop's `UI.ResetPulseConfig` button (`:776`, handler at `:2347`): `Reactor.resetPulseConfig`
 * (`Reactor.java:970`) puts the four pulse figures back at the four defaults and nothing else.
 * The grid, the flags and the tick limit survive, which is what the button's name promises.
 *
 * @param design a design (mutated in place)
 * @returns {Object} `{ ok: true, design }`
 */
export function resetPulseConfig(design) {
  design.onPulse = DEFAULT_ON_PULSE;
  design.offPulse = DEFAULT_OFF_PULSE;
  design.suspendTemp = DEFAULT_SUSPEND_TEMP;
  design.resumeTemp = DEFAULT_RESUME_TEMP;
  return { ok: true, design };
}

/**
 * Are the four pulse figures at the defaults? The desktop's reset button gives no feedback at all,
 * and a page that says nothing cannot tell a visitor whether there was anything to reset — which
 * is also what decides whether the pulse panel is worth showing.
 *
 * @param design a design
 * @returns {Boolean}
 */
export function pulseAtDefaults(design) {
  return design.onPulse === DEFAULT_ON_PULSE
      && design.offPulse === DEFAULT_OFF_PULSE
      && design.suspendTemp === DEFAULT_SUSPEND_TEMP
      && design.resumeTemp === DEFAULT_RESUME_TEMP;
}

/**
 * The desktop's `maxHeatLabel`: `UI.MaxHeatDefault` at construction (`:1420`) and
 * `UI.MaxHeatSpecific` around the reactor's max heat after every edit (`:281`, `:323`, `:2069`,
 * `:2691`). A page always has a design when it paints the label, so it always gets the specific
 * line — the same reasoning `web/ui/heat.js` gives for the label that sits beside this one.
 *
 * @param code a reactor code
 * @param catalog a parsed catalog
 * @returns {Object} `{ ok: true, maxHeat, text }`, or `{ ok: false, message }`
 */
export function maxHeatLabel(code, catalog) {
  const read = designReactor(code, catalog);
  if (!read.ok) return read;
  const maxHeat = read.reactor.getMaxHeat();
  return { ok: true, maxHeat, text: formatI18n('UI.MaxHeatSpecific', maxHeat) };
}
