import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('phase work-item plan defines v0.1 scope and red-test plan', async () => {
  const source = await readDoc(
    'docs/plans/02_PhaseWorkItem_M1_MemoryVerticalSlice.md',
  );

  assert.match(source, /Plan: Phase Work Item \(M1 Memory Vertical Slice\)/i);
  assert.match(source, /version target MUST remain aligned to `v0\.1` short-term scope/i);
  assert.match(source, /MUST NOT implement `v0\.2`-planned APIs in this work item/i);
  assert.match(source, /Acceptance Criteria/i);
  assert.match(source, /Failing Tests \(TDD Red\)/i);
  assert.match(source, /`tests\/core\/datastore-memory-contract\.test\.mjs`/);
});

test('phase transition ADR history is preserved and supersession is explicit', async () => {
  const adr = await readDoc('docs/adr/32_ActivePhase_M1_and_v0.1_ScopeLock.md');
  const adr51 = await readDoc(
    'docs/adr/51_v0.2_Direction_BrowserBackendFirst_After_M5_ReleaseHardening.md',
  );
  const adr37 = await readDoc(
    'docs/adr/37_Phase2_Phase3_Kickoff_and_IncrementalScope.md',
  );
  const adr39 = await readDoc(
    'docs/adr/39_Dedicated_M2_FileDurability_CompletionPlan.md',
  );
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const plansIndex = await readDoc('docs/plans/INDEX.md');
  const roadmap = await readDoc('docs/architecture/development-roadmap.md');

  assert.match(adr, /ADR-32: Active Phase M1 and v0\.1 Scope Lock/i);
  assert.match(adr, /Status: Superseded/i);
  assert.match(adr, /Superseded by ADR-51/i);
  assert.match(adr, /lock immediate implementation scope to `v0\.1` deliverables/i);
  assert.match(adr51, /ADR-51:/i);
  assert.match(adr51, /v0\.2 Direction/i);
  assert.match(adr51, /browser backend/i);

  assert.match(adrIndex, /32_ActivePhase_M1_and_v0\.1_ScopeLock\.md/);
  assert.match(
    adrIndex,
    /51_v0\.2_Direction_BrowserBackendFirst_After_M5_ReleaseHardening\.md/,
  );
  assert.match(
    plansIndex,
    /02_PhaseWorkItem_M1_MemoryVerticalSlice\.md/,
  );
  assert.match(
    plansIndex,
    /03_PhaseWorkItem_P2P3_FileDurability_and_QueryCapacityKickoff\.md/,
  );
  assert.match(
    adrIndex,
    /37_Phase2_Phase3_Kickoff_and_IncrementalScope\.md/,
  );
  assert.match(
    adrIndex,
    /39_Dedicated_M2_FileDurability_CompletionPlan\.md/,
  );
  assert.match(adr37, /Start a combined kickoff work item/i);
  assert.match(adr39, /Introduce a dedicated M2 completion work item/i);
  assert.match(roadmap, /Development Phase Model and Governance/i);
  assert.match(roadmap, /Live status, active phase snapshot, and checkbox tracking/i);
});

test('M2 file-durability work-item plan captures remaining ADR-01 durability obligations', async () => {
  const m2Plan = await readDoc(
    'docs/plans/04_PhaseWorkItem_M2_FileDurabilitySlice.md',
  );
  const plansIndex = await readDoc('docs/plans/INDEX.md');

  assert.match(m2Plan, /Plan: Phase Work Item \(M2 File Durability Slice\)/i);
  assert.match(m2Plan, /corrupt-header and unsupported-version/i);
  assert.match(m2Plan, /lock release.*reopen success/i);
  assert.match(m2Plan, /default auto-commit behavior.*immediate/i);
  assert.match(m2Plan, /Failing Tests \(TDD Red\)/i);
  assert.match(
    plansIndex,
    /04_PhaseWorkItem_M2_FileDurabilitySlice\.md/,
  );
});
