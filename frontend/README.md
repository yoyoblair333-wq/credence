# Credence — frontend dApp

**Undercollateralized credit, underwritten by on-chain AI consensus. No collateral, no bank, no committee.**

A Next.js frontend for the **Credence** GenLayer Intelligent Contract
(`credence.py`, class `Credence`). A borrower — a human or an autonomous agent —
submits their own public evidence of creditworthiness. An on-chain panel of AI
underwriters then does something no other blockchain can: during consensus
**each validator independently fetches that live evidence off the web**
(`gl.nondet.web.render`), judges it (`gl.nondet.exec_prompt`), and must agree on
a bounded **credit grade** before a single token moves. The contract extends an
undercollateralized line, remembers every borrower and outcome, and services the
loan book itself.

This app is adapted from GenLayer's official project boilerplate and mirrors its
stack and patterns: **Next.js 16 + React 19 + TypeScript, Tailwind CSS v4, Radix
UI, TanStack Query, viem/wagmi, MetaMask, and the `genlayer-js` SDK** — the same
stack as the verified JusticeUpgrade frontend.

---

## What the app does

The UI drives every callable method on the contract:

| UI flow | Contract method | Kind |
| --- | --- | --- |
| Connect wallet (MetaMask + GenLayer network) | — | — |
| **Apply for credit** (purpose, requested tokens, evidence) | `request_credit(purpose, requested_tokens, evidence_json)` | write |
| **Run the underwriting panel** | `assess(borrower)` | write (consensus LLM) |
| **Draw** against an approved line | `draw(amount)` *(base units)* | write |
| **Repay** | `repay()` *(payable)* | write |
| **Fund** the lending pool | `fund()` *(payable)* | write |
| **Service the loan book** | `service_book(max_items)` | write |
| Withdraw protocol revenue | `withdraw_fees(to, amount)` | write (owner) |
| Admin | `set_paused` / `set_autonomous` / `set_terms` / `set_relayer` / `set_dev` / `transfer_ownership` | write |
| **Dashboard** (standing, grade, line, loan) | `get_borrower(addr)` / `available_credit(addr)` | view |
| **Pool view** | `get_pool()` | view |
| **Stats strip** | `stats()` | view |
| Grade ladder & terms | `get_config()` / `roster_size()` | view |

### Credit grades → line (whole tokens)

`DENY → 0`, `C → 100`, `B → 250`, `A → 500`, `AA → 1000`, `AAA → 2500`.
The binding grade is the **strongest grade a strict majority of the panel will
back**; a split panel lands on the lender-safe floor, and anything malformed or
any disagreement fails closed to `DENY`.

### Money / units

`1 token = 1e18 base units`. The contract returns native amounts as base-unit
integer **strings** (JS numbers can't hold `1e18` safely); the UI formats them
for display with exact bigint arithmetic. Amounts sent **into** the contract
(`draw` amount, `repay` / `fund` value, `withdraw_fees` amount) are base-unit
integers passed as **bigint**. `request_credit`'s `requested_tokens` is a
whole-token integer (≤ 2500).

### Evidence

`evidence_json` is a JSON string of an array of
`{kind:"text"|"url", label, content}`, up to **8** items. The client mirrors the
contract's validation before spending a transaction: `https`-only URLs, char
limits (`label ≤ 120`, text `content ≤ 1200`, url `content ≤ 300`,
`purpose ≤ 400`). The contract adds the `sha256` commitment and the live
`fetched_excerpt` / `fetched_sha256` on-chain during `assess`; the UI surfaces
both in the assessment result.

---

## Preview mode (graceful degradation)

The frontend reads the deployed address from
`NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS` (falling back to the legacy
`NEXT_PUBLIC_CONTRACT_ADDRESS`).

> **No address set?** The app stays **fully up** in a read-only
> **demo/preview** mode: every panel shows representative sample data, the apply
> flow simulates a consensus assessment locally, and a clear banner makes the
> preview status unmistakable. Nothing touches a chain and no value moves — the
> whole product is explorable before deployment. Do not invent an address.

Only a well-formed `0x…` 40-hex address counts as configured; a placeholder or
empty value degrades to preview mode. Live writes additionally require a
connected wallet.

---

## Configure

```bash
cp .env.example .env
# once deployed:
# NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS=0xYourDeployedContractAddress
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://studio.genlayer.com/api` | GenLayer RPC endpoint |
| `NEXT_PUBLIC_GENLAYER_CHAIN_ID` | `61999` | GenLayer chain ID (MetaMask network) |
| `NEXT_PUBLIC_GENLAYER_CHAIN_NAME` | `GenLayer Studio` | Network name shown in MetaMask |
| `NEXT_PUBLIC_GENLAYER_SYMBOL` | `GEN` | Native currency symbol |
| `NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS` | _(empty — preview mode)_ | Deployed Credence address |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | _(empty)_ | Legacy/fallback address |

---

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # type-check with tsc --noEmit
```

Open the app, connect MetaMask (it will prompt to add/switch to the GenLayer
network), and use the flows: **Apply → Assessment → Dashboard → Pool**.

---

## How it talks to GenLayer

All contract access goes through `genlayer-js`, following the boilerplate's
`FootballBets.ts` / `JusticeUpgrade.ts` pattern. The binding lives in
`lib/contracts/Credence.ts`:

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const client = createClient({ chain: studionet, account, endpoint });

// view (dict → Map, recursively normalized to a plain typed object)
const pool = await client.readContract({ address, functionName: "get_pool", args: [] });

// write (assess is the consensus-LLM call; fees via the shared presets)
const txHash = await client.writeContract({
  address, functionName: "assess", args: [borrower], value: 0n, fees,
});
await client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED" });
```

- **Views** return a `dict`, decoded by `genlayer-js` as a `Map`; a `normalize()`
  helper converts it (recursively) to a plain typed object and coerces small
  count/epoch bigints to numbers (never base-unit money, which stays a string).
- **`assess`** is the slow, LLM-backed consensus write (longer receipt timeout,
  fees estimated via `lib/genlayer/fees.ts`); the assessment is read back from
  on-chain storage with `get_borrower` rather than parsed out of the receipt.
- React Query hooks in `lib/hooks/useCredence.ts` wrap these calls, fall back to
  mock data in preview mode, and invalidate the relevant queries after a write.

---

## Project structure

```
credence/frontend/
├── app/
│   ├── globals.css        # GenLayer brand theme (Tailwind v4) — reused from boilerplate
│   ├── layout.tsx         # Root layout + Credence metadata
│   ├── page.tsx           # Single-page app: hero + apply/assess/dashboard/pool
│   └── providers.tsx      # QueryClient + WalletProvider + Toaster
├── components/
│   ├── AccountPanel.tsx         # MetaMask connect/switch/disconnect (adapted)
│   ├── AddressDisplay.tsx       # reused from boilerplate
│   ├── ApplyForm.tsx            # request_credit + assess, with live JSON preview
│   ├── AssessmentResult.tsx     # grade + per-underwriter votes + rationale + evidence
│   ├── ConsensusExplainer.tsx   # "how consensus underwriting works"
│   ├── ContractBanner.tsx       # preview-mode banner
│   ├── CredenceLogo.tsx         # Credence brand mark
│   ├── Dashboard.tsx            # get_borrower + draw/repay controls
│   ├── EvidenceInput.tsx        # evidence editor → evidence_json
│   ├── GradeBadge.tsx           # shared grade pill (DENY…AAA)
│   ├── Navbar.tsx               # glassy navbar (adapted)
│   ├── PoolView.tsx             # get_pool + fund action
│   ├── StatsStrip.tsx           # stats() + grade ladder
│   └── ui/                      # Radix + Tailwind primitives (reused)
├── lib/
│   ├── contracts/
│   │   ├── Credence.ts          # genlayer-js contract binding
│   │   ├── types.ts             # Borrower / Pool / Stats / Config types
│   │   └── mock.ts              # preview-mode fixtures + local assessment sim
│   ├── genlayer/                # client, wallet, fees (reused from boilerplate)
│   ├── hooks/useCredence.ts
│   └── utils/                   # cn, toast, money/format helpers
├── .env.example
├── package.json
└── ...config (tsconfig, next.config, tailwind.config, postcss, components.json)
```

---

## Notes & assumptions

- Chain ID `61999` and the Studio RPC are the boilerplate defaults; change them
  in `.env` for a different GenLayer network.
- `assess` is permissionless (a keeper, the borrower, or staff may trigger it);
  the decision is the panel's, not the caller's. `draw` requires an approved
  line and sufficient pool liquidity; `repay` rejects overpayment; `fund` and
  `repay` are payable.
- Preview mode's local assessment is a legible stand-in, **not** the real
  underwriting model, and it never lends real value. The live panel's grade is
  authoritative and read back from `get_borrower`.

---

**GenLayer builder referral: `JTR01FHP`**

Powered by [GenLayer](https://genlayer.com) — the Adjudication Layer for the
Agentic Economy.
