import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readJson = async (filePath) => {
  const source = await readFile(filePath, 'utf8');
  return JSON.parse(source);
};

test('package.json defines textlint scripts for markdown check and fix', async () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const scripts = packageJson.scripts ?? {};

  assert.equal(typeof scripts.textlint, 'string');
  assert.match(scripts.textlint, /textlint/);

  assert.equal(typeof scripts['textlint:fix'], 'string');
  assert.match(scripts['textlint:fix'], /--fix/);

  assert.equal(scripts['format:md'], 'pnpm textlint:fix');
  assert.match(scripts.check ?? '', /pnpm textlint/);
});

test('textlint config exists with at least one rule preset', async () => {
  const configPath = path.resolve(process.cwd(), '.textlintrc.json');
  const config = await readJson(configPath);

  assert.equal(typeof config.rules, 'object');
  assert.ok(config.rules);
  assert.ok(Object.keys(config.rules).length > 0);
});

test('deprecated markdown plugin package is not used', async () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const devDependencies = packageJson.devDependencies ?? {};

  assert.equal(devDependencies['textlint-plugin-markdown'], undefined);
});
