import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('specs define regex safety bounds and path-containment hardening', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');

  assert.match(
    datastoreSpec,
    /resolved datastore path MUST stay within current working directory \(`process\.cwd\(\)`\)/i,
  );
  assert.match(
    datastoreSpec,
    /filePrefix` and `target\.fileName` MUST be file-name fragments/i,
  );
  assert.match(
    datastoreSpec,
    /must fail with\s+`ConfigurationError`/i,
  );

  assert.match(
    queryContract,
    /`like` MUST use bounded wildcard matching semantics \(`%` and `_`\) without compiling/i,
  );
  assert.match(
    queryContract,
    /`regexp` patterns using backreferences, look-around assertions, or nested quantifier/i,
  );
  assert.match(
    queryContract,
    /`regexp` pattern length MUST be bounded \(max 256 UTF-16 code units\)/i,
  );
});

test('usage docs and ADR record security hardening contract in EN/JA', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr = await readDoc(
    'docs/adr/43_QueryRegexSafety_and_FilePathContainment.md',
  );

  assert.match(
    usageEn,
    /`regexp` blocks look-around, backreferences, and nested quantifier groups/i,
  );
  assert.match(
    usageEn,
    /resolved file datastore path must stay under `process\.cwd\(\)`/i,
  );

  assert.match(
    usageJa,
    /`regexp` は look-around・backreference・入れ子量指定グループ.*を拒否します/i,
  );
  assert.match(
    usageJa,
    /file backend の解決後パスは `process\.cwd\(\)` 配下に制限されます/i,
  );

  assert.match(
    adrIndex,
    /43_QueryRegexSafety_and_FilePathContainment\.md/,
  );
  assert.match(
    adr,
    /Bound query-time pattern complexity and enforce file datastore path containment/i,
  );
});
