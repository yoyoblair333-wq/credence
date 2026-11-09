# Credence — evidence adapter

Off-chain adapter that packages a borrower's **credit evidence** for the **Credence** on-chain
undercollateralized lending protocol (`../contracts/credence.py`) into a **canonical,
sha256-committed bundle**. The commitments it writes are **byte-identical** to the ones the
contract computes in `_parse_evidence`, so the off-chain record is auditable against the chain and
a borrower cannot later swap what the on-chain underwriting panel judged — the milestone's evidence
story (contract docstring §2, *Evidence-bound, tamper-evident*).

It follows the same canonical-JSON discipline as the sibling JusticeUpgrade adapter.
It is **read-only**: it never signs, never submits, and holds no keys.

**GenLayer referral: JTR01FHP**

## How it maps to the contract's evidence commitments

A credit application carries a list of evidence items, each `{kind, label, content}` with
`kind ∈ {"text","url"}` — the borrower's own public proof of creditworthiness (a revenue
dashboard, on-chain history, a GitHub profile, an invoice, any https page). In `request_credit`,
the contract's `_parse_evidence` validates and **sanitises** each item, then commits it with a
sha256 over the **canonical JSON of the whole item object**:

```python
"sha256": _digest(json.dumps(
    {"kind": kind, "label": label, "content": content},
    sort_keys=True, separators=(",", ":"), ensure_ascii=True))     # _digest = hashlib.sha256(... utf-8 ...).hexdigest()
```

Canonical sorting orders the keys `content, kind, label`. This adapter computes the **same** value
in `src/package.mjs`:

```js
export const itemSha256 = (kind, label, content) => digest({ kind, label, content });
```

To stay byte-identical the adapter reproduces the contract's pure helpers exactly:

| Contract (`credence.py`) | Adapter (`src/`) |
| --- | --- |
| `_digest(text)` = `hashlib.sha256(text.encode("utf-8")).hexdigest()` | `canon.mjs` `sha256(text)` |
| canonical dump = `json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=True)` | `canon.mjs` `canonical(value)` |
| `_sanitise` (NFKC, strip the 5 invisible chars `\u200b \u200c \u200d \u2060 \ufeff`, drop category-`C` control chars except `\n`/`\t`, `.strip()`) | `package.mjs` `sanitise()` |
| `_check_clean` injection screen (`_CONTROL_RE`) | `package.mjs` ported `CONTROL_RE` |
| `_URL_RE`, `MAX_EVIDENCE_ITEMS=8`, `MAX_LABEL_CHARS=120`, `MAX_TEXT_EVIDENCE_CHARS=1200`, `MAX_URL_CHARS=300` | `package.mjs` constants + `parseEvidence()` |

Because `sanitise` is **idempotent**, the already-sanitised `label`/`content` in the bundle hash
to the same values when the contract re-sanitises them in `request_credit` — the chain reproduces
the bundle's per-item `sha256`. The adapter's `verify` proves this: it refuses any item whose
stored value is not already in canonical sanitised form.

The whole bundle is bound by **`bundleSha256`** = `digest(core)` — the sha256 of the canonical
JSON of every field *except* `bundleSha256` itself. One changed byte anywhere is a different
bundle.

## Bundle shape

`buildPackage({purpose, requested_tokens, evidence})` (or a bare `evidence` array) returns:

- `schema` — `"credence-evidence-package/1"`
- `purpose` (sanitised) and `requested_tokens` — the credit application context
- `items[]` — each `{kind, label, content, sha256}` (the per-item contract commitment)
- `meta` — `{commitment, provenance, disclosure}`: the exact algorithm/formula and the bounded
  grade set `["DENY","C","B","A","AA","AAA"]` for auditors, who assembled it and when, and the
  disclosure note
- `idempotency.request_key` — a content-only digest; the same application always yields the same key
- `relay` — `{method:"request_credit", args:["purpose","requested_tokens","evidence_json"], evidence_json, followup:{method:"assess"}}`
- `bundleSha256` — the whole-bundle commitment

## CLI

```
credence-adapter package <input.json>    # build + print the canonical bundle (with hashes)
credence-adapter verify  <bundle.json>   # recompute and check every hash; exit 0 ok, 4 mismatch
credence-adapter submit  <bundle.json>   # STUB: prints the genlayer-js calls it WOULD make (no network, no keys)
```

Exit codes: `0` ok/valid · `4` integrity mismatch · `6` bad input · `7` usage.

`submit` is a clearly-marked stub. It performs no network I/O and signs nothing; it reads
`GENLAYER_RPC_URL`, `GENLAYER_CHAIN_ID`, `CREDENCE_CONTRACT_ADDRESS`, `GENLAYER_PRIVATE_KEY` from
the environment and prints the `request_credit` → `assess` `genlayer-js` call sequence. No
addresses or keys are hardcoded.

## Worked example

`input.json`:

```json
{
  "purpose": "Working capital to scale an autonomous market-making agent.",
  "requested_tokens": 500,
  "evidence": [
    { "kind": "text", "label": "Revenue dashboard", "content": "Monthly recurring revenue of $42,000 as of 2026-10." },
    { "kind": "url",  "label": "GitHub profile",    "content": "https://github.com/example/agent" }
  ]
}
```

```
$ node bin/credence-adapter.mjs package input.json
```

produces (abridged) evidence commitments:

```
items[0].sha256 = b0176d9502be6feee205947e8d436fc78600df81d61bdcf6bc8f22aad03e0132
items[1].sha256 = 04e9cd21686ec107bee581eca36b3a84a508a607eb0196b83ba7f86e34c98f26
```

These equal, byte-for-byte, what the contract's venv CPython computes for the identical input:

```python
import hashlib, json
d = lambda o: hashlib.sha256(json.dumps(o, sort_keys=True, separators=(',',':'), ensure_ascii=True).encode('utf-8')).hexdigest()
d({'kind':'text','label':'Revenue dashboard','content':'Monthly recurring revenue of $42,000 as of 2026-10.'})  # b0176d95...03e0132
d({'kind':'url','label':'GitHub profile','content':'https://github.com/example/agent'})                          # 04e9cd21...4c98f26
```

and are exactly the `sha256` the contract stores in `evidence_json` after `request_credit`.
`credence-adapter verify bundle.json` recomputes every per-item hash, the `bundleSha256`, and the
`idempotency.request_key`, and exits non-zero if any fails.

## Tests

```
npm test            # => node --test
```

Covers: canonical-JSON parity with CPython vectors (`ensure_ascii` surrogate-pair escaping and
float refusal), the per-item sha256 cross-check against the contract formula with pinned CPython
hex (ASCII **and** a non-ASCII NFKC vector), re-canonicalization stability, bound/kind/URL
(`MAX_EVIDENCE_ITEMS=8`, 120/1200/300 limits) and injection-screen validation, the credit
application scalar checks (`purpose`, `requested_tokens` ≤ 2500), `sanitise` idempotency, and
`verify()` round-trip plus tamper detection. 24 tests.

## Dependencies

Zero runtime dependencies — only Node's built-in `node:crypto`. Node ≥ 18.
