# Composability: Credence as a Creditworthiness Oracle

**Credence is judgment-as-a-service.** Its AI underwriter panel turns live, off-chain
evidence into a bounded, consensus-backed **credit grade** (`DENY < C < B < A < AA < AAA`)
and exposes it through two ordinary read-only methods. Any other GenLayer Intelligent
Contract can call those methods **synchronously, across contracts, on-chain** and gate a
real action on the result — with no collateral, no token of its own, and no trust in the
caller.

This repo ships the proof: a **second** contract,
[`contracts/credence_gated.py`](../contracts/credence_gated.py) (`CredenceGatedVault`),
that consumes Credence's oracle, and a live studionet integration script,
[`scripts/compose_studio.py`](../scripts/compose_studio.py), that deploys both and exercises
the cross-contract read end-to-end.

---

## 1. The oracle surface

Credence exposes two `@gl.public.view` methods built to be consumed by other contracts
(see [`contracts/credence.py`](../contracts/credence.py)):

```python
@gl.public.view
def is_creditworthy(self, borrower: str, min_grade: str) -> bool:
    """True iff `borrower` currently holds at least `min_grade` AND is not in
    default/overdue — a one-call gate for other protocols."""

@gl.public.view
def credit_of(self, borrower: str) -> dict:
    """The borrower's live standing as a plain dict:
    keys: known, grade, grade_rank, credit_limit, available, standing, status,
          defaulted, overdue, ever_defaulted, requires_reassessment, assessed_at.
    Returns a safe 'unknown' record for an address Credence has never assessed."""
```

Both are **pure reads** of Credence's state. `is_creditworthy` is the one-call gate;
`credit_of` is the richer record. Both report *live* delinquency from the consensus clock,
so a consumer never sees a stale "current" status, and both return a safe default for an
unknown address (`is_creditworthy -> False`, `credit_of -> {known: False, grade: "DENY", …}`)
— a consumer can never be tricked into trusting an address Credence has not vouched for.

---

## 2. The cross-contract call pattern (synchronous `.view()`)

GenLayer's SDK (`gl.get_contract_at`) returns a proxy whose `.view()` namespace performs a
**synchronous** read of another contract's `@gl.public.view` methods (it resolves through a
`CallContract` sub-VM call and blocks for the decoded result). Writes go through the
asynchronous `.emit()` / `.emit_transfer()` namespaces instead — but for consuming an
oracle you want the synchronous read:

```python
from genlayer import *

# untyped — quickest:
ok = gl.get_contract_at(credence_addr).view().is_creditworthy(borrower_hex, "A")  # -> bool
rec = gl.get_contract_at(credence_addr).view().credit_of(borrower_hex)            # -> dict
```

`credence_addr` is an `Address`; `borrower_hex` is a `0x…`-prefixed 40-hex-char string
(e.g. `gl.message.sender_address.as_hex`).

### Typed interface (recommended)

For static type-checking and self-documentation, declare a `@gl.contract_interface` stub of
just the methods you consume. It has **no runtime cost** (it resolves to `get_contract_at`)
but gives the calls real return types. This is the pattern `CredenceGatedVault` uses:

```python
@gl.contract_interface
class ICredence:
    class View:
        def is_creditworthy(self, borrower: str, min_grade: str) -> bool: ...
        def credit_of(self, borrower: str) -> dict: ...

    class Write:
        pass

# usage inside a write method:
oracle = ICredence(self.credence)                       # self.credence: Address
if not oracle.view().is_creditworthy(sender_hex, self.min_grade):
    _fail("not creditworthy")
rec = oracle.view().credit_of(sender_hex)               # typed dict
```

---

## 3. The use case: an undercollateralized privilege

Every allowlist, perk, or preferential rate on a deterministic chain today has to fall back
on a hard asset — a deposit, a lock, a stake, or a hand-curated whitelist — because the
chain cannot *judge* who deserves the privilege. Credence removes that constraint:
**reputation becomes the collateral.**

`CredenceGatedVault` is a minimal, collateral-free allowlist. Its `claim()` admits the
caller **iff** Credence currently rates them at or above `min_grade` and in good standing:

```python
@gl.public.write
def claim(self) -> dict:
    addr = gl.message.sender_address.as_hex
    if addr in self.members:
        _fail("already admitted")

    oracle = ICredence(self.credence)
    if not oracle.view().is_creditworthy(addr, self.min_grade):   # <-- cross-contract read
        _fail(f"not creditworthy: Credence must rate you at least {self.min_grade} ...")

    rec = oracle.view().credit_of(addr)                           # <-- snapshot the grade
    # record the caller as an admitted member (grade + standing snapshot = the privilege)
    ...
```

The admission record — the live grade and standing *read from Credence at claim time* — is
itself the granted privilege. A production vault would do more with the same gate: waive a
deposit, unlock a fee discount, raise a borrowing limit, or let a member into a round. The
point is that the gate is a single oracle read, and **there is no path to self-admit around
it**: the vault stores no grades of its own and trusts only what Credence returns.

Admission is intentionally sticky (once admitted, a member stays admitted even if their
grade later moves) — the privilege was earned on the reputation that existed at claim time,
which is exactly how a real allowlist behaves. A consumer that wants continuous enforcement
would instead call `is_creditworthy` at the moment of each gated action rather than caching
membership.

---

## 4. Verifying it live

Cross-contract calls require a real GenVM host with the contract-call hook, so they **do
not run in gltest "direct" mode** (the unit-test harness has no cross-contract hook) — the
oracle read cannot be unit-tested in direct mode, and this repo does not fake one. The
honest end-to-end proof is on **studionet**, via
[`scripts/compose_studio.py`](../scripts/compose_studio.py):

```powershell
& "python" -I scripts\compose_studio.py
```

It deploys Credence, deploys `CredenceGatedVault` pointed at it, has a borrower assessed by
Credence's AI panel, then drives three `claim()` calls:

| Phase | Caller   | Vault bar | Vault reads `is_creditworthy(...)` | Outcome |
|-------|----------|-----------|------------------------------------|---------|
| A     | borrower | `AAA`     | `False` (grade below AAA)          | **reject** — threshold enforced |
| B     | borrower | `C`       | `True`                             | **admit** — grade snapshotted from Credence |
| C     | stranger | `C`       | `False` (unknown to Credence)      | **reject** — no reputation |

Text-only evidence is capped at grade `C` in Credence (its identity-bound rule: reaching
`A`/`AA`/`AAA` requires ownership-proven URL evidence), which makes Phases A and C
**deterministic** regardless of how the shared LLM votes — both reject because the live
cross-contract read returns `False`. Phase B (admit) additionally needs the AI panel to land
a grade `>= C`; Studio's shared LLM is slow and may time out or reset, in which case the
script reports that honestly and Phases A/C still prove the cross-contract read runs
on-chain. See `docs/DEPLOY.md` for the studionet account/funding model the script reuses.

### Evidence (real run, 2026-11-03, studionet chain 61999)

Both contracts deployed from the on-disk source, unmodified, and the full flow ran:

```
Credence oracle   : 0xAfD90b5E0070a5F067E3848eD7aE448F1E9a849E
Gated vault       : 0xB9Ff85656f487FBF8530886dfFf8dCa47f1eB0f5   (credence -> the oracle above)
assess landed grade: C  (borrower approved, standing 50, assessed on-chain by the AI panel)

Phase A  bar=AAA  borrower  ->  is_creditworthy(borrower,"AAA")=False  ->  REJECT  (not admitted)
Phase B  bar=C    borrower  ->  is_creditworthy(borrower,"C")  =True   ->  ADMIT
         vault.get_member(borrower) = {grade:"C", grade_rank:1, standing:50, seq:1, admitted_at:...}
         ^ grade & standing SNAPSHOTTED FROM CREDENCE via credit_of() across contracts
Phase C  bar=C    stranger  ->  is_creditworthy(stranger,"C")=False   ->  REJECT  (not admitted)
```

Every `claim()` decision was produced by the vault reading Credence across contracts; the
admitted member's grade/standing in the vault's own storage came from Credence's
`credit_of`. Studio is a shared sandbox and is periodically reset, so these addresses are
ephemeral — re-run the script for a fresh deployment. (GenLayer does not populate a
receipt's execution-result fields at the `ACCEPTED` stage, so the script classifies each
outcome from contract **state** — `is_admitted` — rather than from the receipt.)

---

## 5. Why this matters

- **One integration, any grade bar.** A consumer picks its own `min_grade`; the same oracle
  serves a conservative vault (`AA`) and a permissive one (`C`) with no change to Credence.
- **No oracle feeds, no collateral.** The "price" being read is a *judgment* produced by a
  consensus panel of AI underwriters on live evidence — something only GenLayer can do on
  chain — not a number pushed by a trusted reporter.
- **Composable by default.** Because the interface is just `@gl.public.view` methods,
  Credence is a creditworthiness primitive the whole ecosystem can plug into:
  undercollateralized lending, gated allowlists, risk-priced perks, agent-to-agent trust.
