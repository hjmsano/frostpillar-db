import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('page structure standardizes header checksum to CRC-32C', async () => {
  const source = await readDoc('docs/specs/03_PageStructure.md');

  assert.match(source, /CRC-32C/);
  assert.match(source, /poly:\s*`0x1EDC6F41`/);
  assert.match(source, /init:\s*`0xFFFFFFFF`/);
  assert.match(source, /refin:\s*`true`/);
  assert.match(source, /refout:\s*`true`/);
  assert.match(source, /xorout:\s*`0xFFFFFFFF`/);
  assert.match(source, /"123456789".*`0xE3069283`/);
  assert.doesNotMatch(source, /CRC-32\/ISO-HDLC|CRC32-IEEE/);
});

test('testing strategy aligns known-vector check with CRC-32C', async () => {
  const source = await readDoc('docs/testing/strategy.md');

  assert.match(source, /CRC-32C/);
  assert.match(source, /"123456789".*`0xE3069283`/);
  assert.doesNotMatch(source, /0xCBF43926/);
});
