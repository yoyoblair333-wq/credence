# Credence — the pitch

> **Elevator pitch.** DeFi is 100% over-collateralized: to borrow $100 you must already
> lock up $150, because a deterministic blockchain can hold a deposit but can't *judge* a
> borrower. **Credence** is the first GenLayer contract to gate **real value** on an
> on-chain AI panel that reads a borrower's own live public evidence under consensus —
> each validator independently re-fetches the page and re-judges before a single token
> moves. Undercollateralized credit, decided by the chain — now a **four-contract
> composable suite** (core + a gated vault, an M-of-N governor, and a soulbound Credit
> Passport). 31 methods, 70 passing direct-mode tests, **five independent adversarial
> reviews plus a final pre-submission audit** (`docs/AUDIT.md`), live on studionet.
> **#CreditWithoutCollateral** · GenLayer referral **`JTR01FHP`**

---

## The problem

Every loan in DeFi today is **over-collateralized**. You lock up more than you borrow
because an ordinary smart contract can only hold a deposit — it cannot open a URL, read a
revenue page, weigh an invoice against a GitHub history, or decide whether a claim is
substantiated. So the chain demands collateral it can mechanically seize, and that
excludes exactly the participants who most need credit: the freelancer with real revenue
but no idle capital, the startup with a GitHub and an invoice, the autonomous agent with
an on-chain track record and a job to do. **Undercollateralized lending is the single
largest unsolved problem in on-chain finance**, and it is unsolved for one reason: nobody
on-chain can read the evidence and decide.

## Only possible on GenLayer

Credence puts the underwriting decision *inside consensus*. When a borrower cites an
`https://` page, the contract fetches it live during assessment
(`gl.nondet.web.render`), folds the text into three independent AI underwriter personas
(`gl.nondet.exec_prompt`), and derives a bounded credit grade. Then the part no other
blockchain can do: **every validator independently re-fetches the same evidence and
re-judges it**, and `validator_fn` returns `True` only if its own strict-majority grade
equals the leader's. A split panel, a page that drifts enough to flip the grade, or any
exception means **no assessment is written and nothing is lent** — safety over liveness.
Consensus is reached on the *grade* (a six-value categorical output), not on raw page
bytes, which is precisely what makes agreement over a live, subjective reading tractable.
This is GenLayer's equivalence principle applied to a value-gating decision — the exact
capability GenLayer exists to provide.

## The aha moments

- **Undercollateralized credit via AI consensus.** A borrower posts no seizable
  collateral; the line is underwritten purely on evidence and reputation, with a concrete
  grade→line map (`DENY`/`C`/`B`/`A`/`AA`/`AAA` → 0/100/250/500/1000/2500 tokens). The
  first GenLayer contract to gate real native-token value on consensus AI judgment.
- **Identity-bound evidence.** A cited page only counts as *yours* when it displays your
  own `0x…` wallet address — a DNS-TXT-style ownership challenge checked deterministically
  on the fetched text. Without a proven item the grade is **capped at C** no matter how
  enthusiastic the panel, and the cap is enforced in code and **re-derived by every
  validator** (so it does not rely on the model obeying). This closes the
  borrow-against-a-stranger's-reputation attack.
- **A real two-sided market — lenders earn fees *and* interest.** Lenders fund a native
  pool and **earn yield**: a share of every origination fee **and of time-based interest**
  is streamed pro-rata through an **O(1) MasterChef-style accumulator**
  (`acc_yield_per_share`), so funding is a compounding position — no per-lender loop.
  Lenders redeem principal (`defund`) and claim yield (`claim_yield`) whenever liquidity
  allows.
- **Time-based interest (lenders earn interest, not just fees).** A per-line fixed APR
  (`interest_bps`, off by default) accrues simple interest **lazily** on outstanding
  principal against the consensus clock; `owed = principal + fee + interest`, repaid
  **principal → fee → interest**. The APR is **snapshotted per line at the opening draw**,
  so raising the rate later **never retro-charges an existing line** — and collected
  interest is streamed to lenders as their primary ongoing yield.
- **Due process — the appeal ladder.** An assessed borrower can escalate **one**
  assessment to a larger, independent panel (`PANEL_SIZE` 3 → `APPEAL_PANEL_SIZE` 5) that
  **re-judges from scratch** — allowed **once**, and only with no outstanding debt, since
  the appeal may resize the line.
- **Multimodal vision evidence.** An `image` exhibit is rendered to a screenshot
  (`gl.nondet.web.render(url, mode="screenshot")`) and judged by the panel as a vision
  input. It is **unowned by construction**, so it is always `ownership: unproven` and
  cannot lift the grade above the identity cap (`C`); at most one image per request, the
  screenshot sha256-committed into the stored snapshot.
- **M-of-N governance with zero change to the core.** `CredenceGovernor` is an on-chain
  multisig that can own and govern Credence over a **closed** admin action set
  (propose/approve/execute, checks-effects-interactions) — the single-owner trust
  assumption's production mitigation, bolted on without touching one line of the core.
- **A soulbound Credit Passport.** `CredencePassport` is a **non-transferable** on-chain
  reputation primitive an address mints **for itself** from its live Credence standing via
  a synchronous cross-contract `credit_of` read. There is no transfer / approve / admin
  reassignment surface at all — reputation cannot be bought, sold, or delegated.
- **A four-contract composable suite.** The repo ships four cooperating Intelligent
  Contracts: `credence.py` (core), `credence_gated.py` (`CredenceGatedVault`, a
  collateral-free allowlist gated on the oracle), `credence_governor.py`
  (`CredenceGovernor`), and `credence_passport.py` (`CredencePassport`).
- **Composable judgment-as-a-service.** `credit_of` / `is_creditworthy` expose a
  borrower's live grade, limit and standing as a clean, fail-safe read (conservative
  `unknown`/`DENY` for never-assessed addresses) that other contracts and chains can plug
  into — a creditworthiness oracle for the whole ecosystem, not a closed app.
- **Risk-priced credit.** The origination fee is set by the AI grade itself
  (`ORIGINATION_BPS_BY_GRADE`: C 400 bps → AAA 100 bps — riskier grades pay more), so
  price follows judgment automatically.
- **A self-servicing, bounded-autonomous loan book.** `service_book` walks the roster
  permissionlessly and moves lines overdue → defaulted against the **consensus clock**;
  with `autonomous` on it re-emits itself as a finalized message — a servicing heartbeat
  with no operator, bounded to one roster pass.
- **Hardened and property-fuzzed to value-conservation.** Every borrower field and every
  byte fetched from the web is treated as untrusted data (NFKC normalize → injection
  screen → delimiter-neutralise); a companion invariant suite proves the pool's cash
  always reconciles to funded principal + protocol revenue + unclaimed lender yield +
  non-negative dust across randomized operation sequences.

## Why it scores on the steward rubric

- **Impact / usefulness.** Directly attacks DeFi's headline unsolved problem, and it *is*
  GenLayer's thesis — adjudicating the agentic economy — rather than an illustration of
  it. A complete two-sided economic loop (`fund → assess → draw → repay →
  claim_yield`/`defund`/`withdraw_fees`) with recurring, compounding usage, serving both
  humans and autonomous agents.
- **Effort.** A consensus underwriting engine, a full lending state machine, time-based
  interest accrual, an O(1) yield accumulator, an appeal ladder, multimodal vision
  evidence, a deterministic sybil/evidence pipeline, a self-servicing loan book, and a
  hardened input surface — **31 methods (11 view, 20 write)** in the core, plus three
  companion contracts (gated vault, M-of-N governor, soulbound passport) — not a prompt
  wrapped in a contract.
- **Scope.** A coherent, self-contained unit: four Intelligent Contracts + two test
  suites + CI + the `adapter/` evidence adapter + a typed SDK + the `frontend/` dApp, with
  deliberately conservative bounds (six grades, fixed three/five-persona panels, ≤8
  evidence items, ≤1 image, ≤100% APR cap, ≤10% fee) that are the right design for
  undercollateralized lending.
- **Quality.** Runs under the **real** GenVM SDK in-process; **70 direct-mode tests pass
  (62 scenario + 8 property/invariant — the invariant fuzz now exercises interest
  accrual)**; `genvm-lint check` (3 checks) + `typecheck` + validation clean on **all four
  contracts**; consensus is tested on the *decision* (a validator returns `False` when
  re-judgment yields a different grade), not merely on schema; **five independent
  adversarial reviews (v1.1 yield, v1.2 risk controls, v1.3 appeal+multimodal, v1.4
  interest, and the passport) with every finding fixed and regression-tested, plus a final
  pre-submission audit (`docs/AUDIT.md`) that found no critical/high defect**.
- **Community impact.** A forkable template and a reusable pattern —
  *bounded-categorical-output + independent re-judgment with a live-web read inside the
  consensus block* — documented explicitly so builders can retarget it (insurance, grant
  eligibility, KYB tiers, agent trust). Referral **`JTR01FHP`** published in the README.

## Evidence

| What | Status | Where |
|---|---|---|
| Contracts | **Four Intelligent Contracts**: core 31 methods (11 view, 20 write), gated vault 9, governor 8, passport 11; lint (3 checks) + typecheck + validation clean on all four | `contracts/credence.py`, `contracts/credence_gated.py`, `contracts/credence_governor.py`, `contracts/credence_passport.py` |
| Tests | **70 direct-mode: 62 scenario + 8 property/invariant (conservation, interest-aware), all green** under the real SDK | `tests/direct/test_credence.py`, `tests/direct/test_invariants.py` |
| Adversarial review | **Five independent (v1.1 yield, v1.2 risk controls, v1.3 appeal+multimodal, v1.4 interest, passport)**, all findings fixed + regression-tested | `docs/THREAT_MODEL.md`, `docs/milestones/MILESTONE_PORTAL_FORM.md` |
| Pre-submission audit | **Independent audit (Codex + hand re-derivation), no critical/high defect** | `docs/AUDIT.md` |
| evidence adapter | **24 tests**, per-item evidence digests match the contract **byte-for-byte** | `adapter/` |
| Frontend | Next.js dApp, builds clean (`tsc --noEmit` + `next build` exit 0) | `frontend/` |
| Deploy (live) | **studionet chain `61999`** — deploy, `assess` consensus, composability, governor + passport flows against live addresses | `docs/DEPLOY.md`, `docs/LIVE_EVIDENCE.md` |
| Repo | source, CI (`.github/workflows/ci.yml`), full docs set | `<CREDENCE_REPO_URL>` |
| Bradbury deploy | pending (see below) | `<BRADBURY_DEPLOY_TX>` |

Live studionet proof (2026-11-03, `docs/DEPLOY.md`): deploy tx
`0x8a506957ed2d9b1d73eda767dc577b61047f45b50d1c73bfd47da74fd7741f22`, contract
`0x2139545D4D38dEdd9ade1Eb157821BEff4e8115c`, `request_credit` tx
`0xeef91b5dc9076b5f85d7b783652c06400b799f9f1e9b8f240e9f3c09610e96f8` — all finalized,
no real funds, no captcha.

## What's live vs pending

**Live:** proven end-to-end on GenLayer **studionet** (chain `61999`) — deploy, views, and
a `request_credit` write all succeeded against a live deployed address. **Pending:**
deployment to the public **Bradbury** testnet (chain id `4221`) is blocked only on a
faucet captcha, so there is **no Bradbury transaction hash yet** — `<BRADBURY_DEPLOY_TX>`
is the one remaining placeholder, and nothing else here depends on it.

**#CreditWithoutCollateral** · GenLayer referral **`JTR01FHP`**
