import assert from 'node:assert/strict';
import { mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadCoreModule } from './load-core-module.mjs';

const loadCore = async () => await loadCoreModule();

const createSandboxDirectory = async (name) => {
  const baseDir = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(baseDir, `${name}-${uniqueSuffix}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

const buildNestedNotExpression = (depth) => {
  let expression = {
    field: 'event',
    operator: '=',
    value: 'ok',
  };

  for (let index = 0; index < depth; index += 1) {
    expression = { not: expression };
  }

  return expression;
};

test('queryNative like/regexp enforce pattern safety guardrails', async () => {
  const { Datastore, QueryValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: {
      code: 'sensor-42',
      message: 'error.alpha',
    },
  });

  const likeRows = await datastore.queryNative({
    where: {
      field: 'message',
      operator: 'like',
      value: 'error.%',
    },
  });
  assert.equal(likeRows.length, 1);
  assert.equal(likeRows[0].message, 'error.alpha');

  const regexpRows = await datastore.queryNative({
    where: {
      field: 'code',
      operator: 'regexp',
      value: '^sensor-[0-9]+$',
    },
  });
  assert.equal(regexpRows.length, 1);
  assert.equal(regexpRows[0].code, 'sensor-42');

  await assert.rejects(
    async () => {
      await datastore.queryNative({
        where: {
          field: 'code',
          operator: 'regexp',
          value: '(a+)+$',
        },
      });
    },
    QueryValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.queryNative({
        where: {
          field: 'code',
          operator: 'regexp',
          value: 'a(?=b)',
        },
      });
    },
    QueryValidationError,
  );

  await assert.rejects(
    async () => {
      await datastore.queryNative({
        where: {
          field: 'message',
          operator: 'like',
          value: 'a'.repeat(257),
        },
      });
    },
    QueryValidationError,
  );
});

test('queryNative regexp compiles pattern once per query execution', async () => {
  const { Datastore } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  await datastore.insert({
    timestamp: 1735689600000,
    payload: { code: 'sensor-41' },
  });
  await datastore.insert({
    timestamp: 1735689600001,
    payload: { code: 'sensor-42' },
  });
  await datastore.insert({
    timestamp: 1735689600002,
    payload: { code: 'sensor-43' },
  });

  const OriginalRegExp = globalThis.RegExp;
  let compileCount = 0;
  globalThis.RegExp = class RegExpSpy extends OriginalRegExp {
    constructor(pattern, flags) {
      compileCount += 1;
      super(pattern, flags);
    }
  };

  try {
    const rows = await datastore.queryNative({
      where: {
        field: 'code',
        operator: 'regexp',
        value: '^sensor-[0-9]+$',
      },
    });
    assert.equal(rows.length, 3);
  } finally {
    globalThis.RegExp = OriginalRegExp;
  }

  assert.equal(compileCount, 1);
});

test('file datastore rejects path traversal and path escape outside cwd', async () => {
  const { ConfigurationError, Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('security-hardening-paths');
  const safeFilePath = path.join(sandbox, 'safe.fpdb');
  const escapedTargetPath = path.resolve('/tmp', 'frostpillar-security-escape.fpdb');
  const nestedDirectory = path.join(sandbox, 'nested');

  try {
    const safe = new Datastore({ location: 'file', filePath: safeFilePath });
    await safe.close();

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          target: {
            kind: 'directory',
            directory: nestedDirectory,
            fileName: '../escape',
          },
        });
      },
      ConfigurationError,
    );

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          target: {
            kind: 'directory',
            directory: nestedDirectory,
            filePrefix: '..\\',
            fileName: 'events',
          },
        });
      },
      ConfigurationError,
    );

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          filePath: escapedTargetPath,
        });
      },
      ConfigurationError,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('file datastore rejects symlinked directory escapes outside cwd', async () => {
  const { ConfigurationError, Datastore } = await loadCore();
  const sandbox = await createSandboxDirectory('security-hardening-symlink');
  const outsideDirectory = path.resolve(
    '/tmp',
    `frostpillar-security-outside-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const symlinkPath = path.join(sandbox, 'linked-outside');

  try {
    await mkdir(outsideDirectory, { recursive: true });
    await symlink(outsideDirectory, symlinkPath, 'dir');

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          target: {
            kind: 'directory',
            directory: symlinkPath,
            fileName: 'events',
          },
        });
      },
      ConfigurationError,
    );

    assert.throws(
      () => {
        new Datastore({
          location: 'file',
          filePath: path.join(symlinkPath, 'escape.fpdb'),
        });
      },
      ConfigurationError,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test('payload validation enforces aggregate key-count and byte-budget guardrails', async () => {
  const { Datastore, ValidationError } = await loadCore();
  const datastore = new Datastore({ location: 'memory' });

  const tooWideObject = {};
  for (let index = 0; index < 257; index += 1) {
    tooWideObject[`k${index}`] = index;
  }

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600100,
        payload: { wide: tooWideObject },
      });
    },
    ValidationError,
  );

  const tooManyKeysPayload = {};
  for (let outer = 0; outer < 256; outer += 1) {
    const child = {};
    for (let inner = 0; inner < 16; inner += 1) {
      child[`c${inner}`] = inner;
    }
    tooManyKeysPayload[`n${outer}`] = child;
  }

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600200,
        payload: tooManyKeysPayload,
      });
    },
    ValidationError,
  );

  const tooLargePayload = {};
  for (let index = 0; index < 256; index += 1) {
    tooLargePayload[`s${index}`] = 'a'.repeat(5000);
  }

  await assert.rejects(
    async () => {
      await datastore.insert({
        timestamp: 1735689600300,
        payload: tooLargePayload,
      });
    },
    ValidationError,
  );
});

test('queryNative enforces expression depth and row-budget guardrails', async () => {
  const { Datastore, QueryValidationError } = await loadCore();

  const depthDatastore = new Datastore({ location: 'memory' });
  await depthDatastore.insert({
    timestamp: 1735689600400,
    payload: { event: 'ok' },
  });

  await assert.rejects(
    async () => {
      await depthDatastore.queryNative({
        where: buildNestedNotExpression(65),
      });
    },
    QueryValidationError,
  );

  await depthDatastore.close();

  const outputDatastore = new Datastore({ location: 'memory' });
  for (let index = 0; index < 5001; index += 1) {
    await outputDatastore.insert({
      timestamp: 1735689700000 + index,
      payload: { event: 'out', value: index },
    });
  }

  await assert.rejects(
    async () => {
      await outputDatastore.queryNative({});
    },
    QueryValidationError,
  );

  await outputDatastore.close();

  const scannedDatastore = new Datastore({ location: 'memory' });
  for (let index = 0; index < 10001; index += 1) {
    await scannedDatastore.insert({
      timestamp: 1735689800000 + index,
      payload: { event: 'scan', value: index },
    });
  }

  await assert.rejects(
    async () => {
      await scannedDatastore.queryNative({ limit: 1 });
    },
    QueryValidationError,
  );

  await scannedDatastore.close();
});
