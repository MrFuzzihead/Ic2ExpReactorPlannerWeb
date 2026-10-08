/**
 * The `Materials` panel's one piece of logic: the shopping list for a design.
 *
 * DOM-free and tiny on purpose, like every other `ui/` helper. The list itself is the engine's
 * (`Reactor.getMaterials` walks the grid and sums the recipe table), and this file only builds the
 * reactor the design sits in and asks for it. What the panel *shows* is therefore the desktop's
 * `materialsArea` text verbatim -- same `toString()`, same `#,##0.##` counts, same `TreeMap` order
 * -- which is what `web/test/materials.test.js` pins against the Java dump.
 *
 * @see web/engine/materials-list.js, web/engine/reactor.js, src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java:279
 */

import { blankReactor } from '../engine/reactor.js';

/**
 * The materials needed to build a design, as the desktop's materials area spells them.
 *
 * @param design the design on the board
 * @param catalog the parsed component catalog
 * @returns {String} one `count name` line per material, empty for an empty board
 */
export function shoppingList(design, catalog) {
  const reactor = blankReactor(catalog);
  reactor.placeDesign(design);
  return reactor.getMaterials().toString();
}
