import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('pull request template enforces mandatory phase-gate checklist', async () => {
  const template = await readDoc('.github/pull_request_template.md');

  assert.match(template, /intent alignment/i);
  assert.match(template, /spec update/i);
  assert.match(template, /failing tests/i);
  assert.match(template, /implementation/i);
  assert.match(template, /pnpm test --run/i);
  assert.match(template, /pnpm check/i);
  assert.match(template, /EN\/JA usage docs/i);
  assert.match(template, /ADR/i);
});
