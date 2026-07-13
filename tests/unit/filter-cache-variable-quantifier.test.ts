// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify countVariableWidthQuantifiers and
// the MAX_REGEX_VARIABLE_QUANTIFIERS cap in src/internal/filterCache.ts block a
// chain of atoms whose width the engine may choose. No code here produces a
// usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { countVariableWidthQuantifiers } from '../../src/internal/filterCache.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';
import { MAX_REGEX_VARIABLE_QUANTIFIERS } from '../../src/internal/limits.js';

const caches = createDatabaseCaches();

// ---------------------------------------------------------------------------
// countVariableWidthQuantifiers — direct unit coverage of the counter,
// independent of the ValidationError-throwing wrapper in assertSafeRegexPattern.
//
// A "variable-width" quantifier is one whose minimum and maximum repetition
// counts differ, so its atom can be consumed at more than one width: '?', '*',
// '+', '{n,}', and any '{n,m}' with m > n. Each such atom is an independent
// choice point for the backtracking engine, so k of them cost an exponential
// number of paths on a failing match. A fixed-width '{n}' offers no choice.
// ---------------------------------------------------------------------------

void test('countVariableWidthQuantifiers: ?, * and + all count', () => {
  assert.equal(countVariableWidthQuantifiers('a?b*c+'), 3);
});

void test('countVariableWidthQuantifiers: variable bounds count; fixed {n} does not', () => {
  // {0,5} {0,} {0} {1,5} {2}: the {0} and {2} bounds are fixed-width.
  assert.equal(countVariableWidthQuantifiers('a{0,5}b{0,}c{0}d{1,5}e{2}'), 3);
});

void test('countVariableWidthQuantifiers: a minimum of one is not an escape hatch', () => {
  // The bug this counter used to have: it recognised only a minimum of zero, so
  // a chain of one-or-two-character atoms — the same 2^k shape — sailed through.
  assert.equal(countVariableWidthQuantifiers('a{1,2}b{1,2}c{1,2}'), 3);
  assert.equal(countVariableWidthQuantifiers('a{3,3}b{3}'), 0);
});

void test('countVariableWidthQuantifiers: group-syntax ? is not a quantifier token', () => {
  assert.equal(countVariableWidthQuantifiers('(?:a)(?=b)(?<name>c)'), 0);
  assert.equal(countVariableWidthQuantifiers('(?:a)?'), 1);
});

void test('countVariableWidthQuantifiers: escaped tokens and character-class contents are ignored', () => {
  assert.equal(countVariableWidthQuantifiers('a\\?b\\*c[?*+]d'), 0);
});

void test('countVariableWidthQuantifiers: a lazy marker is itself a token (conservative over-count)', () => {
  assert.equal(countVariableWidthQuantifiers('a*?'), 2);
  assert.equal(countVariableWidthQuantifiers('a+?'), 2);
});

void test('countVariableWidthQuantifiers: counts the chain of optional wildcards', () => {
  assert.equal(
    countVariableWidthQuantifiers('^' + '.?'.repeat(20) + 'a'.repeat(20) + '$'),
    20,
  );
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

void test('$regex rejects a chain of {1,2}-bounded atoms — a minimum of one still explodes', () => {
  // The reported evasion: every atom must match at least once, so the previous
  // minimum-of-zero counter charged the pattern nothing — yet each atom still
  // takes one *or two* characters, and a failing match distributes those choices
  // 2^k ways (~5.2 ms per warmed non-match, multiplied by the scanned documents).
  const document = { _id: 'u1', name: 'b'.repeat(40) };
  const pattern =
    '^' + '.{1,2}'.repeat(MAX_REGEX_VARIABLE_QUANTIFIERS + 1) + 'z$';

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects a chain of + atoms — an unbounded maximum is variable too', () => {
  const document = { _id: 'u1', name: 'a-a-a-a-a-a-a-a-a-a' };
  const pattern = 'a+-'.repeat(MAX_REGEX_VARIABLE_QUANTIFIERS + 1).slice(0, -1);

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects optional wildcards interleaved with mandatory atoms', () => {
  // Fixed-width atoms between the variable ones always consume the same width,
  // so they prune no branch: the path count stays exponential in the total,
  // which is why the cap counts the whole pattern, not the longest adjacent run.
  const document = { _id: 'u1', name: 'bbbbbbbbbbbbbbbbbbbb' };
  const pattern = '^' + '.?\\w'.repeat(12) + 'z$';

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects a chain of optional groups: (?:a)? repeated', () => {
  const document = { _id: 'u1', name: 'aaa' };
  const pattern = '(?:a)?'.repeat(MAX_REGEX_VARIABLE_QUANTIFIERS + 1);

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects a chain of {0,1}-bounded atoms — brace syntax is not an escape hatch', () => {
  const document = { _id: 'u1', name: 'aaa' };
  const pattern = '.{0,1}'.repeat(MAX_REGEX_VARIABLE_QUANTIFIERS + 1) + 'z';

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

void test('$regex accepts exactly MAX_REGEX_VARIABLE_QUANTIFIERS variable-width atoms', () => {
  const document = { _id: 'u1', name: 'abc' };
  const pattern = '.?'.repeat(MAX_REGEX_VARIABLE_QUANTIFIERS);

  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: pattern } }, caches),
  );
});

void test('$regex accepts realistic patterns that use a few variable-width quantifiers', () => {
  const document = { _id: 'u1', url: 'https://www.example.com/docs' };

  assert.doesNotThrow(() =>
    matchesFilter(
      document,
      {
        url: {
          $regex: '^https?://(?:www\\.)?[-\\w]+\\.[a-z]{2,}(?:/[^\\s]*)?$',
        },
      },
      caches,
    ),
  );
});

void test('$regex accepts a long chain of fixed-width atoms — no choice, no backtracking', () => {
  // {n} consumes exactly n characters, so however many are chained the engine
  // never has an alternative to try: they are bounded by MAX_REGEX_QUANTIFIERS
  // alone and must not be charged to the variable-width cap.
  const document = { _id: 'u1', name: 'ab-cd-ef-gh-ij-kl-mn-op-qr-st' };
  const pattern = '.{2}-'
    .repeat(MAX_REGEX_VARIABLE_QUANTIFIERS + 2)
    .slice(0, -1);

  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: pattern } }, caches),
  );
});
