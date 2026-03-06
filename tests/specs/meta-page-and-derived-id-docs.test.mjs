import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('page structure defines fixed page-0 meta root anchor', async () => {
  const source = await readDoc('docs/specs/03_PageStructure.md');

  assert.match(source, /`0x00` meta, `0x01` leaf, `0x02` branch/);
  assert.match(source, /Page ID` MUST be `0`/);
  assert.match(source, /Page Type` MUST be `0x00` \(meta\)/);
  assert.match(
    source,
    /MUST read page `0` and use its `rootPageId`\s+as the source of truth/,
  );
  assert.match(
    source,
    /Section 6 slot\/free-space invariants apply only to leaf and branch pages/i,
  );
  assert.match(source, /meta page MUST set `Cell Count` to `0`/i);
  assert.match(source, /meta page MUST set `Slot Count` to `0`/i);
  assert.match(source, /meta page MUST set `Free Start` and `Free End` to `32`/i);
});

test('record format defines persisted shape and canonical derived _id rule', async () => {
  const source = await readDoc('docs/specs/01_RecordFormat.md');

  assert.match(
    source,
    /export interface PersistedTimeseriesRecord extends TimeseriesRecord/,
  );
  assert.match(source, /insertionOrder: bigint;/);
  assert.match(
    source,
    /`_id` MUST be deterministically derived from persisted tuple key/,
  );
  assert.match(source, /`"<timestamp>:<insertionOrder>"`/);
  assert.doesNotMatch(
    source,
    /every persisted record MUST have one immutable `id`/,
  );
});

test('binary encoding forbids explicit id field and requires tuple-based derivation', async () => {
  const source = await readDoc('docs/specs/02_BinaryEncoding.md');

  assert.match(source, /MUST NOT include an explicit `RecordId` field/);
  assert.match(
    source,
    /derived after decode from tuple\s*`\(timestamp, insertionOrder\)`/,
  );
  assert.match(source, /`"<timestamp>:<insertionOrder>"`/);
});

test('durability/api specs require sidecar and page-0 meta consistency', async () => {
  const api = await readDoc('docs/specs/04_DatastoreAPI.md');
  const durability = await readDoc('docs/specs/10_FlushAndDurability.md');

  assert.match(api, /must validate that sidecar mirrored fields/i);
  assert.match(api, /match page-0 meta payload/i);
  assert.match(durability, /MUST match page-0 meta payload/);
});
