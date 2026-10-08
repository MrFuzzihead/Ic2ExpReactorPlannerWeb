/**
 * The reactor code's payload: one non-negative integer that every field is packed into and
 * unpacked out of, in reverse order.
 *
 * Ported from `BigintStorage.java`. Java uses `java.math.BigInteger`; JavaScript has native
 * `BigInt`, which is the same unbounded integer, so the arithmetic ports one-for-one.
 *
 * The two things that do NOT port one-for-one, and are handled explicitly below:
 *
 * 1. `BigInteger.toByteArray()` is *signed* two's-complement big-endian. For a non-negative
 *    value it emits the minimal big-endian bytes, with a leading 0x00 prepended whenever the
 *    top byte has its high bit set. Omitting that leading zero byte is not cosmetic: it changes
 *    the decoded value, so every field after the first one shifts. `toSignedBytes` reproduces
 *    the prepend, and `fromBase64` refuses a first byte >= 0x80 exactly as the original's
 *    `temp[0] < 0` check does -- that guard is what makes a hand-edited code fail loudly
 *    instead of decoding to a plausible-looking wrong reactor.
 *
 * 2. `Base64.getEncoder()`/`getDecoder()` are strict about the alphabet, the length and the
 *    padding. `atob` is not: it accepts some inputs Java rejects. Since a rejected code is a
 *    user-visible "this code is invalid" message and an accepted-but-wrong code is a silently
 *    wrong reactor, the decode here is written out rather than delegated to `atob`.
 *
 * @see data/bounds.js, engine/reactor-code.js
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const table = new Int16Array(128);
  table.fill(-1);
  for (let i = 0; i < 64; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Encodes bytes with the standard alphabet and '=' padding, no line breaks -- the same output
 * as Java's `Base64.getEncoder().encodeToString`.
 */
export function base64Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 < 0 ? 0 : (b1 >> 4))];
    out += b1 < 0 ? '=' : B64_ALPHABET[((b1 & 15) << 2) | (b2 < 0 ? 0 : (b2 >> 6))];
    out += b2 < 0 ? '=' : B64_ALPHABET[b2 & 63];
  }
  return out;
}

/**
 * Strict base64 -> bytes, matching what Java's `Base64.getDecoder()` accepts.
 *
 * It is NOT padding-mandatory: `AA`, `AAA` and `AAAAAA` all decode. What it does reject is a
 * final group of one character -- "Last unit does not have enough valid bits" -- which covers
 * both an unpadded length of 1 mod 4 and padding that leaves such a group behind. Matching this
 * exactly matters because `setCode` hands short pastes straight to this decoder.
 */
export function base64DecodeStrict(code) {
  const body = code.endsWith('==') ? code.slice(0, -2)
             : code.endsWith('=') ? code.slice(0, -1)
             : code;
  if (body.length % 4 === 1) {
    throw new TypeError(`Invalid base64: the final group of one character has no valid bits`);
  }
  const bytes = new Uint8Array((body.length * 6) >>> 3);
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < body.length; i++) {
    const sextet = B64_INDEX[body.charCodeAt(i)];
    if (sextet < 0) {
      throw new TypeError(`Invalid base64 character ${JSON.stringify(body[i])}`);
    }
    acc = (acc << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (acc >> bits) & 0xff; // big-endian: the high bits are the earlier byte
    }
  }
  return bytes;
}

/**
 * Non-negative BigInt -> Java's `BigInteger.toByteArray()`: minimal big-endian two's-complement
 * bytes, which means a leading 0x00 whenever the top byte would otherwise read as negative.
 */
function toSignedBytes(value) {
  if (value === 0n) return new Uint8Array([0]); // Java emits one zero byte for zero
  const out = [];
  let x = value;
  while (x > 0n) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  out.reverse();
  if ((out[0] & 0x80) !== 0) out.unshift(0);
  return new Uint8Array(out);
}

/** Unsigned big-endian bytes -> non-negative BigInt (the inverse of the payload read). */
function bytesToUnsignedBigInt(bytes) {
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value;
}

export class BigintStorage {
  /** @type {BigInt} the packed payload; grows on `store`, shrinks on `extract`. */
  #storedValue = 0n;

  /**
   * Packs one more field onto the payload.
   * @param value the field's value
   * @param max   the field's bound; the radix used is max + 1
   * @throws {RangeError} when value is negative or above max -- Java throws
   *         IllegalArgumentException with the same wording.
   */
  store(value, max) {
    const v = BigInt(value);
    const m = BigInt(max);
    if (v < 0n || v > m) {
      throw new RangeError(`Cannot store a value of ${v} with a maximum value of ${m}`);
    }
    this.#storedValue = this.#storedValue * (m + 1n) + v;
  }

  /**
   * Unpacks the most recently stored field.
   * @param max must be the bound `store` used for this field, or every remaining field shifts
   * @returns {BigInt} the field's value
   */
  extract(max) {
    const m = BigInt(max) + 1n;
    const value = this.#storedValue % m;
    this.#storedValue = this.#storedValue / m; // BigInt division truncates toward zero
    return value;
  }

  /** @returns {BigInt} the payload, for tests that want to inspect it. */
  peek() {
    return this.#storedValue;
  }

  /**
   * Reads a code's payload.
   * @param code base64, without the `erp=` prefix
   * @throws {TypeError} on malformed base64, or on a payload whose top byte has the sign bit
   *         set -- Java's `temp[0] < 0` guard, which is what stops a corrupted code from
   *         decoding into a plausible but wrong reactor.
   */
  static inputBase64(code) {
    const bytes = base64DecodeStrict(code);
    // Java builds the BigInteger from these bytes, and `new BigInteger(byte[])` rejects an empty
    // array with "Zero length BigInteger". That is what makes a bare `erp=` a refusal rather than
    // an all-zero design.
    if (bytes.length === 0) {
      throw new TypeError('Zero length BigInteger');
    }
    if (bytes[0] >= 0x80) {
      throw new TypeError('Cannot read a negative payload');
    }
    return new BigintStorage(bytesToUnsignedBigInt(bytes));
  }

  /** @returns {String} the payload as base64, ready to be prefixed with `erp=`. */
  outputBase64() {
    return base64Encode(toSignedBytes(this.#storedValue));
  }

  /**
   * @param initialPayload {BigInt|number} starting payload (used by `inputBase64`).
   */
  constructor(initialPayload = 0n) {
    this.#storedValue = BigInt(initialPayload);
  }
}
