# Credence — Cost, Performance & Finality

**Date:** 2026-11-03
**Target measured:** `contracts/credence.py` (`VERSION = "1.4.0"`), deployed and exercised
live on GenLayer **studionet** (chain `61999`, hosted Studio simulator at
`https://studio.genlayer.com/api`).
**Method:** a single timed, non-interactive run using the `genlayer_py` pattern documented in
[`DEPLOY.md`](DEPLOY.md) — throwaway in-memory key, free `sim_fundAccount` (no captcha, no
real funds). Wall-clock latency for each step was taken from real client output, not
estimated. Script: `scripts`-style driver run with the project venv python
(`…/verdict/contracts/.venv/Scripts/python.exe -I`).

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

> **Honesty note on what is and is not measured.** studionet is a shared, periodically-reset
> sandbox with **no gas market and no fee**, so this document reports **latency only** and
> makes **no claim about fees/gas cost**. Real fee measurement requires the persistent
> **Bradbury** (chain `4221`) deployment, which is pending a faucet captcha and is **not**
> done — so no Bradbury number appears here, invented or otherwise. The write latencies below
> are **wall-clock including the client's receipt-polling interval** (3 s for ordinary writes,
> 5 s for `assess`); they are upper bounds on perceived latency, not pure protocol/consensus
> time. The view latency is a direct RPC read with no polling and is representative.

---

## 1. Measured latency (studionet, 2026-11-03)

Single live run. Deployer `0x149694fF21010B289d133d6700332D952910aB42`; deployed Credence
**`0x528F7b1021F46c1CC2171e337F9FE20cdA69b391`** (ephemeral — studionet resets).

| # | Operation | Kind | Wall-clock | Transaction hash | Result |
|---|-----------|------|-----------:|------------------|--------|
| a | `deploy_contract` (61,158-byte source, unmodified) | deploy | **8.18 s** | `0x814831b6d11ceba0acf7c893eb1a242cb23995b0767117e2778c72e0e58eab4c` | addr `0x528F7b10…9b391` |
| b | `get_config` | view (read) | **1.52 s** | — (read, no tx) | `version = 1.4.0` |
| c | `request_credit("Working capital…", 100, "")` | cheap write (pure validation, **no LLM**) | **10.44 s** | `0xb6af945be6943ad1104483a1db56ffc2fac26e7bab0f044552806a76e824d6c5` | borrower → `assessing` |
| d | `assess(borrower)` | **consensus write (LLM panel)** | **30.39 s** | `0xfb10c286139033daa709400579a39d93e58cd18c85b2a49524af3a1e6c0b0b9e` | `grade=DENY`, votes `[DENY,DENY,DENY]`, `status=denied` |

Supporting: `fund_account` (Studio `sim_fundAccount`, free test GEN) returned in 0.75 s;
post-run balance `2000 × 10¹⁸`.

### Reading the numbers honestly

- **View (b) ≈ 1.5 s** is the only pure latency here — a direct `read_contract` RPC with no
  polling. This is the latency an integrator sees for `credit_of` / `is_creditworthy` /
  `get_pool` (the composable-oracle reads other contracts depend on).
- **Deploy (a) ≈ 8 s** and **cheap write (c) ≈ 10 s** are dominated by waiting for the
  transaction to reach `ACCEPTED`/decided; the client polled at a 3 s interval, so these are
  quantised upward to the nearest poll cycle. `request_credit` does **no** non-deterministic
  work (it is pure input validation + storage), so its ~10 s is consensus-round + poll
  latency, not model latency.
- **`assess` (d) ≈ 30 s** is the flagship slow path and the honest headline: it runs a
  **3-persona LLM underwriter panel inside consensus** (`gl.vm.run_nondet_unsafe`), each
  persona a `gl.nondet.exec_prompt`, with every validator re-running the panel. ~30 s
  wall-clock (polled at 5 s) on Studio's shared LLM capacity is the real cost of
  judgment-under-consensus. It will vary with Studio load and with how much live evidence the
  panel must fetch (`gl.nondet.web.render`); a request carrying `url`/`image` evidence fetches
  live pages per validator and will be slower than this empty-evidence run.
- This run passed **empty evidence** (`evidence_json=""`), so the panel correctly returned a
  **unanimous DENY** — the fail-safe default working in production (no verifiable evidence ⇒
  no undercollateralized credit). This matches the independent runs recorded in
  [`LIVE_EVIDENCE.md`](LIVE_EVIDENCE.md).

**Not measured in this run:** a full APPROVE path end-to-end timing (`fund → assess(approve)
→ draw → repay`), and per-op latency with live `web.render` evidence. `LIVE_EVIDENCE.md`
records separate studionet runs that did reach APPROVE (grade C), funded a payable pool, and
fetched a real URL under consensus; those were not re-timed here and are marked accordingly.

---

## 2. Fee / cost model

### studionet (what was measured) — no fee

studionet is the hosted GenLayer **Studio simulator**. In `genlayer_py` 0.16.3
`studionet.id == localnet.id == 61999`; accounts are funded for free with `sim_fundAccount`
and **there is no on-chain gas market, no fee, and no faucet captcha** (see `DEPLOY.md §1`).
Consequently:

- **No GEN was spent** on any operation above; latency is the only cost signal studionet can
  give.
- **No fee/gas figure can honestly be derived from studionet** and none is stated here.

### Bradbury (chain 4221) — governance-set, **not yet measured**

The persistent, points-grade target is **Bradbury**, where transactions carry a real fee set
by network governance. That deployment is **pending a faucet captcha** and has **not** been
done, so:

- **No Bradbury fee is reported** — measuring it requires the live deploy, which is the one
  remaining evidence step (see `LIVE_EVIDENCE.md`, `AUDIT.md §5.1`).
- The contract is written to keep per-call on-chain work bounded (so fees stay bounded):
  evidence is capped at 8 items / 1 image (`MAX_EVIDENCE_ITEMS`), fetched text is clipped to
  2,400 chars and stored as a ≤600-char excerpt + a sha256 (`MAX_FETCH_CHARS`,
  `MAX_STORED_EXCERPT_CHARS` in `credence.py`), screenshots are stored only as a sha256
  (never raw bytes), `service_book` processes at most `MAX_SERVICE_BATCH = 25` borrowers per
  call, and every roster/registry view is paginated (`MAX_PAGE = 50`). These bounds are the
  design lever on real-network cost; their **fee impact remains unquantified until Bradbury**.

### Protocol-internal economic cost (independent of gas)

Separate from network fees, Credence charges a **risk-priced origination fee** in protocol
tokens, set by the AI grade: `ORIGINATION_BPS_BY_GRADE = {C:400, B:300, A:200, AA:150,
AAA:100}` bps on each draw (riskier grades pay more). Half (default
`lender_share_bps = 5000`) streams to lenders as yield, half is protocol revenue. An optional
time-based APR (`interest_bps`, off by default, ≤ 100 % hard cap) accrues on outstanding
principal. These are **in-protocol economics**, verified by the direct-mode suite
(`test_fee_scales_with_grade`, `test_repay_fee_split_is_conserved`, `TestInterest::*`), and
are unrelated to — and do not substitute for — an unmeasured network gas fee.

---

## 3. Finality mapping — where value actually moves

GenLayer transactions pass through consensus stages; the SDK exposes `ACCEPTED` and
`FINALIZED` as distinct terminal statuses (`genlayer_py.types.TransactionStatus`;
`sdk/src/client.ts` defaults `waitStatus` to `"ACCEPTED"`). Credence is written so that
**contract state can update on acceptance, but native value only ever moves on FINALIZED
timing.** These are deliberately different things.

### 3.1 Contract state vs. network finality

| Transaction | What becomes true at **ACCEPTED / decided** | What waits for **FINALIZED** |
|---|---|---|
| `assess` / `appeal` | The consensus panel ran and the **grade + `credit_limit` are written to storage** (borrower → `approved`/`denied`). **No tokens move.** | — (`assess` moves no value; it only authorises a future line) |
| `draw` | principal/fee bookkeeping updates in storage | the **outgoing token transfer** to the borrower — `gl.get_contract_at(sender).emit_transfer(value=amt, on="finalized")` (`credence.py` draw) |
| `repay` | debt reduced, yield streamed into the accumulator | inbound value is already native (payable); downstream lender payouts are on finalized timing |
| `defund` | lender capital reduced in storage | principal returned — `emit_transfer(..., on="finalized")` |
| `claim_yield` | `yield_claimable[addr]` zeroed | yield paid — `emit_transfer(..., on="finalized")` |
| `withdraw_fees` | `fee_revenue` reduced | revenue paid to `dev` — `emit_transfer(..., on="finalized")` |
| `CredenceGovernor.execute` | proposal flipped to `executed` (checks-effects-interactions) | the governed Credence admin call — `.emit(on="finalized")` |
| `service_book` (autonomous) | delinquency/interest recorded from the clock | the self-heartbeat re-emit — `.emit(on="finalized")` |

**Every outward value transfer and every cross-contract write in the suite is `on="finalized"`.**
This is verifiable in source: `emit_transfer(value=…, on="finalized")` in `draw`, `defund`,
`claim_yield`, and `withdraw_fees`; `.emit(on="finalized")` in `CredenceGovernor._dispatch`
and in the autonomous `service_book` re-emit. `THREAT_MODEL.md §6/§7` states the same:
"All outward transfers … and the autonomy self-emit are `on="finalized"`, so value never
moves on speculative execution."

### 3.2 Why this matters — "assess Accepted" is **not** final

A borrower whose `assess` transaction is **Accepted at grade A** has a `credit_limit` written
in contract state — but **no value has moved and none is guaranteed yet**. The credit line is
an *authorisation to draw*, not a disbursement. Value leaves the lender pool only when the
borrower later submits a `draw`, and even then the tokens are transferred on that draw's
**finalized** `emit_transfer`, not on the draw's acceptance. So:

- **Contract state (the grade/limit) is an acceptance-time fact.** It can be read immediately
  by the oracle (`credit_of`), but it is a *decision*, not a settled transfer.
- **Money movement is a finalized-time fact.** No token leaves the pool, returns to a lender,
  or pays out as yield/revenue except via an `on="finalized"` transfer.

This separation is the safety property: a consensus `assess` that is "Accepted" but could
still be reorganised before finality never results in value having moved, because value
movement is gated behind a *separate, later, finalized* `draw`. The AI grade is contained by
design — a wrong or unstable grade is a wrong *authorisation*, and the money only follows a
distinct finalized transfer the borrower must initiate.

### 3.3 Consensus "agreement" ≠ ground truth ≠ finality — three distinct claims

- **Agreement:** a strict majority of the re-deriving panel backed the grade
  (`validator_fn` re-runs the panel and accepts only if its own strict-majority floor and
  identity cap match the leader's — `credence.py` `_run_panel`). This is *agreement on a
  bounded 6-value grade*, not proof the borrower is creditworthy (`THREAT_MODEL.md §3`).
- **Acceptance:** the transaction reached a decided consensus state; contract storage
  reflects it.
- **Finality:** the stage at which value transfers emitted `on="finalized"` actually settle.

Credence never conflates them: the grade is agreed-and-accepted; the tokens are finalized.

---

## 4. Reproducing these measurements

```powershell
$env:PYTHONIOENCODING="utf-8"; $env:PYTHONUTF8="1"
& "python" -I <timing_script.py>
```

The script (modelled on `DEPLOY.md §3`) creates a throwaway account, funds it via
`sim_fundAccount`, deploys `contracts/credence.py` unmodified, and times `deploy` → `get_config`
→ `request_credit` → `assess`, printing each step's wall-clock and tx hash. Because studionet
resets, re-running yields fresh (different) addresses and tx hashes; the **latencies** are what
reproduce, not the identifiers.

---

*All figures in §1 are real client output from a live studionet run on 2026-11-03; nothing is
estimated or invented. No fee/gas figure is claimed, because studionet has none and Bradbury is
not yet deployed. `#CreditWithoutCollateral` · referral `JTR01FHP`.*
