import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('development workflow spec defines mandatory phase gates and task discipline', async () => {
  const workflowSpec = await readDoc('docs/specs/12_DevelopmentWorkflow.md');

  assert.match(workflowSpec, /Step order is mandatory:[\s\S]*intent alignment -> spec update -> failing tests -> implementation -> verification/i);
  assert.match(workflowSpec, /Each phase MUST define entry criteria, execution tasks, and exit criteria/i);
  assert.match(workflowSpec, /A phase MUST NOT start implementation tasks before its failing tests are committed/i);
  assert.match(workflowSpec, /Any behavior change MUST update user docs in both English and Japanese/i);
});

test('usage docs provide bilingual workflow guide with checklist and done criteria', async () => {
  const usageEn = await readDoc('docs/usage/03_DevelopmentWorkflow.md');
  const usageJa = await readDoc('docs/usage/03_DevelopmentWorkflow-JA.md');

  assert.match(usageEn, /Phased Collaboration Workflow/i);
  assert.match(usageEn, /Session Checklist/i);
  assert.match(usageEn, /Definition of Done \(PR Ready\)/i);

  assert.match(usageJa, /段階的コラボレーションワークフロー/);
  assert.match(usageJa, /セッションチェックリスト/);
  assert.match(usageJa, /完了の定義（PR Ready）/);
});

test('usage template docs provide spec and ADR templates in English and Japanese', async () => {
  const templatesEn = await readDoc('docs/usage/04_DevelopmentTemplates.md');
  const templatesJa = await readDoc('docs/usage/04_DevelopmentTemplates-JA.md');

  assert.match(templatesEn, /Spec Update Template/i);
  assert.match(templatesEn, /ADR Template/i);
  assert.match(templatesEn, /Phased Task Breakdown Template/i);

  assert.match(templatesJa, /Spec 更新テンプレート/);
  assert.match(templatesJa, /ADR テンプレート/);
  assert.match(templatesJa, /段階別タスク分解テンプレート/);
});

test('architecture roadmap and indexes include phased development plan artifacts', async () => {
  const roadmap = await readDoc('docs/architecture/development-roadmap.md');
  const docsIndex = await readDoc('docs/INDEX.md');
  const architectureIndex = await readDoc('docs/architecture/INDEX.md');
  const specsIndex = await readDoc('docs/specs/INDEX.md');
  const usageIndex = await readDoc('docs/usage/INDEX.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr31 = await readDoc('docs/adr/31_DevelopmentWorkflow_and_PhasedExecutionPlaybook.md');

  assert.match(roadmap, /Current Development Phases and Task Breakdown/i);
  assert.match(roadmap, /Phase 0: Foundation Sync/i);
  assert.match(roadmap, /Phase 1: Memory Vertical Slice/i);
  assert.match(roadmap, /Phase 2: File Durability Slice/i);
  assert.match(roadmap, /Phase 3: Query and Capacity Hardening/i);

  assert.match(docsIndex, /development-roadmap\.md/);
  assert.match(architectureIndex, /development-roadmap\.md/);
  assert.match(specsIndex, /12_DevelopmentWorkflow\.md/);
  assert.match(usageIndex, /03_DevelopmentWorkflow\.md/);
  assert.match(usageIndex, /04_DevelopmentTemplates\.md/);

  assert.match(adrIndex, /31_DevelopmentWorkflow_and_PhasedExecutionPlaybook\.md/);
  assert.match(adr31, /Adopt a shared phased execution playbook/i);
  assert.match(adr31, /spec-first and TDD-first/i);
});
