// Canonical JSON identical to the Credence contract's canonical dump used in `_parse_evidence`:
//   json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
// and sha256 identical to the contract's `_digest`:
//   hashlib.sha256(text.encode("utf-8")).hexdigest()
//
// Every hash shared between this adapter and the on-chain Credence protocol is a sha256 of
// this encoding. For a single credit-evidence item it is the sha256 of the canonical JSON of the
// whole {kind,label,content} object — byte-for-byte what `credence.py` commits. Only strings,
// integers, booleans, null, arrays and plain objects are allowed; floats are refused because
// CPython and JavaScript print them differently.
//
// and is byte-identical in behaviour to the JusticeUpgrade adapter's canon.mjs (both commit
// the same {kind,label,content} shape).
import crypto from 'node:crypto';

export class CanonError extends Error {}

function sortValue(v, path) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map((x, i) => sortValue(x, `${path}[${i}]`));
  switch (typeof v) {
    case 'string': case 'boolean': return v;
    case 'number':
      if (!Number.isInteger(v) || !Number.isSafeInteger(v)) throw new CanonError(`non-integer number at ${path}`);
      return v;
    case 'object': {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (v[k] === undefined) continue;
        out[k] = sortValue(v[k], `${path}.${k}`);
      }
      return out;
    }
    default: throw new CanonError(`unsupported value (${typeof v}) at ${path}`);
  }
}

// CPython's ensure_ascii escapes every code point above 0x7F as \uXXXX (astral ones as a
// surrogate pair, which is what JavaScript strings already hold). \uXXXX is lower-case hex,
// exactly as json.dumps emits it.
const escapeNonAscii = (s) => s.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function canonical(value) {
  return escapeNonAscii(JSON.stringify(sortValue(value, '$')));
}

// sha256 hex of a raw UTF-8 string — the contract's `_digest(text)`.
export const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// sha256 hex of a value's canonical JSON — the contract's `_digest(json.dumps(..., sort_keys=True,
// separators=(',',':'), ensure_ascii=True))`.
export const digest = (value) => sha256(canonical(value));
