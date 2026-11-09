/**
 * Money + display helpers for Credence.
 *
 * All on-chain native amounts are base-unit integers where 1 token = 1e18 base
 * units. The contract returns them as strings; the UI shows whole-token figures
 * and converts whole tokens back to base-unit integers (as bigint) for writes.
 */

import type { Grade } from "../contracts/types";

export const BASE = 1_000_000_000_000_000_000n; // 1e18

/** Ordered grade rank, weakest to strongest (mirrors the contract's GRADE_RANK). */
export const GRADE_RANK: Record<Grade, number> = {
  DENY: 0,
  C: 1,
  B: 2,
  A: 3,
  AA: 4,
  AAA: 5,
};

/** Sensible default risk-priced origination fee (bps) by grade — the contract's
 *  ORIGINATION_BPS_BY_GRADE. Used as a fallback until get_config() resolves. */
export const DEFAULT_ORIGINATION_BPS_BY_GRADE: Record<string, number> = {
  C: 400,
  B: 300,
  A: 200,
  AA: 150,
  AAA: 100,
};

/** Look up the origination fee (bps) a given grade pays. Falls back to 400. */
export function feeBpsForGrade(
  grade: Grade | "" | undefined,
  table?: Record<string, number> | null
): number {
  const t = table ?? DEFAULT_ORIGINATION_BPS_BY_GRADE;
  if (!grade || grade === "DENY") return t.C ?? 400;
  return t[grade] ?? 400;
}

/** Format basis points as a percentage string, e.g. 400 -> "4%", 150 -> "1.5%". */
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  const pct = bps / 100;
  const s = pct.toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

/**
 * The exact origination fee a draw of `amountBaseUnits` would accrue at a given
 * grade, as a base-unit integer string. Mirrors the contract:
 *   fee = max(1, amount * bps // 10000)
 * Pure bigint arithmetic — never lossy.
 */
export function drawFeeBaseUnits(
  amountBaseUnits: bigint,
  bps: number
): bigint {
  if (amountBaseUnits <= 0n) return 0n;
  const raw = (amountBaseUnits * BigInt(Math.max(0, Math.trunc(bps)))) / 10000n;
  return raw > 0n ? raw : 1n;
}

/**
 * Format a base-unit integer (string | bigint | number) as a human token amount.
 * Uses exact bigint arithmetic for the integer part and keeps up to `decimals`
 * fractional digits (trailing zeros trimmed).
 */
export function formatTokens(
  baseUnits: string | bigint | number | null | undefined,
  decimals: number = 2
): string {
  if (baseUnits === null || baseUnits === undefined || baseUnits === "") return "0";
  let bu: bigint;
  try {
    bu = typeof baseUnits === "bigint" ? baseUnits : BigInt(String(baseUnits).trim());
  } catch {
    return "0";
  }
  const neg = bu < 0n;
  if (neg) bu = -bu;

  const whole = bu / BASE;
  const frac = bu % BASE;

  const wholeStr = whole.toLocaleString("en-US");
  if (frac === 0n || decimals <= 0) {
    return (neg ? "-" : "") + wholeStr;
  }

  // Build the fractional part to `decimals` places.
  const fracFull = frac.toString().padStart(18, "0");
  let fracStr = fracFull.slice(0, decimals).replace(/0+$/, "");
  if (fracStr === "") {
    return (neg ? "-" : "") + wholeStr;
  }
  return (neg ? "-" : "") + wholeStr + "." + fracStr;
}

/** Convert whole tokens (may be fractional) to a base-unit bigint. */
export function tokensToBaseUnits(tokens: number): bigint {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0n;
  // Keep 6 decimals of precision, then scale to 1e18.
  const micro = BigInt(Math.round(tokens * 1_000_000));
  return (micro * BASE) / 1_000_000n;
}

/** Parse a base-unit string to a Number of whole tokens (for ratios/widths only). */
export function baseToTokenNumber(baseUnits: string | bigint | number | null | undefined): number {
  if (baseUnits === null || baseUnits === undefined || baseUnits === "") return 0;
  try {
    const bu = typeof baseUnits === "bigint" ? baseUnits : BigInt(String(baseUnits).trim());
    // Safe for display-sized values; divide via Number after scaling down.
    return Number(bu) / 1e18;
  } catch {
    return 0;
  }
}

/**
 * Tailwind color classes per grade (used by GradeBadge, ladder & charts).
 * Text shades carry an explicit light value plus a `dark:` override so a grade
 * reads with strong contrast in BOTH themes; the translucent bg/border/ring
 * tints work on either background.
 */
export const GRADE_STYLES: Record<Grade, { text: string; bg: string; border: string; ring: string; label: string }> = {
  DENY: {
    text: "text-red-700 dark:text-red-300",
    bg: "bg-red-500/10 dark:bg-red-500/15",
    border: "border-red-500/40",
    ring: "ring-red-500/30",
    label: "No credit",
  },
  C: {
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/10 dark:bg-amber-500/15",
    border: "border-amber-500/40",
    ring: "ring-amber-500/30",
    label: "Entry line",
  },
  B: {
    text: "text-yellow-700 dark:text-yellow-200",
    bg: "bg-yellow-400/10 dark:bg-yellow-400/15",
    border: "border-yellow-500/40 dark:border-yellow-400/40",
    ring: "ring-yellow-500/30 dark:ring-yellow-400/30",
    label: "Standard line",
  },
  A: {
    text: "text-teal-700 dark:text-teal-200",
    bg: "bg-teal-400/10 dark:bg-teal-400/15",
    border: "border-teal-500/40 dark:border-teal-400/40",
    ring: "ring-teal-500/30 dark:ring-teal-400/30",
    label: "Strong line",
  },
  AA: {
    text: "text-sky-700 dark:text-sky-200",
    bg: "bg-sky-400/10 dark:bg-sky-400/15",
    border: "border-sky-500/40 dark:border-sky-400/40",
    ring: "ring-sky-500/30 dark:ring-sky-400/30",
    label: "Prime line",
  },
  AAA: {
    text: "text-emerald-700 dark:text-emerald-200",
    bg: "bg-emerald-400/10 dark:bg-emerald-400/15",
    border: "border-emerald-500/40 dark:border-emerald-400/40",
    ring: "ring-emerald-500/30 dark:ring-emerald-400/30",
    label: "Top line",
  },
};

/** A one-line human descriptor per grade, for the oracle & marketing surfaces. */
export const GRADE_TAGLINE: Record<Grade, string> = {
  DENY: "No line — evidence did not support credit",
  C: "Entry line — unproven or thin evidence",
  B: "Standard line — solid, corroborated standing",
  A: "Strong line — proven, current capacity",
  AA: "Prime line — deep, verified track record",
  AAA: "Top line — exceptional, fully proven standing",
};

/** Format an epoch-seconds due date as a short, locale-stable string. */
export function formatDueDate(epochSeconds: number | null | undefined): string {
  if (!epochSeconds || epochSeconds <= 0) return "—";
  try {
    const d = new Date(epochSeconds * 1000);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Days until (positive) or past (negative) an epoch-seconds due date. */
export function daysUntil(epochSeconds: number | null | undefined): number | null {
  if (!epochSeconds || epochSeconds <= 0) return null;
  const now = Date.now() / 1000;
  return Math.round((epochSeconds - now) / 86400);
}
