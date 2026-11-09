# Tutorial: The Borrower & Lender Lifecycle

*A short, hands-on walkthrough of both sides of Credence's two-sided market, using the typed
[`@credence/sdk`](../../sdk/README.md) client. Every call maps to a real method on
[`contracts/credence.py`](../../contracts/credence.py) (v1.4.0).*

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## 0. The money convention (read this first)

**1 token = `1e18` base units** (the `BASE` constant). This is consistent everywhere, and it's
the one thing newcomers trip on:

- Amounts you **read back** from the contract are base-unit **integer strings** (`"500000000…"`).
  A JS `number` can't hold `1e18`, so **never** coerce them to `Number`.
- Amounts you **send in** (draw / repay / fund / defund / withdraw) are base-unit **`bigint`**.
- Small fields — counts, epochs, bps, `grade_rank`, `standing` — are plain numbers.

Convert with the exported helpers:

```ts
import { toBaseUnits, fromBaseUnits } from "@credence/sdk";

toBaseUnits("2.5");                      // 2_500_000_000_000_000_000n  (bigint)
fromBaseUnits("1000000000000000000");    // "1"                          (string)
```

One more gotcha: `requested_tokens` in `requestCredit` is a **whole-token integer** (1…2500),
*not* base units — it's advisory (the line is set by the AI grade, not your request). Everywhere
else, money is base units.

Set up a client once (writes need an account; reads don't):

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CredenceClient } from "@credence/sdk";

const client = createClient({ chain: studionet, account });   // account = connected signer
const credence = new CredenceClient(client, CONTRACT_ADDRESS);
```

---

## 1. Borrower lifecycle

The arc is **`requestCredit` → `assess` → `draw` → `repay`**, with `appeal` as optional due
process. All borrower writes are sent from the borrower's **own** account (the contract keys on
`msg.sender`).

### 1a. Request credit (opt in with your own evidence)

```ts
import type { EvidenceDraft } from "@credence/sdk";

// Evidence is up to 8 items of { kind: "text" | "url" | "image", label, content }.
const evidence: EvidenceDraft[] = [
  // A url whose page displays YOUR wallet address proves control and unlocks grades above C.
  { kind: "url",   label: "On-chain settlement history", content: "https://explorer.example.com/addr/0xYou" },
  // At most ONE image: an https page rendered to a screenshot and vision-judged.
  { kind: "image", label: "Revenue dashboard",            content: "https://dash.example.com/me" },
  // Free text is read as-is and can never prove ownership (so it's capped at C on its own).
  { kind: "text",  label: "Context",                      content: "18 months of on-time vendor payments." },
];

// requested_tokens is a WHOLE-token integer (1..2500); evidence can also be a pre-serialized
// JSON string, or "" for no evidence.
await credence.requestCredit("Working capital for Q3 inventory", 500, evidence);
```

This sets your status to `assessing`. You can't request a reassessment while a line is still
outstanding (`settle the outstanding line before requesting a reassessment`).

> **Identity proof is what unlocks a real line.** To reach A/AA/AAA you need at least one `url`
> exhibit whose live page text contains your own `0x…` address (a DNS-TXT-style challenge,
> checked in code). Without it, the grade is capped at **C = 100 tokens** no matter how strong
> the panel's vote. `text` and `image` are always unproven. (See [EXPLAINER.md §6](../EXPLAINER.md).)

### 1b. Assess (run the consensus AI panel)

`assess` is **the one slow, expensive, consensus-LLM write** — a panel of independent AI
underwriters runs inside the GenVM, and for each `url` exhibit *every validator independently
fetches the page live and must agree on the same bounded grade*. Estimate fees first.

```ts
// Estimate fees for the expensive write, then assess. Anyone can trigger assess; it keys the
// borrower by the address you pass.
const fees = await credence.estimateAssessFees(borrowerAddress, "high");
const assessed = await credence.assess(borrowerAddress, fees);

console.log("grade:  ", assessed.grade);                         // e.g. "A"
console.log("votes:  ", assessed.grade_votes);                   // e.g. ["A","AA","B"]
console.log("rationale:", assessed.rationale);
console.log("limit:  ", CredenceClient.fromBaseUnits(assessed.credit_limit), "tokens");
console.log("owned:  ", assessed.ownership_proven);              // did a url prove your address?
```

`assess` resolves to the full `Borrower` record read back from chain (not parsed from the
receipt). On a binding `DENY` the status is `denied` and the limit is 0; otherwise `approved`
with `credit_limit = GRADE_TOKENS[grade] × 1e18`.

### 1c. Appeal (optional due process — once)

If you dispute the grade, escalate **once** to a larger, independent panel of five
(`appeal_panel_size`) that re-judges from scratch. Allowed only with **no outstanding debt**, and
sent from your own account:

```ts
if (assessed.grade === "DENY" || assessed.grade === "C") {
  const appealFees = await credence.estimateAppealFees("high");   // the costliest write
  const reheard = await credence.appeal(borrowerAddress, appealFees);
  console.log("appeal grade:", reheard.grade, "tier:", reheard.appeal_tier);  // tier → 1
}
```

A bigger panel raises the strict-majority bar (3 of 5, not 2 of 3) and the identity cap still
applies — appeal is a second, more diverse reading, **not** a bypass of the C cap.

### 1d. Draw against the line

```ts
if (assessed.status === "approved") {
  // Base-unit bigint. Minimum 1 token; bounded by available credit AND pool liquidity.
  await credence.draw(CredenceClient.toBaseUnits("100"));
}
```

What the contract does on `draw`:

- Enforces `amount ≥ 1 token`, `amount ≤ available` (`credit_limit − principal`),
  `amount ≤ pool cash`, and (if the operator set one) the pool **utilization cap**.
- Charges a **risk-priced origination fee** (`ORIGINATION_BPS_BY_GRADE`: C 400 → B 300 → A 200 →
  AA 150 → AAA 100 bps; minimum 1 base unit).
- On the **opening** draw of a cycle, sets `due_at = now + term_seconds` (default 30 days) and
  **fixes this line's APR** (`rate_bps`) from the current protocol rate — so a later rate change
  never re-prices your open line.
- Sends the tokens on finalized timing. Blocked if a default put you in `requires_reassessment`
  (pass a fresh `assess` first) or if the line is overdue.

### 1e. Repay

Read what's owed and send **exactly** it — overpayment reverts.

```ts
const b = await credence.getBorrower(borrowerAddress);
if (b) {
  console.log("principal:", CredenceClient.fromBaseUnits(b.principal));
  console.log("fee:      ", CredenceClient.fromBaseUnits(b.fee_accrued));
  console.log("interest: ", CredenceClient.fromBaseUnits(b.interest_accrued), `@ ${b.rate_bps} bps APR`);

  // owed = principal + fee_accrued + interest_accrued — use it, never principal alone.
  await credence.repay(BigInt(b.owed));
}
```

The contract applies value **principal → fee → interest** (principal first frees the line). A
full, **on-time** repayment of a *real* line (peak principal ≥ 10 tokens, the
`MIN_REWARD_PRINCIPAL` anti-farming floor) lifts your `standing` (+12, capped at 100) and
increments `on_time`. The collected fee + interest is split: `lender_share_bps` to lender yield,
the rest to protocol revenue.

> **The flywheel.** On-time repayment raises `standing` *immediately*, but the grade and line do
> **not** auto-upgrade. They change at your *next* `requestCredit` + `assess`, where the improved
> standing is surfaced to the panel and can earn a higher grade and a larger line. "Repay →
> standing↑ → grade↑ → bigger line" is a deliberate two-transaction loop, not an automatic bump.

### 1f. What happens on default

If a line passes `due_at` it goes **overdue** (standing −8); past `due_at + grace_seconds`
(default 7 days) the keeper (`service_book`, or the inline check on `draw`/`repay`) marks it
**defaulted**: `defaults++`, standing −40, and `requires_reassessment` is set — you must pass a
fresh assessment before drawing again. Repaying a defaulted line in full restores you toward
`approved`. There is no collateral to seize; the penalty is to your reputation and future credit.

---

## 2. Lender lifecycle

The arc is **`fund` → earn yield → `claimYield` → `defund`**. Lenders supply native liquidity and
earn a pro-rata share of every origination fee (and, if the operator enabled an APR, of interest)
streamed through an O(1) accumulator.

### 2a. Fund the pool

```ts
// Fund 1,000 tokens of native liquidity. No args — the value IS the deposit (base-unit bigint).
await credence.fund(CredenceClient.toBaseUnits("1000"));
```

The contract harvests any prior yield and checkpoints your `reward_debt`, so new capital only
earns on fees collected **after** your deposit — a late depositor never dilutes earlier lenders'
accrued yield, and vice versa.

### 2b. Watch your position

```ts
const me = await credence.getLenderBalance(account);
console.log("redeemable principal:", fromBaseUnits(me.funded));
console.log("unclaimed yield:     ", fromBaseUnits(me.pending_yield));

// Pool-wide accounting.
const pool = await credence.getPool();
console.log("utilization:", pool.utilization_bps / 100, "%");
console.log("lifetime yield to lenders:", fromBaseUnits(pool.yield_distributed));
```

`funded` (redeemable principal) and `pending_yield` (accrued, unclaimed yield) are **separate**
balances, both base-unit strings.

### 2c. Claim yield

```ts
const bal = await credence.getLenderBalance(account);
if (BigInt(bal.pending_yield) > 0n) {
  await credence.claimYield();   // paid from pool cash; separate from principal
}
```

Reverts with `no yield to claim` if there's nothing, or if pool cash is momentarily insufficient
because capital is lent out (a liquidity gate, not a loss — try again after repayments).

### 2d. Defund (redeem principal)

```ts
// Redeem 250 tokens of principal, up to available cash. Yield is unaffected — claim it separately.
await credence.defund(CredenceClient.toBaseUnits("250"));
```

Capital currently lent out must be repaid before it can be withdrawn (else `insufficient
available liquidity`). If the operator set a utilization cap, a defund can't push the pool past it
either — the buffer is a genuine always-held invariant.

**How the yield math stays fair (and solvent):** distribution is MasterChef-style —
`acc_yield_per_share` accumulates yield per unit of funded capital, and each lender's
`reward_debt` checkpoints what they've already been credited. It's O(1) per fee regardless of how
many lenders there are, floor-division rounding always leaves *dust in the pool* (never a
deficit), and a deposit or withdrawal never retroactively grants or forfeits accrued yield. The
full derivation with a worked 750:250 split is in [ARCHITECTURE.md §3](../ARCHITECTURE.md).

---

## 3. A note on image evidence (multimodal)

An `image` exhibit points at an `https://` page that the panel renders to a **screenshot**
(`gl.nondet.web.render(url, mode="screenshot")`) and judges with a vision model — so you can
submit, say, a chart or a signed invoice as a picture, not just text. Rules:

- **At most one image** per application (`at most 1 image evidence item is allowed`).
- It's **always `ownership: unproven`** — a screenshot can't carry a verifiable address bind — so
  image (or text) evidence alone keeps you capped at **C**. Pair it with an ownership-proven `url`
  to go higher.
- A render that fails is marked *"the image could not be rendered"* for every node (fail-closed),
  and the screenshot is sha256-committed into the audit trail without storing raw bytes on-chain.

```ts
const evidence: EvidenceDraft[] = [
  { kind: "image", label: "Q3 revenue chart", content: "https://dash.example.com/q3" },
];
await credence.requestCredit("Growth capital", 250, evidence);
```

---

## 4. Full runnable sketch (borrower + lender on studionet)

Deploy Credence per [DEPLOY.md](../DEPLOY.md), then from TypeScript:

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CredenceClient } from "@credence/sdk";

const credence = new CredenceClient(createClient({ chain: studionet, account }), ADDR);
const me = account as string;

// Lender side.
await credence.fund(CredenceClient.toBaseUnits("1000"));

// Borrower side (same person here only for the demo; normally a different account).
await credence.requestCredit("Working capital", 500, [
  { kind: "url", label: "My explorer page", content: "https://explorer.example.com/addr/" + me },
]);
const fees = await credence.estimateAssessFees(me, "high");
const assessed = await credence.assess(me, fees);

if (assessed.status === "approved") {
  await credence.draw(CredenceClient.toBaseUnits("100"));
  const b = await credence.getBorrower(me);
  if (b) await credence.repay(BigInt(b.owed));           // clear the line in full
}

// Lender collects the origination-fee yield the draw+repay produced.
const bal = await credence.getLenderBalance(me);
if (BigInt(bal.pending_yield) > 0n) await credence.claimYield();
```

### What to expect on studionet

- `requestCredit`, `draw`, `repay`, `fund`, `defund`, `claimYield` are fast, pure-logic writes.
- `assess` / `appeal` are the slow ones — they fan out to Studio's shared validators for the live
  web fetch + LLM panel, so give them a generous timeout (the SDK already uses more retries for
  `assess`). On generic / non-owned evidence, expect a correct **DENY or C** — the protocol is
  conservative by design (a real live-run that correctly DENIED a generic page is logged in
  [DEPLOY.md §7](../DEPLOY.md)).

---

### Next

- Consume the oracle from your own contract → [credit-gated-app.md](credit-gated-app.md)
- Why consensus underwriting works → [../EXPLAINER.md](../EXPLAINER.md)
- Common questions → [../FAQ.md](../FAQ.md)
- The precise state machine & invariants → [../ARCHITECTURE.md](../ARCHITECTURE.md)
