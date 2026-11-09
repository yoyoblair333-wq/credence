# Credence — Events

Credence emits an event on every state transition so indexers, UIs, and off-chain keepers
can follow the protocol without polling. This document tables every event with its
**indexed field** and its **blob keys**, grounded in the event classes and the `_emit(...)`
call sites in [`contracts/credence.py`](../contracts/credence.py).

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## How Credence events are shaped

Each event class takes a single **positional-only** argument (the field before `/` in
`__init__`) and arbitrary keyword blob fields:

```python
class CreditRequested(gl.Event):
    def __init__(self, borrower: str, /, **blob): ...
```

- The positional-only parameter is the event's **indexed topic field** — the address the
  event is about (`borrower` for borrower-lifecycle events, `lender` for pool events).
- Everything passed as `**blob` is the event's non-indexed payload.

**Money fields are decimal strings in base units (1 token = 1e18).** They are emitted as
`str(...)` to avoid bigint truncation across the ABI — parse them as big integers, not JS
numbers. Counts, epoch seconds, and booleans are emitted as their native types.

---

## Best-effort delivery (important for indexer authors)

Every event is emitted through the `_emit` helper:

```python
def _emit(ev) -> None:
    try:
        ev.emit()
    except Exception:
        pass
```

Emission is **best-effort**: `_emit` swallows any host rejection so that a host which does
not accept an event can **never break a state transition**. Practical consequences:

- **The contract's state is the source of truth, not its event stream.** A state change
  can succeed even if its event was not recorded. Reconcile from the views
  (`get_borrower`, `get_pool`, `credit_of`, `lender_balance`, `page_borrowers`, `stats`)
  rather than assuming the event log is complete.
- Build indexers to tolerate a **missing** event for a transition that nonetheless
  happened; prefer reconciling against state on a cadence (e.g. after `service_book` runs).
- Events are observability, not consensus: the binding assessment output is the stored
  grade/votes, not the `CreditAssessed` event.

---

## Event catalog

All eight events below are defined and emitted in `contracts/credence.py`.

| Event | Emitted by | Indexed field | Blob keys (type) |
|---|---|---|---|
| `CreditRequested` | `request_credit` | `borrower` (address) | `requested` (string, whole tokens requested), `evidence_items` (int, number of evidence items submitted) |
| `CreditAssessed` | `assess` **or** `appeal` | `borrower` (address) | `grade` (string, one of `DENY`/`C`/`B`/`A`/`AA`/`AAA`), `credit_limit` (string, base units), `ownership_proven` (bool), `tier` (int, `appeal_tier`: `0` for an original assessment, `1` for an appeal result) |
| `Drawn` | `draw` | `borrower` (address) | `amount` (string, base units drawn), `fee` (string, base units of origination fee accrued this draw), `principal` (string, base units outstanding after the draw), `due_at` (int, epoch seconds the line is due) |
| `Repaid` | `repay` | `borrower` (address) | `amount` (string, base units repaid this call), `principal` (string, base units still outstanding after), `fee_paid` (string, base units of fee paid this call), `interest_paid` (string, base units of interest paid this call), `on_time` (bool, repaid on or before `due_at`) |
| `Defaulted` | `service_book` | `borrower` (address) | `debt` (string, base units outstanding = principal + fee at default), `defaults` (int, borrower's lifetime default count after this one) |
| `Funded` | `fund` | `lender` (address) | `amount` (string, base units deposited this call), `funded` (string, base units the lender has contributed in total) |
| `Defunded` | `defund` | `lender` (address) | `amount` (string, base units redeemed this call), `funded` (string, base units the lender has remaining after) |
| `YieldClaimed` | `claim_yield` | `lender` (address) | `amount` (string, base units of yield claimed) |

### Exact emit call sites (for verification)

```python
# request_credit
_emit(CreditRequested(addr, requested=str(requested_tokens), evidence_items=len(evidence)))
# assess / appeal (both go through _apply_result)
_emit(CreditAssessed(addr, grade=grade, credit_limit=str(int(b.credit_limit)),
                     ownership_proven=b.ownership_proven, tier=int(b.appeal_tier)))
# draw
_emit(Drawn(addr, amount=str(amt), fee=str(fee), principal=str(int(b.principal)),
            due_at=int(b.due_at)))
# repay
_emit(Repaid(addr, amount=str(value), principal=str(int(b.principal)),
             fee_paid=str(pay_fee), interest_paid=str(pay_interest), on_time=on_time))
# service_book (per borrower moved to default)
_emit(Defaulted(addr, debt=str(debt), defaults=int(b.defaults)))
# fund
_emit(Funded(addr, amount=str(value), funded=str(self._funded_of(addr))))
# defund
_emit(Defunded(addr, amount=str(amt), funded=str(self._funded_of(addr))))
# claim_yield
_emit(YieldClaimed(addr, amount=str(amt)))
```

### Notes per event

- **`CreditRequested.requested`** is the **whole-token** figure the borrower asked for
  (e.g. `"500"`), not base units — it mirrors the `requested_tokens` argument. The stored
  `requested` on the borrower record is in base units (`requested_tokens * 1e18`); the
  event carries the human figure.
- **`CreditAssessed`** fires once per `assess` **or** `appeal` call (both apply their panel
  result through the shared `_apply_result`), for both approval and denial. On a `DENY`
  outcome `grade` is `"DENY"` and `credit_limit` is `"0"`. The `tier` key distinguishes an
  original assessment (`tier` `0`) from an appeal result (`tier` `1`), so an indexer can tell
  the two apart on the same borrower. The **event set is unchanged** in v1.3 (still the eight
  events above); only this new `tier` blob key was added — no new event type.
- **`Drawn.fee`** is the origination fee accrued **on this draw**, priced by grade
  (`ORIGINATION_BPS_BY_GRADE`), minimum 1 base unit; `due_at` is set on the opening draw of
  a line and unchanged by later draws against the same line.
- **`Repaid`** fires on every `repay`, including partial repayments (`principal` > 0 after).
  `fee_paid` and `interest_paid` are the fee and interest portions settled **on this call**
  (repayment applies value in the order principal → fee → interest), so an indexer can track
  how much of each repayment was principal vs. fee vs. interest; `interest_paid` is `"0"`
  whenever the time-based APR is off or no interest had accrued. `on_time` reflects whether
  the repayment landed on or before `due_at`. The `interest_paid` key is the only event
  change in v1.4 — no new event type was added.
- **`Defaulted`** is emitted inside `service_book` **only on the transition** into
  `defaulted` (the status guard `if b.status != "defaulted"`), so a line defaults — and
  emits — at most once per outstanding cycle, even across repeated servicing passes.
- **`Funded` / `Defunded`** carry both the delta (`amount`) and the lender's running total
  (`funded`), so an indexer can track positions without replaying the whole log.

---

## Related: the composability consumer

The companion [`contracts/credence_gated.py`](../contracts/credence_gated.py)
(`CredenceGatedVault`) emits its own best-effort event when it admits a member on the
strength of Credence's oracle:

| Event | Emitted by | Indexed field | Blob keys (type) |
|---|---|---|---|
| `Admitted` | `claim` | `member` (address) | `grade` (string, the grade snapshotted from Credence at admission), `min_grade` (string, the vault's bar), `seq` (int, 1-based admission order) |

It uses the same best-effort `_emit` pattern. See [`docs/COMPOSABILITY.md`](COMPOSABILITY.md)
for how the vault reads Credence's oracle across contracts.
