# Credence — Architecture (v1.4)

**Date:** 2026-11-03
**Scope:** `contracts/credence.py` (class `Credence`, GenVM Python SDK) — 31 methods
(11 view, 20 write). Companion contracts (`credence_gated.py`, `credence_governor.py`,
`credence_passport.py`) are summarized in §6 (contract topology) and detailed in
[`docs/COMPOSABILITY.md`](COMPOSABILITY.md), [`docs/GOVERNANCE.md`](GOVERNANCE.md) and
[`docs/PASSPORT.md`](PASSPORT.md).

This document describes, precisely and honestly, how Credence actually works: the
borrower state machine, the consensus-underwriting flow, the lender-yield accumulator
math, the protocol invariants, and the identity-binding / ownership-transfer design.
Every statement here is grounded in the contract source; where a word like
*outstanding* or *overdue* is a derived sub-state rather than a stored status, that is
called out explicitly.

---

## 1. Borrower state machine

A borrower record (`Borrower` dataclass) has one stored `status` string, which is
exactly one of:

```
none · assessing · approved · denied · defaulted
```

Two further conditions are **not** separate status values but derived facts layered on
top of `status`:

- **outstanding** — the borrower has a live loan: `_debt_of(b) = principal + fee_accrued +
  interest_accrued > 0` (see §2c). `status` stays `approved` (or `defaulted`) while a line is
  outstanding; there is no `"outstanding"` status string.
- **overdue** — a stored boolean flag (`Borrower.overdue`) set by `service_book` once a
  line is past its `due_at` but still inside the grace window. Again, `status` stays
  `approved`; `overdue` is an orthogonal flag, not a status.

### Transitions (what the code does)

```
                 request_credit                 assess (grade == DENY)
   (new addr) ─────────────────▶ assessing ───────────────────────────▶ denied
       │                            │                                      │
       │                            │ assess (grade != DENY)               │ request_credit
       │                            ▼                                      │ (no debt)
       │                        approved ◀─────────────────────────────────┘
       │                         │  ▲
       │       draw (debt 0→+)   │  │  repay (fully settled: _debt_of == 0)
       │                         ▼  │
       │                    approved + outstanding
       │                      (principal/fee > 0)
       │                         │  ▲
       │   service_book:         │  │  repay (partial — stays outstanding)
       │   past due, in grace    ▼  │
       │                    approved + overdue=true
       │                         │
       │   service_book:         │  (past due + grace_seconds)
       │                         ▼
       └── request_credit ──  defaulted  ── repay (fully settled) ──▶ approved
           blocked while        (debt still > 0; overdue=true;
           debt > 0              defaults++, standing −40)
```

Key facts, each traceable to a method:

- **`none → assessing`** (`request_credit`): a first-time address is created with
  `status="none"` and immediately set to `assessing`. A returning address is reused;
  `request_credit` **reverts** if that borrower still has outstanding debt (`_debt_of(b) >
  0`, i.e. any of `principal` / `fee_accrued` / `interest_accrued`)
  (*"settle the outstanding line before requesting a reassessment"*).
- **`assessing → approved | denied`** (`assess`): on a binding grade of `DENY`,
  `status="denied"` and `credit_limit=0`; otherwise `status="approved"` and
  `credit_limit = GRADE_TOKENS[grade] × 1e18`.
- **`approved | denied → approved | denied`** (`appeal`, due process): an assessed
  borrower with **no outstanding debt** may escalate **once** (`appeal_tier` 0 → 1) to a
  larger independent panel (`APPEAL_PANEL_SIZE = 5`) that re-judges from scratch; the result
  overwrites grade/limit/status via the same `_apply_result` path as `assess` (see §2a). It
  is not a distinct status — it transitions between `approved` and `denied` like a
  re-assessment, but is debt-gated and one-shot.
- **`approved → outstanding`** (`draw`): requires `status == "approved"`. The first
  draw of a cycle (debt was zero) sets `opened_at` / `due_at = now + term_seconds`,
  resets `peak_principal`, and increments `active_lines`. Subsequent draws just add to
  `principal` (bounded by `available = credit_limit − principal` and by pool `cash`).
- **`outstanding → overdue → defaulted`** (`service_book`): computed against the
  **consensus clock** (`gl.message_raw["datetime"]`). `past = now − due_at`. If
  `0 < past ≤ grace_seconds` and not already overdue → set `overdue=true`, standing
  −`STANDING_OVERDUE` (8). If `past > grace_seconds` and not already defaulted →
  `status="defaulted"`, `defaults++`, standing −`STANDING_DEFAULT` (40), `overdue=true`.
- **settle → `approved`** (`repay`, payable): applies value **principal → fee → interest**.
  When the line is fully settled (`_debt_of(b) == 0`): if the repay
  was on time (`due_at > 0 && now ≤ due_at`) **and** `peak_principal ≥
  MIN_REWARD_PRINCIPAL` (10 tokens), `on_time++` and standing +`STANDING_ON_TIME` (12,
  capped at 100); a `defaulted` borrower is restored to `approved`; `due_at`,
  `opened_at`, `peak_principal` reset and `active_lines` decrements.

**The repeat-use flywheel, stated precisely.** On-time full repayment raises `standing`
*immediately*. The **grade and line do not auto-upgrade** — they only change at the next
`request_credit` + `assess`, where the improved `standing` is surfaced to the panel in
the reputation block (`_rep_block`) and can earn a higher grade. So "repay → standing↑ →
grade↑ → larger line" is a two-transaction loop (settle, then re-apply), not an
automatic bump inside `repay`.

---

## 2. Consensus-underwriting flow

`assess` calls `_run_panel`, which wraps a leader/validator pair in
`gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`. Both the live web fetch and the LLM
calls live **inside `leader_fn`** so the GenVM linter sees the non-deterministic calls
are reachable from the leader.

### Leader (`leader_fn`)

1. **Fetch evidence.** For each evidence item:
   - `text` items are neutralised (`_neutralise`) and tagged `ownership: unproven`.
   - `url` items are fetched live with `gl.nondet.web.render(url, mode="text")`, clipped
     to `MAX_FETCH_CHARS` (2400) and neutralised. A fetch that raises becomes the fixed
     placeholder `[the page at this URL could not be retrieved]` (so every node sees the
     same text). A URL is owned iff its host is a domain proven in step 0. A per-URL
     `snapshot` (excerpt, `fetched_sha256`, `ownership_proven`) is recorded for the audit trail.
   - **Step 0 (v2.0), ownership:** for each `domain` item the contract fetches
     `https://<domain>/.well-known/credence-verify.txt` (a URL it builds itself) and marks
     the domain proven iff the applicant's one-time token
     (`sha256(contract|applicant|request_seq)`) is a whole line of it and the domain is not
     bound to another borrower. Validators re-agree the proven list.
2. **Panel.** Build one prompt per persona (`PANEL_SIZE = 3`: CASHFLOW, HISTORY, RISK),
   each embedding the application, the protocol-verified reputation block, and the
   fenced `<<<EVIDENCE>>> … <<<END_EVIDENCE>>>` block. Each prompt is sent to
   `gl.nondet.exec_prompt(prompt, response_format="json")` and parsed by
   `_parse_assessment` (out-of-set or malformed grade → coerced to `DENY`).
3. **Vote aggregation.** `votes = [grade per persona]`. `floor = _grade_floor(votes, 3)`
   — the strongest grade a **strict majority** backs at-or-above (see below).
4. **Identity cap.** `cap = AAA if any URL proved ownership else UNOWNED_GRADE_CAP ("C")`;
   binding `grade = _cap_grade(floor, cap)`.
5. Return `{grade, votes, rationale, any_owned, snapshots}` (rationale is the chosen
   panelist's note, or `NEUTRAL_RATIONALE` on DENY).

The **strict-majority floor** (`_grade_floor`): walk grades strongest→weakest; return
the first grade `g` for which `count(votes ≥ g) · 2 > n`. `DENY` is backed unanimously,
so a grade is always defined. A split panel lands on the lender-safe grade, never the
optimistic one — e.g. votes `[A, AA, B]` → binding `A` (two of three back ≥ A).

### Validators (`validator_fn`)

Each validator independently:

1. **Well-formedness gate (before any re-judgment).** Rejects (`False`) unless the
   leader result is a `gl.vm.Return` whose payload is a dict with: `grade ∈ GRADES`;
   `votes` a list of exactly `PANEL_SIZE` in-set grades; `rationale` a `str`;
   `snapshots` a `list`; `any_owned` a `bool`; **and** `GRADE_RANK[grade] ≤
   GRADE_RANK[_grade_floor(votes, 3)]` (the leader's grade may not exceed its own
   votes' floor).
2. **Re-derive.** Re-runs `leader_fn` itself — re-fetching every URL, re-prompting every
   persona, recomputing the floor **and the identity cap** — and returns `True` **only
   if its own re-derived (capped) grade equals the leader's grade.** Any exception in
   this path returns `False`.

**Consensus is on the bounded, capped grade** (plus a well-formed vote distribution),
**not** on raw page bytes and **not** on the free-text rationale. If live content
diverges enough between fetches to flip the majority floor, the validator disagrees and
**no assessment is written and nothing is lent** — safety over liveness.

Both `assess` and `appeal` call the same `_run_panel(...)` (with `PANEL_SIZE=3` and
`APPEAL_PANEL_SIZE=5` respectively) and then the same `_apply_result(...)`, so the
leader/validator consensus mechanism, the identity cap, and the fail-closed rules are
**identical** on the first pass and on appeal — only the panel size differs.

### 2a. Appeal ladder (due process: assess@3 → appeal@5, once, re-judged, capped)

A borrower who disputes their grade can escalate **once** to a larger, independent panel.
`appeal()` (the borrower is `sender`):

1. **Guards.** Requires `status ∈ {approved, denied}` (there must be an assessment to
   appeal); requires `appeal_tier == 0` (*"this assessment has already been appealed"* —
   **one-shot**); and requires **no outstanding debt** (`_debt_of(b) == 0`,
   *"settle the outstanding line before appealing"*), because the appeal can resize the
   credit line and must not do so while money is drawn against the old line.
2. **Re-judge from scratch.** It re-runs `_run_panel` over the **same stored evidence** with
   `n_panel = APPEAL_PANEL_SIZE = 5` — the first five underwriter personas (CASHFLOW,
   HISTORY, RISK, MACRO, CHARACTER). This is a fresh consensus assessment by a larger panel,
   **not** a review of the first panel's reasoning; every validator re-fetches and re-judges
   with the panel of five, and the binding grade is again the strict-majority floor
   (`count(votes ≥ g)·2 > 5`, i.e. ≥ 3 of 5) capped by the same identity rule.
3. **Replace.** `appeal_tier` is set to 1, then `_apply_result` overwrites the grade, votes,
   rationale, `credit_limit`, and status exactly as `assess` would — the appeal result
   **supersedes** the original. `CreditAssessed` is emitted with `tier = 1`.

Because the appeal reuses the stored evidence and the same deterministic cap, a text-only or
image-only applicant is still capped at **C** on appeal; the ladder buys a larger, more
diverse panel and a second reading, not a bypass of the identity rule. A larger panel also
raises the strict-majority bar in absolute terms (3 concurring votes instead of 2), so a
marginal grade is, if anything, *harder* to clear on appeal — appeal is due process, not a
ratchet.

### 2b. Multimodal (image) evidence — screenshot → vision panel

The third evidence `kind` (`EVIDENCE_KINDS = ("text", "url", "image")`) lets the panel read
a **picture**. An `image` item's `content` is a single `https://` URL (validated exactly
like a `url` item). Inside `leader_fn`:

1. **Render.** The page is rendered to a screenshot with
   `gl.nondet.web.render(url, mode="screenshot")` (vs. `mode="text"` for a `url` item). A
   render that raises is caught and the item is marked *"(the image at this URL could not be
   rendered)"* — **fail-closed**, every node sees the same note.
2. **Attach to the panel as a vision input.** The first successfully-rendered screenshot is
   held as `vision_image` and passed to **every** persona prompt as
   `gl.nondet.exec_prompt(prompt, response_format="json", images=[vision_image])` (a
   text-only request omits `images=`). So the panel judges the screenshot, not an OCR of it.
3. **Unowned by construction.** An image can never carry a wallet-address ownership proof,
   so it is always tagged `ownership: unproven` and contributes nothing to `any_owned`.
   Standalone image/text evidence therefore keeps the binding grade capped at
   `UNOWNED_GRADE_CAP` ("C") (`TestHardening`-style: even a unanimous AAA vote caps to C —
   see `test_image_evidence_vision_path`).
4. **Bounded + committed.** `_parse_evidence` enforces **at most 1 image** per request
   (*"at most 1 image evidence item is allowed"*). The screenshot is sha256-committed into
   the stored snapshot (`fetched_sha256 = _digest(str(shot))`), so the audit trail records
   *that* a screenshot was judged without storing the raw bytes on-chain.

**Consensus on the grade, not the bytes.** As with a live URL fetch, two validators will not
render byte-identical screenshots; the equivalence principle is applied to the resulting
**bounded grade**, re-derived by every validator's own render + vision call, never to the
image data. A screenshot that diverges enough to flip the majority floor fails the
assessment closed.

### 2c. Time-based interest accrual (per-line fixed APR, lazily accrued)

A credit line can carry **simple interest** on its outstanding principal, annualized in
basis points by the `interest_bps` risk parameter. It is **off by default**
(`DEFAULT_INTEREST_BPS = 0`), owner-tunable via `set_interest_bps(0…MAX_INTEREST_BPS)`
(`MAX_INTEREST_BPS = 10000` = a 100% APR hard cap), and designed so that enabling or
changing it can never reach back and reprice money already drawn.

- **Lazy accrual against the consensus clock.** Interest is not a background process; it is
  computed on-demand whenever a line is *touched* — `draw`, `repay`, and `service_book` all
  call `_service_one → _accrue_interest(b, now_epoch)` before reading or settling the debt,
  so the stored `interest_accrued` is brought current from the consensus datetime
  (`gl.message_raw["datetime"]`) at every interaction. The increment is
  `inc = principal · rate_bps · elapsed // (10000 · SECONDS_PER_YEAR)` with
  `SECONDS_PER_YEAR = 31_536_000` and `elapsed = now_epoch − last_accrual`; `last_accrual`
  is then advanced to `now_epoch`. Sub-unit accrual floors to 0 (borrower-favorable) and is
  simply picked up on the next touch once it crosses one base unit.
- **Per-line `rate_bps`, fixed at draw (no retroactive repricing).** The rate a line pays is
  **snapshotted onto the borrower record on the opening draw of a cycle**
  (`b.rate_bps = u32(interest_bps)`), and `_accrue_interest` uses `b.rate_bps`, **not** the
  live `interest_bps`. So a line that opened while the APR was 0 (or 5%) keeps accruing at 0
  (or 5%) even if the owner later raises `interest_bps` — the change applies only to lines
  opened afterward. On full settlement `rate_bps` and `last_accrual` reset to 0 with the
  rest of the cycle. (`test_enabling_apr_does_not_backcharge_existing_line`.)
- **`owed` composition.** Total owed is `owed = principal + fee_accrued + interest_accrued`,
  surfaced on the borrower record (`get_borrower`) and used verbatim by `repay`'s overpayment
  guard. `repay` applies value in the order **principal → fee → interest**: principal first
  frees the line, and interest is settled last.
- **Interest is lender yield.** On repayment the collected `pay_fee + pay_interest` is the
  protocol's `revenue`, split by `lender_share_bps` into the lender-yield accumulator (§3)
  and protocol `fee_revenue` (with no lenders, all of it is protocol revenue). Interest is
  therefore the lenders' *ongoing* yield, on top of the one-off origination-fee share.
  `total_interest_outstanding` tracks the book-wide accrued-but-unpaid interest and is
  surfaced as `outstanding_interest` in `get_pool()`.
- **The `_debt_of` predicate — one source of truth.** `_debt_of(b) = principal +
  fee_accrued + interest_accrued` is the single lifecycle predicate for "is this line
  clear?". It backs opening-detection (the first draw of a cycle opens a new line only when
  `_debt_of == 0`), the `request_credit` / `appeal` debt guards, delinquency
  (`_service_one`, `_effective`), and full-settlement in `repay`. Consequently an
  **interest-only** remainder (principal and fee both paid, interest still owed) keeps the
  line **open** and **active** (`active_lines` stays incremented), keeps its `due_at`
  standing so it can still go overdue/default, and continues to block a reassessment or
  appeal until the interest is paid — unpaid interest can neither be escaped nor silently
  drop the line. (`test_interest_only_debt_keeps_line_open_and_blocks_reassessment`.)

---

## 3. Lender-yield accumulator (O(1), MasterChef-style)

Lenders fund a shared native-token pool (`fund`) and earn a share of every origination
fee. Distribution is **O(1) per fee**, independent of the number of lenders, via one
global accumulator rather than a per-lender loop.

### State

| Variable | Meaning |
|---|---|
| `acc_yield_per_share` (`acc`) | cumulative yield **per unit of funded capital**, fixed-point scaled by `ACC_SCALE = 1e18` |
| `funded[addr]` | a lender's contributed principal (base units) |
| `reward_debt[addr]` | the accumulator value already "accounted" to `addr` at its last checkpoint |
| `yield_claimable[addr]` | harvested-but-unclaimed yield (base units) |
| `total_funded` | `Σ funded[addr]` |
| `yield_distributed` | running total of fee value ever streamed to lenders |

### Math

**Streaming a fee cut to lenders** (`_accrue_lender_yield(amount)`), called from `repay`
with `amount = pay_fee · lender_share_bps / 10000`:

```
if amount > 0 and total_funded > 0:
    acc += (amount · ACC_SCALE) // total_funded
    yield_distributed += amount
    return 0                 # fully streamed
else:
    return amount            # no lenders → caller keeps it as protocol revenue
```

**A lender's un-harvested yield** (`_pending_raw(addr)`):

```
pending_raw(addr) = (funded[addr] · acc) // ACC_SCALE  −  reward_debt[addr]
```

**Harvest** (`_harvest(addr)`, run at the start of `fund`, `defund`, `claim_yield`):

```
p = pending_raw(addr)
if p > 0: yield_claimable[addr] += p
reward_debt[addr] = (funded[addr] · acc) // ACC_SCALE      # checkpoint to current acc
```

`fund` / `defund` harvest **first**, then change `funded[addr]`, then re-set
`reward_debt[addr]` to the new `funded[addr] · acc / ACC_SCALE`, so a deposit or
withdrawal never retroactively grants or forfeits already-accrued yield.

**Views.** `pending_yield(addr) = max(0, pending_raw(addr)) + yield_claimable[addr]`;
`lender_balance(addr) = {funded, pending_yield}`. `claim_yield` harvests, pays
`yield_claimable[addr]` from pool `cash` (reverting if `cash` is insufficient right now),
zeroes it, and transfers `on="finalized"`. **Yield is separate from principal** —
principal is redeemed with `defund`, which is likewise gated on available `cash`.

### Worked example (matches `TestYield::test_yield_splits_pro_rata`)

Alice funds 750 tokens, Charlie funds 250 → `total_funded = 1000·1e18`, `acc = 0`.
A borrower draws 100 tokens at grade **A** (200 bps) → origination fee `2·1e18`. On full
repay, `pay_fee = 2·1e18`; with `lender_share_bps = 5000` (50%):

```
lender_cut   = 2e18 · 5000 / 10000 = 1e18        (streamed to lenders)
protocol_cut = 1e18                              (→ fee_revenue)
acc += (1e18 · 1e18) // (1000·1e18) = 1e15
```

Pending yield, with no further harvest:

```
Alice   = (750e18 · 1e15) // 1e18 − 0 = 0.75e18  = ¾ token
Charlie = (250e18 · 1e15) // 1e18 − 0 = 0.25e18  = ¼ token
```

exactly the 750 : 250 split of the 1-token lender cut. With a single lender (Alice,
1000 tokens) the whole 1-token cut is hers (`TestYield::test_lender_earns_and_claims_yield`).

---

## 4. Protocol invariants

These hold after every externally-callable method. They are the properties a companion
property/invariant suite (`tests/direct/test_invariants.py`, the conservation suite)
exercises across randomized operation sequences, alongside the 62 scenario tests in
`tests/direct/test_credence.py`.

1. **Funded-sum consistency.** `total_funded == Σ_addr funded[addr]`.
   (`fund` adds `value` to both; `defund` subtracts `amt` from both.)
2. **Principal consistency.** `total_principal == Σ_addr Borrower.principal`.
   (`draw` adds `amt`; `repay` subtracts the principal portion.) Likewise
   `total_fees_outstanding == Σ_addr Borrower.fee_accrued`.
3. **Active-line count.** `active_lines == |{ addr : principal + fee_accrued > 0 }|`.
   (Incremented only on the opening draw of a cycle; decremented only when a line is
   fully settled to zero debt.)
4. **Value conservation.**
   ```
   cash  ==  (total_funded − total_principal)      # lenders' capital not currently lent out
           + fee_revenue                            # protocol revenue not yet withdrawn
           + Σ_addr pending_yield(addr)             # lender yield accrued but unclaimed
           + dust                                   # dust ≥ 0
   ```
   Every cash mutation preserves this: `fund` (+v to both sides), `draw` (−amt, +principal),
   `repay` (+value split exactly into principal + lender_cut + protocol_cut), `defund`
   (−amt, −funded), `claim_yield` (−amt, −pending), `withdraw_fees` (−amt, −fee_revenue).
5. **Yield solvency within dust.** The accumulator uses floor division, so the sum of
   lenders' `pending_yield` can be a few base units **less** than the value actually
   streamed. The shortfall stays in `cash` as an unattributable **surplus** (`dust ≥ 0`),
   so the pool is **always solvent** to pay every lender's pending yield — rounding never
   produces a deficit. (`claim_yield` and `defund` additionally revert if `cash` is
   momentarily insufficient because capital is lent out — a liquidity gate, not an
   accounting breach.)

Counters `total_drawn` and `total_repaid` are monotone lifetime totals, not balances,
and are deliberately outside the conservation equation.

---

## 5. Identity-binding and ownership-proof design

**Why.** Without identity binding, a borrower could cite a *stranger's* revenue page and
borrow against reputation they do not own — the core undercollateralized-lending abuse.

**Mechanism (v2.0: an ACME http-01-style challenge, checked deterministically).** The old
rule ("the page displays the applicant's address") was removed: any echo page, comment or
profile can display an address. Now a `domain` item is PROVEN iff the contract-built URL
`https://<domain>/.well-known/credence-verify.txt` contains the applicant's one-time token on
its own line; the token is bound to (contract, applicant, request sequence) and rotates on
every request; a proven domain binds to one borrower (`domain_owner`). A `url` item is PROVEN
iff hosted on a proven domain. `text` and `image` evidence are always `unproven`. **Without a
proven domain the credit limit is zero** (no proof, no line), so unauthenticated claims never
gate lender capital.

**Effect on the grade.** `any_owned` is true iff *some* URL item proved ownership. The
binding grade is capped:

```
cap   = AAA (uncapped)      if any_owned
      = UNOWNED_GRADE_CAP = "C"   otherwise
grade = min(strict_majority_floor, cap)   # _cap_grade
```

So with no ownership-proven evidence the line is capped at **C = 100 tokens**, no matter
how enthusiastic the panel (`TestHardening::test_unowned_evidence_is_capped_at_floor_grade`:
a unanimous AAA vote still yields C); an ownership-proven page unlocks the full range
(`…test_ownership_proof_unlocks_higher_grade`). The prompt reinforces this in-band
(unproven evidence "must NOT by itself justify a grade above C"), but the **cap is
enforced deterministically in code** and **re-derived by every validator**, so it does
not depend on the model obeying. `ownership_proven` is stored on the borrower and on each
URL item for audit.

**Two-step ownership transfer.** Admin ownership uses an explicit nominate/accept
handshake to make a mistyped or hostile hand-off un-bricking:

- `owner` and `pending_owner` both start as the deployer.
- `transfer_ownership(new_owner)` (owner-only) sets `pending_owner = new_owner` — it does
  **not** change `owner`.
- `accept_ownership()` succeeds **only** when `sender == pending_owner` **and**
  `pending_owner != owner` (the nominee must actively claim it, and the guard blocks a
  no-op/replay). It then sets `owner = pending_owner`.

A mistyped nominee simply never accepts, so control stays with the current owner; after a
successful transfer `owner == pending_owner` again, which disarms `accept_ownership`
until the next nomination (`TestHardening::test_two_step_ownership_transfer`).

---

## 6. Contract topology (core + gated vault + governor + passport)

The repo ships **four** Intelligent Contracts, each a separate deployment that composes
with the core through GenLayer's two cross-contract primitives — a **synchronous** read
(`.view()`) and an **asynchronous** write (`.emit(on="finalized")`):

```
   consumer reads the oracle                        quorum owns the admin seat
   (SYNCHRONOUS .view())                             (ASYNCHRONOUS .emit())
 ┌───────────────────────┐   is_creditworthy / credit_of   ┌───────────────────────┐
 │  CredenceGatedVault    │ ──────────────────────────────▶ │       Credence         │
 │  (credence_gated.py)   │   gl.get_contract_at(credence)  │    (credence.py, core) │
 │  collateral-free       │       .view().<method>()  →val  │  owner-gated admin     │
 │  allowlist, no tokens  │                                 │  surface               │
 └───────────────────────┘                                 └───────────▲───────────┘
                                                                        │ owner-only writes
                              set_risk_limits / set_terms / …           │ sender == owner
 ┌───────────────────────┐   gl.get_contract_at(credence)               │
 │  CredenceGovernor      │       .emit(on="finalized").<method>()  ─────┘
 │  (credence_governor.py)│   (no return; lands after finalization)
 │  M-of-N multisig       │   once Credence.owner == governor, every emitted
 │  owns Credence.owner   │   owner-only call passes
 └───────────────────────┘
```

- **Core — `Credence` (`credence.py`).** The underwriting protocol and the oracle. Its
  admin surface is guarded by a single `owner` address; its judgment surface
  (`is_creditworthy` / `credit_of`) is public read.
- **Consumer — `CredenceGatedVault` (`credence_gated.py`).** A second contract that holds
  **no tokens and stores no grades**; it reads Credence's oracle with a **synchronous**
  cross-contract `.view()` call (`gl.get_contract_at(credence).view().is_creditworthy(...)`,
  typed via an `ICredence` stub) and gates a collateral-free allowlist on the live result.
  This is the concrete proof that Credence is judgment-as-a-service. Cross-contract reads
  need a real GenVM host, so this path runs on a live network, not gltest direct mode. Full
  detail: [`docs/COMPOSABILITY.md`](COMPOSABILITY.md).
- **Governor — `CredenceGovernor` (`credence_governor.py`).** An M-of-N multisig that can
  **own** Credence. Because Credence only ever checks the message sender, moving its
  ownership to the governor makes every owner-only action require an M-of-N quorum, with no
  change to Credence. The governor drives Credence with **asynchronous** writes
  (`gl.get_contract_at(credence).emit(on="finalized").<method>(...)`), dispatched only after
  a quorum and marked executed before the external emit (checks-effects-interactions). Full
  detail: [`docs/GOVERNANCE.md`](GOVERNANCE.md).
- **Passport — `CredencePassport` (`credence_passport.py`).** A **soulbound** (non-transferable)
  credit passport an address mints for **itself** by **synchronously** reading
  `credit_of` for the caller and snapshotting the returned grade/standing; its only writes
  are `mint()` and `refresh()` (no transfer, no admin reassignment), so it *materialises*
  Credence's judgment into portable, self-custodied reputation. Full detail:
  [`docs/PASSPORT.md`](PASSPORT.md).

The two directions are complementary: a consumer **pulls** a judgment out of Credence
synchronously; the governor **pushes** admin actions into Credence asynchronously. Neither
requires any bespoke hook inside the core contract.

#CreditWithoutCollateral
