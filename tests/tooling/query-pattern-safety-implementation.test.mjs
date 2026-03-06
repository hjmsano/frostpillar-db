import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const resolvePath = (relativePath) => {
  return path.resolve(process.cwd(), relativePath);
};

test('like matcher uses rolling rows instead of full 2D DP table', async () => {
  const source = await readFile(
    resolvePath('src/core/datastore/queryPatternSafety.ts'),
    'utf8',
  );

  assert.doesNotMatch(source, /const dp:\s*boolean\[\]\[\]/);
  assert.doesNotMatch(source, /Array\.from\(\{\s*length:\s*rowCount\s*\}/);
  assert.match(source, /const previousRow:\s*boolean\[\]/);
  assert.match(source, /const currentRow:\s*boolean\[\]/);
});
