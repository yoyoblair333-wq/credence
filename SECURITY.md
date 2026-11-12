# Security Policy

Credence underwrites **undercollateralized credit**: it extends real native-token value
on a decision made by an on-chain AI underwriter panel that reads borrower-supplied text
and **live web pages**. The value it moves cannot be clawed back by the contract (there is
no collateral), and the strings it feeds a model are written by people who want a larger
line. That makes it adversarial by construction, and we take security reports seriously.

This document is the disclosure policy and a brief map of the security model. The full
analysis — assets, actors, attack surfaces, mitigations, and **residual risks** — is in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), and an independent pre-submission audit
(second-model adversarial pass + hand re-derivation, no critical/high defect) is in
[`docs/AUDIT.md`](docs/AUDIT.md).

`#CreditWithoutCollateral`

---

## Supported versions

Security fixes are provided for the current minor series.

| Version | Supported |
|---|---|
| 1.4.x   | ✅ yes — current release (`VERSION = "1.4.0"` in `contracts/credence.py`) |
| < 1.4.0 | ❌ no — upgrade to 1.4.x |

The running version is readable on-chain at any time via `get_config()["version"]`.

---

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability, and do not disclose it
on-chain or in a pull request.**

Report privately to **`<SECURITY_CONTACT>`** (maintainer to populate before public
release). A good report includes:

- the affected contract and version (`contracts/credence.py`, `contracts/credence_gated.py`, `contracts/credence_governor.py`, or `contracts/credence_passport.py`; `VERSION`),
- a description of the issue and its impact (which asset is at risk — lender principal, lender yield, protocol revenue, or the integrity of the credit decision),
- a concrete reproduction: a failing `tests/direct/` scenario, a sequence of calls, or a crafted evidence payload,
- any suggested remediation.

We aim to acknowledge a report promptly, agree a disclosure timeline with the reporter,
and credit reporters who wish to be named once a fix ships. Please allow a reasonable
window for a fix before any public disclosure.

> New to GenLayer and want to build on or fork Credence? Sign up with referral code
> **`JTR01FHP`**.

---

## Security model in brief

Every mitigation below is implemented across the four Intelligent Contracts
(`contracts/credence.py` core, plus `credence_gated.py`, `credence_governor.py`, and
`credence_passport.py`) and exercised by the direct-mode suite (`tests/direct/`, **69
tests**). See `docs/THREAT_MODEL.md` for the depth, the assumptions, and the residual
risks, and `docs/AUDIT.md` for the independent pre-submission audit (no critical/high).

- **Fail-closed assessment.** The binding grade is the strongest grade a *strict majority*
  of the underwriter panel backs (`_grade_floor`): a split panel lands on the lender-safe
  grade, never the optimistic one, and `DENY` is backed unanimously so a grade is always
  defined. Any malformed underwriter reply is coerced to one `DENY` vote
  (`_parse_assessment`); any panel exception or malformed consensus payload raises or
  returns `False` in `validator_fn`, so **no assessment is written and no credit is
  extended**. Safety is preferred over liveness throughout.

- **Authenticated ownership; no proof, no line (v2.0).** Displaying an address on a page
  proves nothing (comments, profiles and search pages echo arbitrary text), so v2.0
  removed that check. Ownership is proven ACME http-01 style: the borrower lists a bare
  `domain`, and the contract itself fetches `https://<domain>/.well-known/credence-verify.txt`
  (fixed path, no query, no user-controlled URL) and requires a one-time token bound to
  (contract, borrower, request sequence) on its own line. The token rotates on every
  `request_credit`, a proven domain binds to exactly one borrower (`domain_owner`), and a
  `url` item counts as owned only when hosted on a domain proven in the same application.
  Every validator re-derives the proven-domain list. **Without a proven domain the
  credit limit is zero** and `draw` reverts; the applicant keeps at most a public
  reputation grade of `C`, which the `credit_of` / `is_creditworthy` oracle also refuses
  to treat as usable credit. Unauthenticated claims can never gate lender funds.
- **Complete bad-debt lifecycle (v2.0).** A default is written off the moment it is
  recognised (by `service_book` or inline on any `draw`/`repay`): the line leaves the
  book, protocol revenue absorbs the principal loss first (first-loss reserve), and any
  remainder is socialised pro-rata across lenders through a share index, so no lender
  can exit at par ahead of a recognised loss. The full debt stays owed as
  `recovery_owed`; recoveries restore lenders first, then the reserve, then count as
  revenue. Loss allocation is conserved exactly (`written_off_principal ==
  reserve_losses + lender_losses + unallocated_loss`) and fuzz-tested.

- **Consensus re-derivation.** The panel runs inside `gl.vm.run_nondet_unsafe`. The
  leader produces a grade; every validator **re-fetches every URL and re-judges every
  underwriter prompt** and accepts only if its own strict-majority floor equals the
  leader's grade **and its own re-derived evidence-ownership flag (`any_owned`) matches the
  leader's** (`validator_fn`) — so a leader cannot forge the ownership flag to lift the
  identity cap. The consensus is on the bounded six-value grade
  (`DENY < C < B < A < AA < AAA`) plus the ownership flag, not on raw page bytes.

- **Bounded autonomy.** `requested_tokens` is capped at the AAA line (2500 tokens); draws
  are bounded by the AI grade's line, available credit, pool cash, a 1-token minimum, and
  the pool utilization cap. The self-servicing loan book (`service_book`) processes a
  bounded batch (`MAX_SERVICE_BATCH = 25`) from a rolling cursor; the optional autonomous
  heartbeat re-emits itself for at most one roster pass.

- **Pool-utilization buffer (both sides).** A `max_utilization_bps` limit holds a liquidity
  buffer for lenders: below 10000, `draw` rejects a draw that would push outstanding
  principal above that share of `total_funded`, **and `defund` rejects a redemption that
  would push the utilization of the *remaining* capital over the cap** — so the cap cannot
  be evaded from either the borrow side or the exit side (post-audit hardening also blocks
  a draw when there is zero lender capital). Bounded 0…10000, owner-only
  (`set_risk_limits`).

- **Per-line fixed APR (no retroactive repricing).** Optional time-based interest
  (`interest_bps`, **off by default**) accrues lazily on outstanding principal against the
  consensus clock. Each line's APR (`rate_bps`) is **snapshotted at its opening draw**, so
  enabling or raising the global rate later **never retro-charges an existing line**;
  bounded 0…10000 (≤ 100% APR), owner-only (`set_interest_bps`). A single `_debt_of`
  predicate (`principal + fee_accrued + interest_accrued`) governs every lifecycle gate, so
  an interest-only remainder keeps a line open and continues to block reassessment and
  appeal — unpaid interest can neither be escaped nor silently drop the line.

- **Soulbound reputation.** `CredencePassport` has, by construction, **no**
  transfer/approve/admin-reassignment method — a passport is bound forever to the minting
  address, minted only from the caller's own live Credence standing, so on-chain reputation
  cannot be bought, sold, or delegated.

- **Guardian pause (separation of duties) — pause, not unpause.** A dedicated `guardian`
  role can **pause** the protocol (`set_paused(True)`) for incident response but holds
  **no** power over funds or economics — those are owner-only — and **cannot lift a pause**
  (`set_paused(False)` is owner/relayer-only), so a compromised guardian can never override
  an emergency stop. While paused, intake, assessment, funding, drawing, and servicing are
  blocked.

- **Two-step ownership with role reset.** `transfer_ownership` only *nominates* a
  `pending_owner`; the transfer takes effect when the nominee calls `accept_ownership`, so a
  mistyped address cannot brick admin. On acceptance the **delegated roles are reset**
  (`guardian = relayer = owner`), so a prior owner's delegated keys do not silently retain
  authority under the new owner. The recommended production mitigation for the single-owner
  trust assumption is the `CredenceGovernor` M-of-N multisig, which drives the core's
  owner-only methods over a closed, argument-validated action set with
  checks-effects-interactions.

- **Value-conservation invariants.** The accounting is covered by a seeded, randomized
  invariant suite (`tests/direct/test_invariants.py`, which **now also exercises interest
  accrual** — it enables a non-zero APR, advances the consensus clock between ops, and
  asserts interest genuinely accrued) asserting, after every successful op: on-chain `cash`
  equals the net of value that actually moved; principal/fee/interest sums match
  per-borrower totals; the sum of lender `funded` equals `total_funded`; lender yield never
  exceeds `yield_distributed` (within bounded dust); and principal never exceeds a
  borrower's limit. O(1) yield accounting (`acc_yield_per_share` + per-lender `reward_debt`)
  harvests on every `fund`/`defund`, so a deposit or withdrawal never retroactively grants
  or forfeits accrued yield; both the origination fee **and collected interest** are split
  to lenders through the same accumulator; floor-division rounding leaves only bounded
  dust-scale (1e-18-token) residue, and every payout is liquidity-gated against live `cash`
  so it can never drive cash negative or pay out another party's principal.

- **Injection defenses.** Every borrower field and every byte fetched from the web is
  treated as **untrusted data, never instructions**: NFKC normalization plus
  invisible/control-character stripping (`_sanitise`); a write-time regex screen that
  rejects obvious command patterns before any model runs (`_check_clean` / `_CONTROL_RE`);
  and `_neutralise`, which strips prompt-delimiter runs **and** the protocol's own
  structural tokens from every untrusted and fetched field so a hostile page cannot forge
  a section boundary or a fake protocol block. Evidence reused across addresses is flagged
  deterministically (`evidence_owner`) and fed to the panel as a protocol-verified fact.
  Money moves only on `on="finalized"` timing.

---

## Scope

**In scope** (report these):

- `contracts/credence.py` — the core Credence Intelligent Contract.
- `contracts/credence_gated.py` — the `CredenceGatedVault` composability consumer.
- `contracts/credence_governor.py` — the `CredenceGovernor` M-of-N multisig that can own
  and govern the core.
- `contracts/credence_passport.py` — the soulbound `CredencePassport` reputation contract.
- Any way to: extend a larger line than the consensus grade permits; mint credit without a
  passing assessment; borrow against evidence that does not prove ownership; drain or
  mis-attribute lender principal or lender yield; escape accrued interest or retro-charge an
  existing line; withdraw protocol revenue without the owner role; pause/unpause or change
  economics without the correct role; evade the pool-utilization buffer on either `draw` or
  `defund`; execute a governor action outside the closed, argument-validated action set or
  without the signer threshold; move, forge, or self-mint a `CredencePassport` around its
  soulbound/own-standing constraints; break any accounting invariant in
  `tests/direct/test_invariants.py`; or make the underwriter act on injected instructions
  from borrower input or a fetched page.

**Out of scope:**

- The off-chain `adapter/` adapter and the `frontend/` dApp as attack *targets for on-chain
  value* — they hold no funds and no authority (the contract is the sole source of truth).
  Correctness bugs there are ordinary issues, not security reports, unless they induce an
  on-chain loss.
- The GenLayer protocol, GenVM runtime, validator network, and the server-side LLM / web
  providers — report those to GenLayer.
- Liveness of Studio's shared sandbox LLM/web backends (a timed-out `assess` is a liveness
  event, not a vulnerability; the contract fails closed to no-assessment).
- Economic-parameter choices an operator sets within documented bounds (e.g. a loose
  `max_utilization_bps`), and the deliberately sticky `CredenceGatedVault` admission
  documented in `docs/COMPOSABILITY.md`.
- Findings that require trusting an address the owner explicitly granted a role to.
