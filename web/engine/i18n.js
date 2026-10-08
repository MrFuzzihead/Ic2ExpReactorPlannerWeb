/**
 * The planner's resource bundle, and the two `BundleHelper` entry points.
 *
 * `Bundle.properties` becomes `data/i18n/en.json` (see `tools/properties-to-json.mjs`), which
 * keeps the keys verbatim so a report diff does not depend on a renaming. The bundle is
 * module-level state rather than a parameter because `BundleHelper`'s is too: every call site in
 * `AutomationSimulator` reads `getI18n(...)` / `formatI18n(...)` with no bundle argument, and
 * threading one through the tick loop would be a rewrite with no upside.
 *
 * `formatI18n` is `String.format(getI18n(key), args)`, so it inherits the `String.format`
 * semantics pinned in `format.js` -- notably that `%s` of a `Double` prints Java's own notation,
 * which is why `Simulation.ActiveTime`'s `%s` and `UI.InitialHeatDisplay`'s `%,d` disagree on
 * thousands separators.
 *
 * @see ../erp-java-ref/src/BundleHelper.java, ../erp-java-ref/src/I18nPeek.java
 */

import { stringFormat } from './format.js';

let strings = null;

/**
 * Loads a bundle. Called once at startup by the app, and once per test process.
 *
 * @param text the JSON text of `data/i18n/en.json`
 */
export function loadBundle(text) {
  const parsed = JSON.parse(text);
  strings = parsed.strings ?? parsed;
  return strings;
}

/**
 * Selects a locale bundle over the default one, the way `ResourceBundle` does.
 *
 * The desktop ships two files -- `Bundle.properties` (422 entries) and `Bundle_zh_CN.properties`
 * (419) -- and `BundleHelper.java:11` picks one by the system locale. The Chinese file is not
 * complete: three keys exist only in English, two of them (`Simulation.HeatOutputsBeforeOverheated`,
 * `Simulation.EUOutputsBeforeOverheated`) on the report path 201 of the 304 corpus designs take --
 * the before-overheated output lines, which a run writes whenever it recorded any output at all.
 * `probe/BundleLocale.java` settles what Java then does -- it loads the default file first and the
 * locale file over it, so those three keys still read English in a Chinese locale rather than
 * throwing `KeyNotFound`. The web port keeps the same rule, which is why this merges rather than
 * replaces: a page that replaced would leave a hole in two thirds of the corpus's reports.
 *
 * @param text the JSON text of a locale bundle, `data/i18n/zh-CN.json`
 * @returns {Object} the merged map
 */
export function loadLocaleBundle(text) {
  if (strings === null) throw new Error('no default bundle loaded; call loadBundle first');
  const parsed = JSON.parse(text);
  const locale = parsed.strings ?? parsed;
  const merged = Object.assign({}, strings, locale);
  strings = merged;
  return strings;
}

export function setBundle(map) {
  strings = map;
  return map;
}

/** @returns {String} the bundle entry for `key`, throwing rather than printing `undefined`. */
export function getI18n(key) {
  if (strings === null) throw new Error('no i18n bundle loaded; call loadBundle first');
  if (!Object.hasOwn(strings, key)) {
    throw new Error(`bundle key missing: ${key}`);
  }
  return strings[key];
}

/**
 * @param key a bundle key whose value is a `String.format` pattern
 * @param args the arguments for that pattern
 * @returns {String} the formatted text
 */
export function formatI18n(key, ...args) {
  return stringFormat(getI18n(key), ...args);
}

/**
 * A bundle entry the desktop renders as a *label* rather than as text. Three keys carry a Java
 * label wrapper -- `Config.ReplacementThresholdHelp`, `Config.ReactorPauseHelp`, `UI.CSVHelp` --
 * which is Swing's markup instruction, not part of the sentence. A `<div>` prints those tags as
 * words, so the page asks for its labels through this rather than through `getI18n`.
 *
 * @param key a bundle key
 * @returns {String} the entry with the wrapper taken off, and the entry itself when it has none
 */
export function getLabel(key) {
  const text = getI18n(key);
  return text.startsWith('<html>') && text.endsWith('</html>') ? text.slice(6, -7) : text;
}

export function getBundleStrings() {
  return strings;
}
