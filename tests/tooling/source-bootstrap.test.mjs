import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('bootstrap source entry exists for TypeScript project wiring', async () => {
  const entryPath = path.resolve(process.cwd(), 'src/core/index.ts');
  await access(entryPath);

  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /\bexport\b/);
});
