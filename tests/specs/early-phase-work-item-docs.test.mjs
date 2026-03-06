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

test('active-phase ADR records the phase and scope-lock decision and is indexed', async () => {
  const adr = await readDoc('docs/adr/32_ActivePhase_M1_and_v0.1_ScopeLock.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const plansIndex = await readDoc('docs/plans/INDEX.md');
  const roadmap = await readDoc('docs/architecture/development-roadmap.md');

  assert.match(adr, /ADR-32: Active Phase M1 and v0\.1 Scope Lock/i);
  assert.match(adr, /Set the current active implementation phase to `Phase 1`/i);
  assert.match(adr, /lock immediate implementation scope to `v0\.1` deliverables/i);

  assert.match(adrIndex, /32_ActivePhase_M1_and_v0\.1_ScopeLock\.md/);
  assert.match(
    plansIndex,
    /02_PhaseWorkItem_M1_MemoryVerticalSlice\.md/,
  );
  assert.match(roadmap, /Current Focus \(2026-03-06\)/i);
});
