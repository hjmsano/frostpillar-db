import assert from 'node:assert/strict';
import test from 'node:test';

import { Datastore } from '@frostpillar/frostpillar-storage-engine';

import { ConfigurationError, Database } from '../../src/index.js';

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

void test('on(error) returns an unsubscribe function', () => {
  const database = new Database({});

  const unsubscribe = database.on('error', () => {
    return undefined;
  });

  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
});

void test('on(error) duplicate registration of the same listener is idempotent', async () => {
  // Bug-09: registering the same listener reference twice must not create a
  // duplicate underlying subscription. The second call should be a no-op.
  const { attachments, restore } = installDatastoreOnSpy();
  try {
    const database = new Database({});
    database.collection('col');

    const listener = (): void => undefined;
    const unsub1 = database.on('error', listener);
    const unsub2 = database.on('error', listener); // duplicate — should be no-op

    // Only one underlying Datastore.on() attachment for this listener
    const own = attachments.filter((a) => a.listener === listener);
    assert.equal(
      own.length,
      1,
      'listener must attach to the datastore only once',
    );

    // The second unsubscribe should be a no-op (doesn't affect the real subscription)
    unsub2();
    assert.ok(
      own[0]?.active,
      'real subscription must remain active after no-op unsub',
    );

    // The first unsubscribe detaches the real subscription
    unsub1();
    assert.ok(
      !own[0]?.active,
      'real subscription must be inactive after real unsub',
    );

    await database.close();
  } finally {
    restore();
  }
});

void test('on(error) unsubscribe removes listener from datastores created after registration', async () => {
  // Regression: the closure returned by Database.on() must unsubscribe the
  // listener from every per-collection datastore, including those created
  // AFTER on() was called. Previously it only iterated datastores that
  // existed at registration time, leaking listeners onto later collections.
  const { attachments, restore } = installDatastoreOnSpy();
  try {
    const database = new Database({});
    database.collection('alpha'); // datastore A — exists before on()
    const listener = (): void => undefined;
    const unsubscribe = database.on('error', listener);
    database.collection('bravo'); // datastore B — created AFTER on()

    const own = attachments.filter((a) => a.listener === listener);
    assert.equal(own.length, 2, 'listener must attach to both A and B');
    assert.ok(
      own.every((a) => a.active),
      'both attachments must start active',
    );

    unsubscribe();

    const stillActive = own.filter((a) => a.active);
    assert.equal(stillActive.length, 0, 'unsubscribe must detach from A and B');

    await database.close();
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// payloadLimits validation at construction time
// ---------------------------------------------------------------------------

void test('Database constructor throws ConfigurationError for negative maxDepth', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxDepth: -1 } }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for zero maxDepth', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxDepth: 0 } }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for non-integer maxStringBytes', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxStringBytes: 1.5 } }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for negative maxKeyBytes', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxKeyBytes: -100 } }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for non-integer maxKeysPerObject', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxKeysPerObject: 0.9 } }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for zero maxTotalKeys', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxTotalKeys: 0 } }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for non-integer maxTotalBytes', () => {
  assert.throws(
    () => new Database({ payloadLimits: { maxTotalBytes: 1048576.5 } }),
    ConfigurationError,
  );
});

void test('Database constructor does not throw for valid maxDepth', () => {
  assert.doesNotThrow(() => new Database({ payloadLimits: { maxDepth: 5 } }));
});

void test('Database constructor does not throw for empty payloadLimits', () => {
  assert.doesNotThrow(() => new Database({ payloadLimits: {} }));
});

void test('Database constructor does not throw when payloadLimits is omitted', () => {
  assert.doesNotThrow(() => new Database({}));
});

void test('Database constructor does not throw for all valid payloadLimits fields', () => {
  assert.doesNotThrow(
    () =>
      new Database({
        payloadLimits: {
          maxDepth: 32,
          maxKeyBytes: 512,
          maxStringBytes: 32768,
          maxKeysPerObject: 128,
          maxTotalKeys: 2048,
          maxTotalBytes: 524288,
        },
      }),
  );
});

// ---------------------------------------------------------------------------
// maxErrorListeners — construction-time validation
// ---------------------------------------------------------------------------

void test('Database constructor throws ConfigurationError for negative maxErrorListeners', () => {
  assert.throws(
    () => new Database({ maxErrorListeners: -1 }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for zero maxErrorListeners', () => {
  assert.throws(
    () => new Database({ maxErrorListeners: 0 }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for non-integer maxErrorListeners', () => {
  assert.throws(
    () => new Database({ maxErrorListeners: 1.5 }),
    ConfigurationError,
  );
});

void test('Database constructor throws ConfigurationError for NaN maxErrorListeners', () => {
  assert.throws(
    () => new Database({ maxErrorListeners: NaN }),
    ConfigurationError,
  );
});

void test('Database constructor does not throw for valid maxErrorListeners number', () => {
  assert.doesNotThrow(() => new Database({ maxErrorListeners: 5 }));
});

void test('Database constructor does not throw for maxErrorListeners unlimited', () => {
  assert.doesNotThrow(() => new Database({ maxErrorListeners: 'unlimited' }));
});

// ---------------------------------------------------------------------------
// maxErrorListeners — warn-once-per-crossing behavior
// ---------------------------------------------------------------------------

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

void test('on(error): registering up to the threshold does not warn', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({ maxErrorListeners: 3 });
    for (let i = 0; i < 3; i++) {
      db.on('error', () => undefined);
    }
    assert.equal(spy.calls.length, 0);
  });
});

void test('on(error): registering one past the threshold warns exactly once', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({ maxErrorListeners: 3 });
    for (let i = 0; i < 3; i++) {
      db.on('error', () => undefined);
    }
    assert.equal(spy.calls.length, 0, 'no warn at threshold');
    db.on('error', () => undefined); // 4th — crosses threshold
    assert.equal(spy.calls.length, 1, 'warn fires on first crossing');
    db.on('error', () => undefined); // 5th — still above threshold
    assert.equal(spy.calls.length, 1, 'warn does not fire again');
  });
});

void test('on(error): warn message includes method name and count', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({ maxErrorListeners: 2 });
    db.on('error', () => undefined);
    db.on('error', () => undefined);
    db.on('error', () => undefined); // 3rd — crosses threshold
    assert.equal(spy.calls.length, 1);
    const firstArg = spy.calls[0]?.[0];
    const msg = typeof firstArg === 'string' ? firstArg : '';
    assert.ok(msg.includes('on'), 'message mentions method name');
    assert.ok(msg.includes('3'), 'message includes current count');
    assert.ok(
      msg.includes('maxErrorListeners'),
      'message mentions config option',
    );
  });
});

void test('on(error): unsubscribing below threshold resets warn flag, re-crossing warns again', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({ maxErrorListeners: 2 });
    const unsubs: (() => void)[] = [];
    // Register 3 listeners — crosses threshold, warns once
    for (let i = 0; i < 3; i++) {
      unsubs.push(db.on('error', () => undefined));
    }
    assert.equal(spy.calls.length, 1, 'first crossing warns');

    // Unsubscribe 2 listeners — drops to 1, below threshold → flag resets
    unsubs[0]?.();
    unsubs[1]?.();

    // Register 2 more to cross threshold again
    db.on('error', () => undefined); // count: 2 — at threshold
    db.on('error', () => undefined); // count: 3 — crosses again
    assert.equal(spy.calls.length, 2, 'second crossing warns again');
  });
});

void test('on(error): maxErrorListeners unlimited disables warning', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({ maxErrorListeners: 'unlimited' });
    for (let i = 0; i < 100; i++) {
      db.on('error', () => undefined);
    }
    assert.equal(spy.calls.length, 0, 'no warn with unlimited');
  });
});

void test('on(error): custom threshold respected', () => {
  withConsoleWarnSpy((spy) => {
    const db = new Database({ maxErrorListeners: 5 });
    for (let i = 0; i < 5; i++) {
      db.on('error', () => undefined);
    }
    assert.equal(spy.calls.length, 0, 'no warn at 5 listeners');
    db.on('error', () => undefined); // 6th — crosses threshold
    assert.equal(spy.calls.length, 1, 'warn fires when threshold exceeded');
  });
});
