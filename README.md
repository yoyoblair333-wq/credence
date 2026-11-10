# Credence — credit the chain can underwrite

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

**Live app:** https://yoyoblair333-wq.github.io/credence/ · connected to the live Credence v1.4 core on GenLayer studionet (`0x8D9F4365b39bD2646d18e6ceCc9758344605f9ED`, chain 61999)

**Reputation-underwritten, *undercollateralized* credit for the agentic economy —
a loan decided by an on-chain AI panel that reads a borrower's own public
evidence, under consensus, before a single token moves.**

> **v1.4.** Adds **time-based interest accrual** — a configurable APR (`interest_bps`,
> **off by default**) on outstanding principal, accrued lazily against the consensus clock
> and **fixed per line at draw** so enabling it never retro-charges an existing line; total
> `owed = principal + fee + interest`, repaid principal → fee → interest, with interest
> **streamed to lenders as yield** — and a fourth Intelligent Contract, the **soulbound
> Credit Passport** (`credence_passport.py`): non-transferable, self-minted portable
> reputation read from Credence's oracle. On top of v1.3's **appeal ladder** (a borrower
> escalates one assessment to a larger, independent panel — **3 → 5** underwriters —
> re-judged from scratch, **once**, and only with no outstanding debt) and **multimodal
> vision evidence** (an `image` exhibit rendered to a screenshot and judged by the vision
> panel, capped at the identity floor); v1.2's enterprise controls (a guardian pause role +
> a pool-utilization cap); and v1.1's two-sided market: lenders earn **yield** (a share of
> every origination fee **and of interest** streamed pro-rata through an O(1) accumulator)
> and can redeem principal (`defund`) and claim yield (`claim_yield`); **risk-priced**
> origination fees set by the AI grade; a **composable credit oracle** (`credit_of` /
> `is_creditworthy`) other contracts and chains can call; **events on every state
> transition**; and **bounded, paginated** roster reads (`page_borrowers`) plus two-step
> ownership. The contract is **31 methods** (11 view, 20 write); it lints clean
> (`genvm-lint check`, 3 checks) and typechecks clean (`genvm-lint typecheck`), and the
> **70-test** direct-mode suite is green (**62 scenario** tests in
> `tests/direct/test_credence.py` + **6 property/invariant** tests in
> `tests/direct/test_invariants.py`). The repo now ships **four Intelligent Contracts** —
> `credence.py` (core), `credence_gated.py` (a composability consumer),
> `credence_governor.py` (M-of-N governance) and `credence_passport.py` (a soulbound credit
> passport); see [`docs/COMPOSABILITY.md`](docs/COMPOSABILITY.md),
> [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) and [`docs/PASSPORT.md`](docs/PASSPORT.md). See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the state machine, the consensus flow,
> the interest and yield math, and the protocol invariants.

Every loan in DeFi today is *over*-collateralized. To borrow $100 you must already
lock up $150, because an ordinary smart contract cannot *judge* a borrower — it can
only hold a deposit. That excludes exactly the people and agents who most need
credit: the freelancer with a real revenue page but no idle capital, the startup
with a GitHub and an invoice, the autonomous agent with an on-chain track record
and a job to do. "Undercollateralized lending" is the single largest unsolved
problem in on-chain finance, and it is unsolved for one reason: **nobody on-chain
can read the evidence and decide.**

Credence is the primitive that closes that gap, and it can only exist on GenLayer.
A borrower — human or autonomous agent — opts in and submits **their own public
evidence** of creditworthiness: on-chain history, a revenue dashboard, a GitHub
profile, an invoice, any `https://` page. An on-chain panel of three AI underwriter
personas then does something no other blockchain can: during consensus **each
validator independently re-fetches that live evidence from the web**
(`gl.nondet.web.render`), **re-judges it** (`gl.nondet.exec_prompt`), and must agree
on a bounded credit grade before any value is lent. The contract extends an
undercollateralized line, remembers every borrower and outcome, charges a
**risk-priced origination fee** that is split between **lender yield** and protocol
revenue, lets lenders redeem principal and claim yield, exposes a borrower's live
standing as a **composable credit oracle**, and **services its own loan book** with no
operator.

It is permissionless (anyone can fund the pool, anyone can trigger an assessment),
conservative by construction (the binding grade is the strongest grade a *strict
majority* of the panel will back, and anything uncertain fails closed to **DENY**),
evidence-grounded (every exhibit is committed on-chain by canonical-JSON sha256),
sybil-aware (reused evidence is flagged deterministically and fed to the panel), and
compounding (repay on time and your standing, grade, and line all grow — the
repeat-use flywheel). That is credit the chain can actually underwrite — not a demo.

**#CreditWithoutCollateral**

---

## Why this needs GenLayer

An ordinary smart contract can only run deterministic code. It cannot read a revenue
page, weigh an invoice against a GitHub history, judge whether a claim is
substantiated — and it certainly cannot **open a URL**. So on every other chain the
only way to lend is to demand collateral the contract can mechanically seize. That is
why DeFi credit is over-collateralized: the chain is blind to the borrower.

GenLayer's GenVM can see. An Intelligent Contract reaches both an LLM and the live
web through an **equivalence principle**: the leader produces a result, and every
validator independently re-derives it and accepts only if it agrees. Nothing is
written to chain — and in Credence, **no value is lent** — until the network concurs.

### Consensus underwriting on live evidence — the capability only GenLayer has

When a borrower cites a URL, the **contract itself** fetches that page during
assessment (`gl.nondet.web.render(url, mode="text")`), folds the fetched text into
each underwriter's prompt as **untrusted data**, and then — the part no ordinary
blockchain can do — **every validator re-fetches the same URL and re-judges from what
it sees.** A lender whose underwriter can actually open the revenue dashboard the
borrower pointed at, and check whether it says what the borrower claims.

The honest mechanics of making that work:

- **Consensus is on the *grade*, not the bytes.** Two validators fetching the same
  page, at nearly the same moment, through an LLM, will not produce identical prose
  and may not even see byte-identical HTML. So the contract does **not** try to agree
  on raw page content. It bounds the decision to a six-value grade
  (`DENY`/`C`/`B`/`A`/`AA`/`AAA`) and reaches consensus on *that*. The equivalence
  principle is applied to a categorical decision, which is what makes agreement over
  a live, subjective reading tractable. The stored `rationale` is the *leader*
  underwriter's advisory note surfaced for transparency, not a value every validator
  re-agrees on; the binding, re-agreed output is the grade (and a well-formed vote
  distribution).
- **The binding grade is the strict-majority *floor*.** `_grade_floor` walks the
  grades strongest→weakest and returns the first grade for which *more than half* the
  panel voted at-or-above it. A split panel therefore lands on the lender-safe grade,
  never the optimistic one. DENY is backed unanimously, so a grade is always defined.
  A minority of enthusiastic underwriters cannot push a line through.
- **It fails closed.** `validator_fn` first rejects any malformed payload, then
  **re-runs the entire panel itself** — re-fetching every URL, re-prompting every
  underwriter — and returns `True` only if its own strict-majority floor equals the
  leader's grade. A disagreeing panel, a page that diverges enough to flip the grade,
  or any exception means **no assessment is written and no credit is extended.**
  Safety over liveness; for a lender the safe default is always "do not lend."
- **A broken link does not crash underwriting.** A failed fetch becomes a fixed
  placeholder string (`[the page at this URL could not be retrieved]`) so every node
  sees the same text; the panel then judges with that gap acknowledged, typically
  toward a lower grade or DENY.

This same shape — **bounded categorical output + independent re-judgment, with a
live-web read inside the consensus block** — is reusable for any subjective on-chain
decision that must gate value: insurance underwriting, grant eligibility, KYB tiers,
agent-to-agent trust scoring.

---

## Architecture

```
 borrower (human or agent)                        lenders
      │ request_credit(purpose, tokens, evidence)     │ fund()  (native tokens)
      ▼                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Credence  (gl.Contract)                                          │
│                                                                   │
│  intake  ── _sanitise ▸ _check_clean ▸ _parse_evidence            │
│            (NFKC, strip invisibles, injection screen,             │
│             canonical-JSON sha256 per item, https-only URLs)      │
│            └─ deterministic sybil check: evidence_owner[hash]     │
│                                                                   │
│  assess  ── _run_panel  →  gl.vm.run_nondet_unsafe(               │
│              leader_fn:  for each URL  gl.nondet.web.render       │
│                          × 3 personas  gl.nondet.exec_prompt      │
│                          → votes → _grade_floor (strict-majority) │
│              validator_fn: re-fetch, re-judge, agree on GRADE)    │
│            → credit_limit = GRADE_TOKENS[grade] × 1e18            │
│                                                                   │
│  draw    ── undercollateralized; risk-priced origination fee      │
│            accrues (bps by grade); emit_transfer(on="finalized")  │
│  repay   ── principal first, then fee → split: lender yield       │
│            (acc_yield_per_share) + protocol fee_revenue;          │
│            on-time full repay → standing↑, grade eligibility↑     │
│  service_book ── keeper/self-emitting: overdue→default vs the     │
│            consensus clock; standing↓; autonomous heartbeat       │
│  lenders ── fund / defund (principal) · claim_yield (pro-rata);   │
│            credit_of / is_creditworthy = judgment-as-a-service    │
└─────────────────────────────────────────────────────────────────┘
```

Three fixed underwriter personas — **CASHFLOW** (weighs verifiable current income),
**HISTORY** (weighs track record and prior repayment), **RISK** (scrutinizes for
fraud, sybil behavior, stale/overreaching claims) — judge the same evidence through
different lenses, so one biased reading cannot carry a decision.

---

## Quickstart — lint, typecheck, test

The contract is written against the GenVM Python SDK's typed storage primitives
(`u256`/`u64`/`u32`/`Address`, `TreeMap`, `DynArray`, `@allow_storage` dataclasses)
and compiles, deploys, and runs under the **real** SDK in-process. It is **31 methods** (11 view, 20 write), lints clean with `genvm-lint check` (3 checks) and typechecks clean
with `genvm-lint typecheck`, and is covered by a **61-test direct-mode** scenario suite
(`tests/direct/test_credence.py` — the LLM mocked by regex, the live web fetch mocked by
URL, and `run_nondet_unsafe`'s captured validator replayed with `run_validator`) plus a
companion **property/invariant (conservation) suite** (`tests/direct/test_invariants.py`)
that checks the protocol invariants in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Use
the shared GenLayer venv and force UTF-8 on Windows:

```powershell
# From the credence repo root
$env:PYTHONUTF8 = 1
$py = "python"

# Lint (3 checks) + typecheck
& $py -m genvm_linter check     contracts\credence.py    # or: genvm-lint check ...
& $py -m genvm_linter typecheck contracts\credence.py    # or: genvm-lint typecheck ...

# Test — the authoritative check: the whole direct-mode suite
& $py -m pytest tests\direct -q
# -> 70 tests pass: 62 scenario tests + 8 property/invariant (conservation) tests
```

The direct-mode deploy also exercises the GenVM's own compile/lint pass (an unreachable
non-deterministic call would fail to load); passing the suite is therefore proof the
contract both lints clean in the GenVM sense and behaves as documented. CI runs the same
gates on every push (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)): a
**contract** job (`genvm-lint check` / `typecheck` + `pytest tests/direct`), an **adapter**
job (`node --test`), and an optional **frontend** job (typecheck + build).

---

## Method API

### Borrower / lending lifecycle (write)

| Method | Who may call | What it does |
|---|---|---|
| `request_credit(purpose, requested_tokens, evidence_json="")` | the borrower (becomes `sender`) | Opts in with a plain-language `purpose`, a `requested_tokens` figure (1…2500, advisory), and an optional evidence list. Validates and sanitizes everything, commits each exhibit by canonical-JSON sha256, runs the deterministic sybil check, and sets status → `assessing`. Cannot be called while a line is outstanding (repay first). |
| `assess(borrower)` | **anyone** (keeper, borrower, or staff) | Runs the consensus underwriting panel (`PANEL_SIZE` = 3) on a pending request — fetching any URL evidence live, rendering any `image` exhibit to a screenshot for the vision panel, every validator re-judging. Writes the binding grade, the per-panelist votes, the leader rationale, and the fetched snapshots. Sets `credit_limit` and status → `approved` (or `denied` on DENY). Returns the full borrower record. |
| `appeal()` | the borrower (becomes `sender`) | **Due process.** Escalates the caller's own assessment to a larger, independent panel (`APPEAL_PANEL_SIZE` = 5) that **re-judges from scratch** (same identity cap and fail-closed rules as `assess`). Allowed **once** (`appeal_tier` 0 → 1) and **only with no outstanding debt** (the appeal may resize the line). The new grade replaces the old one; emits `CreditAssessed` (now with `tier`). Returns the record. |
| `draw(amount)` | an approved borrower | Draws `amount` base units against the undercollateralized line (`amount ≤ available ≤ pool cash`, `amount ≥ 1 token`). Accrues a **risk-priced origination fee** (`ORIGINATION_BPS_BY_GRADE`: C 400 → AAA 100 bps — riskier grades pay more), sets the due date on the first draw, and — on that opening draw — **fixes this line's interest APR** (`rate_bps` is snapshotted from the current `interest_bps`), so a later rate change never retro-charges it. Sends the funds (`emit_transfer`, `on="finalized"`). Emits `Drawn`. Returns the record. |
| `repay()` *(payable)* | any borrower with a balance | Repays with native value, applied **principal → fee → interest** (principal first frees the line). The collected **fee + interest** are revenue, **split**: `lender_share_bps` streams to lenders as yield (via `acc_yield_per_share`), the remainder is protocol `fee_revenue` (with no lenders, all of it is revenue). Overpayment beyond `owed` (= principal + fee + interest) is rejected. A full, on-time repayment of a real line (`peak_principal ≥ 10 tokens`) raises `standing` (+12, capped at 100), increments `on_time`, and restores a `defaulted` borrower to `approved` — the repeat-use flywheel. Emits `Repaid`. Returns the record. |
| `service_book(max_items=25)` | **anyone** (keeper) | Walks a bounded batch from a rolling cursor and moves lines past-due → `overdue` (standing −8) → `defaulted` (standing −40, `defaults`++) against the **consensus transaction clock** and the grace window. When `autonomous` is on and work remains, re-emits itself as a finalized self-message — a servicing heartbeat with no operator. Returns a batch summary. |

### Lender / pool (write)

| Method | Who may call | What it does |
|---|---|---|
| `fund()` *(payable)* | anyone | Adds native value to the lending pool (`cash`) that undercollateralized draws are paid from, and opens a yield-earning position: the lender's prior yield is harvested and their `reward_debt` is checkpointed so the new capital only earns on fees collected *after* it is deposited. Emits `Funded`. Returns the pool view. |
| `defund(amount)` | a lender | Redeems contributed **principal** (harvesting yield first), up to the pool's available `cash` (capital currently lent out must be repaid first). Yield is unaffected — claim it separately. Sends funds `on="finalized"`; emits `Defunded`. Returns the pool view. |
| `claim_yield()` | a lender | Claims accrued lender yield (a pro-rata share of origination fees), paid from pool `cash` and separate from principal. Reverts if there is nothing to claim or if liquidity is momentarily insufficient. Sends funds `on="finalized"`; emits `YieldClaimed`. Returns `{claimed, cash}`. |
| `withdraw_fees(to, amount)` | **owner** | Withdraws accrued **protocol** revenue (the protocol's share of origination fees) to `to` (defaulting to `dev`). Never touches lender principal, lender yield, or outstanding loans; capped at `fee_revenue` and `cash`. |

### Evidence item shape (`evidence_json`)

A JSON array of up to **8** items. Each item:

| Field | Values | Notes |
|---|---|---|
| `kind` | `"text"`, `"url"`, or `"image"` | The three supported exhibit kinds (`EVIDENCE_KINDS`). |
| `label` | string, ≤ 120 chars | A short caption; screened for injection. |
| `content` | string | For `text`: the exhibit text (≤ 1200 chars, screened). For `url`: a single `https://` URL (≤ 300 chars) the contract fetches live (`mode="text"`). For `image`: a single `https://` URL (≤ 300 chars) the contract renders to a **screenshot** (`mode="screenshot"`) and attaches to the vision panel. |

**Multimodal `image` evidence.** An `image` exhibit is rendered to a screenshot
(`gl.nondet.web.render(url, mode="screenshot")`) and judged by the panel as a **vision
input** (`gl.nondet.exec_prompt(prompt, images=[...])`). It is **unowned by construction**
(there is no wallet-address ownership proof for a picture), so it is always
`ownership: unproven` and, on its own, cannot lift the grade above the floor cap (`C`). **At
most 1 image** per request; a render failure fails closed to a fixed placeholder; the
screenshot is sha256-committed into the stored snapshot. Consensus is on the resulting
**grade**, not the screenshot bytes.

On intake each item is committed over a **canonical JSON encoding** of the whole item
— `sha256(json.dumps({"kind": k, "label": l, "content": c}, sort_keys=True,
separators=(",", ":"), ensure_ascii=True))` — and stored as the on-chain commitment.
(Canonical JSON, rather than a `"kind\nlabel\ncontent"` concatenation, means a newline
inside one field can never collide with a field boundary; this is the exact digest the
off-chain evidence adapter reproduces.) After assessment, each URL item's
`fetched_excerpt` (clipped to 600 chars), `fetched_sha256`, and `ownership_proven`
(true when the fetched page displayed the borrower's own wallet address) are folded
back into the stored evidence as an audit trail of what the leader actually read.
Without at least one ownership-proven item the binding grade is capped at
`unowned_grade_cap` ("C").

### Admin (write, role-gated)

| Method | Who | What it does |
|---|---|---|
| `set_relayer(relayer)` | owner | Sets the off-chain relayer/keeper address. |
| `set_dev(dev)` | owner | Sets the protocol-revenue recipient. |
| `set_guardian(guardian)` | owner | Sets the separation-of-duties guardian (an incident-response pause role that holds no power over funds or economics). |
| `set_risk_limits(max_utilization_bps)` | owner | Sets the pool-utilization cap (0…10000; below 10000 holds a liquidity buffer, enforced on both `draw` and `defund`). |
| `set_interest_bps(interest_bps)` | owner | Sets the time-based interest APR in bps (0…10000, i.e. ≤ 100% APR; **default 0 = off**). A change applies only to **future** lines — each line's `rate_bps` is fixed at its opening draw. |
| `set_paused(paused)` | owner, relayer **or** guardian to pause; owner **or** relayer to unpause | Circuit breaker; while paused, intake and funding are blocked. A compromised guardian cannot override an emergency pause (only owner/relayer may unpause). |
| `set_autonomous(on)` | owner | Enables/disables the self-emitting servicing heartbeat (off by default). |
| `set_terms(lender_share_bps, term_seconds, grace_seconds)` | owner | Tunes economics within bounds: `lender_share_bps` 0…10000 (the share of each origination fee streamed to lenders), a positive loan `term_seconds`, and a non-negative `grace_seconds`. (The origination fee itself is fixed per grade by `ORIGINATION_BPS_BY_GRADE`, not set here.) |
| `transfer_ownership(new_owner)` | owner | **Nominates** a new owner (two-step). Takes effect only when the nominee calls `accept_ownership`, so a mistyped address cannot brick admin. |
| `accept_ownership()` | the nominated `pending_owner` | Completes the two-step transfer; reverts for anyone who is not the current nominee. |

### Views (read-only)

| Method | Returns |
|---|---|
| `get_borrower(borrower)` | The full record: status, purpose, grade, limit/principal/available, `fee_accrued`, `interest_accrued`, `owed` (= principal + fee + interest), `rate_bps` (this line's fixed APR), standing, defaults, on-time count, due date, overdue / sybil / `ownership_proven` flags, per-panelist votes, rationale, and the committed evidence (each item with its fetched excerpt and per-item `ownership_proven`). |
| `available_credit(borrower)` | `credit_limit − principal`, in base units. |
| `credit_of(borrower)` | **Composable credit oracle** (judgment-as-a-service): the live `{known, grade, grade_rank, credit_limit, available, standing, status, defaulted, assessed_at}` of an address, for other contracts/chains to consume. Returns a safe `unknown` record (grade `DENY`) for an address Credence has never assessed. |
| `is_creditworthy(borrower, min_grade)` | One-call gate: `true` iff the address is currently `approved` **and** holds at least `min_grade`. Reverts if `min_grade` is out of set. |
| `lender_balance(lender)` | `{funded, pending_yield}` — the lender's contributed principal and their accrued-but-unclaimed yield, in base units. |
| `pending_yield(lender)` | A lender's accrued-but-unclaimed yield (harvested + un-harvested), in base units. |
| `get_pool()` | `cash`, `total_funded`, `total_drawn`, `total_repaid`, `outstanding_principal`, `outstanding_fees`, `outstanding_interest`, `fee_revenue`, `yield_distributed` (lifetime yield streamed to lenders), `active_lines` (count of lines with outstanding debt), and `utilization_bps`. |
| `stats()` | Roster size, counts of approved / defaulted, `active_lines`, and the service cursor. |
| `page_borrowers(offset, limit)` | **Bounded, paginated** roster read (≤ `MAX_PAGE` = 50 summaries from `offset`) so indexers/UIs never force an unbounded scan. Returns `{total, offset, next_offset, items[]}` (`next_offset` is `-1` at the end). |
| `roster_size()` | Number of borrowers ever seen. |
| `get_config()` | `version`, owner, `pending_owner`, relayer, dev, `guardian`, pause & autonomous flags, economic terms (`lender_share_bps`, `max_utilization_bps`, `interest_bps`, `term_seconds`, `grace_seconds`), the grade set, the grade→token-line map, `origination_bps_by_grade`, `base` (1e18), `panel_size` (3) and `appeal_panel_size` (5), `unowned_grade_cap` ("C"), `min_draw_units`, and `min_reward_principal`. |

### Grades → credit lines

| Grade | DENY | C | B | A | AA | AAA |
|---|---|---|---|---|---|---|
| **Line (tokens)** | 0 | 100 | 250 | 500 | 1000 | 2500 |

---

## Example flow

```python
# A lender funds the native-token pool
fund()                                  # payable: send native value -> cash

# A borrower opts in with their own public evidence
request_credit(
    "Working capital for my established freelance design studio.",
    500,
    evidence_json='[{"kind":"url","label":"Revenue dashboard","content":"https://stripe.example.com/me"},'
                  '{"kind":"text","label":"Track record","content":"36 months of on-chain settlement history."}]',
)

# Anyone triggers the panel; the chain fetches the URL live, every validator re-judges
assess("0xBorrower...")
# -> {"grade": "AA", "status": "approved", "credit_limit": "1000...e18",
#     "grade_votes": ["AA", "AA", "A"], ...}

# The borrower draws undercollateralized credit (origination fee accrues)
draw(100 * 10**18)                      # 100 tokens; available falls, due date set

# ...and repays principal-then-fee; an on-time full repayment lifts standing + grade
repay()                                 # payable: send what is owed
```

---

## `adapter/` — the off-chain evidence adapter

`adapter/` is the companion **evidence adapter**: an off-chain Node tool that packages a
borrower's evidence into a canonical, sha256-committed bundle whose per-item hashes
match the ones the contract computes on-chain **byte-for-byte**. The commitment
contract is fixed and lives in the Python source:
`sha256(json.dumps({"kind","label","content"}, sort_keys=True, separators=(",",":"),
ensure_ascii=True))` (`_parse_evidence` / `_digest`). The adapter exists so a borrower
or an orchestrator can build an auditable evidence package off-chain and prove it is
exactly what the chain judged. (Mirrors the pattern shipped in the sibling
JusticeUpgrade milestone's `adapter/`.)

> Status: **done and verified.** The adapter is implemented and covered by a
> **24-test** suite, including hash-parity tests that assert its per-item evidence
> digests equal the contract's `_digest(_canon(...))` output **byte-for-byte**. See
> `docs/MILESTONE.md` for the full proven-vs-pending breakdown.

## `frontend/` — the dApp

`frontend/` is a **Next.js** dApp that lets a borrower submit evidence, watch the
consensus panel grade it, draw and repay, and lets a lender fund **and redeem**
(`defund`) pool liquidity and see protocol revenue. It surfaces the product's
identity-binding rule directly — grades are capped at **C** until a cited page proves
wallet ownership — and runs fully in a read-only **preview mode** (representative
mock data, a local stand-in panel) when no contract address is configured.

> Status: **wired to the contract interface and building clean** — `npx tsc --noEmit` and `npx next build`
> both exit 0. It includes the Earn panel (fund / defund / claim yield), the Credit-Oracle
> "check any address" showcase, an owner-gated admin panel, a paginated borrower directory,
> risk-priced draw, and a light/dark keynote theme. It goes live against the deployed
> contract via `NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS`, and runs in read-only preview mode
> otherwise.

---

## Security summary

Credence judges money decisions on borrower-supplied text and **live web pages** — an
adversarial setting by construction. Every string the contract feeds a model is
treated as **untrusted data, never instructions**:

- **Normalize → screen → neutralise.** All input is NFKC-normalized and stripped of
  invisible/bidi and control characters (`_sanitise`); a write-time regex screen
  (`_check_clean` / `_CONTROL_RE`) rejects the obvious command patterns ("ignore
  previous instructions," "you are now," `system:`, `grade:`, "approve me," fenced
  blocks) before any model is called; and `_neutralise` strips `<<<`/`>>>`/```` ``` ````
  delimiter runs from *every* untrusted field — borrower fields, labels, URLs, and
  **fetched web pages** — so a hostile page cannot forge the `<<<EVIDENCE>>>` boundary.
- **Untrusted-data framing in the prompt.** The underwriter instructions state that
  all applicant material and all fetched text is untrusted data describing an
  applicant, and that any attempt to address the model is a **negative** signal.
- **Bounded output, fail-closed.** A reply is coerced into the six-value grade set;
  anything out of set, any malformed panel output, any disagreement, or any exception
  becomes **DENY** / no assessment. The strict-majority floor means a split panel is
  lender-safe.
- **Deterministic sybil detection.** Evidence reused across different addresses is
  flagged (`evidence_owner`) and passed to the panel as a protocol-verified fact.
- **Money moves only on finalized timing.** `draw`/`repay`/`defund`/`claim_yield`/
  `withdraw_fees` transfers are `on="finalized"`; overpayment is rejected; protocol fees
  never touch lender principal; `defund` and `claim_yield` can only pay out against
  available cash (a liquidity gate, not an accounting breach).
- **O(1) yield accounting.** The lender-yield accumulator (`acc_yield_per_share` +
  per-lender `reward_debt`) streams a share of each fee pro-rata without a per-lender
  loop; `fund`/`defund` harvest first so a deposit or withdrawal never retroactively
  grants or forfeits accrued yield, and floor-division rounding only ever leaves an
  unattributable dust **surplus** in `cash` (the pool stays solvent for yield). See the
  invariants in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **The credit oracle fails safe.** `credit_of` returns a conservative `unknown` record
  (grade `DENY`) for any address never assessed, and `is_creditworthy` is `true` only for
  a currently-`approved` address at or above the requested grade — so stale/unknown reads
  default to "not creditworthy."
- **Owner/relayer roles** gate pause, terms, autonomy, relayer/dev, ownership transfer,
  and fee withdrawal (two-step ownership makes a mistyped hand-off un-bricking).

The full analysis, including residual risks and assumptions, is in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

---

## Roadmap

- **On-chain deployment.** The contract **deploys and runs end-to-end on GenLayer
  studionet** (chain `61999`, hosted Studio simulator) — a free, captcha-free,
  server-provisioned LLM/web environment; a reproducible non-interactive runbook and real
  deploy evidence are in [`docs/DEPLOY.md`](docs/DEPLOY.md). Deployment to the public
  **Bradbury** testnet (chain id 4221) is still **pending a faucet captcha**, so there is
  **no Bradbury transaction hash yet** (see `docs/MILESTONE.md`).
- **VecDB semantic memory.** The natural next step is on-chain *semantic* reputation
  memory — "has evidence like this defaulted before?" — using the SDK's forthcoming
  on-chain vector search (`VecDB`). **`VecDB` is not available in the v0.2.16 runtime**
  this build deploys against, so Credence deliberately ships with **deterministic +
  LLM memory only** (the `evidence_owner` hash index for exact-reuse sybil detection
  plus the panel's reading of the reputation block). The semantic-memory upgrade lands
  when the SDK runtime ships `VecDB`; the contract is structured so it can be added
  without changing the lending lifecycle.
- **Companion artifacts.** The `adapter/` adapter is complete and verified against the
  frozen commitment format (24 passing tests, evidence hashes matching the contract
  byte-for-byte). The `frontend/` dApp is wired to the contract interface and builds
  clean (`tsc --noEmit` + `next build` both exit 0). The only remaining steps are the
  **Bradbury deploy** (blocked on the faucet captcha, above) and the **GitHub push**.
- **Richer economics — lender yield shipped in v1.1.** Lenders now earn a pro-rata share
  of origination fees through an O(1) accumulator (`acc_yield_per_share`) and redeem
  principal with `defund` / claim yield with `claim_yield`; the origination fee is
  risk-priced per grade. Still roadmap: a variable ongoing APR to lenders (beyond the
  origination-fee share), explicit per-lender loss tracking on default, and
  jury/token-curated underwriter panels (the fixed three-persona panel is a deliberate
  first step).

---

## Fork it / build on it

This is meant to be forked. Clone it, point it at your own underwriting domain
(insurance, grant eligibility, KYB tiers, agent trust scoring), and reuse the
**bounded-categorical-output + independent-re-judgment** pattern with a live-web read
inside the consensus block. New to GenLayer? Sign up with referral code
**`JTR01FHP`**.

## Repo layout

- `contracts/credence.py` — the core Credence Intelligent Contract (rich module docstring); 31 methods (11 view, 20 write)
- `contracts/credence_gated.py` — `CredenceGatedVault` (9 methods): a second Intelligent Contract that **consumes** Credence's oracle to gate a collateral-free allowlist (the composability proof) — see [`docs/COMPOSABILITY.md`](docs/COMPOSABILITY.md)
- `contracts/credence_governor.py` — `CredenceGovernor` (8 methods): an on-chain **M-of-N** multisig that can own and govern Credence with no change to Credence — see [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)
- `contracts/credence_passport.py` — `CredencePassport` (11 methods): a **soulbound**, non-transferable credit passport an address mints for itself from its live Credence standing — see [`docs/PASSPORT.md`](docs/PASSPORT.md)
- `primitives/credit_passport/` — `CreditPassport`, the passport packaged as a **standalone, reusable primitive**: an issuer-controlled (plus optional oracle-synced) registry of soulbound credit grades any dApp can read with one view call; own tests, live studionet deployment — see [`primitives/credit_passport/README.md`](primitives/credit_passport/README.md)
- `tests/direct/test_credence.py` — the 61-test direct-mode scenario suite
- `tests/direct/test_invariants.py` — the companion 6-test property/invariant (conservation) suite
- `adapter/` — the off-chain evidence adapter: canonical sha256-committed evidence bundles matching the contract's on-chain commitments
- `frontend/` — a Next.js dApp for borrowers and lenders
- `.github/workflows/ci.yml` — CI: contract (lint + typecheck + tests), adapter (node:test), frontend (typecheck + build)
- `docs/ARCHITECTURE.md` — state machine, consensus flow, appeal ladder, multimodal evidence, interest accrual, yield-accumulator math, protocol invariants, identity binding, contract topology
- `docs/COMPOSABILITY.md` — Credence as a creditworthiness oracle + the `CredenceGatedVault` consumer (synchronous cross-contract `.view()`)
- `docs/GOVERNANCE.md` — `CredenceGovernor`, the M-of-N multisig over Credence (asynchronous `emit` dispatch)
- `docs/PASSPORT.md` — `CredencePassport`, the soulbound, self-minted portable credit passport read from Credence's oracle
- `docs/MILESTONE.md` — the milestone writeup (aligned to the GenLayer steward rubric)
- `docs/THREAT_MODEL.md` — assets, actors, attack surfaces, mitigations, residual risks
- `docs/DEPLOY.md` — reproducible non-interactive studionet deploy runbook (+ Bradbury notes)

Built on GenLayer's verified SDK patterns (`gl.Contract`, `TreeMap`, `DynArray`,
`@allow_storage` dataclasses, `gl.nondet.exec_prompt`, `gl.nondet.web.render`,
`gl.vm.run_nondet_unsafe`, `emit_transfer`/`emit` on finalized timing).

#CreditWithoutCollateral
