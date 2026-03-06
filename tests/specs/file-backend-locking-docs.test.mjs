import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('datastore file backend spec requires exclusive open lock and typed lock-conflict error', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(datastoreSpec, /Lock file \(single-writer guard\): `\$\{resolvedDataFilePath\}\.lock`/);
  assert.match(datastoreSpec, /MUST acquire an exclusive lock before any[\s\S]*read\/write operation/i);
  assert.match(datastoreSpec, /MUST fail fast[\s\S]*MUST NOT proceed in read-only or best-effort mode/i);
  assert.match(
    datastoreSpec,
    /MUST throw `DatabaseLockedError`, which is a[\s\S]*subtype of `StorageEngineError`/i,
  );
  assert.match(datastoreSpec, /MUST NOT silently break or steal an existing lock/i);
  assert.match(
    datastoreSpec,
    /`DatabaseLockedError`: file-backend exclusive lock acquisition failed because datastore is already opened by another process/i,
  );
});

test('usage docs describe file-backend single-writer lock behavior in EN and JA', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(usageEn, /lock file \(single-writer guard\): `\.\/data\/frostpillar\/prod_events\.fpdb\.lock`/i);
  assert.match(usageEn, /file backend acquires an exclusive lock on open/i);
  assert.match(usageEn, /open fails with `DatabaseLockedError`/i);

  assert.match(usageJa, /ロックファイル（単一 writer 保護）: `\.\/data\/frostpillar\/prod_events\.fpdb\.lock`/);
  assert.match(usageJa, /file backend は open 時に排他ロック/);
  assert.match(usageJa, /open は `DatabaseLockedError`[\s\S]*で失敗します/);
});

test('testing strategy and ADR index include multi-process lock requirements', async () => {
  const testingStrategy = await readDoc('docs/testing/strategy.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr27 = await readDoc(
    'docs/adr/27_FileBackend_ExclusiveOpenLock_for_MultiProcessSafety.md',
  );

  assert.match(
    testingStrategy,
    /exclusive open-lock acquisition for single-writer safety/i,
  );
  assert.match(
    testingStrategy,
    /second-process open on same datastore path must fail with `DatabaseLockedError`/i,
  );
  assert.match(adrIndex, /27_FileBackend_ExclusiveOpenLock_for_MultiProcessSafety\.md/);
  assert.match(adr27, /Require single-writer lock on file backend open/i);
  assert.match(adr27, /Node\.js file APIs do not provide implicit cross-process datastore-level locking/i);
});
