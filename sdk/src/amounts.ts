/**
 * Amount conversions between human token amounts and on-chain base units.
 *
 * 1 token = 1e18 base units. All money READ from the contract comes back as a
 * base-unit integer string; all money sent IN is a base-unit bigint. These
 * helpers are the bridge, and are pure (no dependencies, no floating point for
 * the integer path).
 */

import { DECIMALS } from "./constants.js";

/**
 * Convert a human token amount to base units (bigint).
 *
 * Accepts a decimal string (preferred, lossless) or a `number`. Numbers are
 * convenient but lossy for large or high-precision values — pass a string when
 * precision matters. More than `decimals` fractional digits throws rather than
 * silently truncating.
 *
 * @example
 *   toBaseUnits("1")       // 1_000_000_000_000_000_000n
 *   toBaseUnits("2.5")     // 2_500_000_000_000_000_000n
 *   toBaseUnits(100)       // 100_000_000_000_000_000_000n
 */
export function toBaseUnits(amount: string | number, decimals: number = DECIMALS): bigint {
  const raw = typeof amount === "number" ? numberToDecimalString(amount) : amount.trim();
  if (!/^-?\d*\.?\d*$/.test(raw) || raw === "" || raw === "." || raw === "-" || raw === "-.") {
    throw new Error(`toBaseUnits: invalid decimal amount ${JSON.stringify(amount)}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart = "", fracPart = ""] = unsigned.split(".");
  if (fracPart.length > decimals) {
    throw new Error(
      `toBaseUnits: ${JSON.stringify(amount)} has more than ${decimals} decimal places`,
    );
  }
  const digits = (intPart || "0") + fracPart.padEnd(decimals, "0");
  const value = BigInt(digits);
  return negative ? -value : value;
}

/**
 * Convert base units (bigint or integer string) to a human token decimal string.
 * Trailing zeros in the fractional part are trimmed; an exact whole number has no
 * decimal point.
 *
 * @example
 *   fromBaseUnits(1_000_000_000_000_000_000n) // "1"
 *   fromBaseUnits("2500000000000000000")      // "2.5"
 */
export function fromBaseUnits(base: bigint | string, decimals: number = DECIMALS): string {
  const value = typeof base === "bigint" ? base : parseIntegerString(base);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = frac ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

/** Alias of {@link toBaseUnits} with explicit intent for whole/decimal tokens. */
export function tokensToBaseUnits(tokens: string | number): bigint {
  return toBaseUnits(tokens, DECIMALS);
}

/** Alias of {@link fromBaseUnits} with explicit intent for base-unit amounts. */
export function baseUnitsToTokens(base: bigint | string): string {
  return fromBaseUnits(base, DECIMALS);
}

function parseIntegerString(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`fromBaseUnits: ${JSON.stringify(value)} is not an integer string`);
  }
  return BigInt(trimmed);
}

function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`toBaseUnits: ${n} is not a finite number`);
  }
  // Reject scientific notation (e.g. 1e21) so precision loss is explicit — the
  // caller should pass such amounts as a decimal string instead.
  const s = n.toString();
  if (s.includes("e") || s.includes("E")) {
    throw new Error(
      `toBaseUnits: ${n} stringifies to scientific notation; pass it as a decimal string`,
    );
  }
  return s;
}
