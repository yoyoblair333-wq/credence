# Credence — Pre-Submission Readiness & Quality Audit

**Audit date:** 2026-11-03
**Target:** `Credence` Intelligent Contract suite (on-chain `VERSION = "1.4.0"`)
**Audited commit (snapshot):** `95ef796` — HEAD advanced from `779bedb` during the audit via
two concurrent commits not made by this auditor (see §1.5); all numbers below are pinned to
`95ef796` unless stated otherwise.
**Audience:** GenLayer milestone steward / reviewer
**Status of this document:** independent pre-submission audit. It records what was
verified, how, and what remains unproven. It does **not** modify any code, test, or other
file. Numbers in the gate tables were produced by running the gates for this audit, not
copied from the docs.

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## 0. One-paragraph verdict

Credence is a genuinely substantial, four-contract GenLayer suite that does the hard thing
the platform exists for — gating real native-token value on an in-consensus AI reading of
live web evidence — and it is backed by a real test apparatus (69 direct-mode tests at the
audited HEAD, commit `95ef796`; 67 before two commits landed concurrently mid-audit — see
§1.5 — plus a seeded value-conservation fuzzer and 24 off-chain adapter tests, all green) and
an unusually honest, deep documentation set. All four contracts pass `genvm-lint check` (lint +
validate) and `genvm-lint typecheck` cleanly. An independent second-model (Codex) adversarial
pass plus my own review found **no critical or high-severity defect**; every issue surfaced
is LOW or INFO (dust-scale rounding, an operator-misconfiguration edge in the utilization
cap, provenance-metadata trust in the consensus payload, and a few documented/known
limitations). The one material **evidence gap for a top score is deployment**: the suite is
proven end-to-end only on the **ephemeral studionet sandbox** (with recorded tx hashes);
there is **no persistent public-testnet (Bradbury) deployment and no Bradbury transaction
hash**, which the project's own docs state plainly. Recommendation: submit, with the
Bradbury deploy called out as the remaining item, and optionally land the two one-line
LOW fixes below first.

---

## 1. Scope & methodology

### 1.1 What was audited

| Artifact | Path | Reviewed |
|---|---|---|
| Core contract | `contracts/credence.py` (1307 lines) | Full line-by-line read + independent Codex pass |
| Composability consumer | `contracts/credence_gated.py` (`CredenceGatedVault`) | Full read |
| Governance multisig | `contracts/credence_governor.py` (`CredenceGovernor`) | Full read |
| Soulbound reputation | `contracts/credence_passport.py` (`CredencePassport`) | Full read |
| Scenario tests | `tests/direct/test_credence.py` (61 tests) | Full read + executed |
| Invariant/property tests | `tests/direct/test_invariants.py` (8 tests incl. seeded fuzz — see §1.5 note) | Full read + executed |
| Off-chain adapter | `adapter/` (evidence-commitment adapter + 24 tests) | Executed; `package.json` read |
| Docs | README, ARCHITECTURE, THREAT_MODEL, SECURITY, EVENTS, INTEGRATION, OPERATIONS, GOVERNANCE, COMPOSABILITY, PASSPORT, DEPLOY, CHANGELOG, PITCH, MILESTONE | Read (THREAT_MODEL / SECURITY / CHANGELOG in full; others targeted + overclaim sweep) |

Supporting assets present in the repo (not the primary audit targets, but relevant to the
Effort/Scope rubric): `sdk/` (typed TypeScript client, compiled `dist/`), `frontend/`
(Next.js dApp), `scripts/` (studionet deploy/exercise scripts: `compose_studio.py`,
`governance_studio.py`, `passport_studio.py`), `.github/workflows/ci.yml`, MIT `LICENSE`.

### 1.2 How the gates were run (reproducible)

Environment used for this audit:

- Python toolchain: the project's `genvm`/`gltest` venv at
  `…/GenLayer_Submissions/verdict/contracts/.venv` — `genlayer-py 0.16.3`,
  `genlayer-test 0.29.2`, `genvm-linter 0.11.0`.
- Node: `Node 22` (`node v22.23.4`).
- SDK runner pinned by `tests/direct/conftest.py` to `GENVM_VERSION = v0.2.16` (the version
  the contracts' `Depends` header targets). `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`.

Commands: `genvm-lint check <contract>` and `genvm-lint typecheck <contract>` for each of the
four contracts; `pytest tests/direct -q`; and `node --test` inside `adapter/`.

### 1.3 Second-model cross-check

An **independent, read-only** adversarial pass was run with the Codex CLI
(`codex exec --sandbox read-only`, model `gpt-6.1-sol`) against the core contract, briefed
to hunt for real bugs across value conservation, the yield accumulator, delinquency timing,
the consensus panel, interest accrual, the utilization cap, access control, injection
defenses, and integer/type issues. Its six findings were then **re-derived by hand against
the source** for this audit (not relayed on trust); the calibrated results are in §5.3. Codex
rated three findings MEDIUM; on independent analysis each reduces to LOW given the
mitigations, and I state where I disagree with its severity and why.

### 1.4 The prior-review trail (verified against the commit log)

The project claims a discipline of adversarial-review-then-harden at each minor version. The
git history corroborates this: each review has a corresponding, separately-committed
hardening pass, and the test suite grew monotonically (48 → 51 → 57 → 67) with named
regression tests for the specific fixes.

| Review | Hardening commit (trail) | Regression evidence (test names) |
|---|---|---|
| v1.1 — lender-yield code | `3059d57` *"Credence v1.1: harden after second-model review of the yield code"* | `TestYield::test_lender_earns_and_claims_yield`, `test_yield_splits_pro_rata`; `test_pending_is_exactly_pro_rata_to_funded_at_accrual`, `test_repay_fee_split_is_conserved` |
| v1.2 — enterprise risk controls | `a3a0360` *"Harden after v1.2 risk-control review: enforce utilization buffer on both sides"* | `TestEnterprise::test_pool_utilization_cap`, `test_defund_respects_utilization_cap`, `test_guardian_*` |
| v1.3 — appeal ladder + multimodal | `eb36c67` *"Harden v1.3 after adversarial review: enforce delinquency from the clock (F1) + fixes"* | `TestDelinquencyFromClock::*`, `TestAppeal::*`, `test_image_evidence_vision_path` |
| v1.4 — time-based interest | `55b42f9` *"Harden v1.4 after interest review: unified debt predicate (F1) + per-line APR (F2)"* | `TestInterest::test_enabling_apr_does_not_backcharge_existing_line`, `test_interest_only_debt_keeps_line_open_and_blocks_reassessment` |
| Passport self-review | `2ed36c5` *"Add CredencePassport: soulbound on-chain credit reputation (4th contract)"* | Defensive-by-construction (see note) |

**Honest note on the passport review:** unlike the four core reviews, there is **no separate
"harden passport" commit** — the passport was built with the suite's hardening checklist
applied at creation (defensive reads of the untrusted oracle return via `_grade_or_deny`
collapsing unknown grades to `DENY` and `_as_int` clamping standing to 0–100; soulbound by
construction — no `transfer`/`approve`/admin-reassignment surface exists at all; two-step
ownership; bounded paginated views). So "self-review" here means "built defensively from the
start," not "retrofitted after a finding." That is an accurate reading of the trail, not a
claim of a separate review-and-fix cycle. (The passport has no dedicated unit test file in
`tests/direct/`; its behaviour is exercised only by the studionet script `passport_studio.py`
— see §5.2.)

### 1.5 Note: the repo moved during this audit (HEAD advanced; not by this auditor)

The repository was edited by a **concurrent process while this audit was in progress**, and the
changes were **committed**. HEAD advanced from `779bedb` (at the start of the audit) to
`95ef796` via two commits this auditor did not make:

- `55f23bf` *"docs: LIVE_EVIDENCE.md — consolidated studionet on-chain evidence (real tx
  hashes)"* — adds `docs/LIVE_EVIDENCE.md` (see §5.2).
- `95ef796` *"test: invariant fuzz now exercises interest accrual (close the review's coverage
  gap)"* — expands `tests/direct/test_invariants.py`.

This auditor did **not** author those commits — the only file this audit created/edited is
`docs/AUDIT.md`, and the second-model pass ran read-only. The test change is an **expansion, not
a regression**: the seeded fuzz driver now enables a non-zero interest APR, advances the
consensus clock between ops so interest actually accrues, adds INV11 (`outstanding_interest` ==
sum of `interest_accrued`) and INV12 (owed identity), corrects INV5 to the contract's full
`_debt_of` predicate (principal + fee + interest), and adds `op_set_interest` / `op_appeal`
driver ops plus two deterministic interest-invariant tests. `test_invariants.py` now collects
**8** tests (was 6), so the full direct-mode suite is **69** (was 67); all 69 pass (§6.3). The
first gate run in this audit (67) was against the start-of-audit tree `779bedb`; the §6 numbers
below are for the **audited HEAD `95ef796`**. One consequence: `CHANGELOG.md` still records
"67 tests" and was not updated by the test commit — a fresh minor doc lag (§5.4). Practical
effect on this audit: the interest-off fuzz-coverage gap flagged in an earlier draft is **now
closed and committed** (§3), so it is no longer carried as a Quality deduction. The repo is
being edited live by another process; **this audit is a snapshot at HEAD `95ef796`** and does
not chase further movement.

---

## 2. Per-contract summary

Method counts below are **as reported by `genvm-lint`'s validator** for this audit, and were
cross-checked by counting the `@gl.public.*` decorators by hand (they agree).

### 2.1 `Credence` (core) — 31 methods (11 view, 20 write)

**Purpose.** Reputation-underwritten, undercollateralized credit. A borrower opts in with
their own public evidence (`request_credit`); a 3-persona AI underwriter panel runs inside
`gl.vm.run_nondet_unsafe` (`assess`), fetching any `https://` evidence live and judging it,
with every validator re-fetching and re-judging; the binding grade is the strict-majority
floor over `DENY < C < B < A < AA < AAA`. Approved borrowers `draw` against a grade-sized
line and `repay` (principal → fee → interest). Lenders `fund` a native pool, earn a share of
fees+interest as yield through an O(1) accumulator, and `defund` / `claim_yield`. A
permissionless `service_book` moves lines overdue → defaulted against the consensus clock.
`credit_of` / `is_creditworthy` expose the decision as a composable oracle.

**Key invariants (enforced):** value conservation on `cash`; grade ≤ strict-majority floor,
re-derived by validators; grade capped at `C` without identity-proven evidence; fail-closed
assessment; per-line APR fixed at draw; utilization buffer on both draw and defund; two-step
ownership with role reset; guardian may pause but not unpause. (Detail in §3–§4.)

### 2.2 `CredenceGatedVault` (`credence_gated.py`) — 9 methods (4 view, 5 write)

**Purpose.** The composability proof: a second contract that **consumes** Credence's oracle
on-chain with no funds and no tokens of its own. `claim()` admits the caller to a
collateral-free allowlist **iff** a synchronous cross-contract read
`ICredence(credence).view().is_creditworthy(addr, min_grade)` returns true, then snapshots
the live grade/standing. **Key invariants:** the oracle is the sole source of truth (the vault
stores no grades of its own and cannot self-admit around it); strict address validation;
`min_grade` validated against the canonical set; two-step ownership; bounded paginated roster.

### 2.3 `CredenceGovernor` (`credence_governor.py`) — 8 methods (5 view, 3 write)

**Purpose.** An M-of-N multisig that can own and govern Credence with **zero changes to
Credence** (Credence only checks `sender == owner`; transfer ownership to a deployed governor
and every owner-only call routed through it passes). `propose` / `approve` / `execute` over a
**closed** action set (10 actions, each mapping 1:1 to a Credence admin method). **Key
invariants:** immutable signer set and threshold (v1 — no governance-of-governance surface);
closed action allow-list (unknown actions revert); per-action argument arity + range
validation at propose time (malformed args can never be stored); checks-effects-interactions
(status flipped to `executed` **before** the external call); idempotent approvals; execution
at most once; only signers may propose/approve/execute.

### 2.4 `CredencePassport` (`credence_passport.py`) — 11 methods (6 view, 5 write)

**Purpose.** A **soulbound** (non-transferable) on-chain credit passport an address mints for
**itself** from its live Credence standing (`mint`), and re-syncs (`refresh`). **Key
invariants:** no transfer/approve/admin-reassignment method exists by construction — a
passport is bound forever to the minting address; one passport per address; `mint` reverts if
Credence has never assessed the caller (`credit_of.known == False`); defensive reads of the
untrusted oracle return (`_grade_or_deny`, `_as_int` clamp); `grade_rank` derived locally;
two-step ownership; bounded paginated views.

---

## 3. Protocol invariants and how they are enforced + fuzz-tested

The randomized invariant driver (`tests/direct/test_invariants.py`) applies a seeded
(`SEED=1234`, `NUM_OPS=400` by default) sequence of fund/assess/draw/repay/service/warp/
defund/claim/withdraw/appeal/set_interest operations across 3 lenders and 4 borrowers, maintains a parallel
Python ledger of value actually moved, and re-checks the full invariant battery after **every
successful** op. The run self-asserts that it actually reached the lending path
(`total_drawn > 0`, `yield_distributed > 0`) and that ≥ 1/3 of ops applied.

| # | Invariant | Where enforced in code | How tested |
|---|---|---|---|
| Value conservation | on-chain `cash` == net of every value in/out (fund+repay − draw−defund−fees−yield) | `cash` mutated only in `fund`/`repay`(+) and `draw`/`defund`/`claim_yield`/`withdraw_fees`(−) | Fuzz INV1 after every op + `test_inv1_value_conservation_on_a_fixed_script` |
| `_debt_of` single predicate | a line is "clear" iff `principal + fee_accrued + interest_accrued == 0` | `_debt_of` backs opening-detection (`draw`), reassess/appeal guards, `_service_one`, and full-settlement in `repay` | `test_interest_only_debt_keeps_line_open_and_blocks_reassessment`, `test_fee_only_debt_is_still_serviced` |
| Utilization buffer (draw) | `(total_principal + amt)·10000 ≤ util_cap·total_funded` | `draw` lines 886–889 | `test_pool_utilization_cap` |
| Utilization buffer (defund) | redemption may not push principal above cap of **remaining** capital; handles `new_funded == 0` | `defund` lines 1080–1086 | `test_defund_respects_utilization_cap` |
| Identity cap | grade capped at `C` unless ≥ 1 ownership-proven item (`any_owned`) | `_run_panel` (`cap = GRADES[-1] if any_owned else UNOWNED_GRADE_CAP`), re-derived in `validator_fn` | `test_unowned_evidence_is_capped_at_floor_grade`, `test_ownership_proof_unlocks_higher_grade`, `test_image_evidence_vision_path` |
| Fail-closed assess | malformed reply → one `DENY` vote; panel exception or malformed consensus payload → raise / `False` | `_parse_assessment`, `leader_fn` except-arm, `validator_fn` | `test_malformed_grade_fails_closed_to_deny`, `test_non_json_reply_is_deny_vote_not_revert`, `test_validator_rejects_different_grade` |
| Bounded autonomy | `requested_tokens ≤ AAA`; draws bounded by line/cash/min/cap; `service_book` bounded batch (`MAX_SERVICE_BATCH=25`); autonomous heartbeat ≤ one roster pass | `request_credit`, `draw`, `service_book` | `test_requested_tokens_bounds`, `test_autonomous_self_emit_is_safe_noop_in_direct_mode` |
| Two-step ownership + role reset | `transfer_ownership` nominates; `accept_ownership` requires `sender == pending_owner`; resets `guardian = relayer = owner` | `transfer_ownership` / `accept_ownership` | `test_two_step_ownership_transfer`, `test_ownership_transfer_resets_delegated_roles` |
| Per-line APR / no retroactive repricing | `rate_bps` snapshotted from `interest_bps` only on the opening draw; `_accrue_interest` uses `b.rate_bps`, never the live global | `draw` line 900, `_accrue_interest` | `test_enabling_apr_does_not_backcharge_existing_line` |
| Yield accounting | O(1) MasterChef accumulator; `fund`/`defund` harvest before changing `funded`; floor-division dust returned to protocol; lenders ≤ `yield_distributed` (+ bounded dust) | `_acc`/`_pending_raw`/`_harvest`/`_accrue_lender_yield` | Fuzz INV6/INV7/INV8 + `test_repay_fee_split_is_conserved`, `test_fee_split_with_no_lenders_is_all_protocol_revenue` |

Additional fuzz invariants verified after every op: `cash ≥ 0` (INV2); pool
`outstanding_principal`/`outstanding_fees` equal the per-borrower sums (INV3/4);
`active_lines` equals borrowers carrying debt (INV5); `sum(funded) == total_funded` (INV6);
`pending_yield` monotone non-decreasing except by the exact `claim_yield` amount (INV7);
`principal ≤ credit_limit` (INV9); and the oracle never reports more drawable credit than the
raw line (INV9b cross-view).

**Interest coverage (at audited HEAD `95ef796`).** The seeded fuzz driver enables a non-zero
interest APR on ~85% of seeds (the committed default `SEED=1234` enables it, at a seeded
rate), advances the consensus clock between ops (`drv.tick()`) so interest genuinely accrues
on open lines, and — when an APR is live — **asserts that interest actually accrued**
(`interest_sweeps > 0`), so the interest invariants are never vacuously satisfied. With
interest live the suite also checks INV11 (`outstanding_interest` == sum of
`interest_accrued`), INV12 (every borrower's reported `owed` == principal + fee + interest),
and a **corrected INV5** that counts a line as active on the contract's full `_debt_of`
predicate (so an interest-only line is correctly counted). This closes the interest
fuzz-coverage gap. Important provenance: **this interest coverage landed via a concurrent commit
(`95ef796`) during this audit** (§1.5); it is present at the audited HEAD but was absent from the
start-of-audit tree `779bedb`, where interest was covered only by the deterministic
`TestInterest` scenarios (and the fuzzer ran with interest off, counting "active" as
`principal + fee > 0`).

---

## 4. Security properties and trust model

- **Consensus re-derivation.** `assess`/`appeal` run the panel in `gl.vm.run_nondet_unsafe`.
  The leader computes a grade; each validator re-runs the whole panel (re-fetching every URL,
  re-judging every persona) via its own `leader_fn` and accepts only if its own
  strict-majority floor equals the leader's grade, after first rejecting any ill-formed
  payload (`grade` out of set, `votes` wrong length/out of set, or
  `grade > floor(votes)`). Consensus is on the **bounded six-value grade**, not raw page bytes
  and not the free-text rationale (which is advisory). A page that drifts enough to flip the
  majority fails closed — no assessment is written, nothing is lent. Agreement guarantees
  *agreement*, not ground truth (documented in THREAT_MODEL §3).

- **Money on finalized timing.** All value movement uses
  `emit_transfer(..., on="finalized")` and cross-contract calls are asynchronous finalized
  messages; there is no synchronous external call that could re-enter mid-state. The governor
  flips a proposal to `executed` **before** dispatching the external Credence call
  (checks-effects-interactions).

- **Guardian — pause, not unpause.** `set_paused(True)` is callable by owner/relayer/guardian;
  `set_paused(False)` only by owner/relayer. A compromised guardian can therefore never lift
  an emergency pause (`test_guardian_may_pause_but_not_unpause`), and holds no power over funds
  or economics.

- **Owner-only economics.** `withdraw_fees`, `set_risk_limits`, `set_interest_bps`,
  `set_terms`, `set_relayer`/`set_dev`/`set_guardian`, `set_autonomous`, and ownership transfer
  are owner-only. The owner can withdraw **protocol revenue** (`fee_revenue`) but **not** lender
  principal or lender yield — those are separate balances paid only to their owners via
  `defund`/`claim_yield`. `CredenceGovernor` is the recommended production mitigation for the
  single-owner trust assumption.

- **Soulbound passport.** `CredencePassport` has, by construction, no method that moves a
  passport between addresses — reputation cannot be bought, sold, or delegated.

- **Injection defenses (defense in depth).** Every borrower field and every fetched byte is
  untrusted data: NFKC normalization + invisible/control-char stripping (`_sanitise`); a
  write-time regex screen that rejects obvious command patterns before any model runs
  (`_check_clean`/`_CONTROL_RE`, tested in `test_injection_rejected_in_purpose_and_evidence`);
  and `_neutralise`, which strips prompt-delimiter runs **and** the protocol's own structural
  tokens from untrusted + fetched text so a hostile page cannot forge a section boundary. The
  URL charset excludes angle brackets/quotes/backticks/whitespace, so a URL cannot smuggle a
  delimiter (tested). Deterministic exact-match sybil detection (`evidence_owner`) feeds the
  panel a protocol-verified reuse flag.

### Trust model (who must be trusted)

| Actor | Trusted for | Not trusted for |
|---|---|---|
| **Owner** | pause/terms/autonomy/relayer-dev-guardian, **revenue** withdrawal | lender principal, lender yield (cannot touch either) |
| **Relayer** | shares the pause right (keeper hook) | economics, funds |
| **Guardian** | pause only | unpause, funds, economics |
| **Keeper (anyone)** | may call `assess` / `service_book` permissionlessly | nothing — effects are clock-deterministic and bounded |
| **Validator set / leader** | honest re-derivation of the grade under consensus | see §5.3-#3: the *grade/line* is consensus-protected, but non-grade payload fields (stored provenance) are not independently re-agreed |
| **GenVM platform** | `web.render` egress/SSRF policy, LLM availability, fetch limits | — (a platform dependency, not a contract guarantee) |
| **LLM panel** | reasonable judgment | correctness/stability — the bounded grade, strict-majority floor, DENY default, and identity cap are the *containment*, not a correctness proof |

---

## 5. Residual risks & explicit assumptions

### 5.1 Stated plainly (as the task requires, and as the project's own docs disclose)

1. **No persistent Bradbury deployment.** The suite is proven end-to-end only on
   **studionet** (chain `61999`, hosted Studio simulator), which is a shared sandbox that is
   **periodically reset**, so the recorded addresses/tx hashes are **ephemeral**. There is **no
   public-testnet (Bradbury, chain `4221`) deployment and no Bradbury transaction hash**; the
   docs state this repeatedly and do not claim otherwise (README, MILESTONE, PITCH, DEPLOY).
   See §5.2 for exactly what the recorded evidence does and does not establish.
2. **Consensus-clock monotonicity assumed.** Delinquency and interest are derived from
   `gl.message_raw["datetime"]` parsed deterministically by `_epoch` (fails closed on a bad
   clock). Correctness of overdue/default/interest timing assumes a monotonic consensus clock.
3. **Sub-unit yield/interest dust.** Floor division in the yield accumulator and in interest
   accrual leaves dust-scale (base-unit, i.e. 1e-18-token) rounding. The invariant suite
   explicitly tolerates a bounded over-credit (`dust_tol = n_harvests + len(lenders) + 1`).
   See §5.3-#4 for a precise statement of the one place this is slightly *more* than a pure
   "surplus."
4. **Cross-contract calls unit-tested only on studionet.** The composability path
   (`CredenceGatedVault.claim` reading Credence; `CredencePassport.mint` reading Credence;
   `CredenceGovernor` driving Credence) is a **synchronous/finalized cross-contract** flow that
   gltest "direct" mode does not exercise; it is demonstrated by the studionet scripts
   (`compose_studio.py`, `governance_studio.py`, `passport_studio.py`) only, i.e. on the
   ephemeral sandbox. The direct-mode suite tests each contract in isolation.
5. **LLM/web limits undocumented upstream.** `web.render` fetch timeouts, max body, redirect
   handling, and SSRF/egress protection are **platform behaviour, not contract guarantees**;
   the contract validates URL scheme/shape and size-clips output but does not restrict the host.
6. **Owner is a trusted testnet admin.** There is no on-chain timelock or multisig on the core
   by default (the governor is opt-in). This is a **testnet primitive**; undercollateralized
   credit means a wrong AI grade is a real, unrecoverable loss, and the LLM's substantive
   judgment is not proven correct/unbiased/stable across model versions.

### 5.2 What the recorded deployment evidence actually proves

`docs/DEPLOY.md`, `docs/COMPOSABILITY.md`, and `docs/PASSPORT.md` record studionet runs dated
2026-11-03 with concrete deploy/contract/call tx hashes (e.g. DEPLOY.md deploy tx
`0x8a50…1f22`, contract `0x2139…115c`, `request_credit` tx `0xeef9…e96f8`). This audit
**cannot and does not independently re-verify** those hashes: studionet is ephemeral and
resets, so the addresses are no longer live and the transactions are not reproducible after
reset. The honest reading is: **the contracts deploy and run on a GenLayer Studio chain** (the
runbooks are reproducible and the lint/validate gate confirms the ABI is well-formed), but the
specific recorded txs are sandbox artifacts, not a persistent public-chain record. The audit
does **not** assert a live Bradbury tx exists — none does.

A new `docs/LIVE_EVIDENCE.md` (committed mid-audit as `55f23bf`, §1.5) consolidates the
studionet tx trail — including an `assess`-**consensus** tx (the flagship AI path, not merely
`request_credit`), the gated-vault composability flow, and the governor and passport flows,
each with recorded addresses/hashes. It strengthens the *studionet* proof but **explicitly
states** that a persistent **Bradbury** (chain `4221`) deployment is "pending a faucet captcha
and is NOT represented here … not yet done," which is consistent with §5.1-#1 and does not
change the deployment gap.

### 5.3 Findings from this audit's own pass (independently derived)

Second-model (Codex) + hand re-derivation. **No critical or high-severity defect.** All items
are LOW/INFO. Where Codex rated higher, I give my calibrated severity and reasoning.

**[NEW · LOW] F-1 — Utilization cap is skipped when `total_funded == 0`.**
`draw` guards the cap with `if util_cap < 10000 and total_funded > 0:` (lines 886–889). If all
lenders have redeemed (`total_funded == 0`) but pool `cash` remains (retained `fee_revenue`
and/or unclaimed `yield_claimable`), a borrower with a still-approved line can `draw` against
that cash even under a 0% cap. *Blast radius:* no live lender **principal** exists in this
state, so no principal can be lost; the cash at risk is protocol-owned revenue plus — in a
contrived sequence (lenders defunded but not yet `claim_yield`'d, then the borrower defaults)
— already-earned-but-unclaimed lender yield. Reachable but operator-misconfiguration-gated
(requires the owner to have set `cap < 10000` while funded is zero). *Codex rated this MEDIUM;
I assess LOW* because it cannot touch funded principal and requires an unusual config. *One-line
fix:* drop the `total_funded > 0` conjunct (or treat zero funded + `cap < 10000` as "no new
draws"). `defund` already holds the cap on the exit side, so this is the only asymmetric gap.

**[KNOWN/PARTLY-DOCUMENTED · LOW] F-2 — The identity cap is global-per-application, not
per-item.** `any_owned` becomes true if *any one* URL item shows the applicant's address, and
that lifts the deterministic `C` ceiling for the **whole** application — after which a high
grade can rest on *unowned* third-party evidence if the LLM panel is persuaded. The
*deterministic* guarantee is therefore "≥ 1 owned item exists," not "the high grade is based on
owned evidence of capacity"; the latter is enforced only by the prompt instruction (rule 2:
A/AA/AAA "requires ownership-PROVEN evidence") and the strict-majority floor. The README/PITCH
claim "without a proven item the grade is capped at C no matter how enthusiastic the panel" is
**true**; the nuance that a *proven item elsewhere* can unlock a grade leaning on *unproven*
financials is real and worth a steward's attention. *Codex rated MEDIUM; I assess LOW* (still
requires the applicant to prove control of a page **and** fool a 3-of-panel strict majority
explicitly instructed to discount unproven items). Aligns with THREAT_MODEL §1/§13 residuals.

**[NEW · LOW] F-3 — `validator_fn` re-agrees only the grade, not the stored provenance
metadata.** The validator compares `mine["grade"] == data["grade"]` and well-formedness, but
does **not** compare the leader's `any_owned`, the `votes` vector, or the `snapshots`
(excerpts, `fetched_sha256`, per-item `ownership_proven`) against its own re-derivation.
`_apply_result` then stores those accepted leader fields. A **malicious leader validator** could
therefore store a spuriously-true `ownership_proven` flag or fabricated evidence
excerpts/hashes **when doing so does not change the grade** (a forged `any_owned` that *would*
change the grade is caught, because the validator re-derives the grade with its own
`any_owned`). *Impact:* corruption of the on-chain **audit trail / provenance only** — it
cannot extend a larger line than the honest consensus grade, and `b.ownership_proven` is
informational (no draw/limit logic branches on it). A malformed `snapshots` element would abort
`_apply_result` after consensus, i.e. griefing that **fails closed** (no assessment written).
*Codex rated MEDIUM; I assess LOW* (no fund/line impact; requires a malicious leader).
THREAT_MODEL §3 already discloses that non-grade fields are not byte-re-agreed; it does not
explicitly name `ownership_proven`/snapshots. *Hardening option:* also compare `any_owned`
(and ideally the vote vector / snapshot ownership flags) in `validator_fn`.

**[NEW · LOW/INFO] F-4 — The "rounding only ever leaves a surplus, never a deficit" claim is
slightly optimistic.** In `_accrue_lender_yield`, when `amount·ACC_SCALE // total_funded`
rounds such that `distributed == 0`, the full `amount` is returned as "leftover" and booked to
`fee_revenue`, **yet `acc_yield_per_share` is still incremented by `inc`**. Accumulated across
calls, those sub-unit increments can later cross the rounding threshold and make a lender's
`pending_yield` become claimable — so the same sub-unit of value is booked to protocol revenue
*and* (eventually) credited to a lender. This is exactly why the invariant suite carries a
positive `dust_tol` rather than asserting `credited ≤ yield_distributed`. *Practical impact:*
dust-scale (≤ ~`n_harvests + lenders` base units over the pool's life; base unit = 1e-18
token) and **bounded**; because every payout (`defund`/`claim_yield`/`withdraw_fees`) is
liquidity-gated against live `cash`, it can **never drive cash negative or transfer another
party's principal** — in the worst case a trailing dust unit of a claim is simply
unsatisfiable. So Codex's phrasing "withdrawals can consume lender principal" overstates it; the
accurate statement is a bounded dust **over-promise**. *Recommendation:* soften the SECURITY.md
/ THREAT_MODEL "never a deficit" wording to match the suite's own `dust_tol`, or retain the
leftover in the accumulator instead of double-booking it.

**[INFO] F-5 — Default standing penalty is keeper-timing path-dependent.** A line serviced once
*inside* grace (−8 overdue) and again *after* grace (−40 default) ends at standing 2; a line
first serviced only after grace loses just −40, ending at 10. Same repayment history, different
reputation, depending on whether a permissionless keeper happened to sweep during the grace
window. No money impact (standing only feeds future assessments' rep block and on-time-reward
eligibility); default counting itself is idempotent, and inline servicing in `repay` prevents
repaying-ahead-of-a-sweep from erasing a real default.

**[INFO] F-6 — Interest flooring per touch is minimizable by frequent permissionless
servicing.** `_accrue_interest` floors each interval and always advances `last_accrual`, so
repeatedly touching a small line via `service_book` can keep accrued interest at ~0. It is
**off by default**, borrower-favorable (reduces debt, not a theft), dust-scale for realistic
principals, and already disclosed in THREAT_MODEL §14 ("accrual floors borrower-favorably").

None of F-1…F-6 blocks submission. F-1, F-3, and F-4 are the ones a maintainer may wish to
address (each is a one-to-few-line change) to tighten the cap, the provenance trail, and the
rounding wording respectively.

### 5.4 Documentation inconsistencies (not code defects, but a steward will notice)

- **`docs/PITCH.md` is stale at v1.1 numbers.** It states "27 methods", "48 passing
  direct-mode tests (42 scenario + 6)", "adversarially reviewed twice", and "27 methods (11
  view, 16 write)". The current reality (and the CHANGELOG/README) is **31 core methods (11
  view, 20 write)**, **69 tests (61 + 8) at the audited HEAD `95ef796`** (§1.5), and
  **four/five review cycles**. Recommend syncing PITCH to v1.4 before submission.
- **`CHANGELOG.md` now lags the suite count.** Its v1.4 entry still states "**67 tests** …
  61 scenario + 6 property/invariant"; the committed suite is now **69** (61 + 8) after commit
  `95ef796` (§1.5). A one-line CHANGELOG update would resolve it.
- **`SECURITY.md` is stale at v1.2.** Its supported-versions table and body reference
  `VERSION = "1.2.0"` and name only `credence.py` + `credence_gated.py` as in-scope, omitting
  the governor and passport. Recommend bumping to 1.4.x and adding the two newer contracts to
  scope.
- `SECURITY.md` and `THREAT_MODEL.md` contain a `<SECURITY_CONTACT>` placeholder; the milestone
  portal form and PITCH contain `<CREDENCE_REPO_URL>` / `<BRADBURY_DEPLOY_TX>` placeholders —
  expected pre-publication, noted for completeness.

---

## 6. Gate results (captured for this audit)

### 6.1 `genvm-lint check` (lint + validate) — all four contracts PASS

```
contracts/credence.py            ✓ Lint passed (3 checks)  ✓ Validation passed
                                 Contract: Credence           Methods: 31 (11 view, 20 write)
contracts/credence_gated.py      ✓ Lint passed (3 checks)  ✓ Validation passed
                                 Contract: CredenceGatedVault Methods: 9 (4 view, 5 write)
contracts/credence_governor.py   ✓ Lint passed (3 checks)  ✓ Validation passed
                                 Contract: CredenceGovernor   Methods: 8 (5 view, 3 write)
contracts/credence_passport.py   ✓ Lint passed (3 checks)  ✓ Validation passed
                                 Contract: CredencePassport   Methods: 11 (6 view, 5 write)
```

Each run also prints an advisory that a newer `py-genlayer` runner is available than the one in
the `Depends` header — informational only; the pinned runner validates clean.

### 6.2 `genvm-lint typecheck` — all four contracts PASS

```
credence.py            ✓ No type errors found
credence_gated.py      ✓ No type errors found
credence_governor.py   ✓ No type errors found
credence_passport.py   ✓ No type errors found
```

### 6.3 `pytest tests/direct -q` — 69 passed (audited HEAD `95ef796`)

```
69 passed in 12.01s
```

Split (by `--collect-only`): `tests/direct/test_credence.py` = **61**;
`tests/direct/test_invariants.py` = **8** (1 seeded fuzz over 400 ops + 7 deterministic
property/edge tests, including the interest-invariant additions described in §1.5). Run under
the real GenVM SDK in-process, SDK runner pinned to `v0.2.16`, LLM mocked by regex and web
fetch mocked by URL; `emit_transfer` is a no-op in direct mode, so value flows are asserted
through the contract's own accounting.

> The first gate run captured during this audit, against the start-of-audit tree `779bedb`, was
> `67 passed in 9.40s` (61 + 6). The audited HEAD `95ef796` is 69 after the §1.5 commit. Both
> states are fully green; the delta is 2 added interest-invariant tests + expanded fuzz
> coverage, no removed or failing tests.

### 6.4 `node --test` in `adapter/` — 24 passed

```
# tests 24
# pass 24
# fail 0
```

The adapter's tests include the hardening parity checks (injection screen, NFKC/invisible
normalization idempotence) and confirm the off-chain per-item evidence digests match the
contract's canonical-JSON sha256 scheme.

---

## 7. Readiness verdict against the GenLayer steward rubric

| Dimension | Assessment | Evidence |
|---|---|---|
| **Impact / usefulness** | **High.** Directly attacks DeFi's headline unsolved problem (undercollateralized credit) and *is* GenLayer's thesis — adjudication for the agentic economy — rather than an illustration of it. A complete two-sided loop (fund → assess → draw → repay → yield/defund) usable by humans and agents, plus a composable credit oracle other contracts already consume. | §2; `credit_of`/`is_creditworthy`; `CredenceGatedVault` |
| **Effort** | **High.** Four cooperating Intelligent Contracts (consensus underwriting engine, full lending state machine, O(1) yield accumulator, interest accrual, self-servicing loan book, M-of-N governor, soulbound passport), plus two test suites, a seeded value-conservation fuzzer, an off-chain evidence adapter, a typed SDK, a Next.js dApp, CI, and a deep doc set. Five review/harden cycles in the commit trail. | §1.4, §2, repo survey |
| **Scope** | **Strong & coherent.** Self-contained, with deliberately conservative bounds (six grades, fixed panels, ≤ 8 evidence items, ≤ 1 image, ≤ 100% APR cap, bounded service batches, bounded paginated views) that are the right design for undercollateralized lending. | §2, §3 |
| **Quality** | **High.** Lint + validate + typecheck clean on all four contracts; 69 direct-mode tests at the audited HEAD `95ef796` (67 before two mid-audit commits, §1.5) + seeded fuzzer + 24 adapter tests green under the real SDK; consensus tested on the *decision*, not just schema; independent second-model review found **no critical/high defect**. Deductions: PITCH/SECURITY docs are version-stale (§5.4); three LOW code tighten-ups open (§5.3 F-1/F-3/F-4). | §3–§6 |
| **Community** | **Good.** MIT-licensed forkable template, CI, CONTRIBUTING, a reusable documented pattern (bounded-categorical output + independent re-judgment + live-web read inside the consensus block), referral `JTR01FHP` published. | repo; README; `#CreditWithoutCollateral` |

**Overall:** **Submission-ready for the milestone, strong on four of five rubric dimensions.**
The single thing standing between this and a clean top-tier score is **persistent
public-testnet (Bradbury) deployment** — the project is honest that it has only the ephemeral
studionet runs and no Bradbury tx hash. For maximum points a steward will want a durable
on-chain record. Landing the Bradbury deploy (and, optionally, the three LOW tighten-ups and
the two doc-sync fixes in §5.4/§5.3) closes the only material evidence gap. Nothing in this
audit overstates the deployment status, and no live Bradbury transaction is claimed to exist —
because none does yet.

---

*Prepared as an independent pre-submission audit. Gate outputs in §6 were produced by running
the gates during this audit. The second-model pass used Codex (`gpt-6.1-sol`) read-only; every
relayed finding was re-derived against the source. `#CreditWithoutCollateral` · referral
`JTR01FHP`.*


---

## Post-audit addendum (after HEAD `95ef796`)

The two LOW tighten-ups this audit left open in §5.3 were fixed immediately after the
audited snapshot (commit `b8113fb`), each with a regression test:
- **F-1** — `draw` now also blocks under a utilization cap when `total_funded == 0`
  (protocol-owned cash can no longer be lent uncapped).
- **F-3** — `validator_fn` now re-agrees the evidence ownership flag (`any_owned`), not
  just the grade, so a Byzantine leader cannot store a falsified provenance/cap basis.

F-4 (sub-unit yield-accumulator dust) is retained as documented, bounded, liquidity-gated
dust (the invariant fuzz tolerates it). With the F-1 test added, the direct-mode suite is
now **70 tests (62 scenario + 8 invariant)**, all green; lint + typecheck remain clean on
all four contracts. The one material gap for a top score is unchanged: a persistent
Bradbury deployment with a public tx hash.
