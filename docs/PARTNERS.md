# Credence — Integration-Partner Shortlist

> A working tracker for integration-partner outreach. Companion to [`docs/GTM.md`](GTM.md)
> (strategy) and [`docs/INTEGRATION.md`](INTEGRATION.md) (the how-to a partner follows).
>
> **Status honesty:** every entry is an **outreach target**, not a committed partner. Credence is
> live on **studionet** (chain `61999`); the public **Bradbury** deploy is pending a faucet captcha,
> so integration asks that require a public testnet are sequenced **after** Bradbury (see GTM §4).
>
> `#CreditWithoutCollateral` · GenLayer referral **`JTR01FHP`**

## How a partner integrates (the whole ask, in one line)

```python
# Any GenLayer contract — one synchronous cross-contract read, no capital, no pool risk:
ok  = gl.get_contract_at(credence).view().is_creditworthy(addr, "A")  # -> bool  (the gate)
rec = gl.get_contract_at(credence).view().credit_of(addr)             # -> dict  (the record)
```
Fork [`contracts/credence_gated.py`](../contracts/credence_gated.py) (9 methods, ~250 lines, compiling
and studionet-proven), change `min_grade` and the gated privilege, ship. That is the entire lift for an
oracle consumer. Off-chain readers use the same two views; typed client pattern in
[`frontend/lib/contracts/Credence.ts`](../frontend/lib/contracts/Credence.ts).

## Shortlist

Priority: **P0** = work first (highest leverage / lowest friction). Mode: **Consume** (read the oracle),
**Fund** (lender), **Co-market** (joint narrative), **Amplify** (distribution/recruiting).

| Pri | Target | Segment | Mode | Why them | Concrete integration | First ask |
|---|---|---|---|---|---|---|
| **P0** | **x402 reference gate** (build ourselves) | Agent payments | Consume | The killer composition; our headline demo + best fork template. | Gate an agent's x402 spend limit on its Credence grade (`is_creditworthy(agent,"A")` → cap tier). | Build + open-source it; lead all demos with it. |
| **P0** | **One GenLayer-native agent framework** (ERC-8004 implementer) | Agent frameworks / identity | Consume | Agents carry identity but no portable reputation; passport is purpose-built. | Mint `CredencePassport` per agent; counterparties read `tier_at_least(agent,"A")`. | "Reputation layer under your identity — 15 min?" (template b) |
| **P0** | **Etherisc** | Insurance (Intelligent Oracle cohort) | Co-market / Consume | Same GenLayer underwriting pattern; warmest technical fit. | Price a parametric premium by Credence grade. | "Two sibling underwriting primitives" (template d) |
| **P0** | **A GenLayer steward** | Foundation / stewards | Amplify | Owns reference-template feature + the points gate; drives referrals. | Feature the forkable vault; co-run a "fork the vault" hackathon track. | Template feature + hackathon track (template c) |
| **P0** | **One DeFi lender** (pool-funding design partner) | DeFi lenders | Fund | The hard cold-start side — seed it deliberately. | `fund()` the pool for yield once draw volume + real APY exist. | Bring in *after* self-seeded volume; show `get_pool()` APY. |
| P1 | **PredX** | Prediction markets (Intelligent Oracle cohort) | Consume / Co-market | Same pattern; LP/MM credit is a natural gate. | Gate a market-maker / LP credit line on grade. | Template d, PredX variant. |
| P1 | **MetaMask** | Wallets (consortium) | Consume | Portable reputation badge is a user/agent-facing feature. | Read `passport_of(addr)` → in-wallet reputation badge; unlock perks. | Warm via Internet Court consortium. |
| P1 | **OKX** | Wallet / exchange (consortium) | Consume | Same badge/perk surface at scale. | `credit_of` → tiered access / collateral-free perk. | Warm via consortium. |
| P1 | **Nansen** | Analytics (consortium) | Consume | Credit grade is a new analytics dimension for agent/wallet intel. | Ingest `credit_of` grades as a labeled signal. | Warm via consortium. |
| P2 | **Kleros / UMA** | Dispute adjudication (consortium) | Co-market | Pre-trade credit complements post-trade adjudication. | A Credence `default` escalates to a court; a ruling feeds `standing`. | Position as the pre-trade half of the trust stack. |
| P2 | **ZKsync / Matter Labs / Starknet / NEAR / BNB Chain** | L2s / infra (consortium) | Consume | Cross-chain oracle reads extend Credence's reach. | Read the credit oracle cross-chain to gate native actions. | Warm via consortium. |
| P2 | **Rally** | Consumer distribution (ecosystem) | Amplify | Consumer-facing surface for borrower/passport acquisition. | Surface passports / borrower onboarding. | Explore distribution fit. |

## Warm-surface note

**MetaMask, OKX, Kleros, UMA, ZKsync, Matter Labs, Starknet, NEAR, BNB Chain, and Nansen** are named
**Internet Court consortium** members (~27 firms). They have already endorsed "adjudication for the
agentic economy," which is exactly Credence's thesis — so these are **warm-intro targets via the
consortium / GenLayer foundation, not cold leads.** Route introductions through a steward where possible.

## Sequencing

1. **Now (studionet):** record the deterministic live demo (gated vault rejects unknown + below-bar
   grade without the flaky LLM — see GTM Gem #5). Work P0 **Consume/Amplify** targets with "demo now,
   Bradbury days out."
2. **Blocker:** clear the Bradbury faucet captcha, deploy, publish tx hashes.
3. **Post-Bradbury:** convert P0 integration asks to live; then P1/P2 via consortium warm intros.
4. **Post first live consumer:** run the hackathon track to recruit referred builders (`JTR01FHP`).

## Tracker (fill as you go)

| Target | Owner | Status | Last touch | Next step | Reads landed |
|---|---|---|---|---|---|
| x402 reference gate | | not started | | build reference integration | — |
| agent framework | | not started | | identify specific team | — |
| Etherisc | | not started | | find contact | — |
| GenLayer steward | | not started | | template-feature ask | — |
| DeFi lender (pool) | | not started | | self-seed pool first | — |

---

*GenLayer referral: **`JTR01FHP`**  ·  `#CreditWithoutCollateral`*
