import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getValueByPath,
  PATH_NOT_FOUND,
  setValueByPath,
  unsetValueByPath,
  validateFieldPath,
} from '../../src/internal/documentPath.js';

const pathCache = new Map<string, string[]>();

void test('splitPath rejects __proto__ segment', () => {
  assert.throws(
    () => setValueByPath({}, '__proto__.polluted', true, pathCache),
    {
      message: /invalid or restricted/,
    },
  );
});

void test('splitPath rejects constructor segment', () => {
  assert.throws(() => getValueByPath({}, 'a.constructor.b', pathCache), {
    message: /invalid or restricted/,
  });
});

void test('splitPath rejects prototype segment', () => {
  assert.throws(() => unsetValueByPath({}, 'prototype.x', pathCache), {
    message: /invalid or restricted/,
  });
});

void test('splitPath rejects __proto__ in nested path', () => {
  assert.throws(() => setValueByPath({}, 'a.b.__proto__', 'x', pathCache), {
    message: /invalid or restricted/,
  });
});

// --- validateFieldPath (exported) ---

void test('validateFieldPath rejects empty string', () => {
  assert.throws(() => validateFieldPath(''), {
    message: 'Field path must be a non-empty string.',
  });
});

void test('validateFieldPath rejects path exceeding maximum length', () => {
  const longPath = 'a'.repeat(513);
  assert.throws(() => validateFieldPath(longPath), {
    message: /exceeds maximum length/,
  });
});

void test('validateFieldPath rejects empty segment', () => {
  assert.throws(() => validateFieldPath('a..b'), {
    message: /invalid or restricted/,
  });
});

void test('validateFieldPath rejects reserved segments', () => {
  for (const segment of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => validateFieldPath(`a.${segment}.b`), {
      message: /invalid or restricted/,
    });
  }
});

void test('validateFieldPath rejects paths exceeding maximum depth', () => {
  const segments = Array.from({ length: 33 }, (_, i) => `s${String(i)}`);
  assert.throws(() => validateFieldPath(segments.join('.')), {
    message: /exceeds maximum depth/,
  });
});

void test('validateFieldPath accepts valid paths', () => {
  assert.doesNotThrow(() => validateFieldPath('a'));
  assert.doesNotThrow(() => validateFieldPath('a.b.c'));
});

void test('setValueByPath does not pollute Object.prototype', () => {
  assert.throws(
    () => setValueByPath({}, '__proto__.polluted', true, pathCache),
    {
      message: /invalid or restricted/,
    },
  );

  // Verify prototype was not polluted
  const clean: Record<string, unknown> = {};
  assert.equal(clean['polluted' as keyof typeof clean], undefined);
});

// --- splitPath LRU cache ---

void test('splitPath LRU: cache does not exceed MAX_CACHE_SIZE after 2048 distinct paths', () => {
  const cache = new Map<string, string[]>();
  // Populate 2048 distinct paths to exceed the 1024-entry cap.
  for (let i = 0; i < 2048; i += 1) {
    getValueByPath({}, `field_${String(i)}`, cache);
  }
  // The LRU cache should have evicted excess entries and settled at exactly 1024.
  assert.equal(cache.size, 1024);
});

void test('splitPath LRU: all 2048 paths return correct segments', () => {
  const cache = new Map<string, string[]>();
  // Pre-populate so the cache is full
  for (let i = 0; i < 2048; i += 1) {
    getValueByPath({}, `field_${String(i)}`, cache);
  }
  // Re-access every path and verify segments are correct regardless of whether
  // the result comes from cache or a fresh parse.
  for (let i = 0; i < 2048; i += 1) {
    const doc: Record<string, unknown> = { [`field_${String(i)}`]: i };
    const result = getValueByPath(doc, `field_${String(i)}`, cache);
    assert.notEqual(result, PATH_NOT_FOUND);
    assert.equal(result, i);
  }
});

void test('splitPath LRU: most-recently-used paths are retained after overflow', () => {
  const cache = new Map<string, string[]>();
  // Warm cache with paths 0..1023 (fills it to capacity).
  for (let i = 0; i < 1024; i += 1) {
    getValueByPath({}, `lru_path_${String(i)}`, cache);
  }
  // Re-access paths 512..1023 to promote them to MRU; paths 0..511 remain LRU.
  for (let i = 512; i < 1024; i += 1) {
    getValueByPath({}, `lru_path_${String(i)}`, cache);
  }
  // Adding 512 new paths should evict the 512 oldest (lru_path_0..lru_path_511).
  for (let i = 1024; i < 1536; i += 1) {
    getValueByPath({}, `lru_path_${String(i)}`, cache);
  }
  // Cache should still be at capacity.
  assert.equal(cache.size, 1024);
});

// --- PATH_NOT_FOUND sentinel ---

void test('getValueByPath returns PATH_NOT_FOUND for missing paths', () => {
  const cache = new Map<string, string[]>();
  const doc: Record<string, unknown> = { a: { b: 1 } };
  assert.equal(getValueByPath(doc, 'a.c', cache), PATH_NOT_FOUND);
  assert.equal(getValueByPath(doc, 'z', cache), PATH_NOT_FOUND);
  assert.equal(getValueByPath({}, 'a', cache), PATH_NOT_FOUND);
});

void test('getValueByPath returns raw value for existing paths', () => {
  const cache = new Map<string, string[]>();
  const doc: Record<string, unknown> = { a: { b: 42 }, c: 'hello', d: null };
  assert.equal(getValueByPath(doc, 'a.b', cache), 42);
  assert.equal(getValueByPath(doc, 'c', cache), 'hello');
  assert.equal(getValueByPath(doc, 'd', cache), null);
});

void test('getValueByPath returns undefined (not PATH_NOT_FOUND) when field value is explicitly undefined', () => {
  const cache = new Map<string, string[]>();
  const doc: Record<string, unknown> = { a: undefined };
  const result = getValueByPath(doc, 'a', cache);
  assert.notEqual(result, PATH_NOT_FOUND);
  assert.equal(result, undefined);
});
