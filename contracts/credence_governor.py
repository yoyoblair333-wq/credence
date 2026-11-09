# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
CredenceGovernor - an on-chain M-of-N multisig that owns and governs Credence.
==============================================================================

Credence gates every treasury / economic / lifecycle action behind a SINGLE owner
address (`gl.message.sender_address == self.owner`). For an enterprise or a DAO that is
a single point of failure: one lost or compromised key can pause the protocol, rewrite
its economics, drain accrued fees, or hand ownership away. `CredenceGovernor` removes
that single point of failure WITHOUT changing a line of Credence.

The pattern is deliberately simple and auditable. Credence only ever checks that the
*message sender* is its owner, so if Credence's ownership is transferred to a deployed
`CredenceGovernor` instance (Credence owner calls `transfer_ownership(governor)`, then the
governor calls Credence's `accept_ownership()`), then EVERY owner-only Credence call the
governor emits arrives with `sender_address == governor == Credence.owner` and passes.
Ownership of Credence therefore becomes "whatever an M-of-N quorum of signers agrees to",
with no bespoke access-control code inside Credence itself.

HOW IT WORKS
    1. A fixed set of N signer addresses and a threshold M (1 <= M <= N) are set at
       construction and are IMMUTABLE for v1 (see "WHY IMMUTABLE" below).
    2. Any signer `propose`s exactly one action from a fixed ALLOWED set, each mapping to
       one Credence admin method. The action's arguments are decoded and validated at
       propose time and stored verbatim; the proposer auto-approves.
    3. Signers `approve` a pending proposal (idempotent; one approval per signer).
    4. Once approvals >= threshold, any signer may `execute` it. Execution dispatches the
       stored action to Credence as an ASYNCHRONOUS, finalized cross-contract write
       (`gl.get_contract_at(credence).emit(on="finalized").<method>(...)`), marks the
       proposal executed, and emits a `GovExecuted` event. A proposal executes at most
       once (checks-effects-interactions: status is flipped BEFORE the external call).

ALLOWED ACTIONS (each -> one Credence owner-only method)
    set_paused(bool) · set_autonomous(bool) · set_guardian(addr) · set_relayer(addr) ·
    set_dev(addr) · set_risk_limits(max_utilization_bps) ·
    set_terms(lender_share_bps, term_seconds, grace_seconds) ·
    withdraw_fees(to, amount) · transfer_ownership(new_owner) ·
    accept_ownership_of_credence()  [-> Credence.accept_ownership(), the bootstrap step]

WHY IMMUTABLE SIGNERS (v1). Keeping the signer set and threshold immutable makes the
contract dramatically easier to audit: there is no governance-of-the-governance surface,
no way for a quorum to silently lower the threshold or add a colluding key, and the trust
assumptions are fixed and legible at deploy time. Rotating signers is a deliberate,
transparent act: deploy a fresh governor and move Credence ownership to it via a
`transfer_ownership` proposal on the old governor. A future v2 could add
add_signer / remove_signer / set_threshold as governed actions; v1 intentionally does not.

SAFETY. Reuses Credence's hardening style verbatim: strict `0x`+40-hex address validation
and normalisation, a closed ALLOWED action set (unknown actions revert), per-action arg
arity + range validation at propose time (malformed args can never be stored), u256/u32
sized storage, `@allow_storage` dataclasses with scalar fields only, bounded paginated
views, and clear reverts. Only signers can propose / approve / execute. The external
Credence call is emitted LAST, after the proposal is durably marked executed.

GenLayer referral: JTR01FHP   #CreditWithoutCollateral
"""

import json
from dataclasses import dataclass
from typing import NoReturn

from genlayer import *


# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

ERR = "[credence-gov]"

VERSION = "1.0.0"

MAX_SIGNERS = 50          # keeps get_signers / signer iteration bounded
MAX_PAGE = 50             # bound on list_proposals
U256_MAX = (1 << 256) - 1
U64_MAX = (1 << 64) - 1
U32_MAX = (1 << 32) - 1

# Credence's own documented bounds + storage widths, mirrored here so a proposal whose
# arguments fall outside Credence's STORABLE/documented range is rejected at propose time
# rather than stored and then reverted on Credence's side (defense in depth + clearer UX).
# This covers STATIC argument ranges only; actions that also have a Credence RUNTIME
# precondition are documented on `execute`.
BPS_MAX = 10000

# The closed set of actions a proposal may carry. Each maps 1:1 to a Credence method.
# "accept_ownership_of_credence" maps to Credence.accept_ownership() (the bootstrap by
# which the governor claims ownership that Credence's current owner transferred to it).
ALLOWED = (
    "set_paused",
    "set_autonomous",
    "set_guardian",
    "set_relayer",
    "set_dev",
    "set_risk_limits",
    "set_terms",
    "withdraw_fees",
    "transfer_ownership",
    "accept_ownership_of_credence",
)

# Actions whose single argument is an address.
_ADDR_REQUIRED = ("set_guardian", "set_relayer", "set_dev", "transfer_ownership")
# Actions that take no address at all.
_ADDR_NONE = ("set_paused", "set_autonomous", "set_risk_limits", "set_terms",
              "accept_ownership_of_credence")
# Actions that consume `bool_arg`; every other action must leave it at its default.
_BOOL_CONSUMERS = ("set_paused", "set_autonomous")


# --------------------------------------------------------------------------- #
# Typed interface to the Credence admin surface. Like `credence_gated.py`'s stub this
# provides no runtime behaviour - `@gl.contract_interface` resolves to
# `gl.get_contract_at` - but it gives every cross-contract write a static signature and
# documents exactly which Credence methods this governor is allowed to drive.
# --------------------------------------------------------------------------- #

@gl.contract_interface
class ICredence:
    class View:
        def get_config(self) -> dict: ...

    class Write:
        def set_paused(self, paused: bool) -> None: ...

        def set_autonomous(self, on: bool) -> None: ...

        def set_guardian(self, guardian: str) -> None: ...

        def set_relayer(self, relayer: str) -> None: ...

        def set_dev(self, dev: str) -> None: ...

        def set_risk_limits(self, max_utilization_bps: int) -> None: ...

        def set_terms(self, lender_share_bps: int, term_seconds: int,
                      grace_seconds: int) -> None: ...

        def withdraw_fees(self, to: str, amount: int) -> None: ...

        def transfer_ownership(self, new_owner: str) -> None: ...

        def accept_ownership(self) -> None: ...


# --------------------------------------------------------------------------- #
# Events (observability). Emitted best-effort: a host that rejects an event must never
# break a state transition, so `_emit` swallows failures (mirrors Credence).
# --------------------------------------------------------------------------- #

class GovProposed(gl.Event):
    def __init__(self, proposer: str, /, **blob): ...


class GovApproved(gl.Event):
    def __init__(self, signer: str, /, **blob): ...


class GovExecuted(gl.Event):
    def __init__(self, executor: str, /, **blob): ...


def _emit(ev) -> None:
    try:
        ev.emit()
    except Exception:
        pass


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


def _now() -> str:
    return str(gl.message_raw["datetime"])


def _is_int(v) -> bool:
    """A real integer (JSON `true`/`false` deserialize to bool, a subclass of int, and
    must never be accepted where an integer argument is required)."""
    return isinstance(v, int) and not isinstance(v, bool)


def _parse_signers(raw) -> list:
    """Accept either a comma-separated list of hex addresses or a JSON array string.
    Validate + normalise each to canonical hex, dedupe preserving order, bound the count."""
    if not isinstance(raw, str):
        _fail("signers must be text (comma-separated hex or a JSON array string)")
    s = raw.strip()
    if s == "":
        _fail("signers cannot be empty")
    if s[0] == "[":
        try:
            parts = json.loads(s)
        except Exception:
            _fail("signers JSON array is malformed")
        if not isinstance(parts, list):
            _fail("signers JSON must be an array of address strings")
    else:
        parts = [p for p in s.split(",")]
    out: list = []
    seen: set = set()
    for p in parts:
        if not isinstance(p, str):
            _fail("each signer must be an address string")
        if p.strip() == "":
            continue
        a = _addr_hex(p)
        if a not in seen:
            seen.add(a)
            out.append(a)
    if not out:
        _fail("at least one valid signer is required")
    if len(out) > MAX_SIGNERS:
        _fail(f"at most {MAX_SIGNERS} signers are allowed")
    return out


def _norm_action(raw) -> str:
    if not isinstance(raw, str):
        _fail("action must be text")
    a = raw.strip()
    if a not in ALLOWED:
        _fail("unknown action; allowed: " + ", ".join(ALLOWED))
    return a


def _parse_uint_args(raw) -> list:
    """Decode uint_args_json into a list of non-negative, uint256-bounded integers."""
    if not isinstance(raw, str):
        _fail("uint_args_json must be a JSON array string")
    s = raw.strip()
    if s == "":
        return []
    try:
        arr = json.loads(s)
    except Exception:
        _fail("uint_args_json must be a JSON array of integers")
    if not isinstance(arr, list):
        _fail("uint_args_json must be a JSON array")
    out: list = []
    for v in arr:
        if not _is_int(v):
            _fail("uint_args_json must contain only integers")
        if v < 0:
            _fail("uint_args_json values must be non-negative")
        if v > U256_MAX:
            _fail("uint_args_json value exceeds the uint256 range")
        out.append(int(v))
    return out


def _require_arity(action: str, uints: list, n: int) -> None:
    if len(uints) != n:
        _fail(f"{action} expects exactly {n} integer argument(s), got {len(uints)}")


def _decode_args(action: str, address_arg, uint_args_json, bool_arg) -> tuple:
    """Validate the raw proposal arguments for `action` and return the canonical
    (address_hex_or_blank, [uint, ...]) to store. Raises on any malformed input so a
    bad proposal can never be persisted."""
    if not isinstance(address_arg, str):
        _fail("address_arg must be text")
    has_addr = address_arg.strip() != ""
    # Catch an argument attached to an action that ignores it (a governance footgun).
    if action not in _BOOL_CONSUMERS and bool(bool_arg):
        _fail(f"{action} takes no bool_arg")
    uints = _parse_uint_args(uint_args_json)

    if action in _ADDR_REQUIRED:
        _require_arity(action, uints, 0)
        if not has_addr:
            _fail(f"{action} requires address_arg (a 0x address)")
        return _addr_hex(address_arg), uints

    if action == "set_risk_limits":
        _require_arity(action, uints, 1)
        if has_addr:
            _fail("set_risk_limits takes no address_arg")
        if not (0 <= uints[0] <= BPS_MAX):
            _fail(f"max_utilization_bps must be between 0 and {BPS_MAX}")
        return "", uints

    if action == "set_terms":
        _require_arity(action, uints, 3)
        if has_addr:
            _fail("set_terms takes no address_arg")
        if not (0 <= uints[0] <= BPS_MAX):
            _fail(f"lender_share_bps must be between 0 and {BPS_MAX}")
        if not (0 < uints[1] <= U64_MAX):
            _fail("term_seconds must be a positive integer within the uint64 range")
        # grace_seconds (uints[2]) is already non-negative; bound it to Credence's u64 too.
        if uints[2] > U64_MAX:
            _fail("grace_seconds must be within the uint64 range")
        return "", uints

    if action == "withdraw_fees":
        _require_arity(action, uints, 1)
        if uints[0] <= 0:
            _fail("withdraw amount must be a positive integer (base units)")
        # `to` is optional: an empty address_arg tells Credence to route to its `dev`.
        return ("" if not has_addr else _addr_hex(address_arg)), uints

    # set_paused / set_autonomous / accept_ownership_of_credence: no address, no uints.
    _require_arity(action, uints, 0)
    if has_addr:
        _fail(f"{action} takes no address_arg")
    return "", uints


# --------------------------------------------------------------------------- #
# Storage record. Scalar fields only (JSON strings for the decoded arg vector and the
# approvals set) so the dataclass stays a flat, auditable storage proxy - exactly the
# style Credence uses for its `votes_json` / `evidence_json`.
# --------------------------------------------------------------------------- #

@allow_storage
@dataclass
class Proposal:
    id: u256
    action: str
    address_arg: str          # canonical 0x hex, or "" when the action takes none
    uint_args_json: str       # canonical JSON array of the decoded integer args
    bool_arg: bool
    proposer: str
    approvals_json: str       # JSON array of signer hex addresses (sorted, deduped)
    approvals: u32            # cached len(approvals_json) for cheap threshold checks
    status: str               # "pending" | "executed"
    created_at: str
    executed_at: str


# --------------------------------------------------------------------------- #
# Contract
# --------------------------------------------------------------------------- #

class CredenceGovernor(gl.Contract):
    credence: Address               # the Credence instance this governor owns / drives
    threshold: u32                  # M in M-of-N
    proposal_count: u256            # monotonically increasing; next id == count
    signers: DynArray[str]          # ordered signer set (canonical hex)
    signer_set: TreeMap[str, bool]  # O(1) membership
    proposals: TreeMap[str, Proposal]

    def __init__(self, signers: str, threshold: int, credence: str) -> None:
        self.credence = Address(_addr_hex(credence))
        parsed = _parse_signers(signers)
        if not _is_int(threshold):
            _fail("threshold must be an integer")
        if threshold < 1 or threshold > len(parsed):
            _fail(f"threshold must be between 1 and the number of signers ({len(parsed)})")
        for a in parsed:
            self.signers.append(a)
            self.signer_set[a] = True
        self.threshold = u32(int(threshold))
        self.proposal_count = u256(0)

    # ---------------------------------------------------------------- internals
    def _require_signer(self) -> None:
        if gl.message.sender_address.as_hex not in self.signer_set:
            _fail("only a configured signer may perform this action")

    def _get_proposal(self, pid) -> Proposal:
        if not _is_int(pid) or pid < 0:
            _fail("proposal id must be a non-negative integer")
        key = str(int(pid))
        if key not in self.proposals:
            _fail("no such proposal")
        return self.proposals[key]

    def _proposal_dict(self, p: Proposal) -> dict:
        return {
            "id": int(p.id),
            "action": p.action,
            "address_arg": p.address_arg,
            "uint_args": json.loads(p.uint_args_json) if p.uint_args_json else [],
            "bool_arg": p.bool_arg,
            "proposer": p.proposer,
            "approvals": json.loads(p.approvals_json) if p.approvals_json else [],
            "approval_count": int(p.approvals),
            "threshold": int(self.threshold),
            "status": p.status,
            "executable": p.status == "pending" and int(p.approvals) >= int(self.threshold),
            "created_at": p.created_at,
            "executed_at": p.executed_at,
        }

    def _dispatch(self, p: Proposal) -> None:
        """Emit the stored action to Credence as a finalized, asynchronous cross-contract
        WRITE. `ICredence(self.credence)` resolves to `gl.get_contract_at(self.credence)`;
        `.emit(on="finalized").<method>(...)` posts the owner-only call, which Credence
        accepts because the message sender is this governor (== Credence.owner)."""
        c = ICredence(self.credence).emit(on="finalized")
        action = p.action
        if action == "set_paused":
            c.set_paused(bool(p.bool_arg))
        elif action == "set_autonomous":
            c.set_autonomous(bool(p.bool_arg))
        elif action == "set_guardian":
            c.set_guardian(p.address_arg)
        elif action == "set_relayer":
            c.set_relayer(p.address_arg)
        elif action == "set_dev":
            c.set_dev(p.address_arg)
        elif action == "set_risk_limits":
            a = json.loads(p.uint_args_json)
            c.set_risk_limits(int(a[0]))
        elif action == "set_terms":
            a = json.loads(p.uint_args_json)
            c.set_terms(int(a[0]), int(a[1]), int(a[2]))
        elif action == "withdraw_fees":
            a = json.loads(p.uint_args_json)
            c.withdraw_fees(p.address_arg, int(a[0]))
        elif action == "transfer_ownership":
            c.transfer_ownership(p.address_arg)
        elif action == "accept_ownership_of_credence":
            c.accept_ownership()
        else:
            _fail("unknown action")

    # --------------------------------------------------------------- governance
    @gl.public.write
    def propose(self, action: str, address_arg: str = "", uint_args_json: str = "",
                bool_arg: bool = False) -> int:
        """A signer proposes one ALLOWED action against Credence. Arguments are decoded
        and validated now and stored verbatim; the proposer auto-approves. Returns the
        new proposal id."""
        self._require_signer()
        act = _norm_action(action)
        addr, uints = _decode_args(act, address_arg, uint_args_json, bool_arg)

        now = _now()
        proposer = gl.message.sender_address.as_hex
        pid = int(self.proposal_count)
        approvals = [proposer]
        self.proposals[str(pid)] = Proposal(
            id=u256(pid),
            action=act,
            address_arg=addr,
            uint_args_json=json.dumps(uints, separators=(",", ":")),
            bool_arg=bool(bool_arg),
            proposer=proposer,
            approvals_json=json.dumps(approvals, separators=(",", ":")),
            approvals=u32(1),
            status="pending",
            created_at=now,
            executed_at="",
        )
        self.proposal_count = u256(pid + 1)
        _emit(GovProposed(proposer, id=str(pid), action=act,
                          approvals=1, threshold=int(self.threshold)))
        return pid

    @gl.public.write
    def approve(self, id: int) -> dict:
        """A signer adds their approval to a pending proposal. Idempotent: approving twice
        is a no-op. Only signers; not allowed once executed."""
        self._require_signer()
        p = self._get_proposal(id)
        if p.status != "pending":
            _fail("proposal is not pending")
        signer = gl.message.sender_address.as_hex
        approvals = json.loads(p.approvals_json) if p.approvals_json else []
        if signer not in approvals:
            approvals.append(signer)
            approvals.sort()
            p.approvals_json = json.dumps(approvals, separators=(",", ":"))
            p.approvals = u32(len(approvals))
            _emit(GovApproved(signer, id=str(int(p.id)), approvals=len(approvals),
                              threshold=int(self.threshold)))
        return self._proposal_dict(p)

    @gl.public.write
    def execute(self, id: int) -> dict:
        """Execute a pending proposal once approvals >= threshold. Marks it executed
        BEFORE emitting the external Credence call (checks-effects-interactions), then
        dispatches the action and emits GovExecuted. Only signers may execute.

        NOTE on semantics: a GenLayer cross-contract write is an asynchronous PostMessage
        with no synchronous return, so "executed" means the governed call was DISPATCHED
        after a quorum, not that Credence independently confirmed it. Argument ranges are
        validated at propose time against Credence's storage widths, so static validation
        can never be the cause of a later revert; but an action with a Credence RUNTIME
        precondition (e.g. accept_ownership_of_credence before the external owner has
        called transfer_ownership(governor), or withdraw_fees beyond accrued fee_revenue)
        will revert on Credence's side while this proposal stays marked executed. Propose
        such actions only once their precondition already holds."""
        self._require_signer()
        p = self._get_proposal(id)
        if p.status != "pending":
            _fail("proposal is not pending")
        if int(p.approvals) < int(self.threshold):
            _fail(f"not enough approvals: have {int(p.approvals)}, need {int(self.threshold)}")

        p.status = "executed"
        p.executed_at = _now()
        self._dispatch(p)
        _emit(GovExecuted(gl.message.sender_address.as_hex, id=str(int(p.id)),
                          action=p.action))
        return self._proposal_dict(p)

    # -------------------------------------------------------------------- views
    @gl.public.view
    def get_proposal(self, id: int) -> dict:
        return self._proposal_dict(self._get_proposal(id))

    @gl.public.view
    def list_proposals(self, offset: int, limit: int) -> dict:
        """Bounded, paginated read of proposals so indexers/UIs never force an unbounded
        scan. Returns up to MAX_PAGE proposals from `offset`."""
        n = int(self.proposal_count)
        off = max(0, int(offset)) if _is_int(offset) else 0
        lim = int(limit) if _is_int(limit) and limit > 0 else MAX_PAGE
        lim = min(lim, MAX_PAGE)
        out = []
        k = off
        while k < n and len(out) < lim:
            key = str(k)
            if key in self.proposals:
                out.append(self._proposal_dict(self.proposals[key]))
            k += 1
        return {"total": n, "offset": off, "next_offset": k if k < n else -1, "items": out}

    @gl.public.view
    def get_signers(self) -> list:
        return [s for s in self.signers]

    @gl.public.view
    def is_signer(self, addr: str) -> bool:
        return _addr_hex(addr) in self.signer_set

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "version": VERSION,
            "credence": self.credence.as_hex,
            "threshold": int(self.threshold),
            "signers": [s for s in self.signers],
            "signer_count": len(self.signers),
            "proposal_count": int(self.proposal_count),
            "allowed_actions": list(ALLOWED),
        }
