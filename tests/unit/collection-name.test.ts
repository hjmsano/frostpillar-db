import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { validateCollectionName } from '../../src/internal/collectionName.js';

void test('validateCollectionName accepts valid alphanumeric names', () => {
  assert.doesNotThrow(() => validateCollectionName('users'));
  assert.doesNotThrow(() => validateCollectionName('Users123'));
  assert.doesNotThrow(() => validateCollectionName('my-collection'));
  assert.doesNotThrow(() => validateCollectionName('my.collection'));
  assert.doesNotThrow(() => validateCollectionName('my_collection'));
  assert.doesNotThrow(() => validateCollectionName('a'));
});

void test('validateCollectionName rejects non-string input', () => {
  assert.throws(
    () => validateCollectionName(123 as unknown as string),
    ValidationError,
  );
  assert.throws(
    () => validateCollectionName(null as unknown as string),
    ValidationError,
  );
  assert.throws(
    () => validateCollectionName(undefined as unknown as string),
    ValidationError,
  );
});

void test('validateCollectionName rejects empty string', () => {
  assert.throws(() => validateCollectionName(''), {
    name: 'ValidationError',
    message: 'Collection name must be a non-empty string.',
  });
});

void test('validateCollectionName rejects names containing a null byte', () => {
  assert.throws(() => validateCollectionName('bad\x00name'), ValidationError);
});

void test('validateCollectionName rejects names starting with underscore', () => {
  assert.throws(() => validateCollectionName('_internal'), ValidationError);
  assert.throws(() => validateCollectionName('_'), ValidationError);
});

void test('validateCollectionName rejects names containing ".." sequence', () => {
  assert.throws(() => validateCollectionName('a..b'), ValidationError);
  assert.throws(() => validateCollectionName('..'), ValidationError);
});

void test('validateCollectionName rejects names with unsupported characters', () => {
  assert.throws(() => validateCollectionName('has space'), ValidationError);
  assert.throws(() => validateCollectionName('has/slash'), ValidationError);
  assert.throws(() => validateCollectionName('has$dollar'), ValidationError);
});

void test('validateCollectionName rejects names starting with a non-alphanumeric character', () => {
  assert.throws(() => validateCollectionName('-dash'), ValidationError);
  assert.throws(() => validateCollectionName('.dot'), ValidationError);
});
