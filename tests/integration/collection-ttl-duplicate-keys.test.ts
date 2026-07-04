import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChangeEvent } from '../../src/index.js';
import { Database } from '../../src/index.js';

interface SessionDocument {
  _id?: string;
  token: string;
  _createdAt?: number;
}

// `_createdAt` is server-controlled on any TTL collection (ADR-016) and can
// no longer be forged to simulate an already-expired record, so these tests
// let real time elapse past a short (1-second) TTL instead.

void test('findOne returns live duplicate when first record is expired (duplicateKeys: allow + TTL)', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    duplicateKeys: 'allow',
    ttl: 1,
  });

  try {
    // First record: let it expire, then insert a fresh live duplicate.
    await sessions.insert({ _id: 'dup-1', token: 'expired' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await sessions.insert({ _id: 'dup-1', token: 'live' });

    const doc = await sessions.findOne({ _id: 'dup-1' });
    assert.notEqual(doc, null, 'should find the live duplicate');
    assert.equal(doc!.token, 'live');
  } finally {
    await database.close();
  }
});

void test('findOne returns null when all duplicates are expired (duplicateKeys: allow + TTL)', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    duplicateKeys: 'allow',
    ttl: 1,
  });

  try {
    await sessions.insert({ _id: 'dup-2', token: 'expired-a' });
    await sessions.insert({ _id: 'dup-2', token: 'expired-b' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const doc = await sessions.findOne({ _id: 'dup-2' });
    assert.equal(
      doc,
      null,
      'should return null when all duplicates are expired',
    );
  } finally {
    await database.close();
  }
});

void test('exists returns true when first record is expired but live duplicate exists (duplicateKeys: allow + TTL)', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    duplicateKeys: 'allow',
    ttl: 1,
  });

  try {
    await sessions.insert({ _id: 'dup-3', token: 'expired' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await sessions.insert({ _id: 'dup-3', token: 'live' });

    const result = await sessions.exists('dup-3');
    assert.equal(result, true, 'should return true for live duplicate');
  } finally {
    await database.close();
  }
});

void test('exists returns false when all duplicates are expired (duplicateKeys: allow + TTL)', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    duplicateKeys: 'allow',
    ttl: 1,
  });

  try {
    await sessions.insert({ _id: 'dup-4', token: 'expired-a' });
    await sessions.insert({ _id: 'dup-4', token: 'expired-b' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const result = await sessions.exists('dup-4');
    assert.equal(
      result,
      false,
      'should return false when all duplicates expired',
    );
  } finally {
    await database.close();
  }
});

void test('remove({ _id }) on duplicateKeys: allow emits one remove event per deleted record', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    duplicateKeys: 'allow',
  });

  try {
    await sessions.insert({ _id: 'dup-r1', token: 'a' });
    await sessions.insert({ _id: 'dup-r1', token: 'b' });
    await sessions.insert({ _id: 'dup-r1', token: 'c' });

    const events: ChangeEvent<SessionDocument>[] = [];
    sessions.watch((event) => {
      events.push(event);
    });

    const removed = await sessions.remove({ _id: 'dup-r1' });

    assert.equal(removed, 3, 'should remove all 3 records');
    assert.equal(
      events.length,
      3,
      'should emit 3 remove events, one per record',
    );
    for (const event of events) {
      assert.equal(event.type, 'remove');
      assert.equal(event.documentId, 'dup-r1');
      assert.equal(event.document, null);
    }
  } finally {
    await database.close();
  }
});

void test('remove({ _id: { $in } }) on duplicateKeys: allow emits one remove event per deleted record', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    duplicateKeys: 'allow',
  });

  try {
    await sessions.insert({ _id: 'dup-in1', token: 'a' });
    await sessions.insert({ _id: 'dup-in1', token: 'b' });
    await sessions.insert({ _id: 'dup-in2', token: 'c' });

    const events: ChangeEvent<SessionDocument>[] = [];
    sessions.watch((event) => {
      events.push(event);
    });

    const removed = await sessions.remove({
      _id: { $in: ['dup-in1', 'dup-in2'] },
    });

    assert.equal(removed, 3, 'should remove all 3 records');
    assert.equal(
      events.length,
      3,
      'should emit 3 remove events, one per record',
    );
    for (const event of events) {
      assert.equal(event.type, 'remove');
      assert.equal(event.document, null);
    }
    const eventIds = events.map((e) => e.documentId).sort();
    assert.deepEqual(eventIds, ['dup-in1', 'dup-in1', 'dup-in2']);
  } finally {
    await database.close();
  }
});
