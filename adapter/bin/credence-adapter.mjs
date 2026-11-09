#!/usr/bin/env node
// credence-adapter: the off-chain evidence adapter for the Credence on-chain lending protocol.
// It packages a credit application's evidence into a canonical, sha256-committed bundle whose
// commitments are byte-identical to the ones the contract computes in `_parse_evidence`, and
// verifies such a bundle. It is read-only: it never signs, never submits and never holds a key.
//
//   credence-adapter package <input.json>          build + print the canonical bundle (with hashes)
//   credence-adapter verify  <bundle.json>          recompute and check every hash in a bundle
//   credence-adapter submit  <bundle.json>          STUB: print the genlayer-js calls it WOULD make
//
// Exit codes: 0 ok/valid · 4 integrity mismatch · 6 bad input · 7 usage
//
import fs from 'node:fs';
import { buildPackage, verifyPackage, PackageError } from '../src/package.mjs';
import { CanonError } from '../src/canon.mjs';

const argv = process.argv.slice(2);
const flags = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true); }
  else words.push(a);
}
const emit = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const fail = (code, message) => { process.stderr.write(`credence-adapter: ${message}\n`); process.exit(code); };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\ufeff/, '')); } catch (e) { fail(6, `cannot read ${p}: ${e.message}`); } };

try {
  const [cmd] = words;
  if (cmd === 'package') {
    const input = readJson(words[1] || fail(7, 'package <input.json>'));
    const opts = {};
    if (typeof flags['assembled-by'] === 'string') opts.assembled_by = flags['assembled-by'];
    if (typeof flags['assembled-at'] === 'string') opts.assembled_at = flags['assembled-at'];
    if (typeof flags['release-approval'] === 'string') opts.release_approval = flags['release-approval'];
    const bundle = buildPackage(input, opts);
    emit(bundle);
  } else if (cmd === 'verify') {
    const bundle = readJson(words[1] || fail(7, 'verify <bundle.json>'));
    const result = verifyPackage(bundle);
    emit(result);
    process.exit(result.ok ? 0 : 4);
  } else if (cmd === 'submit') {
    // STUB ONLY — no network, no keys in source. Everything is read from the environment.
    const bundle = readJson(words[1] || fail(7, 'submit <bundle.json>'));
    const check = verifyPackage(bundle);
    if (!check.ok) fail(4, `refusing to submit a bundle that fails verification: ${check.problems.join('; ')}`);
    const env = (k) => process.env[k] || `<$${k} not set>`;
    emit({
      stub: true,
      note: 'This is a STUB. It performs no network I/O and signs nothing. '
        + 'A real relayer would use genlayer-js with these values read from the environment.',
      environment: {
        rpc_url: env('GENLAYER_RPC_URL'),
        chain_id: env('GENLAYER_CHAIN_ID'),
        contract_address: env('CREDENCE_CONTRACT_ADDRESS'),
        account_private_key: process.env.GENLAYER_PRIVATE_KEY ? '<redacted: from $GENLAYER_PRIVATE_KEY>' : '<$GENLAYER_PRIVATE_KEY not set>',
      },
      genlayer_js_calls: [
        { step: 1, method: 'request_credit',
          args: [bundle.purpose ?? '<purpose>', bundle.requested_tokens ?? '<requested_tokens>', bundle.relay?.evidence_json ?? '<evidence_json>'],
          note: 'Called by the borrower. evidence_json is bundle.relay.evidence_json verbatim; the contract re-commits each item and MUST reproduce the sha256 values in this bundle.' },
        { step: 2, method: 'assess', args: ['<borrower 0x-address>'],
          note: 'Runs the on-chain consensus underwriting panel; URL evidence is fetched and judged by every validator, which must agree on the binding grade.' },
      ],
      sketch: [
        "import { createClient, createAccount } from 'genlayer-js';",
        "const account = createAccount(process.env.GENLAYER_PRIVATE_KEY);",
        'const client = createClient({ chain: { id: Number(process.env.GENLAYER_CHAIN_ID), rpcUrl: process.env.GENLAYER_RPC_URL }, account });',
        'const address = process.env.CREDENCE_CONTRACT_ADDRESS;',
        `await client.writeContract({ address, functionName: 'request_credit', args: [${JSON.stringify(bundle.purpose ?? '')}, ${JSON.stringify(bundle.requested_tokens ?? 0)}, ${JSON.stringify(bundle.relay?.evidence_json ?? '')}] });`,
        "await client.writeContract({ address, functionName: 'assess', args: [borrowerAddress] });",
      ],
      bundleSha256: bundle.bundleSha256,
      idempotency_key: bundle.idempotency?.request_key,
    });
  } else {
    process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    process.exit(words.length ? 7 : 0);
  }
} catch (e) {
  if (e instanceof PackageError || e instanceof CanonError) fail(6, e.message);
  fail(6, e.message);
}
