import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('distribution spec defines CI/CD trigger and command contract', async () => {
  const spec = await readFileUtf8(
    'docs/specs/13_DistributionDeliveryTracks.md',
  );

  assert.match(spec, /GitHub Actions CI\/CD Contract/i);
  assert.match(spec, /pull request open\/reopen\/synchronize events/i);
  assert.match(spec, /`pnpm check`/i);
  assert.match(spec, /`pnpm test --run`/i);
  assert.match(spec, /`pnpm build`/i);
  assert.match(spec, /`pnpm build:bundle`/i);
  assert.match(spec, /default branch/i);
});

test('development workflow usage docs include bilingual CI/CD operation guidance', async () => {
  const usageEn = await readFileUtf8('docs/usage/03_DevelopmentWorkflow.md');
  const usageJa = await readFileUtf8('docs/usage/03_DevelopmentWorkflow-JA.md');

  assert.match(usageEn, /GitHub Actions CI\/CD/i);
  assert.match(usageEn, /pull request/i);
  assert.match(usageEn, /default branch/i);
  assert.match(usageEn, /`pnpm build:bundle`/i);

  assert.match(usageJa, /GitHub Actions CI\/CD/);
  assert.match(usageJa, /プルリクエスト/);
  assert.match(usageJa, /デフォルトブランチ/);
  assert.match(usageJa, /`pnpm build:bundle`/);
});

test('adr for ci cd workflow policy is recorded and indexed', async () => {
  const adr = await readFileUtf8(
    'docs/adr/44_GitHub_Actions_CI_CD_Validation_and_Build_Policy.md',
  );
  const adrIndex = await readFileUtf8('docs/adr/INDEX.md');

  assert.match(adr, /ADR-44/i);
  assert.match(adr, /GitHub Actions CI\/CD Validation and Build Policy/i);
  assert.match(adr, /pull requests?[\s\S]*lint and test/i);
  assert.match(adr, /default branch[\s\S]*build/i);
  assert.match(
    adrIndex,
    /44_GitHub_Actions_CI_CD_Validation_and_Build_Policy\.md/,
  );
});
