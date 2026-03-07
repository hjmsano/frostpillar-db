import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('release-hardening spec defines benchmark method, dataset shapes, and policy', async () => {
  const spec = await readFileUtf8('docs/specs/14_ReleaseHardening_v0.1.md');
  const specsIndex = await readFileUtf8('docs/specs/INDEX.md');

  assert.match(spec, /scripts\/benchmark-v0\.1\.mjs/);
  assert.match(spec, /tiny-memory/i);
  assert.match(spec, /small-file/i);
  assert.match(spec, /medium-memory/i);
  assert.match(spec, /regresses by more than `20%`/i);
  assert.match(
    specsIndex,
    /14_ReleaseHardening_v0\.1\.md/,
  );
});

test('benchmark script command and baseline report docs are published', async () => {
  const packageJson = await readFileUtf8('package.json');
  const script = await readFileUtf8('scripts/benchmark-v0.1.mjs');
  const usageEn = await readFileUtf8('docs/usage/06_ReleaseHardening-v0.1.md');
  const usageJa = await readFileUtf8(
    'docs/usage/06_ReleaseHardening-v0.1-JA.md',
  );
  const usageIndex = await readFileUtf8('docs/usage/INDEX.md');

  assert.match(packageJson, /"benchmark:v0\.1"\s*:/);
  assert.match(script, /tiny-memory/);
  assert.match(script, /small-file/);
  assert.match(script, /medium-memory/);
  assert.match(script, /recordsPerSecond/);

  assert.match(usageEn, /v0\.1 Limitations and Non-Goals/i);
  assert.match(usageEn, /Benchmark Method \(v0\.1 baseline\)/i);
  assert.match(usageEn, /pnpm benchmark:v0\.1/i);
  assert.match(usageEn, /browser runtime backend implementation/i);

  assert.match(usageJa, /v0\.1 の制約と非対象/);
  assert.match(usageJa, /ベンチマーク手法 \(v0\.1 baseline\)/);
  assert.match(usageJa, /pnpm benchmark:v0\.1/);
  assert.match(usageJa, /ブラウザランタイムバックエンド実装/);

  assert.match(usageIndex, /06_ReleaseHardening-v0\.1\.md/);
  assert.match(usageIndex, /06_ReleaseHardening-v0\.1-JA\.md/);
});

test('readme and M5 plan state reflect release-hardening closure', async () => {
  const readme = await readFileUtf8('README.md');
  const plan = await readFileUtf8(
    'docs/plans/09_PhaseWorkItem_M5_ReleaseHardening_v0.1.md',
  );
  const adr = await readFileUtf8(
    'docs/adr/52_M5_ReleaseHardening_Benchmark_and_v0.1_Limitations_Contract.md',
  );
  const adrIndex = await readFileUtf8('docs/adr/INDEX.md');

  assert.match(readme, /v0\.1 Limitations and Non-Goals/i);
  assert.match(readme, /location: "memory" and location: "file"/i);
  assert.match(readme, /location: "browser" runtime backend is not implemented yet/i);
  assert.match(readme, /post-v0\.1 direction/i);

  assert.match(plan, /- \[x\] define benchmark dataset shapes and pass\/fail interpretation policy/);
  assert.match(plan, /- \[x\] add failing docs\/spec tests for benchmark-method contract and v0\.1 limitations coverage/);
  assert.match(plan, /- \[x\] add failing verification test for release-readiness checklist synchronization/);
  assert.match(plan, /- \[x\] confirm expected red failures before implementation/);
  assert.match(plan, /- \[x\] implement benchmark script and baseline-report documentation/);
  assert.match(plan, /- \[x\] update README \+ usage EN\/JA with v0\.1 limitations and non-goals/);
  assert.match(plan, /- \[x\] update checklist\/plan\/ADR artifacts to match implemented release-hardening state/);
  assert.match(plan, /- \[x\] targeted M5 tests pass/);
  assert.match(plan, /- \[x\] full suite passes \(`pnpm test --run`\)/);
  assert.match(plan, /- \[x\] quality gate passes \(`pnpm check`\)/);
  assert.match(plan, /- \[x\] status checklist marks M5 exit criteria complete/);

  assert.match(adr, /ADR-52/i);
  assert.match(
    adrIndex,
    /52_M5_ReleaseHardening_Benchmark_and_v0\.1_Limitations_Contract\.md/,
  );
});
