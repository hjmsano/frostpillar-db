// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the enhanced-ReDoS-detection,
// payload-security, and reserved-key guards in src/internal/ block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/database.js';
import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';
import { getValueByPath } from '../../src/internal/documentPath.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';
import { validatePayloadSecurity } from '../../src/internal/payloadValidator.js';
import type { FrostpillarStoredDocument } from '../../src/types.js';
import {
  MAX_REGEX_ALTERNATION_GROUPS,
  MAX_REGEX_TEST_LENGTH,
} from '../../src/internal/limits.js';

const caches = createDatabaseCaches();
const pathCache = caches.pathCache;

// --- #10 Enhanced ReDoS detection ---

void test('$regex rejects bounded quantifier equivalent to unbounded: (a{1,2})+', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a{1,2})+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects nested quantifier with bounded outer: (a+){2,}', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a+){2,}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects bounded quantifier in group with outer quantifier: (a{1,100})*', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a{1,100})*' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects character class content with quantifier inside quantified group: ([ab]+)+', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '([ab]+)+' } }, caches),
    ValidationError,
  );
});

void test('$regex accepts simple character class: ^[a-z]+$', () => {
  const document = { _id: 'u1', name: 'alice' };
  assert.equal(
    matchesFilter(document, { name: { $regex: '^[a-z]+$' } }, caches),
    true,
  );
});

void test('$regex accepts bounded quantifier without nesting: \\d{1,3}\\.\\d{1,3}', () => {
  const document = { _id: 'u1', ip: '192.168' };
  assert.equal(
    matchesFilter(document, { ip: { $regex: '\\d{1,3}\\.\\d{1,3}' } }, caches),
    true,
  );
});

void test('$regex accepts literal group quantified without inner quantifier: (abc)+', () => {
  const document = { _id: 'u1', name: 'abcabc' };
  assert.equal(
    matchesFilter(document, { name: { $regex: '(abc)+' } }, caches),
    true,
  );
});

void test('$regex rejects optional quantifier in quantified group: (a?)+', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a?)+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects backreference with quantifier: (a+)\\1+', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a+)\\1+' } }, caches),
    ValidationError,
  );
});

void test('$regex still accepts escaped question mark in group: (\\?)+', () => {
  const document = { _id: 'u1', name: '???' };
  assert.equal(
    matchesFilter(document, { name: { $regex: '(\\?)+' } }, caches),
    true,
  );
});

void test('$regex rejects field value exceeding MAX_REGEX_TEST_LENGTH', () => {
  const longValue = 'a'.repeat(MAX_REGEX_TEST_LENGTH + 1);
  const document = { _id: 'u1', name: longValue };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '^a' } }, caches),
    ValidationError,
  );
});

void test('$regex accepts field value within MAX_REGEX_TEST_LENGTH', () => {
  const value = 'a'.repeat(MAX_REGEX_TEST_LENGTH);
  const document = { _id: 'u1', name: value };
  assert.equal(
    matchesFilter(document, { name: { $regex: '^a' } }, caches),
    true,
  );
});

// --- #11 skipPayloadValidation security gate ---

void test('validatePayloadSecurity rejects constructor key in nested payload', () => {
  assert.throws(
    () => validatePayloadSecurity({ _id: '1', nested: { constructor: 'bad' } }),
    ValidationError,
  );
});

void test('validatePayloadSecurity rejects prototype key in nested payload', () => {
  assert.throws(
    () => validatePayloadSecurity({ _id: '1', nested: { prototype: {} } }),
    ValidationError,
  );
});

void test('validatePayloadSecurity allows clean payload', () => {
  assert.doesNotThrow(() =>
    validatePayloadSecurity({
      _id: '1',
      name: 'Alice',
      tags: ['a', { valid: true }],
    }),
  );
});

void test('validatePayloadSecurity rejects reserved key inside array element', () => {
  assert.throws(
    () => validatePayloadSecurity({ _id: '1', arr: [{ constructor: 'bad' }] }),
    ValidationError,
  );
});

void test('insert with skipPayloadValidation still rejects reserved keys', async () => {
  const db = new Database({ skipPayloadValidation: true });
  const col = db.collection<{ _id?: string; nested: Record<string, unknown> }>(
    'test-skip-validation',
  );
  await assert.rejects(
    async () => col.insert({ _id: '1', nested: { constructor: 'tampered' } }),
    ValidationError,
  );
  await db.close();
});

// --- #12 Extended reserved key set ---

void test('$set rejects __defineGetter__ key in nested object', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $set: { meta: { __defineGetter__: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects __defineSetter__ key in nested object', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $set: { meta: { __defineSetter__: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects __lookupGetter__ key in nested object', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $set: { meta: { __lookupGetter__: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$set rejects __lookupSetter__ key in nested object', () => {
  const document = { _id: 'u1' } as FrostpillarStoredDocument;
  assert.throws(
    () =>
      applyUpdateOperations(
        document,
        { $set: { meta: { __lookupSetter__: 'bad' } } },
        pathCache,
      ),
    ValidationError,
  );
});

void test('field path rejects __defineGetter__ segment', () => {
  assert.throws(
    () => getValueByPath({}, '__defineGetter__.x', pathCache),
    ValidationError,
  );
});

// --- #13 $regex alternation-group cap (Fix S1) ---
//
// `(a|aa)` repeated N times with NO quantifier character at all produces the
// same class of exponential backtracking blowup as a quantified alternation
// group, but carries zero quantifier tokens — so it evades both
// MAX_REGEX_QUANTIFIERS and every quantifier-keyed CATASTROPHIC_PATTERNS
// heuristic. MAX_REGEX_ALTERNATION_GROUPS (4) closes that gap directly.

void test('$regex rejects an unrolled ambiguous alternation with no quantifier characters (5 groups)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  const pattern = '(a|aa)'.repeat(5) + 'c';
  assert.ok(!/[+*?{]/.test(pattern), 'pattern must contain no quantifier characters');
  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects an unrolled ambiguous alternation (a|a) repeated 6 times', () => {
  const document = { _id: 'u1', name: 'Alice' };
  const pattern = '(a|a)'.repeat(6);
  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test(`$regex accepts a pattern at exactly MAX_REGEX_ALTERNATION_GROUPS (${String(MAX_REGEX_ALTERNATION_GROUPS)})`, () => {
  const document = { _id: 'u1', name: 'Alice' };
  const pattern = '(a|b)'.repeat(MAX_REGEX_ALTERNATION_GROUPS);
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: pattern } }, caches),
  );
});

void test(`$regex rejects a pattern one group past MAX_REGEX_ALTERNATION_GROUPS (${String(MAX_REGEX_ALTERNATION_GROUPS + 1)})`, () => {
  const document = { _id: 'u1', name: 'Alice' };
  const pattern = '(a|b)'.repeat(MAX_REGEX_ALTERNATION_GROUPS + 1);
  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex accepts a single multi-way alternation group: (cat|dog|bird|fish)', () => {
  const document = { _id: 'u1', name: 'dog' };
  assert.equal(
    matchesFilter(
      document,
      { name: { $regex: '^(cat|dog|bird|fish)$' } },
      caches,
    ),
    true,
  );
});

void test('$regex accepts two independent alternation groups: (a|b).*(c|d)', () => {
  const document = { _id: 'u1', name: 'a-c' };
  assert.equal(
    matchesFilter(document, { name: { $regex: '(a|b).*(c|d)' } }, caches),
    true,
  );
});

void test('$regex still rejects (a|a)+ via the pre-existing quantifier heuristic (1 alternation group, under the cap)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a|a)+' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects (a|ab)* via the pre-existing quantifier heuristic (1 alternation group, under the cap)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a|ab)*' } }, caches),
    ValidationError,
  );
});

// --- #14 Generalized nested-quantifier detector (Fix S1 round-2 follow-up) ---
//
// Round-2 adversarial testing found `^(a{1,10}){1,10}$` — a bounded `{n,m}`
// quantifier nested inside another bounded `{n,m}` quantifier — passed every
// existing check: under MAX_REGEX_QUANTIFIERS, 0 alternation groups, and no
// hand-written CATASTROPHIC_PATTERNS entry matched (each was written for one
// specific quantifier-syntax combination, none for bounded-inside-bounded).
// `hasNestedQuantifier` (src/internal/filterCache.ts) replaces those
// hand-written nested-quantifier entries with one structural check that
// catches the shape regardless of which quantifier syntax is used on either
// side. These tests confirm the actual repro is closed, and that the six
// shapes previously caught by the now-removed entries are still rejected —
// via `hasNestedQuantifier` instead — with no coverage regression.

void test('$regex rejects the actual round-2 repro: ^(a{1,10}){1,10}$', () => {
  const document = { _id: 'u1', name: 'a'.repeat(44) };
  assert.throws(
    () =>
      matchesFilter(document, { name: { $regex: '^(a{1,10}){1,10}$' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects (a+)+ (now via hasNestedQuantifier, was CATASTROPHIC_PATTERNS #0)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a+)+' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects ([a-z]+)+ (now via hasNestedQuantifier, was CATASTROPHIC_PATTERNS #4)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '([a-z]+)+' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects (\\d+)+ (now via hasNestedQuantifier, was CATASTROPHIC_PATTERNS #5)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(\\d+)+' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects (a{1,2})+ (now via hasNestedQuantifier, was CATASTROPHIC_PATTERNS #6)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a{1,2})+' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects (a+){2,} (now via hasNestedQuantifier, was CATASTROPHIC_PATTERNS #7)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a+){2,}' } }, caches),
    ValidationError,
  );
});

void test('$regex still rejects (a?)+ (now via hasNestedQuantifier, was CATASTROPHIC_PATTERNS #8)', () => {
  const document = { _id: 'u1', name: 'Alice' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a?)+' } }, caches),
    ValidationError,
  );
});
