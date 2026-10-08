/**
 * Stage 4's palette model: a catalog in, the list a visitor can actually place out. DOM-free on
 * purpose, like `board.js`, so the counts a phone shows are counts a test can assert against.
 *
 * The axes come from `WEB_DESIGN.md` §3: availability is a *catalog* axis (`sourceMod` splits 26
 * base components from 46 mod ones), so a toggle filters it cleanly. Behaviour is a *separate*
 * axis — `gt509behavior`, `gtnhbehavior` and the pinned `mcVersion` change the numbers, and 5.08 /
 * 5.09 / GTNH disagree with each other — so one on/off switch cannot stand in for it and nothing
 * here touches it. The palette only ever removes entries from a list the catalog already proves.
 *
 * @see web/ui/board.js#catalogDisplay, WEB_DESIGN.md §3, WEB_MIGRATION_PLAN.md §5
 */

import { catalogDisplay } from './board.js';

/**
 * What the catalog actually offers, so the page never renders a control that matches nothing: a
 * filter for a mod pack this catalog lacks would be a dead spinner.
 *
 * @param catalog a parsed catalog
 * @returns {Object} `{ mods: [[name, count]], classes: [[name, count]] }`, in catalog order;
 *   `sourceMod: null` reads as `base`.
 */
export function paletteAxes(catalog) {
  const mods = new Map();
  const classes = new Map();
  for (const entry of catalogDisplay(catalog)) {
    if (entry === undefined) continue;
    const mod = entry.sourceMod ?? 'base';
    mods.set(mod, (mods.get(mod) ?? 0) + 1);
    classes.set(entry.kind, (classes.get(entry.kind) ?? 0) + 1);
  }
  return { mods: [...mods.entries()], classes: [...classes.entries()] };
}

/**
 * The components a visitor can place, in catalog order.
 *
 * `modPackFilter` is the one prefs key this toggle owns: `'base'` hides every mod component,
 * anything else (including an unset preference) shows the whole catalog — the safe default is the
 * desktop's, which offers everything it can.
 *
 * `classes` is session-only: it is a viewing aid, not a preference, and the preferences decision
 * persists exactly three keys. An empty or absent list means "no filter" rather than "nothing".
 *
 * @param catalog a parsed catalog
 * @param options `{ modPackFilter, classes }`
 * @returns {Array} of the `catalogDisplay` entries that survive both filters
 */
export function paletteList(catalog, options) {
  const onlyBase = options.modPackFilter === 'base';
  const wanted = options.classes === null || options.classes.length === 0
    ? null
    : new Set(options.classes);

  const list = [];
  for (const entry of catalogDisplay(catalog)) {
    if (entry === undefined) continue;
    if (onlyBase && entry.sourceMod !== null) continue;
    if (wanted !== null && !wanted.has(entry.kind)) continue;
    list.push(entry);
  }
  return list;
}
