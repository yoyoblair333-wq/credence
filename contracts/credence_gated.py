# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
CredenceGatedVault - a collateral-free allowlist gated on Credence's AI credit oracle.
======================================================================================

This is the composability proof for Credence: a SECOND Intelligent Contract that
CONSUMES Credence's creditworthiness oracle on-chain, with no collateral and no tokens
of its own. It is the concrete demonstration that Credence is "judgment-as-a-service"
other contracts can simply plug into.

A deterministic smart contract cannot judge a borrower, so every allowlist, perk or
undercollateralized privilege today has to fall back on a hard asset: a deposit, a lock,
a stake, or a manually curated whitelist. Credence removes that constraint. Because
`is_creditworthy` / `credit_of` are ordinary `@gl.public.view` methods, ANY contract can
read a live, consensus-underwritten credit grade with a single SYNCHRONOUS cross-contract
call and gate a real action on it:

    gl.get_contract_at(credence).view().is_creditworthy(borrower, min_grade)  # -> bool

`CredenceGatedVault` does exactly that. `claim()` admits the caller to a collateral-free
allowlist IFF Credence currently rates them at least `min_grade` and in good standing -
a privilege granted purely on AI-underwritten reputation, with nothing locked up. A
downstream vault would waive a deposit, unlock a perk, or raise a limit for admitted
members; here the admission record (grade + standing snapshot at claim time) IS the
granted privilege.

SAFETY. The oracle is the single source of truth: the vault stores no grades of its own
and trusts only what Credence returns at call time. Every address is validated
(`_addr_hex`), `min_grade` is validated against the canonical grade set, reads use the
typed `@gl.contract_interface` stub, ownership transfer is two-step, and every roster
read is bounded (`MAX_PAGE`). The gate reverts with a clear message when Credence does not
vouch for the caller - there is no way to self-admit around the oracle.

GenLayer referral: JTR01FHP   #CreditWithoutCollateral
"""

from dataclasses import dataclass
from typing import NoReturn

from genlayer import *


# --------------------------------------------------------------------------- #
# Constants (the grade set is Credence's; kept in sync for local validation)
# --------------------------------------------------------------------------- #

ERR = "[credence-gated]"

GRADES = ["DENY", "C", "B", "A", "AA", "AAA"]
GRADE_RANK = {g: i for i, g in enumerate(GRADES)}

DEFAULT_MIN_GRADE = "A"
MAX_PAGE = 50


# --------------------------------------------------------------------------- #
# Pure helpers (mirror Credence's hardening style)
# --------------------------------------------------------------------------- #

def _fail(msg: str) -> NoReturn:
    raise gl.vm.UserError(f"{ERR} {msg}")


def _addr_hex(raw) -> str:
    if not isinstance(raw, str):
        _fail("address must be text")
    v = raw.strip()
    if len(v) != 42 or v[:2].lower() != "0x" or any(c not in "0123456789abcdefABCDEF" for c in v[2:]):
        _fail("address must be 0x followed by 40 hex characters")
    return Address(v).as_hex


def _norm_grade(raw) -> str:
    g = str(raw).strip().upper()
    if g not in GRADE_RANK:
        _fail("grade must be one of " + ", ".join(GRADES))
    return g


def _now() -> str:
    return str(gl.message_raw["datetime"])


# --------------------------------------------------------------------------- #
# Typed interface to the Credence creditworthiness oracle. This stub provides no
# runtime behaviour (it resolves to `gl.get_contract_at`); it gives the
# cross-contract reads static types and documents exactly which Credence views
# this contract depends on.
# --------------------------------------------------------------------------- #

@gl.contract_interface
class ICredence:
    class View:
        def is_creditworthy(self, borrower: str, min_grade: str) -> bool: ...

        def credit_of(self, borrower: str) -> dict: ...

    class Write:
        pass


# --------------------------------------------------------------------------- #
# Events (observability). Emitted best-effort so a host that rejects an event can
# never break a state transition.
# --------------------------------------------------------------------------- #

class Admitted(gl.Event):
    def __init__(self, member: str, /, **blob): ...


def _emit(ev) -> None:
    try:
        ev.emit()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Storage record
# --------------------------------------------------------------------------- #

@allow_storage
@dataclass
class Member:
    addr: str
    grade: str            # Credence grade snapshot at admission
    grade_rank: u32
    standing: u32         # Credence standing (0-100) snapshot at admission
    seq: u32              # 1-based admission order
    admitted_at: str


# --------------------------------------------------------------------------- #
# Contract
# --------------------------------------------------------------------------- #

class CredenceGatedVault(gl.Contract):
    owner: Address
    pending_owner: Address
    credence: Address          # the Credence oracle this vault reads
    min_grade: str             # minimum grade required to be admitted
    members: TreeMap[str, Member]
    roster: DynArray[str]
    admitted_count: u32

    def __init__(self, credence: str, min_grade: str = DEFAULT_MIN_GRADE, owner: str = "") -> None:
        owner_addr = gl.message.sender_address if owner == "" else Address(_addr_hex(owner))
        self.owner = owner_addr
        self.pending_owner = owner_addr
        self.credence = Address(_addr_hex(credence))
        self.min_grade = _norm_grade(min_grade)
        self.admitted_count = u32(0)

    # ---------------------------------------------------------------- internals
    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            _fail("only the owner may call this")

    def _member_dict(self, m: Member) -> dict:
        return {"addr": m.addr, "grade": m.grade, "grade_rank": int(m.grade_rank),
                "standing": int(m.standing), "seq": int(m.seq), "admitted_at": m.admitted_at}

    # ----------------------------------------------------------- member-facing
    @gl.public.write
    def claim(self) -> dict:
        """Admit the caller to the collateral-free allowlist IFF Credence currently
        rates them at least `min_grade` and in good standing. The eligibility check
        is a SYNCHRONOUS cross-contract read of Credence's oracle - no collateral,
        no deposit, pure AI-underwritten reputation."""
        addr = gl.message.sender_address.as_hex
        if addr in self.members:
            _fail("already admitted")

        oracle = ICredence(self.credence)
        if not oracle.view().is_creditworthy(addr, self.min_grade):
            _fail(f"not creditworthy: Credence must rate you at least {self.min_grade} "
                  "and in good standing (not defaulted or overdue)")

        # Eligible: snapshot the live grade/standing from the same oracle for the record.
        rec = oracle.view().credit_of(addr)
        grade = _norm_grade(rec.get("grade", "DENY"))
        seq = u32(int(self.admitted_count) + 1)
        m = Member(addr=addr, grade=grade,
                   grade_rank=u32(GRADE_RANK[grade]),
                   standing=u32(max(0, min(100, int(rec.get("standing", 0))))),
                   seq=seq, admitted_at=_now())
        self.members[addr] = m
        self.roster.append(addr)
        self.admitted_count = seq
        _emit(Admitted(addr, grade=grade, min_grade=self.min_grade, seq=int(seq)))
        return self._member_dict(m)

    # -------------------------------------------------------------------- admin
    @gl.public.write
    def set_min_grade(self, min_grade: str) -> None:
        self._require_owner()
        self.min_grade = _norm_grade(min_grade)

    @gl.public.write
    def set_credence(self, credence: str) -> None:
        self._require_owner()
        self.credence = Address(_addr_hex(credence))

    @gl.public.write
    def transfer_ownership(self, new_owner: str) -> None:
        self._require_owner()
        self.pending_owner = Address(_addr_hex(new_owner))

    @gl.public.write
    def accept_ownership(self) -> None:
        if gl.message.sender_address != self.pending_owner or self.pending_owner == self.owner:
            _fail("only the nominated pending owner may accept ownership")
        self.owner = self.pending_owner

    # -------------------------------------------------------------------- views
    @gl.public.view
    def is_admitted(self, addr: str) -> bool:
        return _addr_hex(addr) in self.members

    @gl.public.view
    def get_member(self, addr: str) -> dict:
        a = _addr_hex(addr)
        if a not in self.members:
            _fail("no such admitted member")
        return self._member_dict(self.members[a])

    @gl.public.view
    def admitted_list(self, offset: int, limit: int) -> dict:
        """Bounded, paginated read of the admitted roster so indexers/UIs never force
        an unbounded scan. Returns up to MAX_PAGE members from `offset`."""
        n = len(self.roster)
        off = max(0, int(offset)) if isinstance(offset, int) else 0
        lim = int(limit) if isinstance(limit, int) and limit > 0 else MAX_PAGE
        lim = min(lim, MAX_PAGE)
        out = []
        k = off
        while k < n and len(out) < lim:
            out.append(self._member_dict(self.members[self.roster[k]]))
            k += 1
        return {"total": n, "offset": off, "next_offset": k if k < n else -1, "items": out}

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "owner": self.owner.as_hex, "pending_owner": self.pending_owner.as_hex,
            "credence": self.credence.as_hex, "min_grade": self.min_grade,
            "min_grade_rank": GRADE_RANK[self.min_grade], "grades": GRADES,
            "admitted": int(self.admitted_count),
        }
