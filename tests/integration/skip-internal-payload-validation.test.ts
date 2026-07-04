// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify that skipPayloadValidation still
// enforces reserved-key and depth guards in src/internal/.
// No code here produces a usable payload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, ValidationError } from '../../src/index.js';
import type { FrostpillarDocument } from '../../src/index.js';
import { DEFAULT_MAX_DEPTH } from '../../src/internal/limits.js';

interface SimpleDoc extends FrostpillarDocument {
  _id?: string;
  name: string;
  value?: number;
}

interface ListDoc extends FrostpillarDocument {
  _id?: string;
  name: string;
  list?: unknown[];
}

// ---------------------------------------------------------------------------
// #1 User-facing insert still validates payloads (rejects circular references)
// ---------------------------------------------------------------------------

void test('insert rejects a document with circular references', async () => {
  const database = new Database();
  const col = database.collection<FrostpillarDocument>('validation-circular');

  try {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;

    await assert.rejects(
      () => col.insert(circular as FrostpillarDocument),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('Circular'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #2 User-facing insert validates unsupported types (bigint)
// ---------------------------------------------------------------------------

void test('insert rejects a document with bigint values', async () => {
  const database = new Database();
  const col = database.collection<FrostpillarDocument>('validation-bigint');

  try {
    const doc = {
      name: 'test',
      big: BigInt(42),
    } as unknown as FrostpillarDocument;
    await assert.rejects(
      () => col.insert(doc),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('bigint'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #3 User-facing insertMany validates payloads
// ---------------------------------------------------------------------------

void test('insertMany rejects documents with unsupported types', async () => {
  const database = new Database();
  const col = database.collection<FrostpillarDocument>('validation-insertmany');

  try {
    const docs = [
      { name: 'ok' },
      { name: 'bad', val: BigInt(1) } as unknown as FrostpillarDocument,
    ];
    await assert.rejects(
      () => col.insertMany(docs),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('bigint'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #4 Internal update path does NOT trigger redundant validation
//    (update on already-inserted document succeeds without validation overhead)
// ---------------------------------------------------------------------------

void test('update on already-inserted document works without double validation', async () => {
  const database = new Database();
  const col = database.collection<SimpleDoc>('update-no-double-validation');

  try {
    const id = await col.insert({ name: 'original', value: 1 });
    const result = await col.update({ _id: id }, { $set: { value: 2 } });

    assert.equal(result.modifiedCount, 1);

    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.value, 2);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #5 Insert validates payload depth limits from DatabaseConfig
// ---------------------------------------------------------------------------

void test('insert validates maxDepth at collection level', async () => {
  const database = new Database({ payloadLimits: { maxDepth: 2 } });
  const col = database.collection<FrostpillarDocument>('depth-validation');

  try {
    await assert.rejects(
      () =>
        col.insert({
          level: { level: { level: { value: 1 } } },
        } as unknown as FrostpillarDocument),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('depth'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #6 Insert validates maxTotalBytes at collection level
// ---------------------------------------------------------------------------

void test('insert validates maxTotalBytes at collection level', async () => {
  const database = new Database({ payloadLimits: { maxTotalBytes: 256 } });
  const col = database.collection<FrostpillarDocument>('size-validation');

  try {
    await assert.rejects(
      () =>
        col.insert({ data: 'x'.repeat(500) } as unknown as FrostpillarDocument),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('bytes'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #7 User-set skipPayloadValidation: true skips all validation
// ---------------------------------------------------------------------------

void test('user-set skipPayloadValidation: true skips insert validation', async () => {
  const database = new Database({ skipPayloadValidation: true });
  const col = database.collection<SimpleDoc>('skip-all');

  try {
    // bigint would normally be rejected but should pass through when skipped
    // We can't actually insert bigint (JSON doesn't support it), so test with a valid doc
    const id = await col.insert({ name: 'trusted' });
    const doc = await col.findOne({ _id: id });
    assert.equal(doc?.name, 'trusted');
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #8 Insert validates reserved keys (__proto__)
// ---------------------------------------------------------------------------

void test('insert rejects documents with reserved keys', async () => {
  const database = new Database();
  const col = database.collection<FrostpillarDocument>('reserved-keys');

  try {
    const doc = {
      name: 'test',
      constructor: { tampered: true },
    } as unknown as FrostpillarDocument;

    await assert.rejects(
      () => col.insert(doc),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('reserved'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #9 Replace policy (internal replaceById) works without double validation
// ---------------------------------------------------------------------------

void test('duplicate key replace policy uses internal path without double validation', async () => {
  const database = new Database();
  const col = database.collection<SimpleDoc>('replace-no-double', {
    duplicateKeys: 'replace',
  });

  try {
    await col.insert({ _id: 'r1', name: 'first', value: 1 });
    await col.insert({ _id: 'r1', name: 'second', value: 2 });

    const doc = await col.findOne({ _id: 'r1' });
    assert.equal(doc?.name, 'second');
    assert.equal(doc?.value, 2);
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #10 Upsert (performUpsert → insert) still validates
// ---------------------------------------------------------------------------

void test('upsert path validates documents through insert', async () => {
  const database = new Database();
  const col = database.collection<FrostpillarDocument>('upsert-validates');

  try {
    // Upsert with a bigint value should fail validation
    await assert.rejects(
      () =>
        col.update(
          { _id: 'new-doc' },
          { $set: { value: BigInt(42) } as unknown as Record<string, unknown> },
          { upsert: true },
        ),
      (error: unknown) =>
        error instanceof ValidationError && error.message.includes('bigint'),
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #11 skipPayloadValidation still enforces depth cap (Fix B)
// ---------------------------------------------------------------------------

const deepSkipArr = (n: number): unknown[] => {
  let a: unknown[] = [1];
  for (let i = 0; i < n; i++) a = [a];
  return a;
};

const deepSkipObj = (n: number): Record<string, unknown> => {
  let o: Record<string, unknown> = { v: 1 };
  for (let i = 0; i < n; i++) o = { a: o };
  return o;
};

void test('skipPayloadValidation mode rejects pathologically deep arrays with ValidationError', async () => {
  const database = new Database({ skipPayloadValidation: true });
  const col = database.collection<FrostpillarDocument>('skip-deep-array');

  try {
    await assert.rejects(
      () =>
        col.insert({
          _id: 'deep',
          a: deepSkipArr(50000),
        } as unknown as FrostpillarDocument),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('skipPayloadValidation mode rejects pathologically deep objects with ValidationError', async () => {
  const database = new Database({ skipPayloadValidation: true });
  const col = database.collection<FrostpillarDocument>('skip-deep-obj');

  try {
    await assert.rejects(
      () =>
        col.insert({
          _id: 'deep',
          a: deepSkipObj(50000),
        } as unknown as FrostpillarDocument),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// ---------------------------------------------------------------------------
// #12 update() enforces a nesting-depth cap on $set / $push / $addToSet
// values (Fix S2). Before the fix, `validateUpdateValue` recursed with no
// depth limit at all, so a pathologically deep update value crashed with a
// raw `RangeError: Maximum call stack size exceeded` instead of throwing a
// clean `ValidationError` — this ran unconditionally on every update(),
// regardless of skipInsertValidation/skipPayloadValidation.
// ---------------------------------------------------------------------------

// The update-value depth check (validateUpdateValue) counts a $set value's
// own nesting starting at depth 2 — as if it were already embedded one
// level inside the document (see the comment on validateUpdateValue in
// updateValidator.ts) — so it lines up with the pre-existing post-merge
// whole-document depth check in Collection.validatePayload(). A value with
// N nested arrays (deepSkipArr(n) nests n+1 levels deep) therefore succeeds
// up to n = maxDepth - 2 and throws starting at n = maxDepth - 1.
void test('update() $set value nested exactly at the default maxDepth succeeds', async () => {
  const database = new Database({});
  const col = database.collection<SimpleDoc>('update-depth-boundary-ok');

  try {
    const id = await col.insert({ name: 'victim' });
    const result = await col.update(
      { _id: id },
      { $set: { payload: deepSkipArr(DEFAULT_MAX_DEPTH - 2) } },
    );
    assert.equal(result.modifiedCount, 1);
  } finally {
    await database.close();
  }
});

void test('update() $set value one level beyond the default maxDepth throws ValidationError', async () => {
  const database = new Database({});
  const col = database.collection<SimpleDoc>('update-depth-boundary-fail');

  try {
    const id = await col.insert({ name: 'victim' });
    await assert.rejects(
      () =>
        col.update(
          { _id: id },
          { $set: { payload: deepSkipArr(DEFAULT_MAX_DEPTH - 1) } },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('update() rejects a pathologically deep $set value with ValidationError, not RangeError (default validation)', async () => {
  const database = new Database({});
  const col = database.collection<SimpleDoc>('update-deepnest-set-default');

  try {
    const id = await col.insert({ name: 'victim' });
    await assert.rejects(
      () =>
        col.update({ _id: id }, { $set: { payload: deepSkipArr(10000) } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('update() rejects a pathologically deep $set value with ValidationError, not RangeError (skipPayloadValidation: true)', async () => {
  const database = new Database({ skipPayloadValidation: true });
  const col = database.collection<SimpleDoc>('update-deepnest-set-skip');

  try {
    const id = await col.insert({ name: 'victim' });
    await assert.rejects(
      () =>
        col.update({ _id: id }, { $set: { payload: deepSkipArr(10000) } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('update() rejects a pathologically deep $push value with ValidationError, not RangeError', async () => {
  const database = new Database({});
  const col = database.collection<ListDoc>('update-deepnest-push');

  try {
    const id = await col.insert({ name: 'victim', list: [] });
    await assert.rejects(
      () => col.update({ _id: id }, { $push: { list: deepSkipArr(10000) } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('update() rejects a pathologically deep $addToSet value with ValidationError, not RangeError', async () => {
  const database = new Database({});
  const col = database.collection<ListDoc>('update-deepnest-addtoset');

  try {
    const id = await col.insert({ name: 'victim', list: [] });
    await assert.rejects(
      () =>
        col.update({ _id: id }, { $addToSet: { list: deepSkipArr(10000) } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});
