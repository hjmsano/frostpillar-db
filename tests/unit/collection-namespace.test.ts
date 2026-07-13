import assert from 'node:assert/strict';
import test from 'node:test';

import { collectionNamespace, ValidationError } from '../../src/index.js';

void test('collectionNamespace leaves already-safe names unchanged', () => {
  assert.equal(collectionNamespace('users'), 'users');
  assert.equal(collectionNamespace('user-events_2026'), 'user-events_2026');
  assert.equal(collectionNamespace('A1'), 'A1');
});

void test('collectionNamespace percent-escapes dots', () => {
  assert.equal(collectionNamespace('orders.2026'), 'orders%2E2026');
  assert.equal(collectionNamespace('foo.fpdb.g.0'), 'foo%2Efpdb%2Eg%2E0');
});

void test('collectionNamespace output never contains a dot', () => {
  for (const name of ['a.b', 'a.b.c', 'x', 'x-1.2_3']) {
    assert.equal(collectionNamespace(name).includes('.'), false);
  }
});

void test('collectionNamespace is injective across colliding shapes', () => {
  // The pair that breaks a raw-name file factory: "foo"'s generation-file
  // prefix ("foo.fpdb.g.") swallows "foo.fpdb.g.0"'s files. Encoded, neither
  // fragment is a delimited prefix of the other.
  const a = collectionNamespace('foo');
  const b = collectionNamespace('foo.fpdb.g.0');
  assert.notEqual(a, b);
  assert.equal(b.startsWith(`${a}.`), false);

  const seen = new Set<string>();
  for (const name of ['a.b', 'a-b', 'a_b', 'ab', 'a.b.c', 'a2Eb']) {
    const encoded = collectionNamespace(name);
    assert.equal(seen.has(encoded), false, `duplicate encoding for ${name}`);
    seen.add(encoded);
  }
});

void test('collectionNamespace rejects invalid collection names', () => {
  assert.throws(() => collectionNamespace(''), ValidationError);
  assert.throws(() => collectionNamespace('_internal'), ValidationError);
  assert.throws(() => collectionNamespace('a..b'), ValidationError);
  assert.throws(() => collectionNamespace('a/b'), ValidationError);
});
