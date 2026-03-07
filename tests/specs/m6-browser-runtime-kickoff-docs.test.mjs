import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('status checklist switches active execution to M6 browser runtime baseline', async () => {
  const checklist = await readFileUtf8(
    'docs/plans/01_DevelopmentStatusChecklist.md',
  );

  assert.match(
    checklist,
    /Active phase: `M6: Browser Runtime Baseline \(active\)`/,
  );
  assert.match(
    checklist,
    /Active work item: `docs\/plans\/10_PhaseWorkItem_M6_BrowserRuntimeBaseline\.md \(active\)`/,
  );
  assert.match(
    checklist,
    /## 13\. Active Work-Item Checklist \(M6 Browser Runtime Baseline\)/,
  );
  assert.match(
    checklist,
    /- \[x\] M6 work-item plan activated and indexed/,
  );
  assert.match(
    checklist,
    /- \[ \] initial browser runtime baseline implementation completed \(localStorage-first\)/,
  );
});

test('m6 browser runtime work-item is added and indexed', async () => {
  const plan = await readFileUtf8(
    'docs/plans/10_PhaseWorkItem_M6_BrowserRuntimeBaseline.md',
  );
  const plansIndex = await readFileUtf8('docs/plans/INDEX.md');
  const roadmap = await readFileUtf8('docs/architecture/development-roadmap.md');
  const adr51 = await readFileUtf8(
    'docs/adr/51_v0.2_Direction_BrowserBackendFirst_After_M5_ReleaseHardening.md',
  );

  assert.match(plan, /Plan: Phase Work Item \(M6 Browser Runtime Baseline\)/i);
  assert.match(plan, /Status: Active/i);
  assert.match(plan, /browser backend runtime support first/i);
  assert.match(plan, /localStorage-first/i);
  assert.match(
    plansIndex,
    /10_PhaseWorkItem_M6_BrowserRuntimeBaseline\.md/,
  );

  assert.match(
    roadmap,
    /## Phase 5: Browser Runtime Baseline \(Post-v0\.1\)/,
  );
  assert.match(roadmap, /implement first browser runtime backend baseline incrementally \(localStorage-first\)/i);
  assert.match(adr51, /browser backend runtime support first/i);
});
