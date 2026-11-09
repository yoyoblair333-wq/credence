# Credence — Integration Guide

How a third party integrates with Credence: consume its creditworthiness **oracle**,
provide liquidity as a **lender**, or take out an undercollateralized line as a
**borrower**. Every signature and convention below is grounded in
[`contracts/credence.py`](../contracts/credence.py) (v1.4.0); the composability patterns
reference [`docs/COMPOSABILITY.md`](COMPOSABILITY.md) and
[`contracts/credence_gated.py`](../contracts/credence_gated.py), and the off-chain client
pattern references [`frontend/lib/contracts/Credence.ts`](../frontend/lib/contracts/Credence.ts).

> A standalone, typed TypeScript client ships in this repo: **`@credence/sdk`**
> (`sdk/`, `CredenceClient`) — a `genlayer-js` binding covering every method, typed to
> the current contract v1.4.0. Use it as the off-chain client; `frontend/lib/contracts/
> Credence.ts` mirrors the same call pattern. The on-chain integration patterns here
> depend only on the contract and are stable.

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## Conventions you must know first

- **Base units: 1 token = `1e18` base units.** Every money amount passed into or returned
  from the contract is in base units. The contract returns base-unit money as **decimal
  strings** (to avoid bigint truncation across the ABI) and small counts/epochs/bps as
  ints. Parse money as a big integer, never as a float.
- **Grades → credit lines** (`GRADES`, `GRADE_TOKENS`):

  | Grade | DENY | C | B | A | AA | AAA |
  |---|---|---|---|---|---|---|
  | Line (tokens) | 0 | 100 | 250 | 500 | 1000 | 2500 |
  | Line (base units) | 0 | 100e18 | 250e18 | 500e18 | 1000e18 | 2500e18 |
  | `grade_rank` | 0 | 1 | 2 | 3 | 4 | 5 |

- **Addresses** are `0x`-prefixed, 40 hex chars; the contract validates with `_addr_hex`
  and reverts `address must be 0x followed by 40 hex characters` otherwise.
- **Identity-bound cap:** without at least one ownership-proven URL exhibit (a cited page
  that displays the applicant's own wallet address), the grade is capped at **`C`**
  (`UNOWNED_GRADE_CAP`). Reaching `A`/`AA`/`AAA` requires ownership-proven evidence.
- **Reads return a safe default** for unknown addresses — `credit_of` →
  `{known: false, grade: "DENY", …}`, `is_creditworthy` → `false` — so a consumer can
  never be tricked into trusting an address Credence has not assessed.
- **Time-based interest (optional, off by default).** The operator can enable a simple APR
  on outstanding principal with `set_interest_bps(interest_bps)` (owner-only, `0…10000` bps
  = ≤ 100% APR; `get_config().interest_bps` reports the live value). Each line's APR is
  **fixed at its opening draw** (`rate_bps` on the borrower record), so enabling or changing
  the rate never retro-charges money already drawn. A borrower's record then carries
  `interest_accrued`, this line's `rate_bps`, and `owed` (= `principal + fee_accrued +
  interest_accrued`); the pool view carries `outstanding_interest`. Repayment settles
  `principal → fee → interest`, and collected interest is streamed to lenders as yield.

Read the live configuration (grades, grade→token map, fee schedule, terms, roles,
`version`) at any time with `get_config()`.

---

## (a) Integrate the credit oracle (`credit_of` / `is_creditworthy`)

Credence is **judgment-as-a-service**: its AI panel turns live evidence into a bounded,
consensus-backed grade, exposed through two ordinary `@gl.public.view` methods.

```python
@gl.public.view
def is_creditworthy(self, borrower: str, min_grade: str) -> bool
# True iff `borrower` is currently `approved`, holds at least `min_grade`, and is not
# in default/overdue (live from the consensus clock). Reverts if min_grade is out of set.

@gl.public.view
def credit_of(self, borrower: str) -> dict
# The richer live record:
# { addr, known, grade, grade_rank, credit_limit, available, standing, status,
#   defaulted, overdue, ever_defaulted, requires_reassessment, assessed_at }
```

Both report **live** delinquency from the consensus clock (not a stale cached status).
`is_creditworthy` is the one-call gate; `credit_of` is the full record.

### Off-chain (read it with genlayer-js)

A dApp, keeper, or backend reads the oracle like any view. From the reference client
(`frontend/lib/contracts/Credence.ts`):

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const client = createClient({ chain: studionet /*, endpoint, account */ });

// one-call gate
const ok: boolean = Boolean(
  await client.readContract({
    address: CREDENCE_ADDRESS,
    functionName: "is_creditworthy",
    args: [borrower, "A"],           // borrower hex, min grade
  }),
);

// full record (genlayer-js decodes a dict as a Map — normalize to a plain object)
const rec = await client.readContract({
  address: CREDENCE_ADDRESS,
  functionName: "credit_of",
  args: [borrower],
});
```

> genlayer-js decodes a contract `dict` return as a JS `Map`; the reference client's
> `normalize()` recursively converts Maps → objects and leaves base-unit money as strings.
> Reuse that helper (or equivalent) so you read `rec.grade`, `rec.credit_limit`, etc.
> directly.

### On-chain (synchronous cross-contract `.view()`)

Another GenLayer Intelligent Contract can read the oracle **synchronously, across
contracts**, and gate a real action on it — no collateral, no token of its own. This is
the pattern `CredenceGatedVault` ships (see `docs/COMPOSABILITY.md`):

```python
from genlayer import *

# untyped — quickest:
ok  = gl.get_contract_at(credence_addr).view().is_creditworthy(borrower_hex, "A")  # -> bool
rec = gl.get_contract_at(credence_addr).view().credit_of(borrower_hex)             # -> dict

# typed (recommended): a no-runtime-cost @gl.contract_interface stub of just what you consume
@gl.contract_interface
class ICredence:
    class View:
        def is_creditworthy(self, borrower: str, min_grade: str) -> bool: ...
        def credit_of(self, borrower: str) -> dict: ...
    class Write:
        pass

oracle = ICredence(self.credence)                       # self.credence: Address
if not oracle.view().is_creditworthy(sender_hex, self.min_grade):
    _fail("not creditworthy")
rec = oracle.view().credit_of(sender_hex)
```

Cross-contract calls require a real GenVM host with the contract-call hook, so they run on
a live network (studionet / Bradbury), **not** in gltest "direct" mode. See
`docs/COMPOSABILITY.md` §4 for a live studionet run with addresses.

Pick your own `min_grade`: the same oracle serves a conservative consumer (`AA`) and a
permissive one (`C`) with no change to Credence. For **continuous** enforcement, call
`is_creditworthy` at the moment of each gated action rather than caching a result (grades
move as borrowers repay or default).

---

## (b) Lender flow (`fund` / `defund` / `claim_yield`)

A lender provides native-token liquidity to the pool and earns a pro-rata share of
origination fees — and, when the APR is enabled, of **interest** — as yield.

```python
@gl.public.write.payable
def fund(self) -> dict          # send native value; adds to pool `cash` and opens a yield position
@gl.public.write
def defund(self, amount: int) -> dict   # redeem contributed principal (base units), up to available cash
@gl.public.write
def claim_yield(self) -> dict           # claim accrued yield (base units), paid from cash; separate from principal
# views:
@gl.public.view
def lender_balance(self, lender: str) -> dict   # { funded, pending_yield } (both base-unit strings)
@gl.public.view
def pending_yield(self, lender: str) -> str     # accrued-but-unclaimed yield (base-unit string)
```

Flow:

1. **`fund()`** — send the native value you want to lend (base units) as the transaction
   value; no args. The contract harvests any prior yield and checkpoints your `reward_debt`
   so new capital only earns on fees collected **after** deposit. Returns `get_pool()`.
2. **`pending_yield(me)` / `lender_balance(me)`** — monitor your redeemable `funded`
   principal and accrued `pending_yield`.
3. **`claim_yield()`** — claim accrued yield (paid from pool `cash`; reverts with
   `no yield to claim` or if liquidity is momentarily insufficient). Returns
   `{claimed, cash}`.
4. **`defund(amount)`** — redeem principal up to the pool's available `cash` (capital
   currently lent out must be repaid first, else `insufficient available liquidity`). Yield
   is unaffected — claim it separately. Returns `get_pool()`.

Yield accounting is O(1) (`acc_yield_per_share` + per-lender `reward_debt`): a deposit or
withdrawal never retroactively grants or forfeits accrued yield. `fund` is blocked while
the protocol is paused; `defund`/`claim_yield` are not pause-gated (a lender can always
attempt to exit against available cash).

TypeScript (reference client): `credence.fund(valueBaseUnits)`,
`credence.defund(amountBaseUnits)`, `credence.claimYield()`,
`credence.getLenderBalance(addr)`, `credence.getPendingYield(addr)`.

---

## (c) Borrower flow (`request_credit` → `assess` → `draw` / `repay`)

```python
@gl.public.write
def request_credit(self, purpose: str, requested_tokens: int, evidence_json: str = "") -> None
@gl.public.write
def assess(self, borrower: str) -> dict           # callable by ANYONE (keeper, borrower, staff)
@gl.public.write
def appeal(self) -> dict                          # the borrower; escalate once to a larger panel
@gl.public.write
def draw(self, amount: int) -> dict               # base units; by the approved borrower
@gl.public.write.payable
def repay(self) -> dict                           # send native value; principal first, then fee
```

1. **`request_credit(purpose, requested_tokens, evidence_json="")`** — the caller (the
   borrower) opts in. `purpose` is plain language (≤ 400 chars, injection-screened);
   `requested_tokens` is a positive whole-token integer `1…2500` (advisory — the line is
   set by the grade, not the request); `evidence_json` is a JSON **array** (≤ 8 items) of
   exhibits, or `""` for none. Sets status → `assessing`. Reverts if a line is already
   outstanding (`settle the outstanding line before requesting a reassessment`).

   **Evidence item shape** (`_parse_evidence`):

   ```jsonc
   [
     {"kind": "url",   "label": "Revenue dashboard", "content": "https://stripe.example.com/me"},
     {"kind": "text",  "label": "Track record",      "content": "36 months of on-chain settlement history."},
     {"kind": "image", "label": "Signed invoice",    "content": "https://files.example.com/invoice.png"}
   ]
   ```

   | Field | Values |
   |---|---|
   | `kind` | `"text"`, `"url"`, or `"image"` |
   | `label` | string, ≤ 120 chars (injection-screened) |
   | `content` | `text`: the exhibit text, ≤ 1200 chars (injection-screened). `url`: a single `https://` URL, ≤ 300 chars, fetched live (`mode="text"`) during assessment. `image`: a single `https://` URL, ≤ 300 chars, rendered to a **screenshot** (`mode="screenshot"`) and judged by the vision panel. |

   **`image` exhibits are multimodal and unowned.** At most **1** image per request; the
   contract renders it to a screenshot and attaches it to the underwriter panel as a vision
   input. An image carries no wallet-address ownership proof, so it is always
   `ownership: unproven` and, on its own, cannot lift the grade above the `C` cap.

   To reach a grade above `C`, include at least one `url` exhibit whose page displays the
   borrower's own wallet address (ownership proof); `text` and `image` exhibits are always
   unproven and capped.

2. **`assess(borrower)`** — **anyone** can trigger it (keeper, the borrower, or staff). It
   runs the 3-persona consensus panel inside the GenVM: each URL is fetched live
   (`gl.nondet.web.render`), each underwriter judges (`gl.nondet.exec_prompt`), and every
   validator re-fetches and re-judges and must agree on the bounded grade. Writes the
   binding grade, per-panelist votes, leader rationale, and fetched snapshots; sets
   `credit_limit` and status → `approved` (or `denied` on `DENY`). Returns the full
   borrower record. This is the slow, LLM-backed write — budget a generous timeout (see
   [`docs/DEPLOY.md`](DEPLOY.md)).

   **`appeal()` (optional, due process).** If the borrower disputes the grade, they can call
   `appeal()` on their **own** assessment to escalate it to a larger, independent panel of
   **5** underwriters (vs. 3) that re-judges the same stored evidence from scratch. Allowed
   **once** (`appeal_tier` 0 → 1) and **only with no outstanding debt** (settle any line
   first). The new grade replaces the old one (same identity cap, same fail-closed rules),
   and `CreditAssessed` is re-emitted with `tier = 1`. A larger panel is not a shortcut past
   the `C` cap — unowned evidence is still capped on appeal. Returns the full record.

3. **`draw(amount)`** — the approved borrower draws `amount` base units against the line.
   Bounds: `amount ≥ 1 token`, `amount ≤ available` (= `credit_limit − principal`),
   `amount ≤ pool cash`, and (when set) within the pool **utilization cap**
   (`max_utilization_bps`). Accrues a **risk-priced origination fee**
   (`ORIGINATION_BPS_BY_GRADE`: C 400 → B 300 → A 200 → AA 150 → AAA 100 bps; min 1 base
   unit), sets the due date on the opening draw, and — on that opening draw — **fixes this
   line's interest APR** (`rate_bps` is snapshotted from the current `interest_bps`), so a
   later `set_interest_bps` never retro-charges it. Sends funds on finalized timing. Blocked
   if `requires_reassessment` is set (after a default) until a fresh `assess` passes.

4. **`repay()`** *(payable)* — send native value; the contract applies value in the order
   **principal → fee → interest** (principal first frees the line). The collected **fee +
   interest** are split (`lender_share_bps` to lender yield, the rest to protocol revenue;
   interest is the lenders' ongoing yield). Overpayment beyond `owed` is rejected
   (`overpayment: N base units are owed`). A full, on-time repayment of a real line
   (`peak_principal ≥ 10 tokens`) raises `standing` (+12, capped 100), increments
   `on_time`, and restores a defaulted borrower toward `approved` — the repeat-use
   flywheel. Read what is owed from `get_borrower(me)` directly as its `owed` field
   (= `principal + fee_accrued + interest_accrued`); `interest_accrued` and this line's fixed
   `rate_bps` are on the same record.

Monitor a borrower with `get_borrower(borrower)` (full record) or `available_credit(borrower)`.

TypeScript (reference client): `credence.requestCredit(purpose, tokens, evidenceJson)`,
`credence.assess(borrower)`, `credence.draw(amountBaseUnits)`,
`credence.repay(valueBaseUnits)`.

---

## Quick reference — method surface (31 methods: 11 view, 20 write)

**Oracle / reads:** `credit_of`, `is_creditworthy`, `get_borrower`, `available_credit`,
`lender_balance`, `pending_yield`, `get_pool`, `stats`, `page_borrowers`, `roster_size`,
`get_config`.

**Borrower:** `request_credit`, `assess`, `appeal`, `draw`, `repay`.

**Lender / pool:** `fund`, `defund`, `claim_yield`, `withdraw_fees` (owner-only).

**Servicing:** `service_book` (permissionless keeper).

**Admin (role-gated):** `set_relayer`, `set_dev`, `set_guardian`, `set_risk_limits`,
`set_interest_bps`, `set_paused`, `set_autonomous`, `set_terms`, `transfer_ownership`,
`accept_ownership`.

Every state transition emits an event — see [`docs/EVENTS.md`](EVENTS.md) for indexing.
