import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('development status checklist activates M5 release hardening scope', async () => {
  const checklist = await readFileUtf8(
    'docs/plans/01_DevelopmentStatusChecklist.md',
  );

  assert.match(checklist, /Active phase: `M5: Release Hardening \(active\)`/);
  assert.match(
    checklist,
    /Active work item: `docs\/plans\/09_PhaseWorkItem_M5_ReleaseHardening_v0\.1\.md \(active\)`/,
  );
  assert.match(
    checklist,
    /## 12\. Active Work-Item Checklist \(M5 Release Hardening v0\.1\)/,
  );
  assert.match(
    checklist,
    /- \[ \] benchmark method and reproducible script draft defined/,
  );
  assert.match(
    checklist,
    /- \[ \] v0\.1 limitations and non-goals documented in README and usage EN\/JA/,
  );
});

test('m5 release hardening work-item is added and indexed', async () => {
  const m5Plan = await readFileUtf8(
    'docs/plans/09_PhaseWorkItem_M5_ReleaseHardening_v0.1.md',
  );
  const plansIndex = await readFileUtf8('docs/plans/INDEX.md');

  assert.match(m5Plan, /Plan: Phase Work Item \(M5 Release Hardening v0\.1\)/i);
  assert.match(m5Plan, /Status: Active/i);
  assert.match(m5Plan, /performance baseline report/i);
  assert.match(m5Plan, /reproducible benchmark script/i);
  assert.match(m5Plan, /README.*limitations.*non-goals/i);
  assert.match(m5Plan, /Phase B: TDD Red/i);
  assert.match(
    plansIndex,
    /09_PhaseWorkItem_M5_ReleaseHardening_v0\.1\.md/,
  );
});

test('adr cleanup and explicit v0.2 direction are documented and indexed', async () => {
  const adr01 = await readFileUtf8('docs/adr/01_DevelopmentPlan.md');
  const adr32 = await readFileUtf8('docs/adr/32_ActivePhase_M1_and_v0.1_ScopeLock.md');
  const adr51 = await readFileUtf8(
    'docs/adr/51_v0.2_Direction_BrowserBackendFirst_After_M5_ReleaseHardening.md',
  );
  const adrIndex = await readFileUtf8('docs/adr/INDEX.md');
  const testingStrategy = await readFileUtf8('docs/testing/strategy.md');
  const usageEn = await readFileUtf8('docs/usage/05_DeliveryOptions.md');
  const usageJa = await readFileUtf8('docs/usage/05_DeliveryOptions-JA.md');

  assert.match(adr01, /Status: Accepted/i);
  assert.match(adr01, /Historical context update \(2026-03-07\)/i);
  assert.match(adr01, /Phases 0-4 are complete/i);

  assert.match(adr32, /Status: Superseded/i);
  assert.match(adr32, /Superseded by ADR-51/i);

  assert.match(adr51, /Status: Accepted/i);
  assert.match(adr51, /v0\.2 direction/i);
  assert.match(adr51, /browser backend runtime support first/i);

  assert.match(
    adrIndex,
    /51_v0\.2_Direction_BrowserBackendFirst_After_M5_ReleaseHardening\.md/,
  );
  assert.match(testingStrategy, /Browser backend \(v0\.2\+\):/i);
  assert.match(
    usageEn,
    /Next Direction \(after v0\.1 release hardening\): browser backend runtime support first/i,
  );
  assert.match(
    usageJa,
    /次の方向性（v0\.1 リリースハードニング後）: ブラウザバックエンド実装を先行/,
  );
});
