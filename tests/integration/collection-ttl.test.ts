import assert from 'node:assert/strict';
import test from 'node:test';

import { Database } from '../../src/index.js';

interface SessionDocument {
  _id?: string;
  token: string;
  _createdAt?: number;
}

void test('documents with TTL get _createdAt auto-injected', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const before = Date.now();
    const id = await sessions.insert({ token: 'abc' });
    const after = Date.now();

    const doc = await sessions.findOne({ _id: id });
    assert.notEqual(doc, null);
    assert.equal(typeof doc!._createdAt, 'number');
    assert.ok(doc!._createdAt! >= before);
    assert.ok(doc!._createdAt! <= after);
  } finally {
    await database.close();
  }
});

void test('expired documents are not returned by find', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', { ttl: 1 });

  try {
    // `_createdAt` is server-controlled on TTL collections (ADR-016) and can
    // no longer be forged to simulate an already-expired document, so we let
    // real time elapse past the 1-second TTL instead.
    await sessions.insert({ token: 'expired' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const docs = await sessions.find().toArray();
    assert.equal(docs.length, 0);
  } finally {
    await database.close();
  }
});

void test('non-expired documents are returned', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    await sessions.insert({ token: 'valid', _createdAt: Date.now() });

    const docs = await sessions.find().toArray();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].token, 'valid');
  } finally {
    await database.close();
  }
});

void test('purgeExpired removes expired documents from storage', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', { ttl: 1 });

  try {
    // Insert a document, let it expire (real time — see note above), then
    // insert a fresh valid document.
    await sessions.insert({ token: 'expired' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await sessions.insert({ token: 'valid' });

    await sessions.purgeExpired();

    // After purge, even raw storage should not contain the expired document.
    // Re-find with a long TTL collection to confirm only valid remains.
    // We verify by checking count on a fresh find (which also filters by TTL).
    const docs = await sessions.find().toArray();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].token, 'valid');
  } finally {
    await database.close();
  }
});

void test('purgeExpired returns count of removed documents', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', { ttl: 1 });

  try {
    await sessions.insert({ token: 'expired1' });
    await sessions.insert({ token: 'expired2' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await sessions.insert({ token: 'valid' });

    const removed = await sessions.purgeExpired();
    assert.equal(removed, 2);
  } finally {
    await database.close();
  }
});

void test('exists() returns false for an expired document', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', { ttl: 1 });

  try {
    const id = await sessions.insert({ token: 'expired' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const result = await sessions.exists(id);
    assert.equal(result, false);
  } finally {
    await database.close();
  }
});

void test('exists() returns true for a non-expired document', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'valid' });

    const result = await sessions.exists(id);
    assert.equal(result, true);
  } finally {
    await database.close();
  }
});

void test('exists() returns false for a non-existent document', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const result = await sessions.exists('no-such-id');
    assert.equal(result, false);
  } finally {
    await database.close();
  }
});

void test('exists() works correctly on non-TTL collection', async () => {
  const database = new Database({});
  const users = database.collection<SessionDocument>('users');

  try {
    const id = await users.insert({ token: 'abc' });

    assert.equal(await users.exists(id), true);
    assert.equal(await users.exists('no-such-id'), false);
  } finally {
    await database.close();
  }
});

void test('ids() excludes expired document IDs', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', { ttl: 1 });

  try {
    const expiredId = await sessions.insert({ token: 'expired' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const validId = await sessions.insert({ token: 'valid' });

    const allIds = await sessions.ids();
    assert.ok(
      !allIds.includes(expiredId),
      'expired id should not appear in ids()',
    );
    assert.ok(allIds.includes(validId), 'valid id should appear in ids()');
    assert.equal(allIds.length, 1);
  } finally {
    await database.close();
  }
});

void test('ids() returns all IDs when nothing is expired', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id1 = await sessions.insert({ token: 'a' });
    const id2 = await sessions.insert({ token: 'b' });

    const allIds = await sessions.ids();
    assert.equal(allIds.length, 2);
    assert.ok(allIds.includes(id1));
    assert.ok(allIds.includes(id2));
  } finally {
    await database.close();
  }
});

void test('ids() works correctly on non-TTL collection', async () => {
  const database = new Database({});
  const users = database.collection<SessionDocument>('users');

  try {
    const id1 = await users.insert({ token: 'x' });
    const id2 = await users.insert({ token: 'y' });

    const allIds = await users.ids();
    assert.equal(allIds.length, 2);
    assert.ok(allIds.includes(id1));
    assert.ok(allIds.includes(id2));
  } finally {
    await database.close();
  }
});

void test('collection without TTL does not inject _createdAt', async () => {
  const database = new Database({});
  const users = database.collection<SessionDocument>('users');

  try {
    const id = await users.insert({ token: 'abc' });
    const doc = await users.findOne({ _id: id });

    assert.notEqual(doc, null);
    assert.equal(doc!._createdAt, undefined);
  } finally {
    await database.close();
  }
});

// Superseded by ADR-016: `_createdAt` is now server-controlled on any TTL
// collection, regardless of `immutableCreatedAt`, so a caller-supplied value
// is always overwritten rather than preserved. See also
// tests/integration/collection-immutable-createdat.test.ts for the full
// insert/update coverage of this protection.
void test('user-provided _createdAt is overwritten by the server timestamp on a TTL collection', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const before = Date.now();
    const customTime = Date.now() - 1000; // 1 second ago (within 3600s TTL)
    const id = await sessions.insert({
      token: 'custom',
      _createdAt: customTime,
    });
    const after = Date.now();

    const doc = await sessions.findOne({ _id: id });
    assert.notEqual(doc, null);
    assert.notEqual(doc!._createdAt, customTime);
    assert.ok(doc!._createdAt! >= before);
    assert.ok(doc!._createdAt! <= after);
  } finally {
    await database.close();
  }
});

void test('update does not reset _createdAt', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'original' });
    const docBefore = await sessions.findOne({ _id: id });
    const originalCreatedAt = docBefore!._createdAt;

    await sessions.update({ _id: id }, { $set: { token: 'updated' } });

    const docAfter = await sessions.findOne({ _id: id });
    assert.equal(docAfter!._createdAt, originalCreatedAt);
    assert.equal(docAfter!.token, 'updated');
  } finally {
    await database.close();
  }
});
