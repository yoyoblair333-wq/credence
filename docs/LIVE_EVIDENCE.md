# Credence - Live On-Chain Evidence (GenLayer studionet, chain 61999)

Credence has been deployed and exercised end-to-end on GenLayer **studionet** (the hosted
Studio network, chain id 61999, `https://studio.genlayer.com/api`) multiple times during
development, fully non-interactively (throwaway in-memory keys, free `sim_fundAccount`, no
captcha, no real funds). Studionet is a **shared, periodically-reset sandbox, so the
addresses below are ephemeral** - re-run the scripts in `scripts/` (and the runbook in
`DEPLOY.md`) to reproduce fresh. The **persistent, points-grade deployment target is
Bradbury** (chain 4221), which is pending a faucet captcha and is NOT represented here.

Every item below is real output captured from a live run; nothing is fabricated.

## 0. v2.0.0: steward attack replayed live (2026-11-12)

Contract **`0x0e0fc114ed62881740b9Be8b5ee8d39671A4c68b`** (v2.0.0, `get_config().version`):
- `ownership_challenge(borrower)` returned the rotating token
  `credence-verify=4fb9200f364b1c0652094316ff1e6489` and path `/.well-known/credence-verify.txt`.
- `fund` (payable): pool cash 500 GEN, `share_index` 1e18.
- `request_credit` with ONLY a URL that echoes the borrower's address in its query string
  (the steward's "displaying an address" attack), then consensus `assess`
  `0x573bbd7a73137711c6b8fc414006c6b005feec055492a6f67b3edd32e6cc2d4f`:
  **`ownership_proven = false`, `credit_limit = 0`, grade `DENY`**.
- `draw(1 GEN)` `0x2d1e94db701f8a3ab71be411e3e5ea883aac60fa498bee019be7d349a8187700`:
  **rolled back**; pool cash still 500 GEN, `outstanding_principal` 0.

## 1. Core: deploy + payable fund + consensus assess (2026-11-03)

Full core run (`scripts/` / scratchpad `credence_fullrun.py`), contract
`0x8D9F4365b39bD2646d18e6ceCc9758344605f9ED`:
- deploy tx          `0xf04793b74f63a7f68405757db04ea5d5b3b8463cc343447b4545eca1551cef6a`
- set_interest_bps   `0xcb924590290678ac14465a66366c6faef152b04037d164551667c59756e695a9`
- fund (payable)     `0xfc31758f02667c43b67797b6dec5a24966d360d7d13195895904347bf2e236b9`  (pool cash 1000 GEN)
- request_credit     `0x7ae486bb71a01ff28fe629892cbda7adca0365ad35fa128cb4c90d999768ae6e`
- assess (consensus) `0x4c1de4514b5a00f667b85ca8ca274e3957af62b7258a3c7a229df12ee8c1d502`

Result: the live 3-persona LLM panel returned a **unanimous DENY** on strong-but-
UNVERIFIABLE self-reported text evidence (`grade_votes = [DENY, DENY, DENY]`). This is the
**fail-safe working in production**: the panel refuses undercollateralized credit on
evidence it cannot verify, and the strict-majority rule lands on the safe default. A prior
identical run reproduced the same outcome (contract
`0x842B0320bc44a910F9F7b7b9CE0485D831F91CD9`, assess
`0x0a2dc2efb119cdd55bdcd0faeb6db6ff6785f38b6da357bae3136e750809eb96`).

An earlier run with a live `web.render` fetch of a real URL also returned DENY and stored
the fetched page excerpt on-chain (contract `0x2139545D4D38dEdd9ade1Eb157821BEff4e8115c`,
assess `0x29e46ba36dfb4880064a027f9f50da308a04ca7a2c057a43535866c8a8e36119`) - see DEPLOY.md.

## 2. Approve path + composability (see COMPOSABILITY.md)

The `scripts/compose_studio.py` run deployed Credence + `CredenceGatedVault` and the live
panel **APPROVED a borrower at grade C**; the vault then **admitted** that creditworthy
borrower by reading Credence's `credit_of` **across contracts**, and rejected both an
above-bar (AAA) request and an unknown stranger. (Credence `0xAfD90b5E0070a5F067E3848eD7aE448F1E9a849E`,
Vault `0xB9Ff85656f487FBF8530886dfFf8dCa47f1eB0f5`.) This is the live proof of both the
approve path and judgment-as-a-service composition.

## 3. On-chain M-of-N governance (see GOVERNANCE.md)

`scripts/governance_studio.py`: ownership of Credence was handed to a 2-of-2
`CredenceGovernor` multisig, which then executed `set_risk_limits(8000)` across contracts
via quorum (Credence `max_utilization_bps` changed 10000 -> 8000, read back from state);
a non-signer propose and an under-threshold execute were both correctly blocked.
(Credence `0x0c91eDa7aA6B1E758feFE863B3461187eE1E9276`, Governor
`0x57E576BF5e3e9e5d2C2dE2ce7Ac60c173C572B14`.)

## 4. Soulbound passport (see PASSPORT.md)

`scripts/passport_studio.py`: a holder **minted** a `CredencePassport` by reading their
Credence standing across contracts; `refresh` updated it; a non-assessed address was
rejected. (Credence `0xc6d3d67f6cA9F9b69F9E24a72B1e2F87C0aE415e`, Passport
`0x657CE66ffcAeBf26E98771b1C62d374E6c622EC5`.)

## What is proven live vs in tests

- **Live on studionet:** deployment of all four contracts; payable `fund`; real
  consensus `assess` (both a correct DENY on unverifiable evidence and an APPROVE at
  grade C); live `web.render` evidence fetch under consensus; cross-contract oracle
  consumption (gated vault + passport); M-of-N governance executing a param change.
- **Proven in the 70-test direct-mode suite (panel mocked for determinism):** the full
  economic loop (draw/repay/claim, fees + interest split to lenders), the appeal ladder,
  multimodal vision path, identity cap, delinquency/default from the clock, utilization
  buffer, and value-conservation under randomized fuzzing.
- **Not yet done:** a persistent Bradbury (chain 4221) deployment with a public tx hash +
  external usage - the remaining evidence step for a top steward score; blocked on a
  faucet captcha.

GenLayer referral JTR01FHP   #CreditWithoutCollateral
