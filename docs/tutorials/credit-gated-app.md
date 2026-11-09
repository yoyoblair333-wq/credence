# Tutorial: Build a Credit-Gated Feature on Credence

*Gate a real feature on a borrower's live, AI-underwritten credit grade — with no collateral,
no deposit, and no credit logic of your own. You just read Credence's oracle.*

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

**You will build:** a collateral-free allowlist that admits a caller *iff* Credence currently
rates them at least grade `A` and in good standing. This is exactly the pattern the shipped
[`CredenceGatedVault`](../../contracts/credence_gated.py) uses. We cover both paths:

- **On-chain** — a GenLayer Intelligent Contract that reads the oracle with a *synchronous*
  cross-contract call and gates a write on the result.
- **Off-chain** — a TypeScript backend/dApp that reads the same oracle through the
  [`@credence/sdk`](../../sdk/README.md) client.

Every snippet below is grounded in the real contract and SDK API. Time: ~20 minutes.

---

## 0. The one idea

Credence is **judgment-as-a-service**. Two ordinary `@gl.public.view` methods expose any
address's live credit standing:

```python
is_creditworthy(borrower: str, min_grade: str) -> bool   # the one-call gate
credit_of(borrower: str) -> dict                          # the full standing record
```

Because they're plain views, *any* contract, chain, or backend can read them. Your app supplies
the policy (which `min_grade` to require, what privilege to grant); Credence supplies the
judgment. You store no grades and you can't be tricked into trusting an address Credence hasn't
assessed — an unknown address returns `is_creditworthy → False` and `credit_of → {known: false,
grade: "DENY", …}`.

---

## 1. Prerequisites

- A Credence contract deployed on **studionet** (see [DEPLOY.md](../DEPLOY.md), or §5 below for
  the short version). You need its address, e.g. `0xAfD9…849E`.
- For the on-chain path: the GenLayer Python SDK runtime (the `# { "Depends": "py-genlayer:…" }`
  pragma on line 1 — copy it verbatim from any contract in this repo; Studio uses it to pick the
  runtime).
- For the off-chain path: Node ≥ 18, and `npm install @credence/sdk genlayer-js`.

> **Why studionet, not gltest?** A synchronous cross-contract `.view()` call needs a real GenVM
> host with the contract-call hook. The unit-test harness (`gltest` "direct" mode) has no such
> hook, so the oracle read **cannot** be exercised there — this pattern is verified live on
> studionet. See [COMPOSABILITY.md §4](../COMPOSABILITY.md) for a real run with addresses.

---

## 2. On-chain: a contract that reads the oracle

### 2a. Declare a typed interface to the oracle

You *can* call the oracle untyped:

```python
ok = gl.get_contract_at(credence_addr).view().is_creditworthy(borrower_hex, "A")  # -> bool
```

…but the recommended pattern is a `@gl.contract_interface` stub of just the methods you consume.
It has **no runtime cost** (it resolves to `gl.get_contract_at`), it gives the cross-contract
reads real static types, and it documents your dependency surface. This is lifted directly from
`credence_gated.py`:

```python
from genlayer import *

@gl.contract_interface
class ICredence:
    class View:
        def is_creditworthy(self, borrower: str, min_grade: str) -> bool: ...
        def credit_of(self, borrower: str) -> dict: ...

    class Write:
        pass
```

### 2b. The gated contract

Here is a minimal, self-contained allowlist. The gate is the single line
`oracle.view().is_creditworthy(addr, self.min_grade)`:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from dataclasses import dataclass
from genlayer import *

GRADES = ["DENY", "C", "B", "A", "AA", "AAA"]
GRADE_RANK = {g: i for i, g in enumerate(GRADES)}


@gl.contract_interface
class ICredence:
    class View:
        def is_creditworthy(self, borrower: str, min_grade: str) -> bool: ...
        def credit_of(self, borrower: str) -> dict: ...
    class Write:
        pass


@allow_storage
@dataclass
class Member:
    addr: str
    grade: str
    standing: u32
    admitted_at: str


class MyGatedApp(gl.Contract):
    owner: Address
    credence: Address          # the Credence oracle we read
    min_grade: str             # the bar we enforce
    members: TreeMap[str, Member]

    def __init__(self, credence: str, min_grade: str = "A") -> None:
        self.owner = gl.message.sender_address
        self.credence = Address(credence)
        g = str(min_grade).strip().upper()
        if g not in GRADE_RANK:
            raise gl.vm.UserError("min_grade must be one of " + ", ".join(GRADES))
        self.min_grade = g

    @gl.public.write
    def claim(self) -> dict:
        """Admit the caller IFF Credence rates them >= min_grade and in good standing."""
        addr = gl.message.sender_address.as_hex
        if addr in self.members:
            raise gl.vm.UserError("already admitted")

        oracle = ICredence(self.credence)

        # --- THE GATE: one synchronous cross-contract read of Credence's oracle. ---
        if not oracle.view().is_creditworthy(addr, self.min_grade):
            raise gl.vm.UserError(
                f"not creditworthy: Credence must rate you at least {self.min_grade} "
                "and in good standing (not defaulted or overdue)")

        # Eligible — snapshot the live grade/standing from the SAME oracle for the record.
        rec = oracle.view().credit_of(addr)
        m = Member(
            addr=addr,
            grade=str(rec.get("grade", "DENY")),
            standing=u32(max(0, min(100, int(rec.get("standing", 0))))),
            admitted_at=str(gl.message_raw["datetime"]),
        )
        self.members[addr] = m
        return {"addr": m.addr, "grade": m.grade, "standing": int(m.standing),
                "admitted_at": m.admitted_at}

    @gl.public.view
    def is_admitted(self, addr: str) -> bool:
        return Address(addr).as_hex in self.members
```

**What's happening**

- `oracle.view().is_creditworthy(addr, self.min_grade)` is a **synchronous** read: it blocks,
  resolves through a sub-VM call into Credence, and hands you back the decoded `bool`. (Writes
  into another contract use the *asynchronous* `.emit(on="finalized")` namespace instead — but
  to *consume* an oracle you want the synchronous read.)
- The gate is the single source of truth. Your contract **stores no grades of its own**; it
  trusts only what Credence returns *at call time*. There is no path to self-admit around it.
- `credit_of` returns the richer record so you can snapshot `grade`/`standing` into your storage
  as the granted privilege. (Keys: `known, grade, grade_rank, credit_limit, available, standing,
  status, defaulted, overdue, ever_defaulted, requires_reassessment, assessed_at`.)

### 2c. Choosing your policy

- **Pick any bar.** The same oracle serves a conservative app (`min_grade="AA"`) and a permissive
  one (`min_grade="C"`) with zero change to Credence. Note that **C is reachable without identity
  proof, but A/AA/AAA are not** — so if your app wants to admit only borrowers who proved
  ownership of real capacity, require `A` or higher.
- **Sticky vs. continuous.** The pattern above is *sticky*: once admitted, a member stays
  admitted even if their grade later moves (the privilege was earned on the reputation that
  existed at claim time — exactly how a real allowlist behaves). If instead you want
  **continuous** enforcement — e.g. a borrowing limit that must track the live grade — don't cache
  membership; call `is_creditworthy` at the moment of *each* gated action. Credence computes
  delinquency live from the consensus clock, so the answer is never stale behind a keeper.

---

## 3. Off-chain: read the oracle from TypeScript

A dApp, keeper, or backend reads the exact same oracle through `@credence/sdk`. No account is
needed for reads.

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { CredenceClient } from "@credence/sdk";

const CREDENCE = "0xYourDeployedCredenceAddress";

// A read-only client (no account) is enough to consume the oracle.
const credence = new CredenceClient(createClient({ chain: studionet }), CREDENCE);

// ── One-call gate: does this address currently hold at least an "A" line? ──
const ok: boolean = await credence.isCreditworthy(userAddress, "A");
if (ok) {
  // ...unlock your feature / waive a deposit / raise a limit...
}

// ── Full standing record (maps to the contract's credit_of). ──
const rec = await credence.creditOf(userAddress);
if (rec.known && !rec.defaulted) {
  console.log(
    `${userAddress}: grade ${rec.grade} (rank ${rec.grade_rank}),`,
    `standing ${rec.standing},`,
    `limit ${CredenceClient.fromBaseUnits(rec.credit_limit)} tokens`,
  );
}
```

Notes grounded in the SDK:

- `isCreditworthy(borrower, minGrade)` → `boolean`; `creditOf(borrower)` → `CreditRecord`. Both
  **never throw** for an unknown address — you get `false` / `{known:false, grade:"DENY", …}`.
- Money fields (`credit_limit`, `available`) come back as **base-unit integer strings** — never
  coerce them to `number` (a JS number can't hold `1e18`). Use `CredenceClient.fromBaseUnits(...)`
  to display them as whole tokens.
- Enumerate the whole borrower roster for a dashboard with `pageBorrowers(offset, 50)`
  (`next_offset` is `-1` on the last page).

### A continuous off-chain gate (snippet)

```ts
/** Call this at the moment of each gated action, not once at sign-up. */
async function assertCreditworthy(user: string, bar: Grade): Promise<void> {
  const ok = await credence.isCreditworthy(user, bar);
  if (!ok) {
    const rec = await credence.creditOf(user);
    throw new Error(
      rec.known
        ? `grade ${rec.grade} is below ${bar}` +
          (rec.defaulted ? " (in default)" : rec.overdue ? " (overdue)" : "")
        : "address is unknown to Credence",
    );
  }
}
```

(`Grade` is the exported union `"DENY" | "C" | "B" | "A" | "AA" | "AAA"`.)

---

## 4. Deploy your gated contract against studionet

Follow [DEPLOY.md](../DEPLOY.md) for the full account/funding model. The short version: a small
`genlayer_py` script, run with the repo's venv Python in isolated mode, deploys for free on
studionet (chain `61999`) via `sim_fundAccount` — no seed phrase, no captcha, no real funds.

```powershell
& "python" -I "<path>\deploy_gated.py"
```

```python
"""Deploy MyGatedApp pointed at a live Credence oracle on studionet (chain 61999)."""
import json
from genlayer_py import create_client, create_account
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionStatus

CREDENCE_ADDR = "0xYourDeployedCredenceAddress"   # from your Credence deploy
GATED_PATH    = r"<path>\my_gated_app.py"

with open(GATED_PATH, "r", encoding="utf-8") as fh:
    code = fh.read()

acct = create_account()                                   # throwaway, in-memory key
client = create_client(chain=studionet, account=acct)
client.fund_account(acct.address, 1000 * 10**18)          # free test GEN on Studio

# Deploy, passing the Credence address + your chosen bar to the constructor.
dep = client.deploy_contract(code=code, kwargs={"credence": CREDENCE_ADDR, "min_grade": "A"})
rcpt = client.wait_for_transaction_receipt(
    transaction_hash=dep, status=TransactionStatus.ACCEPTED, interval=3000, retries=80)
gated = rcpt.get("data", {}).get("contract_address") \
    or rcpt.get("tx_data_decoded", {}).get("contract_address")
print("GATED APP:", gated, flush=True)

# A caller claims — the contract reads Credence across contracts to decide.
tx = client.write_contract(address=gated, function_name="claim", args=[])
client.wait_for_transaction_receipt(
    transaction_hash=tx, status=TransactionStatus.ACCEPTED, interval=3000, retries=60)

print("admitted:", client.read_contract(
    address=gated, function_name="is_admitted", args=[acct.address]), flush=True)
```

### What to expect

- If the caller is rated **at or above** your bar and in good standing, `claim()` succeeds and
  records their snapshotted grade. `is_admitted(addr)` → `True`.
- If not, `claim()` **reverts** with your clear message — there is no way around the gate.
- A caller Credence has *never assessed* is unknown → `is_creditworthy → False` → reject.
- Because Studio is a shared sandbox that is periodically reset, deployed addresses are
  **ephemeral** — re-run to get a fresh deployment.

The shipped proof of this exact flow (three `claim()` phases against a real borrower and a
stranger, with on-chain addresses) is in [COMPOSABILITY.md §4](../COMPOSABILITY.md) and the
script [`scripts/compose_studio.py`](../../scripts/compose_studio.py).

---

## 5. Ideas to extend

You now have a one-line credit gate. Swap the "allowlist" for anything a privilege can mean:

- **Waive a deposit / raise a limit.** Instead of recording membership, unlock a real action:
  a zero-collateral rental, a higher withdrawal cap, a fee discount — gated on `min_grade`.
- **Tiered access by grade.** Read `credit_of(addr).grade_rank` and map each rung to a different
  tier (C → bronze, A → gold, AAA → platinum) in one read.
- **Agent-to-agent trust.** Have one autonomous agent gate a service it offers another agent on
  that agent's live Credence grade — no escrow, no stake.
- **Continuous risk-priced perks.** Re-check `is_creditworthy` at each action and adjust the
  price/limit as the borrower's grade moves with their repayment behavior.
- **Portable reputation.** Mint a soulbound credit passport from the same `credit_of` read — see
  the shipped [`CredencePassport`](../../contracts/credence_passport.py) and [PASSPORT.md](../PASSPORT.md).
- **Governance over your own bar.** Let an M-of-N multisig set your `min_grade`, mirroring how
  [`CredenceGovernor`](../../contracts/credence_governor.py) owns Credence ([GOVERNANCE.md](../GOVERNANCE.md)).

---

### Next

- The borrower & lender side of the protocol → [borrow-and-lend.md](borrow-and-lend.md)
- Why any of this works → [../EXPLAINER.md](../EXPLAINER.md)
- The full method surface & conventions → [../INTEGRATION.md](../INTEGRATION.md)
