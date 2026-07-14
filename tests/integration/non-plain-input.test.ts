import assert from 'node:assert/strict';
import test from 'node:test';

import { Database, ValidationError } from '../../src/index.js';

// Regression coverage: non-plain objects used to pass the `typeof value ===
// 'object'` entry-point check. A filter whose conditions live on the prototype
// (e.g. `Object.create({ _id: 'x' })`) has no own keys, so it was treated as an
// empty filter and `remove`/`update` matched every document. Likewise a `Date`
// or `Map` was accepted as a document and stored as nothing but a generated
// `_id`.

interface Doc {
  _id?: string;
  v: number;
  z?: number;
}

const asFilter = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

void test('remove rejects an inherited-only filter and deletes nothing', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });
    await col.insert({ _id: 'b', v: 2 });

    await assert.rejects(
      () => col.remove(asFilter(Object.create({ _id: 'missing' }))),
      ValidationError,
    );

    assert.equal(await col.find().count(), 2);
  } finally {
    await database.close();
  }
});

void test('update rejects an inherited-only filter and modifies nothing', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });

    await assert.rejects(
      () =>
        col.update(asFilter(Object.create({ _id: 'missing' })), {
          $set: { z: 9 },
        }),
      ValidationError,
    );

    assert.equal((await col.findOne({ _id: 'a' }))?.z, undefined);
  } finally {
    await database.close();
  }
});

void test('find and findOne reject non-plain filters', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    assert.throws(() => col.find(asFilter(new Date())), ValidationError);
    assert.throws(() => col.find(asFilter(new Map())), ValidationError);
    assert.throws(
      () => col.find(asFilter(Object.create({ v: 1 }))),
      ValidationError,
    );
    await assert.rejects(
      () => col.findOne(asFilter(new Date())),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('$and/$or reject non-plain sub-filters instead of matching all', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });

    await assert.rejects(
      () => col.find({ $and: [Object.create({ v: 99 })] }).toArray(),
      ValidationError,
    );
    await assert.rejects(
      () => col.remove({ $or: [Object.create({ v: 99 })] }),
      ValidationError,
    );

    assert.equal(await col.find().count(), 1);
  } finally {
    await database.close();
  }
});

void test('update rejects non-plain operations instead of ignoring them', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });

    const asOperations = (value: unknown): Record<string, unknown> =>
      value as Record<string, unknown>;
    const invalidOperations: unknown[] = [
      undefined,
      null,
      1,
      'x',
      [],
      new Date(),
      Object.create({ $set: { z: 9 } }),
    ];
    for (const operations of invalidOperations) {
      await assert.rejects(
        () => col.update({ _id: 'a' }, asOperations(operations)),
        ValidationError,
      );
    }

    assert.equal((await col.findOne({ _id: 'a' }))?.z, undefined);
  } finally {
    await database.close();
  }
});

void test('update accepts an empty operations object as a no-op', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    await col.insert({ _id: 'a', v: 1 });

    const result = await col.update({ _id: 'a' }, {});

    assert.deepEqual(result, { modifiedCount: 0, upsertedId: null });
    assert.equal((await col.findOne({ _id: 'a' }))?.v, 1);
  } finally {
    await database.close();
  }
});

void test('insert rejects Date, Map, and inherited-only documents', async () => {
  const database = new Database({});
  const col = database.collection<Doc>('t');
  try {
    await assert.rejects(
      () => col.insert(new Date() as unknown as Doc),
      ValidationError,
    );
    await assert.rejects(
      () => col.insert(new Map() as unknown as Doc),
      ValidationError,
    );
    await assert.rejects(
      () => col.insert(Object.create({ v: 1 }) as Doc),
      ValidationError,
    );

    assert.equal(await col.find().count(), 0);
  } finally {
    await database.close();
  }
});

void test('insert rejects non-plain documents under skipPayloadValidation', async () => {
  const database = new Database({ skipPayloadValidation: true });
  const col = database.collection<Doc>('t');
  try {
    await assert.rejects(
      () => col.insert(new Date() as unknown as Doc),
      ValidationError,
    );

    assert.equal(await col.find().count(), 0);
  } finally {
    await database.close();
  }
});
