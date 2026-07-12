// Spec 02 §12 / ADR-025: caller-supplied documents and update operands are
// deep-copied on every write path. Because the underlying Datastore is always
// constructed with skipPayloadValidation: true (which also disables its
// defensive copy), a stored record that aliased caller-owned objects could be
// silently rewritten — or made unreadable by a cycle — after the write returned.
import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';

interface NestedDocument {
  _id?: string;
  name: string;
  tags?: string[];
  profile?: { city?: string; deep?: { level?: number } };
  items?: unknown[];
}

// A cyclic object is unrepresentable in a validated document, so it can only
// enter storage by aliasing. Reading it back is what turns the alias into a
// RangeError, which is why the cycle cases assert on read.
interface Cyclic {
  self?: Cyclic;
  value: number;
}

void test('insert deep-copies nested objects so post-insert mutation cannot alter the stored record', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const input: NestedDocument = {
      name: 'Alice',
      tags: ['a'],
      profile: { city: 'Tokyo', deep: { level: 1 } },
    };
    const id = await collection.insert(input);

    input.name = 'Mallory';
    input.tags?.push('injected');
    if (input.profile !== undefined) input.profile.city = 'Osaka';
    if (input.profile?.deep !== undefined) input.profile.deep.level = 99;

    const stored = await collection.findOne({ _id: id });
    assert.equal(stored?.name, 'Alice');
    assert.deepEqual(stored?.tags, ['a']);
    assert.equal(stored?.profile?.city, 'Tokyo');
    assert.equal(stored?.profile?.deep?.level, 1);
  } finally {
    await database.close();
  }
});

void test('insertMany deep-copies each document', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const first: NestedDocument = { name: 'Alice', tags: ['a'] };
    const second: NestedDocument = { name: 'Bob', tags: ['b'] };
    const ids = await collection.insertMany([first, second]);

    first.tags?.push('injected');
    second.tags?.push('injected');

    const storedFirst = await collection.findOne({ _id: ids[0] });
    const storedSecond = await collection.findOne({ _id: ids[1] });
    assert.deepEqual(storedFirst?.tags, ['a']);
    assert.deepEqual(storedSecond?.tags, ['b']);
  } finally {
    await database.close();
  }
});

void test('inserting the same object twice yields records that do not alias each other', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const shared: NestedDocument = { name: 'Alice', profile: { city: 'Tokyo' } };
    const firstId = await collection.insert(shared);
    const secondId = await collection.insert(shared);

    await collection.update(
      { _id: firstId },
      { $set: { 'profile.city': 'Osaka' } },
    );

    const second = await collection.findOne({ _id: secondId });
    assert.equal(second?.profile?.city, 'Tokyo');
  } finally {
    await database.close();
  }
});

void test('a cycle injected into the input after insert does not corrupt reads', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const cyclic: Cyclic = { value: 1 };
    const input: NestedDocument = { name: 'Alice', items: [cyclic] };
    const id = await collection.insert(input);

    cyclic.self = cyclic;

    const stored = await collection.findOne({ _id: id });
    assert.equal(stored?.name, 'Alice');
    assert.deepEqual(stored?.items, [{ value: 1 }]);
  } finally {
    await database.close();
  }
});

void test('$set deep-copies its value so post-update mutation cannot alter the stored record', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const id = await collection.insert({ name: 'Alice' });

    const value = { city: 'Tokyo', deep: { level: 1 } };
    await collection.update({ _id: id }, { $set: { profile: value } });

    value.city = 'Osaka';
    value.deep.level = 99;

    const stored = await collection.findOne({ _id: id });
    assert.equal(stored?.profile?.city, 'Tokyo');
    assert.equal(stored?.profile?.deep?.level, 1);
  } finally {
    await database.close();
  }
});

void test('$push deep-copies the pushed value', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const id = await collection.insert({ name: 'Alice', items: [] });

    const value = { level: 1 };
    await collection.update({ _id: id }, { $push: { items: value } });

    value.level = 99;

    const stored = await collection.findOne({ _id: id });
    assert.deepEqual(stored?.items, [{ level: 1 }]);
  } finally {
    await database.close();
  }
});

void test('$push deep-copies the value that seeds a missing array field', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const id = await collection.insert({ name: 'Alice' });

    const value = { level: 1 };
    await collection.update({ _id: id }, { $push: { items: value } });

    value.level = 99;

    const stored = await collection.findOne({ _id: id });
    assert.deepEqual(stored?.items, [{ level: 1 }]);
  } finally {
    await database.close();
  }
});

void test('$addToSet deep-copies the added value', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const id = await collection.insert({ name: 'Alice', items: [] });

    const value = { level: 1 };
    await collection.update({ _id: id }, { $addToSet: { items: value } });

    value.level = 99;

    const stored = await collection.findOne({ _id: id });
    assert.deepEqual(stored?.items, [{ level: 1 }]);
  } finally {
    await database.close();
  }
});

void test('a cycle injected into a $set value after the update does not corrupt reads', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const id = await collection.insert({ name: 'Alice' });

    const cyclic: Cyclic = { value: 1 };
    await collection.update({ _id: id }, { $set: { items: [cyclic] } });

    cyclic.self = cyclic;

    const stored = await collection.findOne({ _id: id });
    assert.deepEqual(stored?.items, [{ value: 1 }]);
  } finally {
    await database.close();
  }
});

void test('upsert deep-copies operand values into the inserted document', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const value = { city: 'Tokyo', deep: { level: 1 } };
    const result = await collection.update(
      { name: 'Alice' },
      { $set: { profile: value } },
      { upsert: true },
    );
    assert.notEqual(result.upsertedId, null);

    value.city = 'Osaka';
    value.deep.level = 99;

    const stored = await collection.findOne({ _id: result.upsertedId });
    assert.equal(stored?.profile?.city, 'Tokyo');
    assert.equal(stored?.profile?.deep?.level, 1);
  } finally {
    await database.close();
  }
});

// One update() call can write the same operand into several matched documents.
// The copy must therefore be per-document, not per-call: otherwise the matched
// records alias each other and editing one edits the rest.
void test('one operand written to several matched documents does not alias them together', async () => {
  const database = new Database({});
  const collection = database.collection<NestedDocument>('docs');

  try {
    const firstId = await collection.insert({ name: 'Alice' });
    const secondId = await collection.insert({ name: 'Bob' });

    const value = { city: 'Tokyo' };
    const result = await collection.update({}, { $set: { profile: value } });
    assert.equal(result.modifiedCount, 2);

    await collection.update(
      { _id: firstId },
      { $set: { 'profile.city': 'Osaka' } },
    );

    const second = await collection.findOne({ _id: secondId });
    assert.equal(second?.profile?.city, 'Tokyo');
  } finally {
    await database.close();
  }
});
