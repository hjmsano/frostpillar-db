import assert from 'node:assert/strict';
import test from 'node:test';

import { computeUtf8ByteLength } from '../../src/internal/payloadValidator.js';

// ---------------------------------------------------------------------------
// ASCII
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: ASCII string counts 1 byte per character', () => {
  assert.equal(computeUtf8ByteLength('abc'), 3);
});

// ---------------------------------------------------------------------------
// 2-byte characters (U+0080–U+07FF)
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: é (U+00E9) counts as 2 bytes', () => {
  assert.equal(computeUtf8ByteLength('é'), 2);
});

// ---------------------------------------------------------------------------
// 3-byte characters (U+0800–U+FFFF, excluding surrogates)
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: € (U+20AC) counts as 3 bytes', () => {
  assert.equal(computeUtf8ByteLength('€'), 3);
});

// ---------------------------------------------------------------------------
// Valid surrogate pair → 4 bytes (4-byte UTF-8 code point)
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: 😀 (U+1F600, valid surrogate pair) counts as 4 bytes', () => {
  // U+1F600 is encoded as the surrogate pair 😀
  assert.equal(computeUtf8ByteLength('😀'), 4);
});

// ---------------------------------------------------------------------------
// Lone high surrogate → JSON.stringify escapes as \uXXXX = 6 bytes
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: lone high surrogate \\uD800 counts as 6 bytes', () => {
  assert.equal(computeUtf8ByteLength('\uD800'), 6);
  // Cross-check: JSON.stringify("\uD800") === '"\\uD800"' (8 bytes), minus 2 quotes = 6
  const jsonBytes = Buffer.byteLength(JSON.stringify('\uD800')) - 2;
  assert.equal(computeUtf8ByteLength('\uD800'), jsonBytes);
});

// ---------------------------------------------------------------------------
// Lone low surrogate → JSON.stringify escapes as \uXXXX = 6 bytes
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: lone low surrogate \\uDC00 counts as 6 bytes', () => {
  assert.equal(computeUtf8ByteLength('\uDC00'), 6);
  // Cross-check: JSON.stringify("\uDC00") === '"\\uDC00"' (8 bytes), minus 2 quotes = 6
  const jsonBytes = Buffer.byteLength(JSON.stringify('\uDC00')) - 2;
  assert.equal(computeUtf8ByteLength('\uDC00'), jsonBytes);
});

// ---------------------------------------------------------------------------
// High surrogate followed by a non-low char → lone high (6) + ASCII char (1)
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: \\uD800 followed by "A" counts as 7 bytes', () => {
  assert.equal(computeUtf8ByteLength('\uD800A'), 7);
  // Cross-check against JSON.stringify
  const jsonBytes = Buffer.byteLength(JSON.stringify('\uD800A')) - 2;
  assert.equal(computeUtf8ByteLength('\uD800A'), jsonBytes);
});

// ---------------------------------------------------------------------------
// Two lone high surrogates in a row → 6 + 6 = 12 bytes
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: two lone high surrogates \\uD800\\uD800 count as 12 bytes', () => {
  assert.equal(computeUtf8ByteLength('\uD800\uD800'), 12);
  // Cross-check against JSON.stringify
  const jsonBytes = Buffer.byteLength(JSON.stringify('\uD800\uD800')) - 2;
  assert.equal(computeUtf8ByteLength('\uD800\uD800'), jsonBytes);
});

// ---------------------------------------------------------------------------
// Mixed valid string: ASCII + surrogate pair + ASCII
// ---------------------------------------------------------------------------

void test('computeUtf8ByteLength: "a😀b" counts as 6 bytes (1 + 4 + 1)', () => {
  // 😀 is the surrogate pair 😀
  assert.equal(computeUtf8ByteLength('a😀b'), 6);
});
