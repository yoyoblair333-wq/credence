# GenLayer portal - Milestone / contribution submission (paste-ready)

> Prepared 2026-11-03 (v1.2 - submittable now). All evidence is NEW work (repo first
> commit f124862); no link here was used in any earlier submission. GitHub repo is LIVE
> and on-chain proof is the studionet live runs below; a persistent Bradbury tx will be
> added as a follow-up. DO NOT SUBMIT without Blair - she ticks the captcha.

## Linked project  - DECISION NEEDED

Credence is new, standalone work - NOT a version of DelayProof, JusticeUpgrade, or
VERDICT, so it must NOT be filed under any of those. Register it as its own project
"Credence" and attach this as its first milestone / "Contract Deployed" contribution.
If the portal requires an already-accepted project to attach a milestone, submit via
the new-project / builder-contribution path instead. (Blair to confirm at submit time.)

## Title

Credence - undercollateralized, AI-underwritten credit for the agentic economy

## Description  (972 characters)

Credence is an undercollateralized credit protocol: the first GenLayer contract to gate REAL VALUE on consensus AI judgment of live web evidence. A borrower submits their own public evidence (a revenue page, on-chain history, GitHub); a 3-persona underwriter panel reaches consensus - each validator independently re-fetches it with gl.nondet.web.render and re-judges with gl.nondet.exec_prompt - and the binding grade is the strongest a STRICT MAJORITY backs, failing closed to DENY. Evidence must PROVE ownership (the cited page displays the borrower's address) to raise the grade past a floor cap, closing the borrow-against-a-stranger attack. It is a real two-sided market: lenders earn a pro-rata share of origination fees via an O(1) accumulator, and a composable credit-oracle lets other contracts consume the grade. 27 methods; adversarially reviewed twice; lint + typecheck clean; 48 direct-mode tests incl. property/invariant fuzzing; deployed live on studionet.

## Evidence links  (all NEW; GitHub repo LIVE; on-chain proof = studionet live runs; Bradbury tx to follow)

1. Repo - https://github.com/yoyoblair333-wq/credence
2. First commit - https://github.com/yoyoblair333-wq/credence/commit/f124862
3. Contract - https://github.com/yoyoblair333-wq/credence/blob/HEAD/contracts/credence.py
4. Direct-mode tests (scenario) - https://github.com/yoyoblair333-wq/credence/blob/HEAD/tests/direct/test_credence.py
5. Property/invariant suite - https://github.com/yoyoblair333-wq/credence/blob/HEAD/tests/direct/test_invariants.py
6. Composability consumer contract - https://github.com/yoyoblair333-wq/credence/blob/HEAD/contracts/credence_gated.py
7. evidence adapter (24 tests, hashes match the contract) - https://github.com/yoyoblair333-wq/credence/tree/HEAD/adapter
8. Frontend (Next.js app) - https://github.com/yoyoblair333-wq/credence/tree/HEAD/frontend
9. Architecture + threat model - https://github.com/yoyoblair333-wq/credence/tree/HEAD/docs
10. Studionet deploy runbook (proven live) - https://github.com/yoyoblair333-wq/credence/blob/HEAD/docs/DEPLOY.md
11. On-chain live evidence (GenLayer studionet, chain 61999) - deploy + payable fund + real consensus `assess` + composability + M-of-N governance + soulbound passport, each with real tx hashes - https://github.com/yoyoblair333-wq/credence/blob/HEAD/docs/LIVE_EVIDENCE.md  (persistent Bradbury testnet deployment to follow as an update)

## Why this scores (steward rubric)

- Impact/usefulness: undercollateralized credit is DeFi's biggest unsolved problem; Credence makes it trustless using the one thing only GenLayer has - consensus over live web judgment - with no bank, collateral, or committee. A durable primitive other protocols call (demonstrated by a companion consumer contract) and a forkable template.
- Effort/Scope: a hardened 27-method contract + a composability consumer contract + evidence adapter + full Next.js app + docs + 48 tests - not a tweak.
- Quality: genvm-lint (3 checks) + validation + typecheck clean; REAL consensus that re-derives the decision (not schema-only); TWO independent adversarial reviews (Codex + reconciliation) with every finding fixed and regression-tested; property/invariant fuzzing proves value-conservation.
- Community impact: a reusable access-to-capital primitive in GenLayer's hero "autonomous finance" vertical and on its official ideas list, showcasing web-under-consensus, an identity-binding pattern, and composable judgment-as-a-service others can reuse.

## Captcha

reCAPTCHA ("I'm not a robot") - left for Blair to tick. Do not submit.

## Status

1. DONE - GitHub repo pushed and live: https://github.com/yoyoblair333-wq/credence (branch master, CI running). All evidence links above resolve.
2. DONE - On-chain proof: studionet live runs with real tx hashes (evidence link 11 / docs/LIVE_EVIDENCE.md).
3. FOLLOW-UP (optional, not a gate) - persistent Bradbury (chain 4221) deploy tx. GenLayer's Phase-2 testnet rebuilt its core contracts and the released SDKs still target old Bradbury, so this is pending current Phase-2 deploy tooling; it will be added as an update to this milestone when available.
