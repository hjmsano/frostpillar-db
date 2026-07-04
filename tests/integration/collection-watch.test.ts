import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChangeEvent } from '../../src/index.js';
import { Database } from '../../src/index.js';

interface UserDocument {
  _id?: string;
  name: string;
  age?: number;
  status?: string;
}

void test('watch emits insert event', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    const id = await users.insert({ _id: 'u1', name: 'Alice' });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'insert');
    assert.equal(events[0]?.collection, 'users');
    assert.equal(events[0]?.documentId, id);
    assert.notEqual(events[0]?.document, null);
    assert.equal(events[0]?.document?._id, 'u1');
    assert.equal(events[0]?.document?.name, 'Alice');
  } finally {
    await database.close();
  }
});

void test('watch emits update event', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice', status: 'active' });

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    await users.update({ _id: 'u1' }, { $set: { status: 'inactive' } });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'update');
    assert.equal(events[0]?.collection, 'users');
    assert.equal(events[0]?.documentId, 'u1');
    assert.notEqual(events[0]?.document, null);
    assert.equal(events[0]?.document?.status, 'inactive');
  } finally {
    await database.close();
  }
});

void test('watch emits remove event', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    await users.remove({ _id: 'u1' });

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'remove');
    assert.equal(events[0]?.collection, 'users');
    assert.equal(events[0]?.documentId, 'u1');
    assert.equal(events[0]?.document, null);
  } finally {
    await database.close();
  }
});

void test('watch emits events for insertMany', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    await users.insertMany([
      { _id: 'u1', name: 'Alice' },
      { _id: 'u2', name: 'Bob' },
      { _id: 'u3', name: 'Carol' },
    ]);

    assert.equal(events.length, 3);
    for (const event of events) {
      assert.equal(event.type, 'insert');
      assert.equal(event.collection, 'users');
    }
    assert.equal(events[0]?.documentId, 'u1');
    assert.equal(events[1]?.documentId, 'u2');
    assert.equal(events[2]?.documentId, 'u3');
  } finally {
    await database.close();
  }
});

void test('watch unsubscribe stops events', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events: ChangeEvent<UserDocument>[] = [];
    const unsubscribe = users.watch((event) => {
      events.push(event);
    });

    await users.insert({ _id: 'u1', name: 'Alice' });
    assert.equal(events.length, 1);

    unsubscribe();

    await users.insert({ _id: 'u2', name: 'Bob' });
    assert.equal(events.length, 1);
  } finally {
    await database.close();
  }
});

void test('watch supports multiple listeners', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events1: ChangeEvent<UserDocument>[] = [];
    const events2: ChangeEvent<UserDocument>[] = [];

    users.watch((event) => {
      events1.push(event);
    });
    users.watch((event) => {
      events2.push(event);
    });

    await users.insert({ _id: 'u1', name: 'Alice' });

    assert.equal(events1.length, 1);
    assert.equal(events2.length, 1);
    assert.equal(events1[0]?.documentId, 'u1');
    assert.equal(events2[0]?.documentId, 'u1');
  } finally {
    await database.close();
  }
});

void test('watch emits insert event for upsert', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    await users.update(
      { name: 'Alice' },
      { $set: { status: 'active' } },
      { upsert: true },
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'insert');
    assert.equal(events[0]?.collection, 'users');
    assert.notEqual(events[0]?.document, null);
    assert.equal(events[0]?.document?.name, 'Alice');
    assert.equal(events[0]?.document?.status, 'active');
  } finally {
    await database.close();
  }
});

void test('watch update event contains updated document', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice', age: 25 });

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    await users.update(
      { _id: 'u1' },
      { $set: { age: 30, name: 'Alice Updated' } },
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'update');
    assert.equal(events[0]?.document?._id, 'u1');
    assert.equal(events[0]?.document?.name, 'Alice Updated');
    assert.equal(events[0]?.document?.age, 30);
  } finally {
    await database.close();
  }
});

void test('remove with $in emits events only for keys that existed', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });
    await users.insert({ _id: 'u2', name: 'Bob' });

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    // u1 exists, ghost-u99 does not exist
    await users.remove({ _id: { $in: ['u1', 'ghost-u99'] } });

    assert.equal(
      events.length,
      1,
      'only one remove event for the key that existed',
    );
    assert.equal(events[0]?.type, 'remove');
    assert.equal(events[0]?.collection, 'users');
    assert.equal(events[0]?.documentId, 'u1');
    assert.equal(events[0]?.document, null);
  } finally {
    await database.close();
  }
});

void test('remove with $in emits no events when no keys exist', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    const removed = await users.remove({
      _id: { $in: ['ghost-1', 'ghost-2'] },
    });

    assert.equal(removed, 0);
    assert.equal(events.length, 0, 'no events when no keys existed');
  } finally {
    await database.close();
  }
});

void test('remove with $in emits events for all matched keys when all exist', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'u1', name: 'Alice' },
      { _id: 'u2', name: 'Bob' },
      { _id: 'u3', name: 'Carol' },
    ]);

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    await users.remove({ _id: { $in: ['u1', 'u3'] } });

    assert.equal(
      events.length,
      2,
      'two remove events for the two existing keys',
    );
    for (const event of events) {
      assert.equal(event.type, 'remove');
      assert.equal(event.collection, 'users');
      assert.equal(event.document, null);
    }
    const removedIds = events.map((e) => e.documentId).sort();
    assert.deepEqual(removedIds, ['u1', 'u3']);
  } finally {
    await database.close();
  }
});

void test('scan-based remove emits events matching removed count', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'u1', name: 'Alice', status: 'inactive' },
      { _id: 'u2', name: 'Bob', status: 'inactive' },
      { _id: 'u3', name: 'Carol', status: 'active' },
    ]);

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    // Non-_id filter forces scan-based path
    const removed = await users.remove({ status: 'inactive' });

    assert.equal(removed, 2);
    assert.equal(
      events.length,
      removed,
      'one event per actually-deleted record',
    );
    for (const event of events) {
      assert.equal(event.type, 'remove');
      assert.equal(event.collection, 'users');
      assert.equal(event.document, null);
    }
    const removedIds = events.map((e) => e.documentId).sort();
    assert.deepEqual(removedIds, ['u1', 'u2']);
  } finally {
    await database.close();
  }
});

void test("scan-based remove under duplicateKeys 'allow' emits one event per deleted record", async () => {
  const database = new Database({});
  const items = database.collection<UserDocument>('items', {
    duplicateKeys: 'allow',
  });

  try {
    // Insert three records sharing the same _id (allowed by the policy)
    await items.insert({ _id: 'dup', name: 'Item', status: 'x' });
    await items.insert({ _id: 'dup', name: 'Item', status: 'x' });
    await items.insert({ _id: 'dup', name: 'Item', status: 'x' });
    // Insert one non-matching document
    await items.insert({ _id: 'other', name: 'Other', status: 'y' });

    const events: ChangeEvent<UserDocument>[] = [];
    items.watch((event) => {
      events.push(event);
    });

    // Non-_id filter forces the scan-based path even for 'allow' collections
    const removed = await items.remove({ status: 'x' });

    assert.equal(removed, 3, 'three matching records deleted');
    assert.equal(events.length, 3, 'one remove event per deleted record');
    for (const event of events) {
      assert.equal(event.type, 'remove');
      assert.equal(event.collection, 'items');
      assert.equal(event.documentId, 'dup');
      assert.equal(event.document, null);
    }
  } finally {
    await database.close();
  }
});

void test('scan-based remove emits events whose ids exactly match the removed documents', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insertMany([
      { _id: 'u1', name: 'Alice', status: 'inactive' },
      { _id: 'u2', name: 'Bob', status: 'active' },
      { _id: 'u3', name: 'Carol', status: 'inactive' },
      { _id: 'u4', name: 'Dave', status: 'active' },
      { _id: 'u5', name: 'Eve', status: 'inactive' },
    ]);

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    // Non-_id filter forces scan-based path; removes u1, u3, u5
    const removed = await users.remove({ status: 'inactive' });

    assert.equal(removed, 3);
    assert.equal(events.length, 3, 'one event per removed document');
    const emittedIds = events.map((e) => e.documentId).sort();
    // The emitted ids must exactly equal the ids that matched the filter,
    // not a prefix or positional subset of the scanned matches.
    assert.deepEqual(emittedIds, ['u1', 'u3', 'u5']);
    for (const event of events) {
      assert.equal(event.type, 'remove');
      assert.equal(event.collection, 'users');
      assert.equal(event.document, null);
    }
  } finally {
    await database.close();
  }
});

void test('scan-based remove emits no events when nothing matches', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    await users.insert({ _id: 'u1', name: 'Alice', status: 'active' });

    const events: ChangeEvent<UserDocument>[] = [];
    users.watch((event) => {
      events.push(event);
    });

    const removed = await users.remove({ status: 'nonexistent' });

    assert.equal(removed, 0);
    assert.equal(events.length, 0, 'no events when nothing was removed');
  } finally {
    await database.close();
  }
});

void test('watch isolates listener errors so sibling listeners still run', async () => {
  const database = new Database({});
  const users = database.collection<UserDocument>('users');

  try {
    const seen: string[] = [];
    users.watch(() => {
      throw new Error('listener failure should not disrupt others');
    });
    users.watch((event) => {
      seen.push(event.type);
    });

    await users.insert({ _id: 'u1', name: 'Alice' });
    await users.insert({ _id: 'u2', name: 'Bob' });

    assert.deepEqual(seen, ['insert', 'insert']);
  } finally {
    await database.close();
  }
});
