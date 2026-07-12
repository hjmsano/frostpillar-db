import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, ValidationError } from '../../src/index.js';

// Regression coverage for bug-01: runtime filter validation at Collection
// entry points. Previously these calls threw raw TypeErrors or, worse,
// silently matched every document in the collection.

void test('find throws ValidationError when filter is null', async () => {
  const database = new Database({});
  const col = database.collection('t');
  try {
    assert.throws(
      () => col.find(null as unknown as Record<string, unknown>),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('find throws ValidationError when filter is a primitive', async () => {
  const database = new Database({});
  const col = database.collection('t');
  try {
    assert.throws(
      () => col.find('x' as unknown as Record<string, unknown>),
      ValidationError,
    );
    assert.throws(
      () => col.find(42 as unknown as Record<string, unknown>),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('find throws ValidationError when filter is an array', async () => {
  const database = new Database({});
  const col = database.collection('t');
  try {
    assert.throws(
      () => col.find([] as unknown as Record<string, unknown>),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('find accepts undefined and matches all documents', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number }>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });
    await col.insert({ _id: 'b', v: 2 });
    const all = await col.find().toArray();
    assert.equal(all.length, 2);
  } finally {
    await database.close();
  }
});

void test('findOne throws ValidationError when filter is null', async () => {
  const database = new Database({});
  const col = database.collection('t');
  try {
    await assert.rejects(
      () => col.findOne(null as unknown as Record<string, unknown>),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('remove throws ValidationError when filter is omitted', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number }>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });
    await assert.rejects(
      () => (col as { remove: (f?: unknown) => Promise<number> }).remove(),
      ValidationError,
    );
    // The document must still exist — remove() must not match-all on invalid input.
    assert.equal((await col.findOne({ _id: 'a' })) !== null, true);
  } finally {
    await database.close();
  }
});

void test('remove throws ValidationError when filter is null', async () => {
  const database = new Database({});
  const col = database.collection('t');
  try {
    await assert.rejects(
      () => col.remove(null as unknown as Record<string, unknown>),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('update throws ValidationError when filter is undefined and does NOT match all', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number; z?: number }>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });
    await col.insert({ _id: 'b', v: 2 });

    await assert.rejects(
      () =>
        col.update(undefined as unknown as Record<string, unknown>, {
          $set: { z: 1 },
        }),
      ValidationError,
    );

    // Neither document should have been touched.
    const docs = await col.find().sort({ _id: 1 }).toArray();
    assert.equal(docs.length, 2);
    assert.equal(docs[0]?.z, undefined);
    assert.equal(docs[1]?.z, undefined);
  } finally {
    await database.close();
  }
});

void test('update throws ValidationError when filter is null', async () => {
  const database = new Database({});
  const col = database.collection('t');
  try {
    await assert.rejects(
      () =>
        col.update(null as unknown as Record<string, unknown>, {
          $set: { z: 1 },
        }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('update accepts empty object filter and matches all documents', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number; z?: number }>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });
    await col.insert({ _id: 'b', v: 2 });
    const result = await col.update({}, { $set: { z: 9 } });
    assert.equal(result.modifiedCount, 2);
  } finally {
    await database.close();
  }
});

void test('invalid filters throw even on empty collections (all query paths)', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; x: number }>('empty');
  const reserved = { constructor: 1 } as unknown as Record<string, unknown>;
  const badOp = { x: { $nope: 1 } } as unknown as Record<string, unknown>;

  try {
    // Collection is empty: candidate record set is empty, yet structural
    // validation must still run.
    await assert.rejects(() => col.find(reserved).toArray(), ValidationError);
    await assert.rejects(() => col.findOne(reserved), ValidationError);
    await assert.rejects(() => col.find(reserved).count(), ValidationError);
    await assert.rejects(
      () => col.update(reserved, { $set: { x: 1 } }),
      ValidationError,
    );
    await assert.rejects(() => col.remove(reserved), ValidationError);

    await assert.rejects(() => col.find(badOp).toArray(), ValidationError);
    await assert.rejects(() => col.remove(badOp), ValidationError);
  } finally {
    await database.close();
  }
});

void test('structural validation is exhaustive, not short-circuited by evaluation', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; a: number; b: number }>('t');
  // `a: 1` is false against an empty document, so evaluation-based validation
  // never reached `b`, and the invalid `$nope` slipped through.
  const badOp = { a: 1, b: { $nope: 2 } } as unknown as Record<string, unknown>;

  try {
    await col.insert({ _id: 'a', a: 2, b: 2 });

    await assert.rejects(() => col.find(badOp).toArray(), ValidationError);
    await assert.rejects(() => col.findOne(badOp), ValidationError);
    await assert.rejects(() => col.find(badOp).count(), ValidationError);
    await assert.rejects(
      () => col.update(badOp, { $set: { b: 1 } }),
      ValidationError,
    );
    await assert.rejects(() => col.remove(badOp), ValidationError);
    await assert.rejects(
      () => col.find({ $and: [{ a: 1 }, { b: { $nope: 2 } }] }).toArray(),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('upsert with a structurally invalid filter throws instead of inserting', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; a: number; b: number }>(
    'empty',
  );
  const badOp = { a: 1, b: { $nope: 2 } } as unknown as Record<string, unknown>;

  try {
    await assert.rejects(
      () => col.update(badOp, { $set: { b: 1 } }, { upsert: true }),
      ValidationError,
    );
    assert.equal(await col.count(), 0);
  } finally {
    await database.close();
  }
});

void test('$and/$or reject non-object operands instead of matching all', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; x: number }>('t');
  try {
    await col.insert({ _id: 'a', x: 1 });

    await assert.rejects(
      () =>
        col.find({ $and: [1] } as unknown as Record<string, unknown>).toArray(),
      ValidationError,
    );
    await assert.rejects(
      () =>
        col
          .find({ $or: ['x'] } as unknown as Record<string, unknown>)
          .toArray(),
      ValidationError,
    );
    await assert.rejects(
      () =>
        col
          .find({ $and: [[]] } as unknown as Record<string, unknown>)
          .toArray(),
      ValidationError,
    );
    await assert.rejects(
      () =>
        col
          .find({ $or: [null] } as unknown as Record<string, unknown>)
          .toArray(),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('_id $in fast path enforces the operand size limit on every query path', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number }>('t');
  // MAX_OPERAND_ARRAY_SIZE + 1. The `_id` $in fast paths (getMany / deleteMany)
  // used to run before structural validation, so remove() deleted the listed
  // documents and returned normally, while find()/update() read them back from
  // storage before eventually throwing.
  const ids = Array.from({ length: 10_001 }, (_, i) => `id-${String(i)}`);
  const oversized = { _id: { $in: ids } };

  try {
    await col.insert({ _id: 'id-0', v: 1 });
    await col.insert({ _id: 'id-1', v: 2 });

    await assert.rejects(() => col.find(oversized).toArray(), ValidationError);
    await assert.rejects(() => col.findOne(oversized), ValidationError);
    await assert.rejects(() => col.find(oversized).count(), ValidationError);
    await assert.rejects(
      () => col.update(oversized, { $set: { v: 9 } }),
      ValidationError,
    );
    await assert.rejects(() => col.remove(oversized), ValidationError);

    // Nothing was deleted or modified.
    const docs = await col.find().sort({ _id: 1 }).toArray();
    assert.equal(docs.length, 2);
    assert.equal(docs[0]?.v, 1);
    assert.equal(docs[1]?.v, 2);
  } finally {
    await database.close();
  }
});

void test('_id $in fast path still works at the maximum operand size', async () => {
  const database = new Database({});
  const col = database.collection<{ _id?: string; v: number }>('t');
  const ids = Array.from({ length: 10_000 }, (_, i) => `id-${String(i)}`);

  try {
    await col.insert({ _id: 'id-0', v: 1 });
    await col.insert({ _id: 'id-1', v: 2 });

    assert.equal((await col.find({ _id: { $in: ids } }).toArray()).length, 2);
    assert.equal(await col.remove({ _id: { $in: ids } }), 2);
    assert.equal(await col.count(), 0);
  } finally {
    await database.close();
  }
});
