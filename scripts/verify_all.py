#!/usr/bin/env python3
"""
verify_all.py — one-command local gate runner for Credence.
============================================================

Reproduces the CI gates (.github/workflows/ci.yml) on a contributor's machine, so you can
see green before you push. It runs, in order:

  1. genvm-lint check      on all four contracts  (lint — 3 checks)
  2. genvm-lint typecheck  on all four contracts  (pyright-backed typecheck)
  3. pytest tests/direct                           (direct-mode GenVM suite)
  4. node --test            in adapter/               (off-chain evidence adapter)
  5. tsc -p tsconfig.json --noEmit  in sdk/        (TypeScript SDK typecheck)

Cross-platform (Windows / POSIX), stdlib only. Any tool that isn't installed locally is
reported as **SKIP** with an install hint rather than failing the run, so a partial
toolchain still gives useful signal. The process exits non-zero iff a gate that actually
ran FAILED — mirroring what CI will do.

Tool resolution (override via env):
  CREDENCE_PYTHON   python used for genvm-lint / pytest   (default: this interpreter)
  CREDENCE_NODE     node binary                            (default: `node` on PATH)
  CREDENCE_NPM      npm binary                             (default: `npm`/`npm.cmd` on PATH)
  CREDENCE_NPX      npx binary                             (default: `npx`/`npx.cmd` on PATH)

Usage:
  python scripts/verify_all.py            # run everything available
  python scripts/verify_all.py --list     # list the gates and their resolved commands
  python scripts/verify_all.py contracts  # run only matching gate groups (contracts|pytest|adapter|sdk)

#CreditWithoutCollateral · GenLayer referral JTR01FHP
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACTS = [
    "contracts/credence.py",
    "contracts/credence_gated.py",
    "contracts/credence_governor.py",
    "contracts/credence_passport.py",
]

IS_WIN = os.name == "nt"


def _which(*names: str) -> Optional[str]:
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    return None


def _python() -> str:
    return os.environ.get("CREDENCE_PYTHON") or sys.executable


def _genvm_lint_cmd() -> Optional[list]:
    """Resolve the `genvm-lint` CLI (entry point genvm_linter.cli:cli). Preference order:
    (1) the console script sitting next to the chosen python (venv Scripts/bin, found even
    when the venv isn't activated); (2) `genvm-lint` on PATH (how CI invokes it);
    (3) a `-c` shim that calls the entry point directly if the package is importable."""
    py = _python()
    sib = os.path.dirname(py)
    for name in ("genvm-lint.exe", "genvm-lint"):
        cand = os.path.join(sib, name)
        if os.path.isfile(cand):
            return [cand]
    exe = _which("genvm-lint", "genvm-lint.exe")
    if exe:
        return [exe]
    try:
        r = subprocess.run([py, "-c", "import genvm_linter.cli"],
                           capture_output=True, timeout=60)
        if r.returncode == 0:
            return [py, "-c", "from genvm_linter.cli import cli; cli()"]
    except Exception:
        pass
    return None


def _node() -> Optional[str]:
    return os.environ.get("CREDENCE_NODE") or _which("node", "node.exe")


def _npm() -> Optional[str]:
    return os.environ.get("CREDENCE_NPM") or _which("npm", "npm.cmd")


def _npx() -> Optional[str]:
    return os.environ.get("CREDENCE_NPX") or _which("npx", "npx.cmd")


@dataclass
class Gate:
    group: str
    name: str
    cmd: Optional[list]       # None => tool unavailable (SKIP)
    cwd: str
    skip_hint: str = ""
    pre: Optional[list] = None  # optional prep command (e.g. npm install), failure => SKIP


RESULT_PASS, RESULT_FAIL, RESULT_SKIP = "PASS", "FAIL", "SKIP"


def build_gates() -> list:
    gates: list[Gate] = []
    gl = _genvm_lint_cmd()

    # 1 + 2: lint + typecheck each contract.
    for sub in ("check", "typecheck"):
        for c in CONTRACTS:
            gates.append(Gate(
                group="contracts",
                name=f"genvm-lint {sub} {os.path.basename(c)}",
                cmd=(gl + [sub, c]) if gl else None,
                cwd=ROOT,
                skip_hint="pip install genvm-linter pyright",
            ))

    # 3: direct-mode pytest.
    py = _python()
    has_pytest = False
    try:
        has_pytest = subprocess.run([py, "-c", "import pytest"],
                                    capture_output=True, timeout=60).returncode == 0
    except Exception:
        has_pytest = False
    gates.append(Gate(
        group="pytest",
        name="pytest tests/direct",
        cmd=([py, "-m", "pytest", "tests/direct", "-q"] if has_pytest else None),
        cwd=ROOT,
        skip_hint="pip install genlayer-test pytest",
    ))

    # 4: adapter node:test.
    node = _node()
    npm = _npm()
    gates.append(Gate(
        group="adapter",
        name="node --test (adapter)",
        cmd=([node, "--test"] if node else None),
        cwd=os.path.join(ROOT, "adapter"),
        skip_hint="install Node 22+ (adapter has zero runtime deps; no install step needed)",
    ))

    # 5: sdk tsc typecheck (needs node_modules; prep with npm ci/install if missing).
    sdk_dir = os.path.join(ROOT, "sdk")
    npx = _npx()
    sdk_has_modules = os.path.isdir(os.path.join(sdk_dir, "node_modules"))
    sdk_cmd = None
    sdk_pre = None
    sdk_hint = "install Node 22+ and run `npm ci` in sdk/"
    if npx:
        sdk_cmd = [npx, "tsc", "-p", "tsconfig.json", "--noEmit"]
        if not sdk_has_modules and npm:
            sdk_pre = [npm, "ci"]
    gates.append(Gate(
        group="sdk",
        name="tsc --noEmit (sdk)",
        cmd=sdk_cmd,
        cwd=sdk_dir,
        skip_hint=sdk_hint,
        pre=sdk_pre,
    ))
    return gates


# Mirror CI's environment (.github/workflows/ci.yml sets PYTHONUTF8=1 for the contract
# job): the genvm-lint CLI and pytest open the contract sources without forcing UTF-8, so
# on a cp1252 default (Windows) they crash on the non-ASCII bytes in the contracts. Forcing
# UTF-8 here makes the local run faithful to CI and portable. Harmless for the node gates.
#
# Also prepend the chosen interpreter's directory (a venv Scripts/bin) to PATH, so tools the
# linter shells out to by name — notably `pyright`, which `genvm-lint typecheck` drives — are
# found even when the venv isn't activated, exactly as they would be in CI or an active venv.
def _gate_env() -> dict:
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    pydir = os.path.dirname(_python())
    if pydir and os.path.isdir(pydir):
        env["PATH"] = pydir + os.pathsep + env.get("PATH", "")
    return env


_GATE_ENV = _gate_env()


def run_gate(g: Gate) -> tuple:
    """Return (result, seconds, detail)."""
    if g.cmd is None:
        return (RESULT_SKIP, 0.0, f"tool not found — {g.skip_hint}")
    if g.pre is not None:
        try:
            pr = subprocess.run(g.pre, cwd=g.cwd, capture_output=True, text=True,
                                timeout=1200, env=_GATE_ENV)
            if pr.returncode != 0:
                # try `npm install` as a fallback for the no-lockfile case
                alt = ["npm" if not IS_WIN else "npm.cmd", "install"]
                try:
                    pr2 = subprocess.run(alt, cwd=g.cwd, capture_output=True, text=True,
                                         timeout=1200, env=_GATE_ENV)
                    if pr2.returncode != 0:
                        return (RESULT_SKIP, 0.0, f"prep failed ({' '.join(g.pre)}); {g.skip_hint}")
                except Exception:
                    return (RESULT_SKIP, 0.0, f"prep failed ({' '.join(g.pre)}); {g.skip_hint}")
        except Exception as exc:
            return (RESULT_SKIP, 0.0, f"prep error: {exc}")
    t0 = time.monotonic()
    try:
        r = subprocess.run(g.cmd, cwd=g.cwd, text=True, env=_GATE_ENV)
    except FileNotFoundError:
        return (RESULT_SKIP, 0.0, f"executable missing — {g.skip_hint}")
    except Exception as exc:
        return (RESULT_FAIL, time.monotonic() - t0, f"error: {exc}")
    dt = time.monotonic() - t0
    return ((RESULT_PASS if r.returncode == 0 else RESULT_FAIL), dt,
            f"exit {r.returncode}")


def main(argv: list) -> int:
    args = [a for a in argv if not a.startswith("-")]
    opts = [a for a in argv if a.startswith("-")]
    gates = build_gates()

    if "--list" in opts or "-l" in opts:
        for g in gates:
            cmd = " ".join(g.cmd) if g.cmd else f"(unavailable — {g.skip_hint})"
            print(f"[{g.group}] {g.name}\n    cwd: {g.cwd}\n    cmd: {cmd}")
        return 0

    if args:
        wanted = set(args)
        gates = [g for g in gates if g.group in wanted]
        if not gates:
            print(f"No gate groups matched {sorted(wanted)}. "
                  f"Valid groups: contracts, pytest, adapter, sdk")
            return 2

    print("=" * 72)
    print("Credence — verify_all (local reproduction of CI gates)")
    print(f"repo: {ROOT}")
    print(f"python: {_python()}")
    print("=" * 72)

    results = []
    for g in gates:
        print(f"\n>>> [{g.group}] {g.name}")
        res, dt, detail = run_gate(g)
        marker = {"PASS": "PASS", "FAIL": "FAIL", "SKIP": "SKIP"}[res]
        print(f"<<< {marker} ({detail}, {dt:.1f}s)")
        results.append((g, res, dt, detail))

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    n_pass = n_fail = n_skip = 0
    for g, res, dt, detail in results:
        n_pass += res == RESULT_PASS
        n_fail += res == RESULT_FAIL
        n_skip += res == RESULT_SKIP
        print(f"  {res:4s}  [{g.group:9s}] {g.name:42s} {detail}")
    print("-" * 72)
    print(f"  {n_pass} passed, {n_fail} failed, {n_skip} skipped")
    if n_fail:
        print("\nFAILED — at least one gate that ran did not pass (see output above).")
    elif n_skip:
        print("\nAll runnable gates passed; some were skipped (tool not installed locally). "
              "CI runs the full set.")
    else:
        print("\nAll gates passed.")
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
