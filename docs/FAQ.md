# Credence — FAQ

*Crisp, honest answers to the questions a newcomer, integrator, or steward asks first. Every
answer is grounded in [`contracts/credence.py`](../contracts/credence.py) (v1.4.0); longer
treatments are linked.*

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

### What is Credence, in one sentence?

A GenLayer protocol that extends **undercollateralized** credit by having an on-chain panel of
AI underwriters independently fetch and judge a borrower's own live web evidence during
consensus, bind their votes into a conservative credit grade, and set a collateral-free credit
line and risk-priced fee from it — and that exposes the grade as an oracle any other contract can
read.

---

### Why can't a normal blockchain do this?

Because a deterministic chain's validators must all compute the same bytes, a normal smart
contract can't open a URL or form a judgment — so it can only lend against collateral it already
holds. GenLayer validators *can* fetch the web (`gl.nondet.web.render`) and prompt an LLM
(`gl.nondet.exec_prompt`) during execution, and resolve the resulting non-determinism by each
re-doing the work and agreeing on a bounded result. That capability is the whole reason Credence
can judge a borrower at all. Full mental model: [EXPLAINER.md](EXPLAINER.md).

---

### Is it custodial? Does the protocol hold my keys or my funds?

**No.** Credence is non-custodial. It never holds a private key and never takes custody of your
wallet. It holds a native-token **lending pool** that lenders fund and redeem themselves
(`fund` / `defund`), and the owner can only withdraw *accrued protocol revenue* (`withdraw_fees`),
never lender principal or yield. Every money movement is an on-chain contract call you sign; there
is no off-chain custodian.

---

### What stops someone borrowing on a stranger's reputation?

An **identity-bound ownership proof**, checked deterministically in code and re-verified by every
validator. A `url` exhibit counts as *yours* only if the fetched page text displays **your own
wallet address** (`applicant.lower() in fetched.lower()` — a DNS-TXT-style challenge). Without at
least one ownership-proven URL, the grade is **capped at C (100 tokens)** regardless of how
strongly the panel votes (`UNOWNED_GRADE_CAP`, enforced by `_cap_grade`). You can link to anyone's
dashboard, but only you can make *your* page show *your* address. `text` and `image` evidence can
never prove ownership. See [EXPLAINER.md §6](EXPLAINER.md) and
[ARCHITECTURE.md §5](ARCHITECTURE.md).

---

### How is the grade actually decided? Can it be gamed?

For `assess`, three independent underwriter personas (CASHFLOW, HISTORY, RISK) each grade the
application; the binding grade is the **strongest grade a strict majority backs** — `_grade_floor`
returns the first grade `g` where `count(votes ≥ g) · 2 > n`. It's conservative: a split panel
lands on the lender-safe grade, and a single optimistic vote can't pull the line up. Then the
identity cap is applied. **Every validator independently re-fetches the evidence, re-prompts the
panel, recomputes the grade *and* the ownership flag, and must land on the same result**, or the
transaction fails and nothing is written.

On gaming:

- **Prompt injection** → every borrower field and fetched byte is treated as untrusted *data*, not
  instructions. A write-time screen (`_check_clean`) rejects obvious attempts, `_neutralise` strips
  prompt delimiters and the protocol's own structural tokens, and the **identity cap means even a
  successful injection can't mint more than a C line.**
- **Faking a high vote** → a minority can't; you need a strict majority of *independent re-judges*.
- **Sybil / evidence reuse** → evidence is de-duplicated by content hash; reusing another account's
  exhibit sets a `sybil_flag` surfaced to the panel as a strong negative.
- **Micro-loan farming** → standing only rises for a line whose peak principal reached ≥ 10 tokens
  (`MIN_REWARD_PRINCIPAL`), and every draw pays a real origination fee.

See [THREAT_MODEL.md](THREAT_MODEL.md) and [AUDIT.md](AUDIT.md).

---

### What does the grade ladder mean?

| Grade | DENY | C | B | A | AA | AAA |
|---|---|---|---|---|---|---|
| Credit line (tokens) | 0 | 100 | 250 | 500 | 1,000 | 2,500 |
| Origination fee | — | 400 bps | 300 bps | 200 bps | 150 bps | 100 bps |

Riskier grades pay a higher fee. C is reachable with unproven evidence; **A/AA/AAA require
ownership-proven evidence.** (`GRADE_TOKENS`, `ORIGINATION_BPS_BY_GRADE`.)

---

### What's on-chain vs off-chain?

**Everything that decides anything is on-chain.** The web fetch, the LLM judgments, the vote
aggregation, the grade, the credit line, the fees, the lender yield accounting, and the loan book
all live in the Intelligent Contract and run across GenLayer validators during consensus. What's
*off-chain* is only the convenience layer: the [`@credence/sdk`](../sdk/README.md) TypeScript
client and any dApp/keeper that *calls* the contract. Notably, Credence doesn't rely on any
off-chain oracle feed or trusted reporter — the "price" it reads is a judgment produced on-chain
by the consensus panel.

---

### What happens on default? There's no collateral to seize.

Correct — the penalty is reputational and forward-looking. A line past `due_at` goes **overdue**
(standing −8); past `due_at + grace_seconds` (default 7 days) it **defaults**: `defaults++`,
standing −40, and `requires_reassessment` is set so the borrower **cannot draw again until they
pass a fresh assessment**. A defaulted borrower's grade falls on re-assessment, shrinking or
closing their line. Repaying in full restores them toward `approved`. The loan book is serviced
permissionlessly by `service_book` (and inline on every `draw`/`repay`) against the consensus
clock, so delinquency is recorded even if no keeper has swept. See
[ARCHITECTURE.md §1](ARCHITECTURE.md).

---

### How do lenders make money?

Lenders fund the pool and earn a pro-rata share (`lender_share_bps`, default 50%) of every
**origination fee** — and, if the operator enables an APR (`set_interest_bps`, off by default), of
**interest** on outstanding principal. Yield streams through an O(1) MasterChef-style accumulator,
is claimed with `claimYield`, and is separate from principal (redeemed with `defund`). Rounding
always leaves dust in the pool, so it's always solvent to pay accrued yield. Worked example:
[ARCHITECTURE.md §3](ARCHITECTURE.md).

---

### Is there interest, or just a one-time fee?

By default, just the one-time **origination fee** at draw (`DEFAULT_INTEREST_BPS = 0`). An operator
can optionally enable a simple **APR** on outstanding principal (`set_interest_bps`, 0…10000 bps =
≤ 100% APR). Each line's rate is **fixed at its opening draw** (`rate_bps`), so enabling or changing
the protocol rate never retroactively re-prices money already drawn. Collected interest is streamed
to lenders as ongoing yield. See [ARCHITECTURE.md §2c](ARCHITECTURE.md).

---

### Is it live? Where is it deployed?

Credence has been **deployed and driven end-to-end on GenLayer studionet** (chain `61999`),
including the full AI underwriting consensus panel — real runs with contract addresses and
transaction hashes are logged in [DEPLOY.md](DEPLOY.md) (§6, §7) and the cross-contract
composability run in [COMPOSABILITY.md §4](COMPOSABILITY.md). Studio is a shared sandbox that is
periodically reset, so those specific addresses are ephemeral — re-run the deploy script for a
fresh instance.

---

### Studionet vs Bradbury — what's the difference?

- **studionet** (chain `61999`) is the hosted GenLayer **Studio simulator**. It's free and
  captcha-free: new accounts are funded with test GEN via `sim_fundAccount`, Studio provides the
  validators, LLM, and web-render backends server-side, and no seed phrase or local node is needed.
  It's the recommended target for development and for the live demos in this repo.
- **Bradbury** is GenLayer's public **testnet**. It uses real testnet accounts/funding and is the
  path toward a persistent, non-ephemeral deployment.

The contract source is identical on both; only the account/funding model and persistence differ.
The non-interactive studionet runbook is in [DEPLOY.md](DEPLOY.md).

---

### Who can trigger an assessment? Can anyone assess me?

`assess(borrower)` can be called by **anyone** (the borrower, a keeper, or staff) — but it only
ever acts on evidence **you** already submitted via `request_credit` from your own account, and it
can't do anything but produce a grade on that evidence. Borrower-controlled writes (`request_credit`,
`appeal`, `draw`, `repay`) are all keyed to `msg.sender`, so no one can draw, repay, or appeal on
your behalf.

---

### Can I dispute a grade I think is wrong?

Yes — `appeal()`, once. It re-runs the same consensus machinery on a **larger, independent panel of
five** that re-judges your stored evidence from scratch. It's allowed only with no outstanding debt
(the line may be resized), and it's due process, not a ratchet: the identity cap still applies and a
bigger panel *raises* the majority bar (3 of 5 vs 2 of 3), so a marginal grade is if anything harder
to clear. See [ARCHITECTURE.md §2a](ARCHITECTURE.md).

---

### How do other contracts use Credence?

Through two public views — `is_creditworthy(addr, min_grade) -> bool` (a one-call gate) and
`credit_of(addr) -> dict` (the full record). Any GenLayer contract reads them *synchronously,
across contracts* (`gl.get_contract_at(credence).view().is_creditworthy(...)`); any backend reads
them off-chain via the SDK. Both return a safe default for an unknown address, so a consumer can
never be tricked into trusting someone Credence hasn't assessed. The repo ships a working consumer
([`CredenceGatedVault`](../contracts/credence_gated.py)). Build your own:
[tutorials/credit-gated-app.md](tutorials/credit-gated-app.md).

---

### What's the money unit? Why are amounts returned as strings?

**1 token = `1e18` base units.** Amounts read back are base-unit integer **strings** because a JS
`number` can't safely hold `1e18` — parse them as big integers, never floats. Amounts sent in are
base-unit **`bigint`**. The SDK's `toBaseUnits` / `fromBaseUnits` convert. `requested_tokens` in
`request_credit` is the one exception — a whole-token integer (1…2500), and it's only advisory (the
line is set by the grade). See [tutorials/borrow-and-lend.md §0](tutorials/borrow-and-lend.md).

---

### Is there an admin backdoor? What can the owner do?

The owner can tune economics (`set_terms`, `set_risk_limits`, `set_interest_bps`), pause/unpause,
toggle autonomous servicing, manage roles, and withdraw accrued **protocol revenue only** — never
lender principal or yield, and the owner cannot mint a grade or a line (grades come only from the
consensus panel). Ownership transfer is **two-step** (nominate + accept), a separate **guardian**
role can pause but not move funds (separation of duties), and ownership itself can be handed to an
M-of-N multisig ([`CredenceGovernor`](../contracts/credence_governor.py) /
[GOVERNANCE.md](GOVERNANCE.md)) so every owner action requires a quorum. See
[OPERATIONS.md](OPERATIONS.md).

---

### How was it tested / reviewed?

The core ships with a direct-mode test suite (scenario tests plus a conservation/invariant suite)
and has been adversarially reviewed and hardened — see [AUDIT.md](AUDIT.md) and
[THREAT_MODEL.md](THREAT_MODEL.md). Note that the **cross-contract oracle read can't be unit-tested
in gltest direct mode** (no contract-call hook there), so that path is proven **live on studionet**
rather than faked in a unit test ([COMPOSABILITY.md §4](COMPOSABILITY.md)).

---

### Where do I start building?

1. Read the mental model → [EXPLAINER.md](EXPLAINER.md).
2. Consume the oracle (easiest first win) → [tutorials/credit-gated-app.md](tutorials/credit-gated-app.md).
3. Drive the borrower/lender flow → [tutorials/borrow-and-lend.md](tutorials/borrow-and-lend.md).
4. Deploy it yourself → [DEPLOY.md](DEPLOY.md).
5. Full API surface → [INTEGRATION.md](INTEGRATION.md) and the SDK [README](../sdk/README.md).
