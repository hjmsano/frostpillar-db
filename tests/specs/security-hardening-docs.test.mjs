import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const readDoc = async (relativePath) => {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return await readFile(absolutePath, 'utf8');
};

test('specs define regex safety bounds and path-containment hardening', async () => {
  const datastoreSpec = await readDoc('docs/specs/04_DatastoreAPI.md');
  const queryContract = await readDoc('docs/specs/05_QueryEngineContract.md');

  assert.match(
    datastoreSpec,
    /resolved datastore path MUST stay within current working directory \(`process\.cwd\(\)`\)/i,
  );
  assert.match(
    datastoreSpec,
    /filePrefix` and `target\.fileName` MUST be file-name fragments/i,
  );
  assert.match(
    datastoreSpec,
    /must fail with\s+`ConfigurationError`/i,
  );

  assert.match(
    queryContract,
    /`like` MUST use bounded wildcard matching semantics \(`%` and `_`\) without compiling/i,
  );
  assert.match(
    queryContract,
    /`regexp` patterns using backreferences, look-around assertions, or nested quantifier/i,
  );
  assert.match(
    queryContract,
    /`regexp` pattern length MUST be bounded \(max 256 UTF-16 code units\)/i,
  );
  assert.match(
    queryContract,
    /`like` matching implementation MUST keep additional working memory proportional to[\s\S]*O\(pattern length\)/i,
  );
  assert.match(
    queryContract,
    /each validated `regexp` predicate pattern MUST be[\s\S]*compiled once and reused/i,
  );
});

test('usage docs and ADR record security hardening contract in EN/JA', async () => {
  const usageEn = await readDoc('docs/usage/01_DatastoreAPI.md');
  const usageJa = await readDoc('docs/usage/01_DatastoreAPI-JA.md');
  const adrIndex = await readDoc('docs/adr/INDEX.md');
  const adr = await readDoc(
    'docs/adr/43_QueryRegexSafety_and_FilePathContainment.md',
  );
  const adr45 = await readDoc(
    'docs/adr/45_QueryPredicate_MemoryBound_and_RegexCompileReuse.md',
  );

  assert.match(
    usageEn,
    /`regexp` blocks look-around, backreferences, and nested quantifier groups/i,
  );
  assert.match(
    usageEn,
    /resolved file datastore path must stay under `process\.cwd\(\)`/i,
  );
  assert.match(
    usageEn,
    /`like` matching keeps additional working memory proportional to pattern length/i,
  );
  assert.match(
    usageEn,
    /`regexp` predicate pattern is compiled once per native query execution/i,
  );

  assert.match(
    usageJa,
    /`regexp` は look-around・backreference・入れ子量指定グループ.*を拒否します/i,
  );
  assert.match(
    usageJa,
    /file backend の解決後パスは `process\.cwd\(\)` 配下に制限されます/i,
  );
  assert.match(
    usageJa,
    /`like` の照合は、追加作業メモリをパターン長に比例する範囲.*制限します/i,
  );
  assert.match(
    usageJa,
    /`regexp` パターンは 1 回の native query 実行につき 1 回だけコンパイルし/i,
  );

  assert.match(
    adrIndex,
    /43_QueryRegexSafety_and_FilePathContainment\.md/,
  );
  assert.match(
    adrIndex,
    /45_QueryPredicate_MemoryBound_and_RegexCompileReuse\.md/,
  );
  assert.match(
    adr,
    /Bound query-time pattern complexity and enforce file datastore path containment/i,
  );
  assert.match(
    adr45,
    /MUST use an algorithm with additional working memory[\s\S]*bounded by pattern length/i,
  );
  assert.match(
    adr45,
    /compile each `regexp` predicate pattern once[\s\S]*query invocation[\s\S]*reuse/i,
  );
});
