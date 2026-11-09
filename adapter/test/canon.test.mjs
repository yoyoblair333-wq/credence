// Canonical-JSON + sha256 parity with CPython. The expected hex values below were produced by
// the Credence contract's own venv CPython
// (a local CPython venv) and are pinned here:
//
//   import hashlib, json
//   d = lambda o: hashlib.sha256(json.dumps(o, sort_keys=True, separators=(',',':'), ensure_ascii=True).encode('utf-8')).hexdigest()
//   d([])                                  -> 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
//   d({'b':[True,None],'a':1})             -> 1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668
//   d({'x':'café – 😀'})                   -> 0eba74cb0e34b43f16f6a7711c1523123a07e8df8897fe49f131d79f6fd0874b
//   hashlib.sha256('abc'.encode()).hexdigest() -> ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sha256, digest, CanonError } from '../src/canon.mjs';

test('canonical sorts object keys and uses compact separators', () => {
  assert.equal(canonical({ b: [true, null], a: 1 }), '{"a":1,"b":[true,null]}');
  assert.equal(canonical([]), '[]');
  assert.equal(canonical({ z: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"z":1}');
});

test('canonical escapes every non-ASCII code point (ensure_ascii), astrals as surrogate pairs', () => {
  // é -> \u00e9, en-dash -> \u2013, 😀 (U+1F600) -> \ud83d\ude00
  assert.equal(canonical({ x: 'café – 😀' }), '{"x":"caf\\u00e9 \\u2013 \\ud83d\\ude00"}');
});

test('canonical refuses floats (CPython and JS print them differently)', () => {
  assert.throws(() => canonical({ n: 1.5 }), CanonError);
});

test('digest matches CPython json.dumps + hashlib.sha256 vectors', () => {
  assert.equal(digest([]), '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  assert.equal(digest({ b: [true, null], a: 1 }), '1cc69c7fa23616ca2ec3ee70d24390a6225c8832db8a4c814c7e0e7f942f8668');
  assert.equal(digest({ x: 'café – 😀' }), '0eba74cb0e34b43f16f6a7711c1523123a07e8df8897fe49f131d79f6fd0874b');
});

test('sha256 of a raw UTF-8 string equals the contract _digest', () => {
  // CPython: hashlib.sha256('abc'.encode('utf-8')).hexdigest()
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
