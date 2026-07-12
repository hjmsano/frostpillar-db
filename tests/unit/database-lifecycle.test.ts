import assert from 'node:assert/strict';
import test from 'node:test';

import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import type { DatastoreDriver } from '@frostpillar/frostpillar-storage-engine';

import { ClosedDatabaseError, Database } from '../../src/index.js';

interface UserDoc {
  _id?: string;
  name: string;
}

interface DatastoreOnAttachment {
  listener: (...args: unknown[]) => void;
  active: boolean;
}

const installDatastoreOnSpy = (): {
  attachments: DatastoreOnAttachment[];
  restore: () => void;
} => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalOn = Datastore.prototype.on;
  const attachments: DatastoreOnAttachment[] = [];
  const spy = function (
    this: Datastore,
    event: 'error',
    listener: (...args: unknown[]) => void,
  ): () => void {
    const realUnsub = originalOn.call(
      this,
      event,
      listener as Parameters<typeof originalOn>[1],
    );
    const entry: DatastoreOnAttachment = { listener, active: true };
    attachments.push(entry);
    return (): void => {
      entry.active = false;
      realUnsub();
    };
  } as typeof Datastore.prototype.on;
  Datastore.prototype.on = spy;
  return {
    attachments,
    restore: (): void => {
      Datastore.prototype.on = originalOn;
    },
  };
};

const withConsoleWarnSpy = (
  fn: (spy: { calls: unknown[][] }) => void,
): void => {
  const spy = { calls: [] as unknown[][] };
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    spy.calls.push(args);
  };
  try {
    fn(spy);
  } finally {
    console.warn = original;
  }
};

// ---------------------------------------------------------------------------
// dropCollection — cleanup on clear() failure (bug-14)
// ---------------------------------------------------------------------------

void test('dropCollection cleans up registries even when clear() rejects', async () => {
  const { attachments, restore } = installDatastoreOnSpy();
  try {
    const database = new Database({});
    const listener = (): void => undefined;
    database.on('error', listener);
    database.collection('target');

    // Verify listener was attached
    const own = attachments.filter((a) => a.listener === listener);
    assert.equal(own.length, 1, 'listener attached to target datastore');
    assert.ok(own[0]?.active, 'listener starts active');

    // Patch datastore.clear() to reject
    const internals = database as unknown as {
      datastores: Map<string, Datastore>;
    };
    const datastore = internals.datastores.get('target')!;
    const originalClear = datastore.clear.bind(datastore);
    datastore.clear = async (): Promise<void> => {
      await originalClear();
      throw new Error('simulated clear failure');
    };

    // dropCollection should propagate the error…
    await assert.rejects(() => database.dropCollection('target'), {
      message: 'simulated clear failure',
    });

    // …but cleanup must still have happened:
    // 1. Error listener unsubscribed
    assert.ok(
      !own[0]?.active,
      'error listener must be unsubscribed after failed drop',
    );

    // 2. Collection re-creatable with different options (registries cleared)
    assert.doesNotThrow(() =>
      database.collection('target', { duplicateKeys: 'allow' }),
    );

    await database.close();
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// close() — resource cleanup (bug-11)
// ---------------------------------------------------------------------------

void test('close invokes all stored error unsubscribers', async () => {
  const { attachments, restore } = installDatastoreOnSpy();
  try {
    const database = new Database({});
    database.collection('alpha');
    database.collection('bravo');

    const listenerA = (): void => undefined;
    const listenerB = (): void => undefined;
    database.on('error', listenerA);
    database.on('error', listenerB);

    // 2 listeners × 2 datastores = 4 attachments, all active
    assert.equal(attachments.length, 4);
    assert.ok(
      attachments.every((a) => a.active),
      'all start active',
    );

    await database.close();

    // Every attachment must have been unsubscribed
    assert.ok(
      attachments.every((a) => !a.active),
      'all attachments must be inactive after close()',
    );
  } finally {
    restore();
  }
});

void test('close releases listener registered before and after collection creation', async () => {
  const { attachments, restore } = installDatastoreOnSpy();
  try {
    const database = new Database({});
    const listener = (): void => undefined;

    // listener registered before any collection
    database.on('error', listener);
    database.collection('col');

    const own = attachments.filter((a) => a.listener === listener);
    assert.equal(own.length, 1, 'listener attached to col');

    await database.close();

    assert.ok(!own[0]?.active, 'attachment detached after close()');
  } finally {
    restore();
  }
});

void test('on(error): default threshold is 32', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({});
    for (let i = 0; i < 32; i++) {
      db.on('error', () => undefined);
    }
    assert.equal(spy.calls.length, 0, 'no warn at default threshold of 32');
    db.on('error', () => undefined); // 33rd — crosses default threshold
    assert.equal(
      spy.calls.length,
      1,
      'warn fires when default threshold exceeded',
    );
  });
});

// ---------------------------------------------------------------------------
// stale collection after dropCollection
// ---------------------------------------------------------------------------

void test('stale collection after dropCollection: throws ClosedDatabaseError on insert', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await users.insert({ name: 'Alice' });
  await database.dropCollection('users');
  await assert.rejects(
    () => users.insert({ name: 'Bob' }),
    ClosedDatabaseError,
  );
});

void test('stale collection after dropCollection: throws ClosedDatabaseError on find', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await database.dropCollection('users');
  assert.throws(() => users.find(), ClosedDatabaseError);
});

void test('stale collection after dropCollection: throws ClosedDatabaseError on update', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await database.dropCollection('users');
  await assert.rejects(
    () => users.update({}, { $set: { name: 'X' } }),
    ClosedDatabaseError,
  );
});

void test('stale collection after dropCollection: throws ClosedDatabaseError on remove', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await database.dropCollection('users');
  await assert.rejects(() => users.remove({}), ClosedDatabaseError);
});

void test('stale collection after dropCollection: throws ClosedDatabaseError on count', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await database.dropCollection('users');
  await assert.rejects(() => users.count(), ClosedDatabaseError);
});

void test('stale collection after dropCollection: throws ClosedDatabaseError on watch', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await database.dropCollection('users');
  assert.throws(() => users.watch(() => undefined), ClosedDatabaseError);
});

void test('closed database: collection.watch throws ClosedDatabaseError', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await database.close();
  assert.throws(() => users.watch(() => undefined), ClosedDatabaseError);
});

void test('stale collection after dropCollection: re-acquired collection works', async () => {
  const database = new Database({});
  const users = database.collection<UserDoc>('users');
  await users.insert({ name: 'Alice' });
  await database.dropCollection('users');
  const freshUsers = database.collection<UserDoc>('users');
  const id = await freshUsers.insert({ name: 'Bob' });
  assert.equal(typeof id, 'string');
  await database.close();
});

// ---------------------------------------------------------------------------
// close() is best-effort across datastores
// ---------------------------------------------------------------------------

const createClosingDriver = (
  closed: string[],
  name: string,
  failOnClose: boolean,
): DatastoreDriver => ({
  init: () => ({
    controller: {
      handleRecordAppended: (): Promise<void> => Promise.resolve(),
      handleCleared: (): Promise<void> => Promise.resolve(),
      commitNow: (): Promise<void> => Promise.resolve(),
      close: (): Promise<void> => {
        closed.push(name);
        return failOnClose
          ? Promise.reject(new Error(`close failed: ${name}`))
          : Promise.resolve();
      },
    },
    initialTreeJSON: null,
    initialCurrentSizeBytes: 0,
  }),
});

void test('close() closes every datastore even when one fails, then rethrows', async () => {
  const closed: string[] = [];
  const database = new Database({
    driver: (name: string) => createClosingDriver(closed, name, name === 'b'),
  });
  database.collection<UserDoc>('a');
  database.collection<UserDoc>('b');
  database.collection<UserDoc>('c');

  await assert.rejects(
    () => database.close(),
    (error: unknown) =>
      error instanceof Error && error.message === 'close failed: b',
  );

  // 'c' must still have been closed: the database is already marked closed, so
  // a skipped datastore would be both unreachable and holding its resources.
  assert.deepEqual(closed, ['a', 'b', 'c']);
});

void test('close() aggregates multiple datastore failures', async () => {
  const closed: string[] = [];
  const database = new Database({
    driver: (name: string) => createClosingDriver(closed, name, name !== 'b'),
  });
  database.collection<UserDoc>('a');
  database.collection<UserDoc>('b');
  database.collection<UserDoc>('c');

  await assert.rejects(
    () => database.close(),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.length === 2 &&
      (error.errors[0] as Error).message === 'close failed: a' &&
      (error.errors[1] as Error).message === 'close failed: c',
  );
  assert.deepEqual(closed, ['a', 'b', 'c']);
});

void test('close() clears internal state even when a datastore fails', async () => {
  const closed: string[] = [];
  const database = new Database({
    driver: (name: string) => createClosingDriver(closed, name, true),
  });
  database.collection<UserDoc>('a');

  await assert.rejects(() => database.close());
  // A second close() must report the database as already closed, not retry.
  await assert.rejects(() => database.close(), ClosedDatabaseError);
  assert.deepEqual(closed, ['a']);
});
