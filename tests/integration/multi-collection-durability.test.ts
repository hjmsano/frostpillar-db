/**
 * Two-collection durability tests for every durable driver.
 *
 * Regression tests for the shared-namespace bug: `Database` used to pass the
 * single configured `DatastoreDriver` instance to every per-collection
 * `Datastore`, so all collections targeted the same physical namespace
 * (same file/lock, same snapshot keys). The file driver raised
 * `DatabaseLockedError` on the second collection; browser drivers silently
 * lost data via last-writer-wins snapshots after reopen.
 *
 * The fix (ADR-024) makes `DatabaseConfig.driver` accept a collection-aware
 * factory `(collectionName) => DatastoreDriver`. Each test drives the full
 * create → commit → reopen → drop → reopen cycle with two collections.
 *
 * Browser storage backends (localStorage, IndexedDB, OPFS, sync storage) are
 * not available in Node.js; lightweight in-memory mocks are installed on
 * globalThis for the duration of each test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';
import { indexedDBDriver } from '@frostpillar/frostpillar-storage-engine/drivers/indexedDB';
import { localStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/localStorage';
import { opfsDriver } from '@frostpillar/frostpillar-storage-engine/drivers/opfs';
import { syncStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/syncStorage';

import {
  collectionNamespace,
  ConfigurationError,
  Database,
} from '../../src/index.js';
import type { DatabaseDriverFactory } from '../../src/index.js';

interface UserDoc {
  _id?: string;
  name: string;
}

const globalRecord = globalThis as unknown as Record<string, unknown>;

const makeTmpDir = (): string => {
  const dir = path.join(
    process.cwd(),
    '.tmp-test-multi-collection',
    `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Shared lifecycle: populate two collections, close; reopen and verify both
 * survived; drop one; reopen and verify the drop persisted while the other
 * collection's data is intact.
 */
const runTwoCollectionLifecycle = async (
  driverFactory: DatabaseDriverFactory,
): Promise<void> => {
  {
    const database = new Database({ driver: driverFactory });
    const users = database.collection<UserDoc>('users');
    const posts = database.collection<UserDoc>('posts');
    await users.insert({ name: 'alice' });
    await users.insert({ name: 'bob' });
    await posts.insert({ name: 'hello' });
    await database.commit();
    await database.close();
  }

  {
    const database = new Database({ driver: driverFactory });
    const users = database.collection<UserDoc>('users');
    const posts = database.collection<UserDoc>('posts');
    assert.equal(await users.find({}).count(), 2, 'users must survive reopen');
    assert.equal(await posts.find({}).count(), 1, 'posts must survive reopen');
    const alice = await users.findOne({ name: 'alice' });
    assert.ok(alice, 'document content must survive reopen');
    await database.dropCollection('posts');
    await database.close();
  }

  {
    const database = new Database({ driver: driverFactory });
    const users = database.collection<UserDoc>('users');
    const posts = database.collection<UserDoc>('posts');
    assert.equal(
      await users.find({}).count(),
      2,
      'dropping one collection must not affect another',
    );
    assert.equal(
      await posts.find({}).count(),
      0,
      'dropCollection must persist across reopen',
    );
    await database.close();
  }
};

// ---------------------------------------------------------------------------
// file driver (Node.js)
// ---------------------------------------------------------------------------

void test('fileDriver: two collections commit, reopen, and drop independently', async () => {
  const tmpDir = makeTmpDir();
  try {
    await runTwoCollectionLifecycle((name) =>
      fileDriver({
        target: {
          kind: 'directory',
          directory: tmpDir,
          fileName: collectionNamespace(name),
        },
      }),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Adversarial name pair for the file backend. Data files are named
 * `<fileName>.fpdb.g.<generation>`, and opening a datastore deletes every file
 * beginning with `<fileName>.fpdb.g.` other than its own active generation. Both
 * names below are valid collection names, so with a raw-name factory the base
 * name of `foo` (`foo.fpdb`) yields the deletion prefix `foo.fpdb.g.`, which
 * swallows `foo.fpdb.g.0`'s data file (`foo.fpdb.g.0.fpdb.g.0`): reopening `foo`
 * destroyed the other collection, which then came back empty.
 *
 * `collectionNamespace()` escapes the dots, so neither fragment is a delimited
 * prefix of the other and both collections survive.
 */
void test('fileDriver: collectionNamespace isolates names that collide with generation files', async () => {
  const tmpDir = makeTmpDir();
  const factory: DatabaseDriverFactory = (name) =>
    fileDriver({
      target: {
        kind: 'directory',
        directory: tmpDir,
        fileName: collectionNamespace(name),
      },
    });
  const victim = 'foo.fpdb.g.0';

  try {
    {
      const database = new Database({ driver: factory });
      const foo = database.collection<UserDoc>('foo');
      const shadow = database.collection<UserDoc>(victim);
      await foo.insert({ name: 'alice' });
      await shadow.insert({ name: 'bob' });
      await database.commit();
      await database.close();
    }

    {
      // Open `foo` first: its generation-file cleanup runs here, and must not
      // touch the other collection's files.
      const database = new Database({ driver: factory });
      const foo = database.collection<UserDoc>('foo');
      assert.equal(await foo.find({}).count(), 1);
      const shadow = database.collection<UserDoc>(victim);
      assert.equal(
        await shadow.find({}).count(),
        1,
        'opening "foo" must not delete the other collection\'s snapshot',
      );
      assert.ok(await shadow.findOne({ name: 'bob' }));
      await database.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('fileDriver: plain shared driver instance is rejected on the second collection', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });
  try {
    database.collection<UserDoc>('users');
    assert.throws(
      () => database.collection<UserDoc>('posts'),
      ConfigurationError,
    );
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// localStorage driver (in-memory Storage mock)
// ---------------------------------------------------------------------------

interface LocalStorageMock {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const createLocalStorageMock = (): LocalStorageMock => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
  };
};

void test('localStorageDriver: two collections commit, reopen, and drop independently', async () => {
  globalRecord.localStorage = createLocalStorageMock();
  try {
    await runTwoCollectionLifecycle((name) =>
      localStorageDriver({
        keyPrefix: 'fp-test',
        databaseKey: collectionNamespace(name),
      }),
    );
  } finally {
    delete globalRecord.localStorage;
  }
});

// ---------------------------------------------------------------------------
// syncStorage driver (in-memory browser.storage.sync mock)
// ---------------------------------------------------------------------------

const createSyncStorageMock = (): Record<string, unknown> => {
  const store = new Map<string, unknown>();
  const toKeyList = (keys: string | string[]): string[] =>
    Array.isArray(keys) ? keys : [keys];
  return {
    storage: {
      sync: {
        get: (keys: string | string[]): Promise<Record<string, unknown>> => {
          const found: Record<string, unknown> = {};
          for (const key of toKeyList(keys)) {
            if (store.has(key)) {
              found[key] = store.get(key);
            }
          }
          return Promise.resolve(found);
        },
        set: (items: Record<string, unknown>): Promise<void> => {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value);
          }
          return Promise.resolve();
        },
        remove: (keys: string | string[]): Promise<void> => {
          for (const key of toKeyList(keys)) {
            store.delete(key);
          }
          return Promise.resolve();
        },
      },
    },
  };
};

void test('syncStorageDriver: two collections commit, reopen, and drop independently', async () => {
  globalRecord.browser = createSyncStorageMock();
  try {
    await runTwoCollectionLifecycle((name) =>
      syncStorageDriver({
        keyPrefix: 'fp-test',
        databaseKey: collectionNamespace(name),
      }),
    );
  } finally {
    delete globalRecord.browser;
  }
});

// ---------------------------------------------------------------------------
// IndexedDB driver (in-memory IDBFactory mock)
// ---------------------------------------------------------------------------

interface IdbRequestMock {
  result: unknown;
  error: null;
  onsuccess: ((event: { target: IdbRequestMock }) => void) | null;
  onerror: ((event: { target: IdbRequestMock }) => void) | null;
  onupgradeneeded?:
    | ((event: {
        target: IdbRequestMock;
        oldVersion: number;
        newVersion: number;
      }) => void)
    | null;
}

type IdbStoreData = Map<string, unknown>;

const createIdbRequest = (result: unknown): IdbRequestMock => {
  const request: IdbRequestMock = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => {
    request.onsuccess?.({ target: request });
  });
  return request;
};

const createIdbObjectStore = (data: IdbStoreData): Record<string, unknown> => ({
  get: (key: string): IdbRequestMock => createIdbRequest(data.get(key)),
  put: (value: unknown, key: string): IdbRequestMock => {
    data.set(key, value);
    return createIdbRequest(key);
  },
  clear: (): IdbRequestMock => {
    data.clear();
    return createIdbRequest(undefined);
  },
  getAll: (): IdbRequestMock => createIdbRequest(Array.from(data.values())),
});

const createIdbDatabase = (
  stores: Map<string, IdbStoreData>,
): Record<string, unknown> => ({
  objectStoreNames: {
    contains: (name: string): boolean => stores.has(name),
  },
  createObjectStore: (name: string): Record<string, unknown> => {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }
    return createIdbObjectStore(stores.get(name)!);
  },
  transaction: (
    _storeNames: string[],
    _mode: string,
  ): Record<string, unknown> => {
    let oncompleteHandler: (() => void) | null = null;
    const tx: Record<string, unknown> = {
      onerror: null,
      objectStore: (name: string): Record<string, unknown> =>
        createIdbObjectStore(stores.get(name)!),
    };
    Object.defineProperty(tx, 'oncomplete', {
      get: (): (() => void) | null => oncompleteHandler,
      set: (handler: (() => void) | null): void => {
        oncompleteHandler = handler;
        // The backend assigns oncomplete before awaiting; store mutations in
        // this mock are synchronous, so completing on the next microtask is
        // always ordered after them.
        queueMicrotask(() => {
          oncompleteHandler?.();
        });
      },
    });
    return tx;
  },
  close: (): void => undefined,
});

const createIdbFactoryMock = (): Record<string, unknown> => {
  // databaseName → storeName → key → value; persists across open() calls so
  // a reopened Database reads what the previous session committed.
  const databases = new Map<string, Map<string, IdbStoreData>>();
  return {
    open: (databaseName: string, version: number): IdbRequestMock => {
      if (!databases.has(databaseName)) {
        databases.set(databaseName, new Map());
      }
      const stores = databases.get(databaseName)!;
      const request: IdbRequestMock = {
        result: createIdbDatabase(stores),
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.({
          target: request,
          oldVersion: 0,
          newVersion: version,
        });
        queueMicrotask(() => {
          request.onsuccess?.({ target: request });
        });
      });
      return request;
    },
  };
};

void test('indexedDBDriver: two collections commit, reopen, and drop independently', async () => {
  globalRecord.indexedDB = createIdbFactoryMock();
  try {
    await runTwoCollectionLifecycle((name) =>
      indexedDBDriver({
        databaseName: `fp-test-${collectionNamespace(name)}`,
      }),
    );
  } finally {
    delete globalRecord.indexedDB;
  }
});

/**
 * Pins the constraint spec 01 §1.7 states: for IndexedDB the namespace is the
 * *database*, not the database/object-store pair. The storage engine keeps a
 * datastore's snapshot at a fixed location (`_meta` store, key `config`) and
 * ignores `objectStoreName` on both load and commit, so a factory that varies
 * only the object store leaves every collection sharing one snapshot slot and
 * the last commit wins.
 *
 * The assertion below therefore encodes *broken* isolation deliberately. If it
 * ever fails, the storage engine has gained per-object-store snapshots: relax
 * the "distinct databaseName" requirement in spec 01 §1.7, ADR-024, and both
 * READMEs, and turn this into a normal isolation test.
 */
void test('indexedDBDriver: a shared databaseName does not isolate collections, however the object store varies', async () => {
  globalRecord.indexedDB = createIdbFactoryMock();
  try {
    const factory: DatabaseDriverFactory = (name) =>
      indexedDBDriver({
        databaseName: 'fp-test-shared',
        objectStoreName: `records-${collectionNamespace(name)}`,
      });

    {
      const database = new Database({ driver: factory });
      const users = database.collection<UserDoc>('users');
      const posts = database.collection<UserDoc>('posts');
      await users.insert({ name: 'alice' });
      await users.insert({ name: 'bob' });
      await posts.insert({ name: 'hello' });
      await database.commit();
      await database.close();
    }

    {
      const database = new Database({ driver: factory });
      const users = database.collection<UserDoc>('users');
      // Both collections read the same per-database snapshot, so `users` comes
      // back holding whichever collection committed last — not its own data.
      const survived = await users.find({}).count();
      assert.equal(
        survived,
        1,
        'object-store names do not namespace the snapshot: the last commit wins',
      );
      assert.ok(
        await users.findOne({ name: 'hello' }),
        "users must have been overwritten by posts' snapshot",
      );
      await database.close();
    }
  } finally {
    delete globalRecord.indexedDB;
  }
});

// ---------------------------------------------------------------------------
// OPFS driver (in-memory navigator.storage mock)
// ---------------------------------------------------------------------------

const createNotFoundError = (): Error => {
  const error = new Error('The requested file could not be found.');
  error.name = 'NotFoundError';
  return error;
};

const createOpfsDirectoryMock = (
  files: Map<string, string>,
): Record<string, unknown> => ({
  getFileHandle: (
    name: string,
    options?: { create?: boolean },
  ): Promise<Record<string, unknown>> => {
    if (!files.has(name)) {
      if (options?.create !== true) {
        return Promise.reject(createNotFoundError());
      }
      files.set(name, '');
    }
    return Promise.resolve({
      getFile: (): Promise<Record<string, unknown>> =>
        Promise.resolve({
          text: (): Promise<string> => Promise.resolve(files.get(name) ?? ''),
        }),
      createWritable: (): Promise<Record<string, unknown>> =>
        Promise.resolve({
          write: (data: string): Promise<void> => {
            files.set(name, String(data));
            return Promise.resolve();
          },
          close: (): Promise<void> => Promise.resolve(),
        }),
    });
  },
  removeEntry: (name: string): Promise<void> => {
    files.delete(name);
    return Promise.resolve();
  },
});

const installOpfsMock = (): (() => void) => {
  // directoryName → fileName → content; namespace-aware so each collection's
  // driver gets an isolated directory that persists across sessions.
  const directories = new Map<string, Map<string, string>>();
  const storage = {
    getDirectory: (): Promise<Record<string, unknown>> =>
      Promise.resolve({
        getDirectoryHandle: (
          directoryName: string,
          _options?: { create?: boolean },
        ): Promise<Record<string, unknown>> => {
          if (!directories.has(directoryName)) {
            directories.set(directoryName, new Map());
          }
          return Promise.resolve(
            createOpfsDirectoryMock(directories.get(directoryName)!),
          );
        },
      }),
  };
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage },
    configurable: true,
  });
  return (): void => {
    if (originalDescriptor === undefined) {
      delete globalRecord.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  };
};

void test('opfsDriver: two collections commit, reopen, and drop independently', async () => {
  const restoreNavigator = installOpfsMock();
  try {
    await runTwoCollectionLifecycle((name) =>
      opfsDriver({ directoryName: `fp-${collectionNamespace(name)}` }),
    );
  } finally {
    restoreNavigator();
  }
});
