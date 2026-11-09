# Credence Keeper

A production-shaped **keeper bot** that keeps the Credence loan book serviced. On an
interval it reads the roster and pool state and calls `service_book` in bounded batches, so
past-due lines move `overdue → defaulted` against the consensus clock without anyone
watching. It mirrors the `genlayer_py` pattern in [`scripts/`](../scripts): throwaway /
opt-in accounts, UTF-8 stdout, no Docker, no local node.

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## Why a keeper (and why it's the robust path)

Credence's book must be serviced: [`service_book`](../contracts/credence.py) walks a
bounded batch (≤ `MAX_SERVICE_BATCH = 25`) from a rolling cursor and, against the consensus
datetime and the grace window, moves delinquent lines `overdue → defaulted`
(`_service_one`). The contract can self-drive this when `autonomous` is on (it re-emits
itself as a finalized message), **but a keeper poking it on a cadence is the robust path**:
it is observable, operator-controlled, bounded in spend, and does not depend on the
autonomous heartbeat being enabled. `service_book` is **permissionless** — anyone may call
it (see [`docs/OPERATIONS.md`](../docs/OPERATIONS.md)) — so the keeper needs **no**
owner/relayer/guardian role. It only needs gas on a real testnet; on Studio chains it is
funded for free.

The keeper is **read-reconciled**: after sweeping it re-reads `stats()` (not the event log)
to report new defaults, because Credence events are *best-effort* and state is the source
of truth ([`docs/EVENTS.md`](../docs/EVENTS.md)).

### Keeper vs. the autonomous heartbeat — the `hops` nuance

`service_book(max_items, hops)` uses `hops` to budget the contract's **own** autonomous
self-emission. When a keeper is already paging the roster, you do **not** want the contract
to *also* fan out finalized self-messages for the same work — that is redundant consensus
spend. Passing **`hops = 1`** makes the self-emit budget zero (`min(1, passes) - 1 == 0`
inside the contract), so the keeper is the sole driver. **That is the keeper's default.**
Set `CREDENCE_KEEPER_HOPS=-1` only if you deliberately want one keeper poke to kick off the
contract's autonomous roster pass (and you have `set_autonomous(True)`).

---

## Requirements

- The project venv python with `genlayer_py==0.16.3` (Python stdlib + genlayer_py only —
  no extra dependencies):
  `python`
- A deployed Credence contract address (see [`docs/DEPLOY.md`](../docs/DEPLOY.md)).

---

## Configuration (environment variables)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `CREDENCE_CONTRACT` | **yes** | — | Deployed Credence address (`0x` + 40 hex). |
| `CREDENCE_CHAIN` | no | `studionet` | `studionet` / `localnet` / `testnet_asimov` / `testnet_bradbury` (aliases: `studio`, `local`, `asimov`, `bradbury`). |
| `CREDENCE_RPC` | no | chain default | Override the RPC URL for the chosen chain. |
| `CREDENCE_KEEPER_PRIVATE_KEY` | on real testnets | — | Hex private key for the keeper account. On Studio chains, omit it and a throwaway key is generated and sim-funded for free. |
| `CREDENCE_KEEPER_INTERVAL` | no | `300` | Seconds between cycles. **`0` or negative → run one cycle and exit** (cron/Task Scheduler mode). |
| `CREDENCE_KEEPER_BATCH` | no | `25` | Items per `service_book` call (clamped to `1..25`). |
| `CREDENCE_KEEPER_HOPS` | no | `1` | `service_book` hops arg. `1` = keeper drives, contract self-emit suppressed. `-1` = let the contract autonomously finish the pass. |
| `CREDENCE_KEEPER_MAX_PASSES` | no | `64` | Hard cap on `service_book` calls per cycle (bounds spend on a huge roster). |
| `CREDENCE_KEEPER_DRY_RUN` | no | `false` | Read & plan only; never send a tx. Previews the call via `simulate_write_contract` on Studio chains. |
| `CREDENCE_KEEPER_CONFIRM` | no | `true` | Wait for an `ACCEPTED` receipt after each batch. `false` = fire-and-forget. |
| `CREDENCE_KEEPER_TX_RETRIES` | no | `60` | Receipt-poll retries. |
| `CREDENCE_KEEPER_TX_INTERVAL_MS` | no | `3000` | Receipt-poll interval (ms). |
| `CREDENCE_KEEPER_SIM_FUND` | no | `1000e18` | Base units to sim-fund a throwaway (Studio chains only). |
| `CREDENCE_KEEPER_LOG` | no | `json` | `json` (one JSON object per line) or `text`. |
| `CREDENCE_KEEPER_LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error`. |

---

## Run — studionet (free, no key, no captcha)

Studio chains mint free test GEN via `sim_fundAccount`, so no private key is needed; a
throwaway in-memory key is generated and funded automatically.

**Dry-run one cycle (safe — reads & plans, sends nothing):**

```powershell
$env:CREDENCE_CONTRACT = "0xYourCredenceAddress"
$env:CREDENCE_CHAIN    = "studionet"
$env:CREDENCE_KEEPER_DRY_RUN = "1"
$env:CREDENCE_KEEPER_INTERVAL = "0"   # one-shot
& "python" -I keeper\keeper.py
```

**Service the book for real, once:**

```powershell
$env:CREDENCE_KEEPER_DRY_RUN = "0"
$env:CREDENCE_KEEPER_INTERVAL = "0"
& "python" -I keeper\keeper.py
```

**Run continuously (sweep every 5 minutes):**

```powershell
$env:CREDENCE_KEEPER_INTERVAL = "300"
& "python" -I keeper\keeper.py
```

On POSIX the same, with inline env:

```bash
CREDENCE_CONTRACT=0xYourCredenceAddress CREDENCE_CHAIN=studionet CREDENCE_KEEPER_INTERVAL=300 \
  "python" -I keeper/keeper.py
```

---

## Run — Bradbury (public testnet, chain 4221)

Bradbury has no faucet RPC, so the keeper needs a **pre-funded account**. Supply its key via
`CREDENCE_KEEPER_PRIVATE_KEY` (any account works — `service_book` is permissionless, so this
need not be the owner/relayer; use a low-value, dedicated keeper key). Fund it from the
Bradbury faucet once.

```bash
export CREDENCE_CONTRACT=0xYourCredenceAddress
export CREDENCE_CHAIN=testnet_bradbury
export CREDENCE_KEEPER_PRIVATE_KEY=0xabc...   # dedicated, low-value keeper key with gas
export CREDENCE_KEEPER_INTERVAL=600           # e.g. every 10 minutes
"python" -I keeper/keeper.py
```

> Do a `CREDENCE_KEEPER_DRY_RUN=1 CREDENCE_KEEPER_INTERVAL=0` run first against Bradbury to
> confirm the keeper can read `get_config()`/`roster_size()` before you commit gas. The
> keeper logs `keeper_unfunded` if the key has no GEN.

---

## Scheduling (one-shot mode)

Set `CREDENCE_KEEPER_INTERVAL=0` and let an external scheduler drive the cadence. The
process runs exactly one sweep, reconciles, and exits with a nonzero code if the cycle
failed (so a scheduler can alert).

**cron (every 10 min):**

```cron
*/10 * * * * CREDENCE_CONTRACT=0x... CREDENCE_CHAIN=testnet_bradbury CREDENCE_KEEPER_PRIVATE_KEY=0x... CREDENCE_KEEPER_INTERVAL=0 /path/to/.venv/Scripts/python.exe -I /path/to/credence/keeper/keeper.py >> /var/log/credence-keeper.log 2>&1
```

**systemd timer:** a `credence-keeper.service` (`Type=oneshot`, the env in `Environment=`
lines, `ExecStart=` the one-shot invocation) plus a `credence-keeper.timer`
(`OnUnitActiveSec=10min`). The JSON logs land in `journalctl -u credence-keeper`.

**Windows Task Scheduler:** create a task running the venv python with `-I keeper\keeper.py`,
set the env vars in the task (or a wrapper `.cmd`), and a repeat trigger (e.g. every 10
minutes). `CREDENCE_KEEPER_INTERVAL=0` makes each trigger one sweep.

Long-running mode (`CREDENCE_KEEPER_INTERVAL>0`) is equally fine under a supervisor
(`systemd` `Restart=always`, `docker run --restart`, `pm2`): the loop self-recovers from a
failed cycle with bounded exponential backoff and shuts down cleanly on SIGINT/SIGTERM.

---

## What a cycle logs (JSON lines)

```jsonc
{"ts":"…","level":"info","event":"connected","chain":"studionet","chain_id":61999,"keeper":"0x…","dry_run":false}
{"ts":"…","level":"info","event":"preflight_ok","contract":"0x…","version":"1.4.0","paused":false,"autonomous":false}
{"ts":"…","level":"info","event":"cycle_start","cycle":1,"roster":3,"active_lines":1,"defaulted":0,"service_cursor":0,"utilization_bps":0,"cash":"0"}
{"ts":"…","level":"info","event":"serviced_batch","cycle":1,"pass_index":1,"planned":1,"batch":25,"hops":1,"tx":"0x…"}
{"ts":"…","level":"info","event":"cycle_done","cycle":1,"batches_sent":1,"planned":1,"defaulted_before":0,"defaulted_after":1,"new_defaults":1,"service_cursor":3}
```

Pipe the stream into your log pipeline; `event` is a stable key to alert on
(`service_batch_failed`, `new_defaults`, `keeper_unfunded`, `contract_paused`).

---

## Operational notes

- **Permissionless:** the keeper account needs no role. Keep it low-value; it only spends
  gas (and nothing on Studio chains).
- **Bounded by design:** each cycle does at most one roster pass (`ceil(roster/batch)`
  calls, capped by `CREDENCE_KEEPER_MAX_PASSES`), each call touches ≤ 25 borrowers.
- **Paused contract:** `service_book` reverts while paused; the keeper logs the revert and
  keeps retrying on the next cycle — resume with `set_paused(False)` and it catches up.
- **Idempotent:** servicing a line already defaulted is a no-op (`Defaulted` fires once per
  cycle via the `status != "defaulted"` guard), so an over-eager cadence is safe.
- **Interaction with `draw`/`repay`:** those paths already service the borrower inline from
  the clock, so the keeper is a safety net for *idle* delinquent lines, not a correctness
  dependency.
