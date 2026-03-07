import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('distribution delivery spec defines export and profile matrix contracts', async () => {
  const spec = await readFileUtf8(
    'docs/specs/13_DistributionDeliveryTracks.md',
  );

  assert.match(spec, /top-level `exports` map/i);
  assert.match(spec, /`npm pack` output MUST be installable/i);
  assert.match(spec, /Browser Bundle Manifest and Profile Matrix Contract/i);
  assert.match(spec, /`profileMatrix`/i);
});

test('delivery usage docs publish explicit profile matrix in english and japanese', async () => {
  const usageEn = await readFileUtf8('docs/usage/05_DeliveryOptions.md');
  const usageJa = await readFileUtf8('docs/usage/05_DeliveryOptions-JA.md');

  assert.match(usageEn, /dist\/bundles\/manifest\.json/i);
  assert.match(usageEn, /frostpillar-core\.js/i);
  assert.match(usageEn, /core-indexeddb/i);
  assert.match(usageEn, /planned/i);

  assert.match(usageJa, /dist\/bundles\/manifest\.json/);
  assert.match(usageJa, /frostpillar-core\.js/);
  assert.match(usageJa, /core-indexeddb/);
  assert.match(usageJa, /計画中/);
});

test('distribution delivery ADR is recorded and indexed', async () => {
  const adr = await readFileUtf8(
    'docs/adr/49_P4_ReleaseArtifactContract_for_NPM_Exports_and_ProfileMatrix.md',
  );
  const adrIndex = await readFileUtf8('docs/adr/INDEX.md');

  assert.match(adr, /ADR-49/i);
  assert.match(adr, /Release Artifact Contract for NPM Exports and Profile Matrix/i);
  assert.match(
    adrIndex,
    /49_P4_ReleaseArtifactContract_for_NPM_Exports_and_ProfileMatrix\.md/,
  );
});

test('phase 4 checklist is marked complete with p4 work-item closure', async () => {
  const checklist = await readFileUtf8(
    'docs/plans/01_DevelopmentStatusChecklist.md',
  );
  const p4Plan = await readFileUtf8(
    'docs/plans/05_PhaseWorkItem_P4_DistributionDeliveryTracks.md',
  );

  assert.match(
    checklist,
    /Active phase: `Phase 4: Distribution Delivery Tracks \(completed\)`/,
  );
  assert.match(
    checklist,
    /define release-ready NPM delivery contract with smoke verification/,
  );
  assert.match(checklist, /- \[x\] produce browser bundle artifacts for mandatory `core` profile/);
  assert.match(checklist, /- \[x\] define and verify bundle profile matrix for optional browser adapters/);
  assert.match(checklist, /- \[x\] publish EN\/JA usage guidance for delivery\/profile selection/);
  assert.match(checklist, /- \[x\] npm install\/import smoke tests added first and confirmed red/);
  assert.match(checklist, /- \[x\] browser bundle `core` profile smoke test added first and confirmed red/);
  assert.match(checklist, /- \[x\] package artifact\/export shape implemented and verified/);
  assert.match(checklist, /- \[x\] bundle profile artifacts and metadata matrix implemented and verified/);
  assert.match(checklist, /- \[x\] EN\/JA usage docs updated for delivery choices/);
  assert.match(checklist, /- \[x\] full verification green \(`pnpm test --run`, `pnpm check`\)/);

  assert.match(p4Plan, /Status: Completed/);
  assert.match(p4Plan, /Completion Notes/i);
});
