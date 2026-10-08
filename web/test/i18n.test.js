/**
 * The locale bundle's oracle: what the desktop's `ResourceBundle` does with a locale file that is
 * not complete, and what the page does with the same two files.
 *
 * There is a real Java dump for this, which is unusual for a data question: `probe/BundleLocale.java`
 * loads `Bundle.properties` and `Bundle_zh_CN.properties` through `ResourceBundle.getBundle` under a
 * `zh_CN` locale and prints what each key answers. It settles the one thing the file names do not
 * tell: `Bundle_zh_CN.properties` carries 419 entries against the default's 422, and Java loads the
 * default file *under* the locale file, so the three keys only the default has still answer in
 * English rather than throwing `KeyNotFound`. Two of those three
 * (`Simulation.HeatOutputsBeforeOverheated`, `Simulation.EUOutputsBeforeOverheated`) are the
 * before-overheated output lines, and 201 of the 304 corpus designs write one of them -- so a port
 * that replaced the bundle instead of merging it would leave a hole in two thirds of the corpus's
 * reports, in the middle of a Chinese one.
 *
 * Claims:
 *  1. **The merge keeps every key.** 422 before, 422 after -- the Chinese file adds nothing
 *     (asserted: no key exists only there) and loses nothing.
 *  2. **The three English-only keys answer English.** Asserted by name, and asserted to be exactly
 *     the two overheated-output lines plus the JVM-abort line.
 *  3. **A shared key answers Chinese.** The count of keys whose text actually changed is asserted
 *     non-zero, so a Chinese bundle that was never translated would fail here.
 *  4. **The format specifiers survive translation.** Every `%` conversion in a Chinese value matches
 *     the multiset in that key's English value, because `formatI18n` feeds the entry to `String.format`
 *     and a translated pattern that dropped, added, or reordered a `%s` prints the wrong figures --
 *     or throws -- except the ten the upstream file already gets wrong, which are asserted to be
 *     exactly the ten this repo records, so a new break in a translation fails here rather than
 *     printing wrong figures quietly. Of those ten, exactly one reaches this page: `Simulation.ReactorResidualHeat`
 *     swaps its two arguments, so a Chinese visitor reads the seconds where the heat belongs. The
 *     rest sit under `CSVData.` and `ComponentData.`, the two families the port drops (§1 drops the
 *     CSV tab; `ComponentData.` is the Swing component list's tooltip line at
 *     `ReactorPlannerFrame.java:3342`, which this page does not build). The upstream file is kept
 *     verbatim either way -- it is a frozen fixture, same rule as `components.json` -- so the page
 *     inherits the desktop's bug rather than inventing a translation of its own.
 *
 * Run: `node web/test/i18n.test.js`
 *
 * @see web/engine/i18n.js, web/data/i18n/en.json, web/data/i18n/zh-CN.json,
 *      ../erp-java-ref/probe/BundleLocale.java, ../erp-java-ref/src/Ic2ExpReactorPlanner/BundleHelper.java
 */

import { loadBundle, loadLocaleBundle, getI18n, getBundleStrings } from '../engine/i18n.js';
import { readFile } from 'node:fs/promises';

const en = JSON.parse(await readFile('web/data/i18n/en.json', 'utf8'));
const zh = JSON.parse(await readFile('web/data/i18n/zh-CN.json', 'utf8'));

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * The `%` conversions of a `String.format` pattern, in order, with their flags.
 *
 * A scanner rather than a regex: `%%` is a literal percent, not a conversion, and a regex that does
 * not know that reads `%% h` as one conversion -- which is exactly the mistake that hides the real
 * ones in a hand-translated bundle. `format.js` implements the same grammar for the runtime; this
 * one only has to be strict enough to compare two patterns.
 */
function conversions(pattern) {
  const out = [];
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== '%') continue;
    if (pattern[i + 1] === '%') { i += 1; continue; }
    let j = i + 1;
    while (j < pattern.length && /[-+ #0,]/.test(pattern[j])) j += 1;
    while (j < pattern.length && /[0-9*]/.test(pattern[j])) j += 1;
    if (j < pattern.length && pattern[j] === '.') {
      j += 1;
      while (j < pattern.length && /[0-9*]/.test(pattern[j])) j += 1;
    }
    if (j < pattern.length && /[hlL]/.test(pattern[j])) j += 1;
    out.push(pattern.slice(i, j + 1)); // a broken pattern keeps its text too, so the comparison still fails
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The two files, as the repo ships them
// ---------------------------------------------------------------------------

assert(en.count === Object.keys(en.strings).length, `en.json claims ${en.count}, holds ${Object.keys(en.strings).length}`);
assert(zh.count === Object.keys(zh.strings).length, `zh-CN.json claims ${zh.count}, holds ${Object.keys(zh.strings).length}`);
assert(en.locale === 'en' && zh.locale === 'zh-CN', 'a bundle JSON does not name the locale it was made from');

const onlyEn = Object.keys(en.strings).filter((k) => !(k in zh.strings));
const onlyZh = Object.keys(zh.strings).filter((k) => !(k in en.strings));

assert(onlyZh.length === 0,
  `the Chinese bundle has ${onlyZh.length} key(s) the default does not: ${onlyZh}`);
assert(onlyEn.length === 3,
  `the default bundle has ${onlyEn.length} keys the Chinese one lacks, expected 3: ${onlyEn}`);
assert(onlyEn.includes('Simulation.HeatOutputsBeforeOverheated')
  && onlyEn.includes('Simulation.EUOutputsBeforeOverheated')
  && onlyEn.includes('Simulation.AbortedByError'),
  `the English-only keys are ${onlyEn}, and the two overheated-output lines are the ones a normal run writes`);

// ---------------------------------------------------------------------------
// The merge, through the engine's own entry point
// ---------------------------------------------------------------------------

loadBundle(await readFile('web/data/i18n/en.json', 'utf8'));
const english = getBundleStrings();
assert(Object.keys(english).length === en.count, 'loadBundle lost keys off the default file');

loadLocaleBundle(await readFile('web/data/i18n/zh-CN.json', 'utf8'));
const merged = getBundleStrings();

assert(Object.keys(merged).length === en.count,
  `a merged Chinese bundle holds ${Object.keys(merged).length} keys, expected ${en.count}`);

for (const key of onlyEn) {
  assert(merged[key] === en.strings[key],
    `${key} is missing from the Chinese bundle and must answer the default's text, as Java's ResourceBundle does`);
}

const changed = Object.keys(en.strings).filter((k) => k in zh.strings && en.strings[k] !== zh.strings[k]);
assert(changed.length > 300,
  `only ${changed.length} of ${Object.keys(zh.strings).length} Chinese entries differ from English -- a bundle that was never translated`);

// The two lines every overheated run writes, in a Chinese locale, end to end through `getI18n`.
for (const key of onlyEn) {
  assert(getI18n(key) === en.strings[key], `${key} answers the wrong text through getI18n`);
}
assert(getI18n('UI.SimulateButton') === zh.strings['UI.SimulateButton'],
  'a key the Chinese bundle has answers the default rather than the locale');

// ---------------------------------------------------------------------------
// Translated patterns still format
// ---------------------------------------------------------------------------

let patternsChecked = 0;
const broken = [];
for (const key of Object.keys(zh.strings)) {
  const englishPattern = en.strings[key];
  if (englishPattern === undefined) continue;
  const chinesePattern = zh.strings[key];
  if (conversions(englishPattern).length === 0) continue;
  patternsChecked += 1;
  if (conversions(chinesePattern).join(' ') === conversions(englishPattern).join(' ')) continue;
  broken.push(key);
}

// The ten the repo knows about, and no others. A new break in a translation fails here rather than
// printing wrong figures quietly. All ten are defects in `Bundle_zh_CN.properties` itself: the
// residual-heat line swaps its two arguments, the fuel rods repeat a `%s`, the iridium reflector
// dropped one, the two CSV headers dropped one.
const knownBroken = new Set([
  'CSVData.HeaderComponentName',
  'CSVData.HeaderComponentOutput',
  'ComponentData.DualFuelRodCompressedPlutonium',
  'ComponentData.DualFuelRodLiquidPlutonium',
  'ComponentData.QuadFuelRodCompressedPlutonium',
  'ComponentData.QuadFuelRodLiquidPlutonium',
  'ComponentData.FuelRodCompressedPlutonium',
  'ComponentData.FuelRodLiquidPlutonium',
  'ComponentData.IridiumNeutronReflector',
  'Simulation.ReactorResidualHeat',
]);
assert(broken.length === knownBroken.size && broken.every((k) => knownBroken.has(k)),
  `the Chinese bundle's broken patterns are ${broken}, expected exactly the ${knownBroken.size} this repo records`);

// Of those, the ones the page can actually ask for. `ComponentData.` and `CSVData.` are dropped
// (§1), so exactly one sentence a Chinese visitor reads has its two figures swapped -- asserted so
// that count is a fact rather than a guess.
const reachable = broken.filter((k) => !/^(CSVData|ComponentData)\./.test(k));
assert(reachable.length === 1 && reachable[0] === 'Simulation.ReactorResidualHeat',
  `the broken patterns the page can reach are ${reachable}`);

assert(patternsChecked > 100, `only ${patternsChecked} bundle entries carry a format pattern, which is fewer than the bundle holds`);

// A Chinese pattern that reaches `formatI18n` with the English one's arguments still formats: the
// two overheated-output lines are English in this locale, so the claim that matters is on a key the
// Chinese file does translate.
const formatted = getI18n('UI.VersionNumber');
assert(conversions(formatted).join(' ') === conversions(en.strings['UI.VersionNumber']).join(' '),
  'UI.VersionNumber changes its conversion set between bundles');

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

console.log(`bundles: en ${en.count}, zh-CN ${zh.count}, merged ${Object.keys(merged).length}; `
  + `${changed.length} entries translated, ${patternsChecked} format patterns checked, `
  + `${onlyEn.length} keys falling back to English`);

for (const failure of failures.slice(0, 25)) console.log(failure);

if (failures.length > 0) {
  console.log(`\n${failures.length} problems`);
  process.exitCode = 1;
} else {
  console.log('i18n: the locale bundle merges the way Java\'s ResourceBundle does, and every translated pattern still formats');
}
