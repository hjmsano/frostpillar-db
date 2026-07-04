// Defensive regression tests for frostpillar-db's input-validation layer.
// The hostile-looking inputs below are fixtures that MUST be rejected (or
// safely handled) by the library; they verify the _createdAt-immutability
// guards in src/internal/ continue to block dotted-path and direct writes.
// No code here produces a usable payload.

import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';

import { ConfigurationError, ValidationError } from '../../src/errors.js';
import { Database } from '../../src/index.js';

interface SessionDocument {
  _id?: string;
  token: string;
  _createdAt?: number;
}

const makeTmpDir = (): string => {
  const dir = path.join(
    process.cwd(),
    '.tmp-test-immutable-createdat',
    `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Test 1: immutableCreatedAt: true + ttl — user-supplied _createdAt is ignored on insert
void test('immutableCreatedAt: insert with user _createdAt is overridden by server timestamp', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
    immutableCreatedAt: true,
  });

  try {
    const before = Date.now();
    // Provide a _createdAt that would be expired under a small ttl
    const userCreatedAt = Date.now() - 5000;
    const id = await sessions.insert({
      token: 'abc',
      _createdAt: userCreatedAt,
    });
    const after = Date.now();

    const doc = await sessions.findOne({ _id: id });
    assert.notEqual(doc, null, 'document should not be expired');
    const storedCreatedAt = doc!._createdAt;
    assert.equal(
      typeof storedCreatedAt,
      'number',
      '_createdAt should be a number',
    );
    assert.ok(
      (storedCreatedAt ?? 0) >= before,
      '_createdAt should be >= before timestamp',
    );
    assert.ok(
      (storedCreatedAt ?? 0) <= after,
      '_createdAt should be <= after timestamp',
    );
    assert.notEqual(
      storedCreatedAt,
      userCreatedAt,
      'user-supplied _createdAt must be ignored',
    );

    // Doc is not expired (server timestamp was used)
    const docs = await sessions.find().toArray();
    assert.equal(docs.length, 1, 'document should still be found by find');
  } finally {
    await database.close();
  }
});

// Test 2: immutableCreatedAt: true — $set: { _createdAt } is rejected
void test('immutableCreatedAt: update $set _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
    immutableCreatedAt: true,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update(
          { _id: id },
          { $set: { _createdAt: Date.now() + 99999 } },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 3: immutableCreatedAt: true — $unset and $inc also reject
void test('immutableCreatedAt: update $unset _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
    immutableCreatedAt: true,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $unset: { _createdAt: '' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('immutableCreatedAt: update $inc _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
    immutableCreatedAt: true,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $inc: { _createdAt: 1 } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 4 (ADR-016): default TTL collection (no immutableCreatedAt) — _createdAt
// is now protected automatically because `ttl` is set, regardless of the
// immutableCreatedAt flag. This mirrors Test 1's assertions but WITHOUT
// immutableCreatedAt, since ttl alone is now sufficient.
void test('default TTL collection (no immutableCreatedAt): user-supplied _createdAt is overwritten by server timestamp on insert', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const before = Date.now();
    const customTime = Date.now() - 1000;
    const id = await sessions.insert({
      token: 'custom',
      _createdAt: customTime,
    });
    const after = Date.now();

    const doc = await sessions.findOne({ _id: id });
    assert.notEqual(doc, null);
    const storedCreatedAt = doc!._createdAt;
    assert.equal(typeof storedCreatedAt, 'number');
    assert.notEqual(
      storedCreatedAt,
      customTime,
      'user-supplied _createdAt must be overwritten on a ttl collection even without immutableCreatedAt',
    );
    assert.ok((storedCreatedAt ?? 0) >= before);
    assert.ok((storedCreatedAt ?? 0) <= after);
  } finally {
    await database.close();
  }
});

// Test 4b (ADR-016): mirrors Test 2 — WITHOUT immutableCreatedAt.
void test('default TTL collection (no immutableCreatedAt): update $set _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update(
          { _id: id },
          { $set: { _createdAt: Date.now() + 99999 } },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 4c (ADR-016): mirrors Test 3 — WITHOUT immutableCreatedAt.
void test('default TTL collection (no immutableCreatedAt): update $unset _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $unset: { _createdAt: '' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('default TTL collection (no immutableCreatedAt): update $inc _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $inc: { _createdAt: 1 } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('default TTL collection (no immutableCreatedAt): update $rename _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update({ _id: id }, { $rename: { _createdAt: 'renamed' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 4d (ADR-016): upsert path also rejects _createdAt tampering on a
// default TTL collection (no immutableCreatedAt).
void test('default TTL collection (no immutableCreatedAt): upsert $set _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    await assert.rejects(
      () =>
        sessions.update(
          { _id: 'no-such-doc' },
          { $set: { token: 'x', _createdAt: Date.now() + 99999 } },
          { upsert: true },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 4e (ADR-016 regression guard): non-TTL collections are unaffected —
// _createdAt behaves like any other field when the option is absent.
void test('non-TTL collection (no options): user-supplied _createdAt is preserved on insert', async () => {
  const database = new Database({});
  const plain = database.collection<SessionDocument>('plain');

  try {
    const customTime = Date.now() - 1000;
    const id = await plain.insert({ token: 'custom', _createdAt: customTime });

    const doc = await plain.findOne({ _id: id });
    assert.notEqual(doc, null);
    assert.equal(
      doc!._createdAt,
      customTime,
      'user _createdAt must be preserved on a non-TTL collection',
    );
  } finally {
    await database.close();
  }
});

void test('non-TTL collection (no options): $set _createdAt succeeds', async () => {
  const database = new Database({});
  const plain = database.collection<SessionDocument>('plain');

  try {
    const id = await plain.insert({ token: 'test' });
    const futureTime = Date.now() + 99999;

    const result = await plain.update(
      { _id: id },
      { $set: { _createdAt: futureTime } },
    );
    assert.equal(
      result.modifiedCount,
      1,
      '$set _createdAt should succeed on a non-TTL, non-immutableCreatedAt collection',
    );

    const doc = await plain.findOne({ _id: id });
    assert.notEqual(doc, null);
    assert.equal(doc!._createdAt, futureTime);
  } finally {
    await database.close();
  }
});

// Test 4f (ADR-016 regression guard): immutableCreatedAt: true's INSERT-time
// server-timestamp override is tied to the same `_createdAt` write that
// happens for TTL bookkeeping (prepareInsertRecord only ever writes
// `_createdAt` when `ttl !== undefined` — see ADR-016) — it does not, by
// itself, force an insert-time overwrite on a collection with no `ttl`. This
// is unchanged pre-existing behavior, not something ADR-016 altered. What
// `immutableCreatedAt: true` DOES guarantee unconditionally (see the next
// test) is that `_createdAt`, once set at insert, can never be modified by a
// later update — a "write-once" guarantee rather than a "server-assigned"
// one when no `ttl` is present.
void test('non-TTL collection with immutableCreatedAt: true: user-supplied _createdAt is preserved on insert (no ttl to protect)', async () => {
  const database = new Database({});
  const auditLog = database.collection<SessionDocument>('audit-log', {
    immutableCreatedAt: true,
  });

  try {
    const customTime = Date.now() - 5000;
    const id = await auditLog.insert({
      token: 'custom',
      _createdAt: customTime,
    });

    const doc = await auditLog.findOne({ _id: id });
    assert.notEqual(doc, null);
    assert.equal(
      doc!._createdAt,
      customTime,
      'insert-time server-timestamp overwrite only applies when ttl is set; immutableCreatedAt alone locks the field post-insert, it does not force insert-time assignment',
    );
  } finally {
    await database.close();
  }
});

void test('non-TTL collection with immutableCreatedAt: true: update $set _createdAt rejects with ValidationError', async () => {
  const database = new Database({});
  const auditLog = database.collection<SessionDocument>('audit-log', {
    immutableCreatedAt: true,
  });

  try {
    const id = await auditLog.insert({ token: 'test' });

    await assert.rejects(
      () =>
        auditLog.update(
          { _id: id },
          { $set: { _createdAt: Date.now() + 99999 } },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 5: re-accessing the same collection with different immutableCreatedAt throws ConfigurationError
void test('collection re-access: different immutableCreatedAt throws ConfigurationError', async () => {
  const database = new Database({});
  database.collection<SessionDocument>('sessions', {
    immutableCreatedAt: true,
  });

  assert.throws(
    () =>
      database.collection<SessionDocument>('sessions', {
        immutableCreatedAt: false,
      }),
    ConfigurationError,
  );

  await database.close();
});

void test('collection re-access: different immutableCreatedAt (absent vs true) throws ConfigurationError', async () => {
  const database = new Database({});
  database.collection<SessionDocument>('sessions', {
    immutableCreatedAt: true,
  });

  // Bare re-access resolves immutableCreatedAt: false (default), which differs from true
  assert.throws(
    () => database.collection<SessionDocument>('sessions'),
    ConfigurationError,
  );

  await database.close();
});

// ---------------------------------------------------------------------------
// Round-2 follow-up (S3 gap): `_createdAt` protection used exact string
// equality, so a dotted sub-path (`_createdAt.tamper`) evaded it whenever
// `_createdAt` was missing from the document — `setValueByPath` then treats
// the dotted path as license to *create* `_createdAt` as a nested object,
// turning it into a non-number and making the document permanently
// un-expirable (`isDocumentExpiredAt` requires `typeof _createdAt ===
// 'number'`). Fixed in `updateValidator.ts` by checking
// `fieldPath === '_createdAt' || fieldPath.startsWith('_createdAt.')`.
// ---------------------------------------------------------------------------

// Test 6: direct dotted-path rejection for every field operator, on a ttl
// collection, regardless of what _createdAt currently holds (present as a
// number, or absent entirely).
void test('ttl collection: $set on _createdAt.anything rejects with ValidationError even when _createdAt is a number', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update({ _id: id }, { $set: { '_createdAt.tamper': 'x' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('ttl collection: $unset on _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $unset: { '_createdAt.x': '' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('ttl collection: $inc on _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $inc: { '_createdAt.x': 1 } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('ttl collection: $push on _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $push: { '_createdAt.x': 1 } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('ttl collection: $addToSet on _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () => sessions.update({ _id: id }, { $addToSet: { '_createdAt.x': 1 } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Same, but with immutableCreatedAt: true on a non-ttl collection, to prove
// the fix covers both routes into protectCreatedAt.
void test('immutableCreatedAt collection (no ttl): $set on _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const auditLog = database.collection<SessionDocument>('audit-log', {
    immutableCreatedAt: true,
  });

  try {
    const id = await auditLog.insert({ token: 'test' });

    await assert.rejects(
      () =>
        auditLog.update({ _id: id }, { $set: { '_createdAt.tamper': 'x' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 7: $rename with source or target _createdAt.anything, both directions.
void test('ttl collection: $rename with target _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update(
          { _id: id },
          { $rename: { token: '_createdAt.tampered' } },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

void test('ttl collection: $rename with source _createdAt.anything rejects with ValidationError', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update(
          { _id: id },
          { $rename: { '_createdAt.tampered': 'somewhere' } },
        ),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 8: regression — ordinary non-dotted _createdAt protection (round-1)
// still passes unaffected by the dotted-path fix.
void test('regression: ordinary non-dotted _createdAt protection is unaffected by the dotted-path fix', async () => {
  const database = new Database({});
  const sessions = database.collection<SessionDocument>('sessions', {
    ttl: 3600,
  });

  try {
    const id = await sessions.insert({ token: 'test' });

    await assert.rejects(
      () =>
        sessions.update(
          { _id: id },
          { $set: { _createdAt: Date.now() + 99999 } },
        ),
      ValidationError,
    );
    await assert.rejects(
      () => sessions.update({ _id: id }, { $unset: { _createdAt: '' } }),
      ValidationError,
    );
    await assert.rejects(
      () => sessions.update({ _id: id }, { $inc: { _createdAt: 1 } }),
      ValidationError,
    );
    await assert.rejects(
      () =>
        sessions.update({ _id: id }, { $rename: { _createdAt: 'renamed' } }),
      ValidationError,
    );
  } finally {
    await database.close();
  }
});

// Test 9 (end-to-end, defensive regression): a collection created WITHOUT ttl,
// populated with a document (so it has no _createdAt at all), then reopened
// in a NEW Database instance pointed at the same persisted storage with the
// SAME collection now configured { ttl }. This is ordinary schema evolution
// on a persistent, file-backed database — exactly what this library is
// designed to support across sessions. Confirms the dotted-path write is
// rejected on the resulting legacy, missing-_createdAt document, and that
// the (separate, already-landed, out-of-scope-to-change) round-1 behavior
// for a missing _createdAt under a newly-added ttl is what it is: since
// `isDocumentExpiredAt` requires `typeof _createdAt === 'number'`, a
// document that never had _createdAt written to it does not expire, TTL or
// not — this test asserts that pre-existing behavior, not a new guarantee.
void test('end-to-end: dotted _createdAt write rejected on a legacy document after ttl is added on reopen (fileDriver)', async () => {
  const tmpDir = makeTmpDir();

  try {
    // Session 1: collection created WITHOUT ttl, document inserted has no
    // _createdAt field at all.
    const database1 = new Database({
      driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
    });
    const itemsNoTtl = database1.collection<SessionDocument>('items');
    const id = await itemsNoTtl.insert({ token: 'legacy' });

    const legacyDoc = await itemsNoTtl.findOne({ _id: id });
    assert.notEqual(legacyDoc, null);
    assert.equal(
      Object.prototype.hasOwnProperty.call(legacyDoc, '_createdAt'),
      false,
      '_createdAt must be absent on this legacy document',
    );

    await database1.close();

    // Session 2: a NEW Database instance, same storage, same collection now
    // configured with ttl — the realistic schema-evolution scenario.
    const database2 = new Database({
      driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
    });
    const itemsWithTtl = database2.collection<SessionDocument>('items', {
      ttl: 3600,
    });

    try {
      // Regression: dotted sub-path $set on a document with no _createdAt.
      await assert.rejects(
        () =>
          itemsWithTtl.update(
            { _id: id },
            { $set: { '_createdAt.tamper': 'x' } },
          ),
        ValidationError,
      );

      // Regression: dotted-path $rename that must be rejected.
      await assert.rejects(
        () =>
          itemsWithTtl.update(
            { _id: id },
            { $rename: { token: '_createdAt.tampered' } },
          ),
        ValidationError,
      );

      // The document's _createdAt is still absent (not turned into an
      // object by a write that should have been, and was, rejected).
      const docAfter = await itemsWithTtl.findOne({ _id: id });
      assert.notEqual(docAfter, null);
      assert.equal(
        Object.prototype.hasOwnProperty.call(docAfter, '_createdAt'),
        false,
        '_createdAt must remain absent — the tamper attempts were rejected',
      );

      // Pre-existing (round-1) behavior, asserted here only as a guard
      // against this test silently relying on an incorrect assumption:
      // a document with a missing (non-number) _createdAt is never treated
      // as expired, ttl or not, so it remains findable indefinitely.
      const stillFound = await itemsWithTtl.find().toArray();
      assert.equal(
        stillFound.length,
        1,
        'legacy document with missing _createdAt must remain findable (not expired)',
      );
    } finally {
      await database2.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
