/**
 * TypeScript types for the GenLayer Credence Intelligent Contract.
 *
 * Mirrors the dataclass / return shapes in credence.py (class Credence, VERSION
 * 1.4.0):
 *   - get_borrower(addr)     -> full Borrower dict (status, grade, limits, owed,
 *                               interest, standing, grade_votes, rationale, …)
 *   - available_credit(addr) -> str (base-unit integer)
 *   - get_pool()             -> pool accounting (base-unit integer strings)
 *   - stats()                -> aggregate protocol stats
 *   - get_config()           -> protocol configuration (grades, terms, limits, …)
 *   - credit_of(addr)        -> composable creditworthiness-oracle record
 *   - is_creditworthy(a, g)  -> bool gate
 *   - page_borrowers(o, l)   -> bounded roster page
 *   writes: request_credit, assess (LLM panel), appeal (larger LLM panel), draw,
 *           repay (payable), fund (payable), defund, claim_yield, service_book,
 *           withdraw_fees, admin setters.
 *
 * MONEY: 1 token = 1e18 base units. The contract stores and returns native
 * amounts as base-unit integer *strings* (JS numbers cannot hold 1e18 safely).
 * Amounts sent INTO the contract (draw amount, repay/fund value) are base-unit
 * integers passed as bigint.
 */

/** Bounded credit grades, weakest to strongest. DENY is the only non-lending grade. */
export type Grade = "DENY" | "C" | "B" | "A" | "AA" | "AAA";

/** Lifecycle of a borrower on-chain. */
export type BorrowerStatus =
  | "none"
  | "assessing"
  | "approved"
  | "denied"
  | "defaulted";

/**
 * The kind of a single evidence item.
 *  - `domain`: a bare hostname the applicant controls. The CONTRACT fetches
 *              https://<domain>/.well-known/credence-verify.txt and requires the
 *              applicant's one-time token (`ownership_challenge`) on its own line.
 *              This is the ONLY way to prove ownership and unlock a credit line.
 *  - `url`   : an https page every validator fetches live; counts as the
 *              applicant's own only when hosted on a domain they just proved.
 *  - `text`  : free text the panel reads as-is (can never prove ownership).
 *  - `image` : an https page rendered to a screenshot and vision-judged by the
 *              panel (multimodal). Image evidence is never identity-proven.
 */
export type EvidenceKind = "text" | "url" | "image" | "domain";

/** The ownership challenge a borrower publishes before request_credit. */
export interface OwnershipChallenge {
  addr: string;
  token: string;
  path: string;
}

/** Ordered grade list and the credit line (in whole tokens) each grade unlocks. */
export const GRADES: Grade[] = ["DENY", "C", "B", "A", "AA", "AAA"];
export const GRADE_TOKENS: Record<Grade, number> = {
  DENY: 0,
  C: 100,
  B: 250,
  A: 500,
  AA: 1000,
  AAA: 2500,
};

/**
 * One committed evidence item as stored on-chain. `kind`, `label`, `content`
 * and `sha256` are set at request time. `fetched_excerpt` / `fetched_sha256`
 * and `ownership_proven` are filled in by the CONTRACT during `assess`/`appeal`:
 * for `url`/`image` evidence every validator opens the link live
 * (gl.nondet.web.render) and records what it saw. Empty until an assessment runs.
 */
export interface EvidenceItem {
  kind: EvidenceKind;
  label: string;
  content: string;
  /** sha256 commitment over canonical {kind,label,content} JSON, set at request time. */
  sha256: string;
  /** Short snapshot of the page the contract fetched live (url/image evidence). */
  fetched_excerpt: string;
  /** sha256 over the fetched page text / screenshot the panel judged. */
  fetched_sha256: string;
  /**
   * Set by the CONTRACT during assessment: true when this url's fetched page text
   * displayed the applicant's own wallet address (a DNS-TXT-style proof of
   * control). Only ownership-proven evidence lifts the grade above the unowned
   * cap. Text AND image evidence are always unproven (they cannot prove control).
   */
  ownership_proven: boolean;
}

/** One underwriter panelist's bounded grade vote. */
export type GradeVote = Grade;

/**
 * Full borrower record as returned by get_borrower / assess / appeal.
 * Base-unit amounts are integer strings; counts/epochs are numbers.
 */
export interface Borrower {
  addr: string;
  status: BorrowerStatus;
  purpose: string;
  /** requested credit, base units (advisory). */
  requested: string;
  grade: Grade | "";
  /** base units */
  credit_limit: string;
  /** outstanding principal, base units (counts against the limit). */
  principal: string;
  /** credit_limit - principal, base units. */
  available: string;
  /** origination fees owed by this borrower, base units. */
  fee_accrued: string;
  /** interest accrued on outstanding principal, base units (0 unless interest is on). */
  interest_accrued: string;
  /** total still owed = principal + fee_accrued + interest_accrued, base units. */
  owed: string;
  /**
   * The interest rate (bps APR) locked for THIS line at draw time — the contract
   * does not retroactively re-price an open line when the protocol rate changes.
   * 0 when nothing is drawn or interest was off at draw. Use this (not the live
   * protocol interest_bps) to describe how an open line actually accrues.
   */
  rate_bps: number;
  /** lifetime value repaid, base units. */
  total_repaid: string;
  /** 0..100 reputation. */
  standing: number;
  defaults: number;
  /** count of clean on-time full repayments. */
  on_time: number;
  /** epoch seconds the current line was opened, 0 if none. */
  opened_at: number;
  /** epoch seconds the current line is due, 0 if none. */
  due_at: number;
  overdue: boolean;
  /** evidence reused from another account. */
  sybil_flag: boolean;
  /**
   * True when the last assessment saw at least one ownership-proven evidence
   * item (a fetched https page displaying this borrower's wallet address).
   * When false the grade is capped at the unowned cap (`unowned_grade_cap`, "C").
   */
  ownership_proven: boolean;
  /**
   * True after a default: a fresh assessment (request_credit → assess) is
   * required before this borrower may draw again.
   */
  requires_reassessment: boolean;
  /**
   * 0 for the first assessment; 1 once the borrower has escalated to the larger
   * appeal panel. A borrower may appeal exactly once.
   */
  appeal_tier: number;
  /** one bounded grade per panelist. */
  grade_votes: GradeVote[];
  /** rationale for the binding grade. */
  rationale: string;
  evidence: EvidenceItem[];
  created_at: string;
  updated_at: string;
  assessed_at: string;
}

/**
 * Pool accounting as returned by get_pool. Base-unit amounts are integer
 * strings; `active_lines`/`utilization_bps` are small integer counts.
 */
export interface Pool {
  cash: string;
  total_funded: string;
  total_drawn: string;
  total_repaid: string;
  /** outstanding principal across all borrowers, base units. */
  outstanding_principal: string;
  /** outstanding origination fees across all borrowers, base units. */
  outstanding_fees: string;
  /** outstanding interest across all borrowers, base units. */
  outstanding_interest: string;
  fee_revenue: string;
  /**
   * Lifetime yield streamed to lenders (their share of collected origination
   * fees + interest), base units. Grows every time a borrower repays.
   */
  yield_distributed: string;
  /** borrowers with outstanding debt right now. */
  active_lines: number;
  /** outstanding_principal / total_funded in basis points (0 when unfunded). */
  utilization_bps: number;
}

/**
 * A lender's position as returned by lender_balance(addr). Both are base-unit
 * integer strings. `funded` is redeemable principal (via defund); `pending_yield`
 * is accrued, unclaimed lender yield (via claim_yield). Separate balances.
 */
export interface LenderBalance {
  /** redeemable contributed principal, base units. */
  funded: string;
  /** accrued, unclaimed lender yield, base units. */
  pending_yield: string;
}

/**
 * The composable creditworthiness-oracle read returned by credit_of(addr):
 * an address's live, on-chain credit standing for other contracts/chains to
 * consume. `known` is false for an address Credence has never assessed (and the
 * rest is then a safe DENY/zero record). Delinquency is computed live from the
 * consensus clock, so the result is never stale behind the keeper.
 */
export interface CreditRecord {
  addr: string;
  known: boolean;
  grade: Grade;
  /** 0 (DENY) .. 5 (AAA); mirrors the grade ladder. */
  grade_rank: number;
  /** base units */
  credit_limit: string;
  /** currently drawable credit, base units (0 unless the line is usable right now). */
  available: string;
  standing: number;
  status: BorrowerStatus;
  /** in default now (flagged by the book or past grace on the live clock). */
  defaulted: boolean;
  /** past-due now on the live consensus clock (independent of the keeper). */
  overdue: boolean;
  /** has ever defaulted at least once. */
  ever_defaulted: boolean;
  /** a default is on record; a new assessment is required before drawing again. */
  requires_reassessment: boolean;
  assessed_at: string;
}

/** One summary row from page_borrowers().items. Base-unit amounts are strings. */
export interface BorrowerSummary {
  addr: string;
  status: BorrowerStatus;
  grade: Grade | "";
  standing: number;
  /** base units */
  principal: string;
  /** base units */
  credit_limit: string;
}

/**
 * A bounded, paginated slice of the borrower roster as returned by
 * page_borrowers(offset, limit). `next_offset` is -1 when the page is the last.
 */
export interface BorrowersPage {
  total: number;
  offset: number;
  next_offset: number;
  items: BorrowerSummary[];
}

/** Aggregate protocol stats as returned by stats(). */
export interface Stats {
  borrowers: number;
  approved: number;
  defaulted: number;
  /** borrowers with outstanding debt right now (matches get_pool.active_lines). */
  active_lines: number;
  service_cursor: number;
}

/** Protocol configuration as returned by get_config() (contract v1.4.0). */
export interface ProtocolConfig {
  /** contract semantic version, e.g. "1.4.0". */
  version: string;
  owner: string;
  /** nominated next owner (two-step transfer); equals `owner` when none pending. */
  pending_owner: string;
  relayer: string;
  dev: string;
  /** separation-of-duties incident-response role: may pause, cannot move funds. */
  guardian: string;
  paused: boolean;
  autonomous: boolean;
  /**
   * Share of every collected origination fee + interest streamed to lenders as
   * yield, in basis points (e.g. 5000 = 50%). The remainder is protocol revenue.
   */
  lender_share_bps: number;
  /**
   * Max share of lender capital that may be outstanding at once, in basis points
   * (10000 = no cap). Operators lower it to hold a liquidity buffer.
   */
  max_utilization_bps: number;
  /** annual interest on outstanding principal, in bps APR (0 = off). */
  interest_bps: number;
  term_seconds: number;
  grace_seconds: number;
  grades: Grade[];
  /** Credit line (whole tokens) per grade. */
  grade_tokens: Record<string, number>;
  /**
   * Risk-priced origination fee per grade, in basis points. Riskier grades pay
   * more (e.g. { C: 400, B: 300, A: 200, AA: 150, AAA: 100 }). DENY is absent.
   */
  origination_bps_by_grade: Record<string, number>;
  /** 1e18, as a string. */
  base: string;
  /** panelists on the initial assessment. */
  panel_size: number;
  /** panelists on the (larger, independent) appeal panel. */
  appeal_panel_size: number;
  /** grade cap applied when no ownership-proven evidence was seen (e.g. "C"). */
  unowned_grade_cap: Grade;
  /** minimum draw, base units (1 token = 1e18). */
  min_draw_units: string;
  /** standing only rises for a line whose peak principal reached this, base units. */
  min_reward_principal: string;
}

/** Result of service_book(). */
export interface ServiceResult {
  processed: number;
  overdue: number;
  defaulted: number;
  cursor: number;
  roster: number;
}

export interface TransactionReceipt {
  status: string;
  hash: string;
  blockNumber?: number;
  [key: string]: unknown;
}

/**
 * A draft evidence item used by the apply form before it is serialized to the
 * `evidence_json` string the contract expects (sha256/fetched fields are added
 * on-chain, never by the client).
 */
export interface EvidenceDraft {
  id: string;
  kind: EvidenceKind;
  label: string;
  content: string;
}
