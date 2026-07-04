// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify countAlternationGroups in
// src/internal/filterCache.ts continues to block these shapes.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countAlternationGroups,
  hasQuantifiedAlternationGroup,
} from '../../src/internal/filterCache.js';

// ---------------------------------------------------------------------------
// countAlternationGroups (Fix S1) — direct unit coverage of the group-pipe
// counting algorithm, independent of the ValidationError-throwing wrapper in
// assertSafeRegexPattern.
// ---------------------------------------------------------------------------

void test('countAlternationGroups: single group with one pipe', () => {
  assert.equal(countAlternationGroups('(a|b)'), 1);
});

void test('countAlternationGroups: two independent groups', () => {
  assert.equal(countAlternationGroups('(a|b)(c|d)'), 2);
});

void test('countAlternationGroups: nested group pipe does not count toward outer group', () => {
  // Outer group `(...)` wraps `(a|b)c` — the outer group itself has no
  // top-level pipe of its own, only the inner `(a|b)` does.
  assert.equal(countAlternationGroups('((a|b)c)'), 1);
});

void test('countAlternationGroups: multiple pipes in one group still count once', () => {
  assert.equal(countAlternationGroups('(a|b|c)'), 1);
});

void test('countAlternationGroups: fully escaped parens and pipe are not a real group', () => {
  assert.equal(countAlternationGroups('\\(a\\|b\\)'), 0);
});

void test('countAlternationGroups: pipe inside a character class is literal, not alternation', () => {
  assert.equal(countAlternationGroups('[a|b]'), 0);
});

void test('countAlternationGroups: non-capturing group still counts', () => {
  assert.equal(countAlternationGroups('(?:a|b)'), 1);
});

void test('countAlternationGroups: group without a pipe does not count', () => {
  assert.equal(countAlternationGroups('(abc)+'), 0);
});

void test('countAlternationGroups: no groups at all returns 0', () => {
  assert.equal(countAlternationGroups('abc'), 0);
});

void test('countAlternationGroups: unbalanced/unclosed group does not throw and is not counted', () => {
  assert.doesNotThrow(() => countAlternationGroups('(a|b'));
  assert.equal(countAlternationGroups('(a|b'), 0);
});

void test('countAlternationGroups: unmatched closing paren does not throw', () => {
  assert.doesNotThrow(() => countAlternationGroups('a|b)'));
  assert.equal(countAlternationGroups('a|b)'), 0);
});

void test('countAlternationGroups: repeated ambiguous alternation group (manual unrolling) counts each occurrence', () => {
  const pattern = '(a|aa)'.repeat(5);
  assert.equal(countAlternationGroups(pattern), 5);
});

void test('countAlternationGroups: escaped pipe inside an otherwise real group does not count as alternation', () => {
  assert.equal(countAlternationGroups('(a\\|b)'), 0);
});

// ---------------------------------------------------------------------------
// hasQuantifiedAlternationGroup — direct unit coverage of the structural
// quantified-alternation-group detector. This replaces the hand-written
// CATASTROPHIC_PATTERNS entry /\([^)]*\|[^)]*\)[+*]/, which only covered
// literal `+`/`*` after the group and missed repeating brace bounds like
// `{2,}`/`{2,50}`/`{2}` — a genuinely catastrophic shape (ambiguous
// alternation under a repeat explodes as ~2^n paths even when bounded).
// ---------------------------------------------------------------------------

// Rejected: alternation group followed by a REPEATING quantifier.

void test('hasQuantifiedAlternationGroup: (aa|a){2,} — unbounded brace repeat, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(aa|a){2,}'), true);
});

void test('hasQuantifiedAlternationGroup: (?:aa|a){2,} — non-capturing, unbounded brace repeat, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(?:aa|a){2,}'), true);
});

void test('hasQuantifiedAlternationGroup: (?:aa|a){2,50} — bounded brace repeat still explodes (~2^50), rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(?:aa|a){2,50}'), true);
});

void test('hasQuantifiedAlternationGroup: (aa|a){2} — exact-count brace repeat with n >= 2, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(aa|a){2}'), true);
});

void test('hasQuantifiedAlternationGroup: (a|b)+ — literal + (existing conservative rejection preserved)', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b)+'), true);
});

void test('hasQuantifiedAlternationGroup: (a|ab)* — literal * (existing rejection preserved)', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|ab)*'), true);
});

void test('hasQuantifiedAlternationGroup: (a|b){2,5} — bounded brace repeat with max >= 2, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b){2,5}'), true);
});

void test('hasQuantifiedAlternationGroup: (?:a|b)+ — group-syntax prefix does not exempt the alternation, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(?:a|b)+'), true);
});

void test('hasQuantifiedAlternationGroup: (?<name>aa|a){2,} — named capture group, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(?<name>aa|a){2,}'), true);
});

// Accepted: non-repeating quantifier or no quantifier at all.

void test('hasQuantifiedAlternationGroup: (a|b)? — optional matches group at most once, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b)?'), false);
});

void test('hasQuantifiedAlternationGroup: (a|b){0,1} — max-1 bound, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b){0,1}'), false);
});

void test('hasQuantifiedAlternationGroup: (a|b){1} — exact-one bound, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b){1}'), false);
});

void test('hasQuantifiedAlternationGroup: (a|b) — bare alternation group, no quantifier, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b)'), false);
});

void test('hasQuantifiedAlternationGroup: (?:a|b) — bare non-capturing alternation group, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(?:a|b)'), false);
});

void test('hasQuantifiedAlternationGroup: (abc)+ — no pipe in group, safe (nested-quantifier check owns this shape)', () => {
  assert.equal(hasQuantifiedAlternationGroup('(abc)+'), false);
});

void test('hasQuantifiedAlternationGroup: (a\\|b)+ — escaped pipe is a literal, not alternation, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a\\|b)+'), false);
});

void test('hasQuantifiedAlternationGroup: ([a|b])+ — pipe inside character class is literal, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('([a|b])+'), false);
});

void test('hasQuantifiedAlternationGroup: (a|b)x{2,} — brace repeat applies to x, not the group, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(a|b)x{2,}'), false);
});

void test('hasQuantifiedAlternationGroup: unbalanced (a|b without close does not throw, safe', () => {
  assert.doesNotThrow(() => hasQuantifiedAlternationGroup('(a|b'));
  assert.equal(hasQuantifiedAlternationGroup('(a|b'), false);
});

// ---------------------------------------------------------------------------
// Wrapped / nested alternation groups — a repeat on an enclosing group
// repeats everything nested inside it, so an alternation at any depth under
// that repeat is exposed to the same catastrophic backtracking. Without
// propagating the pipe outward as each group closes, one redundant wrapping
// group hides the alternation from the outer repeat and evades the screen
// (e.g. `((a|aa))+` is exactly `(a|aa)+` and blows up ~2^(n/2)).
// ---------------------------------------------------------------------------

void test('hasQuantifiedAlternationGroup: ((a|aa))+ — capturing wrap does not hide the alternation, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('((a|aa))+'), true);
});

void test('hasQuantifiedAlternationGroup: (?:(?:a|ab))+ — double non-capturing wrap, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('(?:(?:a|ab))+'), true);
});

void test('hasQuantifiedAlternationGroup: ((a|aa)){2,} — wrapped alternation under brace repeat, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('((a|aa)){2,}'), true);
});

void test('hasQuantifiedAlternationGroup: ((a|ab))* — wrapped alternation under star, rejected', () => {
  assert.equal(hasQuantifiedAlternationGroup('((a|ab))*'), true);
});

void test('hasQuantifiedAlternationGroup: (x(a|b)y)+ — inner alternation delimited by literals, still rejected (no ambiguity analysis)', () => {
  assert.equal(hasQuantifiedAlternationGroup('(x(a|b)y)+'), true);
});

// Accepted: wrapping alone must not create a false positive. Propagation
// fires only for a pipe, and only a *repeating* outer quantifier flags it.

void test('hasQuantifiedAlternationGroup: ((abc))+ — wrapped group with no pipe, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('((abc))+'), false);
});

void test('hasQuantifiedAlternationGroup: ((a|b))? — wrapped alternation, non-repeating outer, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('((a|b))?'), false);
});

void test('hasQuantifiedAlternationGroup: (x(a|b)y) — wrapped alternation, no outer quantifier, safe', () => {
  assert.equal(hasQuantifiedAlternationGroup('(x(a|b)y)'), false);
});
