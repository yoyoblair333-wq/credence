# CredencePassport - a soulbound, portable Credit Passport

`CredencePassport` is the fourth Intelligent Contract in the Credence suite and its
**reputation primitive**. It turns a live Credence assessment into a **soulbound
(non-transferable), self-custodied credit passport** that any contract, chain or agent
can read - portable creditworthiness for humans and autonomous agents in the agentic
economy.

- Contract: [`contracts/credence_passport.py`](../contracts/credence_passport.py)
- Live demo script: [`scripts/passport_studio.py`](../scripts/passport_studio.py)
- Depends on the oracle in [`contracts/credence.py`](../contracts/credence.py)

---

## 1. The concept: reputation as a soulbound token

Credence already produces, under AI consensus, a bounded credit grade
(`DENY/C/B/A/AA/AAA`) and a 0-100 standing for any address that opts in. That standing is
an attribute of a **specific identity** - a person or an agent. `CredencePassport` makes
that standing into a first-class, portable object: a **passport** an address mints for
itself and carries as proof of creditworthiness.

The defining property is that it is **soulbound**:

> A passport is bound forever to the address that minted it. There is, by construction,
> **no transfer method and no way to move a passport between addresses.** No `transfer`,
> no `approve`, no `safeTransferFrom`, no admin reassignment.

This is the whole point, not a limitation bolted on afterwards. If creditworthiness were
sellable or lendable, reputation would collapse - anyone could simply buy a AAA passport
and borrow against a stranger's standing. By making the passport immovable, the only way
to hold a good passport is to *be* the address that earned it on Credence. The soulbound
constraint is enforced structurally: the contract's only non-admin writes are `mint()`
(first issuance, by the holder) and `refresh()` (the holder re-syncs their own snapshot).
Neither accepts a recipient; both act solely on `gl.message.sender_address`.

A passport records a snapshot of the holder's Credence standing:

```
{ grade, grade_rank, standing, defaulted, ever_defaulted, known,
  minted_at, updated_at, refresh_count }
```

`grade_rank` is derived locally from `grade` (never trusted from the wire), and `standing`
is clamped to `0..100`, so a passport can only ever hold a well-formed, in-range snapshot.

---

## 2. The cross-contract read (the GenLayer mechanism)

A passport's standing is **never typed in by a user**. On every `mint()` and `refresh()`
the contract performs a **synchronous cross-contract read** of the Credence oracle for the
caller, using the suite's typed `@gl.contract_interface` stub (which resolves at runtime to
`gl.get_contract_at`):

```python
@gl.contract_interface
class ICredence:
    class View:
        def credit_of(self, borrower: str) -> dict: ...
    class Write:
        pass

# inside mint() / refresh(), for the CALLER:
rec = ICredence(self.credence).view().credit_of(gl.message.sender_address.as_hex)
# -> {known, grade, grade_rank, standing, defaulted, overdue, ever_defaulted, ...}
```

This is the same pattern `CredenceGatedVault` uses to gate admission and `CredenceGovernor`
uses to drive the core - a single `.view().<method>()` call across contracts, with no
collateral, no tokens, and no bespoke bridge. Credence is the **single source of truth**;
the passport stores only what the oracle returned at mint/refresh time.

The cross-contract return is treated as **untrusted data**: an unrecognised `grade`
collapses to the safe floor `DENY`, `standing` is clamped, and a non-dict reply reverts
with a clear `[credence-passport]` message.

### Mint / refresh rules

- **`mint()`** - first issuance. Reverts if the caller already holds a passport, or if
  **Credence has never assessed the caller** (`credit_of(caller).known == False`). You
  cannot passport an address Credence has never judged. One passport per address, forever.
- **`refresh()`** - the holder re-reads the oracle and updates their existing snapshot to
  their current standing, incrementing `refresh_count`. Reverts if the caller holds no
  passport, or if the (possibly migrated) oracle no longer recognises them - so a held
  passport always reflects a real Credence assessment.

### Reading a passport

| Method | Returns |
| --- | --- |
| `passport_of(addr)` | the stored snapshot (a safe `held: False` record if none - composable, no revert) |
| `has_passport(addr)` | bool |
| `holder_count()` | number of passports issued |
| `holders(offset, limit)` | bounded, paginated roster (`MAX_PAGE = 50`) |
| `tier_at_least(addr, min_grade)` | convenience gate on the **stored** snapshot grade |
| `get_config()` | credence addr, owner/pending owner, holder count, `soulbound: true` |

Admin surface (owner-only): `set_credence(addr)` for a core migration, and two-step
`transfer_ownership` / `accept_ownership`. None of these can move or alter a holder's
passport - ownership governs only the oracle wiring, never the soulbound tokens.

---

## 3. Use case: agents carrying portable creditworthiness

The agentic economy needs machine-readable, non-forgeable reputation. An autonomous agent
that has earned a standing on Credence mints a passport once, then **carries verifiable,
self-custodied creditworthiness it can present anywhere** - without re-proving itself and
without anyone being able to buy, borrow or move that reputation:

- **Collateral-free onboarding.** A lending venue, marketplace or DAO reads
  `tier_at_least(agent, "A")` (or Credence directly for the live value) and waives a
  deposit for an agent that holds the tier - reputation in place of capital.
- **Agent-to-agent trust.** Before transacting, one agent reads another's passport to
  decide terms. Because it is soulbound, a AAA passport is proof the counterparty *is* the
  address that earned AAA, not one that bought it.
- **Counterparty due diligence.** `defaulted` / `ever_defaulted` travel with the passport,
  so a bad history cannot be laundered by moving a token to a fresh wallet.
- **Portability across the ecosystem.** Any GenLayer contract, and (via the public view)
  any indexer or off-chain agent, can read the passport with one call - the standing
  Credence underwrote becomes a building block the whole ecosystem can compose on.

The passport is the composability story taken one step further than `credence_gated.py`:
not just *consuming* the oracle for a single gate, but **materialising** its judgment into
a durable, portable, non-transferable reputation object.

---

## 4. Hardening

`CredencePassport` reuses the suite's hardening verbatim:

- Strict `0x` + 40-hex **address validation/normalisation** (`_addr_hex`) on every input.
- The typed `@gl.contract_interface` oracle stub (static types, documents the dependency).
- **Defensive reads** of the untrusted cross-contract return (grade -> safe DENY floor,
  standing clamped, non-dict reply reverts).
- **u256/u32-sized storage** and `@allow_storage` **scalar-only** dataclasses (flat,
  auditable storage proxy).
- **Bounded, paginated** views (`MAX_PAGE`) so indexers/UIs never force an unbounded scan.
- **Best-effort events** (`PassportMinted`, `PassportRefreshed`) - a rejected event never
  breaks a state transition.
- **Two-step ownership** transfer, and clear `[credence-passport]`-prefixed reverts.

Verification status:

```
genvm-lint check     contracts/credence_passport.py  -> Lint passed (3 checks) + Validation passed
                                                         (Contract: CredencePassport, 11 methods: 6 view, 5 write)
genvm-lint typecheck contracts/credence_passport.py  -> No type errors found
```

> Cross-contract calls cannot be unit-tested in `gltest` direct mode (there is no hook to
> stand in for the other contract), so there is **no faked unit test** for the oracle read.
> The on-chain behaviour is proven on live **studionet** by `scripts/passport_studio.py`
> instead (below).

---

## 5. Live evidence (studionet)

`scripts/passport_studio.py` was run end-to-end against the hosted GenLayer **studionet**
simulator (chain `61999`, `https://studio.genlayer.com/api`) on **2026-11-03**, exit code
`0`, no real funds, no captcha, throwaway in-memory accounts. It deploys Credence **and**
the passport, exercises the full lifecycle, and reads **contract state** (not receipt
fields) as ground truth. Real output:

```
0. SETUP  (studionet, chain 61999)
   deployer: 0x0d97A28e94a5209842fb68BE581C896CF1F94783
   holder  : 0xE93e795cb0fbF14695e16512d6ada243c5a8ed39
   stranger: 0xbf3d12446abd06fD5c4B62FD72Da37016Cc5bfF3

1. Credence  deployed at 0xc6d3d67f6cA9F9b69F9E24a72B1e2F87C0aE415e   (ACCEPTED)
2. Passport  deployed at 0x657CE66ffcAeBf26E98771b1C62d374E6c622EC5   (ACCEPTED)
   get_config -> credence=0xc6d3...415e, holder_count=0, soulbound=true, version=1.0.0
   OK: passport points at the Credence oracle and advertises soulbound=True

3. SOULBOUND method set (live schema):
   ['accept_ownership','get_config','has_passport','holder_count','holders',
    'mint','passport_of','refresh','set_credence','tier_at_least','transfer_ownership']
   transfer-like holder methods: []   -> CONFIRMED: no way to move a passport

4. holder request_credit -> credit_of(holder): known=true, status="assessing", standing=50
   assess() ran the 3-persona LLM panel LIVE across Studio validators
     -> credit_of(holder): status="denied", grade="DENY", standing=50, assessed_at set
   (text-only evidence with no ownership proof -> the panel correctly DENIED; the
    passport then records this real standing)

5. MINT: credit_of(holder).known = True  (read ACROSS CONTRACTS by mint())
   has_passport(holder) = True
   passport_of(holder) = { held:true, known:true, grade:"DENY", grade_rank:0,
                           standing:50, seq:1, refresh_count:0, minted_at/updated_at set }
   -> grade & standing SNAPSHOTTED FROM CREDENCE across contracts

6. REFRESH: refresh_count 0 -> 1   (CONFIRMED)
   tier_at_least(holder, "C") = False   (snapshot grade DENY (rank 0) < C (rank 1))

7. NON-ASSESSED REJECTED: credit_of(stranger).known = False
   stranger.mint() reverted; has_passport(stranger) = False   -> REJECTED as expected

CROSS-CONTRACT ORACLE READ PROVEN ON-CHAIN: YES
```

What this proves on a live network:

1. **The cross-contract read runs on-chain.** `mint()` and `refresh()` both read
   `Credence.credit_of(caller)` across contracts and recorded the holder's real standing
   into the passport (`seq=1`, `standing=50`, timestamps set).
2. **The non-assessed guard bites.** The stranger's `mint()` **reverted** purely because
   the live cross-contract `credit_of(stranger).known` was `False` - no passport issued.
3. **Soulbound is structural.** The deployed contract's method set contains `mint` /
   `refresh` and admin-only `transfer_ownership`, but **no holder transfer method** of any
   kind - a passport cannot be moved between addresses.

Honest caveats:

- The AI panel **denied** this applicant (grade `DENY`): text-only evidence with no
  ownership proof is, by Credence's design, not enough to extend credit, so the panel
  reaching a unanimous DENY is the *correct* outcome (identical to the DEPLOY.md run). The
  passport then faithfully recorded that real `DENY`/`standing 50` snapshot - `mint()`
  needs only `known == True` (the address has been seen by Credence), which is exactly why
  the cross-contract flow is proven regardless of what grade the slow LLM step lands.
  Re-running with ownership-proven URL evidence would land a higher grade and a passport
  with `grade_rank >= 1` (then `tier_at_least(holder, "C")` would return `True`).
- studionet is a shared, periodically-reset sandbox, so the addresses above are ephemeral;
  re-running the script produces a fresh deployment.

---

*GenLayer referral: **JTR01FHP**  ·  #CreditWithoutCollateral*
