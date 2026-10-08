/**
 * Stage 4's page glue: read a reactor code, draw the board.
 *
 * Deliberately small. Everything that decides *what* is on the board lives in `board.js`, which is
 * DOM-free and covered by `web/test/board.test.js`; everything that decides *how big a cell is*
 * lives in the stylesheet. This file only moves values from the decoded design into elements, and
 * owns the code in the textarea plus the design that code encodes.
 *
 * Editing is a round trip, not a second model: a tap changes `editing`, `board-edit.js` writes the
 * new design back as a code, and that code goes into the textarea and is re-read. The textarea is
 * therefore always the design the page shows, which is what the preferences decision stores.
 *
 * The catalog and the i18n bundle are fetched rather than inlined: they are the same JSON the
 * engine tests read, so the page and the tests cannot drift apart.
 *
 * @see web/ui/board.js, web/ui/palette.js, WEB_MIGRATION_PLAN.md section 6
 */

import { parseCatalog, setMcVersion, setGT509Behavior, setGTNHBehavior, createComponent } from '../engine/components.js';
import { loadBundle, loadLocaleBundle, getI18n, getLabel, formatI18n } from '../engine/i18n.js';
import { describeBoard, CORE_COLS, impliedChambers } from '../ui/board.js';
import { componentList } from '../ui/component-list.js';
import { paletteAxes, paletteList } from '../ui/palette.js';
import { clearCell, clearDesign, placeComponent, pickUp, writeCode, writeLegacyCode, copyDesign } from '../ui/board-edit.js';
import { simulate, inspectCell } from '../ui/inspect.js';
import { shoppingList } from '../ui/materials.js';
import { compareRuns } from '../engine/comparison.js';
import { designReactor, comparisonLines } from './comparison.js';
import { temperatureEffects } from '../ui/heat.js';
import { runMarks, runLegend, MELT_COLOUR, RESIDUAL_COLOUR } from './run-grid.js';
import {
  setReactorFlag, setReactorNumbers, resetPulseConfig, maxHeatLabel,
  PULSE_FIELDS, REACTOR_STYLES, REACTOR_FLAGS, INITIAL_HEAT_RANGE, TICK_LIMIT_RANGE,
} from './config.js';
import { openAutomationPanel, applyAutomationParams, setReactorAutomated } from './automate.js';
import { setGTVersion, setExpandAdvancedAlloy, switches } from '../engine/materials-list.js';
import { GRID_COLS, MAX_AUTOMATION_THRESHOLD, MAX_REACTOR_PAUSE } from '../data/bounds.js';

/** The keys the preferences decision keeps; anything else in storage is ignored. §30 added
 * `chambers`, §32 added `showOldStyleReactorCode` — the desktop persists the same setting under
 * the same name in `ADVANCED_CONFIG` (`ReactorPlannerFrame:416`, `:455`). */
const PREF_KEYS = ['lastCode', 'gtVersion', 'modPackFilter', 'chambers', 'showOldStyleReactorCode'];

/** The page's elements once `main` has found them, and the two pieces of state a tap needs.
 *
 * `editing` is the design the textarea currently encodes, kept in step by re-encoding after every
 * tap; `placing` is the component a Place tap would use, which is the palette entry the visitor
 * last selected, or the settings `Pick` copied out of a cell. Neither can live in the DOM: the
 * first is a design, and the second carries three numbers no element holds. */
let page = null;
let editing = null;
let placing = null;
/** The chamber gate, which no element holds: the code format has no field for it, so the count
 * lives here and the crossed columns follow it. */
let chambers = null;

/** The bounds the board was last sized for, so a window resize can re-run the cell math without
 * re-decoding the design. */
let boardBounds = null;

/**
 * The run an `Inspect` readout reads, and the code it was made from. The desktop keeps the same
 * thing as `simulatedReactor`, and for the same reason: the readout is a finished run's property,
 * so a page that has not run one says `UI.NoSimulationRun` rather than inventing figures. Re-running
 * is keyed to the code rather than to the mode, so typing a new code into the textarea invalidates
 * the popover data instead of leaving it stale.
 */
let inspected = null;
let inspectedCode = null;
// The last run's grid colours, keyed by flat cell index: the desktop keeps them on the design grid's
// buttons until the next run paints every cell silver again, so an edit that redraws the board does
// not clear them.
let lastPaint = new Map();

/**
 * The cell the automation panel is showing, and the panel's five elements once they are built.
 *
 * Neither can live in the DOM where the numbers are: the inputs hold the two figures, but which
 * cell they belong to is a fact no element carries, and the desktop keeps the same pair as its
 * `selectedRow`/`selectedColumn` plus the panel's own widgets.
 */
let automating = null;
let automationParts = null;

/**
 * The `Materials` panel's three parts once it is built: the GregTech row, the alloy toggle, and the
 * list element.
 *
 * The two recipe switches have no page-side copy: `materials-list.js#switches` is the same module
 * state the desktop's combo and checkbox write to, so the panel reads the truth rather than a
 * mirror that can disagree with the list it sits next to.
 */
let materialsParts = null;

/**
 * The two finished runs a comparison needs: the last one and the one before it, each as the code it
 * ran and the `SimulationData` it produced.
 *
 * The desktop keeps the same pair as `simulator`/`prevSimulator`, and `simulateButtonActionPerformed`
 * (`:2085-2091`) is what moves the current run into `prevSimulator` before starting the next one --
 * which is why the shift here happens on a run rather than on a `Compare` tap. The reactor is not
 * stored: the desktop rebuilds both sides from their codes (`tempReactor.setCode(currentReactorCode)`)
 * rather than reading the simulated grid, and this page does the same so a run's mutated heat state
 * never reaches the comparison.
 */
let lastRun = null;
let prevRun = null;
let comparisonParts = null;
/** The Simulation panel's two pieces, so a design change can repaint the report the page is holding
 * without re-running. */
let simulationParts = null;

/**
 * The `Config` and `Components` panels' parts, and the code format the field shows.
 *
 * `legacyCode` is the desktop's `showOldStyleReactorCodeCheck` (`:1741`, handler at `:2329`), and
 * it is page state rather than DOM state for the same reason the other choices are: it decides how
 * the *next* edit writes the field, before any element exists to read it from.
 */
let configParts = null;
let componentsParts = null;
let legacyCode = false;

/**
 * The bundle the page loads, in the desktop's terms.
 *
 * `BundleHelper.java:11` calls `ResourceBundle.getBundle("Ic2ExpReactorPlanner/Bundle")`, which
 * picks the properties file from the system locale and falls back to the default file for a locale
 * it has no file for. The page's equivalent is the browser's locale, and its fallback is English.
 * `?lang=` overrides that choice: a web page's audience is not the machine it runs on, so a visitor
 * on an English system who reads Chinese has no OS setting to change. The parameter is a locale
 * code rather than a word because neither bundle holds the name of a language -- every visible
 * word on the page comes from a bundle, and 'Chinese' is not one of the 422.
 *
 * Only the bundle the choice selects is fetched, which is `WEB_DESIGN.md` §5.5's payload rule:
 * 422 strings always, 419 more only for a visitor who asked for them. A locale file that is not
 * there leaves the page English rather than broken, which is the same fallback the desktop makes
 * for a locale it has no file for.
 */
function requestedLocale() {
  const query = /[?&]lang=([A-Za-z-]+)/.exec(globalThis.location?.search ?? '');
  const wanted = query?.[1] ?? globalThis.navigator?.language ?? '';
  return LOCALE_BUNDLES[wanted.split(/[-_]/)[0].toLowerCase()] ?? null;
}

/** The locale bundles the repo ships, keyed by the language part of a locale code. */
const LOCALE_BUNDLES = { zh: 'zh-CN' };

async function loadEngineData() {
  const [catalogText, bundleText] = await Promise.all([
    fetch('../data/components.json'),
    fetch('../data/i18n/en.json'),
  ]);
  if (!catalogText.ok || !bundleText.ok) throw new Error('catalog or i18n bundle missing');
  loadBundle(await bundleText.text());
  const locale = requestedLocale();
  if (locale !== null) {
    const localeText = await fetch(`../data/i18n/${locale}.json`);
    if (localeText.ok) loadLocaleBundle(await localeText.text());
  }
  return parseCatalog(await catalogText.text());
}

/** The board's cell size: the largest multiple of 16 that fits the viewport both ways, capped at 6x
 * so a monitor does not turn a 16-pixel sprite into a wall of blurred blocks. Sprite pixels stay
 * square: every icon is 16 x 16, so the cell is an integer multiple of 16, and a 2.5x cell would
 * render some sprite pixels 2 wide and others 3, which is what makes copied game art look warped.
 *
 * Split out of `render` because a window resize changes the viewport without changing the design,
 * and nothing else re-runs the math: a board loaded in a 540 x 290 window stayed at 27 px per cell
 * when the window grew to 1798 x 952, which is what left the board floating in dead space at a
 * monitor width. */
function sizeBoard(boardElement, bounds) {
  const available = Math.min(
    window.innerWidth * 0.94 / bounds.cols,
    window.innerHeight * 0.62 / bounds.rows,
  );
  const scale = Math.max(1, Math.min(6, Math.floor(available / 16)));
  boardElement.style.setProperty('--cell', `${scale * 16}px`);
  boardElement.style.setProperty('--cols', String(bounds.cols));
}

function render(board) {
  const boardElement = document.getElementById('board');
  boardElement.replaceChildren();
  boardElement.setAttribute('aria-label', `${board.filled} components on a ${board.bounds.rows} by ${board.bounds.cols} board`);

  boardBounds = board.bounds;
  sizeBoard(boardElement, board.bounds);

  const byIndex = new Map(board.cells.map((cell) => [cell.index, cell]));
  // The frame is always the whole 6 x 9; what the game has not opened up is drawn rather than
  // hidden, so a visitor can see the room to grow. The gate is the page's own selection, not the
  // design's width -- a column at or past it refuses a placement.
  const unlocked = CORE_COLS + chambers;
  for (let row = 0; row < board.bounds.rows; row++) {
    for (let col = 0; col < board.bounds.cols; col++) {
      // The slot's position in the grid, but the index into the design's flat array: a 3 x 4
      // reactor occupies the same cells of a 6 x 9 board as it does in the code.
      const index = row * GRID_COLS + col;
      const cell = byIndex.get(index);
      const slot = document.createElement('div');
      slot.setAttribute('data-index', String(index));
      if (col >= unlocked) slot.setAttribute('data-locked', '');
      if (cell === undefined) {
        slot.setAttribute('data-empty', '');
      } else {
        const icon = document.createElement('img');
        icon.setAttribute('src', cell.icon);
        icon.setAttribute('alt', cell.name);
        icon.setAttribute('loading', 'lazy');
        slot.appendChild(icon);
        slot.setAttribute('data-kind', cell.kind);
      }
      boardElement.appendChild(slot);
    }
  }
  paintRunMarks(boardElement, lastPaint);
}

/**
 * The last run's colours on the cells the board draws. The desktop's `process` sets a button's
 * background and tooltip; this page marks the slot with the same two colours and the same words,
 * and only on a slot that shows an icon -- the desktop clears all 54 buttons to silver before the
 * loop starts, which on a Swing grid is the colour every button already has, while an empty cell and
 * a closed column on this page carry their own drawing.
 */
function paintRunMarks(boardElement, paint) {
  // A slot shows a component when it carries `data-kind`, which is what `render` sets alongside the
  // icon; the marks only go on those, and `children` is a live HTMLCollection in a browser rather
  // than an array, so the walk spreads it once before anything mutates.
  const slots = [...boardElement.children];
  const filled = [];
  for (const slot of slots) {
    if (!slot.hasAttribute('data-kind')) continue;
    filled.push(Number(slot.getAttribute('data-index')));
  }
  const marks = runMarks(paint, filled);
  const byIndex = new Map(marks.map((mark) => [mark.index, mark]));
  for (const slot of slots) {
    const mark = byIndex.get(Number(slot.getAttribute('data-index')));
    if (mark === undefined) continue;
    if (mark.kind === 'melt') slot.setAttribute('data-melt', '');
    else slot.setAttribute('data-residual', '');
    if (mark.tooltip !== null && mark.tooltip !== '') slot.setAttribute('title', mark.tooltip);
  }
  paintRunLegend(marks);
}

/**
 * The legend under the board: the two run colours, in the words the bundle gives them, only for the
 * colours that are actually on the board. The strip stays closed while nothing is marked, which is
 * what keeps a page that has never run from claiming a run happened.
 */
function paintRunLegend(marks) {
  const legend = document.getElementById('runlegend');
  legend.replaceChildren();
  const rows = runLegend(marks);
  if (rows.length === 0) {
    legend.hidden = true;
    return;
  }
  for (const row of rows) {
    const line = document.createElement('div');
    line.setAttribute('data-key', row.kind);
    const swatch = document.createElement('i');
    line.appendChild(swatch);
    const words = document.createElement('span');
    words.textContent = row.words;
    line.appendChild(words);
    legend.appendChild(line);
  }
  legend.hidden = false;
}

function renderHeader(board) {
  const header = document.getElementById('design');
  header.replaceChildren();
  const design = board.design;
  // The reactor-level switches the Swing panel exposes as checkboxes; same i18n keys, so the
  // wording stays whatever the localized bundle says rather than a translation here.
  const flags = [
    ['UI.PulsedReactor', design.pulsed],
    ['UI.AutomatedReactor', design.automated],
    ['Config.FluidReactor', design.fluid],
    ['Config.ReactorCoolantInjectors', design.injectors],
  ];
  for (const [key, value] of flags) {
    if (!value) continue;
    const chip = document.createElement('span');
    chip.setAttribute('data-flag', key);
    chip.textContent = getI18n(key);
    header.appendChild(chip);
  }
}

/** The temperature-effects line under the board: the desktop's `temperatureEffectsLabel`, rewritten
 * after every edit from one expression. The max heat comes from the design at rest rather than from
 * the last run's grid, which is what the desktop's own comparison reactor does -- a run mutates heat
 * in passing, and the label is about the design's limits. */
function renderTemperature(catalog) {
  const panel = page.temperature;
  panel.replaceChildren();
  const got = temperatureEffects(page.textarea.value, catalog);
  if (!got.ok) {
    refuse(got.message);
    return;
  }
  const line = document.createElement('div');
  line.setAttribute('data-effects', '');
  line.textContent = got.text;
  panel.appendChild(line);
}

/**
 * The palette drawer's filter chips, authored from `paletteAxes` rather than written out: a filter
 * for a mod pack or a class this catalog lacks would be a dead control. A chip is on until it
 * carries `data-off`, so a visitor who has touched nothing sees the whole catalog.
 */
function renderFilters(drawer, catalog) {
  const axes = paletteAxes(catalog);
  const filters = document.createElement('div');
  filters.setAttribute('data-filters', '');
  for (const [name] of axes.classes) {
    const chip = document.createElement('button');
    chip.setAttribute('data-axis', 'class');
    chip.setAttribute('data-name', name);
    chip.textContent = name;
    filters.appendChild(chip);
  }
  const mod = document.createElement('button');
  mod.setAttribute('data-axis', 'mod');
  mod.textContent = 'mod components';
  // The availability toggle is the one prefs key the palette owns, so it starts where the
  // remembered preference says rather than where this page guesses.
  if (readBlob().modPackFilter === 'base') mod.setAttribute('data-off', '');
  filters.appendChild(mod);
  drawer.appendChild(filters);
}

/** The components the current chips leave, one element per entry, with the count the visitor can
 * see so an empty palette is not mistaken for a closed drawer. */
function renderEntries(drawer, list) {
  const entries = document.createElement('div');
  entries.setAttribute('data-entries', '');
  entries.setAttribute('data-count', String(list.length));
  for (const entry of list) {
    const chip = document.createElement('div');
    chip.setAttribute('data-id', String(entry.id));
    chip.setAttribute('data-kind', entry.kind);
    const icon = document.createElement('img');
    icon.setAttribute('src', entry.icon);
    icon.setAttribute('alt', entry.name);
    icon.setAttribute('loading', 'lazy');
    chip.appendChild(icon);
    chip.appendChild(document.createTextNode(entry.name));
    entries.appendChild(chip);
  }
  // The filter chips and the placing line survive the swap; only the entry list is replaced. The
  // placing line goes above the entries rather than below them: the entry list is 72 tall, and a
  // line after it is a confirmation a visitor can only read by scrolling past the whole catalog.
  drawer.replaceChildren(drawer.firstElementChild, drawer.querySelector('[data-placing]'), entries);
  return list.length;
}

/** Where the visitor's choices are: the chips, read back as `paletteList`'s options. Every class
 * on means no filter; every class off means an empty palette, which is why the two are not the
 * same value. */
function readFilters(drawer) {
  const filters = drawer.firstElementChild;
  const classes = [];
  let chips = 0;
  let mod = null;
  for (const chip of filters.children) {
    if (chip.getAttribute('data-axis') === 'mod') {
      mod = chip;
      continue;
    }
    if (chip.getAttribute('data-axis') !== 'class') continue;
    chips++;
    if (!chip.hasAttribute('data-off')) classes.push(chip.getAttribute('data-name'));
  }
  return {
    modPackFilter: mod !== null && mod.hasAttribute('data-off') ? 'base' : 'all',
    classes: classes.length === chips ? null : classes,
  };
}

async function main() {
  const textarea = document.getElementById('code');
  const boardElement = document.getElementById('board');
  const errorElement = document.getElementById('error');

  let catalog;
  try {
    catalog = await loadEngineData();
  } catch (problem) {
    errorElement.textContent = problem.message;
    return;
  }

  // The version spinner is gone from the UI: the planner targets 1.7.10-era mods, so the app pins
  // it here rather than offering a choice nobody can use. The engine keeps Java's 1.12.2 default so
  // the oracle mirror and `components.test.js` stay unchanged.
  setMcVersion('1.7.10');

  // The remembered GregTech version, applied before anything reads the design: the desktop's combo
  // writes the recipe table and the two fuel-rod behaviours together (`:2431-2663`), so a page that
  // restored one without the other would show a shopping list that disagrees with the numbers below
  // it. Anything outside the combo's four items is no preference at all.
  const remembered = readBlob().gtVersion;
  if (remembered === '5.08' || remembered === '5.09' || remembered === 'GTNH') applyGtVersion(remembered);

  // The remembered code format, restored before anything writes the field: the desktop keeps this
  // setting in `ADVANCED_CONFIG` under the same name (`:416` reads it, `:455` writes it).
  legacyCode = readBlob().showOldStyleReactorCode === 'true';

  const stored = readStoredCode();
  // `defaultValue` is what the textarea was authored with -- the sample design in `index.html`. A
  // visitor who has not typed anything gets their remembered code instead; a visitor who has typed
  // keeps what they typed.
  if (stored !== null && textarea.value === textarea.defaultValue) textarea.value = stored;

  // A pasted code arrives carrying whatever the source put around it: a chat window adds newlines,
  // a terminal adds a space, a line wrap adds both. The desktop meets that at its paste button
  // (`ReactorPlannerFrame:2388`), which strips everything outside the code's own alphabet before the
  // field sees it, so the page does the same on the field it reads -- and writes the stripped text
  // back, so the field shows what was accepted rather than what was pasted.
  const pasted = pasteCode(textarea.value);
  if (pasted !== textarea.value) textarea.value = pasted;

  const board = describeBoard(textarea.value, catalog);
  if (!board.ok) {
    errorElement.textContent = warningText(board);
    return;
  }
  // The chamber selection is the page's rather than the code's: the code format has no field for it,
  // so a remembered count is restored the way the other preferences are -- and raised back to what
  // the remembered code needs, since a design that reaches column 7 cannot stand in a column the
  // game has not opened.
  let selectedChambers = Number(readBlob().chambers);
  if (!Number.isInteger(selectedChambers) || selectedChambers < 0) selectedChambers = board.minChambers;
  chambers = Math.min(GRID_COLS - CORE_COLS, Math.max(board.minChambers, selectedChambers));

  errorElement.textContent = '';
  render(board);
  renderHeader(board);

  // The drawer only exists while `Place` is the active chip, so the page a first-time visitor sees
  // is still just the board.
  // The design the textarea holds, so a tap starts from what the page already shows rather than
  // from a re-decode that could disagree with it.
  editing = copyDesign(board.design);

  const modes = document.getElementById('modes');
  const drawer = document.getElementById('palette');
  const automation = document.getElementById('automation');
  const materials = document.getElementById('materials');
  const comparison = document.getElementById('comparison');
  const temperature = document.getElementById('temperature');
  const simulation = document.getElementById('simulation');
  const config = document.getElementById('config');
  const components = document.getElementById('components');
  page = {
    textarea, boardElement, errorElement, modes, drawer, automation, materials, comparison,
    temperature, simulation, config, components, catalog,
  };
  renderTemperature(catalog);

  // The drawer only exists while `Place` is the lit chip, so a visitor who never picks a component
  // still sees just the board.
  if (activeMode(modes) === 'Place') {
    drawer.hidden = false;
    renderFilters(drawer, catalog);
    renderPlacing(drawer);
    renderEntries(drawer, paletteList(catalog, readFilters(drawer)));
    paintPlacing(drawer, catalog);
    wirePalette(drawer, catalog);
    writeModPackFilter(readFilters(drawer).modPackFilter);
  }
  if (activeMode(modes) === 'Config') openConfig(config, catalog);
  if (activeMode(modes) === 'Materials') openMaterials(materials, catalog);
  if (activeMode(modes) === 'Components') openComponents(components, catalog);
  if (activeMode(modes) === 'Compare') openComparison(comparison, catalog);
  wireModes(modes, drawer, automation, materials, comparison, simulation, config, components, catalog);
  wireBoard(boardElement, catalog);
  wireAutomation(automation, catalog);
  wireMaterials(materials, catalog);
  wireComparison(comparison, catalog);
  wireCopy(document.getElementById('copy'), textarea);
  wireClearGrid(document.getElementById('cleargrid'), catalog);
  wireSimulate(document.getElementById('simulate'), catalog);
  wireConfig(config, catalog);
  buildChambers(document.getElementById('chambers'), catalog);
  // A window resize changes the viewport without touching the design, so nothing else re-runs the
  // cell math and the board keeps the size it was loaded at. Only the custom property is rewritten:
  // no re-decode, no re-render, the slots stay where they are.
  window.addEventListener('resize', () => {
    if (boardBounds !== null) sizeBoard(boardElement, boardBounds);
  });
  if (textarea.value !== '') writeStoredCode(textarea.value);
}

/**
 * The element a tap aimed at. A tap on a board cell lands on the cell's `<img>`, and a tap on a
 * palette entry lands on its icon or its name, so the handler walks up to the nearest ancestor that
 * carries the attribute -- the same resolution the desktop's hit test makes against a component's
 * drawn rectangle. A tap that resolves to no such element is a tap on the gap between cells, and
 * does nothing.
 */
function tapped(element, attribute) {
  // `parentElement`, not `parentNode`: a browser's chain ends at the `Document` node, which is not
  // an element and carries no `hasAttribute`, so a tap that aims at nothing would walk off the top
  // of the tree. The shim's chain ends at `null`, which is why only a browser found this.
  for (let node = element; node !== null && node !== undefined; node = node.parentElement) {
    if (node.hasAttribute(attribute)) return node;
  }
  return null;
}

/**
 * The visitor's clicks. The chips are the only copy of a filter choice, so the drawer is rebuilt
 * from the DOM after every toggle; the two pieces of editing state are the exception, and only
 * because a design and three numbers have no DOM representation.
 */
function wirePalette(drawer, catalog) {
  drawer.addEventListener('click', (event) => {
    const entry = tapped(event.target, 'data-id');
    if (entry !== null) {
      selectEntry(Number(entry.getAttribute('data-id')), catalog);
      return;
    }
    const chip = tapped(event.target, 'data-axis');
    if (chip === null) return;
    if (chip.hasAttribute('data-off')) chip.removeAttribute('data-off');
    else chip.setAttribute('data-off', '');
    const options = readFilters(drawer);
    renderEntries(drawer, paletteList(catalog, options));
    writeModPackFilter(options.modPackFilter);
  });
}

/** The lit chip is the mode. Clicking a chip lights it and dims the others, and the drawer follows
 * `Place`: it exists exactly while placing is the mode, which is why `Clear` and `Pick` close it
 * rather than leaving a drawer nobody is using. The automation panel follows `Automate` the same way.
 */
function wireModes(modes, drawer, automation, materials, comparison, simulation, config, components, catalog) {
  modes.addEventListener('click', (event) => {
    const chip = event.target;
    const mode = chip.getAttribute('data-mode');
    if (mode === undefined || mode === null) return;
    for (const other of [...modes.children]) other.removeAttribute('data-active');
    chip.setAttribute('data-active', '');
    if (mode === 'Place') {
      drawer.hidden = false;
      renderEntries(drawer, paletteList(catalog, readFilters(drawer)));
    } else {
      drawer.hidden = true;
    }
    if (mode === 'Automate') openAutomation(automation, catalog);
    else automation.hidden = true;
    if (mode === 'Config') openConfig(config, catalog);
    else {
      config.hidden = true;
      configParts = null;
    }
    if (mode === 'Materials') openMaterials(materials, catalog);
    else {
      materials.hidden = true;
      materialsParts = null;
    }
    if (mode === 'Components') openComponents(components, catalog);
    else {
      components.hidden = true;
      componentsParts = null;
    }
    if (mode === 'Compare') openComparison(comparison, catalog);
    else {
      comparison.hidden = true;
      comparisonParts = null;
    }
    if (mode === 'Simulation') openSimulation(simulation, catalog);
    else simulation.hidden = true;
  });
}

/** Which chip is lit; `Place` is the default, matching the desktop's default mode. */
function activeMode(modes) {
  for (const chip of modes.children) {
    const mode = chip.getAttribute('data-mode');
    if (mode !== undefined && mode !== null && chip.hasAttribute('data-active')) return mode;
  }
  return 'Place';
}

/** The board's taps. What a tap does is the lit chip's mode; what it changes is the design, and
 * the design goes back through the code. `Inspect` is the exception: it reads the run rather than
 * the design, so it leaves the textarea alone. */
function wireBoard(boardElement, catalog) {
  boardElement.addEventListener('click', (event) => {
    const slot = tapped(event.target, 'data-index');
    if (slot === null) return;
    const index = Number(slot.getAttribute('data-index'));
    const mode = activeMode(page.modes);
    if (mode === 'Clear') applyEdit(clearCell(editing, index), index, catalog);
    else if (mode === 'Pick') pickFrom(index, catalog);
    else if (mode === 'Inspect') inspectAt(index);
    else if (mode === 'Automate') showAutomation(index, catalog);
    else placeInto(index, catalog);
  });
}

/** Write a changed design back: code, textarea, storage, board. A design that cannot be encoded is
 * reported and left alone, so a refused tap cannot half-apply. */
function applyEdit(edit, index, catalog) {
  if (!edit.ok) {
    refuse(edit.message);
    return;
  }
  // The field's format follows the desktop's `updateCodeField` (`:2130-2140`): with the old-style
  // checkbox selected the field gets `getOldCode()`, otherwise `getCode()`.
  const written = writeField(edit.design, catalog);
  if (!written.ok) {
    refuse(written.message);
    return;
  }
  page.textarea.value = written.code;
  writeStoredCode(written.code);

  const board = describeBoard(written.code, catalog);
  if (!board.ok) {
    refuse(warningText(board));
    return;
  }
  editing = copyDesign(board.design);
  // The old-style format has no slot for the tick limit, so re-reading the field would put the
  // default back where the design's own limit was. The design the page just wrote is the truth;
  // the field is a rendering of it.
  if (legacyCode) editing.maxSimulationTicks = edit.design.maxSimulationTicks;
  page.errorElement.textContent = '';
  render(board);
  renderHeader(board);
  renderTemperature(catalog);

  const touched = page.boardElement.querySelector(`[data-index="${index}"]`);
  if (touched !== null) touched.setAttribute('data-touched', '');
  if (materialsParts !== null) paintMaterials(catalog);
  if (simulationParts !== null) paintSimulation(catalog);
  if (componentsParts !== null) paintComponents(catalog);
  if (configParts !== null) paintConfig(catalog);
}

/** The code for a design, in whichever format the field is showing. */
function writeField(design, catalog) {
  return legacyCode ? writeLegacyCode(design, catalog) : writeCode(design, catalog);
}

/**
 * A code the decoder could not read, in the bundle's words. `Reactor.setCode` hands
 * `WarningDisplay.warn` exactly two things (`Reactor.java:297-301`): the title `Warning.Title` and
 * `Warning.InvalidReactorCode` around the code, with the reader's own reason on a second line when
 * it has one. The five obsolete-component warnings and `Warning.Unrecognized` are not reachable
 * here — they are appended inside `handleTaloniusCode`, whose reader this build drops.
 */
function warningText(read) {
  let body = formatI18n('Warning.InvalidReactorCode', read.code ?? '');
  if (read.detail) body = `${body}\n${read.detail}`;
  return `${getI18n('Warning.Title')}: ${body}`;
}

function placeInto(index, catalog) {
  if (placing === null) {
    refuse(getI18n('Config.NoComponentSelected'));
    return;
  }
  // The gate: a column the game has not opened takes nothing, whatever the design's width would
  // imply. The desktop has no such rule because it has no chambers; this is the page's own.
  if (index % GRID_COLS >= CORE_COLS + chambers) {
    refuse(`no Reactor Chamber opens column ${(index % GRID_COLS) + 1}`);
    return;
  }
  applyEdit(placeComponent(editing, index, placing.id, catalog, placing.params), index, catalog);
}

/** `Pick` copies a cell's component and its three settings into the palette; the board is unchanged. */
function pickFrom(index, catalog) {
  const got = pickUp(editing, index);
  if (!got.ok) {
    refuse(got.message);
    return;
  }
  placing = { id: got.id, params: got.params };
  paintPlacing(page.drawer, catalog);
}

/**
 * The `Automate` chip's panel: the desktop's automation tab, rebuilt each time the chip is lit.
 *
 * Every line of it is the bundle's, and the two bounds come from the code's own constants rather
 * than a second copy authored in the stylesheet -- which is the drift the Java side names once for
 * the same reason (`ReactorPlannerFrame.automationThresholdModel`). The label line starts at
 * `Config.NoComponentSelected`, the desktop's own opening state, so a visitor who lights the chip
 * and taps nothing is looking at a panel that says it has nothing selected.
 */
function openAutomation(panel, catalog) {
  // Re-clicking a chip rebuilds its panel, and the old children go first: appending a fresh caption,
  // header and rows onto the panel that is already open doubles every line. The drawer already does
  // this (`renderEntries`); the three panels did not.
  panel.replaceChildren();
  panel.hidden = false;
  automating = null;

  const chosen = document.createElement('div');
  chosen.setAttribute('data-chosen', '');
  chosen.textContent = getI18n('Config.NoComponentSelected');
  panel.appendChild(chosen);

  const parts = { chosen };
  for (const [field, labelKey, helpKey, bound] of [
    ['threshold', 'Config.ReplacementThreshold', 'Config.ReplacementThresholdHelp', MAX_AUTOMATION_THRESHOLD],
    ['pause', 'Config.ReactorPause', 'Config.ReactorPauseHelp', MAX_REACTOR_PAUSE],
  ]) {
    const label = document.createElement('label');
    label.setAttribute('data-field', field);
    label.textContent = getI18n(labelKey);
    panel.appendChild(label);

    const input = document.createElement('input');
    input.setAttribute('data-field', field);
    input.setAttribute('type', 'number');
    input.setAttribute('min', '0');
    input.setAttribute('max', String(bound));
    input.setAttribute('step', '1');
    panel.appendChild(input);
    parts[field] = input;
    // The desktop registers its change handler on the spinner itself (`ReactorPlannerFrame:2167`,
    // `:2188`), and this page does the same: a browser fires `change` on the input and leaves it
    // there — a probe dispatching one on a real page found the panel's own listener deaf — so a
    // listener on the panel would sit quiet while a visitor typed. One handler per spinner is what
    // the desktop has, and it is what works.
    input.addEventListener('change', () => automationEdit(catalog));

    const help = document.createElement('div');
    help.setAttribute('data-help', field);
    help.textContent = getLabel(helpKey);
    panel.appendChild(help);
  }

  const toggle = document.createElement('button');
  toggle.setAttribute('data-toggle', 'automated');
  toggle.textContent = getI18n('UI.AutomatedReactor');
  panel.appendChild(toggle);
  parts.toggle = toggle;

  automationParts = parts;
  // Only the checkbox gets painted here: the two numbers belong to a cell, and until a cell is
  // selected the desktop's spinners hold whatever they last held rather than a zero this page
  // invented.
  if (editing.automated) toggle.removeAttribute('data-off');
  else toggle.setAttribute('data-off', '');
}

/** The panel answering one cell: the desktop's per-cell `a` button, which selects the cell and puts
 * its label and its two current numbers into the panel -- or says there is nothing there, in the
 * bundle's words, and leaves the panel on whatever cell it was showing. */
function showAutomation(index, catalog) {
  const got = openAutomationPanel(editing, index, catalog);
  if (!got.ok) {
    refuse(got.message);
    return;
  }
  automating = index;
  paintAutomation(got);
}

/** What the panel shows. Painted from the values the engine has, never from the values the visitor
 * asked for, which is what makes a number the setters refused read as the number that stuck. */
function paintAutomation(values) {
  if (automationParts === null) return;
  automationParts.chosen.textContent = values.label;
  automationParts.threshold.value = String(values.automationThreshold);
  automationParts.pause.value = String(values.reactorPause);
  if (values.automated) automationParts.toggle.removeAttribute('data-off');
  else automationParts.toggle.setAttribute('data-off', '');
}

/**
 * One spinner turned. The desktop's handler (`ReactorPlannerFrame:2167`, `:2188`) reads both spinners
 * and writes them into the selected component, then re-encodes the code; typing into one of these
 * inputs is the same gesture, so both figures the panel is showing go back through the code together.
 * A half-typed number is not an edit, so it is ignored rather than reported — the visitor is still
 * typing.
 *
 * The checkbox is the desktop's `UI.AutomatedReactor`, and it goes back through the code like every
 * other edit: the flag is a field the code carries, and it is what makes the two numbers survive a
 * reload at all.
 */
function automationEdit(catalog) {
  if (automating === null || automationParts === null) return;
  const threshold = Number(automationParts.threshold.value);
  const pause = Number(automationParts.pause.value);
  if (!Number.isInteger(threshold) || !Number.isInteger(pause)) return;

  const edit = applyAutomationParams(editing, automating, threshold, pause, catalog);
  if (!edit.ok) {
    refuse(edit.message);
    return;
  }
  applyEdit(edit, automating, catalog);
  // Re-read the cell from the design the new code decodes to, so what the panel shows afterwards
  // is what the code holds — including the case where a reactor that is not automated cannot.
  showAutomation(automating, catalog);
}

/** The panel's own taps. Typed numbers are handled where they land (one listener per spinner, in
 * `openAutomation`), so all that is delegated here is the checkbox — a real click does bubble to the
 * panel, which is what the board's delegated handler relies on too. */
function wireAutomation(panel, catalog) {
  panel.addEventListener('click', (event) => {
    const toggle = tapped(event.target, 'data-toggle');
    if (toggle === null) return;
    const wanted = toggle.hasAttribute('data-off');
    applyEdit(setReactorAutomated(editing, wanted), -1, catalog);
    if (automating !== null) showAutomation(automating, catalog);
  });
}

/** The six spinners' ranges, keyed by the design field each writes. */
const SPINNER_RANGES = {};
for (const [field, , , range] of PULSE_FIELDS) SPINNER_RANGES[field] = range;
SPINNER_RANGES.currentHeat = INITIAL_HEAT_RANGE;
SPINNER_RANGES.maxSimulationTicks = TICK_LIMIT_RANGE;

/**
 * The `Config` panel: the desktop's left column of reactor-level controls, rebuilt each time the
 * chip is lit. Every word is the bundle's, and every bound is the Swing spinner model's own
 * (`config.js`'s ranges), which is why nothing here is authored in the stylesheet.
 *
 * The pulse group is built only while the design's `pulsed` flag is on — the desktop's
 * `togglePulseConfigTab` (`:2261-2272`) inserts the Swing tab under `UI.PulseConfigurationTab`
 * exactly when `pulsedReactorCheck` is selected and removes it otherwise, so a page that showed
 * the four spinners always would offer a control the run ignores.
 */
function openConfig(panel, catalog) {
  panel.replaceChildren();
  panel.hidden = false;
  // The shape marker is not the pulsed flag: `wireConfig` keys the parts by field name, and the
  // pulsed flag's field *is* `pulsed`, so a plain `pulsed` marker would be overwritten by that chip
  // and the panel would rebuild on every edit.
  const parts = { pulsedGroup: editing.pulsed };

  const styleRow = document.createElement('div');
  styleRow.setAttribute('data-style-row', '');
  for (const [name, key, fluid] of REACTOR_STYLES) {
    const chip = document.createElement('button');
    chip.setAttribute('data-style', name);
    chip.textContent = getI18n(key);
    if (editing.fluid === fluid) chip.setAttribute('data-active', '');
    styleRow.appendChild(chip);
    parts[`style-${name}`] = chip;
  }
  panel.appendChild(styleRow);

  const flagRow = document.createElement('div');
  flagRow.setAttribute('data-flag-row', '');
  for (const [field, key] of REACTOR_FLAGS) {
    const chip = document.createElement('button');
    chip.setAttribute('data-flag', field);
    chip.textContent = getI18n(key);
    // The desktop's tooltip on the automated checkbox (`:1444`); a browser shows a `title`.
    if (key === 'UI.AutomatedReactor') chip.title = getI18n('UI.AutomatedReactorTooltip');
    if (!editing[field]) chip.setAttribute('data-off', '');
    flagRow.appendChild(chip);
    parts[field] = chip;
  }
  panel.appendChild(flagRow);

  // The desktop's `showOldStyleReactorCodeCheck` (`:1741`), which sits in the same left column and
  // decides which format `updateCodeField` writes. It is the one control here that changes the
  // *field* rather than the design: the two formats describe the same reactor.
  const legacy = document.createElement('button');
  legacy.setAttribute('data-legacy', '');
  legacy.textContent = getI18n('UI.ShowOldStyleReactorCode');
  if (!legacyCode) legacy.setAttribute('data-off', '');
  panel.appendChild(legacy);
  parts.legacy = legacy;

  spinnerRow(panel, parts, catalog, 'currentHeat', 'UI.InitialReactorHeat', 'UI.InitialReactorHeatTooltip', INITIAL_HEAT_RANGE);

  const maxHeat = maxHeatLabel(page.textarea.value, catalog);
  if (!maxHeat.ok) refuse(maxHeat.message);
  const heatLine = document.createElement('div');
  heatLine.setAttribute('data-max-heat', '');
  heatLine.textContent = maxHeat.ok ? maxHeat.text : '';
  panel.appendChild(heatLine);
  parts.maxHeat = heatLine;

  spinnerRow(panel, parts, catalog, 'maxSimulationTicks', 'UI.MaxSimulationTicks', 'UI.MaxSimulationTicksTooltip', TICK_LIMIT_RANGE);

  if (editing.pulsed) {
    const group = document.createElement('div');
    group.setAttribute('data-pulse', '');
    const caption = document.createElement('div');
    caption.setAttribute('data-caption', '');
    caption.textContent = getI18n('UI.PulseConfigurationTab');
    group.appendChild(caption);
    for (const [field, labelKey, unitKey, range] of PULSE_FIELDS) {
      const row = document.createElement('div');
      row.setAttribute('data-pulse-row', '');
      spinnerRow(row, parts, catalog, field, labelKey, null, range);
      // `Config.Seconds` is the unit word the Swing panel prints after each duration (`:741`,
      // `:752`); the two temperature rows have none.
      if (unitKey !== null) {
        const span = document.createElement('span');
        span.textContent = ` ${getI18n(unitKey)}`;
        row.appendChild(span);
      }
      group.appendChild(row);
    }
    const pulseHelp = document.createElement('div');
    pulseHelp.setAttribute('data-help', 'onPulse');
    pulseHelp.textContent = getLabel('Config.PulseHelp');
    group.appendChild(pulseHelp);
    const tempHelp = document.createElement('div');
    tempHelp.setAttribute('data-help', 'temps');
    tempHelp.textContent = getLabel('Config.SuspendTempHelp');
    group.appendChild(tempHelp);
    const reset = document.createElement('button');
    reset.setAttribute('data-reset-pulse', '');
    reset.textContent = getI18n('UI.ResetPulseConfig');
    group.appendChild(reset);
    parts.reset = reset;
    panel.appendChild(group);
  }

  configParts = parts;
}

/** One spinner: the desktop's label above its spinner, and the spinner itself. The `change` handler
 * sits on the input for the reason the automation panel's two give — a browser fires `change` on
 * the input and leaves it there. */
function spinnerRow(panel, parts, catalog, field, labelKey, tooltipKey, range) {
  const label = document.createElement('label');
  label.setAttribute('data-field', field);
  label.textContent = getI18n(labelKey);
  panel.appendChild(label);

  const input = document.createElement('input');
  input.setAttribute('data-field', field);
  input.setAttribute('type', 'number');
  input.setAttribute('min', String(range[0]));
  input.setAttribute('max', String(range[1]));
  input.setAttribute('step', '1');
  input.value = String(editing[field]);
  if (tooltipKey !== null) input.title = getI18n(tooltipKey);
  input.addEventListener('change', () => configEdit(field, catalog));
  panel.appendChild(input);
  parts[field] = input;
  // The refusal names the control in the bundle's words, which is the only name a visitor has for
  // it — a design field like `suspendTemp` is not a word the desktop ever prints.
  parts[`label-${field}`] = getI18n(labelKey);
}

/** Redraw the panel from the design. The one thing that changes the panel's *shape* is the pulsed
 * flag, and the shape change is a rebuild — the desktop removes the whole Swing tab rather than
 * greying it out (`togglePulseConfigTab`). */
function paintConfig(catalog) {
  if (configParts === null) return;
  if (configParts.pulsedGroup !== editing.pulsed) {
    openConfig(page.config, catalog);
    return;
  }
  for (const [field] of PULSE_FIELDS) {
    const input = configParts[field];
    if (input !== undefined) input.value = String(editing[field]);
  }
  for (const field of ['currentHeat', 'maxSimulationTicks']) {
    const input = configParts[field];
    if (input !== undefined) input.value = String(editing[field]);
  }
  for (const [field] of REACTOR_FLAGS) {
    const chip = configParts[field];
    if (chip === undefined) continue;
    if (editing[field]) chip.removeAttribute('data-off');
    else chip.setAttribute('data-off', '');
  }
  for (const [, , fluid] of REACTOR_STYLES) {
    const chip = configParts[`style-${fluid ? 'fluid' : 'eu'}`];
    if (chip === undefined) continue;
    if (editing.fluid === fluid) chip.setAttribute('data-active', '');
    else chip.removeAttribute('data-active');
  }
  const maxHeat = maxHeatLabel(page.textarea.value, catalog);
  if (!maxHeat.ok) {
    refuse(maxHeat.message);
    return;
  }
  configParts.maxHeat.textContent = maxHeat.text;
}

/** One spinner turned. Refused rather than clamped, and the input put back to what the design holds,
 * which is what the chamber gate does for the same reason. */
function configEdit(field, catalog) {
  if (configParts === null) return;
  const input = configParts[field];
  if (input === undefined) return;
  const range = SPINNER_RANGES[field];
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
    refuse(`${configParts[`label-${field}`]} has to be a whole number from ${range[0]} to ${range[1]}`);
    input.value = String(editing[field]);
    return;
  }
  const edit = setReactorNumbers(editing, { [field]: value });
  if (!edit.ok) {
    refuse(edit.message);
    input.value = String(editing[field]);
    return;
  }
  applyEdit(edit, -1, catalog);
}

/** The panel's clicks: the radio pair, the three checkboxes, and the pulse reset button. The six
 * spinners answer where they land, like the automation panel's two. */
function wireConfig(panel, catalog) {
  panel.addEventListener('click', (event) => {
    const legacy = tapped(event.target, 'data-legacy');
    if (legacy !== null) {
      const wanted = legacy.hasAttribute('data-off');
      const before = legacyCode;
      setLegacyStyle(wanted);
      // A format the design cannot fit is refused, and the chip left as it was.
      if (legacyCode === before) return;
      if (wanted) legacy.removeAttribute('data-off');
      else legacy.setAttribute('data-off', '');
      return;
    }
    const style = tapped(event.target, 'data-style');
    if (style !== null) {
      const wanted = style.getAttribute('data-style') === 'fluid';
      if (editing.fluid === wanted) return;
      applyEdit(setReactorFlag(editing, 'fluid', wanted), -1, catalog);
      return;
    }
    const flag = tapped(event.target, 'data-flag');
    if (flag !== null) {
      const field = flag.getAttribute('data-flag');
      applyEdit(setReactorFlag(editing, field, flag.hasAttribute('data-off')), -1, catalog);
      return;
    }
    const reset = tapped(event.target, 'data-reset-pulse');
    if (reset !== null) applyEdit(resetPulseConfig(editing), -1, catalog);
  });
}

/**
 * The code format the field shows (`showOldStyleReactorCodeCheck`, handler at `:2329`). It is the
 * one control here that changes the field without changing the design, so it does not go through
 * `applyEdit` — it re-renders the same design in the other format, and keeps the tick limit the
 * design had rather than the one the old format would read back.
 *
 * A catalog whose ids do not fit the old format's two hex digits is refused, and the choice put
 * back: the desktop would write a truncated code there, which is a different reactor.
 */
function setLegacyStyle(on) {
  if (legacyCode === on) return;
  const ticksBefore = editing.maxSimulationTicks;
  legacyCode = on;
  const written = writeField(editing, page.catalog);
  if (!written.ok) {
    legacyCode = !on;
    refuse(written.message);
    return;
  }
  page.textarea.value = written.code;
  writeStoredCode(written.code);
  const board = describeBoard(written.code, page.catalog);
  if (!board.ok) {
    refuse(warningText(board));
    return;
  }
  render(board);
  renderHeader(board);
  renderTemperature(page.catalog);
  editing = copyDesign(board.design);
  editing.maxSimulationTicks = ticksBefore;
  page.errorElement.textContent = '';
  if (materialsParts !== null) paintMaterials(page.catalog);
  if (simulationParts !== null) paintSimulation(page.catalog);
  if (componentsParts !== null) paintComponents(page.catalog);
  if (configParts !== null) paintConfig(page.catalog);
  const blob = readBlob();
  blob.showOldStyleReactorCode = String(on);
  writeBlob(blob);
}

/**
 * The `Components` panel: the desktop's Component List tab, opened on demand like every other
 * panel. It has no controls — the list is what the design holds, repainted after every edit the
 * way the shopping list is.
 */
function openComponents(panel, catalog) {
  panel.replaceChildren();
  panel.hidden = false;

  const caption = document.createElement('div');
  caption.setAttribute('data-caption', '');
  caption.textContent = getI18n('UI.ComponentListTab');
  panel.appendChild(caption);

  const list = document.createElement('div');
  list.setAttribute('data-list', '');
  panel.appendChild(list);

  componentsParts = { caption, list };
  paintComponents(catalog);
}

/** Redraw the list from the board the page is already holding — the desktop rewrites the same
 * `JTextArea` after every action (`:280`, `:322`, `:2068`, `:2690`). */
function paintComponents(catalog) {
  if (componentsParts === null) return;
  const got = componentList(page.textarea.value, catalog);
  if (!got.ok) {
    refuse(got.message);
    return;
  }
  componentsParts.list.replaceChildren();
  for (const line of got.lines) {
    const row = document.createElement('div');
    row.setAttribute('data-line', '');
    row.textContent = line;
    componentsParts.list.appendChild(row);
  }
}

/** The palette entry the visitor wants next. Only entries the filters left can be selected, which
 * is why the click lands on one of them. */
function selectEntry(id, catalog) {
  placing = { id, params: null };
  const container = page.drawer.querySelector('[data-entries]');
  if (container !== null) {
    for (const chip of container.children) {
      if (chip.getAttribute('data-id') === String(id)) chip.setAttribute('data-selected', '');
      else chip.removeAttribute('data-selected');
    }
  }
  paintPlacing(page.drawer, catalog);
}

/** The line the desktop shows above the palette, in the bundle's words. */
function renderPlacing(drawer) {
  const line = document.createElement('div');
  line.setAttribute('data-placing', '');
  drawer.appendChild(line);
}

function paintPlacing(drawer, catalog) {
  const line = drawer.querySelector('[data-placing]');
  if (line === null) return;
  if (placing === null) {
    line.textContent = getI18n('UI.ComponentPlacingDefault');
    return;
  }
  const prototype = createComponent(catalog, placing.id);
  if (prototype === null) return;
  line.textContent = getI18n('UI.ComponentPlacingSpecific').replace('%s', getI18n(prototype.nameKey));
}

/** The readout for one cell of the current run. The run is made once per code, not once per tap,
 * which is what the desktop's `simulatedReactor` is for; the tapped cell then answers through the
 * same three branches the desktop's info button has. */
/**
 * The `Materials` chip's panel: the desktop's materials tab, rebuilt each time the chip is lit.
 *
 * The list is the engine's whole string, newlines included, so the panel is the desktop's
 * `materialsArea` rather than a re-imagining of it -- same `toString()`, same `#,##0.##` counts,
 * same `TreeMap` order, all of it pinned against the Java dump in `materials.test.js`. The two
 * controls above it are the recipe switches that rebuild the table the list is summed from, and
 * they are the desktop's own: the GregTech combo (`ReactorPlannerFrame.java:1710`) had four items,
 * the bundle's "None" plus three literal version strings, and `expandAdvancedAlloyCheck` is one
 * checkbox. The coolant-cell substitution is *not* a control here because the desktop never had
 * one: `useUfcForCoolantCells` follows the Minecraft version (`:2408` false, `:2422` true), and
 * this page pins 1.7.10, so the substitution is permanently off -- a control would be a knob that
 * does nothing on this page.
 */
function openMaterials(panel, catalog) {
  panel.replaceChildren();
  panel.hidden = false;
  materialsParts = null;

  const caption = document.createElement('div');
  caption.setAttribute('data-caption', '');
  caption.textContent = getI18n('UI.MaterialsTab');
  panel.appendChild(caption);

  const gtRow = document.createElement('div');
  gtRow.setAttribute('data-gt-row', '');
  const label = document.createElement('span');
  label.textContent = getI18n('UI.GregTechVersion');
  gtRow.appendChild(label);
  for (const version of ['none', '5.08', '5.09', 'GTNH']) {
    const chip = document.createElement('button');
    chip.setAttribute('data-gt', version);
    // The combo's model is the bundle's "None" plus three strings the bundle never had, so the
    // labels are the desktop's: one localized word and three literals.
    chip.textContent = version === 'none' ? getI18n('UI.GregTechVersionNone') : version;
    if (switches().gtVersion === version) chip.setAttribute('data-active', '');
    gtRow.appendChild(chip);
  }
  panel.appendChild(gtRow);

  const alloyRow = document.createElement('div');
  alloyRow.setAttribute('data-alloy-row', '');
  const toggle = document.createElement('button');
  toggle.setAttribute('data-alloy', '');
  toggle.textContent = getI18n('UI.ExpandAdvancedAlloy');
  if (!switches().expandAdvancedAlloy) toggle.setAttribute('data-off', '');
  alloyRow.appendChild(toggle);
  panel.appendChild(alloyRow);

  const list = document.createElement('div');
  list.setAttribute('data-list', '');
  panel.appendChild(list);
  materialsParts = { gtRow, toggle, list };
  paintMaterials(catalog);
}

/** Redraw the list from the board the page is already holding. The desktop recomputes it the same
 * way -- `materialsArea.setText(reactor.getMaterials().toString())` after every action -- so a tap
 * that adds a rod changes the list rather than leaving a stale one under a live board. The trailing
 * newline the engine's `toString()` writes is display noise in a `pre-wrap` box, so it is dropped
 * here and only here: the tests compare the whole string. */
function paintMaterials(catalog) {
  if (materialsParts === null) return;
  const text = shoppingList(editing, catalog);
  materialsParts.list.textContent = text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** The desktop's `gtVersionCombo` write (`:2431-2663`): the recipe table's version, and the two
 * fuel-rod behaviours the same handler sets beside it. The mapping is the desktop's own -- 5.09
 * alone turns on the 509 behaviour, GTNH alone turns on the GTNH one -- and it applies to the
 * simulation as well as the shopping list, which is why the panel is a mode rather than a readout.
 * The page pins Minecraft 1.7.10, so the combo's other guard (`expandAdvancedAlloy` forced off
 * when a GT version is selected, `:2412`) is not reproduced: the checkbox stays whatever the
 * visitor set it, and `setGTVersion` already ignores it for 5.08/5.09 on its own.
 */
function applyGtVersion(version) {
  setGTVersion(version);
  setGT509Behavior(version === '5.09');
  setGTNHBehavior(version === 'GTNH');
}

function writeGtVersion(version) {
  const blob = readBlob();
  blob.gtVersion = version;
  writeBlob(blob);
}

/** The panel's clicks. A GregTech chip is a selection, not a toggle: clicking one makes it the
 * version and dims the other three, which is what a combo with four items and one value means.
 * The alloy checkbox is a toggle, and keeps the drawer's convention of carrying `data-off` when
 * it is off. */
function wireMaterials(panel, catalog) {
  panel.addEventListener('click', (event) => {
    const chip = tapped(event.target, 'data-gt');
    if (chip !== null) {
      const version = chip.getAttribute('data-gt');
      if (switches().gtVersion === version) return;
      applyGtVersion(version);
      for (const other of materialsParts.gtRow.children) {
        if (other.hasAttribute('data-gt')) other.removeAttribute('data-active');
      }
      chip.setAttribute('data-active', '');
      writeGtVersion(version);
      paintMaterials(catalog);
      return;
    }
    const alloy = tapped(event.target, 'data-alloy');
    if (alloy === null || materialsParts === null) return;
    // `data-off` is the chip's state, so the click's value is the other one: a checkbox that is
    // carrying the mark is off, and this tap turns it on.
    const on = alloy.hasAttribute('data-off');
    setExpandAdvancedAlloy(on);
    if (on) alloy.removeAttribute('data-off');
    else alloy.setAttribute('data-off', '');
    paintMaterials(catalog);
  });
}

/** The `Compare` panel: the desktop's comparison tab, which the page opens on demand like the
 * drawer, the automation panel and the shopping list.
 *
 * The words are all the bundle's -- `UI.ComparisonTab` is the Swing tab's label, `Comparison.Header`
 * is the label above the comparison area, and `UI.OnlyShowDiffData` is the desktop's checkbox. The
 * previous code is the desktop's `comparisonCodeField`, which `updateComparison` fills with
 * `prevReactorCode` before it writes a single figure: the comparison is only meaningful against a
 * design the visitor can see, and on a phone the thing they typed last is not on screen any more.
 * The `showOldStyleReactorCodeCheck` half of that field is not reproduced -- see WEB_MIGRATION_PLAN.md
 * §24 for why the old-style code dies with this page's one code format.
 */
function openComparison(panel, catalog) {
  panel.replaceChildren();
  panel.hidden = false;
  comparisonParts = null;

  const caption = document.createElement('div');
  caption.setAttribute('data-caption', '');
  caption.textContent = getI18n('UI.ComparisonTab');
  panel.appendChild(caption);

  const header = document.createElement('div');
  header.setAttribute('data-header', '');
  header.textContent = getI18n('Comparison.Header');
  panel.appendChild(header);

  const prevCode = document.createElement('div');
  prevCode.setAttribute('data-prev-code', '');
  panel.appendChild(prevCode);

  const toggle = document.createElement('button');
  toggle.setAttribute('data-toggle', 'diff');
  toggle.textContent = getI18n('UI.OnlyShowDiffData');
  // Off is the desktop's default, and off is what leaves every line in.
  toggle.setAttribute('data-off', '');
  panel.appendChild(toggle);

  const lock = document.createElement('button');
  lock.setAttribute('data-toggle', 'lock');
  lock.textContent = getI18n('UI.LockInTabCode');
  // `lockPrevCodeCheck` starts unselected, and unselected is what lets a new run take over the
  // desktop's history (`simulateButtonActionPerformed:2089`).
  lock.setAttribute('data-off', '');
  panel.appendChild(lock);

  const copy = document.createElement('button');
  copy.setAttribute('data-copy-comparison', '');
  copy.textContent = getI18n('UI.CopyComparisonData');
  panel.appendChild(copy);

  const lines = document.createElement('div');
  lines.setAttribute('data-lines', '');
  panel.appendChild(lines);

  comparisonParts = { prevCode, toggle, lock, copy, lines };
  paintComparison(catalog);
}

/** Redraw the comparison from the two runs the page is holding.
 *
 * Both reactors are rebuilt from their codes rather than kept, which is the desktop's own move and
 * the reason the panel reads a design's max heat off a grid the run never mutated. A page with one
 * run gets the bundle's `Comparison.Default` rather than a half-built comparison, which is what the
 * Swing label holds before `updateComparison` has ever run.
 */
function paintComparison(catalog) {
  if (comparisonParts === null) return;
  comparisonParts.lines.replaceChildren();

  if (lastRun === null || prevRun === null) {
    const row = document.createElement('div');
    row.setAttribute('data-line', '');
    row.textContent = getI18n('Comparison.Default');
    comparisonParts.lines.appendChild(row);
    comparisonParts.prevCode.textContent = '';
    return;
  }

  const left = designReactor(lastRun.code, catalog);
  const right = designReactor(prevRun.code, catalog);
  if (!left.ok) {
    refuse(left.message);
    return;
  }
  if (!right.ok) {
    refuse(right.message);
    return;
  }

  const got = compareRuns(
    { data: lastRun.data, reactor: left.reactor },
    { data: prevRun.data, reactor: right.reactor },
    { onlyShowDiff: !comparisonParts.toggle.hasAttribute('data-off') });
  comparisonParts.prevCode.textContent = prevRun.code;
  if (!got.ok) {
    const row = document.createElement('div');
    row.setAttribute('data-line', '');
    row.textContent = got.message;
    comparisonParts.lines.appendChild(row);
    return;
  }

  for (const line of comparisonLines(got.html)) {
    const row = document.createElement('div');
    row.setAttribute('data-line', '');
    for (const run of line.runs) {
      if (run.color === null) {
        row.appendChild(document.createTextNode(run.text));
        continue;
      }
      const span = document.createElement('span');
      span.setAttribute('data-color', run.color);
      span.textContent = run.text;
      row.appendChild(span);
    }
    comparisonParts.lines.appendChild(row);
  }
}

/** The panel's controls: the desktop's `onlyShowDiffCheck`, its `lockPrevCodeCheck`, and its
 * `UI.CopyComparisonData` button. A lit checkbox drops the lines that did not move; the toggle is
 * the drawer's convention, carrying `data-off` while it is off. */
function wireComparison(panel, catalog) {
  panel.addEventListener('click', (event) => {
    if (tapped(event.target, 'data-copy-comparison') !== null) {
      copyComparison(comparisonParts === null ? null : comparisonParts.lines);
      return;
    }
    const toggle = tapped(event.target, 'data-toggle');
    if (toggle === null || comparisonParts === null) return;
    const off = toggle.hasAttribute('data-off');
    if (off) toggle.removeAttribute('data-off');
    else toggle.setAttribute('data-off', '');
    // The lock-in checkbox changes no line by itself — it decides what the *next* run does with
    // the desktop's history — so only the diff checkbox repaints.
    if (toggle.getAttribute('data-toggle') === 'diff') paintComparison(catalog);
  });
}

/** The run for the code the field holds, made once per code rather than once per readout.
 *
 * The desktop keeps one `simulatedReactor` and every readout reads it; running again for a code the
 * page has already run would put the same design into the desktop's history twice, which is what
 * makes the comparison drift. So the Simulation panel and the Inspect popovers share this step.
 *
 * @returns {Boolean} whether the page holds a run for the field; a code the decoder rejects is
 *   reported rather than thrown, and the caller leaves its readout alone.
 */
/** Is the desktop's `lockPrevCodeCheck` selected? Off when the comparison panel is closed, since
 * the checkbox lives in that panel and a closed panel has no checkbox showing. */
function lockedInTab() {
  return comparisonParts !== null && !comparisonParts.lock.hasAttribute('data-off');
}

function ensureRun() {
  if (inspectedCode === page.textarea.value) return true;
  const run = simulate(page.textarea.value, page.catalog);
  if (!run.ok) {
    refuse(run.message);
    return false;
  }
  inspected = run.run;
  inspectedCode = page.textarea.value;
  lastPaint = run.run.cellPaint;
  // The run's colours go on the cells the page is already showing: the desktop's `process` repaints
  // the same buttons rather than rebuilding the grid, so a run that finished after the board was
  // drawn has to mark it again rather than waiting for the next edit to do it.
  paintRunMarks(document.getElementById('board'), lastPaint);
  // A finished run is a pair of neighbours in the desktop's history, and the pair is what the
  // comparison label reads: the run that just finished against the one before it. The one
  // exception is the desktop's own: `simulateButtonActionPerformed:2089` skips the shift while
  // `lockPrevCodeCheck` is selected, which is what "lock in-tab code" means — the visitor keeps
  // comparing against the same earlier design.
  if (!lockedInTab()) prevRun = lastRun;
  lastRun = { code: inspectedCode, data: run.run.data };
  return true;
}

/**
 * The desktop's Simulate button (`:1381`, handler at `:2085`): the run for the code the field
 * holds, started again even when the page has already run that code. The desktop's handler moves
 * the finished run into `prevSimulator` first, which is what makes two runs of the same design
 * comparable — the page's `ensureRun` deliberately skips a repeat run for exactly that reason, so
 * this control's job is to clear the skip.
 */
function simulateNow(catalog) {
  inspectedCode = null;
  if (!ensureRun()) return;
  if (simulationParts !== null) paintSimulation(catalog);
  if (comparisonParts !== null) paintComparison(catalog);
}

/** The desktop's Simulate button (`UI.SimulateButton`, `ReactorPlannerFrame:1409`): it runs the
 * design the field holds and repaints the panels that already show, which is the Swing frame's
 * `simulatedReactor` discipline rather than a queue. The label is the bundle's own words, so a
 * Chinese visitor sees 模拟 here; the English answers are the words `index.html` authors, which makes
 * this a no-op for an English one. */
function wireSimulate(button, catalog) {
  button.textContent = getI18n('UI.SimulateButton');
  button.addEventListener('click', () => simulateNow(catalog));
}

/** Opening the Simulation panel: the desktop's Simulation tab, whose one piece of content is the
 * JTextArea the run wrote into. */
function openSimulation(panel, catalog) {
  panel.replaceChildren();
  panel.hidden = false;
  simulationParts = null;

  const caption = document.createElement('div');
  caption.setAttribute('data-caption', '');
  caption.textContent = getI18n('UI.SimulationTab');
  panel.appendChild(caption);

  const lines = document.createElement('div');
  lines.setAttribute('data-lines', '');
  panel.appendChild(lines);

  simulationParts = { caption, lines };
  paintSimulation(catalog);
}

/** The run's report, one row per line -- the same text the Swing frame's `outputArea` receives.
 *
 * Opening the panel runs a simulation for the code the field holds if the page has not run one yet,
 * which is the desktop's `simulatedReactor` discipline rather than its Simulate button: the tab shows
 * the last run, it does not start one, and the page has no cancel and no queue. A page that has never
 * finished a run gets the bundle's `UI.NoSimulationRun` rather than an empty panel.
 */
function paintSimulation(catalog) {
  if (simulationParts === null) return;
  if (!ensureRun()) return;
  simulationParts.lines.replaceChildren();

  if (inspected === null) {
    const row = document.createElement('div');
    row.setAttribute('data-line', '');
    row.textContent = getI18n('UI.NoSimulationRun');
    simulationParts.lines.appendChild(row);
    return;
  }

  const report = inspected.report.split('\n');
  // The desktop's JTextArea has no blank line at the end of a report, so a trailing newline in the
  // engine's string is not a line the visitor would see.
  if (report.length > 0 && report[report.length - 1] === '') report.pop();
  for (const text of report) {
    const row = document.createElement('div');
    row.setAttribute('data-line', '');
    row.textContent = text;
    simulationParts.lines.appendChild(row);
  }
}

function inspectAt(index) {
  if (!ensureRun()) return;

  const got = inspectCell(inspected, index);
  if (!got.ok) {
    refuse(got.message);
    return;
  }
  // A readout that worked is the last word the strip gets, same as an edit that worked: a stale
  // refusal above a board that is answering reads as a page that is still broken. One readout at a
  // time, too -- and only on a success, so a mis-tap leaves the popover the visitor was reading
  // alone rather than blanking it and adding a message.
  page.errorElement.textContent = '';
  clearPopovers();

  const slot = page.boardElement.querySelector(`[data-index="${index}"]`);
  if (slot === null) return;
  const popover = document.createElement('div');
  popover.setAttribute('data-inspect', '');
  popover.textContent = got.text;
  slot.appendChild(popover);
}

/** Take the readouts back off the board. The marker lives on the popover itself, so clearing means
 * dropping the child rather than dimming it. */
function clearPopovers() {
  for (const slot of page.boardElement.children) {
    // `children` is a live HTMLCollection in a browser, not an array, so the copy is explicit --
    // and the copy is what makes the swap safe: dropping a child invalidates the collection.
    const keep = [...slot.children].filter((kid) => !kid.hasAttribute('data-inspect'));
    if (keep.length !== slot.children.length) slot.replaceChildren(...keep);
  }
}

/** A tap the engine refused, in the engine's words. */
function refuse(message) {
  page.errorElement.textContent = message;
}

/**
 * `localStorage` holds only the keys the preferences decision allows; a stale or corrupt blob is
 * treated as "no preference" rather than an error, since the app works without it.
 */
function readStoredCode() {
  try {
    const blob = JSON.parse(localStorage.getItem('erp-prefs') ?? '');
    return typeof blob.lastCode === 'string' ? blob.lastCode : null;
  } catch (ignored) {
    return null;
  }
}

function writeStoredCode(code) {
  const blob = readBlob();
  blob.lastCode = code;
  writeBlob(blob);
}

/** The availability toggle's prefs key; the blob carries four (§30 added `chambers`). */
function writeModPackFilter(value) {
  const blob = readBlob();
  blob.modPackFilter = value;
  writeBlob(blob);
}

/** The chamber gate's prefs key, kept as a string like every other preference the blob carries. */
function writeChambers(value) {
  const blob = readBlob();
  blob.chambers = String(value);
  writeBlob(blob);
}

function writeBlob(blob) {
  try {
    localStorage.setItem('erp-prefs', JSON.stringify(blob));
  } catch (ignored) {
    // Private mode and a full quota both throw; the board is already drawn by then.
  }
}

function readBlob() {
  try {
    const blob = JSON.parse(localStorage.getItem('erp-prefs') ?? '');
    const clean = {};
    for (const key of PREF_KEYS) if (typeof blob[key] === 'string') clean[key] = blob[key];
    return clean;
  } catch (ignored) {
    return {};
  }
}

/**
 * The desktop's paste button (`ReactorPlannerFrame:2388`) hands the code field
 * `clipboard.replaceAll("[^0-9A-Za-z(),.?|:/+=]+", "")` before anything reads it, which is what makes
 * a code pasted out of a chat window or a terminal still decode. A browser's textarea takes the paste
 * verbatim, so the page applies the same strip where it reads the field -- same class of characters,
 * named once, here.
 */
export function pasteCode(text) {
  return text.replace(/[^0-9A-Za-z(),.?|:/+=]/g, '');
}

/**
 * The desktop's `UI.CopyCodeButton` (`ReactorPlannerFrame:2151`) puts the code field on the system
 * clipboard and says nothing about it. A browser cannot do that quietly: the clipboard is a gated
 * API, and a page that reaches it may be refused. So the page tries the honest route first and
 * falls back to the gesture a visitor has to finish, in this order:
 *
 *   1. `navigator.clipboard.writeText`, the async Clipboard API;
 *   2. selecting the page's own field and asking for `execCommand('copy')`, which needs no permission
 *      prompt when it comes from a real tap and works where the API is missing;
 *   3. nothing further -- the text is selected either way, so the visitor's own keyboard copies it.
 *
 * Nothing is reported in any case: the desktop reports nothing, and a page that announces a copy the
 * visitor can already see has no more to say. A refused copy is therefore indistinguishable from a
 * quiet one, which is the honest reading of an API the browser will not let this page observe.
 */
/** The Reactor Chamber gate. The engine has no chamber concept -- `Reactor.java` is a fixed 6 x 9
 * grid and no component is a chamber -- so this control, and the wording it needs, are web-side in
 * the same way the mode chips are. The Nuclear Reactor block brings 3 columns and each chamber opens
 * one more, so the input counts chambers rather than columns: 0 is the smallest legal reactor, 6 the
 * widest the code can carry. The input is a spinner in the desktop's idiom, the same as the
 * automation panel's two, and carries the same `min`/`max` the desktop's spinner would. */
function buildChambers(panel, catalog) {
  const label = document.createElement('label');
  label.setAttribute('data-field', 'chambers');
  label.textContent = 'Reactor Chambers';
  panel.appendChild(label);

  const input = document.createElement('input');
  input.setAttribute('data-field', 'chambers');
  input.setAttribute('type', 'number');
  input.setAttribute('min', '0');
  input.setAttribute('max', String(GRID_COLS - CORE_COLS));
  input.setAttribute('step', '1');
  input.value = String(chambers);
  panel.appendChild(input);
  page.chamberInput = input;
  // One handler on the input rather than on the panel, for the reason the automation panel's spinners
  // give: a browser fires `change` on the input and leaves it there.
  input.addEventListener('change', () => applyChambers(catalog));
}

/** Moving the gate. Closing it below what the design fills is refused rather than applied: the
 * components standing in the closed columns would have nowhere to be, and the page's field always
 * encodes what it draws. */
function applyChambers(catalog) {
  const input = page.chamberInput;
  const wanted = Number(input.value);
  if (!Number.isInteger(wanted) || wanted < 0 || wanted > GRID_COLS - CORE_COLS) {
    refuse(`a chamber count has to be a whole number of columns from 0 to ${GRID_COLS - CORE_COLS}`);
    input.value = String(chambers);
    return;
  }
  const needed = impliedChambers(editing);
  if (wanted < needed) {
    refuse(`${needed} columns past the reactor core hold components, so the gate cannot close below ${needed}`);
    input.value = String(chambers);
    return;
  }
  chambers = wanted;
  writeChambers(chambers);
  const board = describeBoard(page.textarea.value, catalog);
  if (!board.ok) {
    refuse(`${board.title}: ${board.message}`);
    return;
  }
  render(board);
}

/** The desktop's Copy Code button (`UI.CopyCodeButton`, `ReactorPlannerFrame:2151`): it hands the
 * field's text to the clipboard, and the label is the bundle's own words for the same reason the
 * Simulate button's is. */
function wireCopy(button, textarea) {
  button.textContent = getI18n('UI.CopyCodeButton');
  button.addEventListener('click', () => copyCode(textarea));
}

/** The desktop's `UI.ClearGridButton` (`ReactorPlannerFrame:1375`, action at `:2056`): one click
 * empties the whole grid instead of the tapped cell, and it is the only control on the page that
 * acts without a target. The desktop's handler also clears the simulation output area, rewrites the
 * component list, and re-bounds the heat spinner -- this page has none of those controls yet, so
 * what it owns is the grid, the code field, and the materials list `applyEdit` already repaints.
 * The field keeps the encoded empty design rather than the desktop's null: the page's field always
 * holds the code that encodes what it draws, and `Reactor.java:106` clears cells only, so the
 * reactor-level switches survive and an empty field would drop them and disagree with the board. */
function wireClearGrid(button, catalog) {
  button.textContent = getI18n('UI.ClearGridButton');
  button.addEventListener('click', () => applyEdit(clearDesign(editing), null, catalog));
}

function copyCode(textarea) {
  const code = textarea.value;
  if (code === '') return;
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined || clipboard.writeText === undefined) {
    selectForCopy(textarea);
    return;
  }
  try {
    clipboard.writeText(code).catch(() => selectForCopy(textarea));
  } catch (problem) {
    selectForCopy(textarea);
  }
}

/** The desktop's `UI.CopyComparisonData` (`ReactorPlannerFrame:1855`, action at `:2385-2389`):
 * `new HtmlSelection(comparisonLabel.getText())` onto the system clipboard, so a visitor pastes the
 * comparison into a forum post with its colours intact. Two things differ here, and both are the
 * browser's rather than a choice:
 *
 *  - the text is the panel's own rows joined with newlines, not an HTML string. The page already
 *    split the desktop's `<html>`/`<br>` label into rows, and a clipboard that carries markup needs
 *    a MIME pair the Clipboard API does not offer -- only `writeText` exists;
 *  - the fallback is nothing. `copyCode` can leave the code selected in the field the page is
 *    showing; a `<div>` has no field to select, and the visitor's own drag over the panel is the
 *    gesture a browser will not make for them.
 *
 * The button is inert while the panel holds `Comparison.Default`, which is the desktop's own
 * `setEnabled(false)` at construction (`:1856`) and `setEnabled(true)` at the end of `updateComparison`
 * (`:3293`) -- a comparison that has never been written has nothing to copy.
 */
function copyComparison(lines) {
  if (lines === null || lastRun === null || prevRun === null) return;
  // `children` rather than `children.some(...)`: a browser's is a live collection and the shim's an
  // array, and only indexing is true of both (WEB_MIGRATION_PLAN.md §20).
  const rows = lines.children;
  const parts = [];
  for (let i = 0; i < rows.length; i += 1) parts.push(rows[i].textContent);
  const text = parts.join('\n');
  if (text === '') return;
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined || clipboard.writeText === undefined) return;
  try {
    clipboard.writeText(text);
  } catch (ignored) {
    // Nothing is reported in any case: the desktop reports nothing, and a copy a browser refused is
    // indistinguishable from a quiet one.
  }
}

/** The fallback the visitor finishes. `select()` leaves the code highlighted in the field the page
 * is already showing, which is the only route a browser will not take on a visitor's behalf. */
function selectForCopy(textarea) {
  textarea.select();
  if (typeof document.execCommand === 'function') document.execCommand('copy');
}

await main();
