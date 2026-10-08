/**
 * Stage 5's `Automate`: one cell's two automation numbers, in and out. DOM-free like the other
 * models, so a phone's edit of a threshold is a number a test can re-read.
 *
 * The desktop's shape is a button per cell (`ReactorPlannerFrame:178-201`) that selects that cell,
 * puts its label and the cell's two current values into the automation panel, and two spinners
 * whose change handlers (`:2167`, `:2188`) write the values back through the component's setter and
 * then re-encode the code. There is no automation model here on purpose: the two numbers are
 * fields the code already carries per cell, and `AutomationSimulator` already reads them.
 *
 * The write goes through `setAutomationThreshold` / `setReactorPause` rather than onto the cell,
 * because those guards are load-bearing: a value they refuse is left alone rather than clamped, and
 * the panel then re-reads the component. A visitor who asks for a number the format cannot carry
 * sees the number that stuck, which is the only number that is true.
 *
 * `carried` is the other half of what happens to these two numbers: the code writes them only when
 * the reactor is flagged automated (`Reactor.getCode` gates the two fields on `isAutomated()`,
 * mirrored at `reactor-code.js:112-115`), so a threshold set on a reactor that is not automated
 * lives in the page but not in the code the next visitor loads. The desktop has the same shape --
 * a separate `UI.AutomatedReactor` checkbox -- and saying which half of the pair the code will
 * hold is what lets the page show the flag rather than silently lose an edit.
 *
 * @see src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java (the per-cell button and the spinners),
 * @see web/engine/components.js (the guarded setters), WEB_MIGRATION_PLAN.md section 21
 */

import { onBoard } from './board-edit.js';
import { createComponent, setAutomationThreshold, setReactorPause, setInitialHeat } from '../engine/components.js';
import { componentToString } from '../engine/automation-simulator.js';
import { getI18n, formatI18n } from '../engine/i18n.js';
import { GRID_COLS } from '../data/bounds.js';

/**
 * What the panel shows when a cell is selected: the desktop's label line and the cell's two values.
 *
 * The label is `UI.ChosenComponentRowCol` around the component's own `toString` — the same label
 * `Inspect` prints — so the two panels cannot drift apart on what a component is called. The
 * component is built from the catalog and given the cell's initial heat, which is what the
 * reactor's own component carries and what makes the label's heat suffix right.
 *
 * @returns {Object} `{ ok, label, automationThreshold, reactorPause, automated }`, or
 *      `{ ok: false, message }`
 */
export function openAutomationPanel(design, index, catalog) {
  if (!onBoard(index)) return { ok: false, message: 'no such cell' };

  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  const cell = design.cells[index];
  if (cell === null) {
    return { ok: false, message: formatI18n('UI.NoComponentRowCol', row, col) };
  }

  const component = createComponent(catalog, cell.id);
  if (component === null) return { ok: false, message: 'that component is not in this catalog' };
  setInitialHeat(component, cell.initialHeat);

  return {
    ok: true,
    label: formatI18n('UI.ChosenComponentRowCol', componentToString(component), row, col),
    automationThreshold: cell.automationThreshold,
    reactorPause: cell.reactorPause,
    automated: design.automated,
  };
}

/**
 * The reactor-wide half of automation: the desktop's `UI.AutomatedReactor` checkbox
 * (`ReactorPlannerFrame:2274`, `reactor.setAutomated(automatedReactorCheck.isSelected())`). It is
 * offered here rather than beside the board because it is what the panel's two numbers mean -- the
 * code writes a cell's threshold and pause only for a reactor flagged automated, so a visitor who
 * edited numbers on a reactor that is not automated has to be able to turn that flag on to make the
 * edit survive a reload.
 *
 * @param design a design (mutated in place)
 * @param automated the flag
 * @returns {Object} `{ ok, design }`
 */
export function setReactorAutomated(design, automated) {
  design.automated = Boolean(automated);
  return { ok: true, design };
}

/**
 * Write the panel's two numbers onto the cell. Either may be left out, which is what a visitor
 * turning one spinner and leaving the other alone does.
 *
 * @param design a design (mutated in place — the page keeps exactly one)
 * @param index a board index
 * @param threshold the replacement threshold, or `null` to leave it
 * @param pause the reactor pause, or `null` to leave it
 * @returns {Object} `{ ok, design, kept, carried }`, where `kept` is what the engine stored and
 *      `carried` says whether the code can hold it, or `{ ok: false, message }`
 */
export function applyAutomationParams(design, index, threshold, pause, catalog) {
  if (!onBoard(index)) return { ok: false, message: 'no such cell' };

  const cell = design.cells[index];
  if (cell === null) return { ok: false, message: 'that cell is empty' };

  const component = createComponent(catalog, cell.id);
  if (component === null) return { ok: false, message: 'that component is not in this catalog' };

  // The component starts as the cell is, not as the catalog's prototype is: on the desktop the
  // spinner writes into the reactor's own component, which `placeDesign` already loaded with the
  // code's three values. Seeding through the same setters rather than assigning them is what keeps
  // a value the format cannot carry from sneaking in through the back door; for a decoded design it
  // is identity, since the decoder extracts these fields with the bounds these setters accept and
  // a component that cannot be automated carries its defaults (`automate.test.js` asserts both).
  setInitialHeat(component, cell.initialHeat);
  setAutomationThreshold(component, cell.automationThreshold);
  setReactorPause(component, cell.reactorPause);

  if (threshold !== null) setAutomationThreshold(component, threshold);
  if (pause !== null) setReactorPause(component, pause);

  cell.automationThreshold = component.automationThreshold;
  cell.reactorPause = component.reactorPause;
  return {
    ok: true,
    design,
    kept: { automationThreshold: cell.automationThreshold, reactorPause: cell.reactorPause },
    carried: design.automated,
  };
}
