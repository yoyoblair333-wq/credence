# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
CreditPassport - a standalone, SOULBOUND credit-grade registry for GenLayer.
===========================================================================

A small registry that binds one non-transferable credit passport to an address and lets
ANY other contract, dApp or agent read that address's grade with a single view call.
Extracted from the Credence suite's CredencePassport and made independent of it.

GRADES (lowest to highest): DENY, C, B, A, AA, AAA. Each passport stores a grade, its
rank (0..5), a standing score (0..100), whether the address is in default now, whether
it has EVER defaulted (sticky: it can never be cleared), a short memo, who wrote it, and
when.

TWO WAYS A PASSPORT IS WRITTEN
    1. ISSUER MODE (always on). The owner approves issuer addresses. An issuer calls
       `issue(holder, grade, standing, defaulted, memo)` to create or update a
       holder's passport, and `revoke(holder, reason)` to withdraw it. A revoked
       passport keeps its history but reads as DENY and fails every tier gate.
    2. ORACLE MODE (optional). If the owner sets an `oracle` contract that exposes
       `credit_of(addr) -> {known, grade, standing, defaulted, ever_defaulted}` (the
       Credence core does), a holder may call `mint()` / `refresh()` to snapshot their
       OWN standing from that oracle through a synchronous cross-contract read. The
       oracle's reply is treated as untrusted data: an unknown grade collapses to DENY
       and standing is clamped to 0..100.

SOULBOUND BY CONSTRUCTION. There is no transfer, approve or reassignment method. A
passport is bound forever to its address. Holders cannot write their own grade; they
can only pull a snapshot from the configured oracle.

READING A GRADE (from another contract):
    p = gl.get_contract_at(PASSPORT).view().passport_of(addr_hex)
    ok = gl.get_contract_at(PASSPORT).view().tier_at_least(addr_hex, "A")
"""

from dataclasses import dataclass
from typing import NoReturn

from genlayer import *


# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

ERR = "[credit-passport]"
VERSION = "1.0.0"

GRADES = ["DENY", "C", "B", "A", "AA", "AAA"]
GRADE_RANK = {g: i for i, g in enumerate(GRADES)}

STANDING_MAX = 100
MAX_PAGE = 50
MAX_MEMO = 140
MAX_ISSUERS = 32

SOURCE_ISSUER = "issuer"
SOURCE_ORACLE = "oracle"


# --------------------------------------------------------------------------- #
# Pure helpers
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
    """Strict grade validation for trusted callers' input."""
    g = str(raw).strip().upper()
    if g not in GRADE_RANK:
        _fail("grade must be one of " + ", ".join(GRADES))
    return g


def _grade_or_deny(raw) -> str:
    """Lenient grade read for an UNTRUSTED oracle reply: unknown -> DENY."""
    g = str(raw).strip().upper()
    return g if g in GRADE_RANK else "DENY"


def _as_int(v) -> int:
    """Coerce an untrusted oracle value to int (bool is NOT an int here)."""
    return int(v) if isinstance(v, int) and not isinstance(v, bool) else 0


def _memo(raw) -> str:
    if not isinstance(raw, str):
        _fail("memo must be text")
    m = " ".join(raw.split())
    if len(m) > MAX_MEMO:
        _fail(f"memo must be at most {MAX_MEMO} characters")
    return m


def _now() -> str:
    return str(gl.message_raw["datetime"])


# --------------------------------------------------------------------------- #
# Events (best-effort: a rejected event never breaks a state change)
# --------------------------------------------------------------------------- #

class PassportWritten(gl.Event):
    def __init__(self, holder: str, /, **blob): ...


class PassportRevoked(gl.Event):
    def __init__(self, holder: str, /, **blob): ...


def _emit(ev) -> None:
    try:
        ev.emit()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #

@allow_storage
@dataclass
class Passport:
    addr: str
    grade: str             # DENY/C/B/A/AA/AAA
    grade_rank: u32        # 0..5, derived from grade
    standing: u32          # 0..100
    defaulted: bool        # in default as of the latest write
    ever_defaulted: bool   # sticky: once True, never cleared
    revoked: bool          # withdrawn by an issuer or the owner
    source: str            # "issuer" | "oracle" (latest write)
    written_by: str        # issuer address, or the oracle address
    memo: str              # issuer note / revocation reason
    seq: u32               # 1-based issuance order
    update_count: u32      # writes after the first
    minted_at: str         # consensus datetime of first issuance
    updated_at: str        # consensus datetime of the latest write


# --------------------------------------------------------------------------- #
# Contract
# --------------------------------------------------------------------------- #

class CreditPassport(gl.Contract):
    owner: Address
    pending_owner: Address
    oracle: str                      # "" = oracle mode disabled
    issuers: TreeMap[str, bool]
    issuer_list: DynArray[str]
    passports: TreeMap[str, Passport]
    roster: DynArray[str]

    def __init__(self, owner: str = "", oracle: str = "") -> None:
        o = gl.message.sender_address if owner == "" else Address(_addr_hex(owner))
        self.owner = o
        self.pending_owner = o
        self.oracle = "" if oracle == "" else _addr_hex(oracle)

    # ---------------------------------------------------------------- internals
    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            _fail("only the owner may call this")

    def _require_issuer(self) -> str:
        me = gl.message.sender_address.as_hex
        if not self.issuers.get(me, False):
            _fail("only an approved issuer may call this")
        return me

    def _write(self, holder: str, grade: str, standing: int, defaulted: bool, ever: bool,
               source: str, by: str, memo: str) -> Passport:
        now = _now()
        p = self.passports.get(holder)
        if p is None:
            self.passports[holder] = Passport(
                addr=holder, grade=grade, grade_rank=u32(GRADE_RANK[grade]), standing=u32(standing),
                defaulted=defaulted, ever_defaulted=ever or defaulted, revoked=False, source=source,
                written_by=by, memo=memo, seq=u32(len(self.roster) + 1), update_count=u32(0),
                minted_at=now, updated_at=now)
            self.roster.append(holder)
            p = self.passports[holder]
        else:
            p.grade = grade
            p.grade_rank = u32(GRADE_RANK[grade])
            p.standing = u32(standing)
            p.defaulted = defaulted
            p.ever_defaulted = p.ever_defaulted or ever or defaulted
            p.revoked = False
            p.source = source
            p.written_by = by
            p.memo = memo
            p.update_count = u32(int(p.update_count) + 1)
            p.updated_at = now
        _emit(PassportWritten(holder, grade=grade, standing=standing, source=source, by=by))
        return p

    def _snapshot_from_oracle(self, holder: str) -> dict:
        if self.oracle == "":
            _fail("oracle mode is disabled; ask an approved issuer to issue your passport")
        rec = gl.get_contract_at(Address(self.oracle)).view().credit_of(holder)
        if not isinstance(rec, dict):
            _fail("oracle returned an unexpected result")
        grade = _grade_or_deny(rec.get("grade", "DENY"))
        return {
            "known": rec.get("known", False) is True,
            "grade": grade,
            "standing": max(0, min(STANDING_MAX, _as_int(rec.get("standing", 0)))),
            "defaulted": rec.get("defaulted", False) is True,
            "ever_defaulted": rec.get("ever_defaulted", False) is True,
        }

    def _dict(self, p: Passport) -> dict:
        active = not p.revoked
        return {
            "addr": p.addr, "held": True, "active": active,
            "grade": p.grade if active else "DENY",
            "grade_rank": int(p.grade_rank) if active else 0,
            "recorded_grade": p.grade,
            "standing": int(p.standing), "defaulted": p.defaulted,
            "ever_defaulted": p.ever_defaulted, "revoked": p.revoked,
            "source": p.source, "written_by": p.written_by, "memo": p.memo,
            "seq": int(p.seq), "update_count": int(p.update_count),
            "minted_at": p.minted_at, "updated_at": p.updated_at,
        }

    # ------------------------------------------------------------- issuer mode
    @gl.public.write
    def issue(self, holder: str, grade: str, standing: int, defaulted: bool, memo: str = "") -> dict:
        """Approved issuer: create or update `holder`'s passport. Re-issuing a revoked
        passport reinstates it. `ever_defaulted` is sticky and can never be cleared."""
        by = self._require_issuer()
        h = _addr_hex(holder)
        g = _norm_grade(grade)
        if not isinstance(standing, int) or isinstance(standing, bool) or not (0 <= standing <= STANDING_MAX):
            _fail(f"standing must be an integer 0..{STANDING_MAX}")
        if not isinstance(defaulted, bool):
            _fail("defaulted must be true or false")
        return self._dict(self._write(h, g, standing, defaulted, False, SOURCE_ISSUER, by, _memo(memo)))

    @gl.public.write
    def revoke(self, holder: str, reason: str = "") -> dict:
        """Approved issuer or owner: withdraw a passport. History is kept; the passport
        reads as DENY and fails every tier gate until an issuer re-issues it."""
        me = gl.message.sender_address.as_hex
        if gl.message.sender_address != self.owner and not self.issuers.get(me, False):
            _fail("only an approved issuer or the owner may revoke")
        h = _addr_hex(holder)
        p = self.passports.get(h)
        if p is None:
            _fail("no passport to revoke")
        if p.revoked:
            _fail("passport is already revoked")
        p.revoked = True
        p.memo = _memo(reason)
        p.written_by = me
        p.update_count = u32(int(p.update_count) + 1)
        p.updated_at = _now()
        _emit(PassportRevoked(h, by=me))
        return self._dict(p)

    # ------------------------------------------------------------- oracle mode
    @gl.public.write
    def mint(self) -> dict:
        """Holder: first issuance from the configured oracle's assessment of the CALLER.
        Reverts if a passport exists, oracle mode is off, or the oracle does not know you."""
        h = gl.message.sender_address.as_hex
        if h in self.passports:
            _fail("this address already holds a passport (call refresh() to update it)")
        s = self._snapshot_from_oracle(h)
        if not s["known"]:
            _fail("the oracle has never assessed this address")
        return self._dict(self._write(h, s["grade"], s["standing"], s["defaulted"], s["ever_defaulted"],
                                      SOURCE_ORACLE, self.oracle, ""))

    @gl.public.write
    def refresh(self) -> dict:
        """Holder: re-sync your own passport to the oracle's current assessment. A revoked
        passport cannot be self-refreshed; only an issuer can reinstate it."""
        h = gl.message.sender_address.as_hex
        p = self.passports.get(h)
        if p is None:
            _fail("no passport to refresh; call mint() first")
        if p.revoked:
            _fail("passport is revoked; only an issuer can reinstate it")
        s = self._snapshot_from_oracle(h)
        if not s["known"]:
            _fail("the oracle no longer recognises this address")
        return self._dict(self._write(h, s["grade"], s["standing"], s["defaulted"], s["ever_defaulted"],
                                      SOURCE_ORACLE, self.oracle, ""))

    # -------------------------------------------------------------------- admin
    @gl.public.write
    def add_issuer(self, issuer: str) -> None:
        self._require_owner()
        a = _addr_hex(issuer)
        if a not in self.issuers:
            if len(self.issuer_list) >= MAX_ISSUERS:
                _fail("issuer list is full")
            self.issuer_list.append(a)
        self.issuers[a] = True

    @gl.public.write
    def remove_issuer(self, issuer: str) -> None:
        self._require_owner()
        a = _addr_hex(issuer)
        if not self.issuers.get(a, False):
            _fail("not an approved issuer")
        self.issuers[a] = False

    @gl.public.write
    def set_oracle(self, oracle: str) -> None:
        """Owner: point oracle mode at a contract exposing credit_of(addr), or "" to disable."""
        self._require_owner()
        self.oracle = "" if oracle.strip() == "" else _addr_hex(oracle)

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
    def passport_of(self, addr: str) -> dict:
        """Stored passport for `addr`. Never reverts for an unknown address: returns a
        safe `held: False`, grade DENY record so consumers can gate without try/except."""
        a = _addr_hex(addr)
        p = self.passports.get(a)
        if p is None:
            return {"addr": a, "held": False, "active": False, "grade": "DENY", "grade_rank": 0,
                    "recorded_grade": "", "standing": 0, "defaulted": False, "ever_defaulted": False,
                    "revoked": False, "source": "", "written_by": "", "memo": "", "seq": 0,
                    "update_count": 0, "minted_at": "", "updated_at": ""}
        return self._dict(p)

    @gl.public.view
    def grade_of(self, addr: str) -> str:
        """Effective grade: DENY if no passport or revoked."""
        p = self.passports.get(_addr_hex(addr))
        return "DENY" if p is None or p.revoked else p.grade

    @gl.public.view
    def tier_at_least(self, addr: str, min_grade: str) -> bool:
        """True iff `addr` holds an ACTIVE passport with grade >= `min_grade`."""
        mg = _norm_grade(min_grade)
        p = self.passports.get(_addr_hex(addr))
        if p is None or p.revoked:
            return False
        return int(p.grade_rank) >= GRADE_RANK[mg]

    @gl.public.view
    def has_passport(self, addr: str) -> bool:
        """True iff `addr` was ever issued a passport (including a revoked one)."""
        return _addr_hex(addr) in self.passports

    @gl.public.view
    def holder_count(self) -> int:
        return len(self.roster)

    @gl.public.view
    def holders(self, offset: int = 0, limit: int = MAX_PAGE) -> dict:
        n = len(self.roster)
        off = max(0, offset)
        lim = MAX_PAGE if limit <= 0 else min(limit, MAX_PAGE)
        items = [self._dict(self.passports[self.roster[k]]) for k in range(off, min(n, off + lim))]
        nxt = off + len(items)
        return {"total": n, "offset": off, "next_offset": nxt if nxt < n else -1, "items": items}

    @gl.public.view
    def is_issuer(self, addr: str) -> bool:
        return self.issuers.get(_addr_hex(addr), False)

    @gl.public.view
    def list_issuers(self) -> list:
        return [a for a in self.issuer_list if self.issuers.get(a, False)]

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "version": VERSION,
            "owner": self.owner.as_hex, "pending_owner": self.pending_owner.as_hex,
            "oracle": self.oracle, "oracle_mode": self.oracle != "",
            "issuers": [a for a in self.issuer_list if self.issuers.get(a, False)],
            "holder_count": len(self.roster),
            "grades": GRADES, "soulbound": True,
        }
