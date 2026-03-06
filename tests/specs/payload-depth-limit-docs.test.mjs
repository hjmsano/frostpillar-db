import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('record format and binary encoding define payload depth limit', async () => {
  const recordFormat = await readDoc('docs/specs/01_RecordFormat.md');
  const binaryEncoding = await readDoc('docs/specs/02_BinaryEncoding.md');
  const apiSpec = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(
    recordFormat,
    /Payload object nesting depth MUST be `<= 64`\./,
  );
  assert.match(binaryEncoding, /Payload object max nesting depth MUST be `64`/);
  assert.match(binaryEncoding, /nesting depth exceeds `64`/);
  assert.match(apiSpec, /payload object max nesting depth is `64`/i);
});

test('usage guides document payload depth limit in English and Japanese', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(usageEn, /maximum payload object nesting depth is 64/);
  assert.match(usageJa, /payload の最大ネスト深さは 64/);
});

test('adr index includes payload depth limit decision record', async () => {
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr20 = await readDoc(
    'docs/adr/20_Payload_Object_Depth_Limit_for_Stability.md',
  );

  assert.match(
    adrIndex,
    /20_Payload_Object_Depth_Limit_for_Stability\.md/,
  );
  assert.match(adr20, /max nesting depth to `64`/i);
});
