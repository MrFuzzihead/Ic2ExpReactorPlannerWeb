/**
 * The Component List tab: what the design holds, counted by display name.
 *
 * The desktop's is a `JTextArea` in a `JScrollPane` (`ReactorPlannerFrame:634-638`) sitting in the
 * same `outputTabs` as the Simulation and Comparison tabs (`:1631`), rewritten after every action
 * with `reactor.getComponentList().toString()` — the same four sites that rewrite the max-heat
 * label (`:280`, `:322`, `:2068`, `:2690`), which is the design's reactor rather than the last run's
 * grid. Same discipline as `web/ui/materials.js`: the engine's whole string is the panel, so the
 * page renders it rather than re-deriving a count.
 *
 * `Reactor.getComponentList` (`Reactor.java:203`) walks the grid column-major and adds each
 * component's `name` to a `MaterialsList`, so the list is that class's `count name` lines in
 * sorted order — the same `toString` the shopping list uses, and the reason the two panels look
 * alike. The names are the localized display names, not the `ComponentName.*` keys: the desktop
 * reads `component.name`, which is what the bundle resolves.
 *
 * @see src/Ic2ExpReactorPlanner/Reactor.java:203, src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java
 * @see web/engine/reactor.js (`getComponentList`), WEB_MIGRATION_PLAN.md §33
 */

import { designReactor } from '../ui/comparison.js';

/**
 * The design a code holds, and the list of what is in it.
 *
 * @param code a reactor code
 * @param catalog a parsed catalog
 * @returns {Object} `{ ok: true, text, lines }`, where `text` is the engine's whole
 *   `toString()` (trailing newline included, exactly as Java writes it) and `lines` is that
 *   string without the trailing newline split into rows; or `{ ok: false, message }` for a code
 *   the decoder rejects.
 */
export function componentList(code, catalog) {
  const read = designReactor(code, catalog);
  if (!read.ok) return read;
  const text = read.reactor.getComponentList().toString();
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return { ok: true, text, lines: body === '' ? [] : body.split('\n') };
}
