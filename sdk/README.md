# @credence/sdk

A typed, framework-agnostic integration SDK for the **Credence** GenLayer
protocol — reputation-underwritten, **undercollateralized** credit for the
agentic economy. Every loan is graded by an on-chain panel of AI underwriters
that independently fetch and judge the borrower's live evidence during
consensus, so credit can be extended with no collateral to seize.

This package is for enterprise integrators who want a clean, typed client
instead of hand-wiring `genlayer-js`. It wraps the deployed `Credence`
Intelligent Contract (`credence.py`, v1.4.0): every view and write is a typed
method, base-unit money is handled consistently, and the consensus-LLM writes
(`assess` and the larger `appeal` panel) have first-class fee-preset support.

> GenLayer referral: **JTR01FHP** — `#CreditWithoutCollateral`

---

## Install

```bash
npm install @credence/sdk genlayer-js
```

`genlayer-js` is a **peer dependency** (targeted version **`^1.1.8`** — the same
version the reference dApp ships). You bring your own configured `genlayer-js`
client and inject it; the SDK never creates one for you, which is what keeps it
safe to run in the browser, in Node, and under SSR, and free of any chain/wallet
assumptions.

- **ESM-only**, ships `.d.ts` type declarations, zero runtime dependencies.
- Node ≥ 18.

### Construct a client

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CredenceClient } from "@credence/sdk";

// A read-only client (no account) is enough for all views and the oracle.
const client = createClient({ chain: studionet });

const credence = new CredenceClient(
  client,
  "0xYourDeployedCredenceAddress",
);

const config = await credence.getConfig();
console.log(config.version, config.grades); // "1.4.0" ["DENY","C","B","A","AA","AAA"]
```

To **send writes**, create the client with an account/signer (e.g. the connected
wallet address in the browser, where `genlayer-js` signs through
`window.ethereum`):

```ts
const client = createClient({ chain: studionet, account });
const credence = new CredenceClient(client, address);
```

Switching accounts later? Recreate the `genlayer-js` client and call
`credence.setClient(newClient)` — no need to make a new `CredenceClient`.

---

## Money convention

**1 token = 1e18 base units.** This is consistent everywhere:

- Amounts **read back** from the contract are base-unit integer **strings**
  (a JS `number` cannot hold 1e18 safely — never coerce them).
- Amounts you **send in** (draw / repay / fund / defund / withdraw) are base-unit
  **`bigint`**.

Convert with the exported helpers:

```ts
import { toBaseUnits, fromBaseUnits } from "@credence/sdk";

toBaseUnits("2.5");                 // 2_500_000_000_000_000_000n
fromBaseUnits("1000000000000000000"); // "1"
```

They are also exposed as statics: `CredenceClient.toBaseUnits(...)`.

---

## Usage by persona

### 1. Lender — fund the pool and earn yield

Lenders supply native liquidity and earn a pro-rata share of every origination
fee, streamed through an O(1) accumulator. Principal is redeemed with `defund`;
yield is claimed separately with `claimYield`.

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CredenceClient, toBaseUnits, fromBaseUnits } from "@credence/sdk";

const client = createClient({ chain: studionet, account });
const credence = new CredenceClient(client, CONTRACT_ADDRESS);

// Fund 1,000 tokens into the lending pool.
await credence.fund(toBaseUnits("1000"));

// Check your position (both are base-unit strings).
const me = await credence.getLenderBalance(account);
console.log("redeemable principal:", fromBaseUnits(me.funded));
console.log("unclaimed yield:     ", fromBaseUnits(me.pending_yield));

// Claim accrued yield (paid from pool cash, separate from principal).
if (BigInt(me.pending_yield) > 0n) {
  await credence.claimYield();
}

// Redeem 250 tokens of principal (subject to available liquidity).
await credence.defund(toBaseUnits("250"));

// Pool-wide accounting.
const pool = await credence.getPool();
console.log("utilization:", pool.utilization_bps / 100, "%");
```

### 2. Borrower — request credit, get underwritten, draw and repay

A borrower opts in with their own public evidence of creditworthiness (an
on-chain history, a revenue dashboard, a GitHub profile, any `https` page). The
on-chain AI panel grades it; the grade sets the credit line and the risk-priced
origination fee. **`assess` is the one slow, expensive, consensus-LLM write** —
estimate its fees first.

```ts
import { CredenceClient } from "@credence/sdk";
import type { EvidenceDraft } from "@credence/sdk";

const credence = new CredenceClient(client, CONTRACT_ADDRESS);

// Evidence is an array of { kind: "domain" | "text" | "url" | "image", label, content }.
// FIRST publish your token (read `ownership_challenge(yourAddress)`) as a line of
// https://example.com/.well-known/credence-verify.txt, then add a `domain` item.
// Only a proven domain unlocks a credit line (and grades above "C"); url items
// count as yours only on a proven host. Displaying an address on a page proves
// nothing. Text and image evidence can never prove ownership.
const evidence: EvidenceDraft[] = [
  { kind: "domain", label: "Ownership proof", content: "example.com" },
  { kind: "url",   label: "Revenue dashboard", content: "https://example.com/metrics" },
  { kind: "image", label: "Analytics screenshot", content: "https://example.com/chart" },
  { kind: "text",  label: "Context", content: "18 months of on-time vendor payments." },
];

// 1) Opt in and submit evidence (requested line is a WHOLE-token integer, ≤ 2500).
await credence.requestCredit("Working capital for Q3 inventory", 500, evidence);

// 2) Run the consensus underwriting panel. Estimate fees, then assess.
const fees = await credence.estimateAssessFees(borrowerAddress, "high");
const assessed = await credence.assess(borrowerAddress, fees);
console.log("grade:", assessed.grade, "votes:", assessed.grade_votes);
console.log("rationale:", assessed.rationale);
console.log("limit:", CredenceClient.fromBaseUnits(assessed.credit_limit));

// 2b) Due process — escalate ONCE to the larger, independent appeal panel. Sent
//     from the borrower's own account; allowed only with no outstanding debt.
if (assessed.grade === "DENY" || assessed.grade === "C") {
  const appealFees = await credence.estimateAppealFees("high");
  const reheard = await credence.appeal(borrowerAddress, appealFees);
  console.log("appeal grade:", reheard.grade, "tier:", reheard.appeal_tier); // tier → 1
}

// 3) Draw against the approved line (base-unit bigint). The line's APR is fixed
//    at draw time (see `rate_bps`); the protocol `interest_bps` may change later
//    without re-pricing an open line.
if (assessed.status === "approved") {
  await credence.draw(CredenceClient.toBaseUnits("100"));
}

// 4) Repay with native value. `owed` already is principal + fee + interest, so
//    send exactly it to clear the line in full (overpayment reverts). Interest
//    accrues only when an operator has enabled it. On-time, full repayment of a
//    real line lifts standing and grade.
const b = await credence.getBorrower(borrowerAddress);
if (b) {
  console.log("principal:", CredenceClient.fromBaseUnits(b.principal));
  console.log("fee:      ", CredenceClient.fromBaseUnits(b.fee_accrued));
  console.log("interest: ", CredenceClient.fromBaseUnits(b.interest_accrued), `@ ${b.rate_bps} bps APR`);
  await credence.repay(BigInt(b.owed)); // owed = principal + fee_accrued + interest_accrued
}
```

> `requestCredit` also accepts a pre-serialized `evidence_json` string if you
> already have one; pass `""` for an application with no evidence.

### 3. Integrator — read the creditworthiness oracle

`credit_of` / `is_creditworthy` expose any address's live credit standing as a
clean read other contracts, chains and backends can consume as
judgment-as-a-service. These never throw for an unknown address — they return a
safe `known: false` / `false` result — and delinquency is computed live from the
consensus clock, so the answer is never stale behind the keeper.

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CredenceClient } from "@credence/sdk";

// Read-only: no account needed to consume the oracle.
const credence = new CredenceClient(createClient({ chain: studionet }), CONTRACT_ADDRESS);

// Full standing record.
const record = await credence.creditOf(someAddress);
if (record.known && !record.defaulted) {
  console.log(`${someAddress}: grade ${record.grade} (rank ${record.grade_rank}),`,
              `standing ${record.standing}, limit ${CredenceClient.fromBaseUnits(record.credit_limit)}`);
}

// One-call gate: does this address currently hold at least an "A" line?
const ok = await credence.isCreditworthy(someAddress, "A");
if (ok) {
  // ...extend your own service / discount / allowlist...
}

// Paginate the whole roster for an indexer or dashboard.
let offset = 0;
do {
  const page = await credence.pageBorrowers(offset, 50);
  for (const row of page.items) {
    console.log(row.addr, row.grade, row.status);
  }
  offset = page.next_offset; // -1 on the last page
} while (offset !== -1);
```

---

## API surface

Constructed as `new CredenceClient(genlayerClient, contractAddress, options?)`.

**Views** — `getConfig`, `getPool`, `getStats`, `getRosterSize`, `getBorrower`
(→ `Borrower | null`), `getAvailableCredit` (→ `string | null`), `creditOf`,
`isCreditworthy`, `getLenderBalance`, `getPendingYield`, `pageBorrowers`.

**Borrower writes** — `requestCredit`, `estimateAssessFees`, `assess`,
`estimateAppealFees`, `appeal`, `draw`, `repay`.

**Lender writes** — `fund`, `defund`, `claimYield`.

**Keeper** — `serviceBook`.

**Admin (owner / staff)** — `withdrawFees`, `setRelayer`, `setDev`, `setGuardian`,
`setPaused`, `setAutonomous`, `setTerms`, `setRiskLimits`, `setInterestBps`,
`transferOwnership`, `acceptOwnership`.

**Helpers** — `toBaseUnits` / `fromBaseUnits` / `tokensToBaseUnits` /
`baseUnitsToTokens`, `CredenceClient.encodeEvidence`, and grade utilities
`gradeRank`, `creditLineTokens`, `gradeAtLeast`, `isGrade`, plus the constants
`BASE`, `GRADES`, `GRADE_TOKENS`, `ORIGINATION_BPS_BY_GRADE`, `PANEL_SIZE`,
`APPEAL_PANEL_SIZE`, `MAX_INTEREST_BPS`, `UNOWNED_GRADE_CAP`, `MIN_DRAW_UNITS`,
`MIN_REWARD_PRINCIPAL`.

All reads return the typed shapes documented in
[`src/types.ts`](./src/types.ts). Writes resolve to a `TransactionReceipt`;
`assess` resolves to the updated `Borrower` read back from chain.

---

## Build

```bash
npm install
npm run build        # tsc -p tsconfig.json  → dist/ (JS + .d.ts + maps)
npm run typecheck    # tsc -p tsconfig.json --noEmit
```

Strict TypeScript, `NodeNext` modules, declarations emitted to `dist/`.

### A note on the client type

The SDK does **not** import any type from `genlayer-js`. It declares the minimal
structural surface it calls (`GenLayerClient` in
[`src/genlayer.ts`](./src/genlayer.ts), clearly marked), and a real client from
`createClient(...)` is assignable to it without a cast. This keeps the package
type-checking cleanly regardless of the build environment and avoids locking you
to a single `genlayer-js` type version. Every method on the shim mirrors one the
proven reference frontend already calls — nothing is invented.

---

## License

MIT.
