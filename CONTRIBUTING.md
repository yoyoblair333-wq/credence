# Contributing to Credence

Credence extends **undercollateralized** credit on an AI underwriting decision — it moves
real value it cannot claw back. The contribution bar reflects that: every change ships
**production-grade, re-verified green, and cross-reviewed** before it lands. This guide is
how to run the gates locally so your change passes CI on the first try.

`#CreditWithoutCollateral` · GenLayer referral `JTR01FHP`

---

## The bar

- **Every change is re-verified green.** Lint, typecheck, and the full direct-mode test
  suite must pass locally before you open a PR — the same three gates CI runs.
- **Every change is cross-reviewed.** Substantial contract changes get an adversarial
  second read (a second reviewer or a second model) before merge, with edge cases and
  failure modes called out. Security-relevant changes additionally update
  [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`SECURITY.md`](SECURITY.md).
- **No half-work.** New behavior ships with tests that cover it (happy path **and** the
  revert/fail-closed path), and the docs that describe it are updated in the same PR.
- **Be honest about limits.** State plainly in the PR what is proven by tests vs. assumed,
  and what remains out of scope.

---

## Prerequisites

Credence is written against the GenVM Python SDK and runs under the **real** SDK
in-process in "direct" mode. Use the shared GenLayer venv (Python 3.12+; CI pins 3.12):

```
python
```

That venv provides the toolchain CI installs:

- `genlayer-test` — the real GenVM SDK plus the `pytest` fixtures the suite uses
  (`direct_vm`, `direct_deploy`, `direct_alice`/`direct_bob`/`direct_charlie`).
- `genvm-linter` — the `genvm-lint` CLI (`check` / `typecheck` subcommands), exposed as
  `…\.venv\Scripts\genvm-lint.exe`.
- `pyright` — the type engine `genvm-lint typecheck` drives. (If `genvm-lint typecheck`
  reports `pyright not found`, install it into the venv: `python -m pip install pyright`.
  CI installs it as part of the toolchain.)
- `pytest`.

Always force UTF-8 on Windows so the suite's I/O matches CI:

```powershell
$env:PYTHONUTF8 = 1
```

The direct-mode runner is pinned to the GenVM release the contract's `# { "Depends": … }`
pragma targets, via `GENVM_VERSION` (default `v0.2.16`, set in `tests/direct/conftest.py`
and in CI). Do not change the pin without also updating the `Depends` header.

---

## Running the gates locally

From the **credence repo root**, with the venv python:

```powershell
$env:PYTHONUTF8 = 1
$py   = "python"
$lint = "genvm-lint"

# 1. Lint — 3 checks (also reports the method count + contract validation)
& $lint check     contracts\credence.py
& $lint check     contracts\credence_gated.py

# 2. Typecheck (drives pyright)
& $lint typecheck contracts\credence.py
& $lint typecheck contracts\credence_gated.py

# 3. The authoritative gate: the whole direct-mode suite
& $py -m pytest tests\direct -q
```

Expected, on a clean tree (verified 2026-11-03):

- `genvm-lint check contracts/credence.py` → `Lint passed (3 checks)`, `Validation passed`,
  **`Methods: 31 (11 view, 20 write)`**, `Contract: Credence`.
- `genvm-lint check contracts/credence_gated.py` → `Validation passed`,
  `Methods: 9 (4 view, 5 write)`, `Contract: CredenceGatedVault`.
- `pytest tests/direct -q` → **`70 passed`** (62 scenario tests in
  `tests/direct/test_credence.py` + 6 property/invariant tests in
  `tests/direct/test_invariants.py`).

### Useful subsets

```powershell
# Just the scenario suite, or a single class/test
& $py -m pytest tests\direct\test_credence.py -q
& $py -m pytest tests\direct\test_credence.py::TestEnterprise -v

# The seeded invariant/conservation suite (tune the fuzz driver via env vars)
& $py -m pytest tests\direct\test_invariants.py -q
$env:CREDENCE_FUZZ_OPS = 2000; $env:CREDENCE_FUZZ_SEED = 7   # deeper run / new seed
```

> Passing the direct-mode suite also exercises the GenVM's own compile/lint pass (an
> unreachable non-deterministic call would fail to load), so a green suite is itself proof
> the contract loads cleanly in the GenVM sense.

The `adapter/` adapter has its own gate (Node 22, zero runtime deps):

```powershell
cd adapter ; node --test
```

---

## CI gates

CI (`.github/workflows/ci.yml`) runs on every push and PR to `master`/`main` and mirrors
the local checks exactly:

| Job | Steps | Gate |
|---|---|---|
| **contract** | `genvm-lint check` → `genvm-lint typecheck` → `pytest tests/direct -q` (Python 3.12, `PYTHONUTF8=1`, `GENVM_VERSION=v0.2.16`) | **hard** — authoritative |
| **adapter** | `npm ci \|\| npm install` → `node --test` (Node 22) | **hard** |
| **frontend** | `npx tsc --noEmit` → `npx next build` (Node 22) | **non-gating** (`continue-on-error`) while the dApp is reconciled to the v1.1+ interface |

A contract change is not done until the **contract** and **adapter** jobs are green. If you
touch the frontend, aim to clear its typecheck/build too even though it does not block.

---

## Code style

- **Match the existing file.** `contracts/credence.py` is deliberately organized:
  module docstring → constants → pure helpers → events → storage dataclass → contract
  (internals, then borrower API, lender/pool, admin, views). Keep that structure; put pure
  logic in module-level helpers and keep methods thin.
- **Everything untrusted is data, never instructions.** Any new path that touches borrower
  input or fetched web text must go through `_sanitise` / `_check_clean` / `_neutralise`
  as appropriate, and must not let untrusted text reach a model unframed. Preserve the
  fail-closed stance: when anything is wrong or uncertain, write no assessment / lend
  nothing / default to `DENY`.
- **Money is base units (1 token = 1e18).** Use the typed storage primitives
  (`u256`/`u64`/`u32`/`Address`, `TreeMap`, `DynArray`, `@allow_storage` dataclasses).
  Return base-unit money as decimal **strings** (to avoid bigint truncation across the
  ABI) and small counts/epochs/bps as ints — the pattern every view already follows.
- **Preserve the accounting invariants.** Any change to funds flow must keep the ten
  invariants in `tests/direct/test_invariants.py` holding; add/extend invariant coverage
  when you add a funds path. Transfers are `on="finalized"`.
- **Determinism.** Keep validator-visible logic deterministic; all nondeterminism
  (`gl.nondet.*`) stays inside the `run_nondet_unsafe` leader/validator block, and the
  binding output stays bounded (the six-value grade) so consensus is tractable.
- **Bump `VERSION`** in `contracts/credence.py` and add a dated entry to
  [`CHANGELOG.md`](CHANGELOG.md) (Keep a Changelog format) for any behavior change.

---

## Pull requests

- Keep PRs focused; describe what changed, what is **proven by tests** vs. assumed, and
  any security implications.
- Confirm in the PR that lint, typecheck, and `pytest tests/direct` are green locally.
- Note the cross-review (who/what reviewed it) for substantial contract changes.
- Update the docs that describe the behavior you changed (`README.md` method tables,
  `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/EVENTS.md`, `docs/INTEGRATION.md`,
  `docs/OPERATIONS.md`) in the same PR.
