import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors.js';
import { applyUpdateOperations } from '../../src/internal/updateApplier.js';

const pathCache = new Map<string, string[]>();

void test('applyUpdateOperations returns unchanged document for empty operation object', () => {
  const source = { _id: 'u1', name: 'Alice' };
  const result = applyUpdateOperations(source, {}, pathCache);

  assert.equal(result.changed, false);
  assert.deepEqual(result.document, source);
});

void test('applyUpdateOperations supports $set with dot notation', () => {
  const source = { _id: 'u1', profile: { city: 'Tokyo' } };
  const result = applyUpdateOperations(
    source,
    {
      $set: { name: 'Alice', 'profile.country': 'JP' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, {
    _id: 'u1',
    name: 'Alice',
    profile: { city: 'Tokyo', country: 'JP' },
  });
});

void test('applyUpdateOperations supports $unset', () => {
  const source = { _id: 'u1', name: 'Alice', temporaryFlag: true };
  const result = applyUpdateOperations(
    source,
    {
      $unset: { temporaryFlag: true },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', name: 'Alice' });
});

void test('applyUpdateOperations supports $inc and creates missing fields', () => {
  const source = { _id: 'u1', stats: { visits: 10 } };
  const result = applyUpdateOperations(
    source,
    {
      $inc: { 'stats.visits': 2, score: 5 },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, {
    _id: 'u1',
    score: 5,
    stats: { visits: 12 },
  });
});

void test('applyUpdateOperations supports $rename with dot notation', () => {
  const source = { _id: 'u1', profile: { city: 'Tokyo' } };
  const result = applyUpdateOperations(
    source,
    {
      $rename: { 'profile.city': 'profile.town' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', profile: { town: 'Tokyo' } });
});

void test('$rename succeeds when destination does not exist (regression)', () => {
  const source = { _id: 'u1', oldName: 'Alice' };
  const result = applyUpdateOperations(
    source,
    {
      $rename: { oldName: 'newName' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', newName: 'Alice' });
});

void test('$rename throws ValidationError when destination field already exists', () => {
  const source = { _id: 'u1', src: 'value', dest: 'existing' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { src: 'dest' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename throws ValidationError when destination exists with null value', () => {
  const source = { _id: 'u1', src: 'value', dest: null };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { src: 'dest' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename throws ValidationError when nested destination already exists', () => {
  const source = { _id: 'u1', a: { b: 'src-value' }, c: { d: 'dest-value' } };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { 'a.b': 'c.d' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename error message includes source and destination paths', () => {
  const source = { _id: 'u1', src: 'value', dest: 'existing' };

  try {
    applyUpdateOperations(source, { $rename: { src: 'dest' } }, pathCache);
    assert.fail('Expected ValidationError');
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /src/);
    assert.match(error.message, /dest/);
  }
});

void test('$rename throws ValidationError when destination is descendant of source', () => {
  const source = { _id: 'u1', a: { b: 42 } };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { 'a.b': 'a.b.c' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename throws ValidationError when source is descendant of destination', () => {
  const source = { _id: 'u1', a: { b: { c: 42 } } };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { 'a.b.c': 'a.b' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('$rename overlap error message mentions overlap', () => {
  const source = { _id: 'u1', a: { b: 42 } };

  try {
    applyUpdateOperations(source, { $rename: { 'a.b': 'a.b.c' } }, pathCache);
    assert.fail('Expected ValidationError');
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /overlap/);
  }
});

void test('$rename allows paths that share a common prefix but do not overlap', () => {
  const source = { _id: 'u1', a: { bc: 'value' } };
  const result = applyUpdateOperations(
    source,
    {
      $rename: { 'a.bc': 'a.bcd' },
    },
    pathCache,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.document, { _id: 'u1', a: { bcd: 'value' } });
});

void test('applyUpdateOperations validates _id immutability', () => {
  const source = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $set: { _id: 'u2' },
        },
        pathCache,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $unset: { _id: true },
        },
        pathCache,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { name: '_id' },
        },
        pathCache,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $rename: { _id: 'newName' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('applyUpdateOperations rejects invalid operation combinations and unknown operators', () => {
  const source = { _id: 'u1', name: 'Alice' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $set: { name: 'Bob' },
          $unset: { name: true },
        },
        pathCache,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $foo: { name: 'Bob' },
        },
        pathCache,
      ),
    ValidationError,
  );
});

void test('applyUpdateOperations rejects $inc on _id with correct operator name in error', () => {
  const source = { _id: 'u1', name: 'Alice' };

  try {
    applyUpdateOperations(source, { $inc: { _id: 1 } }, pathCache);
    assert.fail('Expected ValidationError');
  } catch (error: unknown) {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /\$inc/);
  }
});

void test('applyUpdateOperations throws ValidationError when $inc targets non-number field', () => {
  const source = { _id: 'u1', visits: 'ten' };

  assert.throws(
    () =>
      applyUpdateOperations(
        source,
        {
          $inc: { visits: 1 },
        },
        pathCache,
      ),
    ValidationError,
  );
});
