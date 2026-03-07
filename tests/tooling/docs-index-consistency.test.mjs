import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const listMarkdownFiles = async (directory) => {
  const absoluteDirectory = path.resolve(process.cwd(), directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => name !== 'INDEX.md')
    .sort();
};

const listIndexedMarkdownFiles = async (indexPath) => {
  const absoluteIndexPath = path.resolve(process.cwd(), indexPath);
  const source = await readFile(absoluteIndexPath, 'utf8');

  const matches = [...source.matchAll(/\]\(\.\/([^\)]+\.md)\)/g)];

  return matches
    .map((match) => match[1])
    .filter((name) => name !== 'INDEX.md')
    .sort();
};

test('docs/specs index references all spec markdown files', async () => {
  const directoryFiles = await listMarkdownFiles('docs/specs');
  const indexFiles = await listIndexedMarkdownFiles('docs/specs/INDEX.md');

  assert.deepEqual(indexFiles, directoryFiles);
});

test('docs/adr index references all adr markdown files', async () => {
  const directoryFiles = await listMarkdownFiles('docs/adr');
  const indexFiles = await listIndexedMarkdownFiles('docs/adr/INDEX.md');

  assert.deepEqual(indexFiles, directoryFiles);
});
