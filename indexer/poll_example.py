#!/usr/bin/env python3
"""
Credence indexer — reconciliation poller (reference stand-in).
==============================================================

Credence events are BEST-EFFORT (`_emit` swallows host rejection), so the contract STATE is
the source of truth, not the event stream — docs/EVENTS.md tells indexer authors to
"reconcile against state on a cadence". This script is that cadence: a tiny, read-only
poller that reads the contract's own views — `get_pool()`, `stats()`, and the bounded,
paginated `page_borrowers()` — and prints normalized **NDJSON** rows that map 1:1 onto the
`pool_snapshot` / `borrower_snapshot` tables in indexer/schema.sql.

It is a stand-in, not the whole indexer: a production indexer would ALSO tail the 8 events
(see indexer/README.md), but this proves the reconciliation half — the half that guarantees
correctness regardless of event delivery — with nothing but stdlib + genlayer_py (the same
SDK scripts/*.py use).

Pipe the output straight into a loader:

  python -I indexer/poll_example.py | psql "$DATABASE_URL" -c "\\copy ..."   # (illustrative)

or just eyeball it. Read-only: it never sends a transaction.

Config (shared with keeper/keeper.py):
  CREDENCE_CONTRACT   (required)  deployed Credence address (0x+40hex)
  CREDENCE_CHAIN      studionet|localnet|testnet_asimov|testnet_bradbury   (default studionet)
  CREDENCE_RPC        optional RPC override
  CREDENCE_INDEXER_PAGE   page size for page_borrowers (default 50, max 50)

#CreditWithoutCollateral · GenLayer referral JTR01FHP
"""

from __future__ import annotations

import copy
import json
import os
import sys
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from genlayer_py import create_account, create_client
    from genlayer_py import chains as gl_chains
except Exception as exc:  # pragma: no cover
    sys.stderr.write(f"FATAL: genlayer_py not importable — run with the project venv python. {exc}\n")
    raise SystemExit(2)

CHAINS = {
    "studionet": gl_chains.studionet,
    "localnet": gl_chains.localnet,
    "testnet_asimov": gl_chains.testnet_asimov,
    "testnet_bradbury": gl_chains.testnet_bradbury,
}
ALIASES = {"studio": "studionet", "local": "localnet", "asimov": "testnet_asimov",
           "bradbury": "testnet_bradbury", "testnet": "testnet_asimov"}
MAX_PAGE = 50  # contract cap on page_borrowers


def _env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def _is_address(v):
    return (isinstance(v, str) and len(v) == 42 and v[:2].lower() == "0x"
            and all(c in "0123456789abcdefABCDEF" for c in v[2:]))


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _emit(kind, payload):
    """One NDJSON line: {"kind": <table>, "observed_at": <ts>, ...fields}."""
    rec = {"kind": kind, "observed_at": _now()}
    rec.update(payload)
    print(json.dumps(rec, default=str, ensure_ascii=False), flush=True)


def main() -> int:
    contract = _env("CREDENCE_CONTRACT") or _env("CREDENCE_KEEPER_CONTRACT")
    if not contract or not _is_address(contract.strip()):
        sys.stderr.write("FATAL: set CREDENCE_CONTRACT to the deployed Credence address (0x+40hex).\n")
        return 2
    contract = contract.strip()

    raw = (_env("CREDENCE_CHAIN", "studionet") or "studionet").strip().lower()
    chain_name = ALIASES.get(raw, raw)
    if chain_name not in CHAINS:
        sys.stderr.write(f"FATAL: CREDENCE_CHAIN must be one of {sorted(CHAINS)}; got {raw!r}\n")
        return 2
    chain = copy.deepcopy(CHAINS[chain_name])
    rpc = _env("CREDENCE_RPC") or _env("CREDENCE_INDEXER_RPC")
    if rpc:
        chain.rpc_urls = {"default": {"http": [rpc]}}

    page = int(_env("CREDENCE_INDEXER_PAGE", str(MAX_PAGE)))
    page = max(1, min(page, MAX_PAGE))

    client = create_client(chain=chain, account=create_account())  # read-only; account unused by views

    def read(fn, args=None):
        return client.read_contract(address=contract, function_name=fn, args=args or [])

    # Fail fast if the address/chain is wrong.
    try:
        cfg = read("get_config")
    except Exception as exc:
        sys.stderr.write(f"FATAL: cannot read get_config() at {contract} on {chain_name}: {exc}\n")
        return 2

    pool = read("get_pool")
    stats = read("stats")

    # pool_snapshot row (get_pool + stats merged).
    _emit("pool_snapshot", {
        "contract_address": contract,
        "version": cfg.get("version") if isinstance(cfg, dict) else None,
        "cash": pool.get("cash"),
        "total_funded": pool.get("total_funded"),
        "total_drawn": pool.get("total_drawn"),
        "total_repaid": pool.get("total_repaid"),
        "outstanding_principal": pool.get("outstanding_principal"),
        "outstanding_fees": pool.get("outstanding_fees"),
        "outstanding_interest": pool.get("outstanding_interest"),
        "fee_revenue": pool.get("fee_revenue"),
        "yield_distributed": pool.get("yield_distributed"),
        "active_lines": pool.get("active_lines"),
        "utilization_bps": pool.get("utilization_bps"),
        "borrowers": stats.get("borrowers"),
        "approved": stats.get("approved"),
        "defaulted": stats.get("defaulted"),
        "service_cursor": stats.get("service_cursor"),
    })

    # borrower_snapshot rows — page through the whole roster via next_offset (bounded).
    offset = 0
    emitted = 0
    pages = 0
    while True:
        res = read("page_borrowers", [offset, page])
        if not isinstance(res, dict):
            break
        pages += 1
        for item in res.get("items", []):
            _emit("borrower_snapshot", {
                "contract_address": contract,
                "borrower": item.get("addr"),
                "status": item.get("status"),
                "grade": item.get("grade"),
                "standing": item.get("standing"),
                "principal": item.get("principal"),
                "credit_limit": item.get("credit_limit"),
            })
            emitted += 1
        nxt = res.get("next_offset", -1)
        if not isinstance(nxt, int) or nxt < 0:
            break
        offset = nxt

    sys.stderr.write(f"[poll_example] ok: 1 pool_snapshot, {emitted} borrower_snapshot "
                     f"rows across {pages} page(s), chain={chain_name}, contract={contract}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
