/**
 * Protocol constants and grade helpers, mirroring credence.py (v1.4.0).
 *
 * These are convenient client-side copies of values the contract also exposes
 * through `get_config()`. For anything an operator can change at runtime
 * (terms, utilization cap, pause state) read the live `get_config()` instead.
 */

import type { Grade } from "./types.js";

/** 1 token = 1e18 base units (matches credence.py `BASE`). */
export const BASE = 1_000_000_000_000_000_000n;

/** Native token decimals. */
export const DECIMALS = 18;

/** Ordered grade ladder, weakest to strongest (index == grade rank). */
export const GRADES = ["DENY", "C", "B", "A", "AA", "AAA"] as const;

/** Credit line, in WHOLE TOKENS, each grade unlocks (contract `GRADE_TOKENS`). */
export const GRADE_TOKENS: Record<Grade, number> = {
  DENY: 0,
  C: 100,
  B: 250,
  A: 500,
  AA: 1000,
  AAA: 2500,
};

/** Risk-priced origination fee per grade, in basis points (contract default). */
export const ORIGINATION_BPS_BY_GRADE: Record<Exclude<Grade, "DENY">, number> = {
  C: 400,
  B: 300,
  A: 200,
  AA: 150,
  AAA: 100,
};

/** Grade cap applied when no ownership-proven evidence was seen. */
export const UNOWNED_GRADE_CAP: Grade = "C";

/** Number of independent AI underwriters on the initial assessment panel. */
export const PANEL_SIZE = 3;

/** Number of independent AI underwriters on the (larger) appeal panel. */
export const APPEAL_PANEL_SIZE = 5;

/** Hard cap on the protocol interest rate, in basis points APR (100%). */
export const MAX_INTEREST_BPS = 10000;

/** Minimum draw, base units (1 whole token). */
export const MIN_DRAW_UNITS = BASE;

/** Standing only rises for a line whose peak principal reached this (base units). */
export const MIN_REWARD_PRINCIPAL = 10n * BASE;

/**
 * Numeric rank of a grade, 0 (DENY) .. 5 (AAA). Returns -1 for an unknown value.
 */
export function gradeRank(grade: Grade): number {
  return GRADES.indexOf(grade);
}

/** Credit line in whole tokens for a grade (0 for DENY / unknown). */
export function creditLineTokens(grade: Grade): number {
  return GRADE_TOKENS[grade] ?? 0;
}

/**
 * True iff `grade` is at least `min` on the grade ladder. Pure client-side
 * comparison — for an authoritative, default-aware check use
 * {@link CredenceClient.isCreditworthy}.
 */
export function gradeAtLeast(grade: Grade, min: Grade): boolean {
  return gradeRank(grade) >= gradeRank(min);
}

/** Type guard: is `value` a valid {@link Grade}? */
export function isGrade(value: unknown): value is Grade {
  return typeof value === "string" && (GRADES as readonly string[]).includes(value);
}
