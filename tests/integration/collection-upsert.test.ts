import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';

interface UserDocument {
  _id?: string;
  name: string;
  age?: number;
  role?: string;
  tags?: string[];
  visits?: number;
}

void test('update with upsert: true inserts when no match', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { name: 'Alice' },
      { $set: { role: 'admin', age: 30 } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.equal(typeof result.upsertedId, 'string');
    assert.notEqual(result.upsertedId, null);

    const doc = await users.findOne({ name: 'Alice' });
    assert.notEqual(doc, null);
    assert.equal(doc?.name, 'Alice');
    assert.equal(doc?.role, 'admin');
    assert.equal(doc?.age, 30);
    assert.equal(doc?._id, result.upsertedId);
  } finally {
    await database.close();
  }
});

void test('update with upsert: true updates when match exists', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice', age: 25 });

    const result = await users.update(
      { name: 'Alice' },
      { $set: { age: 30 } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 1);
    assert.equal(result.upsertedId, null);

    const doc = await users.findOne({ _id: 'u1' });
    assert.equal(doc?.age, 30);
  } finally {
    await database.close();
  }
});

void test('update with upsert: false (default) does not insert on no match', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { name: 'Nobody' },
      { $set: { role: 'admin' } },
    );

    assert.equal(result.modifiedCount, 0);
    assert.equal(result.upsertedId, null);

    const count = await users.count();
    assert.equal(count, 0);
  } finally {
    await database.close();
  }
});

void test('upsert creates document with _id from filter equality', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { _id: 'custom-id' },
      { $set: { name: 'Alice' } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.equal(result.upsertedId, 'custom-id');

    const doc = await users.findOne({ _id: 'custom-id' });
    assert.notEqual(doc, null);
    assert.equal(doc?._id, 'custom-id');
    assert.equal(doc?.name, 'Alice');
  } finally {
    await database.close();
  }
});

void test('upsert generates _id when not in filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { name: 'Alice' },
      { $set: { age: 25 } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.notEqual(result.upsertedId, null);
    assert.equal(typeof result.upsertedId, 'string');

    const doc = await users.findOne({ _id: result.upsertedId! });
    assert.notEqual(doc, null);
    assert.equal(doc?.name, 'Alice');
    assert.equal(doc?.age, 25);
  } finally {
    await database.close();
  }
});

void test('upsert applies $inc to create field on new document', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { name: 'Counter' },
      { $inc: { visits: 5 } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.notEqual(result.upsertedId, null);

    const doc = await users.findOne({ _id: result.upsertedId! });
    assert.notEqual(doc, null);
    assert.equal(doc?.name, 'Counter');
    assert.equal(doc?.visits, 5);
  } finally {
    await database.close();
  }
});

void test('upsert applies all operators including $unset and $rename', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { name: 'Alice' },
      {
        $set: { role: 'admin' },
        $inc: { visits: 1 },
        $unset: { age: true } as unknown as Record<string, unknown>,
        $rename: { role: 'status' } as unknown as Record<string, unknown>,
      },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.notEqual(result.upsertedId, null);

    const doc = await users.findOne({ _id: result.upsertedId! });
    assert.notEqual(doc, null);
    assert.equal(doc?.name, 'Alice');
    assert.equal(doc?.visits, 1);
    // $unset should have been applied (age was not set so it remains absent)
    assert.equal(doc?.age, undefined);
    // $rename should have moved role -> status
    assert.equal(doc?.role, undefined);
    assert.equal((doc as Record<string, unknown>)?.status, 'admin');
  } finally {
    await database.close();
  }
});

void test('upsert expands dot-notation filter keys into nested objects', async () => {
  const database = new Database({});
  const col = database.collection('addresses');

  try {
    const result = await col.update(
      { 'address.city': 'Tokyo' },
      { $set: { name: 'Alice' } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.notEqual(result.upsertedId, null);

    const raw = await col.findOne({ _id: result.upsertedId! });
    assert.notEqual(raw, null);
    const doc = raw as Record<string, unknown>;
    assert.equal(doc.name, 'Alice');

    // The dot-notation key must be expanded into a nested object
    const address = doc.address;
    assert.ok(
      typeof address === 'object' && address !== null,
      'address should be a nested object',
    );
    assert.equal((address as Record<string, unknown>).city, 'Tokyo');

    // Literal top-level key must NOT exist
    assert.equal(
      doc['address.city'],
      undefined,
      'literal "address.city" key must not exist',
    );

    // Must be findable by future dot-path filters
    const found = await col.findOne({ 'address.city': 'Tokyo' });
    assert.notEqual(found, null);
    assert.equal(found?._id, result.upsertedId);
  } finally {
    await database.close();
  }
});

void test('upsert expands deeply nested dot-notation filter key', async () => {
  const database = new Database({});
  const col = database.collection('deep');

  try {
    const result = await col.update(
      { 'a.b.c': 99 },
      { $set: { tag: 'deep' } },
      { upsert: true },
    );

    assert.notEqual(result.upsertedId, null);

    const doc = await col.findOne({ _id: result.upsertedId! });
    assert.notEqual(doc, null);

    const a = (doc as Record<string, unknown>)?.a;
    assert.ok(typeof a === 'object' && a !== null);
    const b = (a as Record<string, unknown>).b;
    assert.ok(typeof b === 'object' && b !== null);
    assert.equal((b as Record<string, unknown>).c, 99);
  } finally {
    await database.close();
  }
});

void test('upsert only extracts equality conditions from filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const result = await users.update(
      { age: { $gt: 25 }, name: 'Bob' },
      { $set: { role: 'member' } },
      { upsert: true },
    );

    assert.equal(result.modifiedCount, 0);
    assert.notEqual(result.upsertedId, null);

    const doc = await users.findOne({ _id: result.upsertedId! });
    assert.notEqual(doc, null);
    assert.equal(doc?.name, 'Bob');
    assert.equal(doc?.role, 'member');
    // age should NOT be set because $gt is not an equality condition
    assert.equal(doc?.age, undefined);
  } finally {
    await database.close();
  }
});

void test('upsert with an object-valued equality creates a document that matches its filter', async () => {
  const database = new Database({});
  const users = database.collection('users');

  try {
    const filter = { profile: { tier: 'pro' } };
    const result = await users.update(
      filter,
      { $set: { role: 'member' } },
      { upsert: true },
    );
    assert.notEqual(result.upsertedId, null);

    // The upserted document must satisfy the filter that created it, otherwise
    // the same upsert inserts a second document on every call.
    const found = await users.find(filter).toArray();
    assert.equal(found.length, 1);
    assert.equal(found[0]._id, result.upsertedId);

    const second = await users.update(
      filter,
      { $set: { role: 'lead' } },
      { upsert: true },
    );
    assert.equal(second.modifiedCount, 1);
    assert.equal(second.upsertedId, null);
    assert.equal(await users.find(filter).count(), 1);
  } finally {
    await database.close();
  }
});

void test('upsert with an array-valued equality creates a document that matches its filter', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const filter = { tags: ['a', 'b'] };
    const result = await users.update(
      filter,
      { $set: { role: 'member' } },
      { upsert: true },
    );
    assert.notEqual(result.upsertedId, null);

    const found = await users.find(filter).toArray();
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].tags, ['a', 'b']);
  } finally {
    await database.close();
  }
});
