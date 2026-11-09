// The "credence evidence package": the off-chain record this adapter assembles for one Credence credit
// application. Every evidence item is committed with the SAME sha256 the contract computes in
// `_parse_evidence` — sha256 over the CANONICAL JSON of the whole {kind,label,content} object,
// over the SANITISED values — and the whole bundle is bound by a bundleSha256 over its canonical
// JSON. The commitments stored here are therefore byte-identical to the ones the on-chain
// Credence protocol will hold, so the off-chain record is auditable against the chain and a
// borrower cannot later swap what the underwriting panel judged.
//
// canonical-JSON / sha256 discipline, and the sibling JusticeUpgrade adapter.
import { canonical, digest, sha256 } from './canon.mjs';

export const PACKAGE_SCHEMA = 'credence-evidence-package/1';

// ---- Contract-mirrored constants (credence.py) ----------------------------------------------
export const EVIDENCE_KINDS = ['text', 'url'];
export const MAX_EVIDENCE_ITEMS = 8;
export const MAX_LABEL_CHARS = 120;
export const MAX_TEXT_EVIDENCE_CHARS = 1200;
export const MAX_URL_CHARS = 300;
export const MAX_PURPOSE_CHARS = 400;
// Bounded credit grades (weakest -> strongest); DENY is the safe default.
export const GRADES = ['DENY', 'C', 'B', 'A', 'AA', 'AAA'];
// GRADE_TOKENS["AAA"] in the contract — the largest line a request may name.
export const MAX_LINE_TOKENS = 2500;

// _URL_RE in the contract: ^https://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{3,}$
// (at least three URL characters after the scheme, no whitespace). Ported verbatim.
const URL_RE = /^https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{3,}$/;

// _INVISIBLE_RE in the contract: exactly these five zero-width / BOM code points
//   \u200b \u200c \u200d \u2060 \ufeff
// (narrower than JusticeUpgrade's range — mirror the Credence contract precisely).
const INVISIBLE_RE = /[\u200b\u200c\u200d\u2060\ufeff]/gu;

// _CONTROL_RE in the contract: a write-time injection screen that rejects text trying to command
// the underwriter rather than describe creditworthiness. Ported verbatim from credence.py so this
// adapter rejects exactly what `request_credit` would reject. Python used `(?i)`; here the `i`
// flag. Python `.` (no DOTALL) and JS `.` (no `s`) both exclude newline, so the `.{0,20}` behaves
// identically. The literal trailing space in the final alternative is preserved.
const CONTROL_RE = new RegExp(
  'ignore (all |the )?(previous|above|prior)'
  + '|disregard .{0,20}instruction'
  + '|you are (now |an? )'
  + '|system prompt'
  + '|<\\s*/?\\s*(system|assistant|user)\\s*>'
  + '|\\b(assistant|system)\\s*:'
  + '|\\bgrade\\s*[:=]'
  + '|respond with'
  + '|output (only|exactly)'
  + '|approve (me|this|my)'
  + '|grant (me|my) ',
  'i',
);

export class PackageError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(`invalid credence evidence package: ${list.join('; ')}`);
    this.problems = list;
  }
}

// --------------------------------------------------------------------------------------------
// Pure helpers, mirroring the contract's pure helpers.
// --------------------------------------------------------------------------------------------

// Contract `_sanitise`: NFKC-normalize, strip the five invisible code points, drop control chars
// (Unicode general category "C*") except newline and tab, then trim. Idempotent, so a value
// sanitised here hashes to the same thing the contract computes after it re-sanitises.
export function sanitise(raw, label) {
  if (typeof raw !== 'string') throw new PackageError(`${label} must be text`);
  let text = raw.normalize('NFKC');
  text = text.replace(INVISIBLE_RE, '');
  text = Array.from(text).filter((ch) => !/\p{C}/u.test(ch) || ch === '\n' || ch === '\t').join('');
  return text.trim();
}

// Contract `_check_clean`: reject underwriter-directed instructions before anything is committed.
function checkClean(text, label) {
  if (CONTROL_RE.test(text)) {
    throw new PackageError(`${label} contains instructions aimed at the underwriter, not a description of creditworthiness`);
  }
}

// Length by Unicode code point (Python's len()), not by UTF-16 code unit.
const clen = (s) => Array.from(s).length;

// The contract's per-item commitment, exactly: a sha256 over the CANONICAL JSON of the whole
// {kind,label,content} object — digest({kind,label,content}) — i.e.
//   hashlib.sha256(json.dumps({"kind":k,"label":l,"content":c},
//                             sort_keys=True, separators=(",",":"), ensure_ascii=True).encode("utf-8")).hexdigest()
// Canonical sorting puts the keys in content,kind,label order.
export const itemSha256 = (kind, label, content) => digest({ kind, label, content });

// --------------------------------------------------------------------------------------------
// Evidence validation — mirrors `_parse_evidence`, returning committed items.
// --------------------------------------------------------------------------------------------
export function parseEvidence(raw) {
  let items = raw;
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw === 'string') {
    try { items = JSON.parse(raw); } catch { throw new PackageError('evidence must be a JSON array'); }
  }
  if (!Array.isArray(items)) throw new PackageError('evidence must be a JSON array');
  if (items.length > MAX_EVIDENCE_ITEMS) throw new PackageError(`at most ${MAX_EVIDENCE_ITEMS} evidence items`);

  return items.map((it, i) => {
    if (it === null || typeof it !== 'object' || Array.isArray(it)) throw new PackageError(`evidence[${i}] must be an object`);
    const kind = it.kind;
    if (!EVIDENCE_KINDS.includes(kind)) throw new PackageError(`evidence[${i}].kind must be 'text' or 'url'`);

    const label = sanitise(it.label ?? '', `evidence[${i}].label`);
    if (clen(label) > MAX_LABEL_CHARS) throw new PackageError(`evidence[${i}].label exceeds ${MAX_LABEL_CHARS} characters`);
    checkClean(label, `evidence[${i}].label`);

    const content = sanitise(it.content ?? '', `evidence[${i}].content`);
    if (!content) throw new PackageError(`evidence[${i}].content cannot be empty`);
    if (kind === 'text') {
      if (clen(content) > MAX_TEXT_EVIDENCE_CHARS) throw new PackageError(`evidence[${i}].content exceeds ${MAX_TEXT_EVIDENCE_CHARS} characters`);
      checkClean(content, `evidence[${i}].content`);
    } else {
      if (clen(content) > MAX_URL_CHARS || !URL_RE.test(content)) throw new PackageError(`evidence[${i}].content must be a single https:// URL`);
    }
    return { kind, label, content, sha256: itemSha256(kind, label, content) };
  });
}

// Validate the credit application scalars the same way `request_credit` does.
function validatePurpose(raw) {
  const purpose = sanitise(raw ?? '', 'purpose');
  if (!purpose) throw new PackageError('purpose cannot be empty');
  if (clen(purpose) > MAX_PURPOSE_CHARS) throw new PackageError(`purpose exceeds ${MAX_PURPOSE_CHARS} characters`);
  checkClean(purpose, 'purpose');
  return purpose;
}

function validateRequestedTokens(raw) {
  if (!Number.isInteger(raw) || raw <= 0) throw new PackageError('requested_tokens must be a positive integer');
  if (raw > MAX_LINE_TOKENS) throw new PackageError(`requested_tokens exceeds the maximum line of ${MAX_LINE_TOKENS}`);
  return raw;
}

// --------------------------------------------------------------------------------------------
// Build the package.
// --------------------------------------------------------------------------------------------

// A deterministic key over only the committed content — the same application + evidence always
// yields the same key, regardless of when or by whom it was assembled. A relayer can use it to
// de-duplicate request_credit calls.
function idempotencyKey(purpose, requestedTokens, items) {
  return digest({
    v: 1,
    purpose_sha256: sha256(purpose),
    requested_tokens: requestedTokens,
    evidence_commitments: items.map((it) => it.sha256),
  });
}

/**
 * Build a Credence credit-evidence package (a "review package" for the underwriting panel) from a
 * credit application. Accepts either an application object or, for convenience, a bare evidence
 * array (equivalent to {evidence: [...]}).
 * @param {{purpose?:string, requested_tokens?:number, evidence?:Array}|Array} input
 * @param {{assembled_by?:string, assembled_at?:string, tool?:string, release_approval?:string, disclosure_note?:string}} [opts]
 * @returns {{items:Array, bundleSha256:string, meta:object}} the package (plus application + relay fields)
 */
export function buildPackage(input, opts = {}) {
  if (Array.isArray(input)) input = { evidence: input };
  if (!input || typeof input !== 'object') throw new PackageError('input must be an object');

  // purpose / requested_tokens are optional so this adapter can also package evidence on its own;
  // when present they are validated exactly as request_credit validates them.
  const hasPurpose = input.purpose !== undefined && input.purpose !== null && input.purpose !== '';
  const purpose = hasPurpose ? validatePurpose(input.purpose) : '';
  const hasTokens = input.requested_tokens !== undefined && input.requested_tokens !== null;
  const requestedTokens = hasTokens ? validateRequestedTokens(input.requested_tokens) : null;

  const items = parseEvidence(input.evidence);

  // The exact JSON string a relayer passes to request_credit(purpose, requested_tokens,
  // evidence_json). The contract re-sanitises these values; sanitise is idempotent, so the
  // commitments it recomputes equal the ones below.
  const relayEvidenceJson = JSON.stringify(items.map(({ kind, label, content }) => ({ kind, label, content })));

  // Everything except bundleSha256 — a package cannot contain a hash of itself.
  const core = {
    schema: PACKAGE_SCHEMA,
    purpose,
    requested_tokens: requestedTokens,
    items,
    meta: {
      commitment: {
        algorithm: 'sha256',
        per_item_formula: 'sha256(utf8(json.dumps({kind,label,content}, sort_keys=True, separators=(",",":"), ensure_ascii=True)))',
        canonical_json: "json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=True)",
        grades: GRADES,
      },
      provenance: {
        assembled_by: typeof opts.assembled_by === 'string' ? opts.assembled_by : 'credence-adapter',
        assembled_at: typeof opts.assembled_at === 'string' ? opts.assembled_at : new Date().toISOString(),
        tool: typeof opts.tool === 'string' ? opts.tool : 'credence-adapter/1',
      },
      disclosure: {
        note: typeof opts.disclosure_note === 'string' ? opts.disclosure_note
          : 'Evidence is committed off-chain by the adapter and relayed to the on-chain Credence protocol; '
            + 'URL evidence is re-fetched and re-judged by every validator in the underwriting panel at assessment time.',
        release_approval: typeof opts.release_approval === 'string' ? opts.release_approval : 'assembler (default)',
      },
    },
    idempotency: { request_key: idempotencyKey(purpose, requestedTokens, items) },
    relay: {
      method: 'request_credit',
      args: ['purpose', 'requested_tokens', 'evidence_json'],
      evidence_json: relayEvidenceJson,
      followup: { method: 'assess', args: ['borrower'] },
    },
  };

  const bundleSha256 = digest(core);
  return { ...core, bundleSha256 };
}

// Identity of a package: canonical digest of every field except bundleSha256.
export function bundleSha256Of(bundle) {
  const { bundleSha256, ...core } = bundle;
  return digest(core);
}

// --------------------------------------------------------------------------------------------
// Verify: recompute and check every hash in an existing bundle.
// --------------------------------------------------------------------------------------------
export function verifyPackage(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new PackageError('bundle must be an object');
  const problems = [];

  const items = Array.isArray(bundle.items) ? bundle.items : [];
  const itemResults = items.map((it, i) => {
    const expected = itemSha256(it.kind, it.label, it.content);
    const match = expected === it.sha256;
    if (!match) problems.push(`items[${i}].sha256 mismatch (stored ${it.sha256}, recomputed ${expected})`);
    // Prove the committed value is already in canonical sanitised form (so the contract's
    // re-sanitisation would not change the commitment).
    let reSan = null;
    try { reSan = sanitise(it.label, 'l') === it.label && sanitise(it.content, 'c') === it.content; } catch { reSan = false; }
    if (reSan === false) problems.push(`items[${i}] is not in canonical sanitised form`);
    return { index: i, label: it.label, kind: it.kind, stored: it.sha256, recomputed: expected, match };
  });

  const expectedBundle = bundleSha256Of(bundle);
  const bundleMatch = expectedBundle === bundle.bundleSha256;
  if (!bundleMatch) problems.push(`bundleSha256 mismatch (stored ${bundle.bundleSha256}, recomputed ${expectedBundle})`);

  let idemMatch = null;
  if (bundle.idempotency && typeof bundle.idempotency.request_key === 'string') {
    const expectedKey = idempotencyKey(bundle.purpose ?? '', bundle.requested_tokens ?? null, items);
    idemMatch = expectedKey === bundle.idempotency.request_key;
    if (!idemMatch) problems.push(`idempotency.request_key mismatch (stored ${bundle.idempotency.request_key}, recomputed ${expectedKey})`);
  }

  return {
    ok: problems.length === 0,
    bundleSha256: { stored: bundle.bundleSha256, recomputed: expectedBundle, match: bundleMatch },
    idempotency: idemMatch === null ? null : { match: idemMatch },
    items: itemResults,
    canonical_bytes: Buffer.byteLength(canonical((({ bundleSha256, ...c }) => c)(bundle)), 'utf8'),
    problems,
  };
}
