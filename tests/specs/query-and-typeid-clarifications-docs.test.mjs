import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('record/api specs clarify string-byte limit vs page-fit boundary', async () => {
  const recordFormat = await readDoc('docs/specs/01_RecordFormat.md');
  const apiSpec = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(
    recordFormat,
    /String payload byte-length limits are independent from page-fit constraints/i,
  );
  assert.match(
    apiSpec,
    /A record that passes payload string-length validation can still fail page-fit checks/i,
  );
  assert.match(
    recordFormat,
    /configured `pageSize` and per-page overhead/i,
  );
});

test('binary encoding reserves type id 0x00 and forbids it as valid tlv payload type', async () => {
  const binaryEncoding = await readDoc('docs/specs/02_BinaryEncoding.md');

  assert.match(binaryEncoding, /`0x00`\s+\|\s+`RESERVED`/);
  assert.match(
    binaryEncoding,
    /`0x00` MUST NOT be emitted for valid v0\.2 TLV fields/i,
  );
});

test('lucene subset defines explicit null/missing behavior, timestamp coercion, and range literal typing', async () => {
  const lucene = await readDoc('docs/specs/07_LuceneSubset.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');

  assert.match(
    lucene,
    /`field:null` MUST match records where the field exists and value is explicit `null`/i,
  );
  assert.match(
    lucene,
    /`field:\*` MUST map to native `exists` and MUST include explicit `null` values/i,
  );
  assert.match(
    lucene,
    /`NOT field:\*` MUST map to native `not_exists` and MUST match only missing fields/i,
  );
  assert.match(
    lucene,
    /Query values for `timestamp` MAY be ISO-8601 date-time strings with timezone/i,
  );
  assert.match(
    lucene,
    /Date-only literals `YYYY-MM-DD` are also allowed and MUST be interpreted as `YYYY-MM-DDT00:00:00\.000Z`/i,
  );
  assert.match(
    lucene,
    /query engine MUST normalize accepted timestamp strings into Unix epoch milliseconds before execution/i,
  );
  assert.match(
    lucene,
    /Invalid `timestamp` date strings MUST raise `QueryValidationError`/i,
  );
  assert.match(
    lucene,
    /Unquoted numeric literals in range bounds MUST be parsed as `number`/,
  );
  assert.match(
    lucene,
    /Quoted range bounds MUST remain `string` literals/,
  );
  assert.match(
    lucene,
    /Unquoted non-numeric range bounds MUST remain `string` literals/,
  );
  assert.match(
    queryContract,
    /`field:null` -> `is_null`/,
  );
  assert.match(
    queryContract,
    /for Lucene range bounds, modules MUST preserve literal typing/i,
  );
});

test('usage docs reflect Lucene null/exists, timestamp coercion, and range typing behavior in EN/JA', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(usageEn, /`field:\*` matches explicit `null` values/i);
  assert.match(usageEn, /Lucene `field:null` maps to native `is_null`/i);
  assert.match(usageEn, /Lucene range bounds use typed literals: unquoted numeric -> number, quoted -> string/i);
  assert.match(usageEn, /Lucene `timestamp` accepts ISO-8601 date-time strings with timezone/i);
  assert.match(usageEn, /Date-only `YYYY-MM-DD` is interpreted as UTC midnight/i);
  assert.match(usageEn, /invalid timestamp literals raise `QueryValidationError`/i);

  assert.match(usageJa, /`field:\*` は明示的な `null` 値にも一致します/i);
  assert.match(usageJa, /Lucene の `field:null` は native `is_null` に対応します/i);
  assert.match(usageJa, /Lucene の範囲境界は型付きで扱います: 非quoted数値は number、quoted は string/i);
  assert.match(usageJa, /Lucene の `timestamp` はタイムゾーン付き ISO-8601 日時文字列を受け付けます/i);
  assert.match(usageJa, /日付のみ `YYYY-MM-DD` は UTC の 00:00:00\.000 として解釈します/i);
  assert.match(usageJa, /不正な timestamp リテラルは `QueryValidationError` になります/i);
});

test('record format standardizes datastore-managed identity field as _id', async () => {
  const recordFormat = await readDoc('docs/specs/01_RecordFormat.md');
  const lucene = await readDoc('docs/specs/07_LuceneSubset.md');

  assert.match(
    recordFormat,
    /export interface IdentifiedTimeseriesRecord extends TimeseriesRecord \{[\s\S]*_id: RecordId;/,
  );
  assert.match(
    recordFormat,
    /export interface IdentifiedPersistedTimeseriesRecord[\s\S]*_id: RecordId;/,
  );
  assert.match(lucene, /- `_id`: internal record id/);
});

test('adr index includes record identity and lucene timestamp/null clarification decision record', async () => {
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr25 = await readDoc(
    'docs/adr/25_RecordSizeBoundary_RecordIdNaming_and_LuceneTimestampNullRules.md',
  );

  assert.match(
    adrIndex,
    /25_RecordSizeBoundary_RecordIdNaming_and_LuceneTimestampNullRules\.md/,
  );
  assert.match(adr25, /Record identity field exposed to query engines is standardized as `_id`/i);
  assert.match(
    adr25,
    /Lucene `timestamp` query values may use ISO-8601 strings and must normalize to epoch milliseconds/i,
  );
});
