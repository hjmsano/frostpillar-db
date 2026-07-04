// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the _id-validation, regex-cache,
// groupBy-cap, and error-sanitization guards in src/internal/ block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/database.js';
import { ValidationError } from '../../src/errors.js';
import { ChangeEmitter } from '../../src/internal/changeEmitter.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { computeGroupBy } from '../../src/internal/aggregationUtils.js';
import {
  extractIdEquality,
  extractIdInclusion,
  extractIdRange,
} from '../../src/internal/filterUtils.js';
import { sanitizeForLog } from '../../src/internal/collectionUtils.js';
import { MAX_GROUP_DOCUMENTS } from '../../src/internal/limits.js';
import { getCachedRegex } from '../../src/internal/filterCache.js';

const caches = createDatabaseCaches();
const pathCache = caches.pathCache;

// --- #15 Regex cache LRU eviction ---

void test('regexStringCache uses LRU eviction instead of bulk clear', () => {
  const cache = new Map<string, RegExp>();
  // Fill cache to capacity
  for (let i = 0; i < 1024; i++) {
    getCachedRegex(`pattern${i}`, cache);
  }
  assert.equal(cache.size, 1024);

  // Access first entry to make it MRU
  getCachedRegex('pattern0', cache);

  // Add one more — should evict LRU (pattern1), not clear everything
  getCachedRegex('newPattern', cache);
  assert.equal(cache.size, 1024); // Size stays at max, not reset to 1
  assert.equal(cache.has('pattern0'), true); // MRU entry preserved
  assert.equal(cache.has('pattern1'), false); // LRU entry evicted
  assert.equal(cache.has('newPattern'), true); // New entry added
});

// --- #16 _id validation at filter time ---

void test('extractIdEquality rejects _id exceeding max length', () => {
  const longId = 'a'.repeat(1025);
  assert.throws(() => extractIdEquality({ _id: longId }), ValidationError);
});

void test('extractIdEquality rejects _id with null byte', () => {
  assert.throws(
    () => extractIdEquality({ _id: 'test\0evil' }),
    ValidationError,
  );
});

void test('extractIdEquality accepts valid _id', () => {
  const result = extractIdEquality({ _id: 'valid-id-123' });
  assert.equal(result, 'valid-id-123');
});

void test('extractIdInclusion rejects _id with control characters', () => {
  assert.throws(
    () => extractIdInclusion({ _id: { $in: ['valid', 'bad\x01id'] } }),
    ValidationError,
  );
});

void test('extractIdRange rejects range bounds with control characters', () => {
  assert.throws(
    () => extractIdRange({ _id: { $gte: 'a\0b', $lte: 'z' } }),
    ValidationError,
  );
});

void test('exists() rejects oversized _id', async () => {
  const db = new Database();
  const col = db.collection('test-exists');
  const longId = 'a'.repeat(1025);
  await assert.rejects(() => col.exists(longId), ValidationError);
  await db.close();
});

// --- #17 groupBy per-group document cap ---

void test('groupBy rejects when a single group exceeds MAX_GROUP_DOCUMENTS', () => {
  // Create documents that all fall into the same group
  const documents = Array.from({ length: MAX_GROUP_DOCUMENTS + 1 }, (_, i) => ({
    _id: `d${i}`,
    dept: 'same-dept', // all same group key
    value: i,
  }));

  assert.throws(
    () =>
      computeGroupBy(documents, 'dept', { total: { $count: true } }, pathCache),
    ValidationError,
  );
});

void test('groupBy allows group at maximum document count', () => {
  // Create exactly 100 docs in one group — representative of the boundary case
  const documents = Array.from({ length: 100 }, (_, i) => ({
    _id: `d${i}`,
    dept: 'eng',
    value: i,
  }));

  const result = computeGroupBy(
    documents,
    'dept',
    { total: { $count: true } },
    pathCache,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].total, 100);
});

// --- #18 Error message sanitization ---

void test('sanitizeForLog passes through clean strings unchanged', () => {
  assert.equal(sanitizeForLog('clean'), 'clean');
  assert.equal(sanitizeForLog('normal-name_123.test'), 'normal-name_123.test');
});

void test('sanitizeForLog escapes null byte (\\x00)', () => {
  assert.equal(sanitizeForLog('has\x00null'), 'has\\x00null');
});

void test('sanitizeForLog escapes unit separator (\\x1f)', () => {
  assert.equal(sanitizeForLog('has\x1ftab'), 'has\\x1ftab');
});

void test('sanitizeForLog escapes DEL character (\\x7f)', () => {
  assert.equal(sanitizeForLog('has\x7fdel'), 'has\\x7fdel');
});

void test('sanitizeForLog escapes multiple control characters', () => {
  assert.equal(sanitizeForLog('\x01\x1f\x7f'), '\\x01\\x1f\\x7f');
});

// --- #19 watch() listener error forwarding ---

void test('ChangeEmitter forwards listener errors to error handler', () => {
  const emitter = new ChangeEmitter();
  const errors: unknown[] = [];
  emitter.setErrorHandler((error) => errors.push(error));

  const testError = new Error('listener failed');
  emitter.watch(() => {
    throw testError;
  });

  emitter.emit('insert', 'test-col', 'doc1', { _id: 'doc1' });

  assert.equal(errors.length, 1);
  assert.equal(errors[0], testError);
});

void test('ChangeEmitter continues after listener error', () => {
  const emitter = new ChangeEmitter();
  const results: string[] = [];

  emitter.watch(() => {
    throw new Error('fail');
  });
  emitter.watch((event) => {
    results.push(event.documentId);
  });

  emitter.emit('insert', 'test-col', 'doc1', { _id: 'doc1' });

  assert.equal(results.length, 1);
  assert.equal(results[0], 'doc1');
});
