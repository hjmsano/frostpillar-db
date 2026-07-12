// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify countOptionalQuantifiers and the
// MAX_REGEX_OPTIONAL_QUANTIFIERS cap in src/internal/filterCache.ts block a
// chain of independently skippable atoms. No code here produces a usable
// payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { countOptionalQuantifiers } from '../../src/internal/filterCache.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';
import { MAX_REGEX_OPTIONAL_QUANTIFIERS } from '../../src/internal/limits.js';

const caches = createDatabaseCaches();

// ---------------------------------------------------------------------------
// countOptionalQuantifiers — direct unit coverage of the counter, independent
// of the ValidationError-throwing wrapper in assertSafeRegexPattern.
//
// An "optional" quantifier is one whose minimum repetition count is zero, so
// its atom can be skipped: '?', '*', and any {0}/{0,}/{0,m} bound. Each such
// atom is an independent binary choice for the backtracking engine, so k of
// them cost up to 2^k paths on a failing match.
// ---------------------------------------------------------------------------

void test('countOptionalQuantifiers: ? and * count, + does not', () => {
  assert.equal(countOptionalQuantifiers('a?b*c+'), 2);
});

void test('countOptionalQuantifiers: {0,m}, {0,} and {0} count; {1,m} does not', () => {
  assert.equal(countOptionalQuantifiers('a{0,5}b{0,}c{0}d{1,5}e{2}'), 3);
});

void test('countOptionalQuantifiers: group-syntax ? is not a quantifier token', () => {
  assert.equal(countOptionalQuantifiers('(?:a)(?=b)(?<name>c)'), 0);
  assert.equal(countOptionalQuantifiers('(?:a)?'), 1);
});

void test('countOptionalQuantifiers: escaped tokens and character-class contents are ignored', () => {
  assert.equal(countOptionalQuantifiers('a\\?b\\*c[?*]d'), 0);
});

void test('countOptionalQuantifiers: a lazy marker is itself an optional token (conservative over-count)', () => {
  assert.equal(countOptionalQuantifiers('a*?'), 2);
  assert.equal(countOptionalQuantifiers('a+?'), 1);
});

void test('countOptionalQuantifiers: counts the chain of optional wildcards', () => {
  assert.equal(countOptionalQuantifiers('^' + '.?'.repeat(20) + 'a'.repeat(20) + '$'), 20);
});

// ---------------------------------------------------------------------------
// End-to-end rejection via assertSafeRegexPattern.
// ---------------------------------------------------------------------------

void test('$regex rejects a chain of optional wildcards: ^(.?){20}-style 2^20 blowup', () => {
  // 20 '.?' atoms then 20 literal 'a's: no repeated atom, no nested quantifier,
  // no alternation, no adjacent-duplicate shape — it passed every prior screen
  // and cost ~1.5 ms per failing evaluation (~15 s over a 10,000-doc scan).
  const document = { _id: 'u1', name: 'bbbbbbbbbbbbbbbbbbbb' };
  const pattern = '^' + '.?'.repeat(20) + 'a'.repeat(20) + '$';

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects optional wildcards interleaved with mandatory atoms', () => {
  // Mandatory atoms between the optional ones always match, so they prune no
  // branch: the path count stays exponential in the total, which is why the cap
  // counts the whole pattern rather than the longest adjacent run.
  const document = { _id: 'u1', name: 'bbbbbbbbbbbbbbbbbbbb' };
  const pattern = '^' + '.?\\w'.repeat(12) + 'z$';

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects a chain of optional groups: (?:a)? repeated', () => {
  const document = { _id: 'u1', name: 'aaa' };
  const pattern = '(?:a)?'.repeat(MAX_REGEX_OPTIONAL_QUANTIFIERS + 1);

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects a chain of {0,1}-bounded atoms — brace syntax is not an escape hatch', () => {
  const document = { _id: 'u1', name: 'aaa' };
  const pattern = '.{0,1}'.repeat(MAX_REGEX_OPTIONAL_QUANTIFIERS + 1) + 'z';

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex accepts exactly MAX_REGEX_OPTIONAL_QUANTIFIERS optional atoms', () => {
  const document = { _id: 'u1', name: 'abc' };
  const pattern = '.?'.repeat(MAX_REGEX_OPTIONAL_QUANTIFIERS);

  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: pattern } }, caches),
  );
});

void test('$regex accepts realistic patterns that use a few optional quantifiers', () => {
  const document = { _id: 'u1', url: 'https://www.example.com/docs' };

  assert.doesNotThrow(() =>
    matchesFilter(
      document,
      { url: { $regex: '^https?://(?:www\\.)?[-\\w]+\\.[a-z]{2,}(?:/[^\\s]*)?$' } },
      caches,
    ),
  );
});

void test('$regex accepts mandatory quantifiers beyond the optional cap', () => {
  // '+' and '{1,}' atoms are not skippable, so they are bounded by
  // MAX_REGEX_QUANTIFIERS alone and must not be charged to the optional cap.
  const document = { _id: 'u1', name: 'a-a-a-a-a-a-a-a-a-a' };
  const pattern = 'a+-'.repeat(MAX_REGEX_OPTIONAL_QUANTIFIERS + 2).slice(0, -1);

  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: pattern } }, caches),
  );
});
