"""
Invariant / property-based test suite for the Credence intelligent contract.
=============================================================================

Where ``test_credence.py`` pins individual behaviours, this file attacks the
*protocol accounting* as a whole: a bounded, SEEDED, randomized driver applies a
few hundred operations across a small cast of lenders and borrowers, maintains a
parallel Python model of the money that actually moved, and after EVERY
successful operation asserts a set of global invariants that must hold for any
reachable state of a correct contract.

The ten core invariants (see ``_assert_invariants``):

  1. VALUE CONSERVATION - on-chain ``cash`` equals the net of every value that
     actually entered or left the pool (funds + repays in; draws, defunds,
     withdrawn fees and claimed yield out), summed from the amounts the driver
     really sent on each *successful* op.
  2. ``cash`` is never negative.
  3. ``outstanding_principal`` == sum of every borrower's ``principal``.
  4. ``outstanding_fees``      == sum of every borrower's ``fee_accrued``.
  5. ``active_lines``          == count of borrowers whose principal+fee+interest > 0
     (the contract's own ``_debt_of`` predicate; counting only principal+fee would
     miss an interest-only line - the F1-class mis-count this suite now guards).
  6. sum of every lender's ``funded`` == ``total_funded``.
  7. a lender's ``pending_yield`` is always >= 0 and never DECREASES except by
     exactly the amount returned from that lender's own ``claim_yield`` call.
  8. sum of all lenders' ``pending_yield`` <= ``yield_distributed`` (integer
     division only ever floors a lender's share DOWN, so the sum stays at or
     below the total streamed; see the dust discussion on INV8 below).
  9. every borrower's ``principal`` <= its ``credit_limit``.
 10. a defaulted borrower cannot ``draw``; a borrower with outstanding debt
     cannot re-``request_credit`` (nor ``appeal``).

Interest invariants (exercised once an operator enables an APR via
``set_interest_bps`` - the fuzz driver now enables one near the start of most
seeded runs and advances the consensus clock between ops so interest actually
accrues on open lines):

 11. ``outstanding_interest`` == sum of every borrower's ``interest_accrued``.
 12. every borrower's ``owed`` == principal + fee_accrued + interest_accrued.
 13. value conservation (INV1) stays EXACT with interest live: interest is only
     ever paid through ``repay`` value, so it is already captured on the inflow
     side of the ledger (``repaid_in``); nothing else moves cash. The lender
     yield share (INV8) now also includes the streamed interest.

Expected reverts (draw over limit, overpayment, illiquid defund, re-request
or appeal while in debt - including interest-only debt, ...) are tolerated and
must NOT advance the parallel model.

Run (from the credence repo root), with the verdict venv:

    $env:PYTHONUTF8=1
    python -m pytest tests/direct/test_invariants.py -q
"""

import json
import os
import random

import pytest

CONTRACT = "contracts/credence.py"

TOK = 1_000_000_000_000_000_000          # 1e18 base units per token
ACC_SCALE = 1_000_000_000_000_000_000    # mirrors the contract's accumulator scale
MAX_LINE_TOKENS = 2500                   # GRADE_TOKENS["AAA"]

NUM_OPS = int(os.environ.get("CREDENCE_FUZZ_OPS", "400"))
SEED = int(os.environ.get("CREDENCE_FUZZ_SEED", "1234"))

GRADES_APPROVABLE = ["C", "B", "A", "AA", "AAA"]
# A benign purpose that trips none of the injection / control-phrase screens.
SAFE_PURPOSE = "Working capital for an established freelance studio with recurring revenue."


# --------------------------------------------------------------------------- #
# small helpers (self-contained; do not import from test_credence.py)
# --------------------------------------------------------------------------- #

def addr_str(a):
    if hasattr(a, "as_hex"):
        return a.as_hex
    if isinstance(a, (bytes, bytearray)):
        return "0x" + bytes(a).hex()
    return str(a)


def key(a):
    return addr_str(a).lower()


def grade_reply(g):
    return json.dumps({"grade": g, "rationale": "Verifiable current revenue supports this line."})


def set_chain_time(iso):
    """Advance the consensus transaction clock the contract reads
    (`gl.message_raw['datetime']`) - the field a real on-chain tx carries."""
    import genlayer.gl as _g
    _g.message_raw["datetime"] = iso


def epoch_to_iso(epoch_seconds):
    import datetime as _dt
    return _dt.datetime.fromtimestamp(epoch_seconds, _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- #
# the parallel model: only what the driver can fully control / predict
# --------------------------------------------------------------------------- #

class Model:
    """Tracks the exact value that moved on each *successful* op, plus enough
    per-actor state to pick valid-ish operations. Invariants are checked by
    cross-referencing this model against the contract's own views."""

    def __init__(self, lenders, borrowers):
        # Cash-conservation ledger (base units), from amounts actually sent.
        self.funded_in = 0
        self.repaid_in = 0
        self.drawn_out = 0
        self.defunded_out = 0
        self.fees_withdrawn_out = 0
        self.yield_claimed_out = 0

        # Per-lender contributed capital (mirrors contract `funded`).
        self.funded = {key(l): 0 for l in lenders}
        # Per-lender last-observed pending_yield, for the monotonicity invariant.
        self.prev_pending = {key(l): 0 for l in lenders}

        # Bookkeeping for the INV8 dust bound.
        self.n_harvests = 0

        self.lenders = list(lenders)
        self.borrowers = list(borrowers)

    def expected_cash(self):
        return (self.funded_in + self.repaid_in
                - self.drawn_out - self.defunded_out
                - self.fees_withdrawn_out - self.yield_claimed_out)


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture
def actors(direct_accounts):
    """Disjoint cast: one owner, three lenders, four borrowers. Keeping lenders
    and borrowers disjoint keeps the model's accounting unambiguous; the
    contract itself imposes no such restriction."""
    owner = direct_accounts[0]
    lenders = [direct_accounts[1], direct_accounts[2], direct_accounts[3]]
    borrowers = [direct_accounts[4], direct_accounts[5], direct_accounts[6], direct_accounts[7]]
    return owner, lenders, borrowers


@pytest.fixture
def deployed(direct_vm, direct_deploy, actors):
    owner, _lenders, _borrowers = actors
    direct_vm.sender = owner
    c = direct_deploy(CONTRACT)
    return c


# --------------------------------------------------------------------------- #
# revert tolerance
# --------------------------------------------------------------------------- #

def _revert_types():
    """The exception types that represent an *expected* contract revert. Any
    other exception (e.g. an integer overflow, an unexpected crash) is a real
    failure and is allowed to propagate out of the driver."""
    from gltest.direct.wasi_mock import ContractRollback
    import genlayer.gl.vm as glvm
    return (glvm.UserError, ContractRollback)


def _safe(revert_types, fn):
    """Run `fn`; return (True, result) on success, (False, exc) on an expected
    revert. Non-revert exceptions propagate (potential real bug). AssertionError
    is never caught here because invariant checks run *outside* this wrapper."""
    try:
        return True, fn()
    except revert_types as exc:
        return False, exc


# --------------------------------------------------------------------------- #
# contract read helpers
# --------------------------------------------------------------------------- #

def _all_borrowers(c):
    out = []
    off = 0
    while off >= 0:
        page = c.page_borrowers(off, 50)
        for item in page["items"]:
            out.append(c.get_borrower(item["addr"]))
        off = page["next_offset"]
    return out


# --------------------------------------------------------------------------- #
# the invariant battery
# --------------------------------------------------------------------------- #

def _assert_invariants(c, m: Model, note=""):
    pool = c.get_pool()
    cash = int(pool["cash"])

    # INV2: cash is never negative.
    assert cash >= 0, f"[INV2 cash>=0] cash={cash} ({note})"

    # INV1: value conservation.
    exp = m.expected_cash()
    assert cash == exp, (
        f"[INV1 value-conservation] contract cash={cash} != model {exp} "
        f"(in: fund={m.funded_in} repay={m.repaid_in}; "
        f"out: draw={m.drawn_out} defund={m.defunded_out} "
        f"fees={m.fees_withdrawn_out} yield={m.yield_claimed_out}) ({note})")

    borrowers = _all_borrowers(c)
    sum_principal = sum(int(b["principal"]) for b in borrowers)
    sum_fees = sum(int(b["fee_accrued"]) for b in borrowers)
    sum_interest = sum(int(b["interest_accrued"]) for b in borrowers)
    # INV5 must use the contract's OWN debt predicate (principal + fee + interest).
    # Counting only principal+fee would miss an interest-only line and wrongly flag
    # a mismatch against active_lines - exactly the F1-class bug this guards.
    active = sum(1 for b in borrowers
                 if int(b["principal"]) + int(b["fee_accrued"]) + int(b["interest_accrued"]) > 0)

    # INV3 / INV4: pool outstanding totals equal the per-borrower sums.
    assert sum_principal == int(pool["outstanding_principal"]), (
        f"[INV3 total-principal] sum(principal)={sum_principal} != "
        f"pool.outstanding_principal={pool['outstanding_principal']} ({note})")
    assert sum_fees == int(pool["outstanding_fees"]), (
        f"[INV4 total-fees] sum(fee_accrued)={sum_fees} != "
        f"pool.outstanding_fees={pool['outstanding_fees']} ({note})")

    # INV11: pool outstanding interest equals the per-borrower sum of accrued interest.
    assert sum_interest == int(pool["outstanding_interest"]), (
        f"[INV11 total-interest] sum(interest_accrued)={sum_interest} != "
        f"pool.outstanding_interest={pool['outstanding_interest']} ({note})")

    # INV12: every borrower's reported owed == principal + fee + interest, exactly.
    for b in borrowers:
        exp_owed = int(b["principal"]) + int(b["fee_accrued"]) + int(b["interest_accrued"])
        assert int(b["owed"]) == exp_owed, (
            f"[INV12 owed-identity] {b['addr']} owed={b['owed']} != "
            f"principal+fee+interest={exp_owed} ({note})")

    # INV5: active_lines == borrowers carrying any debt.
    st = c.stats()
    assert active == int(pool["active_lines"]) == int(st["active_lines"]), (
        f"[INV5 active-lines] counted={active} pool={pool['active_lines']} "
        f"stats={st['active_lines']} ({note})")

    # INV9: principal never exceeds the credit limit.
    for b in borrowers:
        assert int(b["principal"]) <= int(b["credit_limit"]), (
            f"[INV9 principal<=limit] {b['addr']} principal={b['principal']} "
            f"> limit={b['credit_limit']} ({note})")

    # INV6: sum of lender capital == total_funded (contract AND model agree).
    sum_funded = sum(int(c.lender_balance(addr_str(l))["funded"]) for l in m.lenders)
    assert sum_funded == int(pool["total_funded"]), (
        f"[INV6 sum-funded] sum={sum_funded} != total_funded={pool['total_funded']} ({note})")
    assert sum_funded == sum(m.funded.values()), (
        f"[INV6 sum-funded/model] contract={sum_funded} != model={sum(m.funded.values())} ({note})")

    # INV8: no lender set can claim more yield than was ever distributed.
    yield_distributed = int(pool["yield_distributed"])
    sum_pending = sum(int(c.pending_yield(addr_str(l))) for l in m.lenders)
    assert sum_pending <= yield_distributed, (
        f"[INV8 pending<=distributed] sum_pending={sum_pending} > "
        f"yield_distributed={yield_distributed} ({note})")
    # Stronger conservation with a DOCUMENTED dust tolerance: total value ever
    # credited to lenders == still-pending + already-claimed. Each per-lender
    # share is floored, and the accumulator increment itself floors DOWN, so
    # the grand total can only fall SHORT of yield_distributed, never exceed it.
    # We bound any over-credit from the floor-difference in reward-debt resets
    # by `n_harvests + len(lenders)` base units (at most ~1 unit per harvest/
    # per lender segment boundary). In practice the slack is strongly negative.
    dust_tol = m.n_harvests + len(m.lenders) + 1
    credited = sum_pending + m.yield_claimed_out
    assert credited <= yield_distributed + dust_tol, (
        f"[INV8 credit-conservation] credited(pending+claimed)={credited} > "
        f"yield_distributed={yield_distributed} + dust({dust_tol}) ({note})")

    # INV9b (cross-view): the composable oracle never reports MORE drawable
    # credit than the raw line (credit_limit - principal). `credit_of` gates its
    # `available` to 0 for a line that is not usable (not approved, awaiting
    # reassessment after a default, or live-overdue), so it is always either the
    # full raw availability or exactly 0 - never anything in between, and never
    # more than get_borrower's raw availability.
    for b in borrowers:
        co = c.credit_of(b["addr"])
        assert co["available"] in ("0", b["available"]), (
            f"[INV cross credit_of] {b['addr']} oracle available={co['available']} "
            f"not in {{0, raw={b['available']}}} ({note})")
        assert int(co["available"]) <= int(b["available"]), (
            f"[INV cross credit_of] {b['addr']} oracle available exceeds raw ({note})")

    # Coverage telemetry (not an assertion): how much interest is live, and how many
    # lines are in the F1-critical interest-only state (principal 0, fee 0, interest > 0).
    interest_only = sum(1 for b in borrowers
                        if int(b["interest_accrued"]) > 0
                        and int(b["principal"]) == 0 and int(b["fee_accrued"]) == 0)
    return {"interest_outstanding": int(pool["outstanding_interest"]),
            "interest_only_lines": interest_only}


def _check_pending_monotone(c, m: Model, claimer=None, claimed=0, note=""):
    """INV7: pending_yield >= 0 for all lenders; it may only DECREASE via the
    claimer's own claim, and then by exactly `claimed`."""
    for l in m.lenders:
        k = key(l)
        now = int(c.pending_yield(addr_str(l)))
        assert now >= 0, f"[INV7 pending>=0] {k} pending={now} ({note})"
        prev = m.prev_pending[k]
        if claimer is not None and k == key(claimer):
            assert now == prev - claimed, (
                f"[INV7 claim-exact] {k} pending {prev}->{now}, claimed={claimed} ({note})")
        else:
            assert now >= prev, (
                f"[INV7 non-decrease] {k} pending dropped {prev}->{now} "
                f"(op touched {key(claimer) if claimer else 'none'}) ({note})")
        m.prev_pending[k] = now


# --------------------------------------------------------------------------- #
# operation implementations - each returns a short label describing what ran
# --------------------------------------------------------------------------- #

class Driver:
    def __init__(self, vm, c, m: Model, owner, rng, reverts):
        self.vm = vm
        self.c = c
        self.m = m
        self.owner = owner
        self.rng = rng
        self.reverts = reverts
        self.nonce = 0
        self.epoch = 1_767_225_600  # 2026-01-01T00:00:00Z
        set_chain_time(epoch_to_iso(self.epoch))

    # -- individual ops ----------------------------------------------------- #

    def op_fund(self):
        l = self.rng.choice(self.m.lenders)
        tokens = self.rng.randint(1, 2000)
        value = tokens * TOK
        self.vm.sender = l
        self.vm.value = value
        self.c.fund()
        self.vm.value = 0
        self.m.funded_in += value
        self.m.funded[key(l)] += value
        self.m.n_harvests += 1
        return f"fund {key(l)[:8]} {tokens}t", None, 0

    def op_defund(self):
        l = self.rng.choice(self.m.lenders)
        funded = int(self.c.lender_balance(addr_str(l))["funded"])
        if funded == 0:
            amt = self.rng.randint(1, 5) * TOK   # will revert (tolerated)
        else:
            # sometimes over-request to exercise the revert path
            hi = funded if self.rng.random() < 0.8 else funded + 50 * TOK
            amt = self.rng.randint(1, max(1, hi // TOK)) * TOK
        self.vm.sender = l
        ok, _ = _safe(self.reverts, lambda: self.c.defund(amt))
        if ok:
            self.m.defunded_out += amt
            self.m.funded[key(l)] -= amt
            self.m.n_harvests += 1
            return f"defund {key(l)[:8]} {amt // TOK}t", None, 0
        return None, None, 0

    def op_claim(self):
        l = self.rng.choice(self.m.lenders)
        self.vm.sender = l
        ok, res = _safe(self.reverts, lambda: self.c.claim_yield())
        if ok:
            claimed = int(res["claimed"])
            self.m.yield_claimed_out += claimed
            self.m.n_harvests += 1
            return f"claim {key(l)[:8]} {claimed}", l, claimed
        return None, None, 0

    def op_request_assess(self):
        b = self.rng.choice(self.m.borrowers)
        g = self.rng.choice(GRADES_APPROVABLE + ["DENY"])
        owned = self.rng.random() < 0.8
        self.nonce += 1
        bh = addr_str(b)
        self.vm.sender = b
        self.vm.value = 0
        self.vm.clear_mocks()
        if owned:
            url = f"https://proof.example.com/{bh.lower()}/{self.nonce}"
            evidence = [{"kind": "url", "label": "Ownership + revenue", "content": url}]
            body = f"Owner wallet {bh}. Verified recurring revenue over a 36-month history."
        else:
            evidence = [{"kind": "text", "label": "Self-reported",
                         "content": f"Recurring monthly revenue, reference {self.nonce}."}]
            url = None
        tokens = self.rng.randint(1, MAX_LINE_TOKENS)
        ok, _ = _safe(self.reverts,
                      lambda: self.c.request_credit(SAFE_PURPOSE, tokens, json.dumps(evidence)))
        if not ok:
            return None, None, 0   # e.g. settle-outstanding-first (tolerated)
        if url is not None:
            self.vm.mock_web(url, {"status": 200, "body": body})
        self.vm.mock_llm(r"impartial credit underwriter", grade_reply(g))
        out = self.c.assess(bh)
        return f"assess {key(b)[:8]} ask={g} owned={int(owned)} -> {out['grade']}", None, 0

    def op_draw(self):
        b = self.rng.choice(self.m.borrowers)
        bh = addr_str(b)
        co = self.c.credit_of(bh)        # never reverts for an unknown address
        if not co["known"]:
            return None, None, 0

        # INV10 (a): a defaulted borrower must not be able to draw.
        if co["status"] == "defaulted":
            self.vm.sender = b
            ok, _ = _safe(self.reverts, lambda: self.c.draw(1 * TOK))
            assert ok is False, f"[INV10 defaulted-cannot-draw] {key(b)[:8]} draw succeeded"
            return f"draw-blocked(defaulted) {key(b)[:8]}", None, 0

        available = int(co["available"])
        cash = int(self.c.get_pool()["cash"])
        ceiling = min(available, cash)
        if ceiling < TOK:
            amt = self.rng.randint(1, 3) * TOK        # likely reverts (tolerated)
        else:
            amt = self.rng.randint(1, ceiling // TOK) * TOK
            if self.rng.random() < 0.15:              # sometimes exceed on purpose
                amt = ceiling + self.rng.randint(1, 20) * TOK
        self.vm.sender = b
        ok, _ = _safe(self.reverts, lambda: self.c.draw(amt))
        if ok:
            self.m.drawn_out += amt
            return f"draw {key(b)[:8]} {amt // TOK}t", None, 0
        return None, None, 0

    def op_repay(self):
        b = self.rng.choice(self.m.borrowers)
        bh = addr_str(b)
        if not self.c.credit_of(bh)["known"]:
            return None, None, 0
        rec = self.c.get_borrower(bh)
        # owed MUST include accrued interest now that the driver runs with an APR
        # enabled: principal + fee + interest is the true debt (contract `owed`).
        owed = int(rec["principal"]) + int(rec["fee_accrued"]) + int(rec["interest_accrued"])
        if owed == 0:
            value = self.rng.randint(1, 3) * TOK      # reverts: nothing outstanding
        elif self.rng.random() < 0.2:
            value = owed + self.rng.randint(1, 5) * TOK  # overpayment (reverts)
        elif self.rng.random() < 0.5:
            # Settle the debt as last read. If the clock advanced since the line was
            # last touched, repay() accrues a little MORE interest first, so this may
            # leave a tiny interest-only residual (principal 0, fee 0, interest > 0) -
            # a deliberately exercised F1 state - rather than fully closing the line.
            value = owed
        else:
            value = self.rng.randint(1, owed)          # partial repay
        self.vm.sender = b
        self.vm.value = value
        ok, _ = _safe(self.reverts, lambda: self.c.repay())
        self.vm.value = 0
        if ok:
            self.m.repaid_in += value
            return f"repay {key(b)[:8]} {value}", None, 0
        return None, None, 0

    def op_service(self):
        self.vm.sender = self.rng.choice(self.m.borrowers + self.m.lenders + [self.owner])
        batch = self.rng.randint(1, 10)
        self.c.service_book(batch)
        return f"service {batch}", None, 0

    def op_warp(self):
        # Step the consensus clock forward by random days AND hours, so interest
        # accrues at a realistic sub-day granularity on open lines (deterministic).
        days = self.rng.randint(0, 50)
        hours = self.rng.randint(0, 23)
        self.epoch += days * 86400 + hours * 3600
        set_chain_time(epoch_to_iso(self.epoch))
        return f"warp +{days}d{hours}h", None, 0

    def tick(self):
        """A small, always-applied forward step of the consensus clock between
        operations (random hours, occasionally a few days). This is what makes
        interest actually accrue on open lines across the run, not just on the
        comparatively rare op_warp. Seeded, so the whole run stays deterministic."""
        secs = self.rng.randint(0, 48) * 3600
        if self.rng.random() < 0.2:
            secs += self.rng.randint(1, 10) * 86400
        self.epoch += secs
        set_chain_time(epoch_to_iso(self.epoch))

    def op_withdraw_fees(self):
        pool = self.c.get_pool()
        rev = int(pool["fee_revenue"])
        cash = int(pool["cash"])
        cap = min(rev, cash)
        if cap <= 0:
            amt = self.rng.randint(1, 3) * TOK        # reverts (tolerated)
        else:
            amt = self.rng.randint(1, cap)
        self.vm.sender = self.owner
        dest = addr_str(self.owner)
        ok, _ = _safe(self.reverts, lambda: self.c.withdraw_fees(dest, amt))
        if ok:
            self.m.fees_withdrawn_out += amt
            return f"withdraw_fees {amt}", None, 0
        return None, None, 0

    def op_set_interest(self):
        """OWNER re-prices the APR for FUTURE lines. A line's rate is fixed at draw
        (F2: no retroactive repricing), so this only affects lines opened afterward -
        it never perturbs the ledger, so no model bookkeeping is needed."""
        bps = self.rng.choice([0, 1000, 1500, 2000, 2500])
        self.vm.sender = self.owner
        self.c.set_interest_bps(bps)
        return f"set_interest_bps {bps}", None, 0

    def op_appeal(self):
        """A borrower escalates one assessment to a larger panel. It MUST revert while
        any debt is outstanding - including interest-only debt (the F1 state) - which
        this exercises and tolerates. On the rare clean-standing success it re-runs the
        panel; appeal requires zero debt, so principal is 0 and no ledger value moves."""
        b = self.rng.choice(self.m.borrowers)
        bh = addr_str(b)
        if not self.c.credit_of(bh)["known"]:
            return None, None, 0
        self.vm.sender = b
        self.vm.value = 0
        # Deterministic mocks in case the appeal actually runs its panel (re-fetches
        # stored URL evidence and re-judges). Reverts short-circuit before any of this.
        self.vm.clear_mocks()
        self.vm.mock_web(r"proof\.example\.com",
                         {"status": 200, "body": "Recurring revenue; stable operating history."})
        self.vm.mock_llm(r"impartial credit underwriter",
                         grade_reply(self.rng.choice(GRADES_APPROVABLE)))
        ok, _ = _safe(self.reverts, lambda: self.c.appeal())
        if ok:
            return f"appeal {key(b)[:8]}", None, 0
        return None, None, 0


# --------------------------------------------------------------------------- #
# the fuzz test
# --------------------------------------------------------------------------- #

def test_invariants_under_randomized_operations(direct_vm, deployed, actors):
    owner, lenders, borrowers = actors
    c = deployed
    reverts = _revert_types()
    m = Model(lenders, borrowers)
    rng = random.Random(SEED)
    drv = Driver(direct_vm, c, m, owner, rng, reverts)

    # Deterministically (seeded) decide whether this run underwrites with a non-zero
    # interest APR, and at what rate. A dedicated RNG keeps this gate independent of
    # the op-selection stream. ~85% of seeds enable it, and the committed default seed
    # (1234 -> 0.511) does, so the interest path is always exercised in CI. Runs that
    # don't enable it keep testing the fee-only machine. When an APR is live the clock
    # is advanced between every op (drv.tick) so interest actually accrues on open lines.
    interest_rng = random.Random(f"{SEED}_interest")
    interest_on = interest_rng.random() < 0.85
    interest_apr = interest_rng.choice([1000, 1500, 2000, 2500]) if interest_on else 0
    if interest_on:
        direct_vm.sender = owner
        direct_vm.value = 0
        c.set_interest_bps(interest_apr)

    # Weighted op menu: skew toward fund/assess/draw/repay so real lines form.
    ops = (
        [drv.op_fund] * 7
        + [drv.op_request_assess] * 6
        + [drv.op_draw] * 6
        + [drv.op_repay] * 6
        + [drv.op_service] * 4
        + [drv.op_warp] * 4
        + [drv.op_defund] * 3
        + [drv.op_claim] * 3
        + [drv.op_appeal] * 2
        + [drv.op_withdraw_fees] * 2
        + ([drv.op_set_interest] * 1 if interest_on else [])
    )

    # Baseline invariants on the fresh pool.
    _assert_invariants(c, m, note="genesis")
    _check_pending_monotone(c, m, note="genesis")

    checks = 0
    applied = 0
    interest_sweeps = 0        # invariant sweeps taken while interest was outstanding
    interest_only_sweeps = 0   # sweeps that observed an interest-only line (F1 state)
    max_interest = 0
    history = []
    for i in range(NUM_OPS):
        # Advance the consensus clock between operations so interest accrues on any
        # open line before the next touch. (Only when an APR is live; otherwise the
        # run keeps the original timing driven solely by op_warp.)
        if interest_on:
            drv.tick()
        op = rng.choice(ops)
        label, claimer, claimed = op()
        if label is None:
            continue   # tolerated revert: model untouched, no new state to check
        applied += 1
        history.append(f"{i}:{label}")
        note = f"op#{i} {label} | recent={history[-6:]}"
        # Reset sender to a neutral reader for the view sweep.
        direct_vm.sender = owner
        direct_vm.value = 0
        stats = _assert_invariants(c, m, note=note)
        _check_pending_monotone(c, m, claimer=claimer, claimed=claimed, note=note)
        checks += 1
        if stats["interest_outstanding"] > 0:
            interest_sweeps += 1
            max_interest = max(max_interest, stats["interest_outstanding"])
        if stats["interest_only_lines"] > 0:
            interest_only_sweeps += 1

    # The run must actually exercise the machine, not just bounce off reverts.
    assert applied >= NUM_OPS // 3, f"only {applied}/{NUM_OPS} ops applied - driver too revert-heavy"
    pool = c.get_pool()
    assert int(pool["total_drawn"]) > 0, "no draw ever succeeded - fuzz did not reach the lending path"
    assert int(pool["yield_distributed"]) > 0, "no yield ever distributed - fuzz did not reach repay-with-fee"
    # When an APR was live, interest MUST have genuinely accrued on at least one line,
    # otherwise the interest invariants (INV5 corrected, INV11, INV12) were never put
    # under load and the gap this suite was written to close would be untested.
    if interest_on:
        assert interest_sweeps > 0, (
            f"interest APR {interest_apr}bps was enabled but no interest ever accrued - "
            f"the interest path was not exercised")
    print(f"\n[credence-invariants] seed={SEED} ops_requested={NUM_OPS} "
          f"ops_applied={applied} invariant_sweeps={checks} "
          f"interest_on={interest_on} interest_apr={interest_apr} "
          f"sweeps_with_interest={interest_sweeps} interest_only_sweeps={interest_only_sweeps} "
          f"max_interest_outstanding={max_interest} "
          f"final_cash={pool['cash']} total_drawn={pool['total_drawn']} "
          f"outstanding_interest={pool['outstanding_interest']} "
          f"yield_distributed={pool['yield_distributed']}")


# --------------------------------------------------------------------------- #
# targeted DETERMINISTIC property tests (not just the fuzz loop)
# --------------------------------------------------------------------------- #

def _fund(vm, c, lender, tokens):
    vm.sender = lender
    vm.value = tokens * TOK
    c.fund()
    vm.value = 0


def _apply_and_assess(vm, c, borrower, g, tokens=100, owned=True):
    vm.clear_mocks()
    vm.sender = borrower
    vm.value = 0
    bh = addr_str(borrower)
    if owned:
        url = f"https://proof.example.com/{bh.lower()}"
        evidence = [{"kind": "url", "label": "proof", "content": url}]
        c.request_credit(SAFE_PURPOSE, tokens, json.dumps(evidence))
        vm.mock_web(url, {"status": 200, "body": f"Owner wallet {bh}. Strong current revenue."})
    else:
        evidence = [{"kind": "text", "label": "x", "content": "Self-reported revenue."}]
        c.request_credit(SAFE_PURPOSE, tokens, json.dumps(evidence))
    vm.mock_llm(r"impartial credit underwriter", grade_reply(g))
    return c.assess(bh)


def test_pending_is_exactly_pro_rata_to_funded_at_accrual(direct_vm, deployed, actors):
    """PROPERTY: when yield accrues, each lender's pending is exactly their
    pro-rata share (funded_i * lender_cut // total_funded) of the lender cut."""
    owner, lenders, borrowers = actors
    c = deployed
    alice, bob, _ = lenders
    borrower = borrowers[0]

    _fund(direct_vm, c, alice, 750)
    _fund(direct_vm, c, bob, 250)
    total_funded = 1000 * TOK

    _apply_and_assess(direct_vm, c, borrower, "A", tokens=500)  # 200 bps origination
    direct_vm.sender = borrower
    out = c.draw(100 * TOK)
    fee = int(out["fee_accrued"])                     # 2 tokens for grade A on 100
    assert fee == 2 * TOK

    owed = 100 * TOK + fee
    direct_vm.sender = borrower
    direct_vm.value = owed
    c.repay()
    direct_vm.value = 0

    # lender_share_bps defaults to 5000 (half the fee streams to lenders).
    lender_cut = (fee * 5000) // 10000               # 1 token
    exp_alice = (750 * TOK) * lender_cut // total_funded
    exp_bob = (250 * TOK) * lender_cut // total_funded
    assert int(c.pending_yield(addr_str(alice))) == exp_alice == 3 * TOK // 4
    assert int(c.pending_yield(addr_str(bob))) == exp_bob == TOK // 4

    # No lender can be credited more than the whole cut (modulo flooring dust).
    assert exp_alice + exp_bob <= lender_cut
    assert int(c.get_pool()["yield_distributed"]) == lender_cut


def test_repay_fee_split_is_conserved(direct_vm, deployed, actors):
    """PROPERTY: on repay, lender_cut + protocol_cut == fee paid, exactly, with
    the lender cut landing in yield_distributed and the remainder in fee_revenue."""
    owner, lenders, borrowers = actors
    c = deployed
    alice = lenders[0]
    borrower = borrowers[0]

    _fund(direct_vm, c, alice, 1000)
    _apply_and_assess(direct_vm, c, borrower, "C", tokens=100)  # 400 bps origination
    direct_vm.sender = borrower
    out = c.draw(100 * TOK)
    fee = int(out["fee_accrued"])                    # 4 tokens for grade C on 100
    assert fee == 4 * TOK

    before = c.get_pool()
    direct_vm.sender = borrower
    direct_vm.value = 100 * TOK + fee
    c.repay()
    direct_vm.value = 0
    after = c.get_pool()

    d_rev = int(after["fee_revenue"]) - int(before["fee_revenue"])
    d_yield = int(after["yield_distributed"]) - int(before["yield_distributed"])
    assert d_rev + d_yield == fee, f"fee split not conserved: rev+yield={d_rev + d_yield} != fee={fee}"
    assert d_yield == (fee * 5000) // 10000          # half streamed to lenders
    assert d_rev == fee - d_yield


def test_fee_split_with_no_lenders_is_all_protocol_revenue(direct_vm, deployed, actors):
    """EDGE PROPERTY: when a fee is realised while no lender capital is funded,
    the whole fee is protocol revenue and nothing is streamed (yield stays 0),
    with value still conserved.

    Reaching total_funded==0 while a fee is owed is only possible via a fee-only
    line: repay the PRINCIPAL first (no fee realised yet, since pay_fee only
    applies to value beyond principal), let the sole lender fully defund (now
    permitted, the pool is liquid again), then repay the lingering fee with the
    pool empty of lender capital."""
    owner, lenders, borrowers = actors
    c = deployed
    alice = lenders[0]
    borrower = borrowers[0]

    _fund(direct_vm, c, alice, 1000)
    _apply_and_assess(direct_vm, c, borrower, "A", tokens=500)
    direct_vm.sender = borrower
    out = c.draw(100 * TOK)          # principal 100, fee 2; cash 900
    fee = int(out["fee_accrued"])
    assert fee == 2 * TOK

    # Repay exactly the principal -> fee remains, no fee realised yet.
    direct_vm.sender = borrower
    direct_vm.value = 100 * TOK
    rec = c.repay()
    direct_vm.value = 0
    assert rec["principal"] == "0" and int(rec["fee_accrued"]) == fee

    # Sole lender fully exits; the pool is liquid (cash back to 1000).
    direct_vm.sender = alice
    c.defund(1000 * TOK)
    assert int(c.get_pool()["total_funded"]) == 0

    before = c.get_pool()
    direct_vm.sender = borrower
    direct_vm.value = fee            # repay the fee-only debt
    c.repay()
    direct_vm.value = 0
    after = c.get_pool()

    d_rev = int(after["fee_revenue"]) - int(before["fee_revenue"])
    d_yield = int(after["yield_distributed"]) - int(before["yield_distributed"])
    assert d_yield == 0, "no lenders, yet yield was streamed"
    assert d_rev == fee, f"with no lenders the whole fee ({fee}) must be protocol revenue, got {d_rev}"
    assert int(c.pending_yield(addr_str(alice))) == 0


def test_inv10_defaulted_cannot_draw_and_indebted_cannot_rerequest(direct_vm, deployed, actors):
    """INV10 (deterministic): a defaulted borrower cannot draw; a borrower with
    outstanding debt cannot re-request credit."""
    owner, lenders, borrowers = actors
    c = deployed
    alice = lenders[0]
    borrower = borrowers[0]

    _fund(direct_vm, c, alice, 1000)
    set_chain_time("2026-01-01T00:00:00Z")
    _apply_and_assess(direct_vm, c, borrower, "A", tokens=500)
    direct_vm.sender = borrower
    c.draw(100 * TOK)

    # Debt outstanding -> cannot re-request.
    direct_vm.sender = borrower
    with direct_vm.expect_revert("settle the outstanding line"):
        c.request_credit(SAFE_PURPOSE, 200, "")

    # Push well past due + grace, then service into default.
    set_chain_time("2026-04-01T00:00:00Z")
    res = c.service_book(50)
    assert res["defaulted"] == 1
    assert c.get_borrower(addr_str(borrower))["status"] == "defaulted"

    # Defaulted -> cannot draw.
    direct_vm.sender = borrower
    with direct_vm.expect_revert("no approved credit line"):
        c.draw(10 * TOK)


def test_inv1_value_conservation_on_a_fixed_script(direct_vm, deployed, actors):
    """Deterministic smoke test of the conservation ledger: a hand-checked
    sequence of real value transfers lands exactly on the arithmetic."""
    owner, lenders, borrowers = actors
    c = deployed
    alice, bob, _ = lenders
    borrower = borrowers[0]

    _fund(direct_vm, c, alice, 1000)                 # +1000t
    _fund(direct_vm, c, bob, 500)                     # +500t
    _apply_and_assess(direct_vm, c, borrower, "AA", tokens=1000)
    direct_vm.sender = borrower
    out = c.draw(300 * TOK)                           # -300t
    fee = int(out["fee_accrued"])
    direct_vm.sender = bob
    c.defund(200 * TOK)                               # -200t
    direct_vm.sender = borrower
    direct_vm.value = 300 * TOK + fee                 # +(300t+fee)
    c.repay()
    direct_vm.value = 0
    direct_vm.sender = alice
    yv = int(c.pending_yield(addr_str(alice)))
    if yv > 0:
        out_claim = c.claim_yield()                   # -claimed
        claimed = int(out_claim["claimed"])
    else:
        claimed = 0

    expected = (1000 * TOK + 500 * TOK + (300 * TOK + fee)) \
        - (300 * TOK) - (200 * TOK) - claimed
    assert int(c.get_pool()["cash"]) == expected


# --------------------------------------------------------------------------- #
# DETERMINISTIC interest property tests: drive the SAME invariant battery over a
# hand-checked accrual scenario, so INV5(corrected)/INV11/INV12 and value
# conservation with interest live are pinned independently of the fuzz seed.
# --------------------------------------------------------------------------- #

def test_interest_invariants_hold_through_accrual_and_repay(direct_vm, deployed, actors):
    """With an APR enabled, interest accrues on an open line and the full invariant
    battery - including INV1 value conservation (interest is paid via repay value),
    INV11 (outstanding_interest == sum of interest_accrued) and INV12 (owed identity)
    - holds at every step, and clears exactly to the base unit when the line settles."""
    owner, lenders, borrowers = actors
    c = deployed
    alice = lenders[0]
    borrower = borrowers[0]
    m = Model(lenders, borrowers)

    # Owner enables a 20% APR.
    direct_vm.sender = owner
    direct_vm.value = 0
    c.set_interest_bps(2000)
    assert c.get_config()["interest_bps"] == 2000

    # Lender funds; open a line and draw.
    direct_vm.sender = alice
    direct_vm.value = 1000 * TOK
    c.fund()
    direct_vm.value = 0
    m.funded_in += 1000 * TOK
    m.funded[key(alice)] += 1000 * TOK
    m.n_harvests += 1
    _assert_invariants(c, m, note="after-fund")

    set_chain_time("2026-01-01T00:00:00Z")
    _apply_and_assess(direct_vm, c, borrower, "A", tokens=500)
    direct_vm.sender = borrower
    out = c.draw(100 * TOK)
    assert int(out["rate_bps"]) == 2000          # this line's APR is fixed at draw
    m.drawn_out += 100 * TOK
    _assert_invariants(c, m, note="after-draw")

    # Advance ~20 days and touch the line so interest accrues.
    set_chain_time("2026-01-21T00:00:00Z")
    direct_vm.sender = owner
    c.service_book(50)
    b = c.get_borrower(addr_str(borrower))
    accrued = int(b["interest_accrued"])
    assert accrued > 0, "interest should have accrued over ~20 days at 20% APR"
    assert int(b["owed"]) == int(b["principal"]) + int(b["fee_accrued"]) + accrued
    assert int(c.get_pool()["outstanding_interest"]) == accrued
    _assert_invariants(c, m, note="after-accrual")

    # Fully settle the line (principal + fee + interest). No clock advance since the
    # last touch, so repay accrues nothing further and the amount read is exact.
    owed = int(c.get_borrower(addr_str(borrower))["owed"])
    direct_vm.sender = borrower
    direct_vm.value = owed
    c.repay()
    direct_vm.value = 0
    m.repaid_in += owed
    b2 = c.get_borrower(addr_str(borrower))
    assert b2["owed"] == "0" and b2["interest_accrued"] == "0" and b2["principal"] == "0"
    assert int(c.get_pool()["outstanding_interest"]) == 0
    assert c.stats()["active_lines"] == 0
    # Interest was streamed to the lender on top of the fee share.
    assert int(c.pending_yield(addr_str(alice))) > 0
    _assert_invariants(c, m, note="after-settle")
    # Exact conservation to the base unit: cash == funds in + repay in - draw out.
    assert int(c.get_pool()["cash"]) == 1000 * TOK + owed - 100 * TOK


def test_interest_only_debt_blocks_new_credit_and_appeal(direct_vm, deployed, actors):
    """F1 (deterministic): a line whose ONLY remaining debt is accrued interest
    (principal 0, fee 0, interest > 0) must still count as an active line and must
    block BOTH request_credit and appeal until the interest is paid off."""
    owner, lenders, borrowers = actors
    c = deployed
    alice = lenders[0]
    borrower = borrowers[0]

    direct_vm.sender = owner
    direct_vm.value = 0
    c.set_interest_bps(2000)

    direct_vm.sender = alice
    direct_vm.value = 1000 * TOK
    c.fund()
    direct_vm.value = 0

    set_chain_time("2026-01-01T00:00:00Z")
    _apply_and_assess(direct_vm, c, borrower, "A", tokens=500)
    direct_vm.sender = borrower
    out = c.draw(100 * TOK)
    fee = int(out["fee_accrued"])
    assert fee == 2 * TOK

    # Accrue interest, then repay exactly principal + fee, leaving interest only.
    set_chain_time("2026-01-16T00:00:00Z")
    direct_vm.sender = owner
    c.service_book(50)
    assert int(c.get_borrower(addr_str(borrower))["interest_accrued"]) > 0
    direct_vm.sender = borrower
    direct_vm.value = 100 * TOK + fee
    c.repay()
    direct_vm.value = 0

    b = c.get_borrower(addr_str(borrower))
    assert b["principal"] == "0" and b["fee_accrued"] == "0" and int(b["interest_accrued"]) > 0
    assert int(b["owed"]) == int(b["interest_accrued"])
    # The F1-critical counting check: an interest-only line is still active.
    assert c.stats()["active_lines"] == 1
    assert int(c.get_pool()["active_lines"]) == 1

    # Interest-only debt must block a reassessment request AND an appeal.
    direct_vm.sender = borrower
    with direct_vm.expect_revert("settle the outstanding line"):
        c.request_credit(SAFE_PURPOSE, 200, "")
    direct_vm.sender = borrower
    with direct_vm.expect_revert("settle the outstanding line before appealing"):
        c.appeal()

    # Pay the remaining interest; the line now clears and frees up.
    owed = int(c.get_borrower(addr_str(borrower))["owed"])
    direct_vm.sender = borrower
    direct_vm.value = owed
    c.repay()
    direct_vm.value = 0
    assert c.stats()["active_lines"] == 0
    assert int(c.get_pool()["outstanding_interest"]) == 0
