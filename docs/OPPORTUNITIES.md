# Credence — Opportunities (the gems we haven't captured)

**Date:** 2026-11-03 · against on-chain `VERSION = 1.4.0` (four contracts, 70 direct-mode tests green, studionet-proven).
**Author's stance:** this is a *forward-looking* register of high-leverage moves the five prior
adversarial reviews and the pre-submission audit (`docs/AUDIT.md`) did **not** surface, because they
were scoped to correctness of what exists, not to what we should build next. Nothing here is a bug
report. Everything is ranked by leverage, costed honestly (S/M/L), risk-flagged, and tagged
**[already-done]** where a partial version already ships so we don't double-count.

`#CreditWithoutCollateral` · GenLayer referral **`JTR01FHP`**

---

## How to read this

- **Effort:** **S** ≈ ≤1 day / a focused method + tests. **M** ≈ a few days / a new contract or a
  cross-contract path + tests + a studionet script. **L** ≈ a sprint / new economic surface + audit
  + migration.
- **Quick win? ✅** = high leverage *and* low effort (S–M) *and* low risk — do these first.
- **Leverage = (value to Credence) × (value to GenLayer's "Adjudication Layer for the Agentic
  Economy" thesis).** A gem scores highest when it is *only possible on GenLayer* (live web +
  LLM judgment under consensus) **and** plugs Credence into GenLayer's flagship ecosystem rails
  (Internet Court, x402, ERC-8004, cross-chain messaging).

---

## 0. What we already have (do NOT re-pitch these as new)

| Capability | Status | So the gem is… |
|---|---|---|
| Composable credit oracle (`credit_of` / `is_creditworthy`) — judgment-as-a-service as a **free view** | **[already-done]** | a *metered / paid* oracle, and *cross-chain* export (gems #3, #4) |
| Lender yield (O(1) accumulator) + principal redemption (`fund`/`defund`/`claim_yield`) | **[already-done]** | *tokenized, tranched* vaults with a first-loss layer and a secondary market (gems #6, #8) |
| Time-based interest → streamed to lenders as yield (`interest_bps`, per-line APR) | **[already-done]** | nothing extra on the rate mechanic; it *enables* the tranche/real-yield narrative |
| Deterministic exact-reuse sybil flag (`evidence_owner`) | **[already-done]** | *adverse-media / negative-signal* web-scan is a different, uncaptured use of the web read (gem #2) |
| Appeal ladder, multimodal vision, M-of-N governor, soulbound passport | **[already-done]** | passport is the on-ramp to ERC-8004 (gem #5) |
| studionet deploy (deploy / fund / consensus `assess` / compose / govern / passport) | **[already-done]** | *persistent Bradbury* deploy + **real repeated usage** is the #1 points gap (gem #1) |
| "Fork it" paragraph + referral `JTR01FHP` in README | **[already-done]** | an actual *starter kit + hackathon* that converts the paragraph into referred builders (gem #7) |

Note on x402: `@x402/*` appears in `frontend/package-lock.json` only as a **transitive dependency**
of `genlayer-js`; there is **no x402 code in our source**. So the x402 play (gem #4) is genuinely
uncaptured, not half-built.

---

## Ranked gems

### 1. Persistent Bradbury deploy + a captured record of *real* on-chain usage  `[points: a→c]`
**What.** Land the one gap every doc already admits: a durable public-testnet (Bradbury, chain
`4221`) deployment of all four contracts, then drive and record **genuine repeated usage** of the
full loop (`fund → request_credit → assess → draw → repay → claim_yield`) from more than one wallet,
and publish a one-page evidence index (tx hashes, explorer links, a small usage counter).
**Why high-leverage.** The audit is explicit: *"the single thing standing between this and a clean
top-tier score is persistent public-testnet deployment."* Builder points reward **real on-chain
usage (up-to-20% of a contract's usage points)** — which only exists once there are durable txs a
steward can click. This is the highest-EV move on the board; everything else compounds *on top of*
a live address.
**Effort:** **S** for the deploy itself (the studionet runbook already works); **M** to orchestrate
and document multi-wallet usage. **Quick win:** partially — **blocked on the faucet captcha** (be
honest; see `docs/DEPLOY.md`). The unblock is operational, not technical.
**Risk:** low technical; the only risk is the captcha stays blocked — have a fallback (ask GenLayer
for a faucet grant / manual fund, or deploy the moment the captcha clears).

### 2. Adverse-media / negative-signal web-scan at assessment  `[product + thesis; (b),(e)]`  ✅
**What.** During `assess`, in addition to fetching the borrower's *cited* evidence, have the panel
**actively look for disconfirming evidence on the live web** — a search/news/forum read for the
borrower's address, handle, or project (rug-pull reports, sanctions/OFAC hits, scam-tracker entries,
chargeback complaints). Feed the fetched text in as *untrusted data* on the same rails we already
have (`_neutralise` + the `<<<EVIDENCE>>>` fence), and let the RISK persona weigh it. Bound it to a
fixed, deterministic set of query URLs so every validator fetches the same pages.
**Why high-leverage.** This is the purest expression of GenLayer's unique power — *contracts that
read the live web and apply LLM judgment under consensus* — and it is the thing a human underwriter
actually does that no over-collateralized DeFi protocol can. It turns Credence from "reads the
evidence you hand it" into "does real diligence," which is a materially stronger underwriting story
and a headline demo. Fails-closed naturally (a negative hit can only *lower* a grade).
**Effort:** **S–M** (new evidence-gathering step inside `leader_fn`, re-derived by validators; a few
tests; keep the query set fixed for consensus determinism). **Quick win:** ✅ — small, on-thesis,
risk-reducing by construction.
**Risk:** consensus determinism of search-result pages (mitigate by pinning specific URLs and
judging on the bounded grade, exactly as we already do for cited pages); false positives (mitigate:
adverse signal informs the panel, never auto-DENYs deterministically).

### 3. Cross-chain credit attestation export  `[GenLayer-native; (a)]`
**What.** Publish a borrower's consensus grade as an **attestation other chains can consume**, via
GenLayer's EVM/messaging interop: a write path that emits the `{addr, grade, grade_rank, limit,
standing, assessed_at}` tuple to an EVM target (or a signed attestation an EVM verifier contract
reads). Other chains then gate their own lending/allowlists on a Credence grade without re-running
the panel.
**Why high-leverage.** This is *literally* GenLayer's positioning — the **"Adjudication Layer for the
Agentic Economy."** An adjudication layer's value is that its verdicts are consumed *elsewhere*.
Today `credit_of` is consumable only by contracts on GenLayer; exporting it makes Credence the
credit-scoring oracle for the whole multi-chain agent economy and is the most defensible "why this
matters beyond one app" claim we can make to a steward. Pairs with LayerForge/LayerZero framing.
**Effort:** **M–L** (depends on which cross-chain primitive is live in the target runtime; design the
attestation schema + a minimal EVM-side verifier; studionet/Bradbury proof). **Quick win:** no.
**Risk:** platform dependency — confirm the cross-chain write/messaging primitive is available in the
deploy runtime before promising it (same honesty discipline we applied to VecDB). Keep the on-GenLayer
read as the fallback.

### 4. x402 agent-commerce credit rails + Internet Court dispute hook  `[GenLayer-native; (a)]`
**What.** Two connected moves: **(4a)** gate an **x402** "pay-per-request" flow on a Credence grade so
an agent with standing gets *post-paid* / buy-now-pay-later access to a priced API or service (the
line is the credit; x402 is the metering); **(4b)** when a line defaults or a borrower disputes a
grade beyond our one-shot `appeal`, escalate to the **Internet Court** agent-dispute standard rather
than terminating internally.
**Why high-leverage.** x402 + ERC-8004 + Internet Court are GenLayer's declared agent-commerce stack
(Internet Court is backed by OKX/MetaMask/Kleros/UMA + 27 firms). Credence is the missing
*underwriting* layer in that stack: x402 answers "charge the agent," Internet Court answers "resolve
the dispute," and Credence uniquely answers **"should we extend this agent credit at all?"** Being the
credit primitive *inside* the flagship stack is worth far more in ecosystem and points terms than a
standalone app, and it's a recruiting magnet for referred builders.
**Effort:** **M** for 4a (a gated x402 example + the grade check we already expose); **L** for 4b
(dispute-standard integration, depends on Internet Court interfaces being published). **Quick win:**
4a is close to one — it mostly *composes* the oracle we already ship.
**Risk:** interface availability/stability for Internet Court; scope 4a first as the demo, 4b as
roadmap.

### 5. ERC-8004 agent-identity binding — make AI agents first-class borrowers  `[GenLayer-native; (a)]`
**What.** Today identity is proven by "your `0x…` address appears on a cited page." Extend the
ownership proof to **ERC-8004 agent identity**: accept an agent's registered 8004 identifier as the
borrower principal, and prove control via the 8004 registry (the agent's registered domain/endpoint)
rather than only a wallet address on a web page. Have the soulbound `CredencePassport` mirror the
8004 identity so an agent's Credence standing is readable through the standard agent-identity rail.
**Why high-leverage.** Our own tagline is "credit for the agentic economy," but the *proof* mechanism
is still human-shaped (publish your wallet on a dashboard). ERC-8004 is the emerging agent-identity
standard; binding to it makes **autonomous agents genuinely first-class borrowers** — the exact
population GenLayer is built to serve — and lets any 8004-aware contract resolve a Credence grade for
an agent. The passport already materializes reputation per address; 8004 makes it portable across the
agent ecosystem.
**Effort:** **M** (an alternate ownership-proof path keyed to the 8004 registry; passport mirror;
tests; studionet proof). **Quick win:** no, but medium and highly on-thesis.
**Risk:** dependency on the 8004 registry interface; design the proof so a missing/stale registry
fails closed to "unproven → capped at C" (same discipline as the web-ownership path).

### 6. Interest-bearing lender vaults with senior/junior tranches (first-loss)  `[product; (b)]`
**What.** Wrap the pool in an **ERC-4626-style vault** issuing a transferable LP receipt, and split
capital into a **junior (first-loss, higher-yield)** and a **senior (protected, lower-yield)** tranche.
Defaults hit junior first; interest+fees pay junior a premium. The O(1) yield accumulator and per-line
interest we already ship are the engine; this adds the risk-tranching layer on top.
**Why high-leverage.** It turns Credence from "a lending app with yield" into a **real-yield,
risk-structured credit fund** — the structure serious DeFi lenders actually allocate to — and it
finally gives a home to the *loss* side of undercollateralized credit (today a default just lowers
standing; no lender-facing loss waterfall exists). Big narrative upgrade for the DeFi audience; makes
lender capital "sticky."
**Effort:** **L** (new economic surface, a receipt token, loss-waterfall accounting, fresh invariants,
an audit pass). **Quick win:** no — this is a flagship v2, not a sprint.
**Risk:** real economic complexity; must extend the value-conservation invariant suite to the
waterfall before shipping. Gate behind its own adversarial review (keep the five-review discipline).

### 7. A genuine forkable **starter kit** + a themed hackathon  `[recruiting; (d)]`
**What.** Convert the README's "fork it" paragraph into an actual **`create-credence-app` / cookiecutter**
that scaffolds the *bounded-categorical-output + independent-re-judgment + live-web-read* pattern for a
**new domain in ~10 minutes** (insurance underwriting, grant eligibility, KYB tiers, agent-trust), with
the panel personas, the fail-closed validator, the evidence pipeline, and a test harness pre-wired and a
`TODO` where the domain prompt goes. Pair it with a short hackathon / bounty and a tutorial (written +
video), all carrying referral **`JTR01FHP`**.
**Why high-leverage.** This is the **direct points multiplier**: referrals pay **10% of referred
builders' real points**, and a reusable template is how you get referred builders who *ship* (not just
sign up). Credence is unusually well-suited to be a template because the valuable part — the consensus
pattern — is domain-agnostic and already documented; we just haven't packaged it to be *run*, only to be
*read*.
**Effort:** **M** (extract the pattern into a parameterized skeleton + docs; the hackathon is
logistics). **Quick win:** ✅ for the skeleton; the hackathon is a parallel, non-engineering track.
**Risk:** low; mostly packaging and outreach. Biggest risk is it stays a doc instead of a runnable
template — ship the scaffold, not another markdown file.

### 8. Metered / paid judgment-as-a-service + a secondary market for lines  `[product; (a),(b)]`
**What.** Two revenue-surface gems: **(8a)** a **paid oracle** — today any consumer reads `credit_of`
for free and anyone can trigger `assess` for free; add an optional *on-demand paid assessment* (a
payable `assess`/"refresh my grade now" that charges a fee split to lenders/protocol) and/or a
subscription pass contract that meters commercial oracle consumers. **(8b)** a **secondary market for
credit lines**: let a lender sell their yield position (once tokenized per #6) or let an approved
borrower's undrawn line be assigned, via a small marketplace contract reading the oracle.
**Why high-leverage.** 8a converts Credence's core asset (consensus judgment) into recurring protocol
revenue and *more on-chain usage* (which is what points reward) — right now the judgment is given away.
8b deepens the two-sided market into a *tradable* one, which is what makes a credit protocol liquid.
**Effort:** **8a: S–M** (a payable path + fee split we already have the machinery for); **8b: L**
(needs the tokenized receipt from #6 first). **Quick win:** 8a leans quick-win; 8b depends on #6.
**Risk:** 8a must not make the *security-critical* read path (used by gated vault / passport) paid —
keep `credit_of` a free view and meter only a new, explicitly-commercial surface. Pricing/abuse design
needed.

### 9. Reputation-boost / co-sign staking (skin-in-the-game)  `[product; (b)]`
**What.** Let a third party (or the borrower) **stake capital to back a borrower's line** — a co-sign
that is slashed on default and earns a cut of interest on good behavior. The stake is surfaced to the
panel as a protocol-verified signal (like the sybil flag) and can lift the effective line within bounds.
**Why high-leverage.** It adds the one thing pure reputation lacks — **recoverable downside** — without
reverting to full collateral: a defaulting borrower's *backer* takes the hit, so the protocol can safely
extend larger lines to thinner files. It also creates a new yield role (backers) and a social graph of
trust that is itself valuable agent-economy infrastructure.
**Effort:** **M–L** (stake accounting, slashing, panel signal, invariants). **Quick win:** no.
**Risk:** economic/game-theoretic (collusive self-staking); the panel-signal + slashing design needs an
adversarial review before it touches line sizing.

### 10. Grade staleness / decay as a first-class oracle field  `[technical gem; (e)]`  ✅
**What.** `credit_of` already returns `assessed_at`, but the grade itself never decays — a borrower
assessed six months ago reads the same `A` today. Add a configurable **freshness window** so the oracle
reports a *decayed* or `stale`-flagged grade past the window (the stored grade is untouched; the decay is
computed in the view against the consensus clock, exactly like live delinquency already is).
**Why high-leverage.** Consumers (gated vault, passport, any cross-chain reader from #3) are currently
trusting a point-in-time judgment as if it were live. A freshness/decay field makes the oracle *honestly
time-aware* and nudges the repeat-use flywheel (re-assess to refresh), which drives more on-chain usage.
Not surfaced by any prior review because it's a design gap, not a correctness bug.
**Effort:** **S** (a view-side computation + a config knob + tests; no state-machine change). **Quick
win:** ✅.
**Risk:** very low; purely additive to a read path that already computes live facts from the clock.

### 11. Per-item capacity-owned binding (turn audit F-2 into a feature)  `[technical/narrative gem; (e)]`
**What.** Audit F-2 notes the identity cap is *global-per-application*: one owned item unlocks the whole
application, after which a high grade can rest on *unowned* third-party financials. Promote the
already-deterministic ownership flag to a **per-capacity-item requirement**: the specific exhibit that
*justifies* a high line must itself be ownership-proven, enforced in code and re-derived by validators
(not just in the prompt).
**Why high-leverage.** It closes the subtlest residual in the whole threat model and lets us upgrade the
security claim from "≥1 owned item exists" to "the *capacity* evidence is owned" — a stronger, cleaner
story for a steward and for forkers who inherit the pattern. The audit flagged the *risk*; nobody framed
the *fix* as a shippable feature.
**Effort:** **M** (per-item cap logic in `leader_fn` + validator re-derivation + tests). **Quick win:**
borderline. **Risk:** low; it only *tightens* the cap (fails more conservative), consistent with
"safety over liveness."

### 12. A live usage/trust dashboard as the submission's evidence artifact  `[points/narrative; (c),(e)]`  ✅
**What.** A single public page (Artifact or a frontend route) that reads the **live deployed contract**
and shows the real two-sided loop happening: pool cash, active lines, grades issued, yield distributed,
default rate, and a feed of recent txs with explorer links. Driven by `get_pool()`, `stats()`,
`page_borrowers()` — all of which already exist.
**Why high-leverage.** Points reward *demonstrable real usage*; a steward clicking one link that shows
live, moving numbers is worth more than any prose. It's also the natural home for the gem #1 usage
evidence and the recruiting funnel (referral `JTR01FHP` on the page).
**Effort:** **S** (the views and the frontend client already exist; this is a read-only aggregation
page). **Quick win:** ✅ — but only meaningful *after* gem #1 (a persistent address with real txs).
**Risk:** low; depends on #1 for non-trivial data.

---

## Top-5 "do next" shortlist

Ordered for maximum points-per-effort given where the project actually stands (submission-ready, one
deployment gap, strong code):

1. **Bradbury deploy + recorded multi-wallet usage (gem #1).** The one gating item for a top steward
   score and for *usage* points. Operationally blocked on the faucet captcha — escalate that unblock
   today; the deploy itself is ready.
2. **Adverse-media web-scan at assessment (gem #2).** ✅ The best leverage-per-day on the list: small,
   risk-reducing, and the single most vivid proof of GenLayer's only-here capability (live web +
   consensus judgment). Ships as a headline feature and a demo.
3. **Forkable starter kit + hackathon with `JTR01FHP` (gem #7).** ✅ (the scaffold). The direct lever on
   the 10% referral reward — turns the README's "fork it" into builders who actually ship.
4. **Cross-chain credit attestation export (gem #3).** The thesis-defining move: makes Credence an
   *adjudication layer* other chains consume, not a single app. Confirm the cross-chain primitive is in
   the runtime first (VecDB-style honesty).
5. **x402 agent-commerce credit demo (gem #4a) + grade-staleness field (gem #10).** ✅ (both lean
   quick-win). #4a composes the oracle we already ship into GenLayer's flagship agent-commerce rail;
   #10 is a one-view upgrade that makes that oracle honestly time-aware for every downstream consumer.

Everything above is additive and preserves the project's discipline: ship each behind its own
adversarial review + regression tests, keep the fail-closed and value-conservation invariants, and
never make the security-critical `credit_of` read path paid or non-deterministic.

`#CreditWithoutCollateral` · GenLayer referral **`JTR01FHP`**
