# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
CredencePassport - a SOULBOUND on-chain Credit Passport for the Credence suite.
===============================================================================

This is the fourth Intelligent Contract in the Credence suite and its reputation
primitive: a NON-TRANSFERABLE "credit passport" that an address mints for ITSELF and
that permanently reflects that address's own Credence standing. Where
`CredenceGatedVault` CONSUMES the oracle to gate one action and `CredenceGovernor`
OWNS the core, `CredencePassport` turns a live Credence assessment into PORTABLE,
self-custodied reputation that any other contract, chain or agent can read.

WHY SOULBOUND. Creditworthiness is an attribute of a specific identity - a human or an
autonomous agent - and it must not be sellable, lendable or transferable, or the whole
notion of reputation collapses (you could simply buy a AAA passport). So this contract
has, by construction, NO transfer method and NO way to move a passport between
addresses: a passport is bound forever to the address that minted it. The ONLY writes
are `mint()` (first issuance, by the holder) and `refresh()` (the holder re-syncs their
own snapshot to their current Credence standing). There is no `transfer`, no `approve`,
no `safeTransferFrom`, no admin reassignment - the soulbound property is the core
feature, not a restriction bolted on afterwards.

HOW IT WORKS
    * A holder calls `mint()`. The contract performs a SYNCHRONOUS cross-contract read of
      the Credence oracle for the CALLER - `ICredence(self.credence).view().credit_of(
      sender)` (which resolves to `gl.get_contract_at(credence).view().credit_of(...)`) -
      and records a snapshot: {grade, grade_rank, standing, defaulted, ever_defaulted,
      known, minted_at, updated_at, refresh_count}. `mint()` reverts if the caller
      already holds a passport, or if Credence has never assessed them (`known == False`);
      you cannot passport an address Credence has never judged.
    * `refresh()` re-reads the same oracle and updates the holder's existing snapshot to
      their current standing, bumping `refresh_count`. Reputation that compounds on
      Credence stays reflected here on the holder's own passport.
    * `tier_at_least(addr, min_grade)` lets any consumer gate on the STORED snapshot with
      one view call; `passport_of` / `has_passport` / `holder_count` / `holders` expose
      the registry; `get_config` exposes the wiring.

USE CASE. An autonomous agent earns a credit standing on Credence, mints a passport, and
now carries verifiable, self-custodied creditworthiness it can present anywhere -
collateral-free onboarding, counterparty due-diligence, agent-to-agent trust - without
re-proving itself and without anyone being able to buy or move that reputation.

SAFETY. Reuses the suite's hardening verbatim: strict `0x`+40-hex address validation and
normalisation (`_addr_hex`), the typed `@gl.contract_interface` oracle stub, DEFENSIVE
reads of the untrusted cross-contract return (`grade` collapses to the safe floor DENY if
unrecognised, `standing` is clamped to 0..100), u256/u32-sized storage, `@allow_storage`
scalar-only dataclasses, best-effort events (a rejected event never breaks a state
transition), bounded paginated views (`MAX_PAGE`), two-step ownership transfer, and clear
prefixed reverts. The oracle is the single source of truth; the passport stores only what
Credence returned at mint/refresh time and derives `grade_rank` locally from the grade.

GenLayer referral: JTR01FHP   #CreditWithoutCollateral
"""

from dataclasses import dataclass
from typing import NoReturn

from genlayer import *


# --------------------------------------------------------------------------- #
# Constants (the grade set is Credence's; mirrored here for local validation)
# --------------------------------------------------------------------------- #

ERR = "[credence-passport]"

VERSION = "1.0.0"

GRADES = ["DENY", "C", "B", "A", "AA", "AAA"]
GRADE_RANK = {g: i for i, g in enumerate(GRADES)}

MAX_PAGE = 50
STANDING_MAX = 100


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
    """Strict grade validation for USER input (e.g. the tier_at_least threshold)."""
    g = str(raw).strip().upper()
    if g not in GRADE_RANK:
        _fail("grade must be one of " + ", ".join(GRADES))
    return g


def _grade_or_deny(raw) -> str:
    """Lenient grade read for the UNTRUSTED cross-contract oracle return: an
    unrecognised grade collapses to the safe floor DENY rather than reverting."""
    g = str(raw).strip().upper()
    return g if g in GRADE_RANK else "DENY"


def _as_int(v) -> int:
    """Coerce an untrusted oracle value to a plain int (bool is NOT an int here)."""
    return int(v) if isinstance(v, int) and not isinstance(v, bool) else 0


def _now() -> str:
    return str(gl.message_raw["datetime"])


# --------------------------------------------------------------------------- #
# Typed interface to the Credence creditworthiness oracle. Like the rest of the
# suite this stub provides no runtime behaviour (`@gl.contract_interface` resolves to
# `gl.get_contract_at`); it gives the cross-contract read a static type and documents
# exactly which Credence view this contract depends on.
# --------------------------------------------------------------------------- #

@gl.contract_interface
class ICredence:
    class View:
        def credit_of(self, borrower: str) -> dict: ...

    class Write:
        pass


# --------------------------------------------------------------------------- #
# Events (observability). Emitted best-effort so a host that rejects an event can
# never break a state transition (mirrors Credence).
# --------------------------------------------------------------------------- #

class PassportMinted(gl.Event):
    def __init__(self, holder: str, /, **blob): ...


class PassportRefreshed(gl.Event):
    def __init__(self, holder: str, /, **blob): ...


def _emit(ev) -> None:
    try:
        ev.emit()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Storage record. Scalar fields only (@allow_storage), u256/u32-sized, so the
# dataclass stays a flat, auditable storage proxy - the suite's style.
# --------------------------------------------------------------------------- #

@allow_storage
@dataclass
class Passport:
    addr: str
    grade: str             # Credence grade snapshot (DENY/C/B/A/AA/AAA)
    grade_rank: u32        # derived locally from grade (0..5)
    standing: u32          # Credence standing snapshot (0..100)
    defaulted: bool        # was the address in default at snapshot time
    ever_defaulted: bool   # has the address ever defaulted (per Credence)
    known: bool            # Credence had assessed the address (always True once minted)
    seq: u32               # 1-based issuance order
    refresh_count: u32     # number of times the holder has refreshed
    minted_at: str         # consensus datetime of first issuance
    updated_at: str        # consensus datetime of the latest mint/refresh


# --------------------------------------------------------------------------- #
# Contract
# --------------------------------------------------------------------------- #

class CredencePassport(gl.Contract):
    owner: Address
    pending_owner: Address
    credence: Address               # the Credence oracle this passport reads
    holders_count: u32              # monotonic issuance counter (== len(roster))
    passports: TreeMap[str, Passport]
    roster: DynArray[str]

    def __init__(self, credence: str, owner: str = "") -> None:
        owner_addr = gl.message.sender_address if owner == "" else Address(_addr_hex(owner))
        self.owner = owner_addr
        self.pending_owner = owner_addr
        self.credence = Address(_addr_hex(credence))
        self.holders_count = u32(0)

    # ---------------------------------------------------------------- internals
    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            _fail("only the owner may call this")

    def _snapshot_from_oracle(self, addr: str) -> dict:
        """Synchronous cross-contract read of Credence's creditworthiness oracle for
        `addr`. `ICredence(self.credence)` resolves to `gl.get_contract_at(...)`; the
        returned dict is UNTRUSTED data and is read defensively."""
        rec = ICredence(self.credence).view().credit_of(addr)
        if not isinstance(rec, dict):
            _fail("Credence oracle returned an unexpected result")
        grade = _grade_or_deny(rec.get("grade", "DENY"))
        return {
            "known": bool(rec.get("known", False)),
            "grade": grade,
            "grade_rank": GRADE_RANK[grade],
            "standing": max(0, min(STANDING_MAX, _as_int(rec.get("standing", 0)))),
            "defaulted": bool(rec.get("defaulted", False)),
            "ever_defaulted": bool(rec.get("ever_defaulted", False)),
        }

    def _passport_dict(self, p: Passport) -> dict:
        return {
            "addr": p.addr, "held": True, "known": p.known,
            "grade": p.grade, "grade_rank": int(p.grade_rank),
            "standing": int(p.standing), "defaulted": p.defaulted,
            "ever_defaulted": p.ever_defaulted, "seq": int(p.seq),
            "refresh_count": int(p.refresh_count),
            "minted_at": p.minted_at, "updated_at": p.updated_at,
        }

    # ------------------------------------------------------------ holder-facing
    @gl.public.write
    def mint(self) -> dict:
        """First issuance: the CALLER mints their own soulbound passport from their live
        Credence standing. Reverts if they already hold one, or if Credence has never
        assessed them (`credit_of.known == False`). One passport per address, forever."""
        addr = gl.message.sender_address.as_hex
        if addr in self.passports:
            _fail("this address already holds a passport (one per address; call refresh() to update it)")
        snap = self._snapshot_from_oracle(addr)
        if not snap["known"]:
            _fail("Credence has never assessed this address; request and pass an assessment before minting a passport")
        now = _now()
        seq = u32(int(self.holders_count) + 1)
        p = Passport(
            addr=addr, grade=snap["grade"], grade_rank=u32(snap["grade_rank"]),
            standing=u32(snap["standing"]), defaulted=snap["defaulted"],
            ever_defaulted=snap["ever_defaulted"], known=True, seq=seq,
            refresh_count=u32(0), minted_at=now, updated_at=now)
        self.passports[addr] = p
        self.roster.append(addr)
        self.holders_count = seq
        _emit(PassportMinted(addr, grade=snap["grade"], grade_rank=snap["grade_rank"],
                             standing=snap["standing"], seq=int(seq)))
        return self._passport_dict(p)

    @gl.public.write
    def refresh(self) -> dict:
        """The CALLER re-syncs their own passport to their current Credence standing.
        Reverts if they hold no passport, or if the (possibly migrated) oracle no longer
        recognises them, so a held passport always reflects a real Credence assessment."""
        addr = gl.message.sender_address.as_hex
        if addr not in self.passports:
            _fail("no passport to refresh; call mint() first")
        snap = self._snapshot_from_oracle(addr)
        if not snap["known"]:
            _fail("Credence no longer recognises this address (oracle migrated?); cannot refresh")
        p = self.passports[addr]
        p.grade = snap["grade"]
        p.grade_rank = u32(snap["grade_rank"])
        p.standing = u32(snap["standing"])
        p.defaulted = snap["defaulted"]
        p.ever_defaulted = snap["ever_defaulted"]
        p.known = True
        p.refresh_count = u32(int(p.refresh_count) + 1)
        p.updated_at = _now()
        _emit(PassportRefreshed(addr, grade=snap["grade"], grade_rank=snap["grade_rank"],
                                standing=snap["standing"], refresh_count=int(p.refresh_count)))
        return self._passport_dict(p)

    # -------------------------------------------------------------------- admin
    @gl.public.write
    def set_credence(self, credence: str) -> None:
        """Owner-only: re-point the oracle (in case the Credence core migrates). Existing
        passports keep their recorded snapshots; new mint/refresh reads hit the new core."""
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
    def passport_of(self, addr: str) -> dict:
        """The stored snapshot for `addr`. Returns a safe, composable `held: False`
        record for an address that has never minted (no revert), mirroring Credence's
        `credit_of` unknown-record style."""
        a = _addr_hex(addr)
        if a not in self.passports:
            return {"addr": a, "held": False, "known": False, "grade": "DENY",
                    "grade_rank": 0, "standing": 0, "defaulted": False,
                    "ever_defaulted": False, "seq": 0, "refresh_count": 0,
                    "minted_at": "", "updated_at": ""}
        return self._passport_dict(self.passports[a])

    @gl.public.view
    def has_passport(self, addr: str) -> bool:
        return _addr_hex(addr) in self.passports

    @gl.public.view
    def holder_count(self) -> int:
        return len(self.roster)

    @gl.public.view
    def tier_at_least(self, addr: str, min_grade: str) -> bool:
        """Convenience gate reading the STORED passport snapshot (not a live oracle
        call): True iff `addr` holds a passport whose snapshot grade is at least
        `min_grade`. Consumers wanting the live standing should read Credence directly."""
        mg = _norm_grade(min_grade)
        a = _addr_hex(addr)
        if a not in self.passports:
            return False
        return int(self.passports[a].grade_rank) >= GRADE_RANK[mg]

    @gl.public.view
    def holders(self, offset: int, limit: int) -> dict:
        """Bounded, paginated read of the passport-holder roster so indexers/UIs never
        force an unbounded scan. Returns up to MAX_PAGE holders from `offset`."""
        n = len(self.roster)
        off = max(0, int(offset)) if isinstance(offset, int) else 0
        lim = int(limit) if isinstance(limit, int) and limit > 0 else MAX_PAGE
        lim = min(lim, MAX_PAGE)
        out = []
        k = off
        while k < n and len(out) < lim:
            out.append(self._passport_dict(self.passports[self.roster[k]]))
            k += 1
        return {"total": n, "offset": off, "next_offset": k if k < n else -1, "items": out}

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "version": VERSION,
            "owner": self.owner.as_hex, "pending_owner": self.pending_owner.as_hex,
            "credence": self.credence.as_hex,
            "holder_count": len(self.roster),
            "grades": GRADES, "soulbound": True,
        }
