import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('record, binary, and api specs define key/string UTF-8 byte limits', async () => {
  const recordFormat = await readDoc('docs/specs/01_RecordFormat.md');
  const binaryEncoding = await readDoc('docs/specs/02_BinaryEncoding.md');
  const apiSpec = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(recordFormat, /Each key MUST encode to UTF-8 byte length `<= 1024`\./);
  assert.match(
    recordFormat,
    /String payload values \(including nested levels\) MUST encode to UTF-8 byte length\s+`<= 65535`\./,
  );

  assert.match(binaryEncoding, /Payload key UTF-8 byte length MUST be `<= 1024`/);
  assert.match(binaryEncoding, /UTF8_STRING payload value byte length MUST be `<= 65535`/);

  assert.match(apiSpec, /payload key UTF-8 byte length max is `1024`/i);
  assert.match(apiSpec, /payload string UTF-8 byte length max is `65535`/i);
});

test('usage guides document key/string UTF-8 byte limits in English and Japanese', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(usageEn, /payload key UTF-8 byte length limit is 1024/i);
  assert.match(usageEn, /payload string UTF-8 byte length limit is 65535/i);

  assert.match(usageJa, /payload キーの UTF-8 バイト長上限は 1024/i);
  assert.match(usageJa, /payload 文字列値の UTF-8 バイト長上限は 65535/i);
});

test('adr index includes key/string byte limit decision record', async () => {
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr21 = await readDoc(
    'docs/adr/21_KeyAndString_ByteLengthLimits_for_Lightweight_Bounds.md',
  );

  assert.match(
    adrIndex,
    /21_KeyAndString_ByteLengthLimits_for_Lightweight_Bounds\.md/,
  );
  assert.match(adr21, /payload key UTF-8 byte length to `1024`/i);
  assert.match(adr21, /payload string UTF-8 byte length to `65535`/i);
});
