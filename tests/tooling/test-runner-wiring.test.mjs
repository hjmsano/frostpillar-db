import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const readJson = async (filePath) => {
  const source = await readFile(filePath, 'utf8');
  return JSON.parse(source);
};

test('package test script is wired to node test runner wrapper', async () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts.test, 'node ./scripts/run-tests.mjs');
  assert.doesNotMatch(scripts.test, /Dummy test runner/i);
});

test('test runner wrapper normalizes --run and keeps node --test arguments', async () => {
  const { normalizeNodeTestArgs } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'scripts/run-tests.mjs')).href
  );

  assert.deepEqual(normalizeNodeTestArgs([]), ['tests/**/*.test.mjs']);
  assert.deepEqual(
    normalizeNodeTestArgs(['--run', 'tests/specs/query-engine-dx-and-canonical-path-docs.test.mjs']),
    ['tests/specs/query-engine-dx-and-canonical-path-docs.test.mjs'],
  );
  assert.deepEqual(normalizeNodeTestArgs(['--test-name-pattern', 'query']), [
    '--test-name-pattern',
    'query',
  ]);
});
