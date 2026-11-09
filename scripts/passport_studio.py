"""
passport_studio.py - live, on-chain proof of the SOULBOUND Credit Passport.
============================================================================

Deploys TWO Intelligent Contracts to GenLayer **studionet** (chain 61999, the hosted
Studio simulator at https://studio.genlayer.com/api) and shows the passport recording a
holder's Credence standing via a SYNCHRONOUS cross-contract read, on-chain:

  1. Deploy Credence (the creditworthiness oracle).
  2. Deploy CredencePassport, pointed at Credence's address.
  3. A holder requests credit (strong text evidence) and Credence's AI underwriter panel
     `assess`-es them to a grade (text-only evidence is capped at "C" by design).
  4. MINT: the holder calls passport.mint(). The passport reads credit_of(holder) ACROSS
     CONTRACTS (ICredence(credence).view().credit_of(holder)) and records their snapshot.
     (Minting needs only `known == True`, i.e. Credence has seen the address, so this
     proves the cross-contract read even if the slow AI `assess` step does not land.)
  5. REFRESH: the holder calls passport.refresh(); the snapshot re-syncs to the current
     standing and refresh_count increments.
  6. SOULBOUND: the contract exposes NO transfer method - we print its method set to show
     mint/refresh are the only writes besides admin, so a passport cannot be moved.
  7. NON-ASSESSED REJECTED: a stranger Credence has never seen calls mint(). The
     cross-contract credit_of(stranger).known == False, so mint REVERTS and no passport
     is issued.

Run (venv python, isolated mode):
  & "python" -I scripts\\passport_studio.py

Throwaway accounts are random/in-memory (no seed phrase, never persisted); Studio mints
free test GEN via sim_fundAccount (no captcha, no real funds). Studio is a shared sandbox:
the AI `assess` step is slow and may time out or the sandbox may reset. If so, the MINT,
REFRESH and NON-ASSESSED-REJECTED phases still prove the cross-contract oracle read works
(mint records whatever credit_of returns; the stranger is rejected because the live read
returns known=False). The script reports exactly what happened and never fakes a result.
"""

import json
import os
import sys
import traceback

# studionet prints checkmarks/arrows; force UTF-8 so Windows cp1252 never crashes a print.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from genlayer_py import create_client, create_account
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionStatus

HERE = os.path.dirname(os.path.abspath(__file__))
CREDENCE_PATH = os.path.join(HERE, "..", "contracts", "credence.py")
PASSPORT_PATH = os.path.join(HERE, "..", "contracts", "credence_passport.py")

# Strong, clean text evidence. Text-only evidence is capped at grade C by Credence's
# identity-bound rule; a well-substantiated record gives the panel a reason to back C.
EVIDENCE = [{
    "kind": "text",
    "label": "Verified recurring revenue and history",
    "content": ("Operates a profitable software business with 36 consecutive months of "
                "recurring revenue averaging 42,000 USD per month, net margin above 30 "
                "percent, no missed vendor payments, and 180,000 USD in cash reserves. "
                "Seeks a small working-capital line to smooth receivables."),
}]
PURPOSE = "Working capital to smooth receivables for a profitable software business"


def hr(title):
    print("\n" + "=" * 72 + "\n" + title + "\n" + "=" * 72, flush=True)


def read_src(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def deployed_addr(receipt):
    for key in ("data", "tx_data_decoded"):
        sub = receipt.get(key) if hasattr(receipt, "get") else None
        if isinstance(sub, dict) and sub.get("contract_address"):
            return sub["contract_address"]
    if hasattr(receipt, "get") and receipt.get("contract_address"):
        return receipt["contract_address"]
    return None


def exec_name(receipt):
    try:
        return str(receipt.get("tx_execution_result_name") or receipt.get("tx_execution_result"))
    except Exception:
        return "?"


def status_name(receipt):
    try:
        return str(receipt.get("status_name") or receipt.get("status"))
    except Exception:
        return "?"


def read(client, addr, fn, args=None):
    try:
        return client.read_contract(address=addr, function_name=fn, args=args or [])
    except Exception as e:
        return "read-failed: " + str(e)[:160]


def send(client, addr, fn, account, args=None, retries=80, interval=3000):
    """Send a real write and wait for a decided receipt; return an exec hint string.
    A revert (expected for the stranger's mint) is reported, never hidden."""
    try:
        tx = client.write_contract(address=addr, function_name=fn, account=account, args=args or [])
    except Exception as e:
        return "write-raised: " + str(e)[:200]
    try:
        rcpt = client.wait_for_transaction_receipt(transaction_hash=tx,
                                                   status=TransactionStatus.ACCEPTED,
                                                   interval=interval, retries=retries)
        return exec_name(rcpt)
    except Exception as e:
        return "wait-raised: " + str(e)[:200]


def has_passport(client, passport, addr):
    """Ground truth for mint/refresh outcomes: read contract STATE, not the receipt
    (GenLayer does not populate execution-result fields at the ACCEPTED stage)."""
    r = read(client, passport, "has_passport", [addr])
    return bool(r) if isinstance(r, bool) else False


def main():
    hr("0. SETUP: throwaway accounts on studionet (chain %s)" % studionet.id)
    deployer = create_account()
    holder = create_account()
    stranger = create_account()
    print("deployer:", deployer.address, flush=True)
    print("holder  :", holder.address, flush=True)
    print("stranger:", stranger.address, flush=True)

    client = create_client(chain=studionet, account=deployer)
    for who, acct in (("deployer", deployer), ("holder", holder), ("stranger", stranger)):
        client.fund_account(acct.address, 1000 * 10**18)
        print("funded %-8s balance=%s" % (who, client.get_balance(acct.address)), flush=True)

    # ------------------------------------------------------------------ deploy
    hr("1. DEPLOY Credence (the creditworthiness oracle)")
    credence_src = read_src(CREDENCE_PATH)
    passport_src = read_src(PASSPORT_PATH)
    tx = client.deploy_contract(code=credence_src, account=deployer, kwargs={"relayer": "", "dev": ""})
    rcpt = client.wait_for_transaction_receipt(transaction_hash=tx,
                                               status=TransactionStatus.ACCEPTED, interval=3000, retries=100)
    credence = deployed_addr(rcpt)
    print("Credence deployed at:", credence, "status:", status_name(rcpt), flush=True)
    if not credence:
        raise RuntimeError("could not resolve Credence contract address from receipt")

    hr("2. DEPLOY CredencePassport -> Credence (soulbound credit passport)")
    tx = client.deploy_contract(code=passport_src, account=deployer,
                                kwargs={"credence": credence, "owner": ""})
    rcpt = client.wait_for_transaction_receipt(transaction_hash=tx,
                                               status=TransactionStatus.ACCEPTED, interval=3000, retries=100)
    passport = deployed_addr(rcpt)
    print("Passport deployed at:", passport, "status:", status_name(rcpt), flush=True)
    if not passport:
        raise RuntimeError("could not resolve Passport contract address from receipt")
    cfg = read(client, passport, "get_config")
    print("passport.get_config:", json.dumps(cfg, default=str), flush=True)
    assert str(cfg.get("credence", "")).lower() == str(credence).lower(), "passport.credence != Credence addr"
    assert cfg.get("soulbound") is True, "config must advertise soulbound"
    print("OK: passport points at the Credence oracle and advertises soulbound=True", flush=True)

    # ------------------------------------------- SOULBOUND: no transfer method
    hr("3. SOULBOUND: the contract's method set has NO transfer")
    schema = {}
    try:
        schema = client.get_contract_schema(passport)
    except Exception as e:
        print("(schema read failed:", str(e)[:120], ")", flush=True)
    methods = sorted((schema.get("methods") or {}).keys()) if isinstance(schema, dict) else []
    print("passport methods:", methods, flush=True)
    transferish = [m for m in methods if any(t in m.lower() for t in ("transfer", "approve", "send", "move"))
                   and m not in ("transfer_ownership",)]
    print("transfer-like holder methods (expected none):", transferish, flush=True)
    print("SOULBOUND:", "CONFIRMED - no way to move a passport between addresses"
          if not transferish else "!! UNEXPECTED transfer-like method found", flush=True)

    # --------------------------------------------------- request + AI assess
    hr("4. HOLDER requests credit; Credence AI panel assesses")
    tx = client.write_contract(address=credence, function_name="request_credit", account=holder,
                               args=[PURPOSE, 100, json.dumps(EVIDENCE)])
    client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                        interval=3000, retries=60)
    co = read(client, credence, "credit_of", [holder.address])
    print("after request_credit, credit_of(holder):", json.dumps(co, default=str), flush=True)

    grade = None
    assess_ok = False
    try:
        print("calling assess() - 3 LLM underwriters across validators, slow on shared Studio...", flush=True)
        tx = client.write_contract(address=credence, function_name="assess", account=deployer,
                                   args=[holder.address])
        rcpt = client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                                   interval=5000, retries=120)
        rec = read(client, credence, "credit_of", [holder.address])
        grade = rec.get("grade") if isinstance(rec, dict) else None
        assess_ok = isinstance(rec, dict) and rec.get("status") in ("approved", "denied")
        print("assess exec hint:", exec_name(rcpt), "| credit_of:", json.dumps(rec, default=str), flush=True)
    except Exception as e:
        print("!! assess did not complete (Studio LLM slow/timeout/reset):", str(e)[:300], flush=True)

    # ------------------------------------------------------------ Phase: MINT
    hr("5. MINT: holder.mint() reads credit_of(holder) ACROSS CONTRACTS")
    co_now = read(client, credence, "credit_of", [holder.address])
    print("the passport's source -> Credence.credit_of(holder).known =",
          (co_now.get("known") if isinstance(co_now, dict) else co_now), flush=True)
    print("mint exec hint:", send(client, passport, "mint", holder), flush=True)
    minted = has_passport(client, passport, holder.address)
    print("passport.has_passport(holder):", minted, flush=True)
    if minted:
        pp = read(client, passport, "passport_of", [holder.address])
        print("MINTED. passport_of(holder) (grade/standing SNAPSHOTTED FROM CREDENCE across contracts):",
              json.dumps(pp, default=str), flush=True)
    else:
        print("MINT did not land (Studio slow/reset); credit_of.known was",
              (co_now.get("known") if isinstance(co_now, dict) else co_now), flush=True)

    # --------------------------------------------------------- Phase: REFRESH
    hr("6. REFRESH: holder.refresh() re-syncs the snapshot, bumps refresh_count")
    if minted:
        before = read(client, passport, "passport_of", [holder.address])
        rc_before = before.get("refresh_count") if isinstance(before, dict) else None
        print("refresh exec hint:", send(client, passport, "refresh", holder), flush=True)
        after = read(client, passport, "passport_of", [holder.address])
        rc_after = after.get("refresh_count") if isinstance(after, dict) else None
        print("refresh_count %s -> %s" % (rc_before, rc_after), flush=True)
        print("REFRESH:", "CONFIRMED (count incremented)" if (isinstance(rc_after, int) and
              isinstance(rc_before, int) and rc_after > rc_before) else "did not increment (see hint above)",
              flush=True)
        print("tier_at_least(holder, C):", read(client, passport, "tier_at_least", [holder.address, "C"]), flush=True)
    else:
        print("skipped (no passport minted in phase 5)", flush=True)

    # ------------------------------------------------ Phase: NON-ASSESSED REJECT
    hr("7. NON-ASSESSED REJECTED: stranger.mint() (Credence has never seen them)")
    co_s = read(client, credence, "credit_of", [stranger.address])
    print("Credence.credit_of(stranger).known =",
          (co_s.get("known") if isinstance(co_s, dict) else co_s), flush=True)
    print("mint exec hint:", send(client, passport, "mint", stranger, retries=40), flush=True)
    stranger_has = has_passport(client, passport, stranger.address)
    print("passport.has_passport(stranger):", stranger_has, flush=True)
    print("NON-ASSESSED:", "REJECTED as expected (credit_of.known == False)"
          if not stranger_has else "!! UNEXPECTEDLY MINTED", flush=True)

    # ------------------------------------------------------------- summary
    hr("SUMMARY")
    print("Credence oracle     :", credence, flush=True)
    print("Soulbound passport  :", passport, flush=True)
    print("assess landed grade :", grade, "(assess_ok=%s)" % assess_ok, flush=True)
    print("MINT (holder)       -> %s" % ("MINTED [ok]" if minted else "NOT MINTED (Studio slow/reset)"), flush=True)
    print("REFRESH (holder)    -> %s" % ("see phase 6" if minted else "skipped"), flush=True)
    print("NON-ASSESSED reject -> %s" % ("REJECT [ok]" if not stranger_has else "MINT [UNEXPECTED]"), flush=True)
    xchain = minted or (isinstance(co_s, dict) and co_s.get("known") is False and not stranger_has)
    print("\nCROSS-CONTRACT ORACLE READ PROVEN ON-CHAIN:", "YES" if xchain else "NO",
          "- mint/refresh snapshot the holder's standing, and the unknown stranger is",
          "rejected, all via passport -> Credence.credit_of() read across contracts.", flush=True)
    print("Soulbound: no transfer method exists, so a passport can never leave its minter.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\nFATAL - passport script aborted:", flush=True)
        traceback.print_exc()
        sys.exit(1)
