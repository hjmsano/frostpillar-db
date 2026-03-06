import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('query engine contract keeps options-enabled translation and precedence rules', async () => {
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');
  const luceneSubset = await readDoc('docs/specs/07_LuceneSubset.md');

  assert.match(
    queryContract,
    /toNativeQuery\(\s*queryText: string,\s*options\?: QueryExecutionOptions,\s*\): NativeQueryRequest;/s,
  );
  assert.match(
    queryContract,
    /SQL module: conflicting controls between SQL text and `options` MUST fail with `QueryValidationError`/i,
  );
  assert.match(
    queryContract,
    /Lucene module: `options` is the normative source for aggregation\/grouping\/output controls/i,
  );
  assert.match(
    luceneSubset,
    /Aggregation\/grouping\/output options are supplied through `QueryExecutionOptions` argument in\s+`toNativeQuery\(queryText, options\)`/i,
  );
});

test('canonical path escaping rules are centralized in query-engine contract', async () => {
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');
  const sqlSubset = await readDoc('docs/specs/06_SQLSubset.md');
  const luceneSubset = await readDoc('docs/specs/07_LuceneSubset.md');
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(
    queryContract,
    /Canonical field path escaping rules:/,
  );
  assert.match(
    datastoreSpec,
    /canonical path escaping follows `docs\/specs\/05_QueryEngineContract\.md`/i,
  );
  assert.match(
    sqlSubset,
    /canonical payload path escaping MUST follow `docs\/specs\/05_QueryEngineContract\.md` section 6/i,
  );
  assert.match(
    luceneSubset,
    /canonical payload path escaping MUST follow `docs\/specs\/05_QueryEngineContract\.md` section 6/i,
  );
});

test('datastore exposes integrated query API that hides manual NativeQueryRequest handling', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(
    datastoreSpec,
    /registerQueryEngine\(engine: QueryEngineModule\): void;/,
  );
  assert.match(
    datastoreSpec,
    /unregisterQueryEngine\(language: QueryLanguage\): void;/,
  );
  assert.match(
    datastoreSpec,
    /query\(\s*language: QueryLanguage,\s*queryText: string,\s*options\?: QueryExecutionOptions,\s*\): Promise<NativeQueryResultRow\[]>;/s,
  );
  assert.match(
    datastoreSpec,
    /`QueryEngineNotRegisteredError`: requested query language has no registered query-engine module/i,
  );
  assert.match(
    queryContract,
    /Datastore integrated query path MUST call `engine\.toNativeQuery\(queryText, options\)` and execute via `db\.queryNative\(\.\.\.\)` only/i,
  );
  assert.match(
    usageEn,
    /await db\.query\("sql", "SELECT COUNT\(\*\) AS c FROM records WHERE status = 404"\)/i,
  );
  assert.match(
    usageJa,
    /await db\.query\("sql", "SELECT COUNT\(\*\) AS c FROM records WHERE status = 404"\)/i,
  );
});

test('adr captures datastore-integrated query-engine UX decision', async () => {
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr = await readDoc(
    'docs/adr/29_Datastore_IntegratedQueryAPI_for_EngineUX.md',
  );

  assert.match(
    adrIndex,
    /29_Datastore_IntegratedQueryAPI_for_EngineUX\.md/,
  );
  assert.match(
    adr,
    /Expose datastore-integrated query API with language-based engine registry/i,
  );
  assert.match(
    adr,
    /manual `toNativeQuery` \+ `queryNative` flow remains supported for advanced control/i,
  );
});

test('query integration defines close-state and in-flight registry snapshot semantics', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr = await readDoc(
    'docs/adr/30_QueryEngineRegistrySnapshot_and_ClosedStateSemantics.md',
  );

  assert.match(
    datastoreSpec,
    /`query\(\.\.\.\)` MUST fail with `ClosedDatastoreError` if datastore has been closed/i,
  );
  assert.match(
    datastoreSpec,
    /`registerQueryEngine\(\.\.\.\)` and `unregisterQueryEngine\(\.\.\.\)` MUST throw `ClosedDatastoreError`/i,
  );
  assert.match(
    datastoreSpec,
    /MUST resolve target engine once at query invocation boundary/i,
  );
  assert.match(
    queryContract,
    /registry changes after resolution \(`registerQueryEngine` \/ `unregisterQueryEngine`\) MUST NOT/si,
  );
  assert.match(
    queryContract,
    /change engine instance used by that in-flight `Datastore\.query\(\.\.\.\)` call/si,
  );
  assert.match(
    usageEn,
    /after `db\.close\(\)`, `db\.query\(\.\.\.\)` fails with `ClosedDatastoreError`/i,
  );
  assert.match(
    usageJa,
    /`db\.close\(\)` 後の `db\.query\(\.\.\.\)` は `ClosedDatastoreError` で失敗します/i,
  );
  assert.match(
    adrIndex,
    /30_QueryEngineRegistrySnapshot_and_ClosedStateSemantics\.md/,
  );
  assert.match(
    adr,
    /`Datastore\.query\(\.\.\.\)` resolves the target engine once per invocation boundary/i,
  );
});
