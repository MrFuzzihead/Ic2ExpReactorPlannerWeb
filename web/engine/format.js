/**
 * The two JDK formatting classes the report path depends on.
 *
 * `java.text.DecimalFormat` and `java.util.String.format` do *not* agree on ties, and neither
 * agrees with JS's `Number.toFixed`, so both are ported explicitly rather than approximated.
 * The ground truth is the oracle probe (`FormatProbe`, `DecimalProbe`):
 *
 *   - `String.format("%.2f", 0.125)` -> `0.13`, `String.format("%.2f", 0.015)` -> `0.02`
 *     -- half-**up** on the shortest round-trip *decimal* text (what `Double.toString` prints)
 *   - `new DecimalFormat("#,##0.##").format(0.125)` -> `0.12`, `.format(0.015)` -> `0.01`
 *     -- half-**even** on the exact *binary* value
 *
 * The split is load-bearing: the report body prints its figures through `DecimalFormat` while
 * the bundle strings carry `%,.0f` / `%,.2f`, and a design that lands on a tie prints
 * differently in the two places.
 *
 * Locale: `BundleHelper.formatI18n` calls `String.format` with the platform locale, and the
 * committed baseline was generated on this machine (en-US), so `,` grouping and `.` decimal
 * are the working assumption. `CorpusRunner.fmt` pins `Locale.US` for the baseline line itself.
 *
 * @see ../erp-java-ref/src/FormatProbe.java, ../erp-java-ref/src/DecimalProbe.java
 */

// --- java.text.DecimalFormat --------------------------------------------------------------

/**
 * The subset of ICU number patterns the planner asks for: `#,##0.##`
 * (`Simulation.DecimalFormat`, `UI.MaterialDecimalFormat`, `Comparison.SimpleDecimalFormat`)
 * and `+#,##0.##;-#` (`Comparison.CompareDecimalFormat`).
 *
 * A `positive;negative` pattern's negative half carries only a sign here: ICU applies it to the
 * positive half's digit specification, which the probe confirms -- `-#` still prints
 * `-1,234.57` with grouping and two fraction digits. So a pattern is one digit spec plus two
 * sign prefixes.
 */
export function parseDecimalPattern(pattern) {
  let positive = pattern;
  let negative = null;
  const semi = pattern.indexOf(';');
  if (semi >= 0) {
    positive = pattern.slice(0, semi);
    negative = pattern.slice(semi + 1);
  }
  const prefixEnd = [...positive].findIndex((c) => '#0,.'.includes(c));
  const digits = prefixEnd < 0 ? '' : positive.slice(prefixEnd);
  const fractionStart = digits.indexOf('.');
  const integerPart = fractionStart < 0 ? digits : digits.slice(0, fractionStart);
  const fractionPart = fractionStart < 0 ? '' : digits.slice(fractionStart + 1);
  return {
    positivePrefix: prefixEnd < 0 ? positive : positive.slice(0, prefixEnd),
    negativePrefix: negative !== null && negative.length > 0 ? negative[0] : '-',
    grouping: integerPart.includes(','),
    maxFractionDigits: fractionPart.length,
    // `0` is a mandatory digit, `#` an optional one, and the mandatory ones come first.
    minFractionDigits: [...fractionPart].filter((c) => c === '0').length,
  };
}

/**
 * The exact decimal value of a finite double as `{ digits, scale }`, meaning
 * `digits / 10^scale` with no rounding.
 *
 * A double is `significand * 2^exp`, and `2^-k` is `5^k / 10^k`, so the exact expansion has
 * at most `-exp` fraction digits. This is what `DecimalFormat` rounds against, and it is why
 * `0.015` (really `0.01499999999999999944`) rounds *down* at two digits while `0.025`
 * (really `0.025000000000000000555`) rounds up.
 */
function exactDecimal(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const hi = view.getUint32(0, false);
  const lo = view.getUint32(4, false);
  const sign = (hi >>> 31) === 1 ? -1 : 1;
  const expBits = (hi >>> 20) & 0x7ff;
  if (expBits === 0x7ff) return null; // NaN / infinity
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let significand;
  let exp;
  if (expBits === 0) {
    significand = frac;
    exp = -1074;
  } else {
    significand = (1n << 52n) | frac;
    exp = Number(expBits) - 1075;
  }
  if (exp >= 0) return { sign, digits: significand << BigInt(exp), scale: 0 };
  const k = -exp;
  return { sign, digits: significand * 5n ** BigInt(k), scale: k };
}

/** Round `digits / 10^scale` to `places` fraction digits, half-to-even. */
function roundHalfEven(digits, scale, places) {
  if (scale <= places) return digits * 10n ** BigInt(places - scale);
  const divisor = 10n ** BigInt(scale - places);
  let q = digits / divisor;
  const r = digits % divisor;
  const twice = r * 2n;
  if (twice > divisor || (twice === divisor && (q & 1n) === 1n)) q += 1n;
  return q;
}

/**
 * @param pattern a `java.text.DecimalFormat` pattern
 * @param value the number to format
 * @returns {String} the formatted text
 */
export function formatDecimal(pattern, value) {
  const spec = parseDecimalPattern(pattern);
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  const negative = isNegative(value);
  const exact = exactDecimal(Math.abs(value));
  if (exact === null) return '?';
  const rounded = roundHalfEven(exact.digits, exact.scale, spec.maxFractionDigits);
  const asText = rounded.toString().padStart(spec.maxFractionDigits + 1, '0');
  const split = asText.length - spec.maxFractionDigits;
  let integerPart = asText.slice(0, split);
  let fractionPart = asText.slice(split);
  while (fractionPart.length > spec.minFractionDigits && fractionPart.endsWith('0')) {
    fractionPart = fractionPart.slice(0, -1);
  }
  integerPart = integerPart.replace(/^0+(?=\d)/, '');
  if (spec.grouping) {
    let grouped = '';
    for (let i = 0; i < integerPart.length; i++) {
      if (i > 0 && (integerPart.length - i) % 3 === 0) grouped += ',';
      grouped += integerPart[i];
    }
    integerPart = grouped;
  }
  const body = integerPart + (fractionPart.length === 0 ? '' : '.' + fractionPart);
  return (negative ? spec.negativePrefix : spec.positivePrefix) + body;
}

/** The sign of `-0.0`, which is what makes `DecimalFormat` print `-0` for a rounded-away negative. */
function isNegative(value) {
  return value < 0 || (value === 0 && Number.MIN_VALUE / value < 0);
}

// --- java.util.String.format --------------------------------------------------------------

/**
 * Java's `Double.toString`, which is what `%s` of a `Double` produces.
 *
 * The digits are the shortest that round-trip -- the same digits JS produces -- but the two
 * switch between plain and exponential notation at different magnitudes. Java uses plain
 * notation exactly when the count of digits before the decimal point (`eee`) is in [-2, 7]:
 * `0.001` plain, `0.0001` exponential, `1111111.1111` plain, `1.1111111111E7` exponential.
 * JS switches at 1e-7 and 1e21, so the rule is re-implemented rather than inherited.
 */
export function javaDoubleToString(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  const negative = isNegative(value);
  const magnitude = Math.abs(value);
  if (magnitude === 0) return (negative ? '-' : '') + '0.0';
  const { digits, eee } = readShortest(magnitude);
  let body;
  if (eee >= -2 && eee <= 7) {
    if (eee <= 0) body = '0.' + '0'.repeat(-eee) + digits;
    else if (eee >= digits.length) body = digits + '0'.repeat(eee - digits.length) + '.0';
    else body = digits.slice(0, eee) + '.' + digits.slice(eee);
  } else {
    const mantissa = digits[0] + '.' + (digits.length > 1 ? digits.slice(1) : '0');
    body = mantissa + 'E' + (eee - 1);
  }
  return (negative ? '-' : '') + body;
}

/** The shortest round-trip digits of a positive double, as `{ digits, eee }` with value = 0.digits * 10^eee. */
function readShortest(magnitude) {
  const text = String(magnitude); // JS's shortest round-trip form
  const eAt = text.indexOf('e');
  const mantissa = eAt < 0 ? text : text.slice(0, eAt);
  const powerOfTen = eAt < 0 ? 0 : Number(text.slice(eAt + 1));
  const dot = mantissa.indexOf('.');
  const allDigits = dot < 0 ? mantissa : mantissa.slice(0, dot) + mantissa.slice(dot + 1);
  const fractionDigits = dot < 0 ? 0 : mantissa.length - dot - 1;
  // Java prints the shortest digits that round-trip, so the zeros JS leaves on either end are
  // not significant digits: `1e15` is `1.0E15`, not `1.000000000000000E15`.
  const withoutLeadingZeros = allDigits.replace(/^0+/, '');
  const digits = withoutLeadingZeros.replace(/0+$/, '');
  const trailingZeros = withoutLeadingZeros.length - digits.length;
  if (digits === '') return { digits: '0', eee: 1 };
  const eee = digits.length + powerOfTen - fractionDigits + trailingZeros;
  return { digits, eee };
}

/** Round the shortest digits half-**up** at `precision` fraction digits, fixed notation. */
function roundFixedUp(digits, eee, precision) {
  let intPart;
  let fracPart;
  if (eee <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-eee) + digits;
  } else if (eee >= digits.length) {
    intPart = digits + '0'.repeat(eee - digits.length);
    fracPart = '';
  } else {
    intPart = digits.slice(0, eee);
    fracPart = digits.slice(eee);
  }
  const keep = fracPart.slice(0, precision).padEnd(precision, '0');
  const next = fracPart.length > precision ? fracPart[precision] : '0';
  if (next < '5') return { intPart, fracPart: keep };
  // Half-up: the first dropped digit being >= 5 is exactly "at least a half", since anything
  // from .5 upward rounds away from zero.
  const carried = keep.split('');
  let carry = 1;
  for (let i = carried.length - 1; i >= 0 && carry === 1; i--) {
    const d = carried[i].codePointAt(0) - 48 + carry;
    carried[i] = String.fromCodePoint(48 + (d % 10));
    carry = d >= 10 ? 1 : 0;
  }
  if (carry === 1) intPart = addOne(intPart);
  return { intPart, fracPart: carried.join('') };
}

function addOne(digits) {
  let i = digits.length - 1;
  const out = digits.split('');
  while (i >= 0) {
    const d = out[i].codePointAt(0) - 48 + 1;
    out[i] = String.fromCodePoint(48 + (d % 10));
    if (d < 10) return out.join('');
    i--;
  }
  return '1' + out.join('');
}

function groupThousands(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * The `String.format` subset the planner's bundle strings and test code use: `%s`, `%d`,
 * `%x`, `%f`, with the `,` (grouping), `+`, `0` (zero-pad), `-` (left-justify) flags, a width,
 * and a `.precision`. `%%` is a literal percent.
 *
 * `%s` of a `Double` goes through `javaDoubleToString`; `%s` of an `int` is plain digits, which
 * is why `UI.InitialHeatDisplay`'s `%,d` and `Simulation.ActiveTime`'s `%s` disagree on
 * thousands separators.
 */
export function stringFormat(format, ...args) {
  const out = [];
  let at = 0;
  let argIndex = 0;
  while (at < format.length) {
    const c = format[at];
    if (c !== '%') {
      out.push(c);
      at++;
      continue;
    }
    at++;
    if (at < format.length && format[at] === '%') {
      out.push('%');
      at++;
      continue;
    }
    let positional = '';
    while (at < format.length && format[at] >= '1' && format[at] <= '9') {
      positional += format[at++];
    }
    let grouping = false;
    let plusSign = false;
    let zeroPad = false;
    let leftJustify = false;
    while (at < format.length && '+- 0,#'.includes(format[at])) {
      switch (format[at]) {
        case ',': grouping = true; break;
        case '+': plusSign = true; break;
        case '0': zeroPad = true; break;
        case '-': leftJustify = true; break;
        default: break;
      }
      at++;
    }
    let width = '';
    while (at < format.length && format[at] >= '0' && format[at] <= '9') width += format[at++];
    let precision = -1;
    if (at < format.length && format[at] === '.') {
      at++;
      const digits = width;
      width = '';
      precision = 0;
      while (at < format.length && format[at] >= '0' && format[at] <= '9') {
        precision = precision * 10 + (format[at].codePointAt(0) - 48);
        at++;
      }
      width = digits;
    }
    if (at >= format.length) throw new SyntaxError(`incomplete format specifier in ${format}`);
    const type = format[at++];
    const arg = args[positional === '' ? argIndex++ : Number(positional) - 1];
    out.push(padTo(renderSpecifier(type, arg, grouping, plusSign, precision), Number(width), zeroPad));
  }
  return out.join('');
}

function renderSpecifier(type, arg, grouping, plusSign, precision) {
  switch (type) {
    case 's':
      if (typeof arg === 'string') return arg;
      if (Number.isInteger(arg)) return String(arg);
      return javaDoubleToString(arg);
    case 'd':
    case 'i': {
      const value = Math.trunc(Number(arg));
      const magnitude = groupThousands(String(Math.abs(value)));
      const body = grouping ? magnitude : String(Math.abs(value));
      return signFor(value, plusSign) + body;
    }
    case 'x': {
      const value = Math.trunc(Number(arg));
      const body = Math.abs(value).toString(16);
      return signFor(value, plusSign) + body;
    }
    case 'f': {
      const value = Number(arg);
      if (Number.isNaN(value)) return 'NaN';
      if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
      const negative = isNegative(value);
      const magnitude = Math.abs(value);
      const { digits, eee } = readShortest(magnitude);
      const { intPart, fracPart } = roundFixedUp(digits, eee, precision);
      const body = (grouping ? groupThousands(intPart) : intPart) + (precision > 0 ? '.' + fracPart : '');
      return signFor(negative ? -1 : 1, plusSign) + body;
    }
    default:
      throw new SyntaxError(`unsupported format specifier %${type}`);
  }
}

function signFor(value, plusSign) {
  if (value < 0) return '-';
  return plusSign ? '+' : '';
}

/** Width padding. `zeroPad` fills after the sign, which is how `%02x` prints a byte. */
function padTo(text, width, zeroPad) {
  if (width === 0 || text.length >= width) return text;
  const fill = width - text.length;
  if (!zeroPad) return ' '.repeat(fill) + text;
  const signed = text.startsWith('-') || text.startsWith('+');
  if (!signed) return '0'.repeat(fill) + text;
  return text[0] + '0'.repeat(fill) + text.slice(1);
}
