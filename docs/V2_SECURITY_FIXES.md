# Credence v2.0: response to steward review

The v1.4 Builder Project submission was declined with this note:

> We cannot accept this submission because borrower-controlled pages can establish ownership
> merely by displaying an address while unauthenticated claims gate lender funds, and the
> protocol has no complete bad-debt recovery or write-off path.

Both findings were correct. v2.0 fixes each one in the contract, with tests that reproduce
the attacks, a full fuzz of the new accounting, and a live re-deployment.

---

## Finding 1: ownership by displaying an address; unauthenticated claims gate funds

### What was wrong (v1.4)

```python
owned = applicant_l in fetched.lower()     # "the page shows my address"
...
cap = GRADES[-1] if any_owned else UNOWNED_GRADE_CAP   # unproven -> still a C line (100 tokens)
```

* Any page that **echoes** text proved "ownership": a search URL
  (`?q=0xYourAddress`), a comment, a forum post, a profile bio, a pastebin. The borrower
  picked the URL, so the borrower controlled the proof.
* Even with **no** proof, a borrower still got a `C` line: 100 tokens of lender capital on
  claims nobody had authenticated.

### What v2.0 does

**1. Ownership is an ACME http-01-style domain challenge.**

* The borrower adds an evidence item `{"kind": "domain", "content": "example.com"}`. Only a
  bare hostname is accepted (no scheme, path, query, port or userinfo).
* The **contract builds the URL itself**: `https://<domain>/.well-known/credence-verify.txt`.
  The borrower cannot point it at an echo page, add a query string, or choose a path.
* That file must contain, **as a whole line**, the borrower's token
  `credence-verify=<sha256("credence-proof|contract|borrower|request_seq")[:32]>`,
  readable in advance with the view `ownership_challenge(borrower)`.
  * Bound to the **borrower**: copying someone else's token does nothing.
  * Bound to **this contract**: tokens do not carry between deployments.
  * **Rotates on every `request_credit`**: a stale file (for example an expired domain
    that once hosted it) cannot be replayed.
* A proven domain **binds to exactly one borrower** (`domain_owner`, readable with
  `domain_owner_of`). A second borrower cannot reuse it, even with a valid token of their own.
* A `url` item counts as owned **only if its host is a domain proven in the same
  application**. Text and image evidence are never owned.
* Validators re-run the whole check and must agree on the **exact list** of proven domains
  (`validator_fn` compares `proven`, `any_owned` and the grade).

**2. No proof, no line.**

* Without a proven domain, `credit_limit` is **0** and `draw` reverts with
  `no authenticated credit line`. The applicant can hold at most a public reputation grade
  of `C`.
* The oracle agrees: `credit_of(...).available` is `0` and `is_creditworthy(...)` is `false`
  for any unproven borrower, so an integrating protocol cannot be fooled by a bare `C`.

### Tests (`tests/direct/test_credence.py::TestAuthenticatedOwnership`)

| Attack | Test | Result |
|---|---|---|
| Echo page showing the borrower's address (the steward's exact case) | `test_page_that_merely_displays_address_proves_nothing` | not owned, limit 0, draw reverts, oracle says not creditworthy |
| Smuggle a path / query / port / scheme into the domain | `test_domain_evidence_must_be_a_bare_host` | rejected at request time |
| Serve the token on a non-`.well-known` page of the domain | `test_contract_builds_the_proof_url` | not owned |
| Copy another borrower's token onto your domain | `test_token_is_bound_to_the_borrower` | not owned |
| Replay a token from a previous request | `test_stale_token_from_a_previous_request_fails` | not owned |
| Prove a domain already bound to someone else | `test_a_domain_binds_to_one_borrower` | not owned |
| Cite a page on an unproven host | `test_url_counts_as_owned_only_on_a_proven_host` | that url not owned; validator agrees |
| Mention a victim's domain first to get the real owner flagged as a sybil | `TestDomainSquatting` | domains bind only on a successful proof; the owner is unaffected |

---

## Finding 2: no complete bad-debt recovery or write-off path

### What was wrong (v1.4)

A defaulted line stayed in `outstanding_principal` forever. Lender balances never moved, so
the first lenders to `defund` were paid at par out of the remaining cash, and the last ones
were left holding the whole loss. There was no way to write the debt off or to route
recovered money back to the people who lost it.

### What v2.0 does: default, write-off, recovery

**Lender capital is held as shares.** Each lender holds `shares`; their capital is
`shares * share_index / 1e18`. Yield still streams per share through the O(1) accumulator,
so it stays exact while capital is written down.

**Write-off on recognition.** When a default is recognised (permissionless `service_book`, or
inline on the borrower's own `draw`/`repay`, so no keeper is required):

1. The line leaves the book: principal, fees and interest are removed from the outstanding
   totals, and `active_lines` drops.
2. **First-loss reserve:** accrued protocol revenue (`fee_revenue`) absorbs the principal
   loss first.
3. **Pro-rata lender loss:** any remainder lowers `share_index`, so every lender's balance
   drops by the same percentage at once. Nobody can exit at par ahead of the loss.
4. Anything neither can absorb is recorded as `unallocated_loss`. The books always
   reconcile: `written_off_principal == reserve_losses + lender_losses + unallocated_loss`.
5. The **full** debt (principal + fees + interest) stays owed as `recovery_owed`. The
   borrower is `defaulted`, must re-underwrite, and cannot `request_credit` or `appeal`
   while anything is still owed.

**Recovery.** `repay()` against a written-off line pays down `recovery_owed` in this order:

1. **Lenders first:** raises `share_index` back up, up to the amount lenders lost on this loan.
2. **Then the reserve:** restores `fee_revenue`, up to what it absorbed.
3. **Then revenue:** the remainder (written-off fees and interest) is split with lenders
   like any other revenue.

When `recovery_owed` reaches zero, the borrower returns to `approved` but still has
`requires_reassessment`, so they must pass a fresh assessment before drawing again.

New pool views: `share_index`, `total_written_off`, `written_off_principal`,
`total_recovered`, `lender_losses`, `reserve_losses`, `unallocated_loss`. New borrower
fields: `recovery_owed`, `written_off`. New events: `WrittenOff`, `Recovered`,
`DomainVerified`.

### Tests

`tests/direct/test_credence.py::TestBadDebtLifecycle`:

* `test_default_is_written_off_and_loss_socialised_pro_rata`: a 100-token loss on a
  750/250 pool leaves lenders at 675/225.
* `test_no_lender_can_exit_at_par_after_a_default`: a par `defund` reverts; the
  written-down balance exits cleanly.
* `test_revenue_reserve_absorbs_first_loss`: revenue is consumed before lender capital.
* `test_recovery_restores_lenders_then_reserve`: a partial, then a full recovery makes
  lenders whole, rejects overpayment, and blocks new credit until the debt is settled.
* `test_write_off_needs_no_keeper`: a borrower's own late `repay` triggers the write-off.

`tests/direct/test_invariants.py` (seeded fuzz, 400 ops) gains two invariants checked after
every operation, and the driver now repays written-off debt:

* **INV14:** every unit of written-off principal is allocated exactly once
  (reserve + lenders + unallocated).
* **INV15:** the per-borrower `written_off` sum equals the pool total, and the outstanding
  `recovery_owed` sum equals written-off minus recovered.
* **INV6** (sum of lender balances equals `total_funded`) stays exact until the first
  write-off. After that it is bounded by one base unit per lender, because each balance is
  rounded down.

All invariants pass on seeds 1234, 7, 42, 99, 2026 and 31337. Each of those runs wrote off
and recovered thousands of tokens.

---

## Verification

* `genvm-lint check contracts/credence.py`: passes (3 checks), 33 methods (13 view, 20 write).
* `pytest tests/direct`: **83 passed** (75 scenario + 8 property/invariant).
* Frontend `tsc --noEmit` and `next build` (static export) are clean. The SDK
  `tsc --noEmit` is clean.
* **Live, GenLayer studionet (chain 61999), 2026-11-12:** v2.0.0 deployed at
  `0x0e0fc114ed62881740b9Be8b5ee8d39671A4c68b`. The steward's attack was run live: the only
  evidence was a URL that echoes the borrower's address in its query string. Result:
  `ownership_proven = false`, `credit_limit = 0`, the `draw` transaction rolled back, and
  pool cash was unchanged. See [LIVE_EVIDENCE.md](LIVE_EVIDENCE.md) §0.
