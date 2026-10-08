/**
 * The comparison of two runs: the desktop's `Comparison` tab.
 *
 * A line-for-line port of `ReactorPlannerFrame.updateComparison` (lines 2774-3290). The desktop
 * builds one HTML string and hands the whole thing to a JLabel, so this returns the same string,
 * tag for tag: every sentence is the bundle's `Comparison.*` template, and the only two tags it
 * ever emits (`<br>` between lines and `<font color="…">` around a coloured run) are what
 * `web/ui/comparison.js` turns into elements. Nothing here invents a word.
 *
 * Left is the run that just finished, right is the one before it -- the desktop's
 * `simulator`/`prevSimulator` pair, and the same reason its `simulateButtonActionPerformed`
 * (`:2085-2091`) moves the current run into `prevSimulator` before starting the next one.
 *
 * The three output sections that appear three times in Java -- prebreak, predeplete and postsim --
 * come through one `appendOutput` helper. The copies differ only by a field-name prefix (`prebreak`,
 * `predeplete`, and the empty string for the postsim fields) and by whether they print the two
 * temperature lines at all, and every `SimulationData` field follows that prefix rule --
 * `prebreakMinEUoutput`, `predepleteMinEUoutput`, `minEUoutput`. One copy of the fluid four-way
 * branch stays honest where Java's copy-paste has three; the Java duplication is what the
 * `moxStyleReactor` threshold flip and the red/green max-temp swap make each copy fragile.
 *
 * @see src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java:2774-3290, web/engine/simulation-data.js
 */

import { getI18n, formatI18n } from './i18n.js';
import { stringFormat, formatDecimal } from './format.js';
import { INT_MAX } from '../data/limits.js';
import { GRID_ROWS, GRID_COLS } from '../data/bounds.js';
import { MaterialsList } from './materials-list.js';

/** The rods that flip the temperature thresholds' sign (`:2791-2805` and the `moxStyleReactor ? 10 : -10`
 * at both temperature lines). These are `baseName`s, so they survive a localized bundle. */
const MOX_STYLE_RODS = new Set([
  'fuelRodMox', 'dualFuelRodMox', 'quadFuelRodMox',
  'fuelRodNaquadah', 'dualFuelRodNaquadah', 'quadFuelRodNaquadah',
]);

/** The six threshold times, in the order the desktop appends them. The bundle's prefix keys are
 * named after the fields, so one list carries both. */
const THRESHOLD_TIMES = ['timeToBelow50', 'timeToBurn', 'timeToEvaporate', 'timeToHurt', 'timeToLava', 'timeToXplode'];

/**
 * The comparison the desktop's comparison label gets.
 *
 * @param left the finished run as `{ data, reactor }` (`SimulationData` plus the reactor its design
 *   sits in); `null` before the first run
 * @param right the run before it, same shape; `null` until there are two
 * @param options `{ onlyShowDiff }` -- the desktop's `onlyShowDiffCheck`, off by default, which is
 *   what leaves every line in
 * @returns {Object} `{ ok: true, html }` for the whole label including its `<html>` wrapper, or
 *   `{ ok: false, message }` carrying the bundle's `Comparison.Default` for a page that has not
 *   run twice.
 */
export function compareRuns(left, right, options = {}) {
  if (left === null || right === null || left.data === null || right.data === null
    || left.reactor === null || right.reactor === null) {
    return { ok: false, message: getI18n('Comparison.Default') };
  }

  const alwaysDiff = !options.onlyShowDiff;
  const leftData = left.data.values();
  const rightData = right.data.values();
  const leftReactor = left.reactor;
  const rightReactor = right.reactor;
  const moxStyle = hasMoxStyleRod(leftReactor);

  const text = [];
  const prebreak = [];
  const predeplete = [];
  const postsim = [];

  for (const field of THRESHOLD_TIMES) {
    const leftTime = leftData[field];
    const rightTime = rightData[field];
    if ((leftTime !== INT_MAX || rightTime !== INT_MAX)
      && (alwaysDiff || leftTime !== rightTime)) {
      text.push(getI18n(`Comparison.Prefix.${field[0].toUpperCase()}${field.slice(1)}`));
      text.push(buildColoredIntComparison('Time', leftTime, rightTime, INT_MAX, 1));
    }
  }

  const leftBreak = leftData.firstComponentBrokenTime;
  const rightBreak = rightData.firstComponentBrokenTime;
  if (leftBreak !== INT_MAX || rightBreak !== INT_MAX) {
    // Java appends this line with no prefix of its own -- the `Prefix.Prebreak` it would want is
    // only ever written further down, ahead of the output block. Kept as the desktop spells it.
    if (alwaysDiff || Math.abs(leftBreak - rightBreak) > 10) {
      text.push(buildIntComparison('Time', leftBreak, rightBreak, INT_MAX));
    }
    if (leftBreak !== INT_MAX && rightBreak !== INT_MAX) {
      appendOutput(prebreak, 'prebreak', null, leftData, rightData, leftReactor, rightReactor, alwaysDiff, moxStyle);
    }
    if (prebreak.length > 0) {
      text.push(getI18n('Comparison.Prefix.PrebreakTime'));
      text.push(...prebreak);
      text.push('<br>');
    }
  }

  const leftDeplete = leftData.firstRodDepletedTime;
  const rightDeplete = rightData.firstRodDepletedTime;
  if (leftDeplete !== INT_MAX || rightDeplete !== INT_MAX) {
    if (alwaysDiff || Math.abs(leftDeplete - rightDeplete) > 10) {
      text.push(getI18n('Comparison.Prefix.PredepleteTime'));
      text.push(buildIntComparison('Time', leftDeplete, rightDeplete, INT_MAX));
    }
    if (leftData.totalRodCount > 0 && rightData.totalRodCount > 0) {
      appendOutput(predeplete, 'predeplete', 'Predeplete', leftData, rightData, leftReactor, rightReactor, alwaysDiff, moxStyle);
    }
    if (predeplete.length > 0) {
      text.push(getI18n('Comparison.Prefix.Predeplete'));
      text.push(...predeplete);
      text.push('<br>');
    }
  }

  if (alwaysDiff || Math.abs(leftData.totalReactorTicks - rightData.totalReactorTicks) > 10) {
    text.push(getI18n('Comparison.Prefix.PostSimulationTime'));
    text.push(buildIntComparison('Time', leftData.totalReactorTicks, rightData.totalReactorTicks, INT_MAX));
  }
  appendOutput(postsim, '', 'Postsim', leftData, rightData, leftReactor, rightReactor, alwaysDiff, moxStyle);
  if (postsim.length > 0) {
    text.push(getI18n('Comparison.Prefix.PostSimulation'));
    text.push(...postsim);
    text.push('<br>');
  }

  if ((leftData.hullHeating !== 0 || rightData.hullHeating !== 0)
    && (alwaysDiff || Math.abs(leftData.hullHeating - rightData.hullHeating) > 1)) {
    text.push(formatI18n('Comparison.HullHeating',
      colorDecimal(leftData.hullHeating - rightData.hullHeating, -1),
      simpleDecimal(leftData.hullHeating), simpleDecimal(rightData.hullHeating)));
  }
  if ((leftData.componentHeating !== 0 || rightData.componentHeating !== 0)
    && (alwaysDiff || Math.abs(leftData.componentHeating - rightData.componentHeating) > 1)) {
    text.push(formatI18n('Comparison.ComponentHeating',
      colorDecimal(leftData.componentHeating - rightData.componentHeating, -1),
      simpleDecimal(leftData.componentHeating), simpleDecimal(rightData.componentHeating)));
  }
  if (leftData.hullCooling !== 0 || rightData.hullCooling !== 0) {
    if (alwaysDiff || Math.abs(leftData.hullCooling - rightData.hullCooling) > 1) {
      text.push(formatI18n('Comparison.HullCooling',
        colorDecimal(leftData.hullCooling - rightData.hullCooling, 1),
        simpleDecimal(leftData.hullCooling), simpleDecimal(rightData.hullCooling)));
    }
    if (alwaysDiff || Math.abs(leftData.hullCoolingCapacity - rightData.hullCoolingCapacity) > 1) {
      text.push(formatI18n('Comparison.HullCoolingPossible',
        colorDecimal(leftData.hullCoolingCapacity - rightData.hullCoolingCapacity, 1),
        simpleDecimal(leftData.hullCoolingCapacity), simpleDecimal(rightData.hullCoolingCapacity)));
    }
  }
  if (leftData.ventCooling !== 0 || rightData.ventCooling !== 0) {
    if (alwaysDiff || Math.abs(leftData.ventCooling - rightData.ventCooling) > 1) {
      text.push(formatI18n('Comparison.VentCooling',
        colorDecimal(leftData.ventCooling - rightData.ventCooling, 1),
        simpleDecimal(leftData.ventCooling), simpleDecimal(rightData.ventCooling)));
    }
    if (alwaysDiff || Math.abs(leftData.ventCoolingCapacity - rightData.ventCoolingCapacity) > 1) {
      text.push(formatI18n('Comparison.VentCoolingPossible',
        colorDecimal(leftData.ventCoolingCapacity - rightData.ventCoolingCapacity, 1),
        simpleDecimal(leftData.ventCoolingCapacity), simpleDecimal(rightData.ventCoolingCapacity)));
    }
  }
  text.push('<br>');

  const materialDiff = leftReactor.getMaterials().buildComparisonString(rightReactor.getMaterials(), alwaysDiff);
  if (materialDiff !== '') {
    text.push(getI18n('Comparison.MaterialsHeading'));
    text.push(materialDiff);
    text.push('<br>');
  }

  const componentDiff = leftReactor.getComponentList().buildComparisonString(rightReactor.getComponentList(), alwaysDiff);
  if (componentDiff !== '') {
    text.push(getI18n('Comparison.ComponentsHeading'));
    text.push(componentDiff);
    text.push('<br>');
  }

  const leftReplaced = leftData.replacedItems ?? new MaterialsList();
  const rightReplaced = rightData.replacedItems ?? new MaterialsList();
  const replacedDiff = leftReplaced.buildComparisonString(rightReplaced, alwaysDiff);
  if (replacedDiff !== '') {
    text.push(getI18n('Comparison.ComponentsReplacedHeading'));
    text.push(replacedDiff);
  }

  // Java's emptiness test strips the wrapper and every `<br>` it has written, so a comparison that
  // found nothing to say still gets the bundle's sentence rather than a blank label.
  const body = text.join('');
  if (body.split('<br>').join('') === '') text.push(getI18n('Comparison.NoDifferences'));

  return { ok: true, html: `<html>${text.join('')}</html>` };
}

/**
 * The output lines for one section of the comparison.
 *
 * @param out the array the fragments append to
 * @param prefix the `SimulationData` field prefix: `prebreak`, `predeplete`, or `''` for postsim
 * @param tempKey the temperature lines' bundle key (`Predeplete`, `Postsim`), or `null` for the
 *   prebreak section, which has none
 * @see src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java:2849-2930, 2962-3092, 3096-3225
 */
function appendOutput(out, prefix, tempKey, leftData, rightData, leftReactor, rightReactor, alwaysDiff, moxStyle) {
  const leftFluid = leftReactor.isFluid();
  const rightFluid = rightReactor.isFluid();
  const L = (suffix) => leftData[prefix === '' ? suffix[0].toLowerCase() + suffix.slice(1) : prefix + suffix];
  const R = (suffix) => rightData[prefix === '' ? suffix[0].toLowerCase() + suffix.slice(1) : prefix + suffix];

  if (!leftFluid && !rightFluid) {
    if (L('MinEUoutput') <= L('MaxEUoutput') && R('MinEUoutput') <= R('MaxEUoutput')) {
      if (alwaysDiff
        || Math.abs(L('TotalEUoutput') - R('TotalEUoutput')) > 1000
        || Math.abs(L('AvgEUoutput') - R('AvgEUoutput')) > 0.1
        || Math.abs(L('MinEUoutput') - R('MinEUoutput')) > 0.1
        || Math.abs(L('MaxEUoutput') - R('MaxEUoutput')) > 0.1) {
        out.push(formatI18n('Comparison.EUEUoutput',
          colorDecimal(L('TotalEUoutput') - R('TotalEUoutput'), 1000),
          simpleDecimal(L('TotalEUoutput')), simpleDecimal(R('TotalEUoutput')),
          colorDecimal(L('AvgEUoutput') - R('AvgEUoutput'), 0.1),
          simpleDecimal(L('AvgEUoutput')), simpleDecimal(R('AvgEUoutput')),
          colorDecimal(L('MinEUoutput') - R('MinEUoutput'), 0.1),
          simpleDecimal(L('MinEUoutput')), simpleDecimal(R('MinEUoutput')),
          colorDecimal(L('MaxEUoutput') - R('MaxEUoutput'), 0.1),
          simpleDecimal(L('MaxEUoutput')), simpleDecimal(R('MaxEUoutput'))));
      }
    }
  } else if (!leftFluid && rightFluid) {
    if (L('MinEUoutput') <= L('MaxEUoutput') && R('MinHUoutput') <= R('MaxHUoutput')) {
      out.push(formatI18n('Comparison.EUHUoutput',
        simpleDecimal(L('TotalEUoutput')), simpleDecimal(R('TotalHUoutput')),
        simpleDecimal(L('AvgEUoutput')), simpleDecimal(R('AvgHUoutput')),
        simpleDecimal(L('MinEUoutput')), simpleDecimal(R('MinHUoutput')),
        simpleDecimal(L('MaxEUoutput')), simpleDecimal(R('MaxHUoutput'))));
    }
  } else if (leftFluid && !rightFluid) {
    if (L('MinHUoutput') <= L('MaxHUoutput') && R('MinEUoutput') <= R('MaxEUoutput')) {
      out.push(formatI18n('Comparison.HUEUoutput',
        simpleDecimal(L('TotalHUoutput')), simpleDecimal(R('TotalEUoutput')),
        simpleDecimal(L('AvgHUoutput')), simpleDecimal(R('AvgEUoutput')),
        simpleDecimal(L('MinHUoutput')), simpleDecimal(R('MinEUoutput')),
        simpleDecimal(L('MaxHUoutput')), simpleDecimal(R('MaxEUoutput'))));
    }
  } else if (L('MinHUoutput') <= L('MaxHUoutput') && R('MinHUoutput') <= R('MaxHUoutput')) {
    if (alwaysDiff
      || Math.abs(L('TotalHUoutput') - R('TotalHUoutput')) > 1000
      || Math.abs(L('AvgHUoutput') - R('AvgHUoutput')) > 0.1
      || Math.abs(L('MinHUoutput') - R('MinHUoutput')) > 0.1
      || Math.abs(L('MaxHUoutput') - R('MaxHUoutput')) > 0.1) {
      out.push(formatI18n('Comparison.HUHUoutput',
        colorDecimal(L('TotalHUoutput') - R('TotalHUoutput'), 1000),
        simpleDecimal(L('TotalHUoutput')), simpleDecimal(R('TotalHUoutput')),
        colorDecimal(L('AvgHUoutput') - R('AvgHUoutput'), 0.1),
        simpleDecimal(L('AvgHUoutput')), simpleDecimal(R('AvgHUoutput')),
        colorDecimal(L('MinHUoutput') - R('MinHUoutput'), 0.1),
        simpleDecimal(L('MinHUoutput')), simpleDecimal(R('MinHUoutput')),
        colorDecimal(L('MaxHUoutput') - R('MaxHUoutput'), 0.1),
        simpleDecimal(L('MaxHUoutput')), simpleDecimal(R('MaxHUoutput'))));
    }
  }

  if (tempKey === null) return;

  if (L('MinTemp') <= L('MaxTemp') && R('MinTemp') <= R('MaxTemp')) {
    if (alwaysDiff || Math.abs(L('MinTemp') - R('MinTemp')) > 10) {
      out.push(formatI18n(`Comparison.${tempKey}MinTemp`,
        colorDecimal(L('MinTemp') - R('MinTemp'), moxStyle ? 10 : -10),
        simpleDecimal(L('MinTemp')), simpleDecimal(R('MinTemp'))));
    }
    if (alwaysDiff || Math.abs(L('MaxTemp') - R('MaxTemp')) > 10) {
      let leftMaxTemp = simpleDecimal(L('MaxTemp'));
      let rightMaxTemp = simpleDecimal(R('MaxTemp'));
      // The desktop colours the two *values* rather than the difference when one design ran within
      // 15% of its own ceiling and the other did not: the hotter run is the bad one, per side.
      if ((L('MaxTemp') >= leftReactor.getMaxHeat() * 0.85) !== (R('MaxTemp') >= rightReactor.getMaxHeat() * 0.85)) {
        if (L('MaxTemp') >= leftReactor.getMaxHeat() * 0.85) {
          leftMaxTemp = `<font color="red">${leftMaxTemp}</font>`;
          rightMaxTemp = `<font color="green">${rightMaxTemp}</font>`;
        } else {
          leftMaxTemp = `<font color="green">${leftMaxTemp}</font>`;
          rightMaxTemp = `<font color="red">${rightMaxTemp}</font>`;
        }
      }
      out.push(formatI18n(`Comparison.${tempKey}MaxTemp`,
        colorDecimal(L('MaxTemp') - R('MaxTemp'), moxStyle ? 10 : -10),
        leftMaxTemp, rightMaxTemp));
    }
  }
}

/** The left design has a Mox or naquadah rod anywhere on the board (`:2791-2805`). */
function hasMoxStyleRod(reactor) {
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const component = reactor.getComponentAt(row, col);
      if (component !== null && MOX_STYLE_RODS.has(component.baseName)) return true;
    }
  }
  return false;
}

/**
 * `Comparison.<type>.Both`, `LeftOnly` or `RightOnly` for an integer pair.
 *
 * A side equal to `defaultValue` is a run that never reached the event -- Java's `Integer.MAX_VALUE`
 * for every one of these -- and the desktop prints `∞` for it rather than the sentinel.
 */
function buildIntComparison(type, left, right, defaultValue) {
  if (right === defaultValue) return stringFormat(getI18n(`Comparison.${type}.LeftOnly`), left);
  if (left === defaultValue) return stringFormat(getI18n(`Comparison.${type}.RightOnly`), right);
  return stringFormat(getI18n(`Comparison.${type}.Both`), left - right, left, right);
}

/**
 * The same pair with the difference coloured.
 *
 * A difference further from zero than `threshold`, in `threshold`'s own direction, is green; the
 * other direction is red; anything nearer zero than `threshold` is orange. That is why the desktop
 * passes `1` for cooling (more cooling is good) and `-1` for heating (less heating is good), and
 * `moxStyle ? 10 : -10` for temperatures.
 */
function buildColoredIntComparison(type, left, right, defaultValue, threshold) {
  if (right === defaultValue) return stringFormat(getI18n(`Comparison.${type}.LeftOnly`), left);
  if (left === defaultValue) return stringFormat(getI18n(`Comparison.${type}.RightOnly`), right);
  let color = 'orange';
  if (Math.abs(left - right) > Math.abs(threshold)) {
    color = Math.sign(left - right) === Math.sign(threshold) ? 'green' : 'red';
  }
  return stringFormat(getI18n(`Comparison.${type}.BothColored`), color, left - right, left, right);
}

/** `Comparison.SimpleDecimalFormat` (`#,##0.##`), the plain side of every line. */
function simpleDecimal(value) {
  return formatDecimal(getI18n('Comparison.SimpleDecimalFormat'), value);
}

/** `Comparison.CompareDecimalFormat` (`+#,##0.##;-#`) wrapped in the desktop's `<font color>`. */
function colorDecimal(value, threshold) {
  let color = 'orange';
  if (Math.abs(value) > Math.abs(threshold)) {
    color = Math.sign(value) === Math.sign(threshold) ? 'green' : 'red';
  }
  return stringFormat('<font color="%s">%s</font>', color, formatDecimal(getI18n('Comparison.CompareDecimalFormat'), value));
}
