import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('record format defines persisted insertionOrder as internal bigint key', async () => {
  const source = await readDoc('docs/specs/01_RecordFormat.md');

  assert.match(
    source,
    /export interface PersistedTimeseriesRecord extends TimeseriesRecord/,
  );
  assert.match(source, /insertionOrder: bigint;/);
  assert.match(
    source,
    /Every persisted record MUST include immutable `insertionOrder`\./,
  );
});

test('binary encoding defines INSERTION_ORDER_U64 and top-level mandatory order', async () => {
  const source = await readDoc('docs/specs/02_BinaryEncoding.md');

  assert.match(source, /`0x03`\s+\|\s+`INSERTION_ORDER_U64`/);
  assert.match(source, /1\. `TIMESTAMP_I64` TLV/);
  assert.match(source, /2\. `INSERTION_ORDER_U64` TLV/);
  assert.match(source, /3\. `PAYLOAD_OBJECT` TLV/);
});

test('page and btree specs require leaf-level persistence of tuple key', async () => {
  const pageStructure = await readDoc('docs/specs/03_PageStructure.md');
  const btree = await readDoc('docs/specs/11_BTreeIndexInvariants.md');

  assert.match(
    pageStructure,
    /each record cell MUST persist full logical key material:\s*`TIMESTAMP_I64` and `INSERTION_ORDER_U64`/,
  );
  assert.match(
    btree,
    /Every leaf record MUST persist both tuple components in encoded bytes/,
  );
});
