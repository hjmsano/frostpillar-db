import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('phase 0 governance closure docs are tracked and marked complete', async () => {
  const checklist = await readFileUtf8(
    'docs/plans/01_DevelopmentStatusChecklist.md',
  );
  const plansIndex = await readFileUtf8('docs/plans/INDEX.md');
  const workItem = await readFileUtf8(
    'docs/plans/08_PhaseWorkItem_P0_FoundationSync_GovernanceClosure.md',
  );
  const workflowSpec = await readFileUtf8('docs/specs/12_DevelopmentWorkflow.md');
  const testingStrategy = await readFileUtf8('docs/testing/strategy.md');
  const usageEn = await readFileUtf8('docs/usage/03_DevelopmentWorkflow.md');
  const usageJa = await readFileUtf8('docs/usage/03_DevelopmentWorkflow-JA.md');
  const adrIndex = await readFileUtf8('docs/adr/INDEX.md');

  assert.match(
    checklist,
    /Active work item: `docs\/plans\/08_PhaseWorkItem_P0_FoundationSync_GovernanceClosure\.md \(completed\)`/,
  );

  assert.match(
    checklist,
    /- \[x\] confirm `docs\/specs` and `docs\/adr` references are consistent in new changes/,
  );
  assert.match(
    checklist,
    /- \[x\] enforce phase-gate checklist in every feature PR/,
  );
  assert.match(
    checklist,
    /- \[x\] keep test strategy and workflow docs aligned/,
  );
  assert.match(
    checklist,
    /- \[x\] exit criteria met: every new work item follows intent -> spec -> tests -> implementation -> verification/,
  );

  assert.match(
    plansIndex,
    /08_PhaseWorkItem_P0_FoundationSync_GovernanceClosure\.md/,
  );
  assert.match(workItem, /Status: Completed/);
  assert.match(workItem, /Completion Notes/i);

  assert.match(workflowSpec, /Feature PR Phase-Gate Checklist/i);
  assert.match(workflowSpec, /Documentation Index Consistency/i);
  assert.match(
    workflowSpec,
    /intent alignment -> spec update -> failing tests -> implementation -> verification/i,
  );
  assert.match(
    testingStrategy,
    /intent alignment -> spec update -> failing tests -> implementation -> verification/i,
  );
  assert.match(usageEn, /Feature PR Checklist Enforcement/i);
  assert.match(usageJa, /Feature PR チェックリストの強制/);
  assert.match(
    adrIndex,
    /50_Phase0_GovernanceClosure_PRTemplate_and_DocsIndexGuards\.md/,
  );
});
