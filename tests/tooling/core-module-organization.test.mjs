import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const resolvePath = (relativePath) => {
  return path.resolve(process.cwd(), relativePath);
};

const countNonEmptyNonCommentLines = (source) => {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/*') &&
        !trimmed.startsWith('*/')
      );
    }).length;
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
    'src/core/datastore/autoCommit.ts',
    'src/core/datastore/capacity.ts',
    'src/core/datastore/config.ts',
    'src/core/datastore/encoding.ts',
    'src/core/datastore/fileBackend.ts',
    'src/core/datastore/fileBackendController.ts',
    'src/core/datastore/fileBackendSnapshot.ts',
    'src/core/datastore/timeIndexBTree.ts',
    'src/core/datastore/timeIndexBTreeTypes.ts',
    'src/core/datastore/timeIndexBTreeNavigation.ts',
    'src/core/datastore/timeIndexBTreeMutations.ts',
    'src/core/datastore/timeIndexBTreeIntegrity.ts',
    'src/core/datastore/query.ts',
    'src/core/datastore/types.ts',
  ];

  await Promise.all(
    expectedFiles.map(async (relativePath) => {
      await access(resolvePath(relativePath));
    }),
  );

  const entrySource = await readFile(resolvePath('src/core/index.ts'), 'utf8');
  assert.doesNotMatch(entrySource, /\bclass\s+Datastore\b/);
  assert.doesNotMatch(entrySource, /TIMESTAMP_ISO_8601_WITH_TIMEZONE_PATTERN/);
  assert.doesNotMatch(entrySource, /export \* from/u);
  assert.match(entrySource, /export \{ Datastore \} from '.\/datastore\/Datastore\.js';/);
  assert.match(
    entrySource,
    /export \{ runQueryWithEngine \} from '\.\.\/queryEngine\/runQueryWithEngine\.js';/,
  );

  const datastoreModules = expectedFiles.filter((filePath) =>
    filePath.startsWith('src/core/datastore/'),
  );
  const lineCountByFile = await Promise.all(
    datastoreModules.map(async (relativePath) => {
      const source = await readFile(resolvePath(relativePath), 'utf8');
      return {
        relativePath,
        lineCount: countNonEmptyNonCommentLines(source),
      };
    }),
  );
  for (const { relativePath, lineCount } of lineCountByFile) {
    assert.ok(
      lineCount <= 300,
      `${relativePath} must be <= 300 non-empty, non-comment lines, got ${lineCount}.`,
    );
  }

  const datastoreSource = await readFile(
    resolvePath('src/core/datastore/Datastore.ts'),
    'utf8',
  );
  assert.doesNotMatch(datastoreSource, /\bcreateFileBackend\b/);
  assert.doesNotMatch(datastoreSource, /\bloadFileSnapshot\b/);
  assert.doesNotMatch(datastoreSource, /\bwriteInitialFileSnapshot\b/);
  assert.doesNotMatch(datastoreSource, /\bcommitFileBackendSnapshot\b/);
  assert.doesNotMatch(datastoreSource, /\breleaseFileLock\b/);
  assert.doesNotMatch(datastoreSource, /\bsetInterval\s*\(/);
  assert.match(datastoreSource, /fileBackendController/i);
});
