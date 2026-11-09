# Milestone: Credence — "credit the chain can underwrite" (v1.1)

**Date:** 2026-11-03
**Contract:** `contracts/credence.py` (class `Credence`, GenVM Python SDK) — **27 methods**
(11 view, 16 write).
**Status:** compiles, **lints clean** (`genvm-lint check`, 3 checks) and **typechecks
clean** (`genvm-lint typecheck`), deploys and runs under the real GenVM SDK in-process,
and passes its full **42-test** direct-mode scenario suite (verified locally:
`42 passed`), alongside a companion property/invariant (conservation) suite
(`tests/direct/test_invariants.py`). CI runs the same gates on every push
(`.github/workflows/ci.yml`).
**Deployment:** **proven end-to-end on GenLayer studionet** (chain `61999`, hosted Studio
simulator — free, captcha-free; runbook + real evidence in `docs/DEPLOY.md`). **Not yet
deployed to the public Bradbury testnet** — that deploy is blocked on a faucet captcha,
so there is **no Bradbury transaction hash yet** (see
[Verifiable evidence](#verifiable-evidence)).

**New in v1.1.** A real two-sided market: **lender yield** via an O(1)
`acc_yield_per_share` accumulator (a share of each origination fee streamed pro-rata;
`fund`/`defund` harvest; `claim_yield`); **risk-priced** origination fees set by the AI
grade (`ORIGINATION_BPS_BY_GRADE`, C 400 → AAA 100 bps); lender **principal redemption**
(`defund`); a **composable credit oracle** (`credit_of` / `is_creditworthy`) —
judgment-as-a-service other contracts/chains can call; **events on every state
transition**; **bounded, paginated** roster reads (`page_borrowers`); and **two-step
ownership** (`transfer_ownership` + `accept_ownership`). The identity-bound evidence
grade cap and bounded autonomous servicing carry over from v1.

This writeup is organized around the GenLayer steward review rubric:
**Impact / usefulness · Effort · Scope · Quality · Community impact.** Each section
makes the honest case for that criterion, followed by what is proven vs pending and
the verifiable evidence list.

---

## Impact / usefulness

Every loan in DeFi today is **over-collateralized**: you must already lock up more
value than you borrow, because a deterministic contract can hold a deposit but cannot
*judge* a borrower. That design excludes the participants who most need credit and
leaves **undercollateralized lending — the largest unsolved problem in on-chain
finance — unsolved**. It is unsolved for exactly one reason: on every other chain,
nobody can read the evidence and decide.

Credence is a concrete, working primitive for precisely that decision:

- **It extends real undercollateralized credit.** A borrower posts no collateral the
  protocol can seize; the line is underwritten purely on evidence and reputation. The
  grade→line map is concrete (`DENY`/`C`/`B`/`A`/`AA`/`AAA` → 0/100/250/500/1000/2500
  tokens), lenders fund a real native-token pool, and draws and repayments move real
  value.
- **It is a working two-sided economic loop with revenue AND yield, not an accounting
  toy.** `fund` → `assess` → `draw` (risk-priced origination fee accrues) → `repay`
  (principal first, then fee **split** between lender yield and protocol revenue) →
  lenders `claim_yield` / `defund` and the owner `withdraw_fees`. Lenders earn a real,
  compounding position (an O(1) `acc_yield_per_share` accumulator distributes a share of
  every fee pro-rata), and the test suite asserts the full accounting end-to-end —
  including the pro-rata split across lenders (`TestYield`).
- **Credit is inherently recurring — and so is the usage it drives.** The repeat-use
  flywheel (repay on time → standing↑ → grade↑ → larger line) means a single borrower
  comes back, draws again, and generates usage over and over. That is the opposite of
  a one-shot demo.
- **It serves humans *and* autonomous agents.** An agent with an on-chain track
  record and a job to do can be underwritten the same way a freelancer with a revenue
  page can — which is exactly the constituency GenLayer positions itself for.

The usefulness is load-bearing for GenLayer's own thesis. GenLayer calls itself the
adjudication layer for the agentic economy; **underwriting a loan by reading a
borrower's live evidence under validator consensus** is a direct, high-value instance
of that thesis rather than an illustration of it. The same primitive — bounded
categorical output + independent re-judgment, with a live-web read inside the
consensus block — generalizes to insurance underwriting, grant eligibility, KYB
tiers, and agent-to-agent trust.

## Effort

Credence is a substantial, hardened build, not a single-shot prompt wrapped in a
contract:

- **A consensus underwriting engine.** The whole panel — live URL fetch plus three
  independent underwriter prompts — lives directly inside `leader_fn` (so the GenVM
  linter can see the non-deterministic calls are reachable), with a real
  `validator_fn` that re-runs the panel and agrees **only on the binding grade**. The
  binding grade is the **strict-majority floor** (`_grade_floor`: the strongest grade
  more than half the panel backs at-or-above), which makes a split panel resolve to
  the lender-safe grade instead of the optimistic one.
- **A full lending state machine.** `none → assessing → approved/denied`, plus
  `defaulted` and recovery, with an outstanding-line guard that blocks reassessment
  until the balance is settled, origination-fee accrual, principal-first repayment,
  overpayment rejection, and on-time-repayment rewards.
- **An autonomous, self-servicing loan book.** `service_book` walks a bounded batch
  from a rolling cursor and moves lines overdue → defaulted against the **consensus
  transaction clock** (not any node's wall clock), adjusting standing — permissionless,
  with no operator — and, when `autonomous` is enabled, re-emits itself as a finalized
  self-message: the closest thing GenLayer allows to a contract that keeps itself
  alive.
- **An evidence pipeline with deterministic sybil detection.** Typed evidence (text
  and URL kinds, per-kind size and format limits, label caps), per-item canonical-JSON
  sha256 commitments shared with the off-chain adapter, and an `evidence_owner` hash
  index that flags evidence reused across different addresses and feeds that flag to
  the panel as a protocol-verified fact.
- **A hardened input surface.** NFKC normalization, invisible/bidi and control-char
  stripping, a regex injection screen on purpose and every evidence label and text
  body, delimiter-neutralisation of *all* untrusted text including fetched web pages,
  strict `0x`-address validation, and an `https://`-only URL validator whose charset
  excludes the prompt delimiters.
- **Real money plumbing.** A native-token pool, undercollateralized draws, finalized-
  timing transfers, and owner-gated revenue withdrawal that never touches lender
  principal or lender yield.
- **An O(1) lender-yield engine (v1.1).** A MasterChef-style accumulator
  (`acc_yield_per_share` + per-lender `reward_debt`) streams a share of every origination
  fee to lenders pro-rata without any per-lender loop; `fund`/`defund` harvest first so
  deposits/withdrawals never retroactively grant or forfeit accrued yield;
  `claim_yield`/`defund` are liquidity-gated; rounding only ever leaves a solvent dust
  surplus (invariants in `docs/ARCHITECTURE.md`).
- **A composable credit oracle (v1.1).** `credit_of` / `is_creditworthy` expose a live,
  fail-safe creditworthiness read (conservative `unknown`/`DENY` for never-assessed
  addresses) as judgment-as-a-service for other contracts and chains — plus
  observability (an event on every state transition) and bounded, paginated roster reads.
- **The 42-test direct-mode scenario suite** (see Quality) and a companion
  property/invariant (conservation) suite, plus a complete `adapter/` adapter (24 passing
  tests) and a `frontend/` dApp (wired to v1.1; builds clean).

## Scope

The milestone is scoped to a coherent, self-contained unit of work:

- **In scope and delivered:** the `Credence` contract and its full lifecycle;
  consensus underwriting on live web evidence; the strict-majority grade floor;
  evidence commitments; deterministic sybil detection; the native-token lending pool;
  undercollateralized draw/repay with **risk-priced** origination fees; **lender yield**
  via the O(1) `acc_yield_per_share` accumulator with **principal redemption (`defund`)**
  and **`claim_yield`**; the **composable credit oracle** (`credit_of` /
  `is_creditworthy`); **events on every state transition**; **bounded paginated** roster
  reads; **two-step ownership**; the compounding-reputation flywheel; the autonomous
  self-servicing loan book; the input-hardening and access-control surface; and the
  documentation set (this file, the README, the architecture doc, the threat model, and
  the studionet deploy runbook).
- **Deliberately bounded:** six fixed grades; a fixed three-persona panel; evidence
  capped at eight items with per-kind size limits; origination fee capped at 10%.
  These bounds are design choices, not gaps — a small categorical output and a bounded
  panel are precisely what make validator consensus over a subjective, live reading
  tractable, and conservative caps are correct for *undercollateralized* lending.
- **Out of scope for this milestone (named honestly):** deployment to the public
  **Bradbury** testnet and a live Bradbury transaction (pending a faucet captcha, see
  below — studionet deployment is proven, `docs/DEPLOY.md`); a **variable ongoing APR**
  to lenders beyond the origination-fee share, and **explicit per-lender loss tracking**
  on default (a default is still borne by the pool as a whole, though lender principal
  and yield are now individually accounted and redeemable); and on-chain *semantic*
  reputation memory via `VecDB`, which the v0.2.16 runtime does not ship — so this build
  uses deterministic (hash-index) + LLM memory only, by design, so it actually deploys
  and is testable today.

## Quality

- **Runs under the real SDK.** The direct-mode suite deploys the contract through the
  **actual GenVM Python SDK in-process** (not a mock of the VM); the LLM is mocked by
  regex and the web fetch by URL, and `run_nondet_unsafe`'s captured validator is
  replayed with `run_validator`. A contract with an unreachable non-deterministic call
  would fail to load, so a green suite is also evidence the GenVM compile/lint pass
  accepts the contract.
- **Real consensus, tested.** `TestConsensus::test_validator_rejects_different_grade`
  asserts the validator returns **`False`** when re-judgment yields a different grade —
  i.e. consensus is enforced on the *decision*, not merely on output format.
- **42 direct-mode scenario tests, verified green** (`42 passed` locally),
  plus a companion property/invariant (conservation) suite run under the same
  `pytest tests/direct` gate, covering:
  - *Underwriting* — approve sets the line and consensus holds; the grade floor is
    majority-backed (panel `[A, AA, B]` → binding `A`); a minority approval
    (`[DENY, DENY, AAA]`) → DENY; a malformed grade (`"PLATINUM"`) fails closed to
    DENY; assessing an unknown borrower reverts.
  - *Live web evidence (flagship)* — the contract fetches a URL and grades on it; the
    fetched text **provably reaches** the underwriter prompt (a unique marker in the
    page flips the grade); an unreachable URL degrades to the placeholder instead of
    crashing.
  - *Lending* — the full fund/draw/repay flywheel with exact accounting (2% origination
    fee, standing 50→62 on on-time repay); draw requires approval; draw cannot exceed
    available credit or pool liquidity; overpayment and repay-with-nothing-outstanding
    revert; reassessment is blocked while a line is outstanding.
  - *Autonomous servicing* — overdue→default transitions against the consensus clock
    with standing penalties; `service_book` is permissionless and advances the cursor;
    the autonomous self-emit is a safe no-op in direct mode.
  - *Reputation / sybil* — reused evidence flags the second account (not the first);
    the sybil flag reaches the underwriter as a protocol-verified fact.
  - *Guards* — injection rejected in purpose and in evidence; evidence validation (bad
    kind, insecure/`http` URL, a URL carrying a `<<<END_EVIDENCE>>>` delimiter, and an
    over-limit item count); requested-token bounds.
  - *Pool / admin* — owner-only fee withdrawal with correct accounting; pause is
    staff-only and blocks intake; `set_terms` bounds; the config and stats surface.
  - *Lender yield (v1.1)* — a sole lender earns and claims the lender share of a fee
    (and a second claim reverts with nothing to claim); yield splits **pro-rata**
    across lenders (750 : 250 → ¾ : ¼ of the 1-token cut).
  - *Composable credit oracle (v1.1)* — `credit_of` returns a safe `unknown` record for
    an unseen address and the live grade/limit/standing after assessment;
    `is_creditworthy` gates correctly above/below a requested grade.
  - *Risk-priced fees + pagination (v1.1)* — the origination fee scales with grade
    (C = 400 bps → 4 tokens on 100; AAA = 100 bps → 1 token); `page_borrowers` returns
    bounded pages with a correct `next_offset`.
  - *Hardening (v1.1)* — the identity cap holds (a unanimous AAA vote on unproven
    evidence still yields C) and ownership proof unlocks the full range; the minimum
    draw is enforced; fee-only debt is still serviced to default; `defund` returns
    principal and is blocked when capital is lent out; two-step ownership transfer
    requires the nominee to accept.
- **Fail-closed by construction.** Malformed panel output coerces to DENY; a
  disagreeing validator or any exception writes no assessment and lends nothing. For a
  lender the safe default is always "do not lend," and the code honors that everywhere.
- **Documented.** A rich module docstring, a README with the method API table and a
  candid "why it needs GenLayer" section, a standalone **architecture doc**
  (`docs/ARCHITECTURE.md` — state machine, consensus flow, yield math, invariants,
  identity binding), a standalone threat model (`docs/THREAT_MODEL.md`), and a
  reproducible studionet deploy runbook (`docs/DEPLOY.md`).

## Community impact

- **Forkable template.** The repo is structured to be cloned and retargeted — contract,
  two test suites, CI (`.github/workflows/ci.yml`), the complete `adapter/` evidence
  adapter, and the `frontend/` dApp — so other builders can stand up a domain-specific
  on-chain underwriter (insurance, grants, KYB, agent trust) quickly. Referral code
  **`JTR01FHP`** is published in the README for new builders.
- **A reusable pattern, not just an app.** The "bounded categorical output +
  independent re-judgment, with a live-web read inside the consensus block" shape is
  documented explicitly so it can be lifted into other GenLayer contracts — here
  applied, for the first time in this family of milestones, to **gating real value**
  rather than recording a verdict.
- **Tackles the headline DeFi problem.** Undercollateralized credit is the problem the
  rest of DeFi cannot solve; demonstrating it on GenLayer is a strong, legible argument
  for what the chain uniquely enables.
- **Honest about its limits**, which is itself a contribution: the docs state plainly
  that consensus is on the grade (not raw bytes or the rationale), that a page changing
  between fetches fails an assessment closed (a liveness cost, not a wrong loan), and
  that `VecDB` semantic memory is deferred until the runtime ships it — useful guidance
  for anyone building credit primitives on the same base.

---

## What makes Credence different from prior single-shot GenLayer demos

| Area | Typical demo | Credence |
|---|---|---|
| Decision | one LLM call, trusted | panel of 3, **strict-majority grade floor**, every validator re-judges and must agree on the grade |
| Web | none | contract fetches URL evidence live; **every validator re-fetches and re-judges** |
| Stakes | records an opinion | **gates real native-token value** — a lender either lends or does not |
| Evidence | freeform | typed, size-bounded, canonical-JSON sha256-committed (adapter-reproducible) |
| Sybil | none | deterministic reused-evidence detection fed to the panel |
| Memory | none / stateless | compounding reputation (standing, grade, line) + hash-index sybil memory |
| Lifetime | runs when called | **self-servicing loan book** that can re-emit itself (autonomous heartbeat) |
| Revenue | none | **risk-priced** origination fee, **split** between lender yield and withdrawable protocol revenue |
| Lenders | none / passive | a **two-sided market**: lenders earn pro-rata **yield** (O(1) accumulator), redeem principal (`defund`), claim yield (`claim_yield`) |
| Composability | closed | a **credit oracle** (`credit_of` / `is_creditworthy`) other contracts/chains can call — judgment-as-a-service |

## Proven vs pending

**Proven (verified locally while writing this):**
- The contract compiles, **lints clean** (`genvm-lint check`, 3 checks) and
  **typechecks clean** (`genvm-lint typecheck`), and **deploys and runs under the real
  GenVM Python SDK** in direct mode.
- **All 42 direct-mode scenario tests pass** (`pytest tests/direct/test_credence.py` →
  `42 passed`), including the consensus-rejection test that proves agreement is on the
  decision, not the format, and the v1.1 yield / oracle / risk-pricing / defund /
  two-step-ownership tests. A companion property/invariant (conservation) suite runs
  under the same `pytest tests/direct` gate.
- **The `adapter/` adapter is complete and verified** — **24 passing tests**
  (`node --test`), including hash-parity tests that assert its per-item evidence digests
  equal the contract's `_digest(_canon(...))` output byte-for-byte.
- **Deploys and runs end-to-end on GenLayer studionet** (chain `61999`): deploy +
  `get_config`/`get_pool`/`get_borrower` views + a `request_credit` write all succeeded
  against a live deployed address (real output in `docs/DEPLOY.md`).

**Pending (stated plainly):**
- **No public-testnet deployment.** The contract has **not** been deployed to Bradbury;
  that deploy is blocked on a faucet captcha. There is therefore **no Bradbury
  transaction hash, no public on-chain record, and no point value yet** (studionet is a
  shared, periodically-reset sandbox, so its addresses are ephemeral).
- **The `frontend/` dApp is wired to the full v1.1 interface and builds clean**
  (`tsc --noEmit` and `next build` both exit 0): an Earn panel with claim-yield, the
  Credit-Oracle check-any-address showcase, an owner-gated admin panel, a paginated
  borrower directory, risk-priced draw, and a light/dark keynote theme.
- **`VecDB` semantic memory** is roadmap, not built (the v0.2.16 runtime does not ship
  it).

## Verifiable evidence

Stewards reward *legitimate, verifiable* evidence. For this milestone:

- **Primary evidence (available now): the source + the passing suites.** Every claim in
  this writeup is checkable against `contracts/credence.py` and `tests/direct/`. The
  contract suite runs with `pytest tests/direct -q` (shared GenLayer venv,
  `$env:PYTHONUTF8=1`) and yields **42 passed** for the scenario suite; the `adapter/`
  adapter suite runs with `node --test` and yields **24 passing** tests. CI reproduces
  both on every push (`.github/workflows/ci.yml`).
- **Deployment evidence (available now): GenLayer studionet.** `docs/DEPLOY.md` contains
  a reproducible non-interactive runbook and the real output of a live studionet (chain
  `61999`) deploy — deploy tx, contract address, `get_config`/`get_pool`/`get_borrower`
  reads, and a `request_credit` write — all against the on-disk contract, with no real
  funds and no captcha.
- **Deployment target (pending): GenLayer Bradbury testnet.** Bradbury (**chain id
  4221**, faucet at `testnet-faucet.genlayer.foundation`) is the evidence standard for a
  *public-testnet* milestone. **No Bradbury deployment has happened yet** — a faucet
  captcha blocks funding the deployer — so there is **no Bradbury transaction hash to
  cite.** When it is deployed, the deploy transaction and a sample `assess` / `draw` /
  `repay` transaction should be added here.

> Truthful status, stated plainly: (a) the contract compiles, lints and typechecks
> clean, deploys and runs under the real GenVM SDK, and passes its 42 direct-mode
> scenario tests (plus an invariant/conservation suite); (b) it is proven end-to-end on
> **studionet**, but has **not** been deployed to the public **Bradbury** testnet, so
> there is no Bradbury tx hash, point value, or public on-chain record yet; (c) the
> `adapter/` adapter is complete (24 passing tests), the `frontend/` dApp is wired to v1.1 and builds clean (`tsc` + `next build` exit 0), and `VecDB`
> memory is roadmap. Nothing in this document should be read as claiming otherwise.

#CreditWithoutCollateral
