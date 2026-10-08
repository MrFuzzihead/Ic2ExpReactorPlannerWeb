/**
 * The temperature-effects readout: the desktop's `temperatureEffectsLabel`.
 *
 * The Swing frame keeps one JLabel next to the max-heat label and rewrites it after every edit
 * (`ReactorPlannerFrame:285-291`, `:327-333`, `:2073-2079`, `:2695-2701`), always from the same
 * expression: the reactor's max heat times 0.4, 0.5, 0.7, 0.85 and 1.0, each cast to an `int`,
 * dropped into `UI.TemperatureEffectsSpecific`'s five `%,d` slots. The construction site at
 * `:823` is the only one that uses `UI.TemperatureEffectsDefault`, and it is the label's state
 * before any design has been read — a page always has a design, so it always gets the specific
 * line.
 *
 * The five factors are the simulator's own: `automation-simulator.js:224-227` decides
 * `reachedBurn`, `reachedEvaporate`, `reachedHurt` and `reachedLava` against `0.4`, `0.5`, `0.7`
 * and `0.85` of the same max heat, and the report's "will explode at" line is the fifth. Naming
 * them once here is what keeps a visitor from reading one set of gates under the board and
 * watching a run that used another.
 *
 * The reactor is the design at rest rather than the last run's grid — the desktop's
 * `updateComparison` builds a fresh `Reactor` for the same reason, and a run mutates heat in
 * passing, which is not what a label about the design's limits should read.
 *
 * @see src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java (the label and its four update sites),
 * web/engine/automation-simulator.js (the same gates), WEB_MIGRATION_PLAN.md §31
 */

import { designReactor } from '../ui/comparison.js';
import { formatI18n } from '../engine/i18n.js';

/** The desktop's five gates, in the order the bundle's line names them. */
const GATES = [
  ['burn', 0.4],
  ['evaporate', 0.5],
  ['hurt', 0.7],
  ['lava', 0.85],
  ['explode', 1.0],
];

/**
 * The design a code holds, and what its heat limits are.
 *
 * @param code a reactor code
 * @param catalog a parsed catalog
 * @returns {Object} `{ ok: true, maxHeat, gates, text }`, or `{ ok: false, message }` for a code
 *   the decoder rejects. `gates` is the five thresholds in the bundle's order, each Java's `(int)`
 *   cast of max heat times the factor; `text` is the whole line the Swing label gets.
 */
export function temperatureEffects(code, catalog) {
  const read = designReactor(code, catalog);
  if (!read.ok) return read;
  const maxHeat = read.reactor.getMaxHeat();
  const gates = GATES.map(([, factor]) => Math.trunc(maxHeat * factor));
  return {
    ok: true,
    maxHeat,
    gates,
    text: formatI18n('UI.TemperatureEffectsSpecific', ...gates),
  };
}
