/**
 * Compares the JS formatter ports against the oracle probe output produced by the real JDK
 * (`FormatProbe.java`, `DecimalProbe.java`, `NotationProbe.java` in ../erp-java-ref/src).
 *
 * Run: node test/format-oracle.mjs
 */
import { formatDecimal, javaDoubleToString, stringFormat } from '../web/engine/format.js';
import { readFileSync } from 'node:fs';

const PLAIN = '#,##0.##';
const COMPARE = '+#,##0.##;-#';

let checks = 0;
let bad = 0;
function check(label, got, want) {
  checks++;
  if (got === want) return;
  bad++;
  if (bad <= 40) console.log(`MISMATCH ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// --- DecimalProbe: both DecimalFormat patterns, plus the raw Double.toString ---------------
for (const line of readFileSync('../erp-java-ref/probe/decimal-probe.txt', 'utf8').split('\n')) {
  const m = line.match(/^(\S+) simple=\[(.*?)\] compare=\[(.*?)\] raw=\[(.*?)\]$/);
  if (!m) continue;
  const v = Number(m[1]);
  check(`DF ${m[1]}`, formatDecimal(PLAIN, v), m[2]);
  check(`CMP ${m[1]}`, formatDecimal(COMPARE, v), m[3]);
  check(`raw ${m[1]}`, formatDecimal(PLAIN, v).replace(/,/g, ''), m[4]);
}

// --- FormatProbe: String.format and DecimalFormat side by side -----------------------------
const formatText = readFileSync('../erp-java-ref/probe/format-probe.txt', 'utf8');
const FORMATTERS = {
  DF: (v) => formatDecimal(PLAIN, v),
  CMP: (v) => formatDecimal(COMPARE, v),
  '%,.2f': (v) => stringFormat('%,.2f', v),
  '%,.0f': (v) => stringFormat('%,.0f', v),
  '%.2f': (v) => stringFormat('%.2f', v),
  '%.0f': (v) => stringFormat('%.0f', v),
  '%s': (v) => stringFormat('%s', v),
  '%d': (v) => stringFormat('%d', v),
  '%,d': (v) => stringFormat('%,d', v),
};
for (const block of formatText.split('--------\n')[0].split(/(?=^[vi]=)/m)) {
  const head = block.match(/^[vi]=(\S+)/m);
  if (!head) continue;
  const v = Number(head[1]);
  for (const row of block.match(/^  (\S+) +\|(.*)\|$/gm) ?? []) {
    const [, label, want] = row;
    const fn = FORMATTERS[label];
    if (fn === undefined) continue; // the `... DEF` platform-locale rows
    check(`${label} ${head[1]}`, fn(v), want);
  }
}

// --- FormatProbe tail: sentinels and out-of-range magnitudes --------------------------------
const SENTINELS = {
  huge: Infinity,
  nan: NaN,
  max: 1.7976931348623157e308,
  '-0': -0.0,
  big: 1e20,
  '1e20': 1e20,
};
for (const row of (formatText.split(/(?=^DF huge )/m)[1] ?? '').match(/^(\S+) +\|(.*)\|$/gm) ?? []) {
  const [, label, want] = row;
  if (!Object.hasOwn(SENTINELS, label)) continue;
  const v = SENTINELS[label];
  const isStringFormat = label === '1e20';
  check(`tail ${label}`, isStringFormat ? stringFormat('%,.0f', v) : formatDecimal(PLAIN, v), want);
}

// --- NotationProbe: Double.toString and %.6f across every exponent / digit count -----------
for (const line of readFileSync('../erp-java-ref/probe/notation2.txt', 'utf8').split('\n')) {
  const m = line.match(/^(\S+ )?e=(-?\d+) d=(\d+) \|(.*?)\| \|(.*?)\|$/);
  if (!m) continue;
  const v = Number(m[4]); // the text Java printed, read back as the double it came from
  check(`notation ${m[0]}`, javaDoubleToString(v), m[4]);
  check(`%.6f ${m[0]}`, stringFormat('%.6f', v), m[5]);
}

console.log(`${checks} checks, ${bad} mismatches`);
