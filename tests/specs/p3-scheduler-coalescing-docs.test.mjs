import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('flush and datastore specs define scheduler coalescing and retry semantics', async () => {
  const flushSpec = await readDoc('docs/specs/10_FlushAndDurability.md');
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');

  assert.match(
    flushSpec,
    /coalesce triggers and run one additional commit after the in-flight commit completes/i,
  );
  assert.match(
    flushSpec,
    /pending dirty state MUST remain queued for retry by later periodic\/size\/manual trigger/i,
  );
  assert.match(
    datastoreSpec,
    /coalesce[\s\S]*run one additional commit attempt after in-flight completion/i,
  );
  assert.match(
    datastoreSpec,
    /failed background auto-commit attempt, pending dirty state MUST remain and be[\s\S]*retry/i,
  );
});

test('phase 3 scheduler work-item and ADR are indexed', async () => {
  const plansIndex = await readDoc('docs/plans/INDEX.md');
  const status = await readDoc('docs/plans/01_DevelopmentStatusChecklist.md');
  const workItem = await readDoc(
    'docs/plans/07_PhaseWorkItem_P3_SchedulerCoalescing_and_ErrorChannelRegression.md',
  );
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr47 = await readDoc(
    'docs/adr/47_FileAutoCommitScheduler_Coalescing_and_CloseDrain.md',
  );

  assert.match(
    plansIndex,
    /07_PhaseWorkItem_P3_SchedulerCoalescing_and_ErrorChannelRegression\.md/,
  );
  assert.match(
    status,
    /Active work item: `docs\/plans\/07_PhaseWorkItem_P3_SchedulerCoalescing_and_ErrorChannelRegression\.md \(completed\)`/,
  );
  assert.match(workItem, /Plan: Phase Work Item \(P3 Scheduler Coalescing and Error-Channel Regression\)/i);

  assert.match(
    adrIndex,
    /47_FileAutoCommitScheduler_Coalescing_and_CloseDrain\.md/,
  );
  assert.match(adr47, /single in-flight commit orchestration/i);
});

test('usage docs mention coalescing and failed-attempt error propagation in EN/JA', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(usageEn, /scheduler coalesces overlapping triggers/i);
  assert.match(
    usageEn,
    /failures emit one error event per failed attempt and pending changes remain queued/i,
  );

  assert.match(usageJa, /scheduler は重複トリガーを coalescing します/);
  assert.match(
    usageJa,
    /失敗試行ごとに 1 件[\s\S]*未反映変更は次回トリガーで再試行できる状態/,
  );
});
