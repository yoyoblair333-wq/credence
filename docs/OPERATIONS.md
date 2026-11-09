# Credence — Operations Runbook

An operator's guide to deploying, running, and responding to incidents on Credence
(v1.2.0). Every command and method here is grounded in
[`contracts/credence.py`](../contracts/credence.py); the deploy mechanics reference
[`docs/DEPLOY.md`](DEPLOY.md).

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## Roles (who can do what)

Set at deploy (constructor: `relayer` and `dev` default to the deployer; `owner`,
`pending_owner`, and `guardian` are the deployer). Read the current roster any time with
`get_config()`.

| Role | Powers | Gated by |
|---|---|---|
| **owner** | Economics and funds: `withdraw_fees`, `set_risk_limits`, `set_terms`, `set_autonomous`, `set_relayer`, `set_dev`, `set_guardian`, `transfer_ownership`; can also pause. | `_require_owner` |
| **relayer** | Off-chain keeper/staff: can pause; no fund or economic powers. | in `set_paused`'s allow-set |
| **guardian** | **Pause-only** incident response (`set_paused`). **Separation of duties:** cannot move funds or change economics. | in `set_paused`'s allow-set |
| **dev** | Default recipient of withdrawn protocol revenue (`withdraw_fees(to="")`). Not a caller role. | — |

Ownership transfer is **two-step** (`transfer_ownership` → nominee `accept_ownership`), so
a mistyped hand-off cannot brick admin.

---

## Deploying

### studionet — working now (recommended)

Credence deploys and runs end-to-end on GenLayer **studionet** (chain `61999`, hosted
Studio simulator at `https://studio.genlayer.com/api`) **non-interactively, for free, with
no captcha and no real funds** — proven 2026-11-03 (see `docs/DEPLOY.md` §6–7 for real
deploy + full-`assess` evidence). The clean path is a short `genlayer_py` script run with
the shared venv, using a throwaway in-memory account funded via Studio's `sim_fundAccount`:

```powershell
& "python" -I "<path>\deploy_studio.py"
```

The full copy-paste runbook (fund → deploy → view → write → `assess`) is in
[`docs/DEPLOY.md`](DEPLOY.md) §3. The composability pair (Credence + `CredenceGatedVault`)
is deployed and exercised end-to-end by
[`scripts/compose_studio.py`](../scripts/compose_studio.py) (see `docs/COMPOSABILITY.md`).

> Studio is a shared sandbox and is periodically reset, so a deployed address is
> ephemeral — re-run the script for a fresh deployment. Nothing here touches real value.

### Bradbury (public testnet) — pending

Deployment to the public **Bradbury** testnet (chain id 4221) is **pending a faucet
captcha**, so there is **no Bradbury transaction hash yet**. The contract source is
unchanged between targets; only the account/funding path differs. Track this in
`docs/MILESTONE.md`.

### Post-deploy checklist

1. `get_config()` → confirm `version == "1.2.0"`, roles (`owner`/`relayer`/`dev`/`guardian`),
   `paused == false`, `max_utilization_bps`, and the economic terms.
2. Assign a dedicated **guardian** distinct from the owner key (`set_guardian(addr)`) so
   incident-pause does not require the funds key.
3. Set your risk posture: `set_risk_limits(max_utilization_bps)` and, if needed,
   `set_terms(lender_share_bps, term_seconds, grace_seconds)`.
4. Seed liquidity (`fund`, payable) and sanity-check `get_pool()`.

---

## Incident response — pausing via the guardian

The pause is the circuit breaker. **Any of owner, relayer, or guardian** may call it; the
guardian exists precisely so incident response does not need the funds key.

```python
set_paused(True)     # halt
set_paused(False)    # resume
```

While paused, the following revert with `the protocol is paused`: `request_credit`,
`assess`, `draw`, `fund`, and `service_book`. `repay`, `defund`, and `claim_yield` are
**not** pause-gated — borrowers can still pay down debt and lenders can still exit against
available cash during an incident (pausing never traps a lender's principal).

Runbook on a suspected incident (e.g. an exploit report, a mis-grade, an LLM/web anomaly):

1. **Pause immediately** from the guardian key: `set_paused(True)`.
2. Snapshot state: `get_pool()`, `stats()`, and `page_borrowers(0, 50)` (paginate to the
   end via `next_offset`).
3. Triage per [`SECURITY.md`](../SECURITY.md) / [`docs/THREAT_MODEL.md`](THREAT_MODEL.md);
   the contract fails closed, so a halted assessment writes nothing.
4. Resume with `set_paused(False)` only once the cause is understood and, if needed, risk
   limits are tightened (below).

The guardian has **no** economic powers — confirmed by
`TestEnterprise::test_guardian_separation_of_duties`: a guardian calling `withdraw_fees` or
`set_risk_limits` reverts with `only the owner`.

---

## Setting risk limits

### Pool utilization cap (liquidity buffer) — owner-only

```python
set_risk_limits(max_utilization_bps)   # 0..10000; 10000 = no cap
```

When below 10000, `draw` rejects any draw that would push
`total_principal + amount` above `max_utilization_bps` of `total_funded`
(`draw would exceed the pool utilization cap`), holding a liquidity buffer so lenders can
defund. Example: `set_risk_limits(9000)` holds a 10% buffer (verified by
`TestEnterprise::test_pool_utilization_cap`). Tighten this during stress; it takes effect
on the next draw.

### Economic terms — owner-only

```python
set_terms(lender_share_bps, term_seconds, grace_seconds)
# lender_share_bps: 0..10000 (share of each origination fee streamed to lenders as yield)
# term_seconds:     > 0      (loan term)
# grace_seconds:    >= 0      (grace window before overdue -> default)
```

Bounds are enforced (out-of-range reverts `lender_share_bps ...` / `invalid term/grace`).
Note the **origination fee itself is fixed per grade** by `ORIGINATION_BPS_BY_GRADE`
(C 400 → AAA 100 bps) and is **not** set here. Defaults: `lender_share_bps` 5000,
`term_seconds` 2,592,000 (30 days), `grace_seconds` 604,800 (7 days).

---

## Servicing the loan book

`service_book(max_items=25, hops=-1)` is **permissionless** — anyone can call it. It walks
a bounded batch (≤ `MAX_SERVICE_BATCH = 25`) from a rolling cursor and moves past-due lines
`overdue` → `defaulted` against the consensus clock and the grace window. Run it on a
cadence (a cron keeper), paginating the whole roster via the returned `cursor`/`roster`.

Optionally enable the autonomous heartbeat (owner-only): `set_autonomous(True)` makes
`service_book` re-emit itself as a finalized self-message when work remains, bounded to one
roster pass — a self-servicing book with no operator. It is **off by default**; pausing
also blocks `service_book`.

---

## Withdrawing protocol revenue — owner-only

```python
withdraw_fees(to, amount)   # to="" defaults to the `dev` address; amount in base units
```

Withdraws accrued **protocol** revenue only (the protocol's share of collected origination
fees, tracked as `fee_revenue`). It **never** touches lender principal, lender yield, or
outstanding loans, and is capped at both `fee_revenue` and available `cash`
(`amount exceeds accrued protocol revenue` / `insufficient cash on hand`). Non-owner callers
revert `only the owner may call this`. Check withdrawable revenue first via
`get_pool()["fee_revenue"]`.

---

## Rotating the owner (two-step)

```python
# step 1 — current owner nominates (does not take effect yet):
transfer_ownership(new_owner)
# step 2 — the nominee, from their own key, completes it:
accept_ownership()
```

Until the nominee accepts, `get_config()["owner"]` is unchanged and the old owner retains
control. A non-nominee calling `accept_ownership` reverts
`only the nominated pending owner may accept ownership` (verified by
`TestHardening::test_two_step_ownership_transfer`). The same two-step pattern applies to
`CredenceGatedVault`. Rotate the relayer/dev/guardian with the single-step `set_relayer` /
`set_dev` / `set_guardian` (owner-only).

---

## What to monitor

Poll these views on a cadence and alert on the thresholds you choose:

| Signal | Source | Watch for |
|---|---|---|
| **Pool utilization** | `get_pool()["utilization_bps"]` (= `total_principal * 10000 / total_funded`) | Approaching your `max_utilization_bps` cap — the pool is running thin on redeemable liquidity. |
| **Default rate** | `stats()["defaulted"]` vs `stats()["borrowers"]` / `stats()["approved"]` | A rising defaulted share — consider tightening the cap/terms or pausing. |
| **Protocol revenue** | `get_pool()["fee_revenue"]` | Available revenue to withdraw; reconcile against `yield_distributed`. |
| **Active lines** | `get_pool()["active_lines"]` (also in `stats()`) | Count of lines with outstanding debt (principal + fee). Reconcile with `service_book` cadence. |
| **Liquidity** | `get_pool()["cash"]`, `total_funded`, `outstanding_principal`, `outstanding_fees` | `cash` low relative to `total_funded` means defund/claim requests may hit `insufficient liquidity`. |
| **Servicing progress** | `stats()["service_cursor"]`, `roster_size()` | Ensure the keeper is advancing the cursor across the whole roster. |
| **Config drift / pause** | `get_config()` (`version`, `paused`, roles, limits, terms) | Unexpected `paused == true`, role changes, or a `version` mismatch after an upgrade. |

Pair these with the event stream ([`docs/EVENTS.md`](EVENTS.md)) for a push view —
`Defaulted` for new defaults, `Drawn`/`Repaid` for flow, `Funded`/`Defunded`/`YieldClaimed`
for lender activity. Remember events are **best-effort** (`_emit` swallows host rejection),
so treat the views as the source of truth and reconcile against them.
