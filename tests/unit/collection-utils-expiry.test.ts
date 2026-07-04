import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeExpiryThreshold,
  isDocumentExpiredAt,
} from '../../src/internal/collectionUtils.js';

void test('computeExpiryThreshold returns undefined when ttl is undefined', () => {
  assert.strictEqual(computeExpiryThreshold(undefined), undefined);
});

void test('computeExpiryThreshold returns a number when ttl is provided', () => {
  const before = Date.now() - 30 * 1000;
  const threshold = computeExpiryThreshold(30);
  const after = Date.now() - 30 * 1000;
  assert.ok(typeof threshold === 'number');
  assert.ok(threshold >= before);
  assert.ok(threshold <= after);
});

void test('isDocumentExpiredAt returns false when threshold is undefined', () => {
  const doc = { _createdAt: Date.now() - 100_000 };
  assert.strictEqual(isDocumentExpiredAt(doc, undefined), false);
});

void test('isDocumentExpiredAt returns false when _createdAt is missing', () => {
  const doc: Record<string, unknown> = {};
  const threshold = Date.now() - 10 * 1000;
  assert.strictEqual(isDocumentExpiredAt(doc, threshold), false);
});

void test('isDocumentExpiredAt returns false when _createdAt is not a number', () => {
  const doc: Record<string, unknown> = { _createdAt: 'not-a-number' };
  const threshold = Date.now() - 10 * 1000;
  assert.strictEqual(isDocumentExpiredAt(doc, threshold), false);
});

void test('isDocumentExpiredAt returns true when createdAt < expiryThreshold', () => {
  const threshold = Date.now() - 10 * 1000;
  // createdAt is older than the threshold (i.e., before the threshold point in time)
  const doc: Record<string, unknown> = { _createdAt: threshold - 1 };
  assert.strictEqual(isDocumentExpiredAt(doc, threshold), true);
});

void test('isDocumentExpiredAt returns false when createdAt equals expiryThreshold', () => {
  const threshold = Date.now() - 10 * 1000;
  // createdAt is exactly at threshold — not yet expired
  const doc: Record<string, unknown> = { _createdAt: threshold };
  assert.strictEqual(isDocumentExpiredAt(doc, threshold), false);
});

void test('isDocumentExpiredAt returns false when createdAt > expiryThreshold', () => {
  const threshold = Date.now() - 10 * 1000;
  // createdAt is newer than the threshold — clearly not expired
  const doc: Record<string, unknown> = { _createdAt: threshold + 1 };
  assert.strictEqual(isDocumentExpiredAt(doc, threshold), false);
});
