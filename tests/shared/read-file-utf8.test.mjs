import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from './read-file-utf8.mjs';

test('readFileUtf8 reads project-relative UTF-8 content', async () => {
  const packageJson = await readFileUtf8('package.json');

  assert.match(packageJson, /"name"\s*:\s*"frostpillar"/);
});
