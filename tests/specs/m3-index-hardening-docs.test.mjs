import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('M3 index hardening specs define query path and complexity expectations', async () => {
  const apiSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const btreeSpec = await readDoc('docs/specs/11_BTreeIndexInvariants.md');

  assert.match(
    apiSpec,
    /M3\+ runtime path MUST execute range read through B\+ tree lower-bound seek/i,
  );
  assert.match(
    apiSpec,
    /M3\+ runtime path for normal `select` MUST NOT depend on full-dataset `filter \+ sort`/i,
  );
  assert.match(
    btreeSpec,
    /M3 implementation of `select` MUST use index seek \+ linked-leaf forward scan/i,
  );
  assert.match(btreeSpec, /Complexity Expectations \(Normative\)/i);
  assert.match(btreeSpec, /point\/range start seek: expected `O\(log N\)`/i);
});

test('M3 plan and status checklist are indexed and recorded in plans docs', async () => {
  const planIndex = await readDoc('docs/plans/INDEX.md');
  const statusChecklist = await readDoc('docs/plans/01_DevelopmentStatusChecklist.md');
  const m3Plan = await readDoc(
    'docs/plans/06_PhaseWorkItem_M3_QueryScalability_IndexHardening.md',
  );

  assert.match(
    planIndex,
    /06_PhaseWorkItem_M3_QueryScalability_IndexHardening\.md/,
  );
  assert.match(
    statusChecklist,
    /## 9\. Active Work-Item Checklist \(M3 Query Scalability Index Hardening\)/,
  );
  assert.match(
    m3Plan,
    /Plan: Phase Work Item \(M3 Query Scalability Index Hardening\)/i,
  );
  assert.match(m3Plan, /Phase B: TDD Red \(Failing Tests First\)/i);
  assert.match(m3Plan, /split\/merge\/rebalance/i);
});

test('ADR index records M3 runtime index decision and usage docs mention complexity in EN/JA', async () => {
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr46 = await readDoc(
    'docs/adr/46_Runtime_BTree_Index_for_M3_QueryScalability.md',
  );
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');

  assert.match(
    adrIndex,
    /46_Runtime_BTree_Index_for_M3_QueryScalability\.md/,
  );
  assert.match(adr46, /Adopt an internal runtime B\+ tree index/i);

  assert.match(usageEn, /expected `O\(log N \+ K\)`/i);
  assert.match(usageJa, /期待計算量 `O\(log N \+ K\)`/);
});
