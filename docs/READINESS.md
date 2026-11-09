# Credence — Readiness Assessment

**Date:** 2026-11-03
**Target:** the Credence four-contract suite (`VERSION = "1.4.0"`) at
`GenLayer_Submissions/credence`.
**Discipline:** evidence-graded. Every claimed pass carries evidence — a file path, a test
name, a gate line, or a live transaction hash. Scores reflect what is **built and verified**,
not what is ambitious. Gates were **re-run for this assessment**, not copied from the docs; the
studionet latencies were **measured live** (see [`COST_AND_FINALITY.md`](COST_AND_FINALITY.md)).

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## 0. Verification performed for this assessment (what I actually ran)

| Gate | Command | Result (observed) |
|---|---|---|
| Lint + validate (×4 contracts) | `genvm-lint check contracts/<c>.py` | **PASS** — all four: `✓ Lint passed (3 checks)` + `✓ Validation passed`. Methods: Credence 31 (11 view / 20 write); GatedVault 9 (4/5); Governor 8 (5/3); Passport 11 (6/5). |
| Typecheck (×4 contracts) | `genvm-lint typecheck contracts/<c>.py` | **PASS** — all four: `✓ No type errors found` (pyright 1.1.414). |
| Direct-mode suite | `pytest tests/direct -q` | **70 passed in 9.56 s** (SDK runner pinned `v0.2.16`). |
| Test split | `pytest … --collect-only` | `test_credence.py` = **62**; `test_invariants.py` = **8**. Total **70** — reconciles with the CHANGELOG. |
| Off-chain adapter | `node --test` in `adapter/` (node v22.23.4) | **24 passed / 0 failed** in ~124 ms. |
| Live studionet run | `genlayer_py` timed deploy→view→write→assess | **deploy 8.18 s, view 1.52 s, request_credit 10.44 s, assess (LLM) 30.39 s**; assess returned a correct unanimous DENY on empty evidence. Tx hashes in `COST_AND_FINALITY.md §1`. |

All green. The suite reproduces exactly; the live run reproduces the fail-safe behaviour
recorded in `LIVE_EVIDENCE.md`.

---

## 1. ARCHITECTURE FIT — **9 / 10**

> Does the system use GenLayer for what only GenLayer can do, with clean separation, minimal
> on-chain footprint, canonical evidence commitments, a *genuine* consensus primitive, real
> identity/permission binding, and correct finality semantics?

| Criterion | Finding | Evidence |
|---|---|---|
| **Separation of concerns** (4 standalone contracts + off-chain adapter / SDK / keeper) | **Strong.** Four single-responsibility Intelligent Contracts, each independently deployable: core protocol+oracle; a consumer that holds no tokens and reads the oracle; an M-of-N governor that owns the core with zero core changes; a soulbound passport. Off chain: a zero-dependency evidence adapter, a typed SDK, and a permissionless keeper entrypoint. | `contracts/credence.py` (core), `credence_gated.py`, `credence_governor.py`, `credence_passport.py`; `adapter/` (adapter); `sdk/` (TS client); `service_book` (permissionless keeper). Topology diagram in `ARCHITECTURE.md §6`. |
| **Minimal / justified use of the chain** | **Good.** The chain carries only what needs consensus — the grade decision and money. Evidence is bounded (`MAX_EVIDENCE_ITEMS=8`, ≤1 image), fetched text is clipped to 2,400 chars and stored as a ≤600-char excerpt + sha256, screenshots are stored as a **sha256 only** (never raw bytes), servicing is batch-bounded (`MAX_SERVICE_BATCH=25`), every roster/registry view is paginated (`MAX_PAGE=50`). | `credence.py`: `_parse_evidence`, `MAX_FETCH_CHARS`, `MAX_STORED_EXCERPT_CHARS`, `page_borrowers`, `service_book`. |
| **Canonical records + evidence commitments** | **Strong.** Every evidence item is committed as a sha256 over canonical JSON (`sort_keys, separators=(',',':'), ensure_ascii`); the off-chain `adapter` adapter reproduces the **byte-identical** hash and is tested against pinned CPython vectors (ASCII + non-ASCII NFKC). A whole-bundle `bundleSha256` binds the application. This is a real, auditable commitment layer, not a hand-wave. | `credence.py` `_canon`/`_digest`/`_parse_evidence`; `adapter/src/canon.mjs`; `adapter` tests `per-item sha256 equals the contract formula`, `digest matches CPython … vectors` (24/24 pass). |
| **Genuine consensus primitive (re-derived decision, not schema-only)** | **Strong.** `assess`/`appeal` run a 3- (or 5-) persona LLM panel in `gl.vm.run_nondet_unsafe`. The validator does **not** merely schema-check: it re-runs the whole panel (re-fetches each URL, re-prompts each persona), recomputes the strict-majority floor **and** the identity cap **and** (post-audit F-3) the `any_owned` flag, and accepts only if its own grade matches the leader's. Consensus is on a bounded 6-value grade, not raw bytes. | `credence.py` `_run_panel` `leader_fn`/`validator_fn` (lines ~592–705); tested by `test_validator_rejects_different_grade`, `test_approve_sets_line_and_consensus_holds` (`run_validator() is True`), `test_grade_floor_is_majority_backed`. Live consensus on studionet: assess tx `0xfb10c286…0b9e`, votes `[DENY,DENY,DENY]`. |
| **Privacy / permission + identity-cap** | **Good.** Identity binding is a deterministic DNS-TXT-style challenge: a URL proves ownership iff the fetched page displays the applicant's own address; without a proven item the grade is capped at `C` and this cap is re-derived by every validator. Permissioning is layered: owner-only economics, a guardian that may pause but not unpause, two-step ownership transfer that resets delegated roles, and a soulbound passport (no transfer/approve exists by construction). Privacy: only clipped excerpts + hashes reach the chain. | `_run_panel` (`cap = GRADES[-1] if any_owned else UNOWNED_GRADE_CAP`), `_cap_grade`; `set_paused` guardian logic; `accept_ownership` role reset; `credence_passport.py` (no transfer method). Tests: `test_unowned_evidence_is_capped_at_floor_grade`, `test_guardian_may_pause_but_not_unpause`, `test_ownership_transfer_resets_delegated_roles`. |
| **Correct finality semantics** | **Strong.** All value movement and all cross-contract writes are `on="finalized"`; `assess` only writes a grade/limit (an authorisation), and tokens move only on a later finalized `draw`. Governor flips a proposal to `executed` before the external emit (checks-effects-interactions). | `emit_transfer(..., on="finalized")` in `draw`/`defund`/`claim_yield`/`withdraw_fees`; `.emit(on="finalized")` in `CredenceGovernor._dispatch` and the autonomous `service_book` re-emit; mapped in `COST_AND_FINALITY.md §3`; `THREAT_MODEL.md §6`. |

**Why 9 and not 10.** The architecture genuinely does the thing GenLayer exists for — gating
native value on an in-consensus AI reading of live web evidence, with the decision independently
re-derived — and every criterion is met with verifiable code and tests. One honest design
residual holds it off a perfect score: the **identity cap is global-per-application, not
per-item** (`any_owned` lifts the C ceiling for the whole application if *any one* URL proves
ownership, after which a high grade can lean on *unproven* third-party evidence if the panel is
persuaded — audit finding **F-2**, `AUDIT.md §5.3`). The deterministic guarantee is therefore
"≥1 owned item exists," slightly weaker than the headline. It is a LOW-severity nuance (still
needs a proven page **and** fooling a strict majority explicitly told to discount unproven
items), but it is a real architectural caveat on the identity-cap criterion. (Separately, the
cross-contract composability is a design that direct-mode gltest cannot exercise — it is proven
only on a live network — which is scored under Integration, not here.)

**Why not lower.** Nothing here is aspirational: the consensus re-derivation is real and tested,
the commitment layer is byte-reproduced off-chain against CPython vectors, and finality is
enforced in source on every transfer. This is a top-decile GenLayer architecture.

---

## 2. INTEGRATION READINESS — **7 / 10**

> Is it a working, independently-validated, deployed, composable, reproducible, security-tested,
> cost-measured, well-documented system — or just a contract in a repo?

| Criterion | Finding | Evidence |
|---|---|---|
| **Working standalone contract(s)** | **Met.** All four lint + validate + typecheck clean; 70 direct-mode tests pass against the real GenVM SDK in-process. | §0 gates. |
| **Independently-validated consensus** | **Met.** Validator re-derivation is enforced and tested (schema gate → re-run panel → grade must match); live consensus observed on studionet. | `test_validator_rejects_different_grade`; live assess tx `0xfb10c286…0b9e`. |
| **Real testnet deployment** | **Partial — the main gap.** Proven **only on studionet** (ephemeral, resets). I re-verified a live deploy today (contract `0x528F7b10…9b391`, deploy tx `0x814831b6…ab4c`). There is **no persistent Bradbury (chain 4221) deployment and no Bradbury tx hash** — the project states this plainly. | `COST_AND_FINALITY.md §1`; `LIVE_EVIDENCE.md`; `AUDIT.md §5.1`. |
| **Composability demo** | **Met, but studionet-only.** `CredenceGatedVault` admits a grade-C borrower by reading Credence's `credit_of` across contracts; passport mints across contracts; governor drives Credence by quorum. All demonstrated on the ephemeral sandbox, not in CI/direct mode (cross-contract calls need a live host). | `scripts/compose_studio.py`, `passport_studio.py`, `governance_studio.py`; `LIVE_EVIDENCE.md §2–4`; `ARCHITECTURE.md §6`. |
| **Reproducible end-to-end demo** | **Met.** The `DEPLOY.md` runbook reproduces non-interactively; I reproduced deploy → view → write → consensus `assess` live today. Deterministic direct-mode suite reproduces offline. | `DEPLOY.md §3`; `COST_AND_FINALITY.md §4`; `scripts/`. |
| **Security testing** (the 5 reviews + audit + fuzz) | **Met.** Five adversarial-review-then-harden cycles visible in the git trail, each with named regression tests; a pre-submission `AUDIT.md` with an independent second-model (Codex) pass re-derived by hand (no critical/high; all LOW/INFO); a seeded value-conservation fuzzer (400 ops, 13 invariants incl. interest); 24 adapter parity tests. | `AUDIT.md §1.4/§5.3`; `tests/direct/test_invariants.py`; `CHANGELOG.md`. |
| **Cost / performance measurement** | **Partial.** Latency is now **measured live** (deploy 8.18 s, view 1.52 s, cheap write 10.44 s, consensus `assess` 30.39 s). **Fees are not measured** — studionet has no gas market, and Bradbury (where fees are real) is not deployed; no fee number is claimed. | `COST_AND_FINALITY.md §1–2`. |
| **Complete docs** | **Met, with minor staleness.** An unusually deep, honest doc set (ARCHITECTURE, THREAT_MODEL, AUDIT, DEPLOY, GOVERNANCE, PASSPORT, COMPOSABILITY, INTEGRATION, EVENTS, OPERATIONS, SECURITY, CHANGELOG, PITCH, + SDK/adapter READMEs). Deductions: `PITCH.md` stale at v1.1 numbers, `SECURITY.md` stale at v1.2, and placeholders (`<SECURITY_CONTACT>`, `<BRADBURY_DEPLOY_TX>`) remain. | `docs/`; staleness catalogued in `AUDIT.md §5.4`. |

**Why 7 and not higher.** Weighted honestly, as the brief requires: the one criterion that is
not met is **persistent public-testnet deployment + external usage**. studionet is a shared
sandbox that resets, so the recorded addresses/tx hashes — including the ones I captured today —
are **ephemeral artifacts, not a durable public-chain record**, and there is **zero evidence of
external/third-party usage**. For a GenLayer steward this is the single most load-bearing
integration signal, and it is absent. Cost measurement is also only half-complete (latency yes,
fees no, for the same reason). These two gaps cap the score.

**Why not lower.** Everything *around* the deployment gap is genuinely complete and verified by
me, not merely claimed: the functional deployment **works live** (I reproduced it), consensus
**runs live**, composability and governance **run live** on studionet, and the surrounding
apparatus — SDK, zero-dep evidence adapter, CI (`.github/workflows/ci.yml`), reproducible
scripts, and a deep doc set — is real and green. This is a well-integrated system missing one
(important) durability/adoption proof, not a thin demo. 7/10 reflects "production-shaped and
verified, pending a persistent deploy + real users."

---

## 3. Remaining blockers — and exactly what moves each score up

| # | Blocker | Severity | Moves which score | What specifically closes it |
|---|---|---|---|---|
| B1 | **No persistent Bradbury (chain 4221) deployment; no Bradbury tx hash; no external usage.** studionet is ephemeral. | **Material** (the headline gap) | **Integration +1 to +2** (7 → 8–9) | Clear the faucet captcha, deploy all four contracts to Bradbury, record durable public tx hashes, and ideally show ≥1 external address funding/borrowing or a second contract consuming `credit_of`. |
| B2 | **Fees unmeasured.** No real gas/fee figure (studionet has none). | Material (follows from B1) | **Integration** (part of the same +1) | On Bradbury, measure the real governance-set fee for deploy / `request_credit` / `assess` and add it to `COST_AND_FINALITY.md §2`. |
| B3 | **F-2: identity cap is global-per-application, not per-item.** A proven item elsewhere can unlock a grade leaning on unproven financials. | LOW | **Architecture +1** (9 → 10) | Make the cap per-item (a high grade must rest on an ownership-*proven* item of capacity), or re-derive per-item ownership in `validator_fn` and bind the cap to it; add a regression test. |
| B4 | **Composability not in CI/direct mode.** Cross-contract flows are proven only on studionet. | LOW | **Integration** (hardens the 8→9 step) | Add a live-network composability check to CI (or a GenVM host harness) so `GatedVault.claim` / `Passport.mint` / `Governor.execute` are gated automatically, not just by a manual script. |
| B5 | **Doc staleness:** `PITCH.md` (v1.1 numbers), `SECURITY.md` (v1.2 scope), unresolved placeholders. | LOW / cosmetic | **Integration** (removes the only "complete docs" deduction) | Sync PITCH/SECURITY to v1.4 and the four-contract scope; fill `<SECURITY_CONTACT>` / `<BRADBURY_DEPLOY_TX>` at publication. |

**Bottom line.** Architecture is essentially done (9/10; only F-2 stands between it and a 10).
Integration is production-shaped and verified (7/10) but gated on one load-bearing item: a
**persistent Bradbury deployment with public tx hashes and some external usage**. Landing B1/B2
is the highest-leverage move for the milestone score; B3–B5 are small, well-scoped follow-ups.

---

*Prepared under evidence-graded discipline: gates re-run and latencies measured live for this
assessment; no score awarded for ambition, only for built-and-verified capability. Code and
tests were read and executed, not trusted. `#CreditWithoutCollateral` · referral `JTR01FHP`.*
