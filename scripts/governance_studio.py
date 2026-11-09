"""
governance_studio.py - live, on-chain GOVERNANCE proof for Credence.
=====================================================================

Deploys Credence + CredenceGovernor (an M-of-N multisig) to GenLayer **studionet**
(chain 61999, the hosted Studio simulator at https://studio.genlayer.com/api) and proves,
on-chain and across contracts, that an M-of-N quorum of signers - and nobody else - can
drive Credence's owner-only admin surface:

  1. Deploy Credence (owner = deployer).
  2. Deploy CredenceGovernor with 2 signers, threshold = 2, pointed at Credence.
  3. Fund the governor contract so it can pay gas on the messages it emits.
  4. HAND CREDENCE TO THE MULTISIG: deployer calls Credence.transfer_ownership(governor),
     then the governor claims it: signer A proposes `accept_ownership_of_credence`,
     signer B approves (2/2), a signer executes -> the governor emits
     Credence.accept_ownership() across contracts. Poll Credence.get_config until
     owner == governor.
  5. GOVERN AN ADMIN ACTION: signer A proposes `set_risk_limits` [8000], signer B approves
     (2/2), a signer executes -> the governor emits Credence.set_risk_limits(8000) across
     contracts. Poll Credence.get_config until max_utilization_bps == 8000.
  6. NEGATIVE CONTROL: a non-signer stranger's propose() is rejected; and an under-approved
     proposal cannot be executed (1/2 < threshold).

Run (venv python, isolated mode):
  & "python" -I scripts\\governance_studio.py

Throwaway accounts are random/in-memory (no seed phrase, never persisted); Studio mints
free test GEN via sim_fundAccount (no captcha, no real funds). Studio is a shared sandbox:
the cross-contract messages emitted on finalization can be slow to settle, and the sandbox
is periodically reset. The script polls Credence's real STATE for the ground truth of each
step and NEVER fakes a result; if a step does not settle in time it says so honestly and
the lint-clean contract + this script still stand on their own.

NOTE: cross-contract WRITES cannot be unit-tested in gltest direct mode (no sub-VM hook),
which is exactly why this live studionet script exists - it is the only faithful way to
exercise the governor -> Credence emit path end to end.
"""

import json
import os
import sys
import time
import traceback

# Studio prints checkmarks/arrows; force UTF-8 so Windows cp1252 never crashes a print.
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
GOVERNOR_PATH = os.path.join(HERE, "..", "contracts", "credence_governor.py")

NEW_UTIL_BPS = 8000          # change set_risk_limits to this (default is 10000)


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


def wait(client, tx, status=TransactionStatus.ACCEPTED, interval=3000, retries=100):
    return client.wait_for_transaction_receipt(transaction_hash=tx, status=status,
                                               interval=interval, retries=retries)


def send(client, addr, fn, account, args=None, status=TransactionStatus.ACCEPTED,
         interval=3000, retries=100):
    """Send a write and wait for a decided receipt; return (ok, exec_hint)."""
    try:
        tx = client.write_contract(address=addr, function_name=fn, account=account,
                                   args=args or [])
        rcpt = wait(client, tx, status=status, interval=interval, retries=retries)
        return True, exec_name(rcpt)
    except Exception as e:
        return False, "raised: " + str(e)[:160]


def cfg(client, credence):
    try:
        return client.read_contract(address=credence, function_name="get_config")
    except Exception as e:
        return {"_read_error": str(e)[:160]}


def poll_config(client, credence, field, want, label, tries=40, interval=3.0):
    """Poll Credence.get_config()[field] until it equals `want` (string-compared) or we
    run out of tries. Returns (settled, last_value). The emitted cross-contract message
    settles asynchronously after the governor's execute finalizes, so this is how we read
    the ground truth without faking anything."""
    last = None
    for i in range(tries):
        c = cfg(client, credence)
        last = c.get(field) if isinstance(c, dict) else None
        if str(last).lower() == str(want).lower():
            print("  [%2d] %s = %s  <- settled" % (i, label, last), flush=True)
            return True, last
        if i % 5 == 0:
            print("  [%2d] %s = %s (waiting for %s)" % (i, label, last, want), flush=True)
        time.sleep(interval)
    return False, last


def main():
    hr("0. SETUP: throwaway accounts on studionet (chain %s)" % studionet.id)
    deployer = create_account()
    signer_a = create_account()
    signer_b = create_account()
    stranger = create_account()
    print("deployer :", deployer.address, flush=True)
    print("signer_a :", signer_a.address, flush=True)
    print("signer_b :", signer_b.address, flush=True)
    print("stranger :", stranger.address, flush=True)

    client = create_client(chain=studionet, account=deployer)
    for who, acct in (("deployer", deployer), ("signer_a", signer_a),
                      ("signer_b", signer_b), ("stranger", stranger)):
        client.fund_account(acct.address, 1000 * 10**18)
        print("funded %-9s balance=%s" % (who, client.get_balance(acct.address)), flush=True)

    # ------------------------------------------------------------------ deploy
    hr("1. DEPLOY Credence (owner = deployer)")
    credence_src = read_src(CREDENCE_PATH)
    governor_src = read_src(GOVERNOR_PATH)
    tx = client.deploy_contract(code=credence_src, account=deployer,
                                kwargs={"relayer": "", "dev": ""})
    rcpt = wait(client, tx, retries=120)
    credence = deployed_addr(rcpt)
    print("Credence deployed at:", credence, "status:", status_name(rcpt), flush=True)
    if not credence:
        raise RuntimeError("could not resolve Credence contract address from receipt")
    print("Credence owner (should be deployer):",
          cfg(client, credence).get("owner"), flush=True)

    hr("2. DEPLOY CredenceGovernor (2 signers, threshold 2) -> Credence")
    signers_arg = "%s,%s" % (signer_a.address, signer_b.address)   # comma-separated form
    tx = client.deploy_contract(code=governor_src, account=deployer,
                                kwargs={"signers": signers_arg, "threshold": 2,
                                        "credence": credence})
    rcpt = wait(client, tx, retries=120)
    governor = deployed_addr(rcpt)
    print("Governor deployed at:", governor, "status:", status_name(rcpt), flush=True)
    if not governor:
        raise RuntimeError("could not resolve Governor contract address from receipt")
    gcfg = client.read_contract(address=governor, function_name="get_config")
    print("governor.get_config:", json.dumps(gcfg, default=str), flush=True)
    assert str(gcfg.get("credence", "")).lower() == str(credence).lower(), "governor.credence mismatch"
    assert int(gcfg.get("threshold", 0)) == 2, "threshold != 2"
    assert int(gcfg.get("signer_count", 0)) == 2, "signer_count != 2"
    print("OK: governor is 2-of-2 over the Credence oracle", flush=True)
    print("is_signer(signer_a):", client.read_contract(address=governor,
          function_name="is_signer", args=[signer_a.address]), flush=True)
    print("is_signer(stranger):", client.read_contract(address=governor,
          function_name="is_signer", args=[stranger.address]), flush=True)

    # ----------------------------------------------- fund governor for gas on emits
    hr("3. FUND the governor contract (gas for the messages it emits)")
    try:
        client.fund_account(governor, 500 * 10**18)
        print("governor contract balance:", client.get_balance(governor), flush=True)
    except Exception as e:
        print("(could not fund governor contract, continuing):", str(e)[:160], flush=True)

    # ------------------------------------------- negative control: non-signer propose
    hr("4. NEGATIVE CONTROL: stranger (non-signer) tries to propose")
    ok, hint = send(client, governor, "propose", stranger,
                    args=["set_paused", "", "", True], retries=60)
    pc_after = int(client.read_contract(address=governor, function_name="get_config")
                   .get("proposal_count", -1))
    stranger_blocked = (pc_after == 0)
    print("stranger propose exec hint:", hint, "| proposal_count now:", pc_after, flush=True)
    print("NON-SIGNER BLOCKED:", "YES (no proposal created)" if stranger_blocked
          else "!! NO - a non-signer created a proposal", flush=True)

    # ------------------------------------------------ bootstrap: governor takes ownership
    hr("5. HAND CREDENCE TO THE MULTISIG")
    print("5a. deployer -> Credence.transfer_ownership(governor)", flush=True)
    ok, hint = send(client, credence, "transfer_ownership", deployer, args=[governor], retries=80)
    print("   transfer_ownership exec hint:", hint, flush=True)
    print("   Credence pending_owner:", cfg(client, credence).get("pending_owner"), flush=True)

    print("5b. signer_a proposes accept_ownership_of_credence", flush=True)
    ok, hint = send(client, governor, "propose", signer_a,
                    args=["accept_ownership_of_credence", "", "", False], retries=80)
    print("   propose exec hint:", hint, flush=True)
    # The accept proposal is id 0 (stranger's rejected propose created nothing).
    accept_id = 0
    prop = client.read_contract(address=governor, function_name="get_proposal", args=[accept_id])
    print("   proposal[0]:", json.dumps(prop, default=str), flush=True)

    print("5c. signer_b approves proposal 0 (-> 2/2)", flush=True)
    ok, hint = send(client, governor, "approve", signer_b, args=[accept_id], retries=80)
    print("   approve exec hint:", hint, flush=True)
    prop = client.read_contract(address=governor, function_name="get_proposal", args=[accept_id])
    print("   approvals now:", prop.get("approval_count"), "executable:", prop.get("executable"),
          flush=True)

    print("5d. signer_a executes proposal 0 -> governor emits Credence.accept_ownership()",
          flush=True)
    ok, hint = send(client, governor, "execute", signer_a, args=[accept_id],
                    status=TransactionStatus.FINALIZED, interval=4000, retries=120)
    print("   execute exec hint:", hint, flush=True)
    owned, owner_now = poll_config(client, credence, "owner", governor,
                                   "Credence.owner", tries=40, interval=3.0)
    print("CREDENCE NOW OWNED BY THE GOVERNOR:", "YES" if owned else "NOT YET",
          "(owner=%s)" % owner_now, flush=True)

    # ------------------------------------------------ govern a real admin action
    hr("6. GOVERN AN ADMIN ACTION: set_risk_limits(%d) via 2-of-2" % NEW_UTIL_BPS)
    before = cfg(client, credence).get("max_utilization_bps")
    print("Credence.max_utilization_bps before:", before, flush=True)

    print("6a. signer_a proposes set_risk_limits [%d]" % NEW_UTIL_BPS, flush=True)
    ok, hint = send(client, governor, "propose", signer_a,
                    args=["set_risk_limits", "", json.dumps([NEW_UTIL_BPS]), False], retries=80)
    print("   propose exec hint:", hint, flush=True)
    risk_id = 1
    prop = client.read_contract(address=governor, function_name="get_proposal", args=[risk_id])
    print("   proposal[1]:", json.dumps(prop, default=str), flush=True)

    # negative control: cannot execute at 1/2
    print("6b. NEGATIVE CONTROL: try execute at 1/2 (must be refused)", flush=True)
    ok, hint = send(client, governor, "execute", signer_a, args=[risk_id], retries=40)
    prop = client.read_contract(address=governor, function_name="get_proposal", args=[risk_id])
    under_blocked = (prop.get("status") == "pending")
    print("   execute-at-1/2 exec hint:", hint, "| status:", prop.get("status"), flush=True)
    print("   UNDER-THRESHOLD EXECUTE BLOCKED:",
          "YES (still pending)" if under_blocked else "!! NO", flush=True)

    print("6c. signer_b approves proposal 1 (-> 2/2)", flush=True)
    ok, hint = send(client, governor, "approve", signer_b, args=[risk_id], retries=80)
    print("   approve exec hint:", hint, flush=True)

    print("6d. signer_b executes proposal 1 -> governor emits Credence.set_risk_limits(%d)"
          % NEW_UTIL_BPS, flush=True)
    ok, hint = send(client, governor, "execute", signer_b, args=[risk_id],
                    status=TransactionStatus.FINALIZED, interval=4000, retries=120)
    print("   execute exec hint:", hint, flush=True)
    changed, util_now = poll_config(client, credence, "max_utilization_bps", NEW_UTIL_BPS,
                                    "Credence.max_utilization_bps", tries=40, interval=3.0)
    print("ADMIN ACTION TOOK EFFECT ACROSS CONTRACTS:", "YES" if changed else "NOT YET",
          "(max_utilization_bps=%s)" % util_now, flush=True)
    gprop = client.read_contract(address=governor, function_name="get_proposal", args=[risk_id])
    print("governor proposal[1] final status:", gprop.get("status"),
          "executed_at:", gprop.get("executed_at"), flush=True)

    # ------------------------------------------------------------------ summary
    hr("SUMMARY")
    print("Credence           :", credence, flush=True)
    print("CredenceGovernor   :", governor, "(2-of-2)", flush=True)
    print("Non-signer propose blocked         -> %s" %
          ("YES [ok]" if stranger_blocked else "NO [UNEXPECTED]"), flush=True)
    print("Under-threshold execute blocked    -> %s" %
          ("YES [ok]" if under_blocked else "NO [UNEXPECTED]"), flush=True)
    print("Governor took ownership of Credence-> %s" %
          ("YES [ok]" if owned else "NOT SETTLED (Studio slow/reset)"), flush=True)
    print("2-of-2 set_risk_limits(%d) applied  -> %s" %
          (NEW_UTIL_BPS, "YES [ok]" if changed else "NOT SETTLED (Studio slow/reset)"), flush=True)
    proven = owned and changed
    print("\nON-CHAIN M-of-N GOVERNANCE OVER CREDENCE PROVEN:", "YES" if proven else "PARTIAL",
          "- every admin change above was gated behind a 2-of-2 quorum and emitted by the "
          "governor to Credence across contracts.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\nFATAL - governance script aborted:", flush=True)
        traceback.print_exc()
        sys.exit(1)
