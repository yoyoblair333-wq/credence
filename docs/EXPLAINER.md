# How Consensus AI Underwriting Works

*A plain-language mental model of Credence for a general web3 developer.*

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

> You do **not** need to understand this document to *use* Credence — the
> [tutorials](tutorials/credit-gated-app.md) are enough for that. Read this when you want to
> know *why* the thing works at all, and why it can only exist on GenLayer. Every claim here
> is grounded in [`contracts/credence.py`](../contracts/credence.py) (v1.4.0); where it helps,
> the exact code path is named.

---

## 1. The problem: a deterministic chain cannot judge a borrower

Think about what a normal smart contract is allowed to do. To stay safe, every validator on
an Ethereum-style chain must re-execute the same bytecode and get **the same bytes**. That is
what makes the result trustless — but it also means the contract may only touch data that is
already on-chain and already identical for everyone. It cannot open a URL. It cannot read a
revenue dashboard. It cannot form an opinion about whether a GitHub profile looks like a real
engineer or a Potemkin village. The moment two validators might *see* or *decide* something
different, consensus breaks.

That single constraint is why **all** on-chain lending today is *over*-collateralized. Aave,
Compound, Maker — you must lock up **more** value than you borrow, because the contract has no
way to judge *you*. It can only judge the asset you already pledged. Credit — lending against a
*reputation* or a *cash flow* rather than a hostage asset — is the single biggest unsolved
problem in on-chain finance, and it is unsolved precisely because deterministic chains are
structurally incapable of judgment.

Credence is a protocol for exactly that judgment. It can only exist on GenLayer.

---

## 2. GenLayer's trick: Optimistic Democracy over non-deterministic calls

GenLayer is a blockchain whose validators run an **Intelligent Contract** — Python that can do
two things a normal contract cannot:

- **`gl.nondet.web.render(url, ...)`** — fetch a live web page during execution.
- **`gl.nondet.exec_prompt(prompt, ...)`** — ask an LLM a question during execution.

These are *non-deterministic*: two validators fetching the same URL a second apart, or
prompting an LLM, will **not** get byte-identical results. A normal chain would deadlock. GenLayer
resolves it with **Optimistic Democracy**:

1. One validator acts as **leader** and produces a result.
2. Every other validator independently **re-does the work** and votes on whether the leader's
   result is *acceptable* — not byte-identical, but equivalent under a rule the contract itself
   defines.
3. If a strict majority agrees, the result is written. If they can't agree, **nothing is
   written** and the transaction fails.

The crucial design decision in Credence is **what the validators are asked to agree on.** They
do *not* vote on the raw bytes of a fetched page (hopeless — pages change). They do *not* vote
on the free-text reason an LLM gave. They vote on one small, bounded thing: **the credit grade.**
That is the whole idea. (In code this is `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` in
`_run_panel`.)

---

## 3. The grade ladder

Credence collapses "how creditworthy is this borrower?" into a six-rung ladder. Each rung maps
to a hard credit line and a risk-priced origination fee (`GRADES`, `GRADE_TOKENS`,
`ORIGINATION_BPS_BY_GRADE` in the contract):

| Grade | Rank | Credit line | Origination fee | Meaning |
|-------|:----:|------------:|:---------------:|---------|
| **DENY** | 0 | 0 tokens | — | No credit. The safe default. |
| **C** | 1 | 100 tokens | 400 bps (4%) | Thin / unproven. The cap for anyone who hasn't proven identity. |
| **B** | 2 | 250 tokens | 300 bps (3%) | Some substantiated capacity. |
| **A** | 3 | 500 tokens | 200 bps (2%) | Solid, ownership-proven capacity. |
| **AA** | 4 | 1,000 tokens | 150 bps (1.5%) | Strong. |
| **AAA** | 5 | 2,500 tokens | 100 bps (1%) | Exceptional. |

Two things to notice:

- **Riskier grades pay more.** The origination fee *falls* as the grade *rises* (400 bps at C
  down to 100 bps at AAA). Price follows judgment automatically — nobody sets a rate by hand.
- **A grade is a bound, not a number.** "AA" isn't a score of 847; it's a rung a *majority of
  independent judges* were willing to stand behind. That is what makes it something validators
  can agree on.

(1 token = `1e18` base units, the `BASE` constant — see any tutorial's money note.)

---

## 4. The underwriting panel: each validator re-judges live evidence

Here is the full flow of the one expensive write, `assess(borrower)`:

**Step 1 — The borrower submits their own evidence.** Via `request_credit`, a borrower hands in
up to 8 *exhibits*, each one of three kinds (`EVIDENCE_KINDS`):

- `text` — a plain-language claim ("36 months of on-time vendor payments").
- `url` — an `https://` page the panel will **fetch live** (a Stripe dashboard, an on-chain
  explorer page, a GitHub profile).
- `image` — an `https://` page rendered to a **screenshot** and judged by a vision model (at
  most one per application).

**Step 2 — The leader fetches and builds a prompt (inside `leader_fn`).** For every `url`
exhibit, the leader calls `gl.nondet.web.render(url, mode="text")` and pulls the live page text.
For the `image` exhibit it renders a screenshot (`mode="screenshot"`). It then assembles one
prompt *per underwriter persona*. The initial panel is **three** personas (`PANEL_SIZE = 3`),
each with a different lens (`UNDERWRITERS`):

- **CASHFLOW** — weighs verifiable, current income and cash-flow evidence.
- **HISTORY** — weighs track record: on-chain history, prior repayment, longevity.
- **RISK** — scrutinizes for fraud, sybil behavior, stale claims, overreach.

(Appeal uses five — the above plus **MACRO** and **CHARACTER** — see §8.)

**Step 3 — Each persona grades the application.** Each prompt goes to
`gl.nondet.exec_prompt(..., response_format="json")` and comes back as
`{"grade": "...", "rationale": "..."}`. A malformed or out-of-set reply is coerced to a single
**DENY** vote (`_parse_assessment`) — it fails *safe*, it doesn't crash the panel.

**Step 4 — The votes become one binding grade** (`_grade_floor`, see §5).

**Step 5 — Every validator re-does Steps 2–4** (inside `validator_fn`). Each validator
*independently re-fetches every URL, re-prompts every persona, recomputes the grade*, and votes
`True` only if its own re-derived grade **equals the leader's**. This is the heart of the whole
system: the grade written to chain is not "what one AI said" — it is **a grade an independent
quorum of AIs, each looking at the live web for themselves, converged on.**

If the live evidence has drifted enough between fetches to flip the outcome, the validators
*disagree*, the transaction fails, and **nothing is written and no money moves.** Safety over
liveness, by construction.

---

## 5. The strict-majority binding grade (and fail-closed DENY)

How do a handful of independent grades become **one**? Not by averaging (an average is a number
nobody voted for, and it can be dragged up by a single over-optimistic judge). Credence uses the
strongest grade a **strict majority** will stand behind — the `_grade_floor` function:

> Walk the ladder from strongest (AAA) to weakest. Return the first grade `g` such that **more
> than half** the panel voted at grade `g` *or higher*. DENY is backed unanimously, so an answer
> always exists.

In code: `count(votes ≥ g) · 2 > n`.

This is deliberately conservative — it lands on the **lender-safe** grade, never the optimistic
one. A worked example with a 3-judge panel:

```
votes = [AA, A, B]        (one judge says AA, one A, one B)

  AAA?  judges ≥ AAA = 0   →  0·2 > 3 ?  no
  AA?   judges ≥ AA  = 1   →  1·2 > 3 ?  no   (only the AA judge)
  A?    judges ≥ A   = 2   →  2·2 > 3 ?  YES  (the AA and A judges)
  ──> binding floor = A  (500-token line)
```

A single enthusiastic AA vote could **not** pull the line above A, because a strict majority
(2 of 3) only agreed on "A or better." That is the opposite of an average, and it is why a
compromised or hallucinating minority judge cannot mint credit.

**Fail-closed everywhere.** The safe default is always DENY:

- A malformed LLM reply → one DENY vote.
- The panel raising an exception → the whole `assess` call fails (no grade written).
- A validator seeing a malformed consensus payload, or re-deriving a *different* grade → it
  votes the leader down, and the transaction fails.

There is no code path where uncertainty resolves to "approve." Uncertainty always resolves to
"no credit."

---

## 6. Identity-bound evidence: you can't borrow on a stranger's reputation

A naive version of this protocol has an obvious exploit: cite *someone else's* revenue dashboard
and borrow against reputation you don't own. Credence closes this with an **ownership proof**
that is checked deterministically, in code, by every validator — not left to the LLM's goodwill.

The rule (an ACME http-01-style challenge, in `leader_fn`, since v2.0):

> A `domain` exhibit is PROVEN only if `https://<domain>/.well-known/credence-verify.txt` — a URL
> the **contract builds itself** — contains, on its own line, the applicant's one-time token
> `credence-verify=<sha256(contract | applicant | request_seq)[:32]>`. A `url` exhibit counts as
> the applicant's own only if it is hosted on a domain proven in the same application.

Merely *displaying* an address proves nothing — anyone can paste an address into a comment, a
profile or a search box that echoes it. Only whoever controls a domain's web root can publish a
file at its fixed `/.well-known` path. The token is bound to the applicant's address (copying
someone else's is useless), rotates on every request (no stale proofs), and a proven domain binds
to exactly one borrower.

The teeth are in the **cap** (`_cap_grade`):

```
cap   = AAA (the full ladder)   if at least one domain proved ownership
      = C   (UNOWNED_GRADE_CAP)  otherwise
grade = min(strict_majority_floor, cap)
limit = GRADE_TOKENS[grade]      if a domain was proven
      = 0                        otherwise   (no proof, no line)
```

So **without ownership proof, the grade is capped at C and the credit limit is ZERO no matter
what the panel says** — unauthenticated claims never touch lender funds. A second worked example makes this vivid:

```
votes = [AAA, AAA, AAA]   (a unanimous, maximally enthusiastic panel)
no proven domain

  strict-majority floor = AAA
  cap                   = C          (nothing proved ownership)
  binding grade         = min(AAA, C) = C   →  reputation grade only, credit limit 0
```

The panel can love you all it wants; with nothing proving the evidence is *yours*, the line is
C with no line. Crucially, this cap is enforced in Python **and re-derived by every validator** (the validator
re-agrees `any_owned`, not just the grade — `validator_fn`), so it holds even if an LLM is
jailbroken into ignoring the instruction. `text` and `image` exhibits can **never** prove
ownership (text isn't a live, controllable page; a screenshot carries no verifiable address bind),
so on their own they never unlock credit.

This is also the protocol's defense against prompt injection. Every borrower field and every byte
fetched from the web is treated as **untrusted data, never instructions**: a write-time injection
screen (`_check_clean`) plus `_neutralise` (which strips prompt delimiters *and* the protocol's own
structural tokens from all untrusted text), *plus* the identity cap, mean a successful injection
still cannot mint more than a C line.

---

## 7. Why this enables undercollateralized credit

Put the pieces together and you have the thing deterministic chains can't build:

1. A borrower proves, with **their own** live evidence, that they have real capacity.
2. An **independent quorum of AI underwriters** — each fetching the web for itself — converges on
   a bounded grade, or the whole thing fails closed.
3. That grade sets a **hard credit line and a risk-priced fee**, with no collateral pledged.
4. The grade is exposed as a plain on-chain read (`is_creditworthy` / `credit_of`) that *any*
   other contract can consume — Credence is a **creditworthiness oracle**, "judgment-as-a-service."

The collateral was never the point; it was a crutch for chains that couldn't judge. Replace the
judgment and you can drop the crutch. And because repaying a real line on time lifts your
`standing` — which the panel sees on your *next* assessment and can reward with a higher grade —
reputation **compounds**: repay, re-apply, get a bigger line. Default and it falls (standing
−40, and a fresh assessment is required before you can draw again).

---

## 8. Appeal: due process without a loophole

A borrower who disputes their grade may call `appeal()` **once** (`appeal_tier` 0 → 1), and only
with no debt outstanding. Appeal re-runs the *exact same* consensus machinery on a **larger,
independent panel of five** (`APPEAL_PANEL_SIZE = 5` — adds MACRO and CHARACTER) that re-judges
the stored evidence from scratch.

It is due process, **not a ratchet**:

- The identity cap still applies — a text-only applicant is still capped at C on appeal.
- A bigger panel *raises* the strict-majority bar in absolute terms (now 3 concurring votes
  instead of 2), so a marginal grade is, if anything, **harder** to clear.

Appeal buys you a second, more diverse reading — never a bypass of the rules.

---

## 9. One-paragraph summary

A deterministic blockchain can't judge a borrower, so it can only lend against hostage collateral.
GenLayer lets a contract fetch the live web and ask an LLM *during consensus*, and resolves the
resulting non-determinism by having every validator re-do the work and agree on a small bounded
result. Credence uses that to run a panel of independent AI underwriters over a borrower's **own**
(identity-proven) live evidence, bind their votes into the strongest grade a **strict majority**
supports, cap it at C without ownership proof, and fail closed to **DENY** on any doubt. The grade
sets a collateral-free credit line and a risk-priced fee — and is published as an oracle the whole
ecosystem can read. That is undercollateralized, AI-underwritten credit, and it can only exist on
GenLayer.

---

### Keep reading

- Build something that consumes the oracle → [tutorials/credit-gated-app.md](tutorials/credit-gated-app.md)
- Walk the borrower & lender lifecycle → [tutorials/borrow-and-lend.md](tutorials/borrow-and-lend.md)
- Common questions → [FAQ.md](FAQ.md)
- The precise mechanics → [ARCHITECTURE.md](ARCHITECTURE.md) · the integration surface → [INTEGRATION.md](INTEGRATION.md)
