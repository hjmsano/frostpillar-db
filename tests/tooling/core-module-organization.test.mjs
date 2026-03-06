import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const resolvePath = (relativePath) => {
  return path.resolve(process.cwd(), relativePath);
};

test('core entry is a thin barrel and split modules exist', async () => {
  const expectedFiles = [
    'src/core/index.ts',
    'src/core/types.ts',
    'src/core/errors/index.ts',
    'src/core/validation/timestamp.ts',
    'src/core/validation/payload.ts',
    'src/core/records/ordering.ts',
    'src/core/datastore/Datastore.ts',
  ];

  await Promise.all(
    expectedFiles.map(async (relativePath) => {
      await access(resolvePath(relativePath));
    }),
  );

  const entrySource = await readFile(resolvePath('src/core/index.ts'), 'utf8');
  assert.doesNotMatch(entrySource, /\bclass\s+Datastore\b/);
  assert.doesNotMatch(entrySource, /TIMESTAMP_ISO_8601_WITH_TIMEZONE_PATTERN/);
  assert.match(entrySource, /export \* from '.\/types\.js';/);
  assert.match(entrySource, /export \* from '.\/errors\/index\.js';/);
  assert.match(entrySource, /export \* from '.\/datastore\/Datastore\.js';/);
});
