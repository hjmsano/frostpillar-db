import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ClosedDatabaseError,
  ConfigurationError,
  Database,
  DuplicateIdError,
  ValidationError,
} from '../../src/index.js';

interface UserDoc {
  _id?: string;
  name: string;
}

interface LogDoc {
  _id?: string;
  event: string;
}

interface PostDoc {
  _id?: string;
  title: string;
}

void test('collection validates name constraints', () => {
  const database = new Database({});

  assert.throws(
    () => database.collection(123 as unknown as string),
    ValidationError,
  );
  assert.throws(() => database.collection(''), ValidationError);
  assert.throws(() => database.collection('user\u0000ids'), ValidationError);
  assert.throws(() => database.collection('_internal'), ValidationError);
});

void test('collection rejects unsupported duplicateKeys option values', () => {
  const database = new Database({});
  const invalidOptions = {
    duplicateKeys: 'ignore',
  } as unknown as { duplicateKeys: 'allow' | 'replace' | 'reject' };

  assert.throws(
    () => database.collection('users', invalidOptions),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// collection re-access semantics: resolved options must match stored options
// ---------------------------------------------------------------------------

void test('collection re-access: bare lookup after non-default duplicateKeys throws ConfigurationError', () => {
  // stored: { duplicateKeys: 'allow' }
  // resolved bare call: { duplicateKeys: 'reject' } (default)
  // 'allow' !== 'reject' → must throw
  const database = new Database({});
  database.collection('users', { duplicateKeys: 'allow' });
  assert.throws(() => database.collection('users'), ConfigurationError);
});

void test('collection re-access: same explicit duplicateKeys returns same instance', () => {
  const database = new Database({});
  const first = database.collection('users', { duplicateKeys: 'allow' });
  const second = database.collection('users', { duplicateKeys: 'allow' });
  assert.equal(second, first);
});

void test('collection re-access: conflicting explicit duplicateKeys throws ConfigurationError', () => {
  const database = new Database({});
  database.collection('users', { duplicateKeys: 'allow' });
  assert.throws(
    () => database.collection('users', { duplicateKeys: 'reject' }),
    ConfigurationError,
  );
});

void test('collection re-access: bare lookup after bare creation returns same instance', () => {
  // both resolve to defaults → match → OK
  const database = new Database({});
  const first = database.collection('users');
  const second = database.collection('users');
  assert.equal(second, first);
});

void test('collection re-access: bare lookup after explicit default duplicateKeys returns same instance', () => {
  // stored: { duplicateKeys: 'reject' } (explicit, but equals default)
  // resolved bare call: { duplicateKeys: 'reject' }
  // 'reject' === 'reject' → OK
  const database = new Database({});
  const first = database.collection('users', { duplicateKeys: 'reject' });
  const second = database.collection('users');
  assert.equal(second, first);
});

// ---------------------------------------------------------------------------
// Per-field mismatch detection
// ---------------------------------------------------------------------------

void test('collection re-access: ttl mismatch throws ConfigurationError', () => {
  const database = new Database({});
  database.collection('logs', { ttl: 60 });
  assert.throws(
    () => database.collection('logs', { ttl: 120 }),
    ConfigurationError,
  );
});

void test('collection re-access: capacity.maxSize mismatch throws ConfigurationError', () => {
  const database = new Database({});
  database.collection('logs', { capacity: { maxSize: 100 } });
  assert.throws(
    () => database.collection('logs', { capacity: { maxSize: 200 } }),
    ConfigurationError,
  );
});

void test('collection re-access: capacity.policy mismatch throws ConfigurationError', () => {
  const database = new Database({});
  database.collection('logs', { capacity: { maxSize: 100, policy: 'strict' } });
  assert.throws(
    () =>
      database.collection('logs', {
        capacity: { maxSize: 100, policy: 'turnover' },
      }),
    ConfigurationError,
  );
});

// Note: autoCommit options require a durable backend driver — using them with
// the default in-memory backend throws ConfigurationError at collection creation
// time ("autoCommit requires a durable driver"). Mismatch detection for
// autoCommit.frequency and autoCommit.maxPendingBytes is covered by the
// isSameAutoCommit unit path invoked via the resolved-options comparison in
// isSameCollectionOptions; it cannot be exercised end-to-end here without a
// durable driver. Those fields are integration-test concerns.

void test('collection re-access: index.maxLeafEntries mismatch throws ConfigurationError', () => {
  const database = new Database({});
  database.collection('logs', {
    index: { autoScale: false, maxLeafEntries: 64, maxBranchChildren: 32 },
  });
  assert.throws(
    () =>
      database.collection('logs', {
        index: { autoScale: false, maxLeafEntries: 128, maxBranchChildren: 32 },
      }),
    ConfigurationError,
  );
});

void test('collection re-access: deep-equal capacity object (different reference) returns same instance', () => {
  // Confirms isSameCapacity uses value comparison, not reference equality
  const database = new Database({});
  const first = database.collection('logs', {
    capacity: { maxSize: 100, policy: 'strict' },
  });
  // Fresh object with same values
  const second = database.collection('logs', {
    capacity: { maxSize: 100, policy: 'strict' },
  });
  assert.equal(second, first);
});

void test('collection re-access: key definition with same function refs but different wrapper object returns same instance', () => {
  // bug-16: isSameKey must compare function properties structurally,
  // not the outer object by reference identity.
  const normalize = (v: unknown): unknown => Number(v);
  const compare = (a: unknown, b: unknown): number => Number(a) - Number(b);
  const serialize = (k: unknown): string => String(k);
  const deserialize = (s: string): unknown => Number(s);

  const database = new Database({});
  const first = database.collection('items', {
    key: { normalize, compare, serialize, deserialize },
  });
  // Different object literal, same function references
  const second = database.collection('items', {
    key: { normalize, compare, serialize, deserialize },
  });
  assert.equal(second, first);
});

void test('collection re-access: key definition with different function refs throws ConfigurationError', () => {
  const database = new Database({});
  database.collection('items', {
    key: {
      normalize: (v: unknown): unknown => Number(v),
      compare: (a: unknown, b: unknown): number => Number(a) - Number(b),
      serialize: (k: unknown): string => String(k),
      deserialize: (s: string): unknown => Number(s),
    },
  });
  // Different function references (inline arrows) → must throw
  assert.throws(
    () =>
      database.collection('items', {
        key: {
          normalize: (v: unknown): unknown => Number(v),
          compare: (a: unknown, b: unknown): number => Number(a) - Number(b),
          serialize: (k: unknown): string => String(k),
          deserialize: (s: string): unknown => Number(s),
        },
      }),
    ConfigurationError,
  );
});

void test('commit succeeds while open', async () => {
  const database = new Database({});

  await assert.doesNotReject(() => database.commit());
  await database.close();
});

void test('listCollections returns empty array for empty database', async () => {
  const database = new Database({});

  const collections = await database.listCollections();

  assert.deepEqual(collections, []);
  await database.close();
});

void test('each collection gets an independent datastore with its own duplicate key policy', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users', {
    duplicateKeys: 'reject',
  });
  const logs = database.collection<LogDoc>('logs', { duplicateKeys: 'allow' });

  try {
    await users.insert({ _id: 'id-1', name: 'Alice' });
    await assert.rejects(
      () => users.insert({ _id: 'id-1', name: 'Bob' }),
      DuplicateIdError,
    );

    await logs.insert({ _id: 'id-1', event: 'login' });
    await logs.insert({ _id: 'id-1', event: 'logout' });
    const logDocs = await logs.find({ _id: 'id-1' }).toArray();
    assert.equal(logDocs.length, 2);
  } finally {
    await database.close();
  }
});

void test('dropCollection removes only target collection documents', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  const posts = database.collection<PostDoc>('posts');

  try {
    await users.insert({ _id: 'u1', name: 'Alice' });
    await posts.insert({ _id: 'p1', title: 'First Post' });

    await database.dropCollection('users');

    const postCount = await posts.count();
    assert.equal(postCount, 1);

    const freshUsers = database.collection<UserDoc>('users');
    const userCount = await freshUsers.count();
    assert.equal(userCount, 0);
  } finally {
    await database.close();
  }
});

void test('dropCollection clears persisted options allowing reconfiguration', async () => {
  const database = new Database({});

  database.collection('users', { duplicateKeys: 'allow' });

  assert.throws(
    () => database.collection('users', { duplicateKeys: 'reject' }),
    ConfigurationError,
  );

  await database.dropCollection('users');

  assert.doesNotThrow(() =>
    database.collection('users', { duplicateKeys: 'reject' }),
  );

  await database.close();
});

void test('listCollections returns all created collections including empty ones', async () => {
  const database = new Database({});

  const zeta = database.collection<UserDoc>('zeta');
  database.collection('alpha');
  const mango = database.collection<UserDoc>('mango');

  // 'zeta' and 'mango' have documents; 'alpha' is empty — all three must appear
  await zeta.insert({ name: 'Z' });
  await mango.insert({ name: 'M' });

  const collections = await database.listCollections();

  assert.deepEqual(collections, ['alpha', 'mango', 'zeta']);
  await database.close();
});

void test('listCollections includes a created-but-empty collection', async () => {
  const database = new Database({});

  database.collection('empty');

  const collections = await database.listCollections();

  assert.ok(collections.includes('empty'));
  await database.close();
});

void test('listCollections includes a TTL collection whose documents have all expired', async () => {
  const database = new Database({});

  const sessions = database.collection<UserDoc>('sessions', { ttl: 1 });
  await sessions.insert({ name: 'old' } as unknown as UserDoc);
  // Let the document actually expire — `_createdAt` is server-controlled on
  // TTL collections (ADR-016) and can no longer be forged to fast-forward
  // expiry. listCollections() lists the collection regardless of whether its
  // documents have expired, so this simply confirms that holds true once
  // the (only) document genuinely has.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const collections = await database.listCollections();

  assert.ok(collections.includes('sessions'));
  await database.close();
});

void test('listCollections excludes a dropped collection', async () => {
  const database = new Database({});

  database.collection<UserDoc>('keep');
  database.collection<UserDoc>('drop');

  await database.dropCollection('drop');

  const collections = await database.listCollections();

  assert.ok(collections.includes('keep'));
  assert.ok(!collections.includes('drop'));
  await database.close();
});

void test('commit commits all collection datastores', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  const posts = database.collection<PostDoc>('posts');

  await users.insert({ _id: 'u1', name: 'Alice' });
  await posts.insert({ _id: 'p1', title: 'First Post' });

  await assert.doesNotReject(() => database.commit());
  await database.close();
});

void test('close marks database as unusable for further operations', async () => {
  const database = new Database({});

  await database.close();

  await assert.rejects(() => database.commit(), ClosedDatabaseError);
  await assert.rejects(() => database.listCollections(), ClosedDatabaseError);
  await assert.rejects(
    () => database.dropCollection('users'),
    ClosedDatabaseError,
  );
  assert.throws(() => database.collection('users'), ClosedDatabaseError);
  assert.throws(
    () =>
      database.on('error', () => {
        return undefined;
      }),
    ClosedDatabaseError,
  );
});
