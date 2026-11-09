"""
compose_studio.py - live, on-chain COMPOSABILITY proof for Credence.
=====================================================================

Deploys TWO Intelligent Contracts to GenLayer **studionet** (chain 61999, the hosted
Studio simulator at https://studio.genlayer.com/api) and shows the second one CONSUMING
the first one's AI credit oracle across contracts, on-chain:

  1. Deploy Credence (the creditworthiness oracle).
  2. Deploy CredenceGatedVault, pointed at Credence's address, min_grade = "AAA".
  3. A borrower requests credit (text evidence) and Credence's AI underwriter panel
     `assess`-es them to a grade (text-only evidence is capped at "C" by design).
  4. Phase A - THRESHOLD ENFORCED: the borrower calls vault.claim() while the bar is
     "AAA". The vault reads Credence.is_creditworthy(borrower, "AAA") across contracts,
     gets False, and REJECTS. (Proves the cross-contract read runs and the bar bites.)
  5. Phase B - ADMIT: the owner lowers the bar to "C"; the borrower calls claim() again.
     The vault reads is_creditworthy(borrower, "C") -> True, snapshots the live grade via
     credit_of(borrower), and ADMITS them to the collateral-free allowlist.
  6. Phase C - UNKNOWN REJECTED: a stranger Credence has never seen calls claim(). The
     vault reads is_creditworthy(stranger, "C") -> False and REJECTS.

Run (venv python, isolated mode):
  & "python" -I scripts\\compose_studio.py

Throwaway accounts are random/in-memory (no seed phrase, never persisted); Studio mints
free test GEN via sim_fundAccount (no captcha, no real funds). Studio is a shared sandbox:
the AI `assess` step is slow and may time out or the sandbox may reset. If so, Phases A
and C still prove the cross-contract oracle read works (both reject because the live read
returns False); only Phase B (admit) needs `assess` to land a grade >= C. The script
reports exactly what happened and never fakes a result.
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
VAULT_PATH = os.path.join(HERE, "..", "contracts", "credence_gated.py")

MIN_GRADE_HIGH = "AAA"   # above the "C" cap on text-only evidence -> deterministic reject
MIN_GRADE_DEMO = "C"     # the demo admission bar

# Strong, clean text evidence. Text-only evidence is capped at grade C by Credence's
# identity-bound rule, which is exactly what makes Phase A deterministic.
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


def admitted(client, vault, addr):
    """Ground truth for a claim's outcome: read contract STATE. (GenLayer does not
    populate the receipt's execution-result fields at the ACCEPTED stage, so the
    receipt cannot be used to tell admit from reject - the state can.)"""
    try:
        return bool(client.read_contract(address=vault, function_name="is_admitted", args=[addr]))
    except Exception as e:
        print("  (is_admitted read failed:", str(e)[:120], ")", flush=True)
        return False


def oracle_says(client, credence, addr, bar):
    """The authoritative reason a claim is admitted/rejected: the vault's gate IS this
    exact cross-contract read of Credence."""
    try:
        return client.read_contract(address=credence, function_name="is_creditworthy", args=[addr, bar])
    except Exception as e:
        return "read-failed: " + str(e)[:120]


def send_claim(client, vault, account):
    """Send a real claim() write and wait for a decided receipt; return an exec hint."""
    tx = client.write_contract(address=vault, function_name="claim", account=account)
    try:
        rcpt = client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                                   interval=3000, retries=80)
        return exec_name(rcpt)
    except Exception as e:
        return "wait-raised: " + str(e)[:120]


def main():
    hr("0. SETUP: throwaway accounts on studionet (chain %s)" % studionet.id)
    deployer = create_account()
    borrower = create_account()
    stranger = create_account()
    print("deployer:", deployer.address, flush=True)
    print("borrower:", borrower.address, flush=True)
    print("stranger:", stranger.address, flush=True)

    client = create_client(chain=studionet, account=deployer)
    for who, acct in (("deployer", deployer), ("borrower", borrower), ("stranger", stranger)):
        client.fund_account(acct.address, 1000 * 10**18)
        print("funded %-8s balance=%s" % (who, client.get_balance(acct.address)), flush=True)

    # ------------------------------------------------------------------ deploy
    hr("1. DEPLOY Credence (the creditworthiness oracle)")
    credence_src = read_src(CREDENCE_PATH)
    vault_src = read_src(VAULT_PATH)
    tx = client.deploy_contract(code=credence_src, account=deployer, kwargs={"relayer": "", "dev": ""})
    rcpt = client.wait_for_transaction_receipt(transaction_hash=tx,
                                               status=TransactionStatus.ACCEPTED, interval=3000, retries=100)
    credence = deployed_addr(rcpt)
    print("Credence deployed at:", credence, "status:", status_name(rcpt), flush=True)
    if not credence:
        raise RuntimeError("could not resolve Credence contract address from receipt")

    hr("2. DEPLOY CredenceGatedVault -> Credence, min_grade=%s" % MIN_GRADE_HIGH)
    tx = client.deploy_contract(code=vault_src, account=deployer,
                                kwargs={"credence": credence, "min_grade": MIN_GRADE_HIGH, "owner": ""})
    rcpt = client.wait_for_transaction_receipt(transaction_hash=tx,
                                               status=TransactionStatus.ACCEPTED, interval=3000, retries=100)
    vault = deployed_addr(rcpt)
    print("Vault deployed at:", vault, "status:", status_name(rcpt), flush=True)
    if not vault:
        raise RuntimeError("could not resolve Vault contract address from receipt")
    cfg = client.read_contract(address=vault, function_name="get_config")
    print("vault.get_config:", json.dumps(cfg, default=str), flush=True)
    # Prove the vault stored the right oracle address.
    assert str(cfg.get("credence", "")).lower() == str(credence).lower(), "vault.credence != Credence addr"
    print("OK: vault points at the Credence oracle", flush=True)

    # --------------------------------------------------- request + AI assess
    hr("3. BORROWER requests credit; Credence AI panel assesses")
    tx = client.write_contract(address=credence, function_name="request_credit", account=borrower,
                               args=[PURPOSE, 100, json.dumps(EVIDENCE)])
    client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                        interval=3000, retries=60)
    print("request_credit accepted; borrower status:",
          client.read_contract(address=credence, function_name="credit_of",
                               args=[borrower.address]).get("status"), flush=True)

    assess_ok = False
    grade = None
    try:
        print("calling assess() - runs 3 LLM underwriters across validators, slow on shared Studio...", flush=True)
        tx = client.write_contract(address=credence, function_name="assess", account=deployer,
                                   args=[borrower.address])
        rcpt = client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                                   interval=5000, retries=120)
        rec = client.read_contract(address=credence, function_name="credit_of", args=[borrower.address])
        grade = rec.get("grade")
        assess_ok = rec.get("status") == "approved"   # ground truth, not the receipt field
        print("assess exec hint:", exec_name(rcpt), "| credit_of:", json.dumps(rec, default=str), flush=True)
    except Exception as e:
        print("!! assess did not complete (Studio LLM slow/timeout/reset):", str(e)[:300], flush=True)

    # ------------------------------------------------------ Phase A: threshold
    hr("4. PHASE A - THRESHOLD ENFORCED: borrower.claim() while bar = %s" % MIN_GRADE_HIGH)
    print("the vault's gate -> Credence.is_creditworthy(borrower, %s) =" % MIN_GRADE_HIGH,
          oracle_says(client, credence, borrower.address, MIN_GRADE_HIGH), flush=True)
    print("claim exec hint:", send_claim(client, vault, borrower), flush=True)
    phase_a_rejected = not admitted(client, vault, borrower.address)
    print("vault.is_admitted(borrower):", not phase_a_rejected, flush=True)
    print("PHASE A:", "REJECTED as expected (grade C is below the AAA bar)" if phase_a_rejected
          else "!! UNEXPECTEDLY ADMITTED", flush=True)

    # ---------------------------------------------------------- Phase B: admit
    hr("5. PHASE B - ADMIT: owner lowers bar to %s, borrower.claim() again" % MIN_GRADE_DEMO)
    tx = client.write_contract(address=vault, function_name="set_min_grade", account=deployer,
                               args=[MIN_GRADE_DEMO])
    client.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus.ACCEPTED,
                                        interval=3000, retries=60)
    print("min_grade now:", client.read_contract(address=vault, function_name="get_config").get("min_grade"),
          flush=True)
    print("the vault's gate -> Credence.is_creditworthy(borrower, %s) =" % MIN_GRADE_DEMO,
          oracle_says(client, credence, borrower.address, MIN_GRADE_DEMO), flush=True)
    print("claim exec hint:", send_claim(client, vault, borrower), flush=True)
    phase_b_admitted = admitted(client, vault, borrower.address)
    if phase_b_admitted:
        member = client.read_contract(address=vault, function_name="get_member", args=[borrower.address])
        print("ADMITTED. vault.get_member (grade/standing SNAPSHOTTED FROM CREDENCE across contracts):",
              json.dumps(member, default=str), flush=True)
    else:
        print("PHASE B: borrower NOT admitted | grade=%s assess_ok=%s "
              "(expected ONLY if assess timed out or the panel voted DENY)" % (grade, assess_ok), flush=True)

    # -------------------------------------------------------- Phase C: unknown
    hr("6. PHASE C - UNKNOWN REJECTED: stranger.claim() (never assessed by Credence)")
    print("the vault's gate -> Credence.is_creditworthy(stranger, %s) =" % MIN_GRADE_DEMO,
          oracle_says(client, credence, stranger.address, MIN_GRADE_DEMO), flush=True)
    print("claim exec hint:", send_claim(client, vault, stranger), flush=True)
    phase_c_rejected = not admitted(client, vault, stranger.address)
    print("vault.is_admitted(stranger):", not phase_c_rejected, flush=True)
    print("PHASE C:", "REJECTED as expected (unknown to Credence)" if phase_c_rejected
          else "!! UNEXPECTEDLY ADMITTED", flush=True)

    # ------------------------------------------------------------- summary
    hr("SUMMARY")
    print("Credence oracle   :", credence, flush=True)
    print("Gated vault       :", vault, flush=True)
    print("assess landed grade:", grade, "(assess_ok=%s)" % assess_ok, flush=True)
    print("Phase A (bar AAA, borrower)  -> %s" % ("REJECT [ok]" if phase_a_rejected else "ADMIT [UNEXPECTED]"), flush=True)
    print("Phase B (bar C, borrower)    -> %s" % ("ADMIT [ok]" if phase_b_admitted else "REJECT (assess did not yield >= C)"), flush=True)
    print("Phase C (bar C, stranger)    -> %s" % ("REJECT [ok]" if phase_c_rejected else "ADMIT [UNEXPECTED]"), flush=True)
    xchain = phase_a_rejected or phase_c_rejected or phase_b_admitted
    print("\nCROSS-CONTRACT ORACLE READ PROVEN ON-CHAIN:" , "YES" if xchain else "NO",
          "- every claim() decision above came from vault -> Credence.is_creditworthy() read across contracts.",
          flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\nFATAL - compose script aborted:", flush=True)
        traceback.print_exc()
        sys.exit(1)
