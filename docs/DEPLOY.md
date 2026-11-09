# Deploying & Exercising Credence on a Real Network (Non-Interactive)

**Status: WORKING.** Credence can be deployed and driven end-to-end on GenLayer
**studionet** (chain `61999`, hosted Studio simulator at `https://studio.genlayer.com/api`)
**fully non-interactively, for free, with no captcha and no real funds.** This was
proven on this Windows machine on 2026-11-03 (evidence at the bottom).

The clean path is a short **Python script using `genlayer_py`** run with the existing
venv's `python.exe`. The Node `genlayer` CLI also works but is less suited to headless
use (see "Why not the CLI" below).

---

## 1. The account & funding model for studionet (the key enabler)

- **studionet is a hosted GenLayer Studio simulator.** In `genlayer_py` 0.16.3,
  `studionet.id == localnet.id == 61999`. Studio-based chains expose the Studio RPC,
  including the **`sim_fundAccount`** method.
- **New accounts start at 0 GEN.** There is **no on-chain gas market and no faucet
  captcha** on Studio: you simply mint test GEN to any address by calling
  `sim_fundAccount(address, amount)`. Confirmed working against the public
  `https://studio.genlayer.com/api` endpoint.
- Because `studionet.id == localnet.id`, `genlayer_py`'s `client.fund_account(...)`,
  `client.get_contract_schema(...)` and `client.simulate_write_contract(...)` — all of
  which are internally guarded with `if chain.id != localnet.id: raise` — **work against
  studionet too.**
- **A throwaway deployer needs no seed phrase and is never persisted.**
  `genlayer_py.create_account()` generates a random in-memory key (`eth_account`).
  We fund it on Studio and discard it when the process exits.
- **LLM / web providers are server-side.** Studio runs the validators (default 5) and
  provides the LLM (`gl.nondet.exec_prompt`) and web (`gl.nondet.web.render`) backends.
  No provider keys are configured locally. The only env/config needed is the RPC URL
  (`https://studio.genlayer.com/api`) and chain id `61999`, both built into
  `genlayer_py.chains.studionet`.

> Note: Studio is a shared sandbox and is periodically reset, so a deployed address is
> ephemeral — re-run the script to get a fresh deployment. Nothing here touches real
> value or the user's real `a2a-deployer` / Bradbury account.

---

## 2. Prerequisites (already present on this machine)

- venv Python with `genlayer_py==0.16.3`:
  `python`
- Contract source:
  `contracts/credence.py`
  (first line must keep its `# { "Depends": "py-genlayer:..." }` pragma — Studio uses it
  to select the runtime).

No Docker, no local node, no network config changes required.

---

## 3. Reproducible runbook (copy-paste)

Save the script below as e.g. `deploy_studio.py` **anywhere outside the contract folder**,
then run it with the venv python in isolated mode:

```powershell
& "python" -I "<path>\deploy_studio.py"
```

```python
"""Deploy + exercise Credence on GenLayer studionet (chain 61999), non-interactively.
Throwaway account is random/in-memory (no seed phrase, never persisted).
Studio funds it for free via sim_fundAccount (no captcha, no real funds)."""
import json, sys
from genlayer_py import create_client, create_account
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionStatus

CONTRACT_PATH = "contracts/credence.py"

with open(CONTRACT_PATH, "r", encoding="utf-8") as fh:
    code = fh.read()

# (a) fresh throwaway deployer — random key, in memory only
acct = create_account()
print("deployer:", acct.address, flush=True)

client = create_client(chain=studionet, account=acct)   # RPC + chain id baked in

# (b) fund it on Studio for free (works because studionet.id == localnet.id == 61999)
client.fund_account(acct.address, 1000 * 10**18)
print("balance:", client.get_balance(acct.address), flush=True)

# (c) deploy (constructor relayer/dev default to the deployer)
dep_tx = client.deploy_contract(code=code, kwargs={"relayer": "", "dev": ""})
receipt = client.wait_for_transaction_receipt(
    transaction_hash=dep_tx, status=TransactionStatus.ACCEPTED, interval=3000, retries=80)
addr = receipt.get("data", {}).get("contract_address") \
    or receipt.get("tx_data_decoded", {}).get("contract_address")
print("CONTRACT:", addr, flush=True)

# schema (methods) — available on Studio
print("methods:", sorted(client.get_contract_schema(addr)["methods"].keys()), flush=True)

# (d) VIEW
print("get_config:", json.dumps(client.read_contract(address=addr, function_name="get_config"), default=str), flush=True)

# (e) WRITE: request_credit(purpose, requested_tokens, evidence_json="")
w_tx = client.write_contract(address=addr, function_name="request_credit",
    args=["Working capital for an autonomous trading agent", 100, ""])
client.wait_for_transaction_receipt(transaction_hash=w_tx,
    status=TransactionStatus.ACCEPTED, interval=3000, retries=60)

# verify stored borrower
print("borrower:", json.dumps(client.read_contract(address=addr,
    function_name="get_borrower", args=[acct.address]), default=str), flush=True)
```

### Calling the AI underwriting panel (`assess`)
`request_credit` is pure validation (no LLM) and is proven below. To exercise the
consensus LLM panel, add after the borrower is in `assessing`:

```python
a_tx = client.write_contract(address=addr, function_name="assess", args=[acct.address])
client.wait_for_transaction_receipt(transaction_hash=a_tx,
    status=TransactionStatus.ACCEPTED, interval=5000, retries=120)   # LLM: allow more time
print(client.read_contract(address=addr, function_name="get_borrower", args=[acct.address]))
```

`assess` runs 3 underwriter prompts + any URL `web.render` across the Studio validators,
so it is slower and subject to Studio's shared LLM capacity; give it a generous timeout.
(Not required for "deploy + view + write" functional proof.)

---

## 4. Why not the Node `genlayer` CLI for headless use

The CLI (`genlayer` v0.40.0-rc.5, installed globally via npm,
run via `node`) **does** have
`deploy`, `call`, `write`, `account`, `network`, `schema` subcommands and it works. But:

- `deploy`/`write` sign with the **active keystore account** and expose **no `--network`
  flag** (only `--rpc`), so driving studionet means mutating global config
  (`genlayer network set studionet`) and juggling the active account — invasive on a
  machine whose default is `testnet-bradbury` / `a2a-deployer`.
- It has **no `sim_fundAccount` command**, so a fresh keystore account on Studio stays at
  0 GEN unless you fund it out-of-band (exactly the RPC the Python path calls directly).
- Keystore unlock can prompt interactively.

CLI commands that *are* useful non-interactively (for reference):
```
genlayer account create --name <n> --password <pw> --no-set-active
genlayer account show --account <n> --network studionet      # read-only balance check
genlayer call  <addr> get_config  --rpc https://studio.genlayer.com/api
genlayer deploy --contract <path> --args ...                 # uses active acct + current network
```
Net: the `genlayer_py` script is the right non-interactive tool here; the CLI is fine for
manual/one-off interaction.

---

## 5. Fully-local alternative (localnet) — BLOCKED on this machine

The closest fully-local option is the **GenLayer Studio localnet simulator**
(`http://127.0.0.1:4000/api`), launched with `genlayer up` / `genlayer localnet`.
**It requires Docker** (the CLI drives it via `dockerode` / `docker-compose.yml`).
**Docker is not installed on this machine** (`docker` is an unrecognized command), so
localnet cannot be started here without installing Docker Desktop first. Since studionet
already provides a free, captcha-free, server-provisioned LLM/web environment, **studionet
is the recommended target** and no local install is needed.

---

## 6. Evidence (real output, 2026-11-03)

Deployed the on-disk `credence.py` (48,030 bytes) unmodified:

```
deployer: 0x493BD12f66DABE9d12dE12A185ed382ce4d17707
sim_fundAccount tx: 09392428e5607cce26746cb278e6180d0e1bf414784e58bd5dd00ea234d61424
balance: 1000000000000000000000
deploy tx id: 0x8a506957ed2d9b1d73eda767dc577b61047f45b50d1c73bfd47da74fd7741f22
deploy status: 5 (FINALIZED/decided)
DEPLOYED CONTRACT ADDRESS: 0x2139545D4D38dEdd9ade1Eb157821BEff4e8115c
schema methods: accept_ownership, assess, available_credit, claim_yield, credit_of,
  defund, draw, fund, get_borrower, get_config, get_pool, is_creditworthy, lender_balance,
  page_borrowers, pending_yield, repay, request_credit, roster_size, service_book,
  set_autonomous, set_dev, set_paused, set_relayer, set_terms, stats, transfer_ownership,
  withdraw_fees
get_config -> owner/relayer/dev = deployer, paused=false, panel_size=3,
  grades=[DENY,C,B,A,AA,AAA], origination_bps_by_grade={C:400,B:300,A:200,AA:150,AAA:100},
  lender_share_bps=5000, unowned_grade_cap=C
get_pool -> all zeros (fresh pool)
request_credit tx id: 0xeef91b5dc9076b5f85d7b783652c06400b799f9f1e9b8f240e9f3c09610e96f8  (status 5)
get_borrower -> status="assessing", purpose="Working capital for an autonomous trading agent",
  requested="100000000000000000000" (100 GEN), standing=50, grade=""
```

`status: 5` = a decided/finalized consensus state (`wait_for_transaction_receipt` returns
on ACCEPTED-or-decided). Views (`get_config`, `get_pool`, `get_borrower`) and the write
(`request_credit`) all succeeded against the live deployed address.

**No real funds spent, no captcha, no seed phrase, user's global CLI config (network
`testnet-bradbury`, active account `a2a-deployer`) left unchanged.**

---

## 7. Live `assess` evidence (full consensus panel, 2026-11-03)

A second run exercised the FULL flagship path on studionet, including the AI
underwriting consensus panel (not just deploy + write):

```
contract:   0xD378110A7908F9c4d46802738Bb5eaacc0ECF728
request_credit: evidence = [text income claim, url https://example.com]
assess tx:  0x29e46ba36dfb4880064a027f9f50da308a04ca7a2c057a43535866c8a8e36119
result:     status=denied, grade=DENY, grade_votes=[DENY,DENY,DENY], ownership_proven=false
```

The contract fetched `https://example.com` LIVE via `gl.nondet.web.render` during
judgment (the stored `fetched_excerpt` contains the real page text, including its
Arabic paragraph), the 3-persona LLM panel ran across Studio's validators and reached
unanimous consensus, and - correctly - DENIED credit because a generic documentation
page is not evidence of creditworthiness. This demonstrates, on a live network:
web-under-consensus, the real LLM underwriting panel, and the fail-closed safe default.
An earlier run also proved the payable `fund` path (pool cash 500 GEN) and
`request_credit` on a fresh deploy.
