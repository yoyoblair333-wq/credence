"""Deploy Credence to the GenLayer BRADBURY testnet (chain 4221) and capture real tx
hashes for the portal milestone (evidence link 11).

WHY THIS SCRIPT EXISTS
----------------------
studionet runs already proved the whole system live (docs/LIVE_EVIDENCE.md), but
studionet is an ephemeral, periodically-reset sandbox. The GenLayer stewards score on a
PERSISTENT Bradbury deployment with a public tx hash. Bradbury has a real gas market, so
the deployer account must be funded at the faucet first -- that faucet has a captcha, which
is the one human step only Blair can do.

SAFETY
------
- The deployer is a FRESH, throwaway key generated in memory (genlayer_py.create_account()).
  It is NOT Blair's wallet and carries NO seed phrase. Re-running makes a new one.
- Nothing here touches real value. Bradbury GEN is free testnet gas from the faucet.
- For resumability the throwaway private key is printed ONCE and can be re-supplied via the
  DEPLOYER_KEY env var so a re-run reuses the SAME funded address (avoids re-funding).

HOW TO RUN (on the Windows machine, from the credence repo root)
----------------------------------------------------------------
    & "python" -I scripts\\deploy_bradbury.py

Then:
  1. The script prints a deployer ADDRESS and pauses.
  2. Go to the Bradbury faucet ( testnet-faucet.genlayer.foundation ), paste the address,
     solve the captcha, send. (A single faucet drip covers the deploy + sample txs.)
  3. Come back and press Enter. The script waits for the balance, deploys, runs a sample
     lifecycle, and writes docs/LIVE_EVIDENCE_BRADBURY.txt with the real addresses + tx
     hashes (paste-ready for the portal form evidence link 11).

Add --assess to also exercise the live 3-persona consensus panel (slower; costs more gas).
"""
import os, sys, json, time, argparse
from pathlib import Path

from genlayer_py import create_client, create_account
from genlayer_py.chains import testnet_bradbury
from genlayer_py.types import TransactionStatus
from eth_account import Account as _EthAccount

REPO_ROOT = Path(__file__).resolve().parent.parent
CORE = REPO_ROOT / "contracts" / "credence.py"
OUT = REPO_ROOT / "docs" / "LIVE_EVIDENCE_BRADBURY.txt"

EXPLORER = "https://explorer-bradbury.genlayer.com"  # adjust if the stewards use a different explorer host


def tx_link(txid: str) -> str:
    return f"{EXPLORER}/tx/{txid}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assess", action="store_true",
                    help="also run the live consensus underwriting panel (slower, more gas)")
    ap.add_argument("--min-gen", type=float, default=0.05,
                    help="minimum GEN balance to proceed after funding (default 0.05)")
    args = ap.parse_args()

    code = CORE.read_text(encoding="utf-8")
    assert code.lstrip().startswith("#"), "credence.py must keep its first-line Depends pragma"

    # (a) throwaway deployer -- reuse via DEPLOYER_KEY to avoid re-funding on a re-run
    key = os.environ.get("DEPLOYER_KEY")
    if key:
        acct = create_account(account_private_key=key)
        print(f"[deployer] reusing address from DEPLOYER_KEY: {acct.address}", flush=True)
    else:
        acct = create_account()
        pk = acct.key.hex() if hasattr(acct, "key") else _EthAccount.from_key(acct._private_key).key.hex()
        print("=" * 70, flush=True)
        print(f"[deployer] NEW throwaway address: {acct.address}", flush=True)
        print(f"[deployer] throwaway private key (testnet only, to resume): {pk}", flush=True)
        print("            (set DEPLOYER_KEY to this value to reuse the funded address)", flush=True)
        print("=" * 70, flush=True)

    client = create_client(chain=testnet_bradbury, account=acct)
    print(f"[network] {testnet_bradbury.name} (chain {testnet_bradbury.id}) "
          f"rpc={testnet_bradbury.rpc_urls['default']['http'][0]}", flush=True)

    # (b) PAUSE for the human faucet step (captcha)
    print("\n>>> FUND THIS ADDRESS AT THE BRADBURY FAUCET, THEN PRESS ENTER <<<", flush=True)
    print(f">>> faucet: testnet-faucet.genlayer.foundation   address: {acct.address}", flush=True)
    try:
        input()
    except EOFError:
        pass

    # (c) wait for the balance to land
    need = int(args.min_gen * 10**18)
    for i in range(60):
        bal = client.get_balance(acct.address)
        print(f"[balance] {bal} wei ({bal/10**18:.4f} GEN)", flush=True)
        if bal >= need:
            break
        time.sleep(5)
    else:
        print("[abort] balance never reached the minimum -- fund the address and re-run "
              "(set DEPLOYER_KEY to the printed key to reuse it).", flush=True)
        return 2

    results = {"network": testnet_bradbury.name, "chain_id": testnet_bradbury.id,
               "deployer": acct.address}

    # (d) DEPLOY core
    print("\n[deploy] credence.py core ...", flush=True)
    dep_tx = client.deploy_contract(code=code, kwargs={"relayer": "", "dev": ""})
    results["deploy_tx"] = str(dep_tx)
    rcpt = client.wait_for_transaction_receipt(
        transaction_hash=dep_tx, status=TransactionStatus.ACCEPTED, interval=4000, retries=90)
    addr = (rcpt.get("data", {}) or {}).get("contract_address") \
        or (rcpt.get("tx_data_decoded", {}) or {}).get("contract_address")
    results["contract_address"] = addr
    print(f"[deploy] OK  contract={addr}  tx={dep_tx}", flush=True)

    # sanity view
    try:
        cfg = client.read_contract(address=addr, function_name="get_config")
        results["get_config_ok"] = True
        print(f"[view] get_config -> {json.dumps(cfg, default=str)[:200]}", flush=True)
    except Exception as e:
        results["get_config_ok"] = False
        print(f"[view] get_config failed: {e}", flush=True)

    # (e) a real state-changing tx (cheap, no LLM)
    print("\n[write] request_credit ...", flush=True)
    w_tx = client.write_contract(
        address=addr, function_name="request_credit",
        args=["Working capital for an autonomous trading agent", 100, ""])
    results["request_credit_tx"] = str(w_tx)
    client.wait_for_transaction_receipt(
        transaction_hash=w_tx, status=TransactionStatus.ACCEPTED, interval=4000, retries=90)
    print(f"[write] request_credit OK  tx={w_tx}", flush=True)

    # (f) optional: live consensus panel
    if args.assess:
        print("\n[assess] running live 3-persona consensus panel (slow) ...", flush=True)
        a_tx = client.write_contract(address=addr, function_name="assess", args=[acct.address])
        results["assess_tx"] = str(a_tx)
        client.wait_for_transaction_receipt(
            transaction_hash=a_tx, status=TransactionStatus.ACCEPTED, interval=5000, retries=180)
        borrower = client.read_contract(address=addr, function_name="get_borrower", args=[acct.address])
        results["assess_outcome"] = json.dumps(borrower, default=str)
        print(f"[assess] OK  tx={a_tx}  outcome={results['assess_outcome'][:200]}", flush=True)

    # (g) write evidence
    lines = [
        "# Credence -- LIVE on GenLayer Bradbury testnet (chain 4221)",
        f"# Captured {time.strftime('%Y-%m-%d %H:%M:%S %Z')}",
        "",
        f"NETWORK={results['network']} (chain {results['chain_id']})",
        f"DEPLOYER={results['deployer']}",
        f"CONTRACT_ADDRESS={results.get('contract_address')}",
        f"DEPLOY_TX={results.get('deploy_tx')}",
        f"DEPLOY_TX_LINK={tx_link(results.get('deploy_tx',''))}",
        f"REQUEST_CREDIT_TX={results.get('request_credit_tx')}",
    ]
    if args.assess:
        lines += [f"ASSESS_TX={results.get('assess_tx')}",
                  f"ASSESS_OUTCOME={results.get('assess_outcome')}"]
    lines += ["", "GenLayer referral JTR01FHP   #CreditWithoutCollateral", ""]
    OUT.write_text("\n".join(lines), encoding="utf-8")

    print("\n" + "=" * 70, flush=True)
    print("DONE. Evidence written to:", OUT, flush=True)
    print("PORTAL evidence link 11 (paste this):", flush=True)
    print("   ", tx_link(results.get("deploy_tx", "")), flush=True)
    print("=" * 70, flush=True)
    print(json.dumps(results, indent=2, default=str), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
