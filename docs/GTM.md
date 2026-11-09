# Credence — Go-To-Market

> How Credence wins adoption on GenLayer: lead with the **oracle** (a one-line, zero-capital,
> zero-risk integration), not the loan. Every consumer read and every forked consumer compounds
> Credence's usage points and the referral flywheel. Honest, specific, no hype.
>
> `#CreditWithoutCollateral` · GenLayer referral **`JTR01FHP`**

This is a planning document, not a claim of existing partnerships. Every firm named below is an
**outreach target** or a **GenLayer ecosystem participant** — none is a committed partner yet.
Live status is grounded in the repo: Credence runs end-to-end on **studionet** (chain `61999`);
the public **Bradbury** testnet deploy is still **pending a faucet captcha** (see
[`docs/MILESTONE.md`](MILESTONE.md), [`docs/DEPLOY.md`](DEPLOY.md)). That gating fact shapes the
launch sequence below — ecosystem integration asks wait for Bradbury.

---

## 1. Positioning

**One-liner:** *Credence is the creditworthiness layer for the agentic economy — undercollateralized
credit decided by an on-chain AI panel, plus a composable credit oracle any contract, chain, or agent
can read in a single call.*

**Category:** **Undercollateralized credit + a composable creditworthiness oracle** for humans and
autonomous agents. Two products in one suite:
- **A lending protocol** (the two-sided pool: borrowers draw, lenders earn yield + interest).
- **A creditworthiness oracle / reputation primitive** (`credit_of`, `is_creditworthy`, and the
  soulbound `CredencePassport`) that other protocols consume. *This is the wedge* — see §2.

**How it complements the GenLayer ecosystem (complement, never compete):**

| Ecosystem primitive | What it does | How Credence fits (does NOT overlap) |
|---|---|---|
| **Internet Court** (agent-dispute standard; ~27-firm consortium) | Resolves disputes **after** they happen — post-trade adjudication. | Credence prices risk **before** value moves — pre-trade underwriting. Court + Credence = the full agent-commerce trust stack: decide *whether/how much* up front, adjudicate *what went wrong* after. A Credence `default` is a natural input to a dispute; a court ruling is a natural input to `standing`. |
| **Intelligent Oracle** (PredX, Etherisc) | Resolves real-world **events/outcomes** under consensus (prediction, parametric insurance). | Credence is the **same GenLayer pattern** — *bounded categorical output + independent re-judgment with a live-web read inside consensus* — pointed at **creditworthiness** instead of event outcomes. Sibling primitive, not rival: "Intelligent Oracle for credit." Underwriting insurance and underwriting a loan are literally the same shape. |
| **x402** (agent payments) | Moves money for agents; needs a spend policy. | Credence tells x402 **how much is safe to spend** — gate an agent's spending limit on its Credence grade. |
| **ERC-8004** (agent identity) | Gives an agent a durable `0x` identity. | The soulbound `CredencePassport` is the **portable reputation that identity carries** — one passport per address, non-transferable, history can't be laundered to a fresh wallet. |

Credence is **not** another over-collateralized money market and **not** a prediction market. It is the
one thing no deterministic chain can provide and the rest of the stack assumes: a chain that can *read
the evidence and decide* whether an address is good for it.

---

## 2. Target segments + integration-partner shortlist

The central BDR insight: **the oracle is the wedge, not the loan.** A consumer integrates with a
**single synchronous `@gl.public.view` read** (`is_creditworthy(addr, "A")` → `bool`), posts **no
capital**, takes **no pool risk**, and ships gated behavior in an afternoon (fork
[`contracts/credence_gated.py`](../contracts/credence_gated.py), 9 methods, ~250 lines, already
compiling and proven on studionet). That is a far easier "yes" than "come fund a risky pool," and every
such read is Credence **usage** → Credence points. Lead every conversation with the read.

| # | Segment → named targets | Why they consume / fund Credence | Concrete integration |
|---|---|---|---|
| 1 | **Agent frameworks & ERC-8004 identity builders** (GenLayer agent tooling, ERC-8004 implementers, autonomous-agent devs) | Agents need machine-readable, non-forgeable reputation to transact without re-proving themselves. The passport is purpose-built for this. | Mint a `CredencePassport` per agent identity; counterparties read `tier_at_least(agent, "A")` or `credit_of` before transacting. Reputation in place of capital. |
| 2 | **x402 / agent-payments** | A spend cap needs a risk signal. x402 moves value; Credence says how much is safe. | Gate an agent's x402 **spending limit** on its Credence grade: `is_creditworthy(agent, "A")` before raising a cap; grade→limit map drives the tier. **The flagship composition (see Gem #3).** |
| 3 | **DeFi lenders & money markets** (undercollateralized-credit protocols, risk-tiering lenders) | Want undercollateralized exposure or a reputation score to price existing borrowers; or simply want **yield** on idle capital. | Consume `credit_of` to set a per-borrower LTV discount / better rate; **or** `fund()` the Credence pool and earn a pro-rata share of origination fees + interest (`claim_yield`, `defund`). |
| 4 | **Intelligent Oracle cohort — insurance & prediction** (Etherisc, PredX) | Same underwriting pattern; a grade is a ready-made risk input. | Etherisc: price a parametric **premium** by Credence grade. PredX: gate a market-maker / LP **credit line** on grade. Co-market "two Intelligent-Oracle underwriting primitives." |
| 5 | **Wallets** (MetaMask, OKX — both in the Internet Court consortium) | A portable credit/reputation badge is a user- and agent-facing feature; differentiates a wallet. | Read `passport_of(addr)` to surface an in-wallet **reputation badge**; unlock features / collateral-free perks for holders of a tier. |
| 6 | **Internet Court consortium** (Kleros, UMA, ZKsync, Matter Labs, Starknet, NEAR, BNB Chain, Nansen, + wallets above) | Pre-trade credit complements post-trade adjudication; they've already bought into "adjudication for the agentic economy." **Warm surface, not cold outreach.** | Credence grade as a **pre-dispute risk signal**; a Credence `default` escalates to a court (Kleros/UMA); Nansen ingests grades as an analytics dimension; L2s (ZKsync/Starknet/NEAR/BNB) read the oracle cross-chain. |
| 7 | **GenLayer stewards / foundation / Rally** | Want flagship Intelligent Contracts + builder recruiting; Rally is a consumer-facing distribution surface. | Feature Credence as a **reference template**; co-run a hackathon track seeded with the forkable vault. Steward review is the points gate (see memory: points mechanics). |

**Shortlist to work first (highest leverage, lowest friction):**
1. **x402 spend-limit gate** (Gem #3) — the killer composition; build it ourselves as a reference integration.
2. **One GenLayer-native agent-framework team** — passport per agent identity; natural early adopter.
3. **Etherisc** — nearest-neighbor underwriting pattern; warmest technical fit.
4. **A GenLayer steward** — for the reference-template feature + hackathon track (drives referrals).
5. **One DeFi lender** as the first **pool-funding** design partner (hard side — seed it, see Gem #7).

---

## 3. The two-sided (actually three-sided) growth motion

Credence is a two-sided market — **borrowers** and **lenders** — with a decisive third side,
**integrators (oracle consumers)**, that is the real growth engine because it is the cheapest to land
and it compounds points.

**Borrowers (demand — humans + AI agents).** Freelancers, startups, and autonomous agents with real
public evidence but no idle capital. Acquisition: the dApp (`frontend/`), the passport ("carry your
creditworthiness"), and agent-framework integrations that mint a passport on onboarding. The
**repeat-use flywheel** is the retention mechanic: repay on time → `standing`↑ → grade eligibility↑ →
larger line. Keep the demand side warm; it is not the constraint.

**Lenders (supply — yield).** The **hard side** of the cold-start (Gem #7). Lenders fund a native pool
and earn a pro-rata share of every origination fee **and** of time-based interest through the O(1)
accumulator; they `defund` principal and `claim_yield`. Do **not** lead GTM here — bootstrap the pool
first (self-fund or one design-partner lender), generate real draw volume, then recruit lenders with
**actual APY data** from `get_pool()` (`yield_distributed`, `utilization_bps`). Selling yield before
there is draw volume is selling a promise; selling it after is selling a number.

**Integrators (the growth engine — oracle consumers).** One view call, no capital, no risk. Every read
is Credence usage; every forked consumer is a new source of reads. Optimize GTM for **forks that call
the oracle**, not for logos. This side both drives Credence's own usage points (**up-to-20% of the
contract's usage points**) *and* seeds the referral program.

**The forkable-template + hackathon play (the referral flywheel).** Builder points reward recruiting
referred builders at **10% of their real points**, so the objective is to recruit builders who ship
contracts that *actually get used*. The copy-paste starting point is already in the repo:

- **`CredenceGatedVault`** (`contracts/credence_gated.py`) — a complete, compiling, studionet-proven
  consumer in ~250 lines / 9 methods. A builder forks it, changes `min_grade` and the gated privilege
  (waive a deposit, unlock a perk, raise a limit, admit to a round), and has an oracle-gated app the
  same day. No underwriting engine to build.
- **Fork → referral → usage → double points:** a referred builder who ships a Credence consumer earns
  points on their own usage (we get 10% of that) **and** drives reads on Credence (we get up-to-20% of
  our contract's usage). One fork, two point streams. Publish referral **`JTR01FHP`** on every template,
  demo, and hackathon brief.
- **Hackathon track:** "Fork the vault — ship an oracle-gated app." Judge on *reads landed on the live
  oracle*, not slideware. Seed with 3–4 starter ideas (passport badge, agent spend-gate, risk-priced
  perk, insurance premium-by-grade). Ties the 10% referral lever directly to measurable usage.

---

## 4. Launch sequence + outreach templates

**Sequence (gated by the Bradbury deploy — be honest about the order):**

1. **studionet demo (now).** Record the reproducible live demo. **Lead with the deterministic path**
   (Gem #6): the gated-vault rejects an unknown stranger and a below-bar grade *deterministically*,
   independent of the flaky shared LLM — a live demo that won't break on a partner call. Scripts:
   `scripts/compose_studio.py`, `scripts/passport_studio.py` (both ran 2026-11-03, exit 0).
2. **Bradbury deploy (blocker to clear first).** Resolve the faucet captcha, deploy the four contracts,
   publish the tx hashes. **Do not start integration outreach that asks a partner to build against a
   public testnet until this lands** — until then, outreach is "here's a studionet demo, Bradbury is
   days out," not "integrate today."
3. **Ecosystem outreach (post-Bradbury).** Work the shortlist in §2 order. Lead with the one-line oracle
   read + the reference x402 gate. Warmest first: the Intelligent Oracle cohort and the Internet Court
   consortium are pre-sold on the thesis.
4. **Hackathon (post first integration).** Once one real consumer is live, run the "fork the vault" track
   to convert attention into referred builders + usage.

**Outreach templates** — short, specific, honest, no hype. Fill the brackets; attach the studionet
evidence, not adjectives.

**(a) To a protocol dev lead (DeFi lender / money market):**
> Subject: a read-only creditworthiness oracle you can gate on in one call
>
> Hi [name] — we built Credence on GenLayer: an on-chain AI panel underwrites a borrower on their own
> live evidence under consensus, and exposes the result as two plain view methods —
> `is_creditworthy(addr, "A")` → bool and `credit_of(addr)` → record. For [protocol] it's a one-line,
> zero-capital read: risk-tier an existing borrower, or waive/raise a limit for a graded address. No
> collateral, no feed to trust, no capital from you. It's live on GenLayer studionet today (reproducible
> demo: [link]); Bradbury deploy is days out. 15 min to walk the integration? Here's the 250-line
> consumer it'd be based on: [gated-vault link].

**(b) To an agent-framework maintainer (ERC-8004 / x402):**
> Subject: portable, non-forgeable creditworthiness for your agents
>
> Hi [name] — agents in [framework] carry an identity but no portable reputation. Credence mints a
> **soulbound** credit passport an agent earns once and carries anywhere — one per address, no transfer,
> so a bad history can't be laundered to a fresh wallet. Concretely: gate an agent's x402 spend limit on
> its Credence grade, or let a counterparty read `tier_at_least(agent, "A")` before transacting. Single
> cross-contract view call, no bespoke bridge. Proven on studionet (`scripts/passport_studio.py`, [link]).
> Worth a look as the reputation layer under [framework]'s identity?

**(c) To a GenLayer steward:**
> Subject: a forkable reference template for oracle-gated Intelligent Contracts
>
> Hi [name] — Credence (four Intelligent Contracts, 70 passing direct-mode tests, five adversarial
> reviews + a pre-submission audit, live on studionet) ships a deliberately forkable consumer:
> `CredenceGatedVault`, ~250 lines, that reads a live credit oracle across contracts to gate a
> collateral-free privilege. It's a clean copy-paste starting point for builders — fork it, change the
> grade bar and the privilege, ship. Would you consider it for a reference-template feature / a "fork the
> vault" hackathon track? Happy to seed starter ideas and support referred builders (referral `JTR01FHP`).

**(d) To the Intelligent Oracle cohort (Etherisc / PredX):**
> Subject: same GenLayer underwriting pattern, pointed at credit
>
> Hi [name] — Credence uses the exact Intelligent-Oracle shape you do — bounded categorical output +
> independent validator re-judgment with a live-web read inside consensus — but for **creditworthiness**
> instead of event outcomes. For [Etherisc: price a parametric premium / PredX: gate an LP credit line]
> it's a one-call grade read, no collateral, fail-safe for unknown addresses. Feels like two sibling
> underwriting primitives that co-market well. Open to comparing notes? Live on studionet: [link].

---

## 5. KPIs + pilot plan

**KPIs to track** (most are already observable from contract views/events):

| Side | Metric | Source |
|---|---|---|
| Integrators (north star) | Distinct contracts calling `credit_of` / `is_creditworthy`; total oracle reads/week | on-chain reads; `Admitted` + consumer events |
| Referral flywheel | Forks of `credence_gated.py`; referred builders live (`JTR01FHP`); their usage | GitHub forks; steward/referral dashboard |
| Borrowers | `roster_size`, approvals, draws, **on-time repayment rate**, repeat draws (flywheel) | `stats()`, `get_pool()`, `Drawn`/`Repaid` events |
| Lenders | `total_funded`, `active_lines`, `utilization_bps`, `yield_distributed` (realized APY) | `get_pool()`, `Funded`/`YieldClaimed` events |
| Reputation | Passports minted, `refresh` count, `tier_at_least` reads by third parties | `holder_count()`, `PassportMinted`/`PassportRefreshed` |
| Health | Default rate, appeals filed/overturned, pool solvency (invariant holds) | `stats()`, `CreditAssessed(tier)`, invariant suite |

**North-star metric:** *weekly oracle reads from distinct consumer contracts* — it is the one number
that proves the wedge works and directly drives both point streams.

**Pilot plan (first 1–3 design partners):**
- **Partner A — one oracle consumer (easiest win).** An agent-framework or wallet team that forks the
  vault to gate one action (badge, spend-limit, perk). Success = the gate goes live on Bradbury and lands
  real reads. 1–2 week integration; we supply the reference code and a studionet dry-run.
- **Partner B — one pool lender (hard side, seed it).** Self-fund the pool first to prove the loop, then
  bring one lender in against **real** yield data once draw volume exists. Success = `claim_yield` paid a
  real, non-zero amount and the conservation invariant still holds.
- **Partner C — one underwriting sibling (Etherisc/PredX).** A co-marketed "same pattern, different
  domain" integration + joint content. Success = a published joint demo and a warm consortium intro.
- **Per-partner playbook:** scoped integration doc ([`docs/INTEGRATION.md`](INTEGRATION.md)) → studionet
  dry-run → Bradbury go-live → instrument the KPI above → case study → feed into the hackathon brief.

---

## Top BDR gems we'd otherwise miss

1. **The oracle is the wedge, not the loan.** Sell the one-line, zero-capital, zero-risk `view` read, not
   "fund a risky pool." It is the easiest "yes" in the stack and every read is Credence usage points.
2. **Credence sits *under* the Internet Court consortium, not beside it.** Pre-trade underwriting +
   post-trade adjudication = the full agent-commerce trust stack. The ~27 consortium firms are a **warm
   intro surface** already sold on "adjudication for the agentic economy" — not cold leads.
3. **x402 + ERC-8004 is the killer composition and nobody has wired it.** Agent identity (ERC-8004) +
   agent payments (x402) + the missing middle (Credence grade/passport gating the spend limit). **Build
   this reference integration ourselves** — it is the headline demo and the best fork template.
4. **Intelligent Oracle is a sibling, not a rival — borrow its recognition.** Same GenLayer pattern,
   pointed at credit. "Intelligent Oracle for credit" co-markets with Etherisc/PredX for free.
5. **The deterministic rejection path is a de-risked live demo.** Unknown address and below-bar grade
   reject *without* the flaky shared LLM — a partner-call demo that won't break on stage. Most AI-chain
   demos do. Lead with it.
6. **One fork = two point streams.** A referred builder who forks the vault earns points we get 10% of,
   *and* drives reads we get up-to-20% of. Optimize recruiting for **forks that call the oracle.**
7. **Seed the lender side; it is the cold-start constraint.** Don't sell yield before draw volume exists.
   Self-fund, generate volume, then recruit lenders with real APY from `get_pool()`.
8. **The soulbound passport pre-answers the "reputation laundering" objection.** `defaulted` /
   `ever_defaulted` travel with the address and can't be moved to a fresh wallet — the trust/compliance
   hook for wallet and agent-framework partners. Lead passport talks with it.
9. **Bradbury is the GTM gate — sequence honestly.** Integration asks that require a public testnet wait
   for the Bradbury deploy (currently blocked on a faucet captcha). Until then: studionet demos only, and
   say so.

---

*GenLayer referral: **`JTR01FHP`**  ·  `#CreditWithoutCollateral`  ·  See also
[`docs/PARTNERS.md`](PARTNERS.md) for the integration-partner shortlist in table form.*
