#!/usr/bin/env python3
"""
deploy_studio.py - deploy CreditPassport to GenLayer studionet, issue one passport and
read it back.

    python primitives/credit_passport/deploy_studio.py [--contract 0x...]
                                                       [--out primitives/credit_passport/live_run.json]

Steps: deploy (deployer = owner) -> add_issuer(issuer) -> issuer.issue(holder, "A", 72,
false, memo) -> read passport_of / grade_of / tier_at_least -> a non-issuer tries to
issue (must revert; state is re-read to prove nothing changed).

Throwaway in-memory keys, funded for free on studionet (sim_fundAccount). Reports
exactly what the chain returned; nothing is faked.
"""

import argparse
import json
import os
import sys
import time

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionStatus as S

HERE = os.path.dirname(os.path.abspath(__file__))
WEI = 10**18
EXPLORER = "https://explorer-studio.genlayer.com"


def hexs(tx):
    h = tx.hex() if hasattr(tx, "hex") else str(tx)
    return h if h.startswith("0x") else "0x" + h


def submit(send, attempts=5):
    for i in range(attempts):
        try:
            return send()
        except Exception as e:  # Studio sometimes answers 502 on submission
            if i == attempts - 1:
                raise
            print(f"  submit failed ({str(e)[:100]}); retrying in 10s", flush=True)
            time.sleep(10)


def finalize(client, tx, label):
    tx = hexs(tx)
    client.wait_for_transaction_receipt(transaction_hash=tx, status=S.FINALIZED, interval=5000, retries=180)
    t = client.get_transaction(tx)
    votes = sorted((t.get("consensus_data") or {}).get("votes", {}).values())
    lr = (t.get("consensus_data") or {}).get("leader_receipt")
    lr = lr[0] if isinstance(lr, list) and lr else lr
    lr = lr if isinstance(lr, dict) else {}
    res = lr.get("result") if isinstance(lr.get("result"), dict) else {}
    step = {"step": label, "tx": tx, "status": t.get("status_name"), "result": t.get("result_name"),
            "execution": lr.get("execution_result"), "votes": votes}
    if res.get("status") == "rollback":
        step["revert"] = res.get("payload")
    print(f"{label}: {tx} {step['status']} {step['result']} exec={step['execution']} votes={votes}", flush=True)
    return step


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contract", help="reuse an existing CreditPassport (the throwaway deployer must own it)")
    ap.add_argument("--out", default=os.path.join(HERE, "live_run.json"))
    a = ap.parse_args()

    owner, issuer, holder, stranger = (create_account() for _ in range(4))
    co = create_client(chain=studionet, account=owner)
    ci = create_client(chain=studionet, account=issuer)
    cs = create_client(chain=studionet, account=stranger)
    for acct in (owner, issuer, stranger):
        co.fund_account(acct.address, 10 * WEI)
    log = {"network": "studionet (chain 61999, https://studio.genlayer.com/api)",
           "owner": owner.address, "issuer": issuer.address, "holder": holder.address,
           "stranger": stranger.address, "steps": []}

    addr = a.contract
    if not addr:
        with open(os.path.join(HERE, "credit_passport.py"), "r", encoding="utf-8") as fh:
            tx = submit(lambda: co.deploy_contract(code=fh.read(), args=[]))
        r = co.wait_for_transaction_receipt(transaction_hash=tx, status=S.ACCEPTED, interval=3000, retries=100)
        addr = (r.get("data") or {}).get("contract_address") or (r.get("tx_data_decoded") or {}).get("contract_address")
        step = finalize(co, tx, "deploy CreditPassport")
        step["contract"] = addr
        log["steps"].append(step)
    log["contract"] = addr
    log["explorer"] = f"{EXPLORER}/address/{addr}"
    print(f"contract {addr}", flush=True)

    log["steps"].append(finalize(co, submit(lambda: co.write_contract(
        address=addr, function_name="add_issuer", args=[issuer.address])), "owner add_issuer(issuer)"))
    log["steps"].append(finalize(ci, submit(lambda: ci.write_contract(
        address=addr, function_name="issue",
        args=[holder.address, "A", 72, False, "demo: 12 on-time repayments"])), "issuer issue(holder, A, 72)"))

    read = lambda fn, args: co.read_contract(address=addr, function_name=fn, args=args)
    log["passport_of_holder"] = read("passport_of", [holder.address])
    log["grade_of_holder"] = read("grade_of", [holder.address])
    log["tier_at_least_holder_A"] = read("tier_at_least", [holder.address, "A"])
    log["tier_at_least_holder_AA"] = read("tier_at_least", [holder.address, "AA"])
    print("passport_of(holder):", json.dumps(log["passport_of_holder"]), flush=True)
    print("grade_of:", log["grade_of_holder"], "tier>=A:", log["tier_at_least_holder_A"],
          "tier>=AA:", log["tier_at_least_holder_AA"], flush=True)

    log["steps"].append(finalize(cs, submit(lambda: cs.write_contract(
        address=addr, function_name="issue", args=[stranger.address, "AAA", 100, False, ""])),
        "stranger issue(self, AAA) - must revert"))
    log["stranger_has_passport_after"] = read("has_passport", [stranger.address])
    log["config"] = read("get_config", [])
    print("stranger has passport after attempt:", log["stranger_has_passport_after"], flush=True)

    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=2, default=str)
    print(f"wrote {a.out}", flush=True)
    ok = (log["passport_of_holder"].get("grade") == "A" and log["tier_at_least_holder_A"] is True
          and log["stranger_has_passport_after"] is False)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
