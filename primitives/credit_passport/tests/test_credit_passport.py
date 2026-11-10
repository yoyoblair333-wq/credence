"""
Direct-mode tests for CreditPassport (standalone soulbound credit-grade registry).

The real GenVM Python SDK runs in-process. Oracle mode's cross-contract read
(`gl.get_contract_at(oracle).view().credit_of(addr)`) is replaced with an in-test fake
oracle via monkeypatch, so the defensive handling of an untrusted reply is exercised
without deploying a second contract.

Run from the repo root:  pytest primitives/credit_passport/tests -v
"""

import ast
import os

import pytest

CONTRACT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "credit_passport.py")
ORACLE = "0x" + "11" * 20
STRANGER = "0x" + "22" * 20


def h(a) -> str:
    if hasattr(a, "as_hex"):
        return a.as_hex
    if isinstance(a, (bytes, bytearray)):
        return "0x" + bytes(a).hex()
    return str(a)


def same(a, b) -> bool:
    return h(a).lower() == h(b).lower()


@pytest.fixture
def passport(direct_vm, direct_deploy, direct_owner, direct_charlie):
    direct_vm.sender = direct_owner
    c = direct_deploy(CONTRACT)
    c.add_issuer(h(direct_charlie))          # charlie is the approved issuer
    return c


def as_issuer(vm, issuer):
    vm.sender = issuer


class FakeOracle:
    """Stands in for any contract exposing credit_of(addr) -> dict."""

    def __init__(self, records):
        self.records = records
        self.calls = []

    def install(self, monkeypatch):
        import genlayer.gl as _g

        oracle = self

        class _View:
            def credit_of(self, addr):
                oracle.calls.append(addr.lower())
                return oracle.records.get(addr.lower(), {"known": False})

        class _Proxy:
            def __init__(self, address):
                oracle.address = address

            def view(self):
                return _View()

        monkeypatch.setattr(_g, "get_contract_at", _Proxy)
        return self


# ------------------------------------------------------------------ issuer mode

class TestIssue:
    def test_issue_creates_passport(self, direct_vm, passport, direct_charlie, direct_alice):
        as_issuer(direct_vm, direct_charlie)
        p = passport.issue(h(direct_alice), "aa", 82, False, "  12 on-time repayments  ")
        assert p["held"] and p["active"] and p["grade"] == "AA" and p["grade_rank"] == 4
        assert p["standing"] == 82 and p["defaulted"] is False and p["ever_defaulted"] is False
        assert p["source"] == "issuer" and same(p["written_by"], direct_charlie)
        assert p["memo"] == "12 on-time repayments" and p["seq"] == 1 and p["update_count"] == 0
        assert passport.grade_of(h(direct_alice)) == "AA"
        assert passport.has_passport(h(direct_alice)) is True and passport.holder_count() == 1

    def test_reissue_updates_in_place(self, direct_vm, passport, direct_charlie, direct_alice):
        as_issuer(direct_vm, direct_charlie)
        passport.issue(h(direct_alice), "B", 50, False)
        p = passport.issue(h(direct_alice), "A", 70, False)
        assert p["grade"] == "A" and p["update_count"] == 1 and p["seq"] == 1
        assert passport.holder_count() == 1

    def test_ever_defaulted_is_sticky(self, direct_vm, passport, direct_charlie, direct_alice):
        as_issuer(direct_vm, direct_charlie)
        p = passport.issue(h(direct_alice), "DENY", 5, True, "missed 3 payments")
        assert p["defaulted"] is True and p["ever_defaulted"] is True
        p = passport.issue(h(direct_alice), "AAA", 100, False, "cured")
        assert p["defaulted"] is False and p["ever_defaulted"] is True

    def test_non_issuer_cannot_issue(self, direct_vm, passport, direct_alice, direct_bob, direct_owner):
        for who in (direct_alice, direct_bob, direct_owner):
            direct_vm.sender = who
            with direct_vm.expect_revert("only an approved issuer"):
                passport.issue(h(direct_alice), "AAA", 100, False)

    def test_holder_cannot_self_issue(self, direct_vm, passport, direct_alice):
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("only an approved issuer"):
            passport.issue(h(direct_alice), "AAA", 100, False)

    @pytest.mark.parametrize("grade,standing,defaulted,msg", [
        ("AAAA", 50, False, "grade must be one of"),
        ("", 50, False, "grade must be one of"),
        ("A", 101, False, "standing must be an integer"),
        ("A", -1, False, "standing must be an integer"),
        ("A", True, False, "standing must be an integer"),
        ("A", 50, 1, "defaulted must be true or false"),
    ])
    def test_issue_validates_inputs(self, direct_vm, passport, direct_charlie, direct_alice,
                                    grade, standing, defaulted, msg):
        as_issuer(direct_vm, direct_charlie)
        with direct_vm.expect_revert(msg):
            passport.issue(h(direct_alice), grade, standing, defaulted)

    def test_issue_validates_address_and_memo(self, direct_vm, passport, direct_charlie):
        as_issuer(direct_vm, direct_charlie)
        with direct_vm.expect_revert("0x followed by 40 hex"):
            passport.issue("0x1234", "A", 50, False)
        with direct_vm.expect_revert("memo must be at most"):
            passport.issue(STRANGER, "A", 50, False, "x" * 141)


class TestRevoke:
    def test_revoke_reads_as_deny_but_keeps_history(self, direct_vm, passport, direct_charlie, direct_alice):
        as_issuer(direct_vm, direct_charlie)
        passport.issue(h(direct_alice), "AA", 90, False)
        p = passport.revoke(h(direct_alice), "fraud review")
        assert p["revoked"] and not p["active"] and p["grade"] == "DENY" and p["grade_rank"] == 0
        assert p["recorded_grade"] == "AA" and p["memo"] == "fraud review"
        assert passport.grade_of(h(direct_alice)) == "DENY"
        assert passport.tier_at_least(h(direct_alice), "DENY") is False
        assert passport.has_passport(h(direct_alice)) is True
        with direct_vm.expect_revert("already revoked"):
            passport.revoke(h(direct_alice))

    def test_reissue_reinstates(self, direct_vm, passport, direct_charlie, direct_alice):
        as_issuer(direct_vm, direct_charlie)
        passport.issue(h(direct_alice), "AA", 90, False)
        passport.revoke(h(direct_alice))
        p = passport.issue(h(direct_alice), "B", 60, False, "reinstated")
        assert p["active"] and p["grade"] == "B"

    def test_owner_can_revoke_others_cannot(self, direct_vm, passport, direct_charlie, direct_alice,
                                            direct_bob, direct_owner):
        as_issuer(direct_vm, direct_charlie)
        passport.issue(h(direct_alice), "A", 70, False)
        for who in (direct_alice, direct_bob):
            direct_vm.sender = who
            with direct_vm.expect_revert("only an approved issuer or the owner"):
                passport.revoke(h(direct_alice))
        direct_vm.sender = direct_owner
        assert passport.revoke(h(direct_alice))["revoked"] is True

    def test_revoke_unknown_reverts(self, direct_vm, passport, direct_charlie):
        as_issuer(direct_vm, direct_charlie)
        with direct_vm.expect_revert("no passport to revoke"):
            passport.revoke(STRANGER)


# ------------------------------------------------------------------ reads

class TestViews:
    def test_unknown_address_is_safe_deny(self, passport):
        p = passport.passport_of(STRANGER)
        assert p["held"] is False and p["grade"] == "DENY" and p["active"] is False
        assert passport.grade_of(STRANGER) == "DENY"
        assert passport.tier_at_least(STRANGER, "C") is False
        assert passport.has_passport(STRANGER) is False

    @pytest.mark.parametrize("min_grade,expected", [("DENY", True), ("C", True), ("B", True),
                                                    ("A", True), ("aa", False), ("AAA", False)])
    def test_tier_at_least(self, direct_vm, passport, direct_charlie, direct_alice, min_grade, expected):
        as_issuer(direct_vm, direct_charlie)
        passport.issue(h(direct_alice), "A", 70, False)
        assert passport.tier_at_least(h(direct_alice), min_grade) is expected

    def test_tier_at_least_rejects_bad_grade(self, direct_vm, passport):
        with direct_vm.expect_revert("grade must be one of"):
            passport.tier_at_least(STRANGER, "Z")

    def test_holders_pagination(self, direct_vm, passport, direct_charlie):
        as_issuer(direct_vm, direct_charlie)
        addrs = ["0x" + f"{i:040x}" for i in range(1, 6)]
        for a in addrs:
            passport.issue(a, "C", 40, False)
        page = passport.holders(0, 2)
        assert page["total"] == 5 and page["next_offset"] == 2
        assert [x["seq"] for x in page["items"]] == [1, 2]
        last = passport.holders(4, 10)
        assert last["next_offset"] == -1 and len(last["items"]) == 1
        assert passport.holders(9, 10)["items"] == []
        assert len(passport.holders(0, 0)["items"]) == 5          # 0 -> default page size

    def test_soulbound_no_transfer_surface(self, passport):
        """Every public method, read from the contract source: none can move a passport."""
        tree = ast.parse(open(CONTRACT, encoding="utf-8").read())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "CreditPassport")
        public = {f.name for f in cls.body if isinstance(f, ast.FunctionDef)
                  and any("public" in ast.unparse(d) for d in f.decorator_list)}
        assert {"issue", "revoke", "mint", "refresh", "passport_of", "tier_at_least"} <= public
        writes = {f.name for f in cls.body if isinstance(f, ast.FunctionDef)
                  and any(ast.unparse(d).startswith("gl.public.write") for d in f.decorator_list)}
        assert writes == {"issue", "revoke", "mint", "refresh", "add_issuer", "remove_issuer",
                          "set_oracle", "transfer_ownership", "accept_ownership"}
        assert passport.get_config()["soulbound"] is True


# ------------------------------------------------------------------ admin

class TestAdmin:
    def test_issuer_management(self, direct_vm, passport, direct_owner, direct_charlie, direct_alice):
        direct_vm.sender = direct_owner
        passport.add_issuer(h(direct_alice))
        assert passport.is_issuer(h(direct_alice)) is True
        assert [x.lower() for x in passport.list_issuers()] == [h(direct_charlie).lower(), h(direct_alice).lower()]
        passport.remove_issuer(h(direct_charlie))
        assert passport.is_issuer(h(direct_charlie)) is False
        with direct_vm.expect_revert("not an approved issuer"):
            passport.remove_issuer(h(direct_charlie))
        direct_vm.sender = direct_charlie
        with direct_vm.expect_revert("only an approved issuer"):
            passport.issue(STRANGER, "A", 50, False)
        direct_vm.sender = direct_owner
        passport.add_issuer(h(direct_charlie))                 # re-adding does not duplicate
        assert len(passport.list_issuers()) == 2

    def test_only_owner_manages(self, direct_vm, passport, direct_alice):
        direct_vm.sender = direct_alice
        for fn, args in (("add_issuer", [STRANGER]), ("remove_issuer", [STRANGER]),
                         ("set_oracle", [ORACLE]), ("transfer_ownership", [STRANGER])):
            with direct_vm.expect_revert("only the owner"):
                getattr(passport, fn)(*args)

    def test_two_step_ownership(self, direct_vm, passport, direct_owner, direct_alice, direct_bob):
        direct_vm.sender = direct_owner
        passport.transfer_ownership(h(direct_alice))
        direct_vm.sender = direct_bob
        with direct_vm.expect_revert("pending owner"):
            passport.accept_ownership()
        direct_vm.sender = direct_alice
        passport.accept_ownership()
        assert same(passport.get_config()["owner"], direct_alice)
        passport.add_issuer(h(direct_bob))
        assert passport.is_issuer(h(direct_bob))

    def test_constructor_owner_and_oracle(self, direct_vm, direct_deploy, direct_owner, direct_alice):
        direct_vm.sender = direct_owner
        c = direct_deploy(CONTRACT, h(direct_alice), ORACLE)
        cfg = c.get_config()
        assert same(cfg["owner"], direct_alice) and cfg["oracle"].lower() == ORACLE and cfg["oracle_mode"]
        assert cfg["grades"] == ["DENY", "C", "B", "A", "AA", "AAA"] and cfg["holder_count"] == 0


# ------------------------------------------------------------------ oracle mode

class TestOracleMode:
    def _enable(self, vm, passport, owner):
        vm.sender = owner
        passport.set_oracle(ORACLE)

    def test_mint_disabled_without_oracle(self, direct_vm, passport, direct_alice):
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("oracle mode is disabled"):
            passport.mint()

    def test_mint_and_refresh_from_oracle(self, direct_vm, passport, direct_owner, direct_alice, monkeypatch):
        self._enable(direct_vm, passport, direct_owner)
        a = h(direct_alice).lower()
        fake = FakeOracle({a: {"known": True, "grade": "b", "standing": 61, "defaulted": False,
                               "ever_defaulted": False}}).install(monkeypatch)
        direct_vm.sender = direct_alice
        p = passport.mint()
        assert p["grade"] == "B" and p["standing"] == 61 and p["source"] == "oracle"
        assert p["written_by"].lower() == ORACLE and fake.calls == [a]
        with direct_vm.expect_revert("already holds a passport"):
            passport.mint()
        fake.records[a] = {"known": True, "grade": "AA", "standing": 88, "defaulted": False,
                           "ever_defaulted": True}
        p = passport.refresh()
        assert p["grade"] == "AA" and p["ever_defaulted"] is True and p["update_count"] == 1

    def test_unknown_to_oracle_cannot_mint(self, direct_vm, passport, direct_owner, direct_alice, monkeypatch):
        self._enable(direct_vm, passport, direct_owner)
        FakeOracle({}).install(monkeypatch)
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("never assessed"):
            passport.mint()
        with direct_vm.expect_revert("call mint() first"):
            passport.refresh()

    @pytest.mark.parametrize("reply,grade,standing,defaulted", [
        ({"known": True, "grade": "SUPER", "standing": 500, "defaulted": "yes"}, "DENY", 100, False),
        ({"known": True, "grade": "A", "standing": -7, "defaulted": True}, "A", 0, True),
        ({"known": True, "grade": "A", "standing": True}, "A", 0, False),
    ])
    def test_untrusted_oracle_reply_is_sanitised(self, direct_vm, passport, direct_owner, direct_alice,
                                                 monkeypatch, reply, grade, standing, defaulted):
        self._enable(direct_vm, passport, direct_owner)
        FakeOracle({h(direct_alice).lower(): reply}).install(monkeypatch)
        direct_vm.sender = direct_alice
        p = passport.mint()
        assert (p["grade"], p["standing"], p["defaulted"]) == (grade, standing, defaulted)

    def test_known_must_be_literally_true(self, direct_vm, passport, direct_owner, direct_alice, monkeypatch):
        self._enable(direct_vm, passport, direct_owner)
        FakeOracle({h(direct_alice).lower(): {"known": "true", "grade": "AAA"}}).install(monkeypatch)
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("never assessed"):
            passport.mint()

    def test_non_dict_oracle_reply_reverts(self, direct_vm, passport, direct_owner, direct_alice, monkeypatch):
        self._enable(direct_vm, passport, direct_owner)
        FakeOracle({h(direct_alice).lower(): "AAA"}).install(monkeypatch)
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("unexpected result"):
            passport.mint()

    def test_revoked_passport_cannot_self_refresh(self, direct_vm, passport, direct_owner, direct_charlie,
                                                  direct_alice, monkeypatch):
        self._enable(direct_vm, passport, direct_owner)
        FakeOracle({h(direct_alice).lower(): {"known": True, "grade": "AAA", "standing": 99}}).install(monkeypatch)
        direct_vm.sender = direct_alice
        passport.mint()
        direct_vm.sender = direct_charlie
        passport.revoke(h(direct_alice), "dispute")
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("only an issuer can reinstate"):
            passport.refresh()

    def test_issuer_and_oracle_writes_share_one_passport(self, direct_vm, passport, direct_owner,
                                                          direct_charlie, direct_alice, monkeypatch):
        self._enable(direct_vm, passport, direct_owner)
        FakeOracle({h(direct_alice).lower(): {"known": True, "grade": "C", "standing": 30}}).install(monkeypatch)
        direct_vm.sender = direct_charlie
        passport.issue(h(direct_alice), "A", 70, False)
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("already holds a passport"):
            passport.mint()
        p = passport.refresh()
        assert p["grade"] == "C" and p["source"] == "oracle" and passport.holder_count() == 1

    def test_set_oracle_can_disable(self, direct_vm, passport, direct_owner, direct_alice):
        self._enable(direct_vm, passport, direct_owner)
        passport.set_oracle("")
        assert passport.get_config()["oracle_mode"] is False
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("oracle mode is disabled"):
            passport.mint()
