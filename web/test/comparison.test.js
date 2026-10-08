/**
 * The comparison view's oracle: every line is the bundle's, the figures are the run's, and the
 * pairing follows the two designs rather than the two reports.
 *
 * There is no Java dump for this panel and there cannot be one: `updateComparison` is a private
 * method of a Swing frame, and the JDK that runs the planner's own classes has no `javax` left in
 * it. The oracle is therefore the bundle plus the run. Three claims carry the panel:
 *
 * 1. **Every line is made of bundle pieces.** Each line, markup stripped, matches a template built
 *    from a `Comparison.Prefix.*` (or nothing) followed by one `Comparison.*` body template --
 *    numbers masked. A sentence this port wrote instead of copied fails here, the same way
 *    `inspect.test.js` catches an invented readout line.
 * 2. **The figures are the run's.** For a sample of design pairs, the postsim output line is
 *    asserted to carry exactly the pair `(left/right)` the two `SimulationData` records hold,
 *    formatted with the bundle's `Comparison.SimpleDecimalFormat`, and the coloured diff carries
 *    the bundle's `Comparison.CompareDecimalFormat` with the colour the desktop's threshold rule
 *    picks. The run itself is already held against the Java baseline by `corpus.test.js`, so the
 *    figures do not need re-proving here -- only the act of reading them out does.
 * 3. **The pairing follows the designs.** A fluid design against a non-fluid one gets the
 *    `EUHUoutput`/`HUEUoutput` sentence, never the `EUEUoutput` one, and the max-temp line colours
 *    each side against that side's own ceiling.
 *
 * Plus the two gates the desktop has: a page with one run gets `Comparison.Default`, and a run
 * compared to itself with `onlyShowDiffData` on gets `Comparison.NoDifferences` rather than a
 * screen of `+0`s.
 *
 * Run: `node web/test/comparison.test.js` (add `--only <pattern>` to restrict the pairs).
 *
 * @see web/engine/comparison.js, web/ui/comparison.js, src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java:2774-3290
 */

import { readFile } from 'node:fs/promises';
import { parseCatalog } from '../engine/components.js';
import { loadBundle, getI18n } from '../engine/i18n.js';
import { formatDecimal } from '../engine/format.js';
import { simulateCode } from '../engine/automation-simulator.js';
import { compareRuns } from '../engine/comparison.js';
import { SimulationData } from '../engine/simulation-data.js';
import { blankReactor } from '../engine/reactor.js';
import { designReactor, comparisonLines } from '../ui/comparison.js';

const ONLY = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = parseCatalog(await readFile('web/data/components.json', 'utf8'));
loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));
const designs = JSON.parse(await readFile('testResources/corpus-designs.json', 'utf8')).designs;

// ---------------------------------------------------------------------------
// Claim 1: every line is a prefix and a body template, both the bundle's
// ---------------------------------------------------------------------------

/** The `Comparison.*` templates that start a line's content. The four time shapes, the four
 * output shapes, the four temperature shapes, the six heating/cooling lines, and one materials
 * entry (which also stands for the component and replaced entries -- they are the same template). */
const BODY_KEYS = [
  'Time.Both', 'Time.BothColored', 'Time.LeftOnly', 'Time.RightOnly',
  'EUEUoutput', 'EUHUoutput', 'HUEUoutput', 'HUHUoutput',
  'PredepleteMinTemp', 'PredepleteMaxTemp', 'PostsimMinTemp', 'PostsimMaxTemp',
  'HullHeating', 'HullCoolingPossible', 'ComponentHeating', 'VentCooling',
  'HullCooling', 'VentCoolingPossible', 'MaterialsEntry', 'NoDifferences',
];

/** The `Comparison.Prefix.*` strings that can sit in front of a body, including the empty one:
 * the first component-broken line is the desktop's own exception, written with no prefix at all
 * (`ReactorPlannerFrame.java:2847`). */
const PREFIX_KEYS = ['', 'TimeToBelow50', 'TimeToBurn', 'TimeToEvaporate', 'TimeToHurt', 'TimeToLava',
  'TimeToXplode', 'PrebreakTime', 'PredepleteTime', 'PostSimulationTime', 'Prebreak', 'Predeplete',
  'PostSimulation'];

/** The three headings sit under `Comparison.` rather than `Comparison.Prefix.`. */
const HEADING_KEYS = ['MaterialsHeading', 'ComponentsHeading', 'ComponentsReplacedHeading'];

/**
 * A template becomes a pattern with every `%s`/`%d`/`%+,d` masked to a run of digits. The mask is
 * deliberately loose -- it also eats the `50` in "Time to below 50% heat" -- because this claim is
 * about provenance, not about grammar: a line that matches no pattern is a line nobody localized.
 */
function maskedPattern(template) {
  const parts = stripMarkup(template).split(/%[^a-zA-Z]*[dfs]/);
  const literals = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  return new RegExp(`^${literals.join(String.raw`[\s\S]+?`)}$`);
}

const LINE_PATTERNS = [];
for (const prefixKey of [...PREFIX_KEYS, ...HEADING_KEYS]) {
  const prefix = prefixKey === '' ? ''
    : (HEADING_KEYS.includes(prefixKey)
      ? getI18n(`Comparison.${prefixKey}`)
      : getI18n(`Comparison.Prefix.${prefixKey}`));
  if (prefix !== '') LINE_PATTERNS.push(maskedPattern(prefix)); // a heading or prefix alone
  for (const bodyKey of BODY_KEYS) {
    LINE_PATTERNS.push(maskedPattern(prefix + getI18n(`Comparison.${bodyKey}`)));
  }
}

/** The desktop's label markup, taken off a line before it is matched. */
function stripMarkup(text) {
  return text.replace(/<[^>]*>/g, '');
}

function lineProvenance(line) {
  return LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/** How many times `label` appears in `text`. */
function occurrences(text, label) {
  let count = 0;
  let at = text.indexOf(label);
  while (at >= 0) { count++; at = text.indexOf(label, at + label.length); }
  return count;
}

// ---------------------------------------------------------------------------
// Claim 2 and 3 fixtures: runs of design pairs
// ---------------------------------------------------------------------------

const SIMPLE = getI18n('Comparison.SimpleDecimalFormat');
const COMPARE = getI18n('Comparison.CompareDecimalFormat');

function runOf(design) {
  const run = simulateCode(design.code, catalog, {});
  const built = designReactor(design.code, catalog);
  assert(built.ok, `cannot rebuild ${design.id}: ${built.message}`);
  return { data: run.data, reactor: built.reactor };
}

const fluidDesigns = [];
const solidDesigns = [];
for (const design of designs) {
  const built = designReactor(design.code, catalog);
  if (!built.ok) continue;
  if (built.reactor.isFluid()) {
    if (fluidDesigns.length < 4) fluidDesigns.push(design);
  } else if (solidDesigns.length < 12) {
    solidDesigns.push(design);
  }
  if (fluidDesigns.length >= 4 && solidDesigns.length >= 12) break;
}

assert(fluidDesigns.length > 0, 'the corpus has no fluid design to pair against');

const pairs = [];
for (let i = 0; i < solidDesigns.length; i++) {
  pairs.push([solidDesigns[i], solidDesigns[(i + 1) % solidDesigns.length]]);
}
for (const fluid of fluidDesigns) {
  pairs.push([fluid, solidDesigns[0]]);
  pairs.push([solidDesigns[1], fluid]);
  pairs.push([fluid, fluidDesigns[(fluidDesigns.indexOf(fluid) + 1) % fluidDesigns.length]]);
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

let checked = 0;
let linesChecked = 0;
let outputLines = 0;
let fluidPairings = 0;
const failures = [];

for (const [leftDesign, rightDesign] of pairs) {
  if (ONLY !== null && !(leftDesign.id.includes(ONLY) || rightDesign.id.includes(ONLY))) continue;
  const left = runOf(leftDesign);
  const right = runOf(rightDesign);

  const got = compareRuns({ data: left.data, reactor: left.reactor },
    { data: right.data, reactor: right.reactor }, { onlyShowDiff: false });
  assert(got.ok, `a pair of finished runs must compare: ${leftDesign.id} vs ${rightDesign.id}`);

  const html = got.html;
  const lines = comparisonLines(html);

  // Claim 1, every line of the panel.
  for (const line of lines) {
    const text = stripMarkup(line.runs.map((run) => run.text).join(''));
    if (text === '') continue; // the section gaps the desktop's `<br>` pairs leave
    linesChecked++;
    if (!lineProvenance(text)) {
      failures.push(`${leftDesign.id}/${rightDesign.id}: line matches no bundle template: ${text}`);
    }
    // The renderer's own contract: the runs it emits spell the line they came from.
    const rendered = line.runs.map((run) => run.text).join('');
    if (stripMarkup(rendered) !== stripMarkup(line.text)) {
      failures.push(`${leftDesign.id}/${rightDesign.id}: renderer lost text: ${line.text}`);
    }
    for (const run of line.runs) {
      if (run.color !== null && !['green', 'red', 'orange'].includes(run.color)) {
        failures.push(`${leftDesign.id}/${rightDesign.id}: colour word ${run.color} is not the desktop's`);
      }
    }
  }

  // Claim 2: the postsim output line carries the pair the two records hold.
  const leftData = left.data.values();
  const rightData = right.data.values();
  const leftFluid = left.reactor.isFluid();
  const rightFluid = right.reactor.isFluid();
  const leftUnit = leftFluid ? 'HUoutput' : 'EUoutput';
  const rightUnit = rightFluid ? 'HUoutput' : 'EUoutput';
  const leftHasOutput = leftData['min' + leftUnit] <= leftData['max' + leftUnit];
  const rightHasOutput = rightData['min' + rightUnit] <= rightData['max' + rightUnit];
  if (leftHasOutput && rightHasOutput) {
    const leftTotal = formatDecimal(SIMPLE, leftData['total' + leftUnit]);
    const rightTotal = formatDecimal(SIMPLE, rightData['total' + rightUnit]);
    const diff = leftData['total' + leftUnit] - rightData['total' + rightUnit];
    const threshold = 1000;
    const expectedColor = Math.abs(diff) > threshold
      ? (Math.sign(diff) === Math.sign(threshold) ? 'green' : 'red')
      : 'orange';
    const expectedDiff = leftFluid === rightFluid
      ? `<font color="${expectedColor}">${formatDecimal(COMPARE, diff)}</font>`
      : null;
    const pair = leftFluid === rightFluid
      ? `(${leftTotal}/${rightTotal})`
      : `${leftTotal} ${leftFluid ? 'HU' : 'EU'} / ${rightTotal} ${rightFluid ? 'HU' : 'EU'}`;
    const sameUnit = leftFluid === rightFluid;
    const avgDiff = leftData['avg' + leftUnit] - rightData['avg' + rightUnit];
    const avgColor = Math.abs(avgDiff) > 0.1
      ? (Math.sign(avgDiff) === Math.sign(0.1) ? 'green' : 'red')
      : 'orange';
    const expectedAvg = sameUnit
      ? `<font color="${avgColor}">${formatDecimal(COMPARE, avgDiff)}</font>`
        + ` ${leftFluid ? 'HU/t' : 'EU/t'} average`
      : null;
    if (html.includes(pair) && (expectedDiff === null || html.includes(expectedDiff))
      && (expectedAvg === null || html.includes(expectedAvg))) {
      outputLines++;
    } else {
      failures.push(`${leftDesign.id}/${rightDesign.id}: postsim totals ${pair} and ${expectedDiff} `
        + `are not both in the label (got ${leftTotal}/${rightTotal}, diff ${diff})`);
    }
  }

  // Claim 3: the sentence names the unit each side runs in.
  if (leftFluid !== rightFluid) {
    fluidPairings++;
    const mixed = leftFluid ? ' HU / ' : ' EU / ';
    const other = leftFluid ? ' EU / ' : ' HU / ';
    if (!html.includes(mixed) || html.includes(other)) {
      failures.push(`${leftDesign.id}/${rightDesign.id}: a fluid/solid pair must read `
        + `"${mixed.trim()}", and only that: ${html}`);
    }
  }

  // The section order the desktop writes: prebreak, predeplete, postsim.
  const prebreakAt = html.indexOf(getI18n('Comparison.Prefix.PrebreakTime'));
  const predepleteAt = html.indexOf(getI18n('Comparison.Prefix.Predeplete'));
  const postsimAt = html.indexOf(getI18n('Comparison.Prefix.PostSimulation'));
  const order = [prebreakAt, predepleteAt, postsimAt].filter((at) => at >= 0);
  if (order.some((at, i) => i > 0 && at < order[i - 1])) {
    failures.push(`${leftDesign.id}/${rightDesign.id}: sections out of order: `
      + `prebreak=${prebreakAt} predeplete=${predepleteAt} postsim=${postsimAt}`);
  }
// Each section header is written once: a label that appears twice is a section the desktop does
// not have, and the count claim catches a mislabelled header the order claim cannot see.
for (const sectionKey of ['Prebreak', 'Predeplete', 'PostSimulation']) {
  const label = getI18n(`Comparison.Prefix.${sectionKey}`);
  if (occurrences(html, label) > 1) {
    failures.push(`${leftDesign.id}/${rightDesign.id}: the ${label.trim()} header appears `
      + `${occurrences(html, label)} times`);
  }
}

  // A run against itself, with the desktop's "only show differences" checkbox on, says nothing.
  const self = compareRuns({ data: left.data, reactor: left.reactor },
    { data: left.data, reactor: left.reactor }, { onlyShowDiff: true });
  assert(self.html === `<html><br>${getI18n('Comparison.NoDifferences')}</html>`,
    `${leftDesign.id}: a run compared to itself with the checkbox on must answer `
    + `${getI18n('Comparison.NoDifferences')} after the desktop's own gap, got ${self.html}`);

  checked++;
}

// ---------------------------------------------------------------------------
// The colour thresholds, pinned at the boundary
// ---------------------------------------------------------------------------

/** The corpus's output differences are all far past the desktop's thresholds, so the boundary gets
 * its own fixture: two records that differ only in what they produced. */
function outputFixture(total, avg) {
  const data = new SimulationData();
  const record = data.values();
  record.totalEUoutput = total;
  record.avgEUoutput = avg;
  record.minEUoutput = 0;
  record.maxEUoutput = 1;
  return data;
}

const blank = blankReactor(catalog);
for (const [leftTotal, rightTotal, leftAvg, rightAvg, expectedColor] of [
  [1500, 0, 0, 0, 'green'], [0, 1500, 0, 0, 'red'], [1750, 1000, 0, 2, 'orange'],
]) {
  const fixture = compareRuns({ data: outputFixture(leftTotal, leftAvg), reactor: blank },
    { data: outputFixture(rightTotal, rightAvg), reactor: blank }, { onlyShowDiff: false });
  assert(fixture.ok, 'a pair of fixtures must compare');
  const expected = `<font color="${expectedColor}">${formatDecimal(COMPARE, leftTotal - rightTotal)}</font>`;
  assert(fixture.html.includes(expected),
    `a total output difference of ${leftTotal - rightTotal} against the desktop's 1000 threshold reads `
    + `${expectedColor}, and the label says ${fixture.html}`);
}

// ---------------------------------------------------------------------------
// The predeplete half of the panel, and the max-temp rule's 15% boundary
// ---------------------------------------------------------------------------

/** No corpus pair reaches rod depletion, so the predeplete section gets its own fixture. */
function depletionFixture(depleteTime, total, avg, min, max, minTemp, maxTemp) {
  const data = new SimulationData();
  const record = data.values();
  record.firstRodDepletedTime = depleteTime;
  record.totalRodCount = 2;
  record.predepleteTotalEUoutput = total;
  record.predepleteAvgEUoutput = avg;
  record.predepleteMinEUoutput = min;
  record.predepleteMaxEUoutput = max;
  record.predepleteMinTemp = minTemp;
  record.predepleteMaxTemp = maxTemp;
  return data;
}

const predeplete = compareRuns(
  { data: depletionFixture(100, 1000, 300, 100, 900, 20, 9000), reactor: blank },
  { data: depletionFixture(200, 500, 100, 100, 900, 40, 5000), reactor: blank },
  { onlyShowDiff: false });
assert(predeplete.ok, 'a pair of fixtures must compare');
const preHtml = predeplete.html;
const preHeader = getI18n('Comparison.Prefix.Predeplete');
assert(occurrences(preHtml, preHeader) === 1,
  `a pair whose rods deplete prints the predeplete section exactly once, got ${preHtml}`);
assert(preHtml.includes(getI18n('Comparison.Prefix.PredepleteTime'))
  && preHtml.includes('(100/200)'),
  `the depletion time line names both runs' times, got ${preHtml}`);
assert(preHtml.includes(`(${formatDecimal(SIMPLE, 1000)}/${formatDecimal(SIMPLE, 500)})`),
  `the predeplete output line carries the pair the two records hold, got ${preHtml}`);
// One design ran within 15% of the reactor's ceiling and the other did not, so the desktop colours
// the two values rather than the difference, and the hotter side is the red one.
const ceiling = blank.getMaxHeat();
assert(9000 >= ceiling * 0.85 && 5000 < ceiling * 0.85, 'the fixture straddles the 15% ceiling rule');
assert(preHtml.includes(`<font color="red">${formatDecimal(SIMPLE, 9000)}</font>`)
  && preHtml.includes(`<font color="green">${formatDecimal(SIMPLE, 5000)}</font>`),
  `the max-temp line colours each side against its own ceiling, got ${preHtml}`);

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

const gate = compareRuns(null, null, {});
assert(!gate.ok && gate.message === getI18n('Comparison.Default'),
  `a page with one run answers ${getI18n('Comparison.Default')}, got ${gate.message}`);

const renderer = comparisonLines('<html>Reactor maximum temperature: '
  + '<font color="green">+12</font> (<font color="red">100</font>/58)<br><br>plain<br></html>');
assert(renderer.length === 3, 'the renderer keeps every `<br>`-separated line, including the empty one');
assert(renderer[0].runs.length === 5
  && renderer[0].runs[0].color === null && renderer[0].runs[0].text === 'Reactor maximum temperature: '
  && renderer[0].runs[1].color === 'green' && renderer[0].runs[1].text === '+12'
  && renderer[0].runs[3].color === 'red' && renderer[0].runs[3].text === '100',
  'the renderer splits the desktop\'s `<font color>` runs and keeps their colour words');
assert(renderer[1].runs.length === 0, 'an empty line stays empty rather than vanishing');
assert(renderer[2].runs.length === 1 && renderer[2].runs[0].color === null
  && renderer[2].runs[0].text === 'plain', 'plain text stays a plain run');

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

console.log(`pairs: ${checked} (${linesChecked} lines matched a bundle template, `
  + `${outputLines} postsim output lines carry their records' totals, `
  + `${fluidPairings} fluid/solid pairings)`);

for (const failure of failures.slice(0, 25)) console.log(failure);

if (failures.length > 0) {
  console.log(`\n${failures.length} problems`);
  process.exitCode = 1;
} else {
  console.log('comparison: every line is the bundle\'s, every figure is the run\'s');
}
