import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('datastore sidecar schema persists nextInsertionOrder for O(1) restart recovery', async () => {
  const source = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(source, /"nextInsertionOrder": "0"/);
  assert.match(
    source,
    /`nextInsertionOrder`: next allocatable insertion-order value for new inserts/,
  );
  assert.match(
    source,
    /MUST initialize insertion-order allocator from `nextInsertionOrder` in O\(1\) without full data scan/i,
  );
  assert.match(
    source,
    /MUST NOT derive allocator state from rightmost\/last B\+ tree key/i,
  );
});

test('durability protocol includes nextInsertionOrder in sidecar activation payload', async () => {
  const source = await readDoc('docs/specs/10_FlushAndDurability.md');

  assert.match(source, /`nextInsertionOrder` serialized as unsigned decimal string/);
  assert.match(source, /"nextInsertionOrder": "0"/);
  assert.match(
    source,
    /the value that MUST be used as the next insertion-order allocator state after reopen/i,
  );
});

