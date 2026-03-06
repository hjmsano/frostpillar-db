import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('datastore and usage docs clarify localStorage copy-on-write headroom tradeoff', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(
    datastoreSpec,
    /localStorage commit MUST use generation-level copy-on-write/i,
  );
  assert.match(
    datastoreSpec,
    /transient usage can approach[\s\S]*previousGenerationSize \+ newGenerationSize/i,
  );
  assert.match(
    datastoreSpec,
    /effective steady-state writable size[\s\S]*around half of browser quota/i,
  );

  assert.match(usageEn, /generation copy-on-write/i);
  assert.match(usageEn, /near 2x steady-state/i);
  assert.match(usageEn, /about 50% of browser localStorage quota/i);

  assert.match(usageJa, /世代単位の copy-on-write/);
  assert.match(usageJa, /実質2倍近傍/);
  assert.match(usageJa, /おおむね50%前後/);
});

test('lucene and query contract docs clarify timestamp range-bound normalization', async () => {
  const luceneSpec = await readDoc('docs/specs/07_LuceneSubset.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');

  assert.match(
    luceneSpec,
    /Quoted range bounds MUST remain `string` literals at parse stage/i,
  );
  assert.match(
    luceneSpec,
    /Unquoted non-numeric range bounds MUST remain `string` literals at parse stage/i,
  );
  assert.match(
    luceneSpec,
    /For reserved field `timestamp`, accepted timestamp-string bounds[\s\S]*MUST be normalized to Unix epoch milliseconds/i,
  );
  assert.match(
    luceneSpec,
    /Timestamp range normalization MUST apply to both inclusive \(`\[\]`\) and exclusive \(`\{\}`\)/i,
  );
  assert.match(
    luceneSpec,
    /This normalization rule applies to both term comparisons and range-query bounds/i,
  );

  assert.match(
    queryContract,
    /For Lucene range bounds, modules MUST preserve literal typing at parse stage/i,
  );
  assert.match(
    queryContract,
    /For reserved field `timestamp`, modules MUST normalize accepted timestamp-string range[\s\S]*bounds/i,
  );
});

test('adr index and adr-28 record these clarifications', async () => {
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr28 = await readDoc(
    'docs/adr/28_LocalStorageAtomicCommitHeadroom_and_LuceneTimestampRangeNormalization.md',
  );

  assert.match(
    adrIndex,
    /28_LocalStorageAtomicCommitHeadroom_and_LuceneTimestampRangeNormalization\.md/,
  );
  assert.match(adr28, /temporary double-footprint risk/i);
  assert.match(adr28, /timestamp-string range bounds/i);
});
