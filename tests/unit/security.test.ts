// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the ReDoS-detection and
// path/filter depth guards in src/internal/ continue to block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { createDatabaseCaches } from '../../src/internal/databaseCaches.js';
import { matchesFilter } from '../../src/internal/filterEvaluator.js';
import {
  getValueByPath,
  PATH_NOT_FOUND,
  setValueByPath,
} from '../../src/internal/documentPath.js';
import {
  MAX_FIELD_PATH_DEPTH,
  MAX_FIELD_PATH_LENGTH,
  MAX_FILTER_NESTING_DEPTH,
  MAX_REGEX_PATTERN_LENGTH,
} from '../../src/internal/limits.js';

const caches = createDatabaseCaches();
const pathCache = caches.pathCache;

// --- #1 ReDoS protection ---

void test('$regex rejects patterns exceeding maximum length', () => {
  const document = { _id: 'u1', name: 'Alice' };
  const longPattern = 'a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1);

  assert.throws(
    () => matchesFilter(document, { name: { $regex: longPattern } }, caches),
    ValidationError,
  );
});

void test('$regex rejects catastrophic backtracking patterns', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a+)+b' } }, caches),
    ValidationError,
  );

  assert.throws(
    () =>
      matchesFilter(
        document,
        { name: { $regex: '(.*)*@example.com' } },
        caches,
      ),
    ValidationError,
  );
});

void test('$regex rejects alternation-based backtracking patterns', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a|a)+' } }, caches),
    ValidationError,
  );

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a|ab)*' } }, caches),
    ValidationError,
  );
});

void test('$regex still accepts safe patterns', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.equal(
    matchesFilter(document, { name: { $regex: '^Ali' } }, caches),
    true,
  );
  assert.equal(
    matchesFilter(document, { name: { $regex: 'ice$' } }, caches),
    true,
  );
});

void test('$regex rejects chained/adjacent quantifiers (previously reported pattern)', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () =>
      matchesFilter(
        document,
        { name: { $regex: '\\d+\\d+\\d+\\d+\\d+\\d+\\d+\\d+\\d+\\d+$' } },
        caches,
      ),
    ValidationError,
  );
});

void test('$regex rejects adjacent quantified shorthand classes', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '\\d+\\d+' } }, caches),
    ValidationError,
  );

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '\\w+\\w+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects adjacent quantified wildcards', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '.+.+' } }, caches),
    ValidationError,
  );

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '.*.*' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects adjacent quantified character classes', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '[a-z]+[a-z]+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects adjacent same-literal quantifiers', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: 'a+a+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects adjacent bounded quantifiers on shorthand classes', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () =>
      matchesFilter(document, { name: { $regex: '\\d{2,}\\d{2,}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects adjacent star quantifiers on shorthand classes', () => {
  const document = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () => matchesFilter(document, { name: { $regex: '\\w*\\w*' } }, caches),
    ValidationError,
  );
});

void test('$regex accepts legitimate patterns that must not be falsely rejected', () => {
  const document = { _id: 'u1', name: '2026-06-04T12:00:00' };

  // datetime pattern
  assert.equal(
    matchesFilter(
      document,
      {
        name: {
          $regex: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$',
        },
      },
      caches,
    ),
    true,
  );
});

void test('$regex accepts UUID pattern', () => {
  const document = {
    _id: 'u1',
    name: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  };

  assert.equal(
    matchesFilter(
      document,
      {
        name: {
          $regex:
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        },
      },
      caches,
    ),
    true,
  );
});

void test('$regex accepts simple email pattern', () => {
  const document = { _id: 'u1', name: 'a@b.co' };

  assert.equal(
    matchesFilter(
      document,
      { name: { $regex: '^[^@]+@[^@]+\\.[^@]+$' } },
      caches,
    ),
    true,
  );
});

void test('$regex accepts separated quantifiers (not adjacent)', () => {
  const document = { _id: 'u1', name: '123-456' };

  assert.equal(
    matchesFilter(document, { name: { $regex: '\\d+-\\d+' } }, caches),
    true,
  );
});

void test('$regex accepts different-literal adjacent quantifiers', () => {
  const document = { _id: 'u1', name: 'aaabbb' };

  assert.equal(
    matchesFilter(document, { name: { $regex: 'a+b+' } }, caches),
    true,
  );
});

void test('$regex rejects patterns exceeding MAX_REGEX_QUANTIFIERS', () => {
  const document = { _id: 'u1', name: 'Alice' };
  // 21 quantifiers separated by '-' so the adjacency detector does NOT fire
  const pattern = 'a?-'.repeat(21).slice(0, -1);

  assert.throws(
    () => matchesFilter(document, { name: { $regex: pattern } }, caches),
    ValidationError,
  );
});

// --- #1b Group-syntax '?' false-positive fix (end-to-end via assertSafeRegexPattern) ---
// Patterns using (?:, (?=, (?!, (?<=, (?<!, or (?<name> were wrongly rejected
// because the '?' in group syntax was (a) counted toward MAX_REGEX_QUANTIFIERS
// and (b) falsely marked the group as "has a quantifier" in hasNestedQuantifier.

void test('$regex accepts (?:abc)+ — non-capturing group with outer quantifier', () => {
  const document = { _id: 'u1', name: 'abcabc' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(?:abc)+' } }, caches),
  );
});

void test('$regex accepts (?<name>abc)+ — named capture group with outer quantifier', () => {
  const document = { _id: 'u1', name: 'abcabc' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(?<name>abc)+' } }, caches),
  );
});

void test('$regex accepts (?:abc)* — non-capturing group with outer *', () => {
  const document = { _id: 'u1', name: 'abc' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(?:abc)*' } }, caches),
  );
});

void test('$regex accepts (?:abc){2,5} — non-capturing group with outer bounded quantifier', () => {
  const document = { _id: 'u1', name: 'abcabc' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(?:abc){2,5}' } }, caches),
  );
});

void test('$regex accepts (?=x)y+ — lookahead followed by quantified atom', () => {
  const document = { _id: 'u1', name: 'xy' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(?=x)y+' } }, caches),
  );
});

void test('$regex accepts a(?:b)? — optional non-capturing group', () => {
  const document = { _id: 'u1', name: 'a' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: 'a(?:b)?' } }, caches),
  );
});

void test('$regex accepts (?:https?) — non-capturing group with inner optional, no outer quantifier', () => {
  const document = { _id: 'u1', url: 'https://example.com' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { url: { $regex: '(?:https?)' } }, caches),
  );
});

void test('$regex accepts ^(?:[a-z]+\\.)?example$ — realistic domain-prefix pattern', () => {
  const document = { _id: 'u1', host: 'www.example' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { host: { $regex: '^(?:[a-z]+\\.)?example$' } }, caches),
  );
});

void test('$regex accepts 21 non-capturing groups — group-syntax ? not counted toward MAX_REGEX_QUANTIFIERS', () => {
  // Each '(?:a)' has a group-syntax '?' that must NOT count as a quantifier.
  // Before the fix, 21 such groups produced 21 counted quantifiers (> MAX of 20)
  // and the pattern was rejected; after the fix the count is 0.
  const document = { _id: 'u1', name: 'a' };
  const pattern = '(?:a)'.repeat(21);
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: pattern } }, caches),
  );
});

void test('$regex rejects (?:a+)+ — group-syntax prefix does not exempt real inner quantifiers', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(?:a+)+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (?<name>a+)+ — named capture group does not exempt real inner quantifiers', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(?<name>a+)+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (?:a{1,10}){1,10} — bounded inside non-capturing, bounded outside', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () =>
      matchesFilter(document, { name: { $regex: '(?:a{1,10}){1,10}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects ((?:a+))+ — nested quantifier via wrapping capturing group', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '((?:a+))+' } }, caches),
    ValidationError,
  );
});

// --- #1c Alternation group repeated via brace quantifiers ---
// The old hand-written detector /\([^)]*\|[^)]*\)[+*]/ only covered literal
// +/* after an alternation group. Brace-quantified repeats ({2,}, {2,50},
// {2}) are equally catastrophic (ambiguous alternation under a repeat is
// ~2^n paths, even bounded) and are now rejected by the structural
// hasQuantifiedAlternationGroup check.

void test('$regex rejects (aa|a){2,} — alternation group with unbounded brace repeat', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(aa|a){2,}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (?:aa|a){2,} — non-capturing alternation group with unbounded brace repeat', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () =>
      matchesFilter(document, { name: { $regex: '(?:aa|a){2,}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (?:aa|a){2,50} — bounded brace repeat still explodes (~2^50 paths)', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () =>
      matchesFilter(document, { name: { $regex: '(?:aa|a){2,50}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (aa|a){2} — exact-count brace repeat with n >= 2', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(aa|a){2}' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (a|b){2,5} — alternation group with bounded brace repeat', () => {
  const document = { _id: 'u1', name: 'ab' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '(a|b){2,5}' } }, caches),
    ValidationError,
  );
});

void test('$regex accepts (a|b)? — alternation group with non-repeating optional quantifier', () => {
  const document = { _id: 'u1', name: 'a' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(a|b)?' } }, caches),
  );
});

void test('$regex accepts (a|b){0,1} — alternation group with max-1 brace bound', () => {
  const document = { _id: 'u1', name: 'a' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(a|b){0,1}' } }, caches),
  );
});

void test('$regex accepts (a|b){1} — alternation group with exact-one brace bound', () => {
  const document = { _id: 'u1', name: 'a' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(a|b){1}' } }, caches),
  );
});

void test('$regex accepts (a|b) — bare alternation group with no quantifier', () => {
  const document = { _id: 'u1', name: 'a' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(a|b)' } }, caches),
  );
});

void test('$regex accepts (?:a|b) — bare non-capturing alternation group', () => {
  const document = { _id: 'u1', name: 'a' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '(?:a|b)' } }, caches),
  );
});

// --- #1d Alternation group hidden inside a redundant wrapping group ---
// A repeat on an enclosing group repeats everything nested inside it, so
// `((a|aa))+` is semantically `(a|aa)+` and explodes ~2^(n/2). Before the
// pipe was propagated outward as each group closes, the outer group looked
// pipe-free and these evaded the screen entirely.

void test('$regex rejects ((a|aa))+ — capturing wrap around a repeated alternation', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '((a|aa))+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects (?:(?:a|ab))+ — double non-capturing wrap around a repeated alternation', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () =>
      matchesFilter(document, { name: { $regex: '(?:(?:a|ab))+' } }, caches),
    ValidationError,
  );
});

void test('$regex rejects ((a|aa)){2,} — wrapped alternation under an unbounded brace repeat', () => {
  const document = { _id: 'u1', name: 'aaa' };
  assert.throws(
    () => matchesFilter(document, { name: { $regex: '((a|aa)){2,}' } }, caches),
    ValidationError,
  );
});

void test('$regex accepts ((abc))+ — redundant wrap with no alternation, safe', () => {
  const document = { _id: 'u1', name: 'abcabc' };
  assert.doesNotThrow(() =>
    matchesFilter(document, { name: { $regex: '((abc))+' } }, caches),
  );
});

// --- #2 Filter recursion depth ---

void test('matchesFilter rejects deeply nested $and/$or filters', () => {
  const document = { _id: 'u1', age: 30 };

  type NestedFilter = { $and: [NestedFilter] } | { age: number };
  let filter: NestedFilter = { age: 30 };
  for (let i = 0; i < MAX_FILTER_NESTING_DEPTH + 5; i++) {
    filter = { $and: [filter] };
  }

  assert.throws(() => matchesFilter(document, filter, caches), ValidationError);
});

void test('matchesFilter allows filters within nesting depth limit', () => {
  const document = { _id: 'u1', age: 30 };

  type NestedFilter = { $and: [NestedFilter] } | { age: number };
  let filter: NestedFilter = { age: 30 };
  for (let i = 0; i < 5; i++) {
    filter = { $and: [filter] };
  }

  assert.equal(matchesFilter(document, filter, caches), true);
});

void test('matchesFilter rejects deeply nested $not filters', () => {
  const document = { _id: 'u1', email: 'alice@example.com' };

  let condition: unknown = { $exists: true };
  for (let i = 0; i < MAX_FILTER_NESTING_DEPTH + 5; i++) {
    condition = { $not: condition };
  }

  assert.throws(
    () => matchesFilter(document, { email: condition } as never, caches),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.message.includes('Filter nesting depth exceeds maximum'),
  );
});

void test('matchesFilter allows $not filters within nesting depth limit', () => {
  const document = { _id: 'u1', email: 'alice@example.com' };

  let condition: unknown = { $exists: true };
  for (let i = 0; i < MAX_FILTER_NESTING_DEPTH - 1; i++) {
    condition = { $not: condition };
  }

  assert.doesNotThrow(() =>
    matchesFilter(document, { email: condition } as never, caches),
  );
});

void test('matchesFilter rejects $and wrapping deeply nested $not conditions', () => {
  const document = { _id: 'u1', email: 'alice@example.com' };

  let condition: unknown = { $exists: true };
  for (let i = 0; i < MAX_FILTER_NESTING_DEPTH; i++) {
    condition = { $not: condition };
  }
  const filter = { $and: [{ email: condition }] };

  assert.throws(
    () => matchesFilter(document, filter as never, caches),
    ValidationError,
  );
});

// --- #3 Path depth limits ---

void test('splitPath rejects paths exceeding maximum length', () => {
  const longPath = 'a'.repeat(MAX_FIELD_PATH_LENGTH + 1);

  assert.throws(() => getValueByPath({}, longPath, pathCache), ValidationError);
});

void test('splitPath rejects paths exceeding maximum segment depth', () => {
  const segments = Array.from(
    { length: MAX_FIELD_PATH_DEPTH + 1 },
    (_, i) => `s${String(i)}`,
  );
  const deepPath = segments.join('.');

  assert.throws(() => getValueByPath({}, deepPath, pathCache), ValidationError);
});

void test('splitPath allows paths within limits', () => {
  const segments = Array.from(
    { length: MAX_FIELD_PATH_DEPTH },
    (_, i) => `s${String(i)}`,
  );
  const path = segments.join('.');
  const result = getValueByPath({}, path, pathCache);

  assert.equal(result, PATH_NOT_FOUND);
});

void test('setValueByPath rejects paths exceeding maximum depth', () => {
  const segments = Array.from(
    { length: MAX_FIELD_PATH_DEPTH + 1 },
    (_, i) => `s${String(i)}`,
  );
  const deepPath = segments.join('.');

  assert.throws(
    () => setValueByPath({}, deepPath, 'value', pathCache),
    ValidationError,
  );
});
