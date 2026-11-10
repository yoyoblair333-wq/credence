# CreditPassport: a soulbound credit-grade registry for GenLayer

A small, standalone GenLayer Intelligent Contract that binds one **non-transferable**
credit passport to an address. Any other contract, dApp or agent reads the grade with a
single view call. It is the Credence suite's `CredencePassport`
([`contracts/credence_passport.py`](../../contracts/credence_passport.py)) packaged so
it works on its own, with no other Credence contract deployed.

## What it is

* **Grades**, lowest to highest: `DENY`, `C`, `B`, `A`, `AA`, `AAA` (rank 0 to 5).
* Each passport stores the grade, a standing score (0 to 100), whether the address is in
  default now, whether it has **ever** defaulted, a short memo, who wrote it and when.
* **Soulbound by construction.** There is no `transfer`, `approve` or reassignment
  method. A passport stays with its address forever, so reputation cannot be bought,
  sold or lent. The test suite reads the contract's public method set from source and
  fails if anything that could move a passport appears.
* **Holders cannot grade themselves.** They can only pull a snapshot from an oracle the
  owner has configured.

## How issuance works

There are two ways a passport gets written. Both write the same one-per-address record.

### 1. Issuer mode (always on)

The owner approves issuer addresses (a lender, a DAO, a KYB provider, an underwriting
agent). An issuer calls:

| Method | Effect |
|---|---|
| `issue(holder, grade, standing, defaulted, memo)` | create or update the holder's passport. Inputs are strictly validated. Re-issuing a revoked passport reinstates it. |
| `revoke(holder, reason)` | withdraw it (issuer or owner). History is kept, but the passport reads as `DENY` and fails every tier gate. |

`ever_defaulted` is **sticky**: once any write marks an address as defaulted, no later
write can clear it.

### 2. Oracle mode (optional)

If the owner calls `set_oracle(addr)` with a contract that exposes
`credit_of(addr) -> {known, grade, standing, defaulted, ever_defaulted}` (the Credence
core does), a holder can call:

| Method | Effect |
|---|---|
| `mint()` | first issuance from the oracle's assessment of the **caller**, via a synchronous cross-contract read. Reverts if the oracle has never assessed the caller. |
| `refresh()` | re-sync your own passport to the oracle's current assessment. A revoked passport cannot be self-refreshed. |

The oracle's reply is treated as untrusted data: an unknown grade collapses to `DENY`,
standing is clamped to 0..100, and `known` / `defaulted` count only if they are literally
`true`.

### Admin

`add_issuer`, `remove_issuer`, `set_oracle` (`""` disables oracle mode), and two-step
`transfer_ownership` / `accept_ownership`. All are owner-only.

## How other dApps read a grade

| View | Returns |
|---|---|
| `tier_at_least(addr, min_grade)` | `true` only if `addr` holds an **active** passport with grade >= `min_grade` |
| `grade_of(addr)` | the effective grade (`DENY` if no passport, or revoked) |
| `passport_of(addr)` | the full record. **Never reverts** for an unknown address: returns `held: false`, grade `DENY` |
| `has_passport(addr)` | `true` if a passport was ever issued, including a revoked one |
| `holders(offset, limit)` | paginated roster, at most 50 per page, with `next_offset` (`-1` at the end) |
| `holder_count()`, `is_issuer(addr)`, `list_issuers()`, `get_config()` | registry metadata |

`passport_of` record:

```json
{"addr": "0x7eF5...Cd60", "held": true, "active": true, "grade": "A", "grade_rank": 3,
 "recorded_grade": "A", "standing": 72, "defaulted": false, "ever_defaulted": false,
 "revoked": false, "source": "issuer", "written_by": "0x2488...C588",
 "memo": "demo: 12 on-time repayments", "seq": 1, "update_count": 0,
 "minted_at": "2026-11-10T04:41:11.118823Z", "updated_at": "2026-11-10T04:41:11.118823Z"}
```

`grade` and `grade_rank` are the effective values (`DENY`/0 when revoked).
`recorded_grade` keeps the last grade written.

### Integration snippet: gate an action in your own contract

```python
from genlayer import *

class UndercollateralizedVault(gl.Contract):
    passport: Address

    def __init__(self, passport: str):
        self.passport = Address(passport)

    @gl.public.write
    def borrow(self, amount: int) -> None:
        me = gl.message.sender_address.as_hex
        reg = gl.get_contract_at(self.passport).view()
        if not reg.tier_at_least(me, "A"):
            raise gl.vm.UserError("credit passport grade A or better required")
        if reg.passport_of(me)["ever_defaulted"]:
            raise gl.vm.UserError("addresses that have defaulted need collateral")
        ...
```

### From genlayer-js

```ts
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const client = createClient({ chain: studionet, account: createAccount() });
const PASSPORT = "0x27BB4B8e10f74Cd675017c730de94478706cb9D4";

const ok = await client.readContract({ address: PASSPORT, functionName: "tier_at_least", args: [user, "A"] });
const p  = await client.readContract({ address: PASSPORT, functionName: "passport_of", args: [user] });
```

## Deploy your own

```bash
python primitives/credit_passport/deploy_studio.py      # deploy, add issuer, issue, read, prove a non-issuer is rejected
```

Constructor: `CreditPassport(owner="", oracle="")`. An empty `owner` makes the deployer
the owner. An empty `oracle` leaves oracle mode off.

## Tests and lint

```bash
genvm-lint check primitives/credit_passport/credit_passport.py
genvm-lint typecheck primitives/credit_passport/credit_passport.py
pytest primitives/credit_passport/tests -q        # 41 direct-mode tests
```

The suite covers issuance and updates, sticky `ever_defaulted`, strict input validation,
revoke and reinstatement, owner and issuer permissions, the safe unknown-address record,
every `tier_at_least` threshold, pagination, two-step ownership, the soulbound method
set, and oracle mode. Oracle mode uses an in-test fake oracle in place of
`gl.get_contract_at`: mint, refresh, never-assessed rejection, a revoked passport that
cannot self-refresh, and sanitising of malformed oracle replies.

## Live deployment (GenLayer studionet, chain 61999)

| | |
|---|---|
| Contract | `0x27BB4B8e10f74Cd675017c730de94478706cb9D4` |
| Explorer | https://explorer-studio.genlayer.com/address/0x27BB4B8e10f74Cd675017c730de94478706cb9D4 |
| Deploy | `0x885d024b32b2216ea5fcd501e88b811df07f82f5448a35e49162e6ced5b8135a` (FINALIZED, SUCCESS) |
| `add_issuer(issuer)` by owner | `0xcc2004ad9aae24254799a3abee3addcd17bd77679bc9f02305fe864988d19d87` (FINALIZED, SUCCESS) |
| `issue(holder, "A", 72, false, memo)` by issuer | `0x18a6d520ec938d712604f258abc4918c577cd72a52d00a3683e8ef03aa2a8f84` (FINALIZED, SUCCESS) |
| `issue(self, "AAA", ...)` by a non-issuer | `0x31b8e7add853b2b1bf4ee9431459f75a26df09ac7d2a96c079aa86072302e267` (FINALIZED, reverted: `only an approved issuer may call this`) |

Reads after the issue: `passport_of(holder)` returned grade `A`, rank 3, standing 72, with
`source: "issuer"`. `grade_of` returned `A`, `tier_at_least(holder, "A")` returned `true`
and `tier_at_least(holder, "AA")` returned `false`. After the rejected attempt,
`has_passport(stranger)` was `false`. Full record: [`live_run.json`](live_run.json). All
keys were throwaway. Studio is a shared sandbox that is reset from time to time;
redeploy with `deploy_studio.py` if the address is gone.

## Limitations

* An issuer is trusted for the grades it writes. Pick issuers carefully and remove them
  with `remove_issuer`. `written_by` records who wrote each passport.
* Grades are stored snapshots, not live scores. Consumers that need the live value
  should read the oracle directly or require a recent `updated_at`.
* One passport per address, with no multi-issuer aggregation. The latest write wins.
