// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify hasNestedQuantifier in
// src/internal/filterCache.ts continues to block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { hasNestedQuantifier } from '../../src/internal/filterCache.js';

// ---------------------------------------------------------------------------
// hasNestedQuantifier (Fix S1 round-2 follow-up) — direct unit coverage of
// the general, algorithmic nested-quantifier detector, independent of the
// ValidationError-throwing wrapper in assertSafeRegexPattern.
//
// This detector replaces several hand-written CATASTROPHIC_PATTERNS entries
// that were each written for one specific quantifier-syntax combination
// (e.g. only literal `+`/`*` on both sides). Round-2 adversarial testing
// found `(a{1,10}){1,10}` (bounded-inside-bounded) slipped through all of
// them. Every case below is hand-traced in the round-2 spec; each is a
// distinct quantifier-syntax combination the old hand-written entries either
// covered individually or entirely missed.
// ---------------------------------------------------------------------------

void test('hasNestedQuantifier: (a+)+ — classic nested quantifier', () => {
  assert.equal(hasNestedQuantifier('(a+)+'), true);
});

void test('hasNestedQuantifier: (a{1,10}){1,10} — the actual round-2 gap (bounded/bounded)', () => {
  assert.equal(hasNestedQuantifier('(a{1,10}){1,10}'), true);
});

void test('hasNestedQuantifier: (a{1,2})+ — bounded inside, literal outside', () => {
  assert.equal(hasNestedQuantifier('(a{1,2})+'), true);
});

void test('hasNestedQuantifier: (a+){2,} — literal inside, bounded outside', () => {
  assert.equal(hasNestedQuantifier('(a+){2,}'), true);
});

void test('hasNestedQuantifier: ([a-z]+)+ — character class content', () => {
  assert.equal(hasNestedQuantifier('([a-z]+)+'), true);
});

void test('hasNestedQuantifier: (\\d+)+ — shorthand class content', () => {
  assert.equal(hasNestedQuantifier('(\\d+)+'), true);
});

void test('hasNestedQuantifier: (a?)+ — optional quantifier inside', () => {
  assert.equal(hasNestedQuantifier('(a?)+'), true);
});

void test('hasNestedQuantifier: ((a{1,3}){1,3}){1,3} — 3-level nesting detected at innermost pair', () => {
  assert.equal(hasNestedQuantifier('((a{1,3}){1,3}){1,3}'), true);
});

void test('hasNestedQuantifier: (abc)+ — quantified group, no inner quantifier, not ambiguous', () => {
  assert.equal(hasNestedQuantifier('(abc)+'), false);
});

void test('hasNestedQuantifier: (a|b)+ — alternation, not a nested quantifier (different mechanism)', () => {
  assert.equal(hasNestedQuantifier('(a|b)+'), false);
});

void test('hasNestedQuantifier: (abc)+(x{1,3}){1,3} — second unrelated group is the dangerous one', () => {
  assert.equal(hasNestedQuantifier('(abc)+(x{1,3}){1,3}'), true);
});

void test('hasNestedQuantifier: \\(a\\+\\)\\+ — fully escaped, literal text, not a real group', () => {
  assert.equal(hasNestedQuantifier('\\(a\\+\\)\\+'), false);
});

void test('hasNestedQuantifier: a+b+ — adjacent quantifiers, not nested (different mechanism)', () => {
  assert.equal(hasNestedQuantifier('a+b+'), false);
});

// --- Extra realistic patterns from the existing/legitimate $regex corpus,
// which must not be falsely flagged as nested quantifiers ---

void test('hasNestedQuantifier: ^Ali — simple literal/anchored prefix, no groups at all', () => {
  assert.equal(hasNestedQuantifier('^Ali'), false);
});

void test('hasNestedQuantifier: \\d{1,3}\\.\\d{1,3} — bounded quantifiers with no grouping', () => {
  assert.equal(hasNestedQuantifier('\\d{1,3}\\.\\d{1,3}'), false);
});

void test('hasNestedQuantifier: UUID pattern — bounded quantifiers inside unrelated bracket expressions', () => {
  assert.equal(
    hasNestedQuantifier(
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    ),
    false,
  );
});

// --- Non-repeating outer quantifier: a group quantified by `?` (or a
// max-<=1 bound) matches at most once and can NEVER backtrack exponentially,
// however its content is quantified. These ubiquitous, benign patterns must
// be accepted, not flagged — a regression where they were wrongly rejected. ---

void test('hasNestedQuantifier: (\\d+)? — optional quantified group, matches at most once, safe', () => {
  assert.equal(hasNestedQuantifier('(\\d+)?'), false);
});

void test('hasNestedQuantifier: (a+)? — optional one-or-more group, safe', () => {
  assert.equal(hasNestedQuantifier('(a+)?'), false);
});

void test('hasNestedQuantifier: (https?)? — inner and outer optional, safe', () => {
  assert.equal(hasNestedQuantifier('(https?)?'), false);
});

void test('hasNestedQuantifier: (a{1,3})? — bounded inner, optional outer, safe', () => {
  assert.equal(hasNestedQuantifier('(a{1,3})?'), false);
});

void test('hasNestedQuantifier: (a+){0,1} — bounded outer with max 1, matches at most once, safe', () => {
  assert.equal(hasNestedQuantifier('(a+){0,1}'), false);
});

void test('hasNestedQuantifier: (a+){1} — exact-one outer bound, safe', () => {
  assert.equal(hasNestedQuantifier('(a+){1}'), false);
});

void test('hasNestedQuantifier: ^(v\\d+)?$ — optional version prefix, safe', () => {
  assert.equal(hasNestedQuantifier('^(v\\d+)?$'), false);
});

// A non-repeating quantifier still counts as inner content, so a repeating
// OUTER quantifier wrapped around it is still caught.
void test('hasNestedQuantifier: ((a+)?)+ — optional group repeated by outer +, still dangerous', () => {
  assert.equal(hasNestedQuantifier('((a+)?)+'), true);
});

void test('hasNestedQuantifier: (a+){2} — exact-two outer bound repeats the group, dangerous', () => {
  assert.equal(hasNestedQuantifier('(a+){2}'), true);
});

void test('hasNestedQuantifier: (a?)? — nested optionals, neither repeats, safe', () => {
  assert.equal(hasNestedQuantifier('(a?)?'), false);
});

// --- Group-syntax '?' false-positive fix ---
// A '?' immediately after '(' is always JS group syntax ((?:, (?=, (?!, (?<=,
// (?<!, (?<name>), never a quantifier. Before this fix the scanner falsely
// marked the group as "has a quantifier" which caused (?:abc)+ to be rejected
// as if it were a nested-quantifier pattern.

// Currently false-positives — must return false after fix:
void test('hasNestedQuantifier: (?:abc)+ — non-capturing group, no inner quantifier, safe', () => {
  assert.equal(hasNestedQuantifier('(?:abc)+'), false);
});

void test('hasNestedQuantifier: (?:a)+ — minimal non-capturing group with outer +, safe', () => {
  assert.equal(hasNestedQuantifier('(?:a)+'), false);
});

void test('hasNestedQuantifier: (?<name>abc)+ — named capture group, no inner quantifier, safe', () => {
  assert.equal(hasNestedQuantifier('(?<name>abc)+'), false);
});

void test('hasNestedQuantifier: (?:abc)* — non-capturing group with outer *, safe', () => {
  assert.equal(hasNestedQuantifier('(?:abc)*'), false);
});

void test('hasNestedQuantifier: (?:abc){2,5} — non-capturing group with outer bounded quantifier, safe', () => {
  assert.equal(hasNestedQuantifier('(?:abc){2,5}'), false);
});

// These were never false-positives (outer quantifier was non-repeating, or a
// literal char intervened before the outer quantifier) but are included to
// document the expected behavior of group-syntax handling:
void test('hasNestedQuantifier: (?=x)y+ — lookahead then quantified atom, safe', () => {
  assert.equal(hasNestedQuantifier('(?=x)y+'), false);
});

void test('hasNestedQuantifier: a(?:b)? — optional non-capturing group, safe', () => {
  assert.equal(hasNestedQuantifier('a(?:b)?'), false);
});

void test('hasNestedQuantifier: (?:https?) — non-capturing group with inner ?, no outer quantifier, safe', () => {
  assert.equal(hasNestedQuantifier('(?:https?)'), false);
});

void test('hasNestedQuantifier: ^(?:[a-z]+\\.)?example$ — outer ? is non-repeating, safe', () => {
  assert.equal(hasNestedQuantifier('^(?:[a-z]+\\.)?example$'), false);
});

// Still rejected — group-syntax skip applies only to the '?' token; any real
// quantifier inside the group content is still detected:
void test('hasNestedQuantifier: (?:a+)+ — non-capturing group with inner + and outer +, rejected', () => {
  assert.equal(hasNestedQuantifier('(?:a+)+'), true);
});

void test('hasNestedQuantifier: (?:a{1,10}){1,10} — bounded inside non-capturing, bounded outside, rejected', () => {
  assert.equal(hasNestedQuantifier('(?:a{1,10}){1,10}'), true);
});

void test('hasNestedQuantifier: (?<name>a+)+ — named capture group with inner + and outer +, rejected', () => {
  assert.equal(hasNestedQuantifier('(?<name>a+)+'), true);
});

void test('hasNestedQuantifier: ((?:a+))+ — outer capturing group wrapping quantified non-capturing group, rejected', () => {
  assert.equal(hasNestedQuantifier('((?:a+))+'), true);
});
