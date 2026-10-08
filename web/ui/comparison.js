/**
 * The `Compare` panel's two pieces of logic: the reactor a remembered code holds, and the desktop's
 * comparison HTML turned into elements.
 *
 * Both are DOM-free, like every other `ui/` helper. The first is the desktop's `tempReactor`
 * (`updateComparison` builds a fresh `Reactor` and calls `setCode(currentReactorCode)` rather than
 * reusing the simulated one, so the comparison reads a design's materials and max heat off a grid
 * the run never mutated). The second is the page's only piece of markup translation in the whole
 * app: the desktop's comparison label is one HTML string in a JLabel, and the two tags the bundle
 * ever emits -- `<br>` between lines and `<font color="…">` around a coloured run -- become a line
 * per row and a colour per run of text. Anything the bundle does not emit stays literal text.
 *
 * @see web/engine/comparison.js, src/Ic2ExpReactorPlanner/ReactorPlannerFrame.java:2774-3290
 */

import { blankReactor } from '../engine/reactor.js';
import { decodeCode } from '../engine/reactor-code.js';
import { codeDefaults } from '../engine/automation-simulator.js';

/**
 * The reactor a code holds, at rest -- the desktop's `tempReactor` / `prevReactor`.
 *
 * @param code a reactor code
 * @param catalog the parsed component catalog
 * @returns {Object} `{ ok: true, reactor }`, or `{ ok: false, message }` for a code the decoder
 *   rejects.
 */
export function designReactor(code, catalog) {
  const read = decodeCode(code, { defaults: codeDefaults(catalog) });
  if (!read.ok) return { ok: false, message: read.message };
  const reactor = blankReactor(catalog);
  reactor.placeDesign(read.design);
  return { ok: true, reactor };
}

/**
 * The desktop's comparison label as lines of coloured runs.
 *
 * @param html the string `engine/comparison.js#compareRuns` returns, `<html>` wrapper included
 * @returns {Array} one entry per `<br>`-separated line: `{ runs: [{ text, color }], text }`, where
 *   `color` is the bundle's own word (`green`, `red`, `orange`) or `null` for plain text. A line the
 *   desktop leaves empty stays an empty line, so the gap the desktop shows between sections survives.
 */
export function comparisonLines(html) {
  let body = html === null || html === undefined ? '' : String(html);
  if (body.startsWith('<html>')) body = body.slice('<html>'.length);
  if (body.endsWith('</html>')) body = body.slice(0, body.length - '</html>'.length);

  const raw = body.split('<br>');
  // `<br>` ends a line rather than starting a new one, which is how a JLabel reads it: the desktop's
  // label always closes with one, and the page does not add a blank row under it.
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  const lines = [];
  for (const rawLine of raw) {
    let color = null;
    const runs = [];
    let rest = rawLine;
    while (true) {
      const open = rest.indexOf('<font color="');
      if (open < 0) {
        if (rest !== '') runs.push({ text: rest, color });
        break;
      }
      if (open > 0) runs.push({ text: rest.slice(0, open), color });
      const closeQuote = rest.indexOf('"', open + '<font color="'.length);
      const tagEnd = closeQuote < 0 ? -1 : rest.indexOf('>', closeQuote);
      const close = rest.indexOf('</font>', open);
      if (tagEnd < 0 || close < 0 || close < tagEnd) {
        // An unbalanced tag is not something the bundle emits; keep it visible rather than eat it.
        runs.push({ text: rest.slice(open), color });
        break;
      }
      color = rest.slice(open + '<font color="'.length, closeQuote);
      const end = close + '</font>'.length;
      const inner = rest.slice(tagEnd + 1, close);
      if (inner !== '') runs.push({ text: inner, color });
      rest = rest.slice(end);
      color = null;
    }
    lines.push({ runs, text: rawLine.replace(/<[^>]*>/g, '') });
  }
  return lines;
}
