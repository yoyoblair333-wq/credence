# Governance: an on-chain M-of-N multisig over Credence

**Contract:** [`contracts/credence_governor.py`](../contracts/credence_governor.py) — `CredenceGovernor`
**Driver / live proof:** [`scripts/governance_studio.py`](../scripts/governance_studio.py)
**Status:** lint-clean + type-clean (genvm-lint); live studionet evidence at the bottom.

GenLayer referral: **JTR01FHP**   `#CreditWithoutCollateral`

---

## 1. Why this exists

Credence gates every treasury / economic / lifecycle action behind a **single owner
address**. Its admin methods all check the same thing:

```python
# credence.py
def _require_owner(self) -> None:
    if gl.message.sender_address != self.owner:
        _fail(ERR, "only the owner may call this")
```

For an enterprise or a DAO running Credence, a single owner key is a single point of
failure: one lost or compromised key can pause the protocol, rewrite its economics
(`set_terms`, `set_risk_limits`), drain accrued fees (`withdraw_fees`), flip autonomy, or
hand ownership away. `CredenceGovernor` replaces that single key with an **M-of-N
multisig** — **without changing a single line of Credence.**

The insight is that Credence only ever checks the **message sender**. So if Credence's
ownership is moved to a deployed `CredenceGovernor`, then every owner-only call the
governor *emits* arrives at Credence with `sender_address == governor == Credence.owner`
and passes. Ownership of Credence becomes *"whatever an M-of-N quorum of signers agrees
to,"* with **zero** bespoke access-control code inside Credence itself. This is the
canonical "multisig owns the protocol" pattern, native to GenLayer.

---

## 2. The model (M-of-N over Credence admin)

- **N signers, threshold M** (`1 <= M <= N`) are fixed at construction.
- The signer set and threshold are **IMMUTABLE for v1** (see §6). This is a deliberate
  auditability choice: there is no governance-of-the-governance surface, no path for a
  quorum to silently lower the bar or add a colluding key.
- Only a signer can `propose`, `approve`, or `execute`. Everyone else is rejected.
- A proposal carries exactly **one** action drawn from a **closed ALLOWED set**, each
  mapping 1:1 to a Credence owner-only method. Unknown actions are rejected at propose
  time; malformed or out-of-range arguments can never be stored.

### The ten governable actions

| Governor action | Credence method | Arguments (how to pass them) |
|---|---|---|
| `set_paused` | `set_paused(bool)` | `bool_arg` |
| `set_autonomous` | `set_autonomous(bool)` | `bool_arg` |
| `set_guardian` | `set_guardian(str)` | `address_arg` (0x…40hex) |
| `set_relayer` | `set_relayer(str)` | `address_arg` |
| `set_dev` | `set_dev(str)` | `address_arg` |
| `set_risk_limits` | `set_risk_limits(int)` | `uint_args_json = "[max_utilization_bps]"` (0–10000) |
| `set_terms` | `set_terms(int,int,int)` | `uint_args_json = "[lender_share_bps, term_seconds, grace_seconds]"` |
| `withdraw_fees` | `withdraw_fees(str,int)` | `address_arg` = `to` (empty ⇒ Credence routes to `dev`), `uint_args_json = "[amount]"` |
| `transfer_ownership` | `transfer_ownership(str)` | `address_arg` = new owner |
| `accept_ownership_of_credence` | `accept_ownership()` | *(none)* — the bootstrap step |

Arguments are **decoded and range-validated at `propose` time** and stored verbatim, so a
proposal that could only ever revert inside Credence (e.g. `max_utilization_bps > 10000`)
is rejected before it can ever be approved. The validation mirrors Credence's own bounds.

---

## 3. Proposal lifecycle

```
          propose(action, args)                 approve(id)              execute(id)
 signer ───────────────────────▶  PENDING  ◀───────────────── signer   ───────────────▶ EXECUTED
          (proposer auto-approves)   │       (idempotent, 1 per signer)   (approvals ≥ M, once)
                                     │
                                     └── approvals accumulate until approvals ≥ threshold
```

1. **`propose(action, address_arg="", uint_args_json="", bool_arg=False) -> int`**
   A signer submits one ALLOWED action. Args are validated and stored; the **proposer
   auto-approves** (approvals = 1). Returns the new proposal `id` (ids are sequential from
   0; `proposal_count` is the next id).
2. **`approve(id)`** — a signer adds their approval. **Idempotent** (approving twice is a
   no-op); only signers; rejected once the proposal is executed.
3. **`execute(id)`** — allowed only when `status == pending` **and** `approvals >=
   threshold`. It flips the proposal to `executed` **before** emitting the external call
   (checks-effects-interactions, so a proposal can execute **at most once**), dispatches
   the stored action to Credence, and emits a `GovExecuted` event.

Every step emits an event for indexers/UIs: `GovProposed`, `GovApproved`, `GovExecuted`.

### Reads (all bounded)
- `get_proposal(id)` → full proposal record (action, decoded args, proposer, approvals
  list, approval_count, threshold, status, `executable`, timestamps).
- `list_proposals(offset, limit)` → paginated, capped at `MAX_PAGE = 50`; returns
  `{total, offset, next_offset, items}`.
- `get_signers()` → the signer list. `is_signer(addr)` → bool.
- `get_config()` → `{version, credence, threshold, signers, signer_count,
  proposal_count, allowed_actions}`.

---

## 4. The cross-contract execution pattern

Credence's admin methods are **writes**, and on GenLayer a cross-contract **write is
asynchronous**: you *post a message* to be delivered when the current transaction reaches
the chosen consensus stage. Confirmed from the SDK (`genvm_contracts.py`):

- `gl.get_contract_at(addr).view().method(...)` — **synchronous** read, returns a value.
- `gl.get_contract_at(addr).emit(on="finalized").method(...)` — **asynchronous** write
  (a `PostMessage`), returns **`None`**. The call is delivered after this transaction
  **finalizes**.

`CredenceGovernor.execute` dispatches the stored action exactly this way. It uses a typed
`@gl.contract_interface` stub (`ICredence`) — which, per the SDK, resolves at runtime to
`gl.get_contract_at` and adds only static types — so every emitted call has a checked
signature and the contract documents precisely which Credence methods it may drive:

```python
def _dispatch(self, p: Proposal) -> None:
    c = ICredence(self.credence).emit(on="finalized")   # == gl.get_contract_at(credence).emit(...)
    if   p.action == "set_paused":      c.set_paused(bool(p.bool_arg))
    elif p.action == "set_risk_limits": c.set_risk_limits(int(json.loads(p.uint_args_json)[0]))
    elif p.action == "set_terms":
        a = json.loads(p.uint_args_json); c.set_terms(int(a[0]), int(a[1]), int(a[2]))
    elif p.action == "withdraw_fees":
        a = json.loads(p.uint_args_json); c.withdraw_fees(p.address_arg, int(a[0]))
    elif p.action == "transfer_ownership": c.transfer_ownership(p.address_arg)
    elif p.action == "accept_ownership_of_credence": c.accept_ownership()
    # ... set_autonomous / set_guardian / set_relayer / set_dev
```

Because the message is sent **from the governor contract**, Credence sees
`gl.message.sender_address == governor`. Once the governor is Credence's owner, that
equals `Credence.owner`, so the owner-only guard passes.

> **Consequence of the async model.** `execute` cannot read a return value from Credence,
> and the effect lands only after finalization — so the live script below **polls
> Credence's own state** for the ground truth of each step rather than trusting a receipt.
> Marking the proposal `executed` before the emit is intentional (checks-effects-
> interactions): the external effect is scheduled last and the proposal can never
> double-execute. One consequence: **`executed` means "dispatched after quorum," not
> "confirmed by Credence."** Argument ranges are validated at propose time against
> Credence's storage widths (bps fields to 0–10000, term/grace to uint64, amounts to
> uint256), so static validation can never cause a later revert; but an action with a
> Credence *runtime* precondition — `accept_ownership_of_credence` before the external
> owner has run `transfer_ownership(governor)`, or `withdraw_fees` beyond accrued
> `fee_revenue` — will revert on Credence's side while the proposal stays marked
> executed. Propose such actions only once their precondition already holds (the live
> demo sequences them correctly). A future v2 could add a synchronous `view()` pre-flight
> for the pre-flightable cases.

### Why there is no cross-contract unit test
In `gltest` **direct mode** there is no sub-VM hook, so an emitted cross-contract write
has nowhere to land and cannot be faithfully unit-tested. Rather than fake one, the write
path is exercised **live on studionet** by `scripts/governance_studio.py` (§7). The
deterministic, in-process logic (validation, access control, threshold arithmetic,
storage) is what `genvm-lint` checks and what the negative controls in the script verify
on-chain.

---

## 5. Bootstrapping: handing Credence to the multisig

Credence uses a **two-step ownership transfer** (propose-then-accept), so handing it to
the governor is two moves:

1. **Current owner → `Credence.transfer_ownership(governor)`.** Sets
   `Credence.pending_owner = governor` (owner unchanged).
2. **Governor → `Credence.accept_ownership()`,** driven by a governed
   `accept_ownership_of_credence` proposal (propose → reach M approvals → execute). This
   works *before* the governor is owner, because `accept_ownership` only requires
   `sender == pending_owner and pending_owner != owner` — both true for the governor at
   this point. After it lands, `Credence.owner == governor`, and the multisig is in
   control.

**Rotating signers** (v1 has an immutable set) is likewise explicit and transparent:
deploy a fresh governor with the new set and pass a `transfer_ownership(new_governor)`
proposal on the old one; the new governor then runs `accept_ownership_of_credence`.

---

## 6. Security properties

- **No single point of failure.** No single key can move funds or change economics;
  every owner-only action requires M independent approvals.
- **Closed action set.** Only the ten mapped actions exist; unknown actions revert at
  propose time. No arbitrary-call / delegatecall surface.
- **Validated, immutable proposals.** Arguments are decoded, type-checked, arity-checked
  and range-checked at propose time (addresses via strict `0x`+40-hex validation; ints
  are real ints — JSON `true`/`false` is rejected where an integer is required — bounded
  to uint256 and to Credence's own ranges). A stored proposal cannot carry a malformed
  argument.
- **One-shot execution.** `status` flips to `executed` before the external emit; a
  proposal executes at most once; `approve`/`execute` are refused after execution.
- **Signer-only governance.** `propose`, `approve`, and `execute` all require
  `gl.message.sender_address` to be in the signer set (O(1) `TreeMap` membership).
- **Immutable trust assumptions (v1).** The signer set and threshold are fixed at deploy
  time — no governance-of-the-governance, nothing to silently weaken. This is the main
  deliberate design choice; a future v2 could add governed `add_signer` / `remove_signer`
  / `set_threshold` actions.
- **Determinism.** Approvals are stored as a **sorted** JSON array and the decoded uint
  args as a canonical JSON array, so the stored bytes are identical across every
  validator (no set/dict iteration-order nondeterminism).
- **House hardening, reused.** Same style as Credence/`credence_gated`: `@allow_storage`
  dataclasses with scalar fields only, u256/u32 sized storage, bounded paginated views,
  best-effort events that never break a state transition, and clear prefixed reverts.

### Trust / threat notes
- Members trust that **M of N signers are honest and independent.** A colluding quorum of
  size M can do anything the owner could — that is the definition of the threshold, not a
  bug. Choose N and M accordingly.
- The governor contract may need a small native balance to pay gas on the messages it
  emits; the deploy runbook funds it.
- Credence's `set_paused` can also be called by its `relayer`/`guardian` directly (by
  Credence's own design); governance does not remove those separation-of-duties roles, it
  governs the **owner** seat.

---

## 7. Live proof on studionet

`scripts/governance_studio.py` deploys Credence + the governor (2 signers, threshold 2) to
GenLayer **studionet** (chain `61999`) with throwaway, free-funded accounts, then:

1. deploys both contracts and asserts the governor is 2-of-2 over Credence;
2. **negative control** — a non-signer `propose()` is rejected (no proposal created);
3. hands Credence to the multisig: `transfer_ownership(governor)` → a 2-of-2
   `accept_ownership_of_credence` proposal → polls `Credence.get_config` until
   `owner == governor`;
4. **negative control** — a `set_risk_limits` proposal cannot be executed at 1/2;
5. governs a real admin change: a 2-of-2 `set_risk_limits(8000)` → polls
   `Credence.get_config` until `max_utilization_bps == 8000`, proving the change took
   effect **across contracts**.

Run it with the venv python in isolated mode:

```powershell
& "python" -I scripts\governance_studio.py
```

### Evidence (live run)

<!-- LIVE_EVIDENCE -->
**Ran successfully, end to end, on studionet on 2026-11-03.** The governor took ownership
of Credence and a 2-of-2 quorum changed a Credence admin parameter across contracts; both
negative controls held. Real, unedited console output:

```
0. SETUP (throwaway accounts on studionet, chain 61999)
   deployer : 0x1e14d831b519b5B2563190999840AB5B093a6807
   signer_a : 0xf95FB0595194e11E656980A0764f4dF7e1F3788a
   signer_b : 0xaDb30AA14a46d36063E75f3C37BaDC5c76dc4D36
   stranger : 0xed70900D78ed35F6790b366C43C9835Bb15c31fD

1. Credence deployed at 0x0c91eDa7aA6B1E758feFE863B3461187eE1E9276  (owner = deployer)
2. CredenceGovernor deployed at 0x57E576BF5e3e9e5d2C2dE2ce7Ac60c173C572B14
   get_config: threshold=2, signer_count=2, signers=[signer_a, signer_b], proposal_count=0
   is_signer(signer_a)=True   is_signer(stranger)=False

4. NEGATIVE CONTROL — stranger (non-signer) propose()
   -> proposal_count still 0 ... NON-SIGNER BLOCKED: YES (no proposal created)

5. HAND CREDENCE TO THE MULTISIG
   5a. deployer -> Credence.transfer_ownership(governor); Credence.pending_owner = governor
   5b. signer_a proposes accept_ownership_of_credence  -> proposal[0], approvals 1/2
   5c. signer_b approves                               -> approvals 2/2, executable=True
   5d. signer_a executes -> governor emits Credence.accept_ownership()
       [poll] Credence.owner: deployer -> 0x57E576BF5e3e9e5d2C2dE2ce7Ac60c173C572B14  <- settled
   CREDENCE NOW OWNED BY THE GOVERNOR: YES

6. GOVERN AN ADMIN ACTION: set_risk_limits(8000) via 2-of-2
   Credence.max_utilization_bps before: 10000
   6a. signer_a proposes set_risk_limits [8000]        -> proposal[1], uint_args=[8000]
   6b. NEGATIVE CONTROL — execute at 1/2 -> refused, status still "pending": BLOCKED: YES
   6c. signer_b approves                               -> 2/2
   6d. signer_b executes -> governor emits Credence.set_risk_limits(8000)
       [poll] Credence.max_utilization_bps: 10000 -> 8000  <- settled
   ADMIN ACTION TOOK EFFECT ACROSS CONTRACTS: YES (max_utilization_bps=8000)
   governor proposal[1] final status: executed

SUMMARY
   Non-signer propose blocked           -> YES [ok]
   Under-threshold execute blocked      -> YES [ok]
   Governor took ownership of Credence  -> YES [ok]
   2-of-2 set_risk_limits(8000) applied -> YES [ok]
   ON-CHAIN M-of-N GOVERNANCE OVER CREDENCE PROVEN: YES
```

What this proves on a live network: (1) the governor is Credence's **owner** — a
cross-contract `accept_ownership()` emitted by the multisig actually flipped
`Credence.owner`; (2) a Credence **owner-only** parameter (`max_utilization_bps`) was
changed **only** after a 2-of-2 quorum, by a call **emitted from the governor to
Credence**, confirmed by reading Credence's own state (`10000 → 8000`); (3) a non-signer
cannot propose and an under-approved proposal cannot execute. The emitted writes settled
within one poll cycle each; the script reads Credence's live state for ground truth and
never fabricates a result.

> studionet is a shared sandbox and is periodically reset, so these addresses are
> ephemeral — re-run the script for a fresh deployment. No real funds, no captcha, no seed
> phrase; the machine's global CLI network/account were left untouched.

### genvm-lint (deterministic logic — always reproducible)

```
$ genvm-lint check contracts/credence_governor.py
  ✓ Lint passed (3 checks)
  ✓ Validation passed
    Contract: CredenceGovernor
    Methods: 8 (5 view, 3 write)

$ genvm-lint typecheck contracts/credence_governor.py
  ✓ No type errors found
```
