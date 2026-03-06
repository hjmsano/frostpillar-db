import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileUtf8 } from '../shared/read-file-utf8.mjs';

test('github actions workflow defines pull request ci and default branch build gates', async () => {
  const workflow = await readFileUtf8('.github/workflows/ci-cd.yml');

  assert.match(workflow, /^on:\n[\s\S]*pull_request:/m);
  assert.match(workflow, /types:\s*\[\s*opened,\s*reopened,\s*synchronize,\s*ready_for_review\s*\]/);
  assert.match(workflow, /^\s+push:\s*$/m);
  assert.match(workflow, /github\.event\.repository\.default_branch/);

  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm test --run/);
  assert.match(workflow, /pnpm build/);
  assert.match(workflow, /pnpm build:bundle/);

  assert.match(workflow, /if:\s*github\.event_name == 'push' && github\.ref_name == github\.event\.repository\.default_branch/);
});
