import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('binary encoding defines non-fragmented single-record TLV bytes', async () => {
  const source = await readDoc('docs/specs/02_BinaryEncoding.md');

  assert.match(
    source,
    /MUST be represented as one contiguous TLV byte sequence/,
  );
  assert.match(source, /MUST NOT use continuation chunks in v0\.2/);
});

test('record and binary specs bind max record size to configured page payload capacity', async () => {
  const recordFormat = await readDoc('docs/specs/01_RecordFormat.md');
  const binaryEncoding = await readDoc('docs/specs/02_BinaryEncoding.md');

  assert.match(
    recordFormat,
    /storage engine MUST reject[\s\S]*encoded byte length exceeds `maxSingleRecordBytes`/i,
  );
  assert.match(
    recordFormat,
    /`maxSingleRecordBytes = pageSize - 32 - 4`/i,
  );
  assert.match(
    binaryEncoding,
    /Encoder MUST fail if total encoded record bytes exceed target page payload capacity/i,
  );
  assert.match(
    binaryEncoding,
    /target page payload capacity is[\s\S]*`maxSingleRecordBytes = pageSize - 32 - 4`/i,
  );
});

test('page structure defines single-page fit rule for one record cell', async () => {
  const source = await readDoc('docs/specs/03_PageStructure.md');

  assert.match(source, /Single record bytes MUST NOT span multiple pages/);
  assert.match(source, /maxSingleRecordBytes = pageSize - 32 - 4/);
  assert.match(source, /Overflow\/continuation pages are out of scope in v0\.2/);
});

test('datastore and capacity specs require explicit page-fit rejection', async () => {
  const api = await readDoc('docs/specs/04_DatastoreAPI.md');
  const capacity = await readDoc('docs/specs/09_CapacityAndRetention.md');

  assert.match(
    api,
    /If encoded record bytes exceed `maxSingleRecordBytes`, insert MUST reject with `QuotaExceededError`/,
  );
  assert.match(
    capacity,
    /page-fit boundary check MUST run before strict\/turnover policy evaluation/,
  );
});
