# Credence Indexer — reference design

A clean reference spec for indexing Credence's **8 events** into a queryable store, so
dApps and analytics can build on the protocol. It is grounded field-for-field in
[`docs/EVENTS.md`](../docs/EVENTS.md) and the `_emit(...)` call sites in
[`contracts/credence.py`](../contracts/credence.py).

Artifacts in this directory:

| File | What it is |
|---|---|
| [`schema.sql`](schema.sql) | PostgreSQL DDL: one table per event (+ the companion vault's `Admitted`), reconciliation-snapshot tables, and derived analytics views. |
| [`poll_example.py`](poll_example.py) | A tiny, read-only **reconciliation poller** (stdlib + `genlayer_py`) that reads `get_pool()` / `stats()` / `page_borrowers()` and prints NDJSON matching the snapshot tables. |

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## The model: event log **plus** state reconciliation

Credence emits an event on every state transition, but every emit goes through a
best-effort helper that **swallows host rejection** so a host that won't accept an event can
never break a state change:

```python
def _emit(ev) -> None:
    try:
        ev.emit()
    except Exception:
        pass
```

The consequence for an indexer (spelled out in `docs/EVENTS.md`): **the contract's state is
the source of truth, not its event stream.** A transition can succeed with its event
missing. So the reference design is a **hybrid**:

1. **Event log** — tail the 8 events for a cheap, ordered, push/history view (flow, who did
   what when). Tables in `schema.sql`.
2. **Reconciliation snapshots** — on a cadence (e.g. right after the keeper's
   `service_book` run), read the contract's own views and upsert ground truth. Tables
   `pool_snapshot` / `borrower_snapshot`; `poll_example.py` produces the rows. This is the
   half that stays correct even if an event was dropped.

Reconcile the event-derived views against the snapshots; where they disagree, the snapshot
wins.

---

## The 8 events → tables

All eight are defined and emitted in `contracts/credence.py`. Each event's single
positional-only argument is its **indexed topic** (the address it is about); the rest is the
non-indexed blob. **Money blob fields are decimal strings in base units (1 token = 1e18)** —
store them as `NUMERIC(78,0)` and parse as big integers, never JS numbers / `BIGINT` / float
(uint256 is up to 78 digits).

| Event | Emitter | Indexed | Table | Key blob fields (type) |
|---|---|---|---|---|
| `CreditRequested` | `request_credit` | `borrower` | `credit_requested` | `requested` (str, **whole tokens**), `evidence_items` (int) |
| `CreditAssessed` | `assess` / `appeal` | `borrower` | `credit_assessed` | `grade` (str), `credit_limit` (str base units), `ownership_proven` (bool), `tier` (int: 0 original, 1 appeal) |
| `Drawn` | `draw` | `borrower` | `drawn` | `amount`, `fee`, `principal` (str base units), `due_at` (int epoch) |
| `Repaid` | `repay` | `borrower` | `repaid` | `amount`, `principal`, `fee_paid`, `interest_paid` (str base units), `on_time` (bool) |
| `Defaulted` | `service_book` | `borrower` | `defaulted` | `debt` (str base units), `defaults` (int, running count after) |
| `Funded` | `fund` | `lender` | `funded` | `amount`, `funded` (str base units) |
| `Defunded` | `defund` | `lender` | `defunded` | `amount`, `funded` (str base units) |
| `YieldClaimed` | `claim_yield` | `lender` | `yield_claimed` | `amount` (str base units) |

Plus the composability consumer documented in `docs/EVENTS.md`:

| `Admitted` | `CredenceGatedVault.claim` | `member` | `admitted` | `grade` (str), `min_grade` (str), `seq` (int) |

### Field subtleties the schema encodes (from `docs/EVENTS.md`)

- **`CreditRequested.requested` is whole tokens** (e.g. `"500"`), *not* base units — it
  mirrors the `requested_tokens` argument, unlike every other money field. The stored
  borrower record holds base units; the event carries the human figure.
- **`CreditAssessed` fires once per `assess` or `appeal`**, for approval *and* denial. On
  `DENY`, `grade = "DENY"` and `credit_limit = "0"`. `tier` tells an original (`0`) from an
  appeal (`1`) on the same borrower.
- **`Repaid` fires on partial repayments too** (`principal > 0` after). `fee_paid` /
  `interest_paid` are the portions settled *this call* (value applies principal → fee →
  interest); `interest_paid` is `"0"` when the time-based APR is off.
- **`Defaulted` is emitted only on the transition into `defaulted`** (guarded by
  `status != "defaulted"`), so a line defaults — and emits — at most once per outstanding
  cycle, even across repeated servicing passes. Dedupe on `(tx_hash, log_index)` anyway.
- **`Funded` / `Defunded` carry both the delta (`amount`) and the running total
  (`funded`)**, so positions can be tracked without replaying the whole log.

---

## Ingestion contract

- **Idempotency:** every event table's primary key is `(tx_hash, log_index)`, so replays
  and overlapping backfills never double-insert. Use `INSERT ... ON CONFLICT DO NOTHING`.
- **Provenance:** every row carries `block_number`, `tx_hash`, `log_index`,
  `contract_address` (and `emitted_at` when the consensus datetime is available).
- **Addresses:** store lowercased `0x`+40hex for stable joins across event and snapshot
  tables.
- **Tolerate gaps:** because emission is best-effort, an indexer must behave correctly with
  a *missing* event for a transition that happened — reconcile against the snapshots and
  prefer them when they disagree.

---

## Wiring the event tail (production)

The reconciliation half runs today with `poll_example.py`. For the push half, tail logs via
`genlayer_py`'s log/filter surface against the Credence address (events are indexed by the
address topic) and decode each into its table, deduping on `(tx_hash, log_index)`:

```python
# illustrative — exact filter/log shape is SDK/network dependent
logs = client.get_logs({"address": CREDENCE_ADDR, "fromBlock": cursor, "toBlock": "latest"})
for lg in logs:
    name, blob = decode_event(lg)          # -> ("Drawn", {...})
    upsert(TABLE_FOR[name], row_from(lg, blob))
cursor = max(lg.block_number for lg in logs) + 1
```

If a given deployment/host does not surface a decodable log stream, fall back to
**snapshot-only** indexing: `poll_example.py` on a cadence fully populates
`pool_snapshot` / `borrower_snapshot`, which is enough for TVL, utilization, default-rate,
and per-borrower dashboards. The event tables then enrich that with per-transaction flow
when logs are available.

---

## Queries dApps / analytics want

`schema.sql` ships these as views (convenience reads over the event log; cross-check against
snapshots where correctness matters):

- **`v_latest_assessment`** — current grade / credit limit / ownership flag per borrower
  (newest `CreditAssessed` wins). The backing store for a "credit badge" UI.
- **`v_borrower_defaults`** — lifetime default count per borrower.
- **`v_lender_position`** — net lender position: deposited − redeemed, plus yield claimed.
- **`v_origination_flow`** — draws, principal, and risk-priced fees per borrower by grade —
  the revenue/risk lens on the two-sided market.

Pool-level time series (TVL, utilization, default rate, revenue) come straight from
`pool_snapshot`, e.g.:

```sql
-- utilization & default-rate trend
SELECT observed_at, utilization_bps,
       CASE WHEN borrowers > 0 THEN round(100.0 * defaulted / borrowers, 2) END AS default_pct,
       cash, total_funded, outstanding_principal, fee_revenue
FROM credence.pool_snapshot
WHERE contract_address = :addr
ORDER BY observed_at;
```

---

## Running the reconciliation poller

```powershell
$env:CREDENCE_CONTRACT = "0xYourCredenceAddress"
$env:CREDENCE_CHAIN    = "studionet"   # or testnet_bradbury, etc.
& "python" -I indexer\poll_example.py
```

It prints one `pool_snapshot` NDJSON line and one `borrower_snapshot` line per borrower
(paging the whole roster via `page_borrowers`' `next_offset`), and a one-line summary to
stderr. Load the DDL first with `psql -f indexer/schema.sql`, then pipe the NDJSON into your
loader of choice. The poller is **read-only** — it never sends a transaction, so it is safe
to run against any deployment on any cadence.
