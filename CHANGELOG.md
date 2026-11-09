# Changelog

All notable changes to the Credence Intelligent Contract (`contracts/credence.py`) are
documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The on-chain `VERSION` constant (readable via `get_config()["version"]`) is the source of
truth for the deployed release.

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

## [1.4.0] - 2026-11-03

Time-based interest and reputation-primitive release: credit lines can carry a time-based
APR on outstanding principal, and the suite gains a soulbound Credit Passport contract.
**31 methods (11 view, 20 write).** Lint clean (`genvm-lint check`, 3 checks) and typecheck
clean on all four contracts; the direct-mode suite is **70 tests** green (**62 scenario** in
`tests/direct/test_credence.py` + **8 property/invariant** in
`tests/direct/test_invariants.py`, after the invariant fuzz was extended to exercise
interest accrual — see the post-audit note below). An independent pre-submission audit
([`docs/AUDIT.md`](docs/AUDIT.md)) — a second-model (Codex) adversarial pass plus hand
re-derivation across all four contracts — found **no critical or high-severity defect**
(every finding LOW/INFO), and its two actionable LOW tighten-ups were landed as the
post-audit hardening below.

### Added
- **Time-based interest accrual (per-line fixed APR).** A new `interest_bps` risk
  parameter charges simple interest (annualized, in bps APR) on **outstanding principal**,
  accrued **lazily** on each line-touch (`draw` / `repay` / `service_book` →
  `_accrue_interest`) against the consensus clock (`SECONDS_PER_YEAR = 31_536_000`). The
  APR is **fixed PER LINE at draw time** (`rate_bps` is snapshotted from `interest_bps`
  only on the opening draw of a cycle), so enabling or raising the rate later **never
  retro-charges an existing line** (F2: no retroactive repricing). Total owed becomes
  `owed = principal + fee + interest`; `repay` applies value **principal → fee → interest**;
  collected interest is **split to lenders as yield** exactly like the origination fee (it
  is the lenders' primary ongoing yield). New owner-only `set_interest_bps(interest_bps)`
  (bounded `0…MAX_INTEREST_BPS = 10000`, i.e. ≤ 100% APR; **default `DEFAULT_INTEREST_BPS =
  0` = off**). Surfaced as `interest_bps` in `get_config()`, `interest_accrued` / `owed` /
  `rate_bps` on the borrower record (`get_borrower` / `credit_of` path), and
  `outstanding_interest` in `get_pool()`. Covered by `TestInterest`
  (`test_interest_accrues_and_splits_to_lenders`, `test_set_interest_bps_bounds`,
  `test_enabling_apr_does_not_backcharge_existing_line`,
  `test_interest_only_debt_keeps_line_open_and_blocks_reassessment`).
- **Unified `_debt_of` lifecycle predicate.** A single source of truth for whether a line
  is clear — `_debt_of(b) = principal + fee_accrued + interest_accrued` — now backs
  opening-detection (the first draw of a cycle), the reassess/appeal debt guards,
  delinquency (`_service_one` / `_effective`), and full-settlement detection in `repay`. An
  **interest-only** remainder therefore keeps a line open and continues to block
  reassessment and appeal (F1), so unpaid interest can neither be escaped nor silently drop
  the line.
- **`CredencePassport` — soulbound reputation contract (fourth Intelligent Contract).** A
  **non-transferable** on-chain Credit Passport (`contracts/credence_passport.py`,
  `CredencePassport`, **11 methods: 6 view, 5 write**) that an address mints for **itself**
  from its live Credence standing via a synchronous cross-contract `credit_of` read. Its
  only writes are `mint()` and `refresh()` — there is **no transfer / approve / admin
  reassignment**, so reputation cannot be bought or moved. See
  [`docs/PASSPORT.md`](docs/PASSPORT.md). The repo now ships **four** Intelligent Contracts:
  `credence.py` (core), `credence_gated.py` (`CredenceGatedVault`), `credence_governor.py`
  (`CredenceGovernor`), and `credence_passport.py` (`CredencePassport`).

### Changed
- `Repaid` now also carries an `interest_paid` blob key (`str(pay_interest)`), so an indexer
  can see the interest portion of each repayment alongside `fee_paid`. The event set is
  otherwise unchanged (still the eight core events); see [`docs/EVENTS.md`](docs/EVENTS.md).
- `repay` revenue split now covers **fee + interest** (`revenue = pay_fee + pay_interest`),
  each divided by `lender_share_bps` into lender yield and protocol `fee_revenue`; with no
  lenders the whole amount falls back to protocol revenue.
- `VERSION = "1.4.0"`, exposed in `get_config()` as `version`, alongside the new
  `interest_bps`.

### Hardened (post-audit, 2026-11-03)

Landed after the independent pre-submission audit ([`docs/AUDIT.md`](docs/AUDIT.md)); all
within the `1.4.0` on-chain `VERSION`.

- **Utilization cap now blocks draws when there is zero lender capital.** The pool-utilization
  buffer previously skipped its check when `total_funded == 0` (the guard was
  `if util_cap < 10000 and total_funded > 0`), so with a cap configured below 10000 a
  still-approved borrower could `draw` against retained protocol revenue / unclaimed yield
  even with no live lender principal. `draw` now treats zero funded capital under a sub-10000
  cap as "no new draws," closing the one asymmetric gap (`defund` already held the cap on the
  exit side). (Audit F-1.)
- **Validator consensus now re-agrees the evidence ownership flag (`any_owned`), not just the
  grade.** `validator_fn` previously compared only the leader's `grade` (plus payload
  well-formedness); it now also re-derives and compares the leader's `any_owned` flag, so a
  malicious leader can no longer store a spuriously-true ownership flag that would lift the
  identity cap or corrupt the provenance trail. The binding consensus output is therefore the
  bounded grade **and** the ownership flag. (Audit F-3.)
- **Invariant fuzz now exercises interest accrual.** `tests/direct/test_invariants.py` was
  extended to enable a non-zero interest APR, advance the consensus clock between ops so
  interest genuinely accrues, assert that accrual actually happened (never vacuously
  satisfied), and add interest-aware invariants (INV11 `outstanding_interest` == Σ
  `interest_accrued`; INV12 `owed` == principal + fee + interest) with a corrected active-line
  predicate on the full `_debt_of`. The direct-mode suite grows **67 → 70** tests (invariant
  file 6 → 8), closing the interest fuzz-coverage gap noted in the review.

## [1.3.0] - 2026-11-03

Due-process and multimodal release: a borrower can appeal an assessment to a larger
independent panel, and the underwriter panel can now read an image exhibit as a rendered
screenshot. **30 methods (11 view, 19 write).** Lint clean (`genvm-lint check`, 3 checks)
and typecheck clean; the direct-mode suite is **57 tests** green (**51 scenario** in
`tests/direct/test_credence.py` + **6 property/invariant** in
`tests/direct/test_invariants.py`).

### Added
- **Appeal ladder (due process).** New `appeal()` (write) lets an assessed borrower
  escalate **one** assessment to a larger, independent panel — `PANEL_SIZE` 3 →
  `APPEAL_PANEL_SIZE` 5 underwriters — that **re-judges from scratch** (not a review of the
  first panel's reasoning). Allowed **once** (`appeal_tier` flips 0 → 1) and **only with no
  outstanding debt** (`principal == 0 && fee_accrued == 0`), since the appeal may change the
  credit line. The new grade replaces the old one through the shared `_apply_result` path
  (the same identity cap and DENY/approve handling as `assess`). Surfaced as `appeal_tier`
  on the borrower record and `appeal_panel_size` in `get_config()`. Covered by
  `TestAppeal` (`test_appeal_escalates_to_larger_panel`, `test_appeal_only_once`,
  `test_appeal_blocked_with_outstanding_debt`, `test_appeal_panel_size_in_config`).
- **Multimodal vision evidence.** A new `image` evidence `kind` (added to
  `EVIDENCE_KINDS`): its `content` is an `https://` URL that the contract renders to a
  screenshot via `gl.nondet.web.render(url, mode="screenshot")` and attaches to the
  underwriter panel as a vision input (`gl.nondet.exec_prompt(prompt, images=[...])`). An
  image is **unowned by construction**, so it is always `ownership: unproven` and the
  binding grade is capped at `UNOWNED_GRADE_CAP` ("C"); **at most 1 image** is allowed per
  request; the screenshot is sha256-committed into the stored evidence snapshot. A render
  failure fails closed to a fixed "could not be rendered" note. Covered by
  `test_image_evidence_vision_path` and `test_at_most_one_image`.
- **Version / observability.** `VERSION = "1.3.0"` exposed in `get_config()` as `version`,
  alongside the new `appeal_panel_size`.
- **Companion contracts shipped.** The repo now ships **three** Intelligent Contracts:
  `contracts/credence.py` (core), `contracts/credence_gated.py` (`CredenceGatedVault`, a
  composability consumer that gates a collateral-free allowlist on Credence's
  `is_creditworthy` / `credit_of` oracle — see [`docs/COMPOSABILITY.md`](docs/COMPOSABILITY.md)),
  and `contracts/credence_governor.py` (`CredenceGovernor`, an on-chain M-of-N multisig that
  can own and govern Credence with no change to Credence — see
  [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)).

### Changed
- `CreditAssessed` now also carries a `tier` blob key (`int(b.appeal_tier)`), so an indexer
  can distinguish an original assessment (`tier` 0) from an appeal result (`tier` 1). The
  event set is otherwise unchanged.
- `assess` and `appeal` share a single `_apply_result` helper that writes the grade, votes,
  rationale, ownership flag, limit/status, and the per-item fetched snapshots (now including
  `image` items alongside `url` items).

## [1.2.0] - 2026-11-03

Enterprise-hardening release: operational risk controls, separation of duties, and
on-chain observability of the running build. **29 methods (11 view, 18 write).** Lint
clean (`genvm-lint check`, 3 checks) and typecheck clean; the direct-mode suite is **51
tests** green (48 prior + 3 new enterprise tests), alongside the seeded invariant suite.

### Added
- **Guardian role (separation of duties).** A dedicated `guardian` address can pause the
  protocol for incident response via `set_paused`, but holds no power over funds or
  economics (owner-only). New `set_guardian(guardian)` (owner-only) and the guardian added
  to the authorized set in `set_paused`. Covered by
  `TestEnterprise::test_guardian_separation_of_duties`.
- **Pool utilization cap (liquidity buffer).** New `max_utilization_bps` risk limit and
  `set_risk_limits(max_utilization_bps)` (owner-only, bounded 0–10000). When below 10000,
  `draw` rejects any draw that would push outstanding principal above that share of
  `total_funded`, holding a liquidity buffer for lenders. Surfaced as `utilization_bps` in
  `get_pool()`. Defaults to `10000` (no cap). Covered by
  `TestEnterprise::test_pool_utilization_cap`.
- **Version / observability.** `VERSION = "1.2.0"` exposed in `get_config()` as `version`,
  alongside `guardian` and `max_utilization_bps`, so indexers and operators can read the
  running build and its risk posture on-chain. Covered by
  `TestEnterprise::test_config_version_and_risk_defaults`.

### Changed
- `draw` now enforces the pool utilization cap (in addition to the existing
  available-credit and pool-liquidity checks) before extending a line.
- `set_paused` is now callable by the owner, relayer, **or** guardian; the revert message
  is `only the owner, relayer, or guardian may pause`.
- The constructor initializes `guardian` to the deployer and `max_utilization_bps` to
  `DEFAULT_MAX_UTILIZATION_BPS` (10000).

## [1.1.0] - 2026-11-03

Two-sided market and composability release: lenders earn yield, credit becomes an oracle
other contracts can consume, and every state transition emits an event.

### Added
- **Lender yield.** A configurable share (`lender_share_bps`, default 5000) of every
  collected origination fee is streamed to lenders pro-rata through an O(1)
  MasterChef-style accumulator (`acc_yield_per_share` + per-lender `reward_debt`). New
  `claim_yield()`, plus `pending_yield(lender)` and `lender_balance(lender)` views; `fund`
  and `defund` harvest first so deposits/withdrawals never retroactively grant or forfeit
  accrued yield. Lifetime streamed yield is reported as `yield_distributed` in
  `get_pool()`.
- **Lender principal redemption.** New `defund(amount)` lets a lender redeem contributed
  principal up to the pool's available `cash` (capital lent out must be repaid first),
  separate from yield.
- **Events on every state transition.** `CreditRequested`, `CreditAssessed`, `Drawn`,
  `Repaid`, `Defaulted`, `Funded`, `Defunded`, `YieldClaimed` — emitted best-effort
  (`_emit` swallows host rejection so an event can never break a transition). See
  [`docs/EVENTS.md`](docs/EVENTS.md).
- **Composable credit oracle.** `credit_of(borrower)` and `is_creditworthy(borrower, min_grade)`
  (`@gl.public.view`) expose a borrower's live grade, limit, and standing for other
  contracts/chains to consume as judgment-as-a-service; both report live delinquency from
  the consensus clock and return a safe default for an unknown address. See
  [`docs/COMPOSABILITY.md`](docs/COMPOSABILITY.md) and `contracts/credence_gated.py`.
- **Risk-priced origination fees.** The origination fee is set by the AI grade itself
  (`ORIGINATION_BPS_BY_GRADE`: C 400 → B 300 → A 200 → AA 150 → AAA 100 bps) — riskier
  grades pay more — and split between lender yield and protocol revenue on repayment.
- **Bounded, paginated roster reads.** `page_borrowers(offset, limit)` (≤ `MAX_PAGE` = 50
  per page) so indexers/UIs never force an unbounded scan.
- **Two-step ownership transfer.** `transfer_ownership(new_owner)` nominates a
  `pending_owner`; `accept_ownership()` must be called by the nominee, so a mistyped
  address cannot brick admin.
- **Identity-bound grade cap + reassessment.** Grades are capped at `UNOWNED_GRADE_CAP`
  (`"C"`) unless a cited page proves the applicant owns it (`ownership_proven`); a default
  sets `requires_reassessment`, blocking a re-draw on the old line until a fresh assessment
  passes.

### Changed
- Origination fees are no longer a flat rate; they follow the AI grade (see above).
- Repayment applies principal first, then fee; the collected fee is split
  (`lender_share_bps` to lenders, the remainder to protocol `fee_revenue`; with no lenders,
  all of it is revenue).

## [1.0.0] - 2026-11-03

Initial release: reputation-underwritten, undercollateralized credit decided by an
on-chain AI panel reading a borrower's own public evidence under consensus.

### Added
- **Consensus underwriting on live evidence.** A borrower opts in with their own public
  evidence (`request_credit`); `assess` runs a 3-persona underwriter panel
  (CASHFLOW / HISTORY / RISK) inside `gl.vm.run_nondet_unsafe`, fetching any URL evidence
  live (`gl.nondet.web.render`), judging it (`gl.nondet.exec_prompt`), with every validator
  re-fetching and re-judging. The binding grade is the strict-majority floor (`_grade_floor`)
  over the six-value grade set (`DENY < C < B < A < AA < AAA`); it fails closed to `DENY`.
- **Undercollateralized lending lifecycle.** A native-token lending pool (`fund`), credit
  lines sized by grade (`GRADE_TOKENS`: C 100 → AAA 2500 tokens), `draw` against an
  approved line, and `repay` (payable), all on finalized transfer timing.
- **Reputation that compounds.** Per-borrower standing, defaults, on-time count; on-time
  full repayment of a real line (`peak_principal ≥ 10 tokens`) raises standing, and a
  default lowers it. Micro-loan farming earns nothing.
- **Self-servicing loan book.** `service_book` walks the roster against the consensus clock
  and moves overdue → defaulted permissionlessly, with an optional `autonomous` heartbeat.
- **Deterministic sybil detection.** Evidence reused across addresses is flagged
  (`evidence_owner`) and fed to the panel as a protocol-verified fact.
- **Injection-hardened intake.** `_sanitise` (NFKC + control/invisible stripping),
  `_check_clean` / `_CONTROL_RE` write-time screen, and `_neutralise` (strips prompt
  delimiters and the protocol's structural tokens from all untrusted + fetched text).
- **Evidence commitments.** Each exhibit is committed by canonical-JSON sha256
  (`_digest(_canon(...))`), reproduced byte-for-byte by the off-chain `adapter/` adapter.
- **Views & admin.** `get_borrower`, `available_credit`, `get_pool`, `stats`, `get_config`;
  owner/relayer roles gate pause, terms, autonomy, relayer/dev, and fee withdrawal.
