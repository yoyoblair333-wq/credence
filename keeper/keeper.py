#!/usr/bin/env python3
"""
Credence keeper — the robust path for keeping the loan book serviced.
=====================================================================

Credence's loan book must be *serviced*: `service_book` walks a bounded batch of the
borrower roster from a rolling cursor and moves past-due lines `overdue -> defaulted`
against the consensus clock (contracts/credence.py :: service_book / _service_one). The
contract can self-emit this work when `autonomous` is on, but a dedicated KEEPER poking it
on a cadence is the robust, observable path an operator controls — and it is the pattern
GenLayer operators use for clocked contracts.

This bot, on an interval:

  1. reads `roster_size()`, `stats()`, and `get_pool()` for observability,
  2. computes how many bounded `service_book(batch)` calls sweep the WHOLE roster once
     (ceil(roster / batch), clamped to MAX_SERVICE_BATCH = 25 and a hard pass cap), and
  3. sends those calls (or, in dry-run, previews them) so every borrower is checked each
     cycle, then reconciles the result from on-chain state (the source of truth per
     docs/EVENTS.md — events are best-effort).

Design goals (mirrors scripts/*.py: genlayer_py, throwaway/opt-in accounts, UTF-8 stdout):
  * Dependency-light: Python stdlib + genlayer_py only (same SDK the scripts use).
  * Config entirely via environment variables (12-factor); see `_load_config` / README.
  * Structured logging (JSON lines by default, or human text), one record per action.
  * Dry-run mode: reads and plans, previews via `simulate_write_contract` where supported,
    and never sends a transaction.
  * Graceful: SIGINT/SIGTERM stop cleanly between/within cycles; a single failed cycle is
    logged and the loop continues with bounded exponential backoff — the keeper never dies
    on one bad RPC round.

`service_book` is PERMISSIONLESS (anyone may call it — see docs/OPERATIONS.md), so the
keeper account needs no owner/relayer/guardian role. It only needs gas on a real testnet;
on Studio chains it is funded for free via `sim_fundAccount`.

A deliberate operational nuance — KEEPER vs the autonomous heartbeat
--------------------------------------------------------------------
`service_book(max_items, hops)` uses `hops` to budget the contract's OWN autonomous
self-emission (only when `autonomous` is on). When a keeper is the one paging the roster,
you do NOT want the contract to *also* fan out finalized self-messages for the same work —
that is redundant consensus spend. Passing `hops = 1` makes the self-emit budget zero
(`min(1, passes) - 1 == 0` in the contract), so the keeper is the sole driver. That is this
keeper's default (`CREDENCE_KEEPER_HOPS=1`). Set `hops = -1` only if you want a single
keeper poke to kick off the contract's autonomous roster pass.

Run (venv python, isolated mode), one example:
  CREDENCE_CONTRACT=0x... CREDENCE_CHAIN=studionet \
  & "python" -I keeper\\keeper.py

See keeper/README.md for studionet and Bradbury runbooks.
"""

from __future__ import annotations

import copy
import json
import math
import os
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

# Force UTF-8 stdout/stderr so Windows cp1252 never crashes a structured log line
# (same guard scripts/compose_studio.py uses).
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from genlayer_py import create_account, create_client
    from genlayer_py import chains as gl_chains
    from genlayer_py.types import TransactionStatus
except Exception as exc:  # pragma: no cover - import guard for a clear operator message
    sys.stderr.write(
        "FATAL: genlayer_py is not importable in this interpreter.\n"
        "Run the keeper with the project venv python, e.g.\n"
        '  python -I keeper/keeper.py\n'
        f"Import error: {exc}\n")
    raise SystemExit(2)


# --------------------------------------------------------------------------- #
# Constants mirrored from the contract (contracts/credence.py)
# --------------------------------------------------------------------------- #

MAX_SERVICE_BATCH = 25          # contract hard cap per service_book call
BASE = 1_000_000_000_000_000_000  # 1e18 base units per token (for human-readable logs)

# Named chains genlayer_py 0.16.3 ships (verified against the installed SDK).
# studionet/localnet share chain id 61999 and expose sim_fundAccount (free test GEN).
CHAINS: dict[str, Any] = {
    "studionet": gl_chains.studionet,
    "localnet": gl_chains.localnet,
    "testnet_asimov": gl_chains.testnet_asimov,
    "testnet_bradbury": gl_chains.testnet_bradbury,
}
# Convenience aliases an operator might type.
CHAIN_ALIASES = {
    "studio": "studionet",
    "local": "localnet",
    "asimov": "testnet_asimov",
    "bradbury": "testnet_bradbury",
    "testnet": "testnet_asimov",
}
# Chains that expose the Studio simulator's free funding RPC (sim_fundAccount).
FAUCET_CHAINS = {"studionet", "localnet"}


# --------------------------------------------------------------------------- #
# Structured logging (stdlib only; JSON lines by default)
# --------------------------------------------------------------------------- #

class Log:
    """Minimal structured logger: one JSON object (or one aligned text line) per call,
    flushed immediately so `journalctl`/`docker logs`/Task Scheduler capture it live."""

    def __init__(self, fmt: str = "json", level: str = "info") -> None:
        self.fmt = fmt if fmt in ("json", "text") else "json"
        order = {"debug": 10, "info": 20, "warn": 30, "error": 40}
        self.threshold = order.get(level, 20)
        self._order = order

    def _emit(self, level: str, event: str, **fields: Any) -> None:
        if self._order.get(level, 20) < self.threshold:
            return
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        if self.fmt == "json":
            rec = {"ts": ts, "level": level, "event": event}
            rec.update(fields)
            line = json.dumps(rec, default=str, ensure_ascii=False)
        else:
            extra = " ".join(f"{k}={v}" for k, v in fields.items())
            line = f"{ts} {level.upper():5s} {event}" + (f" | {extra}" if extra else "")
        print(line, flush=True)

    def debug(self, event: str, **f: Any) -> None: self._emit("debug", event, **f)
    def info(self, event: str, **f: Any) -> None: self._emit("info", event, **f)
    def warn(self, event: str, **f: Any) -> None: self._emit("warn", event, **f)
    def error(self, event: str, **f: Any) -> None: self._emit("error", event, **f)


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(name)
    return v if v is not None and v != "" else default


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on", "y")


def _env_int(name: str, default: int) -> int:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    try:
        return int(str(v).strip())
    except ValueError:
        raise SystemExit(f"FATAL: {name} must be an integer, got {v!r}")


def _is_address(v: str) -> bool:
    return (isinstance(v, str) and len(v) == 42 and v[:2].lower() == "0x"
            and all(c in "0123456789abcdefABCDEF" for c in v[2:]))


@dataclass
class Config:
    contract: str
    chain_name: str
    rpc: Optional[str]
    private_key: Optional[str]
    interval: int           # seconds between cycles; <= 0 means one-shot
    batch: int              # items per service_book call (1..25)
    hops: int               # service_book hops arg (1 = keeper drives, suppress self-emit)
    max_passes: int         # hard cap on service_book calls per cycle (bounds spend)
    dry_run: bool
    confirm: bool           # wait for a tx receipt after each service_book
    tx_retries: int
    tx_interval_ms: int
    sim_fund: int           # base units to sim-fund a throwaway on faucet chains
    log_fmt: str
    log_level: str


def _load_config() -> Config:
    contract = _env("CREDENCE_CONTRACT") or _env("CREDENCE_KEEPER_CONTRACT")
    if not contract:
        raise SystemExit("FATAL: set CREDENCE_CONTRACT to the deployed Credence address "
                         "(0x + 40 hex).")
    contract = contract.strip()
    if not _is_address(contract):
        raise SystemExit(f"FATAL: CREDENCE_CONTRACT is not a 0x+40hex address: {contract!r}")

    raw_chain = (_env("CREDENCE_CHAIN", "studionet") or "studionet").strip().lower()
    chain_name = CHAIN_ALIASES.get(raw_chain, raw_chain)
    if chain_name not in CHAINS:
        raise SystemExit(f"FATAL: CREDENCE_CHAIN must be one of "
                         f"{sorted(CHAINS)} (or an alias {sorted(CHAIN_ALIASES)}); got {raw_chain!r}")

    batch = _env_int("CREDENCE_KEEPER_BATCH", MAX_SERVICE_BATCH)
    batch = max(1, min(batch, MAX_SERVICE_BATCH))

    hops = _env_int("CREDENCE_KEEPER_HOPS", 1)
    max_passes = _env_int("CREDENCE_KEEPER_MAX_PASSES", 64)
    max_passes = max(1, max_passes)

    return Config(
        contract=contract,
        chain_name=chain_name,
        rpc=_env("CREDENCE_RPC") or _env("CREDENCE_KEEPER_RPC"),
        private_key=_env("CREDENCE_KEEPER_PRIVATE_KEY"),
        interval=_env_int("CREDENCE_KEEPER_INTERVAL", 300),
        batch=batch,
        hops=hops,
        max_passes=max_passes,
        dry_run=_env_bool("CREDENCE_KEEPER_DRY_RUN", False),
        confirm=_env_bool("CREDENCE_KEEPER_CONFIRM", True),
        tx_retries=max(1, _env_int("CREDENCE_KEEPER_TX_RETRIES", 60)),
        tx_interval_ms=max(250, _env_int("CREDENCE_KEEPER_TX_INTERVAL_MS", 3000)),
        sim_fund=_env_int("CREDENCE_KEEPER_SIM_FUND", 1000 * BASE),
        log_fmt=(_env("CREDENCE_KEEPER_LOG", "json") or "json").strip().lower(),
        log_level=(_env("CREDENCE_KEEPER_LOG_LEVEL", "info") or "info").strip().lower(),
    )


# --------------------------------------------------------------------------- #
# Keeper
# --------------------------------------------------------------------------- #

@dataclass
class _Stop:
    """Cooperative shutdown flag toggled by SIGINT/SIGTERM."""
    flag: bool = False

    def request(self, *_: Any) -> None:
        self.flag = True


class Keeper:
    def __init__(self, cfg: Config, log: Log) -> None:
        self.cfg = cfg
        self.log = log
        self.stop = _Stop()
        self.client = None
        self.account = None

    # --------------------------------------------------------------- setup
    def _resolve_chain(self):
        chain = copy.deepcopy(CHAINS[self.cfg.chain_name])
        if self.cfg.rpc:
            try:
                chain.rpc_urls = {"default": {"http": [self.cfg.rpc]}}
            except Exception as exc:  # pragma: no cover - defensive
                self.log.warn("rpc_override_unsupported", rpc=self.cfg.rpc, error=str(exc))
        try:
            http = chain.rpc_urls["default"]["http"][0]
        except Exception:
            http = "?"
        return chain, http

    def connect(self) -> None:
        chain, http = self._resolve_chain()
        # Account: an explicit key (required on real testnets), else a throwaway.
        if self.cfg.private_key:
            try:
                self.account = create_account(account_private_key=self.cfg.private_key.strip())
            except Exception as exc:
                raise SystemExit(f"FATAL: CREDENCE_KEEPER_PRIVATE_KEY is invalid: {exc}")
            key_src = "env_private_key"
        else:
            self.account = create_account()  # random, in-memory only
            key_src = "throwaway"

        self.client = create_client(chain=chain, account=self.account)
        self.log.info("connected", chain=self.cfg.chain_name, chain_id=chain.id, rpc=http,
                      keeper=self.account.address, key_source=key_src,
                      dry_run=self.cfg.dry_run)

        # Faucet funding (Studio chains only). Harmless if already funded.
        if self.cfg.chain_name in FAUCET_CHAINS and not self.cfg.private_key:
            try:
                self.client.fund_account(self.account.address, self.cfg.sim_fund)
                bal = int(self.client.get_balance(self.account.address))
                self.log.info("funded_throwaway", balance=bal)
            except Exception as exc:
                self.log.warn("sim_fund_failed", error=str(exc)[:200])

        # Balance check on a real testnet (no faucet) when we will actually send.
        if self.cfg.chain_name not in FAUCET_CHAINS and not self.cfg.dry_run:
            try:
                bal = int(self.client.get_balance(self.account.address))
                if bal <= 0:
                    self.log.warn("keeper_unfunded", keeper=self.account.address,
                                  note="service_book writes will fail with no gas; fund this key")
                else:
                    self.log.info("keeper_balance", balance=bal)
            except Exception as exc:
                self.log.warn("balance_read_failed", error=str(exc)[:200])

    def preflight(self) -> None:
        """Fail fast with a clear message if the address is unreachable or not Credence."""
        try:
            cfg = self._read("get_config")
        except Exception as exc:
            raise SystemExit(f"FATAL: cannot read get_config() at {self.cfg.contract} "
                             f"on {self.cfg.chain_name} — wrong address/chain/RPC? {exc}")
        version = cfg.get("version") if isinstance(cfg, dict) else None
        paused = cfg.get("paused") if isinstance(cfg, dict) else None
        autonomous = cfg.get("autonomous") if isinstance(cfg, dict) else None
        self.log.info("preflight_ok", contract=self.cfg.contract, version=version,
                      paused=paused, autonomous=autonomous, batch=self.cfg.batch,
                      hops=self.cfg.hops, interval=self.cfg.interval)
        if paused:
            self.log.warn("contract_paused",
                          note="service_book reverts while paused; keeper will log the revert and retry")

    # --------------------------------------------------------------- rpc helpers
    def _read(self, fn: str, args: Optional[list] = None) -> Any:
        return self.client.read_contract(address=self.cfg.contract, function_name=fn,
                                         args=args or [])

    def _simulate(self, fn: str, args: list) -> Any:
        """Dry-run preview of a write's return value (Studio chains only; the SDK guards
        simulate_write_contract to localnet.id, which studionet shares). Returns a COMPACT
        summary — the raw simulate result carries the entire encoded `contract_state`, which
        would bloat a log line to tens of KB, so we keep only the decision-relevant fields."""
        raw = self.client.simulate_write_contract(address=self.cfg.contract,
                                                   function_name=fn, args=args,
                                                   account=self.account)
        if isinstance(raw, dict):
            return {k: raw.get(k) for k in ("execution_result", "mode", "gas_used", "vote")
                    if k in raw}
        return raw

    def _service_once(self, batch: int) -> Optional[str]:
        """Send one service_book(batch, hops) write; return the tx hash (or None)."""
        tx = self.client.write_contract(address=self.cfg.contract, function_name="service_book",
                                        account=self.account, args=[batch, self.cfg.hops])
        if self.cfg.confirm:
            try:
                self.client.wait_for_transaction_receipt(
                    transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                    interval=self.cfg.tx_interval_ms, retries=self.cfg.tx_retries)
            except Exception as exc:
                self.log.warn("receipt_wait_failed", tx=str(tx), error=str(exc)[:200])
        return str(tx)

    # --------------------------------------------------------------- one cycle
    def run_cycle(self, cycle: int) -> None:
        roster = int(self._read("roster_size"))
        stats_before = self._read("stats")
        pool = self._read("get_pool")
        util = pool.get("utilization_bps") if isinstance(pool, dict) else None
        self.log.info("cycle_start", cycle=cycle, roster=roster,
                      active_lines=(stats_before.get("active_lines") if isinstance(stats_before, dict) else None),
                      defaulted=(stats_before.get("defaulted") if isinstance(stats_before, dict) else None),
                      service_cursor=(stats_before.get("service_cursor") if isinstance(stats_before, dict) else None),
                      utilization_bps=util,
                      cash=(pool.get("cash") if isinstance(pool, dict) else None))

        if roster == 0:
            self.log.info("nothing_to_service", cycle=cycle, reason="empty_roster")
            return

        # One full roster pass per cycle: ceil(roster / batch) bounded calls, from the
        # contract's rolling cursor. Clamp to the hard pass cap to bound per-cycle spend.
        needed = math.ceil(roster / self.cfg.batch)
        passes = min(needed, self.cfg.max_passes)
        if passes < needed:
            self.log.warn("pass_cap_hit", needed=needed, cap=self.cfg.max_passes,
                          note="roster larger than max_passes*batch; remainder swept next cycle")

        if self.cfg.dry_run:
            preview = None
            try:
                preview = self._simulate("service_book", [self.cfg.batch, self.cfg.hops])
            except Exception as exc:
                self.log.debug("simulate_unavailable", error=str(exc)[:160])
            self.log.info("dry_run_plan", cycle=cycle, would_call="service_book",
                          batch=self.cfg.batch, hops=self.cfg.hops, passes=passes,
                          roster=roster, simulate_preview=preview)
            return

        sent = 0
        for p in range(passes):
            if self.stop.flag:
                self.log.info("cycle_interrupted", cycle=cycle, sent=sent, planned=passes)
                break
            try:
                tx = self._service_once(self.cfg.batch)
                sent += 1
                self.log.info("serviced_batch", cycle=cycle, pass_index=p + 1,
                              planned=passes, batch=self.cfg.batch, hops=self.cfg.hops, tx=tx)
            except Exception as exc:
                # A single batch failing (RPC blip, transient consensus) must not abort the
                # cycle; log and move on — next cycle re-sweeps from the advanced cursor.
                self.log.error("service_batch_failed", cycle=cycle, pass_index=p + 1,
                               error=str(exc)[:240])

        # Reconcile from on-chain STATE (the source of truth; events are best-effort).
        try:
            stats_after = self._read("stats")
            d0 = int(stats_before.get("defaulted", 0)) if isinstance(stats_before, dict) else 0
            d1 = int(stats_after.get("defaulted", 0)) if isinstance(stats_after, dict) else 0
            self.log.info("cycle_done", cycle=cycle, batches_sent=sent, planned=passes,
                          defaulted_before=d0, defaulted_after=d1, new_defaults=max(0, d1 - d0),
                          service_cursor=stats_after.get("service_cursor") if isinstance(stats_after, dict) else None)
        except Exception as exc:
            self.log.warn("reconcile_failed", cycle=cycle, error=str(exc)[:200])

    # --------------------------------------------------------------- loop
    def run(self) -> int:
        # Register signal handlers where supported (SIGTERM is absent on some Windows setups).
        for sig in ("SIGINT", "SIGTERM"):
            s = getattr(signal, sig, None)
            if s is not None:
                try:
                    signal.signal(s, self.stop.request)
                except (ValueError, OSError):
                    pass  # not in main thread / unsupported — Ctrl-C still raises KeyboardInterrupt

        self.connect()
        self.preflight()

        one_shot = self.cfg.interval <= 0
        cycle = 0
        consecutive_failures = 0
        rc = 0
        try:
            while not self.stop.flag:
                cycle += 1
                try:
                    self.run_cycle(cycle)
                    consecutive_failures = 0
                except KeyboardInterrupt:
                    raise
                except Exception as exc:
                    consecutive_failures += 1
                    self.log.error("cycle_failed", cycle=cycle, error=str(exc)[:240],
                                   consecutive_failures=consecutive_failures)
                    rc = 1  # surface a nonzero exit if one-shot and it failed

                if one_shot:
                    self.log.info("one_shot_exit", cycle=cycle)
                    break

                # Bounded exponential backoff on repeated failure; normal interval otherwise.
                if consecutive_failures > 0:
                    backoff = min(self.cfg.interval * (2 ** (consecutive_failures - 1)),
                                  max(self.cfg.interval, 3600))
                    wait = int(backoff)
                else:
                    wait = self.cfg.interval
                    rc = 0
                self.log.debug("sleeping", seconds=wait, next_cycle=cycle + 1)
                self._interruptible_sleep(wait)
        except KeyboardInterrupt:
            self.log.info("interrupted", note="KeyboardInterrupt — shutting down")
        self.log.info("stopped", cycles_run=cycle)
        return rc if one_shot else 0

    def _interruptible_sleep(self, seconds: int) -> None:
        """Sleep in short slices so a stop signal is honored promptly."""
        deadline = time.monotonic() + max(0, seconds)
        while not self.stop.flag and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))


def main() -> int:
    cfg = _load_config()
    log = Log(fmt=cfg.log_fmt, level=cfg.log_level)
    log.info("keeper_boot", contract=cfg.contract, chain=cfg.chain_name,
             interval=cfg.interval, batch=cfg.batch, hops=cfg.hops,
             dry_run=cfg.dry_run, confirm=cfg.confirm, max_passes=cfg.max_passes)
    return Keeper(cfg, log).run()


if __name__ == "__main__":
    raise SystemExit(main())
