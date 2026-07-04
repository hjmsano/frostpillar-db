import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';

import { ConfigurationError, Database } from '../../src/index.js';

interface ItemDoc {
  _id?: string;
  data: string;
}

const makeTmpDir = (): string => {
  const dir = path.join(
    process.cwd(),
    '.tmp-test-autocommit',
    `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

void test('collection with autoCommit frequency passes config to datastore', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });
  const items = database.collection<ItemDoc>('items', {
    autoCommit: { frequency: 'immediate' },
  });

  try {
    await items.insert({ data: 'test' });
    const doc = await items.findOne({});
    assert.ok(doc);
    assert.equal(doc.data, 'test');
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('collection with autoCommit maxPendingBytes passes config to datastore', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });
  const items = database.collection<ItemDoc>('items', {
    autoCommit: { frequency: '5s', maxPendingBytes: 1024 },
  });

  try {
    await items.insert({ data: 'test' });
    const doc = await items.findOne({});
    assert.ok(doc);
    assert.equal(doc.data, 'test');
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('per-collection autoCommit overrides database-level autoCommit', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
    autoCommit: { frequency: '10s' },
  });

  // This collection has its own autoCommit config
  const items = database.collection<ItemDoc>('items', {
    autoCommit: { frequency: 'immediate' },
  });

  try {
    await items.insert({ data: 'test' });
    const doc = await items.findOne({});
    assert.ok(doc);
    assert.equal(doc.data, 'test');
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('collection without autoCommit inherits database-level autoCommit', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
    autoCommit: { frequency: 'immediate' },
  });

  // No per-collection autoCommit — should inherit database-level
  const items = database.collection<ItemDoc>('items');

  try {
    await items.insert({ data: 'test' });
    const doc = await items.findOne({});
    assert.ok(doc);
    assert.equal(doc.data, 'test');
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('collection rejects conflicting autoCommit options on re-access', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });

  try {
    database.collection('items', {
      autoCommit: { frequency: 'immediate' },
    });

    assert.throws(
      () =>
        database.collection('items', {
          autoCommit: { frequency: '5s' },
        }),
      ConfigurationError,
    );
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('collection rejects conflicting autoCommit maxPendingBytes on re-access', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });

  try {
    database.collection('items', {
      autoCommit: { frequency: 'immediate', maxPendingBytes: 1024 },
    });

    assert.throws(
      () =>
        database.collection('items', {
          autoCommit: { frequency: 'immediate', maxPendingBytes: 2048 },
        }),
      ConfigurationError,
    );
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('collection allows re-access with same autoCommit options', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });

  try {
    const first = database.collection('items', {
      autoCommit: { frequency: 'immediate', maxPendingBytes: 1024 },
    });

    const second = database.collection('items', {
      autoCommit: { frequency: 'immediate', maxPendingBytes: 1024 },
    });

    assert.equal(second, first);
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('bare re-access after autoCommit config throws ConfigurationError', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });

  try {
    database.collection('items', {
      autoCommit: { frequency: '5s' },
    });

    assert.throws(() => database.collection('items'), ConfigurationError);
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('collection detects conflict between undefined and defined autoCommit', async () => {
  const tmpDir = makeTmpDir();
  const database = new Database({
    driver: fileDriver({ target: { kind: 'directory', directory: tmpDir } }),
  });

  try {
    database.collection('items', {
      autoCommit: { frequency: 'immediate' },
    });

    // Passing different autoCommit (undefined frequency vs defined) should conflict
    assert.throws(
      () =>
        database.collection('items', {
          autoCommit: { maxPendingBytes: 512 },
        }),
      ConfigurationError,
    );
  } finally {
    await database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
