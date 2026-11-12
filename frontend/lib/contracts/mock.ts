/**
 * Mock data for Credence's read-only DEMO/PREVIEW mode.
 *
 * When no contract address is configured, the app must stay fully up and show
 * representative data rather than crash or look empty. Every hook falls back to
 * these fixtures, and the apply flow runs `mockAssess` locally so a visitor can
 * experience the entire product — application → consensus assessment → credit
 * line → dashboard → pool — exactly as it will behave against the live contract.
 *
 * None of this touches a chain; a banner makes the preview status unmistakable.
 */

import {
  type Borrower,
  type Pool,
  type Stats,
  type ProtocolConfig,
  type EvidenceDraft,
  type Grade,
  type LenderBalance,
  type CreditRecord,
  type BorrowersPage,
  type BorrowerSummary,
  GRADE_TOKENS,
} from "./types";

export const BASE = 1_000_000_000_000_000_000n; // 1e18

const GRADE_ORDER_RANK: Record<Grade, number> = {
  DENY: 0,
  C: 1,
  B: 2,
  A: 3,
  AA: 4,
  AAA: 5,
};

/** whole tokens -> base-unit integer string */
export function tokensToBaseString(tokens: number): string {
  return (BigInt(Math.max(0, Math.trunc(tokens))) * BASE).toString();
}

/** Minimum draw the contract enforces: 1 token (1e18 base units). */
export const MIN_DRAW_UNITS = BASE;
/** Grade cap when no ownership-proven evidence is seen. */
export const UNOWNED_GRADE_CAP: Grade = "C";

/** Risk-priced origination fee (bps) by grade — matches the contract. */
export const ORIGINATION_BPS_BY_GRADE: Record<string, number> = {
  C: 400,
  B: 300,
  A: 200,
  AA: 150,
  AAA: 100,
};

/** Share of each origination fee streamed to lenders (bps) — matches default. */
export const LENDER_SHARE_BPS = 5000;

/** Demo-only interest rate (bps APR). The real default is 0; a non-zero value
 *  here lets the preview show the interest/owed breakdown the dashboard narrates. */
export const DEMO_INTEREST_BPS = 1200; // 12% APR
/** Demo-only utilization cap (bps). The real default is 10000 (no cap). */
export const DEMO_MAX_UTILIZATION_BPS = 9000; // hold a 10% liquidity buffer
/** Larger, independent panel the appeal escalates to — matches the contract. */
export const APPEAL_PANEL_SIZE = 5;

export const MOCK_CONFIG: ProtocolConfig = {
  version: "1.4.0",
  owner: "0x1111111111111111111111111111111111111111",
  pending_owner: "0x1111111111111111111111111111111111111111",
  relayer: "0x1111111111111111111111111111111111111111",
  dev: "0x1111111111111111111111111111111111111111",
  guardian: "0x2222222222222222222222222222222222222222",
  paused: false,
  autonomous: false,
  lender_share_bps: LENDER_SHARE_BPS,
  max_utilization_bps: DEMO_MAX_UTILIZATION_BPS,
  interest_bps: DEMO_INTEREST_BPS,
  term_seconds: 2_592_000,
  grace_seconds: 604_800,
  grades: ["DENY", "C", "B", "A", "AA", "AAA"],
  grade_tokens: { ...GRADE_TOKENS },
  origination_bps_by_grade: { ...ORIGINATION_BPS_BY_GRADE },
  base: BASE.toString(),
  panel_size: 3,
  appeal_panel_size: APPEAL_PANEL_SIZE,
  unowned_grade_cap: UNOWNED_GRADE_CAP,
  min_draw_units: MIN_DRAW_UNITS.toString(),
  min_reward_principal: (10n * BASE).toString(),
};

export const MOCK_POOL: Pool = {
  cash: tokensToBaseString(41_250),
  total_funded: tokensToBaseString(60_000),
  total_drawn: tokensToBaseString(23_500),
  total_repaid: tokensToBaseString(4_750),
  outstanding_principal: tokensToBaseString(18_750),
  outstanding_fees: tokensToBaseString(142),
  outstanding_interest: tokensToBaseString(61),
  fee_revenue: tokensToBaseString(118),
  yield_distributed: tokensToBaseString(236),
  active_lines: 15,
  // outstanding_principal / total_funded = 18750 / 60000 = 3125 bps.
  utilization_bps: 3125,
};

/**
 * A representative connected-lender position for the Earn preview (demo mode):
 * redeemable principal plus accrued, unclaimed yield.
 */
export const MOCK_LENDER_BALANCE: LenderBalance = {
  funded: tokensToBaseString(7_500),
  pending_yield: (29n * BASE + 500_000_000_000_000_000n).toString(), // 29.5
};

export const MOCK_STATS: Stats = {
  borrowers: 37,
  approved: 24,
  defaulted: 2,
  active_lines: 15,
  service_cursor: 12,
};

/** A fully-populated, approved demo borrower for the dashboard preview. */
export const MOCK_BORROWER: Borrower = {
  addr: "0xA11ce0000000000000000000000000000000Cafe",
  status: "approved",
  purpose:
    "Working capital to buy inventory ahead of a confirmed wholesale order; repaid from receivables within the term.",
  requested: tokensToBaseString(500),
  grade: "A",
  credit_limit: tokensToBaseString(500),
  principal: tokensToBaseString(180),
  available: tokensToBaseString(320),
  fee_accrued: tokensToBaseString(4),
  // 12% APR on 180 tokens for ~12 days ≈ 0.71 tokens of interest.
  interest_accrued: "710000000000000000",
  // owed = principal + fee + interest = 180 + 4 + 0.71 = 184.71 tokens.
  owed: "184710000000000000000",
  // This line was drawn while interest was 12% APR; the rate is locked for the line.
  rate_bps: DEMO_INTEREST_BPS,
  total_repaid: tokensToBaseString(220),
  standing: 74,
  defaults: 0,
  on_time: 3,
  opened_at: Math.floor(Date.now() / 1000) - 12 * 24 * 3600,
  due_at: Math.floor(Date.now() / 1000) + 18 * 24 * 3600,
  overdue: false,
  sybil_flag: false,
  ownership_proven: true,
  requires_reassessment: false,
  appeal_tier: 0,
  grade_votes: ["A", "AA", "B"],
  rationale:
    "Current, verifiable cash flow and a clean three-loan repayment history support a mid-tier line. The confirmed purchase order corroborates the stated purpose; risk flagged no sybil reuse or stale claims. A strict majority backs an A line.",
  evidence: [
    {
      kind: "url",
      label: "Stripe revenue dashboard (public share)",
      content: "https://dashboard.example.com/share/rev-2026-q3",
      sha256:
        "9f2c1d4e7b8a3c0f5e6d2b1a4c7f8e9d0a1b2c3d4e5f60718293a4b5c6d7e8f90",
      fetched_excerpt:
        "Trailing-90-day net volume $142,300 across 1,284 charges; MRR $19,400, +11% QoQ; refund rate 0.9%; no open disputes. Payouts current. Verified owner wallet: 0xA11ce0000000000000000000000000000000Cafe.",
      fetched_sha256:
        "5e6d2b1a4c7f8e9d0a1b2c3d4e5f60718293a4b5c6d7e8f909f2c1d4e7b8a3c0f",
      ownership_proven: true,
    },
    {
      kind: "text",
      label: "Confirmed wholesale purchase order",
      content:
        "PO #4821 from Northwind Retail, net-30, $38,000, countersigned 2026-10-14. Goods ship on receipt of inventory financed by this draw.",
      sha256:
        "a1b2c3d4e5f60718293a4b5c6d7e8f909f2c1d4e7b8a3c0f5e6d2b1a4c7f8e9d",
      fetched_excerpt: "",
      fetched_sha256: "",
      ownership_proven: false,
    },
  ],
  created_at: "2026-08-02T14:05:00Z",
  updated_at: "2026-10-28T09:12:00Z",
  assessed_at: "2026-10-01T16:40:00Z",
};

const PANEL_LENSES: { name: string; lens: string }[] = [
  {
    name: "UNDERWRITER_CASHFLOW",
    lens: "weighs verifiable, current income and cash-flow evidence above all else",
  },
  {
    name: "UNDERWRITER_HISTORY",
    lens: "weighs demonstrated track record: on-chain history, prior repayment, longevity",
  },
  {
    name: "UNDERWRITER_RISK",
    lens: "scrutinizes for fraud, sybil behavior, stale or inconsistent claims, and overreach",
  },
  {
    name: "UNDERWRITER_MACRO",
    lens: "weighs macroeconomic and sector conditions and how they bear on repayment capacity",
  },
  {
    name: "UNDERWRITER_CHARACTER",
    lens: "weighs the stated purpose, its internal consistency, and the plausibility of intent",
  },
];

/** The full underwriter roster (5). The initial panel uses the first 3; an
 *  appeal escalates to all 5. Mirrors credence.py's UNDERWRITERS order. */
export const PANEL = PANEL_LENSES;

const GRADE_ORDER: Grade[] = ["DENY", "C", "B", "A", "AA", "AAA"];

function gradeFloor(votes: Grade[]): Grade {
  const n = votes.length;
  for (let i = GRADE_ORDER.length - 1; i >= 0; i--) {
    const g = GRADE_ORDER[i];
    const atOrAbove = votes.filter(
      (v) => GRADE_ORDER.indexOf(v) >= i
    ).length;
    if (atOrAbove * 2 > n) return g;
  }
  return "DENY";
}

/** Cap `grade` at `cap` (mirrors the contract's _cap_grade). */
function capGrade(grade: Grade, cap: Grade): Grade {
  return GRADE_ORDER.indexOf(grade) <= GRADE_ORDER.indexOf(cap) ? grade : cap;
}

/**
 * A deterministic local stand-in for the on-chain consensus panel, used only in
 * demo mode. It produces a plausible per-underwriter vote set and the
 * strict-majority grade floor the real contract would compute, so the preview's
 * Assessment Result looks and reads like the real thing. It is NOT the real
 * underwriting model and never lends real value.
 */
export function mockAssess(
  purpose: string,
  requestedTokens: number,
  evidence: EvidenceDraft[],
  nPanel: number = 3,
  isAppeal: boolean = false
): {
  grade: Grade;
  votes: Grade[];
  rationale: string;
  ownershipProven: boolean;
} {
  const urlCount = evidence.filter(
    (e) => e.kind === "url" && e.content.trim()
  ).length;
  const textCount = evidence.filter(
    (e) => e.kind === "text" && e.content.trim()
  ).length;
  const imageCount = evidence.filter(
    (e) => e.kind === "image" && e.content.trim()
  ).length;
  const substance = purpose.trim().length;

  // Identity binding: ownership is proven only by the applicant's one-time token
  // at https://<domain>/.well-known/credence-verify.txt (a URL the contract builds
  // itself), and without it the credit limit is ZERO. Demo mode
  // fetches nothing, so no demo evidence can prove ownership — which means the
  // binding grade is capped at the unowned cap ("C"), exactly like on-chain.
  // (Image evidence is never identity-proven, by contract rule.)
  const ownershipProven = false;

  // A simple, legible heuristic: live (url) evidence counts double, an image
  // counts double (it is vision-judged live), text counts once, and a
  // well-described purpose nudges the panel up. More corroboration -> stronger
  // grades, but each underwriter reads it through its own lens.
  const signal =
    urlCount * 2 + imageCount * 2 + textCount + (substance > 120 ? 1 : 0);

  const base = (s: number): Grade => {
    if (s <= 0) return "DENY";
    if (s === 1) return "C";
    if (s === 2) return "B";
    if (s <= 4) return "A";
    if (s <= 6) return "AA";
    return "AAA";
  };

  const clampByRequest = (g: Grade): Grade => {
    // The panel won't hand out a line far above what was asked for.
    const wanted = GRADE_ORDER.find((gr) => GRADE_TOKENS[gr] >= requestedTokens);
    if (!wanted) return g;
    return GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(wanted) ? wanted : g;
  };

  const center = GRADE_ORDER.indexOf(clampByRequest(base(signal)));
  // A symmetric spread of votes around the center so no single lens carries it:
  // the median sits at the center, with the edges one or two steps out. Works
  // for any panel size (3 for an assessment, 5 for an appeal).
  const n = Math.max(1, Math.min(PANEL_LENSES.length, Math.round(nPanel)));
  const votes: Grade[] = Array.from({ length: n }, (_, i) => {
    const offset = i - Math.floor(n / 2); // …, -1, 0, +1, …
    const idx = Math.max(0, Math.min(GRADE_ORDER.length - 1, center - offset));
    return GRADE_ORDER[idx];
  });
  const floor = gradeFloor(votes);
  // Without ownership-proven evidence the binding grade is capped at "C".
  const grade = ownershipProven ? floor : capGrade(floor, UNOWNED_GRADE_CAP);
  const capped = grade !== floor;

  const sources: string[] = [];
  if (urlCount > 0)
    sources.push(`${urlCount} live web source${urlCount > 1 ? "s" : ""} the panel fetched`);
  if (imageCount > 0)
    sources.push(`${imageCount} rendered image${imageCount > 1 ? "s" : ""} the panel vision-judged`);
  if (textCount > 0)
    sources.push(`${textCount} supporting text item${textCount > 1 ? "s" : ""}`);
  const sourceText = sources.length ? sources.join(", ") : "the supplied material";

  const panelPrefix = isAppeal
    ? `On appeal, a larger independent panel of ${n} underwriters re-judged the same evidence from scratch. `
    : "";

  const rationale =
    grade === "DENY"
      ? `${panelPrefix}No strict majority of the underwriting panel supported extending credit on the evidence provided; the safe default (no credit) applies. Add verifiable, current evidence — plus a domain ownership proof (your token at /.well-known/credence-verify.txt) — and re-apply.`
      : `${panelPrefix}The evidence substantiates a ${grade} line: ${sourceText}. Risk flagged no sybil reuse.${
          capped
            ? ` Identity binding: no domain ownership proof was verified, so this is a reputation grade only (capped at ${UNOWNED_GRADE_CAP}) and the credit limit is zero. Publish your token at /.well-known/credence-verify.txt on a domain you control to unlock a credit line.`
            : " A strict majority backs this grade."
        }`;

  return { grade, votes, rationale, ownershipProven };
}

// --------------------------------------------------------------------------- //
// Credit-oracle + roster fixtures (demo mode)
// --------------------------------------------------------------------------- //

/** A representative, varied borrower roster for the directory + oracle preview. */
export const MOCK_ROSTER: BorrowerSummary[] = [
  {
    addr: "0xA11ce0000000000000000000000000000000Cafe",
    status: "approved",
    grade: "A",
    standing: 74,
    principal: tokensToBaseString(180),
    credit_limit: tokensToBaseString(500),
  },
  {
    addr: "0xB0b5000000000000000000000000000000000De1",
    status: "approved",
    grade: "AA",
    standing: 88,
    principal: tokensToBaseString(620),
    credit_limit: tokensToBaseString(1000),
  },
  {
    addr: "0xA9e77000000000000000000000000000000B07cE",
    status: "approved",
    grade: "AAA",
    standing: 97,
    principal: tokensToBaseString(0),
    credit_limit: tokensToBaseString(2500),
  },
  {
    addr: "0xCa701000000000000000000000000000000F00d5",
    status: "approved",
    grade: "B",
    standing: 61,
    principal: tokensToBaseString(95),
    credit_limit: tokensToBaseString(250),
  },
  {
    addr: "0xDefa017000000000000000000000000000000Bad",
    status: "defaulted",
    grade: "C",
    standing: 18,
    principal: tokensToBaseString(42),
    credit_limit: tokensToBaseString(100),
  },
  {
    addr: "0xE5c70000000000000000000000000000000000Fe",
    status: "approved",
    grade: "C",
    standing: 50,
    principal: tokensToBaseString(0),
    credit_limit: tokensToBaseString(100),
  },
  {
    addr: "0xF00d5000000000000000000000000000000Ca571",
    status: "denied",
    grade: "DENY",
    standing: 44,
    principal: "0",
    credit_limit: "0",
  },
  {
    addr: "0x1dea000000000000000000000000000000Ab1e55",
    status: "approved",
    grade: "B",
    standing: 69,
    principal: tokensToBaseString(140),
    credit_limit: tokensToBaseString(250),
  },
  {
    addr: "0x5caf0000000000000000000000000000000d0075",
    status: "assessing",
    grade: "",
    standing: 50,
    principal: "0",
    credit_limit: "0",
  },
];

/** A paginated slice of MOCK_ROSTER, mirroring page_borrowers(offset, limit). */
export function mockPageBorrowers(offset: number, limit: number): BorrowersPage {
  const total = MOCK_ROSTER.length;
  const off = Math.max(0, Math.trunc(offset || 0));
  const lim = Math.min(50, limit && limit > 0 ? Math.trunc(limit) : 50);
  const items = MOCK_ROSTER.slice(off, off + lim);
  const nextRaw = off + items.length;
  return {
    total,
    offset: off,
    next_offset: nextRaw < total ? nextRaw : -1,
    items,
  };
}

function rankToGrade(rank: number): Grade {
  const order: Grade[] = ["DENY", "C", "B", "A", "AA", "AAA"];
  return order[Math.max(0, Math.min(order.length - 1, rank))];
}

/**
 * Deterministic demo stand-in for credit_of(addr). Known roster addresses return
 * their exact record; any other well-formed address gets a believable,
 * stable pseudo-record derived from its bytes so the oracle showcase always has
 * something to render. Malformed input returns a safe `known: false` DENY record.
 */
export function mockCreditOf(addr: string): CreditRecord {
  const a = (addr || "").trim();
  const valid = /^0x[a-fA-F0-9]{40}$/.test(a);
  const lower = a.toLowerCase();

  const known = MOCK_ROSTER.find((r) => r.addr.toLowerCase() === lower);
  if (known) {
    const limit = BigInt(known.credit_limit);
    const principal = BigInt(known.principal);
    const isDefaulted = known.status === "defaulted";
    const usable = known.status === "approved";
    const available = limit - principal;
    return {
      addr: a,
      known: true,
      grade: (known.grade || "DENY") as Grade,
      grade_rank: GRADE_ORDER_RANK[(known.grade || "DENY") as Grade],
      credit_limit: known.credit_limit,
      available: (usable && available > 0n ? available : 0n).toString(),
      standing: known.standing,
      status: known.status,
      defaulted: isDefaulted,
      overdue: false,
      ever_defaulted: isDefaulted,
      requires_reassessment: isDefaulted,
      assessed_at: "2026-10-01T16:40:00Z",
    };
  }

  if (!valid) {
    return {
      addr: a,
      known: false,
      grade: "DENY",
      grade_rank: 0,
      credit_limit: "0",
      available: "0",
      standing: 0,
      status: "none",
      defaulted: false,
      overdue: false,
      ever_defaulted: false,
      requires_reassessment: false,
      assessed_at: "",
    };
  }

  // Derive a stable pseudo-record from the address bytes.
  let sum = 0;
  for (let i = 2; i < lower.length; i++) sum = (sum + lower.charCodeAt(i)) % 997;
  const rank = 1 + (sum % 5); // C..AAA
  const grade = rankToGrade(rank);
  const standing = 45 + (sum % 51); // 45..95
  const limitTokens = GRADE_TOKENS[grade];
  const principalTokens = Math.round((sum % 40) / 100 * limitTokens);
  const limit = BigInt(limitTokens) * BASE;
  const principal = BigInt(principalTokens) * BASE;
  return {
    addr: a,
    known: true,
    grade,
    grade_rank: rank,
    credit_limit: limit.toString(),
    available: (limit - principal).toString(),
    standing,
    status: "approved",
    defaulted: false,
    overdue: false,
    ever_defaulted: false,
    requires_reassessment: false,
    assessed_at: "2026-09-18T11:22:00Z",
  };
}

/** Demo is_creditworthy(addr, minGrade): mirrors the contract's gate. */
export function mockIsCreditworthy(addr: string, minGrade: Grade): boolean {
  const rec = mockCreditOf(addr);
  return (
    rec.known &&
    rec.status === "approved" &&
    GRADE_ORDER_RANK[rec.grade] >= GRADE_ORDER_RANK[minGrade]
  );
}
